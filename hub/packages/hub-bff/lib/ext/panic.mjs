// 一键全停的 HTTP 扩展（挂在 BFF 密钥校验之后，只认 /panic/ 前缀）。
// POST /panic/stop  POST /panic/resume  GET /panic/status
// 子系统（会话、定时器、外包运行器）各自可能存在也可能不存在；每一步如实记录，有一步没停掉就不报「已全停」。
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPanic, resolvePanicConfig } from '../panic.mjs';
import { panicStateDir, stoppedAt } from '../panic-marker.mjs';

const GATE = Symbol.for('hub.panic.gate');
const HERE = new URL('./', import.meta.url);
const instances = new WeakMap();
let reapplyTimer;

function seams(deps) {
  const s = deps.panicSeams ?? {};
  return {
    extDir: s.extDir ?? fileURLToPath(HERE),
    libDir: s.libDir ?? fileURLToPath(new URL('../', HERE)),
  };
}

async function loadSibling(dir, name) {
  const file = path.join(dir, name + '.mjs');
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!stat.isFile()) return undefined;
  return import(pathToFileURL(file).href);
}

function gateOf(holder) {
  const stopError = () => Object.assign(new Error('已一键全停，需先调用 /panic/resume'), {
    code: 'PANIC_STOPPED',
    status: 503,
  });
  return fn => {
    const wrapped = async (...args) => {
      if (holder.core.isStopped()) throw stopError();
      return fn(...args);
    };
    wrapped[GATE] = true;
    return wrapped;
  };
}

// 在共享的 deps.sessions 上装闸门：停机期间 create / send 一律被拒（晨会、讨论组、固定任务都走它）。
function installGate(deps, holder) {
  const sessions = deps.sessions;
  if (!sessions || typeof sessions !== 'object') return false;
  const wrap = gateOf(holder);
  for (const key of ['create', 'send']) {
    if (typeof sessions[key] === 'function' && !sessions[key][GATE]) sessions[key] = wrap(sessions[key]);
  }
  return true;
}

async function runningSessions(deps) {
  const rows = await deps.sessions.list({ all: true });
  return (Array.isArray(rows) ? rows : []).filter(row => row && row.running === true).map(row => row.id);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildAdapters(deps, holder, config) {
  const { extDir, libDir } = seams(deps);
  const adapters = [];
  adapters.push({
    name: 'gate',
    async stop() {
      if (!installGate(deps, holder)) return { status: 'absent', detail: '没有会话入口，无需装闸门' };
      return { status: 'ok', detail: '会话 create/send 闸门已装，停机期间一律被拒' };
    },
    async resume() {
      return { status: 'ok', detail: '闸门随停机状态解除' };
    },
  });
  adapters.push({
    name: 'sessions',
    async stop() {
      if (typeof deps.sessions?.list !== 'function') return { status: 'absent', detail: '没有会话列表入口' };
      const first = await runningSessions(deps);
      if (first.length === 0) return { status: 'ok', detail: '没有在跑的会话回合' };
      if (typeof deps.sessions.cancel !== 'function') {
        throw new Error(`有 ${first.length} 个会话在跑，但没有取消入口（deps.sessions.cancel 未接线）`);
      }
      const refused = [];
      for (const id of first) {
        try {
          await deps.sessions.cancel(id);
        } catch {
          refused.push(id);
        }
      }
      // 取消是异步的：轮询直到没有在跑的，或到等待上限。期间新冒出来的也算（闸门已装，只会是已放行的残余）。
      const deadline = Date.now() + config.verifyWaitMs;
      let left = await runningSessions(deps);
      while (left.length > 0 && Date.now() < deadline) {
        await sleep(config.verifyPollMs);
        for (const id of left) {
          if (refused.includes(id) || first.includes(id)) continue;
          try {
            await deps.sessions.cancel(id);
          } catch {
            refused.push(id);
          }
        }
        left = await runningSessions(deps);
      }
      if (left.length > 0) {
        throw new Error(`仍有 ${left.length} 个会话在跑：${left.slice(0, 10).join(',')}`
          + (refused.length ? `；取消被拒 ${refused.length} 个` : ''));
      }
      return { status: 'ok', detail: `已取消 ${first.length} 个在跑的回合并回查为 0` };
    },
    async resume() {
      return { status: 'ok', detail: '被取消的回合不会自动重来' };
    },
  });
  for (const name of config.timers) {
    adapters.push({
      name: 'timer:' + name,
      async stop() {
        const mod = await loadSibling(extDir, name);
        if (!mod) return { status: 'absent', detail: '没有这个模块，跳过' };
        if (typeof mod.stop !== 'function') return { status: 'absent', detail: '模块没有 stop()，无定时可停' };
        await mod.stop();
        return { status: 'ok', detail: 'stop() 已返回（定时器无查询接口，无法回查）' };
      },
      async resume() {
        const mod = await loadSibling(extDir, name);
        if (!mod || typeof mod.start !== 'function') return { status: 'absent', detail: '无需恢复' };
        await mod.start(deps);
        return { status: 'ok', detail: 'start() 已调用' };
      },
    });
  }
  adapters.push({
    name: 'dispatch',
    async stop() {
      const mod = await loadSibling(libDir, 'dispatch-runner');
      if (!mod) return { status: 'absent', detail: '没有外包运行器，跳过' };
      if (typeof mod.stopAll !== 'function' || typeof mod.listRunning !== 'function') {
        throw new Error('外包运行器缺 stopAll/listRunning，无法停也无法回查');
      }
      // 先作废在等主人点头的外派卡，之后再批也不起工人。
      let voided = 0;
      const ext = await loadSibling(extDir, 'dispatch');
      if (typeof ext?.voidPendingCards === 'function') voided = ext.voidPendingCards((deps.now ?? Date.now)());
      const before = await mod.listRunning();
      await mod.stopAll();
      const after = await mod.listRunning();
      const left = Array.isArray(after) ? after.length : 1;
      if (left > 0) throw new Error(`外包运行器仍有 ${left} 个在跑`);
      const had = Array.isArray(before) ? before.length : '?';
      return { status: 'ok', detail: `原有 ${had} 个，回查为 0；作废待批卡 ${voided} 张` };
    },
    async resume() {
      return { status: 'ok', detail: '被停掉的外包任务不会自动重跑' };
    },
  });
  return adapters;
}

function controllerFor(deps) {
  if (!instances.has(deps)) {
    const config = resolvePanicConfig(deps.hubConfig?.panic);
    // 位置的唯一定义在 panic-marker.mjs，插件与外包派工读同一处。
    const dir = panicStateDir({ dataDir: deps.dataDir, hubConfig: deps.hubConfig, hubHome: deps.hubHome });
    if (!dir) throw new Error('算不出停机状态目录');
    // 闸门要读控制器的状态，控制器又要用到适配器，所以用 holder 打结。
    const holder = { core: undefined };
    holder.core = createPanic({
      dir,
      adapters: buildAdapters(deps, holder, config),
      now: deps.now ?? Date.now,
      stepTimeoutMs: config.stepTimeoutMs,
      logger: deps.logger ?? console,
    });
    installGate(deps, holder);
    instances.set(deps, { core: holder.core, config });
  }
  return instances.get(deps);
}

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= 4096) chunks.push(chunk);
  }
  if (size > 4096) return { tooLarge: true };
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { invalid: true };
  } catch {
    return { invalid: true };
  }
}

async function live(deps) {
  const out = { runningSessions: null, runningExternal: null };
  try {
    if (typeof deps.sessions?.list === 'function') out.runningSessions = (await runningSessions(deps)).length;
  } catch {
  }
  try {
    const mod = await loadSibling(seams(deps).libDir, 'dispatch-runner');
    if (mod && typeof mod.listRunning === 'function') {
      const rows = await mod.listRunning();
      out.runningExternal = Array.isArray(rows) ? rows.length : null;
    }
  } catch {
  }
  return out;
}

// 网页适配层按登录设备重建的设备头（与讨论组确认同一格式）；格式不对按没有算。
function ownerDevice(req) {
  const value = req.headers?.['x-hub-device'];
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value);
}

// 创建只处理 /panic/ 路径的 HTTP 处理器。
export function createHandler(deps) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/panic' && !url.pathname.startsWith('/panic/')) return false;
    if (typeof deps.isTrusted === 'function' && deps.isTrusted(req) !== true) {
      send(res, 401, { error: { code: 'UNAUTHORIZED', message: '需要密钥' } });
      return true;
    }
    if (!deps.dataDir) {
      send(res, 503, { error: { code: 'UNAVAILABLE', message: '没有数据目录，无法保证停机状态落盘' } });
      return true;
    }
    const route = url.pathname.slice('/panic'.length);
    const methods = { '/stop': 'POST', '/resume': 'POST', '/status': 'GET' };
    if (!Object.hasOwn(methods, route)) {
      send(res, 404, { error: { code: 'NOT_FOUND', message: '路径不存在' } });
      return true;
    }
    if (req.method !== methods[route]) {
      send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } });
      return true;
    }
    try {
      const { core } = controllerFor(deps);
      if (route === '/status') {
        send(res, 200, { ...core.status(), live: await live(deps) });
        return true;
      }
      // 解除全停和确认分工表一样，要网页层按登录会话重建的设备头。
      if (route === '/resume' && !ownerDevice(req)) {
        send(res, 403, { error: { code: 'FORBIDDEN', message: '解除一键全停要主人在已登录的设备上点' } });
        return true;
      }
      const body = await readBody(req);
      if (body.tooLarge || body.invalid) {
        send(res, 400, { error: { code: 'INVALID', message: '请求体必须是不超过 4KB 的 JSON 对象' } });
        return true;
      }
      const result = route === '/stop' ? await core.stop(typeof body.reason === 'string' ? body.reason : '') :
        await core.resume();
      send(res, result.ok ? 200 : 503, result);
    } catch {
      send(res, 500, { error: { code: 'INTERNAL', message: '一键全停内部错误；状态不明时请按未停处理并重试' } });
    }
    return true;
  };
}

// 后端启动：装闸门；若落盘状态是「已停」，把各步骤重做一遍（重启时被拉起的定时器会被再次停下）。
export async function start(deps) {
  if (!deps.dataDir) return;
  const { core, config } = controllerFor(deps);
  if (!core.isStopped()) return;
  await core.reapply();
  // 加载器按文件名顺序启动：名字排在 panic 之后的扩展（如 routines）会晚于此刻才起定时，故延迟再补一次。
  clearTimeout(reapplyTimer);
  reapplyTimer = setTimeout(() => {
    if (core.isStopped()) void core.reapply().catch(() => {});
  }, config.reapplyDelayMs);
  reapplyTimer.unref?.();
}

// 后端关闭：只清定时，不改停机状态（停机状态属于磁盘）。
export function stop() {
  clearTimeout(reapplyTimer);
  reapplyTimer = undefined;
}

// 供插件或别的模块只读判断：给定数据目录时，停机标记文件是否存在。
export function isStoppedAt(dataDir, hubConfig) {
  const dir = panicStateDir({ dataDir, hubConfig });
  return dir ? stoppedAt(dir) : true;
}
