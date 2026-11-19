import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createHash } from 'node:crypto';
import { stat, readFile, chmod } from 'node:fs/promises';
import { setImmediate as tick } from 'node:timers/promises';
import { NodeWebSocket } from '../lib/websocket.mjs';
import { loadBffKey, startServer } from '../server.mjs';
import { fixture, request, secretFile, userEvent, assistantEvent } from './fixtures.mjs';
async function withFixture(body){const f=await fixture();try{await body(f);}finally{await f.dispose();}}
test('every HTTP route requires the header, before any upstream call',()=>withFixture(async f=>{
  for(const [method,path]of [['GET','/bff/health'],['GET','/bff/sessions'],['POST','/bff/sessions'],['GET','/bff/sessions/s1/history'],['POST','/bff/sessions/s1/messages'],['GET','/bff/sessions/s1/stream'],['POST','/bff/sessions/s1/cancel'],['OPTIONS','/unknown']]){
    const r=request(f.handler,{method,path,key:null,raw:'not JSON'});assert.deepEqual(await r.json(),{error:{code:'UNAUTHORIZED',message:'BFF key required'}});assert.equal(r.res.status,401);
  }assert.equal(f.source.calls.length,0);
}));
test('keys in query strings and incorrect headers are refused',()=>withFixture(async f=>{
  for(const key of [null,'wrong','']){const r=request(f.handler,{key,path:'/bff/health?key='+f.key});await r.done;assert.equal(r.res.status,401);}
}));
test('invalid bodies, path traversal and wrong verbs are safe errors',()=>withFixture(async f=>{
  for(const options of [{method:'POST',path:'/bff/sessions',raw:'{'},{method:'POST',path:'/bff/sessions',raw:'[]'},{method:'POST',path:'/bff/sessions',value:{title:22}},{path:'/bff/sessions/%2Fetc%2Fpasswd/history'},{method:'DELETE',path:'/bff/sessions/s1/history'}]){
    const r=request(f.handler,options);const value=await r.json();assert.ok(value.error);assert.ok([400,405].includes(r.res.status));
  }
}));
test('health remains false when the upstream connection is unavailable',()=>withFixture(async f=>{
  f.client.dispose();const r=await request(f.handler).json();assert.deepEqual(r,{ok:false,dsh:{connected:false},api:'r23',v:1,ts:r.ts,pid:process.pid,dshConnected:false,answering:false,devicePresent:false,deviceLastSeen:null});assert.ok(Number.isSafeInteger(r.ts));
}));
test('BFF key file is created once with 0600 and reused without printing it',async()=>{
  const parent=await secretFile();const path=parent+'.bff';const a=await loadBffKey(path);assert.equal(a.length,64);assert.equal((await stat(path)).mode&0o777,0o600);assert.equal(await loadBffKey(path),a);assert.equal((await readFile(path,'utf8')).trim(),a);
  await chmod(path,0o644);await assert.rejects(loadBffKey(path),e=>e.code==='CONFIGURATION');
});
test('non-loopback binding fails before key generation or listening',async()=>{
  for(const host of ['0.0.0.0','::','localhost','192.0.2.1'])await assert.rejects(startServer({host}),e=>e.code==='CONFIGURATION');
});
test('internal user-role context is excluded from history and messages',()=>withFixture(async f=>{
  const internal=userEvent(2,'internal context');internal.event.data.source={kind:'runtime-context'};f.source.records=[userEvent(1),internal,assistantEvent(3)];
  assert.deepEqual((await f.client.history('s1')).messages.map(x=>x.text),['hello','echo']);
}));
test('history replacements preserve placement',()=>withFixture(async f=>{
  const replacement=userEvent(5,'replacement');replacement.event.surfaceOp={op:'replace',startSeq:1,endSeq:3};
  f.source.records=[userEvent(1),assistantEvent(2),userEvent(3,'next'),assistantEvent(4,'later'),replacement];
  assert.deepEqual((await f.client.history('s1')).messages.map(x=>x.text),['replacement','later']);
}));
test('mismatched rpc correlation ids fail and writes are not retried',()=>withFixture(async f=>{
  f.source.rpcOverride=e=>e.method==='session/prompt'?new Response(JSON.stringify({type:'server-response',rpcId:'other',result:{ok:true,value:{}}})):undefined;
  const r=await request(f.handler,{method:'POST',path:'/bff/sessions/s1/messages',value:{text:'one'}}).json();assert.equal(r.error.code,'INCOMPATIBLE');assert.equal(f.source.named('session/prompt').length,1);
}));
test('upstream 401 invalidates the connection',()=>withFixture(async f=>{
  f.source.rpcOverride=()=>new Response(null,{status:401});await assert.rejects(f.client.listSessions(),e=>e.code==='DISCONNECTED');assert.equal(f.client.connected,false);
}));
test('SSE emits exact delta/message/done/error JSON and disposes on close',()=>withFixture(async f=>{
  await f.client.connect();const r=request(f.handler,{path:'/bff/sessions/s1/stream'});await tick();assert.equal(r.res.status,200);assert.match(r.res.headers['content-type'],/^text\/event-stream/);
  f.source.emit({type:'assistant-stream',frame:{type:'chunk',attemptId:'a',index:0,chunk:{type:'text-delta',text:'echo'}}});
  f.source.emit(assistantEvent(2));f.source.emit({type:'event',event:{seq:3,type:'turn/end',data:{reason:{kind:'error'}}}});await tick();
  assert.equal(r.res.text,'event: state\ndata: {"running":false,"partial":""}\n\nevent: delta\ndata: {"text":"echo"}\n\nevent: message\ndata: {"role":"assistant","text":"echo","seq":2,"ts":2000,"id":"2","tools":[]}\n\nevent: error\ndata: {"message":"DSH turn failed"}\n\nevent: done\ndata: {}\n\n');
  r.res.destroy();await r.done;assert.equal(f.source.streams.size,0);assert.equal(f.source.named('session/cancel').length,0);
}));
test('stream transport errors are redacted and close SSE',()=>withFixture(async f=>{
  await f.client.connect();const r=request(f.handler,{path:'/bff/sessions/s1/stream'});await tick();
  const id=[...f.source.streams.keys()][0];f.source.sockets[0].emit('message',Buffer.from(JSON.stringify({type:'error',streamId:id,error:{code:'gateway/internal',message:'SECRET_cookie stack'}})));
  await r.done;assert.match(r.res.text,/event: error/);assert.equal(r.res.text.includes('SECRET'),false);assert.equal(r.res.writableEnded,true);
}));
function wsFrame(opcode,content,fin=true){const payload=Buffer.from(content);assert.ok(payload.length<126);return Buffer.concat([Buffer.from([(fin?128:0)|opcode,payload.length]),payload]);}
function memoryCarrier({badAccept=false}={}){
  const req=new EventEmitter(),socket=new EventEmitter();socket.writableLength=0;socket.writes=[];socket.write=data=>socket.writes.push(Buffer.from(data));socket.destroy=()=>socket.emit('close');req.destroy=()=>{};
  let headers;
  const requestImpl=(url,options)=>{headers=options.headers;req.end=()=>queueMicrotask(()=>req.emit('upgrade',{headers:{upgrade:'websocket','sec-websocket-accept':badAccept?'bad':createHash('sha1').update(headers['Sec-WebSocket-Key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')}},socket,Buffer.alloc(0)));return req;};
  return {socket,requestImpl,get headers(){return headers;}};
}
test('native WebSocket sends authenticated masked frames; receives binary fragments and answers ping',async()=>{
  const carrier=memoryCarrier();const ws=new NodeWebSocket(new URL('http://127.0.0.1:13290/api/remote.mux'),'synthetic-cookie',1000,carrier.requestImpl);await once(ws,'open');assert.equal(carrier.headers.Cookie,'synthetic-cookie');
  ws.send('hello');const sent=carrier.socket.writes[0];assert.equal(sent[1]&128,128);const unmasked=Buffer.from(sent.subarray(6));for(let i=0;i<unmasked.length;i++)unmasked[i]^=sent[2+i%4];assert.equal(unmasked.toString(),'hello');
  const messages=[];ws.on('message',b=>messages.push(b.toString()));const fragmented=Buffer.concat([wsFrame(2,'{"type":',false),wsFrame(9,'ping'),wsFrame(0,'"item"}')]);
  carrier.socket.emit('data',fragmented.subarray(0,3));carrier.socket.emit('data',fragmented.subarray(3));assert.deepEqual(messages,['{"type":"item"}']);assert.equal(carrier.socket.writes[1][0]&15,10);ws.close();
});
test('native WebSocket rejects a forged upgrade and oversized frames',async()=>{
  const bad=memoryCarrier({badAccept:true});const ws=new NodeWebSocket(new URL('http://127.0.0.1:13290/api/remote.mux'),'fake',1000,bad.requestImpl);await once(ws,'close');assert.equal(ws.readyState,3);
  const good=memoryCarrier();const second=new NodeWebSocket(new URL('http://127.0.0.1:13290/api/remote.mux'),'fake',1000,good.requestImpl);await once(second,'open');const length=Buffer.alloc(10);length[0]=130;length[1]=127;length.writeBigUInt64BE(9000000n,2);good.socket.emit('data',length);assert.equal(second.readyState,3);
});

test('closing a stream discards buffered frames and ends pending reads quietly',()=>withFixture(async f=>{
  const stream=await f.client.follow('s1');await stream.next();f.source.emit(userEvent(2));stream.dispose();assert.equal((await stream.next()).done,true);
  const other=await f.client.follow('s1');await other.next();const pending=other.next();other.dispose();assert.equal((await pending).done,true);
}));
test('HTTP 监听参数与退出使用内存服务，不打开端口',()=>withFixture(async f=>{
  const memory = new EventEmitter(); memory.listening = false;
  memory.listen = (port,host,ready) => { memory.listening = true; memory.bound = {port,host}; queueMicrotask(ready); };
  memory.closeAllConnections = () => {}; memory.close = ready => { memory.listening = false; ready(); };
  const app=await startServer({port:13291,keyFile:(await secretFile())+'.listener-key',client:f.client,...f.handlerOptions,
    serverFactory:callback=>{assert.equal(typeof callback,'function');return memory;}});
  assert.deepEqual(memory.bound,{host:'127.0.0.1',port:13291}); await app.close();assert.equal(memory.listening,false);
}));
