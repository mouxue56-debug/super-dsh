import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createBoard } from '../lib/board.mjs';
import { loadExtensions } from '../lib/ext/index.mjs';
import { createHandler } from '../lib/ext/routines.mjs';
import { createRoutineService, normalizeRoutine, parseRoutinesConfig, slotStatus, inQuiet }
  from '../lib/routines.mjs';

const T0 = Date.parse('2030-01-07T07:30:00+09:00');
const quiet = { error() {} };
const item = (extra = {}) => ({ id: 'daily-post', name: '日更', assistant: 'writer', at: '07:30',
  prompt: '写今天的一篇短文', done: '草稿已放到指定目录', escape: { maxSteps: 3, maxMinutes: 30 }, ...extra });

async function setup(items = [item()], options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'routines-'));
  const clock = { t: options.start ?? T0 };
  const board = createBoard({ root: join(dir, 'board'), now: () => clock.t });
  const notes = [];
  const sent = [];
  const behaviour = { onSend: async () => {}, hang: false };
  const sessions = {
    created: [],
    async create(bot, opts) {
      sessions.created.push({ bot, opts });
      return { id: 'sess-' + sessions.created.length };
    },
    async send(id, text) {
      sent.push({ id, text });
      if (behaviour.hang) return { accepted: true, reply: new Promise(() => {}) };
      await behaviour.onSend(text, sent.length);
      return { accepted: true, reply: Promise.resolve({ failed: false }) };
    },
  };
  const deps = {
    dataDir: options.noData ? undefined : join(dir, 'data'), now: () => clock.t, board, sessions,
    hubConfig: { routines: { utcOffsetMinutes: 540, items, ...options.config } },
    roster: { get: id => ['writer', 'chief'].includes(id) ? { id, status: 'active' } : undefined },
    notify: event => { notes.push(event); }, logger: quiet,
    timers: options.timers,
  };
  return { dir, clock, board, deps, notes, sent, sessions, behaviour, service: createRoutineService(deps) };
}

const me = name => ({ name, type: 'assistant' });

test('配置校验：缺完成条件、缺逃生口、坏时间、prompt 与 playbook 必须二选一', () => {
  assert.equal(normalizeRoutine(item()).ok, true);
  const reasons = [
    item({ done: undefined }), item({ escape: undefined }), item({ escape: { maxSteps: 0, maxMinutes: 5 } }),
    item({ escape: { maxSteps: 2 } }), item({ at: '7:30' }), item({ playbook: '手册' }),
    item({ prompt: undefined }), item({ days: [0] }), item({ quiet: { from: '25:00', to: '01:00' } }),
  ].map(raw => normalizeRoutine(raw));
  assert.ok(reasons.every(r => r.ok === false), JSON.stringify(reasons));
  assert.equal(normalizeRoutine(item({ prompt: undefined, playbook: '日更手册' })).ok, true);
  const parsed = parseRoutinesConfig({ items: [item(), item({ at: 'bad', id: 'broken' }), item()] });
  assert.equal(parsed.routines.length, 1);
  assert.deepEqual(parsed.invalid.map(x => x.id), ['broken', 'daily-post']);
  assert.equal(parsed.catchUp, false);
});

test('到点判断：未到、到点、错过、安静时段、星期', () => {
  const routine = normalizeRoutine(item({ quiet: { from: '22:00', to: '06:00' }, days: [1, 2] })).routine;
  const cfg = { graceMinutes: 10, catchUp: false, catchUpMinutes: 240 };
  const at = minute => slotStatus(routine, cfg, { date: '2030-01-07', minute });
  assert.equal(at(7 * 60 + 29), 'upcoming');
  assert.equal(at(7 * 60 + 30), 'due');
  assert.equal(at(7 * 60 + 40), 'due');
  assert.equal(at(7 * 60 + 41), 'missed');
  assert.equal(slotStatus(routine, { ...cfg, catchUp: true }, { date: '2030-01-07', minute: 10 * 60 }), 'due');
  assert.equal(slotStatus(routine, cfg, { date: '2030-01-09', minute: 8 * 60 }), 'off');
  const night = normalizeRoutine(item({ at: '23:30', quiet: { from: '22:00', to: '06:00' } })).routine;
  assert.equal(slotStatus(night, cfg, { date: '2030-01-07', minute: 23 * 60 + 31 }), 'quiet');
  assert.equal(inQuiet({ from: '22:00', to: '06:00' }, 3 * 60), true);
  assert.equal(inQuiet({ from: '22:00', to: '06:00' }, 12 * 60), false);
});

test('定时：未到点不动；到点建工单、领单、开新会话、发带完成条件的话；助理回报后算做完', async () => {
  const s = await setup();
  s.clock.t = T0 - 60000;
  assert.deepEqual(await s.service.tick(), []);
  assert.equal((await s.board.list()).length, 0);
  s.clock.t = T0;
  s.behaviour.onSend = async () => {
    const [ticket] = await s.board.list();
    await s.board.report(me('writer'), ticket.id, { summary: '草稿已放好', artifacts: ['draft.md'] });
  };
  const result = await s.service.tick();
  assert.equal(result.length, 1);
  assert.equal(result[0].state, 'reported');
  const [ticket] = await s.board.list();
  assert.equal(ticket.state, 'progress');
  assert.equal(ticket.claimedBy, 'writer');
  assert.equal(ticket.review, 'submitted');
  assert.equal(ticket.reports[0].selfReported, true);
  assert.equal(ticket.routing.via, 'routine');
  assert.match(ticket.title, /2030-01-07/u);
  assert.equal(s.sessions.created[0].bot, 'writer');
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0].text, /完成条件：草稿已放到指定目录/u);
  assert.match(s.sent[0].text, /最多 3 步、最多 30 分钟/u);
  assert.ok(s.notes.some(n => n.type === 'routine' && n.state === 'reported'));
  assert.deepEqual(await s.service.tick(), [], '同一天不重复运行');
  assert.equal((await s.board.list()).length, 1);
  s.clock.t = T0 + 86400000;
  assert.equal((await s.service.tick()).length, 1);
  assert.equal((await s.board.list()).length, 2);
});

test('逃生口·步数：用满步数仍没回报就停，工单标阻断「没做完」并出通知', async () => {
  const s = await setup([item({ escape: { maxSteps: 2, maxMinutes: 30 } })]);
  const [outcome] = await s.service.tick();
  assert.equal(outcome.state, 'incomplete');
  assert.equal(s.sent.length, 2);
  const [ticket] = await s.board.list();
  assert.equal(ticket.state, 'blocked');
  assert.match(ticket.progress.at(-1).text, /没做完/u);
  assert.ok(s.notes.some(n => n.state === 'incomplete'));
  assert.equal(s.service.runs().at(-1).state, 'incomplete');
});

test('逃生口·时间：回合跑过最长时间，不再发新话，工单标超时', async () => {
  const s = await setup([item({ escape: { maxSteps: 5, maxMinutes: 10 } })]);
  s.behaviour.onSend = async () => { s.clock.t += 11 * 60000; };
  const [outcome] = await s.service.tick();
  assert.equal(outcome.state, 'timeout');
  assert.equal(s.sent.length, 1);
  assert.equal((await s.board.list())[0].state, 'waiting-timeout');
});

test('逃生口·时间：回合一直不返回时用计时器停下，并尝试取消会话', async () => {
  const timers = { setTimeout: fn => setTimeout(fn, 5), clearTimeout };
  const s = await setup([item({ escape: { maxSteps: 5, maxMinutes: 10 } })], { timers });
  s.behaviour.hang = true;
  const cancelled = [];
  s.sessions.cancel = id => { cancelled.push(id); };
  const [outcome] = await s.service.tick();
  assert.equal(outcome.state, 'timeout');
  assert.deepEqual(cancelled, ['sess-1']);
  assert.equal((await s.board.list())[0].state, 'waiting-timeout');
});

test('助理自己标了阻断：停止继续催，记为 blocked', async () => {
  const s = await setup();
  s.behaviour.onSend = async () => {
    const [ticket] = await s.board.list();
    await s.board.block(me('writer'), ticket.id, '缺素材', { waitHuman: true });
  };
  const [outcome] = await s.service.tick();
  assert.equal(outcome.state, 'blocked');
  assert.equal(s.sent.length, 1);
});

test('安静时段：到点落在安静时段内就不跑，只记一行', async () => {
  const s = await setup([item({ at: '23:30', quiet: { from: '23:00', to: '06:00' } })],
    { start: Date.parse('2030-01-07T23:31:00+09:00') });
  assert.deepEqual(await s.service.tick(), []);
  assert.equal((await s.board.list()).length, 0);
  assert.equal(s.service.runs().at(-1).state, 'skipped-quiet');
});

test('错过：后端当时没在跑，默认不补只记一行；配置了补做才补', async () => {
  const late = Date.parse('2030-01-07T12:00:00+09:00');
  const s = await setup([item()], { start: late });
  assert.deepEqual(await s.service.tick(), []);
  assert.equal((await s.board.list()).length, 0);
  assert.equal(s.service.runs().at(-1).state, 'missed');
  assert.deepEqual(await s.service.tick(), []);
  assert.equal(s.service.runs().filter(r => r.state === 'missed').length, 1, '只记一行');
  const c = await setup([item()], { start: Date.parse('2030-01-07T09:00:00+09:00'), config: { catchUp: true } });
  assert.equal((await c.service.tick()).length, 1);
  assert.equal((await c.board.list()).length, 1);
});

test('错过：整天没开后端，第二天启动时昨天的一档记一行', async () => {
  const s = await setup([item()]);
  s.clock.t = T0 - 3600000;
  await s.service.tick();
  s.clock.t = T0 + 86400000 + 3600000 * 4;
  await s.service.tick();
  const missed = s.service.runs().filter(r => r.state === 'missed').map(r => r.date);
  assert.deepEqual(missed.sort(), ['2030-01-07', '2030-01-08']);
});

test('暂停：全局与单条都落盘，重启后仍暂停，恢复要显式调用', async () => {
  const s = await setup([item(), item({ id: 'other', name: '另一条' })]);
  assert.equal(s.service.pause('daily-post').state, 'paused');
  assert.equal(s.service.pause('nope').state, 'not-found');
  const first = await s.service.tick();
  assert.deepEqual(first.map(x => x.id), ['other']);
  s.service.pause();
  s.clock.t += 86400000;
  const again = createRoutineService(s.deps);
  assert.deepEqual(await again.tick(), []);
  assert.equal(again.list().paused, true);
  assert.deepEqual(await again.runNow('other'), { state: 'skipped-paused' });
  again.resume();
  assert.equal((await again.tick()).length, 1, '单条仍暂停，只跑另一条');
  again.resume('daily-post');
  assert.equal(again.list().items.find(x => x.id === 'daily-post').paused, false);
});

test('手动跑一次：建工单；同一条同时只跑一份；不存在的 id 是 not-found', async () => {
  const s = await setup();
  let release;
  s.behaviour.onSend = (text, n) => (n === 1 ? new Promise(resolve => { release = resolve; }) : undefined);
  const one = s.service.runNow('daily-post');
  for (let i = 0; i < 200 && !release; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(await s.service.runNow('daily-post'), { state: 'skipped-busy' });
  assert.equal(s.service.list().items[0].running, true);
  release();
  const result = await one;
  assert.equal(result.state, 'incomplete');
  assert.equal((await s.board.list()).length, 1);
  assert.deepEqual(await s.service.runNow('nope'), { state: 'not-found' });
});

test('助理不存在或看板缺失：如实记失败，不假装运行', async () => {
  const s = await setup([item({ assistant: 'ghost' })]);
  const [outcome] = await s.service.tick();
  assert.equal(outcome.state, 'failed');
  assert.equal(s.sent.length, 0);
  const bare = createRoutineService({ ...s.deps, board: undefined, roster: undefined });
  s.clock.t += 86400000;
  assert.equal((await bare.tick())[0].state, 'failed');
});

test('同一天同一条的幂等键：状态文件丢了也不会重复建单', async () => {
  const s = await setup();
  await s.service.tick();
  const other = createRoutineService({ ...s.deps, dataDir: join(s.dir, 'data2') });
  const [again] = await other.tick();
  assert.equal(again.state, 'skipped-duplicate');
  assert.equal((await s.board.list()).length, 1);
});

test('后端重启：没有结束记录的运行标中断，工单标拿不准', async () => {
  const s = await setup();
  s.behaviour.hang = true;
  const timers = { setTimeout: fn => setTimeout(fn, 5), clearTimeout };
  const gone = createRoutineService({ ...s.deps, timers });
  const run = await gone.runNow('daily-post');
  assert.equal(run.state, 'timeout');
  const rows = (await readFile(join(s.dir, 'data', 'routines', 'runs.jsonl'), 'utf8')).trim().split('\n')
    .map(line => JSON.parse(line)).filter(row => row.state !== 'timeout');
  await writeFile(join(s.dir, 'data', 'routines', 'runs.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const ticket = (await s.board.list())[0];
  await s.board.resume(me('writer'), ticket.id);
  const fresh = createRoutineService(s.deps);
  assert.equal(await fresh.recover(), 1);
  assert.equal((await s.board.get(ticket.id)).state, 'uncertain');
  assert.equal(fresh.runs().at(-1).state, 'interrupted');
  assert.equal(await fresh.recover(), 0);
});

function call(handler, url, method = 'GET') {
  const req = Readable.from([]);
  req.url = url;
  req.method = method;
  req.headers = {};
  const res = { text: '', headersSent: false };
  res.writeHead = status => { res.status = status; };
  res.end = text => { res.text += text ?? ''; };
  return handler(req, res).then(handled => ({ handled, status: res.status, body: res.text && JSON.parse(res.text) }));
}

test('HTTP：列表、运行、暂停、恢复、运行记录；别的前缀不认；错误方法 405', async () => {
  const s = await setup();
  const handler = createHandler(s.deps);
  assert.equal((await call(handler, '/other')).handled, false);
  assert.equal((await call(handler, '/routinesx')).handled, false);
  const list = await call(handler, '/routines/');
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].id, 'daily-post');
  assert.equal(list.body.items[0].todayState, 'pending');
  assert.equal((await call(handler, '/routines/daily-post/run', 'GET')).status, 405);
  assert.equal((await call(handler, '/routines/nope-x/run', 'POST')).status, 404);
  assert.equal((await call(handler, '/routines/pause', 'POST')).body.state, 'paused');
  assert.equal((await call(handler, '/routines/daily-post/run', 'POST')).body.state, 'skipped-paused');
  assert.equal((await call(handler, '/routines/resume', 'POST')).body.state, 'resumed');
  const ran = await call(handler, '/routines/daily-post/run', 'POST');
  assert.equal(ran.status, 200);
  assert.ok(ran.body.ticket);
  const runs = await call(handler, '/routines/runs?limit=5');
  assert.ok(runs.body.runs.length >= 2);
  assert.equal((await call(handler, '/routines/unknown/deep/path')).status, 404);
});

test('加载器：routines 与 today 只在密钥校验之后的阶段处理', async () => {
  const dir = fileURLToPath(new URL('../lib/ext/', import.meta.url));
  const ext = await loadExtensions({ dir, deps: {}, logger: quiet, only: ['routines', 'today'] });
  assert.deepEqual(ext.names, ['routines', 'today']);
  assert.equal(ext.matches('/routines/', 'private'), true);
  assert.equal(ext.matches('/today/', 'private'), true);
  assert.equal(ext.matches('/today/', 'public'), false);
  assert.equal(ext.matches('/routines/', 'public'), false);
  assert.equal(ext.matches('/todayx', 'private'), false);
});
