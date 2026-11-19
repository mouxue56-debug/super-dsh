import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { createBoard } from '../lib/board.mjs';
import { createOwnerNotices } from '../lib/owner-notices.mjs';

test('助理自建自问的工单不应冒充需要主人回答的主动提醒', async () => {
  const root = await mkdtemp(join(process.cwd(), '.review8-board-'));
  const now = Date.parse('2026-11-19T13:00:00Z');
  const board = createBoard({root, now: () => now, randomSuffix: () => 'abcd'});
  const assistant = {name:'bot-a', type:'assistant'};
  const t = await board.create(assistant, {title:'内部事务', goal:'内部协作', to:['bot-a']});
  await board.block(assistant, t.id, '请主人立即处理我自己的事情', {waitHuman:true});
  const notices = createOwnerNotices({dataDir:root, now:()=>now, board, roster:[{id:'bot-a',role:'bot'}], hubConfig:{notices:{utcOffsetMinutes:0}}});
  const result = await notices.current();
  assert.equal(result.notice, null, '没有主人来源或授权的助理自建单不应成为主人的待办');
});
