// 路 10 独立复核（事件账部分）：原样拷自复核员测试，断言未改。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createLedger, createEventTranslator } from '../lib/ledger.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'r10-'));

// ---------- 事件账 ----------
test('review-ledger-second-process-must-not-duplicate-a-key', async () => {
  const dir = tmp();
  const ledger = createLedger({ dir });
  await ledger.lastSeq('s');
  const mod = pathToFileURL(join(import.meta.dirname, '../lib/ledger.mjs')).href;
  execFileSync(process.execPath, ['--input-type=module', '-e',
    `import {createLedger} from '${mod}'; await createLedger({dir:${JSON.stringify(dir)}}).record({kind:'action',key:'dup-1',tool:'t',target:'x'});`]);
  await ledger.record({ kind: 'action', key: 'dup-1', tool: 't', target: 'x' });
  const rows = (await createLedger({ dir }).readRows()).filter((r) => r.key === 'dup-1');
  assert.equal(rows.length, 1);
});

test('review-ledger-torn-last-line-must-not-swallow-the-next-row', async () => {
  const dir = tmp();
  const now = () => Date.parse('2026-11-17T01:00:00Z');
  mkdirSync(join(dir, 'events'), { recursive: true });
  writeFileSync(join(dir, 'events', '2026-11-17.jsonl'), '{"v":1,"kind":"action","key":"a","ts');
  const ledger = createLedger({ dir, now });
  await ledger.record({ kind: 'action', key: 'n1', tool: 't', target: 'x' });
  const rows = await createLedger({ dir, now }).readRows();
  assert.ok(rows.some((r) => r.key === 'n1'));
});

test('review-ledger-absurd-token-count-must-be-rejected', async () => {
  const ledger = createLedger({ dir: tmp() });
  const tokens = { input: 1e300, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  await assert.rejects(ledger.record({ kind: 'call', key: 'c1', tokens }));
});

test('review-ledger-approval-key-without-session-must-not-collide-across-bots', () => {
  const t = createEventTranslator();
  const ev = { type: 'approval/decided', seq: 1, time: 1, data: { id: 'ap1', outcome: 'allow' } };
  const a = t.translate(ev, { bot: 'bot-a' });
  const b = t.translate(ev, { bot: 'bot-b' });
  assert.notEqual(a.key, b.key);
});
