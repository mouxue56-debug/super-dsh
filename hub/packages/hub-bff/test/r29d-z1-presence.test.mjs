// 状态句：套话和标签拿掉，过长标题只显示状态词。整句仍不超过十二个字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPresence, LINE_MAX } from '../lib/ext/presence.mjs';

const NOW = Date.parse('2026-11-19T00:00:00.000Z');

function line(title, state = 'progress') {
  const view = buildPresence({
    now: NOW,
    tickets: [{
      claimedBy: 'bot-a', state, review: 'none', title,
      updatedAt: new Date(NOW).toISOString(),
    }],
  });
  return view.bots['bot-a'];
}

test('套话和标签去掉，叫不出内容就只留状态词', () => {
  const stuck = line('Ada 原话转达：定下周一', 'blocked');
  assert.equal(stuck.state, 'stuck');
  assert.equal(stuck.line, '卡在定下周一');
  assert.equal(stuck.line.includes('Ada'), false);
  assert.equal(stuck.line.endsWith('：'), false);
  const empty = line('【转达】原话转达：', 'blocked');
  assert.equal(empty.line, '卡住了');
  const tagged = line('[草稿]整理记录稿', 'progress');
  assert.equal(tagged.line, '在整理记录稿');
});

test('过长标题不截取片段，整句不超过十二字', () => {
  const punct = line('一二三四五六七八九十，后面', 'progress');
  assert.equal(punct.line, '在干活');
  assert.equal(punct.line.endsWith('，'), false);
  const word = line('整理 abcdefghijk', 'progress');
  assert.equal(word.line, '在干活');
  assert.equal(/[A-Za-z0-9]$/u.test(word.line), false);
  const gone = line('abcdefghijklm', 'blocked');
  assert.equal(gone.line, '卡住了');
  for (const row of [stuckSafe(), punct, word, gone]) {
    assert.ok(Array.from(row.line).length <= LINE_MAX);
  }
});

function stuckSafe() {
  return line('外部回信', 'blocked');
}
