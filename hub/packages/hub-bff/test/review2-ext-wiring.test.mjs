// 路18 第二轮复核：后端扩展的挂载、身份、加载器、选模型、晨晚会与真实 deps 的接缝。
// 每条测试都在基线上会失败；失败即证明该发现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chmod, readFile } from 'node:fs/promises';
import { fixture, request } from './fixtures.mjs';
import { issueToken } from '../lib/board-tokens.mjs';
import { loadExtensions } from '../lib/ext/index.mjs';
import { createSessionWithModel as extCreateSession } from '../lib/ext/models.mjs';
import { createMeetingService } from '../lib/ext/meetings.mjs';

const bearer = (token) => ({ authorization: 'Bearer ' + token });

async function withFixture(fn) {
  const f = await fixture();
  try {
    await fn(f);
  } finally {
    await f.handler.dispose();
    f.client.dispose();
  }
}

const quiet = { error() {}, log() {}, warn() {} };
const tmp = (label) => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), label));
const within = (ms, promise) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('超时'), ms))]);

test('M-5a 与助理同名的外部令牌不得认领派给该助理的工单（reservedNames 在 server.mjs 里没接）', () =>
  withFixture(async (f) => {
    await chmod(f.handlerOptions.configDir, 0o700);
    const { token } = await issueToken(f.handlerOptions.configDir, { name: 'pm', scope: 'work' });
    const made = await f.handler.board.create({ name: 'chief', type: 'assistant' },
      { title: '给项目经理的活', goal: '整理周报', to: ['pm'] });
    const claim = request(f.handler, { method: 'POST', path: '/board/tickets/' + made.id + '/claim',
      key: null, value: {}, headers: bearer(token) });
    await claim.done;
    assert.notEqual(claim.res.status, 200, '外部身份 pm 抢走了内部助理 pm 的工单');
  }));

test('M-5b 看板对象本身要拒绝与名册助理同名的 external 身份', () => withFixture(async (f) => {
  await assert.rejects(
    f.handler.board.create({ name: 'pm', type: 'external' }, { title: 't', goal: 'g', to: ['art'] }),
    /Reserved actor name|FORBIDDEN|Forbidden/u,
  );
}));

test('M-11a 一个扩展的 createHandler 永不返回时，加载器不能把整个服务卡死', async () => {
  const dir = tmp('r18-ext-');
  fs.writeFileSync(path.join(dir, 'hang.mjs'), 'export function createHandler() { return new Promise(() => {}); }\n');
  fs.writeFileSync(path.join(dir, 'fine.mjs'), 'export function createHandler() { return async () => false; }\n');
  const result = await within(1500, loadExtensions({ dir, deps: {}, logger: quiet }));
  assert.notEqual(result, '超时', '加载器无超时，后面的扩展和整个 BFF 都起不来');
  assert.deepEqual(result.names, ['fine']);
});

test('M-11b 一个扩展的 start() 永不返回时，不能卡住 handler.start()', async () => {
  const dir = tmp('r18-ext-');
  fs.writeFileSync(path.join(dir, 'slow.mjs'),
    'export function createHandler() { return async () => false; }\n' +
    'export function start() { return new Promise(() => {}); }\n');
  const ext = await loadExtensions({ dir, deps: {}, logger: quiet });
  const result = await within(1500, ext.start());
  assert.notEqual(result, '超时', 'start 无超时，startServer 永远不返回');
});

test('M-3 POST /models/sessions 的 cwd 必须等于该助理的预设目录（/bff/sessions 有这道校验，这里漏了）', () =>
  withFixture(async (f) => {
    const evil = '/private/tmp/review2-evil-cwd';
    const req = request(f.handler, { method: 'POST', path: '/models/sessions', value: { bot: 'pm', cwd: evil } });
    await req.done;
    const created = JSON.stringify(f.source.named('session/create'));
    assert.ok(!created.includes(evil), '任意 cwd 被原样交给内核建会话：' + created.slice(0, 200));
  }));

test('H-5 选了只聊天模型建会话后，BFF 要把会话号写进插件读的 chat-only-sessions.json', async () => {
  const configDir = tmp('r18-chat-');
  const dataDir = tmp('r18-data-');
  const catalog = { default: { provider: 'ch-z', model: 'model-z' },
    groups: [{ id: 'ch-b', models: [{ id: 'model-y' }] }], failures: [] };
  const kernel = {
    modelCatalog: async () => catalog,
    createSession: async () => ({ id: 'session-chat-1' }),
    selectModel: async (args) => ({ provider: args.provider, model: args.model }),
    restoreDefault: async () => {},
  };
  const hubConfig = { models: { enabled: true, channels: { 'ch-b': { chatOnly: true } },
    models: { 'ch-b/model-y': {} }, assistants: { pm: { defaultModel: 'ch-b/model-y' } },
    defaults: { chatOnlyPreset: 'preset-chat' } } };
  const deps = { configDir, dataDir, hubConfig, kernel, roster: { get: () => ({ preset: 'preset-main' }) } };
  const made = await extCreateSession(deps, { bot: 'pm' });
  assert.equal(made.chatOnly, true);
  const file = path.join(configDir, 'chat-only-sessions.json');
  assert.ok(fs.existsSync(file), '没有任何代码写 chat-only-sessions.json，插件侧的只聊天拒绝是空转');
  const value = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(value.sessions.includes('session-chat-1'));
});

test('H-6 晨晚会向助理要「学到的一条」：真实 sessions.send 返回回执加 reply 承诺，必须等到 reply', async () => {
  const dir = tmp('r18-meet-');
  const date = '2026-01-02';
  // 形状照抄 server.mjs sendFromExtension：{...receipt, reply: Promise<{text,failed,toolEvents}>}
  const send = async (id) => ({ accepted: true, requestId: 'r-' + id,
    reply: Promise.resolve({ text: '经验 ' + id, failed: false, toolEvents: [] }) });
  const deps = {
    dataDir: dir, configDir: dir, now: () => Date.parse(date + 'T18:00:00Z'),
    roster: [{ id: 'a1', name: '甲', role: 'assistant' }],
    hubConfig: { meetings: { utcOffsetMinutes: 0 } },
    sessions: { list: async () => [], create: async (id) => id, send },
  };
  const result = await createMeetingService(deps).run({ type: 'morning', date });
  assert.equal(result.learned.a1, true, '真实接线下每位助理的「学到的一条」都是空的');
});

test('L-3 晨晚会不得把提示塞进主人正在用的聊天会话（应另开 purpose=meeting 的会话）', async () => {
  const dir = tmp('r18-meet-');
  const date = '2026-01-02';
  const sent = [];
  const deps = {
    dataDir: dir, configDir: dir, now: () => Date.parse(date + 'T18:00:00Z'),
    roster: [{ id: 'a1', name: '甲', role: 'assistant' }],
    hubConfig: { meetings: { utcOffsetMinutes: 0 } },
    sessions: {
      list: async () => [{ id: 'owner-chat', bot: 'a1' }],
      create: async () => ({ id: 'meeting-own' }),
      send: async (id, text) => { sent.push({ id, text }); return '经验'; },
    },
  };
  await createMeetingService(deps).run({ type: 'morning', date });
  assert.ok(sent.length > 0);
  assert.ok(sent.every((row) => row.id !== 'owner-chat'), '会议提示被发进了主人的聊天会话');
});

test('M-7 投知识库确认卡要带上「正文被截断、全文多长」，否则主人只看到前 600 字却投出全文', () =>
  withFixture(async (f) => {
    const pending = f.handler.deps.cards.ask({
      kind: 'kb-submit', title: '要不要把今天的一条记到知识库？', what: '把这一条记进去',
      where: '知识库', why: '可复用', project: 'dsh', summary: '摘要', bodyPreview: 'x'.repeat(600),
      bodyTruncated: true, bodyLength: 5000,
      actions: [{ id: 'approve', label: '投递' }, { id: 'reject', label: '不投' }],
    });
    pending.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    const card = f.handler.runtime.cards().find((c) => c.confirm === true);
    assert.ok(card);
    assert.equal(card.bodyTruncated, true, 'runtime.ask 丢掉了 bodyTruncated/bodyLength');
    assert.equal(card.bodyLength, 5000);
  }));
