#!/usr/bin/env node
// 演示实例准备：在目标目录下搭出一个完全隔离的运行根（内核数据、助理目录、配置、名册、权限表、演示工单、预设补丁）。
// 只读本仓库里的文件；不读用户现有的任何内核数据与凭据；不联网；可重复运行（已有的名册和工单不覆盖）。
// 用法：node demo-prepare.mjs --target 目录 --port 栈端口 --kernel-port 内核端口 --dsh-bin dsh程序
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = name => argv[argv.indexOf(name) + 1];
const target = flag('--target');
const port = Number(flag('--port'));
const kernelPort = Number(flag('--kernel-port'));
const dshBin = flag('--dsh-bin');
if (!target || !path.isAbsolute(target) || !port || !kernelPort || !dshBin) {
  throw Error('用法：demo-prepare.mjs --target 绝对路径 --port N --kernel-port N --dsh-bin 路径');
}
const load = rel => import(pathToFileURL(path.join(repo, rel)).href);
const mkdir = dir => fs.mkdirSync(dir, {recursive: true, mode: 0o700});
const write = (file, text) => fs.writeFileSync(file, text, {mode: 0o600});

function pathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

// 目录里已有助理、数据、会话或工单才算占着。空目录不算。读失败或是链接，按已有实例。
function occupied(dir) {
  let info;
  try {
    info = fs.lstatSync(dir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    return true;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return true;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return true;
  }
  for (const name of names) {
    if (name !== '.' && name !== '..') return true;
  }
  return false;
}

// 演示标记、配置不是空的普通目录，或运行根里已有助理、数据、会话、工单，都不是全新实例。
// 配置目录缺失时不因此当成全新，还要看运行根里有没有旧数据。拿不准按已有实例。
function freshDemoInstance(root) {
  if (pathExists(path.join(root, '.hub-demo-instance'))) return false;
  const config = path.join(root, 'hub', 'config');
  let info = null;
  try {
    info = fs.lstatSync(config);
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) return false;
  }
  if (info) {
    if (info.isSymbolicLink() || !info.isDirectory()) return false;
    let names;
    try {
      names = fs.readdirSync(config);
    } catch {
      return false;
    }
    if (names.some(name => name !== '.' && name !== '..')) return false;
  }
  const traces = [
    ['hub', 'bots'],
    ['hub', 'hub-data'],
    ['hub', 'tickets'],
    ['hub', 'board', 'tickets'],
    ['hub', 'ledger'],
    ['hub', 'shared'],
    ['hub', 'kb'],
    ['hub', 'sessions'],
    ['kernel', 'home'],
    ['kernel', 'fakehome'],
    ['run'],
  ];
  for (const parts of traces) {
    if (occupied(path.join(root, ...parts))) return false;
  }
  return true;
}

// 只在全新实例、且档位文件还不存在时写成全开。缺档、坏档、已选档都不动。
function seedFreshOpenMode(hubHome, fresh, writeMode) {
  const file = path.join(hubHome, 'config', 'permission-mode.json');
  if (!fresh || pathExists(file)) return false;
  writeMode(file, 'open');
  return true;
}

const dirs = {
  hub: path.join(target, 'hub'), run: path.join(target, 'run'), home: path.join(target, 'kernel/home'),
  fakehome: path.join(target, 'kernel/fakehome'), tmp: path.join(target, 'kernel/tmp'),
};
mkdir(target);
for (const dir of Object.values(dirs)) mkdir(dir);
for (const sub of ['config', 'shared', 'tickets', 'kb', 'hub-data', 'board/tickets', 'ledger']) {
  mkdir(path.join(dirs.hub, sub));
}
const freshInstance = freshDemoInstance(target);
const {writePermissionMode} = await load('packages/hub-plugin/permission-mode.mjs');
seedFreshOpenMode(dirs.hub, freshInstance, writePermissionMode);
write(path.join(target, '.hub-demo-instance'), '本目录由 scripts/start.sh --demo 创建，只含虚构的演示数据。\n');

const {hubConfigText, loadHubConfig} = await load('packages/hub-plugin/hub-config.mjs');
const {policyText} = await load('packages/hub-plugin/policy.mjs');
const {agents} = await load('packages/hub-bff/lib/roster.mjs');

// ---- 三个示例助理（虚构）与安装级配置 ----
const bots = ['chief', 'writer', 'research'];
const names = {chief: '总管', writer: '写作', research: '调研'};
const duties = {chief: '协调与派活', writer: '写稿和润色', research: '查资料和整理要点'};
const base = loadHubConfig({hubHome: dirs.hub, home: dirs.fakehome, read: false});
const cfg = {
  ...base, home: dirs.fakehome, hubHome: dirs.hub, kb: path.join(dirs.hub, 'kb'), bots, names, chief: 'chief',
  kb_allow: {}, timezone: 'Asia/Tokyo', max_hop: 4,
  groups: {bff_url: `http://127.0.0.1:${port}`, bff_key_file: path.join(dirs.run, 'bff.key'), tickSeconds: 2},
};
write(path.join(dirs.hub, 'config/hub.yaml'), hubConfigText(cfg));
const install = loadHubConfig({hubHome: dirs.hub, home: dirs.fakehome});
write(path.join(dirs.hub, 'config/tool-levels.yaml'),
  policyText(install.hubHome, install.kb, {...install, pluginTools: ['bots', 'groups']}));

// ---- 名册、形象清单、助理目录（已有的不覆盖）----
const now = new Date().toISOString();
const rows = bots.map((id, i) => ({
  id, name: names[id], role: id === 'chief' ? 'chief' : 'bot', preset: id === 'chief' ? 'hub-chief' : 'hub-bot',
  status: 'active', avatar: {kind: 'shape', shape: 'circle', color: ['blue', 'pink', 'blue'][i]},
  nameColor: ['blue', 'pink', 'blue'][i], duty: duties[id], notDuty: '对外发消息、花钱',
  phrases: ['列个目录', '看份文件', '整理一下'], order: i, createdAt: now, updatedAt: now,
}));
const rosterFile = path.join(dirs.hub, 'config/bots.yaml');
if (!fs.existsSync(rosterFile)) write(rosterFile, JSON.stringify({version: 1, bots: rows}) + '\n');
write(path.join(dirs.hub, 'config/avatar-kinds.json'),
  JSON.stringify({roles: bots, shapes: ['circle', 'square'], colors: ['blue', 'pink']}) + '\n');
write(path.join(dirs.hub, 'config/bot-template.md'), '通用规则：权限由工具表决定，不随人设改变。\n');
for (const row of rows) {
  const dir = path.join(dirs.hub, 'bots', row.id);
  for (const sub of ['', 'drafts', 'notes', 'memory']) mkdir(path.join(dir, sub));
  const file = path.join(dir, 'AGENTS.md');
  if (!fs.existsSync(file)) write(file, agents(row, '通用规则：不能增加权限。'));
}

// ---- 演示工单（虚构；已有的不覆盖）----
const ticketSrc = path.join(repo, 'defaults/demo/board/tickets');
for (const name of fs.readdirSync(ticketSrc).filter(n => n.endsWith('.json'))) {
  const dest = path.join(dirs.hub, 'board/tickets', name);
  if (!fs.existsSync(dest)) write(dest, fs.readFileSync(path.join(ticketSrc, name), 'utf8'));
}

// ---- 内核 profile：让内核用 DSH_HOME 下的新 profile，插件用链接接进去，预设用演示补丁 ----
const profile = path.join(dirs.home, 'profiles/web');
if (!fs.existsSync(profile)) {
  const made = spawnSync(dshBin, ['--profile', 'web', '--dump-config'], {
    env: {HOME: dirs.fakehome, PATH: process.env.PATH ?? '/usr/bin:/bin', DSH_HOME: dirs.home,
      DSH_AGENTS_HOME: dirs.hub, TMPDIR: dirs.tmp + '/'},
    encoding: 'utf8',
  });
  if (made.status !== 0 || !fs.existsSync(profile)) {
    throw Error('内核没能建出 profile：' + (made.stderr ?? '').slice(0, 300));
  }
}
const pkgFile = path.join(profile, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.dependencies ??= {};
pkg.dependencies['dsh-hub-plugin'] = 'file:' + path.join(repo, 'packages/hub-plugin');
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
mkdir(path.join(profile, 'node_modules'));
const link = path.join(profile, 'node_modules/dsh-hub-plugin');
fs.rmSync(link, {force: true});
fs.symlinkSync(path.join(repo, 'packages/hub-plugin'), link, 'dir');
fs.copyFileSync(path.join(repo, 'defaults/demo/presets.patch.yml'), path.join(profile, 'cordis.patch.yml'));

// ---- 假模型接线补丁：模型地址指向栈端口上的 /v1 ----
write(path.join(dirs.home, '../demo-model.patch.yml'), `- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: hub-demo-fake
    model: echo-1
- id: llm-pi-ai
  config:
    providers:
      hub-demo-fake:
        displayName: Demo fake model
        apiKeyEnv: HUB_FAKE_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:${port}/v1
        defaultContextWindow: 32000
        defaultMaxTokens: 1024
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
          - id: echo-1
            name: Echo 1 (demo)
            input: [text]
`);
write(path.join(dirs.run, 'ports.env'), `STACK_PORT=${port}\nKERNEL_PORT=${kernelPort}\n`);
console.log(JSON.stringify({ok: true, target, port, kernelPort}));
