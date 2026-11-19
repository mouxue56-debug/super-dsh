// · 外部身份只能碰自己名下的卡：领单、读取、列表、追加进度、交回、标卡住都按身份校验；
// 外部交回的卡由主人点完成（external_accept 默认 owner）；接单身份失效时今天页提示。
// 真看板 + 真 HTTP 处理器 + 真命令行；临时目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createBoard } from '../lib/board.mjs';
import { createBoardHandler } from '../lib/board-http.mjs';
import { issueToken, revokeToken } from '../lib/board-tokens.mjs';
import { buildToday } from '../lib/today.mjs';
import { main } from '../bin/hub-handoff.mjs';

const OWNER = { name: 'owner', type: 'owner' };
const CHIEF = { name: 'chief', type: 'assistant' };
const EXT = n => ({ name: n, type: 'external' });
const RESERVED = ['owner', 'chief', 'research'];

async function setup({ ownerAcceptExternal } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'r37-'));
  const configDir = join(dir, 'cfg');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const board = createBoard({ root: join(dir, 'board'), reservedNames: RESERVED,
    ...(ownerAcceptExternal === undefined ? {} : { ownerAcceptExternal }) });
  const tokens = {};
  for (const n of ['codex', 'grok']) tokens[n] = (await issueToken(configDir, { name: n, scope: 'work+create' })).token;
  tokens.viewer = (await issueToken(configDir, { name: 'viewer', scope: 'read' })).token;
  const server = http.createServer((req, res) => {
    createBoardHandler({ board, configDir, prefix: '/board', reservedNames: () => RESERVED })(req, res)
      .then(done => done || res.end());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/board`;
  const api = (who, method, path, body) => fetch(base + path, { method, headers: { Authorization: 'Bearer ' + tokens[who],
    'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    .then(async r => ({ status: r.status, body: await r.json() }));
  const cli = async (who, argv) => {
    let out = '', err = '';
    const code = await main(argv, { HUB_BOARD_URL: base, HUB_BOARD_TOKEN: tokens[who] },
      { stdout: { write: t => { out += t; } }, stderr: { write: t => { err += t; } } });
    return { code, out, err };
  };
  return { dir, configDir, board, tokens, api, cli, close: () => server.close() };
}
const plain = (board, extra = {}) => board.create(OWNER, { title: '普通卡', goal: '没写负责人', ...extra });
const assigned = (board, who = 'codex') => board.create(OWNER, { title: '派给它', goal: '做一下', to: [who] });
const open = (board) => board.openCreate(OWNER, { title: '开放卡', goal: '谁有空谁接' });

test('越权被拒：外部身份不能领没写负责人的普通卡（板层与 HTTP 都拒）', async () => {
  const h = await setup();
  try {
    const t = await plain(h.board);
    await assert.rejects(() => h.board.claim(EXT('codex'), t.id), { code: 'FORBIDDEN' });
    const res = await h.api('codex', 'POST', `/tickets/${t.id}/claim`, {});
    assert.equal(res.status, 403);
    assert.match(res.body.error.hint, /不能领/u);
    const after = await h.board.get(t.id);
    assert.equal(after.state, 'queued');
    assert.equal(after.claimedBy, null);
  } finally { h.close(); }
});

test('越权被拒：派给别人的卡、派给主人的卡、别的外部身份的卡，都不能领', async () => {
  const h = await setup();
  try {
    const a = await assigned(h.board, 'research');
    const b = await assigned(h.board, 'grok');
    const c = await h.board.create(OWNER, { title: '给主人', goal: 'x', to: ['owner'] });
    for (const t of [a, b, c]) {
      await assert.rejects(() => h.board.claim(EXT('codex'), t.id), { code: 'FORBIDDEN' });
      assert.equal((await h.api('codex', 'POST', `/tickets/${t.id}/claim`, {})).status, 403);
    }
  } finally { h.close(); }
});

test('正路照旧：明确派给它的卡能领；开放认领的卡能领；先到先得', async () => {
  const h = await setup();
  try {
    const mine = await assigned(h.board);
    assert.equal((await h.api('codex', 'POST', `/tickets/${mine.id}/claim`, {})).status, 200);
    const o = await open(h.board);
    assert.equal((await h.api('codex', 'POST', `/tickets/${o.id}/claim`, {})).status, 200);
    const o2 = await open(h.board);
    await h.board.claim(EXT('grok'), o2.id);
    const late = await h.api('codex', 'POST', `/tickets/${o2.id}/claim`, {});
    assert.equal(late.status, 409);
    assert.equal(late.body.error.taken.by, 'grok');
  } finally { h.close(); }
});

test('读取：外部身份（含 work+create 令牌）只能读自己名下的卡或开放卡；别的卡 404', async () => {
  const h = await setup();
  try {
    const p = await plain(h.board);
    const mine = await assigned(h.board);
    const theirs = await assigned(h.board, 'grok');
    const o = await open(h.board);
    assert.equal((await h.api('codex', 'GET', `/tickets/${p.id}`)).status, 404);
    assert.equal((await h.api('codex', 'GET', `/tickets/${theirs.id}`)).status, 404);
    assert.equal((await h.api('codex', 'GET', `/tickets/${mine.id}`)).status, 200);
    assert.equal((await h.api('codex', 'GET', `/tickets/${o.id}`)).status, 200);
    assert.equal((await h.api('viewer', 'GET', `/tickets/${mine.id}`)).status, 404);
    const all = await h.api('codex', 'GET', '/tickets');
    assert.deepEqual(all.body.tickets.map(x => x.id).sort(), [mine.id, o.id].sort());
    const asked = await h.api('codex', 'GET', '/tickets?assignee=grok');
    assert.deepEqual(asked.body.tickets, []);
    const openList = await h.api('codex', 'GET', '/tickets?open=1');
    assert.deepEqual(openList.body.tickets.map(x => x.id), [o.id]);
  } finally { h.close(); }
});

test('追加进度、交回、标卡住、失败、超时：别人名下的卡一律 403，自己名下的卡正常', async () => {
  const h = await setup();
  try {
    const p = await plain(h.board);
    const theirs = await assigned(h.board, 'grok');
    await h.board.claim(EXT('grok'), theirs.id);
    for (const t of [p, theirs]) {
      for (const [op, body] of [['progress', { text: 'x' }], ['report', { summary: 's' }], ['block', { reason: 'r' }],
        ['done', {}], ['fail', { reason: 'r' }], ['timeout', {}], ['uncertain', { note: 'n' }], ['resume', {}],
        ['handoff', { to: 'research' }], ['accept', {}], ['send_back', { note: 'n' }], ['answer', { text: 'a' }],
        ['verify', { verdict: 'pass', note: 'n' }]]) {
        const res = await h.api('codex', 'POST', `/tickets/${t.id}/${op}`, body);
        assert.equal(res.status, 403, `${op} 应被拒`);
      }
    }
    assert.equal((await h.board.get(theirs.id)).progress.length, 0);
    const mine = await assigned(h.board);
    assert.equal((await h.api('codex', 'POST', `/tickets/${mine.id}/claim`, {})).status, 200);
    assert.equal((await h.api('codex', 'POST', `/tickets/${mine.id}/progress`, { text: '在做' })).status, 200);
    assert.equal((await h.api('codex', 'POST', `/tickets/${mine.id}/block`, { reason: '问个事', waitHuman: true })).status, 200);
  } finally { h.close(); }
});

test('命令行：take 普通卡被拒、说清楚；mine/open 里没有它；take 开放卡和派给自己的卡仍可', async () => {
  const h = await setup();
  try {
    const p = await plain(h.board);
    const refused = await h.cli('codex', ['take', p.id]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.out, /没有派给你，也不是「谁有空谁接」的开放卡/u);
    assert.equal((await h.board.get(p.id)).claimedBy, null);
    const mine = await h.cli('codex', ['mine', '--json']);
    assert.equal(JSON.parse(mine.out).count, 0);
    assert.equal(JSON.parse((await h.cli('codex', ['open', '--json'])).out).count, 0);
    const a = await assigned(h.board);
    const o = await open(h.board);
    assert.equal((await h.cli('codex', ['take', a.id])).code, 0);
    assert.equal((await h.cli('codex', ['take', o.id])).code, 0);
    const mine2 = JSON.parse((await h.cli('codex', ['mine', '--json'])).out);
    assert.deepEqual(mine2.tickets.map(x => x.id).sort(), [a.id, o.id].sort());
    const nope = await h.cli('codex', ['take', 'T-20200101-000000-zzzz']);
    assert.notEqual(nope.code, 0);
  } finally { h.close(); }
});

test('接力：轮到外部身份的那一棒算派给它的，能读能交回；没轮到它之前、别人的接力卡读不到', async () => {
  const h = await setup();
  try {
    const R = { name: 'research', type: 'assistant' };
    const { ticket: relay } = await h.board.relayCreate(CHIEF, { title: '接力', goal: '三棒', key: 'k37', steps: [
      { who: R, task: '查', doneWhen: '一份' },
      { who: { name: 'codex', type: 'external' }, task: '写', doneWhen: '一份' },
      { who: { name: 'owner', type: 'owner' }, task: '看', doneWhen: '好' }] });
    assert.equal((await h.api('codex', 'GET', `/tickets/${relay.id}`)).status, 404); // 还没轮到它
    assert.ok([403, 409].includes((await h.api('codex', 'POST', `/tickets/${relay.id}/claim`, {})).status)); // 被拒
    assert.equal((await h.api('codex', 'POST', `/tickets/${relay.id}/report`, { summary: 'x' })).status, 403);
    // 第一棒就是它：算派给它的。
    const { ticket: mine } = await h.board.relayCreate(CHIEF, { title: '接力二', goal: '两棒', key: 'k37b', steps: [
      { who: { name: 'codex', type: 'external' }, task: '写', doneWhen: '一份' },
      { who: R, task: '查', doneWhen: '一份' }] });
    assert.equal(mine.claimedBy, 'codex');
    assert.equal((await h.api('codex', 'GET', `/tickets/${mine.id}`)).status, 200);
    assert.equal((await h.api('grok', 'GET', `/tickets/${mine.id}`)).status, 404);
    assert.equal((await h.api('grok', 'POST', `/tickets/${mine.id}/report`, { summary: 'x' })).status, 403);
    assert.equal((await h.api('codex', 'POST', `/tickets/${mine.id}/report`, { summary: '写好了' })).status, 200);
    // 它那一棒做完、卡停在「等主人」（卡的负责人已是主人）：它仍读得到自己这一棒的记录，但碰不了卡。
    await h.board.relaySync(mine.id);
    const gated = await h.board.get(mine.id);
    assert.equal(gated.claimedBy, 'research');
    const still = await h.api('codex', 'GET', `/tickets/${mine.id}`);
    assert.equal(still.status, 200);
    assert.equal(still.body.ticket.relay.steps[0].who.name, 'codex');
    assert.ok((await h.api('codex', 'GET', '/tickets')).body.tickets.some(x => x.id === mine.id));
    assert.equal((await h.api('codex', 'POST', `/tickets/${mine.id}/progress`, { text: '想改' })).status, 403);
    assert.equal((await h.api('grok', 'GET', `/tickets/${mine.id}`)).status, 404);
  } finally { h.close(); }
});

test('外部交回的卡：助理验收只记一句意见，卡停在等验收；主人点完成才算；external_accept=assistant 恢复旧行为', async () => {
  for (const mode of ['owner', 'assistant']) {
    const h = await setup({ ownerAcceptExternal: mode === 'owner' });
    try {
      const t = await h.board.create(CHIEF, { title: '助理派的', goal: 'g', to: ['codex'] });
      await h.board.claim(EXT('codex'), t.id);
      await h.board.report(EXT('codex'), t.id, { summary: '做完了' });
      await h.board.done(EXT('codex'), t.id);
      const reviewed = await h.board.accept(CHIEF, t.id, '看过了，可以');
      if (mode === 'owner') {
        assert.notEqual(reviewed.state, 'completed');
        assert.equal(reviewed.review, 'submitted');
        assert.equal(reviewed.history.at(-1).action, 'review_noted');
        assert.equal(reviewed.history.at(-1).detail, '看过了，可以');
        const done = await h.board.ownerMove(OWNER, t.id, 'done');
        assert.equal(done.state, 'completed');
        assert.equal(done.review, 'accepted');
      } else {
        assert.equal(reviewed.state, 'completed');
      }
    } finally { h.close(); }
  }
});

test('内部助理做的卡，助理验收仍然直接完成（只收紧外部）', async () => {
  const h = await setup();
  try {
    const t = await h.board.create(CHIEF, { title: '内部', goal: 'g', to: ['research'] });
    await h.board.claim({ name: 'research', type: 'assistant' }, t.id);
    await h.board.report({ name: 'research', type: 'assistant' }, t.id, { summary: 'ok' });
    await h.board.done({ name: 'research', type: 'assistant' }, t.id);
    assert.equal((await h.board.accept(CHIEF, t.id)).state, 'completed');
  } finally { h.close(); }
});

test('今天页：接单的外部身份令牌被吊销、或配置里删掉后，它名下进行中的卡出现在 externalLost', async () => {
  const h = await setup();
  try {
    const t = await assigned(h.board);
    await h.board.claim(EXT('codex'), t.id);
    const mk = (board = {}) => ({ board: h.board, configDir: h.configDir, roster: { list: () => [] },
      hubConfig: { board: { externals: ['codex', 'grok'], ...board } }, now: () => Date.now() });
    assert.deepEqual((await buildToday(mk())).externalLost.items, []);
    const gone = await buildToday(mk({ externals: ['grok'] }));
    assert.deepEqual(gone.externalLost.items.map(x => [x.id, x.name, x.reason]), [[t.id, 'codex', 'config']]);
    await revokeToken(h.configDir, 'codex');
    const revoked = await buildToday(mk());
    assert.deepEqual(revoked.externalLost.items.map(x => [x.id, x.name, x.reason]), [[t.id, 'codex', 'token']]);
    await h.board.ownerMove(OWNER, t.id, 'done');
    assert.deepEqual((await buildToday(mk())).externalLost.items, []);
  } finally { h.close(); }
});
