import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { createHubWeb } from '../server.mjs';
import { startMockBff } from './mock-bff.mjs';

test('r24：设备签名、伪造头隔离、所有写请求来源门及旧 cookie 升级', async () => {
  const root=fileURLToPath(new URL('./scratch/',import.meta.url));await mkdir(root,{recursive:true});
  const dir=await mkdtemp(join(root,'r24-')),shell=join(dir,'shell');await mkdir(shell);
  await writeFile(join(shell,'index.html'),'<html><body>离线假壳</body></html>');
  await writeFile(join(dir,'web.fixture'),'r24-offline-web',{mode:0o600});await writeFile(join(dir,'bff.fixture'),'r24-offline-bff',{mode:0o600});
  const fake=await startMockBff();
  const env={HUB_WEB_PORT:'0',HUB_WEB_SHELL_DIR:shell,HUB_WEB_KEY_FILE:join(dir,'web.fixture'),BFF_KEY_FILE:join(dir,'bff.fixture'),BFF_URL:fake.url,HUB_WEB_TRUST_TAILNET:'1'};
  const app=await createHubWeb(env,{log:()=>{}}),url='http://127.0.0.1:'+app.servers[0].address().port;
  const login=async()=>{const r=await fetch(url+'/?key=r24-offline-web',{redirect:'manual'});assert.equal(r.status,303);return r.headers.get('set-cookie').split(';')[0];};
  try {
    const cookie=await login(),cookie2=await login(),headers={Cookie:cookie,Origin:url,'Content-Type':'application/json'};
    const get=async(c,extra={})=>{assert.equal((await fetch(url+'/bff/status',{headers:{Cookie:c,...extra}})).status,200);return fake.stats.headers.at(-1).device;};
    const id=await get(cookie,{'X-Hub-Device':'attacker'});assert.match(id,/^[a-f0-9]{16}$/);assert.equal(await get(cookie),id);assert.notEqual(await get(cookie2),id);
    assert(!cookie.includes(id));
    const post=(h,path='/bff/approvals/approval-1/answer')=>fetch(url+path,{method:'POST',headers:h,body:'{"decision":"approve"}'});
    const n=fake.stats.headers.length;
    for(const h of [{Origin:url},{...headers,Cookie:''},{...headers,Cookie:cookie.slice(0,-1)+'x'},{Cookie:cookie},{...headers,Origin:'null'},{...headers,Origin:'http://example.invalid'},{...headers,'Sec-Fetch-Site':'same-site'},{...headers,'Sec-Fetch-Site':'none'},{...headers,'Sec-Fetch-Site':'cross-site'}]) assert.equal((await post(h)).status,403);
    assert.equal((await post({Cookie:cookie},'/bff/sessions')).status,403);
    assert.equal(fake.stats.headers.length,n,'拒绝请求不可抵达 BFF');
    const ok=await post({...headers,'X-Hub-Device':'spoof','Sec-Fetch-Site':'same-origin'});assert.equal(ok.status,200);assert.equal(fake.stats.headers.at(-1).device,id);
    const idem=await fetch(url+'/bff/sessions/chief-latest/messages',{method:'POST',headers:{...headers,'Idempotency-Key':'test-idem'},body:'{"text":"离线","idem":"test-idem"}'});assert.equal(idem.status,202);assert.equal(fake.stats.headers.at(-1).idem,'test-idem');
    const legacy=createHmac('sha256','r24-offline-web').update('hub-web-cookie-v1').digest('base64url');
    const migrated=await fetch(url,{headers:{Cookie:'hub_web_session='+legacy}});assert.equal(migrated.status,200);assert.match(migrated.headers.get('set-cookie'),/hub_web_session=[a-f0-9]{32}\./);
    assert.equal((await post({...headers,Cookie:'hub_web_session='+legacy})).status,403);
    const trusted=await fetch(url);assert.equal(trusted.status,200);assert.match(trusted.headers.get('set-cookie'),/hub_web_session=[a-f0-9]{32}\./);
  } finally {await app.close();await fake.close();}
});
