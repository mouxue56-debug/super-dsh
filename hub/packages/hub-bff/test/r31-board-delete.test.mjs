// 看板「删掉这张」。软删除：搬进 archive/，列表和读取看不到，数据在，旧单和外部身份删不了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHandler as boardHandler } from '../lib/ext/board.mjs';
import { createBoard } from '../lib/board.mjs';
import { issueToken } from '../lib/board-tokens.mjs';

async function call(handler, url, { method = 'GET', headers = { trusted: 'yes' }, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url, method, headers });
  const res = { text: '', headers: {} };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.writeHead = (status, values = {}) => { res.status = status; Object.assign(res.headers, values); };
  res.end = text => { res.text += text ?? ''; };
  await handler(req, res);
  return { status: res.status, body: res.text ? JSON.parse(res.text) : undefined };
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'r31-del-'));
  const configDir = join(dir, 'cfg');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const root = join(dir, 'board');
  const board = createBoard({ root, reservedNames: ['owner', 'writer'] });
  const roster = { list: () => [{ id: 'writer', name: '写作', status: 'active' }] };
  const handler = boardHandler({ board, configDir, roster, isTrusted: req => req.headers.trusted === 'yes' });
  return { board, configDir, handler, root };
}
const make = async (handler, body) =>
  (await call(handler, '/board/tickets/new', { method: 'POST', body })).body.ticket;
const post = (handler, url, body = {}) => call(handler, url, { method: 'POST', body });

test('删掉一张：列表和读取都看不到，文件和历史在 archive/ 里能找回', async () => {
  const { handler, board, root } = await fixture();
  const keep = await make(handler, { title: '留着' });
  const gone = await make(handler, { title: '要删的', goal: '验收 原文不动' });
  const res = await post(handler, '/board/tickets/' + gone.id + '/delete');
  assert.equal(res.status, 200);
  assert.equal(res.body.ticket.id, gone.id);
  const list = (await call(handler, '/board/tickets')).body.tickets;
  assert.deepEqual(list.map(t => t.id), [keep.id]);
  assert.equal((await call(handler, '/board/tickets/' + gone.id)).status, 404);
  assert.deepEqual(await readdir(join(root, 'archive')), [gone.id + '.json']);
  const saved = JSON.parse(await readFile(join(root, 'archive', gone.id + '.json'), 'utf8'));
  assert.equal(saved.goal, '验收 原文不动');
  assert.equal(saved.history.at(-1).action, 'owner_delete');
  assert.equal(saved.history.at(-1).by, 'owner');
  // 找回：把文件搬回 tickets/ 就又出现了。
  await rename(join(root, 'archive', gone.id + '.json'), join(root, 'tickets', gone.id + '.json'));
  assert.equal((await board.get(gone.id)).title, '要删的');
});

test('删不存在的单 404；格式不对 400；删两次第二次 404', async () => {
  const { handler } = await fixture();
  const made = await make(handler, { title: 'x' });
  assert.equal((await post(handler, '/board/tickets/T-20260102-030405-0001/delete')).status, 404);
  assert.equal((await post(handler, '/board/tickets/..%2Fx/delete')).status, 400);
  assert.equal((await post(handler, '/board/tickets/' + made.id + '/delete')).status, 200);
  assert.equal((await post(handler, '/board/tickets/' + made.id + '/delete')).status, 404);
});

test('旧格式单不能删，原文件不动', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r31-legacy-'));
  const legacyDir = join(dir, 'legacy');
  await mkdir(join(legacyDir, 'done'), { recursive: true });
  const id = 'T-20260102-030405-0001';
  const text = `---\nid: ${id}\nkind: delegation\ncreator: author\nassignee: worker\nstatus: done\n` +
    'createdAt: 2026-01-02T03:04:05.000Z\nupdatedAt: 2026-01-02T03:04:06.000Z\n' +
    'fromSession: abc\ntoSession: def\nsteps: 1\n---\n## 任务\nA task\n## 进度\n- 2026-01-02T03:04:05.000Z started\n## 回报\nA result\n';
  await writeFile(join(legacyDir, 'done', id + '.md'), text);
  const board = createBoard({ root: join(dir, 'board'), legacyDir });
  assert.equal((await board.list()).length, 1);
  await assert.rejects(board.ownerArchive({ name: 'owner', type: 'owner' }, id),
    error => error.code === 'CONFLICT');
  assert.equal(await readFile(join(legacyDir, 'done', id + '.md'), 'utf8'), text);
  assert.equal((await board.list()).length, 1);
});

test('只有主人身份能删：助理、外部令牌、没有可信标记都不行，单还在', async () => {
  const { handler, board, configDir } = await fixture();
  const ticket = await make(handler, { title: '别人删不掉' });
  await assert.rejects(board.ownerArchive({ name: 'writer', type: 'assistant' }, ticket.id),
    error => error.code === 'FORBIDDEN');
  await assert.rejects(board.ownerArchive({ name: 'x', type: 'external' }, ticket.id),
    error => error.code === 'FORBIDDEN');
  const { token } = await issueToken(configDir, { name: 'pm-agent', scope: 'work+create', reserved: ['owner'] });
  const viaToken = await call(handler, '/board/tickets/' + ticket.id + '/delete',
    { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: {} });
  assert.ok([401, 403, 404, 405].includes(viaToken.status), String(viaToken.status));
  assert.equal((await call(handler, '/board/tickets/' + ticket.id, { headers: {} })).status, 401);
  assert.equal((await post(handler, '/board/tickets/' + ticket.id + '/delete')).status, 200);
});

test('带幂等键的单删掉后，同键再建得到新单而不是报错', async () => {
  const { board } = await fixture();
  const will = { name: 'owner', type: 'owner' };
  const first = await board.create(will, { title: 'k', goal: 'g', key: 'same-key' });
  await board.ownerArchive(will, first.id);
  const again = await board.create(will, { title: 'k', goal: 'g', key: 'same-key' });
  assert.notEqual(again.id, first.id);
  assert.equal((await board.list()).length, 1);
});
