import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { computeCost, createPriceBook, parsePriceTable } from '../lib/prices.mjs';
import { summarize } from '../lib/ledger-summary.mjs';
import { createLedgerHandlers } from '../lib/ledger-http.mjs';

const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const now = Date.parse('2030-01-03T12:00:00Z');
const tokens = (input = 1000000, extra = {}) => ({
  input,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  ...extra,
});
const row = (model, t = tokens(), extra = {}) => ({
  kind: 'call',
  channel: 'sample',
  model,
  tokens: t,
  tsMs: now,
  bot: 'a',
  sessionId: 's',
  ticket: 't',
  ...extra,
});
const fixtures = async () => parsePriceTable(await read('./fixtures/prices.fake.json'));

test('parse JSON and YAML, validate and load empty', async () => {
  const json = await fixtures();
  assert.deepEqual(parsePriceTable(await read('./fixtures/prices.fake.yaml')), json);
  assert.deepEqual(parsePriceTable(await read('../prices.empty.json')), []);
  assert.throws(
    () =>
      parsePriceTable(
        '{"prices":[{"channel":"x","model":"y","currency":"X","checkedAt":"2030-01-01","expiresAt":"2031-01-01"}]}',
      ),
    /source.*row|row.*source/i,
  );
  assert.throws(
    () => parsePriceTable('{"prices":[{"channel":"x","model":"y","mode":"local","input":-1}]}'),
    /row/i,
  );
  assert.throws(() => parsePriceTable('prices:\n  - channel: x\n    nested: [a, b]'), /line 3/i);
  assert.throws(() => parsePriceTable('prices:\n  - channel: x\n      model: y'), /line 3/i);
});

test('cost states, missing data, expiry, reference and micro rounding', async () => {
  const book = createPriceBook(await fixtures());
  assert.equal(computeCost(row('unknown'), book, now).status, 'pending');
  const missing = computeCost(row('meter', tokens(0, { output: 1 })), book, now);
  assert.equal(missing.status, 'pending');
  assert.deepEqual(missing.missing, ['output']);
  const exp = computeCost(row('old'), book, now);
  assert.equal(exp.status, 'expired');
  assert.equal(exp.amount, 1.11);
  assert.equal(computeCost(row('old'), book, Date.parse('2030-01-01T23:59:59.999Z')).status, 'ok');
  assert.equal(computeCost(row('old'), book, Date.parse('2030-01-02T00:00:00Z')).status, 'expired');
  assert.equal(computeCost(row('plan'), book, now).reference, 2.22);
  assert.equal(computeCost(row('plan-empty'), book, now).reference, null);
  assert.equal(computeCost(row('local'), book, now).amount, 0);
  assert.deepEqual(computeCost(row('meter', tokens(2, { output: null })), book, now).unreported, ['output']);
  assert.equal(
    computeCost(row('meter', Object.fromEntries(Object.keys(tokens()).map((k) => [k, null]))), book, now)
      .status,
    'pending',
  );
  const many = Array.from({ length: 1000 }, () => row('meter', tokens(1000)));
  assert.equal(summarize(many, { priceBook: book, nowMs: now }).total.cost.byCurrency.USD.ok, 1.11);
});

function assertTotals(groups, total) {
  const add = (values) => {
    if (values.every((v) => typeof v === 'number' || v === undefined)) {
      return values.reduce((a, b) => a + (b ?? 0), 0);
    }
    const keys = new Set(values.flatMap((v) => Object.keys(v ?? {})));
    return Object.fromEntries([...keys].map((k) => [k, add(values.map((v) => v?.[k]))]));
  };
  assert.deepEqual(add(Object.values(groups)), total);
}

test('summary conserves all numeric fields and fills seven days', async () => {
  const book = createPriceBook(await fixtures());
  const models = ['meter', 'old', 'plan', 'local', 'unknown', 'eur'];
  const rows = Array.from(
    { length: 36 },
    (_, i) =>
      row(models[i % 6], tokens(1000000, { output: i % 7 === 0 ? null : 0 }), {
        tsMs: now - (i % 3) * 86400000,
        bot: i % 4 === 0 ? null : `b${i % 3}`,
        sessionId: i % 5 === 0 ? null : `s${i % 4}`,
        ticket: i % 6 === 0 ? null : `t${i % 2}`,
      }),
  );
  rows.push({ kind: 'dispatch', wallMs: null }, { kind: 'dispatch', wallMs: 42 }, { kind: 'approval' }, {
    kind: 'action',
  }, { kind: 'change' });
  const s = summarize(rows, { priceBook: book, nowMs: now });
  for (const groups of [s.byBot, s.byDay, s.bySession]) assertTotals(groups, s.total);
  assert.equal(s.total.calls, 36);
  assert.equal(s.counts.dispatches, 2);
  assert.equal(s.counts.dispatchWallMs, 42);
  assert.equal(
    summarize([{ kind: 'dispatch', wallMs: null }], { priceBook: book, nowMs: now }).counts.dispatchWallMs,
    null,
  );
  assert.equal(s.last7Days.days.length, 7);
  assert.equal(s.last7Days.days[0].calls, 0);
  assert.ok(s.total.cost.byCurrency.USD);
  assert.ok(s.total.cost.byCurrency.EUR);
  assert.ok(s.byBot['(无助理)']);
  assert.ok(s.bySession['(无会话)']);
  assert.ok(s.byTicket['(无工单)']);
});

test('HTTP handlers and routing with in-memory ledger', async () => {
  const book = createPriceBook(await fixtures());
  const rows = [row('meter'), row('unknown', tokens(), { bot: 'b', sessionId: 'other' })];
  const ledger = {
    async readRows({ from, to } = {}) {
      return rows.filter((r) => {
        const d = new Date(r.tsMs).toISOString().slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      });
    },
  };
  const h = createLedgerHandlers({ ledger, priceBook: book, now: () => now });
  assert.equal((await h.ledgerPage({ from: 'bad' })).status, 400);
  assert.equal((await h.ledgerPage({ from: '2030-02-30' })).status, 400);
  assert.equal((await h.ledgerPage({ from: '2030-01-04', to: '2030-01-03' })).status, 400);
  assert.equal((await h.ledgerPage({})).body.total.calls, 2);
  assert.equal((await h.sessionUsage('')).status, 400);
  assert.equal((await h.sessionUsage('absent')).body.calls, 0);
  assert.equal((await h.sessionUsage('other')).body.cost.pendingCalls, 1);
  assert.equal((await h.today({ bot: 'a' })).body.total.calls, 1);
  assert.equal((await h.today({ bot: '' })).status, 400);
  const shifted = createLedgerHandlers({
    ledger,
    priceBook: book,
    now: () => Date.parse('2030-01-02T23:30:00Z'),
    utcOffsetMinutes: 60,
  });
  assert.equal((await shifted.today({})).body.total.calls, 2);
  const send = async (method, url) => {
    let status, headers, body;
    const handled = await h.handle({ method, url }, {
      writeHead(s, h) {
        status = s;
        headers = h;
      },
      end(b) {
        body = b;
      },
    });
    return { handled, status, headers, body: body && JSON.parse(body) };
  };
  assert.equal((await send('GET', '/unrelated')).handled, false);
  for (const url of ['/api/ledger', '/api/ledger/session/s', '/api/ledger/today?bot=a']) {
    const r = await send('GET', url);
    assert.equal(r.handled, true);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /application\/json/);
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal((await send('POST', '/api/ledger')).status, 405);
});
