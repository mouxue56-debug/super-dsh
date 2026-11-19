import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createBoard } from '../lib/board.mjs';
import {
  DISPATCH_DEFAULTS,
  FIXED_FORBIDDEN_LINE,
  composeBrief,
  createRunner,
  inspectDispatch,
  normalizeConfig,
  renderCardText,
} from '../lib/dispatch-runner.mjs';

const writer = { name: 'writer', type: 'assistant' };
const external = { name: 'codex', type: 'external' };
const approval = { by: 'card', id: 'approved' };
const fakeSource = `
import fs from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const argv = process.argv.slice(2);
fs.writeFileSync('received.json', JSON.stringify({ argv, cwd: process.cwd(), stdin: input,
  secret: process.env.SECRET_TOKEN_TEST ?? null }));
if (process.env.FAKE_IGNORE === '1') process.on('SIGTERM', () => {});
for (const file of (process.env.FAKE_TOUCH || '').split(',').filter(Boolean)) fs.writeFileSync(file, 'changed content');
for (const file of (process.env.FAKE_DELETE || '').split(',').filter(Boolean)) fs.unlinkSync(file);
console.log('fallback log message');
if (process.env.FAKE_NO_RESULT !== '1') fs.writeFileSync(argv[3], process.env.FAKE_MESSAGE || 'last message');
await new Promise(resolve => setTimeout(resolve, Number(process.env.FAKE_SLEEP_MS || 0)));
process.exit(Number(process.env.FAKE_EXIT || 0));
`;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, message = 'condition') {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for ${message}`);
}

function setup(t, options = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-test-'));
  const root = path.join(base, 'work');
  const runDir = path.join(base, 'runs');
  const fake = path.join(base, 'fake.mjs');
  const events = [];
  const board = createBoard({ root: path.join(base, 'board'), onEvent: event => events.push(event) });
  const records = [];
  const notices = [];
  const runners = [];
  const pids = new Set();
  fs.mkdirSync(root);
  fs.writeFileSync(fake, fakeSource);
  const raw = {
    root,
    run_dir: runDir,
    poll_ms: 0,
    heartbeat_ms: 100,
    lost_after_ms: 3000,
    timeout_ms: 10000,
    stop_wait_ms: 200,
    env_pass: ['FAKE_EXIT', 'FAKE_SLEEP_MS', 'FAKE_TOUCH', 'FAKE_DELETE', 'FAKE_IGNORE', 'FAKE_NO_RESULT',
      'FAKE_MESSAGE'],
    workers: { codex: { argv: [process.execPath, fake, '{model}', '{workdir}', '{brief_file}', '{result_file}'],
      models: ['m1'] } },
    ...options,
  };
  const config = normalizeConfig(raw);
  const makeRunner = (boardOverride = board) => {
    const runner = createRunner({ config, board: boardOverride, ledger: { record: v => records.push(v) },
      notify: v => notices.push(v), logger: {} });
    runners.push(runner);
    return runner;
  };
  const runner = makeRunner();
  t.after(async () => {
    for (const item of runners) item.dispose();
    for (const pid of pids) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    for (const pid of pids) await waitFor(() => !alive(pid), 'process cleanup');
  });
  const create = async (input = {}) => board.create(writer, {
    title: 'test',
    goal: 'do work',
    to: ['codex'],
    acceptance: [{ check: 'x', expect: 'y' }],
    routing: { requestedBy: 'writer', via: 'test', hint: '', model: 'm1' },
    ...input,
  });
  const start = async (ticket, extra = {}, target = runner) => {
    const result = await target.start({ ticketId: ticket.id, bot: 'writer', readExternal: false, approval, ...extra });
    if (result.run?.pid) pids.add(result.run.pid);
    return result;
  };
  const finish = async (run, target = runner) => {
    await waitFor(() => fs.existsSync(path.join(runDir, run.runId, 'exit')), 'worker exit');
    await target.collect();
    return target.get(run.runId);
  };
  return { base, root, runDir, fake, board, events, records, notices, config, runner,
    makeRunner, create, start, finish };
}

function noSpec(runDir) {
  const dirs = fs.existsSync(runDir) ? fs.readdirSync(runDir) : [];
  assert.equal(dirs.some(dir => fs.existsSync(path.join(runDir, dir, 'spec.json'))), false);
}

function withEnv(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

test('配置校验、默认值和费用键', t => {
  const s = setup(t);
  const base = { root: s.root, run_dir: s.runDir, workers: { codex: { argv: [process.execPath], models: ['m1'] } } };
  assert.throws(() => normalizeConfig({ ...base, root: undefined }));
  assert.throws(() => normalizeConfig({ ...base, workers: undefined }));
  for (const argv of [[process.execPath, '{unknown}'], ['{model}']]) {
    assert.throws(() => normalizeConfig({ ...base, workers: { codex: { argv, models: ['m1'] } } }));
  }
  for (const model of ['bad model', 'bad;model']) {
    const worker = { argv: [process.execPath], models: [model] };
    assert.throws(() => normalizeConfig({ ...base, workers: { codex: worker } }));
  }
  const config = normalizeConfig(base);
  const names = { timeout_ms: 'timeoutMs', grant_days: 'grantDays', card_text_max: 'cardTextMax',
    card_ttl_ms: 'cardTtlMs', poll_ms: 'pollMs', heartbeat_ms: 'heartbeatMs', lost_after_ms: 'lostAfterMs',
    stop_wait_ms: 'stopWaitMs', max_changed_files: 'maxChangedFiles', max_scan_entries: 'maxScanEntries',
    result_max_bytes: 'resultMaxBytes', env_pass: 'envPass' };
  for (const [key, value] of Object.entries(DISPATCH_DEFAULTS)) assert.deepEqual(config[names[key]], value);
  assert.equal(config.workers.codex.stdin, 'brief');
  assert.deepEqual(config.worktreeRoots, []);
  assert.deepEqual(config.denyPatterns, []);
  assert.equal(Object.keys(DISPATCH_DEFAULTS).some(key => /budget|limit|cost|price/iu.test(key)), false);
});

const rejections = [
  ['根外绝对路径', (s, x) => x.workdir = { path: s.base, writable: [] }, 'BAD_WORKDIR'],
  ['路径含上级目录', (s, x) => x.workdir = { path: `${s.root}/../outside`, writable: [] }, 'BAD_WORKDIR'],
  ['指向根外的符号链接', (s, x) => {
    fs.symlinkSync(s.base, path.join(s.root, x.id));
    x.workdir = { path: path.join(s.root, x.id), writable: [] };
  }, 'BAD_WORKDIR'],
  ['悬空符号链接', (s, x) => {
    fs.symlinkSync(path.join(s.base, 'missing'), path.join(s.root, x.id));
    x.workdir = { path: path.join(s.root, x.id), writable: [] };
  }, 'BAD_WORKDIR'],
  ['其他工单目录', (s, x) => {
    x.workdir = { path: path.join(s.root, 'other', 'sub'), writable: [] };
  }, 'BAD_WORKDIR'],
  ['外包根本身', (s, x) => x.workdir = { path: s.root, writable: [] }, 'BAD_WORKDIR'],
  ['可写路径在目录外', (s, x) => {
    x.workdir = { path: path.join(s.root, x.id), writable: [s.root] };
  }, 'BAD_WORKDIR'],
  ['模型未列入白名单', (s, x) => x.routing.model = 'm2', 'BAD_MODEL'],
  ['未指定模型', (s, x) => delete x.routing.model, 'BAD_MODEL'],
  ['工人未配置', (s, x) => x.to = ['unknown'], 'BAD_WORKER'],
  ['多个收件人', (s, x) => x.to = ['codex', 'other'], 'BAD_WORKER'],
  ['名册冲突', () => {}, 'BAD_WORKER', { rosterNames: ['codex'] }],
  ['空验收', (s, x) => x.acceptance = [], 'NO_ACCEPTANCE'],
  ['空检查', (s, x) => x.acceptance = [{ check: '', expect: 'y' }], 'NO_ACCEPTANCE'],
  ['空期望', (s, x) => x.acceptance = [{ check: 'x', expect: '' }], 'NO_ACCEPTANCE'],
  ['空任务书', (s, x) => x.goal = ' ', 'BAD_BRIEF'],
  ['不允许的状态', (s, x) => x.state = 'failed', 'BAD_STATE'],
  ['旧工单', (s, x) => x.legacy = true, 'BAD_STATE'],
  ['派单人名字不同', (s, x) => x.from.name = 'other', 'NOT_SENDER'],
  ['派单人类型不同', (s, x) => x.from.type = 'owner', 'NOT_SENDER'],
  ['额外禁词', (s, x) => x.goal = 'forbidden-marker', 'DENY_PATTERN'],
];

for (const word of ['.secrets', 'auth.json', '.ssh', 'id_rsa', '.credentials', '.env', '.dsh', '.sec\u200brets']) {
  for (const field of ['goal', 'forbidden', 'acceptance']) {
    rejections.push([`密钥路径 ${word} 在 ${field}`, (s, x) => {
      if (field === 'goal') x.goal = word;
      if (field === 'forbidden') x.forbidden = [word];
      if (field === 'acceptance') x.acceptance = [{ check: word, expect: 'y' }];
    }, 'SECRET_PATH']);
  }
}

const escalations = ['sudo', '提权', '绕过', 'bypass', 'dangerously', '忽略之前', 'ＳＵＤＯ', 'su\u200bdo'];

for (const word of escalations) {
  for (const field of ['goal', 'forbidden', 'acceptance']) {
    rejections.push([`提权文字 ${word} 在 ${field}`, (s, x) => {
      if (field === 'goal') x.goal = word;
      if (field === 'forbidden') x.forbidden = [word];
      if (field === 'acceptance') x.acceptance = [{ check: 'x', expect: word }];
    }, 'ESCALATION']);
  }
}

for (const [name, mutate, code, extra = {}] of rejections) {
  test(`第二道闸：${name}`, async t => {
    const s = setup(t, { extra_deny_patterns: ['forbidden-marker'] });
    const ticket = await s.create();
    const changed = structuredClone(ticket);
    mutate(s, changed);
    const direct = inspectDispatch({ ticket: changed, bot: 'writer', config: s.config, readExternal: false, ...extra });
    assert.equal(direct.ok, false);
    assert.equal(direct.code, code);
    const board = { ...s.board, get: async id => id === ticket.id ? changed : s.board.get(id) };
    const runner = s.makeRunner(board);
    const started = await s.start(ticket, extra, runner);
    assert.equal(started.code, code);
    noSpec(s.runDir);
  });
}

for (const [name, ticketTaint, readExternal] of [
  ['工单读过外部内容', true, false],
  ['会话读过外部内容', false, true],
  ['会话状态未明确', false, undefined],
]) {
  test(`第三道闸：${name}`, async t => {
    const s = setup(t);
    const ticket = await s.create({ readExternalContent: ticketTaint });
    assert.equal(inspectDispatch({ ticket, bot: 'writer', config: s.config, readExternal }).code, 'TAINTED');
    assert.equal((await s.start(ticket, { readExternal })).code, 'TAINTED');
    noSpec(s.runDir);
  });
}

for (const [name, value] of [['缺凭据', undefined], ['来源无效', { by: 'other', id: 'x' }],
  ['空编号', { by: 'grant', id: '' }]]) {
  test(`第一道闸：${name}`, async t => {
    const s = setup(t);
    const ticket = await s.create();
    assert.equal((await s.start(ticket, { approval: value })).code, 'NO_APPROVAL');
    noSpec(s.runDir);
  });
}

test('正常文字、任务书次序和确认卡', async t => {
  const s = setup(t);
  const ticket = await s.create({ goal: 'process.env and config.json', forbidden: ['不改别处'] });
  const sentBack = { ...ticket, review: 'sent_back', progress: [{ by: 'writer', text: '请修正' }] };
  const brief = composeBrief(sentBack);
  const parts = [FIXED_FORBIDDEN_LINE, '【本单禁项】', '【验收清单】', '【任务书】', '请修正'];
  let position = -1;
  for (const part of parts) {
    const next = brief.indexOf(part);
    assert.ok(next > position);
    position = next;
  }
  const result = inspectDispatch({ ticket, bot: 'writer', config: s.config, readExternal: false });
  assert.equal(result.ok, true);
  const card = renderCardText(result.spec, 10000);
  for (const value of ['codex', 'm1', result.spec.workdir, result.spec.brief]) assert.ok(card.includes(value));
  assert.equal(renderCardText(result.spec, 1), null);
  const resumed = { ...sentBack, state: 'progress', claimedBy: 'codex', claimedByType: 'external' };
  assert.equal(inspectDispatch({ ticket: resumed, bot: 'writer', config: s.config, readExternal: false }).ok, true);
});

test('参数原样传递且不经 shell，工作树名称含特殊字符', async t => {
  const tree = path.join(os.tmpdir(), `tree space ' ; ${Date.now()}-${process.pid}`);
  fs.mkdirSync(tree);
  const s = setup(t, { worktree_roots: [tree] });
  const goal = `single ' double " ; \`echo hi\` $(touch PWNED) &&\n*`;
  for (const dir of [null, tree]) {
    const ticket = await s.create({ goal, ...(dir ? { workdir: { path: dir, writable: [dir] } } : {}) });
    const result = await s.start(ticket);
    assert.equal(result.ok, true);
    await s.finish(result.run);
    const runDir = path.join(s.runDir, result.run.runId);
    const received = JSON.parse(fs.readFileSync(path.join(result.run.workdir, 'received.json')));
    assert.equal(received.stdin, fs.readFileSync(path.join(runDir, 'brief.md'), 'utf8'));
    assert.ok(received.stdin.includes(goal));
    assert.deepEqual(received.argv, ['m1', result.run.workdir, path.join(runDir, 'brief.md'),
      path.join(runDir, 'result.txt')]);
    assert.equal(received.cwd, fs.realpathSync(dir || result.run.workdir));
    for (const target of [result.run.workdir, s.base, process.cwd()]) {
      assert.equal(fs.existsSync(path.join(target, 'PWNED')), false);
    }
  }
});

test('超时不杀进程，自然结束后恢复并报告', async t => {
  withEnv(t, { FAKE_SLEEP_MS: '3000' });
  const s = setup(t, { timeout_ms: 120 });
  const ticket = await s.create();
  const { run } = await s.start(ticket);
  await waitFor(async () => {
    await s.runner.collect();
    return s.runner.get(run.runId).status === 'timeout';
  }, 'timeout');
  assert.equal(s.runner.get(run.runId).timedOut, true);
  assert.equal(alive(run.pid), true);
  assert.equal((await s.board.get(ticket.id)).state, 'waiting-timeout');
  assert.equal(s.notices.filter(item => item.kind === 'timeout').length, 1);
  const final = await s.finish(run);
  const updated = await s.board.get(ticket.id);
  assert.equal(final.status, 'done');
  assert.equal(final.timedOut, true);
  assert.equal(updated.state, 'progress');
  assert.equal(updated.review, 'submitted');
  assert.ok(updated.history.find(item => item.action === 'resumed'));
});

test('成功回收、文件差异、记账和运行目录', async t => {
  withEnv(t, { FAKE_TOUCH: 'new.txt,changed.txt', FAKE_DELETE: 'deleted.txt', SECRET_TOKEN_TEST: 'hidden' });
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-tree-'));
  fs.writeFileSync(path.join(tree, 'changed.txt'), 'old');
  fs.writeFileSync(path.join(tree, 'deleted.txt'), 'old');
  fs.writeFileSync(path.join(tree, 'unchanged.txt'), 'old');
  const s = setup(t, { worktree_roots: [tree] });
  const ticket = await s.create({ workdir: { path: tree, writable: [tree] } });
  const { run } = await s.start(ticket);
  assert.equal((await s.finish(run)).status, 'done');
  const report = (await s.board.get(ticket.id)).reports.at(-1);
  assert.equal(report.selfReported, true);
  const summaryParts = ['【外部工人自述，未验证】', 'codex', 'm1', '退出码 0', run.runId,
    'last message'];
  for (const value of summaryParts) {
    assert.ok(report.summary.includes(value));
  }
  for (const value of ['new.txt', 'changed.txt', 'deleted.txt（已删除）']) {
    assert.ok(report.artifacts.includes(value));
  }
  assert.equal(report.artifacts.includes('unchanged.txt'), false);
  const dir = path.join(s.runDir, run.runId);
  for (const file of ['brief.md', 'spec.json', 'state.json', 'pid', 'log', 'exit']) {
    assert.equal(fs.existsSync(path.join(dir, file)), true);
  }
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'spec.json')));
  assert.ok(Object.keys(spec.env).every(key => s.config.envPass.includes(key)));
  assert.equal(spec.env.SECRET_TOKEN_TEST, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tree, 'received.json'))).secret, null);
  await s.runner.collect();
  assert.equal(s.records.length, 1);
  assert.deepEqual({ kind: s.records[0].kind, tokens: s.records[0].tokens, worker: s.records[0].worker,
    workerModel: s.records[0].workerModel, exitCode: s.records[0].exitCode },
  { kind: 'dispatch', tokens: null, worker: 'codex', workerModel: 'm1', exitCode: 0 });
  assert.ok(s.records[0].wallMs >= 0);
});

test('非零退出不重试', async t => {
  withEnv(t, { FAKE_EXIT: '3' });
  const s = setup(t);
  const ticket = await s.create();
  const { run } = await s.start(ticket);
  assert.equal((await s.finish(run)).status, 'failed');
  assert.equal((await s.board.get(ticket.id)).state, 'failed');
  await s.runner.collect();
  assert.equal(s.runner.list().filter(item => item.ticket === ticket.id).length, 1);
});

test('不存在的工人程序失败', async t => {
  const missing = path.join(os.tmpdir(), `missing-worker-${process.pid}-${Date.now()}`);
  const s = setup(t, { workers: { codex: { argv: [missing], models: ['m1'] } } });
  const ticket = await s.create();
  const { run } = await s.start(ticket);
  assert.equal((await s.finish(run)).status, 'failed');
  assert.equal((await s.board.get(ticket.id)).state, 'failed');
});

test('结果文件缺失时使用日志末尾', async t => {
  withEnv(t, { FAKE_NO_RESULT: '1' });
  const s = setup(t);
  const ticket = await s.create();
  const { run } = await s.start(ticket);
  await s.finish(run);
  assert.match((await s.board.get(ticket.id)).report.summary, /fallback log message/u);
});

test('长消息截断且改动数超过上限时注明总数', async t => {
  withEnv(t, { FAKE_MESSAGE: '猫'.repeat(5000), FAKE_TOUCH: 'a,b,c' });
  const s = setup(t, { max_changed_files: 2, result_max_bytes: 12000 });
  const ticket = await s.create();
  const { run } = await s.start(ticket);
  await s.finish(run);
  const report = (await s.board.get(ticket.id)).reports.at(-1);
  assert.ok(Buffer.byteLength(report.summary) <= 2048);
  assert.match(report.summary, /改动文件共 4 个，仅列前 2/u);
  assert.equal(report.artifacts.length, 2);
});

test('同目录互斥及释放', async t => {
  withEnv(t, { FAKE_SLEEP_MS: '600' });
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-lock-'));
  const s = setup(t, { worktree_roots: [tree] });
  const first = await s.create({ workdir: { path: tree, writable: [] } });
  const second = await s.create({ workdir: { path: tree, writable: [] } });
  const a = await s.start(first);
  const busy = await s.start(second);
  assert.equal(busy.code, 'BUSY');
  assert.equal((await s.board.get(second.id)).state, 'queued');
  assert.equal(s.runner.list().length, 1);
  const specs = fs.readdirSync(s.runDir).filter(dir => fs.existsSync(path.join(s.runDir, dir, 'spec.json')));
  assert.equal(specs.length, 1);
  await s.finish(a.run);
  const b = await s.start(second);
  assert.equal(b.ok, true);
  await s.finish(b.run);
});

// 期望返回 existing；实际先检查已领取工单，返回 BAD_STATE。
test('同一工单重复启动应复用运行', async t => {
  withEnv(t, { FAKE_SLEEP_MS: '600' });
  const s = setup(t);
  const ticket = await s.create();
  const first = await s.start(ticket);
  const again = await s.start(ticket);
  assert.equal(again.existing, true);
  assert.equal(again.run.runId, first.run.runId);
  assert.equal(s.runner.list().length, 1);
  await s.finish(first.run);
});

test('重启后认回运行中工人并回收', async t => {
  withEnv(t, { FAKE_SLEEP_MS: '500' });
  const s = setup(t);
  const ticket = await s.create();
  const { run } = await s.start(ticket);
  s.runner.dispose();
  const next = s.makeRunner();
  await next.recover();
  assert.equal(next.listRunning().some(item => item.runId === run.runId), true);
  assert.equal((await s.finish(run, next)).status, 'done');
  assert.equal((await s.board.get(ticket.id)).review, 'submitted');
});

test('重启时已有退出文件则立即回收', async t => {
  const s = setup(t);
  const ticket = await s.create();
  const { run } = await s.start(ticket);
  s.runner.dispose();
  await waitFor(() => fs.existsSync(path.join(s.runDir, run.runId, 'exit')), 'exit');
  const next = s.makeRunner();
  await next.recover();
  assert.equal(next.get(run.runId).status, 'done');
  assert.equal((await s.board.get(ticket.id)).review, 'submitted');
});

test('进程消失且没有退出文件时标记 lost', async t => {
  withEnv(t, { FAKE_SLEEP_MS: '3000' });
  const s = setup(t);
  const ticket = await s.create();
  const { run } = await s.start(ticket);
  await waitFor(() => fs.existsSync(path.join(s.runDir, run.runId, 'child.pid')), 'child start');
  s.runner.dispose();
  process.kill(-run.pid, 'SIGKILL');
  await waitFor(() => !alive(run.pid), 'killed wrapper');
  const next = s.makeRunner();
  await next.recover();
  assert.equal(next.get(run.runId).status, 'lost');
  assert.equal((await s.board.get(ticket.id)).state, 'uncertain');
});

test('一键全停多个工人', async t => {
  withEnv(t, { FAKE_SLEEP_MS: '3000' });
  const s = setup(t, { stop_wait_ms: 1000 });
  const tickets = [await s.create(), await s.create()];
  const a = await s.start(tickets[0]);
  const b = await s.start(tickets[1]);
  for (const run of [a.run, b.run]) {
    await waitFor(() => fs.existsSync(path.join(s.runDir, run.runId, 'child.pid')), 'child start');
  }
  assert.equal(s.runner.listRunning().length, 2);
  const stopped = await s.runner.stopAll();
  assert.deepEqual(stopped.stopped.sort(), [a.run.runId, b.run.runId].sort());
  assert.deepEqual(stopped.stillRunning, []);
  for (const ticket of tickets) {
    const value = await s.board.get(ticket.id);
    assert.equal(value.state, 'failed');
    const event = s.events.find(item => item.type === 'failed' && item.id === ticket.id);
    assert.match(event.reason, /一键全停/u);
  }
  for (const run of [a.run, b.run]) await waitFor(() => !alive(run.pid), 'stopped process');
});

test('忽略 SIGTERM 的工人须明确 kill', async t => {
  withEnv(t, { FAKE_SLEEP_MS: '3000', FAKE_IGNORE: '1' });
  const s = setup(t, { stop_wait_ms: 200 });
  const ticket = await s.create();
  const { run } = await s.start(ticket);
  await waitFor(() => fs.existsSync(path.join(run.workdir, 'received.json')), 'worker ready');
  const first = await s.runner.stopAll();
  assert.deepEqual(first.stillRunning, [run.runId]);
  assert.equal(alive(run.pid), true);
  const second = await s.runner.stopAll({ kill: true });
  assert.deepEqual(second.stillRunning, []);
  assert.ok(second.stopped.includes(run.runId));
  await waitFor(() => !alive(run.pid), 'killed process');
});

// 进程号还在但心跳早断了（进程号可能被别的进程复用）：标丢失，绝不向它发信号。
test('心跳断了的活进程被当作丢失，不被误杀', async t => {
  const s = setup(t, { lost_after_ms: 300 });
  const ticket = await s.create();
  await s.board.claim(external, ticket.id);
  const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { detached: true, stdio: 'ignore' });
  bystander.unref();
  t.after(() => {
    try {
      process.kill(-bystander.pid, 'SIGKILL');
    } catch {
      // 已经没了
    }
  });
  const runId = 'D-20260101000000-abcd';
  const dir = path.join(s.runDir, runId);
  const workdir = path.join(s.root, ticket.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ v: 1, runId, dir, ticket: ticket.id, bot: 'writer',
    sessionId: null, worker: 'codex', model: 'm1', workdir, briefSha: 'x', approval, startedAt: Date.now() - 60000,
    timeoutMs: 10000, status: 'running', timedOut: false, pid: bystander.pid }));
  fs.writeFileSync(path.join(dir, 'pid'), String(bystander.pid));
  fs.writeFileSync(path.join(dir, 'beat'), '1');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(dir, 'beat'), old, old);
  const next = s.makeRunner();
  await next.recover();
  assert.equal(next.get(runId).status, 'lost');
  assert.equal(alive(bystander.pid), true);
  assert.equal((await s.board.get(ticket.id)).state, 'uncertain');
  assert.deepEqual((await next.stopAll()).stopped, []);
  assert.equal(alive(bystander.pid), true);
});
