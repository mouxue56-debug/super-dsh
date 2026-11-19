import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBootSlice, estimateTokens } from '../boot-slice.mjs';
const base = {
  date: '2026-01-01', tickets: [], pendingApprovals: 0,
  kb: { state: 'pushed', at: '2026-01-01T12:34:56Z' }, anomalies: [],
};
test('minimal exact output', () =>
  assert.equal(
    buildBootSlice(base),
    '今天 2026-01-01，待办 0 张\n知识库副本：2026-01-01 12:34 同步（pushed）',
  ));
test('满输入 7 行全出（开工切片上限 7 行）', () => {
  const out = buildBootSlice({
    ...base, pendingApprovals: 2, tickets: [1, 2, 3].map(id => ({ id, title: 'title', status: 'queued' })),
    anomalies: ['issue'],
  });
  assert.equal(out.split('\n').length, 7);
  for (const x of ['今天', '等你批', '等待：1', '知识库副本', '异常']) {
    assert.ok(out.includes(x));
  }
  assert.ok(out.includes('等待：2') && out.includes('等待：3'));
});

test('three waiting in input order', () => {
  const out = buildBootSlice({ date: 'x', tickets: [1, 2, 3, 4].map(id => ({ id, title: 't', status: 'new' })) });
  assert.deepEqual(out.split('\n').slice(1), ['等待：1 t', '等待：2 t', '等待：3 t']);
});

test('title truncation and token limit', () => {
  const out = buildBootSlice({
    ...base, tickets: [{ id: 'a1', title: '字'.repeat(1000), status: 'new' }],
    anomalies: ['异'.repeat(1000), '常'.repeat(1000)],
  });
  assert.ok(out.includes('…'));
  assert.ok(estimateTokens(out) <= 150);
  assert.ok(out.split('\n').length <= 7);
});

test('state wording', () => {
  for (const [state, at, expected] of [
    ['up_to_date', '2026-01-01T12:34', '同步（up_to_date）'],
    ['pending', '2026-01-01T12:34', '2026-01-01 12:34 之后未确认同步'],
    ['unknown', '2026-01-01T12:34', '状态未知'], ['pushed', null, '状态未知'],
  ]) {
    assert.ok(buildBootSlice({ ...base, kb: { state, at } }).includes(expected));
  }
});

test('missing fields and controls', () => {
  assert.doesNotThrow(() => buildBootSlice());
  const out = buildBootSlice({
    date: 'x\n\t', tickets: [{ id: 'a\tb', title: 'c\nd', status: 'new' }], anomalies: ['x\t\0y'],
  });
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(out));
  assert.ok(!out.includes('知识库副本'));
});

test('3 张超长工单加超长异常仍不超 7 行与 150 token', () => {
  const out = buildBootSlice({
    ...base, pendingApprovals: 9, anomalies: ['异'.repeat(500)],
    tickets: [1, 2, 3].map(id => ({ id: 'T' + id, title: '字'.repeat(500), status: 'blocked' })),
  });
  assert.ok(estimateTokens(out) <= 150);
  assert.ok(out.split('\n').length <= 7);
  assert.ok(out.includes('今天') && out.includes('异常'));
});
