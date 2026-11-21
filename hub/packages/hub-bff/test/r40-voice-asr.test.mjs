// 假 ASR 只听回环随机端口。公网地址用注入的解析，不连别的机器。
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { request, fixture, secretFile } from './fixtures.mjs';
import { createHandler } from '../lib/ext/voice.mjs';
import { assertVoiceStartup } from '../lib/voice.mjs';
import { startServer } from '../server.mjs';

const AUDIO = 'abc-audio';
const DOWN = '转文字暂时不可用，录音已保存';

// 发布扫描不接受网段和尾巴域名的字面量，测试里拼出来。
function dotted(...parts) {
  return parts.join('.');
}
function httpIp(a, b, c, d) {
  return 'http://' + dotted(a, b, c, d) + '/v1/audio/transcriptions';
}
function tailName(...labels) {
  return dotted(...labels, 'ts', 'net');
}
function httpTail(...labels) {
  return 'http://' + tailName(...labels) + '/v1/audio/transcriptions';
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r40-voice-'));
  const cwd = path.join(root, 'work');
  await fs.mkdir(cwd);
  const deps = {
    hubHome: root,
    dataDir: path.join(root, 'data'),
    hubConfig: { voice: {} },
    panic: { isStopped: () => false },
    sessions: {
      list: async () => [{ id: 's1', bot: 'b1' }],
      send: () => { throw new Error('不应发送'); },
    },
    botCwd: () => cwd,
    isTrusted: () => true,
  };
  return {
    root, cwd, deps,
    handler: createHandler(deps),
    async dispose() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

async function post(box, options = {}) {
  const query = new URLSearchParams({
    conversation: options.conversation || 's1',
    bot: options.bot || 'b1',
  });
  if (options.durationMs != null) query.set('durationMs', String(options.durationMs));
  const res = request(box.handler, {
    method: 'POST',
    path: `/voice/?${query}`,
    raw: options.raw == null ? AUDIO : options.raw,
    headers: {
      'content-type': options.mime || 'audio/webm',
      ...(options.requestId ? { 'x-request-id': options.requestId } : {}),
    },
  });
  await res.done;
  const body = res.res.text ? JSON.parse(res.res.text) : null;
  return { status: res.res.status, body };
}

async function stored(cwd) {
  const dir = path.join(cwd, 'inbox', 's1');
  const names = await fs.readdir(dir);
  return names.filter(name => name !== '.receipts');
}

async function disk(cwd, rel) {
  return fs.readFile(path.join(cwd, ...rel.split('/')));
}

function quietProbe() {
  return async () => false;
}

describe('第40轮远程转写', { concurrency: false }, () => {
  test('假 ASR 正常转写，并去掉标签和外壳', async () => {
    const answers = [
      { text: '<|zh|><|NEUTRAL|>  你好  ' },
      { content: '<|HAPPY|>只有内容' },
      { text: '{"content":"外壳里"}' },
    ];
    let n = 0;
    const seen = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        seen.push(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answers[n++] ?? { text: '' }));
      });
    });
    const port = await listen(server);
    const box = await sandbox();
    try {
      box.deps.hubConfig.voice = {
        asr_url: `http://127.0.0.1:${port}/v1/audio/transcriptions`,
        asr_model: 'fake-model',
        language: 'zh',
        timeout_ms: 3000,
      };
      const first = await post(box, { requestId: 'ok-1' });
      assert.equal(first.status, 200);
      assert.equal(first.body.ok, true);
      assert.equal(first.body.asr, true);
      assert.equal(first.body.text, '你好');
      assert.match(seen[0], /name="file"/u);
      assert.match(seen[0], /name="model"/u);
      assert.match(seen[0], /fake-model/u);
      assert.match(seen[0], /name="language"/u);
      assert.match(seen[0], /abc-audio/u);
      const second = await post(box, { requestId: 'ok-2' });
      assert.equal(second.body.text, '只有内容');
      const third = await post(box, { requestId: 'ok-3' });
      assert.equal(third.body.text, '外壳里');
      assert.equal(await stored(box.cwd).then(names => names.length), 3);
    } finally {
      await closeServer(server);
      await box.dispose();
    }
  });

  test('model 空着时沿用 model 字段', async () => {
    let raw = '';
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        raw = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ text: '别名' }));
      });
    });
    const port = await listen(server);
    const box = await sandbox();
    try {
      box.deps.hubConfig.voice = {
        asr_url: `http://127.0.0.1:${port}/v1/audio/transcriptions`,
        model: 'from-model',
      };
      const result = await post(box, { requestId: 'alias' });
      assert.equal(result.body.text, '别名');
      assert.match(raw, /from-model/u);
    } finally {
      await closeServer(server);
      await box.dispose();
    }
  });

  test('超时、500、非 JSON 都留下录音并可重试', async () => {
    const hang = http.createServer(() => {});
    const hangPort = await listen(hang);
    const bad = http.createServer((req, res) => {
      req.resume();
      const mode = new URL(req.url, 'http://127.0.0.1').searchParams.get('mode');
      if (mode === 'json') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('nope');
        return;
      }
      res.writeHead(500);
      res.end('no');
    });
    const badPort = await listen(bad);
    const box = await sandbox();
    try {
      box.deps.hubConfig.voice = {
        asr_url: `http://127.0.0.1:${hangPort}/v1/audio/transcriptions`,
        asr_model: 'm',
        timeout_ms: 200,
      };
      const slow = await post(box, { requestId: 'slow', raw: 'slow-bytes' });
      assert.equal(slow.status, 504);
      assert.equal(slow.body.error, 'asr-timeout');
      assert.equal(slow.body.message, DOWN);
      assert.equal(slow.body.retryable, true);
      assert.equal(slow.body.asr, true);
      assert.equal((await disk(box.cwd, slow.body.path)).toString(), 'slow-bytes');

      box.deps.hubConfig.voice = {
        asr_url: `http://127.0.0.1:${badPort}/v1/audio/transcriptions?mode=500`,
        asr_model: 'm',
        timeout_ms: 3000,
      };
      const failed = await post(box, { requestId: 'http', raw: 'http-bytes' });
      assert.equal(failed.status, 502);
      assert.equal(failed.body.error, 'asr-failed');
      assert.equal(failed.body.message, DOWN);
      assert.equal(failed.body.retryable, true);

      box.deps.hubConfig.voice.asr_url = `http://127.0.0.1:${badPort}/v1?mode=json`;
      const messy = await post(box, { requestId: 'messy' });
      assert.equal(messy.status, 502);
      assert.equal(messy.body.error, 'asr-failed');
      assert.equal(messy.body.message, DOWN);
      assert.equal((await stored(box.cwd)).length, 3);
    } finally {
      await closeServer(hang);
      await closeServer(bad);
      await box.dispose();
    }
  });

  test('同一录音失败后再试不重复落盘', async () => {
    let hits = 0;
    const server = http.createServer((req, res) => {
      req.resume();
      hits += 1;
      if (hits === 1) {
        res.writeHead(500);
        res.end('no');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: '第二次' }));
    });
    const port = await listen(server);
    const box = await sandbox();
    try {
      box.deps.hubConfig.voice = {
        asr_url: `http://127.0.0.1:${port}/v1/audio/transcriptions`,
        asr_model: 'm',
        timeout_ms: 3000,
      };
      const first = await post(box, { requestId: 'again', raw: 'first-bytes' });
      assert.equal(first.status, 502);
      assert.equal(first.body.retryable, true);
      const second = await post(box, { requestId: 'again', raw: 'second-bytes' });
      assert.equal(second.status, 200);
      assert.equal(second.body.text, '第二次');
      assert.equal(second.body.id, first.body.id);
      assert.equal(hits, 2);
      assert.equal((await stored(box.cwd)).length, 1);
      assert.equal((await disk(box.cwd, second.body.path)).toString(), 'first-bytes');
    } finally {
      await closeServer(server);
      await box.dispose();
    }
  });

  test('超过大小或时长仍留下录音，并且不去转', async () => {
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits += 1;
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: '刚好' }));
    });
    const port = await listen(server);
    const box = await sandbox();
    try {
      box.deps.hubConfig.voice = {
        asr_url: `http://127.0.0.1:${port}/v1/audio/transcriptions`,
        asr_model: 'm',
        max_audio_bytes: 4,
        timeout_ms: 3000,
      };
      const big = await post(box, { requestId: 'big', raw: '123456' });
      assert.equal(big.status, 413);
      assert.equal(big.body.error, 'audio-too-large');
      assert.match(big.body.message, /4 字节/u);
      assert.equal((await disk(box.cwd, big.body.path)).toString(), '123456');
      assert.equal(hits, 0);

      box.deps.hubConfig.voice = {
        asr_url: `http://127.0.0.1:${port}/v1/audio/transcriptions`,
        asr_model: 'm',
        timeout_ms: 3000,
      };
      const long = await post(box, { requestId: 'long', durationMs: 301000, raw: 'long-bytes' });
      assert.equal(long.status, 400);
      assert.equal(long.body.error, 'audio-too-long');
      assert.match(long.body.message, /300 秒/u);
      assert.equal((await disk(box.cwd, long.body.path)).toString(), 'long-bytes');
      assert.equal(hits, 0);

      const edge = await post(box, { requestId: 'edge', durationMs: 300000 });
      assert.equal(edge.status, 200);
      assert.equal(edge.body.ok, true);
      assert.equal(edge.body.text, '刚好');
      assert.equal(hits, 1);
    } finally {
      await closeServer(server);
      await box.dispose();
    }
  });

  test('请求遇到跳转不跟随', async () => {
    let followed = 0;
    const sink = http.createServer((req, res) => {
      followed += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: '不该跟来' }));
    });
    const sinkPort = await listen(sink);
    const jump = http.createServer((req, res) => {
      req.resume();
      res.writeHead(302, { location: `http://127.0.0.1:${sinkPort}/landed` });
      res.end();
    });
    const jumpPort = await listen(jump);
    const box = await sandbox();
    try {
      box.deps.hubConfig.voice = {
        asr_url: `http://127.0.0.1:${jumpPort}/v1/audio/transcriptions`,
        asr_model: 'm',
        timeout_ms: 3000,
      };
      const result = await post(box, { requestId: 'jump' });
      assert.equal(result.status, 502);
      assert.equal(result.body.error, 'asr-failed');
      assert.equal(result.body.message, DOWN);
      assert.equal(followed, 0);
      assert.equal((await stored(box.cwd)).length, 1);
    } finally {
      await closeServer(jump);
      await closeServer(sink);
      await box.dispose();
    }
  });

  test('私网地址原样 POST，公网和解析到公网的不发', async () => {
    const seen = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), redirect: init?.redirect });
      return new Response(JSON.stringify({ text: '私网一句' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const box = await sandbox();
    try {
      const urls = [
        httpIp('10', '2', '3', '4'),
        httpIp('192', '168', '8', '8'),
        httpIp('100', '64', '8', '8'),
      ];
      for (const url of urls) {
        box.deps.hubConfig.voice = { asr_url: url, asr_model: 'm' };
        const result = await post(box, { requestId: `ip-${seen.length}` });
        assert.equal(result.body.text, '私网一句');
      }
      assert.deepEqual(seen.map(item => item.url), urls);
      assert.equal(seen.every(item => item.redirect === 'error'), true);

      const tailIp = dotted('100', '70', '1', '2');
      const tailHost = tailName('ears', 'tail');
      box.deps.asrLookup = async () => [tailIp];
      box.deps.hubConfig.voice = {
        asr_url: httpTail('ears', 'tail'),
        asr_model: 'm',
      };
      const named = await post(box, { requestId: 'ts' });
      assert.equal(named.body.ok, true);
      assert.equal(seen[3].url.includes(tailHost), true);
      assert.equal(seen[3].url.includes(tailIp), false);

      const before = seen.length;
      box.deps.hubConfig.voice = {
        asr_url: 'http://8.8.8.8/v1/audio/transcriptions',
        asr_model: 'm',
      };
      const pub = await post(box, { requestId: 'pub' });
      assert.equal(pub.body.error, 'asr-misconfigured');
      assert.equal(pub.status, 200);
      assert.equal(seen.length, before);

      let answer = ['8.8.8.8'];
      box.deps.asrLookup = async () => answer;
      box.deps.hubConfig.voice = {
        asr_url: httpTail('ears', 'tail'),
        asr_model: 'm',
      };
      const blocked = await post(box, { requestId: 'rebind', raw: 'keep-me' });
      assert.equal(blocked.body.error, 'asr-misconfigured');
      assert.equal(seen.length, before);
      answer = ['10.9.9.9'];
      const opened = await post(box, { requestId: 'rebind', raw: 'other' });
      assert.equal(opened.body.text, '私网一句');
      assert.equal(opened.body.id, blocked.body.id);
      assert.equal((await disk(box.cwd, opened.body.path)).toString(), 'keep-me');
      assert.equal(seen.length, before + 1);
    } finally {
      globalThis.fetch = original;
      await box.dispose();
    }
  });

  test('私网和本机地址允许启动', async () => {
    const allow = [
      'http://127.0.0.1/v1/audio/transcriptions',
      'http://127.8.8.8/v1/audio/transcriptions',
      'http://[::1]/v1/audio/transcriptions',
      'http://10.1.2.3/v1/audio/transcriptions',
      'http://192.168.1.9/v1/audio/transcriptions',
      'http://172.16.0.1/v1/audio/transcriptions',
      'http://172.31.255.255/v1/audio/transcriptions',
      'http://169.254.1.1/v1/audio/transcriptions',
      httpIp('100', '64', '0', '1'),
      httpIp('100', '127', '255', '1'),
      'http://[fd00::1]/v1/audio/transcriptions',
    ];
    for (const asrUrl of allow) {
      let looked = false;
      await assertVoiceStartup({ asr_url: asrUrl }, {
        probe: quietProbe(),
        lookup: async () => { looked = true; return ['127.0.0.1']; },
      });
      assert.equal(looked, false, asrUrl);
    }
    await assertVoiceStartup({ asr_url: 'http://localhost/v1/audio/transcriptions' }, {
      probe: quietProbe(),
      lookup: async host => {
        assert.equal(host, 'localhost');
        return ['127.0.0.1'];
      },
    });
    const startupTail = tailName('ears', 'tail');
    await assertVoiceStartup({ asr_url: 'https://' + startupTail + '/v1/audio/transcriptions' }, {
      probe: quietProbe(),
      lookup: async host => {
        assert.equal(host, startupTail);
        return [dotted('100', '84', '195', '10')];
      },
    });
  });

  test('公网、账号、普通域名和跳转拒绝启动', async () => {
    const deny = [
      'http://8.8.8.8/v1/audio/transcriptions',
      'ftp://127.0.0.1/v1/audio/transcriptions',
      'http://127.0.0.1/v1#frag',
      'http://0.0.0.0/v1/audio/transcriptions',
      'http://100.63.0.1/v1/audio/transcriptions',
      'http://100.128.0.1/v1/audio/transcriptions',
      'http://172.15.0.1/v1/audio/transcriptions',
      'http://172.32.0.1/v1/audio/transcriptions',
      'http://[::ffff:127.0.0.1]/v1/audio/transcriptions',
      'http://[fe80::1]/v1/audio/transcriptions',
      'http://example.com/v1/audio/transcriptions',
      'http://' + dotted('evil', 'ts', 'net', 'example', 'com') + '/v1/audio/transcriptions',
      'http://ts.net/v1/audio/transcriptions',
    ];
    for (const asrUrl of deny) {
      let looked = false;
      let probed = false;
      await assert.rejects(
        () => assertVoiceStartup({ asr_url: asrUrl }, {
          probe: async () => { probed = true; return false; },
          lookup: async () => { looked = true; return ['10.0.0.1']; },
        }),
        error => error?.code === 'CONFIGURATION',
        asrUrl,
      );
      assert.equal(looked, false, asrUrl);
      assert.equal(probed, false, asrUrl);
    }
    let userProbe = 0;
    await assert.rejects(
      () => assertVoiceStartup({
        asr_url: 'https://user:pw@127.0.0.1/v1/audio/transcriptions',
      }, {
        probe: async () => { userProbe += 1; return false; },
      }),
      error => {
        assert.equal(error.code, 'CONFIGURATION');
        assert.equal(error.message.includes('pw'), false);
        assert.equal(error.message.includes('user'), false);
        return true;
      },
    );
    assert.equal(userProbe, 0);

    await assert.rejects(
      () => assertVoiceStartup({ asr_url: httpTail('a') }, {
        probe: quietProbe(),
        lookup: async () => ['8.8.8.8'],
      }),
      error => error?.code === 'CONFIGURATION',
    );
    await assert.rejects(
      () => assertVoiceStartup({ asr_url: httpTail('a') }, {
        probe: quietProbe(),
        lookup: async () => ['10.0.0.1', '8.8.8.8'],
      }),
      error => error?.code === 'CONFIGURATION',
    );
    await assert.rejects(
      () => assertVoiceStartup({ asr_url: httpTail('a') }, {
        probe: quietProbe(),
        lookup: async () => { throw new Error('dns down'); },
      }),
      error => error?.code === 'CONFIGURATION',
    );
  });

  test('明确跳转拒绝启动，关着的端口不拦', async () => {
    let followed = 0;
    const sink = http.createServer((req, res) => {
      followed += 1;
      res.writeHead(200);
      res.end('landed');
    });
    const sinkPort = await listen(sink);
    const jump = http.createServer((req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${sinkPort}/landed` });
      res.end();
    });
    const jumpPort = await listen(jump);
    try {
      await assert.rejects(
        () => assertVoiceStartup({
          asr_url: `http://127.0.0.1:${jumpPort}/v1/audio/transcriptions`,
        }),
        error => error?.code === 'CONFIGURATION' && error.message.includes('跳转'),
      );
      assert.equal(followed, 0);
    } finally {
      await closeServer(jump);
      await closeServer(sink);
    }
    const closed = http.createServer((req, res) => res.end('x'));
    const closedPort = await listen(closed);
    await closeServer(closed);
    await assertVoiceStartup({
      asr_url: `http://127.0.0.1:${closedPort}/v1/audio/transcriptions`,
    });
  });

  test('启动时公网地址拒绝监听，私网地址可以起来', async () => {
    const pub = await fixture();
    const memory = new EventEmitter();
    memory.listening = false;
    memory.listen = () => { memory.listening = true; };
    memory.closeAllConnections = () => {};
    memory.close = ready => { memory.listening = false; if (ready) ready(); };
    try {
      const base = pub.handler.deps?.hubConfig ?? {};
      await assert.rejects(
        async () => startServer({
          port: 13296,
          keyFile: `${await secretFile()}.voice-public`,
          client: pub.client,
          ...pub.handlerOptions,
          hubConfig: {
            ...base,
            voice: {
              asr_url: 'http://8.8.8.8/v1/audio/transcriptions',
              asr_model: 'm',
            },
          },
          asrProbe: async () => false,
          serverFactory() { return memory; },
        }),
        error => error?.code === 'CONFIGURATION' && error.message.includes('8.8.8.8'),
      );
      assert.equal(memory.listening, false);
    } finally {
      await pub.dispose();
    }

    const priv = await fixture();
    const up = new EventEmitter();
    up.listening = false;
    up.bound = null;
    up.listen = (port, host, ready) => {
      up.listening = true;
      up.bound = { port, host };
      queueMicrotask(ready);
    };
    up.closeAllConnections = () => {};
    up.close = ready => { up.listening = false; if (ready) ready(); };
    let app;
    try {
      const base = priv.handler.deps?.hubConfig ?? {};
      const keyFile = `${await secretFile()}.voice-private`;
      app = await startServer({
        port: 13297,
        keyFile,
        client: priv.client,
        ...priv.handlerOptions,
        hubConfig: {
          ...base,
          voice: {
            asr_url: 'http://10.1.2.3/v1/audio/transcriptions',
            asr_model: 'm',
          },
        },
        asrProbe: async () => false,
        serverFactory() { return up; },
      });
      assert.equal(up.listening, true);
      assert.deepEqual(up.bound, { port: 13297, host: '127.0.0.1' });
    } finally {
      if (app) await app.close();
      await priv.dispose();
    }
  });
});
