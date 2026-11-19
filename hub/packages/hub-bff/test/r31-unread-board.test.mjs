// 派工会话（purpose=board）点得开，它的回复要数得到、读得掉；会议、定时任务仍不计。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUnread } from '../lib/unread.mjs';

const reply = (id, text) => ({ role: 'assistant', id, text, seq: Number(id) });

test('派工会话的回复计入这位助理的未读，打开读到最新后清零', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'unread-board-'));
  const history = {
    chat: [reply('1', '单聊里的话')],
    work: [reply('2', '派工做完了'), reply('3', '补一句')],
    meet: [reply('4', '会议里的话')],
    cron: [reply('5', '定时任务的话')],
  };
  const sessions = [
    { id: 'chat', bot: 'bot-a', hidden: false },
    { id: 'work', bot: 'bot-a', hidden: false, purpose: 'board' },
    { id: 'meet', bot: 'bot-a', hidden: false, purpose: 'meeting' },
    { id: 'cron', bot: 'bot-a', hidden: false, purpose: 'routine' },
  ];
  const core = createUnread({
    dataDir: dir,
    sessions: { list: async () => sessions, history: async (id) => ({ messages: history[id] }) },
  });
  const first = (await core.counts()).body;
  assert.equal(first.conversations.work, 2);
  assert.equal(first.conversations.chat, 1);
  assert.equal(first.conversations.meet, undefined);
  assert.equal(first.conversations.cron, undefined);
  assert.equal(first.bots['bot-a'], 3);
  // 不带位置 = 读到最新
  const read = await core.mark({ conversation: 'work' });
  assert.equal(read.status, 200);
  const after = (await core.counts()).body;
  assert.equal(after.conversations.work, 0);
  assert.equal(after.bots['bot-a'], 1);
});
