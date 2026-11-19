// 接力补丁（放行一步完成、今天页 owner 与摘要、停用换人、超时催办、外部身份小标）。
// 原说明：卡片进度线、点开的时间线、新建接力、今天页「接力停在你这里」、首页「在跑第 N 棒」、
// 演示接力自动往前走、真实模式落后端（内存假后端）、减弱动态效果、暗色、电脑。
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
const port = 3861;
const dist = path.join(__dirname, 'dist-generic');
const shots = process.env.R34_SHOTS || path.join(__dirname, '..', 'shots');
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
const mkStep = (name, type, task, over) => Object.assign({who: {name, type: type || 'assistant'}, task, doneWhen: '', gate: false,
  status: 'waiting', startedAt: null, deliveredAt: null, note: null, noteBy: null, question: null, returnedNote: null}, over || {});
const tk = (id, title, over) => Object.assign({id, title, goal: title, from: {name: 'owner', type: 'owner'}, to: [], claimedBy: null,
  claimedByType: null, state: 'progress', review: 'none', open_ask: null, createdAt: ts(300), updatedAt: ts(5), progress: [], reports: [],
  report: null, verification: [], acceptance: [], history: []}, over || {});

function backendWith(externals) {
  const tickets = [];
  tickets.push(tk('T-20261119-100000-h001', '停用卡', {claimedBy: 'chief', state: 'waiting-human', open_ask: {text: '接力停在这里：旧助理已停用，换个人接？', ts: ts(2)},
    relay: {v: 1, phase: 'halted', current: 1, finalAt: null, halt: {name: 'old', at: ts(2)}, steps: [
      mkStep('chief', 'assistant', '查', {status: 'done', startedAt: ts(30), deliveredAt: ts(3), note: '好了', noteBy: 'chief'}),
      mkStep('old', 'assistant', '写', {status: 'active', startedAt: ts(3)}), mkStep('owner', 'owner', '看一眼')]}}));
  tickets.push(tk('T-20261119-100100-s002', '没动静卡', {claimedBy: 'chief', relay: {v: 1, phase: 'running', current: 0, finalAt: null, steps: [
    mkStep('chief', 'assistant', '查', {status: 'active', startedAt: ts(50), stalledAt: ts(10), stalledMin: 30}), mkStep('owner', 'owner', '看一眼')]}}));
  tickets.push(tk('T-20261119-100200-l003', '最后一棒要看一眼', {claimedBy: 'chief', state: 'waiting-human', open_ask: {text: '接力第 2 棒做完了，等你看一眼再放行', ts: ts(1)},
    relay: {v: 1, phase: 'gate', current: 1, finalAt: null, steps: [
      mkStep('chief', 'assistant', '查', {status: 'done', startedAt: ts(30), deliveredAt: ts(10), note: 'a', noteBy: 'chief'}),
      mkStep('chief', 'assistant', '写', {gate: true, status: 'done', startedAt: ts(10), deliveredAt: ts(1), note: 'b', noteBy: 'chief'})]}}));
  const today = new Date().toISOString();
  tickets.push(tk('T-20261119-100300-d004', '已走完的接力', {claimedBy: 'owner', claimedByType: 'owner', state: 'completed', review: 'accepted', updatedAt: today,
    history: [{ts: today, by: 'owner', action: 'relay_released'}, {ts: today, by: 'owner', action: 'accepted'}],
    report: {ts: today, by: 'chief', summary: '这是上一棒写得很长很长的交接说明，按理说不应该被当成摘要显示在今天页里面……'},
    relay: {v: 1, phase: 'done', current: 3, finalAt: today, steps: [mkStep('chief', 'assistant', 'a', {status: 'done'}), mkStep('chief', 'assistant', 'b', {status: 'done'}), mkStep('owner', 'owner', 'c', {status: 'done'})]}}));
  tickets.push(tk('T-20261119-100400-p005', '主人自己做完的普通卡', {claimedBy: 'owner', claimedByType: 'owner', state: 'completed', review: 'accepted', updatedAt: today,
    history: [{ts: today, by: 'owner', action: 'accepted'}]}));
  const calls = [];
  const handle = (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (status, body) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    if (!p.startsWith('/bff/board/')) return route.abort();
    if (req.method() === 'GET' && p === '/bff/board/tickets') return json(200, {tickets});
    if (req.method() === 'GET' && p === '/bff/board/people') {
      return json(200, {people: [{id: 'chief', name: '总管', type: 'assistant'}, {id: 'research', name: '调研', type: 'assistant'}].concat(externals ? [{id: 'agent-x', name: 'agent-x', type: 'external'}] : [])});
    }
    const m = /^\/bff\/board\/tickets\/([^/]+)\/(relay)$/.exec(p);
    if (req.method() !== 'POST' || !m) return json(404, {});
    const body = JSON.parse(req.postData() || '{}');
    calls.push({id: m[1], body});
    const t = tickets.find((x) => x.id === m[1]);
    const r = t.relay, s = r.steps[r.current];
    if (body.action === 'release' && r.phase === 'gate') { t.state = 'completed'; t.review = 'accepted'; r.phase = 'done'; t.open_ask = null; }
    else if (body.action === 'reassign') { s.who = {name: body.who, type: 'assistant'}; s.stalledAt = null; r.phase = 'running'; t.state = 'progress'; t.open_ask = null; t.claimedBy = body.who; }
    else if (body.action === 'rewake') { s.stalledAt = null; }
    else return json(409, {});
    t.updatedAt = new Date().toISOString();
    return json(200, {ticket: t});
  };
  return {tickets, calls, handle};
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
    if (arg.tick) window.__R32_TICK_MS = arg.tick;
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
    const backend = backendWith(false);
    let s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend});
    let page = s.page;
    const idOf = (t) => backend.tickets.find((x) => x.title === t).id;
    // ---- 今天页数据 ----
    const raw = {ok: true, date: new Date().toISOString().slice(0, 10), utcOffsetMinutes: 0,
      waiting: {available: true, waitingAnswer: [{id: idOf('停用卡'), title: '停用卡', assistant: 'chief', reason: '接力停在这里：旧助理已停用，换个人接？'}], awaitingReview: [], blocked: []},
      approvals: {available: true, cards: [], kbDrafts: []}};
    const model = await page.evaluate(([r, tickets]) => R30LT.normalizeToday(r, tickets, (x) => x), [raw, backend.tickets]);
    const wait = model.waiting.items;
    const halted = wait.find((i) => i.id === idOf('停用卡'));
    check('今天页：停用的接力标成「接力停在这里」，不重复列，句子是「某某已停用，换个人接？」', halted && halted.tag === '接力停在这里' &&
      /已停用，换个人接？/.test(halted.sub) && wait.filter((i) => i.id === idOf('停用卡')).length === 1);
    const stalled = wait.find((i) => i.id === idOf('没动静卡'));
    check('今天页：超时的一棒出现在「等你处理」：「这一棒 30 分钟没动静」', stalled && stalled.tag === '这一棒没动静' && stalled.sub === '这一棒 30 分钟没动静');
    const doneItems = model.done.items;
    const relayDone = doneItems.find((i) => i.id === idOf('已走完的接力'));
    check('今天做完的：接力卡负责人显示「你」，不是 owner', relayDone && relayDone.name === '你' && relayDone.bot === '');
    check('今天做完的：接力卡摘要是「卡片标题＋接力 3 棒走完了」，不是交接说明长文', relayDone && relayDone.sub === '「已走完的接力」接力 3 棒走完了');
    const plain = doneItems.find((i) => i.id === idOf('主人自己做完的普通卡'));
    check('今天做完的：主人自己做完的普通卡也显示「你」', plain && plain.name === '你');
    const text = await page.evaluate((m) => { const h = document.createElement('div'); document.body.append(h); R30LT.mountToday(h, m, {}); return h.innerText + h.innerHTML.replace(/<[^>]+>/g, ' '); }, model);
    check('今天页整页文字里没有 owner 字样', !/\bowner\b/i.test(text));
    check('今天页：等你处理里能看到两条新提醒的文字', /接力停在这里/.test(text) && /这一棒 30 分钟没动静/.test(text));
    // ---- 看板与操作单：全站扫 owner ----
    const scan = async (label) => { const t = await page.evaluate(() => document.body.innerText); check(label + '：界面上没有 owner 字样', !/\bowner\b/i.test(t)); };
    await scan('手机看板');
    // ---- 停用 → 换人 ----
    await page.click('[data-r30-card="' + idOf('停用卡') + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r32-ask');
    check('操作单：停用的卡写着「已停用，换个人接」，有换人下拉和按钮', await page.evaluate(() => {
      const box = document.querySelector('.r30-sheet .r32-ask');
      return /已停用，换个人接/.test(box.textContent) && !!box.querySelector('select[name=r32who]') && !!box.querySelector('[data-r32-act=reassign]');
    }));
    check('操作单：下拉里没有「你」也没有已停用的那位', await page.evaluate(() => [...document.querySelectorAll('.r30-sheet [name=r32who] option')].every((o) => !/你/.test(o.textContent) && o.value !== 'old')));
    await shot(page, 'phone-halted-sheet.png');
    await page.selectOption('.r30-sheet [name=r32who]', 'research');
    await page.click('.r30-sheet [data-r32-act="reassign"]');
    await page.waitForTimeout(300);
    check('换人真发给后端（带上新人）', backend.calls.some((c) => c.id === idOf('停用卡') && c.body.action === 'reassign' && c.body.who === 'research'));
    await page.click('.r30-sheet [data-r30-close]').catch(() => {});
    // ---- 超时 → 再叫一次 / 换人 ----
    await page.click('[data-r30-card="' + idOf('没动静卡') + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r32-ask');
    check('操作单：超时的卡写着「这一棒 30 分钟没动静」，有「再叫一次」和「换人」', await page.evaluate(() => {
      const box = document.querySelector('.r30-sheet .r32-ask');
      return /这一棒 30 分钟没动静/.test(box.textContent) && !!box.querySelector('[data-r32-act=rewake]') && !!box.querySelector('[data-r32-act=reassign]');
    }));
    await shot(page, 'phone-stalled-sheet.png');
    await page.click('.r30-sheet [data-r32-act="rewake"]');
    await page.waitForTimeout(300);
    check('「再叫一次」真发给后端', backend.calls.some((c) => c.id === idOf('没动静卡') && c.body.action === 'rewake'));
    await page.click('.r30-sheet [data-r30-close]').catch(() => {});
    // ---- 放行一步完成 ----
    await page.click('[data-r30-card="' + idOf('最后一棒要看一眼') + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r32-ask');
    check('最后一棒的放行按钮写「放行，标完成」', await page.evaluate(() => /放行，标完成/.test(document.querySelector('.r30-sheet [data-r32-act=release]').textContent)));
    await page.click('.r30-sheet [data-r32-act="release"]');
    await page.waitForTimeout(400);
    check('放行一次后卡直接完成，界面上不再出现「验收，标完成」', backend.tickets[2].state === 'completed' && await page.evaluate(() => !document.querySelector('[data-r32-act="finish"]')));
    check('手机：没有报错', s.errors.length === 0);
    await s.ctx.close();
    // ---- 外部身份：配置了才有，带「外部」小标 ----
    for (const ext of [true, false]) {
      s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend: backendWith(ext)});
      page = s.page;
      await page.click('.r30-phone [data-r30-new]');
      await page.click('[data-r32-mode="relay"]');
      await page.waitForTimeout(500);
      const info = await page.evaluate(() => ({tags: [...document.querySelectorAll('.r32-pick .r32-ext')].map((x) => x.textContent),
        names: [...document.querySelectorAll('.r32-pick .r30-who span')].map((x) => x.textContent)}));
      if (ext) {
        check('配置了外部身份：新建接力里能选，带「外部」小标，名字不重复写「外部 ·」', info.tags.length === 1 && info.tags[0] === '外部' && info.names.indexOf('agent-x') >= 0 && !info.names.some((n) => /外部 ·/.test(n)));
        await shot(page, 'phone-new-relay-external.png');
      } else check('没配置外部身份：新建接力里没有「外部」这一类', info.tags.length === 0 && !info.names.some((n) => /agent-x/.test(n)));
      await s.ctx.close();
    }
    // ---- 演示：主人发起的接力放行最后一棒直接完成 ----
    s = await open(browser, {width: 390, height: 844, touch: true});
    page = s.page;
    const out = await page.evaluate(() => {
      const d = (R32Relay.demoCreate('测试', '测试', [{person: {id: 'research', key: 'research', name: '调研', type: 'assistant', roster: true}, task: 'a', gate: false},
        {person: {id: 'owner', key: 'ext:owner:owner', name: '你', type: 'owner'}, task: '看一眼'}]), R32Relay.demoState()[0]);
      const id = d.id;
      R32Relay.tick(); // 第 1 棒交回，轮到「你」
      const mid = R32Relay.demoState().find((x) => x.id === id);
      R32Relay.demoAct(id, 'release', '');
      return {mid: mid.phase, end: R32Relay.demoState().find((x) => x.id === id).phase};
    });
    check('演示：最后一棒主人放行 → 直接 done（不停在「走完等验收」）', out.mid === 'gate' && out.end === 'done');
    check('演示：没有报错', s.errors.length === 0);
    await s.ctx.close();
    console.log('\n全部通过：' + passed + ' 项');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
