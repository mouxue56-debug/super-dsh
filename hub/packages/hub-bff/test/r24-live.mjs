// 只连接工单 A 的隔离假模型 3490。不得指向 3390/3290/主线。
import { readFile,writeFile,mkdir,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { DshClient } from '../lib/dsh-client.mjs';
import { startServer } from '../server.mjs';
const base=join(homedir(),'dsh-work'),run=new URL('../run-r24test/',import.meta.url).pathname;
await mkdir(run,{recursive:true,mode:0o700});
const tag=Date.now().toString(), prefix=join(run,'live-'+tag);await mkdir(prefix,{mode:0o700});
const testCredential='synthetic-r24-fake-only';
const keyFile=join(prefix,'access'),dummy=join(prefix,'synthetic-auth');
await writeFile(keyFile,testCredential,{mode:0o600});await writeFile(dummy,'synthetic-transport-placeholder',{mode:0o600});
// 隔离实例自己生成的本地认证地址只在进程内使用，不输出、不复制凭据文件。
const dshLog=await readFile(join(base,'dev-home-r24scratch/run/dsh.out'),'utf8');
const match=dshLog.match(/http:\/\/127\.0\.0\.1:3490\/[^\s]+/u);if(!match)throw Error('3490 没有就绪地址');
const auth=new URL(match[0]);auth.pathname='/connect';auth.searchParams.set('interactions','answer');
const client=new DshClient({url:'http://127.0.0.1:3490',tokenFile:dummy,fetchImpl:(url,options)=>fetch(new URL(url).pathname==='/connect'?auth:url,options)});
const app=await startServer({port:3491,keyFile,client,storeFile:join(prefix,'store.json'),callLogFile:join(prefix,'calls.log'),configDir:join(prefix,'config'),ticketsDir:join(prefix,'tickets'),requireBot:true});
const checks=[];
async function save(){await writeFile(join(run,'live-result.json'),JSON.stringify({checks,artifacts:prefix,realModelCalls:0},null,2)+'\n',{mode:0o600});}
async function api(method,path,value) {
 const r=await fetch('http://127.0.0.1:3491/bff'+path,{method,headers:{'x-hub-bff-key':testCredential,'x-hub-device':'r24-B-live','content-type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
 const data=await r.json();if(!r.ok)throw Error('BFF '+r.status+' '+JSON.stringify(data));return data;
}
try {
 let model;for(let attempt=0;attempt<20;attempt++){try{model=await client.modelCatalog();break;}catch(error){if(attempt===19)throw error;await delay(150);}}assert.equal(model.default.provider,'hub-fake-r24');assert.equal(model.default.model,'echo-1');checks.push('模型目录确认为隔离 hub-fake-r24/echo-1');
 for(const decision of ['approve','reject']) {
  const row=await api('POST','/sessions',{bot:'chief',title:'R24 BFF 假审批 '+decision});
  const path=join(base,'shared','r24-bff-'+tag+'-'+decision+'.md');
  await api('POST','/sessions/'+row.id+'/messages',{text:'TOOL write '+JSON.stringify({file_path:path,content:'R24 BFF 隔离假模型 '+decision}),idem:'r24-'+decision});
  let card;
  for(let i=0;i<150;i++) { card=(await api('GET','/approvals')).approvals.find(c=>c.sessionId===row.id);if(card)break;await delay(100); }
  if(!card) {
   const all=await api('GET','/sessions/'+row.id+'/cards');
   const events=await client.rpc('session/events',{request:{address:{kind:'session',sessionId:row.id},maxMessages:200}});
   throw Error('没有待批卡 '+JSON.stringify({cards:all.cards,eventTypes:events.records.map(r=>r.event.type),failures:events.records.filter(r=>['approval/asked','approval/decided','turn/end','tool/result'].includes(r.event.type)).map(r=>({type:r.event.type,data:r.event.data}))}));
  }
  assert.equal(card.bot,'chief');assert.equal(card.path,path);
  const answer=await api('POST','/approvals/'+card.id+'/answer',{decision});assert.equal(answer.card.status,decision==='approve'?'approved':'rejected');
  let records=[];
  for(let i=0;i<150;i++) { records=(await client.rpc('session/events',{request:{address:{kind:'session',sessionId:row.id},maxMessages:200}})).records;if(records.some(r=>r.event.type==='turn/end'))break;await delay(100); }
  const asked=records.find(r=>r.event.type==='approval/asked')?.event.data;
  const decided=records.find(r=>r.event.type==='approval/decided')?.event.data;
  assert.equal(asked.id,card.id);assert.equal(decided.id,card.id);assert.equal(decided.outcome,decision==='approve'?'allowed-once':'rejected');
  let exists=true;try{await stat(path);}catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
  const toolError=records.find(r=>r.event.type==='tool/result'&&r.event.data?.error)?.event.data.error?.code;
  if(decision==='reject')assert.equal(exists,false);
  checks.push({decision,sessionId:row.id,approvalId:card.id,outcome:decided.outcome,fileExists:exists,path,...(toolError?{executionError:toolError}:{})});await save();
 }
 const logs=await readFile(join(prefix,'config/approvals.log'),'utf8');assert.equal(logs.trimEnd().split('\n').length,2);
 await app.close();
 const disconnected=new DshClient({url:'http://127.0.0.1:3490',tokenFile:dummy,fetchImpl:(url,options)=>fetch(new URL(url).pathname==='/connect'?auth:url,options)});
 try {
  const row=await disconnected.createSession({cwd:join(base,'bots/chief'),agentPreset:'hub-chief',title:'R24 BFF 断开失败关闭'});
  await disconnected.prompt(row.id,'TOOL write '+JSON.stringify({file_path:join(base,'shared','r24-bff-'+tag+'-disconnected.md'),content:'不应执行'}));
  let records=[];
  for(let i=0;i<100;i++){records=(await disconnected.rpc('session/events',{request:{address:{kind:'session',sessionId:row.id},maxMessages:200}})).records;if(records.some(r=>r.event.type==='turn/end'))break;await delay(100);}
  const decided=records.find(r=>r.event.type==='approval/decided')?.event.data;
  if(!decided){checks.push({case:'BFF 断开，无应答者',sessionId:row.id,outcome:'未观测到 approval/decided',eventTypes:records.map(r=>r.event.type),toolErrors:records.filter(r=>r.event.type==='tool/result').map(r=>r.event.data.error?.code ?? r.event.data.message?.content?.filter(p=>p.type==='text').map(p=>p.text).join(''))});await disconnected.cancel(row.id);}
  else checks.push({case:'BFF 断开，无应答者',sessionId:row.id,outcome:decided.outcome});
 } finally {disconnected.dispose();}
 const result={checks,artifacts:prefix,realModelCalls:0};await writeFile(join(run,'live-result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));
} finally {await app.close();}
