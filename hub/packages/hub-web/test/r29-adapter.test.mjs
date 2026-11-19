// 四组钩子打假后端（经网页层），以及转发名单的越权。端口 3615、3616，跑完关掉。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHubWeb, EXT_PREFIXES, R29_PREFIXES } from '../server.mjs';
import { startR29Mock } from './r29-mock.mjs';

const require = createRequire(import.meta.url);
const { r29CreateHooks, r29FileLine, r28a1Init } = require('../hub-real.js');
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
const WEB = 'web-r29';
const BFF = 'bff-r29';

test('动图钩子没有被按住，原角色格子不再塞静态头像', () => {
  assert.equal(/HubPetMotion\??\.hold\s*\(/.test(source), false);
  assert.match(source, /不调用 HubPetMotion\.hold/);
  assert.match(source, /data-pet-stage': 'home'/);
  assert.equal(r29FileLine('note.txt', '/box/note.txt'), '（附了文件：note.txt，在 /box/note.txt）');
  assert.equal(r29FileLine('a<b>', '/x'), '（附了文件：ab，在 /x）');
  assert.equal(r29FileLine('<', '/x'), '');
  assert.equal(r29FileLine('note.txt', ''), '');
});

test('确认卡和更多入口的挂点不在时不抛', () => {
  const calls = [];
  global.window = {
    AssistantProfiles: { drafts: null, catalog() { return []; } },
    Hub: { registerFeatureSection() {}, fixedTasks() { return []; } },
    render() {}
  };
  global.document = {
    addEventListener(type, fn) { calls.push(fn); },
    querySelector() { return null; }
  };
  try {
    r28a1Init({
      mode: () => 'real',
      S: { mode: 'assistant-profile', bots: [] },
      H: global.window.Hub
    });
    const event = {
      target: {
        closest() {
          return {
            hasAttribute(name) { return name === 'data-assistant-confirm'; },
            dataset: { assistantConfirm: 'd1' }
          };
        }
      },
      preventDefault() {},
      stopImmediatePropagation() {}
    };
    assert.equal(calls.length, 1);
    assert.doesNotThrow(() => calls[0](event));
  } finally {
    delete global.window;
    delete global.document;
  }
});

describe('第29轮钩子与转发', { concurrency: 1 }, () => {
  let mock;
  let web;
  let origin;
  let cookie;

  before(async () => {
    mock = await startR29Mock(3615);
    const root = join(process.cwd(), 'test', 'scratch');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'r29-'));
    const shell = join(dir, 'shell');
    await mkdir(shell);
    await writeFile(join(shell, 'index.html'), '<html><body>离线壳</body></html>');
    await writeFile(join(dir, 'web.key'), WEB, { mode: 0o600 });
    await writeFile(join(dir, 'bff.key'), BFF, { mode: 0o600 });
    web = await createHubWeb({
      HUB_WEB_PORT: '3616', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
      HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'),
      BFF_URL: 'http://127.0.0.1:3615'
    }, { log() {} });
    origin = 'http://127.0.0.1:3616';
    const login = await fetch(origin + '/?key=' + WEB, { redirect: 'manual' });
    cookie = login.headers.get('set-cookie').split(';')[0];
  });

  after(async () => {
    await web?.close();
    await mock?.close();
  });

  function make(sent) {
    let hooks;
    hooks = r29CreateHooks({
      request(path, options = {}) {
        const headers = { ...(options.headers || {}), cookie, origin, 'x-hub-device': 'forged' };
        return fetch(origin + '/bff' + path, { ...options, headers });
      },
      deliver(bot, text) { sent.push(hooks.compose(bot, text)); },
      busy: () => false,
      upTo: () => 4
    });
    return hooks;
  }

  function audio() {
    return new Blob([Buffer.from('abcd')], { type: 'audio/webm;codecs=opus' });
  }

  function noteFile() {
    return new File([Buffer.from('note')], 'note.txt', { type: 'text/plain' });
  }

  test('四组钩子在假后端上成功', async () => {
    mock.state.mode = 'ok';
    mock.state.seen.length = 0;
    const sent = [];
    const hooks = make(sent);
    let views = 0;
    const stop = hooks.HubUnread.subscribe(() => { views += 1; });
    await hooks.refresh();
    assert.equal(hooks.HubUnread.counts().conversations.c1, 2);
    assert.equal(hooks.HubUnread.counts().bots.b1, 2);
    assert.equal(hooks.HubUnread.counts().groups.g1, 1);
    assert.ok(views >= 1);
    hooks.HubUnread.markRead('c1');
    await hooks.idle();
    const voice = await hooks.HubVoiceSend(audio(), { conversation: 'c1', bot: 'b1', durationMs: 800 });
    assert.equal(voice.ok, true);
    assert.equal(voice.text, '你好');
    assert.equal(voice.audioUrl, '');
    assert.deepEqual(sent, ['你好']);
    sent.length = 0;
    const uploaded = await hooks.HubUpload(noteFile(), { conversation: 'c1', bot: 'b1' });
    await hooks.idle();
    assert.equal(uploaded.ok, true);
    assert.equal(uploaded.name, 'note.txt');
    assert.equal(uploaded.path, undefined);
    assert.deepEqual(sent, ['（附了文件：note.txt，在 /box/note.txt）']);
    const settings = await hooks.HubSettings.get();
    assert.equal(settings.permission.mode, 'ask');
    assert.equal(settings.bots.b1.effort, 'low');
    assert.deepEqual(settings.models, ['m']);
    assert.equal(settings.readonly, undefined);
    assert.deepEqual(await hooks.HubSettings.setPermission('readonly'), { ok: true });
    assert.deepEqual(await hooks.HubSettings.setBot('b1', { model: 'm', effort: 'low' }), { ok: true });
    assert.equal((await hooks.HubSettings.setPermission('root')).error, 'bad-mode');
    const read = mock.state.seen.find(item => item.path === '/unread/read');
    assert.equal(JSON.parse(read.body.toString()).upTo, 4);
    const voiceHit = mock.state.seen.find(item => item.path === '/voice/');
    assert.match(voiceHit.search, /conversation=c1/);
    assert.match(voiceHit.search, /bot=b1/);
    assert.equal(voiceHit.headers['content-type'], 'audio/webm');
    assert.equal(voiceHit.headers['x-hub-bff-key'], BFF);
    assert.notEqual(voiceHit.headers['x-hub-device'], 'forged');
    const uploadHit = mock.state.seen.find(item => item.path === '/uploads/');
    assert.equal(uploadHit.headers['x-filename'], 'note.txt');
    stop();
  });

  test('四组钩子在假后端上失败时不抛、不发消息', async () => {
    mock.state.mode = 'fail';
    mock.state.seen.length = 0;
    const sent = [];
    const hooks = make(sent);
    await hooks.refresh();
    assert.deepEqual(hooks.HubUnread.counts(), { conversations: {}, bots: {}, groups: {} });
    const voice = await hooks.HubVoiceSend(audio(), { conversation: 'c1', bot: 'b1' });
    assert.equal(voice.ok, false);
    assert.equal(voice.error, 'asr-unavailable');
    assert.equal(voice.id, 'v9');
    const uploaded = await hooks.HubUpload(noteFile(), { conversation: 'c1', bot: 'b1' });
    await hooks.idle();
    assert.equal(uploaded.error, 'rejected');
    assert.equal(sent.length, 0);
    const settings = await hooks.HubSettings.get();
    assert.equal(settings.permission.mode, 'ask');
    assert.equal(settings.readonly, true);
    assert.equal(settings.error, true);
    assert.equal((await hooks.HubSettings.setPermission('open')).error, 'rejected');
  });

  test('后端 404 时未读为空、语音上传未就绪、设置只读', async () => {
    mock.state.mode = 'missing';
    mock.state.seen.length = 0;
    const sent = [];
    const hooks = make(sent);
    let views = 0;
    hooks.HubUnread.subscribe(() => { views += 1; });
    await hooks.refresh();
    assert.deepEqual(hooks.HubUnread.counts(), { conversations: {}, bots: {}, groups: {} });
    assert.ok(views >= 1);
    const before = mock.state.seen.length;
    hooks.HubUnread.markRead('c1');
    await hooks.idle();
    assert.equal(mock.state.seen.length, before);
    const voice = await hooks.HubVoiceSend(audio(), { conversation: 'c1', bot: 'b1' });
    assert.deepEqual(voice, { ok: false, error: 'not-ready' });
    const uploaded = await hooks.HubUpload(noteFile(), { conversation: 'c1', bot: 'b1' });
    await hooks.idle();
    assert.deepEqual(uploaded, { ok: false, error: 'not-ready' });
    assert.equal(sent.length, 0);
    const settings = await hooks.HubSettings.get();
    assert.equal(settings.readonly, true);
    assert.equal(settings.permission.mode, 'ask');
    assert.equal(settings.error, true);
    const afterGet = mock.state.seen.length;
    assert.deepEqual(await hooks.HubSettings.setPermission('ask'), { ok: false, error: 'not-ready' });
    assert.deepEqual(await hooks.HubSettings.setBot('b1', { model: 'm', effort: 'low' }),
      { ok: false, error: 'not-ready' });
    assert.equal(mock.state.seen.length, afterGet);
  });

  test('没钥匙、跨源、相似前缀都到不了新接口', async () => {
    mock.state.mode = 'ok';
    mock.state.seen.length = 0;
    assert.deepEqual(EXT_PREFIXES, ['board', 'ledger', 'groups', 'meetings', 'models', 'panic', 'routines', 'today']);
    assert.deepEqual(R29_PREFIXES, ['unread', 'voice', 'uploads', 'settings', 'notices', 'presence']);
    const noCookie = await fetch(origin + '/bff/unread/');
    assert.equal(noCookie.status, 401);
    assert.equal(mock.state.seen.length, 0);
    const noOrigin = await fetch(origin + '/bff/voice/', {
      method: 'POST', headers: { cookie, 'content-type': 'audio/webm' }, body: Buffer.from('abcd')
    });
    assert.equal(noOrigin.status, 403);
    assert.equal(mock.state.seen.length, 0);
    const cross = await fetch(origin + '/bff/settings/permission', {
      method: 'PUT',
      headers: { cookie, origin: 'https://other.invalid', 'content-type': 'application/json' },
      body: '{"mode":"open"}'
    });
    assert.equal(cross.status, 403);
    assert.equal(mock.state.seen.length, 0);
    const lookalike = await fetch(origin + '/bff/unreadx', { headers: { cookie } });
    assert.equal(lookalike.status, 404);
    assert.equal(mock.state.seen.at(-1).path, '/bff/unreadx');
    const dispatch = await fetch(origin + '/bff/dispatch/runs', { headers: { cookie } });
    assert.notEqual(dispatch.status, 200);
    assert.notEqual(mock.state.seen.at(-1).path, '/dispatch/runs');
  });
});
