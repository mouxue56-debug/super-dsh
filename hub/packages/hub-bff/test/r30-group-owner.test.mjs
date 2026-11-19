// 主人直接建组、加人、移人。只认主人登录的网页（设备头）；插件那一路不行。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandler, runtimeFor, stop } from '../lib/ext/groups.mjs';

const roster = [
  { id: 'chief', name: '首席', status: 'active' },
  { id: 'research', name: '调研', status: 'active' },
  { id: 'copy', name: '文案', status: 'active' },
  { id: 'image', name: '配图', status: 'active' },
  { id: 'exec', name: '执行', status: 'active' },
  { id: 'old', name: '旧人', status: 'disabled' },
  { id: 'ext1', name: '外面的', status: 'active', kind: 'external' },
];
const owner = { 'x-hub-device': 'owner-phone' };

async function setup(t) {
  const hubHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r30-home-')));
  const deps = {
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'r30-groups-')), hubHome, roster,
    sessions: { create: async () => 's1', send: async () => '过', list: () => [] },
  };
  const handler = createHandler(deps);
  const server = http.createServer(async (req, res) => {
    if (!await handler(req, res)) { res.writeHead(418); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await runtimeFor(deps).idle();
    stop();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, method = 'POST', headers = {}) => {
    const res = await fetch(base + route, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers } });
    return { status: res.status, body: await res.json() };
  };
  const shares = () => JSON.parse(fs.readFileSync(path.join(hubHome, 'config', 'group-shares.json'), 'utf8')).shares;
  return { deps, call, shares };
}

test('主人建组：要设备头，成员至少两位，建出来就是进行中', async (t) => {
  const { call, shares } = await setup(t);
  const plan = { name: '周末安排', members: ['chief', 'research', 'copy'] };
  // 插件那一路不带设备头，不能替主人建组
  assert.equal((await call('/groups/create', plan)).status, 403);
  const made = await call('/groups/create', plan, 'POST', owner);
  assert.equal(made.status, 201);
  const group = made.body.group;
  assert.equal(group.status, 'active');
  assert.equal(group.name, '周末安排');
  assert.equal(group.host, 'chief');
  assert.deepEqual(group.members.map((m) => m.id), ['chief', 'research', 'copy']);
  assert.equal(group.members.find((m) => m.id === 'chief').role, 'host');
  const view = await call(`/groups/${group.id}`, undefined, 'GET');
  assert.equal(view.body.messages.length, 1);
  const [event] = view.body.messages;
  assert.equal(event.system, true);
  assert.equal(event.eventType, 'join');
  assert.equal(event.from, 'owner');
  assert.match(event.text, /首席.*调研.*文案/u);
  assert.deepEqual(view.body.tickets, []);
  assert.equal((await call('/groups/', undefined, 'GET')).body.groups.length, 1);
  const share = shares().find((item) => item.group === group.id);
  assert.deepEqual(share.members, ['chief', 'research', 'copy']);
  assert.equal(share.status, 'active');
  // 建好的组里主人能说话
  const said = await call(`/groups/${group.id}/messages`, { text: '大家好' }, 'POST', owner);
  assert.equal(said.body.ok, true);
});

test('建组的校验：名字、人数、停用、外部、主持', async (t) => {
  const { call } = await setup(t);
  const bad = async (body, status = 400) => assert.equal((await call('/groups/create', body, 'POST', owner)).status,
    status, JSON.stringify(body));
  await bad({ members: ['chief', 'copy'] });
  await bad({ name: '   ', members: ['chief', 'copy'] });
  await bad({ name: '长'.repeat(41), members: ['chief', 'copy'] });
  await bad({ name: '甲', members: ['chief'] });
  await bad({ name: '甲', members: ['chief', 'chief'] });
  await bad({ name: '甲', members: 'chief,copy' });
  await bad({ name: '甲', members: ['chief', 'nobody'] });
  await bad({ name: '甲', members: ['chief', 'ext1'] });
  await bad({ name: '甲', members: ['chief', { id: 'x', kind: 'external' }] });
  await bad({ name: '甲', members: ['chief', 'old'] }, 409);
  await bad({ name: '甲', members: ['chief', 'copy'], host: 'exec' });
  await bad({ name: '甲', members: ['chief', 'copy'], goal: 7 });
  await bad({ name: '甲', members: ['chief', 'research', 'copy', 'image', 'exec', 'chief', 'a1', 'a2', 'a3', 'a4'] });
  const named = await call('/groups/create', { name: '甲', members: ['文案', 'chief'], host: 'chief' }, 'POST', owner);
  assert.equal(named.status, 201);
  assert.equal(named.body.group.host, 'chief');
  assert.deepEqual(named.body.group.members.map((m) => m.id), ['copy', 'chief']);
  // 没有请求体或不是对象
  assert.equal((await call('/groups/create', undefined, 'POST', owner)).status, 400);
});

test('主人加人：幂等、校验、记一条事件、更新放权名单', async (t) => {
  const { call, shares } = await setup(t);
  const made = await call('/groups/create', { name: '三人', members: ['chief', 'research'] }, 'POST', owner);
  const id = made.body.group.id;
  assert.equal((await call(`/groups/${id}/members`, { ids: ['copy'] })).status, 403);
  const added = await call(`/groups/${id}/members`, { ids: ['copy', 'research', 'copy'] }, 'POST', owner);
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.added, ['copy']);
  assert.deepEqual(added.body.group.members.map((m) => m.id), ['chief', 'research', 'copy']);
  const again = await call(`/groups/${id}/members`, { ids: ['copy'] }, 'POST', owner);
  assert.deepEqual(again.body.added, []);
  assert.equal((await call(`/groups/${id}/members`, { ids: [] }, 'POST', owner)).status, 400);
  assert.equal((await call(`/groups/${id}/members`, { ids: ['nobody'] }, 'POST', owner)).status, 400);
  assert.equal((await call(`/groups/${id}/members`, { ids: ['old'] }, 'POST', owner)).status, 409);
  assert.equal((await call(`/groups/${id}/members`, { ids: ['ext1'] }, 'POST', owner)).status, 400);
  assert.equal((await call('/groups/g00000000000000000000/members', { ids: ['copy'] }, 'POST', owner)).status, 404);
  const view = await call(`/groups/${id}`, undefined, 'GET');
  const joins = view.body.messages.filter((m) => m.eventType === 'join');
  assert.equal(joins.length, 2);
  assert.match(joins[1].text, /配图|文案/u);
  assert.deepEqual(shares().find((item) => item.group === id).members, ['chief', 'research', 'copy']);
  // 新成员能在组里说话
  const said = await call(`/groups/${id}/messages`, { from: 'copy', text: '我来了' });
  assert.equal(said.body.ok, true);
  // 上限 8 位
  const many = await call(`/groups/${id}/members`, { ids: ['image', 'exec'] }, 'POST', owner);
  assert.equal(many.body.group.members.length, 5);
});

test('主人移人：主持不能移，至少留两位，有没做完的工单不能移，移出后不能再说话', async (t) => {
  const { deps, call, shares } = await setup(t);
  const four = { name: '四人', members: ['chief', 'research', 'copy', 'image'] };
  const made = await call('/groups/create', four, 'POST', owner);
  const id = made.body.group.id;
  const remove = (who, headers = owner) => call(`/groups/${id}/members/remove`, { id: who }, 'POST', headers);
  assert.equal((await remove('copy', {})).status, 403);
  assert.equal((await remove('chief')).status, 409);
  assert.equal((await remove('nobody')).status, 404);
  assert.equal((await call(`/groups/${id}/members/remove`, {}, 'POST', owner)).status, 400);
  assert.equal((await call(`/groups/${id}/members/remove`, undefined, 'GET', owner)).status, 405);
  // 有没做完的工单：不能移
  const file = path.join(deps.dataDir, 'groups', id, 'tickets.json');
  fs.writeFileSync(file, JSON.stringify([
    { id: 'W1', title: '调研', assignee: 'research', verifier: 'copy', status: 'doing' },
    { id: 'W2', title: '旧', assignee: 'image', verifier: 'chief', status: 'done' },
  ]));
  const blocked = await remove('research');
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /没做完的工单/u);
  assert.equal((await remove('copy')).status, 409);
  // 工单完成的人可以移
  const moved = await remove('image');
  assert.equal(moved.status, 200);
  assert.equal(moved.body.removed, 'image');
  assert.deepEqual(moved.body.group.members.map((m) => m.id), ['chief', 'research', 'copy']);
  assert.deepEqual(shares().find((item) => item.group === id).members, ['chief', 'research', 'copy']);
  const view = await call(`/groups/${id}`, undefined, 'GET');
  const leave = view.body.messages.find((m) => m.eventType === 'leave');
  assert.match(leave.text, /配图/u);
  assert.equal(leave.system, true);
  const late = await call(`/groups/${id}/messages`, { from: 'image', text: '我还在吗' });
  assert.equal(late.status, 403);
  // 清掉工单后继续移到只剩两位，再移就拒
  fs.writeFileSync(file, '[]');
  assert.equal((await remove('copy')).status, 200);
  const last = await remove('research');
  assert.equal(last.status, 409);
  assert.match(last.body.error.message, /至少留两位/u);
});

test('组已结束时不能拉人或移人；不影响原来的分工表建组', async (t) => {
  const { deps, call } = await setup(t);
  const made = await call('/groups/create', { name: '收尾', members: ['chief', 'research', 'copy'] }, 'POST', owner);
  const id = made.body.group.id;
  const file = path.join(deps.dataDir, 'groups', id, 'group.json');
  const group = JSON.parse(fs.readFileSync(file, 'utf8'));
  group.status = 'done';
  fs.writeFileSync(file, JSON.stringify(group));
  assert.equal((await call(`/groups/${id}/members`, { ids: ['image'] }, 'POST', owner)).status, 409);
  assert.equal((await call(`/groups/${id}/members/remove`, { id: 'copy' }, 'POST', owner)).status, 409);
  const plan = await call('/groups/propose', { by: 'chief', name: '分工组', goal: '目标', members: ['research'],
    tickets: [{ title: '调研', goal: '做调研', assignee: 'research', verifier: 'chief', checklist: ['有结果'] }] });
  assert.equal(plan.status, 201);
  assert.equal(plan.body.group.status, 'proposed');
});
