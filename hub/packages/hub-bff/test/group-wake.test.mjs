import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkHandoff,
  checkLength,
  decideWake,
  flushPending,
  initialWakeState,
  isIdleMessage,
  isPassMessage,
  recordHandoff,
} from '../lib/group-wake.mjs';
const group = {
  host: 'm-host',
  members: ['m-host', 'm-research', 'm-copy'].map((id) => ({ id, name: id })),
  limits: {},
};

const msg = (id, from, text, to) => ({
  id,
  from,
  text,
  ...(to === undefined ? {} : { to }),
  toolCalls: 0,
});

test('pass and idle recognition', () => {
  assert.ok(isPassMessage(' 〔过〕 '));
  assert.ok(!isPassMessage('过了'));
  assert.ok(isIdleMessage(msg(1, 'm-host', '好的，谢谢！')));
  assert.ok(isIdleMessage(msg(1, 'm-host', '自定义'), [], { ackWords: ['自定义'] }));
  assert.ok(isIdleMessage(msg(1, 'm-host', '重复内容'), [msg(0, 'owner', '重复 内容')]));
  // 工具调用只认运行时传入的记录，消息自报的 toolCalls 不算；没有记录按没调用
  assert.ok(isIdleMessage({ ...msg(1, 'm-host', '好的'), toolCalls: 1 }));
  assert.ok(!isIdleMessage(msg(1, 'm-host', '好的'), [], { toolRecords: [{ messageId: 1, tool: 'read_file' }] }));
  assert.ok(isIdleMessage(msg(1, 'm-host', '好的'), [], { toolRecords: [{ messageId: 2, tool: 'read_file' }] }));
  assert.ok(isIdleMessage(msg(1, 'm-host', '好的'), [], { toolRecords: [{ messageId: 1, tool: '' }] }));
  assert.ok(!isIdleMessage(msg(1, 'm-host', '实质性的内容')));
  assert.ok(!isIdleMessage(msg(1, 'm-host', '过')));
});

test('mentions, rounds, all and pending', () => {
  let s = initialWakeState();
  let r = decideWake({ group, message: msg(1, 'owner', '开始'), state: s });
  assert.deepEqual(r.wake, ['m-host']);
  s = r.state;
  r = decideWake({
    group,
    message: msg(2, 'm-host', '@m-research', ['m-research', 'm-host', 'missing']),
    state: s,
  });
  assert.deepEqual(r.wake, ['m-research']);
  assert.deepEqual(r.rejected, [{ id: 'missing', reason: 'not_member' }]);
  s = r.state;
  r = decideWake({ group, message: msg(3, 'm-research', '安排', ['m-host']), state: s });
  assert.equal(r.rejected[0].reason, 'already_woken');
  r = decideWake({ group, message: msg(4, 'm-copy', '通知', 'all'), state: r.state, now: 10 });
  assert.equal(r.rejected[0].reason, 'all_not_allowed');
  assert.equal(r.state.pending.length, 1);
  r = decideWake({ group, message: msg(5, 'owner', '全员', 'all'), state: r.state });
  assert.deepEqual(r.wake, ['m-host', 'm-research', 'm-copy']);
  r = decideWake({ group, message: msg(6, 'm-host', '广播', 'all'), state: initialWakeState() });
  assert.deepEqual(r.wake, ['m-research', 'm-copy']);
});

test('batch size and time; paused batch', () => {
  let s = initialWakeState();
  for (let i = 0; i < 5; i++) {
    s = decideWake({ group, state: s, message: msg(i + 1, 'm-copy', `内容${i}`), now: 100 }).state;
  }
  assert.equal(flushPending({ group, state: s, now: 101 }).deliver.length, 2);
  const small = { ...s, pending: s.pending.slice(0, 1) };
  assert.equal(flushPending({ group, state: small, now: 30099 }).deliver.length, 0);
  assert.equal(flushPending({ group, state: small, now: 30100 }).deliver.length, 2);
  assert.equal(
    flushPending({ group, state: { ...s, paused: true }, now: 50000 }).deliver.length,
    0,
  );
});

test('idle pause and owner resume; pass does not alter round', () => {
  let s = initialWakeState();
  for (let i = 1; i <= 6; i++) {
    const r = decideWake({ group, state: s, message: msg(i, 'm-copy', '好的') });
    s = r.state;
    assert.equal(r.pausedNow, i === 6);
  }
  assert.equal(
    decideWake({ group, state: s, message: msg(7, 'm-copy', '工作', ['m-host']) }).rejected[0]
      .reason,
    'paused',
  );
  const pass = decideWake({ group, state: s, message: msg(8, 'owner', '过') });
  assert.deepEqual(pass.state, s);
  const resumed = decideWake({ group, state: s, message: msg(9, 'owner', '继续') });
  assert.equal(resumed.state.paused, false);
  assert.equal(resumed.state.idleCount, 0);
  assert.deepEqual(resumed.wake, ['m-host']);
});

test('handoffs, lengths and twelve-message round', () => {
  let s = initialWakeState();
  for (let i = 0; i < 4; i++) {
    assert.ok(checkHandoff(s, 't', {}).ok);
    s = recordHandoff(s, 't');
  }
  assert.deepEqual(checkHandoff(s, 't', {}), { ok: false, count: 4 });
  assert.ok(checkLength('😀a', { maxChars: 2 }).ok);
  assert.equal(checkLength('😀ab', { maxChars: 2 }).over, 1);
  const script = [
    msg(1, 'owner', '开始'),
    msg(2, 'm-host', '交给研究', ['m-research']),
    msg(3, 'm-research', '交给文案', ['m-copy']),
    msg(4, 'm-copy', '返回主持', ['m-host']),
    msg(5, 'm-host', '过'),
    ...Array.from({ length: 6 }, (_, i) => msg(6 + i, 'm-copy', `事实${i}`)),
    msg(12, 'owner', '继续', ['m-research']),
  ];
  s = initialWakeState();
  for (const m of script) {
    s = decideWake({ group, state: s, message: m }).state;
  }
  assert.equal(s.round.ownerMsgId, 12);
  assert.deepEqual(s.round.woken, ['m-research']);
});

test('wake and batch do not mutate inputs; substantive messages reset idle', () => {
  const state = initialWakeState();
  Object.freeze(state.round.woken);
  Object.freeze(state.round);
  Object.freeze(state.pending);
  Object.freeze(state.handoffs);
  Object.freeze(state);
  const r = decideWake({ group, state, message: msg(1, 'm-copy', '收到'), now: 10 });
  assert.equal(state.idleCount, 0);
  assert.equal(r.state.idleCount, 1);
  const substantive = decideWake({
    group,
    state: r.state,
    message: msg(2, 'm-copy', '完成具体任务'),
  });
  assert.equal(substantive.state.idleCount, 0);
  const before = structuredClone(substantive.state);
  const flushed = flushPending({ group, state: substantive.state, now: 30010 });
  assert.deepEqual(substantive.state, before);
  assert.ok(flushed.deliver.every((d) => d.messages.every((m) => m.from !== d.to)));
  assert.equal(flushed.state.pending.length, 0);
});

test('decideWake 防空转：自报 toolCalls 不能躲过空转计数，运行时记录可以', () => {
  const limited = { ...group, limits: { idleLimit: 2 } };
  const faked = (id) => ({ ...msg(id, 'm-copy', '好的'), toolCalls: 5 });
  let r = decideWake({ group: limited, message: faked(1), state: initialWakeState() });
  r = decideWake({ group: limited, message: faked(2), state: r.state });
  assert.equal(r.pausedNow, true);
  const real = [{ messageId: 1, tool: 'read_file' }, { messageId: 2, tool: 'run_tests' }];
  r = decideWake({ group: limited, message: faked(1), state: initialWakeState(), toolRecords: real });
  r = decideWake({ group: limited, message: faked(2), state: r.state, toolRecords: real });
  assert.equal(r.pausedNow, false);
});
