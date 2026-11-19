import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, chmod, readdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, request } from './fixtures.mjs';

async function eventually(fn,timeout = 1500) {
  const end = Date.now()+timeout;
  while (Date.now()<end) { if (await fn()) return; await delay(5); }
  assert.fail('等待心跳状态超时');
}
const heartbeat = async f => JSON.parse(await readFile(join(f.handlerOptions.configDir,'bff-heartbeat.json'),'utf8'));
async function setup(fn,options = {}) { const f = await fixture({interactions:true,...options}); try { await fn(f); } finally { await f.dispose(); } }

test('心跳初始失败关闭、完整字段、0600、同目录原子替换与每 5 秒刷新',()=>setup(async f => {
  const path = join(f.handlerOptions.configDir,'bff-heartbeat.json');
  const first = await heartbeat(f);
  assert.deepEqual(first,{v:1,ts:first.ts,pid:process.pid,dshConnected:false,answering:false,devicePresent:false,deviceLastSeen:null});
  assert.ok(Number.isSafeInteger(first.ts));
  assert.equal((await stat(path)).mode&0o777,0o600);
  // 保留旧文件句柄：rename 后旧句柄仍读到旧内容，证明并非原地截断目标文件。
  const old = await open(path,'r');
  try {
    await chmod(path,0o644);
    const original = await old.readFile('utf8');
    await eventually(async()=> (await heartbeat(f)).ts > first.ts,6500);
    assert.equal((await stat(path)).mode&0o777,0o600);
    const stillOld = Buffer.alloc(Buffer.byteLength(original));
    await old.read(stillOld,0,stillOld.length,0);
    assert.equal(stillOld.toString('utf8'),original);
    assert.equal(JSON.parse(original).ts,first.ts);
    const previous = await old.stat(), current = await stat(path);
    assert.notEqual(current.ino,previous.ino);
    await f.handler.heartbeat.writes;
    assert.equal((await readdir(f.handlerOptions.configDir)).includes('bff-heartbeat.json.tmp'),false);
  } finally { await old.close(); }
}));

test('设备只从已鉴权有效设备头登记；15 分钟到期与 health 使用同一状态',()=> {
  let now = 1000000;
  return setup(async f => {
    await request(f.handler,{key:'wrong',headers:{'x-hub-device':'ignored'}}).done;
    await request(f.handler,{path:'/bff/status',headers:{'x-hub-device':'invalid device'}}).done;
    assert.equal((await heartbeat(f)).deviceLastSeen,null);
    await request(f.handler,{path:'/bff/status',headers:{'x-hub-device':'device-1'}}).done;
    await eventually(async()=> (await heartbeat(f)).devicePresent);
    assert.equal((await heartbeat(f)).deviceLastSeen,now);
    await f.client.connect();
    const health = await request(f.handler).json();
    const expected = f.handler.heartbeat.state();
    for (const field of Object.keys(expected)) assert.deepEqual(health[field],expected[field]);
    assert.equal(health.answering,true); assert.equal(health.dsh.connected,true);
    now+=900000;
    assert.equal((await request(f.handler).json()).devicePresent,true);
    now++;
    assert.equal((await request(f.handler).json()).devicePresent,false);
    await f.handler.heartbeat.write();
    assert.deepEqual(await heartbeat(f),f.handler.heartbeat.state());
    assert.equal((await heartbeat(f)).deviceLastSeen,1000000);
  },{handlerOptions:{now:()=>now}});
});

test('WebSocket 打开不足以标记就绪：必须等 $events ready；断线无需等下个周期',()=>setup(async f => {
  f.source.holdEventsReady = true;
  const connecting = f.client.connect();
  await eventually(()=>f.source.eventStreams.size===1);
  assert.equal(f.client.connected,true);
  assert.equal((await heartbeat(f)).dshConnected,false);
  assert.equal((await heartbeat(f)).answering,false);
  f.source.interaction({type:'ready',clientId:'event-client'});
  await connecting;
  await eventually(async()=> (await heartbeat(f)).answering);
  const disconnectedAt = Date.now();
  f.source.sockets.at(-1).close();
  await eventually(async()=> !(await heartbeat(f)).dshConnected && !(await heartbeat(f)).answering);
  assert.ok(Date.now()-disconnectedAt<1500);
  assert.equal(f.client.answering,false);
  // 恢复连接后重新等待 ready，不能沿用旧连接的可应答标记。
  f.source.holdEventsReady = false; await f.client.connect();
  await eventually(async()=> (await heartbeat(f)).answering);
}));

test('订阅失败和已就绪的事件流结束立即落盘 false',()=>setup(async f => {
  f.source.holdEventsReady = true;
  const connecting = f.client.connect();
  const rejected = assert.rejects(connecting,e=>e.code==='INCOMPATIBLE');
  await eventually(()=>f.source.eventStreams.size===1);
  f.source.interaction({type:'not-ready'}); await rejected;
  await f.handler.heartbeat.writes;
  assert.equal((await heartbeat(f)).answering,false);
  assert.equal((await heartbeat(f)).dshConnected,false);
  f.source.holdEventsReady = false; await f.client.connect();
  await eventually(async()=> (await heartbeat(f)).answering);
  const [streamId,{socket}] = [...f.source.eventStreams][0];
  const stoppedAt = Date.now();
  socket.emit('message',Buffer.from(JSON.stringify({type:'end',streamId})));
  await eventually(async()=> !(await heartbeat(f)).answering);
  assert.ok(Date.now()-stoppedAt<1500);
  assert.equal((await heartbeat(f)).dshConnected,false);
}));

test('关闭先写 answering:false，排队的旧快照不能覆盖关闭状态，停止周期写入',()=>setup(async f => {
  await f.client.connect(); await f.handler.heartbeat.writes;
  assert.equal((await heartbeat(f)).answering,true);
  for (let n=0;n<8;n++) f.handler.heartbeat.changed();
  let release;
  const blocked = new Promise(resolve=>{release=resolve;});
  f.handler.delegations.dispose = ()=>blocked;
  const closing = f.handler.dispose();
  await eventually(async()=> !(await heartbeat(f)).answering);
  assert.equal(f.handler.heartbeat.timer._destroyed,true);
  release(); await closing;
  await f.handler.heartbeat.writes;
  assert.equal((await heartbeat(f)).answering,false);
}));

for (const signal of ['SIGTERM','SIGINT']) test(signal+' 实际子进程沿生产关闭处理器写最终 false',async()=> {
  const child = spawn(process.execPath,['--input-type=module','-e',`
    import { fixture } from './test/fixtures.mjs';
    import { installShutdown } from './server.mjs';
    const f = await fixture({interactions:true});
    await f.client.connect();
    await f.handler.heartbeat.writes;
    const keepalive = setInterval(()=>{},60000);
    installShutdown({async close(){ await f.dispose(); clearInterval(keepalive); }});
    console.log(JSON.stringify({path:f.handler.heartbeat.path,pid:process.pid}));
  `],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
  let output = '', errors = '';
  child.stdout.on('data',chunk=>{output+=chunk;}); child.stderr.on('data',chunk=>{errors+=chunk;});
  const exit = new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  try {
    await eventually(()=>output.includes('\n'),3000);
    const {path,pid} = JSON.parse(output.trim());
    const before = JSON.parse(await readFile(path,'utf8'));
    assert.equal(before.pid,pid); assert.equal(before.answering,true);
    child.kill(signal);
    const result = await Promise.race([exit,delay(3000).then(()=>{throw Error('子进程未按时退出');})]);
    assert.deepEqual(result,{code:0,signal:null},errors);
    const final = JSON.parse(await readFile(path,'utf8'));
    assert.equal(final.answering,false); assert.equal(final.pid,pid);
    assert.equal((await stat(path)).mode&0o777,0o600);
  } finally { if (child.exitCode===null && child.signalCode===null) { child.kill('SIGKILL'); await exit; } }
});
