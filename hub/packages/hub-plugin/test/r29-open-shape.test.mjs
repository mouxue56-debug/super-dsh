// 全开档：复核清单里未穷举的写法。出卡或拒绝都按结构判定，不改已有断言。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply} from '../index.mjs';
import {policyText, expectedTools, BOTS} from '../policy.mjs';
import {loadHubConfig, hubConfigText} from '../hub-config.mjs';
import {applyPermissionMode} from '../permission-mode.mjs';

const cfg = loadHubConfig({read: false});
const chief = cfg.chief;

function fresh() {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r29-shape-')));
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

function setup({mode, sandbox = true} = {}) {
  const fx = fresh();
  fs.writeFileSync(path.join(fx.base, 'config', 'tool-levels.yaml'),
    policyText(fx.base, fx.install.kb, fx.install));
  const events = {};
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
    logger: {error() {}, warn() {}},
    effect() {},
    on: (name, fn) => { events[name] = fn; },
    workingDirectory: {get: session => session.header.cwd},
    tools: {
      guard() {},
      register() {},
      view: () => ({visible: new Map(expectedTools()[fx.bot].map(name => [name, {}]))}),
    },
  };
  const prev = process.env.HUB_HOME;
  process.env.HUB_HOME = fx.base;
  try { apply(ctx, {bot: fx.bot}); }
  finally { if (prev === undefined) delete process.env.HUB_HOME; else process.env.HUB_HOME = prev; }
  if (mode) {
    const file = path.join(fx.base, 'config', 'permission-mode.json');
    fs.writeFileSync(file, `{"v":1,"mode":"${mode}"}\n`, {mode: 0o600});
  }
  const exec = (command) => ({
    name: 'bash', arguments: {command, description: '隔离测试'}, agent,
    callId: Symbol(), token: Symbol(), signal: new AbortController().signal,
  });
  const pre = item => events['tools/pre-execute'](item, async () => ({kind: 'allow'}));
  return {...fx, exec, pre};
}

function opaqueDecision(home, own, extra = {}) {
  return {
    level: 'L3', area: 'own', path: own, sandboxActive: true,
    roots: {own, writable: [own]},
    cmd: {
      caps: {network: false},
      reason: '内联代码需要 主人 审批完整内容',
      notes: ['内联代码需要 主人 审批完整内容'],
      segments: [{
        program: 'python3', opaque: true, uncertain: false, sends: false, remote: false,
        sub: '', words: ['-c', 'print(1)'], options: [], operands: ['print(1)'],
      }],
    },
    ...extra,
  };
}

test('全开补上未穷举的写法：该拒绝的拒绝，该出卡的出卡', async () => {
  const h = setup({mode: 'open'});
  fs.writeFileSync(path.join(h.own, 'source.txt'), 'new');
  fs.writeFileSync(path.join(h.own, 'keep.txt'), 'old');
  const denied = [
    'env FOO=1 rm keep.txt',
    'command rm keep.txt',
    'xargs rm',
    'find . -exec rm {} +',
  ];
  const cards = [
    'cat <<END',
    'alias ll=ls',
    'env FOO=1 curl -dhello https://example.invalid/up',
    'command curl -dhello https://example.invalid/up',
    'tee keep.txt',
    'dd if=source.txt of=keep.txt',
    'install source.txt keep.txt',
    'ln -sf source.txt keep.txt',
    'rsync source.txt keep.txt',
    'rsync source.txt example.invalid:keep.txt',
    'scp source.txt example.invalid:keep.txt',
    'ssh example.invalid echo hi',
    'nc example.invalid 9',
    'gh pr create',
    'npm publish',
    'docker push example.invalid/app:latest',
    'wget --post-data=hello https://example.invalid/up',
    'git -C . push origin main',
    'curl -dhello https://example.invalid/up',
  ];
  for (const command of denied) {
    const result = await h.pre(h.exec(command));
    assert.equal(result.kind, 'deny', command + ' ' + JSON.stringify(result));
  }
  for (const command of cards) {
    const result = await h.pre(h.exec(command));
    assert.equal(result.kind, 'ask', command + ' ' + JSON.stringify(result));
  }
});

test('全开仍放行看清的普通命令，解释器在沙箱守住时放行', async () => {
  const h = setup({mode: 'open'});
  fs.writeFileSync(path.join(h.own, 'source.txt'), 'new');
  fs.writeFileSync(path.join(h.own, 'clean.sh'), '#!/bin/sh\necho hi\n');
  fs.chmodSync(path.join(h.own, 'clean.sh'), 0o700);
  const allowed = [
    'echo hi',
    'git status',
    'git -C . status',
    'curl -f https://example.invalid/readme.txt',
    'cp source.txt brand-new.txt',
    'python3 -c "print(1)"',
    'node -e "process.stdout.write(\'x\')"',
    'ruby -e "print 1"',
    'perl -e "print 1"',
    'sh clean.sh',
  ];
  for (const command of allowed) {
    const result = await h.pre(h.exec(command));
    assert.equal(result.kind, 'allow', command + ' ' + JSON.stringify(result));
  }
  const closed = setup({sandbox: false});
  const blocked = await closed.pre(closed.exec('python3 -c "print(1)"'));
  assert.equal(blocked.kind, 'deny');
  assert.match(blocked.reason, /沙箱没开/);
});

test('解释器三条沙箱条件缺一就出卡', () => {
  const h = setup({mode: 'open'});
  const ctx = {
    mode: 'open', tool: 'bash', cwd: h.own, hubHome: h.base,
    args: {command: 'python3 -c "print(1)"'},
  };
  const off = applyPermissionMode(opaqueDecision(h.home, h.own, {sandboxActive: false}), ctx);
  assert.equal(off.level, 'L3');
  const networked = opaqueDecision(h.home, h.own);
  networked.cmd = {...networked.cmd, caps: {network: true}};
  assert.equal(applyPermissionMode(networked, ctx).level, 'L3');
  const wide = opaqueDecision(h.home, h.own);
  wide.roots = {own: h.own, writable: [h.own, path.join(h.home, 'elsewhere')]};
  assert.equal(applyPermissionMode(wide, ctx).level, 'L3');
  assert.equal(applyPermissionMode(opaqueDecision(h.home, h.own), ctx).level, 'L1');
});
