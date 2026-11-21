import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { computeCost, createNativePriceBook } from '../lib/prices.mjs';
import { summarize } from '../lib/ledger-summary.mjs';
import { createLedgerHandlers } from '../lib/ledger-http.mjs';

const now = Date.parse('2026-11-19T07:00:00.000Z');
const fullTokens = { input: 1000000, cacheRead: 1000000, cacheWrite: 1000000, output: 1000000, reasoning: 0 };
const call = (timestamp, extra = {}) => ({
  kind: 'call',
  channel: 'deepseek-official',
  model: 'deepseek-v4-flash',
  tsMs: Date.parse(timestamp),
  bot: 'a',
  sessionId: 'session-a',
  tokens: { ...fullTokens },
  ...extra,
});
const cny = bucket => bucket.cost.byCurrency.CNY?.ok ?? 0;

test('r40 checked-in native prices have the four sourced rates and exact JST peak windows', async () => {
  const table = JSON.parse(await readFile(new URL('../native-rates.json', import.meta.url), 'utf8'));
  assert.equal(table.currency, 'CNY');
  assert.equal(table.perTokens, 1000000);
  assert.deepEqual(table.rates, { input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 });
  assert.deepEqual(table.peak, {
    timeZone: 'Asia/Tokyo',
    utcOffsetMinutes: 540,
    weekdays: [1, 2, 3, 4, 5],
    windows: [[10, 13], [15, 19]],
    multiplier: 2,
  });
  const metadata = JSON.stringify(table);
  assert.match(metadata, /cost-meter\/client\.js/);
  assert.match(metadata, /2026-11-19/);
});

test('r40 native prices agree with installed cost-meter source when available', async t => {
  const sourceFile = join(homedir(), 'local-plugins/cost-meter/client.js');
  let source;
  try {
    source = await readFile(sourceFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('cost-meter/client.js is absent; installed-source consistency was not checked');
    return;
  }
  const table = JSON.parse(await readFile(new URL('../native-rates.json', import.meta.url), 'utf8'));
  const literal = source.match(/const PRICE\s*=\s*\{([^}]+)\}/)?.[1];
  assert.ok(literal, 'installed cost-meter must expose its PRICE object');
  for (const name of ['input', 'cacheRead', 'cacheWrite', 'output']) {
    const value = literal.match(new RegExp(`\\b${name}\\s*:\\s*([0-9.]+)`))?.[1];
    assert.equal(Number(value), table.rates[name], `${name} differs from installed cost-meter`);
  }
  assert.match(source, /new Date\(t \+ 9 \* 3_600_000\)/);
  assert.match(source, /weekday < 1 \|\| weekday > 5/);
  assert.match(source, /\(hour >= 10 && hour < 13\) \|\| \(hour >= 15 && hour < 19\)/);
  assert.match(source, /peakAt\(Number\(data\.time\) \|\| 0\) \? 2 : 1/);
});

test('r40 every call uses its own JST peak/off timestamp including weekend and window edges', () => {
  const book = createNativePriceBook();
  const samples = [
    ['2026-11-19T00:59:59.999Z', 6.02],
    ['2026-11-19T01:00:00.000Z', 12.04],
    ['2026-11-19T03:59:59.999Z', 12.04],
    ['2026-11-19T04:00:00.000Z', 6.02],
    ['2026-11-19T05:59:59.999Z', 6.02],
    ['2026-11-19T06:00:00.000Z', 12.04],
    ['2026-11-19T09:59:59.999Z', 12.04],
    ['2026-11-19T10:00:00.000Z', 6.02],
    ['2026-11-21T01:00:00.000Z', 6.02],
    ['2026-11-22T06:00:00.000Z', 6.02],
  ];
  for (const [timestamp, expected] of samples) {
    const price = computeCost(call(timestamp), book, now);
    assert.equal(price.status, 'ok', timestamp);
    assert.equal(price.currency, 'CNY', timestamp);
    assert.equal(price.amount, expected, timestamp);
  }
});

test('r40 cache read and cache write remain distinct, including sub-micro-CNY cache hits', () => {
  const book = createNativePriceBook();
  const base = call('2026-11-19T00:00:00Z');
  for (const [field, expected] of Object.entries({ input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 })) {
    const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, [field]: 1000000 };
    assert.equal(computeCost({ ...base, tokens }, book, now).amount, expected, field);
  }
  const tokens = { input: 0, cacheRead: 1, cacheWrite: 0, output: 0, reasoning: 0 };
  const micro = { ...base, tokens };
  assert.equal(computeCost(micro, book, now).amount, 0.00000002);
  assert.equal(cny(summarize(Array.from({ length: 100 }, () => micro), { priceBook: book, nowMs: now }).total),
    0.000002);
});

test('r40 native known channels share rates while local and unmapped calls count usage without charges', () => {
  const book = createNativePriceBook();
  for (const [channel, model] of [['deepseek-official', 'deepseek-v4-flash'],
    ['deepseek-account', 'deepseek-flash'], ['opencode-go', 'deepseek-v4.1-flash']]) {
    assert.equal(computeCost(call('2026-11-19T01:00:00Z', { channel, model }), book, now).amount, 12.04);
  }
  for (const [channel, model] of [['ollama-local', 'qwen-local'], ['new-channel', 'unknown-model']]) {
    const row = call('2026-11-19T01:00:00Z', { channel, model });
    const result = computeCost(row, book, now);
    assert.equal(result.status, 'local');
    assert.equal(result.amount, 0);
    const summary = summarize([row], { priceBook: book, nowMs: now });
    assert.equal(summary.total.calls, 1);
    assert.equal(summary.total.cost.localCalls, 1);
    assert.equal(summary.total.cost.pendingCalls, 0);
    assert.deepEqual(summary.total.tokens, fullTokens);
  }
});

test('r40 ledger keeps CNY costs, calls and token parts across days, assistants, week, month and recent', async () => {
  const rows = [
    call('2026-11-19T01:00:00Z'),
    call('2026-11-18T14:59:59.999Z', { bot: 'b', sessionId: 'session-b' }),
    call('2026-11-18T15:00:00Z', { bot: 'b', sessionId: 'session-b' }),
    call('2026-10-20T00:00:00Z'),
    call('2026-11-19T02:00:00Z', { bot: 'local', channel: 'ollama-local', model: 'local-model' }),
    { kind: 'approval', tsMs: now, bot: 'a' },
  ];
  const handlers = createLedgerHandlers({
    ledger: { readRows: async () => rows },
    priceBook: createNativePriceBook(),
    now: () => now,
    utcOffsetMinutes: 540,
  });
  const { status, body } = await handlers.ledgerPage({});
  assert.equal(status, 200);
  assert.equal(body.total.calls, 5);
  assert.equal(cny(body.total), 30.1);
  assert.deepEqual(body.total.tokens,
    { input: 5000000, cacheRead: 5000000, cacheWrite: 5000000, output: 5000000, reasoning: 0 });
  assert.equal(cny(body.byDay['2026-11-18']), 6.02);
  assert.equal(cny(body.byDay['2026-11-19']), 18.06);
  assert.equal(cny(body.byBot.a), 18.06);
  assert.equal(cny(body.byBot.b), 12.04);
  assert.equal(body.byBot.local.cost.localCalls, 1);
  assert.equal(body.last7Days.total.calls, 4);
  assert.equal(cny(body.last7Days.total), 24.08);
  assert.equal(body.thisMonth.month, '2026-11');
  assert.equal(body.thisMonth.total.calls, 4);
  assert.equal(cny(body.thisMonth.total), 24.08);
  assert.equal(body.recent.length, 5);
  const peak = body.recent.find(row => row.ts === '2026-11-19T01:00:00.000Z');
  assert.equal(cny(peak.bucket), 12.04);
  assert.deepEqual(peak.bucket.tokens, fullTokens);
  assert.equal(body.total.cost.pendingCalls, 0);
});

test('r40 ledger HTTP exposes native status without dropping event data when a native source fails', async () => {
  const native = { ok: false, reason: 'quota-watch 文件不存在' };
  const handlers = createLedgerHandlers({
    ledger: { readRows: async () => [call('2026-11-19T01:00:00Z')] },
    priceBook: createNativePriceBook(),
    now: () => now,
    readNative: async () => native,
  });
  const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  assert.equal(await handlers.handle({ method: 'GET', url: '/api/ledger' }, response), true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.native, native);
  assert.equal(response.body.total.calls, 1);
  assert.equal(cny(response.body.total), 12.04);
});
