import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPresence } from '../lib/ext/presence.mjs';
import { createUnread } from '../lib/unread.mjs';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('短语完整且不带敏感片段：真实样式标题表', () => {
  const cases = [
    ['在你自己的 notes 里整理资料', '在干活'], ['【任务】原话转达：整理资料', '在整理资料'],
    ['整理资料', '在整理资料'], ['修改页面', '在修改页面'], ['检查数据', '在检查数据'],
    ['制作方案', '在制作方案'], ['整理会议纪要', '在整理会议纪要'], ['编写测试', '在编写测试'],
    ['修复登录问题', '在修复登录问题'], ['生成摘要', '在生成摘要'], ['核对结果', '在核对结果'],
    ['梳理需求', '在梳理需求'], ['更新说明', '在更新说明'], ['处理反馈', '在处理反馈'],
    ['【草稿】检查布局', '在检查布局'], ['和大家一起整理', '在干活'], ['整理后的', '在干活'],
    ['处理了', '在干活'], ['整理非常长非常长的一份资料', '在干活'], ['请主人确认', '在干活'],
    ['/private/file', '在干活'], ['~/secret', '在干活'], ['C:\\private', '在干活'],
    ['abc@example.com', '在干活'], ['https://example.org', '在干活'],
    ['secret123456789012345', '在干活'], ['检查 /private', '在干活'],
  ];
  for (const [title, expected] of cases) {
    const view = buildPresence({ tickets: [{ claimedBy: 'bot-a', state: 'progress', title }] });
    assert.equal(view.bots['bot-a'].line, expected, title);
  }
});

// 改：派工会话（purpose=board）在会话列表里点得开，回复要数得到、读得掉，所以计入；
// 会议、定时任务、组内工作会话、隐藏会话仍不计。
test('系统会话增添回复不改变助理未读（派工会话除外，它点得开所以计入）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'z2-unread-'));
  const rows = [
    { id: 'visible', bot: 'a' }, { id: 'meeting', bot: 'a', hidden: true, purpose: 'meeting' },
    { id: 'routine', bot: 'a', purpose: 'routine' }, { id: 'group', bot: 'a', groupId: 'g' },
    { id: 'board', bot: 'a', purpose: 'board' }, { id: 'hidden', bot: 'a', hidden: true },
  ];
  const messages = [{ id: '1', role: 'assistant', text: '回复' }];
  const systemMessages = [...messages];
  const core = createUnread({
    dataDir: dir, sessions: { list: async () => rows, history: async id => id === 'visible' ? messages : systemMessages },
  });
  assert.equal((await core.counts()).body.bots.a, 2);
  systemMessages.push({ id: '2', role: 'assistant', text: '新回复' });
  const result = (await core.counts()).body;
  assert.equal(result.bots.a, 3);
  assert.deepEqual(Object.keys(result.conversations).sort(), ['board', 'visible']);
});
