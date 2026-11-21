import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createBoard } from '../lib/board.mjs';
import { createHandler } from '../server.mjs';
import { createHubWeb } from '../../hub-web/server.mjs';
import { request } from './fixtures.mjs';
import { seedRoster } from './roster-fixture.mjs';

const owner = { name: 'owner', type: 'owner' };
const settings = '/settings/board-mirror';
const ownerHeaders = { 'x-hub-device': '0123456789abcdef' };
const stub = { modelCatalog: async () => ({}) };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'r41-wiring-'));
  await seedRoster(root);
  const log = { error() {}, warn() {}, log() {} };
  const handlers = [];
  t.after(async () => {
    for (const handler of handlers) await handler.dispose();
    await rm(root, { force: true, recursive: true, maxRetries: 3 });
  });
  return { root, async start(options = {}) {
    const handler = createHandler({
      hubHome: root, storeFile: join(root, 'store.json'), callLogFile: join(root, 'calls.jsonl'),
      key: 'synthetic-bff-key', client: stub, interactions: false, logger: log, ...options,
    });
    handlers.push(handler);
    await handler.ready;
    return handler;
  } };
}

async function soon(fn) {
  for (let i = 0; i < 150; i++) {
    const value = await fn();
    if (value) return value;
    await sleep(20);
  }
  assert.fail('镜像初始化超时');
}

test('服务启动异步重建，后续订阅真实看板事件，并只采用配置名单', async t => {
  const { root, start } = await fixture(t);
  const boardDir = join(root, 'board');
  const beforeStart = createBoard({ root: boardDir });
  await beforeStart.create(owner, { title: '启动前的卡', goal: '重启应看见', to: ['codex'] });
  const dir = join(root, 'custom-mirror');
  await writeFile(join(root, 'config/hub.yaml'), 'version: 1\nboard: ' + JSON.stringify({
    mirror_dir: dir, mirror_throttle_ms: 10, externals: { codex: { inbox: false }, grokbot: { inbox: true } },
  }) + '\n');
  const handler = await start();
  assert.equal(handler.deps.mirror.status().dir, dir);
  await soon(() => handler.deps.mirror.status().state === 'ready');
  assert.match(await readFile(join(dir, '看板.md'), 'utf8'), /启动前的卡/u);
  assert.match(await readFile(join(dir, 'mine/codex.md'), 'utf8'), /启动前的卡/u);
  assert.ok((await stat(join(dir, 'inbox/grokbot'))).isDirectory());

  const created = request(handler, { method: 'POST', path: '/board/tickets/new',
    value: { title: '启动后的卡', goal: '事件触发' } });
  await created.done;
  assert.equal(created.res.status, 201);
  await soon(async () => (await readFile(join(dir, '看板.md'), 'utf8')).includes('启动后的卡'));
});

test('启动不等镜像读取完，默认目录和开关可核对', async t => {
  const { root, start } = await fixture(t);
  let resume;
  const pending = new Promise(resolve => { resume = resolve; });
  const source = createBoard({ root: join(root, 'board') });
  const board = { ...source, async list(...args) { await pending; return source.list(...args); } };
  let handler;
  try {
    const timeout = sleep(3000, undefined, { ref: false }).then(() => assert.fail('启动等待了镜像'));
    handler = await Promise.race([start({ board }), timeout]);
    const status = handler.deps.mirror.status();
    assert.equal(status.state, 'idle');
    assert.equal(status.dir, join(root, 'board-mirror'));
  } finally { resume(); }
  await soon(() => handler.deps.mirror.status().state === 'ready');
});

test('环境变量覆盖配置路径，board.mirror:false 关闭实际启动和重建动作', async t => {
  const { root, start } = await fixture(t);
  const dir = join(root, 'env-mirror');
  const previous = process.env.HUB_BOARD_MIRROR_DIR;
  process.env.HUB_BOARD_MIRROR_DIR = dir;
  let handler;
  try {
    handler = await start({ hubConfig: { board: { mirror: false, mirror_dir: join(root, 'ignored') } } });
  } finally {
    if (previous === undefined) delete process.env.HUB_BOARD_MIRROR_DIR;
    else process.env.HUB_BOARD_MIRROR_DIR = previous;
  }
  const denied = request(handler, { path: settings, key: null });
  await denied.done;
  assert.equal(denied.res.status, 401);
  const deniedDevice = request(handler, { path: settings });
  await deniedDevice.done;
  assert.equal(deniedDevice.res.status, 403);
  const status = request(handler, { path: settings, headers: ownerHeaders });
  assert.equal((await status.json()).dir, dir);
  const rebuilt = request(handler, { method: 'POST', path: settings + '/rebuild', headers: ownerHeaders });
  assert.equal((await rebuilt.json()).state, 'disabled');
  await assert.rejects(stat(dir), { code: 'ENOENT' });
});

test('网页代理用设备 Cookie 和同源校验，今天页透出一条镜像告警', async t => {
  const { root, start } = await fixture(t);
  const blocker = join(root, 'invalid-dir');
  await writeFile(blocker, '路径被文件占用');
  const handler = await start({ hubConfig: { board: { mirror_dir: blocker } } });
  const bff = createServer((req, res) => void handler(req, res));
  bff.listen(0, '127.0.0.1');
  await once(bff, 'listening');
  const shell = join(root, 'shell');
  await mkdir(shell);
  await writeFile(join(shell, 'index.html'), '<html><body>离线测试</body></html>');
  const webKey = join(root, 'test-web.key'), bffKey = join(root, 'test-bff.key');
  await writeFile(webKey, 'synthetic-web-key', { mode: 0o600 });
  await writeFile(bffKey, 'synthetic-bff-key', { mode: 0o600 });
  let web;
  try {
    web = await createHubWeb({
      HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
      HUB_WEB_KEY_FILE: webKey, BFF_KEY_FILE: bffKey, BFF_URL: 'http://127.0.0.1:' + bff.address().port,
    }, { log() {} });
    const origin = 'http://127.0.0.1:' + web.servers[0].address().port;
    const path = origin + '/bff' + settings;
    assert.equal((await fetch(path)).status, 401);
    const login = await fetch(origin + '/?key=synthetic-web-key', { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const headers = { cookie, origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
    const state = await fetch(path, { headers });
    assert.equal(state.status, 200);
    assert.equal((await state.json()).dir, blocker);
    const rebuild = headers => fetch(path + '/rebuild', { method: 'POST', headers, body: '{}' });
    assert.equal((await rebuild({ cookie })).status, 403);
    assert.equal((await rebuild({ ...headers, origin: 'http://127.0.0.1:1' })).status, 403);
    const performed = await rebuild(headers);
    assert.equal(performed.status, 200);
    assert.equal((await performed.json()).state, 'unavailable');
    const today = await fetch(origin + '/bff/today/', { headers });
    assert.equal(today.status, 200);
    assert.match((await today.json()).mirrorNotice, /^任务板文件版：目录不可写/u);
  } finally {
    await web?.close();
    bff.closeAllConnections();
    await new Promise(resolve => bff.close(resolve));
  }
});
