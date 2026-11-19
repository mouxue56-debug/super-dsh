import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../hub-runner.mjs';

function makeFifo(path) {
  const made = spawnSync('mkfifo', [path]);
  if (made.status !== 0) throw new Error('mkfifo 失败');
}

function layout(name) {
  const root = mkdtempSync(join(tmpdir(), `fixq-${name}-`));
  const outside = mkdtempSync(join(tmpdir(), `fixq-${name}-out-`));
  const work = join(root, 'work');
  mkdirSync(work);
  const config = {
    identity: 'codex', stateDir: join(root, 'state'), workRoot: work,
    maxPerRun: 1, dailyLimit: 20, timeoutSec: 5, triageTimeoutSec: 5,
    denyPattern: '付款|删除|密钥|令牌',
    board: { cli: ['FAKECLI'], configFile: join(root, 'unused.json') },
    rules: [], envPass: [],
    tiers: { luna: { model: 'fake-model', cmd: ['FAKEEXEC', '{last}'] } },
  };
  return { outside, work, config };
}

function fakeBoard(ticket, onExec) {
  const calls = [];
  const exec = async (cmd, opts) => {
    calls.push({ cmd, cwd: opts?.cwd });
    if (cmd[0] === 'FAKECLI') {
      if (cmd[1] === 'mine' || cmd[1] === 'take') {
        return { code: 0, stdout: JSON.stringify({ ok: true, tickets: [ticket], ticket }), stderr: '' };
      }
      return { code: 0, stdout: '{"ok":true}', stderr: '' };
    }
    assert.equal(cmd[0], 'FAKEEXEC');
    const stdout = (onExec && onExec(cmd, opts)) || '';
    return { code: 0, stdout, stderr: '', timedOut: false };
  };
  return { calls, deps: { exec, env: {}, out: { write() {} } } };
}

test('点名产物若是指向工作根外的符号链接，则不交回也不读取外部内容', async () => {
  const { outside, work, config } = layout('artifact');
  const marker = '外部机密不应被读取-FIXQ907';
  writeFileSync(join(outside, 'secret.md'), marker + '\n');
  const ticket = { id: 'T-1', state: 'queued', title: '【简单】写说明', goal: '保存 result.md', done: 'result.md 存在' };
  const { calls, deps } = fakeBoard(ticket, (_cmd, opts) => {
    symlinkSync(join(outside, 'secret.md'), join(opts.cwd, 'result.md'));
    writeFileSync(join(opts.cwd, '.last.md'), '只写了链接\n');
  });
  const result = await run(config, deps);
  assert.deepEqual(result.delivered, []);
  assert.equal(calls.filter(c => c.cmd[1] === 'deliver').length, 0);
  assert.equal(JSON.stringify(calls).includes(marker), false);
  const reply = join(work, 'T-1', '回复.md');
  if (existsSync(reply)) assert.equal(readFileSync(reply, 'utf8').includes(marker), false);
  assert.equal(readFileSync(join(outside, 'secret.md'), 'utf8'), marker + '\n');
});

test('交回证据不收录符号链接、特殊文件和越界路径', async () => {
  const { outside, work, config } = layout('evidence');
  const marker = '证据不应带出-FIXQ907';
  writeFileSync(join(outside, 'leak.md'), marker + '\n');
  const ticket = { id: 'T-1', state: 'queued', title: '【简单】写说明', goal: '保存 result.md', done: 'result.md 存在' };
  const { calls, deps } = fakeBoard(ticket, (_cmd, opts) => {
    writeFileSync(join(opts.cwd, 'result.md'), '# 真实产物\n');
    symlinkSync(join(outside, 'leak.md'), join(opts.cwd, 'leak.md'));
    makeFifo(join(opts.cwd, 'pipe.fifo'));
    writeFileSync(join(opts.cwd, '.last.md'), '写完了\n');
  });
  const result = await run(config, deps);
  assert.deepEqual(result.delivered, ['T-1']);
  const deliver = calls.find(c => c.cmd[1] === 'deliver').cmd;
  const evidence = [];
  for (let i = 0; i < deliver.length; i += 1) if (deliver[i] === '--evidence') evidence.push(deliver[i + 1]);
  assert.ok(evidence.length > 0);
  const taskReal = realpathSync(join(work, 'T-1'));
  const outsideReal = realpathSync(outside);
  for (const file of evidence) {
    const st = lstatSync(file);
    assert.equal(st.isSymbolicLink(), false);
    assert.equal(st.isFile(), true);
    const real = realpathSync(file);
    assert.ok(real === taskReal || real.startsWith(taskReal + '/'));
    assert.equal(real === outsideReal || real.startsWith(outsideReal + '/'), false);
    assert.equal(readFileSync(file, 'utf8').includes(marker), false);
  }
  assert.equal(deliver.join('\n').includes(marker), false);
  assert.equal(evidence.some(file => file.endsWith('pipe.fifo') || file.endsWith('leak.md')), false);
});

test('收图不跟随符号链接，外部图片不会被复制进任务目录', async () => {
  const { outside, work, config } = layout('collect');
  const images = join(work, 'incoming');
  const session = join(images, 'sess1');
  mkdirSync(session, { recursive: true });
  const marker = 'PNG-EXTERNAL-FIXQ907';
  writeFileSync(join(outside, 'ext.png'), marker);
  config.tiers = {
    image: { model: 'fake-image', cmd: ['FAKEEXEC'], collectImagesFrom: [join(images, '{session}')] },
  };
  const ticket = { id: 'T-1', state: 'queued', title: '【出图】海报', goal: '出一张图' };
  const { calls, deps } = fakeBoard(ticket, (_cmd, opts) => {
    writeFileSync(join(session, 'ok.png'), 'PNGOK');
    symlinkSync(join(outside, 'ext.png'), join(session, 'bad.png'));
    writeFileSync(join(opts.cwd, '.last.md'), '图好了\n');
    return 'session id: sess1\n';
  });
  const result = await run(config, deps);
  assert.deepEqual(result.delivered, ['T-1']);
  const task = join(work, 'T-1');
  assert.equal(readFileSync(join(task, 'ok.png'), 'utf8'), 'PNGOK');
  assert.equal(existsSync(join(task, 'bad.png')), false);
  assert.equal(readFileSync(join(outside, 'ext.png'), 'utf8'), marker);
  assert.equal(JSON.stringify(calls).includes(marker), false);
});

test('任务目录本身是指向外部的符号链接时，不执行也不往外写', async () => {
  const { outside, work, config } = layout('taskdir');
  symlinkSync(outside, join(work, 'T-1'));
  const ticket = { id: 'T-1', state: 'queued', title: '【简单】写说明', goal: '保存 result.md', done: 'result.md 存在' };
  const { calls, deps } = fakeBoard(ticket, () => { throw new Error('不应执行'); });
  const result = await run(config, deps);
  assert.deepEqual(result.delivered, []);
  assert.equal(calls.some(c => c.cmd[0] === 'FAKEEXEC'), false);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(lstatSync(join(work, 'T-1')).isSymbolicLink(), true);
});
