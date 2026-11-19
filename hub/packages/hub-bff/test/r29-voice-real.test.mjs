// 真 deps 接线。转写只打本机 3612 上的假服务，测完关掉。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { evaluate, parsePolicy, policyText } from '../../hub-plugin/policy.mjs';
import { realDeps } from './real-deps.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3612, '127.0.0.1', resolve);
  });
}

async function call(env, url, options = {}) {
  const res = env.request({
    method: options.method ?? 'POST',
    path: url,
    raw: options.raw ?? '',
    key: options.key === undefined ? 'synthetic-bff-key' : options.key,
    headers: options.headers ?? {},
  });
  await res.done;
  let body = null;
  if (res.res.text) {
    try { body = JSON.parse(res.res.text); } catch { body = { raw: res.res.text }; }
  }
  return { status: res.res.status, body };
}

test('真接线能收文件、能转写，且不替主人发消息', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ text: '听到了' }));
    });
  });
  let env;
  try {
    try {
      await listen(server);
    } catch (error) {
      if (error?.code === 'EADDRINUSE') throw new Error('测试端口 3612 已被占用，本测试不改用别的端口');
      throw error;
    }
    env = await realDeps({
      handlerOptions: {
        hubConfig: {
          voice: {
            asr_url: 'http://127.0.0.1:3612/v1/audio/transcriptions',
            asr_model: 'fake-model',
            timeout_ms: 5000,
          },
        },
      },
    });
    let sent = 0;
    const original = env.deps.sessions.send;
    env.deps.sessions.send = (...args) => {
      sent += 1;
      return original(...args);
    };
    const names = env.f.handler.extensions.names;
    assert.equal(names.includes('uploads'), true);
    assert.equal(names.includes('voice'), true);
    assert.equal(env.f.handler.extensions.matches('/uploads/', 'private'), true);
    assert.equal(env.f.handler.extensions.matches('/voice', 'public'), false);
    const upload = await call(env, '/uploads/?conversation=s1&bot=chief', {
      raw: '附件正文',
      headers: { 'x-filename': 'note.txt', 'x-request-id': 'up-1' },
    });
    assert.equal(upload.status, 200);
    assert.equal(upload.body.ok, true);
    assert.equal(upload.body.path, 'inbox/s1/note.txt');
    const file = path.join(env.f.botsDir, 'chief', ...upload.body.path.split('/'));
    assert.equal(await fs.readFile(file, 'utf8'), '附件正文');
    const home = env.f.handlerOptions.hubHome;
    const policy = parsePolicy(policyText(home, path.join(home, 'kb-root')));
    const cwd = path.join(env.f.botsDir, 'chief');
    const decision = evaluate(policy, 'chief', 'read', { file_path: upload.body.path }, cwd);
    assert.equal(decision.level, 'L0');
    assert.equal(decision.area, 'own');
    const voice = await call(env, '/voice/?conversation=s1&bot=chief&durationMs=1500', {
      raw: 'abc-audio',
      headers: { 'content-type': 'audio/webm', 'x-request-id': 'v-1' },
    });
    assert.equal(voice.status, 200);
    assert.equal(voice.body.ok, true);
    assert.equal(voice.body.text, '听到了');
    assert.equal(voice.body.durationMs, 1500);
    assert.equal(voice.body.path.startsWith('inbox/s1/voice-'), true);
    assert.equal(path.isAbsolute(voice.body.path), false);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].includes('fake-model'), true);
    assert.equal(seen[0].includes('abc-audio'), true);
    const replay = await call(env, '/voice/?conversation=s1&bot=chief', {
      raw: 'other-audio',
      headers: { 'content-type': 'audio/webm', 'x-request-id': 'v-1' },
    });
    assert.equal(replay.body.text, '听到了');
    assert.equal(replay.body.id, voice.body.id);
    assert.equal(seen.length, 1);
    const panicDir = path.join(home, 'panic-state');
    env.deps.hubConfig.panic = { stateDir: panicDir };
    await fs.mkdir(panicDir, { recursive: true });
    await fs.writeFile(path.join(panicDir, 'stopped.flag'), '1', { mode: 0o600 });
    const held = await call(env, '/voice/?conversation=s1&bot=chief', {
      raw: 'kept-audio',
      headers: { 'content-type': 'audio/webm', 'x-request-id': 'v-stop' },
    });
    assert.equal(held.body.ok, false);
    assert.equal(held.body.error, 'stopped');
    assert.equal(seen.length, 1);
    const kept = path.join(env.f.botsDir, 'chief', ...held.body.path.split('/'));
    assert.equal(await fs.readFile(kept, 'utf8'), 'kept-audio');
    const during = await call(env, '/uploads/?conversation=s1&bot=chief', {
      raw: '停着也能收',
      headers: { 'x-filename': 'during.txt' },
    });
    assert.equal(during.status, 200);
    assert.equal(during.body.ok, true);
    const denied = await call(env, '/uploads/?conversation=s1&bot=chief', {
      key: null, raw: 'x', headers: { 'x-filename': 'a.txt' },
    });
    assert.equal(denied.status, 401);
    const extra = await call(env, '/uploads/extra', { raw: 'x' });
    assert.equal(extra.status, 404);
    assert.equal(env.f.source.named('session/prompt').length, 0);
    assert.equal(sent, 0);
  } finally {
    if (env) await env.f.dispose();
    await new Promise(resolve => server.close(resolve));
  }
});
