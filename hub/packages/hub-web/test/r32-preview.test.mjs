// 首页「最近」第二行不露出「【工单 T-…」，换成人话；普通文字照旧。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { previewText } = require('../hub-real.js');

test('派给你了 → 你把这张卡交给了它；不带单号', () => {
  const text = '【工单 T-20261119-0001 派给你了】主人把这张卡派给你了。\n请用 board_list 看这张单';
  assert.equal(previewText(text), '你把这张卡交给了它');
});
test('交回、卡住、做不了、别人派来的活，也都是人话', () => {
  assert.equal(previewText('【工单 T-2026-9 交回了】外部 交回了一件事，等你验收。'), '它交回了一件事，等你看');
  assert.equal(previewText('【工单 T-2026-9 卡住了】x 说卡住了'), '它说卡住了');
  assert.equal(previewText('【工单 T-2026-9 做不了】x'), '它说这件事做不了');
  assert.equal(previewText('【调研员派来的活 · 工单 T-2026-9】整理一下'), '调研员派来一件事');
  for (const raw of ['【工单 T-2026-9 派给你了】a', '【工单 T-2026-9 交回了】a', '【写作派来的活 · 工单 T-1】x']) {
    assert.doesNotMatch(previewText(raw), /T-\d|【工单/u);
  }
});
test('普通消息不受影响', () => {
  assert.equal(previewText('**好的**，我这就去查'), '好的，我这就去查');
  assert.equal(previewText('这是一条讲【工单】的话'), '这是一条讲【工单】的话');
});
