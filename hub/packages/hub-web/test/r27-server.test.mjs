import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { boardSourceAllowed, createHubWeb, EXT_PREFIXES } from '../server.mjs';

async function fixture(remote = false) {
  const root = process.env.HUB_WEB_TEST_TMP || join(process.cwd(), 'test', 'scratch');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'r27-'));
  const shell = join(dir, 'shell');
  await mkdir(shell);
  await writeFile(join(shell, 'index.html'), '<html><body>离线壳</body></html>');
  await writeFile(join(dir, 'web.key'), 'web-test', { mode: 0o600 });
  await writeFile(join(dir, 'bff.key'), 'bff-test', { mode: 0o600 });
  const received = [];
  const fake = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  const env = {
    HUB_WEB_PORT: '0',
    HUB_WEB_HOSTS: '127.0.0.1',
    HUB_WEB_SHELL_DIR: shell,
    HUB_WEB_KEY_FILE: join(dir, 'web.key'),
    BFF_KEY_FILE: join(dir, 'bff.key'),
    BFF_URL: `http://127.0.0.1:${fake.address().port}`,
    HUB_WEB_BOARD_REMOTE: remote ? '1' : '0',
  };
  const web = await createHubWeb(env, { log: () => assert.fail('unexpected trust log') });
  const url = `http://127.0.0.1:${web.servers[0].address().port}`;
  const login = await fetch(`${url}/?key=web-test`, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return {
    url,
    cookie,
    received,
    async close() {
      await web.close();
      await new Promise(resolve => fake.close(resolve));
    },
  };
}

test('扩展接口与旧路径保持认证和同源限制', async () => {
  const f = await fixture();
  try {
    // 收口：加上 panic、routines、today；dispatch 不进网页层。
    assert.deepEqual(EXT_PREFIXES, ['board', 'ledger', 'groups', 'meetings', 'models', 'panic', 'routines', 'today']);
    assert.equal(EXT_PREFIXES.includes('dispatch'), false);
    for (const prefix of EXT_PREFIXES) {
      const res = await fetch(`${f.url}/bff/${prefix}/tickets?state=queued&x=1`, {
        method: 'POST',
        headers: { cookie: f.cookie, origin: f.url, 'x-hub-device': 'forged', 'content-type': 'text/plain' },
        body: 'hello',
      });
      assert.equal(res.status, 200);
      const seen = f.received.at(-1);
      assert.equal(seen.path, `/${prefix}/tickets?state=queued&x=1`);
      assert.equal(seen.method, 'POST');
      assert.equal(seen.body, 'hello');
      assert.equal(seen.headers['x-hub-bff-key'], 'bff-test');
      assert.match(seen.headers['x-hub-device'], /^[a-f0-9]{16}$/);
      assert.notEqual(seen.headers['x-hub-device'], 'forged');
    }
    assert.equal((await fetch(`${f.url}/bff/ledger`, { headers: { cookie: f.cookie } })).status, 200);
    assert.equal(f.received.at(-1).path, '/ledger');
    for (const path of ['/bff/boards/x', '/bff/boardx', '/bff/ledger-old', '/bff/health']) {
      assert.equal((await fetch(f.url + path, { headers: { cookie: f.cookie } })).status, 200);
      assert.equal(f.received.at(-1).path, path);
    }
    assert.equal((await fetch(`${f.url}/bff/board/../health`, { headers: { cookie: f.cookie } })).status, 200);
    assert.equal(f.received.at(-1).path, '/bff/health');
    const before = f.received.length;
    assert.equal((await fetch(`${f.url}/bff/board/tickets`)).status, 401);
    for (const headers of [
      { origin: f.url },
      { cookie: f.cookie },
      { cookie: f.cookie, origin: 'https://other.invalid' },
      { cookie: f.cookie, origin: f.url, 'sec-fetch-site': 'cross-site' },
    ]) {
      const res = await fetch(`${f.url}/bff/board/tickets`, { method: 'POST', headers, body: 'x' });
      assert.equal(res.status, 403);
    }
    assert.equal(f.received.length, before);
  } finally {
    await f.close();
  }
});

test('远程入口默认关闭', async () => {
  const f = await fixture();
  try {
    const res = await fetch(`${f.url}/board/tickets`, { headers: { authorization: 'Bearer test' } });
    assert.equal(res.status, 401);
    assert.equal((await fetch(`${f.url}/board/tickets`, { headers: { cookie: f.cookie } })).status, 404);
    assert.equal(f.received.length, 0);
  } finally {
    await f.close();
  }
});

test('远程入口隔离头部并拒绝不符合条件的请求', async () => {
  const f = await fixture(true);
  try {
    const headers = {
      authorization: 'Bearer test',
      cookie: f.cookie,
      'x-hub-bff-key': 'forged',
      'x-hub-device': 'forged',
      accept: 'application/json',
      'idempotency-key': 'once',
    };
    const res = await fetch(`${f.url}/board/tickets?state=queued`, { headers });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const seen = f.received[0];
    assert.equal(seen.path, '/board/tickets?state=queued');
    assert.equal(seen.headers.authorization, 'Bearer test');
    assert.equal(seen.headers['idempotency-key'], 'once');
    for (const name of ['x-hub-bff-key', 'x-hub-device', 'cookie', 'origin']) {
      assert.equal(seen.headers[name], undefined);
    }
    const before = f.received.length;
    assert.equal((await fetch(`${f.url}/board/x`, { headers: { ...headers, origin: f.url } })).status, 403);
    assert.equal((await fetch(`${f.url}/board/x`)).status, 401);
    const deleted = await fetch(`${f.url}/board/x`, { method: 'DELETE', headers });
    assert.equal(deleted.status, 405);
    assert.equal(deleted.headers.get('allow'), 'GET, POST');
    const large = await fetch(`${f.url}/board/x`, { method: 'POST', headers, body: 'x'.repeat(262145) });
    assert.equal(large.status, 413);
    assert.equal((await fetch(`${f.url}/ledger/x`, { headers: { authorization: 'Bearer test' } })).status, 401);
    assert.equal(f.received.length, before);
    assert.equal((await fetch(`${f.url}/`, { headers: { cookie: f.cookie } })).status, 200);
    assert.equal((await fetch(`${f.url}/hub-real.js`, { headers: { cookie: f.cookie } })).status, 200);
    assert.equal((await fetch(`${f.url}/bff/board/x`, { headers: { cookie: f.cookie } })).status, 200);
    assert.equal(f.received.at(-1).path, '/board/x');
  } finally {
    await f.close();
  }
});

test('远程来源只允许回环、tailnet 和 Serve', () => {
  for (const ip of ['127.0.0.1', '::1', '100.64.0.1', '100.127.255.255']) {
    assert.equal(boardSourceAllowed(ip, false), true);
  }
  for (const ip of ['100.63.0.1', '100.128.0.1', '192.168.1.5', '8.8.8.8']) {
    assert.equal(boardSourceAllowed(ip, false), false);
  }
  assert.equal(boardSourceAllowed('8.8.8.8', true), true);
});
