import fs from 'node:fs';import os from 'node:os';import {randomUUID} from 'node:crypto';
const base=os.homedir()+'/dsh-work',scratch=base+'/dev-home-r24scratch';
const log=fs.readFileSync(scratch+'/run/dsh.out','utf8'),match=log.match(/http:\/\/127\.0\.0\.1:3490\/[^\s]+/);if(!match)throw Error('隔离实例没有就绪地址');
const url=new URL(match[0]);url.pathname='/connect';url.searchParams.set('interactions','none');
const response=await fetch(url,{redirect:'manual'});const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');await response.body?.cancel();if(response.status!==302||!cookie)throw Error('隔离认证失败');
async function rpc(method,args){const rpcId=randomUUID();const r=await fetch('http://127.0.0.1:3490/api/'+method,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload:{args}})});const e=await r.json();if(!e.result?.ok)throw Error(JSON.stringify({method,error:e.result?.error}));return e.result.value;}
const created=await rpc('session/create',{request:{cwd:base+'/bots/chief',agentPreset:'hub-chief'}}),id=created.sessionId;console.log('会话',id);
await rpc('session/prompt',{request:{sessionId:id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'TOOL bot_status {}'}]}});
let records=[];for(let i=0;i<100;i++){records=(await rpc('session/events',{request:{address:{kind:'session',sessionId:id},maxMessages:200}})).records;if(records.some(r=>r.event.type==='turn/end'))break;await new Promise(r=>setTimeout(r,100));}
console.log(JSON.stringify(records.map(r=>r.event),null,2));
