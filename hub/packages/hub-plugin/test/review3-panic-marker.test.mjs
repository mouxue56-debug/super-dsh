// 路31 第三轮复核：插件认一键全停标记的位置，必须与后端写标记的位置一致。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply} from '../index.mjs';
import {loadHubConfig, hubConfigText} from '../hub-config.mjs';
import {policyText} from '../policy.mjs';

const ids = ['leader', 'writer'];

function setup(extraInstall) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r3-panic-')));
  const install = {
    ...loadHubConfig({hubHome: base, read: false}), hubHome: base, kb: base + '/kb', bots: ids, chief: ids[0],
    heartbeat: base + '/config/beat.json', grants: base + '/config/grants.json',
    names: {leader: '总管', writer: '小文'}, kb_allow: {}, ...extraInstall,
  };
  for (const d of ['config', 'shared', 'tickets', 'kb', ...ids.map(id => 'bots/' + id)]) {
    fs.mkdirSync(base + '/' + d, {recursive: true, mode: 0o700});
  }
  const rows = ids.map((id, i) => ({id, name: install.names[id], role: i ? 'bot' : 'chief', preset: 'hub-' + id,
    status: 'active', avatar: {kind: 'role', role: 'helper'}, nameColor: 'blue', duty: '写笔记', notDuty: '',
    phrases: [], order: i, createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z'}));
  fs.writeFileSync(base + '/config/hub.yaml', hubConfigText(install));
  fs.writeFileSync(base + '/config/bots.yaml', JSON.stringify({version: 1, bots: rows}), {mode: 0o600});
  fs.writeFileSync(base + '/config/tool-levels.yaml', policyText(base, install.kb, install));
  fs.writeFileSync(install.heartbeat, JSON.stringify({v: 1, ts: Date.now(), dshConnected: true, answering: true}));
  const events = {}, tools = {};
  const agent = {id: 'session-writer', session: {header: {agentPreset: 'hub-writer', cwd: base + '/bots/writer'},
    append() {}}};
  const ctx = {logger: {error() {}, warn() {}}, on: (n, f) => events[n] = f, effect() {}, get: () => undefined,
    workingDirectory: {get: s => s.header.cwd},
    tools: {register: t => tools[t.name] = t, guard() {},
      view: () => ({visible: new Map(['read', 'write', 'edit', 'bash'].map(n => [n, {}]))})}};
  const prev = process.env.HUB_HOME;
  process.env.HUB_HOME = base;
  try {
    apply(ctx, {bot: 'writer'});
  } finally {
    if (prev === undefined) delete process.env.HUB_HOME;
    else process.env.HUB_HOME = prev;
  }
  const pre = async name => events['tools/pre-execute']({name, arguments: {file_path: base + '/bots/writer/a.md'},
    agent, token: Symbol(), callId: Symbol(), signal: new AbortController().signal}, async () => ({kind: 'allow'}));
  return {base, pre, events, agent};
}

// 发现 4（中）：后端按 data_dir 的展开值（$HUB_HOME/…）落标记，插件拿原文拼路径，认不到，停机后照样放行。
test('R3-4a data_dir 写成 $HUB_HOME/x 时，后端落的停机标记插件也要认', async () => {
  const h = setup({data_dir: '$HUB_HOME/custom-data'});
  await h.events['agent/pre-step']({agent: h.agent, turn: 1, step: 1, messages: []}, async () => ({kind: 'enter',
    messages: []}));
  const flag = path.join(h.base, 'custom-data', 'panic', 'stopped.flag'); // 后端 pathConfig 展开后的位置
  fs.mkdirSync(path.dirname(flag), {recursive: true});
  fs.writeFileSync(flag, '1');
  const d = await h.pre('read');
  assert.equal(d.kind, 'deny', '停机标记在，插件却放行了：' + JSON.stringify(d));
});

// 发现 4（中）：panic.stateDir 自定义时，后端把标记放进那里，插件仍只看 data_dir/panic。
test('R3-4b panic.stateDir 自定义时，插件也要认那里的标记', async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-panic-state-'));
  const h = setup({panic: {stateDir: state}});
  await h.events['agent/pre-step']({agent: h.agent, turn: 1, step: 1, messages: []}, async () => ({kind: 'enter',
    messages: []}));
  fs.writeFileSync(path.join(state, 'stopped.flag'), '1');
  const d = await h.pre('read');
  assert.equal(d.kind, 'deny', '停机标记在，插件却放行了：' + JSON.stringify(d));
});
