// 账本页「有 N 次调用没有上报 token」与上面的 token 数对不上。
// 原因是统计口径：按五项（输入、缓存读、缓存写、输出、推理）取最大，而 DeepSeek 一类模型从不报缓存写和推理，
// 于是每次调用都被算成「没上报」。改为只数缺输入或输出的调用，并把文案说清这几次没算进总数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { summarize } from '../../hub-bff/lib/ledger-summary.mjs';
import { createPriceBook } from '../../hub-bff/lib/prices.mjs';

const require = createRequire(import.meta.url);
const f = require('../hub-real.js');

// 造一条账本调用：只报输入、缓存读、输出。
function call(ts, tokens) {
  return { kind: 'call', tsMs: ts, bot: 'r', sessionId: 's', model: 'm', provider: 'p', tokens };
}

const usual = { input: 1000, cacheRead: 5000, cacheWrite: null, output: 250, reasoning: null };
const blank = { input: null, cacheRead: null, cacheWrite: null, output: null, reasoning: null };

test('只报输入、缓存读、输出的调用不算「没上报」', () => {
  const rows = Array.from({ length: 28 }, (_, i) => call(1000 + i, usual));
  const { total } = summarize(rows, { nowMs: 5000, priceBook: createPriceBook([]) });
  assert.equal(total.unreportedFields.cacheWrite, 28);
  const usage = f.bucketTokens(total);
  assert.equal(usage.known, true);
  assert.equal(usage.total, 28 * 6250);
  assert.equal(usage.unreported, 0);
  assert.doesNotMatch(f.usageLine(total), /未上报/u);
});

test('真缺输入输出的调用才计数，且和总数说得通', () => {
  const rows = [call(1, usual), call(2, usual), call(3, blank)];
  const { total } = summarize(rows, { nowMs: 5000, priceBook: createPriceBook([]) });
  const usage = f.bucketTokens(total);
  assert.equal(usage.unreported, 1);
  assert.equal(usage.total, 2 * 6250);
  assert.match(f.usageLine(total), /有 1 次未上报/u);
});

test('账本页文案说明这几次没算进总数', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
  assert.match(source, /次调用没报输入或输出 token，没算进上面的总数/u);
  assert.doesNotMatch(source, /次调用没有上报 token'/u);
});
