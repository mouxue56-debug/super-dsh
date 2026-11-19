// 账本逐次明细（哪位助理、哪段会话、什么时候、用量、有没有价格）和每月预算设置。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createPriceBook } from '../lib/prices.mjs';
import { createLedgerHandlers } from '../lib/ledger-http.mjs';
import { createHandler } from '../lib/ext/settings.mjs';
import { readBudget } from '../lib/settings.mjs';

const now = Date.parse('2030-01-03T12:00:00Z');
const tk = (input, output = 0) => ({ input, cacheRead: 0, cacheWrite: 0, output, reasoning: 0 });
const call = (i, bot, sessionId, model, extra = {}) => ({ kind: 'call', channel: 'prov', model, tokens: tk(1000 * (i + 1), 10),
  tsMs: now - i * 60000, bot, sessionId, ticket: null, ...extra });

test('账本带逐次明细：最近 60 次，每次有助理、会话标题、时间、用量，有价才算钱', async () => {
  const book = createPriceBook([{ channel: 'prov', model: 'priced', mode: 'metered', currency: 'CNY', perTokens: 1000000,
    input: 2, output: 8, cacheRead: 0, cacheWrite: 0, reasoning: 0, expiresAt: '2099-01-01' }]);
  const rows = [call(0, 'pm', 's1', 'priced'), call(1, 'research', 's2', 'unpriced'),
    ...Array.from({ length: 70 }, (_, i) => call(i + 2, 'pm', 's1', 'priced')),
    { kind: 'approval', tsMs: now, bot: 'pm' }];
  const h = createLedgerHandlers({ ledger: { readRows: async () => rows }, priceBook: book, now: () => now,
    sessionTitle: id => ({ s1: '派工：整理名单' })[id] });
  const { status, body } = await h.ledgerPage({});
  assert.equal(status, 200);
  assert.equal(body.recent.length, 60);
  const first = body.recent[0];
  assert.equal(first.bot, 'pm');
  assert.equal(first.title, '派工：整理名单');
  assert.equal(first.sessionId, 's1');
  assert.equal(first.ts, new Date(now).toISOString());
  assert.equal(first.bucket.calls, 1);
  assert.ok(first.bucket.cost.byCurrency.CNY, '有价格就有钱数');
  const second = body.recent[1];
  assert.equal(second.bot, 'research');
  assert.equal(second.title, '');
  assert.equal(Object.keys(second.bucket.cost.byCurrency).length, 0, '没有价格依据就没有钱数');
  assert.equal(second.bucket.cost.pendingCalls, 1);
  assert.ok(body.total.calls >= 72, '原有汇总不变');
});

function fixture() {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r32-budget-')));
  const deps = { hubHome: home, isTrusted: () => true, roster: { list: () => [], get: () => null },
    isOwnerDevice: req => typeof req.headers?.['x-hub-device'] === 'string' };
  return { home, handler: createHandler(deps) };
}
async function call2(handler, method, url, body, device) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method; req.url = url; req.headers = device ? { 'x-hub-device': device } : {};
  const res = { writeHead(s) { this.status = s; }, end(d) { this.body = JSON.parse(d); } };
  await handler(req, res);
  return res;
}

test('每月预算：默认不设、不写文件；只有主人设备能填；填错不写；可取消', async () => {
  const { home, handler } = fixture();
  const file = path.join(home, 'budget.json');
  const got = await call2(handler, 'GET', '/settings/');
  assert.equal(got.body.budget.monthly, null);
  assert.equal(fs.existsSync(file), false);
  assert.equal((await call2(handler, 'PUT', '/settings/budget', { monthly: 100 })).status, 403);
  assert.equal(fs.existsSync(file), false);
  for (const bad of [{ monthly: 0 }, { monthly: -5 }, { monthly: 'abc' }, { monthly: 5, currency: 'EUR' },
    { monthly: 5, extra: 1 }, { currency: 'CNY' }]) {
    assert.equal((await call2(handler, 'PUT', '/settings/budget', bad, 'dev1')).status, 400, JSON.stringify(bad));
  }
  assert.equal(fs.existsSync(file), false);
  const ok = await call2(handler, 'PUT', '/settings/budget', { monthly: 120.5, currency: 'CNY' }, 'dev1');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.budget, { monthly: 120.5, currency: 'CNY' });
  assert.deepEqual((await call2(handler, 'GET', '/settings/')).body.budget, { monthly: 120.5, currency: 'CNY' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const off = await call2(handler, 'PUT', '/settings/budget', { monthly: null }, 'dev1');
  assert.equal(off.body.budget.monthly, null);
  assert.equal(readBudget(home).monthly, null);
});
