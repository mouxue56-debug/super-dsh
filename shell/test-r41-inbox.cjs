/* 看板进度记录显示来自文件或命令的小标。临时端口，资源仅来自本克隆。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = __dirname;
const home = os.homedir();
const pw = require(process.env.PLAYWRIGHT_CORE ||
  path.join(home, 'node_modules/playwright-core'));
const chromium = process.env.CHROMIUM || path.join(home, 'Library/Caches/ms-playwright',
  'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const bundled = process.env.HUB_SHELL_DIST || path.join(root, 'dist-generic/DSH-Hub.html');
const ticket = {
  id: 'T-20261119-120000-via1',
  title: '来源小标',
  state: 'progress',
  review: 'none',
  claimedBy: 'codex',
  claimedByType: 'external',
  from: { name: 'owner', type: 'owner' },
  to: ['codex'],
  goal: '看小标',
  updatedAt: '2026-11-19T12:00:00.000Z',
  createdAt: '2026-11-19T12:00:00.000Z',
  progress: [
    { ts: '2026-11-19T12:01:00.000Z', by: 'codex', text: '命令记了一笔', via: 'cli' },
    { ts: '2026-11-19T12:02:00.000Z', by: 'grokbot', text: '文件记了一笔', via: 'file' }
  ],
  history: [
    { ts: '2026-11-19T12:00:30.000Z', by: 'codex', action: 'claimed', via: 'cli' }
  ]
};
let browser, server, base;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = url.pathname === '/built.html' ? bundled : path.resolve(root, '.' + url.pathname);
    if (file !== bundled && !file.startsWith(root + path.sep)) {
      res.writeHead(403); res.end(); return;
    }
    fs.readFile(file, (error, body) => {
      if (error) { res.writeHead(404); res.end(); return; }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await pw.chromium.launch({ executablePath: chromium, headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function pageFor(t, entry, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === base || ['data:', 'blob:'].includes(url.protocol) ?
      route.continue() : route.abort();
  });
  await page.goto(base + entry + '#kanban');
  await page.waitForFunction(() => window.Hub && document.querySelector('#app .shell'));
  const painted = await page.evaluate(row => {
    document.documentElement.dataset.hubMode = 'real';
    window.HubBoard = { tickets: () => [row] };
    if (typeof state !== 'undefined') state.mode = 'kanban';
    return r29DeskAsk().then(function (rows) {
      r29DeskRows = rows;
      r29DeskFailed = false;
      r29DeskPaint();
      var card = document.querySelector('[data-r30-card="' + row.id + '"]');
      return { n: rows.length, title: rows[0] && rows[0].title, card: !!(card && card.textContent.includes(row.title)) };
    });
  }, ticket);
  assert.equal(painted.card, true, JSON.stringify(painted));
  return page;
}

function labels(page, selector) {
  return page.locator(selector).allTextContents();
}

for (const entry of ['/index.html', '/built.html']) {
  test(entry + ' 宽屏进度记录带来源小标', async t => {
    const page = await pageFor(t, entry, 1280);
    await page.locator('[data-r29-desk-id]').click();
    await page.waitForSelector('.r29-desk-detail .r41-via');
    const texts = await labels(page, '.r29-desk-detail .r41-via');
    assert.ok(texts.some(text => text.includes('来自：codex（命令）')));
    assert.ok(texts.some(text => text.includes('来自：grokbot（文件）')));
    const block = await page.locator('.r29-desk-detail').innerText();
    assert.match(block, /命令记了一笔/);
    assert.match(block, /领取了这张卡/);
  });

  test(entry + ' 手机详情进度记录带来源小标', async t => {
    const page = await pageFor(t, entry, 390);
    await page.locator('[data-r30-open="' + ticket.id + '"]').click();
    await page.locator('#r30-sheet summary').click();
    await page.waitForSelector('#r30-sheet .r41-via');
    const texts = await labels(page, '#r30-sheet .r41-via');
    assert.ok(texts.some(text => text.includes('来自：codex（命令）')));
    assert.ok(texts.some(text => text.includes('来自：grokbot（文件）')));
  });
}
