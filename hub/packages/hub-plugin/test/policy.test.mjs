import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BOTS,AREAS,TABLE,policyText,parsePolicy,canonicalize,resolveFacts,decide,evaluate,inspectTicket,loadPolicy} from '../policy.mjs';
import {createTicket,updateTicket,moveTicket,botStatus,appendAction} from '../tickets.mjs';
fs.mkdirSync(path.join(os.homedir(),'dsh-work/tmp/r26-B'),{recursive:true});
const temp=fs.realpathSync.native(fs.mkdtempSync(path.join(os.homedir(),'dsh-work/tmp/r26-B/','fixture-'))),base=temp+'/dsh-work',kb=temp+'/knowledge-base';
for(const p of [...BOTS.map(b=>base+'/bots/'+b),base+'/shared',base+'/config',base+'/dev-home-r23',kb+'/40-客服',kb+'/10-其他'])fs.mkdirSync(p,{recursive:true});
const policy=parsePolicy(policyText(base,kb)),cwd=base+'/bots/chief';
const check=(bot,tool,args,dir=base+'/bots/'+bot)=>evaluate(policy,bot,tool,args,dir);
for(const bot of BOTS)for(const [tool,levels]of Object.entries(TABLE))for(const [i,area]of AREAS.entries())test(`纯决策矩阵 ${bot} ${tool} ${area}`,()=>{
 const args={bot:'pm',task:'测试'},facts={area,path:'/模拟路径',known:true,blocked:false};
 let expected=levels[i];if(area==='kb'&&bot!=='support')expected='L4';if(tool==='delegate_to_bot'&&bot!=='chief')expected='L4';
 assert.equal(decide(bot,tool,args,cwd,policy,facts).level,expected);
});
for(const [label,bot,target]of [
 ['绝对路径','chief','/etc/passwd'],['父级越界','chief','../../dev-home-r23/x'],['相对他人','support','../chief/x'],
 ['绝对大小写变体','chief',base.replace('dsh-work','DSH-work')+'/shared/../dev-home-r23'],
 ['全路径大写','chief',(base+'/dev-home-r23').toUpperCase()],['Unicode NFC','support',kb+'/40-客服/医院'.normalize('NFD')],
 ['全角点','chief',cwd+'/．．/dev-home-r23'],['新文件父级','chief',cwd+'/not-exists/../x'],
 ['知识库非白名单','support',kb+'/10-其他'],['其他助理知识库','pm',kb+'/40-客服'],
 ...['医院','病历','医疗','密钥','凭据','secrets','.env','聊天记录','SeCrEtS'].map(w=>['禁用字样'+w,'support',kb+'/40-客服/'+w])
])test('路径守卫 '+label,()=>assert.equal(check(bot,'read',{file_path:target}).level,'L4'));
for(const [label,target]of [['secrets',temp+'/.secrets'],['dev-home-r23',base+'/dev-home-r23']]){
 const link=cwd+'/link-'+label;fs.symlinkSync(target,link);
 test('符号链接指出 '+label,()=>assert.equal(check('chief','read',{file_path:link}).level,'L4'));
}
for(const tool of ['write','edit'])test('知识库禁止写 '+tool,()=>assert.equal(check('support',tool,{file_path:kb+'/40-客服/test'}).level,'L4'));
test('客服知识库白名单只读',()=>assert.equal(check('support','read',{file_path:kb+'/40-客服'}).level,'L0'));
test('NFC目录及大小写按实际目录解析',()=>{const p=cwd+'/café';fs.mkdirSync(p);assert.equal(canonicalize('CAFÉ',cwd),p);});
test('未知工具拒绝',()=>assert.equal(check('chief','bash',{}).level,'L4'));
test('非chief派活拒绝',()=>assert.equal(check('pm','delegate_to_bot',{bot:'art',task:'任务'}).level,'L4'));
test('派给chief及超长任务拒绝',()=>{for(const a of [{bot:'chief',task:'x'},{bot:'pm',task:'x'.repeat(2001)}])assert.equal(check('chief','delegate_to_bot',a).level,'L4');});
test('共享区写需要L3、读L0（Fable 18:42）',()=>{assert.equal(check('chief','write',{file_path:base+'/shared/new.md'}).level,'L3');assert.equal(check('chief','read',{file_path:base+'/shared'}).level,'L0');});
test('工单原子写、creator分级、delegation只能BFF改、改栏',()=>{
 const t=createTicket(policy,'chief',{title:'备注',body:'任务原文'});
 assert.match(t.id,/^T-\d{8}-\d{6}-[a-f0-9]{4}$/);assert.equal(fs.statSync(t.path).mode&0o777,0o600);
 assert.equal(check('chief','ticket_update',{id:t.id}).level,'L1');assert.equal(check('pm','ticket_update',{id:t.id}).level,'L3');
 assert.throws(()=>updateTicket(policy,'pm',{id:t.id,append:'no'}));updateTicket(policy,'pm',{id:t.id,append:'已批准'},true);
 moveTicket(policy,'chief',{id:t.id,to:'done'});assert.equal(inspectTicket(policy,t.id).col,'done');
 const d=createTicket(policy,'chief',{title:'派活',body:'做任务',assignee:'pm',sessionId:'session-test'},true);
 assert.match(fs.readFileSync(d.path,'utf8'),/fromSession: session-test/);assert.equal(check('chief','ticket_update',{id:d.id}).level,'L4');
 assert.throws(()=>moveTicket(policy,'chief',{id:d.id,to:'done'}));assert.equal(botStatus(policy).find(b=>b.bot==='pm').queued,1);
});
test('工单恶意编号拒绝',()=>assert.equal(check('chief','ticket_move',{id:'../../x',to:'done'}).level,'L4'));
test('工单根symlink拒绝',()=>{const b=temp+'/bad';fs.mkdirSync(b);fs.symlinkSync(base+'/tickets',b+'/tickets');const p=parsePolicy(policyText(b,kb));assert.equal(evaluate(p,'chief','ticket_create',{},cwd).level,'L4');});
test('L1日志不记正文且0600',()=>{appendAction(policy,'chief','write',cwd+'/x','L1');const p=base+'/config/actions.log';assert.equal(fs.statSync(p).mode&0o777,0o600);assert.match(fs.readFileSync(p,'utf8'),/chief\twrite\t.*\tL1\n/);});
for(const [label,text]of [['重复键',policyText()+'version: 1\n'],['未知键',policyText()+'no: true\n'],['坏JSON',policyText().replace('version: 1','version: nope')],['弱化L4',policyText().replace('"outside":"L4"','"outside":"L0"')],['遗漏',policyText().replace(/^read: .*\n/m,'')]])test('严格解析 '+label,()=>assert.throws(()=>parsePolicy(text)));
test('权限表启动只读一次，坏表失败关闭',()=>{const file=temp+'/table.yaml';fs.writeFileSync(file,policyText());const a=loadPolicy(file);fs.writeFileSync(file,'bad');assert.equal(loadPolicy(file),a);assert.ok(loadPolicy(temp+'/absent').error);assert.equal(evaluate(undefined,'chief','read',{file_path:cwd},cwd).level,'L4');});

test('嵌套重复键也严格拒绝',()=>assert.throws(()=>parsePolicy(policyText().replace('"support":["40-客服"]','"support":["40-客服"],"support":["40-客服"]'))));
test('新文件剩余段含父级不允许',()=>assert.equal(check('chief','write',{file_path:'newdir/../x'}).level,'L4'));

for(const bot of BOTS)for(const tool of ['write','edit'])for(const name of ['AGENTS.md','agents.MD'])test('根指令只读 '+bot+' '+tool+' '+name,()=>{const file=base+'/bots/'+bot+'/'+name;assert.equal(check(bot,tool,{file_path:file}).level,'L4');assert.equal(check(bot,'read',{file_path:file}).level,'L0');});
test('根指令通过别名链接也不能写',()=>{const file=cwd+'/AGENTS.md';fs.writeFileSync(file,'保护');const alias=cwd+'/alias-instructions.md';fs.symlinkSync(file,alias);assert.equal(check('chief','write',{file_path:alias}).level,'L4');});
test('根指令保护不允许从表弱化',()=>assert.throws(()=>parsePolicy(policyText().replace('own_root_agents_write: "L4"','own_root_agents_write: "L1"'))));
