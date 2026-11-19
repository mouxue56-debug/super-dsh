import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { depsStopped, STOPPED_TEXT } from './panic-marker.mjs';
import { localDate, offsetFor } from './meetings-sources.mjs';

// 全部数字都是「暂定」，可在配置的 routines 段里改；没有任何预算上限。
export const ROUTINE_LIMITS = Object.freeze({
  maxSteps: { min: 1, max: 20 },
  maxMinutes: { min: 1, max: 240 },
  graceMinutes: 10,
  catchUpMinutes: 240,
  tickMs: 60000,
});

const ID = /^[a-z][a-z0-9-]{1,40}$/u;
const BOT = /^[A-Za-z0-9_.-]{1,64}$/u;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const PLAYBOOK = /^[\p{L}\p{N}_.-]{1,64}$/u;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const TERMINAL = ['completed', 'blocked', 'waiting-human', 'failed', 'waiting-timeout', 'uncertain'];
const clockMinutes = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
const plain = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max &&
  !CONTROL.test(value);

// 校验一条固定任务配置，返回规范化结果或原因。
export function normalizeRoutine(raw, defaults = {}) {
  const bad = reason => ({ ok: false, id: typeof raw?.id === 'string' ? raw.id : '?', reason });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('不是对象');
  if (!ID.test(raw.id ?? '')) return bad('id 无效');
  if (!BOT.test(raw.assistant ?? '')) return bad('assistant 无效');
  if (typeof raw.at !== 'string' || !CLOCK.test(raw.at)) return bad('at 须为 HH:MM');
  let days = 'daily';
  if (raw.days !== undefined && raw.days !== 'daily') {
    const valid = Array.isArray(raw.days) && raw.days.length > 0 &&
      raw.days.every(day => Number.isInteger(day) && day >= 1 && day <= 7);
    if (!valid) return bad('days 须为 daily 或 1..7（周一为 1）的数组');
    days = [...new Set(raw.days)].sort();
  }
  const hasPrompt = raw.prompt !== undefined;
  const hasPlaybook = raw.playbook !== undefined;
  if (hasPrompt === hasPlaybook) return bad('prompt 与 playbook 必须二选一');
  if (hasPrompt && !plain(raw.prompt, 1000)) return bad('prompt 无效');
  if (hasPlaybook && !(typeof raw.playbook === 'string' && PLAYBOOK.test(raw.playbook))) {
    return bad('playbook 无效');
  }
  if (!plain(raw.done, 300)) return bad('缺少完成条件 done');
  const escape = raw.escape;
  const lim = ROUTINE_LIMITS;
  const steps = escape?.maxSteps;
  const minutes = escape?.maxMinutes;
  if (!Number.isInteger(steps) || steps < lim.maxSteps.min || steps > lim.maxSteps.max) {
    return bad('缺少或无效的逃生口 escape.maxSteps');
  }
  if (!Number.isInteger(minutes) || minutes < lim.maxMinutes.min || minutes > lim.maxMinutes.max) {
    return bad('缺少或无效的逃生口 escape.maxMinutes');
  }
  const quietRaw = raw.quiet ?? defaults.quiet ?? null;
  let quiet = null;
  if (quietRaw !== null) {
    if (!CLOCK.test(quietRaw?.from ?? '') || !CLOCK.test(quietRaw?.to ?? '')) return bad('quiet 须为 {from,to}');
    quiet = { from: quietRaw.from, to: quietRaw.to };
  }
  const name = raw.name === undefined ? raw.id : raw.name;
  if (!plain(name, 40)) return bad('name 无效');
  return { ok: true, routine: {
    id: raw.id, name, assistant: raw.assistant, at: raw.at, days,
    prompt: hasPrompt ? raw.prompt : null, playbook: hasPlaybook ? raw.playbook : null,
    done: raw.done, escape: { maxSteps: steps, maxMinutes: minutes }, quiet,
  } };
}

// 读取并校验配置段；坏的条目单独列出，不影响其余条目。
export function parseRoutinesConfig(section) {
  const cfg = section && typeof section === 'object' && !Array.isArray(section) ? section : {};
  const defaults = { quiet: cfg.quiet ?? null };
  const routines = [];
  const invalid = [];
  const seen = new Set();
  for (const raw of Array.isArray(cfg.items) ? cfg.items : []) {
    const result = normalizeRoutine(raw, defaults);
    if (!result.ok) invalid.push({ id: result.id, reason: result.reason });
    else if (seen.has(result.routine.id)) invalid.push({ id: result.routine.id, reason: 'id 重复' });
    else {
      seen.add(result.routine.id);
      routines.push(result.routine);
    }
  }
  return {
    enabled: cfg.enabled !== false,
    catchUp: cfg.catchUp === true,
    catchUpMinutes: Number.isInteger(cfg.catchUpMinutes) && cfg.catchUpMinutes > 0 ?
      cfg.catchUpMinutes : ROUTINE_LIMITS.catchUpMinutes,
    graceMinutes: Number.isInteger(cfg.graceMinutes) && cfg.graceMinutes > 0 ?
      cfg.graceMinutes : ROUTINE_LIMITS.graceMinutes,
    tickMs: Number.isInteger(cfg.tickMs) && cfg.tickMs >= 10 ? cfg.tickMs : ROUTINE_LIMITS.tickMs,
    utcOffsetMinutes: Number.isInteger(cfg.utcOffsetMinutes) ? cfg.utcOffsetMinutes : undefined,
    routines, invalid,
  };
}

// 判断某分钟是否落在安静时段内（可跨午夜）。
export function inQuiet(quiet, minute) {
  if (!quiet) return false;
  const from = clockMinutes(quiet.from);
  const to = clockMinutes(quiet.to);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

// 本地日期对应的星期（周一为 1，周日为 7）。
export function isoWeekday(date) {
  return (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7 + 1;
}

// 某条固定任务在某个本地日期是否排班。
export function scheduledOn(routine, date) {
  return routine.days === 'daily' || routine.days.includes(isoWeekday(date));
}

// 判断一个时刻是否到点、已错过或还没到（纯函数，便于假时钟测试）。
export function slotStatus(routine, cfg, { date, minute }) {
  if (!scheduledOn(routine, date)) return 'off';
  const target = clockMinutes(routine.at);
  if (minute < target) return 'upcoming';
  if (inQuiet(routine.quiet, target)) return 'quiet';
  const late = minute - target;
  if (late <= cfg.graceMinutes) return 'due';
  if (cfg.catchUp && late <= cfg.catchUpMinutes) return 'due';
  return 'missed';
}

function mkdirPrivate(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function emptyState() {
  return { paused: false, pausedIds: [], slots: {} };
}

// 创建固定任务服务：定时判断、手动运行、暂停、运行记录。
export function createRoutineService(deps = {}) {
  const clock = () => {
    const value = Number(deps.now?.() ?? Date.now());
    return Number.isFinite(value) ? value : Date.now();
  };
  const cfg = () => {
    const parsed = parseRoutinesConfig(deps.hubConfig?.routines);
    return { ...parsed, tz: { timezone: deps.hubConfig?.timezone, utcOffsetMinutes: parsed.utcOffsetMinutes ??
      (deps.hubConfig?.timezone ? undefined : deps.utcOffsetMinutes) } };
  };
  const stateDir = () => (deps.dataDir ? path.join(deps.dataDir, 'routines') : null);
  const timers = deps.timers ?? { setTimeout, clearTimeout };
  const running = new Set();
  let memory = emptyState();
  const memoryRuns = [];
  let timer;

  // 一键全停：没有数据目录时全停本身落不了盘，按没停。
  const stopped = () => depsStopped(deps, { whenUnknown: false });

  function loadState() {
    const dir = stateDir();
    if (!dir) return memory;
    let text;
    try {
      text = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      return corruptState();
    }
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return corruptState();
      const state = { ...emptyState(), ...value };
      const shapeOk = typeof state.paused === 'boolean' && Array.isArray(state.pausedIds) &&
        Boolean(state.slots) && typeof state.slots === 'object' && !Array.isArray(state.slots);
      if (!shapeOk) return corruptState();
      return state;
    } catch {
      return corruptState();
    }
  }

  // 状态文件在但读不出，按「暂停着」处理并记日志（失败关门）；主人点恢复会重写这个文件。
  function corruptState() {
    try {
      deps.logger?.error?.('HUB_ROUTINES_STATE_CORRUPT');
    } catch {}
    return { ...emptyState(), paused: true, corrupt: true };
  }

  function saveState(state) {
    const dir = stateDir();
    memory = state;
    if (!dir) return;
    mkdirPrivate(dir);
    const tmp = path.join(dir, 'state.json.' + randomBytes(6).toString('hex'));
    fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, path.join(dir, 'state.json'));
  }

  function appendRun(row) {
    const full = { ts: new Date(clock()).toISOString(), ...row };
    memoryRuns.push(full);
    const dir = stateDir();
    if (dir) {
      try {
        mkdirPrivate(dir);
        fs.appendFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify(full) + '\n', { mode: 0o600 });
      } catch {
        deps.logger?.error?.('HUB_ROUTINE_LOG_FAILURE');
      }
    }
    return full;
  }

  function readRuns() {
    const dir = stateDir();
    if (!dir) return [...memoryRuns];
    try {
      return fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').split('\n').flatMap(line => {
        try {
          return line ? [JSON.parse(line)] : [];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  function markSlot(state, id, date) {
    const list = Array.isArray(state.slots[id]) ? state.slots[id] : [];
    state.slots[id] = [...new Set([...list, date])].slice(-7);
    saveState(state);
  }

  const notify = async row => {
    try {
      await deps.notify?.({ type: 'routine', routineId: row.id, state: row.state, ticket: row.ticket ?? null,
        date: row.date });
    } catch {
    }
  };

  const actor = name => ({ name, type: 'assistant' });

  function buildText(routine, ticketId) {
    const head = `固定任务「${routine.name}」，看板工单 ${ticketId}。`;
    const task = routine.prompt ?? `请按手册「${routine.playbook}」办。`;
    return [head, `任务：${task}`, `完成条件：${routine.done}`,
      '做完后用看板对这张工单回报（成果、怎么验的、没验的）；做不下去就在看板上标阻断。',
      `最多 ${routine.escape.maxSteps} 步、最多 ${routine.escape.maxMinutes} 分钟，到了会停下并标「没做完」。`,
    ].join('\n');
  }

  const continueText = (routine, step) =>
    `继续固定任务「${routine.name}」（第 ${step} 步）。完成条件：${routine.done}。` +
    '做完请回报；做不下去请标阻断。';

  async function within(promise, ms) {
    let handle;
    const limit = new Promise(resolve => {
      handle = timers.setTimeout(() => resolve({ timedOut: true }), Math.max(0, ms));
    });
    try {
      return await Promise.race([Promise.resolve(promise).then(value => ({ value })), limit]);
    } finally {
      timers.clearTimeout(handle);
    }
  }

  async function settled(ticketId) {
    try {
      const ticket = await deps.board.get(ticketId);
      if (ticket.reports?.length) return 'reported';
      if (TERMINAL.includes(ticket.state)) return ticket.state === 'completed' ? 'reported' : 'blocked';
    } catch {
    }
    return null;
  }

  async function finish(routine, base, state, extra = {}) {
    const row = appendRun({ ...base, state, ...extra });
    if (['reported', 'incomplete', 'timeout', 'blocked', 'failed'].includes(state)) await notify(row);
    return row;
  }

  async function execute(routine, { date, manual }) {
    const startedMs = clock();
    const runId = `${routine.id}:${startedMs}`;
    const base = { runId, id: routine.id, assistant: routine.assistant, date, manual: manual === true };
    // 一键全停期间不建单、不开会话，直接拒并明说。
    if (stopped()) return { ...base, state: 'stopped', reason: STOPPED_TEXT };
    if (!deps.board?.create || !deps.sessions?.create || !deps.sessions?.send) {
      return finish(routine, base, 'failed', { reason: '看板或会话接口不可用' });
    }
    const roster = typeof deps.roster?.get === 'function' ? await deps.roster.get(routine.assistant) : undefined;
    if (deps.roster && (!roster || (roster.status && roster.status !== 'active'))) {
      return finish(routine, base, 'failed', { reason: '助理不存在或未启用' });
    }
    const me = actor(routine.assistant);
    const key = manual === true ? `routine:${routine.id}:m${startedMs}` : `routine:${routine.id}:${date}`;
    let ticketId;
    try {
      const made = await deps.board.createWithMeta(me, {
        title: `固定任务：${routine.name}（${date}）`,
        goal: `${routine.prompt ?? '按手册「' + routine.playbook + '」办'}\n完成条件：${routine.done}`,
        to: [routine.assistant], key, project: '',
        acceptance: [{ check: routine.done, expect: '自述已完成，并写明怎么验的' }],
        routing: { requestedBy: 'routine', via: 'routine', hint: routine.id },
      });
      if (made.deduped) return finish(routine, base, 'skipped-duplicate', { ticket: made.ticket.id });
      ticketId = made.ticket.id;
      await deps.board.claim(me, ticketId);
    } catch (error) {
      return finish(routine, base, 'failed', { ticket: ticketId ?? null, reason: '建单或接单失败：' +
        (error?.code ?? 'ERROR') });
    }
    appendRun({ ...base, state: 'started', ticket: ticketId });
    const deadline = startedMs + routine.escape.maxMinutes * 60000;
    let sessionId;
    let steps = 0;
    const stop = async (state, reason) => {
      try {
        if (sessionId) await deps.sessions.cancel?.(sessionId);
      } catch {
      }
      try {
        await deps.board.progress(me, ticketId, reason);
      } catch {
      }
      try {
        if (state === 'timeout') await deps.board.markTimeout(me, ticketId);
        else if (state === 'failed') await deps.board.fail(me, ticketId, reason);
        else await deps.board.block(me, ticketId, reason);
      } catch {
      }
      return finish(routine, base, state, { ticket: ticketId, sessionId: sessionId ?? null, steps, reason });
    };
    try {
      const created = await deps.sessions.create(routine.assistant,
        { title: `固定任务·${routine.name}`, purpose: 'routine' });
      sessionId = typeof created === 'string' ? created : created?.id ?? created?.sessionId;
      if (!sessionId) return await stop('failed', '没能建会话');
      while (steps < routine.escape.maxSteps) {
        const remaining = deadline - clock();
        if (remaining <= 0) return await stop('timeout', '没做完：超过最长时间');
        steps += 1;
        const text = steps === 1 ? buildText(routine, ticketId) : continueText(routine, steps);
        const sent = await within(deps.sessions.send(sessionId, text), remaining);
        if (sent.timedOut) return await stop('timeout', '没做完：超过最长时间');
        const reply = sent.value?.reply;
        if (reply && typeof reply.then === 'function') {
          const got = await within(reply, deadline - clock());
          if (got.timedOut) return await stop('timeout', '没做完：超过最长时间');
          if (got.value?.failed) return await stop('failed', '会话回合失败');
        }
        const outcome = await settled(ticketId);
        if (outcome) {
          return finish(routine, base, outcome, { ticket: ticketId, sessionId, steps, selfReported: true });
        }
        if (clock() >= deadline) return await stop('timeout', '没做完：超过最长时间');
      }
      return await stop('incomplete', `没做完：用了 ${steps} 步仍没有回报`);
    } catch {
      return stop('failed', '运行出错');
    }
  }

  async function start(routine, opts) {
    if (running.has(routine.id)) return { state: 'skipped-busy' };
    running.add(routine.id);
    try {
      const row = await execute(routine, opts);
      return { state: row.state, ticket: row.ticket ?? null, runId: row.runId, steps: row.steps ?? 0 };
    } finally {
      running.delete(routine.id);
    }
  }

  const find = id => cfg().routines.find(item => item.id === id);

  const service = {
    // 手动运行一次（忽略安静时段与暂停中的单条；全局暂停时不运行）。
    async runNow(id) {
      const routine = find(id);
      if (!routine) return { state: 'not-found' };
      if (stopped()) return { state: 'stopped', reason: STOPPED_TEXT };
      const state = loadState();
      if (state.paused) return { state: 'skipped-paused' };
      const date = localDate(clock(), offsetFor(cfg().tz, clock()));
      return start(routine, { date, manual: true });
    },
    // 一次定时检查：到点的运行，错过的只记一行。
    async tick() {
      const c = cfg();
      if (!c.enabled) return [];
      // 全停期间到点也不触发（不建单、不记错过）。
      if (stopped()) return [];
      const state = loadState();
      if (state.paused) return [];
      const now = clock();
      const offset = offsetFor(c.tz, now);
      const today = localDate(now, offset);
      const local = new Date(now + offset * 60000);
      const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
      const yesterday = localDate(now - 86400000, offset);
      const outcomes = [];
      for (const routine of c.routines) {
        if (state.pausedIds.includes(routine.id)) continue;
        const done = Array.isArray(state.slots[routine.id]) ? state.slots[routine.id] : [];
        state.seen ??= {};
        const first = state.seen[routine.id] ?? today;
        if (!state.seen[routine.id]) {
          state.seen[routine.id] = today;
          saveState(state);
        }
        if (!done.includes(yesterday) && first <= yesterday && scheduledOn(routine, yesterday)) {
          markSlot(state, routine.id, yesterday);
          appendRun({ id: routine.id, assistant: routine.assistant, date: yesterday, state: 'missed',
            reason: '后端当时没在运行，未补做' });
        }
        if (done.includes(today)) continue;
        const status = slotStatus(routine, c, { date: today, minute });
        if (status === 'upcoming' || status === 'off') continue;
        markSlot(state, routine.id, today);
        if (status === 'quiet') {
          appendRun({ id: routine.id, assistant: routine.assistant, date: today, state: 'skipped-quiet',
            reason: '到点时在安静时段内' });
        } else if (status === 'missed') {
          appendRun({ id: routine.id, assistant: routine.assistant, date: today, state: 'missed',
            reason: '后端当时没在运行，未补做' });
        } else {
          outcomes.push({ id: routine.id, ...(await start(routine, { date: today, manual: false })) });
        }
      }
      return outcomes;
    },
    // 暂停全部（all 为空）或某一条。
    pause(id) {
      const state = loadState();
      if (id === undefined) state.paused = true;
      else if (!find(id)) return { state: 'not-found' };
      else state.pausedIds = [...new Set([...state.pausedIds, id])];
      saveState(state);
      return { state: 'paused', id: id ?? null };
    },
    // 恢复全部或某一条。
    resume(id) {
      const state = loadState();
      if (id === undefined) state.paused = false;
      else if (!find(id)) return { state: 'not-found' };
      else state.pausedIds = state.pausedIds.filter(item => item !== id);
      saveState(state);
      return { state: 'resumed', id: id ?? null };
    },
    // 列出每条固定任务及其今天的状态。
    list(opts = {}) {
      const c = cfg();
      const state = loadState();
      const now = clock();
      const offset = offsetFor(c.tz, now);
      const date = opts.date ?? localDate(now, offset);
      const runs = readRuns();
      const items = c.routines.map(routine => {
        const mine = runs.filter(row => row.id === routine.id);
        const today = mine.filter(row => row.date === date && row.state !== 'started');
        const last = mine.filter(row => row.state !== 'started').at(-1) ?? null;
        const scheduled = scheduledOn(routine, date);
        return {
          id: routine.id, name: routine.name, assistant: routine.assistant, at: routine.at,
          days: routine.days, done: routine.done, escape: routine.escape, quiet: routine.quiet,
          scheduledToday: scheduled,
          paused: state.paused || state.pausedIds.includes(routine.id),
          running: running.has(routine.id),
          todayState: today.at(-1)?.state ?? (scheduled ? 'pending' : 'off'),
          todayTicket: today.at(-1)?.ticket ?? null,
          last: last && { date: last.date, state: last.state, ticket: last.ticket ?? null },
        };
      });
      return { date, paused: state.paused, enabled: c.enabled, catchUp: c.catchUp, items, invalid: c.invalid };
    },
    // 最近的运行记录（新的在后）。
    runs(limit = 50) {
      return readRuns().slice(-Math.max(1, Math.min(500, limit)));
    },
    // 后端重启后：把没有结束记录的运行标为「中断」，工单标「拿不准」交给人。
    async recover() {
      const rows = readRuns();
      const ended = new Set(rows.filter(row => row.state !== 'started').map(row => row.runId));
      const open = rows.filter(row => row.state === 'started' && !ended.has(row.runId));
      for (const row of open) {
        try {
          await deps.board?.markUncertain?.(actor(row.assistant), row.ticket, '后端重启时这次固定任务没做完');
        } catch {
        }
        appendRun({ runId: row.runId, id: row.id, assistant: row.assistant, date: row.date,
          state: 'interrupted', ticket: row.ticket, reason: '后端重启，运行中断' });
      }
      return open.length;
    },
    // 启动进程内定时器（不装系统定时）。
    async begin() {
      if (timer) return;
      await service.recover().catch(() => {});
      const c = cfg();
      timer = setInterval(() => { void service.tick().catch(() => {}); }, c.tickMs);
      timer.unref?.();
      void service.tick().catch(() => {});
    },
    // 停止定时器。
    end() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    isRunning: id => running.has(id),
  };
  return service;
}

const cache = new WeakMap();

// 同一份依赖只创建一个固定任务服务。
export function routineServiceFor(deps) {
  if (!cache.has(deps)) cache.set(deps, createRoutineService(deps));
  return cache.get(deps);
}

// 清除某份依赖的服务（停止时用）。
export function dropRoutineService(deps) {
  cache.get(deps)?.end();
  cache.delete(deps);
}
