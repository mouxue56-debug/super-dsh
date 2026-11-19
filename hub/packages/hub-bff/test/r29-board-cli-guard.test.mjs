import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createBoard } from '../lib/board.mjs';
import { createBoardHandler } from '../lib/board-http.mjs';
import { issueToken } from '../lib/board-tokens.mjs';
import { main } from '../bin/hub-board.mjs';
import { main as triggers } from '../lib/board-triggers.mjs';

const sender = { name: 'sender', type: 'assistant' };

function fakeReq(method, url, { token, raw } = {}) {
  const req = Readable.from(raw === undefined ? [] : [Buffer.from(raw)]);
  req.method = method;
  req.url = url;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  return req;
}

function fakeRes() {
  const res = { status: 0, body: '' };
  res.writeHead = status => { res.status = status; };
  res.setHeader = () => {};
  res.end = body => { res.body = body ?? ''; };
  return res;
}

async function scene() {
  const root = await mkdtemp(join(tmpdir(), 'r29-guard-'));
  const configDir = await mkdtemp(join(tmpdir(), 'r29-guard-tok-'));
  const board = createBoard({ root, reservedNames: ['owner'], randomSuffix: 'abcd' });
  const handler = createBoardHandler({ board, configDir, reservedNames: () => ['owner'] });
  const issue = (name, scope) => issueToken(configDir, { name, scope, reserved: ['owner'] });
  return { board, handler, issue };
}

async function call(handler, method, url, token, raw) {
  const res = fakeRes();
  await handler(fakeReq(method, url, { token, raw }), res);
  return { status: res.status, body: res.body ? JSON.parse(res.body) : {} };
}

test('外部 agent 不能领、不能改派给别人的单', async () => {
  const { board, handler, issue } = await scene();
  const ticket = await board.create(sender, { title: '别人的活', goal: '不要动', to: ['agent-b'] });
  const tokenA = (await issue('agent-a', 'work')).token;
  const tokenB = (await issue('agent-b', 'work')).token;
  const path = `/board/tickets/${ticket.id}`;
  assert.equal((await call(handler, 'POST', `${path}/claim`, tokenA, '{}')).status, 403);
  for (const [op, raw] of [
    ['progress', '{"text":"动手了"}'],
    ['report', '{"summary":"做完了"}'],
    ['done', '{}'],
    ['block', '{"reason":"卡住了","waitHuman":true}'],
  ]) {
    assert.equal((await call(handler, 'POST', `${path}/${op}`, tokenA, raw)).status, 403, op);
  }
  const claimed = await call(handler, 'POST', `${path}/claim`, tokenB, '{}');
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.ticket.claimedBy, 'agent-b');
  assert.equal((await call(handler, 'POST', `${path}/progress`, tokenA, '{"text":"还想改"}')).status, 403);
  const progress = await call(handler, 'POST', `${path}/progress`, tokenB, '{"text":"继续"}');
  assert.equal(progress.status, 200);
});

test('不能冒充主人：签不出这个名字，请求体里的身份也不算', async () => {
  const { board, handler, issue } = await scene();
  await assert.rejects(issue('owner', 'work'), /Reserved/);
  await assert.rejects(
    board.create({ name: 'owner', type: 'external' }, { title: '冒充', goal: '不行', to: ['agent-a'] }),
    error => error.code === 'FORBIDDEN',
  );
  const ticket = await board.create(sender, { title: '自己的活', goal: '领走', to: ['agent-a'] });
  const token = (await issue('agent-a', 'work')).token;
  const who = await call(handler, 'GET', '/board/whoami', token);
  assert.deepEqual(who.body, { name: 'agent-a', scope: 'work' });
  const forged = await call(
    handler, 'POST', `/board/tickets/${ticket.id}/claim`, token,
    '{"actor":{"name":"owner","type":"owner"}}',
  );
  assert.equal(forged.status, 200);
  assert.equal(forged.body.ticket.claimedBy, 'agent-a');
  assert.equal(forged.body.ticket.claimedByType, 'external');
});

test('命令行和触发器都不能把单派给主人去确认', async () => {
  const requests = [];
  const io = {
    stdout: { write() {} },
    stderr: { write() {} },
    fetch: async () => { requests.push('fetch'); return { ok: true, json: async () => ({}) }; },
  };
  const env = { HUB_BOARD_URL: 'http://localhost/board', HUB_BOARD_TOKEN: 'dsb_test_secret' };
  assert.equal(await main(['create', 'owner'], env, io), 2);
  const dir = await mkdtemp(join(tmpdir(), 'r29-owner-'));
  const file = join(dir, 'rules.json');
  await writeFile(file, JSON.stringify({
    version: 1,
    rules: [{
      id: 'ask-owner',
      when: { kind: 'daily', at: '09:00' },
      ticket: { title: '请确认', goal: '点一下', to: ['agent-a', 'owner'], key: 'ask-owner' },
    }],
  }));
  assert.equal(await triggers(['--rules', file], env, io), 2);
  assert.equal(requests.length, 0);
});
