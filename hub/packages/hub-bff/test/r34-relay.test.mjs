// · 接力：放行一步完成、接棒助理停用就停下并能换人、超时催办（保守版）、外部身份名单。
// 真看板 + 假名册 + 假会话 + 叫醒模块（和 r32-relay 同一套假件）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { testDirectory } from './fixtures.mjs';
import { createBoard } from '../lib/board.mjs';
import { createRelayWake, relayWakeText } from '../lib/relay-wake.mjs';
import { createHandoffWake } from '../lib/handoff-wake.mjs';
import { parseRoute } from '../lib/relay-model.mjs';
import { createHandler as boardHandler } from '../lib/ext/board.mjs';
import { Readable } from 'node:stream';

const CHIEF = { name: 'chief', type: 'assistant' };
const RESEARCH = { name: 'research', type: 'assistant' };
const WRITER = { name: 'writer', type: 'assistant' };
const ART = { name: 'art', type: 'assistant' };
const CODEX = { name: 'codex', type: 'external' };
const OWNER = { name: 'owner', type: 'owner' };
const A = (a) => ({ who: { name: a.name, type: a.type }, task: '做' + a.name, doneWhen: '交一份' });

async function harness({ stopped = false, clock = Date.UTC(2026, 10, 19, 10, 0), wakeOptions = {} } = {}) {
  const dir = await testDirectory();
  const state = { stopped, clock };
  const sent = [];
  const created = [];
  const known = new Map([['s-chief', 'chief']]);
  const bots = ['chief', 'research', 'writer', 'art'];
  const roster = new Map(bots.map((id) => [id, { id, name: id, role: id === 'chief' ? 'chief' : 'bot', status: 'active' }]));
  roster.set('gone', { id: 'gone', name: 'gone', role: 'bot', status: 'disabled' });
  const sessions = {
    list: () => [...known].map(([id, bot]) => ({ id, bot })),
    create: async (bot, opts = {}) => {
      const id = 's-new-' + (created.length + 1);
      created.push({ bot, id, title: opts.title });
      known.set(id, bot);
      return { id };
    },
    send: async (id, text, opts) => {
      if (state.stopped) throw Object.assign(new Error('停了'), { code: 'PANIC_STOPPED' });
      sent.push({ id, text, opts, bot: known.get(id) });
    },
  };
  let wake;
  const board = createBoard({ root: join(dir, 'board'), now: () => state.clock, onEvent: (ev) => wake?.onEvent(ev),
    reservedNames: () => ['owner', 'chief', 'research', 'writer', 'art'] });
  const stateFile = join(dir, 'relay-wake.json');
  const make = () => createRelayWake({ board, roster, sessions, stateFile, now: () => state.clock,
    isStopped: () => state.stopped, logger: { error() {} }, tickMs: 0, perTicketMs: 0, ...wakeOptions });
  wake = make();
  const start = async (steps, extra = {}, actor = CHIEF) => (await board.relayCreate(actor, { title: '三棒接力', goal: '把事做完',
    key: 'k' + Math.random(), sessions: { from: 's-chief', to: '' }, steps, ...extra })).ticket;
  const settle = async () => { await wake.drain(); await wake.flush(); await wake.drain(); };
  const ev = async (e) => { await wake.onEvent(e); await wake.drain(); };
  return { dir, state, sent, created, known, board, ev, wake: () => wake, remake: () => (wake = make()), start, settle,
    stateFile, roster };
}


const GATE = (a) => ({ ...A(a), gate: true });
const OWNER_STEP = { who: OWNER, task: '看一眼再发' };

async function http(handler, url, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url, method: 'POST', headers: { trusted: 'yes' } });
  const res = { text: '', headers: {} };
  res.setHeader = () => {};
  res.writeHead = (status) => { res.status = status; };
  res.end = (text) => { res.text += text ?? ''; };
  await handler(req, res);
  return { status: res.status, body: res.text ? JSON.parse(res.text) : undefined };
}

test('第34轮 放行一步完成：主人发起的接力，最后一棒（主人看一眼）放行即完成，不用再点一次验收', async () => {
  const h = await harness();
  const t = await h.start([A(RESEARCH), A(WRITER), OWNER_STEP], {}, OWNER);
  await h.settle();
  await h.board.relayDeliver(RESEARCH, t.id, '第一棒好了');
  await h.settle();
  await h.board.relayDeliver(WRITER, t.id, '第二棒好了');
  await h.settle();
  const waiting = await h.board.get(t.id);
  assert.equal(waiting.relay.phase, 'gate');
  assert.equal(waiting.state, 'waiting-human');
  const done = await h.board.relayRelease(OWNER, t.id, {});
  assert.equal(done.state, 'completed');
  assert.equal(done.review, 'accepted');
  assert.equal(done.relay.phase, 'done');
  assert.equal(done.open_ask, null);
  await h.settle();
  const again = await h.board.get(t.id);
  assert.equal(again.state, 'completed', '同步不会把它拉回去');
  assert.equal(again.relay.phase, 'done');
});

test('第34轮 放行一步完成：最后一棒是助理但要主人看一眼，放行也直接完成', async () => {
  const h = await harness();
  const t = await h.start([A(RESEARCH), GATE(WRITER)], {}, OWNER);
  await h.board.relayDeliver(RESEARCH, t.id, '好了');
  await h.settle();
  await h.board.relayDeliver(WRITER, t.id, '写好了');
  await h.settle();
  assert.equal((await h.board.get(t.id)).relay.phase, 'gate');
  const done = await h.board.relayRelease(OWNER, t.id, {});
  assert.deepEqual([done.state, done.review, done.relay.phase], ['completed', 'accepted', 'done']);
});

test('第34轮 放行一步完成：后面还有棒就交给下一棒（并叫醒）；退回重做不受影响', async () => {
  const h = await harness();
  const t = await h.start([GATE(RESEARCH), A(WRITER), OWNER_STEP], {}, OWNER);
  await h.board.relayDeliver(RESEARCH, t.id, '好了');
  await h.settle();
  const redo = await h.board.relayRelease(OWNER, t.id, { redo: true, note: '再来' });
  assert.equal(redo.relay.phase, 'running');
  assert.equal(redo.relay.steps[0].returnedNote, '再来');
  await h.board.relayDeliver(RESEARCH, t.id, '改好了');
  await h.settle();
  const next = await h.board.relayRelease(OWNER, t.id, {});
  assert.equal(next.state, 'progress');
  assert.equal(next.relay.current, 1);
  await h.settle();
  assert.ok(h.sent.some((m) => m.bot === 'writer' && /接力轮到你了/u.test(m.text)));
});

test('第34轮 放行一步完成：助理发起的接力，最后一棒放行后仍叫发起人总验收（保守）', async () => {
  const h = await harness();
  const t = await h.start([A(RESEARCH), GATE(WRITER)], {}, CHIEF);
  await h.board.relayDeliver(RESEARCH, t.id, '好了');
  await h.settle();
  await h.board.relayDeliver(WRITER, t.id, '写好了');
  await h.settle();
  const out = await h.board.relayRelease(OWNER, t.id, {});
  assert.equal(out.relay.phase, 'final');
  assert.equal(out.state, 'progress');
  await h.settle();
  assert.ok(h.sent.some((m) => m.bot === 'chief' && /接力走完了/u.test(m.text)));
});

test('第34轮 接棒的助理停用：停下，卡进「等你」带一句人话，不叫醒停用的人；主人换人后继续并叫醒新的人', async () => {
  const h = await harness();
  const t = await h.start([A(RESEARCH), A({ name: 'gone', type: 'assistant' }), A(WRITER)], {}, OWNER);
  await h.board.relayDeliver(RESEARCH, t.id, '好了');
  await h.settle();
  const halted = await h.board.get(t.id);
  assert.equal(halted.relay.phase, 'halted');
  assert.equal(halted.state, 'waiting-human');
  assert.equal(halted.open_ask.text, '接力停在这里：gone已停用，换个人接？');
  assert.equal(h.sent.filter((m) => m.bot === 'gone').length, 0);
  // 重复同步不会改变什么
  await h.settle();
  assert.equal((await h.board.get(t.id)).history.filter((x) => x.action === 'relay_halted').length, 1);
  // 只有主人能换
  await assert.rejects(() => h.board.relayReassign(CHIEF, t.id, WRITER), /Not permitted/u);
  await assert.rejects(() => h.board.relayReassign(OWNER, t.id, OWNER), /Invalid assignee/u);
  const moved = await h.board.relayReassign(OWNER, t.id, ART);
  assert.deepEqual([moved.relay.phase, moved.state, moved.claimedBy, moved.relay.steps[1].who.name], ['running', 'progress', 'art', 'art']);
  await h.settle();
  assert.ok(h.sent.some((m) => m.bot === 'art' && /接力轮到你了/u.test(m.text)));
  await h.board.relayDeliver(ART, t.id, '好了');
  await h.settle();
  assert.equal((await h.board.get(t.id)).relay.current, 2);
});

test('第34轮 接棒的助理不在名册里（被删了）同样停下；名册里改成停用后叫醒前也会停下', async () => {
  const h = await harness();
  const t = await h.start([A(RESEARCH), A({ name: 'ghost', type: 'assistant' })], {}, OWNER);
  await h.board.relayDeliver(RESEARCH, t.id, '好了');
  await h.settle();
  const x = await h.board.get(t.id);
  assert.equal(x.relay.phase, 'halted');
  assert.match(x.open_ask.text, /^接力停在这里：ghost已停用/u);
  // 排着还没发时对方被停用
  const h2 = await harness({ stopped: true });
  const t2 = await h2.start([A(RESEARCH), A(WRITER)], {}, OWNER);
  await h2.board.relayDeliver(RESEARCH, t2.id, '好了');
  await h2.settle();
  assert.equal((await h2.board.get(t2.id)).relay.phase, 'running');
  h2.roster.get('writer').status = 'disabled';
  h2.state.stopped = false;
  await h2.settle();
  const y = await h2.board.get(t2.id);
  assert.equal(y.relay.phase, 'halted');
  assert.equal(h2.sent.filter((m) => m.bot === 'writer').length, 0);
});

test('第34轮 超时催办：被叫醒后 30 分钟没动静，记一笔；不自动重叫、不自动换人；有进度就不算；夜间不计', async () => {
  const h = await harness({ clock: Date.UTC(2026, 10, 19, 10, 0) });
  const t = await h.start([A(RESEARCH), A(WRITER)], {}, OWNER);
  await h.settle();
  assert.equal(h.sent.filter((m) => m.bot === 'research').length, 1);
  const tick = async () => { await h.wake().resume(); await h.wake().drain(); };
  h.state.clock += 29 * 60000;
  await tick();
  assert.equal((await h.board.get(t.id)).relay.steps[0].stalledAt, null, '29 分钟还不到');
  // 有进度（写了一条进度）就把计时拨回去
  await h.board.progress(RESEARCH, t.id, '在查了');
  h.state.clock += 29 * 60000;
  await tick();
  assert.equal((await h.board.get(t.id)).relay.steps[0].stalledAt, null, '有进度后重新计');
  h.state.clock += 2 * 60000;
  await tick();
  const stalled = await h.board.get(t.id);
  assert.ok(stalled.relay.steps[0].stalledAt);
  assert.equal(stalled.state, 'progress', '卡的状态不变，对方还能交棒');
  assert.equal(h.sent.length, 1, '不自动重叫');
  assert.equal(stalled.claimedBy, 'research', '不自动换人');
  const n = stalled.history.length;
  await tick();
  assert.equal((await h.board.get(t.id)).history.length, n, '只记一次');
  // 夜间不算：22:00 叫醒，到早上 07:59 都不催
  const night = await harness({ clock: Date.UTC(2026, 10, 19, 21, 50) });
  const t2 = await night.start([A(RESEARCH), A(WRITER)], {}, OWNER);
  await night.settle();
  night.state.clock = Date.UTC(2026, 10, 20, 7, 59);
  await night.wake().resume(); await night.wake().drain();
  assert.equal((await night.board.get(t2.id)).relay.steps[0].stalledAt, null);
  night.state.clock = Date.UTC(2026, 10, 20, 8, 15);
  await night.wake().resume(); await night.wake().drain();
  assert.equal((await night.board.get(t2.id)).relay.steps[0].stalledAt, null, '21:50–22:00 的 10 分钟加 8:00–8:15 的 15 分钟才 25');
  night.state.clock = Date.UTC(2026, 10, 20, 8, 25);
  await night.wake().resume(); await night.wake().drain();
  assert.ok((await night.board.get(t2.id)).relay.steps[0].stalledAt, '满 30 分钟（不含夜里）才催');
});

test('第34轮 超时催办：「再叫一次」叫醒同一位（固定话）并清掉提醒；「换人」换成别人并叫醒；配置 0 为关', async () => {
  const h = await harness({ wakeOptions: { stallMs: 30 * 60000 } });
  const t = await h.start([A(RESEARCH), A(WRITER)], {}, OWNER);
  await h.settle();
  h.state.clock += 31 * 60000;
  await h.wake().resume(); await h.wake().drain();
  assert.ok((await h.board.get(t.id)).relay.steps[0].stalledAt);
  await assert.rejects(() => h.board.relayNudge(CHIEF, t.id), /Not permitted/u);
  const nudged = await h.board.relayNudge(OWNER, t.id);
  assert.equal(nudged.relay.steps[0].stalledAt, null);
  await h.settle();
  const texts = h.sent.filter((m) => m.bot === 'research').map((m) => m.text);
  assert.equal(texts.length, 2);
  assert.match(texts[1], /再提醒一次/u);
  assert.ok(!/第一棒|查资料/u.test(texts[1]), '话里没有任务文字');
  // 又过 31 分钟再次没动静 → 可以换人
  h.state.clock += 31 * 60000;
  await h.wake().resume(); await h.wake().drain();
  assert.ok((await h.board.get(t.id)).relay.steps[0].stalledAt);
  const swapped = await h.board.relayReassign(OWNER, t.id, ART);
  assert.deepEqual([swapped.claimedBy, swapped.relay.steps[0].who.name, swapped.relay.steps[0].stalledAt], ['art', 'art', null]);
  await h.settle();
  assert.ok(h.sent.some((m) => m.bot === 'art'));
  const off = await harness({ wakeOptions: { stallMs: 0 } });
  const t2 = await off.start([A(RESEARCH), A(WRITER)], {}, OWNER);
  await off.settle();
  off.state.clock += 600 * 60000;
  await off.wake().resume(); await off.wake().drain();
  assert.equal((await off.board.get(t2.id)).relay.steps[0].stalledAt, null);
});

test('第34轮 重启后叫醒记录还在：催办不会因为重启重复，也不丢', async () => {
  const h = await harness();
  const t = await h.start([A(RESEARCH), A(WRITER)], {}, OWNER);
  await h.settle();
  h.state.clock += 31 * 60000;
  h.remake();
  await h.wake().resume(); await h.wake().drain();
  assert.ok((await h.board.get(t.id)).relay.steps[0].stalledAt, '重启后照样算出超时');
  assert.equal(h.sent.filter((m) => m.bot === 'research').length, 1);
});

test('第34轮 主人接口：换人（reassign）、再叫一次（rewake）、外部身份名单来自 board.externals', async () => {
  const dir = await testDirectory();
  const board = createBoard({ root: join(dir, 'board'), reservedNames: ['owner', 'writer', 'artist'] });
  const rows = [{ id: 'writer', name: '写作', status: 'active' }, { id: 'artist', name: '画画', status: 'active' },
    { id: 'old', name: '旧的', status: 'disabled' }];
  const mk = (hubConfig) => boardHandler({ board, roster: { list: () => rows }, hubConfig, isTrusted: (r) => r.headers.trusted === 'yes' });
  const none = mk({});
  const get = async (handler, url) => {
    const req = Readable.from([]);
    Object.assign(req, { url, method: 'GET', headers: { trusted: 'yes' } });
    const res = { text: '' };
    res.setHeader = () => {}; res.writeHead = (s) => { res.status = s; }; res.end = (x) => { res.text += x ?? ''; };
    await handler(req, res);
    return JSON.parse(res.text);
  };
  assert.deepEqual((await get(none, '/board/people')).people.map((p) => p.type), ['assistant', 'assistant'], '没配置就没有外部这一类');
  const withExt = mk({ board: { externals: ['agent-research', '带 空格'] } });
  const people = (await get(withExt, '/board/people')).people;
  assert.deepEqual(people.filter((p) => p.type === 'external').map((p) => p.id), ['agent-research']);
  // 路线里可以选外部身份；没配置时不认
  const route = { title: 'x', relay: { steps: [{ who: 'writer', task: 'a' }, { who: 'agent-research', task: 'b' }] } };
  assert.equal((await http(none, '/board/tickets/new', route)).status, 400);
  const made = await http(withExt, '/board/tickets/new', route);
  assert.equal(made.status, 201);
  assert.equal(made.body.ticket.relay.steps[1].who.type, 'external');
  // 换人 / 再叫一次
  const id = made.body.ticket.id;
  const url = '/board/tickets/' + id + '/relay';
  assert.equal((await http(withExt, url, { action: 'rewake' })).status, 200);
  assert.equal((await http(withExt, url, { action: 'reassign', who: 'old' })).status, 400, '停用的人不能当新人选');
  const swap = await http(withExt, url, { action: 'reassign', who: 'artist' });
  assert.equal(swap.status, 200);
  assert.equal(swap.body.ticket.relay.steps[0].who.name, 'artist');
  assert.equal((await http(withExt, url, { action: 'reassign', who: 'owner' })).status, 400);
});
