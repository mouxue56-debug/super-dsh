// 接力：卡片进度线、点开的时间线、新建接力、今天页「接力停在你这里」、首页「在跑第 N 棒」、
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
const port = 3851;
const dist = path.join(__dirname, 'dist-generic');
const shots = process.env.R32_SHOTS || path.join(__dirname, '..', 'shots');
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

/* ---- 内存假后端：和 hub-bff 的看板接口同形状（含接力的主人接口） ---- */
function fakeBackend() {
  const ts = (min) => new Date(Date.now() - min * 60000).toISOString();
  const mkStep = (name, type, task, over) => Object.assign({who: {name, type: type || 'assistant'}, task, doneWhen: '', gate: false,
    status: 'waiting', startedAt: null, deliveredAt: null, note: null, noteBy: null, question: null, returnedNote: null}, over || {});
  const base = (id, title, over) => Object.assign({id, title, goal: title + '的说明', from: {name: 'owner', type: 'owner'}, to: [], claimedBy: null,
    claimedByType: null, state: 'progress', review: 'none', open_ask: null, createdAt: ts(300), updatedAt: ts(5), progress: [], reports: [],
    report: null, verification: [], acceptance: [], history: []}, over || {});
  const tickets = [];
  // 1 在做：第 2 棒是外部 agent
  tickets.push(base('T-20261119-090000-aa01', '活动筹备（真实）', {claimedBy: 'pm-agent', claimedByType: 'external', to: ['pm-agent'], relay: {v: 1, phase: 'running', current: 1, finalAt: null, steps: [
    mkStep('research', 'assistant', '查往年案例', {status: 'done', startedAt: ts(200), deliveredAt: ts(150), note: '查到 5 个案例，放在 /work/a.md。注意含税价。', noteBy: 'research'}),
    mkStep('pm-agent', 'external', '做成表格并核对数字', {status: 'active', startedAt: ts(150)}),
    mkStep('content', 'assistant', '写推荐语'), mkStep('owner', 'owner', '看一眼再发')]}}));
  // 2 停在等你（做完要我看一眼）
  tickets.push(base('T-20261119-090100-aa02', '客户询问（真实）', {claimedBy: 'chief', claimedByType: 'assistant', to: ['chief'], state: 'waiting-human',
    open_ask: {text: '接力第 1 棒做完了，等你看一眼再放行', ts: ts(3)}, from: {name: 'chief', type: 'assistant'}, relay: {v: 1, phase: 'gate', current: 0, finalAt: null, steps: [
      mkStep('chief', 'assistant', '整理客户问题', {gate: true, status: 'done', startedAt: ts(60), deliveredAt: ts(3), note: '问题一共三条，放在 /work/q.md', noteBy: 'chief'}),
      mkStep('research', 'assistant', '查资料'), mkStep('writer', 'assistant', '拟回复')]}}));
  // 3 卡住
  tickets.push(base('T-20261119-090200-aa03', '周报（真实）', {claimedBy: 'writer', claimedByType: 'assistant', to: ['writer'], state: 'waiting-human',
    open_ask: {text: '不知道写给谁看', ts: ts(2)}, from: {name: 'chief', type: 'assistant'}, relay: {v: 1, phase: 'stuck', current: 1, finalAt: null, steps: [
      mkStep('research', 'assistant', '汇总调研', {status: 'done', startedAt: ts(90), deliveredAt: ts(40), note: '汇总好了', noteBy: 'research'}),
      mkStep('writer', 'assistant', '汇总写作', {status: 'stuck', startedAt: ts(40), stuckAt: ts(2), question: '不知道写给谁看'}),
      mkStep('chief', 'assistant', '合并')]}}));
  // 4 走完了，主人发起，等你验收
  tickets.push(base('T-20261119-090300-aa04', '做封面（真实）', {claimedBy: 'art', claimedByType: 'assistant', review: 'submitted', relay: {v: 1, phase: 'final', current: 2, finalAt: ts(1), steps: [
    mkStep('writer', 'assistant', '写文案', {status: 'done', startedAt: ts(300), deliveredAt: ts(250), note: '文案放 /w', noteBy: 'writer'}),
    mkStep('art', 'assistant', '出图', {status: 'done', startedAt: ts(250), deliveredAt: ts(1), note: '图放 /i', noteBy: 'art'})]}}));
  // 6 八棒（最多）：进度线要放得下
  tickets.push(base('T-20261119-090500-aa06', '八棒长接力（真实）', {claimedBy: 'content', claimedByType: 'assistant', relay: {v: 1, phase: 'running', current: 5, finalAt: null, steps:
    ['research', 'writer', 'content', 'art', 'pm', 'content', 'writer', 'chief'].map((n, i) => mkStep(n, 'assistant', '第' + (i + 1) + '步', i < 5 ? {status: 'done', startedAt: ts(300 - i), deliveredAt: ts(290 - i), note: '好了', noteBy: n} : i === 5 ? {status: 'active', startedAt: ts(20)} : {}))}}));
  // 5 普通卡：行为不变
  tickets.push(base('T-20261119-090400-aa05', '一张普通的卡', {claimedBy: 'chief', claimedByType: 'assistant', to: ['chief']}));
  const calls = [];
  const advance = (t) => {
    const r = t.relay; const s = r.steps[r.current];
    if (s.who.type !== 'owner') { s.status = 'done'; s.deliveredAt = new Date().toISOString(); }
    const j = r.current + 1;
    if (j >= r.steps.length) { r.phase = 'final'; r.current = j; t.state = 'progress'; t.review = 'submitted'; t.open_ask = null; return; }
    r.current = j; const n = r.steps[j]; n.startedAt = new Date().toISOString();
    if (n.who.type === 'owner') { n.status = 'gate'; r.phase = 'gate'; t.state = 'waiting-human'; t.open_ask = {text: '接力第 ' + (j + 1) + ' 棒要你来', ts: new Date().toISOString()}; }
    else { n.status = 'active'; r.phase = 'running'; t.state = 'progress'; t.open_ask = null; t.claimedBy = n.who.name; t.claimedByType = n.who.type; }
  };
  const handle = (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (status, body) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    if (!p.startsWith('/bff/board/')) return route.abort();
    if (req.method() === 'GET' && p === '/bff/board/tickets') return json(200, {tickets});
    if (req.method() === 'GET' && p === '/bff/board/people') {
      return json(200, {people: [{id: 'chief', name: '总管', type: 'assistant'}, {id: 'pm-agent', name: 'pm-agent', type: 'external'}]});
    }
    const m = /^\/bff\/board\/tickets(?:\/new|\/([^/]+)\/(move|relay))$/.exec(p);
    if (req.method() !== 'POST' || !m) return json(404, {});
    const body = JSON.parse(req.postData() || '{}');
    calls.push({path: p.replace('/bff/board', ''), body});
    if (backend.fail) return json(409, {error: {code: 'CONFLICT'}});
    if (!m[1]) {
      const steps = (body.relay.steps || []).map((s) => mkStep(s.who === 'owner' ? 'owner' : s.who, s.who === 'owner' ? 'owner' : s.who === 'pm-agent' ? 'external' : 'assistant', s.task, {gate: !!s.gate}));
      const t = base('T-20261119-100000-new' + calls.length, body.title, {goal: body.goal, relay: {v: 1, phase: 'running', current: 0, finalAt: null, steps}});
      t.relay.steps[0].status = 'active'; t.relay.steps[0].startedAt = new Date().toISOString(); t.claimedBy = steps[0].who.name;
      tickets.unshift(t);
      return json(201, {ticket: t});
    }
    const t = tickets.find((x) => x.id === m[1]);
    if (m[2] === 'move') { t.state = 'completed'; t.review = 'accepted'; if (t.relay) t.relay.phase = 'done'; }
    if (m[2] === 'relay') {
      const r = t.relay; const s = r.steps[r.current];
      if (body.action === 'release' && r.phase === 'gate') { if (s.who.type === 'owner') { s.status = 'done'; s.note = body.text || '放行'; s.noteBy = 'owner'; } advance(t); }
      else if (body.action === 'redo' && r.phase === 'gate') { s.status = 'active'; s.returnedNote = body.text; r.phase = 'running'; t.state = 'progress'; t.open_ask = null; }
      else if (body.action === 'answer' && r.phase === 'stuck') { s.status = 'active'; r.phase = 'running'; t.state = 'progress'; t.open_ask = null; }
      else return json(409, {error: {code: 'CONFLICT'}});
    }
    t.updatedAt = new Date().toISOString();
    return json(200, {ticket: t});
  };
  const backend = {tickets, calls, handle, fail: false};
  return backend;
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
const state = (page) => page.evaluate(() => R32Relay.demoState());
const shot = (page, name) => page.screenshot({path: path.join(shots, name)});
const strip = (page, id) => page.evaluate((i) => {
  const card = document.querySelector('[data-r30-card="' + i + '"]');
  if (!card) return null;
  const q = (c) => card.querySelectorAll('.r32-node.' + c).length;
  return {nodes: card.querySelectorAll('.r32-node').length, links: card.querySelectorAll('.r32-link').length, done: q('is-done'),
    now: q('is-now'), wait: q('is-wait'), gate: q('is-gate'), stuck: q('is-stuck'), ticks: card.querySelectorAll('.r32-tick').length,
    line: (card.querySelector('.r29-desk-line') || {}).textContent};
}, id);
const tickTo = async (page, fn, max) => {
  for (let i = 0; i < (max || 20); i += 1) {
    if (fn(await state(page))) return true;
    await page.evaluate(() => R32Relay.tick());
  }
  return fn(await state(page));
};

(async () => {
  fs.mkdirSync(shots, {recursive: true});
  const server = await serve();
  const browser = await playwright.chromium.launch({executablePath: chromium, headless: true});
  try {
    // ================= 手机：演示 =================
    let s = await open(browser, {width: 390, height: 844, touch: true});
    let page = s.page;
    const A = 'r32-demo-event';
    const B = 'r32-demo-dev';
    let st = await strip(page, A);
    check('手机演示：运营类演示卡上有一排小头像：4 个、3 段线，第 1 棒高亮、后面灰着', st && st.nodes === 4 && st.links === 3 && st.now === 1 && st.wait === 3 && st.done === 0);
    check('手机演示：卡片一眼看出现在在谁手上、第几棒、共几棒', /第 1 棒\/共 4 棒 · .*在做/.test(st.line));
    check('手机演示：开发类演示卡末尾是「你」', await page.evaluate((id) => {
      const nodes = document.querySelectorAll('[data-r30-card="' + id + '"] .r32-node');
      return nodes[nodes.length - 1].textContent.indexOf('你') >= 0;
    }, B));
    await shot(page, 'phone-demo-board-start.png');
    // 自己走：量一次真实间隔，应当在 3–4 秒
    const t0 = Date.now();
    await page.waitForFunction(() => R32Relay.demoState()[0].current >= 1, null, {timeout: 8000});
    const gap = Date.now() - t0;
    check('手机演示：自己往前走，一步约 3–4 秒（实测 ' + gap + ' 毫秒，含起算）', gap >= 1800 && gap <= 4800);
    await page.waitForTimeout(900);
    st = await strip(page, A);
    check('手机演示：交棒后上一棒打勾，当前棒换人，这一段线变绿', st.done === 1 && st.now === 1 && st.ticks >= 1 && /第 2 棒\/共 4 棒/.test(st.line));
    check('手机演示：交棒时那一段线有从上一位流向下一位的动效', await page.evaluate((id) => {
      const link = document.querySelector('[data-r30-card="' + id + '"] .r32-link.is-pass');
      return !!link && getComputedStyle(link.querySelector('i')).animationName === 'r32-flow';
    }, A));
    check('手机演示：当前棒的头像有呼吸感（动画在跑）', await page.evaluate((id) => {
      const el = document.querySelector('[data-r30-card="' + id + '"] .r32-node.is-now');
      return getComputedStyle(el, '::before').animationName === 'r32-breathe';
    }, A));
    await shot(page, 'phone-demo-board-moving.png');
    // 点开：时间线
    await page.evaluate((id) => window.R30Board.open(id), A);
    await page.waitForSelector('.r30-sheet .r32-tl');
    check('手机演示：点开是一条竖着的时间线，每一棒有头像、名字、做什么、状态、用时', await page.evaluate(() => {
      const steps = [...document.querySelectorAll('.r30-sheet .r32-step')].filter((x) => !x.classList.contains('r32-end'));
      return steps.length === 4 && steps.every((x) => x.querySelector('.r32-face') && x.querySelector('.r32-head strong') &&
        x.querySelector('.r32-task') && x.querySelector('.r32-chip')) && /用时 \d+ 分钟/.test(steps[0].textContent);
    }));
    check('手机演示：交接说明默认收着，点开能看到上一棒写给下一棒的话', await page.evaluate(() => {
      const d = document.querySelector('.r30-sheet .r32-note');
      return !!d && !d.open && /查了 5 个往年案例/.test(d.textContent);
    }));
    await page.click('.r30-sheet .r32-note summary');
    check('手机演示：点开交接说明后，下一次刷新也保持展开', await page.evaluate(() => document.querySelector('.r30-sheet .r32-note').open));
    await shot(page, 'phone-demo-sheet-timeline.png');
    check('手机演示：接力的卡不给手动换人、换列（后面只有标题说明和删除）', await page.evaluate(() =>
      !document.querySelector('.r30-sheet [data-r30-col]') && !document.querySelector('.r30-sheet [data-r30-who]')));
    await page.click('.r30-sheet [data-r30-close]');
    // 卡住：回答
    await tickTo(page, (x) => x[1].phase === 'stuck');
    await page.evaluate((id) => window.R30Board.open(id), B);
    await page.waitForSelector('.r30-sheet .r32-ask.is-stuck');
    check('手机演示：卡住时点开，直接问「你的回答」，按钮是「回答，让它继续」', await page.evaluate(() => {
      const a = document.querySelector('.r30-sheet .r32-ask.is-stuck');
      return /卡住了/.test(a.textContent) && /是几点/.test(a.textContent) && !!a.querySelector('textarea') && /回答，让它继续/.test(a.textContent);
    }));
    await shot(page, 'phone-demo-stuck.png');
    await page.click('.r30-sheet [data-r32-act="answer"]');
    check('手机演示：没写回答不让继续', (await state(page))[1].phase === 'stuck');
    await page.fill('.r30-sheet [name=r32note]', '按 9 点');
    await page.click('.r30-sheet [data-r32-act="answer"]');
    check('手机演示：回答后从这一棒继续', (await state(page))[1].phase === 'running' && (await state(page))[1].current === 1);
    await page.click('.r30-sheet [data-r30-close]');
    // 停在等你：放行
    await tickTo(page, (x) => x[1].phase === 'gate');
    await page.waitForTimeout(150);
    check('手机演示：停在「等你」的那一棒，头像带「!」，线停在这里', await strip(page, B).then((x) => x.gate === 1 && x.line.indexOf('接力停在你这里') >= 0));
    await shot(page, 'phone-demo-gate-card.png');
    await page.evaluate((id) => window.R30Board.open(id), B);
    await page.waitForSelector('.r30-sheet .r32-ask');
    check('手机演示：停在你这里时，点开能放行（我看过了，放行）', await page.evaluate(() => /我看过了，放行/.test(document.querySelector('.r30-sheet .r32-ask').textContent)));
    await shot(page, 'phone-demo-gate-sheet.png');
    await page.click('.r30-sheet [data-r32-act="release"]');
    check('手机演示：放行后走向总验收', await page.evaluate(() => R32Relay.demoState()[1].phase === 'final'));
    await page.click('.r30-sheet [data-r30-close]');
    check('手机演示：走完等验收的卡落在「等验收」列', await page.evaluate((id) => document.querySelector('[data-r30-card="' + id + '"]').closest('.r30-group').getAttribute('data-r30-group') === 'review', B));
    await tickTo(page, (x) => x[0].phase === 'done' && x[1].phase === 'done');
    await page.waitForTimeout(300);
    await page.click('[data-r30-fold]');
    await page.waitForTimeout(200);
    st = await strip(page, A);
    check('手机演示：走完后全部打勾，没有高亮，一句话说「走完了」，卡落到「完成」列', st.done === 4 && st.now === 0 && /走完了/.test(st.line) && await page.evaluate((id) =>
      document.querySelector('[data-r30-card="' + id + '"]').closest('.r30-group').getAttribute('data-r30-group') === 'done', A));
    await shot(page, 'phone-demo-board-done.png');
    // 重播
    await page.click('[data-r32-replay]');
    await page.waitForTimeout(300);
    check('手机演示：点「重播」从头再走一遍', await state(page).then((x) => x[0].current === 0 && x[1].current === 0 && x[0].phase === 'running'));
    // 新建接力
    await page.click('.r30-phone [data-r30-new]');
    await page.waitForSelector('.r30-sheet .r32-mode');
    await shot(page, 'phone-new-single.png');
    await page.click('[data-r32-mode="relay"]');
    check('手机演示：新建时能选「接力」，出现现成路线和点选的人', await page.evaluate(() =>
      document.querySelectorAll('.r30-sheet .r32-tpl').length === 4 && document.querySelectorAll('.r30-sheet .r32-pick .r30-who').length >= 6));
    check('手机演示：四条现成路线里不只有写代码（活动、客户、周报、功能开发）', await page.evaluate(() =>
      [...document.querySelectorAll('.r32-tpl b')].map((b) => b.textContent).join(',') === '活动筹备,客户询问,周报,功能开发'));
    await shot(page, 'phone-new-relay-empty.png');
    await page.click('[data-r32-add="research"]');
    await page.fill('.r30-sheet [name=title]', '只有一位');
    await page.$eval('[data-r32-go]', (b) => b.click());
    check('手机演示：少于两位不让发起，并说明原因', await page.evaluate(() => !!document.querySelector('.r30-sheet .r32-build') &&
      /最少要两位/.test(document.querySelector('.r30-flash').textContent)));
    await page.fill('.r30-sheet [name=title]', '');
    await page.click('[data-r32-tpl="1"]');
    check('手机演示：点一条现成路线，一次排好 4 棒（含「你」看一眼），标题自动填上', await page.evaluate(() =>
      document.querySelectorAll('.r30-sheet .r32-build-row').length === 4 && document.querySelector('.r30-sheet [name=title]').value === '回复一位客户的询问' &&
      /你/.test(document.querySelectorAll('.r30-sheet .r32-build-row')[3].textContent)));
    await shot(page, 'phone-new-relay-template.png');
    await page.click('.r30-sheet [data-r32-del="1"]');
    await page.click('.r30-sheet [data-r32-add="art"]');
    await page.fill('.r30-sheet [data-r32-task="3"]', '出一张配图');
    check('手机演示：能去掉一棒、再点一位加一棒，每棒一句话写得进去', await page.evaluate(() =>
      document.querySelectorAll('.r30-sheet .r32-build-row').length === 4 && document.querySelector('.r30-sheet [data-r32-task="3"]').value === '出一张配图'));
    await page.click('[data-r32-go]');
    await page.waitForTimeout(400);
    check('手机演示：发起后，看板上多了一张接力卡，4 棒、第 1 棒在做', await page.evaluate(() => {
      const card = [...document.querySelectorAll('.r30-pcard')].find((c) => c.textContent.includes('回复一位客户的询问'));
      return !!card && card.querySelectorAll('.r32-node').length === 4 && card.querySelectorAll('.r32-node.is-now').length === 1;
    }));
    await shot(page, 'phone-new-relay-created.png');
    // 今天页
    await page.evaluate(() => { R32Relay.replay(); });
    await tickTo(page, (x) => x[1].phase === 'gate');
    check('今天页（演示数据）：等你处理里出现「接力停在你这里」', await page.evaluate(() => {
      const m = R30LT.demoToday();
      return m.waiting.items.some((i) => i.tag === '接力停在你这里' && i.kind === 'relay');
    }));
    check('手机演示：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ---- 手机：首页格子上的状态句 + 今天页 ----
    s = await open(browser, {width: 390, height: 844, touch: true, hash: ''});
    page = s.page;
    await page.waitForSelector('[data-bot-status]');
    await page.waitForTimeout(500);
    check('手机演示首页：相关助理格子上写「接力第 N 棒/共 4 棒」，一行放得下，格子布局不变', await page.evaluate(() => {
      const lines = [...document.querySelectorAll('[data-bot-tree] small[data-bot-status]')].map((x) => x.textContent);
      const small = [...document.querySelectorAll('[data-bot-tree] small.r32-home-line')];
      return lines.some((x) => /^接力第\d棒\/共\d棒$/.test(x)) && document.querySelectorAll('[data-bot-tree]').length >= 6 &&
        small.every((x) => x.scrollWidth <= x.clientWidth + 1);
    }));
    await shot(page, 'phone-home-relay.png');
    await tickTo(page, (x) => x[1].phase === 'gate');
    await page.click('[data-today-open]');
    await page.waitForTimeout(500);
    check('手机演示今天页：「等你处理」里是「接力停在你这里」那一项', await page.evaluate(() => document.body.textContent.indexOf('接力停在你这里') >= 0));
    await shot(page, 'phone-today-relay.png');
    await s.ctx.close();

    // ---- 手机：暗色 ----
    s = await open(browser, {width: 390, height: 844, touch: true, scheme: 'dark'});
    page = s.page;
    await tickTo(page, (x) => x[1].phase === 'stuck');
    await shot(page, 'phone-demo-board-dark.png');
    await page.evaluate((id) => window.R30Board.open(id), B);
    await page.waitForSelector('.r30-sheet .r32-ask');
    await shot(page, 'phone-demo-stuck-dark.png');
    await page.click('.r30-sheet [data-r30-close]');
    await page.click('.r30-phone [data-r30-new]');
    await page.click('[data-r32-mode="relay"]');
    await page.click('[data-r32-tpl="0"]');
    await shot(page, 'phone-new-relay-dark.png');
    check('手机暗色：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ---- 手机：减弱动态效果 ----
    s = await open(browser, {width: 390, height: 844, touch: true, reduced: true});
    page = s.page;
    await page.evaluate(() => R32Relay.tick());
    await page.waitForTimeout(400);
    check('减弱动态效果：呼吸和交棒动效都不跑，当前棒仍有静态的圈', await page.evaluate((id) => {
      const el = document.querySelector('[data-r30-card="' + id + '"] .r32-node.is-now');
      const before = getComputedStyle(el, '::before');
      const link = document.querySelector('.r32-link.is-pass i');
      return before.animationName === 'none' && parseFloat(before.borderTopWidth) >= 2 && (!link || getComputedStyle(link).animationName === 'none');
    }, A));
    await s.ctx.close();

    // ================= 手机：真实模式（假后端） =================
    const backend = fakeBackend();
    s = await open(browser, {width: 390, height: 844, touch: true, real: true, backend});
    page = s.page;
    const R = (n) => 'T-20261119-0900' + n + '00-aa0' + n;
    const rid = (n) => n === 5 ? backend.tickets.find((t) => t.title === '一张普通的卡').id : backend.tickets[n - 1].id;
    const eightId = backend.tickets.find((t) => t.title.indexOf('八棒') === 0).id;
    st = await strip(page, rid(1));
    check('手机真实：接力卡来自后端，进度线按后端的棒数和状态画（第 2 棒外部 agent 在做）', st && st.nodes === 4 && st.done === 1 && st.now === 1 && st.wait === 2 && /第 2 棒\/共 4 棒/.test(st.line));
    check('手机真实：外部 agent 的头像是它名字的首字，主人这一棒是「你」', await page.evaluate((id) => {
      const n = document.querySelectorAll('[data-r30-card="' + id + '"] .r32-node');
      return /p/.test(n[1].textContent) && /你/.test(n[3].textContent);
    }, rid(1)));
    check('手机真实：八棒的长接力，进度线整排放得下，没有溢出卡片', await page.evaluate((id) => {
      const card = document.querySelector('[data-r30-card="' + id + '"]');
      const nodes = card.querySelector('.r32-nodes');
      return card.querySelectorAll('.r32-node').length === 8 && nodes.scrollWidth <= nodes.clientWidth + 1 &&
        card.querySelector('.r32-strip').getBoundingClientRect().right <= card.getBoundingClientRect().right;
    }, eightId));
    check('手机真实：普通卡没有进度线、行为不变', await page.evaluate((id) => !document.querySelector('[data-r30-card="' + id + '"] .r32-strip') &&
      !!document.querySelector('[data-r30-card="' + id + '"] [data-r30-assign]'), rid(5)));
    check('手机真实：停在你这里、卡住、走完的卡都在「等你/等验收」里', await page.evaluate((ids) => ids.map((id) =>
      document.querySelector('[data-r30-card="' + id + '"]').closest('.r30-group').getAttribute('data-r30-group')).join(','), [rid(2), rid(3), rid(4)]).then((x) => x === 'attention,attention,review'));
    await shot(page, 'phone-real-board.png');
    await page.click('[data-r30-card="' + rid(2) + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r32-ask');
    await shot(page, 'phone-real-gate-sheet.png');
    await page.fill('.r30-sheet [name=r32note]', '再补一条来源');
    await page.click('.r30-sheet [data-r32-act="redo"]');
    await page.waitForTimeout(300);
    check('手机真实：退回重做真发给后端（带上那句话）', backend.calls.some((c) => c.path === '/tickets/' + rid(2) + '/relay' && c.body.action === 'redo' && c.body.text === '再补一条来源') &&
      backend.tickets[1].relay.phase === 'running');
    await page.click('.r30-sheet [data-r30-close]');
    await tickTo(page, () => true, 0);
    await page.click('[data-r30-card="' + rid(3) + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r32-ask.is-stuck');
    check('手机真实：卡住的卡显示它的问题', await page.evaluate(() => /不知道写给谁看/.test(document.querySelector('.r30-sheet .r32-ask').textContent)));
    await page.fill('.r30-sheet [name=r32note]', '写给新手');
    await page.click('.r30-sheet [data-r32-act="answer"]');
    await page.waitForTimeout(300);
    check('手机真实：回答真发给后端，卡回到进行中', backend.calls.some((c) => c.path === '/tickets/' + rid(3) + '/relay' && c.body.action === 'answer' && c.body.text === '写给新手') && backend.tickets[2].relay.phase === 'running');
    await page.click('.r30-sheet [data-r30-close]');
    await page.click('[data-r30-card="' + rid(4) + '"] .r29-desk-title');
    await page.waitForSelector('.r30-sheet .r32-ask.is-done');
    await page.click('.r30-sheet [data-r32-act="finish"]');
    await page.waitForTimeout(300);
    check('手机真实：主人发起的接力走完后，点「验收，标完成」真发给后端', backend.calls.some((c) => c.path === '/tickets/' + rid(4) + '/move' && c.body.column === 'done') && backend.tickets[3].state === 'completed');
    // 后端拒绝：不假装成功
    backend.fail = true;
    await page.click('.r30-sheet [data-r30-close]').catch(() => {});
    backend.fail = false;
    // 新建接力
    await page.click('.r30-phone [data-r30-new]');
    await page.click('[data-r32-mode="relay"]');
    await page.click('[data-r32-tpl="3"]');
    await page.click('[data-r32-go]');
    await page.waitForTimeout(500);
    const made = backend.calls.find((c) => c.path === '/tickets/new');
    check('手机真实：新建接力真发给后端，带上路线（谁接、做什么、第几棒是「你」）', !!made && made.body.relay.steps.length === 4 &&
      made.body.relay.steps[3].who === 'owner' && made.body.relay.steps.every((x) => x.task) && made.body.title === '做一个新功能');
    check('手机真实：新建后卡就在看板上，第 1 棒在做', await page.evaluate(() => {
      const c = [...document.querySelectorAll('.r30-pcard')].find((x) => x.textContent.includes('做一个新功能'));
      return !!c && c.querySelectorAll('.r32-node.is-now').length === 1;
    }));
    // 今天页（真实）：造一张停在等你的接力卡，经原来的 normalizeToday 走一遍
    const gateTicket = JSON.parse(JSON.stringify(backend.tickets[1]));
    gateTicket.state = 'waiting-human';
    gateTicket.relay.phase = 'gate';
    gateTicket.relay.steps[0].status = 'done';
    const model = await page.evaluate((tk) => {
      const m = R30LT.normalizeToday({ok: true, date: '2026-11-19', waiting: {available: true, waitingAnswer: [{id: tk.id, title: tk.title, assistant: 'chief', reason: '接力第 1 棒做完了'}],
        awaitingReview: [], blocked: []}, approvals: {available: true, cards: [], kbDrafts: []}}, [tk], (x) => x);
      return m.waiting.items.map((i) => i.tag + '|' + i.id + '|' + i.sub);
    }, gateTicket);
    check('今天页（真实数据）：停在你这里的接力卡，标成「接力停在你这里」（原来的「等你回答」那一条改标，不重复列）',
      model.length === 1 && model[0].indexOf('接力停在你这里|' + gateTicket.id) === 0 && /等你看一眼/.test(model[0]));
    const plainModel = await page.evaluate((tk) => R30LT.normalizeToday({ok: true, date: '2026-11-19', waiting: {available: true, waitingAnswer: [{id: tk.id, title: tk.title, assistant: 'chief', reason: 'x'}],
      awaitingReview: [], blocked: []}, approvals: {available: true, cards: [], kbDrafts: []}}, [Object.assign({}, tk, {relay: undefined})], (x) => x).waiting.items.map((i) => i.tag), gateTicket);
    check('今天页（真实数据）：普通卡的「等你回答」不变', plainModel.length === 1 && plainModel[0] === '等你回答');
    check('手机真实：没有报错', s.errors.length === 0);
    await s.ctx.close();

    // ================= 电脑 =================
    s = await open(browser, {width: 1440, height: 900});
    page = s.page;
    await tickTo(page, (x) => x[0].current >= 2);
    await page.waitForTimeout(400);
    check('电脑演示：接力卡在五列里，进度线放得下，没有横向溢出', await page.evaluate((id) => {
      const card = document.querySelector('.r29-desk [data-r30-card="' + id + '"]');
      const strip = card.querySelector('.r32-strip').getBoundingClientRect();
      const box = card.getBoundingClientRect();
      return strip.right <= box.right + 1 && strip.left >= box.left - 1 && card.querySelectorAll('.r32-node').length === 4;
    }, A));
    await shot(page, 'desk-demo-board.png');
    await page.click('.r29-desk [data-r30-card="' + B + '"] .r29-desk-title');
    await page.waitForSelector('.r29-desk-side .r32-tl');
    check('电脑演示：点卡片，右侧栏就是接力时间线', await page.evaluate(() => document.querySelectorAll('.r29-desk-side .r32-step').length >= 4));
    await shot(page, 'desk-demo-side-timeline.png');
    await page.click('.r29-desk [data-r30-new]');
    await page.click('[data-r32-mode="relay"]');
    await page.click('[data-r32-tpl="2"]');
    await shot(page, 'desk-new-relay.png');
    await page.keyboard.press('Escape');
    await s.ctx.close();
    s = await open(browser, {width: 1440, height: 900, real: true, backend: fakeBackend()});
    page = s.page;
    check('电脑真实：八棒的长接力在窄列里放得下（换行也不溢出卡片）', await page.evaluate(() => {
      const card = [...document.querySelectorAll('.r29-desk .r30-card')].find((c) => c.textContent.includes('八棒长接力'));
      const box = card.getBoundingClientRect();
      const nodes = [...card.querySelectorAll('.r32-node')].map((n) => n.getBoundingClientRect());
      return nodes.length === 8 && nodes.every((r) => r.right <= box.right + 1 && r.left >= box.left - 1);
    }));
    await shot(page, 'desk-real-board.png');
    check('电脑真实：没有报错', s.errors.length === 0);
    await s.ctx.close();
    s = await open(browser, {width: 1440, height: 900, scheme: 'dark'});
    page = s.page;
    await tickTo(page, (x) => x[1].phase === 'stuck');
    await shot(page, 'desk-demo-board-dark.png');
    check('电脑暗色：没有报错', s.errors.length === 0);
    await s.ctx.close();
    console.log('\n全部通过：' + passed + ' 项');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
