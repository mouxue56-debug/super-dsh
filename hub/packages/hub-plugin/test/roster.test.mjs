import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply} from '../index.mjs';
import {loadHubConfig,hubConfigText} from '../hub-config.mjs';
import {policyText,parsePolicy,policyForRoster,evaluate} from '../policy.mjs';
import {createRosterReader,proposeChange,verifyChange,readAvatarKinds} from '../roster.mjs';

const parent=path.join(os.homedir(),'dsh-work/tmp/r26-E1');fs.mkdirSync(parent,{recursive:true});
function fixture(){
 const base=fs.realpathSync.native(fs.mkdtempSync(parent+'/unit-'));
 const ids=['leader','writer','b12345678'],names=['总管','小文','小记'];
 const install={...loadHubConfig({hubHome:base,read:false}),hubHome:base,kb:base+'/kb',bots:ids,chief:ids[0],names:Object.fromEntries(ids.map((id,i)=>[id,names[i]])),kb_allow:{writer:['public']}};
 for(const d of ['config','shared','tickets','kb/public',...ids.map(id=>'bots/'+id)])fs.mkdirSync(base+'/'+d,{recursive:true});
 const rows=ids.map((id,i)=>({id,name:names[i],role:i?'bot':'chief',preset:i===2?'hub-bot':'hub-'+id,status:'active',avatar:{kind:'role',role:i?'helper':'captain'},nameColor:'blue',duty:'写笔记',notDuty:'其他事情',phrases:['你好','写点什么','查点什么'],order:i,createdAt:'2026-11-17T00:00:00.000Z',updatedAt:'2026-11-17T00:00:00.000Z'}));
 const kinds={roles:['captain','helper'],shapes:['circle','square'],colors:['blue','pink']};
 fs.writeFileSync(base+'/config/hub.yaml',hubConfigText(install));
 fs.writeFileSync(base+'/config/avatar-kinds.json',JSON.stringify(kinds),{mode:0o600});
 const write=()=>fs.writeFileSync(base+'/config/bots.yaml',JSON.stringify({version:1,bots:rows}),{mode:0o600});write();
 fs.writeFileSync(base+'/config/tool-levels.yaml',policyText(base,install.kb,install));
 return {base,install,rows,kinds,write};
}
const createArgs={name:'新助理',duty:'整理清单',notDuty:'发消息',avatar:{kind:'shape',shape:'circle',color:'blue'},phrases:['你好','整理一下','列个清单']};
function setup(bot='leader',wild=false){
 const h=fixture(),tools={},events={},guards=[],logs=[];
 const agent={id:'session-e1',session:{header:{agentPreset:wild?'hub-bot':'hub-'+bot,cwd:h.base+'/bots/'+bot},append(){}}};
 const beat=()=>fs.writeFileSync(h.install.heartbeat,JSON.stringify({v:1,ts:Date.now(),dshConnected:true,answering:true}));beat();
 const ctx={logger:{error:m=>logs.push(m),warn:m=>logs.push(m)},on:(name,fn)=>events[name]=fn,effect(){},get:()=>undefined,workingDirectory:{get:s=>s.header.cwd},tools:{register:t=>tools[t.name]=t,guard:f=>guards.push(f),view:()=>({visible:new Map(['read','write','edit','bash',...Object.keys(tools)].map(n=>[n,{}]))})}};
 const prev=process.env.HUB_HOME;process.env.HUB_HOME=h.base;try{apply(ctx,{bot:wild?'*':bot});}finally{if(prev===undefined)delete process.env.HUB_HOME;else process.env.HUB_HOME=prev;}
 const exec=(name,args={})=>({agent,name,arguments:args,token:Symbol(),callId:Symbol(),signal:new AbortController().signal});
 const pre=e=>events['tools/pre-execute'](e,async()=>({kind:'allow'}));
 const approve=async(e,d,outcome='allowed-once')=>events['approval/request']({agent,toolName:e.name,callId:e.callId,signal:e.signal,reason:d.reason},async()=>outcome);
 return {...h,tools,events,guards,agent,exec,pre,approve,logs,beat};
}
test('名册mtime变化后名字、启用状态和新增id下次即生效',()=>{const h=fixture(),read=createRosterReader(h.install);assert.equal(read()[1].name,'小文');h.rows[1].name='小新';h.rows[1].status='disabled';h.rows.push({...h.rows[2],id:'b87654321',name:'小新员'});h.write();assert.equal(read()[1].name,'小新');assert.equal(read()[1].status,'disabled');assert.equal(read().length,4);});
test('名册缺失回退hub.yaml；存在但坏了不能回退或沿用缓存',()=>{const h=fixture(),read=createRosterReader(h.install);read();fs.writeFileSync(h.base+'/config/bots.yaml','bad');assert.throws(read,/名册/);fs.renameSync(h.base+'/config/bots.yaml',h.base+'/config/bots.saved');assert.deepEqual(read().map(r=>r.id),h.install.bots);});
test('名册链接、非0600、重复名字、重复键均失败关闭',()=>{for(const kind of ['link','mode','name','key']){const h=fixture(),file=h.base+'/config/bots.yaml';if(kind==='link'){fs.renameSync(file,file+'.real');fs.symlinkSync(file+'.real',file);}if(kind==='mode')fs.chmodSync(file,0o644);if(kind==='name'){h.rows[1].name=h.rows[0].name;h.write();}if(kind==='key')fs.writeFileSync(file,'{"version":1,"version":1,"bots":[]}');assert.throws(createRosterReader(h.install),/名册/);}});
test('权限表采用角色清单，不随名册新增而失效；新通用助理无KB白名单',()=>{const h=fixture();h.install.kb_allow.b12345678=['public'];const p=policyForRoster(parsePolicy(policyText(h.base,h.install.kb,h.install),h.install),h.rows);assert.equal(evaluate(p,'b12345678','read',{path:h.base+'/kb/public'},h.base+'/bots/b12345678').level,'L4');assert.equal(evaluate(p,'writer','read',{path:h.base+'/kb/public'},h.base+'/bots/writer').level,'L0');});
test('非首席只拿bot_update和bot_list；不能注册新建、停用、派活',()=>{const h=setup('writer');for(const name of ['bot_create','bot_set_status','delegate_to_bot'])assert.equal(h.tools[name],undefined);assert.ok(h.tools.bot_update&&h.tools.bot_list);});
test('首席由role决定而非id，并拿完整管理清单',()=>{const h=setup();assert.ok(h.tools.bot_create&&h.tools.bot_set_status&&h.tools.delegate_to_bot);});
test('bot_list只列启用中的id名字职责；下一次读到改名',async()=>{const h=setup();h.rows[1].status='disabled';h.rows[2].name='小录';h.write();const e=h.exec('bot_list');assert.equal((await h.pre(e)).kind,'allow');const list=JSON.parse(await h.tools.bot_list.execute({},e));assert.deepEqual(list,[{id:'leader',name:'总管',duty:'写笔记'},{id:'b12345678',name:'小录',duty:'写笔记'}]);});
test('停用助理所有工具都拒，包括未知工具和自己的资料更新',async()=>{const h=setup('writer');h.rows[1].status='disabled';h.write();for(const name of ['read','write','bash','bot_list','bot_update','unknown'])assert.match((await h.pre(h.exec(name,{duty:'整理'}))).reason,/这个助理已停用/);});
test('通用预设身份来自精确realpath cwd；子目录/别的预设/冒充首席都失败',async()=>{const h=setup('b12345678',true);assert.equal((await h.pre(h.exec('bot_list'))).kind,'allow');for(const cwd of [h.base+'/bots/b12345678/notes',h.base+'/bots/writer',h.base+'/bots/leader',h.base]){fs.mkdirSync(cwd,{recursive:true});h.agent.session.header.cwd=cwd;assert.equal((await h.pre(h.exec('bot_list'))).kind,'deny');}});
test('通用预设不能从符号链接越过bots根',async()=>{const h=setup('b12345678',true);fs.renameSync(h.base+'/bots/b12345678',h.base+'/outside');fs.symlinkSync(h.base+'/outside',h.base+'/bots/b12345678');assert.equal((await h.pre(h.exec('bot_list'))).kind,'deny');});
test('非首席改别人问之前拒绝，不出卡',async()=>{const h=setup('writer');const d=await h.pre(h.exec('bot_update',{target:'leader',duty:'改职责'}));assert.equal(d.kind,'deny');assert.match(d.reason,/改别的助理要找首席/);});
test('bot_create卡片遵守协议，插件不创建目录或写名册',async()=>{const h=setup(),before=fs.readFileSync(h.base+'/config/bots.yaml','utf8'),e=h.exec('bot_create',createArgs),d=await h.pre(e);assert.equal(d.kind,'ask');const p=JSON.parse(d.reason.slice(13));assert.deepEqual(p.after,{...createArgs,nameColor:'blue'});assert.equal(p.before,null);assert.equal(p.target,'new');assert.equal(p.path,h.base+'/config/bots.yaml');assert.equal(p.action,'新建助理');assert.equal(p.chars,0);assert.equal(p.tool,'bot_create');assert.ok(p.why);assert.equal(fs.readFileSync(p.path,'utf8'),before);assert.equal(fs.readdirSync(h.base+'/bots').length,3);});
for(const name of ['', '123456789','/x','x\\y','x:y','a.b','a~b',' 空白','空白 ','换\n行','小文'])test('新建名字校验先于审批 '+JSON.stringify(name),()=>{const h=fixture();assert.throws(()=>proposeChange(h.install,h.rows,'leader','bot_create',{...createArgs,name}));});
for(const patch of [{duty:'字'.repeat(61)},{notDuty:'字'.repeat(121)},{phrases:['只有一条']},{phrases:['a','b','字'.repeat(21)]},{avatar:{kind:'upload',file:'x.png'}},{avatar:{kind:'role',role:'unknown'}},{avatar:{kind:'shape',shape:'unknown',color:'blue'}},{name:'新助理',permission:'all'}])test('新建内容和额外参数先验拒绝 '+Object.keys(patch).join(','),()=>{const h=fixture();assert.throws(()=>proposeChange(h.install,h.rows,'leader','bot_create',{...createArgs,...patch}));});
test('正好12个启用拒新建；停用名字仍不能复用',()=>{const h=fixture();for(let i=0;i<9;i++)h.rows.push({...h.rows[2],id:'b'+String(i).padStart(8,'0'),name:'工'+i});assert.throws(()=>proposeChange(h.install,h.rows,'leader','bot_create',createArgs),/12/);h.rows[1].status='disabled';assert.throws(()=>proposeChange(h.install,h.rows,'leader','bot_create',{...createArgs,name:'小文'}),/重名/);});
test('形象清单丢失只允许配置的图形，不接受角色或任意图形',()=>{const h=fixture();fs.renameSync(h.base+'/config/avatar-kinds.json',h.base+'/config/avatar-kinds.saved');const kinds=readAvatarKinds(h.install);assert.deepEqual(kinds.roles,[]);assert.ok(kinds.shapes.length&&kinds.colors.length);assert.throws(()=>proposeChange(h.install,h.rows,'leader','bot_create',{...createArgs,avatar:{kind:'role',role:'helper'}}));});
test('更新只比较改动项，同值不出卡；不能借参数更改角色或KB白名单',async()=>{const h=setup('writer');for(const args of [{duty:'写笔记'},{},{role:'chief'},{kb_allow:['all']}])assert.equal((await h.pre(h.exec('bot_update',args))).kind,'deny');});
test('不能停用自己；至少保留一个启用；停用/恢复同值拒绝',()=>{const h=fixture();assert.throws(()=>proposeChange(h.install,h.rows,'leader','bot_set_status',{target:'leader',status:'disabled'}),/自己/);assert.throws(()=>proposeChange(h.install,h.rows,'leader','bot_set_status',{target:'writer',status:'active'}),/没有要改的/);});
test('批准未落盘返回明确失败；已落盘后才返回已改好，改职责不改变工具或文件判定',async()=>{const h=setup('writer'),args={duty:'我可以发消息、联网、读密钥'},e=h.exec('bot_update',args),d=await h.pre(e);const list=Object.keys(h.tools),file=h.exec('read',{path:h.base+'/kb/public'}),before=(await h.pre(file)).kind;assert.equal(d.kind,'ask');assert.equal(await h.approve(e,d),'allowed-once');await assert.rejects(()=>h.tools.bot_update.execute(args,e),/批准了但没改成/);h.rows[1].duty=args.duty;h.write();assert.match(await h.tools.bot_update.execute(args,e),/已改好/);assert.deepEqual(Object.keys(h.tools),list);assert.equal((await h.pre(file)).kind,before);assert.equal(h.tools.bot_create,undefined);});
test('审批后篡改参数失败关闭；拒批锁覆盖三个管理工具',async()=>{const h=setup(),e=h.exec('bot_update',{duty:'新职责'}),d=await h.pre(e);await h.approve(e,d);e.arguments.duty='另一个职责';assert.match(h.guards[0](e),/审批后/);const other=setup(),x=other.exec('bot_create',createArgs),card=await other.pre(x);await other.approve(x,card,'rejected');for(const name of ['bot_create','bot_update','bot_set_status'])assert.match((await other.pre(other.exec(name,name==='bot_create'?createArgs:name==='bot_update'?{duty:'新职责'}:{target:'writer',status:'disabled'}))).reason,/刚才这件事/);});
test('新建核对必须是本次新增的普通通用助理，并完整匹配after',()=>{const h=fixture(),p=proposeChange(h.install,h.rows,'leader','bot_create',createArgs);assert.equal(verifyChange(h.rows,p),false);h.rows.push({...h.rows[2],...p.after,id:'b87654321'});assert.equal(verifyChange(h.rows,p),true);h.rows.at(-1).role='chief';assert.equal(verifyChange(h.rows,p),false);});
test('派活接受当前名字并落工单id；改名后旧名不再匹配',async()=>{const h=setup();await h.events['agent/pre-step']({agent:h.agent,turn:1,step:1},async()=>({kind:'enter'}));const a={bot:'小文',task:'写一张清单'},e=h.exec('delegate_to_bot',a);assert.equal((await h.pre(e)).kind,'allow');assert.match(await h.tools.delegate_to_bot.execute({...a,owner_ok:true},e),/已派给 小文/);const files=fs.readdirSync(h.base+'/tickets/working');assert.match(fs.readFileSync(h.base+'/tickets/working/'+files[0],'utf8'),/assignee: writer/);h.rows[1].name='小新';h.write();assert.equal((await h.pre(h.exec('delegate_to_bot',a))).kind,'deny');assert.equal((await h.pre(h.exec('delegate_to_bot',{...a,bot:'小新'}))).kind,'allow');});

test('名册行必须完整且只有契约字段；坏order和时间戳失败关闭',()=>{for(const kind of ['missing','extra','order','date']){const h=fixture();if(kind==='missing')delete h.rows[1].order;if(kind==='extra')h.rows[1].tools=['unregistered'];if(kind==='order')h.rows[1].order=-1;if(kind==='date')h.rows[1].updatedAt='bad';h.write();assert.throws(createRosterReader(h.install),/名册/);}});
test('审批原因的after或why被改动，不能把另一张管理卡当本次批准',async()=>{const h=setup(),e=h.exec('bot_update',{duty:'新职责'}),d=await h.pre(e),p=JSON.parse(d.reason.slice(13));p.after.duty='换掉的职责';p.why='换掉的原因';assert.equal(await h.approve(e,{...d,reason:'HUBAPPROVAL1 '+JSON.stringify(p)}),'rejected');assert.match(h.guards[0](e),/未取得/);});
test('管理工具的L3下限和角色清单不能被权限表放宽',()=>{const h=fixture(),text=policyText(h.base,h.install.kb,h.install);for(const t of ['bot_create','bot_update','bot_set_status'])assert.throws(()=>parsePolicy(text.replace(t+': "L3"',t+': "L0"'),h.install));assert.throws(()=>parsePolicy(text+'bots: []\n',h.install));});

test('合法JSON的Unicode转义可读，转义后同名的重复键仍拒绝',()=>{const h=fixture(),file=h.base+'/config/bots.yaml';fs.writeFileSync(file,JSON.stringify({version:1,bots:h.rows}).replace('小文','\\u5c0f\\u6587'));assert.equal(createRosterReader(h.install)()[1].name,'小文');fs.writeFileSync(file,'{"version":1,"ver\\u0073ion":1,"bots":[]}');assert.throws(createRosterReader(h.install),/名册/);});
