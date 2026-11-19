// G2隔离核验：只连3490/3496，认证值只在内存使用，不打印、不读密钥文件。
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {remoteFixture} from '../test/remote-fixture.mjs';
const base=os.homedir()+'/dsh-work',scratch=base+'/dev-home-r24scratch',run=scratch+'/run';
const heartbeat=run+'/bff-heartbeat.json',stamp=Date.now(),prefix='r24-g2-'+stamp;
const evidence=[],targets=new Set(),seen=[],parameterReason='写文件不要带 justification 或 sandbox_permissions 参数，去掉后直接重试';
const log=fs.readFileSync(run+'/dsh.out','utf8'),match=log.match(/http:\/\/127\.0\.0\.1:3490\/[^\s]+/);
assert.ok(match,'隔离3490必须已就绪');
const patch=fs.readFileSync(scratch+'/profiles/web/cordis.patch.yml','utf8');
assert.doesNotMatch(patch,/id: api-remotes\s+disabled: true/);
assert.doesNotMatch(patch,/test-approval-r24/);
const fake=fs.readFileSync(scratch+'/fake.patch.yml','utf8');assert.match(fake,/baseURL: http:\/\/127\.0\.0\.1:3496\/v1/);
async function auth(){const url=new URL(match[0]);url.pathname='/connect';url.searchParams.set('interactions','answer');const res=await fetch(url,{redirect:'manual'});const cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');await res.body?.cancel();assert.equal(res.status,302);assert.ok(cookie);return cookie;}
const cookie=await auth();
async function rpc(method,args){const res=await fetch('http://127.0.0.1:3490/api/'+method,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method,payload:{args}})});const e=await res.json();assert.ok(e.result?.ok,'隔离RPC失败 '+method);return e.result.value;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const events=async id=>(await rpc('session/events',{request:{address:{kind:'session',sessionId:id},maxMessages:200}})).records.map(r=>r.event);
async function done(id){const start=Date.now();while(Date.now()-start<20000){const es=await events(id);if(es.some(e=>e.type==='turn/end'))return es;await pause(60);}throw Error('隔离会话超时 '+id);}
async function sequence(calls){const id=(await rpc('session/create',{request:{cwd:base+'/bots/chief',agentPreset:'hub-chief'}})).sessionId;await rpc('session/prompt',{request:{sessionId:id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'TOOLSEQ '+JSON.stringify(calls)}]}});return {id,es:await done(id)};}
function save(label,id,es,extra={}){const entry={label,sessionId:id,standardWeb:true,results:es.filter(e=>e.type==='tool/result').map(e=>({error:e.data.message.isError,text:e.data.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')})),approvals:es.filter(e=>['approval/asked','approval/decided'].includes(e.type)).map(e=>({type:e.type,data:e.data})),...extra};evidence.push(entry);fs.writeFileSync(run+'/live-results-g2.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(label+' '+JSON.stringify(entry));return entry;}
function beat(extra={}){fs.writeFileSync(heartbeat+'.g2.tmp',JSON.stringify({v:1,ts:Date.now(),dshConnected:true,answering:true,devicePresent:false,...extra}),{mode:0o600});fs.renameSync(heartbeat+'.g2.tmp',heartbeat);}
if(fs.existsSync(heartbeat))fs.renameSync(heartbeat,heartbeat+'.before-g2-'+stamp);
beat();const timer=setInterval(()=>beat(),3000);let fixture;
try{
 fixture=await remoteFixture(cookie,rpc,async frame=>{const p=JSON.parse(frame.request.reason.slice(13));assert.ok(targets.has(p.path),'只允许本次隔离目标');seen.push(p.path);return p.path.includes('-rejected-')?'rejected':'allowed-once';});
 for(const tool of ['write','edit'])for(const area of ['own','shared'])for(const field of ['justification','sandbox_permissions']){
  const file=base+(area==='own'?'/bots/chief/':'/shared/')+prefix+'-'+tool+'-'+area+'-'+field+'.md';targets.add(file);
  if(tool==='edit')fs.writeFileSync(file,'初始内容',{mode:0o600});
  const clean={file_path:file,...(tool==='write'?{content:'修正参数后成功'}:{old_string:'初始内容',new_string:'修正参数后成功'})};
  const {id,es}=await sequence([{name:tool,args:{...clean,[field]:field==='justification'?'隔离测试':'workspace-write'}},{name:tool,args:clean}]);
  const r=save('参数拦截及同轮重试 '+tool+'/'+area+'/'+field,id,es,{content:fs.readFileSync(file,'utf8')});
  assert.equal(r.results.length,2);assert.equal(r.results[0].error,true);assert.ok(r.results[0].text.includes(parameterReason));assert.equal(r.results[1].error,false);assert.doesNotMatch(r.results[1].text,/刚才这件事/);assert.equal(r.content,'修正参数后成功');
  assert.equal(r.approvals.filter(e=>e.type==='approval/asked').length,area==='shared'?1:0);assert.deepEqual(r.approvals.filter(e=>e.type==='approval/decided').map(e=>e.data.outcome),area==='shared'?['allowed-once']:[]);
  fs.renameSync(file,run+'/'+file.split('/').at(-1));
 }
 const editFile=base+'/shared/'+prefix+'-edit-failure.md';targets.add(editFile);fs.writeFileSync(editFile,'初始内容',{mode:0o600});
 let {id,es}=await sequence([{name:'edit',args:{file_path:editFile,old_string:'不存在的原文',new_string:'不应成功'}},{name:'edit',args:{file_path:editFile,old_string:'初始内容',new_string:'批准后重试成功'}}]);
 let r=save('批准后edit执行失败，同轮重新审批成功',id,es,{content:fs.readFileSync(editFile,'utf8')});
 assert.equal(r.results.length,2);assert.equal(r.results[0].error,true);assert.match(r.results[0].text,/（主人 已批准，但写入没成功：[^\n]+）$/);assert.doesNotMatch(r.results[0].text,/刚才这件事/);assert.equal(r.results[1].error,false);assert.deepEqual(r.approvals.filter(e=>e.type==='approval/decided').map(e=>e.data.outcome),['allowed-once','allowed-once']);assert.equal(r.content,'批准后重试成功');fs.renameSync(editFile,run+'/'+editFile.split('/').at(-1));
 const dir=base+'/shared/'+prefix+'-write-directory',child=dir+'/retry.md';targets.add(dir);targets.add(child);fs.mkdirSync(dir,{mode:0o700});
 ({id,es}=await sequence([{name:'write',args:{file_path:dir,content:'目录不是文件'}},{name:'write',args:{file_path:child,content:'批准后重试成功'}}]));
 r=save('批准后write执行失败，同轮换文件重新审批成功',id,es,{content:fs.readFileSync(child,'utf8')});
 assert.equal(r.results[0].error,true);assert.match(r.results[0].text,/（主人 已批准，但写入没成功：[^\n]+）$/);assert.equal(r.results[1].error,false);assert.deepEqual(r.approvals.filter(e=>e.type==='approval/decided').map(e=>e.data.outcome),['allowed-once','allowed-once']);fs.renameSync(dir,run+'/'+dir.split('/').at(-1));
 const rejected=base+'/shared/'+prefix+'-rejected-first.md',retry=base+'/shared/'+prefix+'-after-rejection.md';targets.add(rejected);targets.add(retry);
 ({id,es}=await sequence([{name:'write',args:{file_path:rejected,content:'必须拒绝'}},{name:'write',args:{file_path:retry,content:'不能换路径重试'}}]));
 r=save('真正拒绝后仍跨路径上锁',id,es,{exists:fs.existsSync(rejected),retryExists:fs.existsSync(retry)});
 assert.deepEqual(r.approvals.filter(e=>e.type==='approval/decided').map(e=>e.data.outcome),['rejected']);assert.equal(r.results[0].error,true);assert.match(r.results[1].text,/刚才这件事 主人 没批准/);assert.equal(r.exists,false);assert.equal(r.retryExists,false);
 console.log('G2标准Web隔离核验11组全部通过；远端审批请求='+seen.length+'；真实模型调用=0。');
}finally{clearInterval(timer);fixture?.close();beat({answering:false,devicePresent:false});}
