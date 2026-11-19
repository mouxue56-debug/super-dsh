// 语音。只用本机假可执行文件，不听端口，不连真引擎。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { request } from './fixtures.mjs';
import { createHandler } from '../lib/ext/voice.mjs';

const AUDIO = 'abc-audio';

async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'b2-voice-'));
  const cwd = path.join(root, 'work');
  await fs.mkdir(cwd);
  const marker = path.join(root, 'calls.txt');
  const script = path.join(root, 'asr.mjs');
  await fs.writeFile(script, [
    "import fs from 'node:fs';",
    'const file = process.argv[2];',
    'const marker = process.argv[3];',
    "const n = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0;",
    'fs.writeFileSync(marker, String(n + 1));',
    "process.stdout.write('听到了:' + fs.readFileSync(file));",
    '',
  ].join('\n'), { mode: 0o700 });
  const sent = [];
  const deps = {
    hubHome: root,
    dataDir: path.join(root, 'data'),
    hubConfig: { voice: {} },
    panic: { isStopped: () => deps.stopped === true },
    sessions: {
      list: async query => {
        deps.listed = query;
        return [{ id: 's1', bot: 'b1' }];
      },
      send: () => {
        sent.push(1);
        throw new Error('不应发送');
      },
    },
    botCwd: () => cwd,
    isTrusted: () => true,
    stopped: false,
  };
  return {
    root, cwd, deps, sent, marker, script,
    handler: createHandler(deps),
    cmd(extra = []) {
      return [process.execPath, script, '{file}', marker, ...extra];
    },
    async calls() {
      try { return Number(await fs.readFile(marker, 'utf8')); } catch { return 0; }
    },
    async dispose() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

async function post(box, options = {}) {
  const {
    raw = AUDIO, conversation = 's1', bot = 'b1', requestId, mime = 'audio/webm',
    durationMs, method = 'POST',
  } = options;
  const query = new URLSearchParams({ conversation, bot });
  if (durationMs != null) query.set('durationMs', String(durationMs));
  const res = request(box.handler, {
    method,
    path: `/voice/?${query}`,
    raw,
    headers: {
      'content-type': mime,
      ...(requestId ? { 'x-request-id': requestId } : {}),
    },
  });
  await res.done;
  let body = null;
  if (res.res.text) body = JSON.parse(res.res.text);
  return { status: res.res.status, body };
}

async function stored(cwd) {
  const dir = path.join(cwd, 'inbox', 's1');
  try {
    return (await fs.readdir(dir)).filter(name => name !== '.receipts');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('没配引擎时留下音频，同一个请求号之后也不再转', async () => {
  const box = await sandbox();
  try {
    const first = await post(box, { requestId: 'v1', durationMs: 1500 });
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, false);
    assert.equal(first.body.error, 'asr-unavailable');
    assert.equal(first.body.durationMs, 1500);
    assert.match(first.body.id, /^[a-f0-9]{16}$/u);
    assert.equal(first.body.path.startsWith('inbox/s1/voice-'), true);
    const bytes = await fs.readFile(path.join(box.cwd, ...first.body.path.split('/')));
    assert.equal(bytes.toString(), AUDIO);
    box.deps.hubConfig.voice = { asr_cmd: box.cmd(), timeout_ms: 3000 };
    const again = await post(box, { requestId: 'v1', raw: 'other' });
    assert.equal(again.body.error, 'asr-unavailable');
    assert.equal(again.body.id, first.body.id);
    assert.equal(await box.calls(), 0);
    const third = await post(box, { requestId: 'v2' });
    assert.equal(third.body.ok, true);
    assert.equal(third.body.text, `听到了:${AUDIO}`);
    assert.equal(await box.calls(), 1);
    assert.equal(box.sent.length, 0);
    assert.deepEqual(box.deps.listed, { all: true });
  } finally {
    await box.dispose();
  }
});

test('命令失败、找不到程序、两个引擎都配了，音频都还在', async () => {
  const box = await sandbox();
  try {
    box.deps.hubConfig.voice = {
      asr_cmd: [process.execPath, '-e', 'process.exit(3)', '{file}'],
      timeout_ms: 3000,
    };
    const failed = await post(box, { requestId: 'bad' });
    assert.equal(failed.body.error, 'asr-failed');
    assert.equal((await stored(box.cwd)).length, 1);
    box.deps.hubConfig.voice = {
      asr_cmd: [path.join(box.root, 'missing-bin'), '{file}'],
    };
    const missing = await post(box, { requestId: 'gone' });
    assert.equal(missing.body.error, 'asr-failed');
    box.deps.hubConfig.voice = {
      asr_url: 'http://127.0.0.1:9/v1/audio/transcriptions',
      asr_model: 'fake-model',
      asr_cmd: box.cmd(),
    };
    const both = await post(box, { requestId: 'both' });
    assert.equal(both.body.error, 'asr-misconfigured');
    assert.equal(await box.calls(), 0);
    assert.equal((await stored(box.cwd)).length, 3);
  } finally {
    await box.dispose();
  }
});

test('转写地址不是本机回环时不发起请求', async () => {
  const box = await sandbox();
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async () => {
    calls.push(1);
    throw new Error('不应联网');
  };
  try {
    box.deps.hubConfig.voice = {
      asr_url: 'http://example.invalid/v1/audio/transcriptions',
      asr_model: 'fake-model',
    };
    const result = await post(box);
    assert.equal(result.body.error, 'asr-misconfigured');
    assert.equal(calls.length, 0);
    assert.equal((await stored(box.cwd)).length, 1);
  } finally {
    globalThis.fetch = original;
    await box.dispose();
  }
});

test('参数不经 shell，分号仍是单独一格', async () => {
  const box = await sandbox();
  try {
    const script = path.join(box.root, 'args.mjs');
    await fs.writeFile(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    box.deps.hubConfig.voice = {
      asr_cmd: [process.execPath, script, '{file}', 'a;b'],
      timeout_ms: 3000,
    };
    const result = await post(box);
    assert.equal(result.body.ok, true);
    const args = JSON.parse(result.body.text);
    assert.equal(args.length, 2);
    assert.equal(args[1], 'a;b');
    assert.equal(path.isAbsolute(args[0]), true);
    assert.equal(await fs.readFile(args[0], 'utf8'), AUDIO);
  } finally {
    await box.dispose();
  }
});

test('超时会杀掉假引擎并留下音频', { timeout: 8000 }, async () => {
  const box = await sandbox();
  try {
    box.deps.hubConfig.voice = {
      asr_cmd: [process.execPath, '-e', 'setTimeout(() => {}, 20000)', '{file}'],
      timeout_ms: 200,
    };
    const result = await post(box, { requestId: 'slow' });
    assert.equal(result.status, 200);
    assert.equal(result.body.error, 'asr-timeout');
    assert.equal((await stored(box.cwd)).length, 1);
    const again = await post(box, { requestId: 'slow' });
    assert.equal(again.body.error, 'asr-timeout');
    assert.equal((await stored(box.cwd)).length, 1);
  } finally {
    await box.dispose();
  }
});

test('一键全停只存音频，恢复后同一个请求号才转一次', async () => {
  const box = await sandbox();
  try {
    box.deps.hubConfig.voice = { asr_cmd: box.cmd(), timeout_ms: 3000 };
    box.deps.stopped = true;
    const held = await post(box, { requestId: 'hold', mime: 'audio/x-wav' });
    assert.equal(held.body.error, 'stopped');
    assert.equal(held.body.path.endsWith('.wav'), true);
    assert.equal(await box.calls(), 0);
    const still = await post(box, { requestId: 'hold', raw: 'zzz' });
    assert.equal(still.body.error, 'stopped');
    assert.equal(still.body.id, held.body.id);
    assert.equal(await box.calls(), 0);
    box.deps.stopped = false;
    const done = await post(box, { requestId: 'hold' });
    assert.equal(done.body.ok, true);
    assert.equal(done.body.text.startsWith('听到了:'), true);
    assert.equal(await box.calls(), 1);
    const replay = await post(box, { requestId: 'hold', raw: 'nope' });
    assert.equal(replay.body.text, done.body.text);
    assert.equal(await box.calls(), 1);
    assert.equal((await stored(box.cwd)).length, 1);
    assert.equal(box.sent.length, 0);
  } finally {
    await box.dispose();
  }
});

test('空音频、坏时长、非音频类型和相对路径的命令都不转写', async () => {
  const box = await sandbox();
  try {
    const empty = await post(box, { raw: '' });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.message, '音频是空的');
    const duration = await post(box, { durationMs: 'abc' });
    assert.equal(duration.status, 400);
    assert.equal(duration.body.message, '时长无效');
    const kind = await post(box, { mime: 'text/plain' });
    assert.equal(kind.status, 415);
    assert.equal(kind.body.message, '音频类型不在允许范围');
    box.deps.hubConfig.voice = { asr_cmd: ['node', '{file}'], timeout_ms: 1000 };
    const relative = await post(box, { mime: 'audio/mpeg' });
    assert.equal(relative.body.error, 'asr-misconfigured');
    assert.equal((await stored(box.cwd)).length, 1);
    assert.equal(box.sent.length, 0);
  } finally {
    await box.dispose();
  }
});
