import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DECISIONS,
  READ_ACTIONS,
  META_ACTIONS,
  WRITE_ACTIONS,
  ALWAYS_ASK_ACTIONS,
  ADMIN_ACTIONS,
  DEFAULT_STOP_WORDS,
  classifyAction,
  validateConfig,
  gate,
  gateToolCall,
} from '../cua-gate.mjs';
const time = Date.parse('2026-11-17T12:00:00Z');
const cfg = (raw) => {
  const v = validateConfig(raw);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return v.config;
};
const req = (action = 'click', extra = {}) => ({
  assistant: 'a1',
  app: 'AppX',
  action,
  readExternal: false,
  windowText: '正常窗口',
  ...extra,
});
const grant = { assistant: 'a1', app: 'AppX', until: '2026-11-17' };
const call = (toolName, args = {}, extra = {}) => ({
  assistant: 'a1',
  toolName,
  args,
  readExternal: false,
  windowText: '正常窗口',
  ...extra,
});

test('动作分类与冻结常量', () => {
  for (
    const [kind, list] of [['read', READ_ACTIONS], ['meta', META_ACTIONS], ['write', WRITE_ACTIONS], [
      'always_ask',
      ALWAYS_ASK_ACTIONS,
    ], ['admin', ADMIN_ACTIONS]]
  ) {
    assert.ok(list.length >= 3);
    for (const name of list)
      assert.equal(classifyAction(name), kind);
    assert.ok(Object.isFrozen(list));
  }
  for (const v of ['missing', '', 3])
    assert.equal(classifyAction(v), 'unknown');
  assert.ok(Object.isFrozen(DEFAULT_STOP_WORDS));
  assert.ok(Object.isFrozen(DECISIONS));
});

test('默认首次询问、只读豁免和会话动作', () => {
  assert.equal(gate(req(), cfg({}), time).rule, 'first-touch');
  assert.equal(gate(req('get_window_state'), cfg({}), time).rule, 'read-ungranted');
  const read = gate(req('get_window_state'), cfg({ readOnlyWithoutAsk: true }), time);
  assert.equal(read.decision, 'allow');
  assert.equal(read.log, true);
  const meta = gate(req('start_session'), cfg({}), time);
  assert.equal(meta.decision, 'allow');
  assert.equal(meta.log, false);
});

test('放权匹配身份、应用、规范化和日期', () => {
  const c = cfg({ grants: [grant, { assistant: 'a1', app: 'Café.app', until: '2026-11-17' }] });
  let r = gate(req(), c, time);
  assert.equal(r.rule, 'granted');
  assert.equal(r.log, true);
  assert.equal(gate(req('click', { assistant: 'a2' }), c, time).rule, 'first-touch');
  assert.equal(gate(req('click', { app: 'AppY' }), c, time).rule, 'first-touch');
  assert.equal(gate(req('click', { app: '  APPX.APP  ' }), c, time).decision, 'allow');
  assert.equal(gate(req('click', { app: 'Cafe\u0301.APP' }), c, time).decision, 'allow');
  assert.equal(gate(req('get_window_state'), c, time).rule, 'granted-read');
  assert.equal(gate(req(), c, Date.parse('2026-11-18T00:00:00Z')).rule, 'grant-expired');
  assert.equal(
    gate(req(), cfg({ grants: [grant], utcOffsetMinutes: 540 }), Date.parse('2026-11-17T23:30:00Z')).rule,
    'grant-expired',
  );
});

test('特殊动作无论放权和只读豁免都先询问', () => {
  const c = cfg({ grants: [grant], readOnlyWithoutAsk: true });
  for (const a of ['kill_app', 'clipboard_read', 'browser_download', 'browser_set_input_files']) {
    assert.equal(gate(req(a), c, time).rule, 'always-ask');
  }
});

test('停下词对读取和放权均生效并优先询问', () => {
  const c = cfg({ grants: [grant], stopWords: ['危险词'] });
  for (const w of ['登录', '验证码', '两步验证', '付款', 'login', 'CAPTCHA', 'Verification Code', '危险词']) {
    const r = gate(req('get_window_state', { windowText: ['正常', w] }), c, time);
    assert.equal(r.rule, 'stop-word');
    assert.equal(r.decision, 'stop');
    assert.ok(!r.reason.includes('\n'));
    assert.ok(r.reason.length <= 60);
  }
  assert.equal(gate(req('kill_app', { windowText: '登录', readExternal: true }), c, time).decision, 'stop');
});

test('应用及配置保护优先于停下和放权', () => {
  const c = cfg({ grants: [grant], protectedApps: ['appx.app'], protectedProfiles: ['Profile A'] });
  assert.equal(gate(req('click', { app: 'APPX.APP', windowText: '登录' }), c, time).rule, 'protected');
  assert.equal(gate(req('click', { app: 'AppY', profile: 'PROFILE A.app' }), c, time).rule, 'protected');
  assert.equal(
    gate(req('click', { app: 'AppY', windowText: '当前 profile a 登录' }), c, time).rule,
    'protected',
  );
});

test('外部内容升级询问但会话动作例外', () => {
  const c = cfg({ grants: [grant], readOnlyWithoutAsk: true });
  for (const v of [true, undefined, 'false', 1]) {
    assert.equal(gate(req('click', { readExternal: v }), c, time).rule, 'external-content');
  }
  assert.equal(gate(req('get_window_state', { readExternal: true }), c, time).rule, 'external-content');
  assert.equal(gate(req('start_session', { readExternal: true }), c, time).rule, 'meta');
});

test('管理动作、未知动作与无效输入失败关闭', () => {
  const c = cfg({});
  for (const a of ['run_script', 'set_config'])
    assert.equal(gate(req(a), c, time).rule, 'admin-action');
  assert.equal(gate(req('something'), c, time).rule, 'unknown-action');
  for (const t of [undefined, NaN, '2026-11-17', new Date(NaN)]) {
    assert.equal(gate(req(), c, t).rule, 'bad-time');
  }
  assert.equal(gate(req(), {}, time).rule, 'bad-config');
  assert.equal(gate(req('click', { assistant: '' }), c, time).rule, 'bad-input');
  assert.equal(gate(req('', {}), c, time).rule, 'bad-input');
});

test('配置默认值、错误及递归冻结', () => {
  const c = cfg({});
  assert.deepEqual(c.grants, []);
  assert.equal(c.readOnlyWithoutAsk, false);
  assert.equal(c.utcOffsetMinutes, 0);
  for (
    const raw of [
      null,
      { grants: [{ ...grant, until: '2026-02-30' }] },
      { grants: [{ assistant: 'a1', app: 'AppX' }] },
      { grant: [] },
      { readOnlyWithoutAsk: 'true' },
      { protectedApps: [1] },
      { utcOffsetMinutes: 841 },
    ]
  ) {
    const v = validateConfig(raw);
    assert.equal(v.ok, false);
    assert.equal(v.config, null);
    assert.ok(v.errors.length);
  }
  const full = cfg({ grants: [grant], protectedApps: ['AppY'] });
  assert.ok(Object.isFrozen(full));
  assert.ok(Object.isFrozen(full.grants));
  assert.ok(Object.isFrozen(full.grants[0]));
  assert.throws(() => {
    full.grants[0].app = 'AppY';
  }, TypeError);
});

test('单次工具名前缀和进程映射', () => {
  const c = cfg({ grants: [grant] });
  let r = gateToolCall(call('mcp__cua-driver-mcp__click', { pid: 7 }, { pidApps: { 7: 'AppX' } }), c, time);
  assert.equal(r.rule, 'granted');
  assert.equal(r.action, 'click');
  assert.equal(r.items.length, 1);
  r = gateToolCall(call('mcp__x__get_window_state', { app: 'AppX' }), c, time);
  assert.equal(r.action, 'get_window_state');
  assert.equal(r.rule, 'granted-read');
  r = gateToolCall(call('click', { pid: 7 }), c, time);
  assert.equal(r.app, null);
  assert.equal(r.rule, 'no-app');
  assert.equal(gateToolCall(call('launch_app', { name: 'AppX' }), c, time).rule, 'granted');
});

test('批量步骤识别并选取最严格结果', () => {
  const c = cfg({ grants: [grant] });
  const r = gateToolCall(
    call('run_steps', {
      steps: [{ tool: 'click', args: { app: 'AppX' } }, { kill_app: {} }, { click: { app: 'AppY' } }],
    }),
    c,
    time,
  );
  assert.deepEqual(r.items.map((x) => x.decision), ['allow', 'deny', 'ask']);
  assert.equal(r.decision, 'deny');
  assert.equal(r.items[1].action, '__unknown__');
  assert.deepEqual(r.items.map((x) => x.index), [0, 1, 2]);
  for (const steps of [[], {}, Array(65).fill({ click: {} })]) {
    assert.equal(gateToolCall(call('run_steps', { steps }), c, time).rule, 'bad-steps');
  }
});

test('简写、等待、观察和全部允许的批量步骤', () => {
  const c = cfg({ grants: [grant] });
  const r = gateToolCall(
    call('run_steps', {
      app: 'AppX',
      steps: [{ click: {} }, { tool: 'click', args: { app: 'AppX' } }, { wait_for: 'ready', expect: 'ok' }],
      observe: {},
    }),
    c,
    time,
  );
  assert.equal(r.decision, 'allow');
  assert.equal(r.log, true);
  assert.deepEqual(r.items.map((x) => x.action), ['click', 'click', 'verify_state', 'get_window_state']);
  const s = gateToolCall(
    call('run_steps', { steps: [{ click: { pid: 3 } }] }, { pidApps: { 3: 'AppX' } }),
    c,
    time,
  );
  assert.equal(s.decision, 'allow');
  const stop = gateToolCall(
    call('run_steps', { steps: [{ click: { app: 'AppX' } }, { unknown: {} }] }, { windowText: '登录' }),
    c,
    time,
  );
  assert.equal(stop.decision, 'stop');
});

test('模块源码不使用文件、环境、系统时钟或日志', () => {
  const source = readFileSync(new URL('../cua-gate.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['node:fs', 'process.env', 'Date.now', 'console.']) {
    assert.equal(source.includes(forbidden), false);
  }
});

test('补充默认停下词覆盖多语言且不误中 footprint', () => {
  const c = cfg({ grants: [grant] });
  for (
    const w of [
      '登入',
      '校验码',
      '二次验证',
      '短信验证',
      '支付',
      '收银台',
      '信用卡',
      'Sign In',
      'Two-Factor',
      'Credit Card',
      'ログイン',
      '認証コード',
      '二段階認証',
      'お支払い',
      '请输入密码',
    ]
  )
    assert.equal(gate(req('get_window_state', { windowText: w }), c, time).decision, 'stop', w);
  assert.equal(gate(req('click', { windowText: 'footprint report' }), c, time).decision, 'allow');
});

test('保护优先于永远先问，停下优先于永远先问', () => {
  const c = cfg({ grants: [grant], protectedApps: ['AppY'] });
  assert.equal(gate(req('kill_app', { app: 'AppY' }), c, time).rule, 'protected');
  assert.equal(gate(req('clipboard_read', { windowText: '请输入验证码' }), c, time).rule, 'stop-word');
});

test('批量里 browser_prepare 等永远先问项被汇总为先问，observe 缺应用时先问', () => {
  const c = cfg({ grants: [grant] });
  const r = gateToolCall(
    call('run_steps', {
      steps: [{ tool: 'click', args: { app: 'AppX' } }, { tool: 'browser_prepare', args: { app: 'AppX' } }],
    }),
    c,
    time,
  );
  assert.equal(r.decision, 'ask');
  assert.equal(r.rule, 'always-ask');
  const o = gateToolCall(
    call('run_steps', { steps: [{ tool: 'click', args: { app: 'AppX' } }], observe: {} }),
    c,
    time,
  );
  assert.equal(o.decision, 'ask');
  assert.equal(o.items.at(-1).rule, 'no-app');
});

test('英文停下词按单词边界匹配：design in、catalog in 不误中，Sign   In 与 login. 命中', () => {
  const c = cfg({ grants: [grant] });
  for (const w of ['design in progress', 'catalog in stock', 'relogin']) {
    assert.equal(gate(req('click', { windowText: w }), c, time).decision, 'allow', w);
  }
  for (const w of ['Sign   In', 'please login.', '(Log In)']) {
    assert.equal(gate(req('click', { windowText: w }), c, time).decision, 'stop', w);
  }
});

test('修D：只给进程号也查受保护名单，认不出的进程号先问，应用名与进程号对不上直接拒', () => {
  const c = cfg({ grants: [grant], protectedApps: ['AppY'] });
  const pidApps = { 5: 'AppY', 7: 'AppX' };
  assert.equal(gateToolCall(call('click', { pid: 5 }, { pidApps }), c, time).rule, 'protected');
  assert.equal(gateToolCall(call('click', { pid: 99 }, { pidApps }), c, time).decision, 'ask');
  assert.equal(gateToolCall(call('get_window_state', { pid: 99 }, { pidApps }), c, time).decision, 'ask');
  assert.equal(gateToolCall(call('click', { app: 'AppX', pid: 5 }, { pidApps }), c, time).rule, 'app-pid-mismatch');
  assert.equal(gateToolCall(call('click', { app: 'appx.app', pid: 7 }, { pidApps }), c, time).rule, 'granted');
});

test('修D：一步带两个动作键直接拒，批量里的 pid 对不上也拒', () => {
  const c = cfg({ grants: [grant] });
  const steps = [{ click: { app: 'AppX' }, kill_app: { app: 'AppX' } }];
  assert.equal(gateToolCall(call('run_steps', { steps }), c, time).decision, 'deny');
  const mixed = [{ tool: 'click', launch_app: { name: 'AppX' }, args: { app: 'AppX' } }];
  assert.equal(gateToolCall(call('run_steps', { steps: mixed }), c, time).rule, 'multi-action');
  const bad = [{ click: { app: 'AppX', pid: 5 } }];
  assert.equal(gateToolCall(call('run_steps', { steps: bad }, { pidApps: { 5: 'AppZ' } }), c, time).decision, 'deny');
});

test('修D：停下词变体（连字符、空格、全角、零宽字符、2fa、password）', () => {
  const c = cfg({ grants: [grant] });
  for (const w of ['Log-in', 'sign_in now', 'ＰＡＳＳＷＯＲＤ', 'pass​word', 'Enter 2FA code', 'ﾊﾟｽﾜｰﾄﾞ']) {
    assert.equal(gate(req('click', { windowText: w }), c, time).decision, 'stop', w);
  }
  assert.equal(gate(req('click', { windowText: 'passport photo' }), c, time).decision, 'allow');
});

test('修D：写动作拿不到窗口文字降为先问，读动作不受影响', () => {
  const c = cfg({ grants: [grant], readOnlyWithoutAsk: true });
  for (const windowText of [undefined, null, '', '  ', []]) {
    const r = gate(req('click', { windowText }), c, time);
    assert.equal(r.decision, 'ask', JSON.stringify(windowText));
    assert.equal(r.rule, 'no-window-text');
  }
  assert.equal(gate(req('get_window_state', { windowText: undefined }), c, time).decision, 'allow');
});
