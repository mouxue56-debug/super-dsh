import {parseApproval,atomicFile} from '../../hub-bff/lib/runtime.mjs';
import {CommandGrants} from '../../hub-bff/lib/command-grants.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply} from '../index.mjs';
import {policyText,parsePolicy,expectedTools,BOTS} from '../policy.mjs';
import {CMD_DEFAULTS} from '../command-policy.mjs';
import {loadHubConfig,hubConfigText,parseFlatYaml} from '../hub-config.mjs';
import {readGrants} from '../grants.mjs';
const parent=path.join(os.homedir(),'dsh-work/tmp/r26-B');fs.mkdirSync(parent,{recursive:true});
const fixture=()=>fs.realpathSync.native(fs.mkdtempSync(parent+'/unit-'));
const cfg=loadHubConfig({read:false});
function setup({extra=[],missing=[],mode='workspace-write',taint=[],timeout=60000}={}){
 const home=fixture(),base=home+'/hub',bot=BOTS[0],own=base+'/bots/'+bot;
 for(const p of ['config','shared','tickets',...BOTS.map(b=>'bots/'+b)])fs.mkdirSync(base+'/'+p,{recursive:true,mode:0o700});
 fs.writeFileSync(base+'/config/hub.yaml',hubConfigText({...cfg,home,hubHome:base,kb:home+'/kb',heartbeat:base+'/config/beat.json',grants:base+'/config/grants.json'}));
 fs.writeFileSync(base+'/config/tool-levels.yaml',policyText(base,home+'/kb').replace('cmd_taint_tools: []','cmd_taint_tools: '+JSON.stringify(taint)).replace('cmd_timeout_ms: 60000','cmd_timeout_ms: '+timeout));
 const beat=()=>fs.writeFileSync(base+'/config/beat.json',JSON.stringify({v:1,ts:Date.now(),dshConnected:true,answering:true}));beat();
 const events={},tools={},guards=[],logs=[],effects=[];let activeMode=mode;
 const sandbox={confine:async argv=>({argv:['/usr/bin/sandbox-exec','-p','old',...argv]})};
 const services={sandbox,shell:{sandboxMode:'workspace-write',resolve:r=>r},sandboxPolicy:{resolve:()=>({mode:activeMode})}};
 const agent={id:'session-'+path.basename(home),session:{header:{agentPreset:'hub-'+bot,cwd:own},append(){}}};
 const ctx={get:k=>services[k],logger:{error:m=>logs.push(['error',m]),warn:m=>logs.push(['warn',m])},effect:f=>effects.push(f()),on:(n,f)=>events[n]=f,workingDirectory:{get:s=>s.header.cwd},tools:{guard:f=>guards.push(f),register:t=>tools[t.name]=t,view:a=>{assert.equal(a,agent);return {visible:new Map([...expectedTools()[bot].filter(n=>!missing.includes(n)),...extra].map(n=>[n,{}]))};}}};
 const prev=process.env.HUB_HOME;process.env.HUB_HOME=base;try{apply(ctx,{bot});}finally{if(prev===undefined)delete process.env.HUB_HOME;else process.env.HUB_HOME=prev;}
 const exec=(args={},name='bash')=>({name,arguments:args,agent,callId:Symbol(),token:Symbol(),signal:new AbortController().signal});
 const pre=e=>events['tools/pre-execute'](e,async()=>({kind:'allow'}));
 const approve=async(e,outcome='allowed-once')=>{const d=await pre(e);assert.equal(d.kind,'ask');return events['approval/request']({agent,callId:e.callId,toolName:e.name,signal:e.signal,reason:d.reason},async()=>outcome);};
 const execute=e=>events['tools/execute'](e,async()=>{const request=services.shell.resolve({command:e.arguments.command});return {...await sandbox.confine(['bash','-c',e.arguments.command],{mode:activeMode}),request};});
 return {home,base,bot,own,events,tools,guards,logs,exec,pre,approve,execute,agent,beat,mode:m=>activeMode=m};
}
const accept=async()=>({kind:'accept'});
const args=(command='ls')=>({command,description:'隔离测试'});
test('HUB_HOME配置、名字和名单从安装配置或预设读取',()=>{const root=fixture(),c=loadHubConfig({home:root,hubHome:root+'/hub',read:false});assert.equal(c.heartbeat,root+'/hub/config/bff-heartbeat.json');assert.equal(c.grants,root+'/hub/config/command-grants.json');assert.deepEqual(c.bots,BOTS);assert.equal(parseFlatYaml(policyText(root+'/hub',root+'/kb')).base,root+'/hub');fs.mkdirSync(c.hubHome+'/config',{recursive:true});fs.writeFileSync(c.hubHome+'/config/hub.yaml',hubConfigText(c)+'bad: true\n');assert.throws(()=>loadHubConfig({home:root,hubHome:c.hubHome}));});
test('严格平面配置拒绝重复键与嵌套重复键',()=>{assert.throws(()=>parseFlatYaml('version: 1\nversion: 1\n'));assert.throws(()=>parseFlatYaml('names: {"a":1,"a":2}\n'));});
for(const key of ['run','git_readonly','script'])test('名单只能收紧 '+key,()=>{const p=JSON.parse(JSON.stringify(parsePolicy(policyText())));p['cmd_'+key]=[];assert.doesNotThrow(()=>parsePolicy(Object.entries(p).map(([k,v])=>k+': '+JSON.stringify(v)).join('\n')));assert.throws(()=>parsePolicy(policyText().replace('cmd_'+key+': '+JSON.stringify(CMD_DEFAULTS[key]),'cmd_'+key+': '+JSON.stringify([...CMD_DEFAULTS[key],'unsafe-new-program']))));});
for(const key of ['deny','ask_always'])test('禁止和先问名单只能增加 '+key,()=>{assert.throws(()=>parsePolicy(policyText().replace('cmd_'+key+': '+JSON.stringify(CMD_DEFAULTS[key]),'cmd_'+key+': []')));assert.doesNotThrow(()=>parsePolicy(policyText().replace('cmd_'+key+': '+JSON.stringify(CMD_DEFAULTS[key]),'cmd_'+key+': '+JSON.stringify([...CMD_DEFAULTS[key],'stricter']))));});
for(const key of ['timeout_ms','timeout_max_ms','output_bytes','grant_days'])test('数值上限只能降低 '+key,()=>{const row='cmd_'+key+': '+CMD_DEFAULTS[key];assert.throws(()=>parsePolicy(policyText().replace(row,'cmd_'+key+': '+(CMD_DEFAULTS[key]+1))));});
test('放行表每次读取，权限/链接/超大/重复键/格式错误都按空表',()=>{
 const dir=fixture(),file=dir+'/grants.json',errors=[],logger={error:m=>errors.push(m)};
 const grant={id:'G-20261117-120000-abcd',bot:BOTS[0],program:'sleep',dir,caps:{network:false,writeRoots:[]},by:'owner',on:'2026-11-17',until:'2026-12-17',tag:'#by/owner #on/2026-11-17 #until/2026-12-17',createdAt:'2026-11-17T03:00:00.000Z',cardId:'test',revokedAt:null};
 fs.writeFileSync(file,JSON.stringify({v:1,grants:[grant]}),{mode:0o600});assert.equal(readGrants(file,logger).length,1);
 fs.writeFileSync(file,JSON.stringify({v:1,grants:[]}));assert.equal(readGrants(file,logger).length,0);
 fs.chmodSync(file,0o644);assert.deepEqual(readGrants(file,logger),[]);fs.chmodSync(file,0o600);
 fs.symlinkSync(file,file+'.link');assert.deepEqual(readGrants(file+'.link',logger),[]);
 for(const text of ['x'.repeat(65537),'{"v":1,"v":1,"grants":[]}',JSON.stringify({v:1,grants:[{...grant,by:'agent'}]})]){fs.writeFileSync(file,text);assert.deepEqual(readGrants(file,logger),[]);}
 assert.equal(errors.length,5);
});
for(const field of ['sandbox_permissions','justification','run_in_background'])for(const value of [undefined,null,false,0,'',{}])test('bash字段存在即拒绝且不锁 '+field+' '+JSON.stringify(value),async()=>{const h=setup(),e=h.exec({...args(),[field]:value});assert.match((await h.pre(e)).reason,/跑命令不要带/);assert.equal((await h.pre(h.exec(args()))).kind,'allow');});
test('命令2000字上限',async()=>{const h=setup();assert.match((await h.pre(h.exec(args('x'.repeat(2001))))).reason,/2000/);});
test('run通过沙箱；网络默认关，临时目录只在own',async()=>{const h=setup(),e=h.exec(args());assert.equal((await h.pre(e)).kind,'allow');const r=await h.execute(e);assert.match(r.argv[2],/\(deny network\*\)/);assert.ok(r.argv.includes('TMPDIR='+h.own+'/.tmp'));assert.equal(fs.statSync(h.own+'/.tmp').mode&0o777,0o700);});
test('审批卡完整命令、why、cwd和能力；批准后执行',async()=>{const h=setup(),e=h.exec({...args('sleep 0'),description:'需要等待'}),d=await h.pre(e);assert.equal(d.kind,'ask');const p=JSON.parse(d.reason.slice(13));assert.equal(p.command,'sleep 0');assert.equal(p.cwd,h.own);assert.equal(p.timeoutMs,60000);assert.equal(p.why,'需要等待');assert.equal(p.action,'跑命令');assert.equal(p.grantable,false);assert.equal(await h.approve(e),'allowed-once');assert.ok((await h.execute(e)).argv.includes('sleep 0'));});
test('拒绝后不执行，并跨命令锁到真实用户输入',async()=>{const h=setup(),e=h.exec(args('sleep 0'));assert.equal(await h.approve(e,'rejected'),'rejected');await assert.rejects(()=>h.execute(e),/刚才这件事/);assert.match((await h.pre(h.exec(args('seq 1 3')))).reason,/刚才这件事/);h.events['agent/inbox/inserted']({agent:h.agent,message:{source:{kind:'user'},content:'新一轮'}});assert.equal((await h.pre(h.exec(args('sleep 0')))).kind,'ask');});
test('审批后完整命令变化被拒绝',async()=>{const h=setup(),e=h.exec(args('sleep 0'));await h.approve(e);e.arguments.command='sleep 1';assert.match(h.guards[0](e),/审批后命令或目录已变化/);});
test('审批后目录链接变化被拒绝',async()=>{const h=setup(),a=h.own+'/a',b=h.own+'/b',link=h.own+'/link';fs.mkdirSync(a);fs.mkdirSync(b);fs.symlinkSync(a,link);const e=h.exec({...args('sleep 0'),workdir:link});await h.approve(e);fs.renameSync(link,link+'.old');fs.symlinkSync(b,link);assert.match(h.guards[0](e),/审批后命令或目录已变化/);});
test('mode不是workspace-write执行前拒绝',async()=>{const h=setup(),e=h.exec(args());await h.pre(e);h.mode('danger-full-access');await assert.rejects(()=>h.execute(e),/命令沙箱没开/);});
test('未经过confine会报警并永久关闭后续bash',async()=>{const h=setup(),e=h.exec(args());await h.pre(e);await h.events['tools/execute'](e,async()=>42);assert.ok(h.logs.some(x=>x[1]==='hub-plugin 命令没经过沙箱'));assert.match((await h.pre(h.exec(args()))).reason,/命令沙箱没开/);});
test('额外工具触发全部拒绝及报警落盘，缺工具只warn',async()=>{const h=setup({extra:['unregistered']}),e=h.exec({file_path:h.own},'read');assert.match((await h.pre(e)).reason,/全部停用/);assert.match(fs.readFileSync(h.base+'/config/alerts.log','utf8'),/unregistered/);const m=setup({missing:['bash']});assert.equal((await m.pre(m.exec({file_path:m.own},'read'))).kind,'allow');assert.ok(m.logs.some(x=>x[0]==='warn'));});
test('本轮读过taint工具后命令升级先问，下一轮恢复',async()=>{const h=setup({taint:['read']});await h.events['agent/pre-step']({agent:h.agent,turn:1},async()=>({kind:'enter'}));await h.events['tools/post-execute'](h.exec({file_path:h.own},'read'),{isError:false},accept);assert.equal((await h.pre(h.exec(args()))).kind,'ask');await h.events['agent/pre-step']({agent:h.agent,turn:2},async()=>({kind:'enter'}));assert.equal((await h.pre(h.exec(args()))).kind,'allow');});
test('大输出存全文0600、只给前4KB并只记程序名',async()=>{const h=setup(),e=h.exec(args('echo marker-sensitive-text'));await h.pre(e);const full='中'.repeat(6000);const r=await h.events['tools/post-execute'](e,{isError:false,content:[{type:'text',text:full}]},accept);assert.ok(Buffer.byteLength(r.content[0].text)<4500);const files=fs.readdirSync(h.own+'/outputs');assert.equal(files.length,1);const file=h.own+'/outputs/'+files[0];assert.equal(fs.readFileSync(file,'utf8'),full);assert.equal(fs.statSync(file).mode&0o777,0o600);const log=fs.readFileSync(h.base+'/config/actions.log','utf8');assert.match(log,/programs=echo/);assert.doesNotMatch(log,/marker-sensitive-text/);});
test('超时保留原始结果并加说明',async()=>{const h=setup(),e=h.exec(args('sleep 70'));await h.approve(e);const r=await h.events['tools/post-execute'](e,{isError:false,content:[{type:'text',text:'[timed out after 60000ms]'}]},accept);assert.ok(r.content.some(c=>c.text==='（超过时限被停了）'));assert.equal(r.content.at(-1).text,'（主人 已在手机上批准，已跑）');});

test('收紧默认超时会传给真正shell，不依赖内核缺省',async()=>{const h=setup({timeout:1000}),e=h.exec(args());await h.pre(e);const r=await h.execute(e);assert.equal(r.request.timeoutMs,1000);assert.equal(r.request.workdir,h.own);});
test('审批中新增记住规则不会改变本次卡片，下一次才用grant',async()=>{const h=setup(),e=h.exec(args('seq 1 3'));await h.approve(e);const g={id:'G-20261117-120000-abcd',bot:h.bot,program:'seq',dir:h.own,caps:{network:false,writeRoots:[]},by:'owner',on:'2026-11-17',until:'2099-12-17',tag:'#by/owner #on/2026-11-17 #until/2099-12-17',createdAt:'2026-11-17T03:00:00.000Z',cardId:'test',revokedAt:null};fs.writeFileSync(h.base+'/config/grants.json',JSON.stringify({v:1,grants:[g]}),{mode:0o600});assert.equal(h.guards[0](e),undefined);assert.ok((await h.execute(e)).argv.includes('seq 1 3'));assert.equal((await h.pre(h.exec(args('seq 1 3')))).kind,'allow');});

test('B真实卡片经C解析、先保存放权再批准、执行及撤销互通',async()=>{const h=setup(),e=h.exec(args('seq 1 3')),d=await h.pre(e),meta=parseApproval(d.reason);assert.ok(meta);const g=new CommandGrants({configDir:h.base+'/config',atomicFile});Object.defineProperty(g,'file',{value:h.base+'/config/grants.json'});const outcome=await h.events['approval/request']({agent:h.agent,callId:e.callId,toolName:'bash',signal:e.signal,reason:d.reason},async()=>{await g.remember({...meta,id:'fixture-card'},'fixture-device');return 'allowed-once';});assert.equal(outcome,'allowed-once');assert.equal(readGrants(g.file).length,1);assert.ok((await h.execute(e)).argv.includes('seq 1 3'));assert.equal((await h.pre(h.exec(args('seq 1 3')))).kind,'allow');await g.revoke(readGrants(g.file)[0].id,'fixture-device');assert.equal((await h.pre(h.exec(args('seq 1 3')))).kind,'ask');});
test('内核spill恢复全文不混入截断提示或无关字符',async()=>{const h=setup(),e=h.exec(args('echo fixture'));await h.pre(e);const spill=h.own+'/kernel-output.txt',body='1\n2\n300000\n';fs.writeFileSync(spill,body);const r=await h.events['tools/post-execute'](e,{isError:false,value:{kind:'foreground',stdout:{truncated:true,spillPath:spill,text:'tail'},stderr:{truncated:false,text:''}},content:[{type:'text',text:'[output truncated]'}]},accept);const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join('');assert.ok(!text.includes('truncated'));assert.ok(text.startsWith(body));});
