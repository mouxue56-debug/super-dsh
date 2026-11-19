import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const f = require('../hub-real.js');
const { environment } = require('./dom-double.cjs');
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');

class Node {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.isConnected = true;
    this.value = '';
    this.listeners = {};
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.clientHeight = 0;
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key.startsWith('data-')) {
        this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
    }
    this.append(...(Array.isArray(children) ? children : [children]));
  }

  append(...children) {
    this.children.push(...children.filter(c => c != null));
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  get textContent() {
    return this.children.map(c => typeof c === 'object' ? c.textContent : String(c)).join('');
  }

  set textContent(value) {
    this.children = [String(value)];
  }

  set innerHTML(value) {
    this.children = [String(value)];
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  querySelectorAll(selector) {
    const all = this.children.flatMap(c => c instanceof Node ? [c, ...c.querySelectorAll('*')] : []);
    if (selector === '*') return all;
    if (selector.startsWith('.')) return all.filter(n => (n.attrs.class || '').split(' ').includes(selector.slice(1)));
    if (selector === '[data-real-open]') return all.filter(n => n.dataset.realOpen);
    return [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  setAttribute() {}
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
}

function fixture(respond, mode = 'real', visible = false) {
  const { ctx, listeners } = environment();
  ctx.document.hidden = !visible;
  const panels = new Map();
  const more = new Map();
  const cards = new Map();
  const calls = [];
  const toasts = [];
  const H = ctx.Hub;
  H.h = (tag, attrs, children) => new Node(tag, attrs, children);
  H.registerPanel = (id, spec) => panels.set(id, spec);
  H.registerCard = (id, spec) => cards.set(id, spec);
  H.registerMoreItem = item => more.set(item.id, item);
  H.toast = text => toasts.push(text);
  H.openPanel = () => {};
  H.avatar = bot => H.h('span', {}, bot);
  H.botStyle = () => '';
  ctx.localStorage.getItem = () => mode === 'demo' ? 'demo' : null;
  ctx.fetch = async (path, options) => {
    calls.push(path);
    return respond(path, options);
  };
  ctx.crypto = { randomUUID: () => 'test-id' };
  vm.runInContext(source, ctx);
  return { ctx, H, panels, more, cards, calls, toasts, listeners };
}

const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const missing = () => response({}, 404);

test('工单列与卡片', () => {
  assert.equal(f.isLegacyTicket(null), false);
  assert.equal(f.isLegacyTicket({ id: 'old' }), true);
  assert.equal(f.isLegacyTicket({ id: 'T-1', legacy: true }), true);
  assert.equal(f.isLegacyTicket({ id: 'T-1' }), false);
  for (const [state, expected] of Object.entries({
    failed: 'failed', completed: 'done', blocked: 'attention', 'waiting-human': 'attention',
    'waiting-timeout': 'attention', uncertain: 'attention', queued: 'queued', progress: 'progress'
  })) assert.equal(f.boardColumn({ state }), expected);
  assert.equal(f.boardColumn({ review: 'submitted' }), 'review');
  assert.equal(f.boardColumn(null), 'queued');
  assert.equal(f.boardColumns(null).length, 6);
  const columns = f.boardColumns([{ id: 'T-1' }, { id: 'T-2', updatedAt: '2026-01-01' }, null]);
  assert.equal(columns[0].tickets[0].id, 'T-2');
  assert.equal(columns[0].count, 2);
  assert.equal(f.boardCardInfo(null).title, '（无标题）');
  assert.equal(f.boardCardInfo({ id: 'old', hop: -1 }).hop, 0);
  assert.match(f.boardCardInfo({ from: { name: 'a' }, claimedBy: 'b' }, x => x.toUpperCase()).who, /发起 A/);
});

test('用量与费用', () => {
  for (const v of [null, undefined, NaN, -1]) assert.equal(f.formatTokenCount(v), '未知');
  assert.equal(f.formatTokenCount(0), '0');
  assert.equal(f.formatTokenCount(1234), '1,234');
  assert.equal(f.formatTokenCount(12345), '1.2 万');
  assert.equal(f.formatTokenCount(100000), '10 万');
  assert.equal(f.bucketTokens(null).known, false);
  assert.equal(f.bucketTokens({ calls: 0 }).known, false);
  const fields = Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'].map(k => [k, 2]));
  const unknown = { calls: 2, tokens: {}, unreportedFields: fields };
  assert.equal(f.bucketTokens(unknown).total, null);
  assert.match(f.usageLine(unknown), /未知 token/);
  assert.equal(f.bucketTokens({ calls: 1, tokens: { input: 23 } }).total, 23);
  assert.deepEqual(f.bucketCost(null), []);
  assert.deepEqual(f.bucketCost({ calls: 1 }), ['费用未知']);
  assert.deepEqual(f.bucketCost({ calls: 2, cost: { byCurrency: { USD: { ok: 0.001, expired: 0.5 } } } }),
    ['$<0.01', '价表过期 $0.50']);
  assert.equal(f.usageLine(null), '本会话用量暂无');
  assert.equal(f.usageLine({ calls: 0 }), '本会话还没有模型调用');
  assert.equal(f.ledgerRows(null).length, 0);
  const rows = f.ledgerRows({ a: unknown, '(无助理)': { calls: 1, tokens: { input: 5 } } });
  assert.equal(rows[0].label, '未归助理');
  assert.equal(rows[1].tokens, '未知');
  assert.equal(f.ledgerRows({ a: unknown }, x => x, 0).length, 0);
});

test('讨论组与确认卡', () => {
  assert.deepEqual(f.normalizeGroups(null), []);
  assert.equal(f.normalizeGroups([{ id: 'x', status: 'bad' }])[0].status, 'active');
  assert.equal(f.normalizeGroups({ groups: [{ id: 'x', members: ['a'] }] })[0].members[0].bot, 'a');
  assert.deepEqual(f.normalizeGroupMessages(null), []);
  assert.equal(f.normalizeGroupMessages([{ text: '' }]).length, 0);
  assert.equal(f.normalizeGroupMessages([{ text: 'x', seq: 2 }, { text: 'y', seq: 1 }])[0].text, 'y');
  assert.equal(f.plainCardInfo({ tool: 'bash' }), null);
  assert.equal(f.plainCardInfo({ tool: 'write' }), null);
  assert.equal(f.plainCardInfo({ tool: 'group_create', grantable: true }).rememberable, false);
  assert.equal(f.plainCardInfo({ tool: 'kb_submit', rememberable: true }).rememberable, true);
  assert.match(f.plainCardInfo({ tool: 'meeting_morning' }).title, /晨会/);
  assert.equal(f.modelLabelFor(null, 'a'), '');
  assert.equal(f.modelLabelFor({ models: [], defaults: { a: 'm' } }, 'a'), '');
  assert.equal(f.modelLabelFor({ models: [{ id: 'm', label: '模型', online: false }],
    defaults: { a: 'm' } }, 'a'), '模型（不在线）');
});

test('面板注册与 404 降级', async () => {
  const env = fixture(missing);
  for (const id of ['hub-real-board', 'hub-real-ledger', 'hub-real-group', 'hub-real-group-page']) {
    assert(env.panels.has(id));
    const host = new Node('div');
    await env.panels.get(id).render(host);
    assert.match(host.textContent, /暂无/);
  }
  assert(env.more.has('hub-real-board'));
  assert(env.more.has('hub-real-ledger'));
  assert.deepEqual(env.toasts, []);
});

test('看板异常与成功', async () => {
  for (const answer of [() => { throw Error('network'); }, () => ({ ok: true, json: async () => {
    throw Error('json');
  } }), () => response({ tickets: '坏' })]) {
    const env = fixture(answer);
    const host = new Node('div');
    await env.panels.get('hub-real-board').render(host);
    assert.match(host.textContent, /暂无/);
    assert.deepEqual(env.toasts, []);
  }
  const tickets = [{ id: 'T-1', state: 'progress', title: '一' },
    { id: 'old', state: 'completed', title: '二' }, { id: 'T-3', title: '三' }];
  const env = fixture(path => path.includes('/board') ? response({ tickets }) : missing());
  const host = new Node('div');
  await env.panels.get('hub-real-board').render(host);
  assert.match(host.textContent, /在做/);
  assert.match(host.textContent, /旧/);
  assert.doesNotMatch(host.textContent, /拖|提交/);
  const empty = fixture(path => path.includes('/board') ? response({ tickets: [] }) : missing());
  const blank = new Node('div');
  await empty.panels.get('hub-real-board').render(blank);
  assert.match(blank.textContent, /现在没有工单/);
});

test('账本未知用量', async () => {
  const fields = Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'].map(k => [k, 1]));
  const bucket = { calls: 1, tokens: {}, unreportedFields: fields };
  const env = fixture(path => path === '/bff/ledger' ? response({ total: bucket, byBot: { a: bucket } }) : missing());
  const host = new Node('div');
  await env.panels.get('hub-real-ledger').render(host);
  const row = host.querySelectorAll('.hub-real-lrow')[0];
  assert.match(row.textContent, /未知 token/);
  assert.doesNotMatch(row.textContent, /0 token/);
});

test('演示模式隔离', async () => {
  const env = fixture(missing, 'demo');
  for (const panel of env.panels.values()) {
    if (['看板', '账本', '讨论组', '项目页'].includes(panel.title)) await panel.render(new Node('div'));
  }
  assert.equal(env.calls.filter(path => /\/bff\/(board|ledger|groups|models)/.test(path)).length, 0);
});

test('讨论组消息名牌、空消息及发送失败', async () => {
  let payload = { messages: [
    { id: '1', seq: 1, from: 'helper', text: '你好' },
    { id: '2', seq: 2, from: 'owner', text: '我说' },
    { id: '3', seq: 3, from: 'system', text: '提示' }
  ] };
  const env = fixture((path, options) => {
    if (options?.method === 'POST') return missing();
    if (path === '/bff/groups') return response({ groups: [{ id: 'g', title: '测试' }] });
    if (path.startsWith('/bff/groups/g?after=')) return response(payload);
    return missing();
  });
  await new Promise(resolve => setImmediate(resolve));
  const handler = env.listeners.get('click')[0];
  const button = { dataset: { realGroup: 'g' }, closest: () => null, hasAttribute: () => false };
  const event = { target: { closest: () => button }, preventDefault() {}, stopImmediatePropagation() {} };
  handler(event);
  const host = new Node('div');
  await env.panels.get('hub-real-group').render(host);
  const names = host.querySelectorAll('*').filter(n => n.dataset.nameplateBot);
  assert.equal(names.length, 1);
  assert.equal(names[0].dataset.nameplateBot, 'helper');
  const input = host.querySelectorAll('*').find(n => n.tag === 'textarea');
  const send = host.querySelectorAll('*').find(n => n.dataset.realGroupSend);
  input.value = '没有发出';
  await send.listeners.click({ preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(input.value, '没有发出');
  assert.deepEqual(env.toasts, ['这句没发出去，请再试一次']);
  payload = { messages: [] };
  const empty = new Node('div');
  await env.panels.get('hub-real-group').render(empty);
  assert.match(empty.textContent, /还没有人说话/);
});


test('扩展接口失败不改变健康连接状态', async () => {
  const env = fixture(path => {
    if (path === '/bff/bots') return response({ bots: [] });
    if (path === '/bff/health') return response({ ok: true, dsh: { connected: true } });
    if (path === '/bff/status') return response({ bots: {} });
    if (path === '/bff/sessions') return response({ sessions: [] });
    return missing();
  }, 'real', true);
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.ctx.HubReal.state().online, true);
  await env.panels.get('hub-real-board').render(new Node('div'));
  await env.panels.get('hub-real-ledger').render(new Node('div'));
  assert.equal(env.ctx.HubReal.state().online, true);
});

test('扩展读取失败没有未处理的拒绝', async () => {
  const errors = [];
  const onError = error => errors.push(error);
  process.on('unhandledRejection', onError);
  try {
    const env = fixture(() => { throw Error('offline'); });
    for (const id of ['hub-real-board', 'hub-real-ledger', 'hub-real-group', 'hub-real-group-page']) {
      const host = new Node('div');
      await env.panels.get(id).render(host);
      assert.match(host.textContent, /暂无/);
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(errors, []);
    assert.deepEqual(env.toasts, []);
  } finally {
    process.off('unhandledRejection', onError);
  }
});

test('路5/路7 对齐：知识库卡按 kind 识别并认 approve-always，模型读 /models/bots 形状', () => {
  const card = { kind: 'kb-submit', bot: 'chief', what: '记一条', where: '知识库', why: '可复用',
    actions: [{ id: 'approve' }, { id: 'approve-always' }, { id: 'reject' }] };
  const info = f.plainCardInfo(card);
  assert.equal(info.kind, 'kb');
  assert.equal(info.rememberable, true);
  assert.deepEqual(info.rows.map(r => r[0]), ['做什么', '在哪做', '为什么']);
  assert.equal(f.plainCardInfo({ kind: 'kb-submit', actions: [{ id: 'approve' }] }).rememberable, false);
  const data = { default: 'a/x', options: [{ ref: 'a/x', name: '模型甲', available: true }] };
  assert.equal(f.modelLabelFor(data, 'bot'), '模型甲');
  data.options[0].available = false;
  assert.equal(f.modelLabelFor(data, 'bot'), '模型甲（不在线）');
  assert.equal(f.modelLabelFor({ default: 'zzz', options: [] }, 'bot'), '');
});
