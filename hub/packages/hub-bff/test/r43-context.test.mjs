import test from 'node:test';
import assert from 'node:assert/strict';
import { DshClient } from '../lib/dsh-client.mjs';
import { isTopicSession } from '../lib/topic-session.mjs';

const user = (seq, text, source = 'user') => ({ seq, time: seq, type: 'user/message',
  data: { role: 'user', content: [{ type: 'text', text }], source: { kind: source } }, surfaceOp: 'append' });
const checkpoint = (seq, startSeq, endSeq) => ({ ...user(seq, '已压缩的摘要', 'compact-checkpoint'),
  surfaceOp: { op: 'replace', startSeq, endSeq } });

async function history(pages, limit = 40) {
  const requests = [];
  const client = { async rpc(method, { request }) {
    assert.equal(method, 'session/events');
    requests.push({ ...request });
    const result = pages[requests.length - 1];
    assert.ok(result, '不应多读历史');
    return { cursor: 40, ...result };
  } };
  const result = await DshClient.prototype.historyPage.call(client, 'chat', { limit });
  return { result, requests };
}

test('只有内核检查点证明已压缩，原文仍可读且保留起句长度受限', async () => {
  const { result } = await history([{ hasMore: false,
    records: [user(1, '旧原文'), user(8, '新'.repeat(100)), checkpoint(20, 1, 7)] }]);
  assert.deepEqual(result.context, { compacted: true, exact: false, checkpointSeq: 20, afterSeq: 7,
    retainedFrom: { seq: 8, text: '新'.repeat(80) } });
  assert.deepEqual(result.messages.map(item => item.seq), [1, 8]);
});

test('分页未见检查点保持未知，主人写出的同样文字不当作内核事实', async () => {
  const { result } = await history([{ hasMore: true,
    records: [user(30, '<compacted-summary>摘要</compacted-summary>')] }]);
  assert.deepEqual(result.context, { compacted: null, exact: false });
});

test('跨原始页的检查点补齐覆盖范围，仍能取到压缩证据', async () => {
  const { result, requests } = await history([
    { hasMore: true, records: [checkpoint(20, 1, 7), user(21, '接下来')] },
    { hasMore: false, records: [user(1, '旧内容'), user(8, '保留的第一句话')] },
  ], 2);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].beforeSeq, 20);
  assert.equal(result.context.afterSeq, 7);
  assert.deepEqual(result.context.retainedFrom, { seq: 8, text: '保留的第一句话' });
});

test('重复压缩选择最近检查点，边界后没有原文时不编造起句', async () => {
  const { result } = await history([{ hasMore: false, records: [user(1, '旧内容'),
    checkpoint(5, 1, 3), checkpoint(20, 1, 19)] }]);
  assert.equal(result.context.checkpointSeq, 20);
  assert.equal(result.context.retainedFrom, null);
});

test('没有合法替换边界的检查点不能证明已压缩', async () => {
  const { result } = await history([{ hasMore: false, records: [user(1, '正文'),
    user(2, '来源标记但没有替换', 'compact-checkpoint'), checkpoint(4, 5, 3)] }]);
  assert.deepEqual(result.context, { compacted: null, exact: false });
});

test('相同短句按内核来源中的请求号区分，不把用户正文当身份', async () => {
  const first = user(1, '好的'), second = user(2, '好的'), malformed = user(4, '坏请求号');
  first.data.source.rpcId = 'request-a';
  second.data.source.rpcId = 'request-b';
  malformed.data.source.rpcId = { id: 'request-c' };
  const { result } = await history([{ hasMore: false, records: [first, second, user(3, 'request-a'), malformed] }]);
  assert.deepEqual(result.messages.map(item => item.requestId), ['request-a', 'request-b', undefined, undefined]);
});

test('归类标记限定自建 UUID，建会话回执必须保持相同身份', async () => {
  const id = 'hub-topic-12345678-1234-4123-8123-123456789abc';
  assert.equal(isTopicSession(id), true);
  for (const value of [null, 'hub-topic-', id + '-extra', 'prefix-' + id, 'ordinary']) {
    assert.equal(isTopicSession(value), false);
  }
  const calls = [];
  const client = { async rpc(method, input) {
    calls.push({ method, input });
    return { sessionId: id };
  } };
  assert.deepEqual(await DshClient.prototype.createSession.call(client,
    { cwd: '/test/chief', agentPreset: 'hub-chief', sessionId: id }), { id });
  assert.deepEqual(calls, [{ method: 'session/create', input: {
    request: { cwd: '/test/chief', agentPreset: 'hub-chief', sessionId: id },
  } }]);
  client.rpc = async () => ({ sessionId: 'different' });
  await assert.rejects(() => DshClient.prototype.createSession.call(client,
    { cwd: '/test/chief', sessionId: id }), { code: 'INCOMPATIBLE' });
});
