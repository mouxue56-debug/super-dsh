// 一键全停的核心。不含任何具体子系统；子系统以「适配器」传入，便于逐个测试。
// 原则：停机必须如实。每一步各自记成 ok / absent / failed，只有全部 ok 或 absent 才算「全停」。
// 停机状态落盘（state.json）并另写一个停机标记文件（stopped.flag），后端重启后仍是停的；恢复必须显式调用。
//
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// 暂定默认值（均可由配置覆盖；不是预算上限）。
export const PANIC_DEFAULTS = Object.freeze({
  stepTimeoutMs: 10000,
  verifyWaitMs: 3000,
  verifyPollMs: 200,
  reapplyDelayMs: 1000,
  timers: Object.freeze(['meetings', 'groups', 'routines']),
});

const OK = new Set(['ok', 'absent']);
const MODULE_NAME = /^[a-z][a-z0-9-]{0,31}$/u;

function positiveInt(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

// 把配置段（可能缺失或带坏值）规整成完整配置，坏值回落到暂定默认值。
export function resolvePanicConfig(section) {
  const s = section && typeof section === 'object' && !Array.isArray(section) ? section : {};
  const timers = Array.isArray(s.timers) ?
    s.timers.filter(name => typeof name === 'string' && MODULE_NAME.test(name) &&
      name !== 'panic' && name !== 'index') :
    [...PANIC_DEFAULTS.timers];
  return {
    stepTimeoutMs: positiveInt(s.stepTimeoutMs, PANIC_DEFAULTS.stepTimeoutMs),
    verifyWaitMs: positiveInt(s.verifyWaitMs, PANIC_DEFAULTS.verifyWaitMs),
    verifyPollMs: positiveInt(s.verifyPollMs, PANIC_DEFAULTS.verifyPollMs),
    reapplyDelayMs: positiveInt(s.reapplyDelayMs, PANIC_DEFAULTS.reapplyDelayMs),
    timers: [...new Set(timers)],
  };
}

function detailOf(error) {
  return String(error?.message ?? error ?? '失败').replace(/[\r\n]+/gu, ' ').slice(0, 200);
}

function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('超时 ' + ms + 'ms')), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomBytes(6).toString('hex');
  fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}

// 读停机标记文件的最小判断：只看文件在不在。插件那一侧也应这样判断；读不了（非「不存在」）按已停处理。
export function markerPresent(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    return error.code === 'ENOENT' ? false : true;
  }
}

// 创建一键全停控制器。dir 是状态目录；adapters 是 [{name, stop(ctx), resume(ctx)}]，返回 {status, detail}，抛错即失败。
export function createPanic({ dir, adapters = [], now = Date.now, stepTimeoutMs = PANIC_DEFAULTS.stepTimeoutMs,
  logger = console }) {
  const stateFile = path.join(dir, 'state.json');
  const markerFile = path.join(dir, 'stopped.flag');
  const names = ['marker', 'state', ...adapters.map(item => item.name)];
  let state = loadState();
  let chain = Promise.resolve();

  function blank() {
    return { version: 1, stopped: false, steps: {}, resumeSteps: {} };
  }

  function loadState() {
    let loaded;
    try {
      loaded = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) throw new Error('bad');
      loaded = { ...blank(), ...loaded };
    } catch (error) {
      // 文件不存在是正常的「从未停过」；存在但读不了，按已停处理（宁停勿放）。
      loaded = error.code === 'ENOENT' ? blank() :
        { ...blank(), stopped: true, corrupt: true, reason: '状态文件读不了，按已停处理' };
    }
    if (!loaded.stopped && markerPresent(markerFile)) {
      loaded = { ...loaded, stopped: true, reason: loaded.reason ?? '发现停机标记文件，按已停处理' };
    }
    return loaded;
  }

  function persist() {
    atomicWrite(stateFile, JSON.stringify(state));
  }

  function record(map, name, status, detail) {
    map[name] = { status, detail, at: now() };
  }

  function complete() {
    return state.stopped && names.every(name => OK.has(state.steps[name]?.status));
  }

  function view() {
    const stopped = state.stopped || markerPresent(markerFile);
    const done = stopped && state.stopped && complete();
    return {
      ok: stopped ? done : true,
      state: stopped ? (done ? 'stopped' : 'partial') : 'running',
      since: state.stopped ? state.since : undefined,
      reason: state.stopped ? state.reason : undefined,
      steps: state.steps,
      resumeSteps: state.resumeSteps,
      marker: markerPresent(markerFile),
      ...(state.lastResumeAt ? { lastResumeAt: state.lastResumeAt } : {}),
    };
  }

  async function runStep(map, name, fn) {
    try {
      const result = await withTimeout(Promise.resolve().then(fn), stepTimeoutMs);
      const status = result?.status === 'absent' ? 'absent' : 'ok';
      record(map, name, status, String(result?.detail ?? ''));
    } catch (error) {
      record(map, name, 'failed', detailOf(error));
      try {
        logger.error?.('HUB_PANIC_STEP_FAILURE ' + name);
      } catch {
      }
    }
  }

  async function doStop(reason) {
    if (!state.stopped) {
      state = { ...blank(), stopped: true, since: now(), reason: String(reason ?? '').slice(0, 200) };
    } else {
      state = { ...state, steps: {} };
    }
    // 先写标记文件：从这一刻起新的工具调用就该被拒。
    try {
      atomicWrite(markerFile, JSON.stringify({ stopped: true, since: state.since }));
      record(state.steps, 'marker', 'ok', '停机标记文件已写');
    } catch (error) {
      record(state.steps, 'marker', 'failed', detailOf(error));
    }
    try {
      persist();
      record(state.steps, 'state', 'ok', '停机状态已落盘');
    } catch (error) {
      record(state.steps, 'state', 'failed', detailOf(error));
    }
    for (const adapter of adapters) {
      await runStep(state.steps, adapter.name, () => adapter.stop({ now }));
    }
    try {
      persist();
    } catch (error) {
      record(state.steps, 'state', 'failed', detailOf(error));
    }
    return view();
  }

  async function doResume() {
    if (!state.stopped && !markerPresent(markerFile)) return { ...view(), noop: true };
    try {
      fs.rmSync(markerFile, { force: true });
    } catch (error) {
      return { ...view(), ok: false, error: '停机标记文件删不掉：' + detailOf(error) };
    }
    const before = state;
    state = { ...blank(), lastStopSteps: before.steps, since: before.since, lastResumeAt: now() };
    try {
      persist();
    } catch (error) {
      state = before;
      try {
        atomicWrite(markerFile, JSON.stringify({ stopped: true, since: state.since }));
      } catch {
      }
      return { ...view(), ok: false, error: '恢复状态写不进磁盘，仍保持停机：' + detailOf(error) };
    }
    for (const adapter of adapters) {
      if (typeof adapter.resume !== 'function') continue;
      await runStep(state.resumeSteps, adapter.name, () => adapter.resume({ now }));
    }
    const failed = Object.values(state.resumeSteps).some(step => step.status === 'failed');
    return { ...view(), ok: !failed };
  }

  function serial(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  }

  return {
    markerFile,
    stateFile,
    // 当前是否处于停机（内存状态或标记文件任一为真）。同步、很便宜，可放在每次调用的闸门里。
    isStopped: () => state.stopped || markerPresent(markerFile),
    // 停机：重复调用会把所有步骤重新做一遍（失败的步骤得到重试）。
    stop: reason => serial(() => doStop(reason)),
    // 显式恢复。
    resume: () => serial(doResume),
    // 当前状态。
    status: view,
    // 后端重启后若仍是停机状态，把各步骤重做一遍（让重启时被重新拉起的定时器再停下）。
    reapply: () => serial(() => (state.stopped || markerPresent(markerFile) ? doStop(state.reason) : view())),
  };
}
