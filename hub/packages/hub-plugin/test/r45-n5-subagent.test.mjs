// 分身工具按其余不拦。假的工具调用，不连本体。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.mjs';
import { policyText, expectedTools } from '../policy.mjs';
import { loadHubConfig, hubConfigText } from '../hub-config.mjs';
import { writePermissionMode, modeFilePath } from '../permission-mode.mjs';

const cfg = loadHubConfig({ read: false });
const bot = cfg.chief;

function fresh() {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r45-n5-')));
  const base = path.join(home, 'hub');
  const own = path.join(base, 'bots', bot);
  for (const dir of ['config', 'shared', 'tickets', ...cfg.bots.map((id) => path.join('bots', id))]) {
    fs.mkdirSync(path.join(base, dir), { recursive: true, mode: 0o700 });
  }
  const install = {
    ...cfg, home, hubHome: base, kb: path.join(home, 'kb'),
    heartbeat: path.join(base, 'config', 'beat.json'),
    grants: path.join(base, 'config', 'grants.json'),
  };
  fs.writeFileSync(path.join(base, 'config', 'hub.yaml'), hubConfigText(install));
  fs.writeFileSync(install.heartbeat, JSON.stringify({ v: 1, ts: Date.now(), dshConnected: true, answering: true }));
  return { home, base, own, install };
}

function setup({ mode, kernelTools, visibleExtra = [], sandbox = true } = {}) {
  const fx = fresh();
  const opts = kernelTools ? { ...fx.install, kernelTools } : fx.install;
  fs.writeFileSync(path.join(fx.base, 'config', 'tool-levels.yaml'), policyText(fx.base, fx.install.kb, opts));
  if (mode) writePermissionMode(modeFilePath(fx.base), mode);
  const events = {};
  const services = sandbox ? {
    sandbox: { confine: async (argv) => ({ argv }) },
    shell: { sandboxMode: 'workspace-write', resolve: (request) => request },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
  } : {};
  const agent = {
    id: 'session-n5',
    session: { header: { agentPreset: 'hub-' + bot, cwd: fx.own }, append() {} },
  };
  const visible = [...expectedTools()[bot], ...visibleExtra];
  const ctx = {
    get: (key) => services[key],
    logger: { error() {}, warn() {} },
    effect() {},
    on: (name, fn) => { events[name] = fn; },
    workingDirectory: { get: (session) => session.header.cwd },
    tools: {
      guard() {},
      register() {},
      view: () => ({ visible: new Map(visible.map((name) => [name, {}])) }),
    },
  };
  const prev = process.env.HUB_HOME;
  process.env.HUB_HOME = fx.base;
  try { apply(ctx, { bot }); }
  finally { if (prev === undefined) delete process.env.HUB_HOME; else process.env.HUB_HOME = prev; }
  const exec = (args = {}, name = 'bash', actor = agent) => ({
    name, arguments: args, agent: actor, callId: Symbol(), token: Symbol(),
    signal: new AbortController().signal,
  });
  const pre = (item) => events['tools/pre-execute'](item, async () => ({ kind: 'allow' }));
  const clone = {
    ...agent,
    session: { header: { ...agent.session.header, origin: 'subagent' } },
  };
  return { ...fx, exec, pre, clone, agent };
}

const registered = { kernelTools: ['subagent'], visibleExtra: ['subagent'] };

test('三档派分身本身都不问；没登记就拒绝', async () => {
  for (const mode of ['open', 'ask', 'readonly']) {
    const h = setup({ mode, ...registered });
    const decision = await h.pre(h.exec({ prompt: '把资料分成三份', description: '拆资料' }, 'subagent'));
    assert.equal(decision.kind, 'allow', mode);
  }
  const off = setup({ mode: 'open' });
  const denied = await off.pre(off.exec({ prompt: '派一个' }, 'subagent'));
  assert.equal(denied.kind, 'deny');
  assert.match(denied.reason, /未列出的工具/);
  const extra = setup({ mode: 'open', visibleExtra: ['subagent'] });
  const bricked = await extra.pre(extra.exec({ file_path: path.join(extra.own, 'a.md') }, 'read'));
  assert.equal(bricked.kind, 'deny');
});

test('分身不能再派、不能改目录或换预设；选模型不升权限', async () => {
  const h = setup({ mode: 'open', ...registered });
  const nested = await h.pre(h.exec({ prompt: '再派' }, 'subagent', h.clone));
  assert.equal(nested.kind, 'deny');
  assert.match(nested.reason, /分身不能再派分身/);
  const cwd = await h.pre(h.exec({ prompt: '去别处', cwd: '/tmp' }, 'subagent'));
  assert.equal(cwd.kind, 'deny');
  assert.match(cwd.reason, /不能改工作目录/);
  const preset = await h.pre(h.exec({ prompt: '换人', agent_preset: ' hub-writer ' }, 'subagent'));
  assert.equal(preset.kind, 'deny');
  assert.match(preset.reason, /不能换预设/);
  const blank = await h.pre(h.exec({ prompt: '留在这', cwd: '', agent_preset: '' }, 'subagent'));
  assert.equal(blank.kind, 'allow');
  const model = await h.pre(h.exec({
    prompt: '用这个模型看一眼', provider: 'demo', model: 'demo', reasoning_effort: 'low',
  }, 'subagent'));
  assert.equal(model.kind, 'allow');
});

test('分身随后的动作仍按档；确认卡写「的分身想」；四类照旧问', async () => {
  const ask = setup({ mode: 'ask', ...registered });
  const shared = path.join(ask.base, 'shared', 'note.md');
  const child = await ask.pre(ask.exec({ file_path: shared, content: '测' }, 'write', ask.clone));
  assert.equal(child.kind, 'ask');
  assert.match(child.displayReason.zh, /的分身想写共享区/);
  const parent = await ask.pre(ask.exec({ file_path: shared, content: '测' }, 'write'));
  assert.equal(parent.kind, 'ask');
  assert.match(parent.displayReason.zh, new RegExp(cfg.names[bot] + '想写共享区'));
  assert.doesNotMatch(parent.displayReason.zh, /的分身想/);
  const quiet = setup({ mode: 'readonly', ...registered });
  const read = await quiet.pre(quiet.exec({ file_path: path.join(quiet.own, 'a.md') }, 'read', quiet.clone));
  assert.equal(read.kind, 'allow');
  const write = await quiet.pre(quiet.exec({ file_path: path.join(quiet.own, 'a.md'), content: '写' }, 'write', quiet.clone));
  assert.equal(write.kind, 'deny');
  assert.match(write.reason, /只读/);
  const open = setup({ mode: 'open', ...registered });
  const existing = path.join(open.own, 'keep.md');
  fs.writeFileSync(existing, '旧');
  const overwrite = await open.pre(open.exec({ file_path: existing, content: '新' }, 'write', open.clone));
  assert.equal(overwrite.kind, 'ask');
  assert.match(overwrite.reason, /没有备份/);
  assert.match(overwrite.displayReason.zh, /的分身想/);
  const pay = await open.pre(open.exec({ command: 'echo 付款', description: '试付款' }, 'bash', open.clone));
  assert.equal(pay.kind, 'ask');
  assert.match(pay.displayReason.zh, /的分身想跑命令/);
});
