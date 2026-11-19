import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyCommand} from '../command-policy.mjs';
import {fixture, setup, inbox, shareGroup} from './review4-fixture.mjs';
import {register as registerGroups} from '../tools/groups.mjs';

function classify(command, extra = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'policy-')));
  const own = path.join(home, 'own');
  fs.mkdirSync(own);
  return classifyCommand({
    command, cwd: own, home, hubHome: path.join(home, 'hub'),
    roots: {own, readable: [own], writable: [own]},
    sandboxActive: true, selfAddrs: [], ...extra,
  });
}

test('外部文件预登记及 edit 读取传递', async () => {
  const fx = fixture();
  const [first, second] = fx.rows.slice(1).map(row => row.id);
  const dir = shareGroup(fx, [first, second]);
  const writer = setup(second, {fx, sandbox: true});
  inbox(writer, '【外部来源】资料');
  await writer.turn(1);
  const target = path.join(dir, second, 'data.txt');
  fs.writeFileSync(target, 'a');
  const edit = writer.exec('edit', {file_path: target, old_string: 'a', new_string: 'b'});
  assert.equal((await writer.pre(edit)).kind, 'allow');
  const reader = setup(first, {fx, sandbox: true});
  await reader.turn(1);
  const read = reader.exec('read', {file_path: target});
  assert.equal((await reader.pre(read)).kind, 'allow');
  await reader.events['tools/post-execute'](read, {isError: false, content: []}, async () => ({kind: 'accept'}));
  assert.equal((await reader.pre(reader.exec('bash', {command: 'pwd'}))).kind, 'ask');
  await reader.turn(2);
  assert.equal((await reader.pre(reader.exec('bash', {command: 'pwd'}))).kind, 'ask');
});

test('组消息和交单保留外部来源标记，读取时恢复', async () => {
  const tools = {};
  const sent = [];
  let marked = false;
  const state = {
    bot: 'member',
    externalTainted: true,
    markExternalRead() { marked = true; },
    markInternalRead() {},
  };
  const groups = {
    async post(_group, body) { sent.push(body.text); return {ok: true}; },
    async submit(_group, _ticket, body) { sent.push(body.summary); return {ok: true}; },
    async view() { return {context: {text: sent.join('\n')}}; },
  };
  registerGroups({tools: {register(tool) { tools[tool.name] = tool; }}}, {
    state: () => state,
    groups,
  });
  const exec = {agent: {id: 'session'}};
  await tools.group_say.execute({group: 'g', text: '内容'}, exec);
  await tools.group_ticket_submit.execute({group: 'g', ticket: 't', summary: '结果'}, exec);
  assert.ok(sent.every(text => text.startsWith('【外部来源】')));
  await tools.group_read.execute({group: 'g'}, exec);
  assert.equal(marked, true);
});

test('jq 敏感表达式与未列选项均不直接运行', () => {
  const expressions = ['$ENV', '$__prog_args', '$__loc__', 'env', 'input', 'inputs', 'debug', 'stderr',
    'halt_error', 'input_filename', 'input_line_number'];
  for (const expression of expressions) {
    assert.notEqual(classify(`jq -n '${expression}'`, {internalTainted: true}).level, 'run', expression);
  }
  for (const option of ['--args', '--jsonargs', '-f', '--from-file', '-L', '--seq', '--stream']) {
    assert.notEqual(classify(`jq ${option} '.'`).level, 'run', option);
  }
  assert.equal(classify("jq -n 'getpath([0])'").level, 'run');
});

test('环境与执行写入选项不直接运行', () => {
  const commands = ['env', 'env -0', 'env | grep X', 'printenv', 'set', 'export -p', 'declare -p',
    'typeset', 'compgen', 'alias', 'find . -exec echo x ;', 'find . -okdir echo x ;',
    'rg --pre x pattern', 'rg --hostname-bin x pattern', 'sort --compress-program=x', 'sort -o out',
    "sed 's/a/b/e'", "sed 'w out'", 'date -f in', 'file -z in',
    "jq -n 'include \"m\"; .'", "jq -n 'import \"m\" as m; .'", "jq -n '$JQ_BUILD_CONFIGURATION'",
    "jq -n 'get_search_list'", "jq -n '$__loc__'", "jq -n '[inputs]'", "jq -n 'debug'", "jq -n '$ENV|keys'"];
  // 写自己目录的 tee、uniq 输出文件仍按口径直接跑（沙箱只许写自己那格），这里不收。
  for (const command of commands) assert.notEqual(classify(command).level, 'run', command);
});

test('工作目录不在组员范围或已结束则拒绝', () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fence-')));
  const root = path.join(home, 'groups');
  const ended = path.join(root, 'ended');
  const other = path.join(root, 'other');
  fs.mkdirSync(ended, {recursive: true});
  fs.mkdirSync(other, {recursive: true});
  const groupFence = {root, read: [], write: [], ended: [ended]};
  for (const workdir of [root, ended, other]) {
    assert.equal(classify('pwd', {home, workdir, groupFence}).level, 'deny');
  }
});

test('错误文字不能冒充参数类型', async () => {
  for (const message of ['missing required property', 'must have required property']) {
    const h = setup(undefined, {sandbox: true});
    await h.turn(1);
    const exec = h.exec('bash', {command: 'pwd', description: '查看'});
    assert.equal((await h.pre(exec)).kind, 'allow');
    await assert.rejects(h.events['tools/execute'](exec, async () => { throw Error(message); }));
    assert.ok(h.logs.some(line => line.includes('命令没经过沙箱')));
  }
});

test('已有说明保持原样，自动说明带前缀', async () => {
  const h = setup(undefined, {sandbox: true});
  await h.turn(1);
  const args = {command: 'pwd', description: '查看'};
  const exec = h.exec('bash', args);
  assert.equal((await h.pre(exec)).kind, 'allow');
  await h.events['tools/execute'](exec, async () => ({}));
  assert.equal(args.description, '查看');
});

test('修H 变形：系统补了说明字段时，命令自己的报错带参数错误字样也不能躲过（不以它开头）', async () => {
  const h = setup(undefined, {sandbox: true});
  await h.turn(1);
  const exec = h.exec('bash', {command: 'echo invalid arguments'});
  assert.equal((await h.pre(exec)).kind, 'allow');
  await assert.rejects(h.events['tools/execute'](exec, async () => {
    throw Error('spawn failed: invalid arguments');
  }));
  assert.ok(h.logs.some(line => line.includes('命令没经过沙箱')));
});
