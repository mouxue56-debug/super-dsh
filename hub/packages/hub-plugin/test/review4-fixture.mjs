// 收口：插件这一侧的接缝与复核修正（派来的会话前缀、读别人写的工单算外部内容、资料边界防伪造）。
// 夹具照抄自 r27-plugin-tools.test.mjs（那份没有导出）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {apply} from '../index.mjs';
import {loadHubConfig, hubConfigText} from '../hub-config.mjs';
import {policyText} from '../policy.mjs';
import {delegatedPrefix} from '../../hub-bff/lib/board-inbox.mjs';

const ids = ['leader', 'writer', 'helper'];
const names = ['总管', '小文', '小帮'];

export function fixture({plugins = ['bots'], disabled = []} = {}) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r27-l2-')));
  const install = {
    ...loadHubConfig({hubHome: base, read: false}), hubHome: base, kb: base + '/kb', bots: ids, chief: ids[0],
    heartbeat: base + '/config/beat.json', grants: base + '/config/grants.json',
    names: Object.fromEntries(ids.map((id, i) => [id, names[i]])), kb_allow: {},
  };
  for (const d of ['config', 'shared', 'tickets', 'kb', ...ids.map(id => 'bots/' + id)]) {
    fs.mkdirSync(base + '/' + d, {recursive: true, mode: 0o700});
  }
  const rows = ids.map((id, i) => ({
    id, name: names[i], role: i ? 'bot' : 'chief', preset: 'hub-' + id,
    status: disabled.includes(id) ? 'disabled' : 'active', avatar: {kind: 'role', role: 'helper'},
    nameColor: 'blue', duty: '写笔记', notDuty: '', phrases: [], order: i,
    createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z',
  }));
  fs.writeFileSync(base + '/config/hub.yaml', hubConfigText(install));
  fs.writeFileSync(base + '/config/bots.yaml', JSON.stringify({version: 1, bots: rows}), {mode: 0o600});
  const opts = plugins === null ? install : {...install, pluginTools: plugins};
  fs.writeFileSync(base + '/config/tool-levels.yaml', policyText(base, install.kb, opts));
  fs.writeFileSync(install.heartbeat, JSON.stringify({v: 1, ts: Date.now(), dshConnected: true, answering: true}));
  return {base, install, rows};
}

export function setup(bot = 'writer', {fx = fixture(), extra = [], config = {}, sandbox = false} = {}) {
  const tools = {}, events = {}, guards = [], logs = [];
  const agent = {id: 'session-' + bot, session: {header: {agentPreset: 'hub-' + bot, cwd: fx.base + '/bots/' + bot},
    append() {}}};
  const services = sandbox ? {
    sandbox: {confine: async argv => ({argv})},
    shell: {sandboxMode: 'workspace-write', resolve: r => r},
    sandboxPolicy: {resolve: () => ({mode: 'workspace-write'})},
  } : {};
  const ctx = {
    logger: {error: m => logs.push(m), warn: m => logs.push(m)}, on: (n, f) => events[n] = f, effect() {},
    get: k => services[k], workingDirectory: {get: s => s.header.cwd},
    tools: {
      register: t => tools[t.name] = t, guard: f => guards.push(f),
      view: () => ({visible: new Map(['read', 'write', 'edit', 'bash', ...Object.keys(tools), ...extra]
        .map(n => [n, {}]))}),
    },
  };
  const prev = process.env.HUB_HOME;
  process.env.HUB_HOME = fx.base;
  try {
    apply(ctx, {bot, ...config});
  } finally {
    if (prev === undefined) {
      delete process.env.HUB_HOME;
    } else {
      process.env.HUB_HOME = prev;
    }
  }
  const exec = (name, args = {}, ag = agent) => ({name, arguments: args, agent: ag, token: Symbol(), callId: Symbol(),
    signal: new AbortController().signal});
  const pre = e => events['tools/pre-execute'](e, async () => ({kind: 'allow'}));
  const turn = n => events['agent/pre-step']({agent, turn: n, step: 1, messages: []}, async () => ({kind: 'enter',
    messages: []}));
  const run = async (name, args) => {
    const e = exec(name, args);
    const d = await pre(e);
    if (d.kind === 'deny') {
      throw Error(d.reason);
    }
    return tools[name].execute(args, e);
  };
  return {fx, tools, events, guards, logs, agent, exec, pre, turn, run};
}

// 送一句用户消息进会话（模拟后端投进来的第一句）。
export function inbox(h, text, kind = 'user') {
  h.events['agent/inbox/inserted']({agent: h.agent, message: {source: {kind}, content: [{type: 'text', text}]}});
}

// 登记一个有效的组文件夹，返回组目录。
export function shareGroup(fx, members, gid = 'g20261118000000abcd') {
  const dir = path.join(fx.base, 'group-work', gid);
  for (const id of members) fs.mkdirSync(path.join(dir, id), {recursive: true, mode: 0o700});
  fs.writeFileSync(path.join(fx.base, 'config', 'group-shares.json'), JSON.stringify({version: 1, shares: [
    {group: gid, dir, members, status: 'active', since: '2026-11-18T00:00:00.000Z'}]}));
  return dir;
}
