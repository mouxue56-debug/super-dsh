const {chromium} = require(process.env.PLAYWRIGHT_CORE);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chrome = process.env.CHROMIUM;
const shots = path.join(__dirname,'r28-a1-shots');
fs.mkdirSync(shots,{recursive:true});

(async () => {
  const browser = await chromium.launch({executablePath:chrome,headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  try {
    await page.goto('http://127.0.0.1:3596/?key=r28-offline-web');
    await page.waitForFunction(() => window.HubReal?.state().rosterReady);
    const isNew = await page.evaluate(() => !!window.AssistantProfiles);
    if (!isNew) {
      assert.equal(await page.evaluate(() => typeof window.HubReal.sendText),'function');
      await page.screenshot({path:path.join(shots,'a1-old.png')});
      console.log('旧壳：名册已加载，真实发送入口存在');
      return;
    }
    await page.locator('[data-act="more"]').first().click();
    await page.locator('[data-hub-more-item="shell-assistants"]').click();
    const row = page.locator('[data-assistant-profile]').first();
    const id = await row.getAttribute('data-assistant-profile');
    await row.click();
    const oldName = await page.locator('[data-profile-name]').innerText();
    await page.locator('[data-profile-edit="name"]').click();
    await page.locator('[data-profile-field="name"]').fill('小白');
    await page.locator('[data-profile-preview]').click();
    await page.locator('[data-assistant-confirm]').click();
    await page.waitForFunction(id => window.HubReal.state().roster.find(b => b.id === id)?.name === '小白',id);
    const stats = await fetch('http://127.0.1:3595/bff/__stats').then(r=>r.json());
    assert.ok(stats.patches.some(p=>p.bot===id && p.patch.name==='小白'));
    assert.equal(await page.locator('[data-profile-name]').innerText(),'小白');
    await page.screenshot({path:path.join(shots,'a1-success.png')});
    await page.locator('[data-profile-edit="name"]').click();
    await page.locator('[data-profile-field="name"]').fill('小蓝');
    await page.locator('[data-profile-preview]').click();
    await page.route('**/bff/bots/' + id,route => {
      if (route.request().method() === 'PATCH') return route.fulfill({status:400,body:'{}'});
      return route.continue();
    });
    await page.locator('[data-assistant-confirm]').click();
    await page.getByText('没改成：资料不符合要求').waitFor();
    assert.equal(await page.evaluate(id=>Hub.state.bots.find(b=>b.id===id).name,id),'小白');
    await page.locator('[data-assistant-cancel]').click();
    await page.unroute('**/bff/bots/' + id);
    await page.locator('[data-avatar-library]').click();
    await page.locator('[data-real-profile-edit="avatar"]').waitFor();
    await page.screenshot({path:path.join(shots,'a1-avatar.png')});
    await page.evaluate(() => { Hub.state.drawer = null; render(); });
    await page.locator('[data-act="more"]').first().click();
    await page.locator('[data-hub-more-item="shell-assistants"]').click();
    assert.ok(await page.locator('[data-assistant-profile]').count() >= 6);
    assert.match(await page.locator('[data-assistant-profile="' + id + '"]').innerText(),/小白/);
    assert.notEqual(oldName,'小白');
    console.log('新壳：改名读回、失败保护、真实形象抽屉通过');
  } finally {
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
