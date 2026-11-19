export const DECISIONS = Object.freeze({ ALLOW: 'allow', ASK: 'ask', DENY: 'deny', STOP: 'stop' });
export const READ_ACTIONS = Object.freeze([
  'list_apps',
  'list_windows',
  'get_window_state',
  'get_desktop_state',
  'get_screen_size',
  'get_accessibility_tree',
  'get_cursor_position',
  'get_browser_state',
  'verify_state',
  'zoom',
  'check_permissions',
  'get_guide',
  'health_report',
  'parse_visual_regions',
  'get_agent_cursor_state',
  'get_recording_state',
  'get_config',
]);
export const META_ACTIONS = Object.freeze([
  'start_session',
  'end_session',
  'escalate_session',
  'get_session',
  'get_session_state',
  'list_sessions',
  'set_agent_cursor_enabled',
  'set_agent_cursor_motion',
  'set_agent_cursor_theme',
]);
export const WRITE_ACTIONS = Object.freeze([
  'click',
  'double_click',
  'right_click',
  'drag',
  'scroll',
  'type_text',
  'set_value',
  'press_key',
  'hotkey',
  'invoke_menu',
  'move_cursor',
  'launch_app',
  'bring_to_front',
  'set_window_frame',
  'browser_click',
  'browser_type',
  'browser_pointer',
  'browser_select',
  'browser_navigate',
  'browser_dialog',
  'page',
]);
export const ALWAYS_ASK_ACTIONS = Object.freeze([
  'kill_app',
  'clipboard_read',
  'clipboard_write',
  'browser_download',
  'browser_set_input_files',
  'browser_prepare',
]);
export const ADMIN_ACTIONS = Object.freeze([
  'set_config',
  'install_extension',
  'install_ffmpeg',
  'check_for_update',
  'replay_trajectory',
  'start_recording',
  'stop_recording',
  'run_script',
]);
// 默认停下词（中英日），命中即停下交主人；刻意不收 otp 这类短缩写，避免 footprint 之类的误中。
export const DEFAULT_STOP_WORDS = Object.freeze([
  '登录',
  '登入',
  '验证码',
  '校验码',
  '两步验证',
  '二次验证',
  '双重验证',
  '短信验证',
  '密码',
  '密碼',
  '登錄',
  '驗證碼',
  '暗証番号',
  '付款',
  '支付',
  '收银台',
  '信用卡',
  '银行卡',
  'login',
  'log in',
  'sign in',
  'signin',
  'password',
  'passwd',
  'passcode',
  'captcha',
  'verification code',
  'security code',
  'two-factor',
  'two-step',
  '2-step',
  '2-factor',
  '2fa',
  'mfa',
  'multi-factor',
  'one-time code',
  'payment',
  'checkout',
  'credit card',
  'ログイン',
  'サインイン',
  'パスワード',
  'パスコード',
  '二要素認証',
  '認証コード',
  '二段階認証',
  'お支払い',
]);
const validated = new WeakSet();
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;
const normName = (s) =>
  s.normalize('NFC').trim().toLowerCase().replace(/\.app$/, '').replace(/\s+/gu, ' ').trim();
// 全角转半角、去零宽字符，避免拿它们绕过停下词。
const normText = (s) => s.normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff]/gu, '').toLowerCase();
const freeze = (v) => {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};

// 分类只承认列出的动作；其余全部按未知处理。
export function classifyAction(action) {
  for (
    const [kind, list] of [['read', READ_ACTIONS], ['meta', META_ACTIONS], ['write', WRITE_ACTIONS], [
      'always_ask',
      ALWAYS_ASK_ACTIONS,
    ], ['admin', ADMIN_ACTIONS]]
  ) if (list.includes(action))
    return kind;
  return 'unknown';
}

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s))
    return false;
  const d = new Date(s + 'T00:00:00.000Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// 配置必须完整校验，复制并冻结，只有本模块签发的对象可用于判定。
export function validateConfig(raw) {
  const errors = [];
  if (!object(raw))
    return { ok: false, errors: ['配置必须是对象'], config: null };
  const keys = [
    'grants',
    'readOnlyWithoutAsk',
    'protectedApps',
    'protectedProfiles',
    'stopWords',
    'utcOffsetMinutes',
  ];
  for (const key of Object.keys(raw)) if (!keys.includes(key))
    errors.push(`未知配置项：${key}`);
  const grants = raw.grants === undefined ? [] : raw.grants;
  if (!Array.isArray(grants))
    errors.push('grants 必须是数组');
  else {
    grants.forEach((g, i) => {
      if (
        !object(g) || !nonempty(g.assistant) || !nonempty(g.app) || !validDate(g.until) ||
        (nonempty(g.app) && !normName(g.app))
      )
        errors.push(`grants 第 ${i + 1} 项的助理、应用或日期无效`);
    });
  }
  const bool = raw.readOnlyWithoutAsk === undefined ? false : raw.readOnlyWithoutAsk;
  if (typeof bool !== 'boolean')
    errors.push('readOnlyWithoutAsk 必须是布尔值');
  const lists = {};
  for (const key of ['protectedApps', 'protectedProfiles', 'stopWords']) {
    const value = raw[key] === undefined ? [] : raw[key];
    if (!Array.isArray(value) || value.some((x) => !nonempty(x) || (key !== 'stopWords' && !normName(x)))) {
      errors.push(`${key} 必须是非空字符串数组`);
    } else
      lists[key] = value.map((x) => key === 'stopWords' ? normText(x.trim()) : normName(x));
  }
  const offset = raw.utcOffsetMinutes === undefined ? 0 : raw.utcOffsetMinutes;
  if (!Number.isInteger(offset) || offset < -720 || offset > 840) {
    errors.push('utcOffsetMinutes 必须是 -720 到 840 的整数');
  }
  if (errors.length)
    return { ok: false, errors, config: null };
  const config = freeze({
    grants: grants.map((g) => ({ assistant: g.assistant, app: normName(g.app), until: g.until })),
    readOnlyWithoutAsk: bool,
    ...lists,
    utcOffsetMinutes: offset,
  });
  validated.add(config);
  return { ok: true, errors: [], config };
}

// 一次判定按输入、动作、保护、停下、询问、外部内容和放权的顺序执行。
export function gate(request, config, now) {
  const r = object(request) ? request : {};
  const { assistant, action } = r;
  const app = typeof r.app === 'string' && r.app.trim() ? r.app : null;
  const kind = classifyAction(action);
  const label = `${app || '未指定应用'} 的 ${typeof action === 'string' && action ? action : '未指定动作'}`
    .replace(/[\r\n]/g, ' ').slice(0, 25);
  const result = (decision, rule, reason) => ({
    decision,
    log: decision === 'allow' && kind !== 'meta',
    reason: `${label}：${reason}`.slice(0, 60),
    rule,
    assistant,
    app,
    action,
    kind,
  });
  if (
    !object(request) || !nonempty(assistant) || !nonempty(action) ||
    !(r.app == null || typeof r.app === 'string') || !(r.profile == null || typeof r.profile === 'string') ||
    !(r.windowText == null || typeof r.windowText === 'string' ||
      (Array.isArray(r.windowText) && r.windowText.every((x) => typeof x === 'string')))
  )
    return result('deny', 'bad-input', '输入不合法，先拒绝');
  if (!object(config) || !validated.has(config))
    return result('deny', 'bad-config', '配置未经校验，先拒绝');
  const ms = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : NaN;
  const local = new Date(ms + config.utcOffsetMinutes * 60000);
  if (!Number.isFinite(ms) || !Number.isFinite(local.getTime())) {
    return result('deny', 'bad-time', '缺少可信时间，先拒绝');
  }
  if (kind === 'unknown')
    return result('deny', 'unknown-action', '未知动作，拒绝');
  const pidApp = typeof r.pidApp === 'string' && r.pidApp.trim() ? r.pidApp : null;
  // 应用名和进程号同时给出却对不上，按冒名处理直接拒。
  if (app && pidApp && normName(app) !== normName(pidApp))
    return result('deny', 'app-pid-mismatch', '应用名与进程号对不上，拒绝');
  if (kind === 'admin')
    return result('deny', 'admin-action', '管理动作，拒绝');
  const text = normText(Array.isArray(r.windowText) ? r.windowText.join(' ') : r.windowText || '');
  if (
    (app && config.protectedApps.includes(normName(app))) ||
    (pidApp && config.protectedApps.includes(normName(pidApp))) ||
    (r.profile && config.protectedProfiles.includes(normName(r.profile))) ||
    config.protectedProfiles.some((p) => normName(text).includes(p))
  )
    return result('deny', 'protected', '受保护，拒绝');
  // 纯英文词按单词边界匹配（design in、catalog in 不算 sign in、log in），中日文按子串匹配。
  // 词内的空格、连字符、下划线都可有可无（sign in、sign-in、signin 同一个词）。
  const hit = (w) => {
    const t = normText(w);
    if (!/^[\x00-\x7f]+$/.test(t))
      return text.includes(t);
    const parts = t.split(/[\s\-_]+/).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp('(^|[^a-z0-9])' + parts.join('[\\s\\-_]*') + '($|[^a-z0-9])').test(text);
  };
  const word = [...DEFAULT_STOP_WORDS, ...config.stopWords].find(hit);
  if (word) {
    return result(
      'stop',
      'stop-word',
      `出现了「${word.slice(0, 12)}」字样（登录、验证码、两步验证或付款相关），先停下交给主人`,
    );
  }
  if (kind === 'always_ask')
    return result('ask', 'always-ask', '此动作须先问');
  if (kind !== 'meta' && r.readExternal !== false) {
    return result('ask', 'external-content', '这一轮读过外部内容，改为先问');
  }
  if (kind === 'meta')
    return result('allow', 'meta', '会话动作允许');
  // 给了进程号却认不出是哪个应用，保护名单查不了，先问。
  if (r.pidGiven === true && !pidApp)
    return result('ask', 'no-app', '进程号认不出对应应用，先问');
  // 会改东西的动作拿不到窗口文字就无从检查停下词，降为先问。
  if (kind === 'write' && !text.trim())
    return result('ask', 'no-window-text', '拿不到窗口文字，改为先问');
  if (kind === 'read' && config.readOnlyWithoutAsk)
    return result('allow', 'read-free', '只读动作允许并留痕');
  if (!app || !normName(app))
    return result('ask', 'no-app', '没说清要对哪个应用');
  const matches = config.grants.filter((g) => g.assistant === assistant && g.app === normName(app));
  const date = local.toISOString().slice(0, 10);
  if (matches.some((g) => g.until >= date)) {
    return result('allow', kind === 'read' ? 'granted-read' : 'granted', '放权有效，允许并留痕');
  }
  if (matches.length) {
    return result(
      'ask',
      'grant-expired',
      `放权已于 ${matches.map((g) => g.until).sort().at(-1)} 到期`,
    );
  }
  return result(
    'ask',
    kind === 'read' ? 'read-ungranted' : 'first-touch',
    '这是第一次碰该应用，需要主人先点头',
  );
}

// 工具名前缀只剥离一次；单步和批量均复用同一判定。
export function gateToolCall(call, config, now) {
  const c = object(call) ? call : {};
  const name = typeof c.toolName === 'string' ? c.toolName.replace(/^mcp__(.+?)__(.+)$/, '$2') : c.toolName;
  const args = object(c.args) ? c.args : {};
  const hasPid = (pid) => typeof pid === 'string' || typeof pid === 'number';
  const pidApp = (pid) =>
    object(c.pidApps) && hasPid(pid) && Object.hasOwn(c.pidApps, pid) && typeof c.pidApps[pid] === 'string'
      ? c.pidApps[pid]
      : null;
  // app 与 pid 同时带上时都传给判定，由 gate 核对是否一致；只有 pid 时用它查到的应用名。
  const request = (action, app, pid) => ({
    assistant: c.assistant,
    app: app ?? pidApp(pid),
    pidApp: pidApp(pid),
    pidGiven: pid != null,
    action,
    readExternal: c.readExternal,
    windowText: c.windowText,
    profile: c.profile,
  });
  if (name !== 'run_steps') {
    const app = typeof args.app === 'string'
      ? args.app
      : name === 'launch_app' && typeof args.name === 'string'
      ? args.name
      : name === 'launch_app' && typeof args.bundle_id === 'string'
      ? args.bundle_id
      : null;
    const item = gate(request(name, app, args.pid), config, now);
    return { ...item, items: [item] };
  }
  if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 64) {
    return {
      decision: 'deny',
      log: false,
      reason: '步骤格式不对或超过 64 步',
      rule: 'bad-steps',
      assistant: c.assistant,
      action: name,
      items: [],
    };
  }
  // 简写仅接受写动作，等待或期望单独出现时视为读取检查；一步里出现两个动作键直接拒。
  const items = args.steps.map((step, index) => {
    const s = object(step) ? step : {};
    const keys = Object.keys(s);
    const actionKeys = keys.filter((k) => classifyAction(k) !== 'unknown');
    const short = typeof s.tool !== 'string' ? keys.find((k) => WRITE_ACTIONS.includes(k)) : null;
    const action = typeof s.tool === 'string'
      ? s.tool
      : short || (keys.length > 0 && keys.every((k) => k === 'wait_for' || k === 'expect')
        ? 'verify_state'
        : '__unknown__');
    const sa = short && object(s[short]) ? s[short] : object(s.args) ? s.args : {};
    const app = typeof sa.app === 'string' ? sa.app : typeof args.app === 'string' ? args.app : null;
    const item = { ...gate(request(action, app, sa.pid ?? s.pid ?? args.pid), config, now), index };
    if (actionKeys.length > (typeof s.tool === 'string' ? 0 : 1)) {
      return { ...item, decision: 'deny', log: false, rule: 'multi-action', reason: '一步里带了多个动作键，拒绝' };
    }
    return item;
  });
  if (object(args.observe)) {
    items.push({
      ...gate(request('get_window_state', typeof args.app === 'string' ? args.app : null, args.pid), config, now),
      index: items.length,
    });
  }
  // 批量按最严格结果汇总；只有全部允许才可留痕。
  const rank = { allow: 0, ask: 1, deny: 2, stop: 3 };
  const worst = items.reduce((a, b) => rank[b.decision] > rank[a.decision] ? b : a);
  return {
    decision: worst.decision,
    log: worst.decision === 'allow' && items.some((x) => x.log),
    reason: worst.reason,
    rule: worst.rule,
    assistant: c.assistant,
    action: name,
    items,
  };
}
