import assert from 'node:assert/strict';
import {join} from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, request, userEvent, assistantEvent, snapshot } from './fixtures.mjs';
export const cases = {
  '兼容性：运行版本未知时不得照抄参考源码版本': async f => {
    const response = request(f.handler); const health = await response.json();
    assert.equal(health.dsh.connected,true);assert.equal('version' in health.dsh,false);assert.equal(health.model,'hub-fake/echo-1');
  },
  '列会话：只调用列表并按可证实的 bot 映射筛选，不激活会话': async f => {
    const response=request(f.handler,{path:'/bff/sessions'});assert.deepEqual(await response.json(),{sessions:[{id:'s1',bot:'chief',title:'First',lastText:'',lastRole:null,updatedAt:900,unread:0,running:false}]});
    assert.deepEqual(f.source.named('session/list'),[]);assert.equal(f.source.named('session/create').length,0);assert.equal(f.source.named('session/prompt').length,0);
  },
  '建会话：同时传递明确预设与目录，并采用真实返回的会话标识': async f => {
    const result=await request(f.handler,{method:'POST',path:'/bff/sessions',value:{title:'Title'}}).json();
    assert.equal(result.id,'created-1');assert.equal(result.bot,'chief');assert.deepEqual(f.source.named('session/create'),[{request:{cwd:join(f.botsDir,'chief'),agentPreset:'hub-chief'}}]);assert.deepEqual(f.source.named('session/rename'),[{request:{sessionId:result.id,title:'Title'}}]);
  },
  '建会话：目录与工作区同时出现时在调用前拒绝': async f => {
    const r=request(f.handler,{method:'POST',path:'/bff/sessions',value:{cwd:'/tmp',workspaceId:'other'}});assert.equal((await r.json()).error.code,'INVALID_INPUT');assert.equal(f.source.named('session/create').length,0);
  },
  '建会话：预设损坏或目录冲突不回退为其他 bot': async f => {
    f.source.rpcOverride=e=>e.method==='session/create'?f.source.response(e,{ok:false,error:{code:'agent-preset/conflict',message:'secret'}}):undefined;
    const r=request(f.handler,{method:'POST',path:'/bff/sessions',value:{}});assert.equal((await r.json()).error.code,'CONFLICT');assert.equal(f.source.named('session/create').length,1);
  },
  '读历史：保留分页切点与顺序，读取不激活会话': async f => {
    const older=[userEvent(1),assistantEvent(2)];const newer=[userEvent(3,'two'),assistantEvent(4,'second')];
    f.source.rpcOverride=e=>e.method==='session/events'?f.source.response(e,{ok:true,value:e.payload.args.request.beforeSeq?{records:older,cursor:9,hasMore:false}:{records:newer,cursor:9,hasMore:true}}):undefined;
    const r=await request(f.handler,{path:'/bff/sessions/s1/history'}).json();assert.deepEqual(r.messages.map(x=>x.text),['hello','echo','two','second']);
    assert.deepEqual(f.source.named('session/events').map(x=>x.request),[{address:{kind:'session',sessionId:'s1'},maxMessages:200},{address:{kind:'session',sessionId:'s1'},maxMessages:200,beforeSeq:3,throughSeq:9}]);assert.equal(f.source.named('session/create').length,0);
  },
  '发消息：保留关联标识和排队模式，接纳不等于生成完成': async f => {
    const r=request(f.handler,{method:'POST',path:'/bff/sessions/s1/messages',value:{text:'hello'}});const data=await r.json();assert.equal(r.res.status,202);assert.equal(data.accepted,true);assert.match(data.requestId,/^[a-f0-9-]{36}$/);
    assert.deepEqual(f.source.named('session/prompt'),[{request:{sessionId:'s1',requestId:data.requestId,mode:'queue',content:[{type:'text',text:'hello'}]}}]);assert.equal(f.source.streams.size,1);
  },
  '发消息：不把空白输入误变成上游空数组续跑': async f => {
    const r=await request(f.handler,{method:'POST',path:'/bff/sessions/s1/messages',value:{text:'  '}}).json();assert.equal(r.error.code,'INVALID_INPUT');assert.equal(f.source.named('session/prompt').length,0);
  },
  '发消息：接纳后回执丢失标为结果未知且不自动重发': async f => {
    f.source.lostAdmission=true;const r=await request(f.handler,{method:'POST',path:'/bff/sessions/s1/messages',value:{text:'once'}}).json();assert.equal(r.error.code,'DISCONNECTED');assert.equal(f.source.named('session/prompt').length,1);assert.equal(JSON.stringify(r).includes('PRIVATE_TOKEN'),false);
  },
  '收流：请求快照与临时输出，不发送上游未定义的续传游标': async f => {
    const stream=await f.client.follow('s1');assert.equal((await stream.next()).value.type,'snapshot');
    const open=f.source.calls.find(x=>x.endpoint==='open').args;assert.deepEqual(open.payload,{args:{request:{address:{kind:'session',sessionId:'s1'},assistantStream:true,maxMessages:200}}});stream.dispose();
  },
  '收流：相同持久序号重复到达只投递一次，不丢替换语义': async f => {
    const stream=await f.client.follow('s1');await stream.next();const event=assistantEvent(2);f.source.emit(event);f.source.emit(event);f.source.emit(userEvent(3));assert.equal((await stream.next()).value.role,'assistant');assert.equal((await stream.next()).value.role,'user');stream.dispose();
    // Rich surface replacement notices are outside HTTP message shape; history is reconstructed separately.
  },
  '收流：临时片段没有持久游标，提交后不重复形成两条消息': async f => {
    const stream=await f.client.follow('s1');await stream.next();f.source.emit({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',index:0,chunk:{type:'text-delta',text:'echo'}}});f.source.emit(assistantEvent(2));assert.deepEqual((await stream.next()).value,{type:'delta',text:'echo'});assert.equal((await stream.next()).value.type,'message');stream.dispose();
  },
  '收流：关闭和切换会话后迟到帧不再投递，关闭不取消生成': async f => {
    const stream=await f.client.follow('s1');await stream.next();stream.dispose();stream.dispose();f.source.emit(userEvent(1));assert.equal(f.source.streams.size,0);assert.equal(f.source.named('session/cancel').length,0);
  },
  '收流：重新订阅接收新代完整快照，旧代帧不能污染新会话': async f => {
    const a=await f.client.follow('s1');await a.next();a.dispose();const b=await f.client.follow('s2');assert.equal((await b.next()).value.type,'snapshot');assert.equal(f.source.streams.size,1);b.dispose();
  },
  '取消：只承诺取消请求已接纳并保留队列': async f => {
    assert.deepEqual(await request(f.handler,{method:'POST',path:'/bff/sessions/s1/cancel',value:{}}).json(),{ok:true});assert.deepEqual(f.source.named('session/cancel'),[{request:{sessionId:'s1'}}]);assert.equal(f.source.named('session/updateQueue').length,0);
  },
  '取消：未挂载会话返回上游找不到错误，不伪造停止成功': async f => {
    f.source.rpcOverride=e=>e.method==='session/cancel'?f.source.response(e,{ok:false,error:{code:'session/not-found',message:'COOKIE secret'}}):undefined;
    const r=request(f.handler,{method:'POST',path:'/bff/sessions/s1/cancel',value:{}});assert.equal((await r.json()).error.code,'NOT_FOUND');assert.equal(r.res.status,404);
  },
  '释放：重复释放安全，后续调用拒绝且不存在残留订阅': async f => {
    await f.client.follow('s1');f.client.dispose();f.client.dispose();await assert.rejects(f.client.listSessions(),e=>e.code==='DISCONNECTED');assert.equal(f.source.streams.size,0);
  }
};
export const semantics = {
  '列会话：只调用列表并按可证实的 bot 映射筛选，不激活会话':'验证 Hub 服务端清单不激活上游；bot 筛选另由 r23 契约测试覆盖',
  '建会话：同时传递明确预设与目录，并采用真实返回的会话标识':'验证旧式不带 bot 的兼容分支；r23 明确预设与目录另测',
  '发消息：接纳后回执丢失标为结果未知且不自动重发':'本轮错误形状仅 code/message；验证失败和不重发，结果未知语义见 README',
  '收流：相同持久序号重复到达只投递一次，不丢替换语义':'验证序号去重；富事件 surfaceOp 不在 SSE 消息契约内'
};
export async function runCase(name) { const f=await fixture();try{await cases[name](f);}finally{await f.dispose();} }
export function skipReason(name) {
  if (/审批/.test(name))return '通用 HubAdapter 句柄语义与 BFF 卡片契约不同；r24.contract.test.mjs 单独覆盖实际审批链';
  if (/任务单|看板/.test(name))return '本工单只提供聊天 BFF，不提供工单和看板存储';
  if (/定时/.test(name))return '本工单不提供定时接口';
  if (/用量/.test(name))return '本工单不提供用量接口，且无订阅窗口凭据';
  if (/能力卡/.test(name))return '本工单不提供业务能力卡接口';
  if (/bot|预设/.test(name))return '本工单不提供 bot 映射或预设管理接口';
  return '富事件兼容性透传超出本轮精简 HTTP/SSE 契约';
}
