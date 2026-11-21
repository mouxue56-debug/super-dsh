'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');

const root = join(__dirname, '..');

function fixture(t, phase) {
  const dom = new JSDOM('<!doctype html><html data-hub-mode="real"><body></body></html>', {
    url: 'http://localhost/',
    runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperty(w.document, 'readyState', { value: 'complete' });
  w.setInterval = () => 1;
  w.clearInterval = () => {};
  w.fetch = () => { throw new Error('夹具禁止真实网络访问'); };
  w.eval(`
    var state = {mode: 'kanban', bots: [
      {id: 'chief', name: '首席', enabled: false},
      {id: 'research', name: '调研'},
      {id: 'writer', name: '写作'}
    ]};
    var Hub = {registerView() {}, on() {}};
    function botBy(id) { return state.bots.find(bot => bot.id === id); }
    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, char =>
        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
    }
  `);
  w.eval(readFileSync(join(root, 'js/views/board.js'), 'utf8'));
  w.eval(readFileSync(join(root, 'js/r32-relay.js'), 'utf8'));
  const ticket = {
    id: 'T-review11-normal-relay', title: '整理读书会安排', goal: '整理议程',
    from: {name: 'owner', type: 'owner'}, to: ['chief'],
    claimedBy: 'chief', claimedByType: 'assistant', state: 'waiting-human',
    relay: {phase, current: 0, steps: [
      {who: {name: 'chief', type: 'assistant'}, task: '整理议程', status: phase === 'gate' ? 'gate' : 'active'},
      {who: {name: 'writer', type: 'assistant'}, task: '润色议程', status: 'waiting'}
    ]}
  };
  w.r29DeskRows = [w.r29DeskFromTicket(ticket)];
  w.r30Sheet = {kind: 'full', id: ticket.id, flash: '', detail: false};
  w.r30SheetRender();
  return w;
}

test('R11-101 接力放行请求仍在途时，连续点击只提交一次', async (t) => {
  const w = fixture(t, 'gate');
  const calls = [];
  w.HubBoard = {
    relay(id, body) {
      calls.push({id, body});
      return new Promise(() => {});
    }
  };
  const button = w.document.querySelector('[data-r32-act="release"]');
  assert.ok(button, '夹具应进入正常接力放行操作单');
  button.click();
  button.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1, '同一次放行尚未返回，第二次点击应被合并或忽略');
});

test('R11-102 接力换人已选中的助理在正常看板刷新后仍然保留', (t) => {
  const w = fixture(t, 'halted');
  const select = w.document.querySelector('[name="r32who"]');
  assert.ok(select, '夹具应显示停用助理的换人下拉');
  assert.equal(select.options.length, 2);
  select.value = 'writer';
  select.dispatchEvent(new w.Event('change', {bubbles: true}));
  assert.equal(select.value, 'writer');
  w.r29DeskPaint();
  assert.equal(w.document.querySelector('[name="r32who"]').value, 'writer',
    '看板刷新不能把用户选中的写作助理恢复成首项调研助理');
});

test('R11-103 已卡住的外部任务身份失效后，今天页只列一项待处理任务', (t) => {
  const w = fixture(t, 'halted');
  w.eval(readFileSync(join(root, 'js/r30-ledger-today.js'), 'utf8'));
  w.eval(readFileSync(join(root, 'js/r35-claim.js'), 'utf8'));
  const id = 'T-review11-blocked-external';
  const raw = {
    date: '2026-11-19', utcOffsetMinutes: 540,
    approvals: {available: true, cards: [], kbDrafts: []},
    waiting: {available: true, waitingAnswer: [], awaitingReview: [], blocked: [
      {id, title: '整理读书会安排', assistant: 'codex', reason: '材料尚未齐全'}
    ]},
    externalLost: {available: true, items: [
      {id, title: '整理读书会安排', name: 'codex', reason: 'config'}
    ]}
  };
  const tickets = [{id, title: '整理读书会安排', state: 'blocked', claimedBy: 'codex', claimedByType: 'external'}];
  const model = w.R30LT.normalizeToday(raw, tickets, name => name);
  assert.equal(model.waiting.items.filter(item => item.id === id).length, 1,
    '同一任务的卡住状态与接单人失效应合并展示，不能把待处理任务数算成两件');
});
