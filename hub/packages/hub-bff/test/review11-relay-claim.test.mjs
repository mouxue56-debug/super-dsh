import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoard } from '../lib/board.mjs';
import { createRelayWake } from '../lib/relay-wake.mjs';
import { createClaimWake } from '../lib/claim-wake.mjs';

const OWNER = { name: 'owner', type: 'owner' };
const CHIEF = { name: 'chief', type: 'assistant' };
const WRITER = { name: 'writer', type: 'assistant' };
const ART = { name: 'art', type: 'assistant' };
const minute = 60_000;

const work = (who, task) => ({ who, task });
const card = title => ({ title, goal: '准备读书会材料' });

async function boardFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'review11-board-'));
  let clock = Date.UTC(2026, 10, 19, 10);
  const now = () => clock;
  const board = createBoard({ root: join(dir, 'board'), now,
    reservedNames: ['owner', 'chief', 'writer', 'art'] });
  return { board, dir, now, advance: ms => { clock += ms; } };
}

async function wakeFixture(kind) {
  const fixture = await boardFixture();
  const { board, dir, now } = fixture;
  const roster = new Map([
    ['chief', { id: 'chief', status: 'active', role: 'chief' }],
    ['writer', { id: 'writer', status: 'active', role: 'bot' }],
    ['art', { id: 'art', status: 'active', role: 'bot' }],
  ]);
  const sessions = new Map();
  const sent = [];
  let nextError;
  const deps = {
    board, roster, now, stateFile: join(dir, kind + '-wake.json'), tickMs: 0,
    perBotMax: 1, perBotWindowMs: 10 * minute, logger: { error() {} },
    sessions: {
      list: () => [...sessions.values()],
      create: async bot => {
        const row = { id: 's-' + (sessions.size + 1), bot };
        sessions.set(row.id, row);
        return row;
      },
      send: async (id, message) => {
        if (nextError) {
          const error = nextError;
          nextError = undefined;
          throw error;
        }
        sent.push({ bot: sessions.get(id).bot, message });
      },
    },
  };
  const makeWake = kind === 'relay' ? createRelayWake : createClaimWake;
  const create = kind === 'relay'
    ? async title => (await board.relayCreate(OWNER, { ...card(title),
      steps: [work(WRITER, '写开场'), work(ART, '画配图')] })).ticket
    : title => board.openCreate(OWNER, card(title));
  return { ...fixture, create, makeWake: () => makeWake(deps), sent,
    failNextSend: () => { nextError = new Error('本地假会话暂时不可用'); } };
}

for (const [kind, label] of [['relay', '接力'], ['claim', '开放认领']]) {
  test(`R11-001 ${label}叫醒暂时发送失败时应补发一次`, async () => {
    const h = await wakeFixture(kind);
    const ticket = await h.create('准备资料');
    const wake = h.makeWake();
    h.failNextSend();
    await wake.onEvent({ id: ticket.id, type: 'created' });
    await wake.drain();
    assert.equal(h.sent.length, 0);

    h.advance(10 * minute);
    await wake.resume();
    await wake.resume();
    assert.equal(h.sent.length, 1, '暂时失败的叫醒恢复后应送达一次');
    assert.ok(h.sent[0].message.includes(ticket.id));
  });

  test(`R11-002 ${label}叫醒重启后仍遵守同一限频窗口`, async () => {
    const h = await wakeFixture(kind);
    const first = await h.create('先准备讲稿');
    let wake = h.makeWake();
    await wake.resume();
    assert.deepEqual(h.sent.map(row => row.message.includes(first.id)), [true]);

    h.advance(minute);
    const second = await h.create('再准备讲义');
    await wake.resume();
    assert.equal(h.sent.length, 1, '重启前第二张应在队列里');
    await wake.stop();
    wake = h.makeWake();
    await wake.resume();
    assert.equal(h.sent.length, 1, '仍在限频窗口内，重启不应提前发送');

    h.advance(10 * minute);
    await wake.resume();
    assert.equal(h.sent.length, 2);
    assert.ok(h.sent[1].message.includes(second.id));
  });
}

test('R11-003 助理总验收退回最后一棒为主人的接力后，主人能重新放行', async () => {
  const { board, advance } = await boardFixture();
  const { ticket } = await board.relayCreate(CHIEF, { ...card('读书会讲稿'),
    steps: [work(WRITER, '写讲稿'), work(OWNER, '核对会场时间')] });
  advance(minute);
  await board.relayDeliver(WRITER, ticket.id, '讲稿已写好');
  advance(minute);
  const final = await board.relayRelease(OWNER, ticket.id, { note: '会场时间是周五下午' });
  assert.equal(final.relay.phase, 'final');
  advance(minute);
  await board.sendBack(CHIEF, ticket.id, '请再核对周五具体几点开场');
  const { ticket: returned } = await board.relaySync(ticket.id);
  assert.equal(returned.relay.steps[1].returnedNote, '请再核对周五具体几点开场');
  assert.deepEqual([returned.relay.phase, returned.state, returned.relay.steps[1].status],
    ['gate', 'waiting-human', 'gate'], '退回主人的这一棒应恢复为可放行的状态');
  const resubmitted = await board.relayRelease(OWNER, ticket.id, { note: '复核后确认下午两点开场' });
  assert.equal(resubmitted.relay.phase, 'final');
});

test('R11-004 当前接棒人更新进度后应撤下该棒已恢复的催办提醒', async () => {
  const h = await wakeFixture('relay');
  const ticket = await h.create('整理配图清单');
  const wake = h.makeWake();
  await wake.resume();
  h.advance(31 * minute);
  await wake.resume();
  assert.ok((await h.board.get(ticket.id)).relay.steps[0].stalledAt, '超时后确实出现提醒');

  await h.board.progress(WRITER, ticket.id, '开场第一段已经写完');
  await wake.resume();
  assert.equal((await h.board.get(ticket.id)).relay.steps[0].stalledAt, null,
    '已有实质进度，不能继续显示「没动静」');
  h.advance(31 * minute);
  await wake.resume();
  assert.ok((await h.board.get(ticket.id)).relay.steps[0].stalledAt, '重新满 30 分钟后才应该再次提醒');
});

test('R11-005 接力按同一幂等键重试时，后续路线发生变化应报冲突', async () => {
  const { board } = await boardFixture();
  const input = { ...card('制作读书会讲义'), key: 'booklet-creation',
    steps: [work(WRITER, '写讲稿'), work(ART, '画一张封面')] };
  const first = await board.relayCreate(OWNER, input);
  const retry = await board.relayCreate(OWNER, input);
  assert.deepEqual([retry.ticket.id, retry.deduped], [first.ticket.id, true]);

  await assert.rejects(() => board.relayCreate(OWNER, { ...input,
    steps: [input.steps[0], work(ART, '画封面和三张内页图')] }),
  { code: 'CONFLICT' }, '第二棒要求已变化，不能当成同一次原样重试');
});
