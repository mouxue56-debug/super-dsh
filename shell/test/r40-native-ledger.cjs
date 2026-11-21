/* 账本渲染回归。jsdom，只用假的金额、用量和本体数据。 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'js/r30-ledger-today.js'), 'utf8');
const evil = '<img src=x onerror="window.__hit=1">';
function bucket(amount = 1.25) {
  return { calls: 2, tokens: { input: 1000, cacheRead: 200, cacheWrite: 300, output: 400, reasoning: 99 },
    cost: { byCurrency: { CNY: { ok: amount, expired: 0 } }, localCalls: 0, pendingCalls: 0, planCalls: 0 } };
}
function fixture(native) {
  const b = bucket();
  return { all: { total: b, byBot: { helper: b }, byDay: { '2026-11-19': b },
    last7Days: { total: b, days: [{ date: '2026-11-19', ...b }] }, thisMonth: { total: bucket(3.75) },
    recent: [{ bot: 'helper', title: evil, ts: '2026-11-19T01:00:00Z', ...b }], native }, today: { total: b } };
}
function render(raw, budget) {
  const dom = new JSDOM('<body><div id="host"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.document.documentElement.dataset.hubMode = 'real';
  w.eval(source);
  const model = w.R30LT.normalizeLedger(raw, () => evil);
  if (model && budget) model.budgets = { month: { cur: 'CNY', limit: budget } };
  const host = w.document.getElementById('host');
  w.R30LT.mountLedger(host, model);
  return { dom, w, model, host };
}
test('真实账本展示人民币、次数、四项 token 和本体价目，预算阈值保持', () => {
  for (const [limit, level] of [[10, 'ok'], [5, 'warm'], [4, 'hot']]) {
    const { dom, model, host } = render(fixture(), limit);
    assert.equal(model.periods.today.tokens, 1900, 'reasoning 不重复计入 token 总量');
    assert.equal(model.periods.month.cost.byCur.CNY, 3.75, '采用本月权威汇总');
    assert.match(host.textContent, /¥1\.25/);
    assert.match(host.textContent, /¥3\.75/);
    assert.match(host.textContent, /2 次/);
    assert.match(host.textContent, /输入 1,000 · 缓存命中 200 · 缓存写 300 · 输出 400/);
    assert.match(host.textContent, /价目与 DeepSeek Harness 同一张表（¥1\/0\.02\/4 每百万，峰时 ×2）/);
    assert.ok(host.querySelector('.r30l-meter.' + level));
    assert.equal(host.querySelectorAll('.r30l-native, img[onerror]').length, 0);
    assert.doesNotMatch(host.textContent, /待计价|费用暂时算不出|示例数据/);
    dom.window.close();
  }
});
test('本体读取失败只在核对块显示具体原因并转义', () => {
  const { dom, host, w } = render(fixture({ ok: false, reason: '文件不存在 ' + evil }));
  assert.match(host.querySelector('.r30l-native').textContent,
    /读不到 DeepSeek Harness 的账本：文件不存在 <img/);
  assert.match(host.querySelector('.r30l-stat').textContent, /¥1\.25/);
  assert.equal(host.querySelectorAll('img,script').length, 0);
  assert.equal(w.__hit, undefined);
  dom.window.close();
});
test('本体样本按天和渠道显示美元，状态额度和余额不生成助理维度', () => {
  const { dom, host } = render(fixture({ quotaWatch: { calls: 3, totalUsd: 0.5,
    days: [{ day: '2026-11-19', provider: evil, calls: 3, usd: 0.5 }] },
  costMeter: { usage: { opencode: { h5: 1, d7: 2, d30: 3 } },
    limits: { opencode: { h5: 20, week: 50, month: 100 } }, providers: { opencode: { phase: 'peak' } },
    balance: { currency: 'CNY', total: 8.6 } } }));
  const native = host.querySelector('.r30l-native');
  assert.match(native.textContent, /本体样本 3 次 · \$0\.50/);
  assert.match(native.textContent, /近 7 天 \$2\.00 \/ 额度 \$50\.00/);
  assert.match(native.textContent, /opencode · 峰时/);
  assert.match(native.textContent, /DeepSeek 余额 ¥8\.60/);
  assert.equal(native.querySelectorAll('img,.r30l-hbars').length, 0);
  dom.window.close();
});
test('本地模型保留用量并明确不计费', () => {
  const raw = fixture();
  const local = bucket();
  local.cost = { byCurrency: {}, localCalls: 2 };
  raw.all.total = local;
  raw.all.byBot.helper = local;
  raw.all.byDay['2026-11-19'] = local;
  raw.all.thisMonth.total = local;
  raw.all.last7Days = { total: local, days: [{ date: '2026-11-19', ...local }] };
  raw.all.recent = [{ bot: 'helper', title: '本地调用', ...local }];
  raw.today.total = local;
  const { dom, host } = render(raw);
  assert.match(host.textContent, /本地模型，不计费/);
  assert.match(host.querySelector('.r30l-row').textContent, /本地模型，不计费/);
  assert.doesNotMatch(host.textContent, /待计价|费用暂时算不出/);
  dom.window.close();
});
test('零金额仍可显示预算，真实数据无效时显示读取失败', () => {
  const raw = fixture();
  raw.all.thisMonth.total = bucket(0);
  const zero = render(raw, 10);
  assert.match(zero.host.querySelectorAll('.r30l-stat')[2].textContent, /¥0\.00/);
  assert.equal(zero.host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '0');
  zero.dom.window.close();
  const missing = render(null);
  assert.equal(missing.model, null);
  assert.match(missing.host.textContent, /账本暂时读不到/);
  assert.equal(missing.host.querySelector('[data-r30l-ledger="demo"]'), null);
  missing.dom.window.close();
});
test('缺失 token 分项显示未上报，缓存独立上报仍保留用量', () => {
  const raw = fixture();
  raw.today.total = { calls: 2, tokens: { input: 0, cacheRead: 200, cacheWrite: 0, output: 0 },
    unreportedFields: { input: 2, cacheWrite: 2, output: 2 }, cost: { localCalls: 2 } };
  const { dom, model, host } = render(raw);
  assert.equal(model.periods.today.tokens, 200);
  assert.match(host.querySelector('.r30l-stat').textContent,
    /输入 未上报 · 缓存命中 200 · 缓存写 未上报 · 输出 未上报/);
  dom.window.close();
});
test('只有往月历史调用时仍显示逐次明细', () => {
  const raw = fixture();
  const empty = { ...bucket(0), calls: 0 };
  raw.all.byDay = { '2026-10-01': bucket() };
  raw.all.thisMonth.total = empty;
  raw.all.last7Days = { total: empty, days: [{ date: '2026-11-19', ...empty }] };
  raw.all.recent[0].ts = '2026-10-01T01:00:00Z';
  raw.today.total = empty;
  const { dom, host } = render(raw);
  assert.equal(host.querySelectorAll('.r30l-row').length, 1);
  assert.match(host.querySelector('.r30l-row').textContent, /10\/1/);
  assert.doesNotMatch(host.textContent, /还没有记录/);
  dom.window.close();
});
