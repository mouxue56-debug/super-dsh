import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,symlink,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,request,assistantEvent} from './fixtures.mjs';
import {createHandler} from '../server.mjs';
import {formatTicket,parseTicket} from '../lib/delegation.mjs';
import {plainSummary,limitReport,taskTotal,toolLabel} from '../lib/delegation-text.mjs';
import {SessionStore} from '../lib/store.mjs';
const headers={'x-hub-device':'g1-device'};
const event=(seq,type,data)=>({type:'event',event:{seq,type,data,time:Date.now()+seq}});
const step=(seq,n)=>event(seq,'step/start',{turn:1,step:n});
const end=(seq,kind='completed')=>event(seq,'turn/end',{reason:{kind}});
const call=(seq,id,name,path)=>event(seq,'tool/call',{callId:id,name,arguments:JSON.stringify(path===undefined?{}:{file_path:path})});
const result=(seq,id,ok=true,text='工具原始结果不应进卡片')=>event(seq,'tool/result',{message:{toolCallId:id,isError:!ok,content:[{type:'text',text}]}});
async function eventually(fn){for(let n=0;n<2400;n++){if(await fn())return;await delay(5);}assert.fail('G1 等待状态超时');}
async function setup(fn,options){const f=await fixture(options);try{await fn(f);}finally{await f.dispose();}}
function ticket(task='整理尚未完成的草稿',suffix='a001',bot='pm'){
 const ts=new Date().toISOString();return {meta:{id:'T-20261117-200000-'+suffix,kind:'delegation',creator:'chief',assignee:bot,status:'queued',createdAt:ts,updatedAt:ts,fromSession:'s1',toSession:'',steps:'0'},task,progress:'- '+ts+' 首席派出',report:''};
}
async function put(f,t){const dir=join(f.handlerOptions.ticketsDir,'working');await mkdir(dir,{recursive:true});await writeFile(join(dir,t.meta.id+'.md'),formatTicket(t),{mode:0o600});}
async function start(f,t=ticket()){await put(f,t);await f.handler.delegations.tick();return f.handler.runtime.cards().find(c=>c.id===t.meta.id);}
async function failed(f,t=ticket()){
 const c=await start(f,t);for(let n=1;n<=8;n++)f.source.emit(step(n,n),c.toSession);
 f.source.emit(event(9,'hub-plugin/notice',{text:'超过 8 步自动停'}),c.toSession);f.source.emit(end(10,'blocked'),c.toSession);
 await settled(f,c);return c;
}
async function settled(f,c){await eventually(async()=>{try{await readFile(join(f.handlerOptions.ticketsDir,c.status==='done'?'done':'failed',c.id+'.md'));const row=f.handler.runtime.store.get(c.toSession);return !row.running&&row.unread===1;}catch{return false;}});}
function continuation(f,id,extra={}){return request(f.handler,{method:'POST',path:'/bff/delegations/'+id+'/continue',headers,value:{},...extra});}

test('G1 无登录设备仍待批满10分钟；心跳设备字段保留；到点拒绝且记审计',()=>setup(async f=>{
 await f.client.connect();await f.handler.heartbeat.changed();await f.handler.heartbeat.writes;
 const h=JSON.parse(await readFile(f.handler.heartbeat.path,'utf8'));assert.equal(h.devicePresent,false);assert.equal(h.answering,true);
 const meta={v:1,bot:'chief',sessionId:'s1',level:'L3',action:'写共享区',tool:'write',path:'/Users/example/dsh-work/shared/g1.md',chars:1,preview:'假'};
 const req={toolName:'write',callId:'g1',reason:'HUBAPPROVAL1 '+JSON.stringify(meta)},at=Date.now();
 f.source.records=[event(1,'approval/asked',{id:'g1-ask',...req})];
 const waiting=f.handler.runtime.receive({eventId:'g1-wire',agentId:'s1',request:req});
 await eventually(()=>f.handler.runtime.cards()[0]?.status==='pending');const c=f.handler.runtime.cards()[0],created=Date.parse(c.createdAt);
 assert.equal(Date.parse(c.expiresAt)-created,600000);assert.equal(f.handler.runtime.waiters.size,1);
 f.handler.runtime.now=()=>created+599999;await f.handler.runtime.expire();assert.equal(c.status,'pending');
 f.handler.runtime.now=()=>created+600000;await f.handler.runtime.expire();assert.equal(await waiting,'rejected');assert.equal(c.status,'timeout');
 assert.equal(c.note,'没等到你点头，这一步没做');assert.match(await readFile(join(f.handlerOptions.configDir,'approvals.log'),'utf8'),/\ttimeout\t-\n/u);assert.ok(at<=created);
},{interactions:true}));

test('G1 派工每步由工具事实更新中文动作，跨步晚到结果归原步，纯文字保留在写回复',()=>setup(async f=>{
 const c=await start(f),cwd=join(f.botsDir,'pm');
 const events=[step(1,1),call(2,'read','read',join(cwd,'notes/x.md')),step(3,2),call(4,'write','write',join(cwd,'drafts/x.md')),
 result(5,'read'),result(6,'write'),step(7,3),call(8,'list','list_files',join(cwd,'drafts')),result(9,'list'),
 step(10,4),call(11,'ticket','ticket_create'),result(12,'ticket'),step(13,5),call(14,'denied','write',join(cwd,'refused.md')),result(15,'denied',false,'主人 没批准，这一步没做'),
 step(16,6),assistantEvent(17,'**写好了**\n## 结果\n- [草稿](https://example.invalid/draft)\n第二行'),end(18)];
 for(const e of events)f.source.emit(e,c.toSession);await settled(f,c);
 assert.deepEqual(c.steps.map(s=>s.label),['派出','开始','读了 notes/x.md','写了 drafts/x.md','列了 drafts/','建了一张工单','被拒：主人 没批准，这一步没做','在写回复','完成']);
 assert.equal(c.summary,'写好了 结果 草稿 第二行');assert.equal(JSON.stringify(c).includes('工具原始结果'),false);assert.equal(c.steps.some(s=>/第\d+步|\brunning\b|\bblocked\b|\bfailed\b/u.test(s.label)),false);
 const raw=await readFile(join(f.handlerOptions.ticketsDir,'done',c.id+'.md'),'utf8');assert.match(raw,/读了 notes\/x.md/u);assert.match(raw,/## 回报\n写好了 结果 草稿 第二行/u);
}));

test('G1 八步上限按成功写入及建单计件，同一文件的编辑/链接别名去重，明确总量可推剩余',()=>setup(async f=>{
 const t=ticket('创建 5 个文件，先完成能够完成的部分'),c=await start(f,t),cwd=join(f.botsDir,'pm');
 await mkdir(join(cwd,'drafts'));await writeFile(join(cwd,'drafts/a.md'),'测试');await symlink(join(cwd,'drafts/a.md'),join(cwd,'a-alias.md'));
 const events=[step(1,1),call(2,'a','write',join(cwd,'drafts/a.md')),result(3,'a'),step(4,2),call(5,'alias','edit','./a-alias.md'),result(6,'alias'),
 step(7,3),call(8,'b','write','drafts/b.md'),result(9,'b'),step(10,4),call(11,'ticket','ticket_create'),result(12,'ticket'),
 step(13,5),call(14,'no','write','drafts/failed.md'),result(15,'no',false,'磁盘写入失败。'),step(16,6),call(17,'read','read','notes/x.md'),result(18,'read'),step(19,7),step(20,8),event(21,'hub-plugin/notice',{text:'超过 8 步自动停'}),end(22,'blocked')];
 for(const e of events)f.source.emit(e,c.toSession);await settled(f,c);
 const reason='做了 8 步还没做完，按规矩先停了：已完成 3 件，剩 2 件';
 assert.equal(c.reason,reason);assert.equal(c.completed,3);assert.equal(c.remaining,2);assert.equal(c.failureKind,'step-limit');assert.equal(f.handler.runtime.store.get(c.toSession).lastText,reason);
 assert.match(await readFile(join(f.handlerOptions.ticketsDir,'failed',c.id+'.md'),'utf8'),/## 回报\n做了 8 步还没做完，按规矩先停了：已完成 3 件，剩 2 件/u);
 assert.equal(f.source.named('session/cancel').length,0);
}));

test('G1 无明确总数不猜剩余，不把模型文字或读取/失败算交付',()=>{
 assert.equal(taskTotal('整理 8 个步骤，写出草稿'),null);assert.equal(taskTotal('写 3 个文件，按要求执行'),3);assert.equal(taskTotal('创建 2 张工单'),2);
 assert.equal(limitReport(2),'做了 8 步还没做完，按规矩先停了：已完成 2 件，剩下的没做');
 assert.equal(toolLabel({name:'write',status:'approved'}),'已获批准，等工具完成');assert.equal(toolLabel({status:'error',brief:'磁盘满了'}),'没做成：磁盘满了');
});

test('G1 续做接口校验鉴权、设备、ID、空正文、卡状态和失败原因',()=>setup(async f=>{
 const c=await failed(f);let r=continuation(f,c.id,{key:null});await r.done;assert.equal(r.res.status,401);
 r=continuation(f,c.id,{headers:{}});await r.done;assert.equal(r.res.status,400);
 r=continuation(f,c.id,{headers:{'x-hub-device':'bad device'}});await r.done;assert.equal(r.res.status,400);
 r=continuation(f,'bad-id');await r.done;assert.equal(r.res.status,400);
 r=continuation(f,'T-20261117-200000-dead');await r.done;assert.equal(r.res.status,404);
 r=continuation(f,c.id,{value:{task:'替换原任务'}});await r.done;assert.equal(r.res.status,400);
 c.status='done';r=continuation(f,c.id);await r.done;assert.equal(r.res.status,409);c.status='failed';
 c.reason='派活已取消';r=continuation(f,c.id);await r.done;assert.equal(r.res.status,409);
 assert.equal((await readdir(join(f.handlerOptions.ticketsDir,'working'))).filter(n=>n.endsWith('.md')).length,0);
}));

test('G1 续做并发只生成一单，原任务逐字承接，正常编排、首席归属及delegate审计',()=>setup(async f=>{
 const task='整理草稿\n保留这个标题与原文。',c=await failed(f,ticket(task));
 const first=continuation(f,c.id),second=continuation(f,c.id);const replies=await Promise.all([first.json(),second.json()]);
 assert.deepEqual([first.res.status,second.res.status].sort(),[200,409]);const value=replies.find(r=>r.ok),id=value.continuedBy;
 assert.equal(c.continuedBy,id);assert.equal(value.card.continuedBy,id);assert.notEqual(id,c.id);
 await eventually(()=>f.source.named('session/prompt').length===2);const next=f.handler.runtime.cards().find(x=>x.id===id);
 assert.equal(next.bot,c.bot);assert.equal(next.sessionId,c.sessionId);assert.equal(next.status,'running');
 const path=join(f.handlerOptions.ticketsDir,'working',id+'.md'),raw=await readFile(path,'utf8');
 const parsed=parseTicket(raw,id+'.md');assert.ok(parsed);assert.equal(parsed.meta.creator,'chief');assert.equal(parsed.meta.fromSession,'s1');assert.equal(parsed.meta.assignee,'pm');
 const text='接着做上一张工单 '+c.id+' 剩下的部分，已完成的不要重做。原任务：'+task;
 assert.equal(parsed.task,text);assert.equal(f.source.named('session/prompt')[1].request.content[0].text,'【首席派来的活 · 工单 '+id+'】'+text);
 await eventually(async()=> (await readFile(f.callLogFile,'utf8')).trim().split('\n').length===2);
 assert.equal((await readFile(f.callLogFile,'utf8')).trim().split('\n').every(l=>l.endsWith('\tdelegate')),true);assert.equal((await stat(path)).mode&0o777,0o600);
 assert.equal(JSON.parse(await readFile(f.storeFile,'utf8')).cards.find(x=>x.id===c.id).continuedBy,id);
 f.source.emit(assistantEvent(1,'剩余已完成。'),next.toSession);f.source.emit(end(2),next.toSession);await settled(f,next);
 await f.handler.delegations.tick();assert.equal(f.source.named('session/prompt').length,2);
 const again=continuation(f,c.id);await again.done;assert.equal(again.res.status,409);
}));

test('G1 续单同助理忙时排队，重启仍只续一次，释放后按正常队列派出',()=>setup(async f=>{
 const c=await failed(f);await f.handler.runtime.store.add({id:'pm-busy',bot:'pm',title:'占位',lastText:'',lastRole:null,updatedAt:Date.now(),unread:0,running:true});
 const r=await continuation(f,c.id).json(),id=r.continuedBy;
 await eventually(()=>f.handler.runtime.cards().find(x=>x.id===id)?.queuePos===1);assert.equal(f.source.named('session/prompt').length,1);
 await f.handler.dispose();f.handler=createHandler({client:f.client,key:f.key,...f.handlerOptions});await f.handler.ready;
 const again=continuation(f,c.id);await again.done;assert.equal(again.res.status,409);
 // store 重启会清 running；这张续单只能由正常扫描派出一次。
 await f.handler.delegations.tick();assert.equal(f.source.named('session/prompt').length,2);await f.handler.delegations.tick();assert.equal(f.source.named('session/prompt').length,2);
}));

test('G1 continuedBy持久化后进程中断，重启晋升staged续单，不丢失也不新建第二单',()=>setup(async f=>{
 const c=await failed(f),rt=f.handler.runtime,original=rt.cardChanged.bind(rt);
 rt.cardChanged=async card=>{await original(card);if(card.id===c.id&&card.continuedBy)throw Error('模拟持久化后中断');};
 const r=continuation(f,c.id);await r.done;assert.equal(r.res.status,502);const id=c.continuedBy;assert.ok(id);
 assert.equal((await readdir(join(f.handlerOptions.ticketsDir,'working'))).includes('.'+id+'.continue'),true);assert.equal(f.source.named('session/prompt').length,1);
 rt.cardChanged=original;await f.handler.dispose();f.handler=createHandler({client:f.client,key:f.key,...f.handlerOptions});await f.handler.ready;
 await f.handler.delegations.tick();assert.equal(f.source.named('session/prompt').length,2);assert.equal(f.handler.runtime.cards().filter(x=>x.id===id).length,1);
 const again=continuation(f,c.id);await again.done;assert.equal(again.res.status,409);await f.handler.delegations.tick();assert.equal(f.source.named('session/prompt').length,2);
}));

test('G1 失败原单缺失、链接或元数据不一致时拒绝续做，不读任意目标',()=>setup(async f=>{
 const c=await failed(f),path=join(f.handlerOptions.ticketsDir,'failed',c.id+'.md');await rename(path,path+'.saved');
 let r=continuation(f,c.id);await r.done;assert.equal(r.res.status,409);
 await symlink(path+'.saved',path);r=continuation(f,c.id);await r.done;assert.equal(r.res.status,409);assert.equal(c.continuedBy,undefined);
 await rename(path,path+'.link-saved');const raw=(await readFile(path+'.saved','utf8')).replace('assignee: pm','assignee: art');await writeFile(path,raw);
 r=continuation(f,c.id);await r.done;assert.equal(r.res.status,409);assert.equal(c.continuedBy,undefined);
}));

for(const kind of ['aborted','cancelled','canceled','interrupted','stopped'])test('G1 被停止回合 '+kind+' 的lastText为已停止，仍只增一次未读',()=>setup(async f=>{
 await request(f.handler,{method:'POST',path:'/bff/sessions/s1/messages',value:{text:'待停止'}}).done;
 const cancel=request(f.handler,{method:'POST',path:'/bff/sessions/s1/cancel',value:{}});await cancel.done;assert.equal(cancel.res.status,200);
 f.source.emit(end(1,kind));f.source.emit(end(2,kind));await eventually(()=>!f.handler.runtime.store.get('s1').running);
 const row=f.handler.runtime.store.get('s1');assert.equal(row.lastText,'已停止');assert.equal(row.lastRole,'error');assert.equal(row.unread,1);
 await f.handler.runtime.store.flush();
 assert.equal(JSON.parse(await readFile(f.storeFile,'utf8')).sessions.find(x=>x.id==='s1').lastText,'已停止');
}));

test('G1 被派回合取消也显示已停止，卡保留派活已取消且不能续做',()=>setup(async f=>{
 const c=await start(f);f.source.emit(end(1,'aborted'),c.toSession);await settled(f,c);
 assert.equal(f.handler.runtime.store.get(c.toSession).lastText,'已停止');assert.equal(c.reason,'派活已取消');const r=continuation(f,c.id);await r.done;assert.equal(r.res.status,409);
}));

test('G1 摘要清理Markdown、链接和换行，400个Unicode字符上限；旧卡加载也清理',()=>setup(async f=>{
 const source='## **结论**\n- [成果](https://example.invalid/result)\n1. `文档` __已写__\n> 下一项',expected='结论 成果 文档 已写 下一项';
 assert.equal(plainSummary(source),expected);assert.equal(Array.from(plainSummary('😀'.repeat(450))).length,400);
 assert.equal(plainSummary('### *完成* ###\n- [原文](https://example.invalid/a_(b)) 与 _附注_；draft_file.md'),'完成 原文 与 附注；draft_file.md');
 const path=join(f.handlerOptions.configDir,'g1-summary-store.json');await writeFile(path,JSON.stringify({sessions:[],cards:[{id:'old',type:'delegation',summary:source}]}));const store=new SessionStore(path);await store.ready;
 assert.equal(store.cards[0].summary,expected);assert.equal(JSON.parse(await readFile(path,'utf8')).cards[0].summary,expected);
}));
