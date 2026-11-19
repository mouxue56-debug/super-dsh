// 一键全停核心（lib/panic.mjs）。全部用假适配器，离线可跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPanic, markerPresent, resolvePanicConfig, PANIC_DEFAULTS } from '../lib/panic.mjs';

const quiet = { error() {}, log() {} };

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panic-core-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'panic');
}

function adapter(name, calls, behaviour = {}) {
  return {
    name,
    async stop() {
      calls.push(name + '.stop');
      if (behaviour.stop) return behaviour.stop();
      return { status: 'ok', detail: 'fine' };
    },
    async resume() {
      calls.push(name + '.resume');
      if (behaviour.resume) return behaviour.resume();
      return { status: 'ok', detail: 'back' };
    },
  };
}

test('从未停过：状态是 running，没有标记文件', t => {
  const dir = tmp(t);
  const panic = createPanic({ dir, adapters: [], logger: quiet });
  assert.equal(panic.status().state, 'running');
  assert.equal(panic.isStopped(), false);
  assert.equal(markerPresent(panic.markerFile), false);
});

test('全部步骤成功才报 stopped；标记文件与状态文件都落盘', async t => {
  const dir = tmp(t);
  const calls = [];
  const panic = createPanic({ dir, adapters: [adapter('a', calls), adapter('b', calls)], logger: quiet });
  const result = await panic.stop('夜里');
  assert.equal(result.ok, true);
  assert.equal(result.state, 'stopped');
  assert.deepEqual(Object.keys(result.steps), ['marker', 'state', 'a', 'b']);
  assert.equal(fs.existsSync(path.join(dir, 'stopped.flag')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).stopped, true);
  assert.equal(panic.isStopped(), true);
});

test('部分失败：不短路、不报全停、标记文件仍在', async t => {
  const dir = tmp(t);
  const calls = [];
  const panic = createPanic({
    dir,
    logger: quiet,
    adapters: [
      adapter('a', calls, { stop: () => { throw new Error('卡住了'); } }),
      adapter('b', calls),
    ],
  });
  const result = await panic.stop();
  assert.equal(result.ok, false);
  assert.equal(result.state, 'partial');
  assert.equal(result.steps.a.status, 'failed');
  assert.match(result.steps.a.detail, /卡住了/u);
  assert.equal(result.steps.b.status, 'ok');
  assert.deepEqual(calls, ['a.stop', 'b.stop']);
  assert.equal(panic.isStopped(), true);
  assert.equal(markerPresent(panic.markerFile), true);
});

test('步骤超时记为失败', async t => {
  const dir = tmp(t);
  const slow = { name: 'slow', stop: () => new Promise(() => {}) };
  const panic = createPanic({ dir, adapters: [slow], stepTimeoutMs: 30, logger: quiet });
  const result = await panic.stop();
  assert.equal(result.state, 'partial');
  assert.equal(result.steps.slow.status, 'failed');
  assert.match(result.steps.slow.detail, /超时/u);
});

test('absent 算成功，但必须如实标出', async t => {
  const dir = tmp(t);
  const none = { name: 'none', stop: async () => ({ status: 'absent', detail: '不存在' }) };
  const panic = createPanic({ dir, adapters: [none], logger: quiet });
  const result = await panic.stop();
  assert.equal(result.ok, true);
  assert.equal(result.steps.none.status, 'absent');
});

test('重启后仍是停的：新实例读到落盘状态', async t => {
  const dir = tmp(t);
  const first = createPanic({ dir, adapters: [adapter('a', [])], logger: quiet });
  await first.stop('原因');
  const again = createPanic({ dir, adapters: [adapter('a', [])], logger: quiet });
  assert.equal(again.isStopped(), true);
  const view = again.status();
  assert.equal(view.state, 'stopped');
  assert.equal(view.reason, '原因');
});

test('重启后 reapply 把步骤重做一遍', async t => {
  const dir = tmp(t);
  await createPanic({ dir, adapters: [], logger: quiet }).stop();
  const calls = [];
  const again = createPanic({ dir, adapters: [adapter('a', calls)], logger: quiet });
  assert.equal(again.status().state, 'partial');
  const result = await again.reapply();
  assert.equal(result.state, 'stopped');
  assert.deepEqual(calls, ['a.stop']);
});

test('没停过时 reapply 什么也不做', async t => {
  const dir = tmp(t);
  const calls = [];
  const panic = createPanic({ dir, adapters: [adapter('a', calls)], logger: quiet });
  await panic.reapply();
  assert.deepEqual(calls, []);
  assert.equal(panic.isStopped(), false);
});

test('重复停机：失败的步骤得到重试，since 不变', async t => {
  const dir = tmp(t);
  let healthy = false;
  let clock = 1000;
  const flaky = adapter('flaky', [], {
    stop: () => {
      if (!healthy) throw new Error('还没好');
      return { status: 'ok' };
    },
  });
  const panic = createPanic({ dir, adapters: [flaky], now: () => clock++, logger: quiet });
  const first = await panic.stop();
  assert.equal(first.state, 'partial');
  healthy = true;
  const second = await panic.stop();
  assert.equal(second.state, 'stopped');
  assert.equal(second.since, first.since);
});

test('并发的停机请求串行执行', async t => {
  const dir = tmp(t);
  let active = 0;
  let peak = 0;
  const probe = {
    name: 'probe',
    async stop() {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
      return { status: 'ok' };
    },
  };
  const panic = createPanic({ dir, adapters: [probe], logger: quiet });
  const results = await Promise.all([panic.stop(), panic.stop(), panic.stop()]);
  assert.equal(peak, 1);
  assert.ok(results.every(item => item.state === 'stopped'));
});

test('恢复必须显式：恢复后标记文件没了，适配器 resume 被调用', async t => {
  const dir = tmp(t);
  const calls = [];
  const panic = createPanic({ dir, adapters: [adapter('a', calls)], logger: quiet });
  await panic.stop();
  assert.equal(panic.isStopped(), true);
  const result = await panic.resume();
  assert.equal(result.ok, true);
  assert.equal(result.state, 'running');
  assert.equal(panic.isStopped(), false);
  assert.equal(markerPresent(panic.markerFile), false);
  assert.deepEqual(calls, ['a.stop', 'a.resume']);
  const reborn = createPanic({ dir, adapters: [], logger: quiet });
  assert.equal(reborn.isStopped(), false);
});

test('没停时恢复是空操作；恢复两次第二次是空操作', async t => {
  const dir = tmp(t);
  const calls = [];
  const panic = createPanic({ dir, adapters: [adapter('a', calls)], logger: quiet });
  assert.equal((await panic.resume()).noop, true);
  await panic.stop();
  await panic.resume();
  const again = await panic.resume();
  assert.equal(again.noop, true);
  assert.deepEqual(calls, ['a.stop', 'a.resume']);
});

test('恢复时某个子系统起不来：如实报失败，但不再处于停机', async t => {
  const dir = tmp(t);
  const bad = adapter('bad', [], { resume: () => { throw new Error('起不来'); } });
  const panic = createPanic({ dir, adapters: [bad], logger: quiet });
  await panic.stop();
  const result = await panic.resume();
  assert.equal(result.ok, false);
  assert.equal(result.state, 'running');
  assert.equal(result.resumeSteps.bad.status, 'failed');
});

test('状态文件损坏：宁停勿放，按已停处理', t => {
  const dir = tmp(t);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), '{坏的');
  const panic = createPanic({ dir, adapters: [], logger: quiet });
  assert.equal(panic.isStopped(), true);
  assert.equal(panic.status().state, 'partial');
});

test('只有标记文件（状态文件丢了）也按已停处理，且不算全停', t => {
  const dir = tmp(t);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stopped.flag'), '{}');
  const panic = createPanic({ dir, adapters: [], logger: quiet });
  assert.equal(panic.isStopped(), true);
  assert.equal(panic.status().ok, false);
});

test('停机状态写不进磁盘：state 步骤如实失败', async t => {
  const dir = tmp(t);
  const panic = createPanic({ dir, adapters: [], logger: quiet });
  fs.mkdirSync(path.join(dir, 'state.json'), { recursive: true });
  const result = await panic.stop();
  assert.equal(result.steps.state.status, 'failed');
  assert.equal(result.state, 'partial');
  assert.equal(markerPresent(panic.markerFile), true);
});

test('配置：坏值回落到暂定默认值，timers 过滤非法名与自己', () => {
  const config = resolvePanicConfig({
    stepTimeoutMs: -1,
    verifyWaitMs: 'x',
    timers: ['meetings', 'panic', '../x', 'a b'],
  });
  assert.equal(config.stepTimeoutMs, PANIC_DEFAULTS.stepTimeoutMs);
  assert.equal(config.verifyWaitMs, PANIC_DEFAULTS.verifyWaitMs);
  assert.deepEqual(config.timers, ['meetings']);
  assert.deepEqual(resolvePanicConfig(undefined).timers, [...PANIC_DEFAULTS.timers]);
});
