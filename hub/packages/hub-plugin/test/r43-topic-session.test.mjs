import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../index.mjs';
import { loadHubConfig, hubConfigText } from '../hub-config.mjs';
import { policyText, expectedTools } from '../policy.mjs';

function setup(t) {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r43-topic-')));
  const base = path.join(home, 'hub');
  const install = loadHubConfig({ home, hubHome: base, read: false });
  for (const dir of ['config', 'shared', 'tickets', ...install.bots.map(bot => 'bots/' + bot)]) {
    fs.mkdirSync(path.join(base, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(base, 'config/hub.yaml'), hubConfigText(install));
  fs.writeFileSync(path.join(base, 'config/tool-levels.yaml'), policyText(base, install.kb, install));
  const events = {}, guards = [], tools = {};
  const ctx = {
    logger: { error() {}, warn() {} }, effect() {}, get() {},
    workingDirectory: { get: session => session.header.cwd },
    on: (name, fn) => { events[name] = fn; },
    tools: { guard: fn => guards.push(fn), register: tool => { tools[tool.name] = tool; },
      view: () => ({ visible: new Map(expectedTools(install.bots, install.chief)[install.chief]
        .map(name => [name, {}])) }) },
  };
  const previous = process.env.HUB_HOME;
  process.env.HUB_HOME = base;
  try { apply(ctx, { bot: install.chief, createUserMessage: value => value }); }
  finally {
    if (previous === undefined) delete process.env.HUB_HOME;
    else process.env.HUB_HOME = previous;
  }
  t.after(() => {
    const entries = fs.readdirSync(home, { recursive: true, withFileTypes: true });
    for (const item of entries.filter(item => !item.isDirectory())) {
      fs.unlinkSync(path.join(item.parentPath, item.name));
    }
    for (const item of entries.filter(item => item.isDirectory()).reverse()) {
      fs.rmdirSync(path.join(item.parentPath, item.name));
    }
    fs.rmdirSync(home);
  });
  const agent = id => ({ id, session: { id,
    header: { agentPreset: 'hub-' + install.chief, cwd: path.join(base, 'bots', install.chief) }, append() {} } });
  const exec = (id, name) => ({ agent: agent(id), name, arguments: {}, token: Symbol(),
    callId: Symbol(), signal: new AbortController().signal });
  return { events, guards, agent, exec };
}

const classifier = 'hub-topic-12345678-1234-4123-8123-123456789abc';

test('话题整理会话在执行前、工具守卫、执行时均拒绝所有工具，普通话题照常', async t => {
  const fixture = setup(t);
  for (const name of ['read', 'write', 'bash', 'bot_list', 'memory_list', 'unknown-tool']) {
    const call = fixture.exec(classifier, name);
    const pre = await fixture.events['tools/pre-execute'](call, () => assert.fail('不应继续工具执行'));
    assert.equal(pre.kind, 'deny');
    assert.match(pre.reason, /话题整理/u);
    assert.ok(fixture.guards.some(guard => /话题整理/u.test(guard(call) ?? '')));
    await assert.rejects(() => fixture.events['tools/execute'](call,
      () => assert.fail('不应执行底层工具')), /话题整理/u);
  }
  const ordinary = await fixture.events['tools/pre-execute'](fixture.exec('ordinary', 'bot_list'),
    async () => ({ kind: 'allow' }));
  assert.equal(ordinary.kind, 'allow');
});

test('话题整理只准一步且不注入开工摘要，普通聊天仍收到开工摘要', async t => {
  const fixture = setup(t);
  const step = (id, number) => fixture.events['agent/pre-step']({ agent: fixture.agent(id),
    turn: 1, step: number, messages: [] }, async () => ({ kind: 'enter', messages: [] }));
  const first = await step(classifier, 1);
  assert.deepEqual(first, { kind: 'enter', messages: [] });
  assert.equal((await step(classifier, 2)).kind, 'reject');
  assert.equal((await step(classifier, undefined)).kind, 'reject');
  const ordinary = await step('ordinary', 1);
  assert.ok(ordinary.messages.some(message => message.source?.kind === 'hub-boot-slice'));
});
