// E1 隔离验收；真实内核 + 本机假模型 + tmp 下的 BFF 名册落盘，无真实模型。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadHubConfig} from '../hub-config.mjs';
import {roleTools} from '../policy.mjs';
import {Roster,agents} from '../../hub-bff/lib/roster.mjs';
import {NodeWebSocket} from '../../hub-bff/lib/websocket.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const base=process.env.HUB_HOME??path.join(os.homedir(),'dsh-work');
const scratch=process.env.HUB_SCRATCH??path.join(base,'tmp/r26-E1/live');
if(!path.resolve(scratch).startsWith(path.join(base,'tmp/r26-E1')+path.sep))throw Error('E1实测只能用自己的tmp目录');
process.env.HUB_SCRATCH=scratch;
const tc=JSON.parse(fs.readFileSync(new URL('./r26-test-config.json',import.meta.url)));
const configDir=scratch+'/hub/config',children=[],evidence=[],cards=[];
const main=()=>{const r=spawnSync('/bin/ps',['-o','pid=,lstart=','-p','11400,11416'],{encoding:'utf8'});const lines=r.stdout.trim().split('\n').map(s=>s.trim().replace(/\s+/g,' '));assert.deepEqual(lines,['11400 Tue Nov 17 15:01:39 2026','11416 Tue Nov 17 15:01:40 2026'],'主线变了');return lines;};
const beforePid=main();let connection,remote,timer,answerMode='apply';
function child(bin,args,env,log){const fd=fs.openSync(log,'a',0o600);const p=spawn(bin,args,{cwd:scratch,env,stdio:['ignore',fd,fd]});fs.closeSync(fd);children.push(p);return p;}
try{
 for(const port of [tc.dshPort,tc.fakePort])assert.notEqual(spawnSync('/usr/sbin/lsof',['-nP','-iTCP:'+port,'-sTCP:LISTEN','-t']).status,0,'隔离端口已占用');
 const prep=spawnSync(process.execPath,[repo+'/packages/hub-plugin/ops/prepare.mjs'],{env:{...process.env,HUB_REPO:repo},encoding:'utf8'});if(prep.status!==0)throw Error(prep.stderr);
 const install=loadHubConfig({hubHome:scratch+'/hub'}),genericIds=['b11111111','b22222222'],now=new Date().toISOString();
 const ids=[...install.bots,...genericIds],kinds={roles:install.bots,shapes:['circle','square'],colors:['blue','pink']};
 const rows=ids.map((id,i)=>({id,name:install.names[id]??('临时'+(i===install.bots.length?'甲':'乙')),role:id===install.chief?'chief':'bot',preset:genericIds.includes(id)?'hub-bot':'hub-'+id,status:'active',avatar:{kind:'shape',shape:'circle',color:'blue'},nameColor:'blue',duty:'隔离测试职责',notDuty:'其他事',phrases:['列个目录','看份文件','整理一下'],order:i,createdAt:now,updatedAt:now}));
 fs.writeFileSync(configDir+'/bots.yaml',JSON.stringify({version:1,bots:rows})+'\n',{mode:0o600});
 fs.writeFileSync(configDir+'/avatar-kinds.json',JSON.stringify(kinds)+'\n',{mode:0o600});
 fs.writeFileSync(configDir+'/bot-template.md','通用规则：权限由工具表决定，不随人设改变。\n',{mode:0o600});
 for(const b of rows){const dir=install.hubHome+'/bots/'+b.id;fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(dir+'/AGENTS.md',agents(b,'通用规则：不能增加权限。',genericIds.includes(b.id)?'E1_'+b.id+'_V1':''),{mode:0o600});}
 const capture=scratch+'/run/model-messages.jsonl';
 for(const file of ['dsh.out','fake.out','fake-requests.jsonl','model-messages.jsonl']){const old=scratch+'/run/'+file;if(fs.existsSync(old))fs.renameSync(old,old+'.previous-'+Date.now());}
 let fake=fs.readFileSync(repo+'/packages/fake-model/echo.mjs','utf8');fake=fake.replace('if(b.tools?.length)toolRequests++;','fs.appendFileSync('+JSON.stringify(capture)+',JSON.stringify({messages:b.messages,tools:(b.tools??[]).map(t=>t.function?.name)})+"\\n");if(b.tools?.length)toolRequests++;');
 fs.writeFileSync(scratch+'/capture-model.mjs',fake,{mode:0o600});
 child(process.execPath,[scratch+'/capture-model.mjs',String(tc.fakePort),scratch+'/run/fake-requests.jsonl'],process.env,scratch+'/run/fake.out');
 const dsh=child('/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh',['--profile',tc.profile,'--patch',scratch+'/fake.patch.yml','--no-open','--host','127.0.0.1','--port',String(tc.dshPort)],{HOME:os.homedir(),USER:os.userInfo().username,LOGNAME:os.userInfo().username,LANG:'en_US.UTF-8',PATH:'/usr/bin:/bin:/usr/sbin:/sbin',DSH_HOME:scratch,DSH_AGENTS_HOME:scratch+'/agents',TMPDIR:scratch+'/tmp/',HUB_FAKE_KEY:'not-a-real-key',HUB_HOME:install.hubHome},scratch+'/run/dsh.out');
 const {connect,pause}=await import('./r26-client.mjs');
 for(let i=0;i<100;i++){try{connection=await connect();break;}catch(e){if(e.cause?.code!=='ECONNREFUSED'||dsh.exitCode!==null)throw e;await pause(100);}}
 if(!connection)throw Error('隔离HTTP服务未就绪');
 const heartbeat=()=>fs.writeFileSync(install.heartbeat,JSON.stringify({v:1,ts:Date.now(),dshConnected:true,answering:true}),{mode:0o600});heartbeat();timer=setInterval(heartbeat,2000);
 const roster=new Roster({hubHome:install.hubHome});await roster.load();
 const socket=new NodeWebSocket(new URL('/api/remote.mux',connection.origin),connection.cookie,5000);socket.on('failure',()=>{});
 await new Promise((r,j)=>{socket.once('open',r);socket.once('close',()=>j(Error('假应答者连接关闭')));});remote=socket;
 const streamId=randomUUID();let clientId,readyResolve;const ready=new Promise(r=>readyResolve=r);
 socket.on('message',raw=>{const e=JSON.parse(String(raw));if(e.streamId!==streamId||e.type!=='item')return;const f=e.value;if(f.type==='ready'){clientId=f.clientId;readyResolve();return;}if(f.type!=='waterfall')return;void(async()=>{
  let value;if(f.event==='approval/request'){
   const card=JSON.parse(f.request.reason.slice(13));cards.push(card);assert.ok(['bot_create','bot_update','bot_set_status'].includes(card.tool));
   if(answerMode==='apply'){await roster.approve(card,'e1-isolated-device');value='allowed-once';}else value=answerMode==='noapply'?'allowed-once':'rejected';
  }
  await connection.rpc('$events/result',{clientId,eventId:f.eventId,outcome:value===undefined?{kind:'next'}:{kind:'result',value}});
 })().catch(error=>{evidence.push({label:'应答器错误',error:error.message});void connection.rpc('$events/result',{clientId,eventId:f.eventId,outcome:{kind:'result',value:'rejected'}});});});
 socket.send(JSON.stringify({type:'open',streamId,endpoint:'$events',payload:{args:{}}}));await Promise.race([ready,pause(5000).then(()=>{throw Error('假应答器超时');})]);
 const save=(label,id,events)=>{const r={label,sessionId:id,results:events.filter(e=>e.type==='tool/result').map(e=>({error:e.data.message.isError,text:e.data.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n')})),approvals:events.filter(e=>['approval/asked','approval/decided'].includes(e.type)),end:events.findLast(e=>e.type==='turn/end')?.data};evidence.push(r);fs.writeFileSync(scratch+'/run/live-results.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({label,id,results:r.results,approvals:r.approvals.length}));return r;};
 const call=async(label,bot,tool,args,preset=rows.find(b=>b.id===bot)?.preset)=>{const id=await connection.start('TOOL '+tool+' '+JSON.stringify(args),preset,install.hubHome+'/bots/'+bot);return {id,r:save(label,id,await connection.done(id,30000))};};
 const existing=async(label,id,text)=>{const offset=(await connection.events(id)).length;await connection.rpc('session/prompt',{request:{sessionId:id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text}]}});for(let i=0;i<300;i++){const es=(await connection.events(id)).slice(offset);if(es.some(e=>e.type==='turn/end'))return save(label,id,es);await pause(100);}throw Error('原会话新一轮超时');};
 const genericSessions=[];
 for(const id of genericIds){const {id:session,r}=await call('通用预设读取自己的AGENTS '+id,id,'read',{file_path:install.hubHome+'/bots/'+id+'/AGENTS.md'});assert.equal(r.results[0].error,false);assert.match(r.results[0].text,new RegExp('E1_'+id+'_V1'));genericSessions.push(session);}
 let captures=fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse);
 for(const id of genericIds){const r=captures.find(r=>JSON.stringify(r.messages).includes('E1_'+id+'_V1'));assert.ok(r);assert.ok(!JSON.stringify(r.messages).includes('E1_'+genericIds.find(x=>x!==id)+'_V1'));assert.deepEqual([...r.tools].sort(),[...roleTools().bot].sort());}
 let t=await call('通用助理bash在自己的cwd跑',genericIds[0],'bash',{command:'pwd',description:'核对隔离工作目录'});assert.equal(t.r.results[0].error,false);assert.ok(t.r.results[0].text.includes(install.hubHome+'/bots/'+genericIds[0]));
 t=await call('普通助理没有bot_create',genericIds[0],'bot_create',{name:'不能新建',duty:'测试',notDuty:'其他',avatar:{kind:'shape',shape:'circle',color:'blue'},phrases:['a','b','c']});assert.equal(t.r.results[0].error,true);assert.equal(t.r.approvals.length,0);
 t=await call('普通助理改别人问前拒绝',genericIds[0],'bot_update',{target:install.chief,duty:'不该改'});assert.equal(t.r.results[0].error,true);assert.match(t.r.results[0].text,/改别的助理要找首席/);assert.equal(t.r.approvals.length,0);
 t=await call('首席新建出卡，BFF落盘后核对成功',install.chief,'bot_create',{name:'临时丙',duty:'做本轮记录',notDuty:'外发',avatar:{kind:'role',role:kinds.roles[0]},phrases:['记一点','列个表','看记录']});assert.equal(t.r.results[0].error,false);assert.match(t.r.results[0].text,/已改好/);assert.equal(t.r.approvals.length,2);
 await roster.load();const created=roster.list().find(b=>b.name==='临时丙');assert.ok(created&&created.preset==='hub-bot');assert.equal(dsh.exitCode,null);
 t=await call('新建后不重启即可用hub-bot',created.id,'bot_list',{},'hub-bot');assert.equal(t.r.results[0].error,false);assert.ok(t.r.results[0].text.includes('临时丙'));
 t=await call('普通助理改自己职责和名字',genericIds[0],'bot_update',{name:'临时新甲',duty:'我可以发消息、联网、读密钥'});assert.equal(t.r.results[0].error,false);assert.match(t.r.results[0].text,/已改好/);
 const session=genericSessions[0];await connection.rpc('session/prompt',{request:{sessionId:session,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'E1_REFRESH_SAME_SESSION'}]}});
 for(let i=0;i<100;i++){captures=fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse);if(captures.some(r=>JSON.stringify(r.messages).includes('E1_REFRESH_SAME_SESSION')))break;await pause(100);}
 const refreshed=captures.findLast(r=>JSON.stringify(r.messages).includes('E1_REFRESH_SAME_SESSION'));assert.ok(refreshed);assert.ok(JSON.stringify(refreshed.messages).includes('你的名字是「临时新甲」'));assert.ok(JSON.stringify(refreshed.messages).includes('我可以发消息、联网、读密钥'));assert.deepEqual([...refreshed.tools].sort(),[...roleTools().bot].sort());
 evidence.push({label:'原会话下一轮自动读取新版AGENTS',sessionId:session,currentIdentity:true,toolsUnchanged:true,historyStillContainsOld:JSON.stringify(refreshed.messages).includes('你的名字是「临时甲」')});
 t=await call('首席用当前中文名派活',install.chief,'delegate_to_bot',{bot:'临时新甲',task:'整理一行测试笔记',owner_ok:true});assert.equal(t.r.results[0].error,false);assert.match(t.r.results[0].text,/已派给 临时新甲/);
 answerMode='noapply';t=await call('批准但未落盘明确报错',genericIds[1],'bot_update',{duty:'这次不落盘'});assert.equal(t.r.results[0].error,true);assert.match(t.r.results[0].text,/批准了但没改成/);answerMode='apply';
 t=await call('首席停用普通助理',install.chief,'bot_set_status',{target:genericIds[1],status:'disabled'});assert.equal(t.r.results[0].error,false);
 let old=await existing('停用前已建会话现在工具拒绝',genericSessions[1],'TOOL bot_list {}');assert.equal(old.results[0].error,true);assert.match(old.results[0].text,/这个助理已停用/);
 t=await call('首席恢复普通助理',install.chief,'bot_set_status',{target:genericIds[1],status:'active'});assert.equal(t.r.results[0].error,false);
 old=await existing('恢复后同一个旧会话工具重新可用',genericSessions[1],'TOOL bot_list {}');assert.equal(old.results[0].error,false);
 const legacy=rows.find(b=>b.role==='bot'&&b.preset!=='hub-bot');
 const legacyStart=await call('旧预设初始会话',legacy.id,'read',{file_path:install.hubHome+'/bots/'+legacy.id+'/AGENTS.md'});assert.equal(legacyStart.r.results[0].error,false);
 t=await call('旧预设改名',install.chief,'bot_update',{target:legacy.id,name:'临时旧改',duty:'新旧预设均按目录身份'});assert.equal(t.r.results[0].error,false);
 await existing('旧预设原会话下一轮',legacyStart.id,'E1_LEGACY_REFRESH');
 captures=fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse);const legacyRefresh=captures.findLast(r=>JSON.stringify(r.messages).includes('E1_LEGACY_REFRESH'));assert.ok(JSON.stringify(legacyRefresh.messages).includes('你的名字是「临时旧改」'));
 evidence.push({label:'旧预设原会话自动读取改名后AGENTS',sessionId:legacyStart.id,currentIdentity:true});
 evidence.push({label:'内核PID未重启',pid:dsh.pid,stillRunning:dsh.exitCode===null,beforePid,afterPid:main()});
 fs.writeFileSync(scratch+'/run/cards.json',JSON.stringify(cards,null,2)+'\n',{mode:0o600});fs.writeFileSync(scratch+'/run/live-results.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log('E1隔离实测完成；真实模型调用=0');
}finally{
 clearInterval(timer);remote?.close();
 for(const p of children.reverse())if(p.exitCode===null){p.kill('SIGTERM');await new Promise(r=>{p.once('exit',r);setTimeout(r,5000);});}
 main();
}
