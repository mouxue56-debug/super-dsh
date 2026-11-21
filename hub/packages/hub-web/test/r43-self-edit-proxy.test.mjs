import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHubWeb} from '../server.mjs';

async function clean(dir) {
  for (const row of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, row.name);
    if (row.isDirectory()) await clean(file);
    else await fs.unlink(file);
  }
  await fs.rmdir(dir);
}
test('改动记录和退回经真实网页登录转发，内部工具入口不对浏览器开放', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r43-web-'));
  const shell = path.join(root, 'shell');
  await fs.mkdir(shell);
  await fs.writeFile(path.join(shell, 'index.html'), '<html><body>假界面</body></html>');
  await fs.writeFile(path.join(root, 'web.key'), 'fake-web', {mode: 0o600});
  await fs.writeFile(path.join(root, 'bff.key'), 'fake-bff', {mode: 0o600});
  const calls = [];
  const bff = http.createServer((req, res) => {
    calls.push({url: req.url, headers: req.headers, method: req.method});
    req.resume();
    req.on('end', () => {res.writeHead(200, {'content-type': 'application/json'}); res.end('{"ok":true}');});
  });
  await new Promise(resolve => bff.listen(0, '127.0.0.1', resolve));
  const web = await createHubWeb({HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
    HUB_WEB_KEY_FILE: path.join(root, 'web.key'), BFF_KEY_FILE: path.join(root, 'bff.key'),
    BFF_URL: 'http://127.0.0.1:' + bff.address().port}, {log() {}});
  t.after(async () => {
    await web.close();
    bff.closeAllConnections();
    await new Promise(resolve => bff.close(resolve));
    await clean(root);
  });
  const origin = 'http://127.0.0.1:' + web.servers[0].address().port;
  assert.equal((await fetch(origin + '/bff/self-edit/log')).status, 401);
  const login = await fetch(origin + '/?key=fake-web', {redirect: 'manual'});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = {cookie, origin, 'content-type': 'application/json', 'x-hub-device': 'forged',
    'x-hub-self-edit-key': 'forged-tool', 'x-hub-owner-proof': 'forged'};
  assert.equal((await fetch(origin + '/bff/self-edit/log', {headers})).status, 200);
  assert.equal(calls.at(-1).url, '/self-edit/log');
  assert.match(calls.at(-1).headers['x-hub-device'], /^[a-f0-9]{16}$/u);
  assert.equal(calls.at(-1).headers['x-hub-self-edit-key'], undefined);
  assert.equal((await fetch(origin + '/bff/self-edit/restore/point-1',
    {method: 'POST', headers, body: '{}'})).status, 200);
  assert.equal(calls.at(-1).url, '/self-edit/restore/point-1');
  const restored=calls.at(-1);
  const [ts,proof]=restored.headers['x-hub-owner-proof'].split('.');
  const input=[restored.headers['x-hub-device'],restored.method,restored.url,ts].join('\n');
  assert.equal(proof,createHmac('sha256','fake-web').update(input).digest('hex'));
  const before = calls.length;
  assert.equal((await fetch(origin + '/bff/self-edit/tool/restart',
    {method: 'POST', headers, body: '{}'})).status, 404);
  assert.equal((await fetch(origin + '/bff/self-edit/log', {method: 'POST', headers, body: '{}'})).status, 405);
  assert.equal((await fetch(origin + '/bff/self-edit/restore/point-1', {headers})).status, 405);
  assert.equal((await fetch(origin + '/bff/self-edit/restore/point-1',
    {method: 'POST', headers: {...headers, origin: 'http://other.invalid'}, body: '{}'})).status, 403);
  assert.equal(calls.length, before);
});
