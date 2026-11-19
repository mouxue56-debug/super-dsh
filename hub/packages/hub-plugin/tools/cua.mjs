// 操作应用（Cua Driver）的调用处接线。只接线：真正的 MCP 调用由宿主经 deps.cua 递进来。
// 平时没有任何 cua 工具可见；助理开「操作应用」工作会话后，才放开按步骤执行的工具。
// 每次执行前都过 cua-gate：先问就出确认卡，拒绝和停下词一律不执行，拿不到窗口文字就是先问。
// 注意：不能 import ./index.mjs（加载器顶层 await 正在导入本文件，会互等）。【确认状态待核】
import fs from 'node:fs';
import path from 'node:path';
import {gateToolCall, validateConfig, WRITE_ACTIONS} from '../cua-gate.mjs';

// 级别是静态的：能免卡的直走工具 L1，要出卡的走 L3 的同参数工具；放权有效与否由守门在两者里都再判一次。
export const levels = Object.freeze({
  cua_open_work: 'L3',
  cua_close_work: 'L1',
  cua_run_steps: 'L1',
  cua_run_steps_ask: 'L3',
});

// 宿主据此决定哪些 cua 相关工具对当前会话可见：没开工作会话时一个都不放（开会话由宿主按钮或放权助理的请求触发）。
export const VISIBLE_TOOLS = Object.freeze({
  idle: Object.freeze([]),
  idleGranted: Object.freeze(['cua_open_work']),
  working: Object.freeze(['cua_run_steps', 'cua_run_steps_ask', 'cua_close_work']),
});

// run_steps 的 tool 枚举（Cua Driver 0.46.1 说明里的十个），全部在守门的写动作名单里。
const STEP_TOOLS = Object.freeze(['click', 'double_click', 'right_click', 'set_value', 'type_text', 'press_key',
  'hotkey', 'scroll', 'drag', 'move_cursor'].filter(k => WRITE_ACTIONS.includes(k)));
const STEP_KEYS = new Set(['tool', 'args', 'wait_for', 'expect', 'timeout_ms', ...STEP_TOOLS]);
const OBSERVE_KEYS = new Set(['max_elements', 'max_depth', 'include_screenshot', 'query']);
const TOP_KEYS = new Set(['steps', 'app', 'window', 'pid', 'delay_ms', 'delivery_mode', 'foreground_fallback',
  'observe']);
const DEFAULT_EXTERNAL = Object.freeze(['safari', 'google chrome', 'chrome', 'firefox', 'arc', 'microsoft edge',
  'brave browser', 'mail', 'messages', 'slack', 'discord', 'telegram', 'whatsapp', 'line', 'wechat', '微信']);
const MAX_ARGS_CHARS = 20000;
const MAX_OUT_CHARS = 30000;

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const norm = s => String(s).normalize('NFC').trim().toLowerCase().replace(/\.app$/u, '').replace(/\s+/gu, ' ').trim();
const oneLine = (v, n) => Array.from(String(v ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim()).slice(0, n)
  .join('');

// 读一个小的 JSON 配置：普通文件、不是符号链接、别人不可写；不存在返回 undefined。
function readJsonFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (e) {
    if (e.code === 'ENOENT') {
      return undefined;
    }
    throw Error('放权配置读不了');
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > 65536 || (st.mode & 0o022) !== 0) {
      throw Error('放权配置须为普通文件且别人不可写');
    }
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch (e) {
    throw Error(e.message.startsWith('放权配置') ? e.message : '放权配置不是合法 JSON');
  } finally {
    fs.closeSync(fd);
  }
}

// 校验并规整一次按步骤执行的参数：只放行已知键，窗口号、截屏之外的重定向一律拒；返回冻结的深拷贝。
export function normalizeRunSteps(args) {
  if (!plain(args) || JSON.stringify(args).length > MAX_ARGS_CHARS) {
    throw Error('参数无效或过长');
  }
  for (const k of Object.keys(args)) {
    if (!TOP_KEYS.has(k)) {
      throw Error('不支持的参数 ' + k + '（用 app 和 window 标题定位，不用窗口号）');
    }
  }
  if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 64) {
    throw Error('steps 须为 1 到 64 步');
  }
  const steps = args.steps.map((s, i) => {
    if (!plain(s)) {
      throw Error(`第 ${i + 1} 步不是对象`);
    }
    for (const k of Object.keys(s)) {
      if (!STEP_KEYS.has(k)) {
        throw Error(`第 ${i + 1} 步含不支持的键 ${k}（这个工具只做点按输入滚动拖动这类步骤）`);
      }
    }
    const shorts = STEP_TOOLS.filter(k => Object.hasOwn(s, k));
    if (Object.hasOwn(s, 'tool') && (typeof s.tool !== 'string' || !STEP_TOOLS.includes(s.tool) || shorts.length)) {
      throw Error(`第 ${i + 1} 步的 tool 无效，或同时写了简写动作键`);
    }
    if (shorts.length > 1 || shorts.some(k => !plain(s[k]))) {
      throw Error(`第 ${i + 1} 步的动作写法无效`);
    }
    if (Object.hasOwn(s, 'args') && !plain(s.args)) {
      throw Error(`第 ${i + 1} 步的 args 须为对象`);
    }
    for (const a of [s.args, ...shorts.map(k => s[k])]) {
      if (a && (Object.hasOwn(a, 'window_id') || Object.hasOwn(a, 'session'))) {
        throw Error(`第 ${i + 1} 步不能用窗口号或自带会话，改用 app 与 window 标题定位`);
      }
      if (a && Object.hasOwn(a, 'app') && typeof a.app !== 'string') {
        throw Error(`第 ${i + 1} 步的 app 须为字符串`);
      }
    }
    return s;
  });
  for (const k of ['app', 'window', 'delivery_mode']) {
    if (Object.hasOwn(args, k) && typeof args[k] !== 'string') {
      throw Error(k + ' 须为字符串');
    }
  }
  const out = {...args, steps};
  if (Object.hasOwn(args, 'observe')) {
    if (!plain(args.observe) || Object.keys(args.observe).some(k => !OBSERVE_KEYS.has(k))) {
      throw Error('observe 只能带 max_elements、max_depth、include_screenshot、query');
    }
    // 一律整窗读取：只给「变化的行」时，之前就在的登录框会漏过停下词检查。
    out.observe = {...args.observe, since: null};
  }
  return deepFreeze(JSON.parse(JSON.stringify(out)));
}

function deepFreeze(v) {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}

// 这一批动作涉及的应用名（规整后）；有一步没说应用就记一个空串。
function appsOf(args) {
  const apps = new Set();
  const top = typeof args.app === 'string' ? norm(args.app) : '';
  for (const s of args.steps) {
    const a = s.args ?? STEP_TOOLS.map(k => s[k]).find(Boolean) ?? {};
    apps.add(typeof a.app === 'string' ? norm(a.app) : top);
  }
  if (args.observe) {
    apps.add(top);
  }
  return apps;
}

// 给确认卡和留痕用的一句话：应用、动作、目标名、要输入的文字（截短）。
function summarize(args) {
  const top = typeof args.app === 'string' ? args.app : '';
  const parts = args.steps.map(s => {
    const key = typeof s.tool === 'string' ? s.tool : STEP_TOOLS.find(k => Object.hasOwn(s, k));
    const a = (key ? s.args ?? s[key] : null) ?? {};
    const app = typeof a.app === 'string' ? a.app : top;
    const pid = a.pid !== undefined ? ' pid ' + a.pid : '';
    const what = [a.role, a.name, a.text !== undefined ? '“' + oneLine(a.text, 24) + '”' : '',
      a.value !== undefined ? '值“' + oneLine(a.value, 24) + '”' : '', a.key ?? ''].filter(Boolean).join(' ');
    return `${oneLine(app, 30) || '未指定应用'}${pid} ${key ?? '检查'} ${oneLine(what, 60)}`.trim();
  });
  if (args.pid !== undefined) {
    parts.push('默认 pid ' + args.pid);
  }
  return parts.join('；');
}

// 合并取一次 MCP 结果里的文字。
function textOf(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n');
}

// 注册 cua_open_work、cua_close_work、cua_run_steps、cua_run_steps_ask。
export function register(ctx, deps) {
  const cfg = deps.hubConfig?.cua ?? {};
  const hubHome = deps.hubConfig?.hubHome;
  const gateFile = cfg.gate_file ?? (hubHome ? path.join(hubHome, 'config/cua-gate.json') : undefined);
  const dataDir = deps.hubConfig?.data_dir ?? (hubHome ? path.join(hubHome, 'hub-data') : undefined);
  const stopFile = dataDir ? path.join(dataDir, 'panic', 'stopped.flag') : undefined;
  const ttlMs = (Number.isSafeInteger(cfg.work_ttl_minutes) && cfg.work_ttl_minutes >= 1 &&
    cfg.work_ttl_minutes <= 480 ? cfg.work_ttl_minutes : 30) * 60000;
  const textMaxAgeMs = (Number.isSafeInteger(cfg.text_max_age_seconds) && cfg.text_max_age_seconds >= 5 &&
    cfg.text_max_age_seconds <= 600 ? cfg.text_max_age_seconds : 120) * 1000;
  const callTimeoutMs = Number.isSafeInteger(cfg.call_timeout_ms) && cfg.call_timeout_ms >= 1000 &&
    cfg.call_timeout_ms <= 300000 ? cfg.call_timeout_ms : 90000;
  const external = new Set((Array.isArray(cfg.external_apps) ? cfg.external_apps : DEFAULT_EXTERNAL).map(norm));
  const now = () => (typeof deps.now === 'function' ? deps.now() : Date.now());
  // 工作会话只放内存：后端一重启全部作废，要重新开。
  const work = new Map();
  // 同一块屏幕同一时刻只许一个调用在做。
  let queue = Promise.resolve();
  const serial = fn => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  // 已一键全停（标记在，或读不了）就一概不动。
  const stopped = () => {
    if (!stopFile) {
      return true;
    }
    try {
      fs.lstatSync(stopFile);
      return true;
    } catch (e) {
      return e.code !== 'ENOENT';
    }
  };
  const allowedBot = bot => {
    const allow = cfg.allow_bots;
    return Array.isArray(allow) && (allow.includes('*') || allow.includes(bot));
  };
  const gateConfig = () => {
    if (!gateFile) {
      throw Error('放权配置路径没配');
    }
    const checked = validateConfig(readJsonFile(gateFile) ?? {});
    if (!checked.ok) {
      throw Error('放权配置无效，操作应用全部不做：' + oneLine(checked.errors.join('；'), 120));
    }
    return checked.config;
  };
  const session = call => {
    const w = work.get(call.sessionId);
    if (w && (w.expires <= now() || w.bot !== call.bot)) {
      work.delete(call.sessionId);
      return undefined;
    }
    return w;
  };
  const liveExternal = call => {
    const st = deps.state(call.sessionId);
    return !(call.readExternal === false && st?.known === true && st.readExternal === false);
  };
  const str = maxLength => ({type: 'string', maxLength});
  const stepsSchema = {type: 'array', items: {type: 'object'}};
  const runParams = {
    type: 'object',
    properties: {
      steps: stepsSchema,
      app: str(200),
      window: str(200),
      pid: {type: 'integer'},
      delay_ms: {type: 'integer'},
      delivery_mode: {type: 'string', enum: ['background', 'foreground']},
      foreground_fallback: {type: 'boolean'},
      observe: {type: 'object'},
    },
    required: ['steps'],
    additionalProperties: false,
  };

  // 取窗口文字：只用同一个应用、足够新的上一次整窗读取，别的一律不给。
  const windowTextFor = (w, apps) => {
    const t = w.text;
    if (!t || apps.size !== 1 || !apps.has(t.app) || now() - t.at > textMaxAgeMs) {
      return undefined;
    }
    return t.value;
  };

  // 执行一次：先守门，再递给 MCP 客户端；confirmed 为真表示这次已有主人点头，可放行「先问」但不放行拒绝与停下。
  async function runSteps(rawArgs, exec, call, confirmed) {
    if (stopped()) {
      throw Error('已一键全停，操作应用不做');
    }
    const w = session(call);
    if (!w) {
      throw Error('还没开「操作应用」工作会话（或已到期），先用 cua_open_work');
    }
    if (typeof deps.cua?.callTool !== 'function') {
      throw Error('操作应用的通道没接通，不做');
    }
    const args = normalizeRunSteps(rawArgs);
    const config = gateConfig();
    const apps = appsOf(args);
    const verdict = gateToolCall({
      assistant: call.bot,
      toolName: 'run_steps',
      args,
      readExternal: liveExternal(call),
      windowText: windowTextFor(w, apps),
    }, config, now());
    if (verdict.decision === 'stop') {
      work.delete(call.sessionId);
      throw Error('停下，交给主人：' + verdict.reason + '。已结束工作会话，不要自己换办法继续');
    }
    if (verdict.decision === 'deny') {
      throw Error('不做：' + verdict.reason);
    }
    if (verdict.decision === 'ask' && !confirmed) {
      throw Error('要先问主人：' + verdict.reason + '。用 cua_run_steps_ask 原样再交一次，主人会看到确认卡；不要换说法绕开');
    }
    const note = summarize(args);
    deps.log?.({target: `${confirmed ? '已批准' : '放权'} ${verdict.rule}: ${note}`});
    // 参数就是刚才过守门的那一份冻结对象，不再重建。
    const signal = AbortSignal.any([exec?.signal, AbortSignal.timeout(callTimeoutMs)].filter(Boolean));
    let result;
    try {
      result = await deps.cua.callTool('run_steps', args, {signal});
    } catch (e) {
      w.text = null;
      throw Error('操作应用没成功（不知道做到哪一步，先别重复，请读一下窗口再说）：' + oneLine(e?.message, 120));
    }
    const text = textOf(result);
    if (result?.isError === true) {
      w.text = null;
      throw Error('驱动报错：' + oneLine(text, 300));
    }
    return after(w, call, args, apps, text, config);
  }

  // 做完以后：记下新的窗口文字，读过外部应用就标「读过外部内容」，结果里出现停下词就结束会话。
  function after(w, call, args, apps, text, config) {
    w.text = null;
    if (args.observe && apps.size === 1) {
      const app = [...apps][0];
      w.text = {app, value: text, at: now()};
      if (!app || external.has(app)) {
        deps.state(call.sessionId).markExternalRead?.();
      }
      const app0 = typeof args.app === 'string' ? args.app : null;
      const seen = gateToolCall({assistant: call.bot, toolName: 'get_window_state', args: app0 ? {app: app0} : {},
        readExternal: false, windowText: text}, config, now());
      if (seen.decision === 'stop' || seen.rule === 'protected') {
        work.delete(call.sessionId);
        return `【停下】${seen.reason}。已结束工作会话；这一步之后不要再操作，请把情况告诉主人。`;
      }
    }
    return text.length > MAX_OUT_CHARS ? text.slice(0, MAX_OUT_CHARS) + '\n（太长，已截断）' : text || '（驱动没有返回文字）';
  }

  const card = (action, args, info) => {
    let preview;
    try {
      preview = summarize(normalizeRunSteps(args));
    } catch (e) {
      return {action: '这条会被拒', preview: oneLine(e.message, 150), why: ''};
    }
    return {
      action: info?.readExternal === true ? action + '（本轮读过外部内容）' : action,
      preview,
      why: '主人点头后才执行；点头只管这一次，不会自动放权',
    };
  };

  ctx.tools.register({
    name: 'cua_open_work',
    description: '开一个「操作应用」工作会话（要请主人点头）：开了以后才能用 cua_run_steps 点按、输入、滚动应用窗口。'
      + '只在主人明确要你操作某个应用时用；用完 cua_close_work 关掉。',
    parameters: {
      type: 'object',
      properties: {app: str(80), reason: str(200)},
      required: [],
      additionalProperties: false,
    },
    approvalCard(args) {
      const app = oneLine(args?.app, 40);
      return {action: '开「操作应用」工作会话', preview: app ? `准备操作 ${app}` : '准备操作应用',
        why: oneLine(args?.reason, 150) || '开了以后每一步还要过守门，首次碰的应用另有确认卡'};
    },
    async execute(args, _exec, call) {
      if (stopped()) {
        throw Error('已一键全停，操作应用不做');
      }
      if (!allowedBot(call.bot)) {
        throw Error('你没有操作应用的权限');
      }
      await deps.askApproval({action: '开「操作应用」工作会话'});
      if (typeof deps.cua?.callTool !== 'function') {
        throw Error('操作应用的通道没接通，不做');
      }
      const config = gateConfig();
      if (typeof args.app === 'string' && config.protectedApps.includes(norm(args.app))) {
        throw Error('这个应用受保护，不能操作');
      }
      work.set(call.sessionId, {bot: call.bot, expires: now() + ttlMs, text: null});
      return `已开工作会话，${Math.round(ttlMs / 60000)} 分钟内有效。用 cua_run_steps 做步骤；`
        + '被说「要先问」时改用 cua_run_steps_ask；遇到登录、验证码、付款就停下交给主人。';
    },
  });

  ctx.tools.register({
    name: 'cua_close_work',
    description: '关掉「操作应用」工作会话。做完就关。',
    parameters: {type: 'object', properties: {}, required: [], additionalProperties: false},
    async execute(_args, _exec, call) {
      const had = work.delete(call.sessionId);
      return had ? '已关闭操作应用工作会话' : '本来就没有开着的操作应用工作会话';
    },
  });

  const runDescription = '按顺序在应用窗口里做若干步（点按、输入、滚动等），遇错即停，可带 observe 读最后的窗口。'
    + '每步写 {tool, args} 或 {动作名: args}，args 里用 app、window 标题、role、name 定位；不要用窗口号。'
    + '每次都会过守门：登录、验证码、付款字样出现就停；首次碰的应用要先问主人。';

  ctx.tools.register({
    name: 'cua_run_steps',
    description: runDescription + '放权有效的应用直接做；被说「要先问」就改用 cua_run_steps_ask。',
    parameters: runParams,
    execute: (args, exec, call) => serial(() => runSteps(args, exec, call, false)),
  });

  ctx.tools.register({
    name: 'cua_run_steps_ask',
    description: runDescription + '这个版本会先给主人出确认卡，点头才做；参数与 cua_run_steps 完全相同。',
    parameters: runParams,
    approvalCard: (args, info) => card('操作应用', args, info),
    async execute(args, exec, call) {
      await deps.askApproval({action: '操作应用'});
      return serial(() => runSteps(args, exec, call, true));
    },
  });
}
