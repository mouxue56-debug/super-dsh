import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHubWeb} from '../../hub-web/server.mjs';
import {testDirectory} from './fixtures.mjs';
test('名册与头像通过真实 web 代理：设备身份重建、只准登录取图、原始/分块上传上限',async()=>{
 const dir=await testDirectory(),shell=join(dir,'shell');await mkdir(shell);await writeFile(join(shell,'index.html'),'<html><body>离线壳</body></html>');
 await writeFile(join(dir,'web.fixture'),'offline-roster-web',{mode:0o600});await writeFile(join(dir,'bff.fixture'),'offline-roster-bff',{mode:0o600});
 const calls=[];const upstream=http.createServer((req,res)=>{req.on('error',()=>{});res.on('error',()=>{});let bytes=0;req.on('data',p=>{bytes+=p.length;});req.on('end',()=>{calls.push({path:req.url,method:req.method,headers:req.headers,bytes});res.writeHead(200,{'Content-Type':req.url.startsWith('/bff/avatars/')?'image/gif':'application/json'});res.end(req.url.startsWith('/bff/avatars/')?'GIF89a':'{"ok":true}');});});upstream.on('clientError',()=>{});
 await new Promise(ok=>upstream.listen(0,'127.0.0.1',ok));
 const app=await createHubWeb({HUB_WEB_PORT:'0',HUB_WEB_HOSTS:'127.0.0.1',HUB_WEB_SHELL_DIR:shell,HUB_WEB_KEY_FILE:join(dir,'web.fixture'),BFF_KEY_FILE:join(dir,'bff.fixture'),BFF_URL:'http://127.0.0.1:'+upstream.address().port},{log:()=>{}});
 const url='http://127.0.0.1:'+app.servers[0].address().port;
 try {
   assert.equal((await fetch(url+'/bff/avatars/art.gif')).status,401);assert.equal(calls.length,0);
   const login=await fetch(url+'/?key=offline-roster-web',{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie,Origin:url,'X-Hub-Device':'forged'};
   assert.equal((await fetch(url+'/bff/avatars/art.gif',{headers:{Cookie:cookie}})).status,200);
   const image=await fetch(url+'/bff/avatars/art.gif',{headers:{Cookie:cookie}});assert.match(image.headers.get('cache-control'),/^private/u);assert.equal(image.headers.get('content-type'),'image/gif');await image.arrayBuffer();
   for(const bad of [{Origin:url},{Cookie:cookie},{...headers,Origin:'https://invalid.test'}])assert.equal((await fetch(url+'/bff/bots/art',{method:'PATCH',headers:{...bad,'Content-Type':'application/json'},body:'{"name":"美术"}'})).status,403);
   assert.equal((await fetch(url+'/bff/bots/art',{method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:'{"name":"美术"}'})).status,200);
   const bytes=Buffer.alloc(1500000,1);assert.equal((await fetch(url+'/bff/bots/art/avatar',{method:'POST',headers:{...headers,'Content-Type':'image/png','Content-Disposition':'attachment; filename="sample.png"'},body:bytes})).status,200);
   const uploaded=calls.at(-1);assert.equal(uploaded.bytes,bytes.length);assert.equal(uploaded.headers['content-disposition'],'attachment; filename="sample.png"');assert.match(uploaded.headers['x-hub-device'],/^[a-f0-9]{16}$/);assert.notEqual(uploaded.headers['x-hub-device'],'forged');
   const count=calls.length;assert.equal((await fetch(url+'/bff/bots/art/avatar',{method:'POST',headers:{...headers,'Content-Type':'image/png'},body:Buffer.alloc(3*1024*1024)})).status,413);assert.equal(calls.length,count);
   const chunked=await new Promise((ok,fail)=>{const req=http.request(url+'/bff/bots/art/avatar',{method:'POST',headers:{...headers,'Content-Type':'image/png','Transfer-Encoding':'chunked'}},res=>{res.resume();res.on('end',()=>ok(res.statusCode));});req.on('error',fail);for(let i=0;i<48;i++)req.write(Buffer.alloc(65536));req.end();});assert.equal(chunked,413);
 }finally{await app.close();upstream.closeAllConnections();await new Promise(ok=>upstream.close(ok));}
});
