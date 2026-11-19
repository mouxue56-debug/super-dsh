import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { createHandler } from '../lib/ext/groups.mjs';
import { createFullTextStore, textDigest } from '../lib/fulltext.mjs';
import { loadGroup, saveGroup } from '../lib/group.mjs';
import { ROSTER, planInput } from './group-runtime-fixture.mjs';

// 创建留在仓库测试目录里的隔离运行时。
function setup() {
  const base = path.resolve('test/.tmp');
  fs.mkdirSync(base, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(base, 'group3-'));
  const notices = [];
  const fullText = createFullTextStore(path.join(dataDir, 'fulltext'));
  const rt = createGroupRuntime({ dataDir, roster: ROSTER, fullText, notify: (event) => notices.push(event) });
  return { rt, dataDir, notices, fullText };
}

// 在内存中调用讨论组处理器。
async function request(handler, route, value, headers = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(value))]);
  req.url = route;
  req.method = 'POST';
  req.headers = headers;
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  await handler(req, res);
  return res;
}

test('网页只能以主人发言且不能处理助理工单', async () => {
  const { dataDir } = setup();
  const handler = createHandler({ dataDir, roster: ROSTER });
  const made = await request(handler, '/groups/propose', planInput());
  const base = `/groups/${made.body.group.id}`;
  const headers = { 'x-hub-device': 'device' };
  await request(handler, `${base}/confirm`, { approved: true }, headers);
  const fake = await request(handler, `${base}/messages`, { from: 'research', text: '消息' }, headers);
  assert.equal(fake.status, 400);
  const owner = await request(handler, `${base}/messages`, { text: '消息' }, headers);
  assert.equal(owner.body.message.from, 'owner');
  const plugin = await request(handler, `${base}/messages`, { from: 'owner', text: '消息' });
  assert.equal(plugin.status, 403);
  for (const action of ['accept', 'submit', 'verify']) {
    const result = await request(handler, `${base}/tickets/W1/${action}`, { by: 'research' }, headers);
    assert.equal(result.status, 403);
    const forged = await request(handler, `${base}/tickets/W1/${action}`, { by: 'owner' });
    assert.equal(forged.status, 403);
  }
});

test('复核者：内部的不能做工单；外部的名字要合法、不撞名册；两种都写进卡', async () => {
  const { rt } = setup();
  for (const reviewer of ['research', 'owner', 'bad name!', { kind: 'external', id: 'exec' }]) {
    await assert.rejects(rt.propose(planInput({ reviewer })), { status: 400 });
  }
  const { card } = await rt.propose(planInput({ reviewer: 'exec' }));
  assert.match(card.text, /里程碑复核：执行/u);
  const outside = await rt.propose(planInput({ reviewer: 'outside-reviewer' }));
  assert.match(outside.card.text, /里程碑复核：外部「outside-reviewer」/u);
});

test('分工字段超限直接拒绝', async () => {
  const { rt } = setup();
  const inputs = [
    planInput({ name: '字'.repeat(41) }),
    planInput({ goal: '字'.repeat(301) }),
    planInput({ tickets: Array.from({ length: 13 }, () => planInput().tickets[0]) }),
  ];
  for (const [field, length] of [['title', 61], ['goal', 501], ['checklist', 201]]) {
    const input = planInput();
    input.tickets[0][field] = field === 'checklist' ? ['字'.repeat(length)] : '字'.repeat(length);
    inputs.push(input);
  }
  for (const input of inputs) {
    await assert.rejects(rt.propose(input), { status: 400 });
  }
});

test('损坏的运行状态不覆盖并暂停发言', async () => {
  const { rt, dataDir, notices } = setup();
  const { group } = await rt.propose(planInput());
  await rt.confirm(group.id, { approved: true });
  await rt.idle();
  const file = path.join(dataDir, 'groups', group.id, 'runtime.json');
  fs.writeFileSync(file, '{');
  await assert.rejects(rt.post(group.id, { from: 'owner', text: '继续' }), { status: 409 });
  assert.equal(fs.readFileSync(file, 'utf8'), '{');
  assert.equal(loadGroup(dataDir, group.id).pausedReason, '运行状态损坏，等主人看');
  assert.ok(notices.some((event) => event.text.includes('运行状态损坏')));
});

test('卡片存全文，展示摘要，变更展示内容后拒绝确认', async () => {
  const { rt, dataDir, fullText } = setup();
  const input = planInput({ reviewer: 'exec' });
  input.tickets[0].checklist = Array.from({ length: 8 }, () => '验'.repeat(200));
  const { group, card } = await rt.propose(input);
  const full = fullText.get(card.fullText);
  assert.equal(textDigest(full), card.fullText);
  assert.ok([...card.text].length <= 900);
  assert.match(card.text, /看全文/u);
  assert.ok(full.includes(input.tickets[0].goal));
  const saved = loadGroup(dataDir, group.id);
  saved.reviewer = 'image';
  saveGroup(dataDir, saved);
  await assert.rejects(rt.confirm(group.id, { approved: true }), { status: 409 });
});
