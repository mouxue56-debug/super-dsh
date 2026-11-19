/* 演示方式下的账本页和今天页。先 python3 build.py --demo generic，再运行本文件。不用端口，不联网。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function firstExisting(list) {
  for (const item of list) if (item && fs.existsSync(item)) return item;
  return '';
}
const playwrightPath = process.env.PLAYWRIGHT_CORE || firstExisting([
  path.join(os.homedir(), 'node_modules/playwright-core'),
  path.join(os.homedir(), 'node_modules/playwright-core')
]);
const chromium = process.env.CHROMIUM || firstExisting([
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell')
]);
assert(playwrightPath && chromium, '缺少本机浏览器或 playwright-core');
const playwright = require(playwrightPath);
const built = path.resolve(__dirname, '..', 'dist-generic', 'DSH-Hub.html');
assert(fs.existsSync(built), '先运行 python3 build.py --demo generic');

(async () => {
  const browser = await playwright.chromium.launch({ executablePath: chromium, headless: true });
  const errors = [];
  try {
    for (const [width, height, theme] of [[390, 844, 'light'], [390, 844, 'dark'], [1440, 900, 'light']]) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto('file://' + built);
      await page.waitForFunction(() => window.Hub && document.querySelector('#app .shell'));
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await page.evaluate(() => Hub.navigate({ view: 'ledger' }));
      await page.waitForSelector('[data-r30l-ledger="demo"] .r30l-bars');
      assert.equal(await page.locator('.r30l-stat').count(), 3);
      assert.equal(await page.locator('.r30l-col').count(), 7);
      await page.click('[data-r30l-act="range:14"]');
      assert.equal(await page.locator('.r30l-col').count(), 14);
      assert.ok(await page.locator('.r30l-hrow').count() >= 3);
      const before = await page.locator('.r30l-row').count();
      await page.click('.r30l-chip:nth-child(2)');
      assert.ok(await page.locator('.r30l-row').count() < before, '筛选后明细应变少');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, true);
      await page.evaluate(() => Hub.navigate({ view: 'chat' }));
      // 今天在首页底栏（data-today-open），不在更多里。
      await page.evaluate(() => document.querySelector('[data-today-open]').click());
      await page.waitForSelector('[data-r30l-today="demo"] .r30l-block');
      assert.equal(await page.locator('.r30l-block:not(.r30l-b-recent)').count(), 4);
      assert.equal(await page.locator('.r30l-pill, .r30l-lead').count(), 0, '三组数字和总结句已删');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, true);
      await page.click('.r30l-b-wait .r30l-trow >> nth=0');
      assert.equal(await page.evaluate(() => state.mode), 'chat');
      // 今天在首页底栏（data-today-open），不在更多里。
      await page.evaluate(() => document.querySelector('[data-today-open]').click());
      await page.click('.r30l-b-doing .r30l-trow >> nth=0');
      assert.equal(await page.evaluate(() => state.mode + ':' + state.drawer), 'kanban:card');
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('r30 ledger/today demo ok');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
