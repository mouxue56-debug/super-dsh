// 把「交给首席安排」「定时卡到点被叫醒」的演示过程录成视频，给宣传片当画面参考。
// 只连 127.0.0.1；需要先 python3 build.py --demo generic。用法：node record-r38-demo.cjs [输出目录]
// 假时钟：演示里每走一格（约 1.2 秒）就是演示时钟的 1 分钟，所以「三分钟后」约 4 秒到点。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const home = os.homedir();
const exists = (file) => { try { return !!(file && fs.existsSync(file)); } catch (e) { return false; } };
const playwright = require(process.env.PLAYWRIGHT_CORE || path.join(home, 'node_modules/playwright-core'));
const chromium = process.env.CHROMIUM || [path.join(home, 'Library/Caches/ms-playwright',
  'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')].find(exists);
assert(chromium, '缺少本机浏览器');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', '录像'));
const dist = path.join(__dirname, 'dist-generic');
const port = 3857;
const base = 'http://127.0.0.1:' + port + '/DSH-Hub.html';
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, base).pathname);
  if (rel === '/') rel = '/DSH-Hub.html';
  const file = path.resolve(dist, '.' + rel);
  if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': {'.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png'}[path.extname(file)] || 'application/octet-stream'});
    res.end(buf);
  });
});
async function clip(browser, name, viewport, touch, scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r38-rec-'));
  const ctx = await browser.newContext({viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, recordVideo: {dir, size: viewport}});
  await ctx.addInitScript(() => { window.__R38_TICK_MS = 1200; window.__R35_TICK_MS = 1000000; });
  const page = await ctx.newPage();
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    return url.hostname === '127.0.0.1' && url.port === String(port) ? route.continue() : route.abort();
  });
  await page.goto(base + '#kanban');
  await page.waitForSelector('.r30-phone, .r29-desk', {state: 'attached'});
  await page.waitForTimeout(1200);
  await scenario(page);
  await page.waitForTimeout(1500);
  const video = page.video();
  await ctx.close();
  fs.mkdirSync(out, {recursive: true});
  const target = path.join(out, name + '.webm');
  await video.saveAs(target);
  fs.rmSync(dir, {recursive: true, force: true});
  console.log('录好：' + target);
  return target;
}
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, {timeout: 90000});
const isPhone = (page) => page.evaluate(() => !!document.querySelector('.r30-phone') && getComputedStyle(document.querySelector('.r30-phone')).display !== 'none');
(async () => {
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const browser = await playwright.chromium.launch({executablePath: chromium, headless: true});
  try {
    await clip(browser, '触发演示-手机-新建选交给首席安排-自动被接走', {width: 390, height: 844}, true, async (page) => {
      await page.evaluate(() => R38Trigger.replay(true));
      await page.waitForTimeout(500);
      await page.click('.r30-phone [data-r30-new]');
      await page.waitForSelector('.r30-sheet .r38-give');
      await page.waitForTimeout(700);
      await page.type('.r30-sheet [name=title]', '给读书会起个名字', {delay: 80});
      await page.waitForTimeout(500);
      await page.click('.r30-sheet .r38-give');
      await page.waitForTimeout(1500);
      await wait(page, () => R38Trigger.demoState()[0].stage >= 1);
      await page.waitForTimeout(600);
      await page.evaluate(() => window.R30Board.open(R38Trigger.demoState()[0].id));
      await page.waitForTimeout(2500);
      await page.click('.r30-sheet [data-r30-close]').catch(() => {});
      await wait(page, () => R38Trigger.demoState()[0].stage >= 3);
    });
    await clip(browser, '触发演示-手机-定时卡到点被叫醒', {width: 390, height: 844}, true, async (page) => {
      await page.evaluate(() => R38Trigger.replay(true));
      await page.waitForTimeout(800);
      await page.evaluate(() => window.R30Board.open(R38Trigger.demoState()[2].id));
      await page.waitForTimeout(2200);
      await page.click('.r30-sheet [data-r30-close]').catch(() => {});
      await wait(page, () => R38Trigger.demoState()[2].stage >= 1);
      await page.waitForTimeout(1500);
      await wait(page, () => R38Trigger.demoState()[2].stage >= 3);
    });
    await clip(browser, '触发演示-手机-首席建议等你点头', {width: 390, height: 844}, true, async (page) => {
      await page.evaluate(() => R38Trigger.replay(true));
      await wait(page, () => R38Trigger.demoState()[1].stage >= 1);
      await page.waitForTimeout(800);
      await page.evaluate(() => window.R30Board.open(R38Trigger.demoState()[1].id));
      await page.waitForTimeout(2500);
      await page.click('.r30-sheet [data-r38-ok]');
      await page.waitForTimeout(1000);
      await wait(page, () => R38Trigger.demoState()[1].stage >= 3);
    });
    await clip(browser, '触发演示-电脑-首席自动安排加定时到点', {width: 1440, height: 900}, false, async (page) => {
      await page.evaluate(() => R38Trigger.replay(true));
      await wait(page, () => R38Trigger.demoState()[0].stage >= 3 && R38Trigger.demoState()[2].stage >= 3);
    });
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
