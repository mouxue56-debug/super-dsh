// 主人在界面上新建接力、放行、回答，经网页层走到真的后端处理器，落到磁盘上的单。
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
const WEB_KEY = 'web-r32-test';
const scratch = fileURLToPath(new URL('./scratch/', import.meta.url));

async function setup() {
  const env = await realDeps({ handlerOptions: { hubConfig: { timezone: 'Asia/Tokyo', meetings: { times: {} } } } });
  await env.f.handler.start();
  const bff = http.createServer((req, res) => { void env.f.handler(req, res); });
  await new Promise(resolve => bff.listen(0, '127.0.0.1', resolve));
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'r32-'));
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

test('r32 新建接力、退回/放行、改后几棒：经网页层走到真后端，读回来一致；外部不能借建卡塞进路线', async () => {
  const s = await setup();
  try {
    const made = await s.call('/board/tickets/new', { method: 'POST', body: { title: '活动筹备', goal: '办起来', relay: { steps: [
      { who: 'chief', task: '查资料', gate: true }, { who: 'pm-agent2', task: '不存在的人' }] } } });
    assert.equal(made.status, 400, '不认识的人要拒：' + made.text);
    const ok = await s.call('/board/tickets/new', { method: 'POST', body: { title: '活动筹备', goal: '办起来', relay: { steps: [
      { who: 'chief', task: '查资料', gate: true }, { who: 'research', task: '写方案' }, { who: 'owner', task: '看一眼' }] } } });
    assert.equal(ok.status, 201, ok.text);
    const id = ok.json.ticket.id;
    assert.equal(ok.json.ticket.relay.steps.length, 3);
    assert.equal(ok.json.ticket.claimedBy, 'chief');
    // 助理交棒（后端自己的看板，同一目录）
    await s.env.f.handler.board.relayDeliver({ name: 'chief', type: 'assistant' }, id, '查完了');
    const gate = (await s.call('/board/tickets')).json.tickets.find(t => t.id === id);
    assert.equal(gate.relay.phase, 'gate');
    const redo = await s.call('/board/tickets/' + id + '/relay', { method: 'POST', body: { action: 'redo', text: '再查一次' } });
    assert.equal(redo.status, 200, redo.text);
    assert.equal(redo.json.ticket.relay.steps[0].returnedNote, '再查一次');
    await s.env.f.handler.board.relayDeliver({ name: 'chief', type: 'assistant' }, id, '查好了');
    const rel = await s.call('/board/tickets/' + id + '/relay', { method: 'POST', body: { action: 'release' } });
    assert.equal(rel.json.ticket.relay.current, 1);
    const reroute = await s.call('/board/tickets/' + id + '/relay', { method: 'POST', body: { action: 'reroute', steps: [{ who: 'chief', task: '收尾' }] } });
    assert.equal(reroute.json.ticket.relay.steps.length, 3);
    assert.deepEqual((await s.call('/board/tickets')).json.tickets.find(t => t.id === id).relay.steps.map(x => x.who.name), ['chief', 'research', 'chief']);
    const noCookie = await s.call('/board/tickets/' + id + '/relay', { method: 'POST', body: { action: 'release' }, authed: false });
    assert.equal(noCookie.status, 403, noCookie.text);
  } finally {
    await s.close();
  }
});

test('r32 适配层的看板钩子带 relay', () => {
  const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
  assert.match(source, /relay: \(id, body\) => call\('\/tickets\/' \+ enc\(id\) \+ '\/relay', body\)/u);
});
