import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { environment } = require('./dom-double.cjs');
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');

// 模拟卡片和面板需要的节点。
class Node {
  // 创建节点。
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

  // 追加子节点。
  append(...children) {
    this.children.push(...children.filter(c => c != null));
  }

  // 替换子节点。
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  // 读取纯文本。
  get textContent() {
    return this.children.map(c => typeof c === 'object' ? c.textContent : String(c)).join('');
  }

  // 设置纯文本。
  set textContent(value) {
    this.children = [String(value)];
  }

  // 禁止通过 HTML 写入。
  set innerHTML(value) {
    throw Error('不允许写入 HTML');
  }

  // 登记事件。
  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  // 查找节点。
  querySelectorAll(selector) {
    const all = this.children.flatMap(c => c instanceof Node ? [c, ...c.querySelectorAll('*')] : []);
    if (selector === '*') return all;
    if (selector.startsWith('.')) return all.filter(n => (n.attrs.class || '').split(' ').includes(selector.slice(1)));
    if (selector === '[data-real-open]') return all.filter(n => n.dataset.realOpen);
    return [];
  }

  // 查找首个节点。
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  // 模拟属性。
  setAttribute() {}
  // 检查属性。
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
}

// 创建隔离的网页适配层测试环境。
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

// 创建接口响应。
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
// 模拟接口不可用。
const missing = () => response({}, 404);

const group = {
  id: 'g', name: '测试组', status: 'active', host: 'a',
  members: [{ id: 'a', name: '甲', role: '主持' }, { id: 'b', name: '乙', role: '成员' }]
};
const view = {
  group, page: '# 项目页\n<文本>', tickets: [], summary: '',
  messages: [{ id: 1, from: 'a', text: '<第一句>', ts: 1000 },
    { id: 2, from: 'b', text: '第二句', ts: 2000 }]
};

// 等待初始化请求完成并选中讨论组。
async function openGroup(env) {
  await new Promise(resolve => setImmediate(resolve));
  const button = { dataset: { realGroup: 'g' }, closest: () => null, hasAttribute: () => false };
  const event = { target: { closest: () => button }, preventDefault() {}, stopImmediatePropagation() {} };
  env.listeners.get('click')[0](event);
}

// 提供讨论组列表和详情的接口桩。
function groupResponse(path) {
  if (path === '/bff/groups') return response({ groups: [group] });
  if (path.startsWith('/bff/groups/g?after=')) return response(view);
  return missing();
}

test('组列表按真实摘要显示组名', async () => {
  const env = fixture(groupResponse);
  await openGroup(env);
  const host = new Node('div');
  await env.panels.get('hub-real-sessions').render(host);
  assert.match(host.textContent, /测试组/);
});

test('组详情携带游标并显示每位成员的名牌和纯文本', async () => {
  const env = fixture(groupResponse);
  await openGroup(env);
  const host = new Node('div');
  await env.panels.get('hub-real-group').render(host);
  assert(env.calls.includes('/bff/groups/g?after=0'));
  assert(!env.calls.some(path => /\/(messages|page)(?:\?|$)/.test(path)));
  const names = host.querySelectorAll('*').filter(n => n.dataset.nameplateBot);
  assert.deepEqual(names.map(n => n.textContent), ['甲', '乙']);
  assert.match(host.textContent, /<第一句>/);
});

test('主人发言使用真实请求体和幂等请求头', async () => {
  let sent;
  const env = fixture((path, options) => {
    if (options?.method === 'POST') {
      sent = { path, options };
      return response({});
    }
    return groupResponse(path);
  });
  await openGroup(env);
  const host = new Node('div');
  await env.panels.get('hub-real-group').render(host);
  const nodes = host.querySelectorAll('*');
  nodes.find(n => n.tag === 'textarea').value = '发言';
  await nodes.find(n => n.dataset.realGroupSend).listeners.click({
    preventDefault() {}, stopImmediatePropagation() {}
  });
  assert.equal(sent.path, '/bff/groups/g/messages');
  assert.deepEqual(JSON.parse(sent.options.body), { from: 'owner', text: '发言' });
  assert.equal(sent.options.headers['idempotency-key'], 'test-id');
});

test('项目页从组详情取得并以纯文本显示', async () => {
  const env = fixture(groupResponse);
  await openGroup(env);
  const host = new Node('div');
  await env.panels.get('hub-real-group-page').render(host);
  assert.match(host.textContent, /# 项目页\n<文本>/);
  assert(env.calls.includes('/bff/groups/g?after=0'));
  assert(!env.calls.some(path => path.includes('/page')));
});

test('分工卡显示三行和多行纯文本预览', () => {
  const env = fixture(missing);
  const card = { id: 'c', type: 'approval', status: 'pending', kind: 'group_plan',
    what: '做什么：任务', where: '在哪做：组里', why: '为什么：协作',
    bodyPreview: '第一单 <内容>\n第二单', actions: [{ id: 'approve' }, { id: 'reject' }] };
  const root = env.cards.get('hub-real-approval').render(card);
  const nodes = root.querySelectorAll('*');
  assert.deepEqual(nodes.filter(n => n.tag === 'dd').map(n => n.textContent), ['任务', '组里', '协作']);
  const preview = nodes.find(n => n.attrs.class === 'hub-real-plan');
  assert.equal(preview.textContent, '第一单 <内容>\n第二单');
  assert.match(preview.attrs.style, /pre-line/);
});

test('知识库确认卡提供以后这类不用问', () => {
  const env = fixture(missing);
  const card = { id: 'c', type: 'approval', status: 'pending', kind: 'kb-submit',
    choices: [{ id: 'approve' }, { id: 'approve-always' }, { id: 'reject' }] };
  const root = env.cards.get('hub-real-approval').render(card);
  assert(root.querySelectorAll('*').some(n => n.textContent === '以后这类不用问'));
});

test('演示模式不读取组和项目页', async () => {
  const env = fixture(groupResponse, 'demo');
  await env.panels.get('hub-real-group').render(new Node('div'));
  await env.panels.get('hub-real-group-page').render(new Node('div'));
  assert(!env.calls.some(path => path.startsWith('/bff/groups')));
});
