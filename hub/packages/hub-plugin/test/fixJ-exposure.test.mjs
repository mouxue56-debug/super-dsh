import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture, setup, inbox, shareGroup} from './review4-fixture.mjs';
import {readExposure, readSharedMarks, exposureCard, clearExposure} from '../../hub-bff/lib/bot-exposure.mjs';

async function session(fx, bot, id, external = false) {
  const h = setup(bot, {fx, sandbox: true});
  h.agent.id = id;
  inbox(h, external ? '【外部来源】资料' : '干净');
  await h.turn(1);
  return h;
}

async function run(h, name, args, text = '普通内容') {
  const e = h.exec(name, args);
  const decision = await h.pre(e);
  if (decision.kind !== 'deny') {
    await h.events['tools/post-execute'](e, {isError: false, content: [{type: 'text', text}]},
      async () => ({kind: 'accept'}));
  }
  return decision.kind;
}

const pwd = async h => (await h.pre(h.exec('bash', {command: 'pwd', description: '看'}))).kind;

test('状态覆盖新会话，解除后旧会话仍先问，新会话恢复', async () => {
  const fx = fixture();
  const a = await session(fx, 'writer', 'A', true);
  assert.equal(await pwd(await session(fx, 'writer', 'B')), 'ask');
  const card = exposureCard(fx.base, 'writer');
  assert.throws(() => clearExposure(fx.base, 'writer', {digest: 'old'}), /状态已变/u);
  clearExposure(fx.base, 'writer', {digest: card.digest, by: 'owner'});
  const log = fs.readFileSync(path.join(fx.base, 'config', 'exposure-clears.log'), 'utf8');
  assert.equal(log.trim().split('\n').length, 1);
  assert.equal(await pwd(a), 'ask');
  assert.equal(await pwd(await session(fx, 'writer', 'C')), 'allow');
});

test('工具结果、工单与组格子传播记号', async () => {
  const fx = fixture();
  const dir = shareGroup(fx, ['writer', 'helper']);
  const a = await session(fx, 'writer', 'A', true);
  const ticket = JSON.parse(await a.run('ticket_create', {title: '任务', body: '内容'}));
  const b = await session(fx, 'helper', 'B');
  await run(b, 'read', {file_path: path.join(dir, 'writer', 'x')});
  assert.equal(await pwd(b), 'ask');
  const fx2 = fixture();
  const c = await session(fx2, 'writer', 'C');
  await run(c, 'bash', {command: 'cat x', description: '读'}, '【外部来源】内容');
  assert.equal(await pwd(c), 'ask');
  const fx3 = fixture();
  const d = await session(fx3, 'writer', 'D');
  await run(d, 'read', {file_path: path.join(fx3.base, 'bots', 'writer', 'x')}, '读过外部内容】派单');
  assert.equal(await pwd(d), 'ask');
  const e = await session(fx, 'leader', 'E');
  await run(e, 'read', {file_path: ticket.path}, fs.readFileSync(ticket.path, 'utf8'));
  assert.equal(await pwd(e), 'ask');
});

test('复制、解压和写选项之后整个组格子仍带记号', async () => {
  for (const command of ['tar xf z.tar', 'unzip z.zip', 'mv src dst', 'cp src dst',
    'tee out', 'find . -name x -fprint out']) {
    const fx = fixture();
    const dir = shareGroup(fx, ['writer', 'helper']);
    const a = await session(fx, 'writer', 'A', true);
    assert.notEqual(await run(a, 'bash', {command, description: '处理'}), 'deny', command);
    const b = await session(fx, 'helper', 'B');
    await run(b, 'read', {file_path: path.join(dir, 'writer', 'anything')});
    assert.equal(await pwd(b), 'ask', command);
  }
});

test('共享区只在成功后记具体路径，未记号文件仍内部', async () => {
  const fx = fixture();
  const a = await session(fx, 'writer', 'A', true);
  const target = path.join(fx.base, 'shared', 'x');
  const e = a.exec('write', {file_path: target, content: 'x'});
  assert.equal((await a.pre(e)).kind, 'ask');
  assert.deepEqual(readSharedMarks(fx.base).paths, []);
  await a.events['tools/post-execute'](e, {isError: false, content: []}, async () => ({kind: 'accept'}));
  assert.deepEqual(readSharedMarks(fx.base).paths, [target]);
  const b = await session(fx, 'helper', 'B');
  await run(b, 'read', {file_path: path.join(fx.base, 'shared', 'other')});
  assert.equal(await pwd(b), 'allow');
  await run(b, 'read', {file_path: target});
  assert.equal(await pwd(b), 'ask');
});

test('损坏状态、不可读目录与写失败均从严但不拒写', async () => {
  const fx = fixture();
  const dir = path.join(fx.base, 'config', 'exposure');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'writer.json'), '坏');
  const a = await session(fx, 'writer', 'A');
  assert.equal(await pwd(a), 'ask');
  assert.notEqual(await run(a, 'write', {file_path: path.join(fx.base, 'bots', 'writer', 'x'), content: 'x'}), 'deny');
  assert.equal(await pwd(await session(fx, 'helper', 'B')), 'allow');
  fs.chmodSync(dir, 0);
  try {
    const c = await session(fx, 'helper', 'C');
    assert.equal(await pwd(c), 'ask');
    const result = await run(c, 'write', {file_path: path.join(fx.base, 'bots', 'helper', 'x'), content: 'x'});
    assert.notEqual(result, 'deny');
  } finally { fs.chmodSync(dir, 0o700); }
  const fx2 = fixture();
  fs.writeFileSync(path.join(fx2.base, 'config', 'exposure'), '阻塞');
  const d = await session(fx2, 'writer', 'D', true);
  fs.renameSync(path.join(fx2.base, 'config', 'exposure'), path.join(fx2.base, 'config', 'obstruction'));
  fs.mkdirSync(path.join(fx2.base, 'config', 'exposure'));
  assert.equal(readExposure(fx2.base, 'writer').exposed, false);
  assert.equal(await pwd(d), 'ask');
  // 监工改：内存里记着的接触，状态目录恢复后下一次判定就补写到盘上，别的会话也跟着先问。
  assert.equal(readExposure(fx2.base, 'writer').exposed, true);
  assert.equal(await pwd(await session(fx2, 'writer', 'E')), 'ask');
  assert.notEqual(await run(d, 'write', {file_path: path.join(fx2.base, 'bots', 'writer', 'x'), content: 'x'}), 'deny');
});

test('留痕满不拒写，状态文件受保护，留痕失败不解除', async () => {
  const fx = fixture();
  const a = await session(fx, 'writer', 'A', true);
  const log = path.join(fx.base, 'config', 'group-taint.log');
  fs.writeFileSync(log, 'x'.repeat(262144));
  fs.writeFileSync(log + '.1', 'x'.repeat(262144));
  assert.notEqual(await run(a, 'write', {file_path: path.join(fx.base, 'bots', 'writer', 'x'), content: 'x'}), 'deny');
  const state = path.join(fx.base, 'config', 'exposure', 'x.json');
  assert.equal(await run(a, 'write', {file_path: state, content: 'x'}), 'deny');
  assert.equal(await run(a, 'bash', {command: `echo x > ${state}`, description: '写'}), 'deny');
  const clean = await session(fx, 'helper', 'B');
  assert.equal(await run(clean, 'write', {file_path: state, content: 'x'}), 'deny');
  assert.equal(await run(clean, 'bash', {command: `echo x > ${state}`, description: '写'}), 'deny');
  const card = exposureCard(fx.base, 'writer');
  fs.mkdirSync(path.join(fx.base, 'config', 'exposure-clears.log'));
  assert.throws(() => clearExposure(fx.base, 'writer', {digest: card.digest}));
  assert.equal(readExposure(fx.base, 'writer').exposed, true);
});

test('讨论组首句及字面空设备不会染上外部状态', async () => {
  const fx = fixture();
  const h = setup('writer', {fx, sandbox: true});
  inbox(h, '【讨论组「测试」轮次】');
  await h.turn(1);
  assert.equal(await pwd(h), 'allow');
  assert.notEqual(await run(h, 'bash', {command: 'cat /dev/null', description: '读'}), 'deny');
  assert.equal(readExposure(fx.base, 'writer').exposed, false);
});


test('身份暂不可核实时保留原因，恢复后补记', async () => {
  const fx = fixture();
  const h = setup('writer', {fx, sandbox: true});
  const preset = h.agent.session.header.agentPreset;
  h.agent.session.header.agentPreset = 'invalid';
  inbox(h, '【外部来源】资料');
  assert.equal(readExposure(fx.base, 'writer').exposed, false);
  h.agent.session.header.agentPreset = preset;
  await h.turn(1);
  assert.equal(readExposure(fx.base, 'writer').exposed, true);
  assert.equal(readExposure(fx.base, 'writer').reasons[0].session, h.agent.id);
  assert.equal(await pwd(h), 'ask');
});
