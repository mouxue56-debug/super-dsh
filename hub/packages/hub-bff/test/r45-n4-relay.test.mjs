// 接力「另开一段会话」。同一位助理新开一段，不复用原来的接力会话。假会话，不叫本体。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { testDirectory } from './fixtures.mjs';
import { createBoard } from '../lib/board.mjs';
import { createRelayWake } from '../lib/relay-wake.mjs';
import { parseRoute } from '../lib/relay-model.mjs';

const CHIEF = { name: 'chief', type: 'assistant' };
const RESEARCH = { name: 'research', type: 'assistant' };
const step = (who, extra = {}) => ({ who, task: '做' + who.name + '这件事-任务原文', doneWhen: '交一份', ...extra });

async function harness({ create } = {}) {
  const dir = await testDirectory();
  const state = { clock: Date.UTC(2026, 10, 19, 10, 0) };
  const sent = [];
  const created = [];
  const known = new Map([['s-chief', 'chief']]);
  const roster = new Map(['chief', 'research'].map((id) => [id, { id, name: id, role: id === 'chief' ? 'chief' : 'bot', status: 'active' }]));
  const sessions = {
    list: () => [...known].map(([id, bot]) => ({ id, bot })),
    create: create ?? (async (bot, opts = {}) => {
      const id = 's-new-' + (created.length + 1);
      created.push({ bot, id, title: opts.title });
      known.set(id, bot);
      return { id };
    }),
    send: async (id, text) => { sent.push({ id, text, bot: known.get(id) }); },
  };
  let wake;
  const board = createBoard({ root: join(dir, 'board'), now: () => state.clock, onEvent: (ev) => wake?.onEvent(ev),
    reservedNames: () => ['owner', 'chief', 'research'] });
  wake = createRelayWake({ board, roster, sessions, stateFile: join(dir, 'relay-wake.json'), now: () => state.clock,
    isStopped: () => false, logger: { error() {} }, tickMs: 0, perTicketMs: 0 });
  const start = (steps, actor = CHIEF) => board.relayCreate(actor, { title: '另开会话', goal: '把事做完',
    key: 'k' + Math.random(), sessions: { from: 's-chief', to: '' }, steps }).then(r => r.ticket);
  const settle = async () => { await wake.drain(); await wake.flush(); await wake.drain(); };
  return { board, sent, created, known, start, settle, wake };
}

test('另开一段会话只适用于助理；普通第 1 棒是发起人自己时仍不另叫醒', async () => {
  assert.throws(() => parseRoute([step(RESEARCH), step({ name: 'owner', type: 'owner' }, { aside: true })]), /只适用于助理/u);
  const h = await harness();
  const own = await h.start([step(CHIEF), step(RESEARCH)]);
  await h.settle();
  assert.equal(h.created.length, 0, '发起人自己的第 1 棒不另开');
  assert.equal(own.relay.steps[0].aside, undefined);
});

test('另开一段会话：发起人自己的第 1 棒也会被叫醒，而且不复用原来的会话', async () => {
  const h = await harness();
  const ticket = await h.start([step(CHIEF, { aside: true }), step(RESEARCH)]);
  assert.equal(ticket.relay.steps[0].aside, true);
  await h.settle();
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].bot, 'chief');
  assert.match(h.created[0].title, /独立会话/u);
  assert.notEqual(h.sent[0].id, 's-chief');
  assert.match(h.sent[0].text, /另开一段会话/u);
  assert.doesNotMatch(h.sent[0].text, /任务原文/u);
  const again = await h.start([step(RESEARCH, { aside: true }), step(CHIEF)]);
  await h.settle();
  const researchSessions = h.created.filter(row => row.bot === 'research');
  assert.equal(researchSessions.length, 1);
  await h.board.relayDeliver(RESEARCH, again.id, '这一棒做完了');
  await h.settle();
  const shared = h.created.filter(row => row.bot === 'research');
  assert.equal(shared.length, 1, '同一位助理的下一次普通棒不该再开，这里下一棒是首席');
  assert.ok(h.created.some(row => row.bot === 'chief' && !/独立会话/u.test(row.title)));
});

test('同一位助理：独立会话和后面的普通棒各用各的会话', async () => {
  const h = await harness();
  const ticket = await h.start([step(RESEARCH, { aside: true }), step(RESEARCH)]);
  await h.settle();
  const first = h.sent.at(-1).id;
  await h.board.relayDeliver(RESEARCH, ticket.id, '独立这段做完了');
  await h.settle();
  const second = h.sent.at(-1).id;
  assert.notEqual(first, second);
  assert.equal(h.created.filter(row => row.bot === 'research').length, 2);
});

test('另开的会话反复打不开：这一棒标成卡住，不悄悄丢掉', async () => {
  const h = await harness({ create: async () => { throw new Error('打不开'); } });
  const ticket = await h.start([step(RESEARCH, { aside: true }), step(CHIEF)]);
  for (let i = 0; i < 8; i += 1) await h.settle();
  const stuck = await h.board.get(ticket.id);
  assert.equal(stuck.relay.phase, 'stuck');
  assert.equal(stuck.relay.steps[0].status, 'stuck');
  assert.match(stuck.open_ask.text, /另开的这段会话没能打开/u);
  assert.equal(h.sent.length, 1, '打不开之后只通知发起人原来的会话');
  assert.equal(h.sent[0].id, 's-chief');
  assert.match(h.sent[0].text, /卡住了/u);
  assert.doesNotMatch(h.sent[0].text, /任务原文/u);
});
