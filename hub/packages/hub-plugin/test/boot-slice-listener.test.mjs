import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installBootSlice } from '../boot-slice-listener.mjs';

// 构造监听器上下文并返回可调用的处理函数。
function setup(getSlice = async () => 'slice') {
  let handler;
  const cancel = () => {
  };
  const ctx = {
    on: (event, fn, opts) => {
      assert.equal(event, 'agent/pre-step');
      assert.deepEqual(opts, { prepend: false });
      handler = fn;
      return cancel;
    },
  };
  assert.equal(installBootSlice(ctx, { name: 'test-slice', getSlice, createUserMessage: x => x }), cancel);
  return (session, decision = { kind: 'continue', messages: [] }, signal = { aborted: false }) =>
    handler({ agent: { session }, turn: 1, step: 1, signal }, async () => decision);
}

test('inject once, source and immutable decision', async () => {
  const run = setup(), session = {}, d = { kind: 'continue', messages: [], other: 3 };
  const out = await run(session, d);
  assert.notEqual(out, d);
  assert.deepEqual(d.messages, []);
  assert.equal(out.other, 3);
  assert.deepEqual(out.messages[0].source, {
    kind: 'test-slice', form: 'snapshot', sections: [{ name: 'test-slice', text: 'slice' }],
  });
  assert.equal((await run(session, d)), d);
});

test('different sessions', async () => {
  const run = setup();
  assert.equal((await run({})).messages.length, 1);
  assert.equal((await run({})).messages.length, 1);
});

test('reject and abort', async () => {
  let calls = 0;
  const run = setup(async () => {
    calls++;
    return 'x';
  }), s = {}, d = { kind: 'reject', messages: [] }, a = { kind: 'continue', messages: [] };
  assert.equal(await run(s, d), d);
  assert.equal(await run(s, a, { aborted: true }), a);
  assert.equal(calls, 0);
});

test('empty retries and exceptions', async () => {
  let n = 0;
  const run = setup(async () => {
    n++;
    if (n === 1) {
      return '';
    }
    if (n === 2) {
      throw Error('oops');
    }
    return 'ok';
  }), s = {}, d = { kind: 'continue', messages: [] };
  assert.equal(await run(s, d), d);
  assert.equal(await run(s, d), d);
  assert.equal((await run(s, d)).messages.length, 1);
});

test('restore from events and tolerate scan error', async () => {
  const run = setup();
  const s = {
    seq: 2, eventAt: i => i === 1 ? { type: 'user/message', data: { source: { kind: 'test-slice' } } } : null,
  };
  assert.equal((await run(s)).messages.length, 0);
  assert.equal((await run({
    seq: 1, eventAt: () => {
      throw Error();
    },
  })).messages.length, 1);
});

test('source imports are local or node', () => {
  const src = fs.readFileSync(new URL('../boot-slice-listener.mjs', import.meta.url), 'utf8');
  // 匹配静态导入路径并检查其来源是否安全。
  for (const m of src.matchAll(/\bimport\s+(?:[^'";]*?from\s*)?['"]([^'"]+)['"]/g)) {
    assert.match(m[1], /^(node:|\.\.?\/)/);
  }
});
