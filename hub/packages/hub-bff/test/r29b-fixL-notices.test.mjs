// 等你回答只认主人发起，或能顺着工单追回去。今天详情仍留着。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {createBoard} from '../lib/board.mjs';
import {createOwnerNotices} from '../lib/owner-notices.mjs';
import {buildToday} from '../lib/today.mjs';

const now = Date.parse('2026-11-19T13:00:00Z');
const owner = {name: 'owner', type: 'owner'};
const assistant = {name: 'bot-a', type: 'assistant'};

async function open() {
  const root = await mkdtemp(join(process.cwd(), '.review8-fixL-notice-'));
  const suffixes = ['abcd', 'efgh', 'ijkl', 'mnop'];
  let nth = 0;
  const board = createBoard({
    root, now: () => now, randomSuffix: () => suffixes[nth++],
  });
  const notices = createOwnerNotices({
    dataDir: root,
    now: () => now,
    board,
    roster: [{id: 'bot-a', role: 'bot'}],
    hubConfig: {notices: {utcOffsetMinutes: 0}},
  });
  return {root, board, notices};
}

test('主人发起的工单停下来问，会进主动提醒', async () => {
  const {board, notices} = await open();
  const ticket = await board.create(owner, {
    title: '主人的事', goal: '请定一下', to: ['bot-a'],
  });
  await board.block(owner, ticket.id, '请主人定方向', {waitHuman: true});
  const result = await notices.current();
  assert.equal(result.ok, true);
  assert.match(result.notice?.text ?? '', /请主人定方向/);
});

test('上级是主人发起的，助理再问也会进主动提醒', async () => {
  const {board, notices} = await open();
  const parent = await board.create(owner, {
    title: '主人的事', goal: '请去做', to: ['bot-a'],
  });
  const child = await board.create(assistant, {
    title: '接着做', goal: '内部', to: ['bot-a'], parentId: parent.id, root: parent.id,
  });
  await board.block(assistant, child.id, '这一句该问主人', {waitHuman: true});
  const result = await notices.current();
  assert.match(result.notice?.text ?? '', /这一句该问主人/);
});

test('助理自建单不进主动提醒，今天详情仍能看到', async () => {
  const {root, board, notices} = await open();
  const ticket = await board.create(assistant, {
    title: '转给别人', goal: '协作', to: ['bot-b'],
  });
  await board.block(assistant, ticket.id, '这句不该主动提醒', {waitHuman: true});
  const result = await notices.current();
  assert.equal(result.notice, null);
  const today = await buildToday({
    now: () => now,
    board,
    dataDir: root,
    hubConfig: {routines: {utcOffsetMinutes: 0}},
    roster: {list: () => []},
    cards: {pending: () => []},
    logger: {error() {}},
  });
  assert.equal(today.waiting.counts.waitingAnswer, 1);
  assert.match(today.waiting.waitingAnswer[0].reason, /这句不该主动提醒/);
});
