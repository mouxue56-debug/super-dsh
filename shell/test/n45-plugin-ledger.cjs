/* 账本插件数据源回归。jsdom，只用假的插件金额和额度。 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'js/r30-ledger-today.js'), 'utf8');
const evil = '<img src=x onerror="window.__hit=1">';

function bucket(amount = 1.25) {
  return { calls: 2, tokens: { input: 1000, cacheRead: 200, cacheWrite: 300, output: 400 },
    cost: { byCurrency: { CNY: { ok: amount, expired: 0 } }, localCalls: 0, pendingCalls: 0, planCalls: 0 } };
}
function pluginFixture(extra) {
  const b = bucket();
  const plugins = Object.assign({
    ok: true, source: 'cost-meter', sources: ['cost-meter', 'quota-watch'],
    summary: { today: { calls: 3, usd: 1.25 }, week: { calls: 7, usd: 4.5 }, month: { calls: 9, usd: 9.9 } },
    quota: [{ provider: 'opencode', label: 'OpenCode Go', currency: 'USD', windows: [
      { key: 'h5', label: '5 小时', limit: 20, used: 1.21, remaining: 18.79 },
      { key: 'week', label: '本周', limit: 50, used: 2.03, remaining: 47.97 },
    ] }],
    providers: { opencode: { phase: 'peak', next: Date.parse('2026-11-19T08:00:00Z') } },
    balance: { currency: 'CNY', total: 8.6 },
  }, extra || {});
  return { total: b, byBot: { helper: b }, byDay: { '2026-11-19': b },
    last7Days: { total: b, days: [{ date: '2026-11-19', ...b }] }, thisMonth: { total: bucket(3.75) },
    recent: [{ bot: 'helper', title: evil, ts: '2026-11-19T01:00:00Z', ...b }], plugins };
}
function render(all, today) {
  const dom = new JSDOM('<body><div id="host"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.document.documentElement.dataset.hubMode = 'real';
  w.eval(source);
  const model = w.R30LT.normalizeLedger({ all, today: today || { total: bucket() } }, () => '助理');
  const host = w.document.getElementById('host');
  w.R30LT.mountLedger(host, model);
  return { dom, host, model, w };
}

test('第45轮：顶部额度卡显示已用、剩余和限额，花费与次数用插件数', () => {
  const { dom, host, model } = render(pluginFixture());
  assert.ok(model.plugins);
  const quota = host.querySelector('.r30l-quota');
  assert.ok(quota, '额度卡在页面上');
  assert.match(quota.textContent, /OpenCode Go/);
  assert.match(quota.textContent, /5 小时/);
  assert.match(quota.textContent, /已用 \$1\.21 · 剩余 \$18\.79 \/ \$20\.00/);
  assert.match(quota.textContent, /DeepSeek 余额 ¥8\.60/);
  const stat = host.querySelector('.r30l-stat');
  assert.match(stat.textContent, /\$1\.25/);
  assert.match(stat.textContent, /3 次 · 插件不记 token/);
  assert.match(host.querySelector('.r30l-source').textContent, /来自 cost-meter 与 quota-watch/);
  assert.equal(host.querySelector('.r30l-native'), null);
  dom.window.close();
});

test('第45轮：插件读不到时退回价目估算并写明来源', () => {
  for (const plugins of [undefined, { ok: false, reasons: ['文件不存在'] }]) {
    const { dom, host } = render(Object.assign(pluginFixture(), plugins === undefined ? { plugins } : { plugins }));
    assert.equal(host.querySelector('.r30l-quota'), null);
    assert.match(host.querySelector('.r30l-source').textContent, /按价目估算/);
    assert.match(host.querySelector('.r30l-stat').textContent, /¥1\.25/);
    dom.window.close();
  }
});

test('第45轮：插件内容一律转义，不生成图片或脚本', () => {
  const { dom, host, w } = render(pluginFixture({
    quota: [{ provider: evil, label: evil, currency: 'USD', windows: [
      { key: 'h5', label: evil, limit: 20, used: 1, remaining: 19 }] }],
    balance: { currency: evil, total: 1 },
  }));
  assert.match(host.querySelector('.r30l-quota').textContent, /<img src=x onerror="window.__hit=1">/);
  assert.equal(host.querySelectorAll('img,script').length, 0);
  assert.equal(w.__hit, undefined);
  dom.window.close();
});
