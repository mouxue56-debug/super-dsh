import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createBoard } from '../lib/board.mjs';
import { createPriceBook, parsePriceTable } from '../lib/prices.mjs';
import { buildToday, costView } from '../lib/today.mjs';
import { createHandler } from '../lib/ext/today.mjs';
import { createRoutineService } from '../lib/routines.mjs';

const jst = text => Date.parse(text + '+09:00');
const clock = { t: jst('2030-01-07T20:00:00') };
const me = name => ({ name, type: 'assistant' });
const prices = createPriceBook(parsePriceTable(
  readFileSync(new URL('./fixtures/prices.fake.json', import.meta.url), 'utf8')));
const tokens = (input, output = 0) => ({ input, cacheRead: 0, cacheWrite: 0, output, reasoning: 0 });
const call = (bot, model, tsMs, t) => ({ kind: 'call', bot, channel: 'sample', model, tsMs, tokens: t,
  sessionId: 's-' + bot, ticket: null });

async function world() {
  const dir = await mkdtemp(join(tmpdir(), 'today-'));
  clock.t = jst('2030-01-07T20:00:00');
  const board = createBoard({ root: join(dir, 'board'), now: () => clock.t });
  const make = async (title, to) => (await board.create(me('chief'), { title, goal: title + '的目标', to: [to] })).id;
  const done = await make('昨天做完的稿', 'writer');
  await board.claim(me('writer'), done);
  await board.report(me('writer'), done, { summary: '写完三篇' });
  await board.accept(me('chief'), done);
  const old = await make('前天做完的稿', 'writer');
  clock.t = jst('2030-01-06T20:00:00');
  await board.claim(me('writer'), old);
  await board.report(me('writer'), old, { summary: '旧的' });
  await board.accept(me('chief'), old);
  clock.t = jst('2030-01-07T21:00:00');
  const asking = await make('等回答的', 'scout');
  await board.claim(me('scout'), asking);
  await board.block(me('scout'), asking, '要不要换选题？', { waitHuman: true });
  const stuck = await make('卡住的', 'scout');
  await board.claim(me('scout'), stuck);
  await board.progress(me('scout'), stuck, '缺账号');
  await board.block(me('scout'), stuck, '缺账号');
  const review = await make('等验收的', 'writer');
  await board.claim(me('writer'), review);
  await board.report(me('writer'), review, { summary: '待验收' });
  clock.t = jst('2030-01-08T08:00:00');
  const minutes = join(dir, 'meetings');
  await mkdir(join(minutes, '会议'), { recursive: true });
  await writeFile(join(minutes, '会议', '2030-01-06-晚会.md'), '# 旧晚会\n- 决定：A');
  await writeFile(join(minutes, '会议', '2030-01-07-晚会.md'), '# 昨晚晚会\n- 决定：B');
  const rows = [
    call('writer', 'meter', jst('2030-01-07T10:00:00'), tokens(1000000)),
    call('writer', 'meter', jst('2030-01-07T11:00:00'), tokens(500000)),
    call('scout', 'unknown-model', jst('2030-01-07T12:00:00'), tokens(300)),
    call('chief', 'meter', jst('2030-01-07T13:00:00'), tokens(1000000)),
    call('chief', 'unknown-model', jst('2030-01-07T14:00:00'), tokens(7)),
    call('writer', 'meter', jst('2030-01-06T23:30:00'), tokens(9999999)),
    call('writer', 'meter', jst('2030-01-08T01:00:00'), tokens(8888888)),
  ];
  const deps = {
    dataDir: join(dir, 'data'), now: () => clock.t, board, priceBook: prices, logger: { error() {} },
    hubConfig: { routines: { utcOffsetMinutes: 540, items: [{ id: 'daily-post', name: '日更', assistant: 'writer',
      at: '09:00', prompt: '写', done: '放好', escape: { maxSteps: 2, maxMinutes: 10 } }] },
    meetings: { minutesDir: minutes } },
    ledger: { async readRows({ from, to }) { return rows.filter(r => true); } },
    roster: { list: () => [{ id: 'writer', name: '小写' }, { id: 'scout', name: '小查' }, { id: 'chief', name: '总管' }] },
  };
  return { dir, board, deps, ids: { done, old, asking, stuck, review } };
}

test('今天：等点头、被阻断、等回答、昨天成果都由代码按看板算出', async () => {
  const w = await world();
  const today = await buildToday(w.deps, { routines: createRoutineService(w.deps) });
  assert.equal(today.date, '2030-01-08');
  assert.equal(today.yesterday, '2030-01-07');
  assert.equal(today.waiting.available, true);
  assert.deepEqual(today.waiting.counts, { blocked: 1, waitingAnswer: 1, awaitingReview: 1 });
  assert.equal(today.waiting.waitingAnswer[0].id, w.ids.asking);
  assert.equal(today.waiting.waitingAnswer[0].reason, '要不要换选题？');
  assert.equal(today.waiting.blocked[0].id, w.ids.stuck);
  assert.equal(today.waiting.blocked[0].reason, '缺账号');
  assert.equal(today.waiting.awaitingReview[0].id, w.ids.review);
  assert.equal(today.yesterdayDone.total, 1);
  assert.equal(today.yesterdayDone.byAssistant[0].name, '小写');
  assert.equal(today.yesterdayDone.byAssistant[0].items[0].id, w.ids.done);
  assert.equal(today.yesterdayDone.byAssistant[0].items[0].selfReported, true);
});

test('今天：昨天的用量只算昨天那一天的调用；没价格就是待定价，绝不估算', async () => {
  const w = await world();
  const { yesterdayUsage: u } = await buildToday(w.deps);
  assert.equal(u.available, true);
  const by = Object.fromEntries(u.byAssistant.map(x => [x.id, x]));
  assert.equal(by.writer.calls, 2);
  assert.equal(by.writer.tokens.input, 1500000);
  assert.equal(by.writer.tokenTotal, 1500000);
  assert.deepEqual(by.writer.cost.amounts, { USD: 1.665 });
  assert.equal(by.writer.cost.label, '已计价');
  assert.equal(by.scout.cost.label, '待定价');
  assert.deepEqual(by.scout.cost.amounts, {});
  assert.equal(by.chief.cost.label, '部分待定价');
  assert.equal(by.chief.cost.pendingCalls, 1);
  assert.equal(u.total.calls, 5);
  assert.equal(u.total.tokens.input, 2500307);
  assert.equal(u.total.cost.label, '部分待定价');
  const none = await buildToday({ ...w.deps, priceBook: undefined });
  assert.ok(none.yesterdayUsage.byAssistant.every(x => x.cost.label === '待定价'));
  assert.equal(costView({ cost: { byCurrency: {}, pendingCalls: 0, expiredCalls: 0, planCalls: 0, localCalls: 0 } })
    .label, '无调用');
});

test('今天：最近一次晚会纪要往前找；超长只截断；固定任务一并带上', async () => {
  const w = await world();
  const today = await buildToday({ ...w.deps, hubConfig: { ...w.deps.hubConfig, today: { minutesMaxChars: 5 } } },
    { routines: createRoutineService(w.deps) });
  assert.equal(today.lastEveningMinutes.date, '2030-01-07');
  assert.equal(today.lastEveningMinutes.file, '2030-01-07-晚会.md');
  assert.equal(today.lastEveningMinutes.text, '# 昨晚晚会'.slice(0, 5));
  assert.equal(today.lastEveningMinutes.truncated, true);
  assert.equal(today.routines.items[0].id, 'daily-post');
  assert.equal(today.routines.items[0].todayState, 'pending');
  const away = await buildToday({ ...w.deps, hubConfig: { ...w.deps.hubConfig, meetings: { minutesDir:
    join(w.dir, 'meetings') } } }, { date: '2030-02-28' });
  assert.equal(away.lastEveningMinutes.date, null);
});

test('今天：每一段独立容错，缺哪段就明说；没有确认卡接口就如实标不可用', async () => {
  const w = await world();
  const broken = { ...w.deps, board: { list: async () => { throw new Error('boom'); } },
    ledger: undefined, cards: { ask() {} } };
  const today = await buildToday(broken);
  assert.equal(today.waiting.available, false);
  assert.equal(today.yesterdayDone.available, false);
  assert.equal(today.yesterdayUsage.available, false);
  assert.equal(today.lastEveningMinutes.available, true);
  assert.equal(today.routines.available, false);
  assert.equal(today.approvals.cardsSource, 'unavailable');
  const live = await buildToday({ ...w.deps, cards: { pending: () => [{ id: 'c1', kind: 'kb-submit',
    title: '要不要投知识库' }] } });
  assert.equal(live.approvals.cardsSource, 'live');
  assert.equal(live.approvals.cards[0].id, 'c1');
  assert.equal(live.approvals.count, 1);
  const empty = await buildToday({});
  assert.equal(empty.waiting.available, false);
});

test('今天：用同一份假时钟，换一天结果跟着变；工单正文里的指令式文字只原样截断不执行', async () => {
  const w = await world();
  clock.t = jst('2030-01-09T08:00:00');
  const later = await buildToday(w.deps);
  assert.equal(later.yesterday, '2030-01-08');
  assert.equal(later.yesterdayDone.total, 0);
  assert.equal(later.yesterdayUsage.total.calls, 1);
  const long = 'x'.repeat(500);
  const t = await w.board.create(me('chief'), { title: long, goal: '目标', to: ['writer'] });
  const view = await buildToday(w.deps);
  assert.ok(view.waiting.counts);
  assert.ok(!JSON.stringify(view).includes(long));
  assert.ok(t.id);
});

function get(handler, url, method = 'GET') {
  const req = Readable.from([]);
  req.url = url;
  req.method = method;
  req.headers = {};
  const res = { text: '' };
  res.writeHead = status => { res.status = status; };
  res.end = text => { res.text += text ?? ''; };
  return handler(req, res).then(handled => ({ handled, status: res.status, body: res.text && JSON.parse(res.text) }));
}

test('HTTP：GET /today/ 返回结构；坏日期 400；非 GET 405；别的前缀不认', async () => {
  const w = await world();
  const handler = createHandler(w.deps);
  assert.equal((await get(handler, '/todayx')).handled, false);
  assert.equal((await get(handler, '/other')).handled, false);
  const ok = await get(handler, '/today/');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.date, '2030-01-08');
  assert.ok(ok.body.waiting && ok.body.yesterdayUsage && ok.body.routines && ok.body.approvals);
  assert.equal((await get(handler, '/today/?date=2030-13-40')).status, 400);
  assert.equal((await get(handler, '/today?date=2030-01-07')).body.date, '2030-01-07');
  assert.equal((await get(handler, '/today/', 'POST')).status, 405);
});
