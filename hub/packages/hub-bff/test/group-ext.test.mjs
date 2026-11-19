import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandler, runtimeFor, start, stop } from '../lib/ext/groups.mjs';

const roster = ['chief', 'research', 'copy', 'image', 'exec'].map((id) => ({ id, status: 'active' }));
const plan = {
  by: 'chief',
  name: '测试组',
  goal: '完成任务',
  members: ['research', 'copy'],
  tickets: [{ title: '调研', goal: '完成调研', assignee: 'research', verifier: 'copy', checklist: ['有结果'] }],
};

async function setup(t, available = true) {
  const cards = [];
  let next = 0;
  const deps = {
    ...(available ? { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'groups-ext-')) } : {}),
    roster,
    sessions: { create: async () => `s${++next}`, send: async () => '过', list: () => [] },
    cards: { ask: (card) => cards.push(card) && undefined },
  };
  const handler = createHandler(deps);
  const server = http.createServer(async (req, res) => {
    if (!await handler(req, res)) {
      res.writeHead(418);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (available) {
      await runtimeFor(deps).idle();
    }
    stop();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, method = 'POST', extra = {}) => {
    const headers = { 'content-type': 'application/json', ...extra };
    const res = await fetch(base + route, { method, body, headers });
    return { status: res.status, body: await res.json() };
  };
  return { deps, cards, handler, base, call };
}

test('真实运行时处理建组、确认、读取和拒绝', async (t) => {
  const { deps, cards, base, call } = await setup(t);
  assert.equal((await fetch(`${base}/other`)).status, 418);
  assert.equal(runtimeFor(deps), runtimeFor(deps));
  assert.equal(start(deps), runtimeFor(deps));
  const made = await call('/groups/propose', JSON.stringify(plan));
  assert.equal(made.status, 201);
  assert.equal(cards.length, 1);
  const gid = made.body.group.id;
  assert.equal((await call('/groups/', undefined, 'GET')).body.groups.length, 1);
  assert.equal((await call(`/groups/${gid}`, undefined, 'GET')).body.group.id, gid);
  // 收口：没有登录设备头（插件那一路）不能替主人确认。
  const noDevice = await call(`/groups/${gid}/confirm`, JSON.stringify({ approved: true }));
  assert.equal(noDevice.status, 403);
  const confirmed = await call(`/groups/${gid}/confirm`, JSON.stringify({ approved: true, by: 'research' }), 'POST',
    { 'x-hub-device': 'owner-phone' });
  assert.equal(confirmed.body.group.status, 'active');
  const long = await call(`/groups/${gid}/messages`, JSON.stringify({ from: 'research', text: '长'.repeat(151) }));
  assert.equal(long.status, 422);
  assert.equal(long.body.reason, 'too_long');
  const verify = await call(`/groups/${gid}/tickets/W1/verify`, JSON.stringify({ by: 'research', verdicts: [] }));
  assert.equal(verify.status, 422);
  assert.equal(verify.body.ok, false);
  assert.equal((await call(`/groups/${gid}/tickets/w1/verify`, '{}')).status, 400);
  assert.equal((await call(`/groups/${gid}?after=-1`, undefined, 'GET')).status, 400);
  assert.equal((await call(`/groups/${gid}`, '{}')).status, 405);
  assert.equal((await call('/groups/unknown/path', '{}')).status, 404);
  assert.equal((await call('/groups/propose', '{')).status, 400);
  assert.equal((await call('/groups/propose', '[]')).status, 400);
  assert.equal((await call(`/groups/${gid}/confirm`, 'null')).status, 400);
  assert.equal((await call('/groups/%E0%A4%A', undefined, 'GET')).status, 400);
  assert.equal((await call('/groups/propose', 'x'.repeat(65537))).status, 413);
});

test('服务未接通返回 503', async (t) => {
  const { call } = await setup(t, false);
  const res = await call('/groups/', undefined, 'GET');
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'UNAVAILABLE');
});

test('不匹配的路径不触碰响应', async (t) => {
  const { handler } = await setup(t);
  const response = new Proxy({}, { get() { throw new Error('响应被触碰'); } });
  assert.equal(await handler({ url: '/groups-other' }, response), false);
});
