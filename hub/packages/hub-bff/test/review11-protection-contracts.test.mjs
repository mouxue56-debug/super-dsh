import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planSync } from '../lib/board-relay.mjs';
import { main } from '../bin/hub-handoff.mjs';
import { run } from '../../../tools/runner/hub-runner.mjs';

test('R11-901 同步规划器不能仅凭进行中状态推断主人已放行', () => {
  const ticket = {
    state: 'waiting-human',
    review: 'none',
    relay: {
      phase: 'gate',
      current: 0,
      steps: [{ who: { name: 'writer', type: 'assistant' }, status: 'done', gate: true }],
    },
  };

  assert.equal(planSync(ticket), null, '正在等待主人时应保留关口');
  assert.equal(planSync({ ...ticket, state: 'progress' }), null, '普通状态字段不能证明主人已确认');
});

test('R11-906 领单回执的卡号不一致时不得建立任务目录或执行', async () => {
  const root = mkdtempSync(join(tmpdir(), 'review11-runner-identity-'));
  const config = {
    identity: 'codex', stateDir: join(root, 'state'), workRoot: join(root, 'work'),
    maxPerRun: 1, dailyLimit: 20, timeoutSec: 5, triageTimeoutSec: 5,
    board: { cli: ['FAKECLI'], configFile: join(root, 'unused-config.json') },
    rules: [], envPass: [], tiers: { luna: { model: 'fake-model', cmd: ['FAKEEXEC'] } },
  };
  const listed = { id: 'T-20261119-030000-Ab12', state: 'queued', title: '【简单】整理说明', goal: '写一行说明' };
  const taken = { ...listed, id: 'T-20261119-030001-Cd34', state: 'progress' };
  const calls = [];
  const reply = payload => ({ code: 0, stdout: JSON.stringify(payload), stderr: '' });
  const exec = async cmd => {
    calls.push(cmd);
    if (cmd[0] === 'FAKEEXEC') return reply({});
    assert.equal(cmd[0], 'FAKECLI');
    if (cmd[1] === 'mine') return reply({ ok: true, tickets: [listed] });
    if (cmd[1] === 'take') return reply({ ok: true, ticket: taken });
    return reply({ ok: true });
  };

  await run(config, { exec, env: {}, out: { write() {} }, now: () => new Date('2026-11-19T03:00:00Z') });

  assert.deepEqual({
    directories: readdirSync(config.workRoot),
    executed: calls.some(cmd => cmd[0] === 'FAKEEXEC'),
    delivered: calls.some(cmd => cmd[0] === 'FAKECLI' && cmd[1] === 'deliver'),
  }, { directories: [], executed: false, delivered: false }, '卡号未匹配，不应处理任务');
});

test('R11-909 CLI 的拒绝和未找到诊断不得显示当前令牌', async () => {
  const testToken = 'review11-fake-marker';
  const failures = [];
  for (const [status, expectedCode] of [[403, 3], [404, 5]]) {
    let stderr = '';
    const code = await main(['mine'], { HUB_BOARD_URL: 'http://127.0.0.1:0/board', HUB_BOARD_TOKEN: testToken }, {
      fetch: async () => ({ ok: false, status, json: async () => ({ error: { hint: `测试诊断 ${testToken}` } }) }),
      stdout: { write() {} },
      stderr: { write(text) { stderr += text; } },
    });
    assert.equal(code, expectedCode);
    assert.ok(stderr.trim(), '应保留可读的错误提示');
    if (stderr.includes(testToken)) failures.push(status);
  }
  assert.deepEqual(failures, [], '列出的 HTTP 状态会在标准错误里输出未脱敏的测试标记');
});
