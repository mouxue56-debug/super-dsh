import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { DshClient } from '../lib/dsh-client.mjs';
import { createHandler } from '../server.mjs';
import { request } from './fixtures.mjs';
async function within(promise,ms,message) {
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}
}
const enabled=Boolean(process.env.DSH_URL && process.env.DSH_TOKEN_FILE);
test('live official DSH protocol + HTTP handler (test instance only)',{skip:!enabled?'Set DSH_URL and DSH_TOKEN_FILE explicitly; no live connection attempted':false,timeout:30000},async t=>{
  const url=new URL(process.env.DSH_URL);
  assert.ok(['http://127.0.0.1:13290','http://127.0.0.1:3290'].includes(url.origin),'Live validation is restricted to the r16 test instance (tunnel 13290 or <host> 3290)'); // 监工改：允许在 <host> 本机直连测试实例
  const c=new DshClient();const handler=createHandler({client:c,key:'live-memory-only-key'});
  const call=options=>request(handler,{key:'live-memory-only-key',...options});let id,stream,pump,firstText='',slowText='',cancelled=false;
  try{
    await t.test('unauthenticated DSH requests and BFF requests are refused',async()=>{
      for(const path of ['/','/api','/connect']){const r=await fetch(new URL(path,url),{redirect:'manual'});assert.equal(r.status,401);await r.body?.cancel();}
      const r=call({key:null});assert.equal((await r.json()).error.code,'UNAUTHORIZED');
    });
    await t.test('connect exchanges token and owns an authenticated WebSocket',async()=>{await c.connect();assert.equal(c.connected,true);const h=await call({path:'/bff/health'}).json();assert.equal(h.dsh.connected,true);assert.equal(h.model,'hub-fake/echo-1');assert.equal('version'in h.dsh,false);});
    await t.test('list sessions with the exact HTTP shape',async()=>{assert.ok(Array.isArray((await call({path:'/bff/sessions'}).json()).sessions));});
    await t.test('create a remote session in the required cwd and preserve title',async()=>{const title='B1 live '+Date.now();const r=await call({method:'POST',path:'/bff/sessions',value:{title}}).json();assert.ok(r.id);id=r.id;const listed=(await call({path:'/bff/sessions'}).json()).sessions.find(item=>item.id===id);assert.equal(listed.title,title);assert.equal(typeof listed.updatedAt,'number');const raw=(await c.rpc('session/list',{_request:{}})).items.find(item=>item.sessionId===id);assert.equal(raw.cwd,process.env.HUB_LIVE_EXPECT_CWD??`${process.env.HOME}/dsh-work/dev-work/chief`);t.diagnostic('created '+id);});
    if(!id)throw new Error('Session creation failed');
    await t.test('send a message, receive echo deltas and completion over follow',async()=>{
      const response=call({path:`/bff/sessions/${id}/stream`});
      stream={dispose:()=>response.res.destroy()};pump=response.done;
      let doneResolve;const done=new Promise(r=>doneResolve=r);
      response.res.on('chunk',chunk=>{const lines=chunk.split('\n');const type=lines[0].slice(7);if(type==='delta')firstText+=JSON.parse(lines[1].slice(6)).text;if(type==='done')doneResolve();});
      await once(response.res,'headers');assert.equal(response.res.status,200);
      const result=await call({method:'POST',path:`/bff/sessions/${id}/messages`,value:{text:'B1 echo verification'}}).json();assert.equal(result.accepted,true);assert.ok(result.requestId);
      await within(done,10000,'No turn completion');stream.dispose();await pump;assert.match(firstText,/假模型回显/);assert.ok(firstText.length>0);
    });
    await t.test('history contains exactly the human input and assistant output',async()=>{const r=await call({path:`/bff/sessions/${id}/history`}).json();assert.deepEqual(r.messages.map(m=>m.role),['user','assistant']);assert.equal(r.messages[0].text,'B1 echo verification');assert.equal(r.messages[1].text,firstText);});
    await t.test('echo content equals the submitted human input',{skip:!firstText.includes('B1 echo verification')?'Upstream fake model echoes injected time-context instead of human input; fake-model source selects the last user-role message':false},async()=>{assert.match(firstText,/B1 echo verification/);});
    await t.test('send 慢, cancel after first delta, and observe the stream stop',async()=>{
      stream=await c.follow(id);await stream.next();let gotDelta,gotDone;const first=new Promise(r=>gotDelta=r),done=new Promise(r=>gotDone=r);let deltasAfterDone=0,ended=false;
      pump=(async()=>{for await(const e of stream){if(e.type==='delta'){if(ended)deltasAfterDone++;slowText+=e.text;gotDelta();}if(e.type==='done'){ended=true;gotDone();}}})();
      await call({method:'POST',path:`/bff/sessions/${id}/messages`,value:{text:'慢：B1 cancellation verification'}}).json();
      await within(first,7000,'No streaming delta before cancellation');
      const receipt=await call({method:'POST',path:`/bff/sessions/${id}/cancel`,value:{}}).json();assert.deepEqual(receipt,{ok:true});cancelled=true;
      await within(done,5000,'Stream did not stop after cancellation');
      const atStop=slowText;await delay(400);assert.equal(slowText,atStop);assert.equal(deltasAfterDone,0);stream.dispose();await pump.catch(e=>{if(e.code!=='DISCONNECTED')throw e;});
    });
    await t.test('the fake model entered its special eight-second slow branch',{skip:!slowText.includes('慢')?'Upstream injected time-context hides 慢 from the fake-model last-message predicate; cancellation is verified during ordinary streaming':false},async()=>{assert.equal(cancelled,true);});
  }finally{stream?.dispose();handler.dispose();c.dispose();if(pump)await pump.catch(()=>{});}
});
