import { join } from 'node:path';
import { addChatOnlySession } from '../chat-only-list.mjs';
import {
  ModelError, loadModelConfig, buildInventory, listForBot, SessionModelRegistry,
  createSessionWithModel as createSessionLocked, assertNoSwitch,
} from '../model-select.mjs';

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > 65536) throw new ModelError('MODEL_BODY_TOO_LARGE', '请求内容太大', 413);
    chunks.push(data);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new ModelError('MODEL_BODY_INVALID', '请求内容不是有效的 JSON 对象', 400);
  }
}

function validateBot(deps, bot) {
  if (typeof bot !== 'string' || !/^[a-z][a-z0-9-]{1,23}$/.test(bot)) {
    throw new ModelError('MODEL_REF_INVALID', '助理编号格式不正确', 400);
  }
  if (typeof deps.roster?.get === 'function' && !deps.roster.get(bot)) {
    throw new ModelError('MODEL_BOT_UNKNOWN', '找不到这个助理', 404);
  }
}

async function inventoryFor(deps) {
  const config = await loadModelConfig(deps);
  let catalog = null;
  try {
    catalog = await deps.kernel?.modelCatalog?.() ?? null;
  } catch {}
  return { config, inventory: buildInventory(config, catalog, { probe: deps.probe }), reachable: catalog !== null };
}

const registries = new Map();

// 按数据目录取同一份会话记录表，处理器与带锁入口共用。
function registryFor(deps) {
  const key = deps.dataDir ?? '';
  if (!registries.has(key)) {
    const file = deps.dataDir ? join(deps.dataDir, 'model-sessions.json') : undefined;
    const registry = new SessionModelRegistry({ file });
    registries.set(key, { registry, loaded: registry.load().catch(() => {}) });
  }
  return registries.get(key);
}

// 带锁建会话入口，已绑定本模块的会话记录表；开关未开时走原路不选模型。
export async function createSessionWithModel(deps, args, options = {}) {
  const entry = registryFor(deps);
  await entry.loaded;
  const result = await createSessionLocked(deps, args, { ...options, registry: entry.registry });
  // 只聊天会话写进插件读的名单（<配置目录>/chat-only-sessions.json）；写不进去就放弃这个会话。
  if (result.chatOnly === true) {
    try {
      if (!deps.configDir) throw new Error('没有配置目录');
      await addChatOnlySession(join(deps.configDir, 'chat-only-sessions.json'), result.sessionId);
    } catch {
      // 放弃入口缺失或放弃失败都要说出来，不能吞掉；调用方据此不把会话交给主人。
      if (typeof deps.kernel?.discardSession !== 'function') {
        deps.logger?.error?.('HUB_MODEL_DISCARD_UNAVAILABLE');
        throw new ModelError('MODEL_CHATONLY_DISCARD_UNAVAILABLE',
          '只聊天名单写不进去，也没有放弃会话的入口；这个会话不能用', 500);
      }
      try {
        await deps.kernel.discardSession(result.sessionId);
      } catch {
        deps.logger?.error?.('HUB_MODEL_DISCARD_FAILURE');
        throw new ModelError('MODEL_CHATONLY_DISCARD_FAILED',
          '只聊天名单写不进去，放弃会话也失败了；这个会话不能用', 500);
      }
      throw new ModelError('MODEL_CHATONLY_LIST_FAILED', '只聊天名单写不进去，已放弃这个会话', 500);
    }
  }
  return result;
}

// 创建模型路由处理器并惰性读取会话记录。
export function createHandler(deps) {
  const entry = registryFor(deps);
  const registry = entry.registry;
  return async (request, response) => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== '/models' && !path.startsWith('/models/')) return false;
    try {
      await entry.loaded;
      const botMatch = path.match(/^\/models\/bots\/([^/]+)$/);
      const sessionMatch = path.match(/^\/models\/sessions\/([^/]+)$/);
      let allowed;
      if (path === '/models/list' || botMatch || sessionMatch) allowed = 'GET';
      else if (path === '/models/sessions' || path === '/models/select') allowed = 'POST';
      else throw new ModelError('MODEL_NOT_FOUND', '找不到这个接口', 404);
      if (request.method !== allowed) {
        send(response, 405, { error: { code: 'MODEL_METHOD_NOT_ALLOWED', message: '请求方法不支持' } },
          { Allow: allowed });
        return true;
      }
      if (path === '/models/list') {
        const { config, inventory, reachable } = await inventoryFor(deps);
        // 开关字段：界面只有看到 enabled:true 才显示选模型入口。
        send(response, 200, { models: inventory, kernelReachable: reachable, enabled: config.enabled === true });
      } else if (botMatch) {
        let bot;
        try {
          bot = decodeURIComponent(botMatch[1]);
        } catch {
          throw new ModelError('MODEL_REF_INVALID', '助理编号格式不正确', 400);
        }
        validateBot(deps, bot);
        const { config, inventory } = await inventoryFor(deps);
        send(response, 200, { ...listForBot(config, inventory, bot), enabled: config.enabled === true });
      } else if (sessionMatch) {
        let id;
        try {
          id = decodeURIComponent(sessionMatch[1]);
        } catch {
          throw new ModelError('MODEL_REF_INVALID', '会话编号格式不正确', 400);
        }
        const record = registry.get(id);
        if (!record) throw new ModelError('MODEL_SESSION_UNKNOWN', '找不到这个会话', 404);
        send(response, 200, record);
      } else if (path === '/models/select') {
        const body = await readBody(request);
        assertNoSwitch(registry, body.sessionId);
      } else {
        const body = await readBody(request);
        validateBot(deps, body.bot);
        if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 200)) {
          throw new ModelError('MODEL_BODY_INVALID', '标题格式不正确', 400);
        }
        if (body.model !== undefined && typeof body.model !== 'string') {
          throw new ModelError('MODEL_REF_INVALID', '模型引用格式不正确', 400);
        }
        if (body.cwd !== undefined && typeof body.cwd !== 'string') {
          throw new ModelError('MODEL_BODY_INVALID', '工作目录格式不正确', 400);
        }
        // 工作目录只认名册预设的那一个（插件按目录认身份）；请求里给了别的一律拒。
        let cwd;
        if (typeof deps.botCwd === 'function') cwd = await deps.botCwd(body.bot);
        else if (typeof deps.roster?.presets === 'function') {
          const presets = await deps.roster.presets();
          cwd = Array.isArray(presets) ? presets.find(item => item.bot === body.bot)?.cwd : presets?.[body.bot]?.cwd;
        }
        if (typeof cwd !== 'string' || !cwd) {
          throw new ModelError('MODEL_BODY_INVALID', '找不到这个助理的工作目录', 400);
        }
        if (body.cwd !== undefined && body.cwd !== cwd) {
          throw new ModelError('MODEL_BODY_INVALID', '工作目录只能是这个助理自己的目录', 400);
        }
        const session = await createSessionWithModel(deps,
          { bot: body.bot, model: body.model, title: body.title, cwd });
        if (typeof deps.sessions?.adopt === 'function') {
          await deps.sessions.adopt(session.sessionId, body.bot, body.title);
        }
        send(response, 201, { session });
      }
    } catch (error) {
      const known = error instanceof ModelError;
      const code = known ? error.code : 'MODEL_INTERNAL_ERROR';
      const message = known ? error.message : '处理请求时发生错误';
      send(response, known ? error.status : 500, { error: { code, message } });
    }
    return true;
  };
}
