// 看板删卡（页内确认、软删除）、一次清掉已完成的、编辑只提交改过的字且编辑框是原文、更多里不再有看板和活动。
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
const port = 3843;
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
    const m = /^\/bff\/board\/tickets(?:\/new|\/([^/]+)\/(move|assign|edit|delete))$/.exec(p);
    if (req.method() !== 'POST' || !m) return json(404, {});
    const body = JSON.parse(req.postData() || '{}');
    calls.push({path: p.replace('/bff/board', ''), body});
    if (backend.fail) return json(409, {error: {code: 'CONFLICT'}});
    if (m[1] && !tickets.some((x) => x.id === m[1])) return json(404, {});
    if (!m[1]) {
      const t = {...tickets[0], id: 'T-20261119-100000-new' + calls.length, title: body.title,
        goal: body.goal || body.title, to: body.to ? [body.to] : [], state: 'queued', claimedBy: null,
        updatedAt: new Date().toISOString()};
      tickets.unshift(t);
      return json(201, {ticket: t});
    }
    const t = tickets.find((x) => x.id === m[1]);
    if (m[2] === 'delete') {
      tickets.splice(tickets.indexOf(t), 1);
      return json(200, {ticket: t});
    }
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

const cardCount = (page) => page.evaluate(() => document.querySelectorAll('.r30-phone .r30-card').length);

(async () => {
  const server = await serve();
  const browser = await playwright.chromium.launch({executablePath: chromium, headless: true});
  try {
    // ---- 演示模式：删一张、清完成 ----
    let s = await open(browser, {width: 390, height: 844, touch: true});
    let page = s.page;
    let dialogs = 0;
    page.on('dialog', (d) => { dialogs += 1; d.dismiss(); });
    const n0 = await cardCount(page);
    const id0 = await page.evaluate(() => document.querySelector('.r30-pcard').getAttribute('data-r30-card'));
    await page.click('.r30-pcard .r29-desk-title');
    await page.waitForSelector('.r30-sheet');
    check('演示：操作单里有「删掉这张」', await page.locator('.r30-sheet [data-r30-del]').count() === 1);
    await page.click('.r30-sheet [data-r30-del]');
    check('演示：点了先出页内确认，卡还在', await page.locator('.r30-sheet .r30-confirm').count() === 1 &&
      await cardCount(page) === n0);
    await page.click('.r30-sheet [data-r30-del-no]');
    check('演示：先不删，确认条收起', await page.locator('.r30-sheet .r30-confirm').count() === 0 &&
      await page.locator('.r30-sheet [data-r30-del]').count() === 1);
    await page.click('.r30-sheet [data-r30-del]');
    await page.click('.r30-sheet [data-r30-del-yes]');
    await page.waitForTimeout(200);
    check('演示：确认后卡片没了，操作单关了', await cardCount(page) === n0 - 1 &&
      await page.locator('[data-r30-card="' + id0 + '"]').count() === 0 && await page.locator('.r30-sheet').count() === 0);
    check('演示：整个过程没有浏览器弹窗', dialogs === 0);
    await page.click('.r30-phone [data-r30-tab="done"]');
    const doneN = await cardCount(page);
    check('演示：完成这一列下有「清掉已完成的」', doneN > 0 &&
      await page.locator('.r30-phone [data-r30-clear]').count() === 1);
    await page.click('.r30-phone [data-r30-clear]');
    check('演示：点了先出确认，卡还在', await page.locator('.r30-phone .r30-confirm').count() === 1 &&
      await cardCount(page) === doneN);
    await page.click('.r30-phone [data-r30-del-no]');
    check('演示：先不清，卡还在', await cardCount(page) === doneN);
    await page.click('.r30-phone [data-r30-clear]');
    await page.click('.r30-phone [data-r30-clear-yes]');
    await page.waitForTimeout(200);
    check('演示：确认后完成列清空', await cardCount(page) === 0);
    check('演示：没有报错', s.errors.length === 0);
    // 更多里没有看板和活动
    await page.evaluate(() => Hub.openPanel('more'));
    await page.waitForSelector('[data-r29-more-list]');
    const ids = await page.locator('[data-r29-more-list] [data-r29-more]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-r29-more')));
    check('演示：更多里没有看板和活动，也没有重复', !ids.includes('board') && !ids.includes('activity') &&
      new Set(ids).size === ids.length);
    await s.ctx.close();

    // ---- 真实模式（内存假后端） ----
    const b = fakeBackend();
    b.tickets[1].title = '很长的标题 验收 ' + '长'.repeat(50);
    b.tickets[1].goal = '先做验收，再说';
    b.tickets[4].state = 'completed';
    s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend: b});
    page = s.page;
    const longId = b.tickets[1].id;
    const longTitle = b.tickets[1].title;
    await page.click('.r30-pcard[data-r30-card="' + longId + '"] .r29-desk-title');
    await page.click('.r30-sheet [data-r30-edit]');
    const form = await page.evaluate(() => ({t: document.querySelector('.r30-sheet [name=title]').value,
      g: document.querySelector('.r30-sheet [name=goal]').value}));
    check('真实：编辑框里是库里的原文（没截断、没被说人话替换）', form.t === longTitle && form.g === '先做验收，再说');
    let before = b.calls.length;
    await page.click('.r30-sheet [data-r30-save]');
    await page.waitForTimeout(200);
    check('真实：什么都没改就保存，不发请求', b.calls.length === before);
    await page.click('.r30-sheet [data-r30-edit]');
    await page.fill('.r30-sheet [name=goal]', '先做验收，再说。补一句');
    await page.click('.r30-sheet [data-r30-save]');
    await page.waitForTimeout(300);
    const edit = b.calls.filter((c) => c.path === '/tickets/' + longId + '/edit').pop();
    check('真实：只改说明，请求里只带说明、不带标题', edit && edit.body.goal === '先做验收，再说。补一句' &&
      !('title' in edit.body));
    check('真实：库里标题原样', b.tickets[1].title === longTitle && !b.tickets[1].title.includes('看过确认'));
    // 删：失败放回，成功后请求走 delete
    b.fail = true;
    await page.click('.r30-sheet [data-r30-del]');
    await page.click('.r30-sheet [data-r30-del-yes]');
    await page.waitForTimeout(300);
    check('真实：后端拒绝时卡片放回来', await page.locator('.r30-phone [data-r30-card="' + longId + '"]').count() === 1);
    b.fail = false;
    await page.click('.r30-sheet [data-r30-del]');
    await page.click('.r30-sheet [data-r30-del-yes]');
    await page.waitForTimeout(300);
    check('真实：确认后发 delete，卡片没了', b.calls.some((c) => c.path === '/tickets/' + longId + '/delete') &&
      await page.locator('.r30-phone [data-r30-card="' + longId + '"]').count() === 0);
    // 清完成：旧单（locked）不删
    const doneIds = b.tickets.filter((t) => t.state === 'completed' && !t.legacy).map((t) => t.id);
    await page.click('.r30-phone [data-r30-tab="done"]');
    await page.click('.r30-phone [data-r30-clear]');
    await page.click('.r30-phone [data-r30-clear-yes]');
    await page.waitForTimeout(600);
    const deleted = b.calls.filter((c) => /\/delete$/.test(c.path)).map((c) => c.path.split('/')[2]);
    check('真实：清完成：每张完成的都发了 delete', doneIds.length > 0 && doneIds.every((id) => deleted.includes(id)));
    check('真实：没有报错', s.errors.length === 0);
    await s.ctx.close();
    console.log('合计通过 ' + passed + ' 项');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
