// 语音缓存键是助理号加请求号。同一助理换会话仍去重；不同助理各转各的。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {r29CreateHooks} = require('../hub-real.js');

function audio() {
  return new Blob(['audio'], {type: 'audio/wav'});
}

test('同一会话同一请求号只转写一次', async () => {
  let calls = 0;
  const hooks = r29CreateHooks({
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ok: true, text: '第' + (++calls) + '段'}),
    }),
    placeVoice: () => {},
  });
  const first = await hooks.HubVoiceSend(audio(), {
    bot: 'bot-a', conversation: 'conv-a', requestId: 'req-1',
  });
  const second = await hooks.HubVoiceSend(audio(), {
    bot: 'bot-a', conversation: 'conv-a', requestId: 'req-1',
  });
  assert.equal(first.text, '第1段');
  assert.equal(second.text, '第1段');
  assert.equal(calls, 1);
});

test('不同助理即使会话号和请求号都相同也各转各的', async () => {
  let calls = 0;
  const placed = [];
  const hooks = r29CreateHooks({
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ok: true, text: '第' + (++calls) + '段'}),
    }),
    placeVoice: (bot, text, meta) => placed.push({bot, text, meta}),
  });
  const blob = audio();
  const left = hooks.HubVoiceSend(blob, {
    bot: 'bot-a', conversation: 'conv-same', requestId: 'same',
  });
  const right = hooks.HubVoiceSend(blob, {
    bot: 'bot-b', conversation: 'conv-same', requestId: 'same',
  });
  const [a, b] = await Promise.all([left, right]);
  assert.equal(a.text, '第1段');
  assert.equal(b.text, '第2段');
  assert.equal(placed.length, 2);
  assert.equal(placed[0].meta.conversation, 'conv-same');
  assert.equal(placed[1].meta.conversation, 'conv-same');
});

test('同一助理换了会话号仍算同一次开口', async () => {
  let calls = 0;
  const placed = [];
  const hooks = r29CreateHooks({
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ok: true, text: '第' + (++calls) + '段'}),
    }),
    placeVoice: (bot, text, meta) => placed.push({bot, text, meta}),
  });
  const blob = audio();
  const first = await hooks.HubVoiceSend(blob, {
    bot: 'bot-a', conversation: 'conv-a', requestId: 'same',
  });
  const second = await hooks.HubVoiceSend(blob, {
    bot: 'bot-a', conversation: 'conv-b', requestId: 'same',
  });
  assert.equal(first.text, '第1段');
  assert.equal(second.text, '第1段');
  assert.equal(calls, 1);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].meta.conversation, 'conv-a');
});
