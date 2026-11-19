// 第六轮复核（路61）：外部来源记号的漏洞。每条测试在当前代码上都会失败，改好后应通过。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture, setup, inbox} from './review4-fixture.mjs';
import {policyText} from '../policy.mjs';
import {hubConfigText} from '../hub-config.mjs';

const logFile = fx => path.join(fx.base, 'config', 'group-taint.log');
const logOf = fx => {
  try {
    return fs.readFileSync(logFile(fx), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
};
// 走一遍 pre + post（命令「成功执行」），返回 pre 的判定
async function run(h, name, args) {
  const e = h.exec(name, args);
  const d = await h.pre(e);
  await h.events['tools/post-execute'](e, {isError: false, content: [{type: 'text', text: 'x'}]},
    async () => ({kind: 'accept'}));
  return d.kind;
}
const clean = async (fx, id, bot = 'writer') => {
  const h = setup(bot, {fx, sandbox: true});
  h.agent.id = id;
  inbox(h, '干净');
  await h.turn(1);
  return h;
};
const external = async (fx, id, bot = 'writer') => {
  const h = setup(bot, {fx, sandbox: true});
  h.agent.id = id;
  inbox(h, '【外部来源】资料');
  await h.turn(1);
  return h;
};
// 一个会话现在是不是被算成外部（外部来源的会话连 pwd 也要先问）
const askedPwd = async h => (await h.pre(h.exec('bash', {command: 'pwd', description: '看'}))).kind === 'ask';

test('R6-P1 干净会话用 cat 重定向把已登记的外部文件复制进自己目录：新文件没登记，第三个会话读到不带记号', async () => {
  const fx = fixture();
  const a = await external(fx, 'A');
  fs.writeFileSync(path.join(fx.base, 'shared', 'x.txt'), 'ext');
  await run(a, 'write', {file_path: path.join(fx.base, 'shared', 'x.txt'), content: 'ext'});
  assert.ok(logOf(fx).includes(path.join(fx.base, 'shared', 'x.txt')), '前提：外部会话写的文件已登记');
  const b = await clean(fx, 'B');
  assert.equal(await run(b, 'bash', {command: 'cat ../../shared/x.txt > y.txt', description: '复制'}), 'allow');
  fs.writeFileSync(path.join(fx.base, 'bots', 'writer', 'y.txt'), 'ext');
  const c = await clean(fx, 'C');
  await run(c, 'bash', {command: 'cat y.txt', description: '读'});
  assert.equal(await askedPwd(c), true, '复制出来的文件内容就是外部内容，读它的会话应被算成外部');
});

test('R6-P2 外部文件读进来只算「本轮」：下一轮同一会话写文件不登记、发组消息不带记号', async () => {
  const fx = fixture();
  fx.install.kb_allow = {writer: ['ok']};
  fs.mkdirSync(path.join(fx.base, 'kb', 'ok'), {recursive: true});
  fs.writeFileSync(path.join(fx.base, 'kb', 'ok', 'ext.txt'), '外部文字');
  fs.writeFileSync(path.join(fx.base, 'config', 'hub.yaml'), hubConfigText(fx.install));
  fs.writeFileSync(path.join(fx.base, 'config', 'tool-levels.yaml'),
    policyText(fx.base, fx.install.kb, {...fx.install, pluginTools: ['bots']}));
  const h = setup('writer', {fx, sandbox: true});
  inbox(h, '干净');
  await h.turn(1);
  await run(h, 'read', {file_path: path.join(fx.base, 'kb', 'ok', 'ext.txt')});
  const own = path.join(fx.base, 'bots', 'writer');
  await h.pre(h.exec('write', {file_path: path.join(own, 't1.txt'), content: 'x'}));
  assert.equal(logOf(fx).length, 1, '前提：读过外部文件的同一轮，写会登记');
  await h.turn(2);
  await h.pre(h.exec('write', {file_path: path.join(own, 't2.txt'), content: 'x'}));
  assert.ok(logOf(fx).includes(path.join(own, 't2.txt')), '会话上下文里还留着外部内容，下一轮写出的文件也该登记');
});

test('R6-P3 外部会话只是「想写」shared 目录（要 主人 批、没批）就登记整个 shared：之后别人读 shared 下任何文件都被算外部', async () => {
  const fx = fixture();
  const a = await external(fx, 'A');
  const decision = await a.pre(a.exec('write', {file_path: path.join(fx.base, 'shared'), content: 'x'}));
  assert.equal(decision.kind, 'ask', '前提：这一步还在等 主人 批，没有写成');
  fs.writeFileSync(path.join(fx.base, 'shared', 'readme.txt'), '自己人写的');
  const b = await clean(fx, 'B', 'helper');
  await run(b, 'bash', {command: 'cat ../../shared/readme.txt', description: '读'});
  assert.equal(await askedPwd(b), false, '没批准、没写成的尝试不该把整个共享区永久染上外部记号');
});

test('R6-P4 登记文件两份都写满后，所有外部会话都写不了东西、且没有任何清理办法', async () => {
  const fx = fixture();
  const a = await external(fx, 'A');
  const own = path.join(fx.base, 'bots', 'writer');
  const pad = JSON.stringify(path.join(own, 'padding')) + '\n';
  fs.writeFileSync(logFile(fx), pad.repeat(Math.ceil(262144 / pad.length)));
  fs.writeFileSync(logFile(fx) + '.1', pad.repeat(Math.ceil(262144 / pad.length)));
  const other = await external(fx, 'B', 'helper');
  const target = path.join(fx.base, 'bots', 'helper', 'note.txt');
  const decision = await other.pre(other.exec('write', {file_path: target, content: 'x'}));
  assert.notEqual(decision.kind, 'deny', '登记满了应当合并/淘汰旧条目，不该让所有外部会话停摆：' + decision.reason);
  assert.ok(a);
});

test('R6-P5a 外部会话用 find -fprint 在自己目录写文件：命令要先问，但写出的文件没登记（只读白名单分支里的写选项）', async () => {
  const fx = fixture();
  const a = await external(fx, 'A');
  const decision = await a.pre(a.exec('bash', {command: 'find . -name x -fprint out.txt', description: '找'}));
  assert.equal(decision.kind, 'ask');
  assert.ok(logOf(fx).includes(path.join(fx.base, 'bots', 'writer', 'out.txt')),
    'find -fprint 批准后会写 out.txt，应登记');
});

test('R6-P5b 外部会话解压/展开压缩包：登记的是 xf、z.tar 这种假路径，解出来的文件没登记', async () => {
  const fx = fixture();
  const a = await external(fx, 'A');
  await a.pre(a.exec('bash', {command: 'tar xf z.tar', description: '解压'}));
  // 模拟解压后得到的文件
  fs.writeFileSync(path.join(fx.base, 'bots', 'writer', 'inner.txt'), '解出来的外部内容');
  const b = await clean(fx, 'B');
  await run(b, 'bash', {command: 'cat inner.txt', description: '读'});
  assert.equal(await askedPwd(b), true, '解压出来的文件应能被追到外部来源');
});

test('R6-P6 外部会话经 ticket_create 写出的工单，别的会话读到后只算「内部」而不是外部（降级洗白）', async () => {
  const fx = fixture();
  const a = await external(fx, 'A');
  const ticket = JSON.parse(await a.run('ticket_create', {title: 't', body: '外部来源给的指令'}));
  const b = await clean(fx, 'B');
  await run(b, 'read', {file_path: ticket.path});
  assert.equal(await askedPwd(b), true, '外部会话写的工单没登记，读它的会话被当成内部来源，只读命令都不再先问');
});
