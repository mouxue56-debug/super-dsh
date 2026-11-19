import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createHubWeb } from '../server.mjs';

test('备用头像白名单与穿越防护', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r28-assets-'));
  const shell = join(dir, 'shell');
  await mkdir(join(shell, 'pets/spare/x'), { recursive: true });
  await writeFile(join(shell, 'index.html'), '<html><body>壳</body></html>');
  await writeFile(join(shell, 'pets/spare/x/avatar-192.webp'), 'avatar');
  await writeFile(join(shell, 'pets/spare/x/other.webp'), 'other');
  await writeFile(join(shell, 'pets/spare/spare.json'), '{}');
  await writeFile(join(dir, 'web.key'), 'web-test', { mode: 0o600 });
  await writeFile(join(dir, 'bff.key'), 'bff-test', { mode: 0o600 });
  const web = await createHubWeb({ HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
    HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key') });
  t.after(() => web.close());
  const port = web.servers[0].address().port;
  const url = 'http://127.0.0.1:' + port;
  const login = await fetch(url + '/?key=web-test', { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(url + '/pets/spare/x/avatar-192.webp', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(url + '/pets/spare/spare.json', { headers: { cookie } })).status, 200);
  assert.equal((await fetch(url + '/pets/spare/x/other.webp', { headers: { cookie } })).status, 404);
  const status = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/pets/spare/x/%2e%2e/other.webp',
      headers: { cookie } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(status, 404);
});
