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

async function fixture(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'r30-board-'));
  const configDir = join(dir, 'cfg');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const board = createBoard({ root: join(dir, 'board'), reservedNames: ['owner', 'writer', 'artist'], ...options });
  const roster = { list: () => [{ id: 'writer', name: '写作', status: 'active' },
    { id: 'artist', name: '画画', status: 'active' }, { id: 'old', name: '旧的', status: 'paused' }] };
  const handler = boardHandler({ board, configDir, roster, isTrusted: req => req.headers.trusted === 'yes' });
  return { board, configDir, handler };
}
const make = async (handler, body) =>
  (await call(handler, '/board/tickets/new', { method: 'POST', body })).body.ticket;
const post = (handler, url, body) => call(handler, url, { method: 'POST', body });

test('主人新建一张卡并指定负责人', async () => {
  const { handler, board } = await fixture();
  const made = await call(handler, '/board/tickets/new',
    { method: 'POST', body: { title: '整理相册', to: 'writer' } });
  assert.equal(made.status, 201);
  assert.equal(made.body.ticket.title, '整理相册');
  assert.deepEqual(made.body.ticket.to, ['writer']);
  assert.equal(made.body.ticket.from.type, 'owner');
  assert.equal(made.body.ticket.state, 'queued');
  assert.equal((await board.list()).length, 1);
  assert.equal((await post(handler, '/board/tickets/new', { title: '   ' })).status, 400);
});

test('挪列：五列都能到，来回挪状态一致', async () => {
  const { handler } = await fixture();
  const ticket = await make(handler, { title: 'a', to: 'writer' });
  const move = async column =>
    (await post(handler, '/board/tickets/' + ticket.id + '/move', { column })).body.ticket;
  let t = await move('progress');
  assert.equal(t.state, 'progress');
  assert.equal(t.claimedBy, 'writer');
  t = await move('review');
  assert.equal(t.state, 'progress');
  assert.equal(t.review, 'submitted');
  t = await move('attention');
  assert.equal(t.state, 'waiting-human');
  assert.ok(t.open_ask.text);
  t = await move('done');
  assert.equal(t.state, 'completed');
  t = await move('queued');
  assert.equal(t.state, 'queued');
  assert.equal(t.claimedBy, null);
  assert.equal(t.review, 'none');
  assert.equal(t.open_ask, null);
  assert.ok(t.history.some(h => h.action === 'owner_move' && h.by === 'owner'));
  assert.equal((await post(handler, '/board/tickets/' + ticket.id + '/move', { column: 'x' })).status, 400);
});

// 默认情况下没负责人的卡拖到「在做」会请首席安排（见 r38-trigger.test.mjs）；
// 这条测的是配置 board.arrange.on_drag: false 关掉之后的旧行为（主人本人接手）。
test('没指定人的单挪到在做由主人本人接手；完成时顺带验收已交回的', async () => {
  const { handler } = await fixture({ arrangeOnDrag: false });
  const ticket = await make(handler, { title: 'b' });
  const url = '/board/tickets/' + ticket.id + '/move';
  const doing = (await post(handler, url, { column: 'progress' })).body.ticket;
  assert.equal(doing.claimedBy, 'owner');
  assert.equal(doing.claimedByType, 'owner');
  await post(handler, url, { column: 'review' });
  const done = (await post(handler, url, { column: 'done' })).body.ticket;
  assert.equal(done.state, 'completed');
  assert.equal(done.review, 'accepted');
});

test('换负责人：待领只改候选；在做的同时换接手人；结束的不让换；可清空', async () => {
  const { handler } = await fixture();
  const ticket = await make(handler, { title: 'c' });
  const base = '/board/tickets/' + ticket.id;
  let t = (await post(handler, base + '/assign', { assignee: 'writer' })).body.ticket;
  assert.deepEqual(t.to, ['writer']);
  assert.equal(t.claimedBy, null);
  await post(handler, base + '/move', { column: 'progress' });
  t = (await post(handler, base + '/assign', { assignee: 'pm-agent', assigneeType: 'external' })).body.ticket;
  assert.deepEqual(t.to, ['pm-agent']);
  assert.equal(t.claimedBy, 'pm-agent');
  assert.equal(t.claimedByType, 'external');
  t = (await post(handler, base + '/assign', { assignee: null })).body.ticket;
  assert.deepEqual(t.to, []);
  assert.equal(t.state, 'queued');
  await post(handler, base + '/move', { column: 'done' });
  assert.equal((await post(handler, base + '/assign', { assignee: 'writer' })).status, 409);
  assert.equal((await post(handler, base + '/assign', { assignee: '../x' })).status, 400);
});

test('改标题和说明：空的、过长的拒绝；只改一项也行', async () => {
  const { handler } = await fixture();
  const ticket = await make(handler, { title: 'd', goal: 'g' });
  const url = '/board/tickets/' + ticket.id + '/edit';
  let t = (await post(handler, url, { title: '新标题' })).body.ticket;
  assert.equal(t.title, '新标题');
  assert.equal(t.goal, 'g');
  t = (await post(handler, url, { goal: '新的说明' })).body.ticket;
  assert.equal(t.goal, '新的说明');
  assert.equal((await post(handler, url, { title: '  ' })).status, 400);
  assert.equal((await post(handler, url, {})).status, 400);
  assert.equal((await post(handler, url, { goal: 'x'.repeat(4001) })).status, 400);
  assert.equal((await call(handler, url, { method: 'POST', raw: '{bad' })).status, 400);
});

test('旧格式或不存在的单不能改', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r30-legacy-'));
  const board = createBoard({ root: join(dir, 'board') });
  await assert.rejects(board.ownerMove({ name: 'owner', type: 'owner' }, 'T-20260102-030405-0001', 'done'),
    error => error.code === 'NOT_FOUND');
});

test('只有主人身份能用这三个动作；外部令牌走不通', async () => {
  const { handler, board, configDir } = await fixture();
  const ticket = await make(handler, { title: 'e' });
  await assert.rejects(board.ownerMove({ name: 'writer', type: 'assistant' }, ticket.id, 'done'),
    error => error.code === 'FORBIDDEN');
  await assert.rejects(board.ownerAssign({ name: 'x', type: 'external' }, ticket.id, 'writer'),
    error => error.code === 'FORBIDDEN');
  await assert.rejects(board.ownerEdit({ name: 'x', type: 'external' }, ticket.id, { title: 'z' }),
    error => error.code === 'FORBIDDEN');
  const { token } = await issueToken(configDir, { name: 'pm-agent', scope: 'work+create', reserved: ['owner'] });
  const viaToken = await call(handler, '/board/tickets/' + ticket.id + '/move',
    { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: { column: 'done' } });
  assert.equal(viaToken.status, 404);
  assert.equal((await board.get(ticket.id)).state, 'queued');
});

test('可派给谁：在用的助理加有效的外部身份，撤销后消失，不露令牌内容', async () => {
  const { handler, configDir } = await fixture();
  await issueToken(configDir, { name: 'pm-agent', scope: 'work', reserved: ['owner'] });
  await issueToken(configDir, { name: 'gone-agent', scope: 'read', reserved: ['owner'] });
  await revokeToken(configDir, 'gone-agent');
  const result = await call(handler, '/board/people');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.people.map(p => p.id), ['writer', 'artist', 'pm-agent']);
  assert.equal(result.body.people[2].type, 'external');
  assert.doesNotMatch(JSON.stringify(result.body), /hash|dsb_/u);
});

test('没有可信标记的请求按令牌规则处理', async () => {
  const { handler } = await fixture();
  assert.equal((await call(handler, '/board/people', { headers: {} })).status, 401);
  const anon = await call(handler, '/board/tickets/new', { method: 'POST', headers: {}, body: { title: 'x' } });
  assert.equal(anon.status, 401);
});
