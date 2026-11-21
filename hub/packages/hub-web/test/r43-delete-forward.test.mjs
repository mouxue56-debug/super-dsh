import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubWeb, EXT_PREFIXES, R29_PREFIXES, R43_PREFIXES, READONLY_EXT_PREFIXES } from '../server.mjs';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'r43-trash-web-'));
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
  const web = await createHubWeb({
    HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
    HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'),
    BFF_URL: 'http://127.0.0.1:' + fake.address().port,
  }, { log() {} });
  const url = 'http://127.0.0.1:' + web.servers[0].address().port;
  const login = await fetch(url + '/?key=web-test', { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return {
    url, cookie, received,
    async close() {
      await web.close();
      await new Promise(resolve => fake.close(resolve));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('最近删除走已登录的同源转发，不改旧前缀', async () => {
  assert.deepEqual(R43_PREFIXES, ['trash']);
  assert.equal(EXT_PREFIXES.includes('trash'), false);
  assert.equal(READONLY_EXT_PREFIXES.includes('trash'), false);
  assert.equal(R29_PREFIXES.includes('trash'), false);
  const f = await fixture();
  try {
    const before = f.received.length;
    const anonGet = await fetch(f.url + '/bff/trash');
    assert.equal(anonGet.status, 401);
    const anon = await fetch(f.url + '/bff/trash/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    // 未登录的写请求先被 403 挡住，到不了上游。GET 才是 401。
    assert.equal(anon.status, 403);
    assert.equal(f.received.length, before);
    const body = JSON.stringify({ session: 's1', id: 'm1' });
    const res = await fetch(f.url + '/bff/trash/messages', {
      method: 'POST', body,
      headers: { cookie: f.cookie, origin: f.url, 'x-hub-device': 'forged', 'content-type': 'application/json' },
    });
    assert.equal(res.status, 200);
    const seen = f.received.at(-1);
    assert.equal(seen.path, '/trash/messages');
    assert.equal(seen.method, 'POST');
    assert.equal(seen.body, body);
    assert.equal(seen.headers['x-hub-bff-key'], 'bff-test');
    assert.match(seen.headers['x-hub-device'], /^[a-f0-9]{16}$/);
    assert.notEqual(seen.headers['x-hub-device'], 'forged');
    assert.equal((await fetch(f.url + '/bff/trash', { headers: { cookie: f.cookie } })).status, 200);
    assert.equal(f.received.at(-1).path, '/trash');
  } finally {
    await f.close();
  }
});
