import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {classifyCommand} from '../command-policy.mjs';
import {fixture, setup, inbox} from './review4-fixture.mjs';
import {register} from '../tools/groups.mjs';

test('后续干净消息不能清掉外部来源', async () => {
  const h = setup('writer', {sandbox: true});
  inbox(h, '干净');
  await h.turn(1);
  inbox(h, '【外部来源】资料');
  await h.turn(2);
  inbox(h, '干净');
  await h.turn(3);
  assert.equal((await h.pre(h.exec('bash', {command: 'pwd', description: '看'}))).kind, 'ask');
});

test('复制到自己目录登记具体目标，另一会话读命令继承来源', async () => {
  const fx = fixture();
  const writer = setup('writer', {fx, sandbox: true});
  inbox(writer, '【外部来源】资料');
  await writer.turn(1);
  const own = path.join(fx.base, 'bots', 'writer');
  const target = path.join(own, 'copy.txt');
  await writer.pre(writer.exec('bash', {command: 'cp source.txt copy.txt', description: '复制'}));
  const log = path.join(fx.base, 'config', 'group-taint.log');
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse), [target]);
  const reader = setup('writer', {fx, sandbox: true});
  reader.agent.id = 'reader';
  await reader.turn(1);
  const read = reader.exec('bash', {command: 'cat copy.txt', description: '读'});
  await reader.pre(read);
  await reader.events['tools/post-execute'](read, {isError: false, content: []}, async () => ({kind: 'accept'}));
  assert.equal((await reader.pre(reader.exec('bash', {command: 'pwd', description: '看'}))).kind, 'ask');
});

test('登记去重，轮转后旧文件仍使读者继承来源，轮转文件不能写', async () => {
  const fx = fixture();
  const h = setup('writer', {fx, sandbox: true});
  inbox(h, '【外部来源】资料');
  await h.turn(1);
  const own = path.join(fx.base, 'bots', 'writer');
  const old = path.join(own, 'old.txt');
  const log = path.join(fx.base, 'config', 'group-taint.log');
  const write = () => h.pre(h.exec('bash', {command: 'cp src old.txt', description: '复制'}));
  await write();
  await write();
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);
  const padding = JSON.stringify(path.join(own, 'padding')) + '\n';
  fs.appendFileSync(log, padding.repeat(Math.ceil(262144 / padding.length)));
  await h.pre(h.exec('write', {file_path: path.join(own, 'new.txt'), content: 'x'}));
  assert.ok(fs.existsSync(log + '.1'));
  for (const name of ['write', 'edit']) {
    assert.notEqual((await h.pre(h.exec(name, {file_path: log + '.1', content: 'x'}))).kind, 'allow');
  }
  assert.equal((await h.pre(h.exec('bash', {command: `echo x > ${log}.1`, description: '写'}))).kind, 'deny');
  const reader = setup('writer', {fx, sandbox: true});
  reader.agent.id = 'reader';
  await reader.turn(1);
  const read = reader.exec('read', {file_path: old});
  await reader.pre(read);
  await reader.events['tools/post-execute'](read, {isError: false, content: []}, async () => ({kind: 'accept'}));
  assert.equal((await reader.pre(reader.exec('bash', {command: 'pwd', description: '看'}))).kind, 'ask');
});

test('各字段已有前缀不重复', async () => {
  const tools = {};
  const sent = [];
  const groups = {
    async propose(body) { sent.push(body); return {group: {id: 'g', name: 'n'}}; },
    async accept(_g, _t, body) { sent.push(body); return {}; },
    async verify(_g, _t, body) { sent.push(body); return {}; },
  };
  register({tools: {register(t) { tools[t.name] = t; }}},
    {state: () => ({bot: 'writer', externalTainted: true}), groups});
  const exec = {agent: {id: 's'}};
  const marked = '【外部来源】文字';
  await tools.group_create.execute({name: 'n', goal: marked, members: ['writer'], tickets: [
    {title: marked, goal: '目标', assignee: 'writer', checklist: [marked, '检查']},
  ]}, exec);
  await tools.group_ticket_accept.execute({group: 'g', ticket: 't', restatement: marked}, exec);
  await tools.group_ticket_verify.execute({group: 'g', ticket: 't', verdicts: [
    {item: 1, verdict: 'fail', evidence: marked, reason: '原因'},
  ]}, exec);
  assert.equal(sent[0].goal, marked);
  assert.deepEqual(sent[0].tickets[0].checklist, [marked, '【外部来源】检查']);
  assert.equal(sent[0].tickets[0].title, marked);
  assert.equal(sent[0].tickets[0].goal, '【外部来源】目标');
  assert.equal(sent[1].restatement, marked);
  assert.equal(sent[2].verdicts[0].evidence, marked);
  assert.equal(sent[2].verdicts[0].reason, '【外部来源】原因');
});

test('jq 字段和字符串放行，真实敏感调用仍审批', () => {
  const own = process.cwd();
  const decide = command => classifyCommand({command, cwd: own, home: own, hubHome: path.join(own, 'hub'),
    roots: {own, readable: [own], writable: [own]}, sandboxActive: true, selfAddrs: []}).level;
  for (const expr of ['input', '.a|input', '[inputs]', 'env.HOME', '$ENV', 'include "x"; .',
    '.a | debug', '.x|stderr', '"\\(input)"', '$__loc__']) {
    assert.equal(decide(`jq '${expr}' a`), 'ask', expr);
  }
  for (const expr of ['.input', '.a.include', 'select(.t=="input")', '."x"', '.stderr']) {
    assert.equal(decide(`jq '${expr}' a`), 'run', expr);
  }
});
