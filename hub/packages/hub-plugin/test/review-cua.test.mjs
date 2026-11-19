// 路 10 独立复核（守门部分）：原样拷自复核员测试，断言未改。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, gateToolCall } from '../cua-gate.mjs';

// ---------- Cua 守门 ----------
const gateCfg = () => validateConfig({ grants: [{ assistant: 'a', app: 'Notes', until: '2099-01-01' }], protectedApps: ['Bank'] }).config;
const call = (extra) => ({ assistant: 'a', readExternal: false, windowText: '备忘录', ...extra });

test('review-cua-app-and-pid-must-agree', () => {
  const r = gateToolCall(call({ toolName: 'click', args: { app: 'Notes', pid: 99 }, pidApps: { 99: 'Bank' } }), gateCfg(), Date.now());
  assert.notEqual(r.decision, 'allow');
});

test('review-cua-batch-step-with-two-action-keys-must-not-be-allowed', () => {
  const step = { click: { app: 'Notes' }, launch_app: { name: 'Bank' } };
  const r = gateToolCall(call({ toolName: 'run_steps', args: { steps: [step] } }), gateCfg(), Date.now());
  assert.notEqual(r.decision, 'allow');
});

test('review-cua-stop-words-must-cover-password-and-hyphenated-sign-in', () => {
  for (const windowText of ['Enter your password', 'Sign-in required', 'パスワードを入力']) {
    const r = gateToolCall(call({ toolName: 'type_text', args: { app: 'Notes' }, windowText }), gateCfg(), Date.now());
    assert.equal(r.decision, 'stop', `「${windowText}」没有停下`);
  }
});

test('review-cua-write-without-window-text-must-not-be-allowed', () => {
  const r = gateToolCall({ assistant: 'a', readExternal: false, toolName: 'type_text', args: { app: 'Notes' } }, gateCfg(), Date.now());
  assert.notEqual(r.decision, 'allow');
});
