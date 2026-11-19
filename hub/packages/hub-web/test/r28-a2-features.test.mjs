import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const f = require('../hub-real.js');

class Node {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs;
    this.children = [];
    this.isConnected = true;
    this.append(...(Array.isArray(children) ? children : [children]));
  }

  append(...items) {
    this.children.push(...items.filter(item => item != null));
  }

  replaceChildren(...items) {
    this.children = [];
    this.append(...items);
  }

  get textContent() {
    return this.children.map(item => item instanceof Node ? item.textContent : String(item)).join('');
  }
}

const h = (tag, attrs, children) => new Node(tag, attrs, children);
const data = {
  '/board/tickets': {tickets: [{id: 'x', title: '<b>x</b>', state: 'queued'}]},
  '/ledger': {total: {calls: 2, tokens: {input: 3, output: 4}, cost: {}}},
  '/ledger/today': {total: {calls: 2, tokens: {input: 3, output: 4}, cost: {}}},
  '/routines': {items: [{id: 'daily', name: '<b>x</b>', assistant: 'chief', days: 'daily'}]},
  '/meetings/status': {times: {morning: '09:00', evening: '21:00'}},
  '/meetings/today': {date: '2026-11-18', minutes: [{type: 'evening', title: '<b>x</b>'}]},
  '/grants': {grants: [{bot: 'chief', program: '<b>x</b>', until: '2026-12-01'}]}
};

function context(variant = 'data') {
  const get = async path => {
    if (variant === 'error') return {ok: false, status: 500};
    if (variant === 'empty') return {ok: false, status: 404};
    return {ok: true, status: 200, data: data[path]};
  };
  return {
    H: {h, navigate() {}, openPanel() {}},
    mode: () => 'real',
    extGet: (_key, path) => get(path),
    extCall: get,
    boardColumns: f.boardColumns,
    sortRecent: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
    bucketTokens: f.bucketTokens,
    bucketCost: f.bucketCost,
    formatTokenCount: f.formatTokenCount,
    routineView: f.routineView,
    meetingView: f.meetingView,
    displayName: id => id,
    pending: () => 2
  };
}

for (const id of ['board', 'ledger', 'schedule', 'permissions', 'memory', 'devices', 'connections']) {
  for (const kind of ['now', 'log']) {
    for (const variant of ['data', 'empty', 'error']) {
      test(id + ' ' + kind + ' ' + variant, async () => {
        const target = new Node('div');
        await f.fsRender(context(variant), id, kind, target);
        assert.ok(target.textContent.length);
        if (variant !== 'data' || ['memory', 'devices', 'connections'].includes(id)) {
          assert.match(target.textContent, /暂无/);
        }
        assert.ok(target.children.every(child => child instanceof Node));
        assert.ok(target.children.every(child => child.tag !== 'b'));
      });
    }
  }
}

test('后端文字只作为文本，权限和纪要日期可见', async () => {
  for (const [id, kind] of [['board', 'log'], ['schedule', 'now'], ['schedule', 'log'],
    ['permissions', 'log']]) {
    const target = new Node('div');
    await f.fsRender(context(), id, kind, target);
    assert.match(target.textContent, /<b>x<\/b>/);
    assert.ok(target.children.every(child => child.tag !== 'b'));
  }
  const target = new Node('div');
  await f.fsRender(context(), 'permissions', 'log', target);
  assert.match(target.textContent, /2026-12-01/);
});

test('旧壳初始化不注册、不碰状态', () => {
  const c = {H: {}, S: {}, mode: () => 'real'};
  assert.doesNotThrow(() => f.fsInit(c));
});

test('真实与演示切换恢复固定任务、待输入和活动', () => {
  let mode = 'demo';
  let style = null;
  global.document = {
    querySelector: () => style,
    createElement: () => ({
      setAttribute() {},
      remove() { style = null; }
    }),
    head: {append(node) { style = node; }}
  };
  const sections = [];
  const c = context();
  c.mode = () => mode;
  c.S = {fixedTasks: [{id: 'fixed'}], pendingInputs: [{id: 'pending'}],
    activities: [{id: 'demo-activity-x'}, {id: 'hub-real-x'}]};
  Object.assign(c.H, {
    registerFeatureSection: (id, spec) => sections.push({id, ...spec}),
    openFeature() {},
    featureOwner() {}
  });
  f.fsInit(c);
  assert.equal(style, null);
  assert.equal(c.S.fixedTasks.length, 1);
  const target = new Node('div');
  sections[0].render(target);
  assert.equal(target.hidden, true);
  mode = 'real';
  f.fsSync();
  assert.ok(style.textContent.includes('[data-feature-contribution]'));
  assert.equal(c.S.fixedTasks.length, 0);
  assert.equal(c.S.pendingInputs.length, 0);
  assert.deepEqual(c.S.activities.map(a => a.id), ['hub-real-x']);
  mode = 'demo';
  f.fsSync();
  assert.equal(style, null);
  assert.equal(c.S.fixedTasks[0].id, 'fixed');
  assert.equal(c.S.pendingInputs[0].id, 'pending');
  assert.equal(c.S.activities.length, 2);
  delete global.document;
});

test('接口形状错误显示暂无', async () => {
  const c = context();
  c.extGet = async () => ({ok: true, status: 200, data: {}});
  c.extCall = async () => ({status: 200, data: null});
  for (const [id, kind] of [['board', 'now'], ['board', 'log'], ['ledger', 'now'],
    ['ledger', 'log'], ['schedule', 'now'], ['schedule', 'log'], ['permissions', 'now'],
    ['permissions', 'log']]) {
    const target = new Node('div');
    await f.fsRender(c, id, kind, target);
    assert.match(target.textContent, /暂无/, id + ' ' + kind);
  }
});

test('真实数据产生指定的导航按钮', async () => {
  const calls = [];
  const c = context();
  c.H.navigate = value => calls.push(value.view);
  c.H.openPanel = value => calls.push(value);
  for (const id of ['board', 'ledger', 'schedule', 'permissions']) {
    const target = new Node('div');
    await f.fsRender(c, id, 'now', target);
    for (const button of target.children.filter(child => child.tag === 'button')) button.attrs.onClick();
  }
  assert.deepEqual(calls, ['kanban', 'ledger', 'hub-real-routines', 'hub-real-meetings',
    'hub-real-permissions']);
});
