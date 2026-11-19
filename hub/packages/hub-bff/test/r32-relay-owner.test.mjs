// · 接力：主人接口——新建接力、放行、退回、回答卡住的问题、改后几棒；外部令牌走不通。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHandler as boardHandler } from '../lib/ext/board.mjs';
import { createBoard } from '../lib/board.mjs';
import { issueToken, revokeToken } from '../lib/board-tokens.mjs';

async function call(handler, url, { method = 'GET', headers = { trusted: 'yes' }, body, raw } = {}) {
  const chunks = raw !== undefined ? [Buffer.from(raw)] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  Object.assign(req, { url, method, headers });
  const res = { text: '', headers: {} };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.writeHead = (status, values = {}) => { res.status = status; Object.assign(res.headers, values); };
  res.end = text => { res.text += text ?? ''; };
  await handler(req, res);
  return { status: res.status, body: res.text ? JSON.parse(res.text) : undefined };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'r30-board-'));
  const configDir = join(dir, 'cfg');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const board = createBoard({ root: join(dir, 'board'), reservedNames: ['owner', 'writer', 'artist'] });
  const roster = { list: () => [{ id: 'writer', name: '写作', status: 'active' },
    { id: 'artist', name: '画画', status: 'active' }, { id: 'old', name: '旧的', status: 'disabled' }] };
  await issueToken(configDir, { name: 'agent-x', scope: 'work', reserved: ['owner', 'writer', 'artist'] });
  const handler = boardHandler({ board, configDir, roster, isTrusted: req => req.headers.trusted === 'yes' });
  return { board, configDir, handler };
}
const post = (handler, url, body) => call(handler, url, { method: 'POST', body });
const S = (who, task, extra = {}) => ({ who, task, doneWhen: '交一份', ...extra });

test('主人新建一条接力：谁接按名册和外部名单认；坏路线、停用的人、不认识的人都拒；卡一建好第 1 棒已交给对方', async () => {
  const { handler, board } = await fixture();
  const made = await post(handler, '/board/tickets/new', { title: '活动筹备', goal: '把活动办起来',
    relay: { steps: [S('writer', '写方案'), S('agent-x', '做出图', { gate: true }), S('owner', '你看一眼')] } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const t = made.body.ticket;
  assert.deepEqual(t.relay.steps.map(s => [s.who.name, s.who.type]), [['writer', 'assistant'], ['agent-x', 'external'], ['owner', 'owner']]);
  assert.deepEqual([t.state, t.claimedBy, t.from.type], ['progress', 'writer', 'owner']);
  assert.equal((await board.list()).length, 1);
  for (const steps of [[S('writer', 'a')], [S('old', 'a'), S('writer', 'b')], [S('路人', 'a'), S('writer', 'b')],
    [S('owner', 'a'), S('writer', 'b')], [S('writer', ''), S('artist', 'b')], 'x']) {
    assert.equal((await post(handler, '/board/tickets/new', { title: 't', relay: { steps } })).status, 400, JSON.stringify(steps));
  }
  assert.equal((await post(handler, '/board/tickets/new', { title: '', relay: { steps: [S('writer', 'a'), S('artist', 'b')] } })).status, 400);
});

test('主人放行、退回重做、回答卡住的问题、改后几棒；换人和转手被拒（要改路线）', async () => {
  const { handler, board } = await fixture();
  const t = (await post(handler, '/board/tickets/new', { title: 'x', relay: { steps: [S('writer', 'a', { gate: true }),
    S('artist', 'b'), S('writer', 'c')] } })).body.ticket;
  const W = { name: 'writer', type: 'assistant' };
  await board.relayDeliver(W, t.id, '好了');
  const url = '/board/tickets/' + t.id + '/relay';
  assert.equal((await post(handler, url, { action: 'nope' })).status, 400);
  const redo = await post(handler, url, { action: 'redo', text: '再改改' });
  assert.equal(redo.body.ticket.relay.phase, 'running');
  assert.equal(redo.body.ticket.relay.steps[0].returnedNote, '再改改');
  await board.relayDeliver(W, t.id, '改好了');
  const rel = await post(handler, url, { action: 'release' });
  assert.equal(rel.body.ticket.relay.current, 1);
  assert.equal((await post(handler, url, { action: 'release' })).status, 409, '不在等你上的卡不能放行');
  const rer = await post(handler, url, { action: 'reroute', steps: [S('writer', '收尾一')] });
  assert.equal(rer.body.ticket.relay.steps.length, 3);
  assert.equal(rer.body.ticket.relay.steps[2].task, '收尾一');
  assert.equal((await post(handler, url, { action: 'reroute', steps: [S('路人', 'x')] })).status, 400);
  assert.equal((await post(handler, '/board/tickets/' + t.id + '/assign', { assignee: 'writer', assigneeType: 'assistant' })).status, 409);
  await board.relayStuck({ name: 'artist', type: 'assistant' }, t.id, '缺素材');
  const ans = await post(handler, url, { action: 'answer', text: '素材在网盘' });
  assert.equal(ans.body.ticket.state, 'progress');
  assert.equal((await board.relaySync(t.id)).ticket.relay.phase, 'running');
});

test('外部令牌走不通主人接口，也不能借建卡接口塞进自己写的路线', async () => {
  const { handler, configDir } = await fixture();
  const { token } = await issueToken(configDir, { name: 'agent-y', scope: 'work+create', reserved: ['owner', 'writer', 'artist'] });
  const asExternal = (url, body) => call(handler, url, { method: 'POST', headers: { authorization: 'Bearer ' + token }, body });
  assert.notEqual((await asExternal('/board/tickets/new', { title: 't', relay: { steps: [S('writer', 'a'), S('artist', 'b')] } })).status, 201);
  const made = await asExternal('/board/tickets', { title: '普通卡', goal: 'g', relay: { v: 1, phase: 'final', current: 2, steps: [] } });
  assert.equal(made.status, 201);
  assert.equal(made.body.ticket.relay, undefined);
  const id = made.body.ticket.id;
  assert.ok([403, 404, 405].includes((await asExternal('/board/tickets/' + id + '/relay', { action: 'release' })).status));
});
