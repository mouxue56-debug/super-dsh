import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {toolText,shortPath,outputPreview,surfaceEntries,toolRun}=require('../hub-real.js');
test('r26 目录短写只依据状态返回的根，防止相似前缀误缩短',()=>{
 const root='/fixture/hub';assert.equal(shortPath(root+'/bots/pm/notes',root),'bots/pm/notes');
 assert.equal(shortPath(root,root),'.');assert.equal(shortPath(root+'-other/file',root),root+'-other/file');
 assert.equal(shortPath('/unrelated/file',''),'/unrelated/file');
});
test('r26 命令成功/等待/批准与拒绝分别表述，批准不冒充执行',()=>{
 const t={name:'bash',command:'猫'.repeat(60)};
 assert.equal(toolText({...t,status:'ok'}),'跑了命令：'+'猫'.repeat(40));
 for(const status of ['pending','approved','running'])assert(!toolText({...t,status}).startsWith('跑了命令'));
 for(const status of ['denied','rejected','unavailable','revised'])assert.match(toolText({...t,status,brief:'没有获得批准'}),/^这条命令没跑：没有获得批准$/);
 assert.match(toolText({...t,status:'error',brief:'执行失败'}),/命令没跑完：执行失败/);
});
test('r26 输出上限按 UTF8 字节计，表情不会切半',()=>{
 assert.equal(outputPreview('😀'.repeat(1024)).truncated,false);
 const p=outputPreview('a😀'.repeat(1000));assert(p.truncated);assert(Buffer.byteLength(p.text)<=4096);assert(!p.text.includes('�'));
 assert.equal(outputPreview('x'.repeat(4097)).text.length,4096);
});
test('r26 相同命令工具更新合并，完整命令和真实输出保留',()=>{
 const t={id:'bash1',name:'bash',command:'printf "<script>example</script>"',cwd:'/fixture/bots/pm',status:'running'};
 const values=surfaceEntries([{role:'assistant',text:'',tools:[t]},{role:'assistant',text:'',tools:[{...t,status:'ok',output:'实际输出'}]}]);
 assert.equal(values.length,1);assert.equal(values[0].command,t.command);assert.equal(values[0].output,'实际输出');
 const messages=[{hubToolId:'bash1',parts:[{data:values[0]}]},{hubToolId:'read1',parts:[{data:{id:'read1',name:'read'}}]}];
 assert.equal(toolRun(messages,'bash1').length,2);
});

test('r26 新写接口通过真实web代理：同源与设备隔离，remember/revoke 都可达',async()=>{
 const {mkdir,mkdtemp,writeFile}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const {createHubWeb}=await import('../server.mjs'),{startMockBff}=await import('./mock-bff.mjs');
 const root=process.env.HUB_WEB_TEST_TMP ?? tmpdir();await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'r26-web-')),shell=join(dir,'shell');await mkdir(shell);
 await writeFile(join(shell,'index.html'),'<html><body>离线壳</body></html>');await writeFile(join(dir,'web.fixture'),'r26-test-web',{mode:0o600});await writeFile(join(dir,'bff.fixture'),'r26-test-bff',{mode:0o600});
 const fake=await startMockBff(),web=await createHubWeb({HUB_WEB_PORT:'0',HUB_WEB_HOSTS:'127.0.0.1',HUB_WEB_SHELL_DIR:shell,HUB_WEB_KEY_FILE:join(dir,'web.fixture'),BFF_KEY_FILE:join(dir,'bff.fixture'),BFF_URL:fake.url},{log:()=>{}}),url='http://127.0.0.1:'+web.servers[0].address().port;
 try {
  const login=await fetch(url+'/?key=r26-test-web',{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie,Origin:url,'Content-Type':'application/json'};
  const post=(path,value={},h=headers)=>fetch(url+'/bff'+path,{method:'POST',headers:h,body:JSON.stringify(value)});
  await post('/__fixture',{id:'api-cmd',tool:'bash',grantable:true,grantKey:{program:'printf',dir:'/fixture/bots/chief'}});
  const before=fake.stats.headers.length;
  for(const h of [{Origin:url},{Cookie:cookie},{...headers,Origin:'null'},{...headers,'Sec-Fetch-Site':'cross-site'}])assert.equal((await post('/approvals/api-cmd/answer',{decision:'approve',remember:true},h)).status,403);
  assert.equal(fake.stats.headers.length,before);
  assert.equal((await post('/approvals/api-cmd/answer',{decision:'approve',remember:true},{...headers,'X-Hub-Device':'forged-device'})).status,200);
  const list=await (await fetch(url+'/bff/grants',{headers:{Cookie:cookie}})).json();assert.equal(list.grants.length,1);
  const path='/grants/'+list.grants[0].id+'/revoke';assert.equal((await post(path,{}, {Cookie:cookie})).status,403);assert.equal((await post(path,{}, {...headers,'X-Hub-Device':'forged-device'})).status,200);
  const upstream=fake.stats.headers.filter(h=>h.path.endsWith('/answer') || h.path.endsWith('/revoke'));assert.equal(upstream.length,2);assert(upstream.every(h=>/^[a-f0-9]{16}$/.test(h.device)&&h.device!=='forged-device'));
 }finally{await web.close();await fake.close();}
});
