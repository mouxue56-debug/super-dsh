// 仅本轮隔离假模型联调，不连接真实模型，不打印认证信息。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {connect,scratch} from './r26-client.mjs';
import {loadHubConfig} from '../hub-config.mjs';
import {remoteFixture} from '../test/remote-fixture.mjs';
const c=await connect(),config=JSON.parse(fs.readFileSync(new URL('./r26-test-config.json',import.meta.url),'utf8'));
const install=loadHubConfig({hubHome:scratch+'/hub'}),bot=install.chief,own=install.hubHome+'/bots/'+bot;
const evidence=[],cards=[],out=scratch+'/run/live-results-r26'+(process.env.R26_EXTRA_TOOL==='1'?'-extra':'')+'.json';
const healthy=()=>fs.writeFileSync(install.heartbeat,JSON.stringify({v:1,ts:Date.now(),dshConnected:true,answering:true}),{mode:0o600});healthy();const timer=setInterval(healthy,2000);
let fixture;
function save(label,id,es,extra={}){
 const r={label,sessionId:id,results:es.filter(e=>e.type==='tool/result').map(e=>({error:e.data.message.isError,text:e.data.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')})),approvals:es.filter(e=>['approval/asked','approval/decided'].includes(e.type)).map(e=>({type:e.type,data:e.data})),end:es.find(e=>e.type==='turn/end')?.data.reason,...extra};
 evidence.push(r);fs.writeFileSync(out,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({label,sessionId:id,results:r.results.map(x=>({error:x.error,text:x.text.slice(0,250),bytes:Buffer.byteLength(x.text)})),approvals:r.approvals.length,...extra}));return r;
}
async function call(command,why='本轮隔离测试',extra={},timeout=25000){const id=await c.start('TOOL bash '+JSON.stringify({description:why,command,...extra}),'hub-'+bot,own),es=await c.done(id,timeout);return {id,es};}
try{
 fixture=await remoteFixture(c.cookie,c.rpc,async frame=>{
  const p=JSON.parse(frame.request.reason.slice(13));assert.equal(p.bot,bot);assert.equal(p.tool,'bash');assert.equal(p.cwd,own);cards.push(p);
  return p.why==='本轮拒绝测试'?'rejected':'allowed-once';
 });
 if(process.env.R26_EXTRA_TOOL==='1'){
  const id=await c.start('TOOLS '+JSON.stringify([{name:'read',args:{file_path:own+'/inventory-check.txt'}},{name:'bash',args:{description:'不应执行',command:'ls'}}]),'hub-'+bot,own),es=await c.done(id);const r=save('额外工具触发全部拒绝',id,es);assert.equal(r.results.length,2);for(const t of r.results)assert.match(t.text,/工具清单和权限表对不上/);assert.match(fs.readFileSync(install.hubHome+'/config/alerts.log','utf8'),/r26_unregistered/);
 }else{
  for(const idBot of install.bots){const id=await c.start('TOOL bash '+JSON.stringify({description:'列出自己的目录',command:'ls'}),'hub-'+idBot,install.hubHome+'/bots/'+idBot),es=await c.done(id),r=save('六预设run '+idBot,id,es);assert.equal(r.results[0].error,false);assert.match(r.results[0].text,/L1 已记录/);}
  const control=await c.start('不用工具',''+config.controlPreset,scratch),ces=await c.done(control);save('其他预设无bash',control,ces);
  const probes=fs.readFileSync(scratch+'/run/probe.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.ok(probes.filter(p=>p.preset===config.controlPreset).every(p=>!p.tools.includes('bash')));
  let t=await call('sleep 0','本轮批准测试'),r=save('ask批准后跑',t.id,t.es);assert.equal(r.results[0].error,false);assert.match(r.results[0].text,/主人 已在手机上批准，已跑/);assert.equal(r.approvals.length,2);
  const rejectedFile=own+'/must-not-exist-'+Date.now()+'.txt';t=await call('touch '+JSON.stringify(rejectedFile),'本轮拒绝测试');r=save('ask拒绝后不跑',t.id,t.es,{fileExists:fs.existsSync(rejectedFile)});assert.equal(r.results[0].error,true);assert.equal(fs.existsSync(rejectedFile),false);
  t=await call('sudo true');r=save('deny不发卡',t.id,t.es);assert.equal(r.results[0].error,true);assert.equal(r.approvals.length,0);
  t=await call('ls','参数拒绝',{sandbox_permissions:'workspace-write'});r=save('sandbox_permissions问前拒绝',t.id,t.es);assert.match(r.results[0].text,/跑命令不要带/);assert.equal(r.approvals.length,0);
  t=await call('seq 1 100000','本轮大输出测试',{},45000);r=save('大输出前4KB与全文',t.id,t.es);assert.match(r.results[0].text,/只显示前 4KB/);const output=r.results[0].text.match(/全文在 (bots\/[^）]+)/)[1],file=path.join(install.hubHome,output);const full=fs.readFileSync(file,'utf8');assert.match(full,/^1\n2\n3\n/);assert.match(full,/99999\n100000/);assert.equal(fs.statSync(file).mode&0o777,0o600);r.output={path:output,bytes:Buffer.byteLength(full),mode:'0600'};fs.writeFileSync(out,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  // 只读取变量名，绝不读取或输出变量值。
  fs.writeFileSync(own+'/env-names.py',"import os\nprint('ENV_KEY_CHECK_OK')\nprint('\\n'.join(sorted(k for k in os.environ if any(t in k for t in ['KEY','PASSWORD','SECRET','TOKEN']))))\n",{mode:0o600});
  t=await call('python3 env-names.py','只看环境变量名');r=save('子进程密钥变量名被剔除',t.id,t.es);assert.match(r.results[0].text,/ENV_KEY_CHECK_OK/);assert.doesNotMatch(r.results[0].text,/HUB_FAKE_KEY|HUB_OPENCODE_KEY/);
  const start=Date.now();t=await call('sleep 70','本轮超时测试',{},90000);r=save('sleep70缺省60秒停止',t.id,t.es,{elapsedMs:Date.now()-start});assert.match(r.results[0].text,/timed out after/);assert.match(r.results[0].text,/超过时限被停了/);assert.ok(Date.now()-start>=59000&&Date.now()-start<80000);
  fs.writeFileSync(scratch+'/run/cards-r26.json',JSON.stringify(cards,null,2)+'\n',{mode:0o600});
 }
 console.log('隔离实测完成；真实模型调用=0；结果='+out);
}finally{clearInterval(timer);fixture?.close();fs.writeFileSync(install.heartbeat,JSON.stringify({v:1,ts:Date.now(),dshConnected:true,answering:false}),{mode:0o600});}
