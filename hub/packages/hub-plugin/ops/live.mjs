// 只连接本轮3490。认证值仅从本轮启动日志留在进程内；不读任何凭据/密钥文件。
import fs from 'node:fs';import os from 'node:os';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const base=os.homedir()+'/dsh-work',scratch=base+'/dev-home-r24scratch',root=base+'/dsh-hub/packages/hub-plugin';
const log=fs.readFileSync(scratch+'/run/dsh.out','utf8'),match=log.match(/http:\/\/127\.0\.0\.1:3490\/[^\s]+/);if(!match)throw Error('3490实例未就绪');
const auth=new URL(match[0]);auth.pathname='/connect';auth.searchParams.set('interactions','none');
const response=await fetch(auth,{redirect:'manual'}),cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');await response.body?.cancel();if(response.status!==302||!cookie)throw Error('3490认证失败');
async function rpc(method,args){const rpcId=randomUUID(),r=await fetch('http://127.0.0.1:3490/api/'+method,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method,payload:{args}})});const e=await r.json();if(!e.result?.ok)throw Error(JSON.stringify({method,error:e.result?.error}));return e.result.value;}
async function events(id){return(await rpc('session/events',{request:{address:{kind:'session',sessionId:id},maxMessages:200}})).records.map(r=>r.event);}
async function create(bot){return(await rpc('session/create',{request:{cwd:base+'/bots/'+bot,agentPreset:'hub-'+bot}})).sessionId;}
async function turn(id,text){const prior=await events(id),seq=prior.at(-1)?.seq??-1;await rpc('session/prompt',{request:{sessionId:id,requestId:randomUUID(),mode:'queue',content:[{type:'text',text}]}});for(let i=0;i<400;i++){const es=(await events(id)).filter(e=>e.seq>seq);if(es.some(e=>e.type==='turn/end'))return es;await new Promise(r=>setTimeout(r,50));}throw Error('本轮测试超时');}
const remoteDisabled=/id: api-remotes\s+disabled: true/.test(fs.readFileSync(scratch+'/profiles/web/cordis.patch.yml','utf8'));console.log('测试环境：3490；api-remotes禁用='+remoteDisabled+'（裸审批内核与标准Web宿主分开记录）');
const results=[];function save(label,id,es){const value={remoteDisabled,label,sessionId:id,tools:es.filter(e=>e.type==='request/header').flatMap(e=>e.data.header.tools.map(t=>t.name)),results:es.filter(e=>e.type==='tool/result').map(e=>({error:e.data.message.isError,text:e.data.message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'),detail:e.data.error})),turns:es.filter(e=>e.type==='turn/end').map(e=>e.data.reason)};results.push(value);fs.writeFileSync(root+'/live-results.json',JSON.stringify(results,null,2)+'\n');console.log(label,JSON.stringify(value));return value;}
const ids={};for(const bot of ['chief','support','content','pm','art','research']){ids[bot]=await create(bot);const r=save('工具清单 '+bot,ids[bot],await turn(ids[bot],'TOOL bot_status {}'));const expected=['read','write','edit','list_files','ticket_create','ticket_update','ticket_move','bot_status',...(bot==='chief'?['delegate_to_bot']:[])].sort();assert.deepEqual([...new Set(r.tools)].sort(),expected);assert.equal(r.results[0].error,false);}
async function tool(bot,label,name,args,expected){const es=await turn(ids[bot],'TOOL '+name+' '+JSON.stringify(args)),r=save(label,ids[bot],es);assert.equal(r.results.length,1);assert.equal(r.results[0].error,expected==='deny');return r;}
const stamp=Date.now(),own=base+'/bots/chief',file=own+'/r24-a-'+stamp+'.md',shared=base+'/shared/r24-a-denied-'+stamp+'.md';
await tool('chief','L0读自己的文件','read',{file_path:'AGENTS.md'},'allow');
await tool('chief','L1写自己的文件','write',{file_path:file,content:'第24轮假模型写入测试\n'},'allow');assert.equal(fs.readFileSync(file,'utf8'),'第24轮假模型写入测试\n');
await tool('chief','L1编辑自己的文件','edit',{file_path:file,old_string:'写入测试',new_string:'编辑测试'},'allow');assert.match(fs.readFileSync(file,'utf8'),/编辑测试/);
await tool('chief','L0列自己的目录','list_files',{path:own},'allow');
const no=await tool('chief','L3没有应答者','write',{file_path:shared,content:'绝不落盘'},'deny');assert.equal(fs.existsSync(shared),false);assert.match(no.results[0].text,/approval|审批/i);
const seq=save('同轮L3拒绝锁',ids.chief,await turn(ids.chief,'TOOLSEQ '+JSON.stringify([{name:'write',args:{file_path:shared,content:'不落盘1'}},{name:'write',args:{file_path:shared+'-2',content:'不落盘2'}}])));assert.equal(seq.results.length,2);assert.match(seq.results[1].text,/刚才这件事 主人 没批准/);assert.equal(fs.existsSync(shared+'-2'),false);
const cleared=await tool('chief','新user清L3锁','write',{file_path:shared+'-3',content:'仍无应答者'},'deny');assert.doesNotMatch(cleared.results[0].text,/刚才这件事 主人 没批准/);assert.equal(fs.existsSync(shared+'-3'),false);
for(const [label,target,bot='chief',name='read']of [
 ['绝对越界','/etc/passwd'],['点点越界','../../dev-home-r23/x'],['相对其他助理','../chief/x','support'],
 ['DSH-work大小写',base.replace('/dsh-work','/DSH-work')+'/shared/../dev-home-r23'],['USERS大小写',(base+'/dev-home-r23').replace('/Users/example','/USERS/EXAMPLE')],
 ['NFD禁用字样',(os.homedir()+'/knowledge-base/40-客服/医院').normalize('NFD'),'support'],['全角点',own+'/．．/x'],
 ['知识库非白名单',os.homedir()+'/knowledge-base/10-其他','support'],['知识库写',os.homedir()+'/knowledge-base/40-客服/r24-deny.md','support','write'],
 ['知识库禁用字样',os.homedir()+'/knowledge-base/40-客服/secrets.md','support']
])await tool(bot,'L4 '+label,name,{file_path:target,...name==='write'?{content:'禁止落盘'}:{}},'deny');
for(const [label,target]of [['secrets',os.homedir()+'/.secrets'],['dev-home-r23',base+'/dev-home-r23']]){const link=own+'/r24-a-link-'+label+'-'+stamp;fs.symlinkSync(target,link);await tool('chief','L4链接 '+label,'read',{file_path:link},'deny');}
await tool('pm','L4非chief派活','delegate_to_bot',{bot:'art',task:'不许派'},'deny');await tool('chief','L4未知工具','bash',{command:'printf 不许执行'},'deny');
const note=await tool('chief','L1新建工单','ticket_create',{title:'第24轮A测试备注',body:'纯假模型测试，不供真实派活'},'allow');const ticket=note.results[0].text.match(/T-\d{8}-\d{6}-[a-f0-9]{4}/)[0];
await tool('chief','L1更新自建工单','ticket_update',{id:ticket,append:'自己更新',status:'done'},'allow');await tool('chief','L1移动自建工单','ticket_move',{id:ticket,to:'done'},'allow');await tool('pm','L3改别人工单无应答者','ticket_update',{id:ticket,append:'不允许写'},'deny');
console.log('内核集成检查全部通过，真实模型调用=0；派活限额在隔离单测验证，未创建真实派活工单');
