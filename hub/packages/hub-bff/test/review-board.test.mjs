// 路 10 独立复核（看板、令牌部分）：断言原样；仅把两处超长行折行以满足每行不超过 120。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createBoard } from '../lib/board.mjs';
import { createBoardHandler } from '../lib/board-http.mjs';
import { issueToken, revokeToken, verifyToken } from '../lib/board-tokens.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'r10-'));
const boss = { name: 'boss', type: 'assistant' };
const worker = { name: 'w1', type: 'assistant' };
let seq = 0;
const suffix = () => 'a' + String(seq++ % 1000).padStart(3, '0');
const mk = (opts = {}) => createBoard({ root: tmp(), randomSuffix: suffix, ...opts });
const base = { title: 't', goal: 'g', to: ['w1'] };

// 构造假请求，可携带正文。
function fakeReq(method, url, { token, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'content-length': String(chunks[0].length) } : {}),
  };
  return req;
}
function fakeRes() {
  const r = { status: 0, body: '', headers: {} };
  r.writeHead = (s) => { r.status = s; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = b ?? ''; };
  return r;
}

// ---------- 看板 ----------
test('review-board-http-triple-slash-url-must-not-throw-unauthenticated', async () => {
  const handler = createBoardHandler({ board: mk(), configDir: tmp() });
  const res = fakeRes();
  await assert.doesNotReject(async () => handler({ url: '///', method: 'GET', headers: {} }, res));
});

test('review-board-worker-cannot-verify-before-reporting', async () => {
  const board = mk();
  const t = await board.create(boss, base);
  await board.claim(worker, t.id);
  await assert.rejects(board.verify(worker, t.id, { verdict: 'pass', note: 'ok' }));
});

test('review-board-done-after-send-back-needs-a-new-report', async () => {
  const board = mk();
  const t = await board.create(boss, base);
  await board.claim(worker, t.id);
  await board.report(worker, t.id, { summary: 'first' });
  await board.sendBack(boss, t.id, 'redo');
  await assert.rejects(board.done(worker, t.id));
});

test('review-board-idempotency-key-survives-index-write-failure', async () => {
  let fail = true;
  const board = mk({ __beforeIndexWrite: async () => { if (fail) { fail = false; throw new Error('boom'); } } });
  const input = { ...base, key: 'k-1' };
  await board.createWithMeta(boss, input).catch(() => {});
  await board.createWithMeta(boss, input).catch(() => {});
  assert.equal((await board.list()).length, 1);
});

test('review-board-stale-lock-must-not-give-two-owners', async () => {
  let both = 0;
  // 单独跑：旧锁文件存在时，两个不同工人同时领取同一张单
  for (let i = 0; i < 40; i++) {
    const root = tmp();
    const board = createBoard({ root, randomSuffix: suffix });
    const t = await board.create(boss, { ...base, to: [] });
    const lock = join(root, '.locks', `${t.id}.lock`);
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60000);
    utimesSync(lock, old, old);
    const res = await Promise.allSettled(
      Array.from({ length: 12 }, (_, k) => 'x' + k).map((n) => board.claim({ name: n, type: 'assistant' }, t.id)),
    );
    if (res.filter((r) => r.status === 'fulfilled').length > 1) both++;
  }
  assert.equal(both, 0, '出现过两个人都领到同一张单');
});

test('review-board-external-actor-must-not-act-as-same-named-assistant', async () => {
  const board = mk();
  const t = await board.create(boss, base);
  await board.claim(worker, t.id);
  await board.report(worker, t.id, { summary: 's' });
  await assert.rejects(board.accept({ name: 'boss', type: 'external' }, t.id));
});

test('review-tokens-concurrent-issue-must-not-resurrect-revoked-token', async () => {
  const dir = tmp();
  const { token } = await issueToken(dir, { name: 'a' });
  await Promise.all([revokeToken(dir, 'a'), issueToken(dir, { name: 'b' })]);
  assert.equal(await verifyToken(dir, token), null);
});

test('review-board-read-token-sees-only-own-tickets', async () => {
  const board = mk();
  const configDir = tmp();
  await board.create(boss, base);
  const { token } = await issueToken(configDir, { name: 'spy', scope: 'read' });
  const res = fakeRes();
  await createBoardHandler({ board, configDir })(fakeReq('GET', '/board/tickets', { token }), res);
  assert.equal(JSON.parse(res.body).tickets.length, 0);
});

