// 外包派工扩展（后端，BFF 密钥之后）。
// 三道闸都在这一侧：①本次外派确认卡；②机器检查任务书；③读过外部内容不许派。
// 插件工具只负责把「哪张工单、谁在派、会话读没读过外部内容」递过来，不决定任何事。
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRunner, normalizeConfig, renderCardText, setActiveRunner } from '../dispatch-runner.mjs';
import { cardSummary, textDigest } from '../fulltext.mjs';
import { depsStopped, panicStateDir, STATE_NAME } from '../panic-marker.mjs';

const states = new WeakMap();
let current;
const GRANT_KEYS = ['id', 'bot', 'program', 'dir', 'caps', 'by', 'on', 'until', 'tag', 'createdAt', 'cardId',
  'revokedAt'];
const STATUS = { INVALID: 400, NOT_FOUND: 404, BUSY: 409, TOO_LONG: 422, BOARD_UNAVAILABLE: 503, NO_CARDS: 503,
  PANIC_STOPPED: 503 };

// 一键全停的状态目录，与 panic 扩展、插件共用 panic-marker.mjs 的定义。
function panicDir(deps) {
  return panicStateDir({ dataDir: deps.dataDir, hubConfig: deps.hubConfig, hubHome: deps.hubHome });
}

// 现在是不是停着：与其他入口共用 panic-marker.mjs 的判断；外包派工算不出目录也按停着。
export function panicStopped(deps) {
  return depsStopped(deps, { whenUnknown: true });
}

// 出卡之后有没有发生过一键全停（停过再恢复也算）：有就作废这张卡。状态文件读不出也按发生过。
function stoppedSince(deps, createdAt) {
  const dir = panicDir(deps);
  if (!dir) return true;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(dir, STATE_NAME), 'utf8'));
  } catch (error) {
    return error.code !== 'ENOENT';
  }
  if (!state || typeof state !== 'object') return true;
  return [state.since, state.lastResumeAt].some(t => typeof t === 'number' && t >= createdAt);
}

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function bodyOf(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= 65536) chunks.push(chunk);
  }
  if (size > 65536) throw Object.assign(new Error('请求体超过 64 KB'), { status: 413 });
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // 落到下面统一报错
  }
  throw Object.assign(new Error('请求体必须是 JSON 对象'), { status: 400 });
}

// 按配置的时区偏移取「今天」。
function today(nowMs, offsetMinutes) {
  return new Date(nowMs + (Number(offsetMinutes) || 0) * 60000).toISOString().slice(0, 10);
}

// 读放权表；坏了按空表处理（等于每次都问）。
function readGrants(file, logger) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > 65536) throw new Error('文件不合规');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data?.v !== 1 || !Array.isArray(data.grants)) throw new Error('格式不对');
    const ok = g => g && typeof g === 'object' && GRANT_KEYS.every(k => Object.hasOwn(g, k)) &&
      g.by === 'owner' && typeof g.bot === 'string' && typeof g.program === 'string' &&
      path.isAbsolute(g.dir) && /^\d{4}-\d{2}-\d{2}$/u.test(g.until) &&
      g.tag === `#by/owner #on/${g.on} #until/${g.until}`;
    if (!data.grants.every(ok)) throw new Error('条目格式不对');
    return data.grants;
  } catch (error) {
    if (error.code !== 'ENOENT') logger?.error?.('HUB_DISPATCH_GRANTS_UNUSABLE');
    return [];
  }
}

// 放权表：沿用命令放权的条目格式；program 写工人名，dir 写外包根（或工作树根）。
function createGrants({ file, now, offset, logger }) {
  let chain = Promise.resolve();
  const status = g => (g.revokedAt ? 'revoked' : today(now(), offset) > g.until ? 'expired' : 'active');
  const write = grants => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, grants }) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  };
  const log = (action, g, device) => {
    try {
      const line = [new Date(now()).toISOString(), 'dispatch-' + action, g.bot, g.program, g.dir, g.until,
        device ?? '-'].join('\t') + '\n';
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW;
      const fd = fs.openSync(path.join(path.dirname(file), 'permissions.changes.log'), flags, 0o600);
      try {
        fs.writeSync(fd, line);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      logger?.error?.('HUB_DISPATCH_GRANT_LOG_FAILURE');
    }
  };
  const change = fn => {
    const work = chain.then(fn);
    chain = work.catch(() => {});
    return work;
  };
  return {
    list: () => readGrants(file, logger).map(g => ({ ...g, status: status(g) })),
    revoke(id, device) {
      return change(() => {
        const grants = readGrants(file, logger);
        const g = grants.find(x => x.id === id);
        if (!g) return null;
        if (!g.revokedAt) {
          g.revokedAt = new Date(now()).toISOString();
          write(grants);
          log('grant-revoke', g, device);
        }
        return { ...g, status: status(g) };
      });
    },
  };
}

// 读配置：先看安装配置里的 dispatch 段，没有再读配置目录里的 dispatch.json；都没有就是没开通。
function loadConfig(deps) {
  let raw = deps.hubConfig?.dispatch;
  if (raw === undefined && deps.configDir) {
    try {
      const file = path.join(deps.configDir, 'dispatch.json');
      const st = fs.lstatSync(file);
      if (st.isFile() && st.size <= 65536) raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') deps.logger?.error?.('HUB_DISPATCH_CONFIG_UNREADABLE');
    }
  }
  if (raw === undefined) return { config: null, reason: '外包派工未配置' };
  const base = deps.dataDir ?? deps.configDir;
  try {
    return { config: normalizeConfig(raw, { defaultRunDir: base ? path.join(base, 'dispatch-runs') : undefined }) };
  } catch (error) {
    return { config: null, reason: error.message };
  }
}

// 同一组依赖只建一个运行器。
export function stateFor(deps) {
  if (!states.has(deps)) {
    const { config, reason } = loadConfig(deps);
    const now = deps.now ?? Date.now;
    const state = { config, reason, pending: new Map(), tasks: new Set(), runner: null, grants: null, voidedAt: -1 };
    if (config) {
      state.runner = createRunner({ config, board: deps.board, ledger: deps.ledger, notify: deps.notify, now,
        logger: deps.logger ?? console, canStart: () => !panicStopped(deps) });
      state.grants = createGrants({ file: path.join(deps.configDir, 'dispatch-grants.json'), now,
        offset: typeof deps.utcOffsetMinutes === 'number' ? deps.utcOffsetMinutes : 0,
        logger: deps.logger });
    }
    states.set(deps, state);
  }
  return states.get(deps);
}

// 启动：认回正在跑的，接着收结果。
export async function start(deps) {
  current = stateFor(deps);
  setActiveRunner(current.runner);
  await current.runner?.recover();
}

// 停：只停定时回收，不动已经起来的工人。
export function stop() {
  current?.runner?.dispose();
  setActiveRunner(undefined);
  current = undefined;
}

// 给「一键全停」用：现在还在跑的外包进程。
export function listRunning() {
  return current?.runner?.listRunning() ?? [];
}

// 给「一键全停」用：停掉所有在跑的，如实回报。
export async function stopAll(options) {
  if (!current?.runner) return { stopped: [], stillRunning: [], errors: [], configured: false };
  return { ...(await current.runner.stopAll(options)), configured: true };
}

// 给「一键全停」用：作废所有在等主人点头的外派卡（之后再批也不起工人；恢复后要重新出卡）。
export function voidPendingCards(at = Date.now()) {
  if (!current) return 0;
  current.voidedAt = Math.max(current.voidedAt, at);
  const count = current.pending.size;
  current.pending.clear();
  return count;
}

// 测试与收尾用：等所有在等主人点头的任务处理完。
export async function waitIdle(deps) {
  const state = states.get(deps);
  while (state?.tasks.size) await Promise.allSettled([...state.tasks]);
}

function refusal(res, code, message, reasons) {
  send(res, STATUS[code] ?? 403, { error: { code, message, ...(reasons ? { reasons } : {}) } });
}

// 创建只处理 /dispatch 路径的处理器。
export function createHandler(deps) {
  const state = stateFor(deps);
  current ??= state;
  const notify = event => {
    try {
      deps.notify?.({ source: 'dispatch', ...event });
    } catch {
      deps.logger?.error?.('HUB_DISPATCH_NOTIFY_FAILURE');
    }
  };
  const names = () => (deps.roster?.list?.() ?? []).flatMap(b => [b.id, b.name]).filter(Boolean);

  // 主人本次批准后先复查并启动。旧卡的 approve-always 只按本次批准处理。
  async function afterCard({ answer, request, spec, digest, createdAt }) {
    const yes = answer?.status === 'answered' && ['approve', 'approve-always'].includes(answer.choice);
    if (!yes) {
      notify({ kind: 'declined', ticket: spec.ticketId, text: '外派没有获批（主人没点头或卡超时），没有启动' });
      return;
    }
    // 批了卡也要先看停机；出卡后停过（哪怕已恢复）这张卡作废，要重新出卡。
    if (panicStopped(deps) || state.voidedAt >= createdAt || stoppedSince(deps, createdAt)) {
      notify({ kind: 'refused', ticket: spec.ticketId, code: 'PANIC_STOPPED',
        text: '出卡之后一键全停过，这张卡作废了，没有启动；恢复后请重新派' });
      return;
    }
    if (digest && deps.fullText?.get(digest) !== renderCardText(spec)) {
      deps.logger?.error?.('HUB_DISPATCH_FULLTEXT_CHANGED');
      notify({ kind: 'refused', ticket: spec.ticketId, code: 'CHANGED', text: '任务书全文已改变，没有启动' });
      return;
    }
    const result = await state.runner.start({ ticketId: spec.ticketId, bot: request.bot,
      sessionId: request.sessionId, readExternal: request.readExternal, approval: { by: 'card', id: answer.id },
      expectSha: spec.specSha, expectText: digest ?? textDigest(renderCardText(spec)), rosterNames: names() });
    if (!result.ok) {
      notify({ kind: 'refused', ticket: spec.ticketId, code: result.code,
        text: `主人批准了，但启动前复查没通过：${result.reasons?.[0]?.message ?? result.code}` });
      return;
    }

  }

  async function dispatch(body, res) {
    const { ticket, bot, sessionId, readExternal } = body;
    if (typeof ticket !== 'string' || typeof bot !== 'string' || typeof readExternal !== 'boolean' ||
      sessionId !== undefined && typeof sessionId !== 'string') {
      return refusal(res, 'INVALID', '需要 ticket、bot、readExternal（布尔）');
    }
    // 停着就不出卡、不按放权开工。
    if (panicStopped(deps)) return refusal(res, 'PANIC_STOPPED', '已一键全停，需先恢复');
    const row = deps.roster?.get?.(bot);
    const permitted = state.config.allowBots.includes(bot) || state.config.allowBots.includes('*');
    const active = row && row.status === 'active' && row.paused !== true;
    if (!active || !permitted) {
      return refusal(res, 'NOT_ALLOWED', '这位助理未启用或不在外派允许名单中');
    }
    const request = { ticketId: ticket, bot, sessionId, readExternal, rosterNames: names() };
    const running = state.runner.forTicket(ticket).find(r => ['running', 'timeout'].includes(r.status));
    if (running && running.bot === bot) return send(res, 200, { status: 'running', run: running });
    const inspected = await state.runner.inspect(request);
    if (!inspected.ok) {
      if (inspected.code === 'TAINTED') {
        notify({ kind: 'tainted', ticket, bot, text: `工单 ${ticket} 不能外派（读过外部内容），请主人亲自处理` });
      }
      return refusal(res, inspected.code, inspected.reasons[0].message, inspected.reasons);
    }
    const { spec } = inspected;
    if (typeof deps.cards?.ask !== 'function') return refusal(res, 'NO_CARDS', '确认卡通道暂未接通，请稍后再试');
    if (state.pending.has(ticket)) return send(res, 202, { status: 'awaiting_approval', repeated: true });
    const createdAt = (deps.now ?? Date.now)();
    const token = {};
    const full = renderCardText(spec);
    if (!deps.fullText && Array.from(full).length > 900) {
      return refusal(res, 'TOO_LONG', '任务书超过 900 字且全文存储不可用，请精简或拆单');
    }
    const digest = deps.fullText ? deps.fullText.put(full) : undefined;
    const text = cardSummary(full, 900).text;
    state.pending.set(ticket, token);
    const task = Promise.resolve(deps.cards.ask({
      title: `派给外部工人：${spec.worker}`.slice(0, 40), text, bot, sessionId: sessionId ?? '', kind: 'dispatch',
      ttlMs: state.config.cardTtlMs, confirmationTotal: 1, ...(digest ? { fullText: digest } : {}),
      choices: [{ id: 'approve', label: '这次派出去' }, { id: 'reject', label: '先不' }],
      targets: [`${spec.worker} · ${spec.ticketId} · ${spec.workdir}`], targetCount: 1,
      consequence: '任务书会交给这位外部工人，并启动配置好的接单器。',
      rollback: '可以停止后续执行，已发送的任务书和已产生的费用无法撤回。',
    })).then(answer => afterCard({ answer, request, spec, digest, createdAt }))
      .catch(() => notify({ kind: 'card_failed', ticket, text: '外派确认卡出错，没有启动' }))
      .finally(() => {
        // 全停作废后同一张单可能已重新出卡：只清自己那一条。
        if (state.pending.get(ticket) === token) state.pending.delete(ticket);
        state.tasks.delete(task);
      });
    state.tasks.add(task);
    return send(res, 202, { status: 'awaiting_approval' });
  }

  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/dispatch' && !url.pathname.startsWith('/dispatch/')) return false;
    if (deps.isTrusted?.(req) !== true) {
      send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'BFF key required' } });
      return true;
    }
    if (!state.config) {
      send(res, 503, { error: { code: 'UNAVAILABLE', message: state.reason } });
      return true;
    }
    try {
      const parts = url.pathname.split('/').slice(2).filter(Boolean).map(decodeURIComponent);
      if (parts[0] === 'runs' && parts.length === 1 && req.method === 'POST') {
        await dispatch(await bodyOf(req), res);
      } else if (parts[0] === 'runs' && parts.length === 1 && req.method === 'GET') {
        await state.runner.collect();
        send(res, 200, { runs: state.runner.list() });
      } else if (parts[0] === 'runs' && parts.length === 2 && req.method === 'GET') {
        await state.runner.collect();
        const run = state.runner.get(parts[1]);
        send(res, run ? 200 : 404, run ? { run } : { error: { code: 'NOT_FOUND', message: '没有这次运行' } });
      } else if (parts[0] === 'grants' && parts.length === 1 && req.method === 'GET') {
        send(res, 200, { grants: state.grants.list() });
      } else if (parts[0] === 'grants' && parts.length === 3 && parts[2] === 'revoke' && req.method === 'POST') {
        const grant = await state.grants.revoke(parts[1], 'owner');
        send(res, grant ? 200 : 404, grant ? { grant } : { error: { code: 'NOT_FOUND', message: '没有这条放权' } });
      } else {
        send(res, 404, { error: { code: 'NOT_FOUND', message: '路径不存在' } });
      }
    } catch (error) {
      deps.logger?.error?.('HUB_DISPATCH_FAILURE');
      send(res, Number.isInteger(error?.status) ? error.status : 500,
        { error: { code: 'DISPATCH_FAILURE', message: Number.isInteger(error?.status) ? error.message : '外包派工出错' } });
    }
    return true;
  };
}
