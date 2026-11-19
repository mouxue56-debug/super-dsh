import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
const config=JSON.parse(fs.readFileSync(new URL('./r26-test-config.json',import.meta.url),'utf8'));
export const scratch=process.env.HUB_SCRATCH??path.join(process.env.HUB_HOME??path.join(os.homedir(),'dsh-work'),'tmp/r26-B/runtime');
export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function connect(){
 let match;for(let i=0;i<100;i++){try{const log=fs.readFileSync(scratch+'/run/dsh.out','utf8');match=log.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s]+/);}catch{}if(match)break;await pause(100);}
 if(!match)throw Error('隔离实例没有就绪地址');
 const url=new URL(match[0]);if(url.hostname!=='127.0.0.1'||+url.port!==config.dshPort)throw Error('只许连接配置中的隔离端口');
 const origin=url.origin;url.pathname='/connect';url.searchParams.set('interactions','answer');
 const response=await fetch(url,{redirect:'manual'});const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');await response.body?.cancel();
 if(response.status!==302||!cookie)throw Error('隔离认证失败');
 async function rpc(method,args){const e=await(await fetch(origin+'/api/'+method,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:randomUUID(),method,payload:{args}})})).json();if(!e.result?.ok)throw Error(JSON.stringify({method,error:e.result?.error}));return e.result.value;}
 const events=async id=>(await rpc('session/events',{request:{address:{kind:'session',sessionId:id},maxMessages:300}})).records.map(r=>r.event);
 async function start(text,preset,cwd){const id=(await rpc('session/create',{request:{cwd,agentPreset:preset}})).sessionId;await rpc('session/prompt',{request:{sessionId:id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text}]}});return id;}
 async function done(id,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){const es=await events(id);if(es.some(e=>e.type==='turn/end'))return es;await pause(100);}throw Error('隔离会话超时 '+id);}
 return {cookie,rpc,events,start,done,origin};
}
