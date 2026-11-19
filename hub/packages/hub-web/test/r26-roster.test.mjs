import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHubWeb} from '../server.mjs';
import {startMockBff} from './mock-bff.mjs';
const require=createRequire(import.meta.url);
const {normalizeRoster,validateName,validateAvatarFile,rosterChanges,approvalTitle,approvalResult}=require('../hub-real.js');
test('F 名册：排序、动态 id、停用保留，坏名册不回退演示名单',()=>{
 const b={id:'b1234abcd',name:'新助理',role:'bot',status:'active',order:8};
 assert.deepEqual(normalizeRoster({bots:[b,{...b,id:'leader',role:'chief',order:0,status:'disabled'}]}).bots.map(b=>b.id),['leader','b1234abcd']);
 for(const data of [{},{bots:[b,b]},{bots:[{...b,id:'../bad'}]},{bots:[{...b,status:'unknown'}]}])assert.throws(()=>normalizeRoster(data));
});
test('F 名字：Unicode 字数、路径与空白、停用者重名、自身改名',()=>{
 const bots=[{id:'one',name:'小助理',status:'disabled'}];
 assert.equal(validateName('😀'.repeat(8),bots,'new'),'');
 for(const name of ['',' 九个字九个字九个字','a/b','a\\b','a:b','a.b','~a','a\n','a\t','a\x7f','a\x85','a\u2028b','😀'.repeat(9)])assert(validateName(name,bots,'new'));
 assert.match(validateName('CAFÉ',[{id:'other',name:'cafe\u0301'}],'new'),/重名/);
 assert.match(validateName('小助理',bots,'new'),/重名/);assert.equal(validateName('小助理',bots,'one'),'');
});
test('F 上传：2MB 边界、扩展名与 MIME 双校验，不收 SVG/伪图片',()=>{
 for(const [name,type] of [['x.png','image/png'],['X.JPG','image/jpeg'],['x.webp','image/webp'],['x.gif','image/gif']])assert.equal(validateAvatarFile({name,type,size:2*1024*1024}),'');
 for(const file of [null,{name:'x.png',type:'image/png',size:0},{name:'x.svg',type:'image/svg+xml',size:12},{name:'x.png',type:'text/html',size:12},{name:'x.jpg',type:'image/jpeg',size:2*1024*1024+1}])assert(validateAvatarFile(file));
});
test('F 确认卡：新建全列、修改只列变化，四种标题和写入失败不冒充批准',()=>{
 const after={name:'阿星',avatar:{kind:'shape',shape:'circle',color:'blue'},nameColor:'blue',duty:'整理',notDuty:'发送',phrases:['一','二','三']};
 assert.equal(rosterChanges(null,after).length,6);assert.deepEqual(rosterChanges(after,{name:'阿星',duty:'核对'}).map(v=>v.key),['duty']);
 assert.equal(approvalTitle({tool:'bot_create',botName:'首席'}),'首席想新建一个助理');
 assert.equal(approvalTitle({tool:'bot_update',botName:'首席',targetName:'阿星'}),'首席想改阿星的资料');
 for(const [status,label] of [['active','恢复'],['disabled','停用']])assert.equal(approvalTitle({tool:'bot_set_status',botName:'首席',targetName:'阿星',after:{status}}),'首席想'+label+'阿星');
 assert.equal(approvalResult({tool:'bot_create',status:'failed',failureReason:'磁盘写入失败'}),'没改成：磁盘写入失败');
 assert.equal(approvalResult({tool:'bot_update',status:'failed',reason:'roster-failed',note:'没改成：名字已占用'}),'没改成：名字已占用');
});
test('F 真实 web 代理：名册、PATCH、上传与图片登录保护，跨源不达上游',async()=>{
 const dir=await mkdtemp(join(process.env.HUB_WEB_TEST_TMP || tmpdir(),'f-roster-'));const shell=join(dir,'shell');await mkdir(shell);await writeFile(join(shell,'index.html'),'<body>假环境</body>');
 await writeFile(join(dir,'web.fixture'),'test-roster-web',{mode:0o600});await writeFile(join(dir,'bff.fixture'),'test-roster-bff',{mode:0o600});
 const fake=await startMockBff(),web=await createHubWeb({HUB_WEB_PORT:'0',HUB_WEB_HOSTS:'127.0.0.1',HUB_WEB_SHELL_DIR:shell,HUB_WEB_KEY_FILE:join(dir,'web.fixture'),BFF_KEY_FILE:join(dir,'bff.fixture'),BFF_URL:fake.url},{log:()=>{}}),url='http://127.0.0.1:'+web.servers[0].address().port;
 try {
  assert.equal((await fetch(url+'/bff/bots')).status,401);
  const login=await fetch(url+'/?key=test-roster-web',{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie,Origin:url,'Content-Type':'application/json','X-Hub-Device':'forged'};
  const roster=await (await fetch(url+'/bff/bots',{headers:{Cookie:cookie}})).json(),id=roster.bots[0].id,path='/bff/bots/'+id;
  const before=fake.stats.headers.length;
  for(const h of [{Cookie:cookie},{...headers,Origin:'https://elsewhere.invalid'},{...headers,'Sec-Fetch-Site':'cross-site'}])assert.equal((await fetch(url+path,{method:'PATCH',headers:h,body:'{"name":"试改"}'})).status,403);
  assert.equal(fake.stats.headers.length,before);
  assert.equal((await fetch(url+path,{method:'PATCH',headers,body:'{"name":"星星"}'})).status,200);
  assert.equal(fake.stats.patches.length,1);assert.notEqual(fake.stats.headers.at(-1).device,'forged');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V8AAAAASUVORK5CYII=','base64');
  assert.equal((await fetch(url+path+'/avatar',{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:png})).status,200);
  const image='/bff/avatars/'+id+'.png';assert.equal((await fetch(url+image)).status,401);assert.equal((await fetch(url+image,{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(url+path+'/avatar',{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:'fake'})).status,400);
 }finally{await web.close();await fake.close();}
});
