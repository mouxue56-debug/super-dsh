import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay, setImmediate as tick } from 'node:timers/promises';
import { createHandler } from '../server.mjs';
import {TEST_BOT_IDS as BOT_IDS} from './roster-fixture.mjs';
import { SessionStore } from '../lib/store.mjs';
import { fixture, request, snapshot, assistantEvent, testDirectory } from './fixtures.mjs';

const row = (id='s1', bot='chief') => ({id,bot,title:'',lastText:'',lastRole:null,updatedAt:1,unread:0,running:false});
const call = (f,method,path,value) => request(f.handler,{method,path,value});
const send = (f,text,id='s1') => call(f,'POST',`/bff/sessions/${id}/messages`,{text});
const sessions = async f => (await call(f,'GET','/bff/sessions').json()).sessions;
const end = (seq=20,kind='completed') => ({type:'event',event:{type:'turn/end',seq,data:{reason:{kind}}}});
const chunk = (index,text) => ({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',index,chunk:{type:'text-delta',text}}});
async function eventually(predicate) {
  const deadline = Date.now()+2500;
  do { if (await predicate()) return; await delay(5); } while (Date.now()<deadline);
  assert.fail('等待内存夹具状态超时');
}
async function withFixture(body,options) { const f=await fixture(options); try { await body(f); } finally { await f.dispose(); } }

test('预设固定六行、固定顺序和正确目录，查询不触发上游',()=>withFixture(async f=>{
  const r=call(f,'GET','/bff/presets'); const data=await r.json();
  assert.deepEqual(data.bots,BOT_IDS.map((bot,index)=>({bot,preset:'hub-'+bot,
    name:['首席助理','客服助理','内容助理','项目经理','艺术总监','调研员'][index],cwd:join(f.botsDir,bot),phrases:[]})));
  assert.equal(r.res.status,200); assert.equal(f.source.calls.length,0);
}));

test('六个 bot 建会话传对应预设和目录，清单按更新时间倒序并支持过滤',()=>withFixture(async f=>{
  for (const bot of BOT_IDS) {
    const r=call(f,'POST','/bff/sessions',{bot}); const value=await r.json();
    assert.equal(r.res.status,201); assert.equal(value.bot,bot); assert.equal(value.title,'');
    assert.equal(value.lastText,''); assert.equal(value.lastRole,null); assert.equal(value.unread,0); assert.equal(value.running,false);
  }
  assert.deepEqual(f.source.named('session/create').map(item=>item.request),BOT_IDS.map(bot=>({cwd:join(f.botsDir,bot),agentPreset:'hub-'+bot})));
  const all=await sessions(f); assert.equal(all.length,6); assert.ok(all.every((value,index)=>index===0||value.updatedAt<=all[index-1].updatedAt));
  assert.deepEqual((await call(f,'GET','/bff/sessions?bot=art').json()).sessions.map(value=>value.bot),['art']);
  assert.equal(f.source.named('session/list').length,0); assert.equal(f.source.named('session/prompt').length,0);
},{seed:false,requireBot:true}));

test('r23 缺 bot、非法 bot 和非法筛选返回 400，不回退到 chief',()=>withFixture(async f=>{
  for (const bot of [undefined,null,'other','../chief','toString',23]) {
    const r=call(f,'POST','/bff/sessions',bot===undefined?{}:{bot}); assert.equal((await r.json()).error.code,'INVALID_INPUT'); assert.equal(r.res.status,400);
  }
  const bad=call(f,'GET','/bff/sessions?bot=other'); await bad.done; assert.equal(bad.res.status,400);
  assert.equal(f.source.calls.length,0);
},{requireBot:true}));

test('目录不存在报 BOTS_DIR_MISSING，既不建目录也不调用上游',()=>withFixture(async f=>{
  await f.handler.dispose();
  const missing=join(f.botsDir,'not-created');
  f.handler=createHandler({client:f.client,key:f.key,...f.handlerOptions,botsDir:missing});
  const r=call(f,'POST','/bff/sessions',{bot:'chief'}); assert.equal((await r.json()).error.code,'BOTS_DIR_MISSING'); assert.equal(r.res.status,503);
  await assert.rejects(stat(missing),{code:'ENOENT'}); assert.equal(f.source.calls.length,0);
}));

test('不带 bot 的兼容入口也从名册读取首席预设和目录',()=>withFixture(async f=>{
  const value=await call(f,'POST','/bff/sessions',{}).json();
  assert.equal(value.bot,'chief'); assert.deepEqual(f.source.named('session/create'),[{request:{cwd:join(f.botsDir,'chief'),agentPreset:'hub-chief'}}]);
  assert.ok((await sessions(f)).some(item=>item.id===value.id));
}));

test('清单持久化，重建处理器后会话仍在且 running 一律归 false',()=>withFixture(async f=>{
  const created=await call(f,'POST','/bff/sessions',{bot:'research',title:'保留会话'}).json();
  await f.handler.dispose();
  const content=JSON.parse(await readFile(f.storeFile,'utf8'));
  content.sessions.find(item=>item.id===created.id).running=true;
  await writeFile(f.storeFile,JSON.stringify(content));
  f.handler=createHandler({client:f.client,key:f.key,...f.handlerOptions}); await f.handler.ready;
  const loaded=(await sessions(f)).find(item=>item.id===created.id);
  assert.equal(loaded.title,'保留会话'); assert.equal(loaded.bot,'research'); assert.equal(loaded.running,false);
  assert.equal((await stat(f.storeFile)).mode&0o777,0o600);
  assert.equal(JSON.parse(await readFile(f.storeFile,'utf8')).sessions.find(item=>item.id===created.id).running,false);
}));

test('坏 JSON 与坏结构都保全原稿、报告固定错误并从空清单恢复',async()=>{
  for (const content of ['{broken',JSON.stringify({sessions:[{id:'incomplete'}]})]) {
    const directory=await testDirectory(), path=join(directory,'store.json'), errors=[];
    await writeFile(path,content,{mode:0o600});
    const store=new SessionStore(path,{logger:{error:value=>errors.push(value)}}); await store.ready;
    assert.deepEqual(store.list(),[]); assert.equal(errors.length,1); assert.equal(errors[0].includes(content),false);
    const backup=(await readdir(directory)).find(name=>name.startsWith('store.json.corrupt-'));
    assert.ok(backup); assert.equal(await readFile(join(directory,backup),'utf8'),content);
    assert.equal((await stat(path)).mode&0o777,0o600);
  }
});

test('并发更新串行原子写，保留全部增量并修正临时文件权限',async()=>{
  const directory=await testDirectory(), path=join(directory,'store.json');
  await writeFile(path+'.tmp','old',{mode:0o644});
  const store=new SessionStore(path); await store.ready; await store.add(row());
  await Promise.all(Array.from({length:12},()=>store.update('s1',value=>({unread:value.unread+1}))));
  assert.equal(JSON.parse(await readFile(path,'utf8')).sessions[0].unread,12);
  assert.equal((await stat(path)).mode&0o777,0o600); await assert.rejects(stat(path+'.tmp'),{code:'ENOENT'});
});

test('首条消息按首句截 24 字改 DSH 标题，保留已有标题',()=>withFixture(async f=>{
  const first=await call(f,'POST','/bff/sessions',{bot:'content'}).json();
  const text='猫'.repeat(25)+'。后面的句子'; const r=send(f,text,first.id); await r.done;
  assert.equal(r.res.status,202); assert.equal((await sessions(f)).find(item=>item.id===first.id).title,'猫'.repeat(24));
  assert.deepEqual(f.source.named('session/rename').at(-1),{request:{sessionId:first.id,title:'猫'.repeat(24)}});
  f.source.emit(end(),first.id); await eventually(async()=>!(await sessions(f)).find(item=>item.id===first.id).running);
  const second=await call(f,'POST','/bff/sessions',{bot:'pm',title:'用户标题'}).json();
  await send(f,'新标题？下一句',second.id).done;
  assert.equal(f.source.named('session/rename').filter(item=>item.request.sessionId===second.id).length,1);
  assert.equal((await sessions(f)).find(item=>item.id===second.id).title,'用户标题');
}));

test('换行、问号和感叹号都作为首句终点，emoji 按字截断',()=>withFixture(async f=>{
  for (const delimiter of ['\n','？','！','?','!']) {
    const created=await call(f,'POST','/bff/sessions',{bot:'chief'}).json();
    await send(f,'😀'.repeat(25)+delimiter+'其他',created.id).done;
    assert.equal((await sessions(f)).find(item=>item.id===created.id).title,'😀'.repeat(24));
  }
}));

test('follow 的 snapshot 就绪前不发 prompt，离线浏览器也后台完成',()=>withFixture(async f=>{
  f.source.holdSnapshot=true;
  const r=send(f,'短问题'); await eventually(()=>f.source.streams.size===1);
  assert.equal(f.source.named('session/prompt').length,0);
  f.source.emit(snapshot()); await r.done; assert.equal(r.res.status,202);
  assert.equal((await sessions(f))[0].running,true);
  const sequence=f.source.calls.map(item=>item.endpoint); assert.ok(sequence.indexOf('open')<sequence.indexOf('/api/session/prompt'));
  f.source.emit(assistantEvent(2,'回复'.repeat(80))); f.source.emit(end(3));
  await eventually(async()=>!(await sessions(f))[0].running);
  const value=(await sessions(f))[0]; assert.equal(value.lastText,'回复'.repeat(60)); assert.equal(value.lastRole,'assistant'); assert.equal(value.unread,1);
  assert.equal(f.source.streams.size,0); assert.equal(f.source.named('session/cancel').length,0);
}));

test('超快模型在接纳回执返回前结束也不丢后台结果',()=>withFixture(async f=>{
  f.source.rpcOverride=envelope=>{
    if (envelope.method==='session/prompt') { f.source.emit(assistantEvent(2,'已完成')); f.source.emit(end(3)); }
  };
  assert.equal((await send(f,'快答').json()).accepted,true);
  await eventually(async()=>!(await sessions(f))[0].running);
  assert.equal((await sessions(f))[0].lastText,'已完成'); assert.equal((await sessions(f))[0].unread,1);
}));

test('status 汇总六个 bot，read 清零且不重置运行状态',()=>withFixture(async f=>{
  await send(f,'第一轮').done;
  const running=(await call(f,'GET','/bff/status').json()).bots;
  assert.deepEqual(Object.keys(running),BOT_IDS); assert.deepEqual(running.chief,{running:true,runningSessionId:'s1',unread:0,pending:0,delegated:{running:false,queued:0}});
  f.source.emit(assistantEvent(2,'完成')); f.source.emit(end(3)); await eventually(async()=>!(await sessions(f))[0].running);
  assert.equal((await call(f,'GET','/bff/status').json()).bots.chief.unread,1);
  await send(f,'第二轮').done;
  assert.deepEqual(await call(f,'POST','/bff/sessions/s1/read',{}).json(),{ok:true});
  assert.deepEqual((await call(f,'GET','/bff/status').json()).bots.chief,{running:true,runningSessionId:'s1',unread:0,pending:0,delegated:{running:false,queued:0}});
  assert.equal(f.source.named('session/prompt').length,2);
}));

test('同一 bot 多会话汇总未读，运行会话取最新一条',()=>withFixture(async f=>{
  const second=await call(f,'POST','/bff/sessions',{bot:'chief'}).json();
  await send(f,'第一会话').done; await send(f,'第二会话',second.id).done;
  let value=(await call(f,'GET','/bff/status').json()).bots.chief;
  assert.equal(value.running,true); assert.equal(value.runningSessionId,second.id);
  f.source.emit(end(3)); f.source.emit(end(3),second.id);
  await eventually(async()=>(await sessions(f)).every(item=>!item.running));
  value=(await call(f,'GET','/bff/status').json()).bots.chief;
  assert.deepEqual(value,{running:false,runningSessionId:null,unread:2,pending:0,delegated:{running:false,queued:0}});
}));

test('清单外 history/messages/cancel/read/stream 均为 404，连上游都不做',()=>withFixture(async f=>{
  for (const [method,action] of [['GET','history'],['POST','messages'],['POST','cancel'],['POST','read'],['GET','stream']]) {
    const r=call(f,method,'/bff/sessions/foreign/'+action,action==='messages'?{text:'禁止调用'}:{});
    assert.equal((await r.json()).error.code,'NOT_FOUND'); assert.equal(r.res.status,404);
  }
  assert.equal(f.source.calls.length,0);
}));

test('新增路由也须先鉴权，查询参数中的 key 不生效',()=>withFixture(async f=>{
  for (const [method,path] of [['GET','/bff/presets'],['GET','/bff/status'],['POST','/bff/sessions/s1/read']]) {
    const r=request(f.handler,{method,path:path+'?key='+f.key,key:null,value:{}}); await r.done; assert.equal(r.res.status,401);
  }
  assert.equal(f.source.calls.length,0);
}));

test('stream 首帧 state 携带当前 partial，snapshot 正文不再重复作为 delta',()=>withFixture(async f=>{
  await send(f,'继续回复').done;
  f.source.initialSnapshot={...snapshot(),assistantStream:{activeAttempt:{attemptId:'a',nextIndex:2,
    stream:[{type:'text-chunks',texts:['已','生成']},{type:'reasoning-chunks',texts:['不公开']},{type:'text-chunks',texts:['全文']}]}}};
  const r=call(f,'GET','/bff/sessions/s1/stream'); await eventually(()=>r.res.text.includes('event: state'));
  assert.equal(r.res.text,'event: state\ndata: {"running":true,"partial":"已生成全文"}\n\n');
  f.source.emit(chunk(1,'重复')); f.source.emit(chunk(2,'新增')); await eventually(()=>r.res.text.includes('新增'));
  assert.equal(r.res.text.includes('重复'),false); assert.equal(r.res.text.includes('不公开'),false);
  assert.equal(r.res.text.match(/event: delta/g).length,1);
  r.res.destroy(); await r.done;
  assert.equal(f.source.streams.size,1); // 浏览器离开不关后台跟随。
  f.source.emit(assistantEvent(2,'已生成全文新增')); f.source.emit(end(3));
  await eventually(async()=>!(await sessions(f))[0].running); assert.equal((await sessions(f))[0].unread,1);
}));

test('空闲 SSE 首帧固定为 state 空串，不重放历史',()=>withFixture(async f=>{
  f.source.initialSnapshot=snapshot([assistantEvent(1,'旧内容')],1);
  const r=call(f,'GET','/bff/sessions/s1/stream'); await eventually(()=>r.res.text.includes('event: state'));
  assert.equal(r.res.text,'event: state\ndata: {"running":false,"partial":""}\n\n');
  r.res.destroy(); await r.done;
}));

test('每次接纳仅记一行 ISO 时间、bot、sessionId、Unicode 字数且权限 0600',()=>withFixture(async f=>{
  await send(f,'猫😀\n好').done;
  const lines=(await readFile(f.callLogFile,'utf8')).trimEnd().split('\n');
  assert.equal(lines.length,1); assert.match(lines[0],/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\tchief\ts1\t4$/);
  assert.equal(lines[0].includes('猫'),false); assert.equal((await stat(f.callLogFile)).mode&0o777,0o600);
}));

test('回执丢失不重发、不记接纳账，终止悬挂跟随并解除 running',()=>withFixture(async f=>{
  f.source.lostAdmission=true;
  const r=send(f,'只发一次'); const value=await r.json(); assert.equal(value.error.code,'DISCONNECTED');
  assert.equal(f.source.named('session/prompt').length,1); assert.equal(await readFile(f.callLogFile,'utf8'),'');
  assert.equal((await sessions(f))[0].running,false); assert.equal((await sessions(f))[0].unread,0); assert.equal(f.source.streams.size,0);
}));

test('done 与 error 只累计一次未读；后台出错不泄露上游细节',()=>withFixture(async f=>{
  await send(f,'测试失败').done; f.source.emit(end(3,'error'));
  await eventually(async()=>!(await sessions(f))[0].running);
  const value=(await sessions(f))[0]; assert.equal(value.unread,1); assert.equal(value.lastRole,'error'); assert.equal(value.lastText,'出错了');
  f.source.emit(end(4)); await tick(); assert.equal((await sessions(f))[0].unread,1);
}));

test('DSH 断线标记 error 并解除 running，不自动重发',()=>withFixture(async f=>{
  await send(f,'断线测试').done; f.source.sockets[0].close();
  await eventually(async()=>!(await sessions(f))[0].running);
  const value=(await sessions(f))[0]; assert.equal(value.lastRole,'error'); assert.equal(value.lastText,'出错了'); assert.equal(value.unread,1);
  assert.equal(f.source.named('session/prompt').length,1);
}));

test('同一会话运行中第二次输入返回 409，不增加真实调用和跟随',()=>withFixture(async f=>{
  await send(f,'第一条').done; const second=send(f,'第二条'); assert.equal((await second.json()).error.code,'CONFLICT');
  assert.equal(second.res.status,409); assert.equal(f.source.named('session/prompt').length,1); assert.equal(f.source.streams.size,1);
  assert.equal((await readFile(f.callLogFile,'utf8')).trimEnd().split('\n').length,1);
}));

test('read、status、presets、列表不会记账；空白消息在上游前拒绝',()=>withFixture(async f=>{
  for (const path of ['/bff/status','/bff/presets','/bff/sessions']) await call(f,'GET',path).done;
  await call(f,'POST','/bff/sessions/s1/read',{}).done;
  assert.equal((await send(f,' \n ').json()).error.code,'INVALID_INPUT');
  await assert.rejects(stat(f.callLogFile),{code:'ENOENT'}); assert.equal(f.source.calls.length,0);
}));
