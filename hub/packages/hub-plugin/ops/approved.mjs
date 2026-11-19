import fs from 'node:fs';import os from 'node:os';import {randomUUID} from 'node:crypto';
const base=os.homedir()+'/dsh-work',scratch=base+'/dev-home-r24scratch';
const log=fs.readFileSync(scratch+'/run/dsh.out','utf8'),match=log.match(/http:\/\/127\.0\.0\.1:3490\/[^\s]+/);if(!match)throw Error('隔离实例没有就绪地址');
const url=new URL(match[0]);url.pathname='/connect';url.searchParams.set('interactions','none');
const response=await fetch(url,{redirect:'manual'});const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');await response.body?.cancel();if(response.status!==302||!cookie)throw Error('隔离认证失败');
async function rpc(method,args){const rpcId=randomUUID();const r=await fetch('http://127.0.0.1:3490/api/'+method,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload:{args}})});const e=await r.json();if(!e.result?.ok)throw Error(JSON.stringify({method,error:e.result?.error}));return e.result.value;}
const target=base+'/shared/r24-a-approved-'+Date.now()+'.md',body='第24轮A：隔离假审批通过后的共享区写入证据\n';
fs.writeFileSync(scratch+'/run/bff-heartbeat.json',JSON.stringify({v:1,ts:Date.now(),pid:process.pid,dshConnected:true,answering:true,devicePresent:true}),{mode:0o600});
const created=await rpc('session/create',{request:{cwd:base+'/bots/chief',agentPreset:'hub-chief'}}),id=created.sessionId;
await rpc('session/prompt',{request:{sessionId:id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'TOOL write '+JSON.stringify({file_path:target,content:body})}]}});
let records=[];for(let i=0;i<200;i++){records=(await rpc('session/events',{request:{address:{kind:'session',sessionId:id},maxMessages:200}})).records;if(records.some(r=>r.event.type==='turn/end'))break;await new Promise(r=>setTimeout(r,50));}
const result=records.find(r=>r.event.type==='tool/result')?.event.data.message;
const approvals=records.filter(r=>['approval/asked','approval/decided'].includes(r.event.type)).map(r=>({type:r.event.type,data:r.event.data}));
const evidence={sessionId:id,fixture:'只在3490挂载的假审批',target,result,approvals,exists:fs.existsSync(target)};
fs.writeFileSync(base+'/dsh-hub/packages/hub-plugin/approved-results.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
if(!result||result.isError||!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==body)throw Error('共享区获批写入未通过');
const saved=scratch+'/run/'+target.split('/').at(-1);fs.renameSync(target,saved);console.log('获批共享写入通过；测试文件已移动保存在隔离实例run目录，未删除');
