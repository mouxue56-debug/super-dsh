import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPluginLedger, resolvePluginSource } from '../lib/plugin-ledger.mjs';
import { createHandler } from '../lib/ext/ledger.mjs';
import { createNativePriceBook } from '../lib/prices.mjs';
import { readHubYaml } from '../lib/ext/index.mjs';
import { loadHubConfig, hubConfigText } from '../../hub-plugin/hub-config.mjs';

const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const now = Date.parse('2026-11-19T07:00:00Z');
const hour = 3_600_000, day = 86_400_000;
const samples = [
  { t: now - hour, p: 'deepseek', c: 0.1 },
  { t: now - 2 * hour, p: 'deepseek', c: 0.2 },
  { t: now - 6 * hour, p: 'opencode', c: 0.5 },
  { t: now - 8 * day, p: 'deepseek', c: 1 },
];
const statusPayload = {
  usage: {
    opencode: { h5: 1.2, d7: 3.4, d30: 5.6 },
    deepseek: { h5: 0.4, d7: 0.9, d30: 1.9 },
  },
  limits: {
    opencode: { h5: 20, week: 50, month: 100 },
    ollama: { month: 60 },
    deepseek: null,
  },
  providers: {
    opencode: { phase: 'peak', next: now + hour },
    deepseek: { phase: 'off', next: now + 2 * hour },
  },
  balance: { configured: true, isAvailable: true, currency: 'CNY', total: 12.34 },
};

async function fixture(name, contents) {
  await mkdir(temporaryRoot, { recursive: true });
  const dir = await mkdtemp(path.join(temporaryRoot, 'r45-plugin-'));
  const file = path.join(dir, name);
  if (contents !== undefined) await writeFile(file, contents, 'utf8');
  return { dir, file };
}

async function endpoint(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}/plugins/cost-meter/status`;
}

function response() {
  return {
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); },
  };
}

test('r45 plugin source reads quota-watch samples with cost-meter status as the primary source', async t => {
  const url = await endpoint(t, (_request, res) => res.end(JSON.stringify(statusPayload)));
  const { file } = await fixture('quota-watch.json', JSON.stringify(samples));
  const plugins = await readPluginLedger({ quotaWatchFile: file, costMeterUrl: url },
    { env: {}, now, utcOffsetMinutes: 540 });
  assert.equal(plugins.ok, true);
  assert.equal(plugins.source, 'cost-meter');
  assert.deepEqual(plugins.sources, ['cost-meter', 'quota-watch']);
  assert.equal(plugins.windows.deepseek.h5.calls, 2);
  assert.ok(Math.abs(plugins.windows.deepseek.h5.usd - 0.3) < 1e-12);
  assert.equal(plugins.windows.opencode.h5.calls, 0);
  assert.ok(Math.abs(plugins.windows.opencode.d7.usd - 0.5) < 1e-12);
  assert.ok(Math.abs(plugins.windows.deepseek.d30.usd - 1.3) < 1e-12);
  assert.equal(plugins.summary.today.calls, 3);
  assert.ok(Math.abs(plugins.summary.today.usd - 0.8) < 1e-12);
  assert.equal(plugins.summary.week.calls, 3);
  assert.equal(plugins.summary.month.calls, 4);
  assert.ok(Math.abs(plugins.summary.month.usd - 1.8) < 1e-12);
  assert.equal(plugins.quota.length, 2);
  const opencode = plugins.quota.find(row => row.provider === 'opencode');
  assert.ok(opencode);
  assert.equal(opencode.provider, 'opencode');
  assert.equal(opencode.label, 'OpenCode Go');
  assert.deepEqual(opencode.windows.map(row => [row.key, row.used, row.limit, row.remaining]), [
    ['h5', 1.2, 20, 18.8],
    ['week', 3.4, 50, 46.6],
    ['month', 5.6, 100, 94.4],
  ]);
  assert.equal(plugins.providers.deepseek.phase, 'off');
  assert.equal(plugins.balance.total, 12.34);
});

test('r45 quota-watch file alone still gives used amounts, counts and no invented limits', async () => {
  const { file } = await fixture('quota-watch.json', JSON.stringify(samples));
  const plugins = await readPluginLedger({ quotaWatchFile: file }, { env: {}, now, utcOffsetMinutes: 540 });
  assert.equal(plugins.ok, true);
  assert.equal(plugins.source, 'quota-watch');
  assert.deepEqual(plugins.sources, ['quota-watch']);
  assert.equal(plugins.summary.month.calls, 4);
  assert.equal(plugins.quota.length, 0);
  assert.equal(plugins.providers, undefined);
});

test('r45 hub.yaml loaders preserve the plugins section', async () => {
  const { dir } = await fixture('unused');
  const configDir = path.join(dir, 'config');
  await mkdir(configDir);
  const plugins = { quotaWatchFile: path.join(dir, 'quota-watch.json'),
    costMeterUrl: 'http://127.0.0.1:9876/plugins/cost-meter/status' };
  await writeFile(path.join(configDir, 'hub.yaml'), `version: 1\nplugins: ${JSON.stringify(plugins)}\n`);
  assert.deepEqual(readHubYaml(configDir).plugins, plugins);
  const config = loadHubConfig({ home: dir, hubHome: dir });
  assert.deepEqual(config.plugins, plugins);
  assert.ok(hubConfigText(config).includes(`plugins: ${JSON.stringify(plugins)}\n`));
});

test('r45 plugin failures stay explicit and do not fabricate plugin totals', async () => {
  const { dir } = await fixture('missing.json');
  const plugins = await readPluginLedger({ quotaWatchFile: path.join(dir, 'absent.json'),
    costMeterUrl: 'http://8.8.8.8/status' }, { env: {}, now });
  assert.equal(plugins.ok, false);
  assert.equal(plugins.source, 'plugins');
  assert.equal(plugins.summary, undefined);
  assert.equal(plugins.quota, undefined);
  assert.match(plugins.reasons.join('；'), /文件不存在/);
  assert.match(plugins.reasons.join('；'), /地址无效/);
  assert.equal(await readPluginLedger(undefined, { env: {} }), undefined);
  assert.equal(await readPluginLedger(false, { env: {} }), undefined);
  assert.equal((await readPluginLedger('bad', { env: {} })).ok, false);
});

test('r45 detection uses only an explicit DSH_HOME and only when the plugin store exists', async () => {
  const { dir } = await fixture('unused');
  const missing = path.join(dir, 'no-store');
  assert.equal(resolvePluginSource({}, { env: { DSH_HOME: missing } }), undefined);
  await mkdir(path.join(dir, 'storages'));
  await writeFile(path.join(dir, 'storages', 'quota-watch.json'), '[]');
  assert.deepEqual(resolvePluginSource({}, { env: { DSH_HOME: dir } }), {
    quotaWatchFile: path.join(dir, 'storages', 'quota-watch.json'),
    detected: true,
  });
  assert.deepEqual(resolvePluginSource({}, { env: { DSH_HOME: dir, DSH_URL: 'http://127.0.0.1:3290' } }), {
    quotaWatchFile: path.join(dir, 'storages', 'quota-watch.json'),
    detected: true,
    costMeterUrl: 'http://127.0.0.1:3290/plugins/cost-meter/status',
  });
  assert.equal(resolvePluginSource({}, { env: { DSH_HOME: dir, DSH_URL: 'http://example.com:3290' } })
    .costMeterUrl, undefined);
  assert.equal(resolvePluginSource({ plugins: false }, { env: { DSH_HOME: dir } }), undefined);
  assert.deepEqual(resolvePluginSource({ nativeLedger: { quotaWatchFile: '/x.json' } }, { env: {} }),
    { quotaWatchFile: '/x.json' });
});

test('r45 ledger HTTP labels plugin numbers as the source and falls back to price estimates', async t => {
  const url = await endpoint(t, (_request, res) => res.end(JSON.stringify(statusPayload)));
  const { file } = await fixture('quota-watch.json', JSON.stringify(samples));
  const tsMs = now;
  const deps = {
    hubConfig: { plugins: { quotaWatchFile: file, costMeterUrl: url } },
    priceBook: createNativePriceBook(),
    now: () => tsMs,
    utcOffsetMinutes: 540,
    ledger: { readRows: async () => [{
      kind: 'call', channel: 'deepseek-official', model: 'deepseek-v4-flash', tsMs, bot: 'a', sessionId: 's',
      tokens: { input: 1000000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    }] },
  };
  const handler = createHandler(deps);
  const res = response();
  assert.equal(await handler({ method: 'GET', url: '/ledger', headers: {} }, res), true);
  assert.equal(res.status, 200);
  assert.equal(res.body.pricing.source, 'plugins');
  assert.equal(res.body.pricing.label, '来自 cost-meter');
  assert.equal(res.body.plugins.ok, true);
  assert.equal(res.body.plugins.summary.today.calls, 3);
  assert.equal(res.body.total.calls, 1);
  assert.equal(res.body.total.cost.byCurrency.CNY.ok, 2);

  const plain = createHandler({ ...deps, hubConfig: {} });
  const res2 = response();
  assert.equal(await plain({ method: 'GET', url: '/ledger', headers: {} }, res2), true);
  assert.equal(res2.body.pricing.source, 'prices');
  assert.equal(res2.body.pricing.label, '按价目估算');
  assert.equal(res2.body.plugins, undefined);
});
