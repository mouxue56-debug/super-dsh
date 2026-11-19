// 看板：手机能滑到底、点卡片出操作单改状态/换人/改标题、电脑能拖、真实模式落到后端（用内存假后端）。
// 只连 127.0.0.1；需要先 python3 build.py --demo generic。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const home = os.homedir();
const exists = (file) => { try { return !!(file && fs.existsSync(file)); } catch (e) { return false; } };
const playwrightPath = process.env.PLAYWRIGHT_CORE ||
  [path.join(home, 'node_modules/playwright-core')].find(exists);
const chromium = process.env.CHROMIUM || [path.join(home, 'Library/Caches/ms-playwright',
  'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')].find(exists);
assert(playwrightPath && chromium, '缺少本机浏览器或 playwright-core');
const playwright = require(playwrightPath);
const port = 3841;
const dist = path.join(__dirname, 'dist-generic');
const shots = path.join(__dirname, '..', 'shots');
const base = 'http://127.0.0.1:' + port + '/DSH-Hub.html';
let passed = 0;
const check = (label, value) => { assert(value, label); passed += 1; console.log('通过：' + label); };

function serve() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, base).pathname);
    if (rel === '/') rel = '/DSH-Hub.html';
    const file = path.resolve(dist, '.' + rel);
    if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      const types = {'.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
        '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json'};
      res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// 内存假后端：和 hub-bff 的看板接口同形状，足够验证界面真的发了请求并按回执更新。
function fakeBackend() {
  const now = Date.now();
  const names = ['整理资料', '排版周报', '核对账目', '回复邮件', '画封面', '写提纲'];
  const states = ['queued', 'progress', 'progress', 'waiting-human', 'completed', 'queued'];
  const tickets = [];
  for (let i = 0; i < 24; i += 1) {
    const t = {id: 'T-20261119-09' + String(i).padStart(2, '0') + '00-ab' + String(i).padStart(2, '0'),
      title: names[i % 6] + ' ' + (i + 1), goal: '目标说明 ' + (i + 1), from: {name: 'owner', type: 'owner'},
      to: i % 3 ? ['chief'] : [], claimedBy: null, state: states[i % 6], review: 'none', open_ask: null,
      createdAt: new Date(now - i * 3600e3).toISOString(), updatedAt: new Date(now - i * 3600e3).toISOString(),
      progress: [], reports: [], verification: [], acceptance: []};
    if (t.state !== 'queued') t.claimedBy = 'chief';
    tickets.push(t);
  }
  tickets.push({...tickets[0], id: 'T-20261119-099900-leg1', title: '旧单', legacy: true, to: [], state: 'queued'});
  const calls = [];
  const colState = {queued: ['queued', 'none'], progress: ['progress', 'none'], review: ['progress', 'submitted'],
    attention: ['waiting-human', 'none'], done: ['completed', 'none']};
  const handle = (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (status, body) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    if (!p.startsWith('/bff/board/')) return route.abort();
    if (req.method() === 'GET' && p === '/bff/board/tickets') return json(200, {tickets});
    if (req.method() === 'GET' && p === '/bff/board/people') {
      return json(200, {people: [{id: 'chief', name: '总管', type: 'assistant'},
        {id: 'pm-agent', name: 'pm-agent', type: 'external'}]});
    }
    const m = /^\/bff\/board\/tickets(?:\/new|\/([^/]+)\/(move|assign|edit))$/.exec(p);
    if (req.method() !== 'POST' || !m) return json(404, {});
    const body = JSON.parse(req.postData() || '{}');
    calls.push({path: p.replace('/bff/board', ''), body});
    if (backend.fail) return json(409, {error: {code: 'CONFLICT'}});
    if (!m[1]) {
      const t = {...tickets[0], id: 'T-20261119-100000-new' + calls.length, title: body.title,
        goal: body.goal || body.title, to: body.to ? [body.to] : [], state: 'queued', claimedBy: null,
        updatedAt: new Date().toISOString()};
      tickets.unshift(t);
      return json(201, {ticket: t});
    }
    const t = tickets.find((x) => x.id === m[1]);
    if (m[2] === 'move') [t.state, t.review] = colState[body.column];
    if (m[2] === 'assign') {
      t.to = body.assignee ? [body.assignee] : [];
      if (t.state !== 'queued' && body.assignee) { t.claimedBy = body.assignee; t.claimedByType = body.assigneeType; }
    }
    if (m[2] === 'edit') { if (body.title) t.title = body.title; if (body.goal) t.goal = body.goal; }
    t.updatedAt = new Date().toISOString();
    return json(200, {ticket: t});
  };
  const backend = {tickets, calls, handle, fail: false};
  return backend;
}

async function open(browser, {width, height, touch, real, backend, scheme}) {
  const ctx = await browser.newContext({viewport: {width, height}, hasTouch: !!touch, isMobile: !!touch,
    deviceScaleFactor: touch ? 2 : 1, colorScheme: scheme || 'light'});
  if (real) {
    await ctx.addInitScript(() => {
      (function f() {
        if (document.documentElement) document.documentElement.dataset.hubMode = 'real';
        else setTimeout(f, 0);
      })();
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.hostname !== '127.0.0.1' || url.port !== String(port)) return route.abort();
    if (url.pathname.startsWith('/bff/')) return backend ? backend.handle(route) : route.abort();
    return route.continue();
  });
  await page.goto(base + '#kanban');
  await page.waitForSelector('.r30-phone, .r29-desk', {state: 'attached'});
  await page.waitForTimeout(600);
  return {ctx, page, errors};
}
const scrollInfo = (page) => page.evaluate(() => {
  const list = document.querySelector('.r30-list');
  const cards = [...list.querySelectorAll('.r30-card')];
  const last = cards[cards.length - 1].getBoundingClientRect();
  const box = list.getBoundingClientRect();
  return {top: list.scrollTop, sh: list.scrollHeight, ch: list.clientHeight, lastBottom: last.bottom,
    boxBottom: box.bottom, vh: innerHeight, n: cards.length};
});
async function touchScroll(ctx, page, dy, times) {
  const cdp = await ctx.newCDPSession(page);
  for (let i = 0; i < times; i += 1) {
    await cdp.send('Input.synthesizeScrollGesture',
      {x: 195, y: 520, yDistance: -dy, speed: 1400, gestureSourceType: 'touch'});
    await page.waitForTimeout(250);
  }
}

(async () => {
  fs.mkdirSync(shots, {recursive: true});
  const server = await serve();
  const browser = await playwright.chromium.launch({executablePath: chromium, headless: true});
  try {
    // ---- 手机：演示模式 ----
    let s = await open(browser, {width: 390, height: 844, touch: true});
    let page = s.page;
    check('手机演示：看板是新列表，旧五列拖动版藏起来', await page.evaluate(() =>
      !!document.querySelector('.r30-list') &&
      getComputedStyle(document.querySelector('.r30-legacy')).display === 'none'));
    await touchScroll(s.ctx, page, 600, 10);
    let info = await scrollInfo(page);
    check('手机演示：手指能一路滑到最底，最后一张卡完整露出', info.top > 0 && info.lastBottom <= info.boxBottom - 8 &&
      info.top + info.ch >= info.sh - 2);
    await page.screenshot({path: path.join(shots, 'phone-demo-bottom.png')});
    await page.evaluate(() => { document.querySelector('.r30-list').scrollTop = 0; });
    await page.click('[data-r30-tab="progress"]');
    check('手机演示：点「在做」只看那一列', await page.evaluate(() =>
      [...document.querySelectorAll('.r30-card')].length > 0 && !document.querySelector('.r30-group h2')));
    await page.click('[data-r30-tab="all"]');
    // 操作单
    const firstId = await page.evaluate(() => document.querySelector('.r30-pcard').getAttribute('data-r30-card'));
    await page.screenshot({path: path.join(shots, 'phone-demo-before-change.png')});
    await page.click('.r30-pcard .r29-desk-title');
    await page.waitForSelector('.r30-sheet');
    check('手机演示：点卡片升起操作单，五个状态一排', await page.evaluate(() =>
      document.querySelectorAll('.r30-sheet .r30-col').length === 5 &&
      document.querySelectorAll('.r30-sheet .r30-who').length >= 4 &&
      document.querySelector('.r30-sheet').getBoundingClientRect().bottom <= innerHeight + 1));
    await page.screenshot({path: path.join(shots, 'phone-demo-sheet.png')});
    const before = await page.evaluate((id) => document.querySelector('[data-r30-card="' + id + '"]')
      .closest('.r30-group').getAttribute('data-r30-group'), firstId);
    await page.click('.r30-sheet [data-r30-col="review"]');
    check('手机演示：点「等验收」当场落到那一列', await page.evaluate((id) =>
      document.querySelector('[data-r30-card="' + id + '"]').closest('.r30-group')
        .getAttribute('data-r30-group') === 'review',
      firstId) && before !== 'review');
    await page.click('.r30-sheet [data-r30-who]:nth-child(3)');
    check('手机演示：换负责人后操作单里那个人亮起来', await page.evaluate(() =>
      document.querySelectorAll('.r30-sheet .r30-who.is-on').length === 1 &&
      !document.querySelector('.r30-sheet .r30-who.is-on[data-r30-who=""]')));
    await page.click('.r30-sheet [data-r30-edit]');
    await page.fill('.r30-sheet [name=title]', '改过的标题<b>x</b>');
    await page.fill('.r30-sheet [name=goal]', '改过的说明');
    await page.click('.r30-sheet [data-r30-save]');
    await page.click('.r30-sheet [data-r30-close]');
    check('手机演示：标题改了，尖括号按文字显示', await page.evaluate((id) => {
      const t = document.querySelector('[data-r30-card="' + id + '"] .r29-desk-title');
      return t.textContent === '改过的标题<b>x</b>' && !t.querySelector('b');
    }, firstId));
    await page.screenshot({path: path.join(shots, 'phone-demo-after-change.png')});
    // 点头像直接换人
    await page.click('[data-r30-card="' + firstId + '"] [data-r30-assign]');
    check('手机演示：点头像出「派给谁」小单，选一个就关', await page.evaluate(() =>
      !document.querySelector('.r30-sheet .r30-cols') && document.querySelectorAll('.r30-sheet .r30-who').length >= 4));
    await page.screenshot({path: path.join(shots, 'phone-demo-assign.png')});
    await page.click('.r30-sheet .r30-who:nth-child(2)');
    check('手机演示：选完小单自动关闭', await page.evaluate(() => !document.querySelector('.r30-sheet')));
    // 新建
    await page.click('.r30-phone [data-r30-new]');
    await page.fill('.r30-sheet [name=title]', '新建的一张');
    // 初始状态收进可选项；点「交给某人」直接建（少点一下）。
    await page.click('.r30-sheet .r30-opt summary');
    await page.click('.r30-sheet [data-r30-newcol="progress"]');
    // 负责人那一排第一项改成了「谁有空谁接」；第二项又加了「交给首席安排」，这里点的是第一位助理（第 3 个按钮）。
    await page.click('.r30-sheet [data-r30-newgo]:nth-child(3)');
    check('手机演示：新建时选了派给谁和放哪一列，出现在列表里', await page.evaluate(() => {
      const card = [...document.querySelectorAll('.r30-pcard')].find((c) => c.textContent.includes('新建的一张'));
      return !!card && card.closest('.r30-group').getAttribute('data-r30-group') === 'progress' &&
        !!card.querySelector('.r30-face *');
    }));
    check('手机演示：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ---- 手机：真实模式 + 假后端 ----
    const backend = fakeBackend();
    s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend});
    page = s.page;
    // 已完成的默认折起；展开后才是 25 张。
    const foldedN = backend.tickets.filter((t) => t.state === 'completed').length;
    check('手机真实：已完成默认折起，只给一条「已完成 N 件」', await page.evaluate((n) =>
      document.querySelectorAll('.r30-pcard').length === 25 - n && document.querySelectorAll('[data-r30-fold]').length === 1, foldedN));
    await page.click('[data-r30-fold]');
    check('手机真实：卡片来自后端，旧单也在', await page.evaluate(() => document.querySelectorAll('.r30-pcard').length === 25));
    await touchScroll(s.ctx, page, 900, 14);
    info = await scrollInfo(page);
    check('手机真实：25 张卡一路滑到最底，最后一张完整露出', info.top + info.ch >= info.sh - 2 &&
      info.lastBottom <= info.boxBottom - 8 && info.sh > info.ch * 2);
    await page.screenshot({path: path.join(shots, 'phone-real-bottom.png')});
    await page.evaluate(() => { document.querySelector('.r30-list').scrollTop = 0; });
    const target = backend.tickets.find((t) => t.state === 'queued' && !t.legacy).id;
    await page.click('[data-r30-card="' + target + '"] .r29-desk-title');
    await page.click('.r30-sheet [data-r30-col="progress"]');
    await page.waitForTimeout(300);
    check('手机真实：改状态真发给后端，后端那张单变了', backend.calls.some((c) =>
      c.path === '/tickets/' + target + '/move' && c.body.column === 'progress') &&
      backend.tickets.find((t) => t.id === target).state === 'progress');
    await page.click('.r30-sheet [data-r30-who="chief"]');
    await page.waitForTimeout(300);
    check('手机真实：换负责人真发给后端，带上是助理', backend.calls.some((c) =>
      c.path === '/tickets/' + target + '/assign' && c.body.assignee === 'chief' &&
      c.body.assigneeType === 'assistant'));
    check('手机真实：外部身份也在名单里', await page.evaluate(() =>
      [...document.querySelectorAll('.r30-sheet .r30-who')].some((b) => b.textContent.includes('pm-agent'))));
    await page.click('.r30-sheet [data-r30-who="ext:external:pm-agent"]');
    await page.waitForTimeout(300);
    check('手机真实：派给外部 agent 带上类型 external', backend.calls.some((c) =>
      c.body.assignee === 'pm-agent' && c.body.assigneeType === 'external'));
    await page.click('.r30-sheet [data-r30-edit]');
    await page.fill('.r30-sheet [name=title]', '后端里的新标题');
    await page.fill('.r30-sheet [name=goal]', '后端里的新说明');
    await page.click('.r30-sheet [data-r30-save]');
    await page.waitForTimeout(300);
    const saved = backend.tickets.find((t) => t.id === target);
    check('手机真实：改标题和说明真发给后端', saved.title === '后端里的新标题' && saved.goal === '后端里的新说明');
    await page.screenshot({path: path.join(shots, 'phone-real-sheet.png')});
    await page.click('.r30-sheet [data-r30-close]');
    // 失败要放回去
    backend.fail = true;
    const target2 = backend.tickets.find((t) => t.state === 'completed').id;
    await page.click('[data-r30-card="' + target2 + '"] .r29-desk-title');
    await page.click('.r30-sheet [data-r30-col="queued"]');
    await page.waitForTimeout(400);
    check('手机真实：后端拒绝时卡片放回原列，不假装成功', await page.evaluate((id) =>
      document.querySelector('[data-r30-card="' + id + '"]').closest('.r30-group')
        .getAttribute('data-r30-group') === 'done',
      target2));
    backend.fail = false;
    await page.click('.r30-sheet [data-r30-close]');
    // 旧单只读
    await page.click('[data-r30-card="T-20261119-099900-leg1"] .r29-desk-title');
    check('手机真实：旧单只能看，按钮全是灰的', await page.evaluate(() =>
      [...document.querySelectorAll('.r30-sheet .r30-col')].every((b) => b.disabled) &&
      document.querySelector('.r30-sheet').textContent.includes('只能看')));
    await page.click('.r30-sheet [data-r30-close]');
    // 新建
    await page.click('.r30-phone [data-r30-new]');
    await page.fill('.r30-sheet [name=title]', '真实新建的卡');
    await page.click('.r30-sheet [data-r30-newgo="chief"]');
    await page.waitForTimeout(300);
    check('手机真实：新建真发给后端，带上派给谁', backend.calls.some((c) =>
      c.path === '/tickets/new' && c.body.title === '真实新建的卡' && c.body.to === 'chief'));
    check('手机真实：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ---- 手机：底部安全区（主屏幕独立模式在 iPhone 上 env 不为 0）。用浏览器自带的安全区模拟。 ----
    s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend: fakeBackend()});
    page = s.page;
    const cdpSafe = await s.ctx.newCDPSession(page);
    await cdpSafe.send('Emulation.setSafeAreaInsetsOverride', {insets: {top: 47, bottom: 34, left: 0, right: 0}});
    await page.waitForTimeout(300);
    await touchScroll(s.ctx, page, 900, 14);
    const safe = await page.evaluate(() => {
      const list = document.querySelector('.r30-list');
      const cards = list.querySelectorAll('.r30-card');
      const last = cards[cards.length - 1].getBoundingClientRect();
      return {pad: parseFloat(getComputedStyle(list).paddingBottom),
        gap: list.getBoundingClientRect().bottom - last.bottom,
        atEnd: list.scrollTop + list.clientHeight >= list.scrollHeight - 2};
    });
    check('手机：有底部安全区时，滚动区自己多留 34px，最后一张卡离屏幕底边至少 60px',
      safe.atEnd && safe.pad >= 66 && safe.gap >= 60);
    await page.screenshot({path: path.join(shots, 'phone-real-bottom-safe-area.png')});
    await s.ctx.close();

    // ---- 电脑：演示模式 拖动 ----
    s = await open(browser, {width: 1440, height: 900});
    page = s.page;
    check('电脑演示：五列并排，卡片可拖', await page.evaluate(() =>
      document.querySelectorAll('.r29-desk-col').length === 5 &&
      document.querySelectorAll('.r29-desk-card').length > 5));
    await page.screenshot({path: path.join(shots, 'desk-demo-before-drag.png')});
    const dragId = await page.evaluate(() => document.querySelector('[data-r29-desk-col="queued"] .r30-card')
      .getAttribute('data-r30-card'));
    const from = await page.locator('.r29-desk [data-r30-card="' + dragId + '"] .r29-desk-title').boundingBox();
    const to = await page.locator('[data-r29-desk-col="progress"]').boundingBox();
    await page.mouse.move(from.x + 10, from.y + 6);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 20, {steps: 4});
    await page.mouse.move(to.x + to.width / 2, to.y + 120, {steps: 12});
    check('电脑演示：拖的时候目标列亮框', await page.evaluate(() => !!document.querySelector('.r29-desk-col.is-over') &&
      !!document.querySelector('.r30-ghost')));
    await page.screenshot({path: path.join(shots, 'desk-demo-dragging.png')});
    await page.mouse.up();
    await page.waitForTimeout(200);
    check('电脑演示：放手后卡片到了「在做」列', await page.evaluate((id) =>
      document.querySelector('.r29-desk [data-r30-card="' + id + '"]').closest('[data-r29-desk-col]')
        .getAttribute('data-r29-desk-col') === 'progress' && !document.querySelector('.r30-ghost'), dragId));
    await page.screenshot({path: path.join(shots, 'desk-demo-after-drag.png')});
    check('电脑演示：拖完没有误开操作单', await page.evaluate(() => !document.querySelector('.r30-sheet')));
    await page.click('.r29-desk [data-r30-card="' + dragId + '"] .r29-desk-title');
    check('电脑演示：点一下卡片，右侧栏出快捷操作', await page.evaluate(() =>
      document.querySelectorAll('.r29-desk-side .r30-col').length === 5 &&
      document.querySelectorAll('.r29-desk-side .r30-who').length >= 4));
    await page.click('.r29-desk-side [data-r30-col="done"]');
    check('电脑演示：右侧栏改状态同样生效', await page.evaluate((id) =>
      document.querySelector('.r29-desk [data-r30-card="' + id + '"]').closest('[data-r29-desk-col]')
        .getAttribute('data-r29-desk-col') === 'done', dragId));
    await page.click('.r29-desk [data-r30-card="' + dragId + '"] [data-r30-menu]');
    check('电脑演示：卡片右上角菜单出居中的操作单', await page.evaluate(() => {
      const b = document.querySelector('.r30-sheet').getBoundingClientRect();
      return Math.abs(b.left + b.width / 2 - innerWidth / 2) < 4 && b.bottom < innerHeight;
    }));
    await page.screenshot({path: path.join(shots, 'desk-demo-sheet.png')});
    await page.keyboard.press('Escape');
    check('电脑演示：Esc 关操作单', await page.evaluate(() => !document.querySelector('.r30-sheet')));
    // Esc 取消拖动
    const fromB = await page.locator('[data-r29-desk-col="queued"] .r30-card .r29-desk-title').first().boundingBox();
    await page.mouse.move(fromB.x + 8, fromB.y + 6);
    await page.mouse.down();
    await page.mouse.move(fromB.x + 300, fromB.y + 100, {steps: 8});
    await page.keyboard.press('Escape');
    await page.mouse.up();
    check('电脑演示：拖到一半按 Esc 取消，不改列', await page.evaluate(() => !document.querySelector('.r30-ghost') &&
      document.querySelectorAll('[data-r29-desk-col="queued"] .r30-card').length >= 1));
    check('电脑演示：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ---- 电脑：真实模式拖动落后端 ----
    const b2 = fakeBackend();
    s = await open(browser, {width: 1440, height: 900, real: true, backend: b2});
    page = s.page;
    const qid = b2.tickets.find((t) => t.state === 'queued' && !t.legacy).id;
    const f2 = await page.locator('.r29-desk [data-r30-card="' + qid + '"] .r29-desk-title').boundingBox();
    const t2 = await page.locator('[data-r29-desk-col="review"]').boundingBox();
    await page.screenshot({path: path.join(shots, 'desk-real-before-drag.png')});
    await page.mouse.move(f2.x + 10, f2.y + 6);
    await page.mouse.down();
    await page.mouse.move(f2.x + 50, f2.y + 20, {steps: 4});
    await page.mouse.move(t2.x + t2.width / 2, t2.y + 100, {steps: 14});
    await page.mouse.up();
    await page.waitForTimeout(400);
    const moved = b2.tickets.find((t) => t.id === qid);
    check('电脑真实：拖到「等验收」真落到后端', b2.calls.some((c) => c.path === '/tickets/' + qid + '/move' &&
      c.body.column === 'review') && moved.review === 'submitted');
    check('电脑真实：界面上卡片也在「等验收」列', await page.evaluate((id) =>
      document.querySelector('.r29-desk [data-r30-card="' + id + '"]').closest('[data-r29-desk-col]')
        .getAttribute('data-r29-desk-col') === 'review', qid));
    await page.screenshot({path: path.join(shots, 'desk-real-after-drag.png')});
    // 旧单拖不动
    const lf = await page.locator('.r29-desk [data-r30-card="T-20261119-099900-leg1"] .r29-desk-title').boundingBox();
    const dropBox = await page.locator('[data-r29-desk-col="done"]').boundingBox();
    const callsBefore = b2.calls.length;
    await page.mouse.move(lf.x + 10, lf.y + 6);
    await page.mouse.down();
    await page.mouse.move(dropBox.x + dropBox.width / 2, dropBox.y + 100, {steps: 12});
    await page.mouse.up();
    await page.waitForTimeout(300);
    check('电脑真实：旧单拖不动，也不发请求', b2.calls.length === callsBefore);
    // 点头像换人
    await page.click('.r29-desk [data-r30-card="' + qid + '"] [data-r30-assign]');
    await page.click('.r30-sheet [data-r30-who="chief"]');
    await page.waitForTimeout(300);
    check('电脑真实：点头像换人落到后端', b2.calls.some((c) => c.path === '/tickets/' + qid + '/assign' &&
      c.body.assignee === 'chief'));
    check('电脑真实：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ---- 暗色手机，截图看一眼 ----
    s = await open(browser, {width: 390, height: 844, touch: true, scheme: 'dark'});
    await s.page.click('.r30-pcard .r29-desk-title');
    await s.page.screenshot({path: path.join(shots, 'phone-demo-sheet-dark.png')});
    await s.ctx.close();
    console.log('合计通过 ' + passed + ' 项');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
