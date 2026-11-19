// W4：今天页首句只指一件。排序在 buildToday 里算，不改已有断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoard } from '../lib/board.mjs';
import { buildToday } from '../lib/today.mjs';

const me = name => ({ name, type: 'assistant' });
const will = { name: 'owner', type: 'owner' };
const CLEAR = '今天没有等你处理的事';
const UNREAD = '暂时读不到';

async function openBoard(clock) {
  const dir = await mkdtemp(join(tmpdir(), 'w4-today-'));
  return createBoard({ root: join(dir, 'board'), now: () => clock.t });
}

function deps(board, clock, extra = {}) {
  return {
    now: () => clock.t, board, logger: { error() {} },
    hubConfig: { routines: { utcOffsetMinutes: 540 } },
    roster: { list: () => [] },
    cards: { pending: () => [] },
    ...extra,
  };
}

async function ask(board, title, question) {
  const id = (await board.create(me('chief'), {
    title, goal: title + '的目标', to: ['writer'],
  })).id;
  await board.claim(me('writer'), id);
  await board.block(me('writer'), id, question, { waitHuman: true });
  return id;
}

test('两张标题一样的待答，首句只指等得更久的那件；答完换下一件', async () => {
  const clock = { t: Date.parse('2030-01-08T01:00:00Z') };
  const board = await openBoard(clock);
  const older = await ask(board, '报价稿', '按周五交？');
  clock.t = Date.parse('2030-01-08T02:00:00Z');
  const newer = await ask(board, '报价稿', '按周一交？');
  clock.t = Date.parse('2030-01-08T10:00:00Z');
  const first = await buildToday(deps(board, clock, {
    cards: { pending: () => [{ id: 'confirm-a', title: '报价稿', text: '先点头',
      createdAt: '2030-01-08T00:00:00.000Z' }] },
  }));
  assert.equal(first.headline.status, 'item');
  assert.equal(first.headline.kind, 'answer');
  assert.equal(first.headline.place, 'question');
  assert.equal(first.headline.id, older);
  assert.match(first.headline.text, /按周五交/);
  assert.doesNotMatch(first.headline.text, /按周一交/);
  assert.doesNotMatch(first.headline.text, /先点头/);
  assert.equal(first.waiting.counts.waitingAnswer, 2);
  await board.answer(will, older, '周五');
  const second = await buildToday(deps(board, clock));
  assert.equal(second.headline.id, newer);
  assert.match(second.headline.text, /按周一交/);
  assert.doesNotMatch(second.headline.text, /按周五交/);
});

test('没有待答时选更早的确认卡；两张标题一样就带上各自的话', async () => {
  const clock = { t: Date.parse('2030-01-08T10:00:00Z') };
  const board = await openBoard(clock);
  const today = await buildToday(deps(board, clock, {
    cards: { pending: () => [
      { id: 'confirm-old', title: '报价稿', text: '先看甲', createdAt: '2030-01-08T01:00:00.000Z' },
      { id: 'confirm-new', title: '报价稿', text: '先看乙', createdAt: '2030-01-08T02:00:00.000Z' },
    ] },
  }));
  assert.equal(today.headline.kind, 'approval');
  assert.equal(today.headline.place, 'card');
  assert.equal(today.headline.id, 'confirm-old');
  assert.match(today.headline.text, /先看甲/);
  assert.doesNotMatch(today.headline.text, /先看乙/);
});

test('没有待答和待点头时，等得最久的结果在前；处理完换下一件，都没有就说没事', async () => {
  const clock = { t: Date.parse('2030-01-08T03:00:00Z') };
  const board = await openBoard(clock);
  const submitted = (await board.create(me('chief'), {
    title: '只交回', goal: '交一版', to: ['writer'],
  })).id;
  await board.claim(me('writer'), submitted);
  await board.report(me('writer'), submitted, { summary: '还没验' });
  clock.t = Date.parse('2030-01-08T04:00:00Z');
  const checked = (await board.create(me('chief'), {
    title: '报价稿', goal: '交一版', to: ['writer'],
  })).id;
  await board.claim(me('writer'), checked);
  await board.report(me('writer'), checked, { summary: '自述' });
  await board.verify(me('chief'), checked, { verdict: 'pass', note: '差别在交期' });
  clock.t = Date.parse('2030-01-08T10:00:00Z');
  const today = await buildToday(deps(board, clock));
  assert.equal(today.headline.kind, 'verified');
  assert.equal(today.headline.place, 'result');
  assert.equal(today.headline.id, submitted);
  assert.match(today.headline.text, /等你看结果/);
  assert.match(today.headline.text, /还没验/);
  await board.accept(me('chief'), submitted);
  const after = await buildToday(deps(board, clock));
  assert.equal(after.headline.id, checked);
  assert.match(after.headline.text, /已验的结果/);
  assert.match(after.headline.text, /差别在交期/);
  await board.accept(me('chief'), checked);
  const none = await buildToday(deps(board, clock));
  assert.equal(none.headline.status, 'clear');
  assert.equal(none.headline.text, CLEAR);
  assert.equal(none.yesterdayUsage.available, false);
});

test('待答或待点头读不到时不报平安，也不改用更低一档', async () => {
  const clock = { t: Date.parse('2030-01-08T10:00:00Z') };
  const board = await openBoard(clock);
  const blind = await buildToday(deps(board, clock, {
    board: { list: async () => { throw new Error('boom'); } },
    cards: { pending: () => [{ id: 'confirm-a', title: '报价稿', text: '先点头',
      createdAt: '2030-01-08T01:00:00.000Z' }] },
  }));
  assert.equal(blind.headline.status, 'unread');
  assert.equal(blind.headline.text, UNREAD);
  assert.equal(blind.waiting.available, false);
  const noCards = await buildToday(deps(board, clock, { cards: { ask() {} } }));
  assert.equal(noCards.headline.status, 'unread');
  assert.notEqual(noCards.headline.text, CLEAR);
  const badShape = await buildToday(deps(board, clock, { cards: { pending: () => ({ cards: [] }) } }));
  assert.equal(badShape.headline.status, 'unread');
});

test('待答没有问题正文时仍指这件；缺编号就不改口说没事', async () => {
  const clock = { t: Date.parse('2030-01-08T10:00:00Z') };
  const board = await openBoard(clock);
  const quiet = await buildToday(deps(board, clock, {
    board: { list: async () => [{
      id: 'T-20300108-010000-abcd', title: '报价稿', state: 'waiting-human',
      updatedAt: '2030-01-08T01:00:00.000Z', open_ask: { text: '' }, history: [],
    }] },
    cards: { pending: () => [{ id: 'confirm-a', title: '报价稿', text: '先点头',
      createdAt: '2030-01-08T00:00:00.000Z' }] },
  }));
  assert.equal(quiet.headline.status, 'item');
  assert.equal(quiet.headline.kind, 'answer');
  assert.equal(quiet.headline.id, 'T-20300108-010000-abcd');
  assert.match(quiet.headline.text, /等你回答/);
  assert.doesNotMatch(quiet.headline.text, /先点头/);
  const nameless = await buildToday(deps(board, clock, {
    board: { list: async () => [{
      title: '报价稿', state: 'waiting-human', updatedAt: '2030-01-08T01:00:00.000Z',
      open_ask: { text: '问什么' }, history: [],
    }] },
  }));
  assert.equal(nameless.headline.status, 'unread');
  assert.equal(nameless.headline.text, UNREAD);
});
