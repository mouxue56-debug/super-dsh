// 角色动图分档目录（pets/<包>/x216、x360）要放行，其余深层路径与穿越仍拒绝。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createHubWeb } from '../server.mjs';

test('角色分档动图放行，未知档位与穿越仍拒绝', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'r29-tier-'));
  const shell = join(dir, 'shell');
  await mkdir(join(shell, 'pets/pk/x216'), { recursive: true });
  await mkdir(join(shell, 'pets/pk/x999'), { recursive: true });
  await writeFile(join(shell, 'index.html'), '<html><body>壳</body></html>');
  await writeFile(join(shell, 'pets/pk/idle.webp'), 'base');
  await writeFile(join(shell, 'pets/pk/x216/idle.webp'), 'tier');
  await writeFile(join(shell, 'pets/pk/x999/idle.webp'), 'other');
  await writeFile(join(dir, 'web.key'), 'web-test', { mode: 0o600 });
  await writeFile(join(dir, 'bff.key'), 'bff-test', { mode: 0o600 });
  const web = await createHubWeb({ HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
    HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key') });
  t.after(() => web.close());
  const port = web.servers[0].address().port;
  const url = 'http://127.0.0.1:' + port;
  const login = await fetch(url + '/?key=web-test', { redirect: 'manual' });
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
  assert.equal((await fetch(url + '/pets/pk/idle.webp', { headers })).status, 200);
  assert.equal((await fetch(url + '/pets/pk/x216/idle.webp', { headers })).status, 200);
  assert.equal((await fetch(url + '/pets/pk/x999/idle.webp', { headers })).status, 404);
  const status = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/pets/pk/x216/%2e%2e/idle.webp', headers },
      res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
  });
  assert.equal(status, 404);
});
