// 假转写故意先卡住。端口用系统分配的空闲端口，测完关掉。不连真引擎。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { request } from './fixtures.mjs';
import { createHandler } from '../lib/ext/voice.mjs';

async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'w1-voice-'));
  const cwd = path.join(root, 'work');
  await fs.mkdir(cwd);
  const sent = [];
  const deps = {
    hubHome: root,
    dataDir: path.join(root, 'data'),
    hubConfig: { voice: {} },
    panic: { isStopped: () => false },
    sessions: {
      list: async () => [{ id: 's1', bot: 'b1' }],
      send: () => { sent.push(1); throw new Error('不应发送'); }
    },
    botCwd: () => cwd,
    isTrusted: () => true
  };
  return {
    root, cwd, deps, sent,
    handler: createHandler(deps),
    async dispose() { await fs.rm(root, { recursive: true, force: true }); }
  };
}

// 监听 0，等 listening 回调再返回系统分到的端口。
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function post(box, options = {}) {
  const query = new URLSearchParams({
    conversation: options.conversation || 's1',
    bot: options.bot || 'b1'
  });
  const res = request(box.handler, {
    method: 'POST',
    path: `/voice/?${query}`,
    raw: options.raw || 'abc-audio',
    headers: {
      'content-type': 'audio/webm',
      ...(options.requestId ? { 'x-request-id': options.requestId } : {})
    }
  });
  await res.done;
  const body = res.res.text ? JSON.parse(res.res.text) : null;
  return { status: res.res.status, body };
}

// 看到回执锁被第二路独占失败，说明第二路已经堵在同一请求号上。
function watchReceiptLock(suffix, notify) {
  const original = fs.open;
  fs.open = async function(file, flags, mode) {
    try {
      return await original.call(fs, file, flags, mode);
    } catch (error) {
      if (error?.code === 'EEXIST' && String(file).endsWith(suffix)) notify();
      throw error;
    }
  };
  return () => { fs.open = original; };
}

test('延迟的假转写对同一请求号只跑一次，音频留下', { timeout: 8000 }, async () => {
  const seen = [];
  let releaseFirst = () => {};
  let markFirst = () => {};
  const firstBody = new Promise(resolve => { markFirst = resolve; });
  let markWaiting = () => {};
  const secondWaiting = new Promise(resolve => { markWaiting = resolve; });
  const server = http.createServer((req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen.push(Buffer.concat(chunks).toString('utf8'));
      const respond = () => {
        if (res.writableEnded) return;
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ text: '延迟一句' }));
      };
      if (seen.length === 1) {
        releaseFirst = respond;
        markFirst();
      } else {
        respond();
      }
    });
  });
  const box = await sandbox();
  const restoreOpen = watchReceiptLock('voice-slow-1.json.lock', () => markWaiting());
  try {
    const port = await listen(server);
    box.deps.hubConfig.voice = {
      asr_url: `http://127.0.0.1:${port}/v1/audio/transcriptions`,
      asr_model: 'fake-model',
      timeout_ms: 3000
    };
    const firstPromise = post(box, { requestId: 'slow-1' });
    await firstBody;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].includes('abc-audio'), true);
    const secondPromise = post(box, { requestId: 'slow-1', raw: 'other-audio' });
    await secondWaiting;
    releaseFirst();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.text, '延迟一句');
    assert.equal(second.body.text, first.body.text);
    assert.equal(second.body.id, first.body.id);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].includes('fake-model'), true);
    assert.equal(seen[0].includes('abc-audio'), true);
    assert.equal(seen[0].includes('other-audio'), false);
    const file = path.join(box.cwd, ...first.body.path.split('/'));
    assert.equal(await fs.readFile(file, 'utf8'), 'abc-audio');
    const other = await post(box, { requestId: 'slow-2' });
    assert.equal(other.body.ok, true);
    assert.equal(other.body.text, '延迟一句');
    assert.notEqual(other.body.id, first.body.id);
    assert.equal(seen.length, 2);
    assert.equal(box.sent.length, 0);
  } finally {
    restoreOpen();
    releaseFirst();
    await new Promise(resolve => server.close(resolve));
    await box.dispose();
  }
});

test('没配引擎时不连假转写，音频仍留下', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    seen.push(1);
    res.writeHead(500);
    res.end('不应连上');
  });
  const box = await sandbox();
  try {
    await listen(server);
    const held = await post(box, { requestId: 'none-1' });
    assert.equal(held.status, 200);
    assert.equal(held.body.ok, false);
    assert.equal(held.body.error, 'asr-unavailable');
    const file = path.join(box.cwd, ...held.body.path.split('/'));
    assert.equal(await fs.readFile(file, 'utf8'), 'abc-audio');
    const again = await post(box, { requestId: 'none-1', raw: 'other-audio' });
    assert.equal(again.body.id, held.body.id);
    assert.equal(again.body.error, 'asr-unavailable');
    assert.equal(await fs.readFile(file, 'utf8'), 'abc-audio');
    assert.equal(seen.length, 0);
    assert.equal(box.sent.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await box.dispose();
  }
});
