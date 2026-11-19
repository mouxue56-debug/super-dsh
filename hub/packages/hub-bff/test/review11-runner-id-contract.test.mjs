import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ID_PATTERN } from '../lib/ticket.mjs';
import { run } from '../../../tools/runner/hub-runner.mjs';

test('R11-906 接单器应拒绝不符合看板格式的卡号', async () => {
  const root = mkdtempSync(join(tmpdir(), 'review11-runner-id-'));
  const config = {
    identity: 'codex', stateDir: join(root, 'state'), workRoot: join(root, 'work'),
    maxPerRun: 1, dailyLimit: 20, timeoutSec: 5, triageTimeoutSec: 5,
    board: { cli: ['FAKECLI'], configFile: join(root, 'unused-config.json') },
    rules: [], envPass: [], tiers: { luna: { model: 'fake-model', cmd: ['FAKEEXEC'] } },
  };
  const ticket = { id: 'draft-123', state: 'queued', title: '【简单】整理说明', goal: '写一行说明' };
  assert.match(ticket.id, /^[A-Za-z0-9-]+$/u);
  assert.doesNotMatch(ticket.id, ID_PATTERN);

  const observed = [];
  const reply = body => ({ code: 0, stdout: JSON.stringify(body), stderr: '' });
  const exec = async command => {
    const [program, action] = command;
    if (program === 'FAKEEXEC') {
      observed.push('execute');
      return reply({});
    }
    assert.equal(program, 'FAKECLI');
    if (action === 'mine') return reply({ tickets: [ticket] });
    observed.push(action);
    if (action === 'take') return reply({ ticket: { ...ticket, state: 'progress' } });
    return reply({});
  };

  await run(config, { exec, env: {}, out: { write() {} }, now: () => new Date('2026-11-19T03:00:00Z') });

  assert.deepEqual({ actions: observed, taskDirectories: readdirSync(config.workRoot) },
    { actions: [], taskDirectories: [] }, '卡号格式不合格时应在尝试领单和创建任务目录前跳过');
});
