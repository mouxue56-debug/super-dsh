import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createBoard } from '../lib/board.mjs';
import { composeBrief } from '../lib/dispatch-runner.mjs';
import { createFullTextStore, textDigest } from '../lib/fulltext.mjs';
import * as ext from '../lib/ext/dispatch.mjs';
import { loadExtensions } from '../lib/ext/index.mjs';

async function request(handler, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.url = url;
  req.method = body === undefined ? 'GET' : 'POST';
  req.headers = {};
  const res = { text: '' };
  res.writeHead = status => { res.status = status; };
  res.end = text => { res.text += text ?? ''; };
  const handled = await handler(req, res);
  return { handled, status: res.status, body: res.text ? JSON.parse(res.text) : undefined };
}

async function fixture(t, options = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-ext-test-')));
  const root = path.join(dir, 'work');
  const tree = path.join(dir, 'tree');
  const boardRoot = path.join(dir, 'board');
  fs.mkdirSync(root);
  fs.mkdirSync(tree);
  const script = path.join(dir, 'worker.mjs');
  const source = [
    "import fs from 'node:fs';",
    "const result = process.argv[process.argv.indexOf('--result') + 1];",
    "if (process.argv.includes('--hold')) setInterval(() => {}, 1000);",
    "else fs.writeFileSync(result, '假工人完成');",
  ].join('\n');
  fs.writeFileSync(script, source);
  const argv = [process.execPath, script, '--result', '{result_file}'];
  if (options.hold) argv.push('--hold');
  const board = createBoard({ root: boardRoot });
  const cards = [];
  const resolvers = [];
  const events = [];
  const rows = [];
  const roster = [
    { id: 'bot', status: 'active' },
    { id: 'other', status: 'active' },
  ];
  let now = Date.parse('2026-01-01T18:00:00Z');
  const deps = {
    board,
    configDir: dir,
    dataDir: dir,
    now: () => now,
    utcOffsetMinutes: 540,
    isTrusted: () => true,
    roster: {
      list: () => roster,
      get: id => roster.find(row => row.id === id),
      canDispatch: () => true,
      canDispatchExternal: () => true,
    },
    cards: { ask: card => {
      cards.push(card);
      return new Promise(resolve => resolvers.push(resolve));
    } },
    notify: event => events.push(event),
    ledger: { record: row => { rows.push(row); } },
    logger: { error() {} },
    hubConfig: { dispatch: {
      root,
      run_dir: path.join(dir, 'runs'),
      worktree_roots: [tree],
      poll_ms: 0,
      heartbeat_ms: 100,
      stop_wait_ms: 100,
      grant_days: 2,
      ...(options.allow === undefined ? {} : { allow_bots: options.allow }),
      card_text_max: options.cardMax ?? 3000,
      workers: {
        worker: { argv, models: ['model-1'] },
        worker2: { argv, models: ['model-1'] },
      },
    } },
  };
  if (options.unconfigured) deps.hubConfig = {};
  if (options.fullText) deps.fullText = createFullTextStore(path.join(dir, 'fulltext'));
  if (options.invalid) deps.hubConfig.dispatch.root = 'relative';
  const handler = ext.createHandler(deps);
  await ext.start(deps);
  t.after(async () => {
    for (const resolve of resolvers) resolve({ status: 'timeout' });
    await ext.waitIdle(deps);
    for (const run of ext.listRunning()) {
      if (!run.pid) continue;
      try {
        process.kill(-run.pid, 'SIGKILL');
      } catch (error) {
        // 没权限不等于进程还在；清场失败不把已经做完的断言判红。
        if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
      }
    }
    ext.stop();
  });
  const ticket = async (patch = {}, bot = 'bot') => board.create({ name: bot, type: 'assistant' }, {
    title: '测试任务',
    goal: '任务书正文完整内容',
    to: ['worker'],
    routing: { requestedBy: bot, hint: '', worker: 'worker', model: 'model-1', via: 'dispatch_prepare' },
    acceptance: [{ check: '检查结果', expect: '内容正确' }],
    forbidden: ['不改其他文件'],
    readExternalContent: false,
    ...patch,
  });
  const post = (id, extra = {}) => request(handler, '/dispatch/runs', {
    ticket: id, bot: 'bot', readExternal: false, ...extra,
  });
  const answer = async (choice = 'approve', status = 'answered') => {
    const resolve = resolvers.shift();
    resolve({ id: 'confirm-1', status, choice, device: 'd1' });
    await ext.waitIdle(deps);
  };
  return { dir, root, tree, boardRoot, board, deps, handler, cards, resolvers, events, rows, roster,
    ticket, post, answer, advance: ms => { now += ms; } };
}

async function eventually(fn, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('条件等待超时');
}

test('鉴权、非本扩展路径和配置缺失或错误', async t => {
  const h = await fixture(t, { unconfigured: true });
  h.deps.isTrusted = () => false;
  for (const url of ['/dispatch', '/dispatch/runs', '/dispatch/grants']) {
    assert.equal((await request(h.handler, url)).status, 401);
  }
  assert.equal((await request(h.handler, '/else')).handled, false);
  h.deps.isTrusted = () => true;
  assert.equal((await request(h.handler, '/dispatch/runs')).status, 503);
  assert.deepEqual(ext.listRunning(), []);
  assert.equal((await ext.stopAll()).configured, false);
  const bad = await fixture(t, { invalid: true });
  const response = await request(bad.handler, '/dispatch/runs');
  assert.equal(response.status, 503);
  assert.match(response.body.error.message, /root/);
});

test('参数、名册、外部内容与机器检查均在出卡前拦截', async t => {
  const h = await fixture(t);
  const good = await h.ticket();
  assert.equal((await request(h.handler, '/dispatch/runs', { bot: 'bot', readExternal: false })).status, 400);
  assert.equal((await h.post(good.id, { readExternal: 'false' })).status, 400);
  const restricted = await fixture(t, { allow: [] });
  const restrictedTicket = await restricted.ticket();
  assert.equal((await restricted.post(restrictedTicket.id)).body.error.code, 'NOT_ALLOWED');
  await ext.start(h.deps);
  for (const patch of [{ paused: true }, { status: 'disabled' }]) {
    Object.assign(h.roster[0], patch);
    assert.equal((await h.post(good.id)).body.error.code, 'NOT_ALLOWED');
    Object.assign(h.roster[0], { paused: false, status: 'active' });
  }
  assert.equal((await h.post(good.id, { readExternal: true })).body.error.code, 'TAINTED');
  const tainted = await h.ticket({ readExternalContent: true });
  assert.equal((await h.post(tainted.id)).body.error.code, 'TAINTED');
  assert.equal(h.events.filter(e => e.kind === 'tainted').length, 2);
  const cases = [
    { routing: { requestedBy: 'bot', hint: '', worker: 'worker', model: 'bad', via: 'dispatch_prepare' } },
    { workdir: { path: path.join(h.dir, 'outside'), writable: [] } },
    { acceptance: [] },
    { goal: '读取 .secrets 目录' },
  ];
  for (const patch of cases) {
    const ticket = await h.ticket(patch);
    const result = await h.post(ticket.id);
    assert.equal(result.status, 403);
    assert.ok(Array.isArray(result.body.error.reasons));
  }
  assert.equal((await h.post('T-20260101-000000-abcd')).status, 404);
  const other = await h.ticket({}, 'other');
  assert.equal((await h.post(other.id)).body.error.code, 'NOT_SENDER');
  assert.equal(h.cards.length, 0);
  assert.deepEqual(ext.listRunning(), []);
});

test('确认卡全文、重复请求、批准、回收结果与账本', async t => {
  const h = await fixture(t);
  const ticket = await h.ticket();
  const first = await h.post(ticket.id);
  assert.equal(first.status, 202);
  assert.equal(first.body.status, 'awaiting_approval');
  assert.equal(h.cards.length, 1);
  const card = h.cards[0];
  assert.equal(card.kind, 'dispatch');
  assert.deepEqual(card.choices.map(c => c.id), ['approve', 'reject']);
  assert.ok(card.text.includes(composeBrief(ticket)));
  assert.ok(card.text.includes('worker') && card.text.includes('model-1'));
  assert.ok(card.text.includes(path.join(h.root, ticket.id)));
  assert.equal((await h.board.get(ticket.id)).state, 'queued');
  assert.deepEqual(ext.listRunning(), []);
  assert.equal((await h.post(ticket.id)).body.repeated, true);
  assert.equal(h.cards.length, 1);
  await h.answer();
  const claimed = await h.board.get(ticket.id);
  assert.equal(claimed.claimedBy, 'worker');
  assert.equal(claimed.claimedByType, 'external');
  assert.ok(claimed.progress.some(p => p.text.includes('已外派')));
  const run = ext.listRunning()[0];
  assert.ok(run?.pid);
  const done = await eventually(async () => {
    const response = await request(h.handler, '/dispatch/runs/' + run.runId);
    return response.body.run.status === 'done' && response.body.run;
  });
  assert.equal(done.status, 'done');
  const updated = await h.board.get(ticket.id);
  assert.equal(updated.review, 'submitted');
  assert.equal(updated.report.selfReported, true);
  assert.ok((await request(h.handler, '/dispatch/runs')).body.runs.some(r => r.runId === run.runId));
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].kind, 'dispatch');
});

test('拒绝和超时不启动，可以再次申请', async t => {
  const h = await fixture(t);
  for (const [choice, status] of [['reject', 'answered'], ['', 'timeout']]) {
    const ticket = await h.ticket();
    await h.post(ticket.id);
    await h.answer(choice, status);
    assert.equal((await h.board.get(ticket.id)).state, 'queued');
    assert.equal((await h.post(ticket.id)).status, 202);
    await h.answer('reject');
  }
  assert.equal(h.events.filter(e => e.kind === 'declined').length, 4);
  assert.deepEqual(ext.listRunning(), []);
});

test('卡确认后工单被篡改时启动前拒绝', async t => {
  const h = await fixture(t);
  const ticket = await h.ticket();
  await h.post(ticket.id);
  const file = path.join(h.boardRoot, 'tickets', ticket.id + '.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  value.goal = '被替换的任务正文';
  fs.writeFileSync(file, JSON.stringify(value));
  await h.answer();
  assert.ok(h.events.some(e => e.kind === 'refused' && e.code === 'CHANGED'));
  assert.equal((await h.board.get(ticket.id)).state, 'queued');
  assert.deepEqual(ext.listRunning(), []);
});

test('没有全文存储时长任务书被拒，短任务书照常出卡', async t => {
  const small = await fixture(t);
  const first = await small.ticket({ goal: '任务'.repeat(500) });
  const denied = await small.post(first.id);
  assert.equal(denied.status, 422);
  assert.equal(denied.body.error.code, 'TOO_LONG');
  assert.equal(small.cards.length, 0);
  const large = await fixture(t, { cardMax: 3000 });
  const second = await large.ticket();
  assert.equal((await large.post(second.id)).status, 202);
  await large.answer('reject');
});

test('长任务书出全文卡，存储被篡改后拒绝执行和放权', async t => {
  const h = await fixture(t, { fullText: true });
  const ticket = await h.ticket({ goal: '任务'.repeat(800) });
  assert.equal((await h.post(ticket.id)).status, 202);
  const card = h.cards[0];
  const full = h.deps.fullText.get(card.fullText);
  assert.ok(full.includes('任务'.repeat(800)));
  assert.equal(textDigest(full), card.fullText);
  assert.ok([...card.text].length <= 900);
  assert.match(card.text, /看全文/u);
  fs.writeFileSync(path.join(h.dir, 'fulltext', card.fullText + '.txt'), '已改变');
  await h.answer('approve-always');
  assert.ok(h.events.some(event => event.kind === 'refused' && event.code === 'CHANGED'));
  assert.equal((await request(h.handler, '/dispatch/grants')).body.grants.length, 0);
  assert.deepEqual(ext.listRunning(), []);
});

test('默认启用可发起，显式名单收紧且停用始终拒绝', async t => {
  for (const allow of [undefined, '*', ['*'], ['bot'], [], ['other']]) {
    const h = await fixture(t, { allow });
    h.roster[0].can_dispatch_external = true;
    const ticket = await h.ticket();
    const result = await h.post(ticket.id);
    const allowed = allow === undefined || allow.includes('*') || allow.includes('bot');
    assert.equal(result.status, allowed ? 202 : 403);
    if (allowed) await h.answer('reject');
    h.roster[0].status = 'disabled';
    assert.equal((await h.post(ticket.id)).body.error.code, 'NOT_ALLOWED');
  }
});

test('长任务书经全文卡批准后按原文启动', async t => {
  const h = await fixture(t, { fullText: true });
  const ticket = await h.ticket({ goal: '任务'.repeat(800) });
  assert.equal((await h.post(ticket.id)).status, 202);
  await h.answer();
  assert.equal(ext.listRunning().length, 1);
});

test('旧外派放权可查看撤销，但每张新工单仍需本次确认', async t => {
  const h = await fixture(t);
  const file = path.join(h.dir, 'dispatch-grants.json');
  const grant = { id: 'G-old', bot: 'bot', program: 'worker', dir: h.root,
    caps: { network: false, writeRoots: [h.root] }, by: 'owner', on: '2026-01-02', until: '2026-01-04',
    tag: '#by/owner #on/2026-01-02 #until/2026-01-04', createdAt: '2026-01-01T18:00:00Z',
    cardId: 'old-confirm', revokedAt: null };
  fs.writeFileSync(file, JSON.stringify({ v: 1, grants: [grant] }), { mode: 0o600 });
  const first = await h.ticket();
  assert.equal((await h.post(first.id)).status, 202, '旧放权不跳过本次确认');
  assert.equal(h.cards.length, 1);
  await h.answer('approve-always');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).grants, [grant], '旧卡选项只批准本次');
  const next = await h.ticket();
  assert.equal((await h.post(next.id)).status, 202, '同一助理、工人、目录的新任务仍问');
  await h.answer('reject');
  const tainted = await h.ticket({ readExternalContent: true });
  assert.equal((await h.post(tainted.id)).body.error.code, 'TAINTED');
  assert.equal((await request(h.handler, '/dispatch/grants')).body.grants[0].status, 'active');
  h.advance(3 * 86400000);
  assert.equal((await request(h.handler, '/dispatch/grants')).body.grants[0].status, 'expired');
  const revoked = await request(h.handler, '/dispatch/grants/G-old/revoke', {});
  assert.equal(revoked.body.grant.status, 'revoked');
  assert.equal((await request(h.handler, '/dispatch/grants')).body.grants[0].status, 'revoked');
});

test('同一工作树的外派批准后拒绝并发；停服务不杀进程，全停能回报', async t => {
  const h = await fixture(t, { hold: true });
  const workdir = { path: h.tree, writable: [] };
  const first = await h.ticket({ workdir });
  await h.post(first.id);
  await h.answer('approve-always');
  const running = ext.listRunning();
  assert.equal(running.length, 1);
  assert.ok(running[0].pid);
  const second = await h.ticket({ workdir });
  assert.equal((await h.post(second.id)).status, 202);
  await h.answer();
  assert.ok(h.events.some(e => e.kind === 'refused' && e.code === 'BUSY'));
  const third = await h.ticket({ workdir }, 'other');
  assert.equal((await h.post(third.id, { bot: 'other' })).status, 202);
  await h.answer();
  assert.ok(h.events.some(e => e.kind === 'refused' && e.code === 'BUSY'));
  ext.stop();
  assert.ok(running[0].pid);
  let signal = 'alive';
  try { process.kill(running[0].pid, 0); }
  catch (error) { signal = error.code || 'error'; }
  // 停服务不收割进程。没权限时与运行时代码一样，不当成已经退出。
  assert.ok(signal === 'alive' || signal === 'EPERM');
  await ext.start(h.deps);
  const result = await ext.stopAll({ kill: true });
  assert.equal(result.configured, true);
  assert.ok(result.stopped.length + result.stillRunning.length >= 1);
});

test('加载器仅在 private 阶段路由派工扩展', async t => {
  const h = await fixture(t);
  const dir = path.dirname(fileURLToPath(new URL('../lib/ext/dispatch.mjs', import.meta.url)));
  const loader = await loadExtensions({ dir, deps: h.deps, only: ['dispatch'], logger: h.deps.logger });
  assert.deepEqual(loader.names, ['dispatch']);
  assert.deepEqual(loader.failed, []);
  assert.equal(loader.matches('/dispatch/runs', 'public'), false);
  assert.equal(loader.matches('/dispatch/runs', 'private'), true);
  await loader.start();
  const result = await request((req, res) => loader.handle(req, res, 'private'), '/dispatch/runs');
  assert.equal(result.status, 200);
  await loader.stop();
});
