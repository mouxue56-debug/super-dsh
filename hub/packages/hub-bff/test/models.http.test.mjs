import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler } from '../lib/ext/models.mjs';

const config = {
  enabled: true,
  channels: { 'ch-a': {}, 'ch-b': {} },
  models: { 'ch-a/model-x': {}, 'ch-b/model-y': {} },
  assistants: { 'bot-a': { defaultModel: 'ch-a/model-x', deny: ['ch-b/*'] } },
};

function setup() {
  let current = { provider: 'ch-c', model: 'model-z' };
  let next = 0;
  const calls = [];
  const kernel = {
    calls,
    async modelCatalog() {
      return { default: { ...current }, groups: [
        { id: 'ch-a', models: [{ id: 'model-x' }] },
        { id: 'ch-b', models: [{ id: 'model-y' }] },
      ], failures: [] };
    },
    async createSession(args) {
      await new Promise(resolve => setTimeout(resolve, 2));
      const id = `session-${++next}`;
      calls.push(['create', id, args]);
      return { id };
    },
    async selectModel(args) {
      await new Promise(resolve => setTimeout(resolve, 2));
      calls.push(['select', args.sessionId]);
      current = { provider: args.provider, model: args.model };
      return current;
    },
    async restoreDefault(value) { current = { ...value }; },
  };
  // 收口：建会话的工作目录只认名册预设的（M-3），桩里给出 botCwd。
  const deps = { hubConfig: { models: config }, kernel, roster: { get: id => id === 'bot-a' ? {} : null },
    botCwd: id => (deps.roster.presets?.() ?? [{ bot: 'bot-a', cwd: '/work/bot-a' }]).find(x => x.bot === id)?.cwd };
  return { deps, kernel };
}

async function request(handler, method, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.method = method;
  req.url = url;
  const response = {
    statusCode: 0,
    headers: {},
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(value) {
      this.body = value;
    },
  };
  const handled = await handler(req, response);
  return { handled, ...response, json: response.body ? JSON.parse(response.body) : null };
}

test('路径、目录和离线状态', async () => {
  const { deps } = setup();
  const handler = createHandler(deps);
  const outside = await request(handler, 'GET', '/other');
  assert.equal(outside.handled, false);
  assert.equal(outside.statusCode, 0);
  const list = await request(handler, 'GET', '/models/list');
  assert.equal(list.statusCode, 200);
  assert.equal(list.json.kernelReachable, true);
  deps.kernel.modelCatalog = async () => { throw new Error('private'); };
  const offline = await request(handler, 'GET', '/models/list');
  assert.equal(offline.json.kernelReachable, false);
  assert.equal(offline.json.models[0].available, false);
  const bot = await request(handler, 'GET', '/models/bots/bot-a');
  assert.equal(bot.json.options[0].blockedBy, 'MODEL_OFFLINE');
  assert.equal((await request(handler, 'GET', '/models/bots/missing')).statusCode, 404);
  assert.equal((await request(handler, 'POST', '/models/list')).statusCode, 405);
  assert.equal((await request(handler, 'GET', '/models/other')).statusCode, 404);
});

test('建会话、校验请求及禁止中途换模型', async () => {
  const { deps, kernel } = setup();
  deps.roster.presets = () => [{ bot: 'bot-a', cwd: 'workspace-a' }];
  const handler = createHandler(deps);
  const ok = await request(handler, 'POST', '/models/sessions', JSON.stringify({ bot: 'bot-a' }));
  assert.equal(ok.statusCode, 201);
  assert.equal(kernel.calls[0][2].cwd, 'workspace-a');
  const id = ok.json.session.sessionId;
  const record = await request(handler, 'GET', `/models/sessions/${id}`);
  assert.equal(record.json.ref, 'ch-a/model-x');
  const denied = await request(handler, 'POST', '/models/sessions',
    JSON.stringify({ bot: 'bot-a', model: 'ch-b/model-y' }));
  assert.equal(denied.statusCode, 403);
  deps.probe = { 'ch-a': false };
  const offline = await request(handler, 'POST', '/models/sessions',
    JSON.stringify({ bot: 'bot-a', model: 'ch-a/model-x' }));
  assert.equal(offline.statusCode, 409);
  assert.equal((await request(handler, 'POST', '/models/sessions', '{')).statusCode, 400);
  const large = await request(handler, 'POST', '/models/sessions', 'x'.repeat(65537));
  assert.equal(large.statusCode, 413);
  assert.equal(large.json.error.code, 'MODEL_BODY_TOO_LARGE');
  const count = kernel.calls.length;
  const known = await request(handler, 'POST', '/models/select', JSON.stringify({ sessionId: id }));
  assert.equal(known.statusCode, 409);
  const unknown = await request(handler, 'POST', '/models/select', JSON.stringify({ sessionId: 'missing' }));
  assert.equal(unknown.statusCode, 404);
  assert.equal(kernel.calls.length, count);
  assert.doesNotMatch(JSON.stringify(known.json), /stack|private/);
});

test('两个并发请求不会交错建会话和选模型', async () => {
  const { deps, kernel } = setup();
  const handler = createHandler(deps);
  const body = JSON.stringify({ bot: 'bot-a' });
  const results = await Promise.all([
    request(handler, 'POST', '/models/sessions', body),
    request(handler, 'POST', '/models/sessions', body),
  ]);
  assert.deepEqual(results.map(x => x.statusCode), [201, 201]);
  assert.deepEqual(kernel.calls.map(x => x[0]), ['create', 'select', 'create', 'select']);
  assert.equal(kernel.calls[0][1], kernel.calls[1][1]);
  assert.equal(kernel.calls[2][1], kernel.calls[3][1]);
});

test('导出的带锁入口与处理器共用记录表，开关关闭时不选模型', async () => {
  const { createSessionWithModel } = await import('../lib/ext/models.mjs');
  const { deps, kernel } = setup();
  const result = await createSessionWithModel(deps, { bot: 'bot-a' });
  assert.equal(result.model, 'ch-a/model-x');
  assert.equal(kernel.calls.filter(c => c[0] === 'select').length, 1);
  const handler = createHandler(deps);
  const found = await request(handler, 'GET', `/models/sessions/${result.sessionId}`);
  assert.equal(found.statusCode, 200);
  assert.equal(found.json.ref, 'ch-a/model-x');
  const off = { ...deps, hubConfig: { models: { ...config, enabled: false } } };
  const before = kernel.calls.length;
  const plain = await createSessionWithModel(off, { bot: 'bot-a' });
  assert.equal(plain.model, null);
  assert.equal(kernel.calls.slice(before).filter(c => c[0] === 'select').length, 0);
  const viaHttp = await request(createHandler(off), 'POST', '/models/sessions', JSON.stringify({ bot: 'bot-a' }));
  assert.equal(viaHttp.statusCode, 201);
  assert.equal(kernel.calls.filter(c => c[0] === 'select').length, 1);
});
