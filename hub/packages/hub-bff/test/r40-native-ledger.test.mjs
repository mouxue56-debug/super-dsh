import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNativeLedger, validateCostMeterUrl } from '../lib/native-ledger.mjs';
import { createHandler } from '../lib/ext/ledger.mjs';
import { createNativePriceBook } from '../lib/prices.mjs';
import { readHubYaml } from '../lib/ext/index.mjs';
import { loadHubConfig, hubConfigText } from '../../hub-plugin/hub-config.mjs';

const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const statusPayload = {
  usage: { deepseek: { h5: 1.2, d7: 3.4, d30: 5.6 } },
  limits: { opencode: { h5: 20, week: 50, month: 100 } },
  providers: { deepseek: { phase: 'off', next: 1795046400000 } },
  balance: { configured: true, isAvailable: true, currency: 'CNY', total: 12.34 },
};

async function fixture(name, contents) {
  await mkdir(temporaryRoot, { recursive: true });
  const dir = await mkdtemp(path.join(temporaryRoot, 'r40-native-'));
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

test('r40 native sources stay hidden without configuration and use only an explicit DSH_HOME default', async () => {
  assert.equal(await readNativeLedger(undefined, { env: {} }), undefined);
  assert.equal(await readNativeLedger(null, { env: {} }), undefined);
  assert.equal(await readNativeLedger({}, { env: {} }), undefined);
  const { dir } = await fixture('unused');
  await mkdir(path.join(dir, 'storages'));
  await writeFile(path.join(dir, 'storages', 'quota-watch.json'), '[]');
  assert.equal(await readNativeLedger(undefined, { env: { DSH_HOME: dir } }), undefined);
  const native = await readNativeLedger({}, { env: { DSH_HOME: dir } });
  assert.deepEqual(native.quotaWatch, { days: [], totalUsd: 0, calls: 0 });
});

test('r40 both hub.yaml loaders and serialization preserve the camelCase nativeLedger section', async () => {
  const { dir } = await fixture('unused');
  const configDir = path.join(dir, 'config');
  await mkdir(configDir);
  const nativeLedger = {
    quotaWatchFile: path.join(dir, 'quota-watch.json'),
    costMeterUrl: 'http://127.0.0.1:9876/plugins/cost-meter/status',
  };
  const text = `version: 1\nnativeLedger: ${JSON.stringify(nativeLedger)}\n`;
  await writeFile(path.join(configDir, 'hub.yaml'), text);
  assert.deepEqual(readHubYaml(configDir).nativeLedger, nativeLedger);
  const config = loadHubConfig({ home: dir, hubHome: dir });
  assert.deepEqual(config.nativeLedger, nativeLedger);
  assert.ok(hubConfigText(config).includes(`nativeLedger: ${JSON.stringify(nativeLedger)}\n`));
});

test('r40 quota samples preserve USD, count by JST day/provider and omit unavailable dimensions', async () => {
  const samples = [
    { t: Date.parse('2026-11-18T14:59:59.999Z'), p: 'deepseek', c: 0.1 },
    { t: Date.parse('2026-11-18T15:00:00.000Z'), p: 'deepseek', c: 0.2 },
    { t: Date.parse('2026-11-18T15:01:00.000Z'), p: 'deepseek', c: 0.3 },
    { t: Date.parse('2026-11-18T15:02:00.000Z'), p: 'opencode', c: 0 },
  ];
  const contents = JSON.stringify(samples);
  const { file } = await fixture('quota-watch.json', contents);
  const native = await readNativeLedger({ quotaWatchFile: file }, { env: {} });
  assert.equal(native.quotaWatch.calls, 4);
  assert.ok(Math.abs(native.quotaWatch.totalUsd - 0.6) < 1e-12);
  const days = [...native.quotaWatch.days].sort((a, b) =>
    `${a.day}/${a.provider}`.localeCompare(`${b.day}/${b.provider}`));
  assert.deepEqual(days, [
    { day: '2026-11-18', provider: 'deepseek', calls: 1, usd: 0.1 },
    { day: '2026-11-19', provider: 'deepseek', calls: 2, usd: 0.5 },
    { day: '2026-11-19', provider: 'opencode', calls: 1, usd: 0 },
  ]);
  assert.equal(Object.hasOwn(native.quotaWatch, 'byBot'), false);
  assert.equal(Object.hasOwn(native.quotaWatch, 'tokens'), false);
  assert.equal(await readFile(file, 'utf8'), contents, 'reading must leave the source file byte-for-byte intact');
});

test('r40 quota read failures have specific reasons and no fabricated totals', async () => {
  const absent = await fixture('missing.json');
  const missing = await readNativeLedger({ quotaWatchFile: absent.file }, { env: {} });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /文件不存在/);
  assert.equal(missing.quotaWatch, undefined);
  const directory = await readNativeLedger({ quotaWatchFile: absent.dir }, { env: {} });
  assert.equal(directory.ok, false);
  assert.match(directory.reason, /不可读/);
  for (const data of ['{', '{}', '[{"t":0,"p":"deepseek","c":-1}]']) {
    const bad = await fixture('invalid.json', data);
    const result = await readNativeLedger({ quotaWatchFile: bad.file }, { env: {} });
    assert.equal(result.ok, false);
    assert.match(result.reason, /格式不对/);
    assert.equal(result.quotaWatch, undefined);
  }
});

test('r40 quota samples enforce the 60000 row boundary', async () => {
  const samples = Array.from({ length: 60000 }, () => ({ t: 1795000000000, p: 'deepseek', c: 0 }));
  const allowed = await fixture('quota-watch.json', JSON.stringify(samples));
  const accepted = await readNativeLedger({ quotaWatchFile: allowed.file }, { env: {} });
  assert.equal(accepted.quotaWatch.calls, 60000);
  samples.push(samples[0]);
  const oversized = await fixture('quota-watch.json', JSON.stringify(samples));
  const rejected = await readNativeLedger({ quotaWatchFile: oversized.file }, { env: {} });
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /格式不对/);
  assert.equal(rejected.quotaWatch, undefined);
});

test('r40 cost-meter permits private hosts and refuses public URLs and credentials before fetching', async () => {
  for (const host of ['127.0.0.1', 'localhost', '10.0.0.1', '172.16.0.1', '192.168.1.1', '[::1]', '[fd12::1]']) {
    assert.ok(validateCostMeterUrl(`http://${host}:9876/plugins/cost-meter/status`), host);
  }
  for (const url of ['http://8.8.8.8/status', 'http://example.com/status', 'http://172.32.0.1/status',
    'http://user:password@127.0.0.1/status', 'file:///etc/passwd']) {
    assert.equal(validateCostMeterUrl(url), null, url);
    const result = await readNativeLedger({ costMeterUrl: url }, { env: {} });
    assert.equal(result.ok, false, url);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
    assert.equal(result.costMeter, undefined);
  }
});

test('r40 fake cost-meter status passes through only ledger fields and sends no credentials', async t => {
  let seen = 0;
  const url = await endpoint(t, (request, response) => {
    seen++;
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/plugins/cost-meter/status');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ...statusPayload, at: 42, ignored: 'drop this field' }));
  });
  const native = await readNativeLedger({ costMeterUrl: url }, { env: {} });
  assert.equal(seen, 1);
  assert.deepEqual(native.costMeter, statusPayload);
  assert.equal(native.quotaWatch, undefined);
});

test('r40 one unavailable source retains the independently read source and reports the failure', async t => {
  const url = await endpoint(t, (_request, response) => response.end(JSON.stringify(statusPayload)));
  const { file } = await fixture('missing.json');
  const native = await readNativeLedger({ quotaWatchFile: file, costMeterUrl: url }, { env: {} });
  assert.equal(native.ok, false);
  assert.match(native.reason, /文件不存在/);
  assert.deepEqual(native.costMeter, statusPayload);
  assert.equal(native.quotaWatch, undefined);
});

test('r40 configured ledger extension returns native sources alongside the priced event ledger', async t => {
  const url = await endpoint(t, (_request, response) => response.end(JSON.stringify(statusPayload)));
  const tsMs = Date.parse('2026-11-19T01:00:00Z');
  const { file } = await fixture('quota-watch.json', JSON.stringify([{ t: tsMs, p: 'deepseek', c: 0.5 }]));
  const handler = createHandler({
    hubConfig: { nativeLedger: { quotaWatchFile: file, costMeterUrl: url } },
    priceBook: createNativePriceBook(),
    now: () => tsMs,
    utcOffsetMinutes: 540,
    ledger: { readRows: async () => [{
      kind: 'call', channel: 'deepseek-official', model: 'deepseek-v4-flash', tsMs, bot: 'a', sessionId: 's',
      tokens: { input: 1000000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    }] },
  });
  const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  assert.equal(await handler({ method: 'GET', url: '/ledger', headers: {} }, response), true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.native.costMeter, statusPayload);
  assert.equal(response.body.native.quotaWatch.totalUsd, 0.5);
  assert.equal(response.body.native.quotaWatch.calls, 1);
  assert.equal(response.body.total.cost.byCurrency.CNY.ok, 2);
  assert.equal(response.body.total.calls, 1);
});

test('r40 malformed cost-meter data and HTTP errors stay visible as concrete reasons', async t => {
  const url = await endpoint(t, (request, response) => {
    if (request.url === '/unavailable') response.writeHead(503);
    response.end(request.url === '/invalid-json' ? '{' : '{}');
  });
  for (const pathname of ['/invalid-json', '/wrong-shape', '/unavailable']) {
    const target = new URL(pathname, url).href;
    const result = await readNativeLedger({ costMeterUrl: target }, { env: {} });
    assert.equal(result.ok, false);
    assert.match(result.reason, pathname === '/unavailable' ? /接口不通/ : /格式不对/);
    assert.equal(result.costMeter, undefined);
  }
});

test('r40 redirects are refused without requesting their target', async t => {
  let targetReads = 0;
  const url = await endpoint(t, (request, response) => {
    if (request.url === '/target') {
      targetReads++;
      response.end(JSON.stringify(statusPayload));
      return;
    }
    response.writeHead(302, { location: '/target' });
    response.end();
  });
  const result = await readNativeLedger({ costMeterUrl: url }, { env: {} });
  assert.equal(result.ok, false);
  assert.match(result.reason, /接口不通/);
  assert.equal(targetReads, 0);
});

test('r40 an unresponsive cost-meter stops after the three-second deadline', async t => {
  const url = await endpoint(t, () => {});
  const start = performance.now();
  const result = await readNativeLedger({ costMeterUrl: url }, { env: {} });
  const elapsed = performance.now() - start;
  assert.equal(result.ok, false);
  assert.match(result.reason, /超时/);
  assert.ok(elapsed >= 2500 && elapsed < 5000, `elapsed ${elapsed}ms`);
});
