// 开放认领（谁有空谁接）：新建第一项、卡片小标、点开的说明、转问主人回答、今天页「挂着没人接的」、演示卡自动被接走。
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
const port = 3871;
const dist = path.join(__dirname, 'dist-generic');
const shots = process.env.R35_SHOTS || path.join(__dirname, '..', 'shots');
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

const ts = (min) => new Date(Date.now() - min * 60000).toISOString();
const tk = (id, title, over) => Object.assign({id, title, goal: title + '的说明', from: {name: 'owner', type: 'owner'}, to: [], claimedBy: null,
  claimedByType: null, state: 'queued', review: 'none', open_ask: null, createdAt: ts(300), updatedAt: ts(5), progress: [], reports: [],
  report: null, verification: [], acceptance: [], history: []}, over || {});
const ID = {open: 'T-20261119-100000-o001', chief: 'T-20261119-100100-c002', ext: 'T-20261119-100200-e003', ask: 'T-20261119-100300-a004',
  plain: 'T-20261119-100400-p005', old: 'T-20261119-100500-o006', fresh: 'T-20261119-100600-f007'};

function backendWith({chiefUp}) {
  const tickets = [
    tk(ID.open, '挂了很久没人接', {openClaim: {state: 'open', openedAt: ts(40)}}),
    tk(ID.fresh, '刚挂出来的', {openClaim: {state: 'open', openedAt: ts(2)}}),
    tk(ID.chief, '首席派走的', {to: ['research'], openClaim: {state: 'taken', openedAt: ts(60), takenBy: 'research', takenType: 'assistant', takenShown: '调研',
      via: 'chief', reason: '这是要先查清楚的事，调研最合适', at: ts(58)}}),
    tk(ID.ext, '外部领走的', {to: ['agent-x'], claimedBy: 'agent-x', claimedByType: 'external', state: 'progress', openClaim: {state: 'taken', openedAt: ts(50),
      takenBy: 'agent-x', takenType: 'external', takenShown: 'agent-x', via: 'external', at: ts(49)}}),
    tk(ID.ask, '首席拿不准的', {state: 'waiting-human', open_ask: {text: '这件事是对内还是对外？', ts: ts(3)}, openClaim: {state: 'asked', openedAt: ts(30), at: ts(3)}}),
    tk(ID.plain, '没写负责人的普通卡', {}),
  ];
  const calls = [];
  const handle = (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (status, body) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    if (!p.startsWith('/bff/board/')) return route.abort();
    if (req.method() === 'GET' && p === '/bff/board/tickets') return json(200, {tickets});
    if (req.method() === 'GET' && p === '/bff/board/people') return json(200, {people: [{id: 'chief', name: '总管', type: 'assistant'}]});
    if (req.method() !== 'POST') return json(404, {});
    const body = JSON.parse(req.postData() || '{}');
    if (p === '/bff/board/tickets/new') {
      calls.push({path: 'new', body});
      const t = tk(ID.old.replace('o006', 'n' + (tickets.length + 100)), body.title, {goal: body.goal || body.title, createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), openClaim: body.open ? {state: 'open', openedAt: new Date().toISOString()} : undefined, to: body.to ? [body.to] : []});
      tickets.unshift(t);
      return json(201, {ticket: t});
    }
    const m = /^\/bff\/board\/tickets\/([^/]+)\/(assign|answer|move|edit|delete)$/.exec(p);
    if (!m) return json(404, {});
    calls.push({path: m[2], id: m[1], body});
    const t = tickets.find((x) => x.id === m[1]);
    if (m[2] === 'assign' && body.open === true) { t.openClaim = {state: 'open', openedAt: new Date().toISOString()}; }
    else if (m[2] === 'answer') { t.state = 'queued'; t.open_ask = null; t.openClaim = {state: 'open', openedAt: t.openClaim.openedAt, reopenedAt: new Date().toISOString(), answer: body.text}; }
    else return json(409, {});
    t.updatedAt = new Date().toISOString();
    return json(200, {ticket: t});
  };
  return {tickets, calls, handle, chiefUp};
}

async function open(browser, {width, height, touch, real, backend, scheme, hash, reduced, tick, video}) {
  const options = {viewport: {width, height}, hasTouch: !!touch, isMobile: !!touch, deviceScaleFactor: touch ? 2 : 1,
    colorScheme: scheme || 'light', reducedMotion: reduced ? 'reduce' : 'no-preference'};
  if (video) options.recordVideo = {dir: video, size: {width, height}};
  const ctx = await browser.newContext(options);
  await ctx.addInitScript((arg) => {
    (function f() {
      if (document.documentElement) { if (arg.real) document.documentElement.dataset.hubMode = 'real'; }
      else setTimeout(f, 0);
    })();
    if (arg.tick) window.__R35_TICK_MS = arg.tick;
  }, {real: !!real, tick});
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
    const backend = backendWith({chiefUp: true});
    let s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend});
    let page = s.page;
    const cardText = (id) => page.evaluate((i) => { const c = document.querySelector('[data-r30-card="' + i + '"]'); return c ? c.innerText : null; }, id);
    check('真实：「没写负责人的普通卡」没有任何开放认领小标（旧卡不会自动变成开放）', !/等人接|首席派给|接走了|首席在问/.test(await cardText(ID.plain) || 'x') &&
      await page.evaluate((i) => !document.querySelector('[data-r30-card="' + i + '"] .r35-chip'), ID.plain));
    check('真实：没人接的卡显示「等人接」小标', /等人接/.test(await cardText(ID.open)));
    check('真实：首席派走的卡显示「首席派给了调研」（名字用助理的显示名）', await page.evaluate((i) => {
      const c = document.querySelector('[data-r30-card="' + i + '"] .r35-chip'); return !!c && /^首席派给了/.test(c.textContent) && c.textContent.length > 5; }, ID.chief));
    check('真实：外部领走的卡显示「agent-x 接走了」', /agent-x 接走了/.test(await cardText(ID.ext)));
    check('真实：首席转问主人的卡显示「首席在问你」', /首席在问你/.test(await cardText(ID.ask)));
    check('界面上没有 owner 字样', await page.evaluate(() => !/\bowner\b/i.test(document.body.innerText)));
    await shot(page, 'phone-board-claim.png');
    // ---- 点开首席派走的：看得到理由 ----
    await page.click('[data-r30-card="' + ID.chief + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r35-box');
    check('点开首席派走的卡：写着「首席派给了…」和首席留的理由', await page.evaluate(() => {
      const b = document.querySelector('.r30-sheet .r35-box'); return /首席派给了/.test(b.textContent) && /这是要先查清楚的事，调研最合适/.test(b.textContent); }));
    await shot(page, 'phone-sheet-taken.png');
    await page.click('.r30-sheet [data-r30-close]').catch(() => {});
    // ---- 点开外部领走的 ----
    await page.click('[data-r30-card="' + ID.ext + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r35-box');
    check('点开外部领走的卡：写着「agent-x 接走了」', await page.evaluate(() => /agent-x 接走了/.test(document.querySelector('.r30-sheet .r35-box').textContent)));
    await page.click('.r30-sheet [data-r30-close]').catch(() => {});
    // ---- 点开没人接的：说明；已经开放的卡，派给谁里没有「改成开放」重复项 ----
    await page.click('[data-r30-card="' + ID.open + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r35-box');
    check('点开没人接的卡：写着「等人接」和怎么回事', await page.evaluate(() => /等人接/.test(document.querySelector('.r30-sheet .r35-box').textContent)));
    check('已经开放的卡，派给谁那一排没有再放一个「谁有空谁接」', await page.evaluate(() => !document.querySelector('.r30-sheet [data-r35-open]')));
    await page.click('.r30-sheet [data-r30-close]').catch(() => {});
    // ---- 转问主人：直接回答 ----
    await page.click('[data-r30-card="' + ID.ask + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r35-box [name=r35answer]');
    check('点开首席转来的卡：显示首席的问题和回答框', await page.evaluate(() => /这件事是对内还是对外/.test(document.querySelector('.r30-sheet .r35-box').textContent)));
    await shot(page, 'phone-sheet-asked.png');
    await page.click('.r30-sheet [data-r35-answer]');
    await page.waitForTimeout(150);
    check('不写回答点按钮：不发给后端', backend.calls.filter((c) => c.path === 'answer').length === 0);
    await page.fill('.r30-sheet [name=r35answer]', '对内');
    await page.click('.r30-sheet [data-r35-answer]');
    await page.waitForTimeout(500);
    check('回答真发给后端（带上回答的话）', backend.calls.some((c) => c.path === 'answer' && c.id === ID.ask && c.body.text === '对内'));
    check('回答后这张卡回到「等人接」', /等人接/.test(await cardText(ID.ask) || ''));
    // ---- 把普通卡改成「谁有空谁接」 ----
    await page.click('[data-r30-card="' + ID.plain + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r35-whoopen');
    check('普通没人接的卡：派给谁那一排第一项是「谁有空谁接」', await page.evaluate(() => {
      const first = document.querySelector('.r30-sheet .r30-people button'); return !!first && first.classList.contains('r35-whoopen'); }));
    await page.click('.r30-sheet [data-r35-open]');
    await page.waitForTimeout(500);
    check('点它真发给后端：assign 带 open:true', backend.calls.some((c) => c.path === 'assign' && c.id === ID.plain && c.body.open === true));
    check('点完这张卡出现「等人接」', /等人接/.test(await cardText(ID.plain) || ''));
    // ---- 新建：第一项是「谁有空谁接」 ----
    await page.click('.r30-phone [data-r30-new]');
    await page.waitForSelector('.r30-sheet .r35-give');
    check('新建里负责人那一排第一项是「谁有空谁接」', await page.evaluate(() => {
      const first = document.querySelector('.r30-sheet .r30-people button'); return !!first && /谁有空谁接/.test(first.textContent) && first.classList.contains('r35-give'); }));
    await shot(page, 'phone-new-sheet.png');
    await page.fill('.r30-sheet [name=title]', '办一场读书会');
    await page.click('.r30-sheet .r35-give');
    await page.waitForTimeout(500);
    const made = backend.calls.filter((c) => c.path === 'new').pop();
    check('新建发给后端：open:true，没有指定任何人', made && made.body.open === true && made.body.to === undefined && made.body.title === '办一场读书会');
    check('新建的卡在「待领」并带「等人接」', await page.evaluate(() => {
      const card = [...document.querySelectorAll('[data-r30-card]')].find((c) => /办一场读书会/.test(c.innerText)); return !!card && /等人接/.test(card.innerText); }));
    check('新建后没有报错（含手机）', s.errors.length === 0);
    // ---- 今天页数据 ----
    const raw = {ok: true, date: new Date().toISOString().slice(0, 10), utcOffsetMinutes: 0, waiting: {available: true, waitingAnswer: [], awaitingReview: [], blocked: []},
      approvals: {available: true, cards: [], kbDrafts: []}, openClaims: {available: true, minutes: 15, chiefUsable: true, chiefName: '首席助理', items: []}};
    const tickets = backend.tickets;
    let model = await page.evaluate(([r, t]) => R30LT.normalizeToday(r, t, (x) => x), [raw, tickets]);
    check('今天页：挂了 40 分钟的卡出现在「挂着没人接的」，写着已经挂了 N 分钟', model.open && model.open.items.some((i) => i.id === ID.open && /已经挂了 4\d 分钟/.test(i.sub)));
    check('今天页：刚挂出来的（2 分钟）不提示，被派走的、被领走的也不在', !model.open.items.some((i) => i.id === ID.fresh || i.id === ID.chief || i.id === ID.ext));
    check('今天页：普通没人负责的卡不会进「挂着没人接的」', !model.open.items.some((i) => i.id === ID.plain));
    const raw5 = JSON.parse(JSON.stringify(raw)); raw5.openClaims.minutes = 1;
    model = await page.evaluate(([r, t]) => R30LT.normalizeToday(r, t, (x) => x), [raw5, tickets]);
    check('今天页：设定分钟数可改（改成 1 分钟，刚挂的也列出来）', model.open.items.some((i) => i.id === ID.fresh));
    const down = JSON.parse(JSON.stringify(raw)); down.openClaims.chiefUsable = false;
    model = await page.evaluate(([r, t]) => R30LT.normalizeToday(r, t, (x) => x), [down, tickets]);
    const downItems = model.waiting.items.filter((i) => i.tag === '没人派活');
    check('今天页：首席停用时，每张开放的卡在「等你处理」里明说「首席助理已停用…你来挑一位」', downItems.length >= 2 && downItems.every((i) => /首席助理已停用/.test(i.sub)));
    check('今天页：首席停用时「挂着没人接的」不再重复列同一批', !model.open || !model.open.items.some((i) => downItems.some((d) => d.id === i.id)));
    const askedItem = await page.evaluate(([r, t]) => { const x = JSON.parse(JSON.stringify(r)); x.waiting.waitingAnswer = [{id: t[0], title: '首席拿不准的', assistant: 'owner', reason: '这件事是对内还是对外？'}];
      return R30LT.normalizeToday(x, [{id: t[0], title: 'x', state: 'waiting-human', openClaim: {state: 'asked', openedAt: new Date().toISOString()}}], (y) => y).waiting.items.find((i) => i.id === t[0]); }, [raw, [ID.ask]]);
    check('今天页：首席转问你的卡标成「首席在问你」', askedItem && askedItem.tag === '首席在问你');
    const html = await page.evaluate((m) => { const h = document.createElement('div'); document.body.append(h); R30LT.mountToday(h, m, {}); return h.innerText; }, (await page.evaluate(([r, t]) => R30LT.normalizeToday(r, t, (x) => x), [raw, tickets])));
    check('今天页整页文字：有「挂着没人接的」一块，没有 owner 字样', /挂着没人接的/.test(html) && !/\bowner\b/i.test(html));
    await s.ctx.close();
    // ---- 旧后端没有 openClaims 数据：按默认 15 分钟从卡上算 ----
    s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend: backendWith({chiefUp: true})});
    page = s.page;
    model = await page.evaluate(([r, t]) => R30LT.normalizeToday(r, t, (x) => x), [{ok: true, date: '2026-11-19', utcOffsetMinutes: 0,
      waiting: {available: true, waitingAnswer: [], awaitingReview: [], blocked: []}, approvals: {available: true, cards: [], kbDrafts: []}}, backend.tickets]);
    check('今天页：没带分钟数时默认 15 分钟', model.open && model.open.minutes === 15);
    await s.ctx.close();

    // ================= 今天页画面（真实，手机） =================
    const b2 = backendWith({chiefUp: true});
    s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend: b2, hash: '#kanban'});
    page = s.page;
    const todayModel = await page.evaluate((t) => R30LT.normalizeToday({ok: true, date: new Date().toISOString().slice(0, 10), utcOffsetMinutes: 0,
      waiting: {available: true, waitingAnswer: [], awaitingReview: [], blocked: []}, approvals: {available: true, cards: [], kbDrafts: []},
      openClaims: {available: true, minutes: 15, chiefUsable: true, chiefName: '首席助理', items: []}}, t, (x) => x), b2.tickets);
    await page.evaluate((m) => { const host = document.createElement('div'); host.id = 'r35-today'; host.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:auto;background:var(--bg)'; (document.getElementById('app') || document.body).append(host); R30LT.mountToday(host, m, {}); }, todayModel);
    await page.waitForTimeout(300);
    await shot(page, 'phone-today-open-block.png');
    // 接单的外部身份已失效 → 「等你处理」里出现一行；没有失效就没有。
    const lostModel = await page.evaluate((t) => R30LT.normalizeToday({ok: true, date: new Date().toISOString().slice(0, 10), utcOffsetMinutes: 0,
      waiting: {available: true, waitingAnswer: [], awaitingReview: [], blocked: []}, approvals: {available: true, cards: [], kbDrafts: []},
      openClaims: {available: true, minutes: 15, chiefUsable: true, chiefName: '首席助理', items: []},
      externalLost: {available: true, items: [{id: 'T-20261119-000000-abcd', title: '外部做的卡', name: 'codex', reason: 'token'}]}}, t, (x) => x), b2.tickets);
    check('今天页：外部身份失效 → 等你处理里写「接单的外部身份已失效，换人？」',
      lostModel.waiting.items.some((i) => i.id === 'T-20261119-000000-abcd' && i.sub.indexOf('接单的外部身份「codex」已失效，换人？') >= 0));
    check('今天页：没有失效就没有这一行', !todayModel.waiting.items.some((i) => /外部身份/.test(i.sub || '')));
    await s.ctx.close();

    // ================= 演示模式：一张会自动被接走的卡 =================
    s = await open(browser, {width: 390, height: 844, touch: true, tick: 450});
    page = s.page;
    const demoChip = () => page.evaluate(() => { const c = document.querySelector('[data-r30-card^="r35-demo-"] .r35-chip'); return c ? c.textContent.trim() : null; });
    const demoCol = () => page.evaluate(() => { const c = R35Claim.demoState()[0]; return c ? c.stage : -1; });
    check('演示：板上有一张演示卡', await page.evaluate(() => !!document.querySelector('[data-r30-card^="r35-demo-"]')));
    const seen = [];
    for (let i = 0; i < 30; i++) { const c = await demoChip(); if (c && seen[seen.length - 1] !== c) seen.push(c); if (await demoCol() === 3) break; await page.waitForTimeout(250); }
    check('演示：小标依次是「等人接」→「首席派给了…」，最后停在等验收', seen.length >= 2 && seen[0] === '等人接' && /^首席派给了/.test(seen[1]) && await demoCol() === 3);
    check('演示：最终在「等验收」那一列（交回，等你验收）', await page.evaluate(() => /交回，等你验收/.test(document.querySelector('[data-r30-card^="r35-demo-"]').innerText)));
    await page.waitForTimeout(300);
    await shot(page, 'phone-demo-claim-review.png');
    await page.click('[data-r32-replay]');
    await page.waitForTimeout(250);
    check('演示：点板头的「重播」，认领演示卡也从头再来（回到等人接）', await demoCol() === 0 && /等人接/.test(await demoChip()));
    check('演示：新建里选「谁有空谁接」会多出一张自己会被接走的卡', await (async () => {
      await page.click('.r30-phone [data-r30-new]');
      await page.waitForSelector('.r30-sheet .r35-give');
      await page.fill('.r30-sheet [name=title]', '我自己新建的');
      await page.click('.r30-sheet .r35-give');
      await page.waitForTimeout(300);
      const n = await page.evaluate(() => R35Claim.demoState().length);
      for (let i = 0; i < 20; i++) { if (await page.evaluate(() => R35Claim.demoState()[0].stage) >= 1) break; await page.waitForTimeout(250); }
      return n === 2 && await page.evaluate(() => R35Claim.demoState()[0].stage >= 1);
    })());
    check('演示：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ================= 深色、减弱动效、电脑 =================
    s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend: backendWith({chiefUp: true}), scheme: 'dark', reduced: true});
    page = s.page;
    check('深色+减弱动效：小标在，脉动点不动画', await page.evaluate((i) => { const c = document.querySelector('[data-r30-card="' + i + '"] .r35-pulse'); return !!c && getComputedStyle(c).animationName === 'none'; }, ID.open));
    await shot(page, 'phone-board-claim-dark.png');
    await s.ctx.close();
    s = await open(browser, {width: 1440, height: 900, real: true, backend: backendWith({chiefUp: true})});
    page = s.page;
    check('电脑：看板里也有「等人接」小标', await page.evaluate(() => !!document.querySelector('.r29-desk-card .r35-chip')));
    await page.click('[data-r29-desk-id="' + ID.chief + '"]');
    await page.waitForSelector('.r29-desk-side .r35-box');
    check('电脑：右侧栏看得到首席派给谁和理由', await page.evaluate(() => /首席派给了/.test(document.querySelector('.r29-desk-side .r35-box').textContent)));
    await shot(page, 'desk-board-claim.png');
    check('电脑：没有报错', s.errors.length === 0);
    await s.ctx.close();
    console.log('\n全部通过：' + passed + ' 项');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
