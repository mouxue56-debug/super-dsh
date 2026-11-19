import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { cardSummary, textDigest } from '../lib/fulltext.mjs';
import { ROSTER, fakeClock, planInput, tempDir } from './group-runtime-fixture.mjs';

function setup(sessions, extra = {}) {
  const dir = tempDir();
  const cards = [];
  const errors = [];
  const rt = createGroupRuntime({
    dataDir: dir,
    roster: ROSTER,
    now: fakeClock(),
    sessions,
    cards: { ask: (card) => {
      cards.push(card);
      return Promise.resolve(null);
    } },
    logger: { error: (value) => errors.push(value) },
    ...extra,
  });
  return { dir, rt, cards, errors };
}

function saved(dir, id) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'groups', id, 'group.json'), 'utf8'));
}

test('发起人的会话优先，卡归属发起人并持久化', async () => {
  const sessions = { list: () => [{ id: 'mine', bot: 'chief' }] };
  const { rt, dir, cards } = setup(sessions);
  const { group, card } = await rt.propose(planInput({ host: 'copy', session: 'mine' }));
  assert.equal(card.sessionId, 'mine');
  assert.equal(card.bot, 'chief');
  assert.equal(cards[0].sessionId, 'mine');
  assert.equal(saved(dir, group.id).cardSession, 'mine');
});

test('他人的会话被排除，选择主持最近的普通会话', async () => {
  const rows = [
    { id: 'other', bot: 'image', updatedAt: 9 },
    { id: 'old', bot: 'copy', updatedAt: 1 },
    { id: 'group', bot: 'copy', groupId: 'g', updatedAt: 8 },
    { id: 'indexed', bot: 'copy', updatedAt: 7 },
    { id: 'recent', bot: 'copy', updatedAt: 3 },
  ];
  const { rt } = setup({ list: () => rows }, { isGroupSession: (id) => id === 'indexed' });
  const { card } = await rt.propose(planInput({ host: 'copy', session: 'other' }));
  assert.equal(card.sessionId, 'recent');
  assert.equal(card.bot, 'copy');
});

test('无会话时创建，创建失败则保留空会话并记录错误', async () => {
  const calls = [];
  const sessions = { list: () => [], create: async (...args) => {
    calls.push(args);
    return { id: 'new' };
  } };
  const first = setup(sessions);
  const { card } = await first.rt.propose(planInput());
  assert.equal(card.sessionId, 'new');
  assert.deepEqual(calls, [['chief', { title: '讨论组分工表' }]]);
  const second = setup({ list: () => [], create: async () => { throw Error('failure'); } });
  const result = await second.rt.propose(planInput());
  assert.equal(result.card.sessionId, '');
  assert.equal(result.group.status, 'proposed');
  assert.deepEqual(second.errors, ['HUB_GROUP_CARD_SESSION_FAILURE']);
});

test('摘要和全文校验不变，确认时两道校验仍生效', async () => {
  let full;
  const fullText = { put: (text) => {
    full = text;
    return createHash('sha256').update(text).digest('hex');
  } };
  const { rt, dir } = setup({ list: () => [], create: async () => ({ id: 'new' }) }, { fullText });
  const { card, group } = await rt.propose(planInput());
  const data = saved(dir, group.id);
  assert.equal(card.text, cardSummary(full, 900).text);
  assert.equal(card.fullText, createHash('sha256').update(full).digest('hex'));
  assert.equal(card.summary, `分工表校验 ${data.planDigest.slice(0, 12)}`);
  assert.equal(data.planTextDigest, textDigest(full));
  data.plan.tickets[0].goal = 'changed';
  const file = path.join(dir, 'groups', group.id, 'group.json');
  fs.writeFileSync(file, JSON.stringify(data));
  await assert.rejects(rt.confirm(group.id, { approved: true }), /变更/);
  data.plan.tickets[0].goal = planInput().tickets[0].goal;
  data.goal = 'changed';
  fs.writeFileSync(file, JSON.stringify(data));
  await assert.rejects(rt.confirm(group.id, { approved: true }), /变更/);
  data.goal = planInput().goal;
  fs.writeFileSync(file, JSON.stringify(data));
  assert.equal((await rt.confirm(group.id, { approved: true })).group.status, 'active');
});

test('列表读取末条有效消息，空组使用创建时间', async () => {
  const { rt, dir } = setup();
  const { group } = await rt.propose(planInput());
  const empty = rt.list()[0];
  assert.equal(empty.lastText, '');
  assert.equal(empty.updatedAt, new Date(fakeClock()()).toISOString());
  const file = path.join(dir, 'groups', group.id, 'messages.jsonl');
  const rows = [JSON.stringify({ text: '旧'.repeat(9000), ts: 1 }),
    JSON.stringify({ text: '末条\n' + '字'.repeat(90), ts: 1000 }), '{broken'];
  fs.writeFileSync(file, rows.join('\n') + '\n');
  const row = rt.list()[0];
  assert.equal(row.lastText, '末条 ' + '字'.repeat(76) + '…');
  assert.equal(row.updatedAt, new Date(1000).toISOString());
});
