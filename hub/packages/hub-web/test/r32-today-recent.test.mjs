// 今天页「刚刚发生的」来自后端真记录，刷新（重新画）后还在。只验适配层，不起服务。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const f = require('../hub-real.js');
const { environment } = require('./dom-double.cjs');
const source = await readFile(new URL('../hub-real.js', import.meta.url), 'utf8');

class Node {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs || {};
    this.children = [];
    this.dataset = {};
    this.isConnected = true;
    for (const [key, value] of Object.entries(this.attrs)) {
      if (!key.startsWith('data-')) continue;
      const name = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[name] = value;
    }
    this.append(...(Array.isArray(children) ? children : [children]));
  }

  append(...children) {
    for (const child of children.filter(item => item != null)) {
      if (child instanceof Node) child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  get textContent() {
    return this.children.map(child => (
      typeof child === 'object' ? child.textContent : String(child)
    )).join('');
  }

  all() {
    return this.children.flatMap(child => (child instanceof Node ? [child, ...child.all()] : []));
  }
}

const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => data,
});

function mount(respond) {
  const { ctx } = environment();
  ctx.document.hidden = true;
  const panels = new Map();
  const opened = [];
  const H = ctx.Hub;
  H.h = (tag, attrs, children) => new Node(tag, attrs, children);
  H.registerPanel = (id, spec) => panels.set(id, spec);
  H.registerMoreItem = () => {};
  H.openPanel = id => { opened.push(id); };
  H.toast = () => {};
  ctx.localStorage.getItem = () => null;
  ctx.fetch = async path => respond(path);
  ctx.crypto = { randomUUID: () => 'test-id' };
  ctx.TextEncoder = TextEncoder;
  vm.runInContext(source, ctx);
  return { panels, opened };
}


function mountWithR30(respond, mounts) {
  const { ctx } = environment();
  ctx.document.hidden = true;
  const panels = new Map();
  const H = ctx.Hub;
  H.h = (tag, attrs, children) => new Node(tag, attrs, children);
  H.registerPanel = (id, spec) => panels.set(id, spec);
  H.registerMoreItem = () => {};
  H.openPanel = () => {};
  H.toast = () => {};
  ctx.localStorage.getItem = () => null;
  ctx.fetch = async path => respond(path);
  ctx.crypto = { randomUUID: () => 'test-id' };
  ctx.TextEncoder = TextEncoder;
  // 界面壳的卡片版今天：这里只收下适配层交给它的整理结果。
  ctx.R30LT = {
    normalizeToday: () => ({ source: 'real', date: '2030-01-08', waiting: { available: true, items: [] },
      doing: { available: true, items: [] }, done: { available: true, items: [] },
      routines: { available: true, items: [], paused: false } }),
    mountToday: (_host, model) => { mounts.push(model); }
  };
  vm.runInContext(source, ctx);
  return { panels };
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve));
}
const todayData = { date: '2030-01-08', headline: { status: 'clear', text: '今天没有等你处理的事' },
  checkedResults: { available: true, items: [] },
  approvals: { available: true, cardsSource: 'live', cards: [], kbDrafts: [], count: 0 },
  waiting: { available: true, waitingAnswer: [], blocked: [], awaitingReview: [], counts: {} },
  yesterdayDone: { available: true, byAssistant: [] }, yesterdayUsage: { available: true, byAssistant: [] },
  lastEveningMinutes: { available: true, text: '' }, routines: { available: true, items: [] } };

test('刚刚发生的取自后端 /today/recent，最近 20 条，新开一次页面（刷新）仍在', async () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ kind: 'card', id: 'c' + i, bot: 'pm', name: '项目经理',
    title: '确认 ' + i, state: '已批准', at: new Date(Date.UTC(2030, 0, 8, 1, i)).toISOString() }));
  const mounts = [];
  const seen = [];
  const { panels } = mountWithR30((path) => {
    seen.push(path);
    if (path === '/bff/today') return response(todayData);
    if (path === '/bff/today/recent') return response({ items, sources: { cards: true, tickets: true } });
    if (path === '/bff/board/tickets') return response({ tickets: [] });
    return response({}, 404);
  }, mounts);
  for (let round = 0; round < 2; round += 1) {
    await panels.get('hub-real-today').render(new Node('div'));
    await settle();
  }
  assert.equal(mounts.length, 2);
  for (const model of mounts) {
    assert.equal(model.recent.length, 20);
    assert.equal(model.recent[0].title, '确认 24');
    assert.equal(model.recent[0].state, '已批准');
    assert.equal(model.recent[0].name, '项目经理');
  }
  assert.ok(seen.includes('/bff/today/recent'));
});

test('老后端没有这个接口时退回本页见过的卡，不报错也不编', async () => {
  const mounts = [];
  const { panels } = mountWithR30((path) => {
    if (path === '/bff/today') return response(todayData);
    if (path === '/bff/board/tickets') return response({ tickets: [] });
    return response({}, 404);
  }, mounts);
  await panels.get('hub-real-today').render(new Node('div'));
  await settle();
  assert.equal(mounts.length, 1);
  assert.equal(mounts[0].recent.length, 0);
});
