import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {project,coordinates} from '../lib/timeline.mjs';
import {Reconnector} from '../lib/reconnect.mjs';
import {formatTicket} from '../lib/delegation.mjs';
import {fixture,request,snapshot} from './fixtures.mjs';
const headers={'x-hub-device':'b3-device'};
const at=Date.now();
const e=(seq,type,data={},time=at+seq)=>({event:{seq,type,data,time}});
const assistant=(seq,text,turn=1,step=1,extra=[])=>e(seq,'assistant/message',{turn,step,message:{content:[{type:'reasoning',text:'HIDDEN_THINKING_DO_NOT_FORWARD'},{type:'text',text},...extra]}});
const toolCall=(seq,id='call-1',name='write',args={file_path:'/Users/example/dsh-work/shared/x.md',content:'PRIVATE_ARGUMENT_BODY'},turn=1,step=1)=>e(seq,'tool/call',{callId:id,name,arguments:JSON.stringify(args),turn,step});
const result=(seq,id='call-1',isError=false,text='RAW_OUTPUT_DO_NOT_FORWARD',tail)=>e(seq,'tool/result',{message:{toolCallId:id,isError,content:[{type:'text',text},...(tail?[{type:'text',text:tail}]:[])]}});
const end=(seq,kind='completed')=>e(seq,'turn/end',{reason:{kind}});
const tick=async()=>{await delay(0);};
async function eventually(fn){for(let n=0;n<500;n++){if(await fn())return;await delay(5);}assert.fail('B3 等待状态超时');}
async function setup(fn,options={}){const f=await fixture(options);try{await fn(f);}finally{await f.dispose();}}
const events=async name=>(await readFile(new URL('./fixtures/'+name,import.meta.url),'utf8')).trim().split('\n').map(l=>({event:JSON.parse(l)}));
const parseSse=text=>text.split('\n\n').filter(s=>s.startsWith('event:')).map(s=>({type:s.split('\n')[0].slice(7),data:JSON.parse(s.split('\ndata: ')[1])}));
function clock(){const timers=new Map(),delays=[];let serial=0;return {timers,delays,schedule(fn,ms){const id=++serial;timers.set(id,fn);delays.push(ms);return id;},cancel(id){timers.delete(id);},async fire(){const [id,fn]=timers.entries().next().value ?? [];assert.ok(fn,'应有待重试定时器');timers.delete(id);await fn();}};}
const meta={v:1,bot:'chief',sessionId:'s1',level:'L3',action:'写共享区',tool:'write',path:'/Users/example/dsh-work/shared/x.md',chars:3,preview:'草稿猫'};
const reason='HUBAPPROVAL1 '+JSON.stringify(meta);
const approval=(seq=3,id='approval-b3')=>e(seq,'approval/asked',{id,toolName:'write',callId:'call-1',reason});
const waterfall=id=>({type:'waterfall',event:'approval/request',eventId:id,agentId:'s1',request:{toolName:'write',callId:'call-1',reason}});
const ticket=(n=1)=>{const ts=new Date(at).toISOString();return {meta:{id:'T-20261117-181200-'+String(n).padStart(4,'0'),kind:'delegation',creator:'chief',assignee:'pm',status:'queued',createdAt:ts,updatedAt:ts,fromSession:'s1',toSession:'',steps:'0'},task:'整理草稿 '+n,progress:'- '+ts+' 首席派出',report:''};};
async function put(f,t){const p=join(f.handlerOptions.ticketsDir,'working');await mkdir(p,{recursive:true});await writeFile(join(p,t.meta.id+'.md'),formatTicket(t),{mode:0o600});}

test('真实 L4 样本：稳定工具 ID/序号、结果事实、L1 尾注，隐藏推理/参数/原始输出不外传',()=>setup(async f=>{
 f.source.records=await events('t2-L4-events.jsonl');const history=await f.client.history('s1');
 const tools=history.messages.flatMap(m=>m.tools ?? []);assert.equal(tools.length,8);
 assert.deepEqual(tools.map(t=>t.seq),[16,18,20,22,27,29,31,36]);
 assert.deepEqual(tools.map(t=>t.status),['ok','denied','denied','denied','denied','denied','denied','ok']);
 assert.equal(tools.at(-1).level,'L1');assert.equal(tools.at(-1).brief,'L1 已记录');
 assert.equal(tools[2].brief,'这件事我做不了：路径或工具不在本轮授权范围');
 assert.ok(history.messages.every(m=>Number.isSafeInteger(m.seq)&&typeof m.id==='string'&&Number.isFinite(m.ts)));
 assert.equal(JSON.stringify(tools).includes('R24 权限验收测试写入一行'),false);
 assert.equal(JSON.stringify(tools).includes('Created file'),false);
 assert.equal(JSON.stringify(history).includes('reasoning'),false);
 const first=project(f.source.records).surface();assert.deepEqual(project([...f.source.records,...f.source.records]).surface(),first);
}));

test('真实超时/断线样本：审批序号与 why 来自前文，超时卡补精确状态、通道拒绝保留原因',()=>setup(async f=>{
 const records=await events('t3-超时与断线-events.jsonl');
 f.source.records=records.filter(r=>r.event.seq<=17);
 const asked=records.find(r=>r.event.type==='approval/asked').event;
 const context=await f.client.approvalContext('s1',asked.data);
 assert.equal(context.id,asked.data.id);assert.equal(context.seq,17);assert.equal(context.ts,asked.time);
 assert.equal(context.why,'我来处理这项验收：先尝试把内容写入共享区。');
 f.source.records=records;
 const h=await f.client.history('s1',{cards:[{type:'approval',id:asked.data.id,status:'timeout'}]});
 const tools=h.messages.flatMap(m=>m.tools ?? []);assert.equal(tools[0].status,'timeout');assert.equal(tools[0].level,'L3');assert.equal(tools[0].seq,16);
 assert.equal(tools[0].brief,'主人 没批准，这一步没做');assert.equal(tools[1].status,'unavailable');
 assert.match(tools[1].brief,/审批通道不在线/u);
}));

test('why 只取调用前的可见末句，≤80 字；同轮回退、跨轮不借、调用后文本不采用',()=>{
 const before=assistant(1,'前一句。'+ '猫'.repeat(100)+'。');
 const current=assistant(2,'',1,2,[{type:'tool-call',id:'call-1'}, {type:'text',text:'这是调用后的话，不能采用。'}]);
 const t=project([before,current,toolCall(3,'call-1','write',{},1,2)]);
 assert.equal(t.calls.get('call-1').why,'猫'.repeat(80)+'…');
 const other=project([before,toolCall(3,'call-1','write',{},2,1)]);assert.equal(other.calls.get('call-1').why,'');
 assert.equal(project([toolCall(1)]).calls.get('call-1').why,'');
});

test('只输出真实时间和序号；没有坐标不编造，ISO 可透传',()=>{
 assert.deepEqual(coordinates({seq:0,time:'2026-11-17T18:00:00+09:00'}),{seq:0,ts:'2026-11-17T18:00:00+09:00'});
 for(const time of [null,undefined,'yesterday',{},NaN])assert.deepEqual(coordinates({seq:-1,time}),{});
 const [m]=project([{event:{type:'assistant/message',data:{message:{content:[{type:'text',text:'旧消息'}]}}}}]).surface();assert.equal('ts' in m,false);assert.equal('seq' in m,false);
});

test('工具缺 isError 不算成功；read 原文不作 L1 标记，批准后错误保留 error',()=>{
 const a=approval();const t=project([assistant(1,'先写入。'),toolCall(2),a,e(4,'approval/decided',{id:a.event.data.id,outcome:'allowed-once'}),result(5,'call-1',true,'磁盘写入失败。不要传后一句。')],[{type:'approval',id:a.event.data.id,status:'approved'}]);
 assert.equal(t.surface()[0].tools[0].status,'error');assert.equal(t.surface()[0].tools[0].brief,'磁盘写入失败。');
 const read=project([toolCall(1,'r','read',{file_path:'note.md'}),result(2,'r',false,'（已写入 x，L1 已记录）')]);assert.equal(read.surface()[0].tools[0].level,undefined);assert.equal(read.surface()[0].tools[0].brief,'');
 const missing=result(2);delete missing.event.data.message.isError;assert.equal(project([toolCall(1),missing]).surface()[0].tools[0].status,'error');
});

test('实际 stream 透传 message/id/seq/ts/tools，tool 同 ID 更新，卡片 why/seq 更新不移位',()=>setup(async f=>{
 await request(f.handler,{path:'/bff/status',headers}).done;await f.client.connect();
 const stream=request(f.handler,{path:'/bff/sessions/s1/stream'});await eventually(()=>stream.res.text.includes('event: state'));
 const records=[assistant(1,'需要留给团队查阅，所以写共享区。'),toolCall(2),approval(3)];
 for(const r of records)f.source.emit({type:'event',event:r.event});f.source.records=records;f.source.interaction(waterfall('wire-b3'));
 await eventually(()=>f.handler.runtime.cards()[0]?.status==='pending');
 const card=f.handler.runtime.cards()[0];assert.equal(card.seq,3);assert.equal(card.why,'需要留给团队查阅，所以写共享区。');const createdAt=card.createdAt;
 await request(f.handler,{method:'POST',path:'/bff/approvals/approval-b3/answer',headers,value:{decision:'approve'}}).done;
 for(const r of [e(4,'approval/decided',{id:'approval-b3',outcome:'allowed-once'}),result(5,'call-1',true,'磁盘写入失败。')]){records.push(r);f.source.emit({type:'event',event:r.event});}
 await eventually(()=>parseSse(stream.res.text).some(e=>e.type==='tool'&&e.data.status==='error'));
 const out=parseSse(stream.res.text),m=out.find(e=>e.type==='message').data;assert.equal(m.seq,1);assert.equal(m.id,'1');assert.equal(m.ts,at+1);assert.deepEqual(m.tools,[]);
 const tools=out.filter(e=>e.type==='tool').map(e=>e.data);assert.deepEqual(tools.map(t=>t.status),['running','pending','approved','error']);assert.ok(tools.every(t=>t.id==='call-1'&&t.seq===2&&t.ts===at+2));
 const publicText=JSON.stringify(out);assert.equal(publicText.includes('PRIVATE_ARGUMENT_BODY'),false);assert.equal(publicText.includes('HIDDEN_THINKING'),false);assert.equal(publicText.includes('RAW_OUTPUT'),false);
 assert.equal(card.seq,3);assert.equal(card.createdAt,createdAt);assert.equal(card.status,'approved');
 stream.res.destroy();await stream.done;
},{interactions:true}));

test('派工卡精确关联首席 delegate_to_bot callId 的序号并持久；取不到用 createdAt',()=>setup(async f=>{
 const t=ticket(),other=ticket(2);await put(f,t);await put(f,other);
 f.source.records=[toolCall(20,'delegate-call','delegate_to_bot',{bot:'pm',task:t.task}),result(21,'delegate-call',false,'已派给 项目经理，工单 '+t.meta.id+'，前面还有 0 个')];
 await f.handler.delegations.tick();let c=f.handler.runtime.cards().find(c=>c.id===t.meta.id);assert.equal(c.seq,20);const time=c.createdAt;
 const fallback=f.handler.runtime.cards().find(c=>c.id===other.meta.id);assert.equal('seq' in fallback,false);assert.equal(fallback.createdAt,other.meta.createdAt);
 f.source.emit({type:'event',event:end(100).event},c.toSession);await eventually(()=>c.status==='done');assert.equal(c.seq,20);assert.equal(c.createdAt,time);
 const saved=JSON.parse(await readFile(f.storeFile,'utf8')).cards.find(c=>c.id===t.meta.id);assert.equal(saved.seq,20);assert.equal(saved.createdAt,time);
}));

test('真实 pre-step blocked：八步后显示中文上限，卡和工单回报记成功交付件数',()=>setup(async f=>{
 const t=ticket();await put(f,t);await f.handler.delegations.tick();const c=f.handler.runtime.cards()[0];
 for(let n=1;n<=8;n++)f.source.emit({type:'event',event:e(n,'step/start',{turn:1,step:n}).event},c.toSession);
 f.source.emit({type:'event',event:e(9,'hub-plugin/notice',{turn:1,step:9,text:'超过 8 步自动停'}).event},c.toSession);
 f.source.emit({type:'event',event:end(10,'blocked').event},c.toSession);
 await eventually(async()=> (await readdir(join(f.handlerOptions.ticketsDir,'failed')).catch(()=>[])).includes(t.meta.id+'.md'));
 assert.equal(c.reason,'做了 8 步还没做完，按规矩先停了：已完成 0 件，剩下的没做');const text=await readFile(join(f.handlerOptions.ticketsDir,'failed',t.meta.id+'.md'),'utf8');assert.match(text,/## 回报\n做了 8 步还没做完，按规矩先停了：已完成 0 件，剩下的没做/u);assert.match(text,/steps: 8/u);assert.equal(text.includes('blocked'),false);assert.equal(f.source.named('session/cancel').length,0);
}));

for(const [kind,expected] of [['blocked','派活被权限规则拦下'],['aborted','派活已取消'],['error','派活执行出错']])test('其他派工终止原因用中文：'+kind,()=>setup(async f=>{
 const t=ticket();await put(f,t);await f.handler.delegations.tick();const c=f.handler.runtime.cards()[0];f.source.emit({type:'event',event:end(1,kind).event},c.toSession);await eventually(()=>c.status==='failed');assert.equal(c.reason,expected);
}));

test('退避 1/2/4/8/16/30 秒无限重试、实际延迟封顶 30 秒；成功重置、退出清定时器',async()=>{
 const c=clock(),listeners=new Set(),client={connected:false,onStateChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},async connect(){this.calls=(this.calls??0)+1;if(!this.succeed)throw Error('offline');this.connected=true;for(const fn of listeners)fn();}};
 const r=new Reconnector({client,random:()=>0.5,schedule:c.schedule,cancel:c.cancel});await r.start();for(let n=0;n<9;n++)await c.fire();assert.deepEqual(c.delays,[1000,2000,4000,8000,16000,30000,30000,30000,30000,30000]);
 client.succeed=true;await c.fire();assert.equal(c.timers.size,0);assert.equal(r.attempt,0);client.connected=false;for(const fn of listeners)fn();assert.equal(c.delays.at(-1),1000);r.stop();assert.equal(c.timers.size,0);
 for(const random of [()=>0,()=>1]){const k=clock(),q=new Reconnector({client:{...client,succeed:false,connected:false},random,schedule:k.schedule,cancel:k.cancel});await q.start();assert.equal(k.delays[0],random()===0?800:1200);q.stop();}
});

test('断线关闭全部待批卡且审计，退避期间审批一律拒绝，health 不绕过退避，旧 Peer 不能破坏新连接',()=>setup(async f=>{
 const c=clock();await f.client.startReconnect({random:()=>0.5,schedule:c.schedule,cancel:c.cancel});await request(f.handler,{path:'/bff/status',headers}).done;
 f.source.records=[assistant(1,'需要写入。'),toolCall(2),approval(3)];f.source.interaction(waterfall('waiting'));
 await eventually(()=>f.handler.runtime.cards()[0]?.status==='pending');const old=f.source.sockets[0];old.close();
 await eventually(()=>f.handler.runtime.cards()[0]?.status==='unavailable');const health=await request(f.handler).json();assert.equal(health.dshConnected,false);assert.equal(health.answering,false);assert.equal(f.source.sockets.length,1);
 const offline=await f.handler.runtime.receive(waterfall('offline-arrival'),new AbortController().signal);assert.equal(offline,'rejected');assert.ok(f.handler.runtime.cards().every(c=>c.status==='unavailable'));
 await eventually(async()=> (await readFile(join(f.handlerOptions.configDir,'approvals.log'),'utf8')).trim().split('\n').length===2);
 const late= request(f.handler,{method:'POST',path:'/bff/approvals/approval-b3/answer',headers,value:{decision:'approve'}});await late.done;assert.equal(late.res.status,409);
 const original=f.client.fetchImpl;let failing=true;f.client.fetchImpl=(url,opts)=>failing&&new URL(url).pathname==='/connect'?Promise.reject(Error('offline')):original(url,opts);
 await c.fire();await c.fire();assert.deepEqual(c.delays,[1000,2000,4000]);failing=false;await c.fire();assert.equal(f.client.answering,true);assert.equal(f.source.eventStreams.size,1);
 old.emit('close');old.emit('failure');assert.equal(f.client.answering,true);assert.equal(f.source.named('$events/result').length,0);
 await f.handler.heartbeat.writes;const heartbeat=JSON.parse(await readFile(f.handler.heartbeat.path,'utf8'));assert.equal(heartbeat.dshConnected,true);assert.equal(heartbeat.answering,true);assert.equal((await stat(f.handler.heartbeat.path)).mode&0o777,0o600);
},{interactions:true}));

test('连回恢复会话跟随、补漏步骤与完成、继续派工队列并推全局 status，用户/派工首句不重发',()=>setup(async f=>{
 const c=clock();await f.handler.start();f.client.stopReconnect();await f.client.startReconnect({random:()=>0.5,schedule:c.schedule,cancel:c.cancel});
 const global=request(f.handler,{path:'/bff/events'});await eventually(()=>global.res.text.includes('event: status'));
 await request(f.handler,{method:'POST',path:'/bff/sessions/s1/messages',value:{text:'原消息'}}).done;
 const tickets=[ticket(),ticket(2)];for(const t of tickets)await put(f,t);await f.handler.delegations.tick();const card=f.handler.runtime.cards().find(c=>c.id===tickets[0].meta.id),target=card.toSession;
 f.source.emit({type:'event',event:e(1,'step/start',{turn:1,step:1}).event},target);await eventually(()=>card.steps.some(s=>s.label==='在写回复'));
 const viewer=request(f.handler,{path:'/bff/sessions/s1/stream'});await eventually(()=>viewer.res.text.includes('event: state'));
 const before=parseSse(global.res.text).filter(e=>e.type==='status').length;f.source.sockets.at(-1).close();await eventually(()=>f.client.connected===false);assert.equal(f.handler.runtime.store.get('s1').running,true);
 const chiefRecords=[assistant(1,'断线期间完成的回复'),end(2)],targetRecords=[e(1,'step/start',{turn:1,step:1}),e(2,'step/start',{turn:1,step:2}),assistant(3,'已整理完成。'),end(4)];
 f.source.snapshotFor=id=>snapshot(id==='s1'?chiefRecords:id===target?targetRecords:[],id==='s1'?2:id===target?4:0);
 f.source.recordsFor=id=>id==='s1'?chiefRecords:id===target?targetRecords:[];
 await c.fire();await eventually(()=>card.status==='done'&&!f.handler.runtime.store.get('s1').running);
 assert.equal(card.summary,'已整理完成。');assert.equal(card.steps.filter(s=>s.label==='在写回复').length,2);assert.equal(f.source.named('session/prompt').length,2);
 await eventually(()=>viewer.res.text.includes('断线期间完成的回复'));assert.ok(parseSse(global.res.text).filter(e=>e.type==='status').length>before);
 await eventually(()=>!f.handler.delegations.running.has(card.id));await f.handler.delegations.tick();assert.equal(f.source.named('session/prompt').length,3);assert.equal(f.source.named('session/create').length,2);
 global.res.destroy();viewer.res.destroy();await Promise.all([global.done,viewer.done]);
},{interactions:true}));

test('退出发生在重连等待中时能结束跟随，不留重试定时器',()=>setup(async f=>{
 const c=clock();await f.client.startReconnect({schedule:c.schedule,cancel:c.cancel,random:()=>0.5});const follow=await f.client.follow('s1');await follow.next();const waiting=follow.next();f.source.sockets[0].close();await tick();follow.dispose();assert.equal((await waiting).done,true);f.client.stopReconnect();assert.equal(c.timers.size,0);
},{interactions:true}));

test('重连快照超过窗口时只读补全漏事件，按 seq 去重，不漏中间工具结果与步骤',()=>setup(async f=>{
 const c=clock();await f.client.startReconnect({schedule:c.schedule,cancel:c.cancel,random:()=>0.5});
 const stream=await f.client.follow('s1');await stream.next();const pending=stream.next();f.source.sockets[0].close();await tick();
 const records=[assistant(1,'准备读取。'),toolCall(2,'read-gap','read',{file_path:'note.md'}),result(3,'read-gap',false),e(4,'step/start',{turn:1,step:2}),assistant(5,'读取完毕。'),end(6)];
 f.source.records=records;f.source.initialSnapshot={...snapshot(records.slice(-2),6),hasMore:true};
 await c.fire();assert.equal((await pending).value.type,'snapshot');
 const output=[];while(true){const n=await stream.next();if(n.done)break;output.push(n.value);if(n.value.type==='done')break;}
 assert.deepEqual(output.filter(e=>e.type==='tool').map(e=>e.status),['running','ok']);assert.equal(output.filter(e=>e.type==='step').length,1);assert.equal(output.filter(e=>e.type==='message').length,2);assert.ok(f.source.named('session/events').length>=1);assert.equal(f.source.named('session/prompt').length,0);stream.dispose();
},{interactions:true}));

test('重连时 SSE 重发完整 activeAttempt partial，旧 chunk 去重，新 delta 继续追加',()=>setup(async f=>{
 const c=clock();await f.client.startReconnect({schedule:c.schedule,cancel:c.cancel,random:()=>0.5});
 const stream=request(f.handler,{path:'/bff/sessions/s1/stream'});await eventually(()=>stream.res.text.includes('event: state'));
 f.source.emit({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',index:0,chunk:{type:'text-delta',text:'已见'}}});await eventually(()=>stream.res.text.includes('已见'));
 f.source.sockets[0].close();await tick();f.source.initialSnapshot={...snapshot([],0),assistantStream:{activeAttempt:{attemptId:'a',nextIndex:3,stream:[{type:'text-chunks',texts:['已见','断线补回']}]}}};
 await c.fire();await eventually(()=>parseSse(stream.res.text).filter(e=>e.type==='state').length===2);
 assert.equal(parseSse(stream.res.text).filter(e=>e.type==='state').at(-1).data.partial,'已见断线补回');
 f.source.emit({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',index:2,chunk:{type:'text-delta',text:'断线补回'}}});
 f.source.emit({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',index:3,chunk:{type:'text-delta',text:'继续'}}});await eventually(()=>stream.res.text.includes('继续'));
 assert.deepEqual(parseSse(stream.res.text).filter(e=>e.type==='delta').map(e=>e.data.text),['已见','继续']);stream.res.destroy();await stream.done;
},{interactions:true}));
