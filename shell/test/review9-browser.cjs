const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const pick = a => a.find(x => x && fs.existsSync(x));
const pw = require(pick([process.env.PLAYWRIGHT_CORE, path.join(os.homedir(), 'node_modules/playwright-core'), path.join(os.homedir(), 'node_modules/playwright-core')]));
const chrome = pick([process.env.CHROMIUM, path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')]);
let server, browser;
before(async () => {
  browser=await pw.chromium.launch({headless:true,executablePath:chrome});
});
after(async()=>{if(browser)await browser.close();if(server)await new Promise(ok=>server.close(ok));});
async function page(init) {
  const p=await browser.newPage({viewport:{width:390,height:844}});
  await p.route('**/*', async r => { const u=new URL(r.request().url()); if(u.hostname!=='127.0.0.1'||u.port!=='3771') return r.abort(); const f=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname))); if(!f.startsWith(root+path.sep))return r.abort(); try {const body=fs.readFileSync(f);const contentType={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[path.extname(f)]||'application/octet-stream';await r.fulfill({status:200,contentType,body});}catch(e){await r.fulfill({status:404,body:'missing'});} });
  if(init) await p.addInitScript(init);
  await p.goto('http://127.0.0.1:3771/');
  await p.waitForFunction(()=>window.Hub && window.state && state.bots.length && window.HubPlainTalk);
  return p;
}
test('看板工单标题不能注入事件属性',async()=>{const p=await page();try{
  const result=await p.evaluate(()=>{state.boardScope='all'; state.boardView='columns'; const c=state.cards[0];c.title='标题" onmouseover="window.__review9=1'; const box=document.createElement('div');box.innerHTML=boardView();const card=box.querySelector('.kcard'); document.body.append(box);card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));return {event:card.getAttribute('onmouseover'),hit:window.__review9||0};});
  assert.equal(result.event,null,JSON.stringify(result));assert.equal(result.hit,0);
}finally{await p.close();}});
test('确认卡折叠时必须展示真实命令而非仅听信理由',async()=>{const p=await page();try{
  const x=await p.evaluate(()=>{const el=HubPlainTalk.renderCard({id:'a',botName:'助理',tool:'bash',command:'rm -rf important',why:'查看文件列表',caps:{network:false,writeRoots:['important']}});document.body.append(el);return {line:el.querySelector('h3').textContent,visible:el.innerText,detailOpen:el.querySelector('details').open};});
  assert.match(x.visible,/rm -rf important/,JSON.stringify(x));
}finally{await p.close();}});
test('权限快速连选时旧请求失败不得覆盖最新成功选择',async()=>{const p=await page();try{
  const x=await p.evaluate(async()=>{let pending=[];window.HubSettings={get:()=>({permission:{mode:'open'}}),setPermission:m=>new Promise((resolve,reject)=>pending.push({m,resolve,reject}))};Hub.openPanel('permission');await new Promise(r=>setTimeout(r,20));document.querySelector('[data-r29-permission="ask"]').click();document.querySelector('[data-r29-permission="readonly"]').click();pending[1].resolve({ok:true});await Promise.resolve();pending[0].reject(Error('fail'));await new Promise(r=>setTimeout(r,20));return {sent:pending.map(x=>x.m),shown:window.R29Permission.mode};});
  assert.equal(x.shown,'readonly',JSON.stringify(x));
}finally{await p.close();}});
test('禁止本机存储时页面仍可打开和使用',async()=>{const p=await page(()=>{Object.defineProperty(Storage.prototype,'getItem',{value(){throw Error('blocked')}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw Error('blocked')}})});try{assert.ok(await p.locator('.pinned .pin').count());await p.locator('.pinned .pin').first().click();await p.waitForSelector('[data-focus="composer"]');}finally{await p.close();}});
test('欢迎引导不遮挡助理入口',async()=>{const p=await page();try{await p.waitForSelector('[data-r29-welcome]');const pin=p.locator('.pinned .pin').first();await pin.click({timeout:3000});await p.waitForSelector('[data-focus="composer"]');}finally{await p.close();}});
test('移除附件后发送不会上传该附件',async()=>{const p=await page();try{await p.locator('.pinned .pin').first().click();await p.waitForSelector('[data-focus="composer"]');await p.evaluate(()=>{window.__uploads=[];window.HubUpload=async f=>{window.__uploads.push(f.name);return {ok:true}}});await p.locator('[data-r29-file="any"]').setInputFiles({name:'<x onerror="a">.txt',mimeType:'text/plain',buffer:Buffer.from('secret')});await p.locator('[data-act="remove-attach"]').click();await p.locator('[data-focus="composer"]').fill('hello');await p.locator('[data-act="send"]').last().click();assert.deepEqual(await p.evaluate(()=>window.__uploads),[]);}finally{await p.close();}});
test('头像与确认卡危险文本作为文本渲染',async()=>{const p=await page();try{const x=await p.evaluate(()=>{let s='<img src=x onerror="window.__review9=1"> javascript: "';state.bots[0].name=s;let holder=document.createElement('div');holder.innerHTML=HubAvatars.html(state.bots[0].id,32);holder.append(HubPlainTalk.renderCard({botName:s,tool:'bash',why:s,command:s}));document.body.append(holder);return {bad:holder.querySelectorAll('img[onerror],script,a[href^="javascript:"]').length, text:holder.textContent, hit:window.__review9||0};});assert.equal(x.bad,0);assert.equal(x.hit,0);}finally{await p.close();}});
