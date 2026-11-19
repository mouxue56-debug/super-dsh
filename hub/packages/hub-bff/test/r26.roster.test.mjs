import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir,stat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {Roster,validateRoster,validRosterCard,atomic} from '../lib/roster.mjs';
import {migrate} from '../ops/migrate-roster.mjs';
import {createHandler} from '../server.mjs';
import {formatTicket} from '../lib/delegation.mjs';
import {parseApproval} from '../lib/runtime.mjs';
import {imageType} from '../lib/avatars.mjs';
import {fixture,request,testDirectory} from './fixtures.mjs';
import {seedRoster,TEST_BOT_IDS,TEST_KINDS} from './roster-fixture.mjs';
const run=promisify(execFile),device={'x-hub-device':'roster-test'},reason=v=>'HUBAPPROVAL1 '+JSON.stringify(v);
const call=(f,method,path,value,extra={})=>request(f.handler,{method,path,value,headers:device,...extra});
const raw=(f,bytes,mime='image/png',filename)=>call(f,'POST','/bff/bots/art/avatar',undefined,{raw:bytes,headers:{...device,'content-type':mime,...(filename?{'content-disposition':'attachment; filename="'+filename+'"'}:{})}});
async function setup(fn){const f=await fixture();try{await fn(f);}finally{await f.dispose();}}
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await delay(5);}assert.fail('等待审批超时');}
function meta(f,changes={}) {return {v:1,bot:'chief',sessionId:'s1',level:'L3',action:'新建助理',tool:'bot_create',path:f.handler.roster.file,chars:0,preview:'新增测试助理',target:'new',before:null,after:{name:'新助理',avatar:{kind:'role',role:'art'},nameColor:'blue',duty:'整理草稿',notDuty:'不发消息',phrases:['开始整理']},why:'需要整理资料',...changes};}
async function ask(f,v=meta(f),id='roster-a') {
 const req={toolName:v.tool,callId:id,reason:reason(v)};
 f.source.records=[{event:{seq:1,type:'approval/asked',data:{id,...req}}}];
 const controller=new AbortController(),promise=f.handler.runtime.receive({eventId:id,agentId:v.sessionId,request:req},controller.signal);
 await until(()=>f.handler.runtime.cards().some(c=>c.id===id));return {promise,controller,card:f.handler.runtime.cards().find(c=>c.id===id)};
}
const answer=(f,id='roster-a',decision='approve')=>call(f,'POST','/bff/approvals/'+id+'/answer',{decision,note:'再细一点'});
async function migrationFixture(){
 const home=await testDirectory(),repo=join(home,'repo'),shell=join(repo,'packages/hub-web/shell-r23'),config=join(home,'config');
 await seedRoster(home);const original=JSON.parse(await readFile(join(config,'bots.yaml')));
 // 假环境从未迁移的六个旧目录开始；旧名册保全到测试 tmp。
 await (await import('node:fs/promises')).rename(join(config,'bots.yaml'),join(config,'seed.saved'));
 await mkdir(join(shell,'pets'),{recursive:true});await mkdir(join(repo,'packages/devinst'),{recursive:true});
 const block=original.bots.map((b,i)=>"  { id: '"+b.id+"', color: '#11223"+i+"', name: '"+b.name+"', duty: '旧职责' }").join(',\n');
 await writeFile(join(shell,'index.html'),'var BOT_SRC = [\n'+block+'\n];\nconst SHORT={'+original.bots.map(b=>b.id+":'首页职责'").join(',')+'};\n');
 await writeFile(join(shell,'pets/pack.json'),JSON.stringify({assistants:Object.fromEntries(TEST_BOT_IDS.map(id=>[id,{}])),spare:['spare-a','spare-b','spare-c']}));
 await writeFile(join(repo,'packages/devinst/presets-r24.phrases.json'),JSON.stringify(Object.fromEntries(TEST_BOT_IDS.map(id=>[id,['一','二','三']]))));
 for(const id of TEST_BOT_IDS)await writeFile(join(home,'bots',id,'AGENTS.md'),'旧说明 '+id);
 return {home,repo,shell,config};
}
test('迁移保留六个 id，按模板重写并备份；幂等重跑不改任何文件',async()=>{
 const f=await migrationFixture(),opts={hubHome:f.home,repoRoot:f.repo};
 const first=await migrate(opts);assert.equal(first.migrated,true);assert.deepEqual(first.ids,TEST_BOT_IDS);assert.equal(first.avatarKinds.roles.length,9);
 const roster=new Roster({hubHome:f.home});await roster.load();assert.deepEqual(roster.get('art').phrases,['一','二','三']);assert.equal(roster.get('chief').duty,'总调度 · 知识库');
 const files=await readdir(join(f.home,'bots/chief'));assert.equal(files.filter(s=>s.startsWith('AGENTS.md.bak-r26-')).length,1);
 assert.match(await readFile(join(f.home,'bots/support/AGENTS.md'),'utf8'),/40-客服\/客服场景规则.md/u);
 const path=join(f.config,'bots.yaml'),a=await stat(path),raw=await readFile(path,'utf8'),again=await migrate(opts),b=await stat(path);
 assert.equal(again.migrated,false);assert.equal(a.mtimeMs,b.mtimeMs);assert.equal(await readFile(path,'utf8'),raw);assert.equal(b.mode&0o777,0o600);
});
test('迁移中途失败恢复已经重写的 AGENTS，名册不发布',async()=>{
 const f=await migrationFixture();await (await import('node:fs/promises')).rename(join(f.home,'bots/art/AGENTS.md'),join(f.home,'bots/art/kept'));
 await assert.rejects(migrate({hubHome:f.home,repoRoot:f.repo}));assert.equal(await readFile(join(f.home,'bots/chief/AGENTS.md'),'utf8'),'旧说明 chief');await assert.rejects(stat(join(f.config,'bots.yaml')),{code:'ENOENT'});
});
test('名册严格校验，未知字段、非法 id、首席数、坏形象均失败关闭',()=>setup(async f=>{
 const v=structuredClone(f.handler.roster.value);for(const edit of [v=>v.extra=1,v=>v.bots[0].id='../x',v=>v.bots[1].role='chief',v=>v.bots[0].avatar={kind:'role',role:'unknown'},v=>v.bots[0].preset='other']){const bad=structuredClone(v);edit(bad);assert.throws(()=>validateRoster(bad,TEST_KINDS));}
}));
test('名册 API、预设、状态取当前名册；SSE 首帧和变动推 roster',()=>setup(async f=>{
 const data=await call(f,'GET','/bff/bots').json();assert.equal(data.bots.length,6);assert.equal(data.limits.maxActive,12);assert.deepEqual(data.avatarKinds,TEST_KINDS);assert(!('createdAt' in data.bots[0]));
 const events=call(f,'GET','/bff/events');await until(()=>events.res.text.includes('event: roster'));const changed=await call(f,'PATCH','/bff/bots/art',{name:'美术助理',phrases:['新短语']}).json();assert.equal(changed.bot.name,'美术助理');assert.match(events.res.text,/美术助理/);events.res.destroy();await events.done;
 assert.equal((await call(f,'GET','/bff/presets').json()).bots.find(b=>b.bot==='art').name,'美术助理');
}));
test('名字重名（含停用）、超长、路径字符、控制字符、首尾空白与空修改被拒',()=>setup(async f=>{
 await call(f,'PATCH','/bff/bots/support',{status:'disabled'}).done;
 for(const name of ['客服助理','123456789','a/b','a\\b','a:b','a.b','a~b',' x','x ','x\u0000','x\u0085','']){const r=call(f,'PATCH','/bff/bots/art',{name});await r.done;assert.equal(r.res.status,400,name);}
 for(const patch of [{},{duty:'插入 <!-- /hub:identity -->'}, {preset:'hub-chief'},{role:'chief'},{avatar:{kind:'role',role:'unknown'}},{nameColor:'unknown'},{avatar:{kind:'upload',file:'art.png',v:1}}]){const r=call(f,'PATCH','/bff/bots/art',patch);await r.done;assert.equal(r.res.status,400);}
}));
test('审批 before/after 形状严格，路径与 before 被二次核验',()=>setup(async f=>{
 const good=meta(f);assert.deepEqual(parseApproval(reason(good)),good);
 for(const v of [{...good,before:{}},{...good,after:{...good.after,role:'chief'}},{...good,after:{...good.after,avatar:{kind:'upload',file:'art.png',v:1}}},{...good,tool:'bot_update',action:'改助理',target:'art',before:{name:'艺术总监'},after:{duty:'新职责'}},{...good,why:'a\nb'}])assert.equal(parseApproval(reason(v)),null);
 const a=await ask(f,meta(f,{path:'/wrong/bots.yaml'}));await answer(f).done;assert.equal(await a.promise,'rejected');assert.equal(a.card.status,'failed');assert.equal(a.card.statusText,'没改成');
}));
test('批准后才创建目录、通用预设、identity 和名册；动态 id 可创建会话与进入状态',()=>setup(async f=>{
 const a=await ask(f);assert.equal(f.handler.roster.ids().length,6);const shown=await call(f,'GET','/bff/approvals').json();assert.deepEqual(shown.approvals[0].before,null);assert.deepEqual(shown.approvals[0].after,meta(f).after);
 const data=await answer(f).json();assert.equal(await a.promise,'allowed-once');const id=data.card.appliedTarget;assert.match(id,/^b[0-9a-f]{8}$/);const b=f.handler.roster.get(id);assert.equal(b.preset,'hub-bot');assert.equal(b.role,'bot');
 for(const part of ['drafts','notes','memory'])assert((await stat(join(f.botsDir,id,part))).isDirectory());assert.match(await readFile(join(f.botsDir,id,'AGENTS.md'),'utf8'),/整理草稿/u);
 const r=call(f,'POST','/bff/sessions',{bot:id});await r.done;assert.equal(r.res.status,201);assert.equal(f.source.named('session/create').at(-1).request.agentPreset,'hub-bot');assert.equal(f.source.named('session/create').at(-1).request.cwd,join(f.botsDir,id));assert(id in (await call(f,'GET','/bff/status').json()).bots);
 await f.handler.dispose();f.handler=createHandler({client:f.client,key:f.key,...f.handlerOptions});await f.handler.ready;assert.equal((await call(f,'GET','/bff/sessions?bot='+id).json()).sessions.length,1);assert.equal(f.handler.roster.get(id).preset,'hub-bot');
 const log=await readFile(join(f.handlerOptions.configDir,'bots.changes.log'),'utf8');assert.match(log,/\tchief\t新建助理\tb[0-9a-f]{8}\t/);assert(!log.includes('整理草稿'));assert.match(log,/\troster-test\n$/);
}));
test('12 个上限在锁内校验；并发新建只准一个，恢复也受上限约束',()=>setup(async f=>{
 for(let n=0;n<5;n++)await f.handler.roster.approve(meta(f,{after:{...meta(f).after,name:'测试'+n}}),'test');
 const values=await Promise.allSettled([f.handler.roster.approve(meta(f,{after:{...meta(f).after,name:'第十二'}}),'test'),f.handler.roster.approve(meta(f,{after:{...meta(f).after,name:'第十三'}}),'test')]);assert.equal(values.filter(v=>v.status==='fulfilled').length,1);assert.equal(f.handler.roster.ids().length,12);
 await f.handler.roster.patch('art',{status:'disabled'},'test');await f.handler.roster.approve(meta(f,{after:{...meta(f).after,name:'替补'}}),'test');await assert.rejects(f.handler.roster.patch('art',{status:'active'},'test'),/最多 12/u);
}));
test('BFF 拒绝非首席新建、改别人、停用；自己改资料可批准',()=>setup(async f=>{
 await f.handler.runtime.store.add({id:'s-art',bot:'art',title:'测试',lastText:'',lastRole:null,updatedAt:1,unread:0,running:false});
 let n=0;
 for(const change of [{},{tool:'bot_update',action:'改助理',target:'content',before:{name:'内容助理'},after:{name:'编辑'}},{tool:'bot_set_status',action:'停用助理',target:'art',before:{status:'active'},after:{status:'disabled'}}]){
   const id='denied-'+n++,a=await ask(f,meta(f,{bot:'art',sessionId:'s-art',...change}),id);await answer(f,id).done;assert.equal(await a.promise,'rejected');assert.equal(a.card.status,'failed');assert.match(a.card.note,/只有首席/u);
 }
 const a=await ask(f,meta(f,{bot:'art',sessionId:'s-art',tool:'bot_update',action:'改助理',target:'art',before:{name:'艺术总监'},after:{name:'美术'}}),'own');await answer(f,'own').done;assert.equal(await a.promise,'allowed-once');assert.equal(f.handler.roster.get('art').name,'美术');
}));
test('卡过时或落盘/日志失败时 rejected，身份及名册恢复，卡标没改成',()=>setup(async f=>{
 let a=await ask(f,meta(f,{tool:'bot_update',action:'改助理',target:'art',before:{name:'艺术总监'},after:{name:'美术'}}));await f.handler.roster.patch('art',{name:'画师'},'test');await answer(f).done;assert.equal(await a.promise,'rejected');assert.equal(f.handler.roster.get('art').name,'画师');
 const roster=f.handler.roster,original=roster.log;roster.log=async()=>{throw Error('模拟磁盘失败');};a=await ask(f,meta(f),'failed-create');await answer(f,'failed-create').done;assert.equal(await a.promise,'rejected');assert.equal(a.card.status,'failed');assert.equal(roster.ids().length,6);assert.equal(JSON.parse(await readFile(roster.file)).bots.length,6);assert.equal((await readdir(f.botsDir)).length,6);
 a=await ask(f,meta(f,{tool:'bot_update',action:'改助理',target:'art',before:{name:'画师'},after:{name:'新名'}}),'failed-update');await answer(f,'failed-update').done;assert.equal(await a.promise,'rejected');assert.match(await readFile(join(f.botsDir,'art/AGENTS.md'),'utf8'),/# 画师/u);roster.log=original;
}));
test('改一下不落盘；保留现有 revise 入队',()=>setup(async f=>{
 const sent=[];f.handler.runtime.send=async(...args)=>sent.push(args);const a=await ask(f);const r=await answer(f,'roster-a','revise').json();assert.equal(r.card.status,'revised');assert.equal(await a.promise,'rejected');await until(()=>sent.length);assert.match(sent[0][1],/再细一点/u);assert.equal(f.handler.roster.ids().length,6);
}));
test('主人 PATCH 要设备，不改权限；identity 外正文与 memory/drafts/notes 原样保留；先留0600备份',()=>setup(async f=>{
 const no=call(f,'PATCH','/bff/bots/art',{name:'美术'},{headers:{}});await no.done;assert.equal(no.res.status,400);
 const dir=join(f.botsDir,'art'),path=join(dir,'AGENTS.md');await writeFile(path,(await readFile(path,'utf8'))+'\n自有附注\n');for(const part of ['drafts','notes','memory']){await mkdir(join(dir,part));await writeFile(join(dir,part,'keep.txt'),'保留');}
 await call(f,'PATCH','/bff/bots/art',{name:'美术',duty:'新职责',notDuty:'不外发'}).done;const text=await readFile(path,'utf8');assert.match(text,/新职责/u);assert.match(text,/不外发/u);assert.match(text,/自有附注/u);
 for(const part of ['drafts','notes','memory'])assert.equal(await readFile(join(dir,part,'keep.txt'),'utf8'),'保留');
 const backups=(await readdir(f.handlerOptions.configDir)).filter(x=>x.startsWith('bots.yaml.bak-'));assert.equal(backups.length,1);for(const name of ['bots.yaml','bots.changes.log',...backups])assert.equal((await stat(join(f.handlerOptions.configDir,name))).mode&0o777,0o600);
}));
test('停用后旧会话只读，创建、发新消息与派工都被拦；恢复后可用',()=>setup(async f=>{
 await call(f,'PATCH','/bff/bots/chief',{status:'disabled'}).done;
 for(const [path,value] of [['/bff/sessions',{bot:'chief'}],['/bff/sessions/s1/messages',{text:'继续'}]]){const r=call(f,'POST',path,value);const data=await r.json();assert.equal(r.res.status,409);assert.equal(data.error.message,'这个助理已停用');}
 const r=call(f,'GET','/bff/sessions/s1/history');await r.done;assert.equal(r.res.status,200);assert.equal(f.source.named('session/prompt').length,0);await call(f,'PATCH','/bff/bots/chief',{status:'active'}).done;assert.equal(f.handler.roster.enabled('chief').status,'active');
 await call(f,'PATCH','/bff/bots/art',{status:'disabled'}).done;
 const ts=new Date().toISOString(),id='T-20261117-010101-abcd',ticket={meta:{id,kind:'delegation',creator:'chief',assignee:'art',status:'queued',createdAt:ts,updatedAt:ts,fromSession:'s1',toSession:'',steps:'0'},task:'整理草稿',progress:'',report:''};
 const working=join(f.handlerOptions.ticketsDir,'working');await mkdir(working,{recursive:true});await writeFile(join(working,id+'.md'),formatTicket(ticket));await f.handler.delegations.tick();assert.equal(f.handler.runtime.cards().find(c=>c.id===id).status,'failed');assert.equal(f.source.named('session/create').length,0);assert.equal(f.source.named('session/prompt').length,0);
}));
test('头像大于 2MB（含3MB）、假魔数、伪装扩展名及 MIME 不符被拒',()=>setup(async f=>{
 const r=raw(f,Buffer.alloc(3*1024*1024));await r.done;assert.equal(r.res.status,413);
 for(const [bytes,mime,filename] of [[Buffer.from('not-image'),'image/png','x.png'],[Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00','binary'),'image/gif','x.png'],[Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00','binary'),'image/png','x.gif']]){const r=raw(f,bytes,mime,filename);await r.done;assert.equal(r.res.status,415);}
}));
async function jpegWithExif(home) {
 const bmp=Buffer.alloc(54+4*4*3);bmp.write('BM');bmp.writeUInt32LE(bmp.length,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);bmp.writeInt32LE(4,18);bmp.writeInt32LE(4,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp.fill(180,54);
 const src=join(home,'own.bmp'),dst=join(home,'own.jpg');await writeFile(src,bmp);await run('/usr/bin/sips',['-s','format','jpeg',src,'--out',dst]);const b=await readFile(dst),label=Buffer.from('E2_TEST_EXIF\0'),tiff=Buffer.alloc(26+label.length);tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x010e,10);tiff.writeUInt16LE(2,12);tiff.writeUInt32LE(label.length,14);tiff.writeUInt32LE(26,18);label.copy(tiff,26);const payload=Buffer.concat([Buffer.from('Exif\0\0'),tiff]),marker=Buffer.alloc(4);marker[0]=255;marker[1]=225;marker.writeUInt16BE(payload.length+2,2);return Buffer.concat([b.subarray(0,2),marker,payload,b.subarray(2)]);
}
test('真实 sips 重编码、自制 JPG 的 EXIF 消失、0600、替换归档、只送登记头像',()=>setup(async f=>{
 const jpeg=await jpegWithExif(f.handler.roster.hubHome);assert(jpeg.includes(Buffer.from('Exif\0\0')));assert(jpeg.includes(Buffer.from('E2_TEST_EXIF')));
 let r=raw(f,jpeg,'image/jpeg','mine.jpg'),data=await r.json();assert.equal(r.res.status,200,JSON.stringify(data));assert.equal(data.bot.avatar.kind,'upload');const path=join(f.handler.roster.hubHome,'avatars/art.jpg'),encoded=await readFile(path);assert.equal(imageType(encoded),'jpg');assert(!encoded.includes(Buffer.from('Exif\0\0')));assert(!encoded.includes(Buffer.from('E2_TEST_EXIF')));assert.equal((await stat(path)).mode&0o777,0o600);
 r=call(f,'GET','/bff/avatars/art.jpg');await r.done;assert.equal(r.res.status,200);assert.match(r.res.headers['cache-control'],/^private/u);
 r=call(f,'GET','/bff/avatars/chief.jpg');await r.done;assert.equal(r.res.status,404);await raw(f,jpeg,'image/jpeg').done;assert.equal((await readdir(join(f.handler.roster.hubHome,'avatars/.old'))).length,1);
}));
test('multipart 单图上传，GIF 保持原样并校验尺寸；头像读写拒绝软链接',()=>setup(async f=>{
 const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64'),boundary='roster-test-boundary',body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="avatar"; filename="one.gif"\r\nContent-Type: image/gif\r\n\r\n'),gif,Buffer.from('\r\n--'+boundary+'--\r\n')]);
 const r=raw(f,body,'multipart/form-data; boundary='+boundary),d=await r.json();assert.equal(r.res.status,200,JSON.stringify(d));assert.deepEqual(await readFile(join(f.handler.roster.hubHome,'avatars/art.gif')),gif);
 const outside=join(f.handler.roster.hubHome,'kept-gif');await writeFile(outside,gif);await (await import('node:fs/promises')).rename(join(f.handler.roster.hubHome,'avatars/art.gif'),join(f.handler.roster.hubHome,'avatars/kept.gif'));await symlink(outside,join(f.handler.roster.hubHome,'avatars/art.gif'));
 const denied=call(f,'GET','/bff/avatars/art.gif');await denied.done;assert.notEqual(denied.res.status,200);assert.deepEqual(await readFile(outside),gif);
}));

test('AGENTS 真正写入失败时卡不批准，名册与上游保持不变',()=>setup(async f=>{
 const path=join(f.botsDir,'art/AGENTS.md');await (await import('node:fs/promises')).rename(path,path+'.kept');await mkdir(path);
 const a=await ask(f,meta(f,{tool:'bot_update',action:'改助理',target:'art',before:{duty:'测试职责'},after:{duty:'新职责'}}));await answer(f).done;assert.equal(await a.promise,'rejected');assert.equal(a.card.statusText,'没改成');assert.equal(f.handler.roster.get('art').duty,'测试职责');assert.equal(JSON.parse(await readFile(f.handler.roster.file)).bots.find(b=>b.id==='art').duty,'测试职责');
}));

test('名册落盘期间审批被撤回，不会在卡已失效后提交改动',()=>setup(async f=>{
 const rt=f.handler.runtime,roster=f.handler.roster,oldLog=roster.log.bind(roster);let entered,release;const barrier=new Promise(ok=>entered=ok);
 roster.log=async(...args)=>{await oldLog(...args);entered();await new Promise(ok=>release=ok);};
 const a=await ask(f),response=answer(f);await barrier;a.controller.abort();assert.equal(await a.promise,'rejected');release();await response.done;assert.equal(a.card.status,'unavailable');assert.equal(roster.ids().length,6);assert.equal(JSON.parse(await readFile(roster.file)).bots.length,6);
}));

test('已有名册而配套清单缺失时停止，不误判成未迁移并覆盖名册',async()=>{
 const f=await migrationFixture();await migrate({hubHome:f.home,repoRoot:f.repo});const path=join(f.config,'bots.yaml'),before=await readFile(path,'utf8'),agentsBefore=await readFile(join(f.home,'bots/chief/AGENTS.md'),'utf8');await (await import('node:fs/promises')).rename(join(f.config,'avatar-kinds.json'),join(f.config,'avatar-kinds.kept'));await assert.rejects(migrate({hubHome:f.home,repoRoot:f.repo}),{code:'ENOENT'});assert.equal(await readFile(path,'utf8'),before);assert.equal(await readFile(join(f.home,'bots/chief/AGENTS.md'),'utf8'),agentsBefore);
});
