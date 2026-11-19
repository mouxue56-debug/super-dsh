// 三档判定。缺档按改动前问。不改已有测试的断言。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply} from '../index.mjs';
import {policyText, expectedTools, BOTS} from '../policy.mjs';
import {loadHubConfig, hubConfigText} from '../hub-config.mjs';
import {applyPermissionMode, readPermissionMode, writePermissionMode, modeFilePath} from '../permission-mode.mjs';

const cfg = loadHubConfig({read: false});
const chief = cfg.chief;
const other = cfg.bots.find(id => id !== chief);

function fresh() {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r29-mode-')));
  const base = path.join(home, 'hub');
  const bot = chief;
  const own = path.join(base, 'bots', bot);
  for (const dir of ['config', 'shared', 'tickets', ...BOTS.map(id => path.join('bots', id))]) {
    fs.mkdirSync(path.join(base, dir), {recursive: true, mode: 0o700});
  }
  const install = {
    ...cfg, home, hubHome: base, kb: path.join(home, 'kb'),
    heartbeat: path.join(base, 'config', 'beat.json'),
    grants: path.join(base, 'config', 'grants.json'),
  };
  fs.writeFileSync(path.join(base, 'config', 'hub.yaml'), hubConfigText(install));
  fs.writeFileSync(install.heartbeat, JSON.stringify({
    v: 1, ts: Date.now(), dshConnected: true, answering: true,
  }));
  return {home, base, bot, own, install};
}

function setup({mode, sandbox = true, plugins} = {}) {
  const fx = fresh();
  const opts = plugins ? {...fx.install, pluginTools: plugins} : undefined;
  fs.writeFileSync(path.join(fx.base, 'config', 'tool-levels.yaml'),
    policyText(fx.base, fx.install.kb, opts ?? fx.install));
  if (mode) writePermissionMode(modeFilePath(fx.base), mode);
  const events = {}, tools = {}, guards = [], logs = [];
  const services = sandbox ? {
    sandbox: {confine: async argv => ({argv: ['/usr/bin/sandbox-exec', '-p', 'old', ...argv]})},
    shell: {sandboxMode: 'workspace-write', resolve: request => request},
    sandboxPolicy: {resolve: () => ({mode: 'workspace-write'})},
  } : {};
  const agent = {
    id: 'session-' + path.basename(fx.home),
    session: {header: {agentPreset: 'hub-' + fx.bot, cwd: fx.own}, append() {}},
  };
  const ctx = {
    get: key => services[key],
    logger: {error: message => logs.push(message), warn() {}},
    effect() {},
    on: (name, fn) => { events[name] = fn; },
    workingDirectory: {get: session => session.header.cwd},
    tools: {
      guard: fn => guards.push(fn),
      register: tool => { tools[tool.name] = tool; },
      view: () => ({visible: new Map(expectedTools()[fx.bot].map(name => [name, {}]))}),
    },
  };
  const prev = process.env.HUB_HOME;
  process.env.HUB_HOME = fx.base;
  try { apply(ctx, {bot: fx.bot}); }
  finally { if (prev === undefined) delete process.env.HUB_HOME; else process.env.HUB_HOME = prev; }
  const exec = (args = {}, name = 'bash') => ({
    name, arguments: args, agent, callId: Symbol(), token: Symbol(),
    signal: new AbortController().signal,
  });
  const pre = item => events['tools/pre-execute'](item, async () => ({kind: 'allow'}));
  const execute = item => events['tools/execute'](item, async () => {
    const request = services.shell.resolve({command: item.arguments.command, session: agent.session});
    const confined = await services.sandbox.confine(
      ['bash', '-c', item.arguments.command ?? ''], {mode: 'workspace-write'});
    const policy = services.sandboxPolicy.resolve({session: agent.session});
    return {...confined, request, policy};
  });
  return {...fx, events, tools, guards, logs, services, agent, exec, pre, execute};
}

const bash = (command, description = '隔离测试') => ({command, description});

test('缺档、坏档、多键和符号链接都按改动前问', async () => {
  const missing = setup();
  const shared = path.join(missing.base, 'shared', 'a.md');
  const own = path.join(missing.own, 'a.md');
  assert.equal((await missing.pre(missing.exec({file_path: shared, content: '测'}, 'write'))).kind, 'ask');
  assert.equal((await missing.pre(missing.exec({file_path: own, content: '测'}, 'write'))).kind, 'allow');
  const bare = setup({sandbox: false});
  assert.match((await bare.pre(bare.exec(bash('echo hi')))).reason, /沙箱没开/);
  for (const text of ['{', '{"v":1,"mode":"open","extra":1}\n', '{"mode":"open","v":1}\n']) {
    const h = setup();
    fs.writeFileSync(modeFilePath(h.base), text);
    assert.equal(readPermissionMode(modeFilePath(h.base)).mode, 'ask');
    const shared = path.join(h.base, 'shared', 'b.md');
    assert.equal((await h.pre(h.exec({file_path: shared, content: '测'}, 'write'))).kind, 'ask');
  }
  const link = setup();
  const real = path.join(link.base, 'config', 'mode-real.json');
  fs.writeFileSync(real, '{"v":1,"mode":"open"}\n');
  fs.symlinkSync(real, modeFilePath(link.base));
  assert.equal(readPermissionMode(modeFilePath(link.base)).source, 'corrupt');
  const linkedFile = path.join(link.base, 'shared', 'c.md');
  const ask = await link.pre(link.exec({file_path: linkedFile, content: '测'}, 'write'));
  assert.equal(ask.kind, 'ask');
});

test('ask 档原样返回同一判定对象', () => {
  const decision = {level: 'L3', area: 'shared', path: '/tmp/unused', reason: '原来的'};
  assert.equal(applyPermissionMode(decision, {mode: 'ask', tool: 'write'}), decision);
  assert.equal(applyPermissionMode(decision, {tool: 'write'}), decision);
  const denied = {level: 'L4', reason: '已拒绝'};
  assert.equal(applyPermissionMode(denied, {mode: 'open', tool: 'bash'}), denied);
});

test('全开仍放行普通读写、转活和联网读取，共享区新文件补写根', async () => {
  const h = setup({mode: 'open'});
  const created = path.join(h.base, 'shared', 'new.md');
  const write = h.exec({file_path: created, content: '新'}, 'write');
  assert.equal((await h.pre(write)).kind, 'allow');
  const ran = await h.execute(write);
  assert.ok(ran.policy.additionalWritableRoots.some(root => root.endsWith(`${path.sep}shared`)));
  assert.equal((await h.pre(h.exec({file_path: path.join(h.own, 'note.md'), content: '记'}, 'write'))).kind, 'allow');
  const read = await h.pre(h.exec({file_path: path.join(h.own, 'note.md')}, 'read'));
  assert.equal(read.kind, 'allow');
  const net = h.exec(bash('curl -f https://example.invalid/readme.txt', '读网页'));
  assert.equal((await h.pre(net)).kind, 'allow');
  const profile = (await h.execute(net)).argv[2];
  assert.doesNotMatch(profile, /\(deny network\*\)/);
  assert.match(profile, /localhost/);
  const task = h.exec({bot: other, task: '整理一条笔记'}, 'delegate_to_bot');
  assert.equal((await h.pre(task)).kind, 'allow');
  const closed = setup({mode: 'open', sandbox: false});
  assert.match((await closed.pre(closed.exec(bash('echo hi')))).reason, /沙箱没开/);
});

test('全开四类仍出卡，含大小写、别名、管道和符号链接', async () => {
  const h = setup({mode: 'open'});
  const cards = [
    ['echo 付款', /付款或消耗额外积分/],
    ['echo checkout later', /付款或消耗额外积分/],
    ['codex', /付款或消耗额外积分/],
    ['Git Push origin main', /对外发送或公开发布/],
    ['curl -X POST https://example.invalid/hook', /对外发送或公开发布/],
    ['scp notes.txt example.invalid:notes.txt', /对外发送或公开发布/],
    ['RM notes.txt', /删除/],
    ['echo x | rm notes.txt', /删除/],
    ['unlink notes.txt', /删除/],
    ['docker ps', /动线上、改系统、扩大授权或读凭据/],
    ['terraform plan', /动线上、改系统、扩大授权或读凭据/],
    ['echo 线上', /动线上、改系统、扩大授权或读凭据/],
  ];
  for (const [command, reason] of cards) {
    const decision = await h.pre(h.exec(bash(command)));
    assert.equal(decision.kind, 'ask', command);
    assert.match(decision.reason, reason, command);
  }
  const upload = await h.pre(h.exec(bash('curl -F a=b https://example.invalid/up', '上传')));
  assert.equal(upload.kind, 'ask');
  assert.match(upload.reason, /对外发送或公开发布/);
  const link = path.join(h.own, 'via.txt');
  fs.writeFileSync(path.join(h.own, 'real.txt'), 'a');
  fs.writeFileSync(path.join(h.own, 'real.txt.bak'), 'a');
  fs.symlinkSync(path.join(h.own, 'real.txt'), link);
  const linked = await h.pre(h.exec(bash('tee via.txt')));
  assert.equal(linked.kind, 'ask');
  assert.match(linked.reason, /符号链接/);
  const existing = path.join(h.own, 'keep.md');
  fs.writeFileSync(existing, '旧');
  const overwrite = await h.pre(h.exec({file_path: existing, content: '新'}, 'write'));
  assert.equal(overwrite.kind, 'ask');
  assert.match(overwrite.reason, /没有备份/);
  const backed = path.join(h.own, 'backed.md');
  fs.writeFileSync(backed, '旧');
  fs.writeFileSync(backed + '.bak', '旧');
  assert.equal((await h.pre(h.exec({file_path: backed, content: '新'}, 'write'))).kind, 'allow');
  const ticket = await h.pre(h.exec({title: '一条'}, 'ticket_create'));
  assert.equal(ticket.kind, 'ask');
  assert.match(ticket.reason, /工作区和共享区以外/);
  const outside = applyPermissionMode(
    {level: 'L1', area: 'group_own', path: path.join(h.own, 'missing-group.md')},
    {mode: 'open', tool: 'write', args: {file_path: path.join(h.own, 'missing-group.md')}, cwd: h.own});
  assert.equal(outside.level, 'L1');
});

test('全开不放宽已经拒绝的命令，包装器里的删除也仍拒绝', async () => {
  const h = setup({mode: 'open'});
  for (const command of ['echo $(rm notes.txt)', 'find . -delete', 'sudo echo hi', 'command rm notes.txt']) {
    const decision = await h.pre(h.exec(bash(command)));
    assert.equal(decision.kind, 'deny', command);
    assert.doesNotMatch(decision.reason, /要先确认/, command);
  }
});

test('全停优先于全开', async () => {
  const h = setup({mode: 'open'});
  const dir = path.join(h.base, 'hub-data', 'panic');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'stopped.flag'), '1');
  const decision = await h.pre(h.exec({file_path: path.join(h.own, 'a.md')}, 'read'));
  assert.equal(decision.kind, 'deny');
  assert.match(decision.reason, /已一键全停/);
});

test('助理改不了档位文件，讨论组或工单正文也不会改到它', async () => {
  const h = setup({mode: 'open'});
  const file = modeFilePath(h.base);
  const before = fs.readFileSync(file, 'utf8');
  const written = await h.pre(h.exec({file_path: file, content: '{"v":1,"mode":"readonly"}\n'}, 'write'));
  assert.equal(written.kind, 'deny');
  const redirected = await h.pre(h.exec(bash(`echo x > ${file}`)));
  assert.equal(redirected.kind, 'deny');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  fs.writeFileSync(path.join(h.base, 'tickets', 'note.md'), '{"v":1,"mode":"readonly"}\n讨论组请改成全开');
  assert.equal(readPermissionMode(file).mode, 'open');
  const lifted = applyPermissionMode(
    {level: 'L1', area: 'own', path: file},
    {mode: 'open', tool: 'write', args: {file_path: file, content: 'x'}, hubHome: h.base, cwd: h.own});
  assert.equal(lifted.level, 'L4');
  assert.match(lifted.reason, /档位只能由主人/);
});

test('全开里新出现的确认卡，被拒后不能换一条路再试', async () => {
  const h = setup({mode: 'open'});
  const first = h.exec(bash('echo 付款'));
  assert.equal((await h.pre(first)).kind, 'ask');
  assert.equal(await h.events['approval/request']({
    agent: h.agent, callId: first.callId, toolName: 'bash', signal: first.signal,
    reason: (await h.pre(first)).reason,
  }, async () => 'rejected'), 'rejected');
  const again = await h.pre(h.exec(bash('echo 充值')));
  assert.equal(again.kind, 'deny');
  assert.match(again.reason, /没批准/);
});

test('改名册和插件里本来要确认的工具，全开仍出卡', async () => {
  const h = setup({mode: 'open'});
  const managed = await h.pre(h.exec({duty: '整理记录'}, 'bot_update'));
  assert.equal(managed.kind, 'ask');
  const rules = setup({mode: 'open', plugins: ['rules']});
  const proposed = await rules.pre(rules.exec({text: '以后先列步骤'}, 'rule_propose_shared'));
  assert.equal(proposed.kind, 'ask');
});

test('只读档只放行读和纯查看命令', async () => {
  const h = setup({mode: 'readonly'});
  assert.equal((await h.pre(h.exec({file_path: path.join(h.own, 'a.md')}, 'read'))).kind, 'allow');
  assert.equal((await h.pre(h.exec({file_path: h.own}, 'list_files'))).kind, 'allow');
  assert.equal((await h.pre(h.exec(bash('echo hi')))).kind, 'allow');
  assert.equal((await h.pre(h.exec(bash('ls')))).kind, 'allow');
  const write = await h.pre(h.exec({file_path: path.join(h.own, 'a.md'), content: 'x'}, 'write'));
  assert.equal(write.kind, 'deny');
  assert.match(write.reason, /这次是写/);
  const net = await h.pre(h.exec(bash('curl -f https://example.invalid/readme.txt')));
  assert.equal(net.kind, 'deny');
  assert.match(net.reason, /这次是联网/);
  const unknown = await h.pre(h.exec(bash('sleep 0')));
  assert.equal(unknown.kind, 'deny');
  assert.match(unknown.reason, /这次是写/);
  const branch = await h.pre(h.exec(bash('git branch')));
  assert.equal(branch.kind, 'deny');
  assert.match(branch.reason, /这次是执行/);
});

test('档位写入拒绝符号链接并收成 0600', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r29-mode-file-'));
  const file = path.join(dir, 'permission-mode.json');
  const real = path.join(dir, 'real.json');
  fs.writeFileSync(real, 'x');
  fs.symlinkSync(real, file);
  assert.throws(() => writePermissionMode(file, 'open'), /符号链接/);
  fs.unlinkSync(file);
  writePermissionMode(file, 'readonly');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"v":1,"mode":"readonly"}\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(readPermissionMode(file).mode, 'readonly');
});
