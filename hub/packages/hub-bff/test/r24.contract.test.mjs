import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat, mkdir, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHandler } from '../server.mjs';
import { parseApproval } from '../lib/runtime.mjs';
import { formatTicket, parseTicket } from '../lib/delegation.mjs';
import { fixture, request, assistantEvent } from './fixtures.mjs';
const good={v:1,bot:'chief',sessionId:'s1',level:'L3',action:'写共享区',tool:'write',path:'/Users/example/dsh-work/shared/x.md',chars:3,preview:'草稿猫'};
const reason=v=>'HUBAPPROVAL1 '+JSON.stringify(v);
const headers={'x-hub-device':'test-device'};
const call=(f,method,path,value,extra={})=>request(f.handler,{method,path,value,...extra});
const end=(seq=100,kind='completed')=>({type:'event',event:{seq,type:'turn/end',data:{reason:{kind}}}});
const step=seq=>({type:'event',event:{seq,type:'step/start',data:{turn:1,step:seq}}});
async function eventually(fn) { for(let i=0;i<400;i++){if(await fn())return;await delay(5);}assert.fail('等待状态超时'); }
async function setup(fn,options={}) {const f=await fixture(options);try{await fn(f);}finally{await f.dispose();}}
async function device(f) { await call(f,'GET','/bff/status',undefined,{headers}).done; }
function ask(f,v=good,eventId='e1',id='approval-1') {
  const req={toolName:'write',callId:'call-1',reason:typeof v==='string'?v:reason(v)};
  f.source.records=[{type:'event',event:{seq:1,type:'approval/asked',data:{id,...req}}}];
  return f.handler.runtime.receive({type:'waterfall',event:'approval/request',eventId,agentId:'s1',request:req},new AbortController().signal);
}
async function pending(f) { await eventually(()=>f.handler.runtime.cards().some(c=>c.status==='pending')); await eventually(()=>f.handler.runtime.status().pendingTotal===1); }
const answer=(f,id='approval-1',decision='approve',note,withDevice=true)=>call(f,'POST','/bff/approvals/'+id+'/answer',{decision,...(note===undefined?{}:{note})},{headers:withDevice?headers:{}});

test('原因串：好串、坏 JSON、缺 bot/path、错 level、日志控制字符均核验',()=>{
 assert.deepEqual(parseApproval(reason(good)),good);
 for(const value of ['bad','HUBAPPROVAL1 {',reason({...good,bot:undefined}),reason({...good,path:undefined}),reason({...good,level:'L1'}),reason({...good,path:'/a\nb'}),reason({...good,preview:undefined})])assert.equal(parseApproval(value),null);
 assert.equal(Array.from(parseApproval(reason({...good,preview:'猫'.repeat(210),diff:'字'.repeat(620)})).preview).length,200);
});
test('审批并发只答一次，卡与审计 0600 落盘，第二次 409',()=>setup(async f=>{
 await device(f);const result=ask(f);await pending(f);
 const a=answer(f), b=answer(f);const values=await Promise.all([a.json(),b.json()]);assert.deepEqual([a.res.status,b.res.status].sort(),[200,409]);
 assert.equal(values.find(v=>v.error)?.error.code,'already-answered');assert.equal(await result,'allowed-once');
 const log=join(f.handlerOptions.configDir,'approvals.log');assert.match(await readFile(log,'utf8'),/\tchief\twrite\t.*\tapproved\ttest-device\n$/u);assert.equal((await stat(log)).mode&0o777,0o600);
 assert.equal((await stat(f.storeFile)).mode&0o777,0o600);assert.equal((await call(f,'GET','/bff/approvals').json()).approvals.length,0);
 assert.equal((await call(f,'GET','/bff/sessions/s1/cards').json()).cards[0].status,'approved');
}));
test('无设备/过期设备仍等待10分钟，坏原因与bot会话不符继续失败关闭',()=>setup(async f=>{
 const first=ask(f);await pending(f);assert.equal(f.handler.runtime.present(),false);
 f.handler.runtime.now=()=>Date.now()+600001;await f.handler.runtime.expire();assert.equal(await first,'rejected');assert.equal(f.handler.runtime.cards()[0].status,'timeout');
 f.handler.runtime.now=Date.now;await device(f);assert.equal(await ask(f,'bad','e2','a2'),'rejected');assert.equal(await ask(f,{...good,bot:'pm'},'e3','a3'),'rejected');
 f.handler.runtime.devices.set('test-device',Date.now()-900001);const old=ask(f,good,'e4','a4');await eventually(()=>f.handler.runtime.cards().find(c=>c.id==='a4')?.status==='pending');
 assert.equal(f.handler.runtime.present(),false);f.handler.runtime.now=()=>Date.now()+600001;await f.handler.runtime.expire();assert.equal(await old,'rejected');assert.equal(f.handler.runtime.waiters.size,0);
}));
test('10 分钟注入时钟超时，刚过期限点击不会批准',()=>setup(async f=>{
 await device(f);const result=ask(f);await pending(f);f.handler.runtime.now=()=>Date.now()+600001;await f.handler.runtime.expire();assert.equal(await result,'rejected');assert.equal(f.handler.runtime.cards()[0].status,'timeout');assert.equal(f.handler.runtime.cards()[0].note,'没等到你点头，这一步没做');
}));
test('审批必须带设备、未找到 404、参数限 500 字',()=>setup(async f=>{
 await device(f);const result=ask(f);await pending(f);const no=answer(f,'approval-1','approve',undefined,false);await no.done;assert.equal(no.res.status,400);assert.equal(f.handler.runtime.cards()[0].status,'pending');
 const missing=answer(f,'unknown');await missing.done;assert.equal(missing.res.status,404);
 const bad=answer(f,'approval-1','revise','猫'.repeat(501));await bad.done;assert.equal(bad.res.status,400);
 await answer(f,'approval-1','reject').done;assert.equal(await result,'rejected');
}));
test('revise 拒绝内核，以 主人 身份排队一句，calls.log 记 revise',()=>setup(async f=>{
 await call(f,'POST','/bff/sessions/s1/messages',{text:'第一句'}).done;await device(f);const result=ask(f);await pending(f);
 const r=answer(f,'approval-1','revise','缩成一句');assert.equal((await r.json()).card.status,'revised');assert.equal(await result,'rejected');assert.equal(f.source.named('session/prompt').length,1);
 f.source.emit(end());await eventually(()=>f.source.named('session/prompt').length===2);
 const prompt=f.source.named('session/prompt')[1].request;assert.equal(prompt.mode,'queue');assert.deepEqual(prompt.content,[{type:'text',text:'（改一下）主人 看了审批卡，要你按这条意见改完重做（重做照常走审批，这不算绕过）：缩成一句'}]);
 await eventually(async()=> (await readFile(f.callLogFile,'utf8')).includes('\trevise\n'));f.source.emit(end(101));
}));
test('重启把待批卡结束并保留旧卡；连接撤销也失败关闭',()=>setup(async f=>{
 await device(f);const result=ask(f);await pending(f);await f.handler.runtime.lost();assert.equal(await result,'rejected');
 const saved=JSON.parse(await readFile(f.storeFile,'utf8'));saved.cards[0].status='pending';await f.handler.dispose();await writeFile(f.storeFile,JSON.stringify(saved));
 f.handler=createHandler({client:f.client,key:f.key,...f.handlerOptions});await f.handler.ready;assert.equal(f.handler.runtime.cards()[0].status,'unavailable');
}));
test('全局 SSE 与会话 SSE 都推卡和状态，断开不取消会话',()=>setup(async f=>{
 await device(f);const global=call(f,'GET','/bff/events'), session=call(f,'GET','/bff/sessions/s1/stream');await eventually(()=>session.res.text.includes('event: state'));
 const result=ask(f);await pending(f);await eventually(()=>global.res.text.includes('event: card')&&session.res.text.includes('event: card'));
 await eventually(()=>global.res.text.includes('"pendingTotal":1'));assert.match(global.res.text,/"pendingTotal":1/u);await answer(f,'approval-1','reject').done;assert.equal(await result,'rejected');
 global.res.destroy();session.res.destroy();await Promise.all([global.done,session.done]);assert.equal(f.source.named('session/cancel').length,0);
}));
test('真实 Remote 线格式握手、waterfall 批准/拒绝、questions next、不持有已撤回审批',()=>setup(async f=>{
 await device(f);await f.client.connect();assert.equal(f.source.eventStreams.size,1);
 for(const [n,decision,outcome] of [[1,'approve','allowed-once'],[2,'reject','rejected']]) {
  const req={toolName:'write',callId:'c'+n,reason:reason(good)};f.source.records=[{event:{seq:n,type:'approval/asked',data:{id:'wire-'+n,...req}}}];
  f.source.interaction({type:'waterfall',event:'approval/request',eventId:'event-'+n,agentId:'s1',request:req});await eventually(()=>f.handler.runtime.cards().some(c=>c.id==='wire-'+n&&c.status==='pending'));
  await answer(f,'wire-'+n,decision).done;await eventually(()=>f.source.named('$events/result').length===n);assert.deepEqual(f.source.named('$events/result')[n-1],{clientId:'event-client',eventId:'event-'+n,outcome:{kind:'result',value:outcome}});
 }
 f.source.interaction({type:'waterfall',event:'user-questions/request',eventId:'question',agentId:'s1',request:{}});await eventually(()=>f.source.named('$events/result').length===3);assert.deepEqual(f.source.named('$events/result')[2].outcome,{kind:'next'});
 const req={toolName:'write',callId:'cc',reason:reason(good)};f.source.records=[{event:{type:'approval/asked',data:{id:'cancelled-card',...req}}}];f.source.interaction({type:'waterfall',event:'approval/request',eventId:'cancelled-event',agentId:'s1',request:req});await eventually(()=>f.handler.runtime.cards().some(c=>c.id==='cancelled-card'));
 f.source.interaction({type:'cancel',eventId:'cancelled-event'});await eventually(()=>f.handler.runtime.cards().find(c=>c.id==='cancelled-card').status==='unavailable');assert.equal(f.source.named('$events/result').length,3);
},{interactions:true}));
test('幂等并发、头部号、重启与回执丢失均不重发',()=>setup(async f=>{
 const a=call(f,'POST','/bff/sessions/s1/messages',{text:'只发一次',idem:'same'}),b=call(f,'POST','/bff/sessions/s1/messages',{text:'重复',idem:'same'});
 const [av,bv]=await Promise.all([a.json(),b.json()]);assert.equal(av.requestId,bv.requestId);assert.equal(bv.duplicate,true);assert.equal(b.res.status,200);assert.equal(f.source.named('session/prompt').length,1);
 await f.handler.dispose();f.handler=createHandler({client:f.client,key:f.key,...f.handlerOptions});await f.handler.ready;
 const c=call(f,'POST','/bff/sessions/s1/messages',{text:'重启重试'},{headers:{'idempotency-key':'same'}});assert.equal((await c.json()).duplicate,true);assert.equal(f.source.named('session/prompt').length,1);
 f.source.lostAdmission=true;const lost=call(f,'POST','/bff/sessions/s1/messages',{text:'丢回执',idem:'lost'});await lost.done;assert.equal(lost.res.status,502);
 const retry=await call(f,'POST','/bff/sessions/s1/messages',{text:'重试',idem:'lost'}).json();assert.equal(retry.duplicate,true);assert.equal(f.source.named('session/prompt').length,2);
}));
test('幂等超过 10 分钟重新接纳、不同会话号独立',()=>setup(async f=>{
 await call(f,'POST','/bff/sessions/s1/messages',{text:'一次',idem:'old'}).done;f.source.emit(end());await eventually(()=>!f.handler.runtime.store.get('s1').running);
 const state=f.handler.runtime.store;state.idempotency[0].ts-=600001;await state.persist();const r=call(f,'POST','/bff/sessions/s1/messages',{text:'二次',idem:'old'});await r.done;assert.equal(r.res.status,202);assert.equal(f.source.named('session/prompt').length,2);
}));
function ticket(n=1,bot='pm') {const date='2026-11-17T18:12:00+09:00';return {meta:{id:'T-20261117-181200-'+String(n).padStart(4,'0'),kind:'delegation',creator:'chief',assignee:bot,status:'queued',createdAt:date,updatedAt:date,fromSession:'s1',toSession:'',steps:'0'},task:'整理草稿 '+n,progress:'- '+date+' 首席派出',report:''};}
async function put(f,t) {const dir=join(f.handlerOptions.ticketsDir,'working');await mkdir(dir,{recursive:true});await writeFile(join(dir,t.meta.id+'.md'),formatTicket(t),{mode:0o600});}
test('工单格式严格读取，陌生文件/符号链接/其他创建者不动',()=>setup(async f=>{
 const t=ticket();assert.ok(parseTicket(formatTicket(t),t.meta.id+'.md'));assert.equal(parseTicket('garbage',t.meta.id+'.md'),null);assert.equal(parseTicket(formatTicket(t),'../wrong.md'),null);
 await put(f,{...t,meta:{...t.meta,creator:'pm'}});const dir=join(f.handlerOptions.ticketsDir,'working');await writeFile(join(dir,'unknown.md'),'garbage');await symlink(join(dir,'unknown.md'),join(dir,'T-20261117-181200-0002.md'));
 await f.handler.delegations.tick();assert.equal(f.source.named('session/create').length,0);assert.equal(await readFile(join(dir,'unknown.md'),'utf8'),'garbage');
}));
test('派活同助理排队、跨助理并行、完成移栏并把卡交首席，不自动发首席消息',()=>setup(async f=>{
 const a=ticket(1),b=ticket(2),c=ticket(3,'art');for(const t of [a,b,c])await put(f,t);await f.handler.delegations.tick();
 assert.equal(f.source.named('session/create').length,2);const cards=f.handler.runtime.cards('s1');assert.equal(cards.find(c=>c.id===b.meta.id).queuePos,1);assert.equal(f.handler.runtime.status().bots.pm.delegated.queued,1);
 const target=cards.find(c=>c.id===a.meta.id).toSession;const requests=f.source.named('session/prompt');assert.equal(requests.every(p=>p.request.sessionId!=='s1'),true);assert.equal(requests[0].request.content[0].text,'【首席派来的活 · 工单 '+a.meta.id+'】'+a.task);
 f.source.emit(step(1),target);f.source.emit(assistantEvent(2,'回报'.repeat(300)),target);f.source.emit(end(3),target);
 await eventually(async()=> (await readdir(join(f.handlerOptions.ticketsDir,'done')).catch(()=>[])).includes(a.meta.id+'.md'));
 const done=await readFile(join(f.handlerOptions.ticketsDir,'done',a.meta.id+'.md'),'utf8');assert.match(done,/status: done/u);assert.match(done,/steps: 1/u);assert.equal(Array.from(f.handler.runtime.cards().find(c=>c.id===a.meta.id).summary).length,400);assert.equal(f.handler.runtime.store.get(target).unread,1);
 await eventually(()=>!f.handler.delegations.running.has(a.meta.id));await f.handler.delegations.tick();assert.equal(f.source.named('session/create').length,3);assert.match(await readFile(f.callLogFile,'utf8'),/\tdelegate\n/u);
}));
test('派活第 9 步立即取消并移 failed，重复序号不重复计步',()=>setup(async f=>{
 const t=ticket();await put(f,t);await f.handler.delegations.tick();const target=f.handler.runtime.cards()[0].toSession;
 for(let n=1;n<=9;n++){f.source.emit(step(n),target);f.source.emit(step(n),target);}
 await eventually(()=>f.source.named('session/cancel').length===1);await eventually(async()=> (await readdir(join(f.handlerOptions.ticketsDir,'failed')).catch(()=>[])).length===1);
 const text=await readFile(join(f.handlerOptions.ticketsDir,'failed',t.meta.id+'.md'),'utf8');assert.match(text,/做了 8 步还没做完，按规矩先停了：已完成 0 件，剩下的没做/u);assert.match(text,/steps: 9/u);assert.equal(f.handler.runtime.cards()[0].status,'failed');
}));
test('派活取消、错误移 failed；启动接纳失败也移 failed',()=>setup(async f=>{
 const t=ticket();await put(f,t);await f.handler.delegations.tick();f.source.emit(end(1,'aborted'),f.handler.runtime.cards()[0].toSession);
 await eventually(()=>f.handler.runtime.cards()[0].status==='failed');await eventually(async()=> (await readdir(join(f.handlerOptions.ticketsDir,'failed')).catch(()=>[])).length===1);
 const t2=ticket(2,'art');await put(f,t2);f.source.lostAdmission=true;await f.handler.delegations.tick();assert.equal(f.handler.runtime.cards().find(c=>c.id===t2.meta.id).status,'failed');assert.equal(f.source.named('session/prompt').some(p=>p.request.sessionId==='s1'),false);
}));
test('presets 短语只取名册；旧 phrases 文件不覆盖正本；bot-status 六行原子 0600',()=>setup(async f=>{
 const path=join(f.handlerOptions.configDir,'phrases.json');await writeFile(path,JSON.stringify({chief:['一','二','三','四']}));
 await f.handler.dispose();f.handler=createHandler({client:f.client,key:f.key,...f.handlerOptions,phrasesFile:path});await f.handler.ready;
 const presets=await call(f,'GET','/bff/presets').json();assert.deepEqual(presets.bots[0].phrases,[]);assert.deepEqual(presets.bots[1].phrases,[]);
 const path2=join(f.handlerOptions.configDir,'bot-status.json');const status=JSON.parse(await readFile(path2,'utf8'));assert.equal(Object.keys(status.bots).length,6);assert.equal((await stat(path2)).mode&0o777,0o600);
}));

test('审批存储失败只能拒绝，内存不会显示批准',()=>setup(async f=>{
 await device(f);const result=ask(f);await pending(f);const rt=f.handler.runtime;
 const original=rt.audit;rt.audit=async()=>{throw Error('fixture failure');};const r=answer(f);await r.done;
 assert.equal(r.res.status,502);assert.equal(await result,'rejected');assert.equal(rt.cards()[0].status,'unavailable');rt.audit=original;
}));
test('忙碌前置拒绝不消耗幂等号；不同会话的同号独立',()=>setup(async f=>{
 await call(f,'POST','/bff/sessions/s1/messages',{text:'运行中'}).done;
 const blocked=call(f,'POST','/bff/sessions/s1/messages',{text:'还不能发',idem:'retry-later'});await blocked.done;assert.equal(blocked.res.status,409);
 f.source.emit(end());await eventually(()=>!f.handler.runtime.store.get('s1').running);
 const retry=call(f,'POST','/bff/sessions/s1/messages',{text:'现在发送',idem:'retry-later'});assert.equal((await retry.json()).duplicate,undefined);assert.equal(retry.res.status,202);
 const other=await call(f,'POST','/bff/sessions',{bot:'pm'}).json();const next=call(f,'POST','/bff/sessions/'+other.id+'/messages',{text:'独立同号',idem:'retry-later'});assert.equal((await next.json()).duplicate,undefined);assert.equal(next.res.status,202);
}));
