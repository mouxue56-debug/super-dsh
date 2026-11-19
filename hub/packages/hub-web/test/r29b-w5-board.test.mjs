import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const f = createRequire(import.meta.url)('../hub-real.js');
const nameOf = id => ({ alpha: '甲', beta: '乙', gamma: '丙' })[id] || id;
const lineOf = ticket => f.boardCardInfo(ticket, nameOf).line;
const detail = (ticket, label) => f.boardCardInfo(ticket, nameOf).detail.find(row => row.label === label).text;

test('四句人话按阶段走，候选人不算接手', () => {
  const from = { name: 'alpha', type: 'assistant' };
  assert.equal(lineOf({ from, to: ['beta'], claimedBy: null, state: 'queued', review: 'none' }), '甲请乙帮忙');
  assert.equal(lineOf({
    from, to: ['beta'], claimedBy: 'beta', claimedByType: 'assistant', state: 'progress', review: 'none'
  }), '乙已接手');
  assert.equal(lineOf({
    from, to: ['beta'], claimedBy: 'beta', claimedByType: 'assistant', state: 'progress', review: 'submitted'
  }), '乙交回，等甲看');
  assert.equal(lineOf({
    from, claimedBy: 'beta', claimedByType: 'assistant', state: 'completed', review: 'accepted'
  }), '甲已验收');
  const many = f.boardCardInfo({ from, to: ['beta', 'gamma'], claimedBy: null, state: 'progress' }, nameOf);
  assert.equal(many.line, '甲发出，还没人领');
  assert.equal(many.line.includes('已接手'), false);
  assert.match(detail({ from, to: ['beta', 'gamma'], claimedBy: null }, '没验的'), /候选还没接手：乙、丙/);
  assert.equal(many.faces.some(person => person.id === 'beta'), false);
});

test('无人领、退回、缺来源、外部成员', () => {
  const from = { name: 'alpha', type: 'assistant' };
  assert.equal(lineOf({ from, to: [], claimedBy: null }), '甲发出，还没人领');
  assert.equal(lineOf({ to: [], claimedBy: null }), '还没人领');
  assert.equal(lineOf({ to: ['beta'], claimedBy: null }), '请乙帮忙');
  assert.equal(lineOf({
    from, claimedBy: 'beta', claimedByType: 'assistant', state: 'progress', review: 'sent_back'
  }), '甲退回，等乙再做');
  assert.match(detail({
    from, claimedBy: 'beta', review: 'sent_back', state: 'progress'
  }, '没验的'), /退回之后还没再交/);
  const ext = f.boardCardInfo({
    from, claimedBy: 'exttool', claimedByType: 'external', state: 'progress', review: 'none'
  }, nameOf);
  assert.equal(ext.line, '外部 · exttool已接手');
  assert.equal(ext.faces.some(person => person.id === 'exttool'), false);
  const blank = f.boardCardInfo({
    id: 'old', claimedBy: 'beta', claimedByType: 'assistant', state: 'progress'
  }, nameOf);
  assert.equal(blank.line, '乙已接手');
  assert.equal(blank.line.includes('甲'), false);
  assert.equal(blank.faces.some(person => person.role === 'from'), false);
});

test('点开有摘要、怎么验的、没验的；验收不借接手人的脸', () => {
  const from = { name: 'alpha', type: 'assistant' };
  const ticket = {
    from, claimedBy: 'beta', claimedByType: 'assistant', state: 'completed', review: 'accepted',
    goal: '<img src=x>',
    report: { summary: '两版差在交期', selfReported: true },
    verification: [{ by: 'alpha', verdict: 'pass', note: '对过交期' }],
    acceptance: [{ check: '日期', expect: '周五' }]
  };
  const info = f.boardCardInfo(ticket, nameOf);
  assert.equal(info.line, '甲已验收');
  assert.deepEqual(info.faces.map(person => person.id), ['alpha']);
  assert.deepEqual(info.detail.map(row => row.label), ['摘要', '怎么验的', '没验的']);
  assert.match(info.detail[0].text, /两版差在交期/);
  assert.match(info.detail[0].text, /交回时自己写的/);
  assert.equal(info.detail[0].text.includes('<img'), false);
  assert.match(info.detail[1].text, /甲 · 通过 · 对过交期/);
  assert.match(info.detail[2].text, /日期（应是 周五）/);
  const failed = f.boardCardInfo({
    from, claimedBy: 'beta', state: 'progress', review: 'none',
    verification: [{ by: 'alpha', verdict: 'partial', note: '差一处' }]
  }, nameOf);
  assert.match(failed.detail[1].text, /部分通过/);
  assert.match(failed.detail[2].text, /最近一次没全部过：差一处/);
  assert.equal(detail({ from, claimedBy: 'beta', state: 'progress' }, '怎么验的'), '还没有核验记录');
  assert.equal(detail({}, '摘要'), '没有');
});

test('旧字段仍在，缺来源的老单不编发起人', () => {
  assert.equal(f.boardCardInfo(null).title, '（无标题）');
  assert.equal(f.boardCardInfo({ id: 'old', hop: -1 }).hop, 0);
  assert.equal(f.boardCardInfo({ id: 'old', hop: -1 }).line, '还没人领');
  assert.match(f.boardCardInfo({ from: { name: 'a' }, claimedBy: 'b' }, x => x.toUpperCase()).who, /发起 A/);
  assert.equal(f.boardCardInfo({ id: 'old-ticket', from: { name: 'chief' } }).legacy, true);
  const done = f.boardCardInfo({
    state: 'completed', review: 'none', from: { name: 'alpha', type: 'assistant' }
  }, nameOf);
  assert.equal(done.line, '已标完成');
  assert.equal(done.faces.length, 0);
});

test('画脸只走名册和头像钩子，工单文字不拼进页面代码', () => {
  const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
  const start = source.indexOf('function boardFaceNode');
  const end = source.indexOf('function renderLedger');
  assert.ok(start > 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /person\.type === 'external'/);
  assert.match(body, /S\.bots/);
  assert.match(body, /HubAvatars/);
  assert.match(body, /api\.html\(person\.id, 28\)/);
  assert.match(body, /H\.h\('span', \{\}, info\.line/);
  assert.doesNotMatch(body, /innerHTML|insertAdjacentHTML|info\.line \+/);
});

class FaceNode {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs || {};
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.append(...(Array.isArray(children) ? children : [children]));
  }

  append(...children) {
    this.children.push(...children.filter(child => child != null && child !== false));
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  get textContent() {
    return this.children.map(child => typeof child === 'object' ? child.textContent : String(child)).join('');
  }
}

function walk(node, acc = []) {
  if (!(node instanceof FaceNode)) return acc;
  acc.push(node);
  for (const child of node.children) walk(child, acc);
  return acc;
}

test('真数据卡片画出人话，外部成员不调用头像', async () => {
  const { environment } = createRequire(import.meta.url)('./dom-double.cjs');
  const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
  const { ctx } = environment();
  const panels = new Map();
  const faces = [];
  const H = ctx.Hub;
  H.h = (tag, attrs, children) => new FaceNode(tag, attrs, children);
  H.registerPanel = (id, spec) => panels.set(id, spec);
  H.registerCard = () => {};
  H.registerMoreItem = () => {};
  H.toast = () => {};
  H.openPanel = () => {};
  H.avatar = () => H.h('span');
  H.botStyle = () => '';
  H.fromHTML = html => new FaceNode('i', { class: 'face' }, [String(html)]);
  ctx.localStorage.getItem = () => null;
  ctx.crypto = { randomUUID: () => 'test-id' };
  ctx.HubAvatars = {
    html(id, px) {
      faces.push([id, px]);
      return '<span data-r29-avatar="' + id + '"></span>';
    }
  };
  const tickets = [
    {
      id: 'T-1', title: '<img src=x>', state: 'queued', review: 'none', goal: '把摘要写清',
      from: { name: 'alpha', type: 'assistant' }, to: ['beta'], claimedBy: null
    },
    {
      id: 'T-2', title: '外部的单', state: 'progress', review: 'none',
      from: { name: 'alpha', type: 'assistant' }, claimedBy: 'exttool', claimedByType: 'external'
    }
  ];
  ctx.fetch = async path => String(path).includes('/board/tickets')
    ? { ok: true, status: 200, json: async () => ({ tickets }) }
    : { ok: false, status: 404, json: async () => ({}) };
  vm.runInContext(source, ctx);
  H.state.bots = [{ id: 'alpha', name: '甲' }, { id: 'beta', name: '乙' }];
  const host = new FaceNode('div');
  await panels.get('hub-real-board').render(host);
  assert.match(host.textContent, /甲请乙帮忙/);
  assert.match(host.textContent, /外部 · exttool已接手/);
  assert.match(host.textContent, /摘要：把摘要写清/);
  assert.match(host.textContent, /怎么验的：还没有核验记录/);
  assert.match(host.textContent, /没验的：/);
  assert.match(host.textContent, /<img src=x>/);
  assert.equal(walk(host).some(node => node.tag === 'img'), false);
  assert.deepEqual(faces, [['alpha', 28], ['beta', 28]]);
  assert.equal(host.textContent.includes('发起'), false);
});
