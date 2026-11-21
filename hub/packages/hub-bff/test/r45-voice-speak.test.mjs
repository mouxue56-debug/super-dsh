// 回环假服务验 remote、失败回落、合成切段与没配时的提示。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { request } from './fixtures.mjs';
import { createHandler } from '../lib/ext/voice.mjs';
import { assertVoiceStartup, engines } from '../lib/voice.mjs';
import { cleanForSpeech, splitForSpeech } from '../lib/voice-tts.mjs';

const AUDIO = 'remote-audio';
const DOWN = '转文字暂时不可用，录音已保存';

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

function wav() {
  const data = Buffer.from([0, 0, 0, 0]);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function asrServer(state) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    req.resume();
    req.on('end', () => {
      if (state.down) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('down');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: state.text || '远程听到了' }));
    });
  });
  return { server, seen };
}

function ttsServer() {
  const inputs = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      inputs.push(body);
      const audio = wav();
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'content-length': String(audio.length),
      });
      res.end(audio);
    });
  });
  return { server, inputs };
}

async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r45-speak-'));
  const cwd = path.join(root, 'work');
  await fs.mkdir(cwd);
  const scriptPath = path.join(root, 'fake-native.cjs');
  await fs.writeFile(scriptPath, "process.stdout.write('本体听到了');\n", { mode: 0o700 });
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
    nativeVoice: { bin: process.execPath, script: scriptPath, dylib: '/tmp/r45-speak-dylib' },
  };
  return {
    root, cwd, deps, scriptPath,
    handler: createHandler(deps),
    async dispose() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

async function postVoice(box, requestId = 'v1') {
  const query = new URLSearchParams({ conversation: 's1', bot: 'b1' });
  const res = request(box.handler, {
    method: 'POST',
    path: `/voice/?${query}`,
    raw: AUDIO,
    headers: { 'content-type': 'audio/webm', 'x-request-id': requestId },
  });
  await res.done;
  return { status: res.res.status, body: JSON.parse(res.res.text) };
}

async function postSpeak(box, text, id) {
  const res = request(box.handler, {
    method: 'POST',
    path: '/voice/speak',
    value: id ? { text, id } : { text },
    headers: { 'content-type': 'application/json' },
  });
  await res.done;
  return { status: res.res.status, body: JSON.parse(res.res.text) };
}

describe('第45轮 N8 能听能说', { concurrency: false }, () => {
  test('顺序可以写成数组或逗号，单写 native 仍不和地址混用', () => {
    const url = 'http://127.0.0.1/v1/audio/transcriptions';
    assert.equal(engines({ engine: 'remote', asr_url: url }).kind, 'url');
    assert.deepEqual(engines({ engine: ['remote', 'native'], asr_url: url }).order, ['remote', 'native']);
    assert.deepEqual(engines({ engine: 'native,remote', asr_url: url }).order, ['native', 'remote']);
    assert.equal(engines({ engine: 'native', asr_url: url }).kind, 'both');
    assert.equal(engines({ engine: ['native'], asr_url: url }).kind, 'both');
    assert.equal(engines({ engine: 'remote' }).kind, 'both');
    assert.equal(engines({ engine: 'remote,nope', asr_url: url }).kind, 'bad');
  });

  test('清洗掉代码块、链接和表格，超长按句再按字数切开', () => {
    const raw = [
      '你好。',
      '',
      '```js',
      'secret()',
      '```',
      '',
      '看 [这里](https://example.com/x) 和 https://example.com/y 。',
      '',
      '| 名 | 值 |',
      '| --- | --- |',
      '| a | 1 |',
      '',
      '结束了。',
    ].join('\n');
    const cleaned = cleanForSpeech(raw);
    assert.equal(cleaned.includes('secret'), false);
    assert.equal(cleaned.includes('example.com'), false);
    assert.equal(cleaned.includes('|'), false);
    assert.equal(cleaned.includes('这里'), true);
    assert.deepEqual(splitForSpeech(cleaned, 80), ['你好。', '看 这里 和。', '结束了。']);
    assert.deepEqual(splitForSpeech('一二三四五六七八九十', 4), ['一二三四', '五六七八', '九十']);
  });

  test('remote 打到回环假转写', async () => {
    const fake = asrServer({ text: '今天去散步' });
    const port = await listen(fake.server);
    const box = await sandbox();
    try {
      box.deps.hubConfig.voice = {
        engine: 'remote',
        asr_url: `http://127.0.0.1:${port}/v1/audio/transcriptions`,
        asr_model: 'qwen3-asr',
        timeout_ms: 3000,
      };
      const result = await postVoice(box, 'remote-ok');
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
      assert.equal(result.body.asr, true);
      assert.equal(result.body.text, '今天去散步');
      assert.equal(fake.seen.length, 1);
    } finally {
      await closeServer(fake.server);
      await box.dispose();
    }
  });

  test('remote 失败就改用 native，native 失败就改用 remote', async () => {
    const state = { down: true, text: '远程补上了' };
    const fake = asrServer(state);
    const port = await listen(fake.server);
    const box = await sandbox();
    try {
      const url = `http://127.0.0.1:${port}/v1/audio/transcriptions`;
      box.deps.hubConfig.voice = {
        engine: ['remote', 'native'], asr_url: url, asr_model: 'qwen3-asr', timeout_ms: 3000,
      };
      const first = await postVoice(box, 'fall-native');
      assert.equal(first.body.ok, true);
      assert.equal(first.body.text, '本体听到了');
      assert.equal(fake.seen.length, 1);

      await fs.writeFile(box.scriptPath, 'process.exit(3);\n', { mode: 0o700 });
      fake.seen.length = 0;
      state.down = false;
      box.deps.hubConfig.voice = {
        engine: 'native,remote', asr_url: url, asr_model: 'qwen3-asr', timeout_ms: 3000,
      };
      const second = await postVoice(box, 'fall-remote');
      assert.equal(second.status, 200);
      assert.equal(second.body.text, '远程补上了');
      assert.equal(fake.seen.length, 1);
    } finally {
      await closeServer(fake.server);
      await box.dispose();
    }
  });

  test('两档都失败仍留下录音，并提示可重试', async () => {
    const fake = asrServer({ down: true });
    const port = await listen(fake.server);
    const box = await sandbox();
    try {
      await fs.writeFile(box.scriptPath, 'process.exit(3);\n', { mode: 0o700 });
      box.deps.hubConfig.voice = {
        engine: ['native', 'remote'],
        asr_url: `http://127.0.0.1:${port}/v1/audio/transcriptions`,
        asr_model: 'qwen3-asr',
        timeout_ms: 3000,
      };
      const result = await postVoice(box, 'both-down');
      assert.equal(result.status, 502);
      assert.equal(result.body.error, 'asr-failed');
      assert.equal(result.body.message, DOWN);
      assert.equal(result.body.retryable, true);
      assert.equal(result.body.asr, true);
    } finally {
      await closeServer(fake.server);
      await box.dispose();
    }
  });

  test('没配合成时如实说还没接上', async () => {
    const box = await sandbox();
    try {
      const result = await postSpeak(box, '你好');
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.message, '还没接上');
    } finally {
      await box.dispose();
    }
  });

  test('合成按清洗后的句子依次请求回环服务', async () => {
    const fake = ttsServer();
    const port = await listen(fake.server);
    const box = await sandbox();
    try {
      box.deps.hubConfig.voice = {
        tts_url: `http://127.0.0.1:${port}/v1/audio/speech`,
        tts_model: 'qwen3-tts',
        tts_voice: 'serena',
        tts_timeout_ms: 3000,
        tts_max_chars: 80,
      };
      const raw = '你好。\n```js\nsecret()\n```\n看 [这里](https://example.com/x)。';
      const result = await postSpeak(box, raw, 'msg-1');
      assert.equal(result.body.ok, true);
      assert.equal(result.body.id, 'msg-1');
      assert.equal(result.body.mime, 'audio/wav');
      assert.equal(result.body.count, 2);
      assert.deepEqual(fake.inputs.map(item => item.input), ['你好。', '看 这里。']);
      assert.equal(fake.inputs.every(item => item.model === 'qwen3-tts' && item.voice === 'serena'), true);
      assert.equal(result.body.segments.length, 2);
    } finally {
      await closeServer(fake.server);
      await box.dispose();
    }
  });

  test('公网合成地址拒绝启动，回环地址可以', async () => {
    const publicUrl = 'http://' + ['8', '8', '8', '8'].join('.') + '/v1/audio/speech';
    await assert.rejects(
      () => assertVoiceStartup({
        tts_url: publicUrl, tts_model: 'qwen3-tts', tts_voice: 'serena',
      }, { probe: async () => false }),
      error => error?.code === 'CONFIGURATION' && /私网/.test(error.message),
    );
    await assertVoiceStartup({
      tts_url: 'http://127.0.0.1:9/v1/audio/speech',
      tts_model: 'qwen3-tts',
      tts_voice: 'serena',
    }, { probe: async () => false });
    await assert.rejects(
      () => assertVoiceStartup({ tts_url: 'http://127.0.0.1:9/v1/audio/speech' }, { probe: async () => false }),
      error => /合成模型/.test(error.message),
    );
  });
});
