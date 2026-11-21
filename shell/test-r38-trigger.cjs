// 触发（首席安排与卡片定时）：新建里的「交给首席安排」与「什么时候做」、卡片小钟与小标、点开的说明与三个操作、
// 拖没负责人的卡、定时模板折叠区、今天页首席建议三个操作 / 没叫动 / 今天的固定任务、演示。
// 只连 127.0.0.1；需要先 python3 build.py --demo generic。真实模式用内存假后端（拦 /bff/board/*）。
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
const port = 0;
const dist = path.join(__dirname, 'dist-generic');
const shots = process.env.R38_SHOTS || path.join(__dirname, 'tmp/r38-trigger');
let base = 'http://127.0.0.1/DSH-Hub.html';
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
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    base = 'http://127.0.0.1:' + server.address().port + '/DSH-Hub.html'; resolve(server);
  }));
}

const iso = (min) => new Date(Date.now() + min * 60000).toISOString();
const tk = (id, title, over) => Object.assign({id, title, goal: title + '的说明', from: {name: 'owner', type: 'owner'}, to: [], claimedBy: null,
  claimedByType: null, state: 'queued', review: 'none', open_ask: null, createdAt: iso(-300), updatedAt: iso(-5), progress: [], reports: [],
  report: null, verification: [], acceptance: [], history: []}, over || {});
const ID = {wanted: 'T-20261119-100000-w001', proposed: 'T-20261119-100100-p002', applied: 'T-20261119-100200-a003', once: 'T-20261119-100300-o004',
  tpl: 'T-20261119-100400-t005', plain: 'T-20261119-100500-n006', owned: 'T-20261119-100600-d007', plain2: 'T-20261119-100700-n008',
  missed: 'T-20261119-100800-m009'};

function backendWith() {
  const plan = {kind: 'bot', who: {name: 'research', type: 'assistant'}, when: {kind: 'now'}, why: '这是对外发布的事', askOwner: false, askReason: ''};
  const tickets = [
    tk(ID.wanted, '等首席给结论的卡', {arrange: {state: 'wanted', via: 'new', requestedAt: iso(-1), attempts: 0}}),
    tk(ID.proposed, '把名字发到对外公众号', {state: 'waiting-human', open_ask: {text: 'x', ts: iso(-2)},
      arrange: {state: 'proposed', via: 'drag', requestedAt: iso(-4), proposedAt: iso(-2), plan, note: '首席建议：交给 调研员，现在做。因为这是对外发布的事',
        needs: [{code: 'publish', text: '这是对外发送或公开发布，要先确认'}]}}),
    tk(ID.applied, '首席直接派走的卡', {to: ['research'], arrange: {state: 'applied', via: 'new', requestedAt: iso(-30), decision: 'auto',
      note: '首席安排：交给 调研员，现在做。因为这类事归调研员管', plan: Object.assign({}, plan, {why: '这类事归调研员管'})}}),
    tk(ID.once, '三分钟后的事', {schedule: {kind: 'once', at: iso(3), assignee: {name: 'research', type: 'assistant'}, state: 'waiting', template: false, by: 'owner', createdAt: iso(-1)}}),
    tk(ID.tpl, '每日晨报', {schedule: {kind: 'daily', time: '09:00', assignee: {name: 'content', type: 'assistant'}, state: 'waiting', template: true, by: 'owner', createdAt: iso(-1000)}}),
    tk(ID.plain, '没写负责人的普通卡', {}),
    tk(ID.plain2, '另一张没负责人的卡', {}),
    tk(ID.owned, '有负责人的卡', {to: ['research']}),
    tk(ID.missed, '错过的定时', {schedule: {kind: 'once', at: iso(-600), assignee: null, state: 'missed', template: false, by: 'owner', createdAt: iso(-900)}}),
  ];
  const calls = [];
  let n = 100;
  const handle = (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (status, body) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    if (!p.startsWith('/bff/board/')) return route.abort();
    if (req.method() === 'GET' && p === '/bff/board/tickets') return json(200, {tickets});
    if (req.method() === 'GET' && p === '/bff/board/people') return json(200, {people: [{id: 'codex', name: 'codex', type: 'external'}]});
    if (req.method() !== 'POST') return json(404, {});
    const body = JSON.parse(req.postData() || '{}');
    if (p === '/bff/board/tickets/new') {
      calls.push({path: 'new', body});
      n += 1;
      const t = tk('T-20261119-1' + n + '00-n' + String(n).padStart(3, '0'), body.title, {goal: body.goal || body.title, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), to: body.to && !body.schedule ? [body.to] : []});
      if (body.arrange) t.arrange = {state: 'wanted', via: 'new', requestedAt: new Date().toISOString(), attempts: 0};
      if (body.schedule) t.schedule = Object.assign({}, body.schedule, {assignee: body.to ? {name: body.to, type: 'assistant'} : null, state: 'waiting', template: body.schedule.kind !== 'once', by: 'owner', createdAt: new Date().toISOString()});
      tickets.unshift(t);
      return json(201, {ticket: t});
    }
    const m = /^\/bff\/board\/tickets\/([^/]+)\/(assign|answer|move|edit|delete|arrange|schedule)$/.exec(p);
    if (!m) return json(404, {});
    calls.push({path: m[2], id: m[1], body});
    const t = tickets.find((x) => x.id === m[1]);
    if (!t) return json(404, {});
    if (m[2] === 'move') {
      // 后端的新规则：没负责人的卡拖到「在做」= 请首席安排，卡留在待领；有负责人的只改状态。
      if (body.column === 'progress' && !t.to.length && !t.claimedBy) t.arrange = {state: 'wanted', via: 'drag', requestedAt: new Date().toISOString(), attempts: 0};
      else if (body.column === 'progress') { t.state = 'progress'; t.claimedBy = t.to[0]; }
      else if (body.column === 'done') t.state = 'completed';
    } else if (m[2] === 'arrange') {
      if (t.requireConfirmation && ['ok', 'swap'].includes(body.action)) {
        return json(202, {ticket: {...t, awaitingConfirmation: true}});
      }
      if (body.action === 'ok') { t.arrange = Object.assign({}, t.arrange, {state: 'applied', decision: 'ok'}); t.state = 'queued'; t.to = ['research']; t.open_ask = null; }
      else if (body.action === 'skip') { t.arrange = Object.assign({}, t.arrange, {state: 'declined'}); t.state = 'queued'; t.open_ask = null; }
      else if (body.action === 'swap') { t.arrange = Object.assign({}, t.arrange, {state: 'applied', decision: 'swap'}); t.state = 'queued'; t.to = [body.who]; t.open_ask = null; }
      else if (body.action === 'ask') t.arrange = {state: 'wanted', via: 'button', requestedAt: new Date().toISOString(), attempts: 0};
    } else if (m[2] === 'schedule') {
      if (body.action === 'set') t.schedule = Object.assign({}, body.schedule, {assignee: null, state: 'waiting', template: body.schedule.kind !== 'once', by: 'owner', createdAt: new Date().toISOString()});
      else if (body.action === 'clear') delete t.schedule;
      else if (body.action === 'pause') t.schedule.state = 'paused';
      else if (body.action === 'resume') t.schedule.state = 'waiting';
    } else return json(409, {});
    t.updatedAt = new Date().toISOString();
    return json(200, {ticket: t});
  };
  return {tickets, calls, handle};
}

async function open(browser, {width, height, touch, real, backend, scheme, hash, reduced, tick}) {
  const options = {viewport: {width, height}, hasTouch: !!touch, isMobile: !!touch, deviceScaleFactor: touch ? 2 : 1,
    colorScheme: scheme || 'light', reducedMotion: reduced ? 'reduce' : 'no-preference', timezoneId: 'Asia/Tokyo'};
  const ctx = await browser.newContext(options);
  await ctx.addInitScript((arg) => {
    (function f() {
      if (document.documentElement) { if (arg.real) document.documentElement.dataset.hubMode = 'real'; }
      else setTimeout(f, 0);
    })();
    if (arg.tick) window.__R38_TICK_MS = arg.tick;
  }, {real: !!real, tick});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname.startsWith('/bff/')) return backend ? backend.handle(route) : route.abort();
    return route.continue();
  });
  await page.goto(base + (hash === undefined ? '#kanban' : hash));
  await page.waitForSelector(hash === undefined ? '.r30-phone, .r29-desk' : 'body', {state: 'attached'});
  await page.waitForTimeout(700);
  return {ctx, page, errors};
}
const shot = (page, name) => page.screenshot({path: path.join(shots, name)});

(async () => {
  fs.mkdirSync(shots, {recursive: true});
  const server = await serve();
  const browser = await playwright.chromium.launch({executablePath: chromium, headless: true});
  try {
    // ================= 真实模式（手机） =================
    const backend = backendWith();
    let s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend});
    let page = s.page;
    const card = (id) => page.evaluate((i) => { const c = document.querySelector('[data-r30-card="' + i + '"]'); return c ? c.innerText : null; }, id);
    check('真实：等首席给结论的卡显示「首席安排中」', /首席安排中/.test(await card(ID.wanted) || ''));
    check('真实：等你点头的卡显示「首席建议 · 等你点头」', /首席建议 · 等你点头/.test(await card(ID.proposed) || ''));
    check('真实：首席直接派走的卡显示「首席安排的」', /首席安排的/.test(await card(ID.applied) || ''));
    const onceText = await card(ID.once) || '';
    check('真实：定时的卡有小钟和时间（今天 hh:mm）', /今天 \d\d:\d\d/.test(onceText) && await page.evaluate((i) => !!document.querySelector('[data-r30-card="' + i + '"] .r38-chip svg.r38-clk'), ID.once));
    check('真实：定时的卡到点之前，负责人显示成它要交给的人（调研员），说明「到点」', /到点/.test(onceText));
    check('真实：定时模板不混在五列里，也不在手机的卡列表里', await card(ID.tpl) === null);
    check('真实：看板下面有折叠的「定时任务 · 1 个」，里面是模板', await page.evaluate(() => { const d = document.querySelector('.r30-phone [data-r38-tpl]'); return !!d && /定时任务 · 1 个/.test(d.querySelector('summary').textContent) && /每日晨报/.test(d.textContent) && /每天 09:00/.test(d.textContent); }));
    check('真实：旧的没负责人的普通卡没有任何首席安排或定时小标（不会被自动分派）', await page.evaluate((ids) => ids.every((i) => !document.querySelector('[data-r30-card="' + i + '"] .r38-chip')), [ID.plain, ID.plain2, ID.owned]));
    check('界面上没有 owner 字样', await page.evaluate(() => !/\bowner\b/i.test(document.body.innerText)));
    await shot(page, 'phone-board-trigger.png');
    await page.evaluate(() => { document.querySelector('.r30-phone [data-r38-tpl]').open = true; document.querySelector('.r30-phone .r30-list').scrollTop = 99999; });
    await page.waitForTimeout(200);
    await shot(page, 'phone-board-templates.png');
    // ---- 点开等你点头的卡：三个操作 ----
    await page.click('[data-r30-card="' + ID.proposed + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r38-box[data-r38-box=proposed]');
    check('点开首席建议：写着建议、原因，有「就这么办 / 换个人 / 先不做」三个操作', await page.evaluate(() => { const b = document.querySelector('.r30-sheet [data-r38-box=proposed]');
      return /首席建议：交给 调研员，现在做。因为这是对外发布的事/.test(b.textContent) && /对外发送或公开发布/.test(b.textContent) && !!b.querySelector('[data-r38-ok]') && !!b.querySelector('[data-r38-swap]') && !!b.querySelector('[data-r38-skip]'); }));
    await shot(page, 'phone-sheet-proposed.png');
    await page.click('.r30-sheet [data-r38-swap]');
    await page.waitForSelector('.r30-sheet .r38-pick button');
    check('「换个人」展开人选；点一位才换', await page.evaluate(() => document.querySelectorAll('.r30-sheet .r38-pick button').length >= 1) && backend.calls.every((c) => c.path !== 'arrange'));
    await shot(page, 'phone-sheet-swap.png');
    await page.click('.r30-sheet .r38-pick button[data-r38-who="codex"], .r30-sheet .r38-pick button >> nth=0');
    await page.waitForTimeout(400);
    const swapCall = backend.calls.filter((c) => c.path === 'arrange').pop();
    check('换人真发给后端：arrange swap，带 who', swapCall && swapCall.id === ID.proposed && swapCall.body.action === 'swap' && typeof swapCall.body.who === 'string' && swapCall.body.who);
    check('换完后这张卡不再是「等你点头」', !/等你点头/.test(await card(ID.proposed) || ''));
    // 「就这么办」「先不做」：用另外两张
    backend.tickets.find((t) => t.id === ID.wanted).state = 'waiting-human';
    Object.assign(backend.tickets.find((t) => t.id === ID.wanted), {arrange: Object.assign({}, backend.tickets.find((t) => t.id === ID.wanted).arrange, {state: 'proposed', plan: {kind: 'bot', who: {name: 'research', type: 'assistant'}, when: {kind: 'now'}, why: 'x'}, note: '首席建议：交给 调研员，现在做。因为x', needs: []})});
    await page.evaluate(() => { try { r29DeskPull && (r29DeskLastPull = null); r29DeskPull(); } catch (e) {} });
    await page.waitForTimeout(600);
    await page.click('[data-r30-card="' + ID.wanted + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet [data-r38-ok]');
    await page.click('.r30-sheet [data-r38-ok]');
    await page.waitForTimeout(400);
    check('「就这么办」真发给后端：arrange ok', backend.calls.some((c) => c.path === 'arrange' && c.id === ID.wanted && c.body.action === 'ok'));
    check('点头之后这张卡显示「首席安排的」', /首席安排的/.test(await card(ID.wanted) || ''));
    // ---- 首席直接派走的：看得到那句话 ----
    await page.click('[data-r30-card="' + ID.applied + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet [data-r38-box=applied]');
    check('点开首席直接派走的卡：写着「首席安排：交给 调研员，现在做。因为……」', await page.evaluate(() => /首席安排：交给 调研员，现在做。因为这类事归调研员管/.test(document.querySelector('.r30-sheet [data-r38-box=applied]').textContent)));
    await shot(page, 'phone-sheet-applied.png');
    await page.click('.r30-sheet [data-r30-close]').catch(() => {});
    // ---- 定时卡：说明块、取消 ----
    await page.click('[data-r30-card="' + ID.once + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet [data-r38-box=clock]');
    check('点开定时的卡：写着到点会叫醒谁，有「取消定时」', await page.evaluate(() => { const b = document.querySelector('.r30-sheet [data-r38-box=clock]'); return /到点会叫醒/.test(b.textContent) && !!b.querySelector('[data-r38-unsched]'); }));
    await page.click('.r30-sheet [data-r38-unsched]');
    await page.waitForTimeout(400);
    check('取消定时真发给后端：schedule clear', backend.calls.some((c) => c.path === 'schedule' && c.id === ID.once && c.body.action === 'clear'));
    // ---- 模板：点开，能暂停 ----
    await page.evaluate(() => { document.querySelector('.r30-phone [data-r38-tpl]').open = true; });
    await page.click('.r30-phone .r38-tpl-row');
    await page.waitForSelector('.r30-sheet [data-r38-pause]');
    check('点开定时模板：有「暂停定时」', true);
    await page.click('.r30-sheet [data-r38-pause]');
    await page.waitForTimeout(300);
    check('暂停真发给后端：schedule pause', backend.calls.some((c) => c.path === 'schedule' && c.id === ID.tpl && c.body.action === 'pause'));
    await page.click('.r30-sheet [data-r30-close]').catch(() => {});
    // ---- 没负责人的普通卡：点「交给首席安排」 ----
    await page.click('[data-r30-card="' + ID.plain + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r38-ask');
    check('普通没人负责的卡：派给谁那一排有「交给首席安排」，下面有「定个时间做…」', await page.evaluate(() => !!document.querySelector('.r30-sheet .r38-ask') && !!document.querySelector('.r30-sheet [data-r38-sched-open]')));
    await page.click('.r30-sheet [data-r38-ask]');
    await page.waitForTimeout(400);
    check('点它真发给后端：arrange ask', backend.calls.some((c) => c.path === 'arrange' && c.id === ID.plain && c.body.action === 'ask'));
    check('点完这张卡出现「首席安排中」，旁边的卡不受影响', /首席安排中/.test(await card(ID.plain) || '') && !/首席安排中/.test(await card(ID.plain2) || ''));
    // ---- 给卡定时 ----
    await page.click('[data-r30-card="' + ID.plain2 + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet [data-r38-sched-open]');
    await page.click('.r30-sheet [data-r38-sched-open]');
    await page.waitForSelector('.r30-sheet [data-r38-sform]');
    await page.click('.r30-sheet [data-r38-sched-save]');
    await page.waitForTimeout(150);
    check('不选时间点「定下来」：不发给后端', backend.calls.filter((c) => c.path === 'schedule' && c.id === ID.plain2).length === 0);
    await page.click('.r30-sheet [data-r38-mode=weekly]');
    await page.click('.r30-sheet [data-r38-day="3"]');
    await page.fill('.r30-sheet [name=r38stime]', '10:30');
    await shot(page, 'phone-sheet-schedule-form.png');
    await page.click('.r30-sheet [data-r38-sched-save]');
    await page.waitForTimeout(400);
    const setCall = backend.calls.filter((c) => c.path === 'schedule' && c.id === ID.plain2).pop();
    check('每周一三 10:30 真发给后端：schedule set，days 排好序', setCall && setCall.body.schedule.kind === 'weekly' && setCall.body.schedule.time === '10:30' && JSON.stringify(setCall.body.schedule.days) === '[1,3]');
    check('定好后这张卡是「定时模板」，进了折叠区，不再在列里', await card(ID.plain2) === null && await page.evaluate(() => /定时任务 · 2 个/.test(document.querySelector('.r30-phone [data-r38-tpl] summary').textContent)));
    // ---- 新建：交给首席安排 ----
    await page.click('.r30-phone [data-r30-new]');
    await page.waitForSelector('.r30-sheet .r38-give');
    check('新建：负责人那一排有「交给首席安排」，紧挨着「谁有空谁接」', await page.evaluate(() => { const l = [...document.querySelectorAll('.r30-sheet .r30-people button')].map((b) => b.textContent.trim());
      const a = l.findIndex((x) => /谁有空谁接/.test(x)); const b = l.findIndex((x) => /交给首席安排/.test(x)); return a >= 0 && b === a + 1; }));
    check('新建：有「什么时候做」，默认「现在」', await page.evaluate(() => { const w = document.querySelector('.r30-sheet [data-r38-when]'); return !!w && w.querySelector('[data-r38-newmode=now]').classList.contains('is-on'); }));
    await shot(page, 'phone-new-sheet-trigger.png');
    await page.fill('.r30-sheet [name=title]', '用一句话给读书会起个名字');
    await page.click('.r30-sheet .r38-give');
    await page.waitForTimeout(500);
    const made = backend.calls.filter((c) => c.path === 'new').pop();
    check('新建发给后端：arrange:true，没有指定任何人、没有 column、没有 schedule', made && made.body.arrange === true && made.body.to === undefined && made.body.column === undefined && made.body.schedule === undefined);
    check('新建的卡在待领，带「首席安排中」', await page.evaluate(() => { const c = [...document.querySelectorAll('[data-r30-card]')].find((x) => /给读书会起个名字/.test(x.innerText)); return !!c && /首席安排中/.test(c.innerText); }));
    // ---- 新建：选了时间 + 谁有空谁接 → 拒；选时间 + 交给首席安排 → arrange+schedule；选时间 + 某人 → to+schedule ----
    await page.click('.r30-phone [data-r30-new]');
    await page.waitForSelector('.r30-sheet .r38-give');
    await page.fill('.r30-sheet [name=title]', '明早的事');
    await page.click('.r30-sheet [data-r38-newmode=once]');
    await page.waitForSelector('.r30-sheet [name=r38nat]');
    await page.click('.r30-sheet .r38-give');
    await page.waitForTimeout(150);
    check('选了「选个时间」却没选时间：不发给后端，提示先选个时间', backend.calls.filter((c) => c.path === 'new').length === 1);
    const future = new Date(Date.now() + 3 * 3600000);
    const local = (d) => { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
    await page.fill('.r30-sheet [name=r38nat]', local(new Date(Date.now() - 3600000)));
    await page.click('.r30-sheet .r38-give');
    await page.waitForTimeout(150);
    check('选的时间已经过了：不发给后端', backend.calls.filter((c) => c.path === 'new').length === 1);
    await page.fill('.r30-sheet [name=r38nat]', local(future));
    await page.click('.r30-sheet [data-r30-newgo="open"]');
    await page.waitForTimeout(150);
    check('「谁有空谁接」不能和定时一起用：不发给后端', backend.calls.filter((c) => c.path === 'new').length === 1);
    await shot(page, 'phone-new-sheet-timed.png');
    await page.click('.r30-sheet .r38-give');
    await page.waitForTimeout(500);
    const timed = backend.calls.filter((c) => c.path === 'new').pop();
    check('交给首席安排 + 选了时间：arrange:true 与 schedule 一起发（绝对时刻）', timed && timed.body.arrange === true && timed.body.schedule.kind === 'once' && Math.abs(Date.parse(timed.body.schedule.at) - future.getTime()) < 61000);
    await page.click('.r30-phone [data-r30-new]');
    await page.waitForSelector('.r30-sheet .r38-give');
    await page.fill('.r30-sheet [name=title]', '每天对账');
    await page.click('.r30-sheet [data-r38-newmode=daily]');
    await page.waitForSelector('.r30-sheet [name=r38ntime]');
    await page.fill('.r30-sheet [name=r38ntime]', '09:15');
    const researchKey = await page.evaluate(() => { const b = [...document.querySelectorAll('.r30-sheet .r30-give')].find((x) => /调研|research/i.test(x.textContent)); return b ? b.getAttribute('data-r30-newgo') : null; });
    await page.click(researchKey ? '.r30-sheet [data-r30-newgo="' + researchKey + '"]' : '.r30-sheet .r30-give >> nth=3');
    await page.waitForTimeout(500);
    const daily = backend.calls.filter((c) => c.path === 'new').pop();
    check('选某人 + 每天 09:15：to 与 schedule 一起发，没有 column', daily && !!daily.body.to && daily.body.schedule.kind === 'daily' && daily.body.schedule.time === '09:15' && daily.body.column === undefined && daily.body.arrange === undefined);
    check('新建后没有报错（含手机）', s.errors.length === 0);
    // ---- 今天页 ----
    const raw = {ok: true, date: new Date().toISOString().slice(0, 10), utcOffsetMinutes: 540, waiting: {available: true, waitingAnswer: [], awaitingReview: [], blocked: []},
      approvals: {available: true, cards: [], kbDrafts: []},
      arrangements: {available: true, hidden: 0, items: [{id: ID.proposed, title: '把名字发到对外公众号', since: iso(-2), stalled: false, planKind: 'bot', who: '调研员', whoId: 'research', whoType: 'assistant',
        when: '现在', why: '这是对外发布的事', needs: [{code: 'publish', text: '这是对外发送或公开发布，要先确认'}],
        text: '首席建议：交给 调研员，现在做，因为这是对外发布的事'}]},
      schedules: {available: true, items: [{id: ID.once, title: '下午的事', kind: 'once', state: 'waiting', assignee: 'research', assigneeType: 'assistant', at: iso(120), text: '今天 15:30'},
        {id: ID.tpl, title: '每日晨报', kind: 'daily', state: 'waiting', assignee: 'content', assigneeType: 'assistant', time: '09:00', template: true, text: '每天 09:00', child: {id: 'T-x', state: 'progress'}}],
        missed: {count: 2, items: []}},
      launchFailed: {available: true, items: [{id: ID.plain, title: '写开场白', name: 'codex', since: iso(-3), reason: '接单器出错了（退出码 3）'}]}};
    const tickets = backend.tickets;
    const model = await page.evaluate(([r, t]) => R30LT.normalizeToday(r, t, (x) => x), [raw, tickets]);
    check('今天页：「等你处理」第一条是首席建议，带原因', model.waiting.items[0].tag === '首席建议' && /首席建议：交给 调研员/.test(model.waiting.items[0].sub) && model.waiting.items[0].prop.needs.length === 1);
    check('今天页：没叫动的外部身份写成「没叫动 Codex」', model.waiting.items.some((i) => i.tag === '没叫动 Codex' && /退出码 3/.test(i.sub)));
    check('今天页：「今天的固定任务」里有今天到点的卡，并提示「有 2 个定时没赶上」', model.routines.items.length === 2 && /有 2 个定时没赶上/.test(model.routines.note));
    await page.evaluate((m) => { const host = document.createElement('div'); host.id = 'r38-today'; host.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:auto;background:var(--bg)'; (document.getElementById('app') || document.body).append(host); R30LT.mountToday(host, m, {}); }, model);
    await page.waitForTimeout(300);
    check('今天页：首席建议那一行下面有三个操作', await page.evaluate(() => { const a = document.querySelector('#r38-today .r38-acts'); return !!a && !!a.querySelector('[data-r38-tok]') && !!a.querySelector('[data-r38-tswap]') && !!a.querySelector('[data-r38-tskip]') && /为什么要你点头/.test(a.textContent); }));
    await shot(page, 'phone-today-trigger.png');
    const before = backend.calls.length;
    await page.click('#r38-today [data-r38-tswap]');
    await page.waitForSelector('#r38-today .r38-pick button');
    check('今天页「换个人」：展开人选，点之前不发给后端', backend.calls.length === before);
    await page.click('#r38-today [data-r38-tok]');
    await page.waitForTimeout(500);
    check('今天页「就这么办」真发给后端：arrange ok，这一行换成一句回执', backend.calls.slice(before).some((c) => c.path === 'arrange' && c.body.action === 'ok') && await page.evaluate(() => /已照首席的意思办/.test(document.querySelector('#r38-today').innerText)));
    const pendingTicket = backend.tickets.find(t => t.id === raw.arrangements.items[0].id);
    pendingTicket.requireConfirmation = true;
    const beforeState = JSON.stringify(pendingTicket);
    await page.evaluate(m => R30LT.mountToday(document.querySelector('#r38-today'), m, {}), model);
    await page.click('#r38-today [data-r38-tok]');
    await page.waitForTimeout(500);
    check('高风险安排等待核对对象，不提前宣称办成', await page.evaluate(() => {
      const text = document.querySelector('#r38-today').innerText;
      return text.includes('核对对象，再确认一次') && !text.includes('已照首席的意思办');
    }) && JSON.stringify(pendingTicket) === beforeState);
    await s.ctx.close();

    // ================= 电脑：拖没负责人的卡到「在做」 =================
    const b2 = backendWith();
    s = await open(browser, {width: 1440, height: 900, real: true, backend: b2});
    page = s.page;
    check('电脑：看板的列里没有定时模板；有折叠的「定时任务」区', await page.evaluate(() => !document.querySelector('.r29-desk-col [data-r30-card="T-20261119-100400-t005"]') && !!document.querySelector('.r29-desk [data-r38-tpl]')));
    const box = async (sel) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); const b = await page.locator(sel).first().boundingBox(); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; };
    const drag = async (from, to) => {
      const a = await box(from); const b = await box(to); b.y += 100;
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 20, a.y + 10, {steps: 4});
      await page.mouse.move(b.x, b.y, {steps: 12}); await page.mouse.up();
    };
    const colBody = '[data-r29-desk-col=progress]';
    await drag('.r29-desk [data-r30-card="' + ID.plain + '"] .r29-desk-title', colBody);
    await page.waitForTimeout(700);
    const mv = b2.calls.filter((c) => c.path === 'move').pop();
    check('电脑：把没负责人的卡拖到「在做」：发出 move progress', mv && mv.id === ID.plain && mv.body.column === 'progress');
    check('电脑：拖完卡留在待领，带「首席安排中」（后端自己请首席）', await page.evaluate((i) => { const c = document.querySelector('[data-r29-desk-col=queued] [data-r30-card="' + i + '"]'); return !!c && /首席安排中/.test(c.innerText); }, ID.plain));
    check('电脑：拖完弹一句「已交给首席安排」', await page.evaluate(() => /已交给首席安排/.test(document.getElementById('toast').innerText)));
    await drag('.r29-desk [data-r30-card="' + ID.owned + '"] .r29-desk-title', colBody);
    await page.waitForTimeout(700);
    check('电脑：有负责人的卡拖到「在做」：只改状态，不出现首席安排小标', await page.evaluate((i) => { const c = document.querySelector('[data-r29-desk-col=progress] [data-r30-card="' + i + '"]'); return !!c && !/首席安排/.test(c.innerText); }, ID.owned));
    await shot(page, 'desk-board-trigger.png');
    await page.click('[data-r29-desk-id="' + ID.proposed + '"]');
    await page.waitForSelector('.r29-desk-side [data-r38-box=proposed]');
    check('电脑：右侧栏有首席建议和三个操作', await page.evaluate(() => !!document.querySelector('.r29-desk-side [data-r38-ok]')));
    await shot(page, 'desk-side-proposed.png');
    check('电脑：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ================= 演示模式 =================
    s = await open(browser, {width: 390, height: 844, touch: true, tick: 450});
    page = s.page;
    const dstate = () => page.evaluate(() => R38Trigger.demoState());
    check('演示：板上有三张演示卡（首席自动安排、等你点头、定时）', await page.evaluate(() => document.querySelectorAll('.r30-phone [data-r30-card^="r38-demo-"]').length === 3));
    const seen = [];
    const chip = () => page.evaluate(() => { const c = document.querySelector('.r30-phone [data-r30-card^="r38-demo-"] .r38-chip'); return c ? c.textContent.trim() : null; });
    for (let i = 0; i < 40; i += 1) { const st = (await dstate()); const c = await chip(); if (c && seen[seen.length - 1] !== c) seen.push(c); if (st[0].stage === 3 && st[2].stage === 3) break; await page.waitForTimeout(200); }
    const st = await dstate();
    check('演示：首席自动安排的那张走到「等验收」', st[0].stage === 3);
    check('演示：定时那张到点后被叫醒并走到「等验收」（假时钟三格到点）', st[2].stage === 3);
    check('演示：等你点头的那张停在「首席建议」，等你点（没有自己往下走）', st[1].stage === 1 && !st[1].decided);
    check('演示：自动安排的小标出现过「首席安排中」', seen.indexOf('首席安排中') >= 0);
    await page.evaluate(() => R38Trigger.replay(true));
    await page.waitForTimeout(200);
    for (let i = 0; i < 30; i += 1) { if ((await dstate())[1].stage === 1) break; await page.waitForTimeout(200); }
    await shot(page, 'phone-demo-trigger.png');
    await page.evaluate(() => { const c = document.querySelectorAll('.r30-phone [data-r30-card^="r38-demo-"]'); for (const x of c) if (/公众号/.test(x.innerText)) { x.querySelector('.r29-desk-title').click(); return; } });
    await page.waitForSelector('.r30-sheet [data-r38-ok]');
    await shot(page, 'phone-demo-sheet-proposed.png');
    await page.click('.r30-sheet [data-r38-ok]');
    await page.waitForTimeout(300);
    check('演示：点「就这么办」后这张往下走（被派给助理）', (await dstate())[1].stage >= 2);
    await page.click('[data-r32-replay]');
    await page.waitForTimeout(250);
    check('演示：点板头「重播」，回到开头（首席安排中、等到点）', (await dstate())[0].stage === 0 && (await dstate())[2].stage === 0);
    check('演示：新建里选「交给首席安排」会多出一张自己会被安排的卡', await (async () => {
      await page.click('.r30-phone [data-r30-new]');
      await page.waitForSelector('.r30-sheet .r38-give');
      await page.fill('.r30-sheet [name=title]', '我自己新建的');
      await page.click('.r30-sheet .r38-give');
      await page.waitForTimeout(300);
      return (await dstate()).length === 4;
    })());
    check('演示：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ================= 深色、减弱动效 =================
    s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend: backendWith(), scheme: 'dark', reduced: true});
    page = s.page;
    check('深色+减弱动效：小标在，脉动点不动画', await page.evaluate((i) => { const c = document.querySelector('[data-r30-card="' + i + '"] .r38-pulse'); return !!c && getComputedStyle(c).animationName === 'none'; }, ID.wanted));
    await shot(page, 'phone-board-trigger-dark.png');
    check('深色：没有报错', s.errors.length === 0);
    await s.ctx.close();
    console.log('\n全部通过：' + passed + ' 项');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
