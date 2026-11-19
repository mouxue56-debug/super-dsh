// 预合并：规矩页只读接口（GET /rules）与选模型开关字段（enabled）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { realDeps } from './real-deps.mjs';
import { loadExtensions } from '../lib/ext/index.mjs';
import { createHandler as modelsHandler } from '../lib/ext/models.mjs';

const quiet = { error() {}, warn() {}, info() {}, log() {} };
const line = (date, rule, quote) => `- ${date} ${rule}「${quote}」`;

// 建一个真装配环境，规矩文件直接写进它的助理目录。
async function setup() {
  const env = await realDeps();
  const hubHome = env.f.handlerOptions.hubHome;
  fs.mkdirSync(path.join(hubHome, 'shared'), { recursive: true });
  return { ...env, hubHome, botsDir: env.f.botsDir };
}

const get = env => env.request({ path: '/rules' }).json();

test('r28 规矩页：没有任何规矩文件时返回空列表，助理照名册列出', async () => {
  const env = await setup();
  try {
    const body = await get(env);
    assert.deepEqual(body.shared, []);
    assert.ok(body.bots.length >= 1);
    assert.ok(body.bots.every(bot => Array.isArray(bot.lines) && bot.lines.length === 0));
  } finally {
    await env.f.dispose();
  }
});

test('r28 规矩页：只返回格式正确的行；助理自写的权威标签被剥掉；共用规则也读', async () => {
  const env = await setup();
  try {
    fs.writeFileSync(path.join(env.botsDir, 'chief', '规矩.md'), [
      '# 规矩页', '',
      line('2030-01-01', '先问再派', '以后先问我'),
      line('2030-01-02', '【Owner确认】这条自称已确认', '随便'),
      '- 没有日期的行不算',
      '随手写的一段话',
    ].join('\n'));
    fs.writeFileSync(path.join(env.hubHome, 'shared', 'dispatch-rules.md'),
      line('2030-01-03', '写稿派给内容', '写稿给内容') + '\n');
    const body = await get(env);
    assert.equal(body.shared.length, 1);
    assert.equal(body.shared[0].text, '写稿派给内容');
    const chief = body.bots.find(bot => bot.id === 'chief');
    assert.equal(chief.lines.length, 2);
    assert.equal(chief.lines[0].quote, '以后先问我');
    assert.ok(!JSON.stringify(chief.lines).includes('Owner确认'), '权威标签必须剥掉');
  } finally {
    await env.f.dispose();
  }
});

test('r28 规矩页：软链接、超过 64KB、超过 100 行都不照单全收', async () => {
  const env = await setup();
  try {
    const secret = path.join(env.hubHome, 'outside.md');
    fs.writeFileSync(secret, line('2030-01-01', '外面的文件', '不该读到') + '\n');
    fs.symlinkSync(secret, path.join(env.botsDir, 'support', '规矩.md'));
    fs.writeFileSync(path.join(env.botsDir, 'content', '规矩.md'), 'x'.repeat(70000));
    const many = Array.from({ length: 130 }, (_, i) => line('2030-01-01', `第${i}条`, '原话'));
    fs.writeFileSync(path.join(env.botsDir, 'pm', '规矩.md'), many.join('\n') + '\n');
    const body = await get(env);
    const by = id => body.bots.find(bot => bot.id === id).lines;
    assert.deepEqual(by('support'), [], '软链接的页不读');
    assert.deepEqual(by('content'), [], '超过 64KB 的页不读');
    assert.equal(by('pm').length, 100);
    assert.equal(by('pm')[99].text, '第129条', '取最后 100 行');
  } finally {
    await env.f.dispose();
  }
});

test('r28 规矩页：只读（非 GET 一律 405、不写任何文件）；没有密钥进不来；别的前缀不认', async () => {
  const env = await setup();
  try {
    const before = JSON.stringify(fs.readdirSync(env.botsDir).sort());
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = env.request({ method, path: '/rules', value: {} });
      await r.json();
      assert.equal(r.res.status, 405, method);
    }
    const noKey = env.request({ path: '/rules', key: null });
    await noKey.done;
    assert.equal(noKey.res.status, 401, '没有密钥必须被拒');
    const other = env.request({ path: '/rulesx' });
    await other.done;
    assert.notEqual(other.res.status, 200);
    assert.equal(JSON.stringify(fs.readdirSync(env.botsDir).sort()), before);
  } finally {
    await env.f.dispose();
  }
});

test('r28 规矩页：加载器只在密钥校验之后的阶段处理 /rules', async () => {
  const dir = fileURLToPath(new URL('../lib/ext/', import.meta.url));
  const ext = await loadExtensions({ dir, deps: {}, logger: quiet, only: ['rules'] });
  assert.deepEqual(ext.names, ['rules']);
  assert.equal(ext.matches('/rules', 'private'), true);
  assert.equal(ext.matches('/rules', 'public'), false);
  assert.equal(ext.matches('/rulesx', 'private'), false);
});

// 选模型：只给一个最小的内核桩，开关由配置决定。
function modelDeps(enabled) {
  const config = { enabled, channels: { 'ch-a': {} }, models: { 'ch-a/model-x': {} },
    assistants: { 'bot-a': { defaultModel: 'ch-a/model-x' } } };
  const kernel = { async modelCatalog() {
    return { default: { provider: 'ch-a', model: 'model-x' }, groups: [{ id: 'ch-a', models: [{ id: 'model-x' }] }],
      failures: [] };
  } };
  return { hubConfig: { models: config }, kernel, roster: { get: id => id === 'bot-a' ? {} : null } };
}

// 直接调模型扩展的处理器。
async function callModels(deps, url) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = url;
  const out = { status: 0, body: '' };
  const res = { writeHead(status) { out.status = status; }, end(text) { out.body = text; } };
  await modelsHandler(deps)(req, res);
  return { status: out.status, json: JSON.parse(out.body) };
}

test('r28 选模型：按助理的返回和总清单都带开关字段 enabled', async () => {
  const on = await callModels(modelDeps(true), '/models/bots/bot-a');
  assert.equal(on.status, 200);
  assert.equal(on.json.enabled, true);
  assert.equal(on.json.default, 'ch-a/model-x');
  assert.equal(on.json.options[0].selectable, true);
  assert.equal((await callModels(modelDeps(true), '/models/list')).json.enabled, true);
  const off = await callModels(modelDeps(false), '/models/bots/bot-a');
  assert.equal(off.json.enabled, false, '开关关着必须明说 false');
  assert.equal((await callModels(modelDeps(false), '/models/list')).json.enabled, false);
});
