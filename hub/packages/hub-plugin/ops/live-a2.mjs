// 全程只连隔离3490/3496；登录值来自本实例启动日志，留在内存，不输出。
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {remoteFixture} from '../test/remote-fixture.mjs';
const base=os.homedir()+'/dsh-work',scratch=base+'/dev-home-r24scratch',root=base+'/dsh-hub/packages/hub-plugin';
const heartbeat=scratch+'/run/bff-heartbeat.json';
const stamp=Date.now(),evidence=[];
const log=fs.readFileSync(scratch+'/run/dsh.out','utf8');
const match=log.match(/http:\/\/127\.0\.0\.1:3490\/[^\s]+/);if(!match)throw Error('隔离3490未就绪');
assert.doesNotMatch(fs.readFileSync(scratch+'/profiles/web/cordis.patch.yml','utf8'),/id: api-remotes\s+disabled: true/);
async function auth(mode){const url=new URL(match[0]);url.pathname='/connect';url.searchParams.set('interactions',mode);const res=await fetch(url,{redirect:'manual'});const cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');await res.body?.cancel();if(res.status!==302||!cookie)throw Error('隔离认证失败');return cookie;}
let cookie=await auth('none');
async function rpc(method,args){const rpcId=randomUUID();const res=await fetch('http://127.0.0.1:3490/api/'+method,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload:{args}})});const e=await res.json();if(!e.result?.ok)throw Error('隔离RPC失败 '+method+': '+JSON.stringify(e.result?.error));return e.result.value;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function events(id){return (await rpc('session/events',{request:{address:{kind:'session',sessionId:id},maxMessages:200}})).records.map(r=>r.event);}
async function waitFor(id,filter,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){const es=await events(id);if(filter(es))return es;await pause(50);}throw Error('隔离测试超时 '+id);}
const create=async bot=>(await rpc('session/create',{request:{cwd:base+'/bots/'+bot,agentPreset:'hub-'+bot}})).sessionId;
const prompt=(id,text)=>rpc('session/prompt',{request:{sessionId:id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text}]}});
const done=es=>es.some(e=>e.type==='turn/end');
const result=es=>es.filter(e=>e.type==='tool/result').map(e=>({error:e.data.message.isError,text:e.data.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')}));
const approvals=es=>es.filter(e=>['approval/asked','approval/decided'].includes(e.type)).map(e=>({type:e.type,data:e.data,time:e.time}));
function save(label,id,es,extra={}){const e={label,sessionId:id,standardWeb:true,results:result(es),approvals:approvals(es),...extra};evidence.push(e);fs.writeFileSync(root+'/live-results-a2.json',JSON.stringify(evidence,null,2)+'\n');console.log(label+' '+JSON.stringify(e));return e;}
function beat(patch={}){const tmp=heartbeat+'.a2.tmp';fs.writeFileSync(tmp,JSON.stringify({v:1,ts:Date.now(),pid:process.pid,dshConnected:true,answering:true,devicePresent:true,deviceLastSeen:Date.now(),...patch}),{mode:0o600});fs.renameSync(tmp,heartbeat);}
let ticking=false,fixture;
const timer=setInterval(()=>{if(ticking)beat();},3000);
try {
 if(fs.existsSync(heartbeat))fs.renameSync(heartbeat,heartbeat+'.before-a2-'+stamp);
 const missing=base+'/shared/r24-a2-missing-'+stamp+'.md',missing2=missing+'-retry';
 const id=await create('chief');await prompt(id,'TOOLSEQ '+JSON.stringify([{name:'write',args:{file_path:missing,content:'禁止落盘'}},{name:'write',args:{file_path:missing2,content:'禁止换路径'}}]));
 let es=await waitFor(id,done);let r=save('①心跳缺失立刻拒绝及同轮拒绝锁',id,es,{exists:fs.existsSync(missing),retryExists:fs.existsSync(missing2)});
 assert.equal(r.approvals.length,0);assert.equal(r.results.length,2);assert.match(r.results[0].text,/审批通道不在线/);assert.match(r.results[1].text,/刚才这件事 主人 没批准/);assert.equal(fs.existsSync(missing),false);assert.equal(fs.existsSync(missing2),false);
 beat();ticking=true;
 const stale=base+'/shared/r24-a2-stale-'+stamp+'.md';const waitId=await create('chief');await prompt(waitId,'TOOL write '+JSON.stringify({file_path:stale,content:'等待中断线不得写入'}));
 await waitFor(waitId,es=>es.some(e=>e.type==='approval/asked'));
 ticking=false;const expiredAt=Date.now();beat({ts:Date.now()-16000});
 es=await waitFor(waitId,es=>es.some(e=>e.type==='approval/decided'),5000);const rejectionMs=Date.now()-expiredAt;
 es=await waitFor(waitId,done);r=save('②等待中心跳过期数秒内拒绝',waitId,es,{rejectionMs,exists:fs.existsSync(stale)});
 assert.equal(r.approvals.find(e=>e.type==='approval/decided').data.outcome,'rejected');assert.ok(rejectionMs<4500);assert.equal(fs.existsSync(stale),false);assert.match(r.results[0].text,/审批通道不在线/);
 beat();ticking=true;cookie=await auth('answer');
 fixture=await remoteFixture(cookie,rpc,async frame=>{
  const data=JSON.parse(frame.request.reason.slice(13));
  // 旧过期请求也故意批准，用于证明迟到批准不能恢复写入。
  return data.path.includes('r24-a2-rejected-')?'rejected':'allowed-once';
 });
 const approved=base+'/shared/r24-a2-approved-'+stamp+'.md',content='A2：标准Web+假远端应答者批准，真实模型调用0。\n';
 const approvedId=await create('chief');await prompt(approvedId,'TOOL write '+JSON.stringify({file_path:approved,content}));es=await waitFor(approvedId,done);r=save('③心跳正常远端明确批准并落盘',approvedId,es,{exists:fs.existsSync(approved)});
 assert.equal(r.approvals.find(e=>e.type==='approval/decided').data.outcome,'allowed-once');assert.equal(r.results[0].error,false);assert.equal(fs.readFileSync(approved,'utf8'),content);fs.renameSync(approved,scratch+'/run/'+approved.split('/').at(-1));
 assert.equal(fs.existsSync(stale),false);
 const rejected=base+'/shared/r24-a2-rejected-'+stamp+'.md',rejectId=await create('chief');await prompt(rejectId,'TOOL write '+JSON.stringify({file_path:rejected,content:'拒绝不得写入'}));es=await waitFor(rejectId,done);r=save('④心跳正常远端拒绝无文件',rejectId,es,{exists:fs.existsSync(rejected),staleStillAbsent:!fs.existsSync(stale)});
 assert.equal(r.approvals.find(e=>e.type==='approval/decided').data.outcome,'rejected');assert.equal(r.results[0].error,true);assert.equal(fs.existsSync(rejected),false);
 const agents=base+'/bots/chief/AGENTS.md',original=fs.readFileSync(agents,'utf8'),hash=x=>createHash('sha256').update(x).digest('hex'),before=hash(original);
 const protectedId=await create('chief');await prompt(protectedId,'TOOLS '+JSON.stringify([{name:'write',args:{file_path:agents,content:original}},{name:'edit',args:{file_path:agents,old_string:original,new_string:original}}]));es=await waitFor(protectedId,done);r=save('⑤own根AGENTS.md写与编辑L4，原文未变',protectedId,es,{before,after:hash(fs.readFileSync(agents)),unchanged:before===hash(fs.readFileSync(agents))});
 assert.equal(r.results.length,2);for(const t of r.results){assert.equal(t.error,true);assert.match(t.text,/AGENTS.md 不可写或编辑/);}assert.equal(r.unchanged,true);assert.equal(r.approvals.length,0);
 const stepsId=await create('pm'),sequence=Array.from({length:12},(_,i)=>({name:'list_files',args:{path:base+'/bots/pm'+'/'.repeat(i+1)}}));
 const beforeCalls=await (await fetch('http://127.0.0.1:3496/__stats')).json();
 await prompt(stepsId,'【首席派来的活 · 工单 T-20261117-181500-a200】\nTOOLSEQ '+JSON.stringify(sequence));es=await waitFor(stepsId,done);
 const afterCalls=await (await fetch('http://127.0.0.1:3496/__stats')).json();
 r=save('⑥派活会话第9步前自动停',stepsId,es,{stepStarts:es.filter(e=>e.type==='step/start').map(e=>e.data.step),notices:es.filter(e=>e.type==='hub-plugin/notice'),fakeCalls:afterCalls.toolRequests-beforeCalls.toolRequests,totalFakeCallsIncludingTitle:afterCalls.requests-beforeCalls.requests,turnEnd:es.find(e=>e.type==='turn/end')?.data});
 assert.equal(r.fakeCalls,8);assert.equal(r.results.length,8);assert.deepEqual(r.stepStarts,[1,2,3,4,5,6,7,8]);assert.match(r.notices[0].data.text,/超过 8 步自动停/);
 save('⑦瀑布转发及迟到批准证据',waitId,await events(waitId),{forwardedApprovals:fixture.frames.filter(f=>f.type==='waterfall'&&f.event==='approval/request').map(f=>({eventId:f.eventId,path:JSON.parse(f.request.reason.slice(13)).path})),lateFileExists:fs.existsSync(stale)});
 assert.equal(fs.existsSync(stale),false);
 // 回收插件无法独立撤销的旧Gateway pending，不改变已完成的拒绝结果。
 await rpc('session/cancel',{request:{sessionId:waitId}});
 console.log('A2标准Web核验全部通过；真实模型调用=0。');
} finally {
 clearInterval(timer);fixture?.close();beat({answering:false,devicePresent:false});
}
