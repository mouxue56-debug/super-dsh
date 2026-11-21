/* 设置里的文件版状态、重建与今天页提示。临时端口，资源仅来自本克隆。 */
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

async function pageFor(t, entry, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === base || ['data:', 'blob:'].includes(url.protocol) ?
      route.continue() : route.abort();
  });
  await page.goto(base + entry);
  await page.waitForFunction(() => window.Hub && window.R29Settings && window.R30LT &&
    document.querySelector('#app .shell'));
  return page;
}

async function settings(page, value) {
  await page.evaluate(info => {
    document.documentElement.dataset.hubMode = 'real';
    window.HubSettings = {
      getMirror: async () => info,
      rebuildMirror: () => new Promise(resolve => {
        window.mirrorCalls = (window.mirrorCalls || 0) + 1;
        window.mirrorResolve = resolve;
      })
    };
    Hub.openPanel('more');
  }, value);
  await page.locator('[data-r29-more="settings"]').click();
  await page.waitForFunction(() => {
    const line = document.querySelector('[data-r41-mirror]');
    return line && !line.textContent.includes('读取中');
  });
}

for (const entry of ['/index.html', '/built.html']) {
  test(entry + ' 设置按钩子显示路径、日期，重建防连点并使用回执', async t => {
    const page = await pageFor(t, entry);
    const dir = '/本机/任务板/<img src=x onerror="window.hit=1">/' + '很长的目录'.repeat(25);
    await settings(page, { enabled: true, dir, lastUpdated: '2026-11-19T01:02:03Z', state: 'ready' });
    const row = page.locator('[data-r41-mirror]');
    assert.equal(await page.locator('[data-r31-setting]').count(), 3);
    assert.equal(await row.locator('input,textarea,img,[onerror]').count(), 0);
    assert.match(await row.innerText(), /任务板文件版：在 \/本机\/任务板\//);
    assert.match(await row.innerText(), /2026/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const button = row.locator('button');
    await button.click();
    await page.evaluate(() => document.querySelector('[data-r41-mirror-rebuild]').click());
    assert.equal(await button.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.mirrorCalls), 1);
    await page.evaluate(() => window.mirrorResolve({ enabled: true, dir: '/已重建',
      lastUpdated: '2026-11-20T01:02:03Z', state: 'ready' }));
    await page.waitForFunction(() => document.querySelector('[data-r41-mirror]').textContent.includes('/已重建'));
    assert.equal(await button.isDisabled(), false);
  });
}

test('无钩子只读，关闭时不能重建', async t => {
  const page = await pageFor(t, '/built.html');
  await page.evaluate(() => Hub.openPanel('r31-settings'));
  assert.match(await page.locator('[data-r41-mirror]').innerText(), /暂无/);
  assert.equal(await page.locator('[data-r41-mirror-rebuild]').isDisabled(), true);
  await settings(page, { enabled: false, state: 'disabled', dir: '/关闭' });
  assert.match(await page.locator('[data-r41-mirror]').innerText(), /已关闭/);
  assert.equal(await page.locator('[data-r41-mirror-rebuild]').isDisabled(), true);
});

test('远端停写禁用重建，目录不可写与请求失败均可重试', async t => {
  const page = await pageFor(t, '/built.html', 1440);
  for (const [state, text] of [['remote', '发现远端配置，已停写'], ['unavailable', '暂时无法写入']]) {
    await settings(page, { enabled: true, state, dir: '/任务板' });
    assert.ok((await page.locator('[data-r41-mirror]').innerText()).includes(text));
    assert.equal(await page.locator('[data-r41-mirror-rebuild]').isDisabled(), state === 'remote');
  }
  await page.evaluate(() => {
    HubSettings.rebuildMirror = () => Promise.reject(Error('断开'));
  });
  await page.locator('[data-r41-mirror-rebuild]').click();
  await page.waitForFunction(() => document.querySelector('[data-r41-mirror]').textContent.includes('暂时读不到'));
  assert.equal(await page.locator('[data-r41-mirror-rebuild]').isDisabled(), false);
});

test('今天页提示每次挂载只显示一行并按纯文本转义', async t => {
  const page = await pageFor(t, '/built.html');
  const result = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.append(host);
    const raw = { date: '2026-11-19', mirrorNotice: '任务板文件版：发现远端配置，已停写 <img onerror=x>' };
    const model = R30LT.normalizeToday(raw, [], id => id);
    R30LT.mountToday(host, model);
    R30LT.mountToday(host, model);
    const count = host.querySelectorAll('[data-r41-mirror-notice]').length;
    const text = host.textContent;
    const unsafe = host.querySelectorAll('img,[onerror]').length;
    R30LT.mountToday(host, R30LT.normalizeToday({ date: raw.date }, [], id => id));
    return { count, text, unsafe, cleared: host.querySelectorAll('[data-r41-mirror-notice]').length };
  });
  assert.equal(result.count, 1);
  assert.ok(result.text.includes('<img onerror=x>'));
  assert.equal(result.unsafe, 0);
  assert.equal(result.cleared, 0);
});
