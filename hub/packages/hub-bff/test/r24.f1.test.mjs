import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {project,lastSentence} from '../lib/timeline.mjs';
import {SessionStore} from '../lib/store.mjs';
import {formatTicket} from '../lib/delegation.mjs';
import {fixture,request} from './fixtures.mjs';
const headers={'x-hub-device':'f1-device'};
const meta={v:1,bot:'chief',sessionId:'s1',level:'L3',action:'写共享区',tool:'write',path:'/Users/example/dsh-work/shared/f1.md',chars:3,preview:'假草稿'};
const reason='HUBAPPROVAL1 '+JSON.stringify(meta);
const event=(seq,type,data)=>({event:{seq,type,data,time:Date.now()+seq}});
async function eventually(fn){for(let n=0;n<2400;n++){if(await fn())return;await delay(5);}assert.fail('F1 等待状态超时');}
async function setup(fn,options){const f=await fixture(options);try{await fn(f);}finally{await f.dispose();}}
function ask(f,{invalid=false,signal}={}) {
 const req={toolName:'write',callId:'f1-call',reason:invalid?'HUBAPPROVAL1 {':reason};
 f.source.records=[event(3,'approval/asked',{id:invalid?'f1-bad':'f1-approval',...req})];
 return f.handler.runtime.receive({eventId:'f1-wire',agentId:'s1',request:req},signal);
}
const cards=f=>request(f.handler,{path:'/bff/sessions/s1/cards'}).json();

test('F1 原因：无设备保持待批，坏请求仍拒绝，原因透传并持久化',()=>setup(async f=>{
 const result=ask(f);await eventually(()=>f.handler.runtime.cards()[0]?.status==='pending');
 assert.equal(f.handler.runtime.cards()[0].reason,undefined);
 await request(f.handler,{path:'/bff/status',headers}).done;
 assert.equal(await ask(f,{invalid:true}),'rejected');
 const all=f.handler.runtime.cards();
 assert.deepEqual(all.map(c=>[c.status,c.reason]),[['pending',undefined],['unavailable','bad-request']]);
 assert.deepEqual(JSON.parse(await readFile(f.storeFile,'utf8')).cards.map(c=>c.reason),[undefined,'bad-request']);
 await f.handler.runtime.resolve(all[0],'rejected','f1-device');assert.equal(await result,'rejected');assert.equal(f.handler.runtime.waiters.size,0);
}));

for(const mode of ['lost','abort','offline-answer'])test('F1 原因：'+mode+' 保存服务断开，晚到批准仍拒绝',()=>setup(async f=>{
 await request(f.handler,{path:'/bff/status',headers}).done;
 await f.client.connect();
 const controller=new AbortController(),result=ask(f,{signal:controller.signal});
 await eventually(()=>f.handler.runtime.cards()[0]?.status==='pending');
 if(mode==='abort')controller.abort();
 else if(mode==='lost')await f.handler.runtime.lost();
 else {
  f.client.interactionHandler=()=>{};f.client.connected=false;
  const response=request(f.handler,{method:'POST',path:'/bff/approvals/f1-approval/answer',headers,value:{decision:'approve'}});
  await response.done;assert.equal(response.res.status,409);
 }
 assert.equal(await result,'rejected');
 const card=(await cards(f)).cards[0];assert.equal(card.reason,'dsh-disconnected');assert.equal(card.status,'unavailable');
 const late=request(f.handler,{method:'POST',path:'/bff/approvals/f1-approval/answer',headers,value:{decision:'approve'}});
 await late.done;assert.equal(late.res.status,409);
 assert.equal(JSON.parse(await readFile(f.storeFile,'utf8')).cards[0].reason,'dsh-disconnected');
}));

test('F1 原因：加载遗留 pending 标记 bff-restart，已结束旧卡不补造原因',()=>setup(async f=>{
 const ts=new Date().toISOString(),path=join(f.handlerOptions.configDir,'f1-restart.json');await mkdir(f.handlerOptions.configDir,{recursive:true});
 await writeFile(path,JSON.stringify({sessions:[],cards:[{id:'pending',type:'approval',status:'pending',createdAt:ts},{id:'legacy',type:'approval',status:'unavailable',createdAt:ts}]}));
 const store=new SessionStore(path);await store.ready;
 assert.equal(store.cards[0].status,'unavailable');assert.equal(store.cards[0].reason,'bff-restart');assert.equal('reason' in store.cards[1],false);
 assert.equal(JSON.parse(await readFile(path,'utf8')).cards[0].reason,'bff-restart');
}));

test('F1 原因：已断线且无法取审批身份，仍按服务断开而不是信息不全结束',()=>setup(async f=>{
 f.client.interactionHandler=()=>{};f.client.connected=false;f.client.approvalContext=async()=>({});
 assert.equal(await ask(f),'rejected');
 const card=f.handler.runtime.cards()[0];assert.equal(card.reason,'dsh-disconnected');assert.equal(card.status,'unavailable');
}));

test('F1 原因：正常关闭也给待批卡 bff-restart',()=>setup(async f=>{
 await request(f.handler,{path:'/bff/status',headers}).done;const result=ask(f);
 await eventually(()=>f.handler.runtime.cards()[0]?.status==='pending');await f.handler.dispose();
 assert.equal(await result,'rejected');assert.equal(f.handler.runtime.cards()[0].reason,'bff-restart');
}));

test('F1 工具：内核英文全部映射短句，中文插件解释优先，未知英文不泄漏',()=>{
 const cases=[['Error: the user rejected tool "write"','主人 没批准'],['Error: approval request was cancelled','审批取消了'],
  ['Error: tool "write" requires approval, but no approval channel is available','审批通道不在线'],['Approval unavailable','审批通道不在线'],
  ['Error: unexpected kernel failure in 中文文件.md','这一步没做成'],['Error: 磁盘写入失败。不要带后一句。','磁盘写入失败。']];
 for(const [text,expected] of cases){
  const t=project([event(1,'tool/call',{callId:'c',name:'write'}),event(2,'tool/result',{message:{toolCallId:'c',isError:true,content:[{type:'text',text}]}})]);
  assert.equal(t.surface()[0].tools[0].brief,expected);
 }
 const t=project([event(1,'tool/call',{callId:'c',name:'write'}),event(2,'tool/result',{message:{toolCallId:'c',isError:true,content:[{type:'text',text:'Error: the user rejected tool "write"'},{type:'text',text:'主人 没批准，这一步没做'}]}})]);
 assert.equal(t.surface()[0].tools[0].brief,'主人 没批准，这一步没做');
});

test('F1 why：丢弃未完成末句，按五类句尾取完整句，超长带省略号且不切半个字符',()=>{
 for(const mark of ['。','！','？','!','?'])assert.equal(lastSentence('前一句。最后的完整句'+mark+'还没说完'),'最后的完整句'+mark);
 assert.equal(lastSentence('前一句。\n这一句说明写入目的。\n验证审批卡能显'),'这一句说明写入目的。');
 assert.equal(lastSentence('猫'.repeat(100)+'。尾巴'),'猫'.repeat(80)+'…');
 assert.equal(lastSentence('😀'.repeat(90)+'！'),'😀'.repeat(80)+'…');
 assert.equal(lastSentence('没有完整句'), '');
 const t=project([event(1,'assistant/message',{turn:1,step:1,message:{content:[{type:'text',text:'把日期写进共享区。接着验证审批卡能显'},{type:'tool-call',id:'c'},{type:'text',text:'调用后的句子。'}]}}),event(2,'tool/call',{callId:'c',name:'write',turn:1,step:1})]);
 assert.equal(t.calls.get('c').why,'把日期写进共享区。');
});

for(const count of [8,9])test('F1 最近摘要：'+count+'步上限与卡片/工单一致，接口及落盘均保留具体原因',()=>setup(async f=>{
 const ts=new Date().toISOString(),id='T-20261117-191800-f1aa';
 const ticket={meta:{id,kind:'delegation',creator:'chief',assignee:'pm',status:'queued',createdAt:ts,updatedAt:ts,fromSession:'s1',toSession:'',steps:'0'},task:'假模型步数上限测试',progress:'- '+ts+' 首席派出',report:''};
 const dir=join(f.handlerOptions.ticketsDir,'working');await mkdir(dir,{recursive:true});await writeFile(join(dir,id+'.md'),formatTicket(ticket));
 await f.handler.delegations.tick();const card=f.handler.runtime.cards()[0];
 for(let n=1;n<=count;n++)f.source.emit({type:'event',event:event(n,'step/start',{turn:1,step:n}).event},card.toSession);
 if(count===8){f.source.emit({type:'event',event:event(9,'hub-plugin/notice',{text:'超过 8 步自动停'}).event},card.toSession);f.source.emit({type:'event',event:event(10,'turn/end',{reason:{kind:'blocked'}}).event},card.toSession);}
 await eventually(async()=>{try{await readFile(join(f.handlerOptions.ticketsDir,'failed',id+'.md'));const row=f.handler.runtime.store.get(card.toSession);return !row.running && row.unread===1;}catch{return false;}});
 const sessions=(await request(f.handler,{path:'/bff/sessions'}).json()).sessions,row=sessions.find(s=>s.id===card.toSession);
 assert.equal(row.lastText,'做了 8 步还没做完，按规矩先停了：已完成 0 件，剩下的没做');assert.equal(row.lastRole,'error');assert.equal(row.unread,1);assert.equal(card.reason,row.lastText);
 assert.match(await readFile(join(f.handlerOptions.ticketsDir,'failed',id+'.md'),'utf8'),/## 回报\n做了 8 步还没做完，按规矩先停了：已完成 0 件，剩下的没做/u);
 await f.handler.runtime.store.flush();
 assert.equal(JSON.parse(await readFile(f.storeFile,'utf8')).sessions.find(s=>s.id===card.toSession).lastText,row.lastText);
}));
