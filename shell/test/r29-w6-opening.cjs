/* 空会话第一句。只连 127.0.0.1 的 3711 和 3712，不读密钥，不调真模型。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const lane = path.resolve(__dirname, '..', '..');
const shots = path.join(lane, 'shots');
const demoDir = path.join(root, 'dist-generic');
const adapterFile = path.join(lane, 'hub/packages/hub-web/hub-real.js');
const fakeFile = path.join(lane, 'hub/packages/hub-web/test/fake-bff.mjs');
const forbidden = /豆包|Gemini|Codex|报价|token|首席|总管|owner/i;

function firstExisting(list) {
  for (const item of list) if (item && fs.existsSync(item)) return item;
  return '';
}
const playwrightPath = process.env.PLAYWRIGHT_CORE || firstExisting([
  path.join(os.homedir(), 'node_modules/playwright-core'),
  path.join(os.homedir(), 'node_modules/playwright-core'),
]);
const chromiumPath = process.env.CHROMIUM || firstExisting([
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64',
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
]);

function serve(port, onRequest) {
  const server = http.createServer(onRequest);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
function closeServer(server) {
  return new Promise(resolve => { if (!server) resolve(); else server.close(() => resolve()); });
}
function readUnder(dir, rel) {
  const file = path.resolve(dir, '.' + rel);
  if (!file.startsWith(dir)) return null;
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
function typeOf(file) {
  const types = {
    '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.webp': 'image/webp', '.svg': 'image/svg+xml',
  };
  return types[path.extname(file)] || 'application/octet-stream';
}

(async () => {
  assert(fs.existsSync(path.join(demoDir, 'DSH-Hub.html')), '先运行 python3 build.py --demo generic');
  assert(playwrightPath && chromiumPath, '缺少 playwright-core 或浏览器');
  assert(fs.existsSync(adapterFile), '缺少适配层');
  fs.mkdirSync(shots, { recursive: true });
  const playwright = require(playwrightPath);
  const browser = await playwright.chromium.launch({ executablePath: chromiumPath, headless: true });
  const checks = [];
  const check = (label, value) => { assert.ok(value, label); checks.push(label); console.log('通过：' + label); };
  try {
    await demo(browser, check);
    await real(browser, check);
    console.log('合计通过 ' + checks.length);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });

async function demo(browser, check) {
  const port = 3711;
  const server = await serve(port, (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/DSH-Hub.html';
    const buf = readUnder(demoDir, rel);
    if (!buf) { res.writeHead(404); res.end('missing'); return; }
    res.writeHead(200, { 'Content-Type': typeOf(rel) });
    res.end(buf);
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto('http://127.0.0.1:' + port + '/DSH-Hub.html');
    await page.waitForFunction(() => window.state && state.bots && state.bots.length >= 6);
    await page.evaluate(() => { state.detail = false; state.drawer = null; render(); });
    await page.waitForFunction(() => document.querySelectorAll('.pinned [data-bot-tree]').length === 6);
    check('演示首页仍是六格', await page.locator('.pinned [data-bot-tree]').count() === 6);
    await page.screenshot({ path: path.join(shots, 'demo-home.png') });
    const bot = await page.evaluate(() => state.bots[0].id);
    await page.evaluate(id => {
      state.detail = true;
      Hub.navigate({ view: 'chat', bot: id });
      state.detail = true;
      render();
    }, bot);
    await page.waitForSelector('.chatview [data-focus="composer"]');
    check('已有消息的会话不显示示例', await page.locator('[data-r29-opening]').count() === 0);
    check('快捷话条仍不可见', !(await shown(page, '.hub-quick')) && !(await shown(page, '.chat-quick-slot')));
    const expected = {
      '把手头几件事说给我，我帮你排先后': ['梳理待办、核对资料、协调转派'],
      '把要写的话交给我，我帮你理成一段': ['整理来信与回复草稿'],
      '把要做到哪一步说给我，我帮你对一下': ['整理资料摘要与交付清单', '跟进任务、验收与设备样例'],
      '把想看到的画面说给我，我帮你收成一版': ['整理图形、配色与版式方案'],
      '把想弄清的问题说给我，我按能对上的来源整理': ['核对公开资料、比较候选与来源'],
    };
    const rows = await page.evaluate(() => state.bots.map(item => ({ id: item.id, duty: item.duty || '' })));
    for (const row of rows) {
      await openEmpty(page, row.id);
      const line = await page.locator('[data-r29-opening]').innerText();
      const hit = Object.entries(expected).find(([, duties]) => duties.includes(row.duty));
      check('职责挑句 ' + row.duty, hit && hit[0] === line.trim());
      check('默认句不含具体人设或业务词', !forbidden.test(line));
      const box = await page.locator('[data-r29-opening]').boundingBox();
      check('390 宽里示例在屏内', !!box && box.width > 40 && box.x >= 0 && box.x + box.width <= 390);
    }
    await openEmpty(page, bot);
    await page.screenshot({ path: path.join(shots, 'demo-empty.png') });
    const before = await page.evaluate(() => (Hub.currentMessages() || []).length);
    check('点之前没有消息', before === 0);
    check('空输入仍是麦克风', await shown(page, '.composer-area [data-r29-mic]'));
    const line = (await page.locator('[data-r29-opening]').innerText()).trim();
    await page.locator('[data-r29-opening]').click();
    const placed = await page.evaluate(() => {
      const box = document.querySelector('[data-focus="composer"]');
      return { input: state.input, value: box ? box.value : '', n: (Hub.currentMessages() || []).length };
    });
    check('点一下只放进输入框', placed.input === line && placed.value === line && placed.n === 0);
    check('放进输入框后变成可发送', await shown(page, '.composer-area [data-act="send"]'));
    await page.locator('.composer-area [data-act="send"]').click();
    await page.waitForFunction(() => (Hub.currentMessages() || []).some(item => (
      item.role === 'user' || item.from === 'user'
    )));
    check('发出第一句后示例消失', await page.locator('[data-r29-opening]').count() === 0);
    await page.evaluate(() => {
      window.HubOpeningLines = { fallback: '自定义通用句', rows: [{ when: '完全不匹配xyz', text: '不会用到' }] };
      state.threads[state.bot] = [];
      state.input = '';
      state.running = false;
      render();
    });
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-r29-opening]');
      return node && node.textContent.trim() === '自定义通用句';
    });
    check('句子表可换成通用句', true);
    check('演示页没有脚本错误', errors.length === 0);
  } finally {
    await page.close();
    await closeServer(server);
  }
}

async function openEmpty(page, id) {
  await page.evaluate(bot => {
    state.threads[bot] = [];
    state.input = '';
    state.running = false;
    state.detail = true;
    state.drawer = null;
    Hub.navigate({ view: 'chat', bot: bot });
    state.detail = true;
    render();
  }, id);
  await page.waitForSelector('[data-r29-opening]');
}

async function shown(page, selector) {
  const loc = page.locator(selector);
  if (await loc.count() === 0) return false;
  return loc.first().evaluate(el => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (el.hidden || el.hasAttribute('hidden')) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity) === 0) return false;
    return box.width > 0 && box.height > 0;
  });
}

async function real(browser, check) {
  const { startFakeBff } = await import(pathToFileURL(fakeFile).href);
  const fake = await startFakeBff();
  let historyDelayMs = 0;
  const port = 3712;
  const html = fs.readFileSync(path.join(demoDir, 'DSH-Hub.html'), 'utf8')
    .replace(/<\/body>/i, '<script src="/hub-real.js"></script></body>');
  const adapter = fs.readFileSync(adapterFile);
  const server = await serve(port, async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/bff/')) {
        if (historyDelayMs && /\/history$/.test(url.pathname)) {
          await new Promise(resolve => setTimeout(resolve, historyDelayMs));
        }
        return fake.handler(req, res);
      }
      if (url.pathname === '/' || url.pathname === '/DSH-Hub.html') {
        res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
        res.end(html);
        return;
      }
      if (url.pathname === '/hub-real.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript;charset=utf-8' });
        res.end(adapter);
        return;
      }
      const buf = readUnder(demoDir, decodeURIComponent(url.pathname));
      if (!buf) { res.writeHead(404); res.end('missing'); return; }
      res.writeHead(200, { 'Content-Type': typeOf(url.pathname) });
      res.end(buf);
    } catch (error) {
      if (!res.headersSent) { res.writeHead(500); res.end(String(error)); }
    }
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => {
    const url = route.request().url();
    const local = url.startsWith('http://127.0.0.1:' + port + '/')
      || url.startsWith('data:') || url.startsWith('blob:');
    return local ? route.continue() : route.abort();
  });
  try {
    await page.goto('http://127.0.0.1:' + port + '/DSH-Hub.html');
    await page.waitForFunction(() => window.HubReal && HubReal.state().rosterReady);
    await page.evaluate(() => { state.detail = false; state.drawer = null; render(); });
    await page.waitForFunction(() => document.querySelectorAll('.pinned [data-bot-tree]').length === 6);
    check('真实首页仍是六格', await page.locator('.pinned [data-bot-tree]').count() === 6);
    const bot = await page.evaluate(() => HubReal.state().roster[0].id);
    await page.evaluate(id => { Hub.navigate({ view: 'chat', bot: id }); state.detail = true; render(); }, bot);
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-r29-opening]');
      return node && node.textContent.includes('这个你帮我看看怎么办');
    });
    const emptyText = await page.locator('.hub-real-empty').innerText();
    const name = await page.evaluate(() => (state.bots.find(item => item.id === state.bot) || {}).name || '');
    check('原空状态文字还在', emptyText === '和' + (name || '助理') + '说点什么');
    check('真实空会话用通用句', true);
    const creates = fake.stats.creates;
    await page.locator('[data-r29-opening]').click();
    const placed = await page.evaluate(() => {
      const box = document.querySelector('[data-focus="composer"]');
      return {
        value: box ? box.value : '',
        n: (Hub.currentMessages() || []).length,
        quick: !!document.querySelector('.hub-quick:not([hidden])'),
      };
    });
    check('真实模式点一下不发送', placed.value.includes('这个你帮我看看怎么办') && placed.n === 0 && fake.stats.creates === creates);
    check('没有恢复快捷话条', !(await shown(page, '.hub-quick')) && !(await shown(page, '.chat-quick-slot')));
    await page.locator('[data-focus="composer"]').press('Enter');
    await page.waitForFunction(() => (Hub.currentMessages() || []).length > 0);
    check('真实模式发出后示例消失', await page.locator('[data-r29-opening]').count() === 0);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const ready = [...fake.sessions.values()].some(item => (item.history || []).length > 0);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    check('服务器里已经有旧消息', [...fake.sessions.values()].some(item => (item.history || []).length > 0));
    historyDelayMs = 1600;
    await page.goto('http://127.0.0.1:' + port + '/DSH-Hub.html');
    await page.waitForFunction(() => window.HubReal && HubReal.state().rosterReady
      && HubReal.state().sessions.length > 0);
    await page.evaluate(id => {
      Hub.navigate({ view: 'chat', bot: id });
      state.detail = true;
      render();
    }, bot);
    const started = Date.now();
    let sawLoading = false;
    let flashed = false;
    while (Date.now() - started < 1400) {
      const snap = await page.evaluate(() => ({
        loading: document.querySelector('.hub-real-empty') ? document.querySelector('.hub-real-empty').textContent : '',
        opening: document.querySelectorAll('[data-r29-opening]').length,
        n: window.Hub && Hub.currentMessages ? Hub.currentMessages().length : 0,
      }));
      if (snap.loading === '正在加载会话…') sawLoading = true;
      if (snap.opening > 0 && snap.n === 0) flashed = true;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    check('加载旧会话时看过「正在加载」', sawLoading);
    check('加载旧会话时没有闪出示例', !flashed);
    await page.waitForFunction(() => (Hub.currentMessages() || []).length > 0, null, { timeout: 8000 });
    check('旧会话加载完仍没有示例', await page.locator('[data-r29-opening]').count() === 0);
    await page.screenshot({ path: path.join(shots, 'real-old.png') });
    check('真实页没有脚本错误', errors.length === 0);
  } finally {
    historyDelayMs = 0;
    await page.close();
    await closeServer(server);
    await fake.close();
  }
}
