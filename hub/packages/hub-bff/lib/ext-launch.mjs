// 派给外部身份时，当场拉起它的接单器（代替装定时任务）。【AI建议】
//
// 配置只在 hub.yaml 的 board.external_launch（界面和助理都改不了），按外部身份名写：
//   {"codex":{"cmd":["/绝对路径/node","/绝对路径/hub-runner.mjs","--once","--config","/绝对路径/config.json"],
//             "timeout_seconds":1200,"daily_max":20,"retries":1,"env":{"PATH":"…","HOME":"…"}}}
// 没写某个外部身份就和以前一样：等它自己来拿。
// 安全：命令是参数数组、不经 shell；卡片标题、说明、助理写的任何字都不进命令行，也不进环境变量；
// 环境变量只有配置里写死的几项，加上一个 HUB_TICKET=单号（单号只含字母数字和 -）。
// 触发：看板事件里一张卡变成「排队中、没人领、负责人是这个外部身份」（含接力轮到它这一棒、定时到点、主人审批通过）。
// 限制：同一时刻只跑一个（排队）、有超时、失败重试 retries 次（默认 1）、每个身份每天最多 daily_max 次（默认 20）。
// 失败（含超时、跑完了却没领走这张卡）记下来，今天页提示「没叫动 X」。一键全停：不拉起，排着，恢复后补。
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { localDay } from './arrange-model.mjs';

const MAX_REMEMBER = 2000;
const MAX_FAILURES = 50;
const NAME = /^[A-Za-z0-9_.-]{1,64}$/u;
const ASSIGN_ACTIONS = ['created', 'owner_assign', 'arrange_set', 'arrange_ok', 'arrange_swap', 'schedule_fired',
  'handoff', 'schedule_spawned'];

// 读配置；坏的条目跳过（返回 invalid 列出来），不影响别的。
export function parseLaunchConfig(boardConfig) {
  const raw = boardConfig?.external_launch;
  const map = new Map();
  const invalid = [];
  if (raw === undefined) return { map, invalid };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { map, invalid: ['external_launch 不是对象'] };
  const listed = new Set(Array.isArray(boardConfig?.externals) ? boardConfig.externals : []);
  for (const [name, item] of Object.entries(raw)) {
    const bad = reason => invalid.push(`${name}：${reason}`);
    if (!NAME.test(name)) { bad('名字无效'); continue; }
    if (!listed.has(name)) { bad('不在 board.externals 名单里'); continue; }
    if (!item || typeof item !== 'object' || Array.isArray(item)) { bad('不是对象'); continue; }
    const cmd = item.cmd;
    if (!Array.isArray(cmd) || !cmd.length || cmd.length > 32 || cmd.some(p => typeof p !== 'string' || !p || /[\0\r\n]/u.test(p))) {
      bad('cmd 须为非空的字符串数组'); continue;
    }
    if (!path.isAbsolute(cmd[0])) { bad('cmd[0] 须为绝对路径'); continue; }
    const int = (v, d, min, max) => (v === undefined ? d : Number.isSafeInteger(v) && v >= min && v <= max ? v : null);
    const timeout = int(item.timeout_seconds, 1200, 5, 7200);
    const daily = int(item.daily_max, 20, 1, 500);
    const retries = int(item.retries, 1, 0, 3);
    if (timeout === null || daily === null || retries === null) { bad('数字配置不合法'); continue; }
    let env = {};
    if (item.env !== undefined) {
      if (!item.env || typeof item.env !== 'object' || Array.isArray(item.env) ||
        Object.entries(item.env).some(([k, v]) => !/^[A-Z][A-Z0-9_]{0,63}$/u.test(k) || k === 'HUB_TICKET' ||
          typeof v !== 'string' || /[\0\r\n]/u.test(v))) { bad('env 须为大写变量名到字符串的对象'); continue; }
      env = { ...item.env };
    }
    if (item.cwd !== undefined && !(typeof item.cwd === 'string' && path.isAbsolute(item.cwd))) { bad('cwd 须为绝对路径'); continue; }
    map.set(name, { cmd: [...cmd], timeoutMs: timeout * 1000, dailyMax: daily, retries, env, cwd: item.cwd });
  }
  return { map, invalid };
}

function emptyState() {
  return { done: [], pending: [], daily: { date: '', counts: {} }, failures: [] };
}

function readState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const base = emptyState();
    if (Array.isArray(value?.done) && value.done.every(i => typeof i === 'string')) base.done = value.done;
    if (Array.isArray(value?.pending)) {
      base.pending = value.pending.filter(i => i && typeof i.key === 'string' && typeof i.id === 'string' &&
        NAME.test(i.name ?? '') && Number.isSafeInteger(i.attempt ?? 1));
    }
    if (value?.daily && typeof value.daily.date === 'string' && value.daily.counts && typeof value.daily.counts === 'object') {
      base.daily = { date: value.daily.date, counts: { ...value.daily.counts } };
    }
    if (Array.isArray(value?.failures)) {
      base.failures = value.failures.filter(i => i && typeof i.id === 'string' && NAME.test(i.name ?? ''));
    }
    return base;
  } catch {
    return emptyState();
  }
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomBytes(6).toString('hex');
  const value = { done: state.done.slice(-MAX_REMEMBER), pending: state.pending.slice(-200), daily: state.daily,
    failures: state.failures.slice(-MAX_FAILURES) };
  fs.writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}

// 这张卡现在是不是「该拉起某个外部身份的接单器」。只看卡本身，不信事件里带的字。
export function launchTarget(ticket, launchMap) {
  if (!ticket || ticket.legacy) return null;
  if (ticket.relay) {
    // 接力里轮到外部身份那一棒：卡已经写成它在做（进行中、负责人是它），但它还没交这一棒。
    const relay = ticket.relay;
    const step = relay.steps?.[relay.current];
    if (relay.phase !== 'running' || !step || step.who?.type !== 'external' || !launchMap.has(step.who.name)) return null;
    if (ticket.state !== 'progress' || ticket.claimedBy !== step.who.name || ticket.review === 'submitted') return null;
    const began = step.resumedAt ?? step.startedAt ?? '';
    if (ticket.report && ticket.report.by === step.who.name && Date.parse(ticket.report.ts) >= (Date.parse(began) || 0)) return null;
    return { name: step.who.name, stamp: began, key: `${ticket.id}#launch#${step.who.name}#r${relay.current}#${began}` };
  }
  if (ticket.state !== 'queued' || ticket.claimedBy) return null;
  if (ticket.arrange && ['wanted', 'proposed'].includes(ticket.arrange.state)) return null;
  const to = ticket.to ?? [];
  if (to.length !== 1 || !launchMap.has(to[0])) return null;
  const stamp = [...(ticket.history ?? [])].reverse().find(h => ASSIGN_ACTIONS.includes(h.action))?.ts ?? ticket.createdAt;
  return { name: to[0], stamp, key: `${ticket.id}#launch#${to[0]}#${stamp}` };
}

export function createExtLaunch({ board, hubConfig = () => ({}), stateFile, isStopped = () => false, now = Date.now,
  utcOffsetMinutes = 0, logger = console, spawn = nodeSpawn, tickMs = 5000, retryDelayMs = 30000, killGraceMs = 5000 } = {}) {
  let state = null;
  let timer = null;
  let pumping = null;
  let chain = Promise.resolve();
  const load = () => {
    state ??= readState(stateFile);
    return state;
  };
  const offset = () => (typeof utcOffsetMinutes === 'function' ? utcOffsetMinutes() : utcOffsetMinutes);
  const config = () => parseLaunchConfig(hubConfig()?.board);
  const halted = () => {
    try {
      return isStopped() === true;
    } catch {
      return true;
    }
  };
  const save = () => writeState(stateFile, load());

  const intake = async id => {
    const { map } = config();
    if (!map.size) return false;
    let ticket;
    try {
      ticket = await board.get(id);
    } catch {
      return false;
    }
    const target = launchTarget(ticket, map);
    if (!target) return false;
    const current = load();
    if (current.done.includes(target.key) || current.pending.some(item => item.key === target.key)) return false;
    current.pending.push({ key: target.key, id, name: target.name, attempt: 1, ts: now(), notBefore: 0 });
    save();
    return true;
  };

  // 真正拉起：不经 shell，参数数组，环境变量只有配置里写死的加单号；有超时，超时杀整个进程组。
  const run = (spec, id) => new Promise(resolve => {
    let child;
    try {
      child = spawn(spec.cmd[0], spec.cmd.slice(1), { cwd: spec.cwd, env: { ...spec.env, HUB_TICKET: id },
        shell: false, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch {
      resolve({ code: 127, timedOut: false, stderr: '' });
      return;
    }
    let stderr = '';
    let timedOut = false;
    let finished = false;
    child.stderr?.on?.('data', chunk => { if (stderr.length < 4000) stderr += String(chunk); });
    const kill = sig => {
      try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* 已退出 */ } }
    };
    const timer2 = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), killGraceMs).unref?.();
    }, spec.timeoutMs);
    const done = code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer2);
      resolve({ code, timedOut, stderr });
    };
    child.on('error', () => done(127));
    child.on('close', code => done(code ?? 1));
  });

  const note = (name, id, reason) => {
    const current = load();
    current.failures = current.failures.filter(f => !(f.id === id && f.name === name));
    current.failures.push({ id, name, ts: new Date(now()).toISOString(), reason });
  };

  const runItem = async item => {
    const current = load();
    const { map } = config();
    const spec = map.get(item.name);
    let ticket;
    try {
      ticket = await board.get(item.id);
    } catch {
      current.pending = current.pending.filter(p => p !== item);
      current.done.push(item.key);
      save();
      return;
    }
    const target = launchTarget(ticket, map);
    if (!spec || !target || target.key !== item.key) { // 已经被领走、被改派、配置没了：不用拉起了
      current.pending = current.pending.filter(p => p !== item);
      current.done.push(item.key);
      save();
      return;
    }
    const today = localDay(now(), offset());
    if (current.daily.date !== today) current.daily = { date: today, counts: {} };
    const used = current.daily.counts[item.name] ?? 0;
    if (used >= spec.dailyMax) {
      current.pending = current.pending.filter(p => p !== item);
      current.done.push(item.key);
      note(item.name, item.id, `今天已经叫了 ${used} 次，到上限了`);
      save();
      return;
    }
    current.daily.counts[item.name] = used + 1;
    save();
    const result = await run(spec, item.id);
    let fresh = null;
    try {
      fresh = await board.get(item.id);
    } catch { /* 读不到就当没领 */ }
    const stillWaiting = fresh ? launchTarget(fresh, map)?.key === item.key : false;
    if (result.code === 0 && !result.timedOut) {
      current.pending = current.pending.filter(p => p !== item);
      current.done.push(item.key);
      if (stillWaiting) note(item.name, item.id, '接单器跑完了，但没有领这张卡（可能被它自己的规则拦下）');
      else current.failures = current.failures.filter(f => !(f.id === item.id && f.name === item.name));
      save();
      return;
    }
    const reason = result.timedOut ? `超过 ${Math.round(spec.timeoutMs / 1000)} 秒没跑完`
      : `接单器出错了（退出码 ${result.code}）`;
    if (!stillWaiting) { // 出错退出，但卡已经被领走（做了一半）：不重试，免得重复
      current.pending = current.pending.filter(p => p !== item);
      current.done.push(item.key);
      save();
      return;
    }
    if (item.attempt <= spec.retries) {
      item.attempt += 1;
      item.notBefore = now() + retryDelayMs;
    } else {
      current.pending = current.pending.filter(p => p !== item);
      current.done.push(item.key);
      note(item.name, item.id, reason);
    }
    save();
  };

  // 一次只跑一个：从排队里挑能跑的，依次跑完。
  const pump = () => {
    if (pumping) return pumping;
    const job = (async () => {
      for (;;) {
        if (halted()) return;
        const current = load();
        const item = current.pending.find(p => (p.notBefore ?? 0) <= now());
        if (!item) return;
        try {
          await runItem(item);
        } catch {
          logger.error('HUB_EXT_LAUNCH_FAILURE');
          current.pending = current.pending.filter(p => p !== item);
          current.done.push(item.key);
          save();
        }
      }
    })();
    pumping = job;
    // 先登记再清：整段同步跑完的（没有要拉起的）也不会把「在跑」标记留在那里。
    void job.finally(() => { if (pumping === job) pumping = null; });
    return job;
  };

  return {
    // 看板事件出口调用；不抛错、不阻塞看板。
    onEvent(ev) {
      if (!ev || typeof ev.id !== 'string' || !ev.id || ev.type === 'inbox-failed') return Promise.resolve();
      chain = chain.then(async () => {
        if (await intake(ev.id)) void pump();
      }).catch(() => logger.error('HUB_EXT_LAUNCH_FAILURE'));
      return chain;
    },
    // 启动时：只接着做上次没做完的排队，不去翻看板（旧卡不会因为上线被拉起）。
    resume() {
      void pump();
      return Promise.resolve();
    },
    pump,
    async drain() {
      await chain;
      while (pumping) await pumping;
    },
    start() {
      if (timer || !tickMs) return;
      timer = setInterval(() => { void pump(); }, tickMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await chain;
    },
    pending: () => load().pending.length,
    // 给今天页：还没解决的失败（由今天页再按卡的现状筛）
    failures: () => load().failures.map(f => ({ ...f })),
    configured: () => [...config().map.keys()],
    invalid: () => config().invalid,
  };
}
