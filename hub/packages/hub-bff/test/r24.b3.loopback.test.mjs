// 仅使用自建 127.0.0.1 假 DSH 和独立端口 BFF；无模型、无真实凭据、无外网。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DshClient} from '../lib/dsh-client.mjs';
import {seedRoster} from './roster-fixture.mjs';
import {startServer} from '../server.mjs';
import {testDirectory} from './fixtures.mjs';
import {formatTicket} from '../lib/delegation.mjs';
const AUTH='b3-loopback-synthetic-only';
async function eventually(fn,ms=6000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(10);}assert.fail('回环联调等待超时');}
function packet(value){const b=Buffer.from(JSON.stringify(value));let h;if(b.length<126)h=Buffer.from([0x82,b.length]);else if(b.length<65536){h=Buffer.alloc(4);h[0]=0x82;h[1]=126;h.writeUInt16BE(b.length,2);}else{h=Buffer.alloc(10);h[0]=0x82;h[1]=127;h.writeBigUInt64BE(BigInt(b.length),2);}return Buffer.concat([h,b]);}
class FakeDsh {
 records=new Map();peers=new Set();streams=new Map();results=[];prompts=[];readyCount=0;
 async start(port=this.port ?? 0){
  this.server=http.createServer(async(req,res)=>{
   try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/connect'){
     if(url.searchParams.get('token')!==AUTH || url.searchParams.get('interactions')!=='answer'){res.writeHead(401);res.end();return;}
     res.writeHead(302,{location:'./api/remote.mux','set-cookie':'session=b3-synthetic; HttpOnly'});res.end();return;
    }
    if(req.headers.cookie!=='session=b3-synthetic'){res.writeHead(401);res.end();return;}
    const chunks=[];for await(const c of req)chunks.push(c);const q=JSON.parse(Buffer.concat(chunks));const a=q.payload.args;let value;
    switch(q.method){
     case 'session/modelCatalog':value={default:{provider:'hub-fake',model:'b3-no-model'}};break;
     case 'session/create':{const id='loopback-'+(this.records.size+1);this.records.set(id,[]);value={sessionId:id};break;}
     case 'session/rename':value={};break;
     case 'session/prompt':this.prompts.push({sessionId:a.request.sessionId,requestId:a.request.requestId,content:a.request.content});value={accepted:true};break;
     case 'session/events':{const rows=this.records.get(a.request.address.sessionId) ?? [];value={records:rows,cursor:rows.at(-1)?.event.seq ?? 0,hasMore:false};break;}
     case '$events/result':this.results.push(a);break;
     case 'session/cancel':assert.fail('回环场景不应重发或取消会话');break;
     default:assert.fail('假 DSH 不支持这个端点');
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({type:'server-response',rpcId:q.rpcId,result:{ok:true,value}}));
   }catch{res.writeHead(500);res.end();}
  });
  this.server.on('upgrade',(req,socket)=>{
   if(req.url!=='/api/remote.mux' || req.headers.cookie!=='session=b3-synthetic'){socket.destroy();return;}
   const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
   socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
   this.peers.add(socket);let buffered=Buffer.alloc(0);
   socket.on('data',chunk=>{
    buffered=Buffer.concat([buffered,chunk]);
    while(buffered.length>=2){
     const opcode=buffered[0]&15;let length=buffered[1]&127,offset=2;
     if(length===126){if(buffered.length<4)return;length=buffered.readUInt16BE(2);offset=4;}
     else if(length===127){if(buffered.length<10)return;length=Number(buffered.readBigUInt64BE(2));offset=10;}
     const masked=Boolean(buffered[1]&128);const bodyAt=offset+(masked?4:0);if(buffered.length<bodyAt+length)return;
     const body=Buffer.from(buffered.subarray(bodyAt,bodyAt+length));if(masked)for(let i=0;i<length;i++)body[i]^=buffered[offset+i%4];buffered=buffered.subarray(bodyAt+length);
     if(opcode===8){socket.end();return;}if(opcode!==1 && opcode!==2)continue;
     const m=JSON.parse(body);if(m.type==='cancel'){this.streams.delete(m.streamId);continue;}
     if(m.type!=='open')continue;
     const entry={socket,endpoint:m.endpoint,sessionId:m.payload.args.request?.address?.sessionId};this.streams.set(m.streamId,entry);
     if(m.endpoint==='$events'){this.readyCount++;this.send(m.streamId,{type:'ready',clientId:'fake-peer-'+this.readyCount});}
     else if(m.endpoint==='session/follow'){const records=this.records.get(entry.sessionId) ?? [];this.send(m.streamId,{type:'snapshot',records,cursor:records.at(-1)?.event.seq ?? 0,hasMore:false,header:{id:entry.sessionId}});}
    }
   });
   socket.on('error',()=>{});socket.on('close',()=>{this.peers.delete(socket);for(const [id,e]of this.streams)if(e.socket===socket)this.streams.delete(id);});
  });
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(port,'127.0.0.1',resolve);});this.port=this.server.address().port;
 }
 send(streamId,value){const socket=this.streams.get(streamId)?.socket;if(socket&&!socket.destroyed)socket.write(packet({type:'item',streamId,value}));}
 append(id,event){const records=this.records.get(id) ?? [];records.push({event});this.records.set(id,records);for(const [streamId,s] of this.streams)if(s.endpoint==='session/follow'&&s.sessionId===id)this.send(streamId,{type:'event',event});}
 ask(id,request,eventId){for(const [streamId,s]of this.streams)if(s.endpoint==='$events')this.send(streamId,{type:'waterfall',event:'approval/request',eventId,agentId:id,request});}
 async stop(){for(const socket of this.peers)socket.destroy();this.peers.clear();this.streams.clear();this.server.closeAllConnections();await new Promise(resolve=>this.server.close(resolve));}
}
async function sse(url,headers){const controller=new AbortController(),response=await fetch(url,{headers,signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader();const state={text:'',error:null};const task=(async()=>{try{for(;;){const p=await reader.read();if(p.done)break;state.text+=new TextDecoder().decode(p.value);}}catch(error){if(!controller.signal.aborted)state.error=error;}})();return {state,async close(){controller.abort();await task;}};}

test('独立端口真 HTTP/WebSocket/SSE：假 DSH 停机→失败退避→重启→审批/跟随恢复，不重复消息',{timeout:30000},async()=>{
 const reserve=http.createServer();await new Promise(ok=>reserve.listen(0,'127.0.0.1',ok));const bffPort=reserve.address().port;await new Promise(ok=>reserve.close(ok));
 const dir=await testDirectory(),fake=new FakeDsh();let app,global,session;
 const tokenFile=join(dir,'synthetic-auth');await writeFile(tokenFile,AUTH,{mode:0o600});
 const botsDir=join(dir,'bots');for(const id of ['chief','support','content','pm','art','research'])await mkdir(join(botsDir,id),{recursive:true});
 const bffHeaders={'x-hub-bff-key':AUTH,'x-hub-device':'loopback-device','content-type':'application/json'};
 const api=async(path,method='GET',value,withDevice=true)=>{const response=await fetch('http://127.0.0.1:'+bffPort+'/bff'+path,{method,headers:withDevice?bffHeaders:Object.fromEntries(Object.entries(bffHeaders).filter(([key])=>key!=='x-hub-device')),...(value===undefined?{}:{body:JSON.stringify(value)})});return {status:response.status,body:await response.json()};};
 let seq=0;const ev=(type,data)=>({seq:++seq,type,time:Date.now(),data});
 try{
  await fake.start();const client=new DshClient({url:'http://127.0.0.1:'+fake.port,tokenFile,timeoutMs:400});
  // 预先写入仅本测试使用的 BFF 认证文件；不读取任何真实凭据。
  const keyFile=join(dir,'synthetic-bff-auth');await writeFile(keyFile,AUTH,{mode:0o600});
  await seedRoster(dir);
  app=await startServer({hubHome:dir,port:bffPort,keyFile,client,storeFile:join(dir,'store.json'),callLogFile:join(dir,'calls.log'),configDir:join(dir,'config'),ticketsDir:join(dir,'tickets'),botsDir,requireBot:true,reconnectOptions:{random:()=>0.5}});
  assert.equal((await api('/health')).body.answering,true);const id=(await api('/sessions','POST',{bot:'chief',title:'B3 假数据'})).body.id;
  global=await sse('http://127.0.0.1:'+bffPort+'/bff/events',bffHeaders);session=await sse('http://127.0.0.1:'+bffPort+'/bff/sessions/'+id+'/stream',bffHeaders);
  const first=await api('/sessions/'+id+'/messages','POST',{text:'只发送一次',idem:'loopback-once'});assert.equal(first.status,202);
  const meta={v:1,bot:'chief',sessionId:id,level:'L3',action:'写共享区',tool:'write',path:'/Users/example/dsh-work/shared/b3.md',chars:3,preview:'短摘要'};
  const reason='HUBAPPROVAL1 '+JSON.stringify(meta),req={toolName:'write',callId:'b3-call-1',reason};
  fake.append(id,ev('assistant/message',{turn:1,step:1,message:{content:[{type:'reasoning',text:'PRIVATE_THINKING'},{type:'text',text:'让团队能查阅，所以写进共享区。'}]}}));
  fake.append(id,ev('tool/call',{turn:1,step:1,callId:'b3-call-1',name:'write',arguments:JSON.stringify({file_path:meta.path,content:'PRIVATE_TOOL_BODY'})}));
  fake.append(id,ev('approval/asked',{id:'loopback-approval-1',...req}));fake.ask(id,req,'first-event');
  await eventually(async()=> (await api('/approvals')).body.approvals.length===1);
  const firstCard=(await api('/approvals')).body.approvals[0];assert.equal(firstCard.seq,3);assert.equal(firstCard.why,'让团队能查阅，所以写进共享区。');
  await eventually(()=>session.state.text.includes('"status":"pending"'));
  const statusBefore=global.state.text.match(/event: status/gu).length;
  await fake.stop();await eventually(async()=>!(await api('/health')).body.dshConnected);
  const down=(await api('/health')).body;assert.equal(down.answering,false);assert.equal(down.dshConnected,false);
  await eventually(async()=> (await api('/sessions/'+id+'/cards')).body.cards[0].status==='unavailable');
  const late=await api('/approvals/loopback-approval-1/answer','POST',{decision:'approve'});assert.equal(late.status,409);
  await eventually(()=>client.reconnector.attempt>=2,3500); // 至少一次真实连接失败，下一次等 2 秒。
  fake.append(id,ev('approval/decided',{id:'loopback-approval-1',outcome:'rejected'}));
  fake.append(id,ev('tool/result',{message:{toolCallId:'b3-call-1',isError:true,content:[{type:'text',text:'主人 没批准，这一步没做'}]}}));
  fake.append(id,ev('assistant/message',{turn:1,step:2,message:{content:[{type:'text',text:'断线期间已拒绝，没有写入。'}]}}));fake.append(id,ev('turn/end',{reason:{kind:'completed'}}));
  await fake.start();await eventually(async()=> (await api('/health')).body.answering,6000);
  await eventually(()=>session.state.text.includes('断线期间已拒绝，没有写入。')&&session.state.text.includes('event: done'));
  await eventually(async()=>!(await api('/sessions')).body.sessions[0].running);
  assert.equal(fake.readyCount,2);assert.equal(fake.prompts.length,1);assert.equal(fake.results.length,0);
  const duplicate=await api('/sessions/'+id+'/messages','POST',{text:'回执重试',idem:'loopback-once'});assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);assert.equal(fake.prompts.length,1);
  const history=(await api('/sessions/'+id+'/history')).body;assert.equal(history.messages.flatMap(m=>m.tools ?? [])[0].status,'unavailable');
  assert.equal(history.messages[0].seq,1);assert.ok(global.state.text.match(/event: status/gu).length>statusBefore);
  await api('/sessions/'+id+'/messages','POST',{text:'连回后新的一句'});
  const req2={...req,callId:'b3-call-2'};
  fake.append(id,ev('assistant/message',{turn:2,step:1,message:{content:[{type:'text',text:'为团队保存最终结果。'}]}}));
  const callSeq=seq+1;fake.append(id,ev('tool/call',{turn:2,step:1,callId:req2.callId,name:'write',arguments:JSON.stringify({file_path:meta.path,content:'PRIVATE_SECOND_BODY'})}));
  const askedSeq=seq+1;fake.append(id,ev('approval/asked',{id:'loopback-approval-2',...req2}));fake.ask(id,req2,'second-event');
  await eventually(async()=> (await api('/approvals')).body.approvals.length===1);const approved=await api('/approvals/loopback-approval-2/answer','POST',{decision:'approve'});assert.equal(approved.body.card.seq,askedSeq);
  await eventually(()=>fake.results.length===1);assert.equal(fake.results[0].outcome.value,'allowed-once');assert.equal(fake.results[0].clientId,'fake-peer-2');
  fake.append(id,ev('approval/decided',{id:'loopback-approval-2',outcome:'allowed-once'}));fake.append(id,ev('tool/result',{message:{toolCallId:req2.callId,isError:false,content:[{type:'text',text:'PRIVATE_RAW_RESULT'}]}}));fake.append(id,ev('turn/end',{reason:{kind:'completed'}}));
  await eventually(()=>session.state.text.includes('"status":"ok"'));const h2=(await api('/sessions/'+id+'/history')).body;const tool=h2.messages.flatMap(m=>m.tools ?? []).find(t=>t.id===req2.callId);assert.equal(tool.seq,callSeq);assert.equal(tool.status,'ok');assert.equal(tool.level,'L3');
  const wire=JSON.stringify(h2)+session.state.text;for(const secret of ['PRIVATE_TOOL_BODY','PRIVATE_THINKING','PRIVATE_RAW_RESULT','PRIVATE_SECOND_BODY'])assert.equal(wire.includes(secret),false);
  const audit=await readFile(join(dir,'config/approvals.log'),'utf8');assert.equal(audit.trim().split('\n').length,2);assert.match(audit,/\tunavailable\t-\n/u);assert.match(audit,/\tapproved\tloopback-device\n/u);assert.equal((await stat(join(dir,'config/bff-heartbeat.json'))).mode&0o777,0o600);
  assert.equal(global.state.error,null);assert.equal(session.state.error,null);assert.equal(fake.prompts.length,2);
  // G1：真实 HTTP 续做接口和派工卡 SSE，仍全程只用自建假 DSH。
  await eventually(async()=>!(await api('/sessions')).body.sessions.find(s=>s.id===id).running);
  const tid='T-20261117-210000-g1aa',ts=new Date().toISOString(),working=join(dir,'tickets/working');await mkdir(working,{recursive:true});
  await writeFile(join(working,tid+'.md'),formatTicket({meta:{id:tid,kind:'delegation',creator:'chief',assignee:'pm',status:'queued',createdAt:ts,updatedAt:ts,fromSession:id,toSession:'',steps:'0'},task:'整理尚未完成的草稿。',progress:'- '+ts+' 首席派出',report:''}),{mode:0o600});
  let delegated;await eventually(async()=>{delegated=(await api('/sessions/'+id+'/cards')).body.cards.find(c=>c.id===tid);return delegated?.status==='running'&&fake.prompts.length===3;});
  for(let n=1;n<=8;n++){
   fake.append(delegated.toSession,ev('step/start',{turn:1,step:n}));
   if(n===1){fake.append(delegated.toSession,ev('tool/call',{callId:'g1-write',name:'write',arguments:JSON.stringify({file_path:join(botsDir,'pm/drafts/a.md'),content:'PRIVATE_G1_BODY'})}));fake.append(delegated.toSession,ev('tool/result',{message:{toolCallId:'g1-write',isError:false,content:[{type:'text',text:'PRIVATE_G1_RESULT'}]}}));}
  }
  fake.append(delegated.toSession,ev('hub-plugin/notice',{text:'超过 8 步自动停'}));fake.append(delegated.toSession,ev('turn/end',{reason:{kind:'blocked'}}));
  await eventually(async()=>{delegated=(await api('/sessions/'+id+'/cards')).body.cards.find(c=>c.id===tid);try{await readFile(join(dir,'tickets/failed',tid+'.md'));return delegated.status==='failed';}catch{return false;}});
  assert.equal(delegated.reason,'做了 8 步还没做完，按规矩先停了：已完成 1 件，剩下的没做');assert.equal(delegated.steps[2].label,'写了 drafts/a.md');
  const route='/delegations/'+tid+'/continue';assert.equal((await api(route,'POST',{},false)).status,400);
  const clicks=await Promise.all([api(route,'POST',{}),api(route,'POST',{})]);assert.deepEqual(clicks.map(r=>r.status).sort(),[200,409]);const continued=clicks.find(r=>r.status===200).body.continuedBy;assert.ok(continued);
  let next;await eventually(async()=>{next=(await api('/sessions/'+id+'/cards')).body.cards.find(c=>c.id===continued);return next?.status==='running'&&fake.prompts.length===4;});
  assert.equal(fake.prompts[3].content[0].text,'【首席派来的活 · 工单 '+continued+'】接着做上一张工单 '+tid+' 剩下的部分，已完成的不要重做。原任务：整理尚未完成的草稿。');
  fake.append(next.toSession,ev('step/start',{turn:1,step:1}));fake.append(next.toSession,ev('assistant/message',{message:{content:[{type:'text',text:'## **完成**\n- [剩余草稿](https://example.invalid/draft)'}]}}));fake.append(next.toSession,ev('turn/end',{reason:{kind:'completed'}}));
  await eventually(async()=>{next=(await api('/sessions/'+id+'/cards')).body.cards.find(c=>c.id===continued);return next.status==='done';});assert.equal(next.summary,'完成 剩余草稿');assert.equal((await api(route,'POST',{})).status,409);
  await eventually(()=>global.state.text.includes('"continuedBy":"'+continued+'"')&&global.state.text.includes('写了 drafts/a.md'));assert.equal(global.state.text.includes('PRIVATE_G1'),false);
  const calls=(await readFile(join(dir,'calls.log'),'utf8')).trim().split('\n');assert.equal(calls.length,4);assert.equal(calls.filter(l=>l.endsWith('\tdelegate')).length,2);
  console.log('回环验证：独立临时端口；假 DSH 重启一次；原两条用户消息各发送一次；原派工和续单各派一次；并发续做200/409；中文动作和纯文字摘要已透过SSE；无模型调用。');
 }finally{await session?.close();await global?.close();await app?.close();if(fake.server?.listening)await fake.stop();}
});
