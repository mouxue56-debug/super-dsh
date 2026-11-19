// 把演示接力自动往前走的过程录成视频，给宣传片当画面参考。
// 只连 127.0.0.1；需要先 python3 build.py --demo generic。用法：node record-r32-demo.cjs [输出目录]
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
const port = 3852;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r32-rec-'));
  const ctx = await browser.newContext({viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, recordVideo: {dir, size: viewport}});
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
const allDone = (page) => page.waitForFunction(() => R32Relay.demoState().every((x) => x.phase === 'done'), null, {timeout: 90000});
(async () => {
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const browser = await playwright.chromium.launch({executablePath: chromium, headless: true});
  try {
    await clip(browser, '接力演示-手机-看板自己走', {width: 390, height: 844}, true, async (page) => {
      await page.evaluate(() => { const l = document.querySelector('.r30-list'); if (l) l.scrollTop = 520; });
      await allDone(page);
    });
    await clip(browser, '接力演示-手机-点开时间线', {width: 390, height: 844}, true, async (page) => {
      await page.waitForFunction(() => R32Relay.demoState()[1].current >= 1, null, {timeout: 20000});
      await page.evaluate(() => window.R30Board.open('r32-demo-dev'));
      await allDone(page);
    });
    await clip(browser, '接力演示-电脑-看板自己走', {width: 1440, height: 900}, false, async (page) => { await allDone(page); });
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
