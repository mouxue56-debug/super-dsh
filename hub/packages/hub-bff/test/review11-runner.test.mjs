import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { run } from '../../../tools/runner/hub-runner.mjs';

// 所有看板和执行器调用均由假 exec 接管。配置文件路径只是占位，不创建或读取令牌文件。
function fixture({ ticket, artifact, failFirstDelivery = false }) {
  const root = mkdtempSync(join(tmpdir(), 'review11-runner-'));
  const calls = [];
  let deliveryCount = 0;
  const config = {
    identity: 'codex',
    stateDir: join(root, 'state'),
    workRoot: join(root, 'work'),
    maxPerRun: 1,
    dailyLimit: 20,
    timeoutSec: 5,
    triageTimeoutSec: 5,
    denyPattern: '付款|删除|密钥|令牌',
    board: { cli: ['FAKECLI'], configFile: join(root, 'unused-config.json') },
    rules: [],
    envPass: [],
    tiers: { luna: { model: 'fake-model', cmd: ['FAKEEXEC', '{last}'] } },
  };
  const exec = async (cmd, options) => {
    calls.push(cmd);
    if (cmd[0] === 'FAKECLI') {
      if (cmd[1] === 'mine') {
        return { code: 0, stdout: JSON.stringify({ ok: true, tickets: [ticket] }), stderr: '' };
      }
      if (cmd[1] === 'take') {
        return { code: 0, stdout: JSON.stringify({ ok: true, ticket }), stderr: '' };
      }
      if (cmd[1] === 'deliver') {
        deliveryCount += 1;
        if (failFirstDelivery && deliveryCount === 1) {
          return { code: 1, stdout: '', stderr: '暂时不可用' };
        }
      }
      return { code: 0, stdout: '{"ok":true}', stderr: '' };
    }
    assert.equal(cmd[0], 'FAKEEXEC', '不能启动真实执行器');
    const artifactName = typeof artifact === 'function' ? artifact(ticket) : artifact;
    if (artifactName) {
      const output = join(options.cwd, artifactName);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, '# 已完成的产物\n');
    }
    writeFileSync(cmd[1], '本次执行已结束。\n');
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  };
  const deps = { exec, env: {}, out: { write() {} }, now: () => new Date('2026-11-19T03:00:00Z') };
  return { config, deps, calls };
}

test('R11-201 合法子目录中的点名产物已经生成时应能交回', async () => {
  const setup = fixture({
    ticket: {
      id: 'T-R11-201', state: 'queued', title: '【简单】整理说明',
      goal: '写三行说明，保存到 reports/result.md', done: 'reports/result.md 存在',
    },
    artifact: 'reports/result.md',
  });
  const result = await run(setup.config, setup.deps);
  assert.deepEqual(result.delivered, ['T-R11-201'], '已存在的合法相对路径产物不应被误报缺失');
});

test('R11-202 接力产物已完成而交回瞬时失败时下次应重试交回', async () => {
  const setup = fixture({
    ticket: {
      id: 'T-R11-202', state: 'progress', title: '【简单】整理交接说明',
      goal: '保存 result.md', done: 'result.md 存在',
      relay: { index: 1, total: 2, task: '写三行说明' },
    },
    artifact: 'result.md',
    failFirstDelivery: true,
  });
  const first = await run(setup.config, setup.deps);
  assert.deepEqual(first.delivered, [], '首次实际未交回，不能标为已交回');
  assert.equal(setup.calls.filter(cmd => cmd[1] === 'deliver').length, 1);
  const second = await run(setup.config, setup.deps);
  assert.deepEqual(second.delivered, ['T-R11-202'], '暂时失败恢复后，已完成的接力产物应能重新交回');
  assert.equal(setup.calls.filter(cmd => cmd[0] === 'FAKEEXEC').length, 1, '重试交回应复用已有产物');
});

test('R11-203 主人验收退回的普通卡应按退回意见继续处理', async () => {
  const setup = fixture({
    ticket: {
      id: 'T-R11-203', state: 'progress', review: 'sent_back',
      title: '【简单】补全说明', goal: '保存 result.md', done: 'result.md 存在',
      answer: null, relay: null,
      notes: [{ by: 'owner', ts: '2026-11-19T02:59:00Z', text: '请补上最后一行说明' }],
    },
    artifact: 'result.md',
  });
  const result = await run(setup.config, setup.deps);
  assert.deepEqual(result.delivered, ['T-R11-203'], '验收退回是新的待办，应执行补做并重新交回');
});

test('R11-204 上一棒留下的同名产物不能充当这一棒的新产物', async () => {
  const ticket = {
    id: 'T-R11-204', state: 'progress', title: '【简单】编写说明',
    goal: '本棒更新 result.md', done: 'result.md 存在',
    relay: { index: 1, total: 2, task: '写说明初稿' },
  };
  const setup = fixture({ ticket, artifact: current => current.relay.index === 1 ? 'result.md' : null });
  const first = await run(setup.config, setup.deps);
  assert.deepEqual(first.delivered, [ticket.id]);
  ticket.relay = { index: 2, total: 2, task: '把说明更新成定稿' };
  const second = await run(setup.config, setup.deps);
  assert.deepEqual(second.took, [ticket.id], '第二棒是这张卡上独立的新任务');
  assert.deepEqual(second.delivered, [], '本棒未写出定稿，上一棒留下的初稿不能通过校验');
});
