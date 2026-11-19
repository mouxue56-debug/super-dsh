// 头像状态：网页层把已登录的 /bff/presence 转给后端。端口 3721、3722，跑完关掉。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHubWeb } from '../server.mjs';

const WEB = 'web-w11';
const BFF = 'bff-w11';
const BFF_PORT = 3721;
const WEB_PORT = 3722;

function startMock(port) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    void Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    seen.push({ method: req.method, path: url.pathname, key: req.headers['x-hub-bff-key'] });
    const known = url.pathname === '/presence' && (req.method === 'GET' || req.method === 'HEAD');
    const body = JSON.stringify(known
      ? { ok: true, bots: { 'bot-a': { state: 'thinking', line: '在想' } } }
      : { ok: false });
    res.writeHead(known ? 200 : 404, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      seen,
      async close() {
        await new Promise(done => server.close(done));
        server.closeAllConnections?.();
      },
    }));
  });
}

test('首页格子的状态句是纯文本，并交给壳换形象', () => {
  const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
  const start = source.indexOf('const R29_FACE');
  const end = source.indexOf('function renderBotList', start);
  assert.ok(start >= 0 && end > start);
  const slice = source.slice(start, end);
  assert.match(slice, /window\.HubRosterStatus/);
  assert.match(slice, /HubPetStage\?\.event\?/);
  assert.match(slice, /H\.petTurn\(id, face\.pet\)/);
  assert.match(slice, /caption\.textContent/);
  assert.match(slice, /data-pet-state/);
  assert.match(slice, /n\.closest\('\.pinned'\)/);
  assert.equal(/innerHTML/.test(slice), false);
});

describe('头像状态转发', { concurrency: 1 }, () => {
  let mock;
  let web;
  let origin;
  let cookie;

  before(async () => {
    mock = await startMock(BFF_PORT);
    const root = join(process.cwd(), 'test', 'scratch');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'w11-'));
    const shell = join(dir, 'shell');
    await mkdir(shell);
    await writeFile(join(shell, 'index.html'), '<html><body>离线壳</body></html>');
    await writeFile(join(dir, 'web.key'), WEB, { mode: 0o600 });
    await writeFile(join(dir, 'bff.key'), BFF, { mode: 0o600 });
    web = await createHubWeb({
      HUB_WEB_PORT: String(WEB_PORT),
      HUB_WEB_HOSTS: '127.0.0.1',
      HUB_WEB_SHELL_DIR: shell,
      HUB_WEB_KEY_FILE: join(dir, 'web.key'),
      BFF_KEY_FILE: join(dir, 'bff.key'),
      BFF_URL: 'http://127.0.0.1:' + BFF_PORT,
    }, { log() {} });
    origin = 'http://127.0.0.1:' + WEB_PORT;
    const login = await fetch(origin + '/?key=' + WEB, { redirect: 'manual' });
    cookie = login.headers.get('set-cookie').split(';')[0];
  });

  after(async () => {
    await web?.close();
    await mock?.close();
  });

  test('登录后的查询转到 /presence，没钥匙是 401', async () => {
    const open = await fetch(origin + '/bff/presence');
    assert.equal(open.status, 401);
    assert.equal(mock.seen.length, 0);
    const hit = await fetch(origin + '/bff/presence', { headers: { cookie, origin } });
    assert.equal(hit.status, 200);
    const body = await hit.json();
    assert.equal(body.bots['bot-a'].line, '在想');
    assert.equal(mock.seen.at(-1).path, '/presence');
    assert.equal(mock.seen.at(-1).method, 'GET');
    assert.equal(mock.seen.at(-1).key, BFF);
    const lookalike = await fetch(origin + '/bff/presence-extra', { headers: { cookie } });
    assert.equal(lookalike.status, 404);
    assert.equal(mock.seen.at(-1).path, '/bff/presence-extra');
  });
});
