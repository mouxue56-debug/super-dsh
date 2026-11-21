// 转写只进开口时的会话。假请求，不连真引擎。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { r29CreateHooks } = require('../hub-real.js');
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');

function audio() {
  return new Blob([Buffer.from('abcd')], { type: 'audio/webm;codecs=opus' });
}

function okBody(text) {
  return {
    status: 200,
    ok: true,
    async json() {
      return { ok: true, id: 'v1', text, durationMs: 40, audioUrl: '' };
    }
  };
}

test('开口时的会话号写进投递，延迟期间切走也不改口', async () => {
  const calls = [];
  const placed = [];
  let current = 'a-1';
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const hooks = r29CreateHooks({
    async request(path, options) {
      calls.push({ path, headers: options.headers || {} });
      await gate;
      return okBody('一句');
    },
    deliver(bot, text) { placed.push({ via: 'deliver', bot, text, current }); },
    placeVoice(bot, text, info) { placed.push({ via: 'place', text, info, current }); }
  });
  const blob = audio();
  const first = hooks.HubVoiceSend(blob, {
    conversation: 'a-1', bot: 'b1', durationMs: 40, requestId: 'req-1'
  });
  const second = hooks.HubVoiceSend(blob, {
    conversation: 'a-2', bot: 'b1', durationMs: 40, requestId: 'req-1'
  });
  current = 'a-2';
  release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.ok, true);
  assert.equal(one.text, '一句');
  assert.equal(two.text, '一句');
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /conversation=a-1/);
  assert.match(calls[0].path, /bot=b1/);
  assert.match(calls[0].path, /durationMs=40/);
  assert.equal(calls[0].headers['x-request-id'], 'req-1');
  assert.equal(calls[0].headers['content-type'], 'audio/webm');
  assert.equal(placed.length, 1);
  assert.equal(placed[0].via, 'place');
  assert.equal(placed[0].info.conversation, 'a-1');
  assert.equal(placed[0].current, 'a-2');
  current = 'a-3';
  const third = await hooks.HubVoiceSend(blob, {
    conversation: 'a-3', bot: 'b1', requestId: 'req-1'
  });
  assert.equal(third.text, '一句');
  assert.equal(calls.length, 1);
  assert.equal(placed.length, 1);
});

test('断线重试沿用请求号，成功后再调也不再投一次', async () => {
  const placed = [];
  let attempts = 0;
  const hooks = r29CreateHooks({
    async request() {
      attempts += 1;
      if (attempts === 1) throw new Error('reset');
      return okBody('补上');
    },
    deliver() { placed.push('deliver'); },
    placeVoice(bot, text, info) { placed.push({ text, conversation: info.conversation }); }
  });
  const blob = audio();
  const failed = await hooks.HubVoiceSend(blob, {
    conversation: 'a-1', bot: 'b1', requestId: 'req-2'
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'failed');
  assert.equal(placed.length, 0);
  const again = await hooks.HubVoiceSend(blob, {
    conversation: 'a-1', bot: 'b1', requestId: 'req-2'
  });
  assert.equal(again.text, '补上');
  assert.deepEqual(placed, [{ text: '补上', conversation: 'a-1' }]);
  const dup = await hooks.HubVoiceSend(blob, {
    conversation: 'a-2', bot: 'b1', requestId: 'req-2'
  });
  assert.equal(dup.text, '补上');
  assert.equal(placed.length, 1);
  assert.equal(attempts, 2);
});

test('没配引擎不投文字，建会话失败也不把音频送出去', async () => {
  const placed = [];
  let hits = 0;
  const quiet = r29CreateHooks({
    async request() {
      return {
        status: 200,
        ok: true,
        async json() { return { ok: false, error: 'asr-unavailable', id: 'kept' }; }
      };
    },
    deliver() { placed.push('deliver'); },
    placeVoice() { placed.push('place'); }
  });
  const held = await quiet.HubVoiceSend(audio(), {
    conversation: 'a-1', bot: 'b1', requestId: 'req-3'
  });
  assert.equal(held.ok, false);
  assert.equal(held.error, 'asr-unavailable');
  assert.equal(held.id, 'kept');
  assert.equal(placed.length, 0);
  const blocked = r29CreateHooks({
    async bindVoice() { throw new Error('创建失败'); },
    async request() {
      hits += 1;
      return { status: 500, ok: false, async json() { return null; } };
    },
    deliver() { placed.push('deliver'); },
    placeVoice() { placed.push('place'); }
  });
  const bad = await blocked.HubVoiceSend(audio(), {
    conversation: 'local-1', bot: 'b1', requestId: 'req-5'
  });
  assert.deepEqual(bad, { ok: false, error: 'failed' });
  assert.equal(hits, 0);
  assert.equal(placed.length, 0);
});

test('首次会话换成建好的远端号，文字仍回到壳上的那一段', async () => {
  const seen = [];
  const landed = [];
  const hooks = r29CreateHooks({
    async bindVoice(bot, info) {
      assert.equal(bot, 'b1');
      assert.equal(info.conversation, 'local-1');
      assert.equal(info.requestId, 'req-4');
      return { conversation: 'remote-1', remote: 'remote-1', local: 'local-1' };
    },
    async request(path, options) {
      seen.push({ path, id: options.headers['x-request-id'] });
      return okBody('已转');
    },
    deliver() { landed.push('deliver'); },
    placeVoice(bot, text, info) { landed.push({ bot, text, info }); }
  });
  const voice = await hooks.HubVoiceSend(audio(), {
    conversation: 'local-1', bot: 'b1', durationMs: 12, requestId: 'req-4'
  });
  assert.equal(voice.text, '已转');
  assert.equal(seen.length, 1);
  assert.match(seen[0].path, /conversation=remote-1/);
  assert.match(seen[0].path, /durationMs=12/);
  assert.equal(seen[0].id, 'req-4');
  assert.equal(landed.length, 1);
  assert.equal(landed[0].text, '已转');
  assert.equal(landed[0].info.conversation, 'local-1');
  assert.equal(landed[0].info.remote, 'remote-1');
  assert.equal(landed[0].info.requestId, 'req-4');
});

test('真页面把语音投递接到现有发送，不改成按当前会话', () => {
  assert.match(source, /bindVoice:\s*r29BindVoice/);
  assert.match(source, /placeVoice:\s*r29PlaceVoice/);
  assert.match(source, /function r29BindVoice/);
  assert.match(source, /function r29PlaceVoice/);
  assert.match(source, /createRemote\(r, bot\)/);
  assert.match(source, /sendText\(bot, text, r\)/);
});

test('远程转写 502 和 504 把能力和重试交给壳', async () => {
  function down(status, error, id) {
    return {
      status,
      ok: false,
      async json() {
        return {
          ok: false,
          error,
          id,
          asr: true,
          retryable: true,
          message: '转文字暂时不可用，录音已保存',
        };
      },
    };
  }
  const failed = r29CreateHooks({
    async request() { return down(502, 'asr-failed', 'v-down'); },
  });
  const voice = await failed.HubVoiceSend(audio(), {
    conversation: 'a-1', bot: 'b1', requestId: 'req-down',
  });
  assert.equal(voice.ok, false);
  assert.equal(voice.error, 'asr-failed');
  assert.equal(voice.id, 'v-down');
  assert.equal(voice.asr, true);
  assert.equal(voice.retryable, true);
  assert.equal(voice.message, '转文字暂时不可用，录音已保存');
  const slow = r29CreateHooks({
    async request() { return down(504, 'asr-timeout', 'v-slow'); },
  });
  const timed = await slow.HubVoiceSend(audio(), {
    conversation: 'a-1', bot: 'b1', requestId: 'req-slow',
  });
  assert.equal(timed.error, 'asr-timeout');
  assert.equal(timed.asr, true);
  assert.equal(timed.retryable, true);
  assert.notEqual(timed.error, 'failed');
});

test('转写成功时把 asr 能力原样交回', async () => {
  const hooks = r29CreateHooks({
    async request() {
      return {
        status: 200,
        ok: true,
        async json() { return { ok: true, text: '一句', asr: true, audioUrl: '' }; },
      };
    },
  });
  const voice = await hooks.HubVoiceSend(audio(), {
    conversation: 'a-1', bot: 'b1', requestId: 'req-asr',
  });
  assert.equal(voice.ok, true);
  assert.equal(voice.text, '一句');
  assert.equal(voice.asr, true);
});
