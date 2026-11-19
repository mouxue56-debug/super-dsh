// 主动一句的网页转发。端口 3703、3704，跑完关掉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHubWeb, R29_PREFIXES } from '../server.mjs';

const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');

function noticeSource() {
  const start = source.indexOf('function paintOwnerNotice()');
  const end = source.indexOf('try {\n    if (mode === \'real\') paintOwnerNotice();', start);
  assert.ok(start > 0 && end > start);
  return source.slice(start, end);
}

test('首页那一句用文本节点，不把工单原文当页面代码', () => {
  const body = noticeSource();
  assert.equal(body.includes('innerHTML'), false);
  assert.equal(body.includes('insertAdjacentHTML'), false);
  assert.match(body, /textContent/);
  assert.match(body, /data-owner-notice/);
  assert.equal(R29_PREFIXES.includes('notices'), true);
});

test('已登录才把 /bff/notices/ 转到后端', async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, notice: null, quiet: false, stopped: false }));
  });
  await new Promise((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(3703, '127.0.0.1', resolve);
  });
  const root = join(process.cwd(), 'test', 'scratch');
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'r29-notices-'));
  const shell = join(dir, 'shell');
  await mkdir(shell);
  await writeFile(join(shell, 'index.html'), '<html><body>离线壳</body></html>');
  await writeFile(join(dir, 'web.key'), 'web-r29-notices', { mode: 0o600 });
  await writeFile(join(dir, 'bff.key'), 'bff-r29-notices', { mode: 0o600 });
  const web = await createHubWeb({
    HUB_WEB_PORT: '3704', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
    HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'),
    BFF_URL: 'http://127.0.0.1:3703',
  }, { log() {} });
  try {
    const origin = 'http://127.0.0.1:3704';
    const blocked = await fetch(origin + '/bff/notices/?viewing=conv-1');
    assert.equal(blocked.status, 401);
    assert.equal(seen.length, 0);
    const login = await fetch(origin + '/?key=web-r29-notices', { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const allowed = await fetch(origin + '/bff/notices/?viewing=conv-1', { headers: { cookie } });
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.equal(body.ok, true);
    assert.equal(body.notice, null);
    assert.equal(seen.at(-1).startsWith('/notices/'), true);
    assert.match(seen.at(-1), /viewing=conv-1/);
  } finally {
    await web.close();
    await new Promise(resolve => upstream.close(resolve));
    upstream.closeAllConnections?.();
  }
});
