// voice.engine: native。本体命令用假脚本顶替，不装本体、不加载真模型。
// 假脚本吃 argv[2] 的音频路径，检查后端传的 DYLD_LIBRARY_PATH，按脚本名决定成败。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { request } from './fixtures.mjs';
import { createHandler } from '../lib/ext/voice.mjs';
import { engines } from '../lib/voice.mjs';

const AUDIO = 'native-audio';
const DOWN = '转文字暂时不可用，录音已保存';
const FAKE_DYLIB = '/tmp/r45-fake-dylib';

async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'r45-native-'));
  const cwd = path.join(root, 'work');
  await fs.mkdir(cwd);
  const marker = path.join(root, 'hits.txt');
  // 假的本体命令：读 argv[2] 的音频，校验后端注入的 DYLD_LIBRARY_PATH，转写文字写到 stdout。
  // 期望值在生成时写死进脚本（子进程只拿 PATH/HOME/DYLD_LIBRARY_PATH 三个变量）。
  const scriptPath = path.join(root, 'fake-native.cjs');
  await fs.writeFile(scriptPath, [
    "const fs = require('node:fs');",
    `if (process.env.DYLD_LIBRARY_PATH !== ${JSON.stringify(FAKE_DYLIB)}) process.exit(4);`,
    "process.stdout.write('听到了:' + fs.readFileSync(process.argv[2]) + ' DYLD-OK');",
    '',
  ].join('\n'), { mode: 0o700 });
  const sent = [];
  const deps = {
    hubHome: root,
    dataDir: path.join(root, 'data'),
    hubConfig: { voice: {} },
    panic: { isStopped: () => deps.stopped === true },
    sessions: {
      list: async () => [{ id: 's1', bot: 'b1' }],
      send: () => { sent.push(1); throw new Error('不应发送'); },
    },
    botCwd: () => cwd,
    isTrusted: () => true,
    stopped: false,
    nativeVoice: { bin: process.execPath, script: scriptPath, dylib: FAKE_DYLIB },
  };
  return {
    root, cwd, deps, scriptPath, marker, sent,
    handler: createHandler(deps),
    native(extra = {}) {
      return { engine: 'native', timeout_ms: 3000, ...extra };
    },
    async hits() {
      try { return Number(await fs.readFile(marker, 'utf8')); } catch { return 0; }
    },
    async dispose() {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function post(box, options = {}) {
  const query = new URLSearchParams({ conversation: 's1', bot: 'b1' });
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
  return { status: res.res.status, body: res.res.text ? JSON.parse(res.res.text) : null };
}

async function stored(cwd) {
  const dir = path.join(cwd, 'inbox', 's1');
  const names = await fs.readdir(dir);
  return names.filter(name => name !== '.receipts');
}

async function disk(cwd, rel) {
  return fs.readFile(path.join(cwd, ...rel.split('/')));
}

// 计数版假脚本：marker 路径在生成时写死进去（后端 native 只传音频一个参数）。
async function useCountingScript(box) {
  const script = path.join(box.root, 'fake-counting.cjs');
  await fs.writeFile(script, [
    "const fs = require('node:fs');",
    `const marker = ${JSON.stringify(box.marker)};`,
    `if (process.env.DYLD_LIBRARY_PATH !== ${JSON.stringify(FAKE_DYLIB)}) process.exit(4);`,
    "const n = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0;",
    'fs.writeFileSync(marker, String(n + 1));',
    "process.stdout.write('听到了:' + fs.readFileSync(process.argv[2]));",
    '',
  ].join('\n'), { mode: 0o700 });
  box.deps.nativeVoice.script = script;
  return script;
}

describe('第45轮本体转写（native 引擎）', { concurrency: false }, () => {
  test('engine 配置分发正确', () => {
    assert.equal(engines({ engine: 'native' }).kind, 'native');
    assert.equal(engines({ engine: 'native', asr_url: 'http://127.0.0.1/x' }).kind, 'both');
    assert.equal(engines({ engine: 'native', asr_cmd: ['x'] }).kind, 'both');
    assert.equal(engines({ engine: 'bogus' }).kind, 'bad');
    assert.equal(engines({ engine: '' }).kind, 'none');
    assert.equal(engines({}).kind, 'none');
    assert.equal(engines({ asr_url: 'http://127.0.0.1/x' }).kind, 'url');
    assert.equal(engines({ asr_cmd: ['x'] }).kind, 'cmd');
  });

  test('假的本体命令转写成功，传给它的是落盘音频和本体原生库目录', async () => {
    const box = await sandbox();
    try {
      box.deps.hubConfig.voice = box.native();
      const result = await post(box, { requestId: 'ok-1', raw: 'hello-native' });
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
      assert.equal(result.body.asr, true);
      assert.equal(result.body.text, '听到了:hello-native DYLD-OK');
      assert.equal(await disk(box.cwd, result.body.path).then(b => b.toString()), 'hello-native');
      assert.equal((await stored(box.cwd)).length, 1);
    } finally {
      await box.dispose();
    }
  });

  test('假命令输出为空也算转写成功', async () => {
    const box = await sandbox();
    try {
      const script = path.join(box.root, 'fake-empty.cjs');
      await fs.writeFile(script, "process.stdout.write('');\n", { mode: 0o700 });
      box.deps.nativeVoice.script = script;
      box.deps.hubConfig.voice = box.native();
      const result = await post(box, { requestId: 'empty' });
      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);
      assert.equal(result.body.text, '');
    } finally {
      await box.dispose();
    }
  });

  test('假命令失败：录音留下，可重试，同请求号再来一次成功', async () => {
    const box = await sandbox();
    try {
      // 先挂一个必败的假命令。
      await fs.writeFile(box.scriptPath, 'process.exit(3);\n', { mode: 0o700 });
      box.deps.hubConfig.voice = box.native();
      const failed = await post(box, { requestId: 'again', raw: 'keep-native' });
      assert.equal(failed.status, 502);
      assert.equal(failed.body.error, 'asr-failed');
      assert.equal(failed.body.message, DOWN);
      assert.equal(failed.body.retryable, true);
      assert.equal(failed.body.asr, true);
      assert.equal(await disk(box.cwd, failed.body.path).then(b => b.toString()), 'keep-native');

      // 换成稳定成功的假命令，同一个请求号重试。
      await fs.writeFile(box.scriptPath, [
        "const fs = require('node:fs');",
        `if (process.env.DYLD_LIBRARY_PATH !== ${JSON.stringify(FAKE_DYLIB)}) process.exit(4);`,
        "process.stdout.write('第二次:' + fs.readFileSync(process.argv[2]));",
        '',
      ].join('\n'), { mode: 0o700 });
      const second = await post(box, { requestId: 'again', raw: 'second-bytes' });
      assert.equal(second.status, 200);
      assert.equal(second.body.ok, true);
      assert.equal(second.body.text, '第二次:keep-native');
      assert.equal(second.body.id, failed.body.id);
      assert.equal((await stored(box.cwd)).length, 1);
      assert.equal(await disk(box.cwd, second.body.path).then(b => b.toString()), 'keep-native');
    } finally {
      await box.dispose();
    }
  });

  test('假命令卡住：转写超时，录音留下，可重试', async () => {
    const box = await sandbox();
    try {
      const script = path.join(box.root, 'fake-hang.cjs');
      await fs.writeFile(script, "setTimeout(() => {}, 20000);\n", { mode: 0o700 });
      box.deps.nativeVoice.script = script;
      box.deps.hubConfig.voice = box.native({ timeout_ms: 250 });
      const result = await post(box, { requestId: 'slow', raw: 'slow-native' });
      assert.equal(result.status, 504);
      assert.equal(result.body.error, 'asr-timeout');
      assert.equal(result.body.message, DOWN);
      assert.equal(result.body.retryable, true);
      assert.equal(result.body.asr, true);
      assert.equal(await disk(box.cwd, result.body.path).then(b => b.toString()), 'slow-native');
    } finally {
      await box.dispose();
    }
  });

  test('engine 写错、与 url 或 cmd 同配：算配置无效，不去转', async () => {
    const box = await sandbox();
    try {
      await useCountingScript(box);
      box.deps.hubConfig.voice = box.native();
      const good = await post(box, { requestId: 'probe' });
      assert.equal(good.body.ok, true);
      const hitsAfterProbe = await box.hits();

      box.deps.hubConfig.voice = box.native({ asr_url: 'http://127.0.0.1:9/v1/audio/transcriptions' });
      const withUrl = await post(box, { requestId: 'with-url' });
      assert.equal(withUrl.status, 200);
      assert.equal(withUrl.body.error, 'asr-misconfigured');
      assert.equal(withUrl.body.asr, false);
      const retried = await post(box, { requestId: 'with-url', raw: 'again' });
      assert.equal(retried.body.error, 'asr-misconfigured');
      assert.equal(retried.body.id, withUrl.body.id);
      assert.equal(await box.hits(), hitsAfterProbe);

      box.deps.hubConfig.voice = box.native({ asr_cmd: [process.execPath, 'x', '{file}'] });
      const withCmd = await post(box, { requestId: 'with-cmd' });
      assert.equal(withCmd.body.error, 'asr-misconfigured');
      assert.equal(await box.hits(), hitsAfterProbe);

      box.deps.hubConfig.voice = { engine: 'bogus', timeout_ms: 3000 };
      const bogus = await post(box, { requestId: 'bogus' });
      assert.equal(bogus.body.error, 'asr-misconfigured');
      assert.equal(bogus.body.asr, false);
      assert.equal(await box.hits(), hitsAfterProbe);
      assert.equal((await stored(box.cwd)).length, 4);
    } finally {
      await box.dispose();
    }
  });

  test('超过大小或时长仍留下录音，并且不去转', async () => {
    const box = await sandbox();
    try {
      await useCountingScript(box);
      box.deps.hubConfig.voice = box.native({ max_audio_bytes: 4 });
      const big = await post(box, { requestId: 'big', raw: '123456' });
      assert.equal(big.status, 413);
      assert.equal(big.body.error, 'audio-too-large');
      assert.equal(big.body.asr, true);
      assert.match(big.body.message, /4 字节/u);
      assert.equal(await disk(box.cwd, big.body.path).then(b => b.toString()), '123456');

      box.deps.hubConfig.voice = box.native({ max_audio_seconds: 30 });
      const long = await post(box, { requestId: 'long', durationMs: 31000, raw: 'long-native' });
      assert.equal(long.status, 400);
      assert.equal(long.body.error, 'audio-too-long');
      assert.match(long.body.message, /30 秒/u);
      assert.equal(await disk(box.cwd, long.body.path).then(b => b.toString()), 'long-native');
      assert.equal(await box.hits(), 0);
    } finally {
      await box.dispose();
    }
  });

  test('一键全停：只留下录音，不去转，恢复后同请求号会转', async () => {
    const box = await sandbox();
    try {
      await useCountingScript(box);
      box.deps.hubConfig.voice = box.native();
      box.deps.stopped = true;
      const stopped = await post(box, { requestId: 'panic', raw: 'panic-native' });
      assert.equal(stopped.status, 200);
      assert.equal(stopped.body.error, 'stopped');
      assert.equal(stopped.body.asr, undefined);
      assert.equal(await disk(box.cwd, stopped.body.path).then(b => b.toString()), 'panic-native');
      assert.equal(await box.hits(), 0);

      box.deps.stopped = false;
      const resumed = await post(box, { requestId: 'panic', raw: 'after-panic' });
      assert.equal(resumed.status, 200);
      assert.equal(resumed.body.ok, true);
      assert.equal(resumed.body.text, '听到了:panic-native');
      assert.equal(await box.hits(), 1);
      assert.equal((await stored(box.cwd)).length, 1);
    } finally {
      await box.dispose();
    }
  });
});
