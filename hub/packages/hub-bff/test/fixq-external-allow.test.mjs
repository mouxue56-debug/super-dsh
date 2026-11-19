// 配了 board.externals：名单外的令牌不再认，候选人也不再带上。没配名单时仍只认令牌。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createBoard } from '../lib/board.mjs';
import { createHandler } from '../lib/ext/board.mjs';
import { issueToken } from '../lib/board-tokens.mjs';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'fixq-allow-'));
  const configDir = join(dir, 'cfg');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const board = createBoard({ root: join(dir, 'board'), reservedNames: ['owner'] });
  const tokens = {};
  for (const name of ['codex', 'grok']) {
    tokens[name] = (await issueToken(configDir, { name, scope: 'work' })).token;
  }
  const handlerFor = hubConfig => createHandler({
    board, configDir, hubConfig, roster: { list: () => [] },
    isTrusted: request => request.headers.trusted === 'yes',
  });
  const call = async (handler, { url, token, trusted = false }) => {
    const req = Readable.from([]);
    Object.assign(req, {
      url, method: 'GET',
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(trusted ? { trusted: 'yes' } : {}) },
    });
    const res = { text: '', headers: {} };
    res.setHeader = (key, value) => { res.headers[key] = value; };
    res.writeHead = status => { res.status = status; };
    res.end = text => { res.text += text ?? ''; };
    await handler(req, res);
    return { status: res.status, body: res.text ? JSON.parse(res.text) : undefined };
  };
  return { tokens, handlerFor, call };
}

test('显式名单拿掉的外部身份令牌被拒，且不再出现在候选人里', async () => {
  const h = await setup();
  const listed = h.handlerFor({ board: { externals: ['grok'] } });
  const removed = await h.call(listed, { url: '/board/whoami', token: h.tokens.codex });
  const kept = await h.call(listed, { url: '/board/whoami', token: h.tokens.grok });
  assert.equal(removed.status, 401);
  assert.equal(kept.status, 200);
  assert.equal(kept.body.name, 'grok');
  const people = await h.call(listed, { url: '/board/people', trusted: true });
  assert.deepEqual(people.body.people.filter(person => person.type === 'external').map(person => person.id), ['grok']);
});

test('没配外部名单时，有效令牌仍可使用，候选人仍是已发令牌的名字', async () => {
  const h = await setup();
  const open = h.handlerFor({});
  const who = await h.call(open, { url: '/board/whoami', token: h.tokens.codex });
  assert.equal(who.status, 200);
  assert.equal(who.body.name, 'codex');
  const people = await h.call(open, { url: '/board/people', trusted: true });
  assert.deepEqual(people.body.people.filter(person => person.type === 'external').map(person => person.id).sort(), ['codex', 'grok']);
});

test('显式名单为空时，已发令牌也不再算外部身份', async () => {
  const h = await setup();
  const empty = h.handlerFor({ board: { externals: [] } });
  assert.equal((await h.call(empty, { url: '/board/whoami', token: h.tokens.codex })).status, 401);
  const people = await h.call(empty, { url: '/board/people', trusted: true });
  assert.deepEqual(people.body.people.filter(person => person.type === 'external'), []);
});
