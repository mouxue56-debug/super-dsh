// 未读只数助理写给主人的正文。系统提示、开工切片、工具占位都不进投影或不进计数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSessionUnread, isDirectReply, isGroupReply } from '../lib/unread.mjs';
import { messageFromEvent } from '../lib/timeline.mjs';

test('系统提示、开工切片、工具步骤不算助理发言', () => {
  const boot = messageFromEvent({
    type: 'user/message', seq: 1,
    data: {
      source: { kind: 'hub-boot-slice' },
      content: [{ type: 'text', text: '今天 11月19日，待办 3 张' }],
    },
  });
  const reminder = messageFromEvent({
    type: 'user/message', seq: 2,
    data: {
      source: { kind: 'agent-instructions' },
      content: [{ type: 'text', text: '系统提示' }],
    },
  });
  const clock = messageFromEvent({
    type: 'user/message', seq: 3,
    data: {
      source: { kind: 'time-context' },
      content: [{ type: 'text', text: 'Time sampled while preparing' }],
    },
  });
  const runtime = messageFromEvent({
    type: 'user/message', seq: 4,
    data: {
      source: { kind: 'runtime-context' },
      content: [{ type: 'text', text: 'Current runtime context.' }],
    },
  });
  const system = messageFromEvent({
    type: 'system/message', seq: 5,
    data: { content: [{ type: 'text', text: '系统' }] },
  });
  assert.equal(boot, undefined);
  assert.equal(reminder, undefined);
  assert.equal(clock, undefined);
  assert.equal(runtime, undefined);
  assert.equal(system, undefined);
  const reply = messageFromEvent({
    type: 'assistant/message', seq: 6,
    data: { message: { content: [{ type: 'text', text: '在' }] } },
  });
  const messages = [
    { role: 'user', id: 'u1', text: '今天 11月19日，待办 3 张' },
    { role: 'assistant', id: 'tool:1', text: '' },
    { role: 'assistant', id: 'a0', text: '系统样板', system: true },
    reply,
  ];
  assert.equal(isDirectReply(messages[0]), false);
  assert.equal(isDirectReply(messages[1]), false);
  assert.equal(isDirectReply(messages[2]), false);
  assert.equal(countSessionUnread(messages, null), 1);
  const assistants = new Set(['aa']);
  assert.equal(isGroupReply({ id: 1, from: 'aa', text: '系统', system: true }, assistants), false);
  assert.equal(isGroupReply({ id: 2, from: 'owner', text: '我来说' }, assistants), false);
  assert.equal(isGroupReply({ id: 3, from: 'aa', text: '一句' }, assistants), true);
});
