// 路31 第三轮复核：恢复（解除一键全停）不该比「确认分工表」更容易。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import * as panic from '../lib/ext/panic.mjs';

async function call(handler, method, url, headers = {}) {
  const req = Readable.from([]);
  req.url = url;
  req.method = method;
  req.headers = headers;
  const res = {text: ''};
  res.writeHead = s => { res.status = s; };
  res.end = t => { res.text += t ?? ''; };
  await handler(req, res);
  return res.status;
}

// 发现 11（低）：讨论组确认要求登录设备头（x-hub-device），/panic/resume 只要有后端密钥就能解除停机。
test('R3-11 /panic/resume 也要求主人登录设备头', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-panic-'));
  const deps = {dataDir, isTrusted: () => true, logger: {error() {}}, hubConfig: {panic: {timers: []}},
    sessions: {create: async () => ({}), send: async () => ({}), list: async () => [], cancel: async () => {}}};
  const handler = panic.createHandler(deps);
  assert.equal(await call(handler, 'POST', '/panic/stop'), 200);
  assert.equal(await call(handler, 'POST', '/panic/resume'), 403, '没有设备头也能恢复');
});
