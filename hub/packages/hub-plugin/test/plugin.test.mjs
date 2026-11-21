import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {apply} from '../index.mjs';import {policyText,BOTS} from '../policy.mjs';
fs.mkdirSync(path.join(os.homedir(),'dsh-work/tmp/r26-B'),{recursive:true});
const home=fs.realpathSync.native(fs.mkdtempSync(path.join(os.homedir(),'dsh-work/tmp/r26-B/','fixture-plugin-'))),base=home+'/dsh-work';
for(const p of ['config','shared',...BOTS.map(b=>'bots/'+b)])fs.mkdirSync(base+'/'+p,{recursive:true});
fs.writeFileSync(base+'/config/tool-levels.yaml',policyText(base,home+'/knowledge-base'));
const heartbeat=base+'/config/bff-heartbeat.json';
const healthy=()=>fs.writeFileSync(heartbeat,JSON.stringify({v:1,ts:Date.now(),dshConnected:true,answering:true,devicePresent:true}));
const original=os.homedir;os.homedir=()=>home;
function setup(bot='chief') {healthy();const events={},tools={},guards=[],notes=[];const ctx={logger:{error(){}},workingDirectory:{get:s=>base+'/bots/'+s.header.agentPreset.slice(4)},on:(n,f)=>events[n]=f,tools:{view:()=>({visible:new Map(['read','write','edit',...Object.keys(tools)].map(n=>[n,{}]))}),guard:f=>guards.push(f),register:t=>tools[t.name]=t}};os.homedir=()=>home;try{apply(ctx,{bot});}finally{os.homedir=original;}const agent={id:'session-'+bot,session:{header:{agentPreset:'hub-'+bot},append:(type,data)=>notes.push({type,data})}};const exec=(name,args,ag=agent)=>({name,arguments:args,agent:ag,token:Symbol(),callId:Symbol(),signal:new AbortController().signal});const approve=async(e,outcome='allowed-once')=>events['approval/request']({agent:e.agent,callId:e.callId,toolName:e.name,signal:e.signal,reason:'HUBAPPROVAL1 '+JSON.stringify({bot,sessionId:e.agent.id,path:e.arguments.file_path,tool:e.name})},async()=>outcome);return {ctx,events,tools,guards,agent,exec,approve,notes};}
const allow=async()=>({kind:'allow'}),accept=async()=>({kind:'accept'});
test('六预设只注册约定自写工具，非chief没有派活',()=>{for(const b of BOTS){const h=setup(b);assert.deepEqual(Object.keys(h.tools).sort(),['list_files','ticket_create','ticket_update','ticket_move','bot_status','bot_list','bot_update',...(b==='chief'?['delegate_to_bot','bot_create','bot_set_status']:[])].sort());}});
test('审批原因单行JSON与guard独立复判',async()=>{const h=setup(),e=h.exec('write',{file_path:base+'/shared/a.md',content:'测试'});const d=await h.events['tools/pre-execute'](e,allow);assert.equal(d.kind,'ask');assert.ok(!d.reason.includes('\n'));const p=JSON.parse(d.reason.slice('HUBAPPROVAL1 '.length));assert.deepEqual({v:p.v,bot:p.bot,sessionId:p.sessionId,level:p.level,path:p.path,chars:p.chars},{v:1,bot:'chief',sessionId:'session-chief',level:'L3',path:base+'/shared/a.md',chars:2});assert.match(h.guards[0](e),/未取得本次明确批准/);assert.equal(await h.approve(e),'allowed-once');assert.equal(h.guards[0](e),undefined);assert.match(h.guards[0](h.exec('write',{file_path:base+'/shared/b.md',content:'x'})),/审批后的路径/);assert.match(h.guards[0](h.exec('bash',{})),/做不了/);});
test('L3拒绝锁跨工具跨路径、会话隔离、只有真实user清锁',async()=>{const h=setup(),e=h.exec('write',{file_path:base+'/shared/a.md',content:'x'});await h.events['tools/pre-execute'](e,allow);assert.equal(await h.approve(e,'rejected'),'rejected');h.events['tools/result'](e,{isError:true});const another=h.exec('edit',{file_path:base+'/shared/b.md'});assert.match((await h.events['tools/pre-execute'](another,allow)).reason,/刚才这件事 主人 没批准/);const ag={id:'session-other',session:{header:{agentPreset:'hub-chief'}}};assert.equal((await h.events['tools/pre-execute'](h.exec('write',{file_path:base+'/shared/c.md'},ag),allow)).kind,'ask');h.events['agent/inbox/inserted']({agent:h.agent,message:{source:{kind:'plugin'}}});assert.equal((await h.events['tools/pre-execute'](another,allow)).kind,'deny');h.events['agent/inbox/inserted']({agent:h.agent,message:{source:{kind:'user'}}});assert.equal((await h.events['tools/pre-execute'](another,allow)).kind,'ask');});
test('审批等待期间收到新user，旧拒绝不重新上锁',async()=>{const h=setup(),e=h.exec('write',{file_path:base+'/shared/a.md'});await h.events['tools/pre-execute'](e,allow);h.events['agent/inbox/inserted']({agent:h.agent,message:{source:{kind:'user'}}});assert.equal(await h.approve(e,'rejected'),'rejected');h.events['tools/result'](e,{isError:true});assert.equal((await h.events['tools/pre-execute'](h.exec('write',{file_path:base+'/shared/b.md'}),allow)).kind,'ask');});
test('预设身份缺失或不符全部L4',async()=>{const h=setup();for(const agent of [undefined,{id:'bad',session:{header:{agentPreset:'hub-pm'}}}]){const e=h.exec('read',{file_path:base+'/bots/chief'},agent??{});assert.equal((await h.events['tools/pre-execute'](e,allow)).kind,'deny');}});
test('L1工具结果末尾留痕且不修改L0结果',async()=>{const h=setup(),e=h.exec('write',{file_path:base+'/bots/chief/a.md'});const r=await h.events['tools/post-execute'](e,{isError:false,content:[{type:'text',text:'成功'}]},accept);assert.match(r.content.at(-1).text,/bots\/chief\/a.md，L1 已记录/);assert.deepEqual(await h.events['tools/post-execute'](h.exec('read',{file_path:base+'/bots/chief'}),{isError:false},accept),{kind:'accept'});});
test('每轮最多3次派活，下一轮恢复，不直接创建会话',async()=>{const h=setup();await h.events['agent/pre-step']({agent:h.agent,turn:1},async()=>({kind:'enter'}));for(let i=0;i<3;i++)assert.match(await h.tools.delegate_to_bot.execute({bot:'pm',task:'测试派活 '+i,owner_ok:true},h.exec('delegate_to_bot',{bot:'pm',task:'测试派活 '+i,owner_ok:true})),/已派给 项目经理/);await assert.rejects(()=>h.tools.delegate_to_bot.execute({bot:'art',task:'第四个',owner_ok:true},h.exec('delegate_to_bot',{bot:'art',task:'第四个',owner_ok:true})),/本轮已派3个/);await h.events['agent/pre-step']({agent:h.agent,turn:2},async()=>({kind:'enter'}));assert.match(await h.tools.delegate_to_bot.execute({bot:'art',task:'下一轮',owner_ok:true},h.exec('delegate_to_bot',{bot:'art',task:'下一轮',owner_ok:true})),/已派给/);});
test('缺少轮次时派活失败关闭',async()=>{const h=setup();await assert.rejects(()=>h.tools.delegate_to_bot.execute({bot:'pm',task:'x'},h.exec('delegate_to_bot',{bot:'pm',task:'x'})),/无法核实当前轮次/);});
os.homedir=original;

test('共享区获批后只在执行期加写根，执行后撤销',async()=>{const h=setup(),e=h.exec('write',{file_path:base+'/shared/approved.md',content:'x'});await h.events['tools/pre-execute'](e,allow);assert.match(h.guards[0](e),/未取得本次明确批准/);assert.equal(await h.approve(e),'allowed-once');assert.equal(h.guards[0](e),undefined);assert.equal(await h.events['tools/execute'](e,async()=>42),42);});
test('审批后路径链接被换向外部，guard再次拒绝',async()=>{const h=setup(),target=base+'/shared/link-after';const e=h.exec('write',{file_path:target,content:'x'});assert.equal((await h.events['tools/pre-execute'](e,allow)).kind,'ask');fs.symlinkSync(base+'/bots/pm',target);assert.match(h.guards[0](e),/做不了/);});


for(const tool of ['write','edit'])test('AGENTS.md '+tool+' pre及guard双拒绝',async()=>{const h=setup(),e=h.exec(tool,{file_path:base+'/bots/chief/AGENTS.md',content:'禁止'});assert.match((await h.events['tools/pre-execute'](e,allow)).reason,/AGENTS.md/);assert.match(h.guards[0](e),/AGENTS.md/);});
test('心跳缺失预审批直接拒绝并锁到下一句user',async()=>{const h=setup();fs.renameSync(heartbeat,heartbeat+'.saved');const e=h.exec('write',{file_path:base+'/shared/missing.md'});assert.match((await h.events['tools/pre-execute'](e,allow)).reason,/审批通道不在线/);healthy();assert.match((await h.events['tools/pre-execute'](h.exec('edit',{file_path:base+'/shared/other.md'}),allow)).reason,/刚才这件事/);h.events['agent/inbox/inserted']({agent:h.agent,message:{source:{kind:'user'},content:[]}});assert.equal((await h.events['tools/pre-execute'](h.exec('write',{file_path:base+'/shared/other.md'}),allow)).kind,'ask');});
test('明确批准后心跳失效guard仍拒绝',async()=>{const h=setup(),e=h.exec('write',{file_path:base+'/shared/guard.md'});await h.events['tools/pre-execute'](e,allow);await h.approve(e);fs.writeFileSync(heartbeat,'{}');assert.match(h.guards[0](e),/审批通道不在线/);});
test('被派会话第9步前拒绝，下一轮重计，普通会话不限8步',async()=>{const h=setup('pm');h.events['agent/inbox/inserted']({agent:h.agent,message:{source:{kind:'user'},content:[{type:'text',text:'【首席派来的活 · 工单 T-测试】任务'}]}});for(let step=1;step<=8;step++)assert.equal((await h.events['agent/pre-step']({agent:h.agent,turn:1,step},async()=>({kind:'enter'}))).kind,'enter');let called=false;assert.equal((await h.events['agent/pre-step']({agent:h.agent,turn:1,step:9},async()=>{called=true;return {kind:'enter'};})).kind,'reject');assert.equal(called,false);assert.equal(h.notes.length,0);assert.match(fs.readFileSync(base+'/config/step-limits.log','utf8'),/超过 8 步自动停/);assert.equal((await h.events['agent/pre-step']({agent:h.agent,turn:2,step:1},async()=>({kind:'enter'}))).kind,'enter');const ordinary=setup('content');ordinary.events['agent/inbox/inserted']({agent:ordinary.agent,message:{source:{kind:'user'},content:[{type:'text',text:'普通任务'}]}});assert.equal((await ordinary.events['agent/pre-step']({agent:ordinary.agent,turn:1,step:9},async()=>({kind:'enter'}))).kind,'enter');});
test('模型/plugin伪造派活前缀不改变普通会话分类',async()=>{const h=setup();for(const kind of ['plugin','user'])h.events['agent/inbox/inserted']({agent:h.agent,message:{source:{kind},content:[{type:'text',text:kind==='user'?'普通首句':'【首席派来的活 · 工单 假】'}]}});assert.equal((await h.events['agent/pre-step']({agent:h.agent,turn:1,step:9},async()=>({kind:'enter'}))).kind,'enter');});

test('G1 手机离线时L3仍询问，明确批准后guard及执行可过',async()=>{const h=setup(),e=h.exec('write',{file_path:base+'/shared/phone-asleep.md',content:'x'});fs.writeFileSync(heartbeat,JSON.stringify({v:1,ts:Date.now(),dshConnected:true,answering:true,devicePresent:false}));assert.equal((await h.events['tools/pre-execute'](e,allow)).kind,'ask');assert.equal(await h.approve(e),'allowed-once');assert.equal(h.guards[0](e),undefined);assert.equal(await h.events['tools/execute'](e,async()=>42),42);});

// G2：字段存在即拒绝，不能浪费审批，也不能把参数或执行错误当作拒批。
const parameterReason='写文件不要带 justification 或 sandbox_permissions 参数，去掉后直接重试';
for(const tool of ['write','edit'])for(const area of ['own','shared'])for(const field of ['justification','sandbox_permissions'])for(const value of [undefined,null,'',false,0,{},[], 'workspace-write'])test(`G2 ${tool}/${area}/${field}=${JSON.stringify(value)} 问前拒绝且不锁`,async()=>{
 const h=setup(),file=base+(area==='own'?'/bots/chief':'/shared')+'/g2-parameter.md';
 const args={file_path:file,...(tool==='write'?{content:'x'}:{old_string:'x',new_string:'y'}),[field]:value};
 const e=h.exec(tool,args);let called=false;
 const d=await h.events['tools/pre-execute'](e,async()=>{called=true;return {kind:'allow'};});
 assert.equal(d.kind,'deny');assert.ok(d.reason.endsWith(parameterReason));assert.equal(called,false);
 assert.ok(h.guards[0](e).endsWith(parameterReason));
 h.events['tools/result'](e,{isError:true});
 const retry=h.exec(tool,{...args});delete retry.arguments[field];
 assert.equal((await h.events['tools/pre-execute'](retry,allow)).kind,area==='own'?'allow':'ask');
});
for(const tool of ['write','edit'])test('G2 '+tool+' 批准后执行失败保留错误首句且不上锁',async()=>{
 const h=setup(),e=h.exec(tool,{file_path:base+'/shared/g2-failed.md',content:'x',old_string:'x',new_string:'y'});
 assert.equal((await h.events['tools/pre-execute'](e,allow)).kind,'ask');assert.equal(await h.approve(e),'allowed-once');
 const error={isError:true,error:{message:'首句错误。第二句不应复述。\n内部堆栈'},content:[{type:'text',text:'原始错误仍保留'}]};
 const r=await h.events['tools/post-execute'](e,error,accept);
 assert.equal(r.kind,'accept');assert.equal(r.content[0].text,'原始错误仍保留');assert.equal(r.content.at(-1).text,'（主人 已批准，但写入没成功：首句错误。）');
 assert.doesNotMatch(r.content.at(-1).text,/已写入|第二句|内部堆栈/);
 h.events['tools/result'](e,error);
 assert.equal((await h.events['tools/pre-execute'](h.exec('write',{file_path:base+'/shared/g2-retry.md',content:'x'}),allow)).kind,'ask');
});
test('G2 执行错误没有结构化message时取原始文本首行',async()=>{
 const h=setup(),e=h.exec('write',{file_path:base+'/shared/g2-text-error.md',content:'x'});
 await h.events['tools/pre-execute'](e,allow);await h.approve(e);
 const r=await h.events['tools/post-execute'](e,{isError:true,content:[{type:'text',text:'Error: EISDIR: illegal operation on a directory\n第二行'}]},accept);
 assert.equal(r.content.at(-1).text,'（主人 已批准，但写入没成功：EISDIR: illegal operation on a directory）');
});
test('G2 未到审批结果的执行错误不冒充批准或拒批',async()=>{
 const h=setup(),e=h.exec('write',{file_path:base+'/shared/g2-no-outcome.md',content:'x'});
 await h.events['tools/pre-execute'](e,allow);const r=await h.events['tools/post-execute'](e,{isError:true,content:[]},accept);
 assert.deepEqual(r,{kind:'accept'});h.events['tools/result'](e,{isError:true});
 assert.equal((await h.events['tools/pre-execute'](h.exec('write',{file_path:base+'/shared/g2-no-outcome-retry.md'}),allow)).kind,'ask');
});
for(const outcome of ['rejected','timeout','unavailable'])test('G2 '+outcome+' 由审批结果上锁，无需等tools/result',async()=>{
 const h=setup(),e=h.exec('write',{file_path:base+'/shared/g2-denied.md',content:'x'});
 await h.events['tools/pre-execute'](e,allow);assert.equal(await h.approve(e,outcome),'rejected');
 const r=await h.events['tools/post-execute'](e,{isError:true,content:[{type:'text',text:'拒绝'}]},accept);
 assert.doesNotMatch(JSON.stringify(r),/主人 已批准/);
 assert.match((await h.events['tools/pre-execute'](h.exec('edit',{file_path:base+'/shared/g2-denied-retry.md'}),allow)).reason,/刚才这件事 主人 没批准/);
});
test('G2 真正拒批后带错参数不清锁，修正参数仍拒绝',async()=>{
 const h=setup(),e=h.exec('write',{file_path:base+'/shared/g2-keep-lock.md'});
 await h.events['tools/pre-execute'](e,allow);await h.approve(e,'rejected');
 await h.events['tools/pre-execute'](h.exec('write',{file_path:base+'/shared/g2-keep-lock.md',justification:''}),allow);
 assert.match((await h.events['tools/pre-execute'](h.exec('write',{file_path:base+'/shared/g2-keep-lock.md'}),allow)).reason,/刚才这件事 主人 没批准/);
});
test('G2 获批成功仍留成功回执，不追加失败提示',async()=>{
 const h=setup(),e=h.exec('write',{file_path:base+'/shared/g2-success.md',content:'x'});
 await h.events['tools/pre-execute'](e,allow);await h.approve(e);
 const r=await h.events['tools/post-execute'](e,{isError:false,content:[{type:'text',text:'成功'}]},accept);
 assert.match(r.content.at(-1).text,/主人 已在手机上批准，已写入/);assert.doesNotMatch(JSON.stringify(r),/写入没成功/);
});
