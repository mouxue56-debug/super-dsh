import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventTranslator, createLedger, dayOf } from '../lib/ledger.mjs';
import { importLegacy, parseActionsLog, parseApprovalsLog } from '../lib/ledger-legacy.mjs';
import { main } from '../bin/ledger-backfill.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const names = ['t2-L4-events.jsonl', 't3-超时与断线-events.jsonl'];
const load = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8').trim().split('\n').map(JSON.parse);
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('fixture translation preserves calls, timing and approvals and deduplicates across instances', async (t) => {
  const dir = temp(t);
  let ledger = createLedger({ dir });
  for (const name of names) {
    const events = load(name);
    await ledger.ingest(events, {});
    await ledger.ingest(events, {});
  }
  let rows = await ledger.readRows({});
  assert.equal(rows.filter((r) => r.kind === 'call').length, 8);
  assert.equal(rows.filter((r) => r.kind === 'approval').length, 1);
  for (const name of names) {
    const events = load(name), sid = events[0].id;
    for (const event of events.filter((e) => e.type === 'assistant/message')) {
      const r = rows.find((x) => x.sessionId === sid && x.seq === event.seq && x.kind === 'call');
      const u = event.data.usage ?? {};
      const start = events.find((e) =>
        e.type === 'step/start' && e.data.turn === event.data.turn && e.data.step === event.data.step
      );
      assert.deepEqual([r.seq, r.model, r.channel, r.turn, r.step, r.durationMs, r.totalTokens], [
        event.seq,
        event.data.message.source.model,
        event.data.message.source.provider,
        event.data.turn,
        event.data.step,
        event.time - start.time,
        u.totalTokens ?? null,
      ]);
      assert.deepEqual(
        r.tokens,
        Object.fromEntries(
          ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'].map(
            (k) => [k, u[k + 'Tokens'] ?? null],
          ),
        ),
      );
    }
  }
  const a = rows.find((r) => r.kind === 'approval');
  assert.equal(a.outcome, 'rejected');
  assert.ok(a.action);
  assert.ok(a.askedTsMs);
  ledger = createLedger({ dir });
  for (const name of names) await ledger.ingest(load(name), {});
  assert.equal((await ledger.readRows({})).length, 9);
});

test('catch-up across restart matches full ingestion and tracks skipped seq', async (t) => {
  const dir = temp(t), fullDir = temp(t), events = load(names[1]), sid = events[0].id;
  let partial = createLedger({ dir });
  await partial.ingest(events.slice(0, Math.floor(events.length / 2)), {});
  partial = createLedger({ dir });
  const expected = await partial.lastSeq(sid);
  let since;
  await partial.catchUp({
    sessionId: sid,
    fetchSince: async (n) => {
      since = n;
      return events.filter((e) => Number.isInteger(e.seq) && (n === null || e.seq > n));
    },
  });
  assert.ok(since >= expected);
  const full = createLedger({ dir: fullDir });
  await full.ingest(events, {});
  assert.deepEqual(
    (await partial.readRows({})).map((r) => r.key),
    (await full.readRows({})).map((r) => r.key),
  );
  assert.equal((await partial.catchUp({ sessionId: sid, fetchSince: async () => events })).written, 0);
});

test('validation, truncation, permissions, date boundaries and damaged lines', async (t) => {
  const dir = temp(t),
    ledger = createLedger({ dir, utcOffsetMinutes: 540, now: () => Date.parse('2026-01-01T15:00:00Z') });
  await assert.rejects(ledger.record({ kind: 'unknown', id: 'x' }));
  for (const val of [-1, '3']) {
    await assert.rejects(
      ledger.record({
        kind: 'call',
        id: 'bad',
        tokens: { input: val, cacheRead: null, cacheWrite: null, output: null, reasoning: null },
      }),
    );
  }
  const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  await assert.rejects(ledger.record({ kind: 'dispatch', id: 'bad', tokens: zero }));
  await ledger.record({
    kind: 'dispatch',
    id: 'good',
    tokens: Object.fromEntries(Object.keys(zero).map((k) => [k, null])),
  });
  await ledger.record({ kind: 'action', id: 'long', detail: '猫'.repeat(20000), target: 'x'.repeat(20000) });
  assert.equal(dayOf(Date.parse('2026-01-01T15:00:00Z'), 540), '2026-01-02');
  assert.deepEqual(await ledger.listDays(), ['2026-01-02']);
  const file = path.join(dir, 'events', '2026-01-02.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.ok(lines.every((x) => Buffer.byteLength(x + '\n') <= 8192));
  assert.equal(JSON.parse(lines[1]).truncated, true);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(dir, 'events')).mode & 0o777, 0o700);
  fs.appendFileSync(file, '{"partial":');
  const rows = await ledger.readRows({});
  assert.equal(rows.length, 2);
  assert.equal(rows.skippedLines, 1);
  assert.equal(Object.keys(rows).includes('skippedLines'), false);
});

test('backfill CLI dry-run, bot mapping and repeat import', async (t) => {
  const dir = temp(t),
    dry = path.join(dir, 'dry'),
    dest = path.join(dir, 'ledger'),
    map = path.join(dir, 'map.json');
  fs.writeFileSync(map, JSON.stringify({ [load(names[0])[0].agentPreset]: 'mapped' }));
  let output = '';
  const stdout = {
    write: (s) => {
      output += s;
    },
  };
  await main(['--ledger', dry, '--events', fixtures, '--dry-run'], { stdout });
  assert.equal(fs.existsSync(path.join(dry, 'events')), false);
  assert.equal(JSON.parse(output).written, 9);
  output = '';
  await main(['--ledger', dest, '--events', fixtures, '--bot-map', map, '--bot', 'fallback'], { stdout });
  assert.equal(JSON.parse(output).written, 9);
  const rows = await createLedger({ dir: dest }).readRows({});
  assert.ok(rows.every((r) => r.backfill === true));
  assert.ok(rows.some((r) => r.bot === 'mapped'));
  output = '';
  await main(['--ledger', dest, '--events', fixtures, '--bot-map', map, '--bot', 'fallback'], { stdout });
  assert.equal(JSON.parse(output).written, 0);
});

test('legacy parsers import valid lines once and count invalid ones', async (t) => {
  const dir = temp(t), ledger = createLedger({ dir });
  const approvalsText = '2026-01-01T00:00:00Z\tbot\twrite\t/a\tapproved\t-\nbroken\n';
  const actionsText = '2026-01-01T00:00:01Z\tbot\tread\t/b\tL1\n';
  assert.equal(parseApprovalsLog(approvalsText).bad, 1);
  assert.equal(parseActionsLog(actionsText).rows.length, 1);
  const first = await importLegacy(ledger, { approvalsText, actionsText });
  assert.equal(first.written, 2);
  assert.equal(first.bad, 1);
  const second = await importLegacy(ledger, { approvalsText, actionsText });
  assert.equal(second.written, 0);
  assert.equal(second.duplicate, 2);
  const rows = await ledger.readRows({});
  assert.equal(rows.length, 2);
  assert.equal(rows[0].device, null);
});

test('translator isolates sessions and tolerates missing approval context', () => {
  const translator = createEventTranslator();
  assert.equal(translator.translate({ type: 'session', id: 's' }, {}), null);
  const row = translator.translate({
    type: 'approval/decided',
    seq: 2,
    time: 1,
    data: { id: 'a', outcome: 'approved' },
  }, {});
  assert.equal(row.sessionId, 's');
  assert.equal(row.action, null);
});

test('catch-up uses the highest skipped event sequence and persists approval sequence across restart', async (t) => {
  const dir = temp(t), ledger = createLedger({ dir });
  await ledger.ingest([
    { type: 'session', id: 's' },
    { type: 'assistant/message', seq: 2, time: 10, data: { usage: {}, message: {} } },
    { type: 'approval/decided', seq: 5, time: 11, data: { id: 'a', outcome: 'approved' } },
    { type: 'other', seq: 8, time: 12 },
  ], {});
  assert.equal(await ledger.lastSeq('s'), 2);
  let seen;
  await ledger.catchUp({
    sessionId: 's',
    fetchSince: async (n) => {
      seen = n;
      return [];
    },
  });
  assert.equal(seen, 8);
  const restarted = createLedger({ dir });
  await restarted.catchUp({
    sessionId: 's',
    fetchSince: async (n) => {
      seen = n;
      return [];
    },
  });
  assert.equal(seen, 5);
});

test('concurrent ledger instances serialize duplicate writes and date filtering is inclusive', async (t) => {
  const dir = temp(t), a = createLedger({ dir }), b = createLedger({ dir });
  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).record({ kind: 'action', id: 'same', tsMs: 0 })),
  );
  assert.equal(results.filter((r) => r.written).length, 1);
  await b.record({ kind: 'action', id: 'next', tsMs: 86400000 });
  assert.equal((await a.readRows({ from: '1970-01-02', to: '1970-01-02' })).length, 1);
});

test('approval rows from events and from an explicit BFF write share one key (first writer wins)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-key-'));
  const ledger = createLedger({ dir });
  const asked = {
    type: 'approval/asked',
    seq: 5,
    time: 1000,
    data: {
      id: 'A1',
      toolName: 'write',
      reason: 'HUBAPPROVAL1 {"tool":"write","level":"L3","action":"x","path":"/p"}',
    },
  };
  const decided = { type: 'approval/decided', seq: 6, time: 2000, data: { id: 'A1', outcome: 'approved' } };
  const first = await ledger.record({
    kind: 'approval',
    key: 'approval:S1:A1',
    tsMs: 1500,
    sessionId: 'S1',
    approvalId: 'A1',
    outcome: 'approved',
    device: 'phone',
  });
  assert.equal(first.written, true);
  await ledger.recordEvent(asked, { sessionId: 'S1' });
  const second = await ledger.recordEvent(decided, { sessionId: 'S1' });
  assert.equal(second.written, false);
  const rows = (await ledger.readRows()).filter((r) => r.kind === 'approval');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].device, 'phone');
});

test('修D：同键重复行读的时候只算一条，残行之后追加的新行读得出来且残行计入跳过', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r27d-'));
  fs.mkdirSync(path.join(dir, 'events'), { recursive: true });
  const row = (key) => JSON.stringify({ v: 1, kind: 'action', key, ts: '2026-11-17T01:00:00.000Z', tsMs: 1 });
  fs.writeFileSync(path.join(dir, 'events', '2026-11-17.jsonl'), `${row('k')}\n${row('k')}\n{"v":1,"ki`);
  const now = () => Date.parse('2026-11-17T01:00:00Z');
  const ledger = createLedger({ dir, now });
  assert.equal((await ledger.readRows()).filter((r) => r.key === 'k').length, 1);
  await ledger.record({ kind: 'action', key: 'next', tool: 't', target: 'x' });
  const rows = await ledger.readRows();
  assert.deepEqual(rows.map((r) => r.key), ['k', 'next']);
  assert.equal(rows.skippedLines, 1);
});

test('修D：token 数超上限或不是安全整数一律拒收', async () => {
  const ledger = createLedger({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'r27d-')) });
  for (const input of [1e13, 2 ** 53, 1.5]) {
    const tokens = { input, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
    await assert.rejects(ledger.record({ kind: 'call', key: 'c' + input, tokens }));
  }
});
