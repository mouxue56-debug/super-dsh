import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { createHubWeb } from '../server.mjs';
import { startFakeBff } from './fake-bff.mjs';

const tmp = fileURLToPath(new URL('./scratch/', import.meta.url));
await mkdir(tmp, { recursive: true });

test('auth bootstrap, key modes, protected routes, proxy streaming, cancel and host/origin boundaries', async () => {
  const dir = await mkdtemp(join(tmp, 'b2-server-'));
  const webKey = randomBytes(32).toString('hex'), bffKey = randomBytes(32).toString('hex');
  await writeFile(join(dir, 'web.fixture'), webKey, { mode: 0o600 });
  await writeFile(join(dir, 'bff.fixture'), bffKey, { mode: 0o600 });
  const fake = await startFakeBff({ port: 0, key: bffKey });
  const env = { HUB_WEB_PORT: '0', HUB_WEB_KEY_FILE: join(dir, 'web.fixture'), BFF_KEY_FILE: join(dir, 'bff.fixture'), BFF_URL: fake.url };
  const app = await createHubWeb(env);
  const url = `http://127.0.0.1:${app.servers[0].address().port}`;
  try {
    for (const path of ['/', '/hub-real.js', '/bff/health', '/?key=wrong']) assert.equal((await fetch(url + path)).status, 401);
    const login = await fetch(url + '/?key=' + webKey, { redirect: 'manual' });
    assert.equal(login.status, 303); assert.equal(login.headers.get('location'), '/');
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=2592000/);
    const headers = { Cookie: cookie.split(';')[0], 'Content-Type': 'application/json', Origin: url };
    const page = await fetch(url, { headers });
    const html = await page.text();
    assert.match(html, /<script src="\/hub-real.js"><\/script>\s*<\/body>/);
    assert(html.includes("connect-src 'self';") && !html.includes("connect-src 'none';"));
    assert.equal((await fetch(url + '/hub-real.js', { headers })).status, 200);
    assert.equal((await fetch(url + '/pets/pack.json', { headers })).status, 404);
    assert.equal((await fetch(url + '/bff/health', { headers: { ...headers, Origin: 'http://attacker.invalid' } })).status, 403);
    const hostStatus = await new Promise((ok, fail) => {
      const req = http.get(url + '/bff/health', { headers: { ...headers, Host: 'attacker.invalid' } }, res => { res.resume(); ok(res.statusCode); });
      req.on('error', fail);
    });
    assert.equal(hostStatus, 403);
    const health = await (await fetch(url + '/bff/health', { headers })).json();
    assert.equal(health.dsh.connected, true);
    const session = await (await fetch(url + '/bff/sessions', { method: 'POST', headers, body: '{"bot":"chief"}' })).json();
    const root = url + '/bff/sessions/' + session.id;
    const admitted = await (await fetch(root + '/messages', { method: 'POST', headers, body: JSON.stringify({ text: '慢速代理流测试' }) })).json();
    assert.equal(admitted.accepted, true);
    const stream = await fetch(root + '/stream', { headers });
    const reader = stream.body.getReader();
    let output = '', firstDelta;
    while (!output.includes('event: delta')) {
      const chunk = await reader.read(); assert.equal(chunk.done, false);
      output += Buffer.from(chunk.value).toString();
    }
    firstDelta = fake.stats.deltas;
    assert(firstDelta > 0 && firstDelta < 6, 'SSE must arrive before the full response');
    const cancelled = await (await fetch(root + '/cancel', { method: 'POST', headers, body: '{}' })).json();
    assert.equal(cancelled.ok, true); assert.equal(fake.stats.cancels, 1);
    await reader.cancel();
    assert.equal((await stat(env.HUB_WEB_KEY_FILE)).mode & 0o777, 0o600);
    await assert.rejects(createHubWeb({ ...env, HUB_WEB_HOSTS: '0.0.0.0' }), /non-wildcard/);
    await assert.rejects(createHubWeb({ ...env, HUB_WEB_HOSTS: '::' }), /non-wildcard/);
    await assert.rejects(createHubWeb({ ...env, HUB_WEB_HOSTS: '0:0:0:0:0:0:0:0' }), /non-wildcard/);
    const generated = { ...env, HUB_WEB_KEY_FILE: join(dir, 'generated.fixture') };
    const generatedApp = await createHubWeb(generated);
    assert.equal((await stat(generated.HUB_WEB_KEY_FILE)).mode & 0o777, 0o600);
    await generatedApp.close();
    await writeFile(join(dir, 'bad.fixture'), 'invalid-permissions', { mode: 0o644 });
    await assert.rejects(createHubWeb({ ...env, HUB_WEB_KEY_FILE: join(dir, 'bad.fixture') }), /0600/);
    await fake.close();
    assert.equal((await fetch(url + '/bff/health', { headers })).status, 502);
  } finally { await app.close(); if (fake.server.listening) await fake.close(); }
});
