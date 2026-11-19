/* 壳 core.js 里助理名、助理号、卡片时间拼进 HTML 前要转义（设置页「选择助理」下拉、卡片抽屉的说明行）。
 * 无头浏览器、只连 127.0.0.1；需要先 python3 build.py --demo generic。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const home = os.homedir();
const exists = (f) => { try { return !!(f && fs.existsSync(f)); } catch (e) { return false; } };
const playwrightPath = process.env.PLAYWRIGHT_CORE || [path.join(home, 'node_modules/playwright-core')].find(exists);
const chromium = process.env.CHROMIUM || [path.join(home, 'Library/Caches/ms-playwright',
  'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')].find(exists);
assert(playwrightPath && chromium, '缺少本机浏览器或 playwright-core');
const playwright = require(playwrightPath);
const port = 3853;
const dist = path.join(__dirname, '..', 'dist-generic');
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/DSH-Hub.html';
  const file = path.resolve(dist, '.' + rel);
  if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('missing'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await playwright.chromium.launch({ executablePath: chromium });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto('http://127.0.0.1:' + port + '/DSH-Hub.html');
    await page.waitForTimeout(600);
    const out = await page.evaluate(() => {
      const evil = '<img src=x onerror="window.__hit=1">';
      state.bots[0].name = evil;
      state.bots[1].id = 'x" data-pwn="1';
      state.bots[1].name = evil;
      const card = state.cards[0];
      card.bot = state.bots[0].id;
      card.time = evil;
      card.sub = evil;
      state.cardId = card.id;
      state.drawer = 'card';
      const box = document.createElement('div');
      box.innerHTML = drawerHTML() + settingsBot();
      return { pwn: box.querySelectorAll('[data-pwn]').length, hit: window.__hit, img: box.querySelectorAll('img[onerror]').length, html: box.innerHTML.includes('&lt;img src=x') };
    });
    assert.equal(out.hit, undefined, '没有执行注入的脚本');
    assert.equal(out.pwn, 0, '助理号里的引号不能跳出属性');
    assert.equal(out.img, 0, '助理名、助理号、时间里的标签不能变成元素');
    assert(out.html, '名字作为文字显示');
    console.log('通过：r33 助理名/号/时间转义（设置页下拉与卡片抽屉）');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
