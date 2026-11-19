import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { loadExtensions, readHubYaml, configuredPath, utcOffsetMinutes, loadPriceBook } from '../lib/ext/index.mjs';
import { createHandler as boardHandler } from '../lib/ext/board.mjs';
import { createHandler as ledgerHandler } from '../lib/ext/ledger.mjs';
import { createBoard } from '../lib/board.mjs';
import { issueToken } from '../lib/board-tokens.mjs';
import { createLedger } from '../lib/ledger.mjs';

async function directory() {
  return mkdtemp(join(tmpdir(), 'ext-test-'));
}

async function request(handler, url, { method = 'GET', headers = {}, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.url = url;
  req.method = method;
  req.headers = headers;
  const res = { headers: {}, headersSent: false, text: '' };
  res.setHeader = (key, value) => {
    res.headers[key.toLowerCase()] = value;
  };
  res.writeHead = (status, values = {}) => {
    res.status = status;
    res.headersSent = true;
    for (const [key, value] of Object.entries(values)) {
      res.headers[key.toLowerCase()] = value;
    }
  };
  res.end = text => {
    res.text += text ?? '';
  };
  const handled = await handler(req, res);
  return { handled, ...res, body: res.text ? JSON.parse(res.text) : undefined };
}

const quiet = { error() {} };

test('missing directory returns an empty router', async () => {
  const dir = join(await directory(), 'missing');
  const ext = await loadExtensions({ dir, deps: {}, logger: quiet });
  assert.deepEqual(ext.names, []);
  const result = await request((req, res) => ext.handle(req, res, 'private'), '/alpha');
  assert.equal(result.handled, false);
});

test('loader filters files, isolates failures and runs lifecycle hooks', async () => {
  const dir = await directory();
  const deps = { events: [] };
  const alpha = [
    'export function createHandler(deps) {',
    '  deps.events.push(deps);',
    '  return async (req, res) => {',
    '    res.writeHead(200);',
    "    res.end('{}');",
    '    return true;',
    '  };',
    '}',
    "export function start(deps) {",
    "  deps.events.push('start');",
    "}",
    "export function stop() {",
    "  globalThis.__extStopCount++;",
    "}",
  ].join('\n');
  await writeFile(join(dir, 'alpha.mjs'), alpha);
  await writeFile(join(dir, 'broken.mjs'), "throw Error('failure');\n");
  await writeFile(join(dir, 'nohandler.mjs'), 'export const value = 1;\n');
  await writeFile(join(dir, 'index.mjs'), "throw Error('ignored');\n");
  await writeFile(join(dir, 'Bad_Name.mjs'), "throw Error('ignored');\n");
  await symlink(join(dir, 'alpha.mjs'), join(dir, 'link.mjs'));
  globalThis.__extStopCount = 0;
  const errors = [];
  const ext = await loadExtensions({ dir, deps, logger: { error: value => errors.push(value) } });
  assert.deepEqual(ext.names, ['alpha']);
  assert.deepEqual(ext.failed.map(item => item.name), ['broken', 'nohandler']);
  assert.equal(errors.length, 2);
  assert.equal(deps.events[0], deps);
  const handle = (req, res) => ext.handle(req, res, 'private');
  assert.equal((await request(handle, '/alpha/x')).status, 200);
  assert.equal((await request(handle, '/alphabet')).handled, false);
  assert.equal((await request(handle, '/bff/alpha')).handled, false);
  await ext.start();
  await ext.stop();
  assert.equal(deps.events.filter(value => value === 'start').length, 1);
  assert.equal(globalThis.__extStopCount, 1);
  const limited = await loadExtensions({ dir, deps: {}, only: ['broken'], logger: quiet });
  assert.deepEqual(limited.failed.map(item => item.name), ['broken']);
});

test('handler failure produces sanitized 500', async () => {
  const dir = await directory();
  const source = ['export const createHandler = () => async () => {', '  throw Error();', '};'].join('\n');
  await writeFile(join(dir, 'bad.mjs'), source);
  const errors = [];
  const ext = await loadExtensions({ dir, deps: {}, logger: { error: value => errors.push(value) } });
  const result = await request((req, res) => ext.handle(req, res, 'private'), '/bad');
  assert.equal(result.handled, true);
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'EXTENSION_FAILURE');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(errors, ['HUB_EXT_FAILURE bad']);
});

test('stages and matches respect authentication ownership', async () => {
  const dir = await directory();
  const source = [
    'export const createHandler = deps => async () => {',
    '  deps.count++;',
    '  return true;',
    '};',
  ].join('\n');
  await writeFile(join(dir, 'board.mjs'), source);
  await writeFile(join(dir, 'other.mjs'), source);
  const deps = { count: 0 };
  const ext = await loadExtensions({ dir, deps });
  for (const [path, stage, expected] of [
    ['/board/x', 'public', true],
    ['/board/x', 'private', false],
    ['/other', 'public', false],
    ['/other', 'private', true],
    ['/bff/board', 'public', false],
  ]) {
    assert.equal(ext.matches(path, stage), expected);
    assert.equal((await request((req, res) => ext.handle(req, res, stage), path)).handled, expected);
  }
  assert.equal(deps.count, 2);
});

test('configuration, paths, time zones and price tables', async () => {
  const dir = await directory();
  const now = Date.now();
  assert.equal(utcOffsetMinutes('Asia/Tokyo', now), 540);
  assert.equal(utcOffsetMinutes('UTC', now), 0);
  assert.equal(utcOffsetMinutes('invalid/zone', now), -new Date(now).getTimezoneOffset());
  assert.deepEqual(readHubYaml(dir), {});
  await writeFile(join(dir, 'hub.yaml'), 'version: 1\nsetting: {"enabled":true}\n');
  assert.deepEqual(readHubYaml(dir), { version: 1, setting: { enabled: true } });
  await writeFile(join(dir, 'hub.yaml'), 'bad: secret invalid text\n');
  assert.throws(() => readHubYaml(dir), error => !error.message.includes('secret'));
  assert.equal(configuredPath('~/x', { home: dir, hubHome: dir }), join(dir, 'x'));
  assert.equal(configuredPath('$HUB_HOME/x', { home: dir, hubHome: dir }), join(dir, 'x'));
  assert.equal(configuredPath('relative', { home: dir, hubHome: dir }), undefined);
  const errors = [];
  const logger = { error: value => errors.push(value) };
  assert.equal(loadPriceBook(join(dir, 'missing'), logger).find('x', 'y'), undefined);
  assert.deepEqual(errors, []);
  const price = join(dir, 'price');
  await writeFile(price, 'broken price data');
  assert.equal(loadPriceBook(price, logger).find('x', 'y'), undefined);
  assert.deepEqual(errors, ['HUB_PRICE_TABLE_INVALID']);
});

test('board authentication and owner read-only access preserve legacy tickets', async () => {
  const dir = await directory();
  const configDir = join(dir, 'config');
  const legacyDir = join(dir, 'legacy');
  const board = createBoard({ root: join(dir, 'board'), legacyDir });
  const handler = boardHandler({ board, configDir, isTrusted: req => req.headers.trusted === 'yes' });
  const reader = (await issueToken(configDir, { name: 'reader', scope: 'read' })).token;
  const maker = (await issueToken(configDir, { name: 'maker', scope: 'work+create' })).token;
  const auth = token => ({ authorization: `Bearer ${token}` });
  assert.equal((await request(handler, '/board/tickets')).status, 401);
  assert.equal((await request(handler, '/board/tickets', { method: 'POST', headers: auth(reader) })).status, 403);
  const created = await request(handler, '/board/tickets', {
    method: 'POST',
    headers: auth(maker),
    body: { title: 'Task', goal: 'Goal' },
  });
  assert.equal(created.status, 201);
  const trusted = { trusted: 'yes' };
  const list = await request(handler, '/board/tickets', { headers: trusted });
  assert.equal(list.body.tickets[0].id, created.body.ticket.id);
  const blocked = await request(handler, '/board/anything', { method: 'POST', headers: trusted });
  assert.equal(blocked.status, 405);
  assert.equal(blocked.headers.allow, 'GET');
  assert.equal((await board.list()).length, 1);
  const id = 'T-20260102-030405-0001';
  const legacy = [
    '---',
    `id: ${id}`,
    'kind: delegation',
    'creator: author',
    'assignee: worker',
    'status: done',
    'createdAt: 2026-01-02T03:04:05.000Z',
    'updatedAt: 2026-01-02T03:04:06.000Z',
    'fromSession: abc',
    'toSession: def',
    'steps: 1',
    '---',
    '## 任务',
    'A task',
    '## 进度',
    '- 2026-01-02T03:04:05.000Z started',
    '## 回报',
    'A result',
    '',
  ].join('\n');
  await mkdir(join(legacyDir, 'done'), { recursive: true });
  await writeFile(join(legacyDir, 'done', id + '.md'), legacy);
  const withLegacy = await request(handler, '/board/tickets', { headers: trusted });
  assert.equal(withLegacy.body.tickets.find(ticket => ticket.id === id)?.legacy, true);
  assert.equal((await request(handler, '/board/tickets/%zz', { headers: trusted })).status, 400);
  assert.equal((await request(boardHandler({}), '/board/tickets')).status, 503);
});

test('ledger routes summarize real calls and handle missing ledger', async () => {
  const dir = await directory();
  const ledger = createLedger({ dir });
  const tokens = { input: 1, cacheRead: null, cacheWrite: null, output: null, reasoning: null };
  await ledger.record({ kind: 'call', sessionId: 'one', seq: 1, tokens });
  await ledger.record({ kind: 'call', sessionId: 'two', seq: 1, tokens });
  const handler = ledgerHandler({ ledger });
  assert.equal((await request(handler, '/ledger/session/one')).body.calls, 1);
  assert.equal((await request(handler, '/ledger?from=2020-01-01')).status, 200);
  assert.equal((await request(handler, '/ledger', { method: 'POST' })).status, 405);
  assert.equal((await request(handler, '/ledger/nope')).status, 404);
  assert.equal((await request(ledgerHandler({}), '/ledger')).status, 503);
});
