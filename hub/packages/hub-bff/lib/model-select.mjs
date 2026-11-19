import * as fs from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';

// 表示模型选择过程中的可公开错误。
export class ModelError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
    this.status = status;
  }
}

const invalid = () => new ModelError('MODEL_CONFIG_INVALID', '模型配置格式不正确', 500);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;

// 按第一个分隔符解析模型引用。
export function parseRef(ref) {
  if (typeof ref !== 'string') throw new ModelError('MODEL_REF_INVALID', '模型引用格式不正确', 400);
  const index = ref.indexOf('/');
  if (index < 1 || index === ref.length - 1) {
    throw new ModelError('MODEL_REF_INVALID', '模型引用格式不正确', 400);
  }
  return { channel: ref.slice(0, index), id: ref.slice(index + 1) };
}

// 生成模型引用。
export function refOf(channel, id) {
  return `${channel}/${id}`;
}

function checkKeys(value, keys) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
}

function checkRef(ref) {
  try {
    parseRef(ref);
  } catch {
    throw invalid();
  }
}

function checkRefs(value) {
  if (!Array.isArray(value) || value.some(item => !text(item))) throw invalid();
  value.forEach(checkRef);
}

function checkString(value) {
  if (!text(value)) throw invalid();
}

function checkWindow(value) {
  if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) throw invalid();
}

// 校验配置并返回补齐缺省值的独立副本。
export function normalizeConfig(raw) {
  checkKeys(raw, ['version', 'enabled', 'channels', 'models', 'assistants', 'defaults']);
  if (raw.version !== undefined && raw.version !== 1) throw invalid();
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw invalid();
  const result = { version: 1, enabled: raw.enabled === true, channels: {}, models: {}, assistants: {}, defaults: {} };
  for (const key of ['channels', 'models', 'assistants', 'defaults']) {
    if (raw[key] !== undefined && !object(raw[key])) throw invalid();
    if (raw[key] !== undefined) result[key] = structuredClone(raw[key]);
  }
  for (const [key, value] of Object.entries(result.channels)) {
    if (!text(key) || key.includes('/')) throw invalid();
    checkKeys(value, ['label', 'allowedModels', 'chatOnly']);
    if (value.label !== undefined) checkString(value.label);
    if (value.chatOnly !== undefined && typeof value.chatOnly !== 'boolean') throw invalid();
    if (value.allowedModels !== undefined &&
      (!Array.isArray(value.allowedModels) || value.allowedModels.some(item => !text(item)))) throw invalid();
  }
  for (const [key, value] of Object.entries(result.models)) {
    checkRef(key);
    checkKeys(value, ['name', 'window', 'chatOnly', 'reasoningEffort']);
    for (const field of ['name', 'reasoningEffort']) if (value[field] !== undefined) checkString(value[field]);
    if (value.window !== undefined) checkWindow(value.window);
    if (value.chatOnly !== undefined && typeof value.chatOnly !== 'boolean') throw invalid();
  }
  for (const [key, value] of Object.entries(result.assistants)) {
    checkString(key);
    checkKeys(value, ['defaultModel', 'deny', 'allow', 'fallback', 'chatOnlyPreset']);
    if (value.defaultModel !== undefined) checkRef(value.defaultModel);
    if (value.chatOnlyPreset !== undefined) checkString(value.chatOnlyPreset);
    for (const field of ['deny', 'allow', 'fallback']) if (value[field] !== undefined) checkRefs(value[field]);
  }
  checkKeys(result.defaults, ['deny', 'chatOnlyPreset', 'smallWindow']);
  if (result.defaults.deny !== undefined) checkRefs(result.defaults.deny);
  if (result.defaults.chatOnlyPreset !== undefined) checkString(result.defaults.chatOnlyPreset);
  if (result.defaults.smallWindow !== undefined) {
    checkWindow(result.defaults.smallWindow);
    if (result.defaults.smallWindow === null) throw invalid();
  }
  return result;
}

// 按优先级读取模型配置。
export async function loadModelConfig({ configDir, hubConfig, readFile = fs.readFile } = {}) {
  if (object(hubConfig?.models)) return normalizeConfig(hubConfig.models);
  if (!configDir) return normalizeConfig({});
  let data;
  try {
    data = await readFile(join(configDir, 'models.json'));
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeConfig({});
    throw invalid();
  }
  if (Buffer.byteLength(data) > 256 * 1024) throw invalid();
  try {
    return normalizeConfig(JSON.parse(data.toString()));
  } catch {
    throw invalid();
  }
}

// 合并配置与内核目录，离线模型保留为不可用。
export function buildInventory(config, catalog, { probe } = {}) {
  const items = new Map();
  const listed = new Set();
  for (const [ref, value] of Object.entries(config.models)) items.set(ref, value.name);
  for (const group of catalog?.groups ?? []) {
    for (const model of group.models ?? []) {
      const ref = refOf(group.id, model.id);
      listed.add(ref);
      if (!items.has(ref)) items.set(ref, model.name);
    }
  }
  for (const [channel, value] of Object.entries(config.channels)) {
    for (const id of value.allowedModels ?? []) {
      const ref = refOf(channel, id);
      if (!items.has(ref)) items.set(ref, undefined);
    }
  }
  const result = [];
  for (const [ref, catalogName] of items) {
    const { channel, id } = parseRef(ref);
    const channelConfig = config.channels[channel] ?? {};
    const modelConfig = config.models[ref] ?? {};
    if (channelConfig.allowedModels && !channelConfig.allowedModels.includes(id)) continue;
    let reason = null;
    if (!catalog) reason = 'kernel-unreachable';
    else if ((catalog.failures ?? []).some(item => item.id === channel)) reason = 'channel-failed';
    else if (!listed.has(ref)) reason = 'not-in-catalog';
    else if (probe?.[channel] === false) reason = 'probe-offline';
    const window = modelConfig.window ?? null;
    result.push({
      ref, channel, id, name: modelConfig.name ?? catalogName ?? id, window,
      chatOnly: modelConfig.chatOnly ?? channelConfig.chatOnly ?? false,
      available: reason === null, reason, listed: listed.has(ref) || (channelConfig.allowedModels ?? []).includes(id),
      smallWindow: window !== null && config.defaults.smallWindow != null && window <= config.defaults.smallWindow,
    });
  }
  return result.sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
}

// 返回助理与全局设置合并后的策略。
export function botPolicy(config, botId) {
  const bot = config.assistants[botId] ?? {};
  return {
    defaultModel: bot.defaultModel ?? null,
    deny: [...new Set([...(config.defaults.deny ?? []), ...(bot.deny ?? [])])],
    allow: bot.allow?.length ? [...bot.allow] : null,
    fallback: [...(bot.fallback ?? [])],
    chatOnlyPreset: bot.chatOnlyPreset ?? config.defaults.chatOnlyPreset ?? null,
  };
}

// 判断列表中的引用或渠道通配符是否匹配。
export function refMatches(list, ref) {
  const { channel } = parseRef(ref);
  return (list ?? []).includes(ref) || (list ?? []).includes(`${channel}/*`);
}

const failures = {
  MODEL_UNKNOWN: [404, '找不到这个模型'],
  MODEL_DENIED_FOR_BOT: [403, '这个助理不能使用该模型'],
  MODEL_NOT_ALLOWED_IN_CHANNEL: [403, '这个渠道不允许使用该模型'],
  MODEL_OFFLINE: [409, '这个模型暂时不可用'],
};

// 按规定顺序检查模型是否可用于助理。
export function evaluateModel(config, inventory, botId, ref) {
  const entry = inventory.find(item => item.ref === ref) ?? null;
  let code = null;
  if (!entry) code = 'MODEL_UNKNOWN';
  else {
    const policy = botPolicy(config, botId);
    const { channel, id } = parseRef(ref);
    if (refMatches(policy.deny, ref) || (policy.allow && !refMatches(policy.allow, ref))) {
      code = 'MODEL_DENIED_FOR_BOT';
    } else if (config.channels[channel]?.allowedModels && !config.channels[channel].allowedModels.includes(id)) {
      code = 'MODEL_NOT_ALLOWED_IN_CHANNEL';
    } else if (!entry.available) code = 'MODEL_OFFLINE';
  }
  return { ok: !code, code, reason: code ? failures[code][1] : null, entry };
}

// 根据显式请求或助理策略选择模型。
export function chooseModel(config, inventory, botId, requested) {
  const policy = botPolicy(config, botId);
  if (requested !== undefined && requested !== null) {
    const result = evaluateModel(config, inventory, botId, requested);
    if (!result.ok) throw new ModelError(result.code, result.reason, failures[result.code][0]);
    return { ref: requested, entry: result.entry, via: 'requested' };
  }
  const candidates = [[policy.defaultModel, 'default'], ...policy.fallback.map(ref => [ref, 'fallback'])];
  for (const [candidate, via] of candidates) {
    if (!candidate) continue;
    const refs = candidate.endsWith('/*') ? inventory.filter(item => refMatches([candidate], item.ref))
      .map(item => item.ref) : [candidate];
    for (const ref of refs) {
      const result = evaluateModel(config, inventory, botId, ref);
      if (result.ok) return { ref, entry: result.entry, via };
    }
  }
  throw new ModelError('MODEL_NONE_AVAILABLE', '这个助理现在没有可用的模型', 409);
}

// 创建先进先出的异步互斥锁。
export function createMutex() {
  let tail = Promise.resolve();
  return {
    run(fn) {
      const result = tail.then(fn);
      tail = result.catch(() => {});
      return result;
    },
  };
}

// 保存会话与模型的对应关系。
export class SessionModelRegistry {
  constructor({ file, readFile = fs.readFile, writeFile = fs.writeFile } = {}) {
    this.file = file;
    this.readFile = readFile;
    this.writeFile = writeFile;
    this.records = new Map();
  }

  get(id) {
    return this.records.get(id);
  }

  set(id, rec) {
    this.records.set(id, structuredClone(rec));
  }

  list() {
    return Object.fromEntries(this.records);
  }

  async load() {
    if (!this.file) return;
    try {
      const data = JSON.parse(await this.readFile(this.file, 'utf8'));
      if (!object(data)) throw invalid();
      this.records = new Map(Object.entries(data));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new ModelError('MODEL_REGISTRY_ERROR', '读取会话记录失败', 500);
    }
  }

  async save() {
    if (!this.file) return;
    const temp = join(dirname(this.file), `.${basename(this.file)}.${randomBytes(12).toString('hex')}.tmp`);
    try {
      await this.writeFile(temp, JSON.stringify(this.list()), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, this.file);
    } catch {
      throw new ModelError('MODEL_REGISTRY_ERROR', '保存会话记录失败', 500);
    }
  }
}

// 禁止已登记会话中途切换模型。
export function assertNoSwitch(registry, sessionId) {
  if (!registry.get(sessionId)) throw new ModelError('MODEL_SESSION_UNKNOWN', '找不到这个会话', 404);
  throw new ModelError(
    'MODEL_SWITCH_FORBIDDEN', '会话已开始，不在中途换模型；请新建会话选新模型', 409,
  );
}

// 判断会话是否仅可聊天。
export function isChatOnlySession(registry, sessionId) {
  return registry.get(sessionId)?.chatOnly === true;
}

const defaultLock = createMutex();
// 共用默认模型锁，避免并发选择相互干扰。
export const sharedLock = defaultLock;

// 选模型开关关闭时走原路：只建会话，绝不调用 selectModel，也不读模型目录。
async function createPlainSession(deps, { bot, model, title, cwd }) {
  if (model !== undefined) throw new ModelError('MODEL_DISABLED', '选模型未启用', 400);
  const preset = await deps.botPreset?.(bot) ?? deps.roster?.get?.(bot)?.preset;
  let session;
  if (typeof deps.kernel?.createSession === 'function') {
    session = await deps.kernel.createSession({ ...(cwd !== undefined && { cwd }),
      ...(preset !== undefined && { agentPreset: preset }), ...(title !== undefined && { title }) });
  } else if (typeof deps.sessions?.create === 'function') {
    session = await deps.sessions.create(bot, { preset, title, cwd });
  } else throw new ModelError('MODEL_KERNEL_UNAVAILABLE', '内核暂时不可用，不能建会话', 503);
  if (!session?.id) throw new ModelError('MODEL_KERNEL_UNAVAILABLE', '内核未返回会话编号', 503);
  return { sessionId: session.id, bot, model: null, via: 'disabled', chatOnly: false, preset: preset ?? null,
    verified: false, defaultRestored: false, defaultDrift: null };
}

// 在全局锁内建会话、选模型并检查默认模型。
export async function createSessionWithModel(deps, { bot, model, title, cwd }, { lock = sharedLock, registry } = {}) {
  try {
    // 选模型配置坏了不当成「没开」：拒绝建会话（否则只聊天、禁选都悄悄失效）。没写配置才算没开。
    let enabled = false;
    try {
      enabled = (await loadModelConfig(deps)).enabled === true;
    } catch {
      throw new ModelError('MODEL_CONFIG_INVALID', '选模型配置读不出或格式不对，先修好配置再建会话', 503);
    }
    if (!enabled) return await createPlainSession(deps, { bot, model, title, cwd });
    return await lock.run(async () => {
    const config = await loadModelConfig(deps);
    const kernel = deps.kernel;
    if (!kernel || typeof kernel.modelCatalog !== 'function' || typeof kernel.selectModel !== 'function') {
      throw new ModelError('MODEL_KERNEL_UNAVAILABLE', '内核暂时不可用，不能选模型', 503);
    }
    let catalog;
    try {
      catalog = await kernel.modelCatalog();
    } catch {
      catalog = null;
    }
    const before = catalog?.default?.provider && catalog?.default?.model ? { ...catalog.default } : null;
    const inventory = buildInventory(config, catalog, { probe: deps.probe });
    const choice = chooseModel(config, inventory, bot, model);
    let preset;
    if (choice.entry.chatOnly) {
      preset = botPolicy(config, bot).chatOnlyPreset;
      if (!preset) {
        throw new ModelError(
          'MODEL_CHATONLY_NO_PRESET',
          '这个模型只能聊天，但没有配置只聊天的预设，不能建会话',
          409,
        );
      }
    } else preset = await deps.botPreset?.(bot) ?? deps.roster?.get?.(bot)?.preset;
    let session;
    if (typeof kernel.createSession === 'function') {
      const args = { ...(cwd !== undefined && { cwd }), ...(preset !== undefined && { agentPreset: preset }),
        ...(title !== undefined && { title }) };
      session = await kernel.createSession(args);
    } else if (typeof deps.sessions?.create === 'function') {
      session = await deps.sessions.create(bot, { preset, title, cwd });
    } else throw new ModelError('MODEL_KERNEL_UNAVAILABLE', '内核暂时不可用，不能选模型', 503);
    const sessionId = session?.id;
    if (!sessionId) throw new ModelError('MODEL_KERNEL_UNAVAILABLE', '内核未返回会话编号', 503);
    let selected;
    try {
      const args = { sessionId, provider: choice.entry.channel, model: choice.entry.id };
      const effort = config.models[choice.ref]?.reasoningEffort;
      if (effort !== undefined) args.reasoningEffort = effort;
      selected = await kernel.selectModel(args);
      if (selected && (selected.provider !== args.provider || selected.model !== args.model)) throw new Error();
    } catch {
      try {
        await kernel.discardSession?.(sessionId);
      } catch {}
      // 选择失败也可能已改写全局默认，尽力恢复。
      try {
        if (before) await kernel.restoreDefault?.(before);
      } catch {}
      const error = new ModelError('MODEL_SELECT_FAILED', '选模型失败，已放弃这个会话', 502);
      error.orphanSessionId = sessionId;
      throw error;
    }
    let defaultRestored = false;
    let defaultDrift = null;
    if (before) {
      if (typeof kernel.restoreDefault === 'function') {
        try {
          await kernel.restoreDefault(before);
          defaultRestored = true;
        } catch {}
      }
      try {
        const after = await kernel.modelCatalog();
        defaultDrift = after?.default?.provider !== before.provider || after?.default?.model !== before.model;
      } catch {
        defaultDrift = null;
      }
    }
    const record = { ref: choice.ref, bot, chatOnly: choice.entry.chatOnly, preset: preset ?? null,
      at: new Date().toISOString() };
    if (registry) {
      registry.set(sessionId, record);
      await registry.save();
    }
    return { sessionId, bot, model: choice.ref, via: choice.via, chatOnly: choice.entry.chatOnly,
      preset: preset ?? null, verified: Boolean(selected), defaultRestored, defaultDrift };
    });
  } catch (error) {
    if (error instanceof ModelError) throw error;
    throw new ModelError('MODEL_INTERNAL_ERROR', '处理模型请求时发生错误', 500);
  }
}

// 列出助理可见模型及不可选原因。
export function listForBot(config, inventory, botId) {
  const options = inventory.map(entry => {
    const result = evaluateModel(config, inventory, botId, entry.ref);
    return { ref: entry.ref, name: entry.name, window: entry.window, chatOnly: entry.chatOnly,
      available: entry.available, reason: entry.reason, selectable: result.ok, blockedBy: result.code };
  });
  return { default: botPolicy(config, botId).defaultModel, options };
}
