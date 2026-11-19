// W4：今天页首句的排版和点开。只验适配层，不起服务。
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

const older = 'T-20300108-010000-aaa1';
const newer = 'T-20300108-020000-bbb2';

function todayBody(headline, extra = {}) {
  return {
    date: '2030-01-08',
    headline,
    checkedResults: { available: true, items: extra.results || [] },
    approvals: { available: true, cardsSource: 'live', cards: extra.cards || [], kbDrafts: [], count: 0 },
    waiting: {
      available: true,
      waitingAnswer: extra.answers || [],
      blocked: [], awaitingReview: [],
      counts: { blocked: 0, waitingAnswer: (extra.answers || []).length, awaitingReview: 0 },
    },
    yesterdayDone: { available: true, byAssistant: [] },
    yesterdayUsage: { available: true, byAssistant: [], total: { calls: 5, tokenTotal: 9,
      cost: { amounts: { USD: 1.5 }, label: '已计价' } } },
    lastEveningMinutes: { available: true, date: null, text: '' },
    routines: { available: true, items: [] },
  };
}

function leadOf(host) {
  return host.all().find(node => node.dataset.realTodayLead === 'item');
}

function targetOf(host) {
  return host.all().find(node => node.dataset.realTodayTarget);
}

async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve));
}

test('纯函数：缺首句或更高一档没读到，不说今天没事', () => {
  assert.equal(f.todayView(null), null);
  const missing = f.todayView({ date: '2030-01-08', waiting: { available: false },
    approvals: { available: true, cardsSource: 'live', cards: [], kbDrafts: [] },
    yesterdayDone: { available: true, byAssistant: [] },
    yesterdayUsage: { available: true, byAssistant: [] },
    lastEveningMinutes: { available: true, text: '' },
    routines: { available: true, items: [] },
    headline: { status: 'clear', text: '今天没有等你处理的事' } });
  assert.equal(missing.lead.text, '暂时读不到');
  assert.equal(missing.sections.length, 6);
  const pointed = f.todayView(todayBody({
    status: 'item', kind: 'answer', id: older, place: 'question', text: '等你回答「报价稿」：按周五交？',
  }, { answers: [
    { id: older, title: '报价稿', reason: '按周五交？' },
    { id: newer, title: '报价稿', reason: '按周一交？' },
  ] }));
  assert.equal(pointed.lead.id, older);
  assert.match(pointed.lead.text, /按周五交/);
  assert.doesNotMatch(pointed.lead.text, /按周一交/);
  const usage = pointed.sections.find(section => section.id === 'usage');
  assert.match(usage.lines.at(-1), /5 次调用/);
  const blank = f.todayView(todayBody(
    { status: 'clear', text: '今天没有等你处理的事' },
    { answers: [{ id: older, title: '报价稿', reason: '' }] },
  ));
  assert.equal(blank.lead.text, '暂时读不到');
});

test('点首句只打开这一张的问题；编号对不上就不显示另一张', async () => {
  const body = todayBody({
    status: 'item', kind: 'answer', id: older, place: 'question', text: '等你回答「报价稿」：按周五交？',
  }, { answers: [
    { id: older, title: '报价稿', reason: '按周五交？' },
    { id: newer, title: '报价稿', reason: '按周一交？' },
  ] });
  const tickets = {
    [older]: { id: older, title: '报价稿', open_ask: { text: '按周五交？' } },
    [newer]: { id: newer, title: '报价稿', open_ask: { text: '按周一交？' } },
  };
  let swap = false;
  const seen = [];
  const { panels } = mount(path => {
    seen.push(path);
    if (path === '/bff/today') return response(body);
    const match = /\/board\/tickets\/([^/?]+)$/.exec(path);
    if (!match) return response({}, 404);
    const id = decodeURIComponent(match[1]);
    const ticket = tickets[id];
    if (!ticket) return response({}, 404);
    return response({ ticket: swap ? { ...tickets[newer], id: newer } : ticket });
  });
  const host = new Node('div');
  await panels.get('hub-real-today').render(host);
  const button = leadOf(host);
  assert.match(button.textContent, /按周五交/);
  assert.doesNotMatch(button.textContent, /按周一交/);
  const waiting = host.all().find(node => node.dataset.realToday === 'waiting');
  assert.match(waiting.textContent, /按周一交/);
  button.attrs.onClick();
  await settle();
  assert.ok(seen.some(path => path.includes(older)));
  const hit = targetOf(host);
  assert.equal(hit.dataset.realTodayTarget, older);
  assert.match(hit.textContent, /这个问题/);
  assert.match(hit.textContent, /按周五交/);
  assert.doesNotMatch(hit.textContent, /按周一交/);
  swap = true;
  button.attrs.onClick();
  await settle();
  const missed = targetOf(host);
  assert.equal(missed, undefined);
  assert.match(host.textContent, /暂时读不到/);
  assert.equal(host.all().some(node => /按周一交/.test(node.textContent)
    && node.dataset.realTodayTarget), false);
});

test('点确认卡只打开这一张；取数失败写暂时读不到', async () => {
  const cardA = 'confirm-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const cardB = 'confirm-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const body = todayBody({
    status: 'item', kind: 'approval', id: cardA, place: 'card', text: '等你点头「报价稿」：先看甲',
  }, {
    cards: [
      { id: cardA, title: '报价稿', ask: '先看甲' },
      { id: cardB, title: '报价稿', ask: '先看乙' },
    ],
  });
  const { panels, opened } = mount(path => {
    if (path === '/bff/today') return response(body);
    if (path === '/bff/cards') {
      return response({ cards: [
        { id: cardA, title: '报价稿', text: '先看甲', type: 'approval', sessionId: '', bot: 'chief' },
        { id: cardB, title: '报价稿', text: '先看乙', type: 'approval', sessionId: '', bot: 'chief' },
      ] });
    }
    return response({}, 404);
  });
  const host = new Node('div');
  await panels.get('hub-real-today').render(host);
  leadOf(host).attrs.onClick();
  await settle();
  const hit = targetOf(host);
  assert.equal(hit.dataset.realTodayTarget, cardA);
  assert.match(hit.textContent, /这张确认卡/);
  assert.match(hit.textContent, /先看甲/);
  assert.doesNotMatch(hit.textContent, /先看乙/);
  assert.deepEqual(opened, []);
  const down = mount(() => response({}, 500));
  const empty = new Node('div');
  await down.panels.get('hub-real-today').render(empty);
  assert.match(empty.textContent, /暂时读不到/);
  assert.match(empty.textContent, /暂无/);
  assert.doesNotMatch(empty.textContent, /今天没有等你处理的事/);
});
