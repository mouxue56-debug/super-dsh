/* 真实账本布局。内置假账本，file 页面，不启动服务。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pick = (values) => values.find((value) => value && fs.existsSync(value));
const playwright = require(pick([process.env.PLAYWRIGHT_CORE,
  path.join(os.homedir(), 'node_modules/playwright-core')]));
const chrome = pick([process.env.CHROMIUM, path.join(os.homedir(), 'Library/Caches/ms-playwright',
  'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')]);
const built = path.resolve(__dirname, '..', 'dist-generic/DSH-Hub.html');
(async () => {
  const browser = await playwright.chromium.launch({ executablePath: chrome, headless: true });
  const errors = [];
  try {
    for (const [width, theme] of [[390, 'light'], [390, 'dark'], [1440, 'light']]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.route(/^https?:/, (route) => route.abort());
      await page.goto('file://' + built);
      await page.waitForFunction(() => window.Hub && window.R30LT);
      await page.evaluate((selectedTheme) => {
        document.documentElement.dataset.theme = selectedTheme;
        Hub.navigate({ view: 'ledger' });
        document.documentElement.dataset.hubMode = 'real';
        const host = document.querySelector('[data-r30l-ledger]').parentElement;
        const b = { calls: 2, tokens: { input: 1000000, cacheRead: 200000, cacheWrite: 300000, output: 400000 },
          cost: { byCurrency: { CNY: { ok: 2.904, expired: 0 } } } };
        const all = { total: b, byBot: { helper: b }, byDay: { '2026-11-19': b },
          thisMonth: { total: b }, last7Days: { total: b, days: [{ date: '2026-11-19', ...b }] },
          recent: [{ title: '一次真实形状的测试调用', bot: 'helper', ...b }],
          native: { ok: false, reason: '文件不存在 <img src=x onerror="window.__hit=1">' } };
        const model = R30LT.normalizeLedger({ all, today: { total: b } }, () => '本地测试助理');
        model.budgets = { month: { cur: 'CNY', limit: 4 } };
        R30LT.mountLedger(host, model);
      }, theme);
      assert.equal(await page.locator('[data-r30l-ledger="real"] .r30l-stat').count(), 3);
      assert.match(await page.locator('.r30l-stat').first().textContent(), /¥2\.90/);
      assert.match(await page.locator('.r30l-native').textContent(), /读不到 DeepSeek Harness 的账本：文件不存在/);
      assert.equal(await page.locator('.r30l-native img').count(), 0);
      assert.equal(await page.locator('.r30l-meter.warm').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), true);
      await page.click('[data-r30l-act="metric:tokens"]');
      assert.match(await page.locator('.r30l-row').textContent(), /(缓存命中|存着的命中) 200,000/);
      assert.doesNotMatch(await page.locator('[data-r30l-ledger]').textContent(), /待计价|费用暂时算不出|示例数据/);
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('r40 ledger browser passed 3 viewports/themes');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
