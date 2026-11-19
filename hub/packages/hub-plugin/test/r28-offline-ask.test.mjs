// 路37 补验：审批通道（手机端）不在线时，「先问」的动作一律被拒、不执行、留痕，恢复后也不放行旧的。
// 用插件真实入口（apply）加假 ctx，全部在临时目录，不碰真实家目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.mjs';
import { policyText } from '../policy.mjs';
import { loadHubConfig, hubConfigText } from '../hub-config.mjs';
import { OFFLINE } from '../heartbeat.mjs';

const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r28-offline-')));
const base = path.join(home, 'hub');
const kb = path.join(home, 'kb');
const originalHome = os.homedir;
for (const dir of ['config', 'shared', 'kb', 'bots/chief', 'bots/pm', 'bots/art', 'tickets']) {
  fs.mkdirSync(path.join(dir.startsWith('kb') ? home : base, dir), { recursive: true });
}
const install = loadHubConfig({ hubHome: base, home, read: false });
fs.writeFileSync(path.join(base, 'config/hub.yaml'), hubConfigText({ ...install, kb }));
fs.writeFileSync(path.join(base, 'config/tool-levels.yaml'),
  policyText(base, kb, { ...install, kb, pluginTools: ['rules'] }));
const heartbeat = path.join(base, 'config/bff-heartbeat.json');
const good = () => ({ v: 1, ts: Date.now(), dshConnected: true, answering: true, devicePresent: true });
const online = () => fs.writeFileSync(heartbeat, JSON.stringify(good()));
const allow = async () => ({ kind: 'allow' });
const stub = () => { os.homedir = () => home; };
const unstub = () => { os.homedir = originalHome; };
process.env.HUB_HOME = base;

// 起一个助理的假宿主。
function setup(bot = 'pm') {
  online();
  const events = {}, tools = {}, guards = [];
  const ctx = { logger: { error() {} },
    workingDirectory: { get: s => path.join(base, 'bots', s.header.agentPreset.slice(4)) },
    on: (name, fn) => { events[name] = fn; },
    tools: { view: () => ({ visible: new Map(['read', 'write', 'edit', ...Object.keys(tools)].map(n => [n, {}])) }),
      guard: fn => guards.push(fn), register: tool => { tools[tool.name] = tool; } } };
  stub();
  try { apply(ctx, { bot }); } finally { unstub(); }
  const agent = { id: 'session-' + bot, session: { header: { agentPreset: 'hub-' + bot }, append() {} } };
  const exec = (name, args) => ({ name, arguments: args, agent, token: Symbol(), callId: Symbol(),
    signal: new AbortController().signal });
  const approve = async (e, outcome = 'allowed-once') => events['approval/request']({ agent: e.agent, callId: e.callId,
    toolName: e.name, signal: e.signal, reason: 'HUBAPPROVAL1 ' + JSON.stringify({ bot, sessionId: e.agent.id,
      path: e.arguments.file_path ?? '', tool: e.name }) }, async () => outcome);
  const user = () => events['agent/inbox/inserted']({ agent, message: { source: { kind: 'user' }, content: [] } });
  return { events, tools, guards, agent, exec, approve, user };
}

const breakers = {
  '文件缺失': () => fs.rmSync(heartbeat, { force: true }),
  '心跳过期（16 秒前）': () => fs.writeFileSync(heartbeat, JSON.stringify({ ...good(), ts: Date.now() - 16000 })),
  '内核没连上': () => fs.writeFileSync(heartbeat, JSON.stringify({ ...good(), dshConnected: false })),
  '后端没在答复': () => fs.writeFileSync(heartbeat, JSON.stringify({ ...good(), answering: false })),
  '时间在未来': () => fs.writeFileSync(heartbeat, JSON.stringify({ ...good(), ts: Date.now() + 60000 })),
  '内容损坏': () => fs.writeFileSync(heartbeat, '{'),
  '版本不对': () => fs.writeFileSync(heartbeat, JSON.stringify({ ...good(), v: 2 })),
  '换成目录': () => { fs.rmSync(heartbeat, { force: true }); fs.mkdirSync(heartbeat); },
  '换成链接': () => {
    fs.rmSync(heartbeat, { force: true, recursive: true });
    fs.writeFileSync(heartbeat + '.real', JSON.stringify(good()));
    fs.symlinkSync(heartbeat + '.real', heartbeat);
  },
};

// 恢复成健康心跳（先清掉上一个破坏动作留下的目录或链接）。
function heal() {
  fs.rmSync(heartbeat, { force: true, recursive: true });
  fs.rmSync(heartbeat + '.real', { force: true });
  online();
}

for (const [label, breakIt] of Object.entries(breakers)) {
  test(`r28 手机离线（${label}）：写共享区在问之前就被拒，没有执行，留 unavailable 一行`, async () => {
    heal();
    const h = setup();
    const target = path.join(base, 'shared', 'offline-' + Math.random().toString(16).slice(2) + '.md');
    const e = h.exec('write', { file_path: target, content: '不该写进去' });
    breakIt();
    const decision = await h.events['tools/pre-execute'](e, allow);
    assert.equal(decision.kind, 'deny', JSON.stringify(decision));
    assert.ok(decision.reason.includes(OFFLINE), decision.reason);
    assert.ok(h.guards[0](e), '守卫独立复判也要拒');
    await assert.rejects(() => h.events['tools/execute'](e, async () => { fs.writeFileSync(target, 'x'); return 1; }),
      /./u);
    assert.equal(fs.existsSync(target), false, '文件不能被写出来');
    const log = fs.readFileSync(path.join(base, 'config/approvals.log'), 'utf8').trim().split('\n').at(-1).split('\t');
    assert.deepEqual([log[1], log[2], log[4], log[5]], ['pm', 'write', 'unavailable', '-'], log.join('|'));
    heal();
  });
}

test('r28 问了之后手机掉线：即使下游随后给出批准，也按拒绝，且不放行执行', async () => {
  heal();
  const h = setup();
  const target = path.join(base, 'shared', 'went-offline.md');
  const e = h.exec('write', { file_path: target, content: '不该写进去' });
  assert.equal((await h.events['tools/pre-execute'](e, allow)).kind, 'ask');
  breakers['心跳过期（16 秒前）']();
  assert.equal(await h.approve(e, 'allowed-once'), 'rejected', '掉线后的批准必须按拒绝');
  assert.match(h.guards[0](e), /./u);
  await assert.rejects(() => h.events['tools/execute'](e, async () => 1), /./u);
  assert.equal(fs.existsSync(target), false);
  heal();
});

test('r28 手机离线时：改全家共用的派活规则（先问类插件工具）、改共享区文件，在线要问、离线被拒', async () => {
  const cases = [
    ['pm', 'rule_propose_shared', { rule: '以后先问再派', quote: '以后先问再派' }],
    ['pm', 'edit', { file_path: path.join(base, 'shared', 'a.md'), old_string: 'a', new_string: 'b' }],
    ['art', 'write', { file_path: path.join(base, 'shared', 'b.md'), content: 'x' }],
  ];
  for (const [bot, name, args] of cases) {
    heal();
    const h = setup(bot);
    const asked = await h.events['tools/pre-execute'](h.exec(name, args), allow);
    assert.equal(asked.kind, 'ask', `${name} 在线时应先问：${JSON.stringify(asked)}`);
    const fresh = setup(bot);
    breakers['文件缺失']();
    const offline = await fresh.events['tools/pre-execute'](fresh.exec(name, args), allow);
    assert.equal(offline.kind, 'deny', `${name} 离线时必须被拒：${JSON.stringify(offline)}`);
    assert.ok(offline.reason.includes(OFFLINE), offline.reason);
  }
  heal();
});

test('r28 离线拒绝之后心跳立刻恢复：同一会话仍被锁，直到主人再说一句话', async () => {
  heal();
  const h = setup();
  const e = h.exec('write', { file_path: path.join(base, 'shared', 'lock-1.md'), content: 'x' });
  breakers['文件缺失']();
  assert.equal((await h.events['tools/pre-execute'](e, allow)).kind, 'deny');
  heal();
  const again = await h.events['tools/pre-execute'](h.exec('write', { file_path: path.join(base, 'shared', 'lock-2.md'),
    content: 'x' }), allow);
  assert.equal(again.kind, 'deny', '锁没解开前不能重新问');
  assert.match(again.reason, /刚才这件事/u);
  h.user();
  assert.equal((await h.events['tools/pre-execute'](h.exec('write', { file_path: path.join(base, 'shared', 'lock-3.md'),
    content: 'x' }), allow)).kind, 'ask', '主人再说话后才会重新问');
});

test('r28 离线只影响「要问的」：读自己的目录与写自己的草稿照常', async () => {
  heal();
  const h = setup();
  breakers['文件缺失']();
  const read = await h.events['tools/pre-execute'](h.exec('read', { file_path: path.join(base, 'bots/pm') }), allow);
  assert.notEqual(read.kind, 'deny', JSON.stringify(read));
  const draft = await h.events['tools/pre-execute'](h.exec('write', { file_path: path.join(base, 'bots/pm/drafts/a.md'),
    content: 'x' }), allow);
  assert.notEqual(draft.kind, 'deny', JSON.stringify(draft));
  heal();
});
