import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ModelError, parseRef, refOf, normalizeConfig, loadModelConfig, buildInventory, botPolicy,
  refMatches, evaluateModel, chooseModel, createMutex, SessionModelRegistry, assertNoSwitch,
  isChatOnlySession, createSessionWithModel, listForBot,
} from '../lib/model-select.mjs';

const raw = {
  enabled: true,
  channels: { 'ch-a': { allowedModels: ['model-x'] }, 'ch-b': { chatOnly: true } },
  models: { 'ch-a/model-x': { window: 100 }, 'ch-b/model-y': {} },
  assistants: {
    'bot-a': { defaultModel: 'ch-a/model-x', fallback: ['ch-b/model-y'] },
    'bot-b': { defaultModel: 'ch-b/model-y' },
    'bot-c': { defaultModel: 'ch-a/model-x' },
  },
  defaults: { chatOnlyPreset: 'preset-chat', smallWindow: 100 },
};
const catalog = {
  default: { provider: 'ch-z', model: 'model-z' },
  groups: [
    { id: 'ch-a', models: [{ id: 'model-x' }, { id: 'model-y' }, { id: 'model-z' }] },
    { id: 'ch-b', models: [{ id: 'model-y' }] },
  ],
  failures: [],
};
const err = code => error => error instanceof ModelError && error.code === code;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeKernel(delay = () => 0) {
  let current = { ...catalog.default };
  let next = 0;
  const calls = [];
  const selected = new Map();
  return {
    calls,
    selected,
    current: () => current,
    async modelCatalog() { return { ...catalog, default: { ...current } }; },
    async createSession(args) {
      await pause(delay());
      const id = `session-${++next}`;
      calls.push({ type: 'create', id, args });
      return { id };
    },
    async selectModel(args) {
      await pause(delay());
      calls.push({ type: 'select', id: args.sessionId, args });
      current = { provider: args.provider, model: args.model };
      selected.set(args.sessionId, `${args.provider}/${args.model}`);
      return current;
    },
    async restoreDefault(value) { current = { ...value }; },
    async discardSession(id) { calls.push({ type: 'discard', id }); },
  };
}

test('配置与引用校验', async () => {
  assert.deepEqual(parseRef('ch-a/model/x'), { channel: 'ch-a', id: 'model/x' });
  assert.equal(refOf('ch-a', 'model/x'), 'ch-a/model/x');
  assert.throws(() => parseRef('bad'), err('MODEL_REF_INVALID'));
  for (const value of [null, [], { extra: 1 }, { channels: [] }, { models: { bad: {} } },
    { models: { 'a/b': { window: 0 } } }, { channels: { a: { allowedModels: [1] } } },
    { assistants: { a: { deny: ['bad'] } } }]) {
    assert.throws(() => normalizeConfig(value), err('MODEL_CONFIG_INVALID'));
  }
  const copy = normalizeConfig(raw);
  copy.channels['ch-a'].allowedModels.push('other');
  assert.equal(raw.channels['ch-a'].allowedModels.length, 1);
  assert.deepEqual(await loadModelConfig({ hubConfig: { models: raw } }), normalizeConfig(raw));
  assert.deepEqual(await loadModelConfig({}), normalizeConfig({}));
  await assert.rejects(loadModelConfig({ configDir: '.', readFile: async () => 'x'.repeat(262145) }),
    err('MODEL_CONFIG_INVALID'));
});

test('清单过滤、策略与降级', () => {
  const config = normalizeConfig(raw);
  const inventory = buildInventory(config, catalog);
  assert.deepEqual(inventory.map(x => x.ref), ['ch-a/model-x', 'ch-b/model-y']);
  assert.equal(inventory[0].smallWindow, true);
  assert.throws(() => chooseModel(config, inventory, 'bot-a', 'ch-a/model-y'), err('MODEL_UNKNOWN'));
  const denied = normalizeConfig({ ...raw, assistants: {
    'bot-a': { defaultModel: 'ch-a/model-x', deny: ['ch-a/*'], fallback: ['ch-b/model-y'] },
  } });
  assert.equal(refMatches(['ch-a/*'], 'ch-a/model-x'), true);
  assert.equal(botPolicy(denied, 'bot-a').defaultModel, 'ch-a/model-x');
  assert.equal(chooseModel(denied, inventory, 'bot-a').via, 'fallback');
  assert.throws(() => chooseModel(denied, inventory, 'bot-a', 'ch-a/model-x'), err('MODEL_DENIED_FOR_BOT'));
  const allowed = normalizeConfig({ ...raw, assistants: { 'bot-a': { allow: ['ch-b/*'] } } });
  assert.equal(evaluateModel(allowed, inventory, 'bot-a', 'ch-a/model-x').code, 'MODEL_DENIED_FOR_BOT');
  assert.throws(() => chooseModel(allowed, inventory, 'bot-a'), err('MODEL_NONE_AVAILABLE'));
});

test('不可达、渠道失败和探测失败只置灰', () => {
  const config = normalizeConfig(raw);
  for (const [cat, probe, reason] of [
    [null, {}, 'kernel-unreachable'],
    [{ ...catalog, failures: [{ id: 'ch-a' }] }, {}, 'channel-failed'],
    [catalog, { 'ch-a': false }, 'probe-offline'],
  ]) {
    const inventory = buildInventory(config, cat, { probe });
    const entry = inventory.find(x => x.ref === 'ch-a/model-x');
    assert.equal(entry.reason, reason);
    assert.equal(entry.available, false);
    assert.throws(() => chooseModel(config, inventory, 'bot-a', entry.ref), err('MODEL_OFFLINE'));
    assert.equal(listForBot(config, inventory, 'bot-a').options[0].selectable, false);
  }
});

test('建会话使用预设、恢复默认和报告失败', async () => {
  const kernel = fakeKernel();
  const registry = new SessionModelRegistry({});
  const deps = { hubConfig: { models: raw }, kernel, botPreset: () => 'preset-main' };
  const normal = await createSessionWithModel(deps, { bot: 'bot-a' }, { registry });
  assert.equal(normal.verified, true);
  assert.equal(normal.defaultRestored, true);
  assert.equal(normal.defaultDrift, false);
  assert.equal(kernel.calls[0].args.agentPreset, 'preset-main');
  const chat = await createSessionWithModel(deps, { bot: 'bot-b' }, { registry });
  assert.equal(kernel.calls[2].args.agentPreset, 'preset-chat');
  assert.equal(isChatOnlySession(registry, chat.sessionId), true);
  const modelChat = { ...raw, models: { ...raw.models, 'ch-a/model-x': { chatOnly: true } } };
  await createSessionWithModel({ ...deps, hubConfig: { models: modelChat } }, { bot: 'bot-a' }, { registry });
  assert.equal(kernel.calls[4].args.agentPreset, 'preset-chat');
  const noPreset = { ...raw, defaults: {} };
  const before = kernel.calls.length;
  await assert.rejects(createSessionWithModel({ ...deps, hubConfig: { models: noPreset } },
    { bot: 'bot-b' }, { registry }), err('MODEL_CHATONLY_NO_PRESET'));
  assert.equal(kernel.calls.length, before);
  const unrestored = fakeKernel();
  delete unrestored.restoreDefault;
  const result = await createSessionWithModel({ ...deps, kernel: unrestored }, { bot: 'bot-a' }, { registry });
  assert.equal(result.defaultRestored, false);
  assert.equal(result.defaultDrift, true);
  const broken = fakeKernel();
  broken.selectModel = async () => { throw new Error('internal'); };
  await assert.rejects(createSessionWithModel({ ...deps, kernel: broken }, { bot: 'bot-a' }, { registry }),
    error => err('MODEL_SELECT_FAILED')(error) && error.orphanSessionId === 'session-1');
  assert.equal(broken.calls.at(-1).type, 'discard');
  await assert.rejects(createSessionWithModel({}, { bot: 'bot-a' }, { registry }), err('MODEL_KERNEL_UNAVAILABLE'));
});

test('会话禁止切换，持久记录可读取', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'model-test-'));
  try {
    const file = join(dir, 'records.json');
    const registry = new SessionModelRegistry({ file });
    registry.set('session-a', { ref: 'ch-a/model-x', bot: 'bot-a', chatOnly: false });
    await registry.save();
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const other = new SessionModelRegistry({ file });
    await other.load();
    assert.equal(other.get('session-a').ref, 'ch-a/model-x');
    assert.throws(() => assertNoSwitch(other, 'session-a'), err('MODEL_SWITCH_FORBIDDEN'));
    assert.throws(() => assertNoSwitch(other, 'missing'), err('MODEL_SESSION_UNKNOWN'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('并发建会话串行，对照组确实交错', async () => {
  async function run(lock, delay) {
    const kernel = fakeKernel(delay);
    const registry = new SessionModelRegistry({});
    const deps = { hubConfig: { models: raw }, kernel };
    const bots = ['bot-a', 'bot-b', 'bot-c'];
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) =>
      createSessionWithModel(deps, { bot: bots[i % 3] }, { registry, ...(lock ? { lock } : {}) })));
    return { kernel, registry, results };
  }
  const safe = await run(null, () => Math.floor(Math.random() * 6));
  assert.equal(new Set(safe.results.map(x => x.sessionId)).size, 24);
  for (const item of safe.results) {
    assert.equal(safe.registry.get(item.sessionId).ref, item.model);
    assert.equal(safe.kernel.selected.get(item.sessionId), item.model);
  }
  for (let i = 0; i < safe.kernel.calls.length; i += 2) {
    assert.equal(safe.kernel.calls[i].type, 'create');
    assert.equal(safe.kernel.calls[i + 1].type, 'select');
    assert.equal(safe.kernel.calls[i].id, safe.kernel.calls[i + 1].id);
  }
  assert.deepEqual(safe.kernel.current(), catalog.default);
  const unsafe = await run({ run: fn => fn() }, () => 5);
  assert.ok(unsafe.kernel.calls.some((call, i, calls) => call.type === 'create' && calls[i + 1]?.type === 'create'));
});

test('互斥锁按顺序执行且错误不阻塞', async () => {
  const lock = createMutex();
  const order = [];
  const tasks = [0, 1, 2].map(i => lock.run(async () => {
    order.push(i);
    if (i === 1) throw new Error('failure');
    return i;
  }));
  const results = await Promise.allSettled(tasks);
  assert.deepEqual(order, [0, 1, 2]);
  assert.deepEqual(results.map(x => x.status), ['fulfilled', 'rejected', 'fulfilled']);
});

test('开关：enabled 非 true 时走原路且不调用 selectModel', async () => {
  const calls = [];
  const kernel = {
    async modelCatalog() { calls.push('catalog'); return null; },
    async createSession(args) { calls.push(['create', args]); return { id: 'session-1' }; },
    async selectModel() { calls.push('select'); return {}; },
  };
  for (const models of [undefined, { ...raw, enabled: false }, { ...raw, enabled: undefined }]) {
    calls.length = 0;
    const deps = { hubConfig: models && { models }, kernel, botPreset: () => 'preset-main' };
    const result = await createSessionWithModel(deps, { bot: 'bot-a', title: 't', cwd: '/x' });
    assert.equal(result.sessionId, 'session-1');
    assert.equal(result.model, null);
    assert.deepEqual(calls, [['create', { cwd: '/x', agentPreset: 'preset-main', title: 't' }]]);
  }
  await assert.rejects(createSessionWithModel({ hubConfig: { models: { ...raw, enabled: false } }, kernel },
    { bot: 'bot-a', model: 'ch-a/model-x' }), err('MODEL_DISABLED'));
  assert.ok(!calls.includes('select'));
  assert.throws(() => normalizeConfig({ enabled: 'yes' }), err('MODEL_CONFIG_INVALID'));
  assert.equal(normalizeConfig({ enabled: true }).enabled, true);
});

test('开关：enabled 为 true 时才选模型', async () => {
  const calls = [];
  const kernel = {
    async modelCatalog() {
      return { default: { provider: 'ch-c', model: 'z' }, groups: [{ id: 'ch-a', models: [{ id: 'model-x' }] }] };
    },
    async createSession() { return { id: 'session-2' }; },
    async selectModel(args) { calls.push(args); return { provider: args.provider, model: args.model }; },
    async restoreDefault() {},
  };
  const result = await createSessionWithModel({ hubConfig: { models: raw }, kernel, botPreset: () => 'p' },
    { bot: 'bot-a' }, {});
  assert.equal(result.model, 'ch-a/model-x');
  assert.equal(calls.length, 1);
});
