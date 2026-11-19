// 看板补充测试（畸形请求、保留名、锁归属、只读令牌按单可见）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createBoard } from '../lib/board.mjs';
import { createBoardHandler } from '../lib/board-http.mjs';
import { issueToken } from '../lib/board-tokens.mjs';
import { withFileLock } from '../lib/board-lock.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'r27a-'));
const boss = { name: 'boss', type: 'assistant' };
let seq = 0;
const suffix = () => 'b' + String(seq++ % 1000).padStart(3, '0');
const mk = (opts = {}) => createBoard({ root: tmp(), randomSuffix: suffix, ...opts });

function fakeReq(method, url, { token, raw, headers = {} } = {}) {
  const req = Readable.from(raw === undefined ? [] : [Buffer.from(raw)]);
  req.method = method;
  req.url = url;
  req.headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers };
  return req;
}
function fakeRes() {
  const r = { status: 0, body: '', headers: {} };
  r.writeHead = (s) => { r.status = s; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = b ?? ''; };
  return r;
}

test('malformed requests always get a 4xx and never throw', async () => {
  const board = mk();
  const configDir = tmp();
  const { token } = await issueToken(configDir, { name: 'ext', scope: 'work+create' });
  const t = await board.create(boss, { title: 't', goal: 'g', to: [] });
  const handler = createBoardHandler({ board, configDir });
  const urls = ['///', '//board', '/board//', '/board/tickets/%zz', '/board/tickets/%00',
    '/board/tickets/' + t.id + '/x', '/board/tickets?state=%E0%A4%A', '/board/tickets?state=nope',
    '/board/' + 'a'.repeat(5000), '/board/tickets/..%2f..'];
  const bodies = ['', 'null', '[]', '"x"', '{', '{"summary":1}', '{"to":{}}', '{"title":{},"goal":[]}', '\u0000'];
  for (const url of urls) {
    for (const method of ['GET', 'POST', 'DELETE']) {
      for (const tok of [token, undefined]) {
        for (const raw of bodies) {
          const res = fakeRes();
          await assert.doesNotReject(handler(fakeReq(method, url, { token: tok, raw }), res));
          if (res.status) assert.ok(res.status < 500, `${method} ${url} -> ${res.status}`);
        }
      }
    }
  }
  for (const op of ['claim', 'progress', 'report', 'block', 'handoff', 'verify', 'answer', 'send_back']) {
    for (const raw of bodies) {
      const res = fakeRes();
      await handler(fakeReq('POST', `/board/tickets/${t.id}/${op}`, { token, raw }), res);
      assert.ok(res.status >= 200 && res.status < 500, `${op} ${raw} -> ${res.status}`);
    }
  }
  const res = fakeRes();
  await handler({ url: undefined, method: undefined, headers: {} }, res);
  assert.ok(res.status === 0 || res.status < 500);
});

test('triple slash url gets a 400 body', async () => {
  const res = fakeRes();
  await createBoardHandler({ board: mk(), configDir: tmp() })({ url: '///', method: 'GET', headers: {} }, res);
  assert.equal(res.status, 400);
});

test('read token cannot fetch a ticket it is not involved in, but sees its own', async () => {
  const board = mk();
  const configDir = tmp();
  const t = await board.create(boss, { title: 't', goal: 'g', to: ['w1'] });
  const spy = (await issueToken(configDir, { name: 'spy', scope: 'read' })).token;
  const w1 = (await issueToken(configDir, { name: 'w1', scope: 'read' })).token;
  const h = createBoardHandler({ board, configDir });
  let res = fakeRes();
  await h(fakeReq('GET', `/board/tickets/${t.id}`, { token: spy }), res);
  assert.equal(res.status, 404);
  res = fakeRes();
  await h(fakeReq('GET', `/board/tickets/${t.id}`, { token: w1 }), res);
  assert.equal(res.status, 200);
});

test('reserved names: external cannot impersonate an assistant, tokens cannot use roster names', async () => {
  const board = mk({ reservedNames: ['boss'] });
  const t = await board.create(boss, { title: 't', goal: 'g', to: ['w1'] });
  const fake = { name: 'boss', type: 'external' };
  await assert.rejects(board.create(fake, { title: 't', goal: 'g' }), { code: 'FORBIDDEN' });
  await assert.rejects(board.claim({ name: 'boss', type: 'external' }, t.id), { code: 'FORBIDDEN' });
  await assert.rejects(issueToken(tmp(), { name: 'boss', reserved: ['boss'] }), /Reserved/);
});

test('an external actor with the claimant name cannot report on an assistant claim', async () => {
  const board = mk();
  const t = await board.create(boss, { title: 't', goal: 'g', to: ['w1'] });
  await board.claim({ name: 'w1', type: 'assistant' }, t.id);
  const fake = { name: 'w1', type: 'external' };
  await assert.rejects(board.report(fake, t.id, { summary: 's' }), { code: 'FORBIDDEN' });
});

test('verify needs a report and a verifier who is not the worker', async () => {
  const board = mk();
  const t = await board.create(boss, { title: 't', goal: 'g', to: ['w1'] });
  const w1 = { name: 'w1', type: 'assistant' };
  await board.claim(w1, t.id);
  await assert.rejects(board.verify({ name: 'v', type: 'assistant' }, t.id, { verdict: 'pass', note: 'n' }));
  await board.report(w1, t.id, { summary: 's' });
  await assert.rejects(board.verify(w1, t.id, { verdict: 'pass', note: 'n' }));
  const done = await board.verify({ name: 'v', type: 'assistant' }, t.id, { verdict: 'pass', note: 'n' });
  assert.equal(done.verification.length, 1);
});

test('file lock: release never removes a lock that now belongs to someone else', async () => {
  const dir = tmp();
  const path = join(dir, 'x.lock');
  await withFileLock(path, async () => {
    writeFileSync(path, 'someone-else');
  });
  assert.ok(existsSync(path));
});

test('file lock: a stale lock is taken over and leaves no debris', async () => {
  const dir = tmp();
  const path = join(dir, 'y.lock');
  writeFileSync(path, 'dead-owner');
  const old = new Date(Date.now() - 60000);
  utimesSync(path, old, old);
  let ran = false;
  await withFileLock(path, async () => { ran = true; });
  assert.ok(ran);
  assert.deepEqual(readdirSync(dir), []);
});

test('file lock: a live lock times out instead of being taken', async () => {
  const dir = tmp();
  const path = join(dir, 'z.lock');
  writeFileSync(path, 'alive');
  await assert.rejects(withFileLock(path, async () => {}, { tries: 3, delayMs: 1 }), { code: 'LOCK_TIMEOUT' });
  assert.ok(existsSync(path));
});
