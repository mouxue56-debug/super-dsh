import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, estimateTokens, splitPage } from '../lib/group-context.mjs';
const group = {
  members: [{ id: 'm-host', name: '主持' }, { id: 'm-copy', name: '文案' }],
  limits: { contextMessages: 8, tokenBudget: 1200 },
};

const page =
  '# 项目页：组\n## 目标\n- 完成目标\n## 主人说过的\n- [#1] 原话\n## 已定的决定\n- [#2] 决定\n' +
  '## 分工与谁来验\n- 分工内容\n## 进度\n- 进度内容\n  续行\n## 卡点\n- 卡点内容\n## 下一步\n- 下一步内容';
const tickets = [{
  id: 't1',
  title: '任务',
  assignee: 'm-copy',
  verifier: 'm-host',
  status: 'doing',
  checklist: [{ text: '验收内容' }],
}, {
  id: 't2',
  title: '验任务',
  assignee: 'm-host',
  verifier: 'm-copy',
  status: 'review',
  checklist: [{ text: '验收二' }],
}, { id: 't3', title: '完成', assignee: 'm-copy', status: 'done', checklist: [] }];
const messages = [{ id: 1, from: 'owner', text: '主人内容', to: [] }, {
  id: 2,
  from: 'm-host',
  text: '@文案 请处理',
}, { id: 3, from: 'm-host', text: '普通消息', to: [] }];
const args = { group, memberId: 'm-copy', page, tickets, messages };
test('token estimate and page split', () => {
  assert.equal(estimateTokens('中文abcd'), 3);
  assert.equal(estimateTokens('あ한'), 2);
  const p = splitPage(page);
  assert.equal(p.order.length, 7);
  assert.deepEqual(p.sections['进度'], ['- 进度内容', '  续行']);
});

test('composition, counts, deduplication and last spoke', () => {
  const r = buildContext(args);
  assert.match(r.text, /### 项目页/);
  assert.match(r.text, /\[t1\] 任务/);
  assert.doesNotMatch(r.text, /\[t3\]/);
  assert.equal((r.text.match(/#2 m-host/g) ?? []).length, 1);
  assert.equal(r.parts.mentions.items, 1);
  assert.equal(r.parts.recent.items, 2);
  assert.equal(r.used, Object.values(r.parts).reduce((a, p) => a + p.tokens, 0));
  assert.equal(buildContext({ ...args, lastSpokeId: 2 }).parts.mentions.items, 0);
});

test('trim ordinary messages, then entries, then tickets; protect owner and mentions', () => {
  const full = buildContext(args);
  const low = buildContext({ ...args, options: { tokenBudget: 1 } });
  assert.deepEqual(low.dropped, [3]);
  assert.match(low.text, /主人内容/);
  assert.match(low.text, /@文案 请处理/);
  assert.match(low.text, /完成目标/);
  assert.match(low.text, /原话/);
  assert.match(low.text, /决定/);
  assert.doesNotMatch(low.text, /进度内容/);
  assert.doesNotMatch(low.text, /\[t1\]/);
  assert.ok(low.notes.some((n) => n.includes('4 条目')));
  assert.ok(low.overBudget);
  assert.ok(full.used > low.used);
  const noOrdinary = buildContext({ ...args, options: { tokenBudget: full.used - 1 } });
  assert.deepEqual(noOrdinary.dropped, [3]);
  assert.match(noOrdinary.text, /进度内容/);
});

test('frozen inputs remain unchanged', () => {
  const deepFreeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  };
  const frozen = deepFreeze(structuredClone(args));
  assert.doesNotThrow(() => buildContext({ ...frozen, options: { tokenBudget: 1 } }));
});

test('ticket reductions keep identifiers and prioritize verifier-only work', () => {
  const base = { group, memberId: 'm-copy', page: '', tickets, messages: [] };
  const full = buildContext(base);
  let sawVerifierReduced = false, sawVerifierGone = false;
  for (let budget = full.used - 1; budget > 0; budget--) {
    const r = buildContext({ ...base, options: { tokenBudget: budget } });
    const v = r.text.split('\n').find((x) => x.includes('[t2]'));
    const a = r.text.split('\n').find((x) => x.includes('[t1]'));
    if (v && !v.includes('验收:')) {
      sawVerifierReduced = true;
      assert.match(v, /\[t2\] 验任务/);
      assert.ok(a?.includes('验收:'));
    }
    if (!v && a?.includes('验收:')) {
      sawVerifierGone = true;
    }
  }
  assert.ok(sawVerifierReduced);
  assert.ok(sawVerifierGone);
});

test('all mentions are protected and old mentions can enter recent only', () => {
  const data = {
    ...args,
    messages: [{ id: 4, from: 'm-host', text: '广播', to: 'all' }, {
      id: 5,
      from: 'm-host',
      text: '@m-copy 旧点名',
      to: ['m-copy'],
    }],
    lastSpokeId: 5,
  };
  const r = buildContext(data);
  assert.equal(r.parts.mentions.items, 0);
  assert.equal(r.parts.recent.items, 2);
  const after = buildContext({ ...data, lastSpokeId: 3, options: { tokenBudget: 1 } });
  assert.equal(after.parts.mentions.items, 2);
  assert.deepEqual(after.dropped, []);
});
