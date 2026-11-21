// 界面入口（选模型、今天、一键全停、固定任务、晨会晚会、规矩页、看全文）的契约与桩测试。
// 只用假的 Hub、假的 fetch：不起服务、不碰屏幕。没有在手机上验过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const f = require('../hub-real.js');
const { environment } = require('./dom-double.cjs');
const source = await readFile(new URL('../hub-real.js', import.meta.url), 'utf8');

const htmlWrites = [];

class Node {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs || {};
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.isConnected = true;
    this.parent = null;
    for (const [key, value] of Object.entries(this.attrs)) {
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    this.append(...(Array.isArray(children) ? children : [children]));
  }

  append(...children) {
    for (const child of children.filter(c => c != null)) {
      if (child instanceof Node) child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
  }

  get textContent() {
    return this.children.map(c => typeof c === 'object' ? c.textContent : String(c)).join('');
  }

  set textContent(value) {
    this.children = [String(value)];
  }

  set innerHTML(value) {
    htmlWrites.push(String(value));
  }

  get disabled() { return this.attrs.disabled === true; }
  set disabled(value) { this.attrs.disabled = value; }
  addEventListener() {}
  setAttribute() {}
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }

  all() {
    return this.children.flatMap(c => c instanceof Node ? [c, ...c.all()] : []);
  }

  querySelectorAll(selector) {
    if (selector === '*') return this.all();
    if (selector.startsWith('.')) {
      return this.all().filter(n => (n.attrs.class || '').split(' ').includes(selector.slice(1)));
    }
    return [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const missing = () => response({}, 404);
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };

function fixture(respond, { mode = 'real', crypto: cryptoImpl } = {}) {
  const { ctx, listeners } = environment();
  ctx.document.hidden = true;
  const panels = new Map(), more = new Map(), cards = new Map(), calls = [], toasts = [];
  const H = ctx.Hub;
  H.h = (tag, attrs, children) => new Node(tag, attrs, children);
  H.registerPanel = (id, spec) => panels.set(id, spec);
  H.registerCard = (id, spec) => cards.set(id, spec);
  H.registerMoreItem = item => more.set(item.id, item);
  H.toast = text => toasts.push(text);
  H.openPanel = id => { calls.push('open:' + id); };
  H.avatar = bot => H.h('span', {}, bot);
  H.botStyle = () => '';
  ctx.localStorage.getItem = () => mode === 'demo' ? 'demo' : null;
  ctx.fetch = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', body: options.body });
    return respond(path, options);
  };
  ctx.crypto = cryptoImpl || { randomUUID: () => 'test-id' };
  ctx.TextEncoder = TextEncoder;
  vm.runInContext(source, ctx);
  const click = async button => {
    const handler = listeners.get('click')[0];
    const target = { closest: () => button };
    let consumed = false;
    handler({ target, preventDefault() { consumed = true; }, stopImmediatePropagation() {} });
    await tick();
    return consumed;
  };
  const paths = () => calls.filter(c => typeof c === 'object').map(c => c.method + ' ' + c.path);
  return { ctx, H, panels, more, cards, calls, toasts, listeners, click, paths };
}

// 一个模拟的按钮：只带 data-* 与文字，点击处理器只认 dataset。
function fakeButton(attrs, text = '按钮') {
  const button = new Node('button', attrs, text);
  button.closest = () => null;
  return button;
}

const partial = {
  ok: false, state: 'partial', reason: '测试', since: 1,
  steps: { marker: { status: 'ok', detail: '已写' }, 'timer:routines': { status: 'failed', detail: '超时了' },
    sessions: { status: 'failed', detail: '<b>还有 1 个</b>' } },
  live: { runningSessions: 1, runningExternal: null }
};

test('纯函数：全停状态只认三种，没停全列出失败步骤', () => {
  assert.equal(f.panicView(null), null);
  assert.equal(f.panicView({ state: '随便' }), null);
  assert.equal(f.panicView({ state: 'running', steps: {} }).state, 'running');
  const view = f.panicView(partial);
  assert.equal(view.state, 'partial');
  assert.deepEqual(view.failed.map(s => s.name), ['固定任务定时', '在跑的会话']);
  assert.equal(view.failed[1].reason, '<b>还有 1 个</b>');
  assert.equal(view.live.sessions, 1);
  assert.equal(view.live.external, null);
  assert.equal(f.panicStepName('timer:zzz'), '定时：zzz');
});

test('纯函数：选模型只有开关明确开着才出现', () => {
  const data = { default: 'a/x', options: [{ ref: 'a/x', name: '甲', selectable: true, window: 128000 },
    { ref: 'a/y', name: '乙', selectable: false, reason: '不在线' }] };
  assert.equal(f.modelPickView(data), null);
  assert.equal(f.modelPickView({ ...data, enabled: false }), null);
  assert.equal(f.modelPickView({ ...data, enabled: 'true' }), null);
  assert.equal(f.modelPickView({ enabled: true, options: [] }), null);
  const view = f.modelPickView({ ...data, enabled: true });
  assert.equal(view.options.length, 2);
  assert.equal(view.options[0].window, '128K');
  assert.equal(view.options[1].selectable, false);
  assert.match(f.modelErrorText({ payload: { error: { message: '选模型未启用' } } }), /选模型未启用/);
  assert.match(f.modelErrorText({}), /没有建出来/);
});

test('纯函数：今天一页每段独立容错，没数据是暂无', () => {
  assert.equal(f.todayView(null), null);
  const view = f.todayView({
    date: '2026-11-18',
    approvals: { available: true, cards: [{ assistant: 'a', title: '<img src=x onerror=alert(1)>' }], kbDrafts: [] },
    waiting: { available: false, reason: '看板不可用' },
    yesterdayDone: { available: true, byAssistant: [{ id: 'a', count: 1, items: [{ title: '做完', summary: '自述' }] }] },
    yesterdayUsage: { available: true, byAssistant: [{ id: 'a', calls: 2, tokenTotal: 1234, unreportedCalls: 1,
      cost: { amounts: { USD: 0.5 }, label: '部分待定价' } }], total: { calls: 2, tokenTotal: 1234, cost: {} } },
    lastEveningMinutes: { available: true, date: '2026-11-17', text: '纪要\n第二行', truncated: false },
    routines: { available: true, paused: true,
      items: [{ name: '日更', assistant: 'a', at: '07:30', todayState: 'pending' }] }
  }, id => id.toUpperCase());
  const by = Object.fromEntries(view.sections.map(s => [s.id, s]));
  assert.equal(by.waiting.available, false);
  assert.equal(by.approvals.lines[0], 'A · <img src=x onerror=alert(1)>');
  assert.match(by.usage.lines[0], /A · 2 次调用 · 1,234 token（1 次没上报 token） · USD 0.5 · 部分待定价/);
  assert.match(by.usage.lines[1], /^合计 · /);
  assert.equal(by.minutes.block, '纪要\n第二行');
  assert.match(by.routines.lines[0], /日更 · A · 07:30 · 还没到点/);
  assert.equal(by.routines.note, '固定任务现在是暂停的');
});

test('纯函数：固定任务、晨会、规矩页、日期', () => {
  assert.equal(f.routineView({ items: 'x' }), null);
  const view = f.routineView({ paused: false, enabled: true, items: [
    { id: 'daily-post', name: '日更', assistant: 'a', at: '07:30', days: 'daily', todayState: 'reported', done: '放好了' },
    { id: 'Bad Id', name: '坏', days: [1, 3], todayState: 'zzz' }], invalid: [{ id: 'x', reason: '缺逃生口' }] });
  assert.equal(view.items[0].id, 'daily-post');
  assert.equal(view.items[0].when, '每天 07:30');
  assert.equal(view.items[0].state, '已回报');
  assert.equal(view.items[1].id, '');
  assert.equal(view.items[1].when, '每周一、三');
  assert.equal(view.items[1].state, '状态未知');
  assert.equal(view.invalid[0], 'x：缺逃生口');
  assert.equal(f.routineActionText('pause', 200, { state: 'paused' }), '已暂停');
  assert.match(f.routineActionText('run', 200, { state: 'skipped-paused' }), /暂停中没跑/);
  assert.match(f.routineActionText('run', 0, null), /状态不明/);
  assert.equal(f.meetingView(null, []), null);
  const meeting = f.meetingView({ times: { morning: '09:00', evening: '21:00' }, today: { morning: true },
    running: [], pendingCount: 2 },
  [{ type: 'evening', text: '晚会纪要', file: '/不显示/路径.md' }, { type: 'bad', text: 'x' }]);
  assert.equal(meeting.minutes.length, 1);
  assert.equal(meeting.minutes[0].label, '晚会');
  assert.equal(JSON.stringify(meeting).includes('不显示'), false);
  assert.equal(f.meetingRunText(409), '这场已经在开了，请稍等');
  assert.match(f.meetingRunText(200, { file: 'x', cards: [1, 2] }), /2 张投知识库的卡/);
  assert.match(f.meetingRunText(200, { file: null }), /没写出纪要/);
  assert.match(f.meetingRunText(0, null), /还在开/);
  assert.equal(f.shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(f.shiftDate('坏', 1), '');
  assert.equal(f.rulesView(null), null);
  const rules = f.rulesView({ shared: ['- 2026-11-17 长稿给小文「都交给小文」'],
    bots: { a: { lines: [{ date: '2026-11-17', text: '派给小文', quote: '交给小文' }] } } }, id => '名' + id);
  assert.equal(rules.shared[0], '- 2026-11-17 长稿给小文「都交给小文」');
  assert.equal(rules.bots[0].name, '名a');
  assert.equal(rules.bots[0].lines[0], '2026-11-17 派给小文 「交给小文」');
  assert.equal(f.isDigest('a'.repeat(64)), true);
  assert.equal(f.isDigest('A'.repeat(64)), false);
  assert.equal(f.plainText('a\u0000b\nc d'), 'a b\nc d');
});

test('新代码里没有把后端文字当页面代码的写法', async () => {
  const diff = source.split('\n');
  const start = diff.findIndex(line => line.includes('r28 路35：界面入口用的纯函数'));
  const end = diff.findIndex(line => line.includes('if (typeof module') && line.includes('module.exports = {'));
  const uiStart = diff.findIndex(line => line.includes('r28 路35：界面上缺的入口'));
  const uiEnd = diff.findIndex(line => line.includes("H.registerPanel('hub-real-board'"));
  assert(start > 0 && end > start && uiStart > 0 && uiEnd > uiStart);
  const mine = [...diff.slice(start, end), ...diff.slice(uiStart, uiEnd)].join('\n');
  assert.doesNotMatch(mine,
    /innerHTML|outerHTML|insertAdjacentHTML|fromHTML|messageHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(mine, /markdown\(/);
  const long = [...diff.slice(start, end), ...diff.slice(uiStart, uiEnd)].filter(line => Array.from(line).length > 120);
  assert.deepEqual(long, []);
});

test('六个新面板拿不到数据都显示暂无，不报错、不弹提示', async () => {
  const env = fixture(missing);
  for (const id of ['hub-real-today', 'hub-real-panic', 'hub-real-routines', 'hub-real-meetings', 'hub-real-rules']) {
    assert(env.panels.has(id), id);
    const host = new Node('div');
    await env.panels.get(id).render(host);
    assert.match(host.textContent, /暂无/, id);
  }
  const model = new Node('div');
  await env.panels.get('hub-real-model').render(model);
  assert.match(model.textContent, /开聊|暂无/);
  for (const id of ['hub-real-today', 'hub-real-panic', 'hub-real-routines', 'hub-real-meetings', 'hub-real-rules']) {
    assert(env.more.has(id), id);
  }
  assert.deepEqual(env.toasts, []);
});

test('六个新面板碰到网络异常或坏返回也是暂无', async () => {
  const errors = [];
  const onError = error => errors.push(error);
  process.on('unhandledRejection', onError);
  try {
    for (const answer of [() => { throw Error('offline'); },
      () => ({ ok: true, status: 200, json: async () => { throw Error('json'); } }),
      () => response('坏'), () => response({ items: '坏', state: '坏', minutes: 3 })]) {
      const env = fixture(answer);
      for (const id of ['hub-real-today', 'hub-real-panic', 'hub-real-routines', 'hub-real-meetings',
        'hub-real-rules']) {
        const host = new Node('div');
        await env.panels.get(id).render(host);
        assert.match(host.textContent, /暂无/, id);
      }
      await tick();
      assert.deepEqual(env.toasts, []);
    }
    assert.deepEqual(errors, []);
  } finally {
    process.off('unhandledRejection', onError);
  }
});

test('演示模式下新入口一个请求也不发', async () => {
  const env = fixture(missing, { mode: 'demo' });
  await tick();
  for (const id of ['hub-real-today', 'hub-real-panic', 'hub-real-routines', 'hub-real-meetings', 'hub-real-rules']) {
    const host = new Node('div');
    await env.panels.get(id).render(host);
    assert.match(host.textContent, /演示模式/);
  }
  assert.equal(env.paths().filter(p => /panic|routines|meetings|today|rules|fulltext/.test(p)).length, 0);
  assert.equal(env.ctx.HubRealR28.banner(), null);
});

test('今天页：后端文字原样当文本，没数据的段写暂无', async () => {
  htmlWrites.length = 0;
  const body = { date: '2026-11-18',
    approvals: { available: true, cards: [{ assistant: 'a', title: '<img src=x onerror=alert(1)>' }], kbDrafts: [] },
    waiting: { available: false },
    yesterdayDone: { available: true, byAssistant: [] },
    yesterdayUsage: { available: false },
    lastEveningMinutes: { available: true, date: '2026-11-17', text: '<script>alert(1)</script>\n纪要', truncated: true },
    routines: { available: true, items: [] } };
  const env = fixture(path => path === '/bff/today' ? response(body) : missing());
  const host = new Node('div');
  await env.panels.get('hub-real-today').render(host);
  assert.match(host.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(host.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(host.all().some(n => ['img', 'script'].includes(n.tag)), false);
  assert.deepEqual(htmlWrites, []);
  const section = id => host.all().find(n => n.dataset.realToday === id);
  assert.match(section('waiting').textContent, /暂无/);
  assert.match(section('yesterdayDone' in {} ? 'x' : 'done').textContent, /暂无/);
  assert.match(section('usage').textContent, /暂无/);
  assert.match(section('minutes').textContent, /太长/);
});

test('一键全停：状态读不到时不画横幅，没停全时醒目列出哪一步没停', async () => {
  let status = { status: 200, data: { ok: true, state: 'running', steps: {}, live: {} } };
  const env = fixture(path => path === '/bff/panic/status' ? response(status.data, status.status) : missing());
  await tick();
  assert.equal(env.ctx.HubRealR28.panic().state, 'running');
  assert.equal(env.ctx.HubRealR28.banner(), null);
  status = { status: 200, data: partial };
  await env.ctx.HubRealR28.refreshPanic();
  const banner = env.ctx.HubRealR28.banner();
  assert.equal(banner.attrs.role, 'alert');
  assert.equal(banner.hidden, false);
  assert.equal(banner.dataset.state, 'partial');
  assert.match(banner.textContent, /没停全/);
  assert.match(banner.textContent, /固定任务定时（超时了）/);
  assert.match(banner.textContent, /在跑的会话（<b>还有 1 个<\/b>）/);
  assert.equal(banner.all().some(n => n.tag === 'b'), false);
  const actions = banner.all().filter(n => n.tag === 'button').map(n => n.dataset.realR28);
  assert.deepEqual(actions, ['panic-stop', 'panic-resume', 'open-panel']);
  // 短暂读不到（断网、500）不能把「没停全」的横幅清掉
  status = { status: 500, data: {} };
  await env.ctx.HubRealR28.refreshPanic();
  assert.equal(env.ctx.HubRealR28.panic().state, 'partial');
  assert.equal(banner.hidden, false);
  status = { status: 200, data: { ok: true, state: 'stopped', reason: '备注', steps: {}, live: {} } };
  await env.ctx.HubRealR28.refreshPanic();
  assert.equal(banner.dataset.state, 'stopped');
  assert.match(banner.textContent, /已一键全停/);
  status = { status: 200, data: { ok: true, state: 'running', steps: {}, live: {} } };
  await env.ctx.HubRealR28.refreshPanic();
  assert.equal(banner.hidden, true);
});

test('一键全停：要点两下才发；返回 503 没停全也如实显示，连不上不当成已停', async () => {
  let stopReply = { status: 503, data: partial };
  const env = fixture((path, options) => {
    if (path === '/bff/panic/status') return response({ ok: true, state: 'running', steps: {}, live: {} });
    if (path === '/bff/panic/stop' && options.method === 'POST') return response(stopReply.data, stopReply.status);
    return missing();
  });
  await tick();
  const host = new Node('div');
  await env.panels.get('hub-real-panic').render(host);
  const button = host.all().find(n => n.dataset.realR28 === 'panic-stop');
  assert(button, '运行中应有一键全停按钮');
  assert.equal(await env.click(button), true);
  assert.equal(env.paths().some(p => p === 'POST /bff/panic/stop'), false, '第一下只上膛');
  assert.match(button.textContent, /再点一下/);
  await env.click(button);
  assert(env.paths().includes('POST /bff/panic/stop'));
  const sent = env.calls.find(c => c.path === '/bff/panic/stop');
  assert.deepEqual(JSON.parse(sent.body), { reason: '从手机上点的' });
  assert.equal(env.ctx.HubRealR28.panic().state, 'partial');
  assert.match(env.toasts.at(-1), /没停全：固定任务定时、在跑的会话/);
  assert.match(env.ctx.HubRealR28.banner().textContent, /没停全/);
  // 完全连不上：不能说「已停」，提示按没停处理
  stopReply = { status: 0, data: null };
  const env2 = fixture((path, options) => {
    if (path === '/bff/panic/stop') throw new Error('offline');
    return path === '/bff/panic/status' ? response({ ok: true, state: 'running', steps: {}, live: {} }) : missing();
  });
  await tick();
  const host2 = new Node('div');
  await env2.panels.get('hub-real-panic').render(host2);
  const button2 = host2.all().find(n => n.dataset.realR28 === 'panic-stop');
  await env2.click(button2);
  await env2.click(button2);
  assert.match(env2.toasts.at(-1), /状态不明/);
  assert.equal(env2.ctx.HubRealR28.panic().state, 'running');
});

test('一键全停：恢复也要点两下，用的是 resume', async () => {
  const env = fixture((path, options) => {
    if (path === '/bff/panic/status') return response({ ok: true, state: 'stopped', steps: {}, live: {} });
    if (path === '/bff/panic/resume' && options.method === 'POST') {
      return response({ ok: true, state: 'running', steps: {}, live: {} });
    }
    return missing();
  });
  await tick();
  const banner = env.ctx.HubRealR28.banner();
  assert.equal(banner.dataset.state, 'stopped');
  const resume = banner.all().find(n => n.dataset.realR28 === 'panic-resume');
  await env.click(resume);
  assert.equal(env.paths().includes('POST /bff/panic/resume'), false);
  await env.click(resume);
  assert(env.paths().includes('POST /bff/panic/resume'));
  assert.equal(env.ctx.HubRealR28.panic().state, 'running');
  assert.equal(banner.hidden, true);
  assert.equal(env.toasts.at(-1), '已恢复');
});

test('固定任务：看列表、暂停、手动跑一次（点两下），id 不合规矩的行没有按钮', async () => {
  const routines = { paused: false, enabled: true, items: [
    { id: 'daily-post', name: '日更', assistant: 'a', at: '07:30', days: 'daily', todayState: 'pending',
      done: '<b>放好了</b>' },
    { id: '坏 id', name: '坏的', assistant: 'a', at: '08:00', days: 'daily' }], invalid: [] };
  const env = fixture((path, options) => {
    if (path === '/bff/routines' && options.method !== 'POST') return response(routines);
    if (path === '/bff/routines/daily-post/run') return response({ state: 'reported', ticket: 'T-1' });
    if (path === '/bff/routines/daily-post/pause') return response({ state: 'paused', id: 'daily-post' });
    if (path === '/bff/routines/pause') return response({ state: 'paused', id: null });
    return missing();
  });
  await tick();
  const host = new Node('div');
  await env.panels.get('hub-real-routines').render(host);
  assert.match(host.textContent, /日更/);
  assert.match(host.textContent, /<b>放好了<\/b>/);
  assert.equal(host.all().some(n => n.tag === 'b'), false);
  const rows = host.all().filter(n => n.dataset.realRoutineRow !== undefined);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].all().filter(n => n.tag === 'button').length, 0);
  const run = rows[0].all().find(n => n.dataset.realR28 === 'routine-run');
  await env.click(run);
  assert.equal(env.paths().some(p => /routines\/daily-post\/run/.test(p)), false);
  await env.click(run);
  assert(env.paths().includes('POST /bff/routines/daily-post/run'));
  assert.match(env.toasts.at(-1), /已经跑了一次/);
  const pause = rows[0].all().find(n => n.dataset.realR28 === 'routine-pause');
  await env.click(pause);
  assert(env.paths().includes('POST /bff/routines/daily-post/pause'));
  assert.equal(env.toasts.at(-1), '已暂停');
  const all = host.all().find(n => n.dataset.realR28 === 'routines-pause-all');
  await env.click(all);
  assert(env.paths().includes('POST /bff/routines/pause'));
  // 伪造的 id 不会发请求
  const forged = fakeButton({ 'data-real-r28': 'routine-pause', 'data-real-id': '../panic/stop' });
  const before = env.paths().length;
  await env.click(forged);
  assert.equal(env.paths().length, before);
});

test('固定任务：已一键全停时不让手动跑', async () => {
  const env = fixture((path, options) => {
    if (path === '/bff/panic/status') return response({ ok: true, state: 'stopped', steps: {}, live: {} });
    if (path === '/bff/routines') return response({ items: [{ id: 'daily-post', name: '日更', todayState: 'pending' }] });
    return missing();
  });
  await tick();
  const host = new Node('div');
  await env.panels.get('hub-real-routines').render(host);
  const run = host.all().find(n => n.dataset.realR28 === 'routine-run');
  assert.equal(run.disabled, true);
  const direct = fakeButton({ 'data-real-r28': 'routine-run', 'data-real-id': 'daily-post' });
  await env.click(direct);
  await env.click(direct);
  assert.equal(env.paths().some(p => /\/run$/.test(p)), false);
  assert.match(env.toasts.at(-1), /先恢复/);
});

test('晨会晚会：看纪要（文字当文本）、前一天、开晚会', async () => {
  const env = fixture((path, options) => {
    if (path === '/bff/meetings/status') return response({ times: { morning: '09:00', evening: '21:00' },
      today: { morning: false, evening: true }, running: [], pendingCount: 0 });
    if (path === '/bff/meetings/today') return response({ date: '2026-11-18', minutes: [
      { type: 'evening', file: '/某/路径/晚会.md', text: '<img src=x onerror=alert(1)>\n要点' }] });
    if (path.startsWith('/bff/meetings/minutes?date=2026-11-17&type=evening')) {
      return response({ date: '2026-11-17', type: 'evening', file: '/x', text: '昨天的晚会' });
    }
    if (path.startsWith('/bff/meetings/minutes')) return missing();
    if (path === '/bff/meetings/run' && options.method === 'POST') return response({ file: 'x', cards: [] });
    return missing();
  });
  await tick();
  const host = new Node('div');
  await env.panels.get('hub-real-meetings').render(host);
  assert.match(host.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(host.textContent.includes('某/路径'), false);
  assert.equal(host.all().some(n => n.tag === 'img'), false);
  const prev = host.all().find(n => n.dataset.realR28 === 'meeting-day');
  assert.equal(prev.dataset.realDate, '2026-11-17');
  await env.click(prev);
  await tick();
  assert.match(host.textContent, /昨天的晚会/);
  const run = host.all().find(n => n.dataset.realR28 === 'meeting-run-evening');
  await env.click(run);
  assert.equal(env.paths().includes('POST /bff/meetings/run'), false);
  await env.click(run);
  assert(env.paths().includes('POST /bff/meetings/run'));
  const sent = env.calls.find(c => c.path === '/bff/meetings/run');
  assert.deepEqual(JSON.parse(sent.body), { type: 'evening' });
  assert.match(env.toasts.at(-1), /晚会开完了/);
});

test('晨会晚会：一键全停时不开晚会；超时不当成失败', async () => {
  const env = fixture((path, options) => {
    if (path === '/bff/panic/status') return response({ ok: true, state: 'stopped', steps: {}, live: {} });
    if (path === '/bff/meetings/status') return response({ times: {}, today: {}, running: [], pendingCount: 0 });
    if (path === '/bff/meetings/today') return response({ date: '2026-11-18', minutes: [] });
    return missing();
  });
  await tick();
  const host = new Node('div');
  await env.panels.get('hub-real-meetings').render(host);
  assert.match(host.textContent, /这一天暂无纪要/);
  const run = host.all().find(n => n.dataset.realR28 === 'meeting-run-evening');
  assert.equal(run.disabled, true);
  const direct = fakeButton({ 'data-real-r28': 'meeting-run-evening' });
  await env.click(direct);
  await env.click(direct);
  assert.equal(env.paths().includes('POST /bff/meetings/run'), false);
  assert.match(env.toasts.at(-1), /先恢复/);
  const slow = fixture((path, options) => {
    if (path === '/bff/meetings/run') throw new Error('abort');
    if (path === '/bff/meetings/status') return response({ times: {}, today: {}, running: [], pendingCount: 0 });
    if (path === '/bff/meetings/today') return response({ date: '2026-11-18', minutes: [] });
    return missing();
  });
  await tick();
  const slowHost = new Node('div');
  await slow.panels.get('hub-real-meetings').render(slowHost);
  const go = slowHost.all().find(n => n.dataset.realR28 === 'meeting-run-evening');
  await slow.click(go);
  await slow.click(go);
  assert.match(slow.toasts.at(-1), /还在开/);
});

test('规矩页：只读，文字当文本；没有读取接口时是暂无', async () => {
  const env = fixture(path => path === '/bff/rules' ? response({
    shared: ['- 2026-11-17 长稿给小文「<script>x</script>」'],
    bots: [{ id: 'a', lines: ['- 2026-11-17 写稿先问「先问」'] }] }) : missing());
  const host = new Node('div');
  await env.panels.get('hub-real-rules').render(host);
  assert.match(host.textContent, /<script>x<\/script>/);
  assert.equal(host.all().some(n => n.tag === 'script'), false);
  assert.match(host.textContent, /只读/);
  assert.equal(host.all().some(n => n.tag === 'button' || n.tag === 'textarea' || n.tag === 'input'), false);
  assert.equal(env.paths().some(p => /^(POST|PUT|PATCH|DELETE) /.test(p)), false);
});

test('选模型：标题旁的入口只有开关开着时出现；选了就带进建会话请求', async () => {
  const view = enabled => ({ ...(enabled === undefined ? {} : { enabled }), default: 'a/x', options: [
    { ref: 'a/x', name: '甲', selectable: true }, { ref: 'bad/model', name: '丙', selectable: true }] });
  const env = fixture((path, options) => {
    if (path === '/bff/models/bots/chief') return response(view(true));
    if (path === '/bff/sessions' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.model === 'bad/model') return response({ error: { code: 'MODEL_OFFLINE', message: '这个模型不在线' } }, 409);
      return response({ id: 'remote-1', bot: body.bot, model: body.model ?? null }, 201);
    }
    return missing();
  });
  const api = env.ctx.HubRealR28;
  const r = api.record('chief');
  const title = new Node('div');
  api.models.set('chief', view(false));
  api.paintModelChip(title, r);
  assert.equal(title.querySelector('.hub-real-model-chip'), null, '开关关着不显示');
  api.models.set('chief', view(undefined));
  api.paintModelChip(title, r);
  assert.equal(title.querySelector('.hub-real-model-chip'), null, '后端没说开关就当关着');
  api.models.set('chief', view(true));
  api.paintModelChip(title, r);
  const chip = title.querySelector('.hub-real-model-chip');
  assert.equal(chip.dataset.realR28, 'model-open');
  assert.equal(chip.textContent, '模型：默认 ›');
  // 开聊以后（已有远端会话）不再显示
  api.paintModelChip(title, { ...r, remote: 'x' });
  assert.equal(title.querySelector('.hub-real-model-chip'), null);
  // 点入口、选一个
  env.H.state.conversation = r.local;
  await env.click(fakeButton({ 'data-real-r28': 'model-open' }));
  assert(env.calls.includes('open:hub-real-model'));
  const panel = new Node('div');
  await env.panels.get('hub-real-model').render(panel);
  assert.equal(panel.all().filter(n => n.dataset.realR28 === 'model-pick').length, 3);
  await env.click(fakeButton({ 'data-real-r28': 'model-pick', 'data-real-ref': 'not/in/list' }));
  assert.equal(api.picked(r.local), '');
  await env.click(fakeButton({ 'data-real-r28': 'model-pick', 'data-real-ref': 'a/x' }));
  assert.equal(api.picked(r.local), 'a/x');
  const again = new Node('div');
  api.paintModelChip(again, r);
  assert.equal(again.querySelector('.hub-real-model-chip').textContent, '模型：甲 ›');
  const created = await api.createRemote(r, 'chief');
  assert.equal(created.id, 'remote-1');
  const post = env.calls.filter(c => c.path === '/bff/sessions' && c.method === 'POST').at(-1);
  assert.deepEqual(JSON.parse(post.body), { bot: 'chief', model: 'a/x' });
  assert.equal(r.modelName, '甲');
  assert.equal(api.picked(r.local), '');
  // 没选：请求里没有 model 字段（走原来的路）
  const r2 = api.record('chief');
  await api.createRemote(r2, 'chief');
  assert.deepEqual(JSON.parse(env.calls.filter(c => c.path === '/bff/sessions' && c.method === 'POST').at(-1).body),
    { bot: 'chief' });
  // 选的模型建不出来：把原因告诉用户，不偷偷换别的
  env.H.state.conversation = r2.local;
  await env.click(fakeButton({ 'data-real-r28': 'model-open' }));
  await env.click(fakeButton({ 'data-real-r28': 'model-pick', 'data-real-ref': 'bad/model' }));
  await assert.rejects(() => api.createRemote(r2, 'chief'));
  assert.match(env.toasts.at(-1), /这个模型不在线/);
  const posts = env.calls.filter(c => c.path === '/bff/sessions' && c.method === 'POST');
  assert.equal(posts.length, 3, '失败后没有再换默认模型重试');
});

test('确认卡：外包工单用摘要加看全文，字当文本，批准的按钮是派出去/先不', async () => {
  const text = '<b>摘要</b> 前面一段';
  const full = '完整任务书\n<img src=x onerror=alert(1)>\n后面很长很长';
  const digest = createHash('sha256').update(full, 'utf8').digest('hex');
  const env = fixture(path => path === '/bff/fulltext/' + digest ? response({ digest, text: full }) : missing(),
    { crypto: globalThis.crypto });
  const card = { type: 'approval', id: 'confirm-1', confirm: true, tool: 'confirm', kind: 'dispatch', bot: 'chief',
    title: '派给外部工人：<i>codex</i>', text, fullText: digest, status: 'pending', sessionId: 's1',
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
    choices: [{ id: 'approve', label: '派出去' }, { id: 'approve-always', label: '以后这类不用问' },
      { id: 'reject', label: '先不' }] };
  const root = env.cards.get('hub-real-approval').render(card);
  assert.match(root.textContent, /派给外部工人：<i>codex<\/i>/);
  assert.match(root.textContent, /<b>摘要<\/b> 前面一段/);
  assert.doesNotMatch(root.textContent, /写入一份文件|字数/);
  assert.equal(root.all().some(n => ['b', 'i', 'img'].includes(n.tag)), false);
  const answers = root.all().filter(n => n.dataset.realAnswer !== undefined);
  assert.deepEqual(answers.map(n => [n.textContent, n.dataset.realAnswer]), [['派出去', 'approve'], ['先不', 'reject']]);
  assert.match(root.textContent, new RegExp(digest.slice(0, 8)));
  const open = root.all().find(n => n.dataset.realR28 === 'fulltext');
  assert.equal(open.textContent, '看全文');
  assert.equal(open.dataset.realDigest, digest);
  await env.click(open);
  assert(env.paths().includes('GET /bff/fulltext/' + digest));
  const shown = env.ctx.HubRealR28.fullTextBlock(card);
  assert.match(shown.textContent, /完整任务书/);
  assert.match(shown.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(shown.all().some(n => n.tag === 'img'), false);
  assert.match(shown.textContent, /在本机重算过，一致/);
  assert.match(shown.textContent, /收起全文/);
  await env.click(open);
  assert.match(env.ctx.HubRealR28.fullTextBlock(card).textContent, /看全文/);
});

test('看全文：校验码对不上、全文不存在、卡上没有或校验和写法不对', async () => {
  const wrong = 'b'.repeat(64);
  const env = fixture(path => path === '/bff/fulltext/' + wrong ? response({ digest: wrong, text: '被改过的全文' }) :
    path.startsWith('/bff/fulltext/') ? response({ error: {} }, 404) : missing(), { crypto: globalThis.crypto });
  const api = env.ctx.HubRealR28;
  assert.equal(api.fullTextBlock({ confirm: true }), null);
  assert.equal(api.fullTextBlock({ fullText: '../../etc/passwd' }), null);
  assert.equal(api.fullTextBlock({ fullText: wrong.toUpperCase() }), null);
  await env.click(fakeButton({ 'data-real-r28': 'fulltext', 'data-real-digest': wrong }));
  const bad = api.fullTextBlock({ fullText: wrong });
  assert.match(bad.textContent, /对不上，请不要批准/);
  assert.doesNotMatch(bad.textContent, /被改过的全文/);
  const none = 'c'.repeat(64);
  await env.click(fakeButton({ 'data-real-r28': 'fulltext', 'data-real-digest': none }));
  assert.match(api.fullTextBlock({ fullText: none }).textContent, /不存在，或被改动过，请不要批准/);
  // 伪造的校验和不发请求
  const before = env.paths().length;
  await env.click(fakeButton({ 'data-real-r28': 'fulltext', 'data-real-digest': '../x' }));
  assert.equal(env.paths().length, before);
});

test('已有三类确认卡的渲染不受影响，没有校验和的卡没有看全文', () => {
  const env = fixture(missing);
  const card = { type: 'approval', id: 'c1', confirm: true, tool: 'group_create', bot: 'chief', title: '拉组',
    text: '做什么：x', status: 'pending', sessionId: 's', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), choices: [{ id: 'approve' }, { id: 'reject' }] };
  const root = env.cards.get('hub-real-approval').render(card);
  assert.equal(root.all().some(n => n.dataset.realR28 === 'fulltext'), false);
  assert.deepEqual(root.all().filter(n => n.dataset.realAnswer !== undefined).map(n => n.dataset.realAnswer),
    ['approve', 'reject'], '确认类卡后端不认「改一下」，不给这个按钮');
  const withFull = env.cards.get('hub-real-approval').render({ ...card, fullText: 'd'.repeat(64) });
  assert(withFull.all().some(n => n.dataset.realR28 === 'fulltext'));
});

test('「改一下」：确认类卡（后端永远回 400）一律没有；非确认的审批卡仍有', () => {
  const env = fixture(missing);
  const base = { type: 'approval', bot: 'chief', status: 'pending', sessionId: 's', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const answers = card => env.cards.get('hub-real-approval').render(card).all()
    .filter(n => n.dataset.realAnswer !== undefined).map(n => n.dataset.realAnswer);
  const choices = [{ id: 'approve' }, { id: 'reject' }];
  for (const tool of ['group_create', 'meeting_card', 'kb_write']) {
    const got = answers({ ...base, id: 'c-' + tool, confirm: true, tool, title: '确认', text: 'x', choices });
    assert.equal(got.includes('edit'), false, tool);
    assert.deepEqual(got, ['approve', 'reject'], tool);
  }
  const bash = answers({ ...base, id: 'b1', tool: 'bash', action: '跑命令', command: 'ls', cwd: '/tmp', preview: 'ls' });
  assert.deepEqual(bash, ['approve', 'reject', 'edit']);
});

async function webFixture() {
  const root = process.env.HUB_WEB_TEST_TMP || join(process.cwd(), 'test', 'scratch');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'r28-'));
  const shell = join(dir, 'shell');
  await mkdir(shell);
  await writeFile(join(shell, 'index.html'), '<html><body>离线壳</body></html>');
  await writeFile(join(dir, 'web.key'), 'web-test', { mode: 0o600 });
  await writeFile(join(dir, 'bff.key'), 'bff-test', { mode: 0o600 });
  const received = [];
  const fake = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, path: req.url });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  const { createHubWeb } = await import('../server.mjs');
  const web = await createHubWeb({ HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
    HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'),
    BFF_URL: `http://127.0.0.1:${fake.address().port}` }, { log: () => assert.fail('unexpected log') });
  const url = `http://127.0.0.1:${web.servers[0].address().port}`;
  const login = await fetch(`${url}/?key=web-test`, { redirect: 'manual' });
  return { url, cookie: login.headers.get('set-cookie').split(';')[0], received,
    async close() { await web.close(); await new Promise(resolve => fake.close(resolve)); } };
}

test('网页层：规矩页只读，长对话只放行明确的写操作，dispatch 仍不转发', async () => {
  const { READONLY_EXT_PREFIXES, EXT_PREFIXES } = await import('../server.mjs');
  assert.deepEqual(READONLY_EXT_PREFIXES, ['rules', 'threads']);
  assert.equal(EXT_PREFIXES.includes('rules'), false);
  assert.equal(EXT_PREFIXES.includes('dispatch'), false);
  const web = await webFixture();
  try {
    const ok = await fetch(`${web.url}/bff/rules`, { headers: { cookie: web.cookie } });
    assert.equal(ok.status, 200);
    assert.equal(web.received.at(-1).path, '/rules');
    assert.equal((await fetch(`${web.url}/bff/rules/a?x=1`, { headers: { cookie: web.cookie } })).status, 200);
    assert.equal(web.received.at(-1).path, '/rules/a?x=1');
    const thread = await fetch(`${web.url}/bff/threads/aa?before=cursor&limit=40`, {
      headers: { cookie: web.cookie },
    });
    assert.equal(thread.status, 200);
    assert.equal(web.received.at(-1).path, '/threads/aa?before=cursor&limit=40');
    const before = web.received.length;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${web.url}/bff/rules/a`, { method, body: '{}',
        headers: { cookie: web.cookie, origin: web.url, 'content-type': 'application/json' } });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get('allow'), 'GET, HEAD');
      const threadWrite = await fetch(`${web.url}/bff/threads/aa/read`, { method, body: '{}',
        headers: { cookie: web.cookie, origin: web.url, 'content-type': 'application/json' } });
      assert.equal(threadWrite.status, 405, 'threads ' + method);
      assert.equal(threadWrite.headers.get('allow'), 'GET, HEAD');
    }
    assert.equal(web.received.length, before);
    const writes = [['POST', 'send'], ['POST', 'send/request-a/hold'], ['POST', 'send/request-a/cancel'],
      ['POST', 'reassign'], ['PATCH', 'topics/s-a'], ['POST', 'topics/s-a/merge'], ['POST', 'topics/s-a/unmerge']];
    for (const [method, route] of writes) {
      const path = '/threads/aa/' + route;
      const headers = { cookie: web.cookie, origin: web.url, 'content-type': 'application/json' };
      assert.equal((await fetch(web.url + '/bff' + path, { method, body: '{}', headers })).status, 200);
      assert.deepEqual(web.received.at(-1), { method, path });
    }
    const sent = web.received.length;
    const denied = await fetch(web.url + '/bff/threads/aa/send', { method: 'POST', body: '{}',
      headers: { cookie: web.cookie, origin: 'http://localhost:1', 'content-type': 'application/json' } });
    assert.equal(denied.status, 403);
    assert.equal(web.received.length, sent);
    // 没登录的读取仍然被拒
    assert.equal((await fetch(`${web.url}/bff/rules`)).status === 200, false);
    // 全文与全停走原来的代理路径
    assert.equal((await fetch(`${web.url}/bff/fulltext/${'a'.repeat(64)}`,
      { headers: { cookie: web.cookie } })).status, 200);
    assert.equal(web.received.at(-1).path, `/bff/fulltext/${'a'.repeat(64)}`);
    assert.equal((await fetch(`${web.url}/bff/panic/status`, { headers: { cookie: web.cookie } })).status, 200);
    assert.equal(web.received.at(-1).path, '/panic/status');
  } finally {
    await web.close();
  }
});
