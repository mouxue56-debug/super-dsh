// 主人设备查看与撤销；本机插件用独立凭据调用助理工具。
import path from 'node:path';
import os from 'node:os';
import {timingSafeEqual, createHash} from 'node:crypto';
import {createSelfEdit} from '../self-edit.mjs';
import {readSecret} from '../secrets.mjs';
import {configuredPath} from './index.mjs';
import {ACTIONS, MUTATIONS, DISABLED} from '../../../hub-plugin/tools/self-edit.mjs';
import {modeFilePath, readPermissionMode} from '../../../hub-plugin/permission-mode.mjs';

const services = new WeakMap();
const denied = message => Object.assign(Error(message), {status: 403});
const invalid = message => Object.assign(Error(message), {status: 400});
function send(res, status, value) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(value));
}
async function body(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 512000) throw invalid('改动内容太大，请分次写入。');
    parts.push(part);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); }
  catch { throw invalid('改动内容格式不对。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('改动内容格式不对。');
  return value;
}
function sameKey(value, key) {
  if (typeof value !== 'string' || typeof key !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
function local(req) {
  const ip = req.socket?.remoteAddress;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function configFor(deps) {
  const raw = deps.hubConfig?.self_edit ?? {};
  const config = {...raw};
  const roots = {home: os.homedir(), hubHome: deps.hubHome};
  for (const key of ['source_dir', 'tool_key_file', 'runtime_dir', 'health_key_file', 'build_artifact']) {
    if (raw[key] !== undefined) config[key] = configuredPath(raw[key], roots);
  }
  if (Array.isArray(raw.main_dsh_paths)) {
    config.main_dsh_paths = raw.main_dsh_paths.map(value => configuredPath(value, roots));
  }
  return config;
}
export function serviceFor(deps) {
  if (!services.has(deps)) {
    const config = configFor(deps);
    services.set(deps, createSelfEdit({config,
      runtimeDir: config.runtime_dir ?? path.resolve(deps.hubHome ?? '.', 'runtime'),
      notice: value => deps.notify?.({source: 'self-edit', ...value}),
    }));
  }
  return services.get(deps);
}
function fields(input, allowed) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw invalid('改动里有未声明参数。');
}
function argumentsFor(action, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalid('缺少改动参数。');
  const spec = ACTIONS[action] ?? (action === 'prepare' ? {
    properties: {path: {type: 'string', maxLength: 1000}, summary: {type: 'string', maxLength: 300}},
    required: ['path', 'summary'],
  } : action === 'release' ? {
    properties: {id: {type: 'string', maxLength: 100}, leaseId: {type: 'string', maxLength: 100}},
    required: ['id', 'leaseId'],
  } : null);
  if (!spec) throw invalid('改自己没有这一步。');
  fields(args, Object.keys(spec.properties));
  for (const key of spec.required) if (!Object.hasOwn(args, key)) throw invalid('缺少参数 ' + key);
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string' || value.length > spec.properties[key].maxLength) {
      throw invalid('参数无效 ' + key);
    }
  }
}
async function toolCaller(deps, req, input, action) {
  if (!local(req)) throw denied('改自己工具只接受本机插件请求。');
  const config = configFor(deps);
  let key;
  try { key = await readSecret(config.tool_key_file); } catch { throw denied('改自己专用凭据未配好。'); }
  if (!sameKey(req.headers['x-hub-self-edit-key'], key)) throw denied('改自己工具凭据无效。');
  fields(input, ['args', 'caller']);
  const call = input.caller;
  if (!call || typeof call !== 'object' || Array.isArray(call)) throw denied('缺少助理调用身份。');
  fields(call, ['bot', 'sessionId', 'approved', 'ownerTurn', 'level']);
  const bot = deps.roster?.list?.().find(row => row.id === call.bot && row.status === 'active');
  const session = deps.sessions?.list?.({all: true}).find(row => row.id === call.sessionId && row.bot === call.bot);
  if (!bot || !session) throw denied('这次调用不属于正在工作的助理。');
  if (MUTATIONS.has(action)) {
    if (call.ownerTurn !== true || session.selfEditOwnerTurn !== true || !session.running) {
      throw denied('资料里的话不能发起改自己，请在主人交代的这一轮操作。');
    }
    const mode = readPermissionMode(modeFilePath(deps.hubHome)).mode;
    if (mode === 'readonly') throw denied('只读档只能查看，不能改自己。');
  }
  return {bot: call.bot, sessionId: call.sessionId};
}
export function createHandler(deps = {}) {
  const core = serviceFor(deps);
  const pending = new Map();
  async function confirm(action, args, caller, review, run, wait = false) {
    const key = createHash('sha256').update(JSON.stringify({action, args, caller})).digest('hex');
    let entry = pending.get(key);
    if (!entry) {
      const opening = (async () => {
        const request = await deps.cards.open({ ...review, bot: caller.bot === '主人' ? undefined : caller.bot,
          sessionId: caller.sessionId ?? '', kind: 'self-edit', ttlMs: 600000,
          text: review.consequence + '\n' + review.rollback,
          choices: [{id: 'yes', label: '确认并继续'}, {id: 'no', label: '先不做'}] });
        const execution = request.result.then(async answer => {
          if (answer.status !== 'answered' || answer.choice !== 'yes' || !answer.device) {
            return {cancelled: true, message: '这次改动已取消。'};
          }
          try {
            const value = await run();
            if (!wait) await deps.notify?.({source: 'self-edit', kind: 'self-edit', bot: caller.bot,
              text: review.title + '已执行，可以在改动记录查看进度。'});
            return value;
          } catch (error) {
            await deps.notify?.({source: 'self-edit', kind: 'self-edit', bot: caller.bot,
              text: '刚才确认的改自己操作没有完成，请查看改动记录后重试。'});
            throw error;
          }
        });
        execution.catch(() => {});
        execution.finally(() => pending.delete(key)).catch(() => {});
        return {card: request.card, execution};
      })();
      pending.set(key, opening);
      entry = opening;
      opening.catch(() => pending.delete(key));
    }
    const opened = await entry;
    if (wait) return opened.execution;
    return {pending: true, card: opened.card};
  }
  async function toolOperation(action, args, caller) {
    const review = await core.review(action, args, caller);
    const askMode = readPermissionMode(modeFilePath(deps.hubHome)).mode === 'ask';
    const needed = review ?? (askMode && MUTATIONS.has(action) ? {
      confirmationTotal: 1, title: '继续这次改自己', targets: args.path ? [args.path] : [],
      targetCount: args.path ? 1 : 0, consequence: '将执行这次源码操作。', rollback: '修改前会保存源码还原点。',
    } : null);
    const run = async () => {
      const session = deps.sessions?.list?.({all: true}).find(row =>
        row.id === caller.sessionId && row.bot === caller.bot);
      if (MUTATIONS.has(action) && (!session?.selfEditOwnerTurn ||
        readPermissionMode(modeFilePath(deps.hubHome)).mode === 'readonly')) {
        throw denied('这段主人交代已结束或权限档位已改变，请重新发起。');
      }
      return core.execute(action, args, caller);
    };
    if (!needed) return run();
    // 原生写入必须等到批准和还原点都完成，才把租约交给真正执行文件操作的插件。
    return confirm(action, args, caller, needed, run, ['prepare', 'read'].includes(action));
  }
  return async (req, res) => {
    const route = new URL(req.url, 'http://127.0.0.1').pathname.replace(/^\/bff(?=\/self-edit)/u, '');
    if (!route.startsWith('/self-edit/')) return false;
    try {
      const tool = /^\/self-edit\/tool\/([a-z]+)$/u.exec(route);
      if (tool) {
        if (req.method !== 'POST') throw Object.assign(Error('这个操作需要 POST。'), {status: 405});
        const input = await body(req);
        const caller = await toolCaller(deps, req, input, tool[1]);
        argumentsFor(tool[1], input.args);
        if (deps.hubConfig?.self_edit?.enabled !== true) {
          send(res, 200, {enabled: false, message: DISABLED});
          return true;
        }
        const result = await toolOperation(tool[1], input.args, caller);
        send(res, result.pending ? 202 : 200, result);
      } else {
        if (deps.isOwnerDevice?.(req) !== true) throw denied('只有已登录的主人设备能查看或退回改动。');
        if (route === '/self-edit/log' && req.method === 'GET') send(res, 200, await core.log());
        else {
          const restore = /^\/self-edit\/restore\/([^/]+)$/u.exec(route);
          if (!restore || req.method !== 'POST') throw Object.assign(Error('没有这项改自己操作。'), {status: 404});
          fields(await body(req), []);
          const id = decodeURIComponent(restore[1]);
          const review = await core.review('restore', {id}, {bot: '主人'});
          send(res, 202, await confirm('restore', {id}, {bot: '主人'}, review,
            () => core.restore(id, {bot: '主人'})));
        }
      }
    } catch (error) {
      const message = error.status ? error.message : '改自己这一步失败，请查看改动记录或使用救援命令。';
      send(res, error.status ?? 500, {ok: false, error: {code: 'SELF_EDIT_FAILED', message}});
    }
    return true;
  };
}
