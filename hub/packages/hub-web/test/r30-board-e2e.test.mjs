// 主人在界面上改看板，经网页层走到真的后端处理器，落到磁盘上的单。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHubWeb } from '../server.mjs';
import { realDeps } from '../../hub-bff/test/real-deps.mjs';

const BFF_KEY = 'synthetic-bff-key';
const WEB_KEY = 'web-r30-test';
const scratch = fileURLToPath(new URL('./scratch/', import.meta.url));

async function setup() {
  const env = await realDeps({ handlerOptions: { hubConfig: { timezone: 'Asia/Tokyo', meetings: { times: {} } } } });
  await env.f.handler.start();
  const bff = http.createServer((req, res) => { void env.f.handler(req, res); });
  await new Promise(resolve => bff.listen(0, '127.0.0.1', resolve));
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'r30-'));
  await mkdir(join(dir, 'shell'));
  await writeFile(join(dir, 'shell', 'index.html'), '<html><body>离线壳</body></html>');
  await writeFile(join(dir, 'web.key'), WEB_KEY, { mode: 0o600 });
  await writeFile(join(dir, 'bff.key'), BFF_KEY, { mode: 0o600 });
  const bffUrl = `http://127.0.0.1:${bff.address().port}`;
  const web = await createHubWeb({ HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: join(dir, 'shell'),
    HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'), BFF_URL: bffUrl },
  { log: () => assert.fail('unexpected trust log') });
  const url = `http://127.0.0.1:${web.servers[0].address().port}`;
  const login = await fetch(`${url}/?key=${WEB_KEY}`, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (path, { method = 'GET', body, headers = {}, authed = true } = {}) => {
    const res = await fetch(url + '/bff' + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(authed ? { cookie, origin: url } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 如实返回 */ }
    return { status: res.status, json, text };
  };
  return { env, call, async close() {
    await web.close();
    await new Promise(resolve => bff.close(resolve));
    bff.closeAllConnections?.();
    await env.f.dispose();
  } };
}

test('r30 新建、挪列、换负责人、改标题说明：经网页层走到真后端，再读回来一致', async () => {
  const s = await setup();
  try {
    const made = await s.call('/board/tickets/new',
      { method: 'POST', body: { title: '整理相册', goal: '先分年份', to: 'chief' } });
    assert.equal(made.status, 201, made.text);
    const id = made.json.ticket.id;
    assert.equal(made.json.ticket.from.type, 'owner');
    const move = await s.call('/board/tickets/' + id + '/move', { method: 'POST', body: { column: 'review' } });
    assert.equal(move.status, 200, move.text);
    assert.equal(move.json.ticket.review, 'submitted');
    const assign = await s.call('/board/tickets/' + id + '/assign',
      { method: 'POST', body: { assignee: 'pm-agent', assigneeType: 'external' } });
    assert.equal(assign.status, 200, assign.text);
    assert.equal(assign.json.ticket.claimedBy, 'pm-agent');
    const edit = await s.call('/board/tickets/' + id + '/edit', { method: 'POST', body: { title: '整理相册（二）' } });
    assert.equal(edit.status, 200, edit.text);
    const list = await s.call('/board/tickets');
    const row = list.json.tickets.find(t => t.id === id);
    assert.equal(row.title, '整理相册（二）');
    assert.equal(row.goal, '先分年份');
    assert.deepEqual(row.to, ['pm-agent']);
    assert.deepEqual(row.history.map(h => h.action).slice(-3), ['owner_move', 'owner_assign', 'owner_edit']);
    const people = await s.call('/board/people');
    assert.equal(people.status, 200, people.text);
    assert.ok(people.json.people.some(p => p.id === 'chief' && p.type === 'assistant'), people.text);
    const bad = await s.call('/board/tickets/' + id + '/move', { method: 'POST', body: { column: '??' } });
    assert.equal(bad.status, 400);
  } finally {
    await s.close();
  }
});

test('r30 没有设备 cookie 或没有同源 Origin 的改单请求到不了后端', async () => {
  const s = await setup();
  try {
    const made = await s.call('/board/tickets/new', { method: 'POST', body: { title: '只读检查' } });
    const id = made.json.ticket.id;
    const noCookie = await s.call('/board/tickets/' + id + '/move',
      { method: 'POST', body: { column: 'done' }, authed: false });
    assert.equal(noCookie.status, 403, noCookie.text);
    const foreign = await s.call('/board/tickets/' + id + '/move',
      { method: 'POST', body: { column: 'done' }, headers: { origin: 'http://evil.example' } });
    assert.equal(foreign.status, 403, foreign.text);
    const still = (await s.call('/board/tickets')).json.tickets.find(t => t.id === id);
    assert.equal(still.state, 'queued');
  } finally {
    await s.close();
  }
});

test('r30 适配层不再把新看板换成只读列表，也提供看板钩子', () => {
  const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
  assert.match(source, /hasAttribute\('data-r30-board'\)/u);
  for (const name of ['tickets', 'people', 'move', 'assign', 'edit', 'create', 'remove']) {
    assert.match(source, new RegExp(`\\b${name}: `, 'u'), name);
  }
  assert.match(source, /window\.HubBoard = r30BoardHook\(\)/u);
  assert.match(source, /delete window\.HubBoard/u);
});
