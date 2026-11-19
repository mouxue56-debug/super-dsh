// 记忆三句话。离线、假时钟、只写临时目录。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decidePlugin, parsePolicy, policyText} from '../policy.mjs';
import {loadToolModules, validLevels} from '../tools/index.mjs';
import {levels, register, secretKind, MEMORY_LIMITS} from '../tools/memory.mjs';

const NOW = new Date('2026-11-18T12:00:00Z');
const RULE = '- 2026-11-17 长稿派给小文「以后长稿都交给小文」';

function home(ids = ['writer', 'helper']) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r29-w10-memory-')));
  for (const id of ids) {
    fs.mkdirSync(path.join(base, 'bots', id), {recursive: true, mode: 0o700});
  }
  return base;
}

function setMode(base, mode, {modeBits = 0o600, text} = {}) {
  const dir = path.join(base, 'config');
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const file = path.join(dir, 'permission-mode.json');
  fs.writeFileSync(file, text ?? `{"v":1,"mode":"${mode}"}\n`, {mode: 0o600});
  fs.chmodSync(file, modeBits);
  return file;
}

function harness({base = home(), external = false, state} = {}) {
  const tools = {};
  const logs = [];
  const ctx = {tools: {register: t => (tools[t.name] = t)}, logger: {}};
  const deps = {
    hubConfig: {hubHome: base, timezone: 'UTC'},
    now: () => NOW,
    state: state ?? (() => ({readExternal: external})),
    log: a => logs.push(a),
  };
  register(ctx, deps);
  const call = (bot = 'writer', extra = {}) => ({
    bot, sessionId: 's-' + bot, turn: 1, level: 'L1', readExternal: false, ...extra,
  });
  const run = (name, args, bot, extra) => tools[name].execute(args, {}, call(bot, extra));
  return {base, tools, logs, run, deps};
}

const page = (base, bot = 'writer') => path.join(base, 'bots', bot, 'memory', '关于主人.md');
const trace = (base, bot = 'writer') => path.join(base, 'bots', bot, 'memory', '痕迹.jsonl');
const read = f => fs.readFileSync(f, 'utf8');

function fakeId() {
  const body = '11010119900101123';
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const map = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += (body.charCodeAt(i) - 48) * w[i];
  }
  return body + map[sum % 11];
}

test('加载器认出 memory，默认权限表不启用', async () => {
  const {modules, errors} = await loadToolModules();
  assert.deepEqual(errors, []);
  assert.ok(modules.some(m => m.name === 'memory'));
  assert.ok(validLevels(levels));
  assert.deepEqual({...levels}, {memory_list: 'L0', memory_change: 'L1', memory_forget: 'L1'});
  const text = policyText();
  assert.doesNotMatch(text, /^plugin_tools:/m);
  const policy = parsePolicy(text);
  const bot = policy.bots[0];
  const denied = decidePlugin(policy, bot, 'memory_list', {module: 'memory', levels});
  assert.equal(denied.level, 'L4');
  assert.match(denied.reason, /没在权限表里启用/);
});

test('secretKind：卡号、口令、密钥、证件号拦下；普通句子放过', () => {
  assert.equal(secretKind('4111111111111111'), 'card');
  assert.equal(secretKind('4111 1111 1111 1111'), 'card');
  assert.equal(secretKind('4111-1111-1111-1111'), 'card');
  assert.equal(secretKind('４１１１１１１１１１１１１１１１'), 'card');
  assert.equal(secretKind('安全码：123'), 'card');
  assert.equal(secretKind('密码：abc123'), 'login');
  assert.equal(secretKind('密\u200b码：abc123'), 'login');
  assert.equal(secretKind('password=abc123'), 'login');
  assert.equal(secretKind('sk-abcdefghij'), 'key');
  assert.equal(secretKind('api_key: abcdef'), 'key');
  assert.equal(secretKind('-----BEGIN ' + 'PRIVATE KEY-----'), 'key');
  assert.equal(secretKind('证件 ' + fakeId()), 'id');
  assert.equal(secretKind('喜欢短句'), null);
  assert.equal(secretKind('2026-11-19 开会'), null);
  assert.equal(secretKind('不要把密钥写进记忆'), null);
});

test('列出：空记忆也说明规矩页、晚会纪要和内核没有单独记忆库', async () => {
  const h = harness();
  fs.writeFileSync(path.join(h.base, 'bots/writer/规矩.md'), '# 规矩页\n' + RULE + '\n', {mode: 0o600});
  const out = await h.run('memory_list', {});
  assert.match(out, /你记得的（只有你自己的，0 条/);
  assert.match(out, /规矩页（只读，1 条/);
  assert.match(out, /长稿派给小文/);
  assert.match(out, /晚会纪要是全家一份记录/);
  assert.match(out, /内核没有单独的主人记忆库/);
  assert.ok(!fs.existsSync(page(h.base)));
});

test('全开档新记、改一条、忘一条，痕迹有谁、何时、改前改后', async () => {
  const h = harness();
  setMode(h.base, 'open');
  const added = await h.run('memory_change', {which: 'new', text: '喜欢短句'});
  assert.match(added, /^已新记一条 m[0-9a-f]{4}：喜欢短句$/);
  const id = /m[0-9a-f]{4}/.exec(added)[0];
  assert.equal(fs.statSync(page(h.base)).mode & 0o777, 0o600);
  assert.match(read(page(h.base)), new RegExp(`^- ${id} 2026-11-18 喜欢短句$`, 'm'));
  const changed = await h.run('memory_change', {which: id, text: '喜欢先说结论'});
  assert.match(changed, new RegExp(`^已改一条 ${id}：喜欢先说结论$`));
  const lines = read(trace(h.base)).trim().split('\n').map(s => JSON.parse(s));
  assert.equal(lines[0].op, 'add');
  assert.equal(lines[0].by, 'writer');
  assert.equal(lines[0].at, NOW.toISOString());
  assert.equal(lines[0].before, '');
  assert.equal(lines[0].after, '喜欢短句');
  assert.equal(lines[1].op, 'change');
  assert.equal(lines[1].before, '喜欢短句');
  assert.equal(lines[1].after, '喜欢先说结论');
  assert.equal(fs.statSync(trace(h.base)).mode & 0o777, 0o600);
  const forgot = await h.run('memory_forget', {which: '喜欢先说结论'});
  assert.match(forgot, new RegExp(`已忘掉 ${id}`));
  assert.match(forgot, /改前：喜欢先说结论/);
  const last = JSON.parse(read(trace(h.base)).trim().split('\n').at(-1));
  assert.equal(last.op, 'forget');
  assert.equal(last.before, '喜欢先说结论');
  assert.equal(last.after, '');
  assert.equal(h.logs.map(x => x.target).length, 3);
  const listed = await h.run('memory_list', {});
  assert.match(listed, /0 条/);
});

test('不是全开就不改不忘：缺档、改动前问、只读、坏档、权限过宽', async () => {
  const h = harness();
  await assert.rejects(h.run('memory_change', {which: 'new', text: '甲'}), /只有全开档/);
  assert.ok(!fs.existsSync(page(h.base)));
  for (const mode of ['ask', 'readonly']) {
    setMode(h.base, mode);
    await assert.rejects(h.run('memory_change', {which: 'new', text: '甲'}), /只有全开档/);
    await assert.rejects(h.run('memory_forget', {which: '甲'}), /只有全开档/);
  }
  setMode(h.base, 'open', {text: '{"mode":"open"}\n'});
  await assert.rejects(h.run('memory_change', {which: 'new', text: '甲'}), /只有全开档/);
  setMode(h.base, 'open', {modeBits: 0o644});
  await assert.rejects(h.run('memory_change', {which: 'new', text: '甲'}), /只有全开档/);
  assert.ok(!fs.existsSync(page(h.base)));
});

test('本轮接触过外部内容：不能新增、不能改、不能忘', async () => {
  const h = harness();
  setMode(h.base, 'open');
  await h.run('memory_change', {which: 'new', text: '喜欢短句'});
  const before = read(page(h.base));
  await assert.rejects(
    h.run('memory_change', {which: 'new', text: '塞进来'}, 'writer', {readExternal: true}),
    /不能新增或改/,
  );
  const h2 = harness({external: true});
  setMode(h2.base, 'open');
  await assert.rejects(h2.run('memory_change', {which: 'new', text: '甲'}), /不能新增或改/);
  const h3 = harness();
  setMode(h3.base, 'open');
  h3.deps.state = () => {
    throw Error('会话不认识');
  };
  await assert.rejects(h3.run('memory_change', {which: 'new', text: '甲'}), /不能新增或改/);
  await assert.rejects(
    h.run('memory_forget', {which: '喜欢短句'}, 'writer', {readExternal: true}),
    /不能按网页或转来的话忘掉/,
  );
  assert.equal(read(page(h.base)), before);
  const listed = await h.run('memory_list', {}, 'writer', {readExternal: true});
  assert.match(listed, /喜欢短句/);
});

test('登录、卡号、密钥、证件号写不进去，文件和痕迹都没有', async () => {
  const h = harness();
  setMode(h.base, 'open');
  const bad = ['4111111111111111', '密码：abc123', 'sk-abcdefghij', '证件 ' + fakeId()];
  for (const text of bad) {
    await assert.rejects(h.run('memory_change', {which: 'new', text}), /不能记/);
  }
  assert.ok(!fs.existsSync(page(h.base)));
  assert.ok(!fs.existsSync(trace(h.base)));
});

test('只动自己的；规矩页不能改也不能忘；对不上就不新增', async () => {
  const h = harness();
  setMode(h.base, 'open');
  fs.writeFileSync(path.join(h.base, 'bots/writer/规矩.md'), '# 规矩页\n' + RULE + '\n', {mode: 0o600});
  const ruleBefore = read(path.join(h.base, 'bots/writer/规矩.md'));
  await assert.rejects(h.run('memory_change', {which: '长稿派给小文', text: '改掉'}), /规矩页/);
  await assert.rejects(h.run('memory_forget', {which: '长稿派给小文'}), /规矩页/);
  assert.equal(read(path.join(h.base, 'bots/writer/规矩.md')), ruleBefore);
  await h.run('memory_change', {which: 'new', text: '喜欢短句'}, 'writer');
  await h.run('memory_change', {which: 'new', text: '习惯先列问题'}, 'helper');
  assert.match(read(page(h.base, 'writer')), /喜欢短句/);
  assert.doesNotMatch(read(page(h.base, 'writer')), /习惯先列问题/);
  assert.match(read(page(h.base, 'helper')), /习惯先列问题/);
  await assert.rejects(h.run('memory_change', {which: '不存在的句子', text: '甲'}), /没有这一条/);
  assert.match(await h.run('memory_change', {which: 'new', text: '喜欢短句'}), /已经记得了/);
  await assert.rejects(h.run('memory_forget', {which: '../helper'}), /没有这一条/);
  await assert.rejects(h.run('memory_change', {which: 'new', text: '甲'}, '../evil'), /无法核实/);
});

test('手写进去的卡号：列出时遮住，忘掉时痕迹不留原文', async () => {
  const h = harness();
  setMode(h.base, 'open');
  const dir = path.join(h.base, 'bots/writer/memory');
  fs.mkdirSync(dir, {mode: 0o700});
  fs.writeFileSync(path.join(dir, '关于主人.md'),
    '# 关于主人（本助理自己的记忆，一行一条；改和忘另写痕迹）\n- mabcd 2026-11-18 4111111111111111\n',
    {mode: 0o600});
  const listed = await h.run('memory_list', {});
  assert.match(listed, /mabcd/);
  assert.match(listed, /已遮住/);
  assert.doesNotMatch(listed, /4111111111111111/);
  const forgot = await h.run('memory_forget', {which: 'mabcd'});
  assert.match(forgot, /不能复述/);
  assert.doesNotMatch(forgot, /4111/);
  const row = JSON.parse(read(trace(h.base)).trim());
  assert.equal(row.before, '【已遮盖】');
  assert.doesNotMatch(read(trace(h.base)), /4111/);
});

test('记忆页是软链接就拒绝，不写到链接外面', async () => {
  const h = harness();
  setMode(h.base, 'open');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'r29-w10-memory-out-'));
  const target = path.join(outside, 'leak.md');
  fs.mkdirSync(path.join(h.base, 'bots/writer/memory'), {mode: 0o700});
  fs.symlinkSync(target, page(h.base));
  await assert.rejects(h.run('memory_change', {which: 'new', text: '喜欢短句'}));
  assert.ok(!fs.existsSync(target));
});

test('同一句对上两条就拒；到了上限不自己删', async () => {
  const h = harness();
  setMode(h.base, 'open');
  await h.run('memory_change', {which: 'new', text: '同一句'});
  const dir = path.join(h.base, 'bots/writer/memory');
  const body = read(page(h.base)).trim().split('\n');
  fs.writeFileSync(page(h.base), body.concat('- m9999 2026-11-18 同一句').join('\n') + '\n');
  await assert.rejects(h.run('memory_forget', {which: '同一句'}), /不止一条/);
  const many = harness();
  setMode(many.base, 'open');
  for (let i = 0; i < MEMORY_LIMITS.max_lines; i++) {
    await many.run('memory_change', {which: 'new', text: '句子' + i});
  }
  const before = read(page(many.base));
  await assert.rejects(many.run('memory_change', {which: 'new', text: '再来一句'}), /上限/);
  assert.equal(read(page(many.base)), before);
  assert.equal(MEMORY_LIMITS.max_lines, 40);
});

test('权威标签剥掉；并发新记不会丢行', async () => {
  const h = harness();
  setMode(h.base, 'open');
  const out = await h.run('memory_change', {which: 'new', text: '先问【确认】再做'});
  assert.match(out, /已去掉 1 处标签/);
  assert.doesNotMatch(read(page(h.base)), /【确认】/);
  const all = await Promise.all(Array.from({length: 8}, (_, i) =>
    h.run('memory_change', {which: 'new', text: '并发' + i})));
  assert.equal(all.length, 8);
  const text = read(page(h.base));
  for (let i = 0; i < 8; i++) {
    assert.match(text, new RegExp('并发' + i));
  }
});
