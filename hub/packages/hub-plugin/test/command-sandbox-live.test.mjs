import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
const mod=await import('../command-sandbox.mjs').catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
const base=path.join(process.env.HUB_HOME||path.join(os.homedir(),'dsh-work'),'tmp/r26-A2');fs.mkdirSync(base,{recursive:true});
const fixture=fs.mkdtempSync(base+'/live-'),home=fixture+'/home',own=home+'/own',shared=home+'/shared',outside=fixture+'/outside';
for(const p of [own+'/.tmp',shared,outside,home+'/.secrets',home+'/.ssh'])fs.mkdirSync(p,{recursive:true});
console.log('真沙箱实测明细：'+fixture+'/commands.jsonl');
// Only a fabricated marker is used; stdout from denied reads is always /dev/null.
fs.writeFileSync(home+'/.secrets/fake.txt','fabricated-fixture\n');fs.writeFileSync(own+'/data.txt','ok\n');fs.symlinkSync(home+'/.secrets',own+'/link-to-private');
const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
function profile(extra={}){assert.equal(typeof mod.buildProfile,'function','缺少真沙箱实现');return mod.buildProfile({home,hubHome:home+'/work',own,readable:[own,shared],denyRead:[home+'/.secrets',home+'/.ssh'],network:false,...extra});}
function run(command,extra={}){const r=spawnSync('/usr/bin/sandbox-exec',['-p',profile(extra),'--','/bin/bash','--noprofile','--norc','-c',command],{cwd:own,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,TMPDIR:own+'/.tmp',NO_COLOR:'1'},encoding:'utf8',timeout:12000});fs.appendFileSync(fixture+'/commands.jsonl',JSON.stringify({command,status:r.status,signal:r.signal,markers:r.stdout?.match(/check\d+:\d+/g)||[],stderr:r.stderr?.slice(0,6000)})+'\n');assert.ifError(r.error);assert.ok(!/sandbox-exec: (?:.*syntax|.*unbound|.*invalid|.*failed)/i.test(r.stderr),r.stderr);return r;}
const denied=(command,extra={})=>{const r=run(command,extra);assert.notEqual(r.status,0,command+' unexpectedly succeeded');assert.match(r.stderr,/not permitted|denied|EPERM|EACCES/i,command+': '+r.stderr);return r;};
test('真沙箱：bash python node小脚本能运行，own和.tmp能写',()=>{assert.equal(run('echo ok > result; echo tmp > "$TMPDIR/small"; cat data.txt').status,0);assert.equal(run('/usr/bin/python3 -c '+q('print(1)')).status,0);assert.equal(run(q(process.execPath)+' -e '+q('console.log(1)')).status,0);assert.ok(fs.existsSync(own+'/.tmp/small'));});
for(const [label,command] of [['密钥内容','cat '+q(home+'/.secrets/fake.txt')+' > /dev/null'],['密钥目录列表','ls '+q(home+'/.secrets')+' > /dev/null'],['own内symlink','cat link-to-private/fake.txt > /dev/null'],['外部写','echo forbidden > '+q(outside+'/forbidden')],['家目录其他位置读','cat '+q(home+'/unreadable.txt')+' > /dev/null']])test('真沙箱拒绝 '+label,()=>{if(label==='家目录其他位置读')fs.writeFileSync(home+'/unreadable.txt','fixture');denied(command);assert.ok(!fs.existsSync(outside+'/forbidden'));});
test('真沙箱拒绝系统临时目录写入',()=>denied('echo forbidden > '+q('/private/tmp/r26-A2-outside-'+process.pid)));
test('真沙箱批准的extraWrite才可写且不额外开放家目录读',()=>{const p=outside+'/approved';assert.equal(run('echo ok > '+q(p),{extraWrite:[outside]}).status,0);assert.equal(fs.readFileSync(p,'utf8'),'ok\n');});
for(const [label,command]of [['curl','/usr/bin/curl -sS -m 5 https://example.com > /dev/null'],['python','/usr/bin/python3 -c '+q('import urllib.request; urllib.request.urlopen("https://example.com",timeout=5)')+' > /dev/null'],['node',q(process.execPath)+' -e '+q('fetch("https://example.com",{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0)).catch(e=>{console.error(e.cause||e);process.exit(1)})')+' > /dev/null']])test('真沙箱拒绝联网 '+label,()=>{const r=run(command);assert.notEqual(r.status,0);assert.match(r.stderr,/not permitted|denied|EPERM|EACCES|resolve host|gaierror|ENOTFOUND|nodename/i);});
test('真沙箱拒绝通过python间接exec defaults',()=>denied('/usr/bin/python3 -c '+q('import subprocess,sys;sys.exit(subprocess.run(["/usr/bin/defaults","read","-g","AppleLocale"]).returncode)')));
test('真沙箱拒绝信号给沙箱外自建进程，允许自身与子进程',async()=>{const child=spawn('/bin/sleep',['30'],{stdio:'ignore'});await once(child,'spawn');try{denied('kill -0 '+child.pid);assert.equal(run('kill -0 $$; /bin/sleep 1 & child=$!; kill -0 "$child"; wait "$child"').status,0);}finally{child.kill();await once(child,'exit');}});
test('写进脚本再跑：读密钥/越界写/网络/信号/exec全部被真实沙箱挡住',async()=>{
 const child=spawn('/bin/sleep',['30'],{stdio:'ignore'});await once(child,'spawn');
 const lines=['cat '+q(home+'/.secrets/fake.txt')+' > /dev/null','echo forbidden > '+q(outside+'/script-forbidden'),'/usr/bin/curl -sS -m 5 https://example.com > /dev/null','kill -0 '+child.pid,'/usr/bin/defaults read -g AppleLocale > /dev/null'];
 const script=own+'/indirect.sh';fs.writeFileSync(script,lines.map((x,i)=>x+'\nprintf "check'+i+':%s\\n" "$?"').join('\n')+'\n');
 try{const r=run('/bin/sh '+q(script));const matches=[...r.stdout.matchAll(/check(\d):(\d+)/g)];assert.equal(matches.length,5,r.stdout);for(const m of matches)assert.notEqual(Number(m[2]),0,'script operation '+m[1]);assert.ok(!fs.existsSync(outside+'/script-forbidden'));}finally{child.kill();await once(child,'exit');}
});

for(const [label,command]of [
 ['curl指定地址','/usr/bin/curl -sS -m 5 --resolve example.com:443:192.0.2.1 https://example.com > /dev/null'],
 ['python套接字','/usr/bin/python3 -c '+q('import socket; s=socket.socket();s.settimeout(3);s.connect(("192.0.2.1",443))')+' > /dev/null'],
 ['node套接字',q(process.execPath)+' -e '+q('const s=require("net").connect(443,"192.0.2.1");s.on("error",e=>{console.error(e);process.exit(1)});s.setTimeout(3000,()=>process.exit(2))')+' > /dev/null']
])test('真沙箱阻断实际connect '+label,()=>{if(label==='curl指定地址'){const r=run(command);assert.equal(r.status,7);assert.match(r.stderr,/connect/i);}else denied(command);});
test('凭据文件名即使在own也不能读写',()=>{fs.writeFileSync(own+'/auth.json','fixture');denied('cat auth.json > /dev/null');denied('echo x > auth.json');});

test('凭据文件名大小写也不漏过',()=>{fs.writeFileSync(own+'/AUTH.JSON','fixture');denied('cat AUTH.JSON > /dev/null');fs.writeFileSync(own+'/.hub-opencode-key-fake','fixture');denied('cat .hub-opencode-key-fake > /dev/null');});

test('脚本不能改own根指令文件，但能读',()=>{fs.writeFileSync(own+'/AGENTS.md','fixture\n');assert.equal(run('cat AGENTS.md > /dev/null').status,0);denied('echo overwritten > AGENTS.md');assert.equal(fs.readFileSync(own+'/AGENTS.md','utf8'),'fixture\n');});
test('宽readable也不能重新放开dev-home前缀和秘密根',()=>{fs.mkdirSync(home+'/work/dev-home-example',{recursive:true});fs.writeFileSync(home+'/work/dev-home-example/plain.txt','fixture');denied('cat '+q(home+'/work/dev-home-example/plain.txt')+' > /dev/null',{readable:[home]});denied('cat '+q(home+'/.secrets/fake.txt')+' > /dev/null',{readable:[home]});});


// Pure connect probes send zero application bytes, even if the regression returns.
function socketCode(address,port){return 'import socket; s=socket.socket(socket.AF_INET6 if ":" in '+JSON.stringify(address)+' else socket.AF_INET); s.settimeout(2); s.connect(('+JSON.stringify(address)+','+port+')); s.close()';}
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function tcpBoundary(address,connectAddress=address){
 let accepted=0,bytes=0;
 const server=net.createServer(socket=>{accepted++;socket.on('data',chunk=>bytes+=chunk.length);socket.end();});
 server.listen(0,address);await once(server,'listening');
 try{
  const port=server.address().port,code=socketCode(connectAddress,port);
  const control=spawnSync('/usr/bin/python3',['-c',code],{encoding:'utf8',timeout:4000});assert.ifError(control.error);assert.equal(control.status,0,control.stderr);await pause();assert.equal(accepted,1);
  for(const network of [false,true])denied('/usr/bin/python3 -c '+q(code),{network,selfAddrs:[address]});
  await pause();assert.equal(accepted,1,'沙箱探针不应到达监听器');assert.equal(bytes,0,'所有探针都只连接，不发送业务内容');
 }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
test('真实回环边界：IPv4监听器沙箱外可连，批准联网后仍EPERM',()=>tcpBoundary('127.0.0.1'));
test('真实回环边界：IPv6监听器沙箱外可连，批准联网后仍EPERM',()=>tcpBoundary('::1'));
test('真实回环边界：IPv4映射IPv6不能绕过',()=>tcpBoundary('127.0.0.1','::ffff:127.0.0.1'));
test('真实回环边界：未指定地址不能绕过',()=>tcpBoundary('127.0.0.1','0.0.0.0'));
test('真实本机非回环地址：调用方传入selfAddrs仍全部阻断',async()=>{
 // Prefer point-to-point IPv4 interfaces for the no-env path; VM bridge
 // interface addresses may bind but cannot be connected to on this macOS.
 const interfaces=Object.values(os.networkInterfaces()).flat().filter(x=>x&&!x.internal&&x.family==='IPv4');
 const pointToPoint=interfaces.filter(x=>x.netmask==='255.255.255.255');
 const selfAddrs=process.env.R26_SELF_ADDRS?.trim().split(/\s+/).filter(Boolean)??(pointToPoint.length?pointToPoint:interfaces).map(x=>x.address);
 assert.ok(selfAddrs.length,'需要真实本机非回环地址，不能跳过本机tailnet边界');
 for(const address of new Set(selfAddrs))await tcpBoundary(address);
});
test('真实Unix socket边界：own中无sock后缀的监听器也不可连',async()=>{
 const endpoint=own+'/.tmp/local-endpoint';let accepted=0,bytes=0;
 const server=net.createServer(socket=>{accepted++;socket.on('data',chunk=>bytes+=chunk.length);socket.end();});server.listen(endpoint);await once(server,'listening');
 try{
  const code='import socket; s=socket.socket(socket.AF_UNIX); s.settimeout(2); s.connect('+JSON.stringify(endpoint)+'); s.close()';
  const control=spawnSync('/usr/bin/python3',['-c',code],{encoding:'utf8',timeout:4000});assert.ifError(control.error);assert.equal(control.status,0,control.stderr);await pause();assert.equal(accepted,1);
  for(const network of [false,true])denied('/usr/bin/python3 -c '+q(code),{network});await pause();assert.equal(accepted,1);assert.equal(bytes,0);
 }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
test('真实Unix socket边界：批准联网也不能连var/run系统socket（DNS 的 mDNSResponder 除外）',()=>{
 const endpoint='/var/run/systemkeychaincheck.socket';assert.ok(fs.statSync(endpoint).isSocket(),'系统socket必须存在，不能用不存在路径当拒绝证据');
 const code='import socket; s=socket.socket(socket.AF_UNIX); s.settimeout(2); s.connect('+JSON.stringify(endpoint)+'); s.close()';denied('/usr/bin/python3 -c '+q(code),{network:true});
});

test('批准联网只放行 DNS socket；未批准时 DNS socket 也禁',()=>{
 const endpoint='/var/run/mDNSResponder';assert.ok(fs.statSync(endpoint).isSocket());
 const code='import socket; s=socket.socket(socket.AF_UNIX); s.settimeout(2); s.connect('+JSON.stringify(endpoint)+'); s.close()';
 denied('/usr/bin/python3 -c '+q(code),{network:false});
});
