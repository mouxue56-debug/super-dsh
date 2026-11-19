// · 触发：卡片定时（一次性、重复、夜间、错过补跑、超时不补、全停、权限）。
// 假时钟（时区 +09:00，clock 用 UTC 毫秒）、假会话；看板、触发器、HTTP 处理器是真的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToday } from '../lib/today.mjs';
import { OWNER, CHIEF, at, call, fixture, newCard, good } from './r38-helpers.mjs';

// at(h, m, d) 是 UTC；日本时间 = UTC + 9。例如 at(1,0) = 日本 10:00。
const iso = (h, m = 0, d = 19) => new Date(at(h, m, d)).toISOString();
const todayOf = h => buildToday({ board: h.board, roster: h.roster, hubConfig: h.hubConfig, now: () => h.state.clock,
  cards: { pending: () => [] } });

test('一次性：建卡时选了人和时间，到点前不派、不叫、外部也领不走；到点只派一次、叫醒一次', async () => {
  const h = await fixture();
  const r = await call(h.handler, '/board/tickets/new', { title: '三分钟后的事', to: 'research',
    schedule: { kind: 'once', at: iso(1, 3) } });
  assert.equal(r.status, 201);
  const t = r.body.ticket;
  assert.deepEqual(t.to, [], '没到点之前不写负责人');
  assert.deepEqual(t.schedule.assignee, { name: 'research', type: 'assistant' });
  assert.equal(t.schedule.state, 'waiting');
  assert.equal(t.schedule.template, false);
  await h.settle();
  assert.equal(h.sent.length, 0, '建卡不叫醒');
  h.state.clock = at(1, 2);
  await h.tick();
  await h.settle();
  assert.equal(h.sent.length, 0);
  h.state.clock = at(1, 3, 19) + 5000;
  await h.tick();
  await h.settle();
  const after = await h.board.get(t.id);
  assert.deepEqual(after.to, ['research']);
  assert.equal(after.schedule.state, 'fired');
  assert.equal(h.sent.filter(s => s.bot === 'research').length, 1);
  assert.ok(h.sent[0].text.includes(t.id));
  for (let i = 0; i < 3; i += 1) { h.state.clock += 30000; await h.tick(); await h.settle(); }
  assert.equal(h.sent.filter(s => s.bot === 'research').length, 1, '只叫一次');
});

test('一次性：时间不在未来、坏格式、没有人也没有时间的重复，被拒', async () => {
  const h = await fixture();
  const bad = [
    { kind: 'once', at: iso(0, 59) }, { kind: 'once', at: '乱写' }, { kind: 'once' }, { kind: 'daily', time: '9点' },
    { kind: 'weekly', time: '09:00', days: [] }, { kind: 'weekly', time: '09:00', days: [8] }, { kind: 'hourly', time: '09:00' },
  ];
  for (const schedule of bad) {
    assert.equal((await call(h.handler, '/board/tickets/new', { title: 'x', to: 'research', schedule })).status, 400,
      JSON.stringify(schedule));
  }
  assert.equal((await call(h.handler, '/board/tickets/new', { title: 'x', to: 'nobody', schedule: { kind: 'once', at: iso(2) } })).status, 400);
  assert.equal((await call(h.handler, '/board/tickets/new', { title: 'x', schedule: { kind: 'once', at: iso(2) }, column: 'progress' })).status, 400);
});

test('一次性没选人：到点请首席安排（定时触发条件触发）；时间听主人的，首席只挑人', async () => {
  const h = await fixture();
  const t = (await call(h.handler, '/board/tickets/new', { title: '到点再说谁做', schedule: { kind: 'once', at: iso(2) } })).body.ticket;
  assert.equal(t.schedule.assignee, null);
  h.state.clock = at(2, 0) + 1000;
  await h.tick();
  await h.settle();
  const woke = await h.board.get(t.id);
  assert.equal(woke.arrange.state, 'wanted');
  assert.equal(woke.arrange.via, 'schedule');
  assert.equal(h.sent.filter(s => s.bot === 'chief').length, 1);
  const done = await h.board.arrangeSet(CHIEF, t.id, good({ when: 'at', at: iso(5) }), h.view());
  assert.deepEqual(done.to, ['research']);
  assert.equal(done.arrange.plan.when.kind, 'now', '主人的时间已经到了，所以是现在做');
});

test('先请首席安排、同时主人定了时间：时间听主人的，到点才派', async () => {
  const h = await fixture();
  const t = (await call(h.handler, '/board/tickets/new', { title: '明早做', arrange: true,
    schedule: { kind: 'once', at: iso(23, 0, 19) } })).body.ticket;
  assert.equal(t.arrange.state, 'wanted');
  assert.equal(t.schedule.by, 'owner');
  const done = await h.board.arrangeSet(CHIEF, t.id, good({ when: 'now' }), h.view());
  assert.deepEqual(done.to, [], '主人定的时间没到，先不派');
  assert.equal(done.schedule.assignee.name, 'research');
  assert.equal(done.schedule.at, iso(23, 0, 19));
  h.state.clock = at(23, 0, 19) + 2000;
  await h.tick();
  await h.settle();
  assert.deepEqual((await h.board.get(t.id)).to, ['research']);
  assert.equal(h.sent.filter(s => s.bot === 'research').length, 1);
});

test('首席定的时间：安排成「明早 9 点」→ 卡停在待领，到点才派并叫醒', async () => {
  const h = await fixture();
  const t = await newCard(h, { arrange: true });
  const done = await h.board.arrangeSet(CHIEF, t.id, good({ when: 'at', at: '2026-11-20T09:00:00+09:00' }), h.view());
  assert.deepEqual(done.to, []);
  assert.equal(done.schedule.by, 'chief');
  assert.match(done.arrange.note, /^首席安排：交给 调研员，11 月 20 日 09:00做。因为/);
  await h.settle();
  assert.equal(h.sent.filter(s => s.bot === 'research').length, 0);
  h.state.clock = at(0, 0, 20) + 1000; // 日本 11-20 09:00:01
  await h.tick();
  await h.settle();
  assert.deepEqual((await h.board.get(t.id)).to, ['research']);
  assert.equal(h.sent.filter(s => s.bot === 'research').length, 1);
});

test('重复：每个排班时刻生成一张当次的子卡（标题带日期），同一个时刻只生成一次；母卡留着当模板', async () => {
  const h = await fixture();
  const mother = (await call(h.handler, '/board/tickets/new', { title: '每日晨报', goal: '写三行晨报', to: 'research',
    schedule: { kind: 'daily', time: '11:00' } })).body.ticket;
  assert.equal(mother.schedule.template, true);
  assert.equal(mother.state, 'queued');
  // 建卡时是日本 10:00：今天 11:00 还没到
  h.state.clock = at(1, 30);
  await h.tick();
  assert.equal((await h.board.list()).length, 1);
  h.state.clock = at(2, 0) + 3000; // 日本 11:00:03
  await h.tick();
  await h.settle();
  for (let i = 0; i < 3; i += 1) { h.state.clock += 20000; await h.tick(); await h.settle(); }
  const all = await h.board.list();
  const kids = all.filter(t => t.parentId === mother.id);
  assert.equal(kids.length, 1);
  assert.equal(kids[0].title, '每日晨报（11-19）');
  assert.deepEqual(kids[0].to, ['research']);
  assert.equal(kids[0].goal, '写三行晨报');
  assert.equal(h.sent.filter(s => s.bot === 'research').length, 1);
  const m2 = await h.board.get(mother.id);
  assert.equal(m2.state, 'queued');
  assert.deepEqual(m2.to, []);
  assert.equal(m2.schedule.lastSlot, iso(2, 0));
  // 第二天
  h.state.clock = at(2, 0, 20) + 3000;
  await h.tick();
  await h.settle();
  const kids2 = (await h.board.list()).filter(t => t.parentId === mother.id).map(t => t.title).sort();
  assert.deepEqual(kids2, ['每日晨报（11-19）', '每日晨报（11-20）']);
  // 母卡不会被当成普通开放卡或安排对象
  assert.deepEqual((await h.board.list({ open: true })), []);
  await assert.rejects(() => h.board.arrangeAsk(OWNER, mother.id, 'button'), { code: 'CONFLICT' });
});

test('每周：只在选定的星期出子卡；建卡之前的时刻不补', async () => {
  const h = await fixture(); // 11-19 是周四
  const mother = (await call(h.handler, '/board/tickets/new', { title: '周会', to: 'content',
    schedule: { kind: 'weekly', time: '09:00', days: [1, 5] } })).body.ticket;
  h.state.clock = at(0, 30, 19);
  await h.tick();
  assert.equal((await h.board.list()).filter(t => t.parentId === mother.id).length, 0, '周四不排，也不补周一的');
  h.state.clock = at(0, 30, 20); // 周五 09:30
  await h.tick();
  await h.settle();
  const kids = (await h.board.list()).filter(t => t.parentId === mother.id);
  assert.equal(kids.length, 1);
  assert.equal(kids[0].title, '周会（11-20）');
});

test('夜间：到点的助理照样叫醒、话里要求别打扰；要主人点头的顺延到早上 8 点才出现在今天页', async () => {
  const h = await fixture({ clock: at(14, 0) }); // 日本 23:00
  const night = (await call(h.handler, '/board/tickets/new', { title: '夜里的活', to: 'research',
    schedule: { kind: 'once', at: iso(14, 30) } })).body.ticket; // 日本 23:30
  const risky = (await call(h.handler, '/board/tickets/new', { title: '夜里把名字发到对外的公众号', arrange: true,
    schedule: { kind: 'once', at: iso(14, 40) } })).body.ticket;
  await h.tick();
  await h.settle();
  await h.board.arrangeSet(CHIEF, risky.id, good(), h.view());
  h.state.clock = at(14, 31);
  await h.tick();
  await h.settle();
  const wake = h.sent.filter(s => s.bot === 'research');
  assert.equal(wake.length, 1);
  assert.ok(wake[0].text.includes('夜间静默') && wake[0].text.includes(night.id));
  const p = await h.board.get(risky.id);
  assert.equal(p.arrange.state, 'proposed', '要点头的没派');
  assert.deepEqual(p.to, []);
  const evs = h.events.filter(e => e.id === risky.id && e.type === 'arrange_set');
  assert.ok(evs.length && evs.every(e => e.attention !== true), '夜里不发提醒');
  let today = await todayOf(h);
  assert.equal(today.arrangements.items.length, 0, '夜里今天页先不出现');
  assert.equal(today.arrangements.hidden, 1);
  h.state.clock = at(23, 0, 19) + 60000; // 日本 08:01
  today = await todayOf(h);
  assert.equal(today.arrangements.items.length, 1, '早上出现');
});

test('错过的点：服务停了一阵，启动后只补最近那一个（一次），更早的记成没赶上', async () => {
  const h = await fixture();
  const mother = (await call(h.handler, '/board/tickets/new', { title: '每日巡检', to: 'research',
    schedule: { kind: 'daily', time: '09:00' } })).body.ticket;
  // 服务停了：11-20、11-21 的 09:00 都没跑；11-22 日本 09:30 才起来
  h.state.clock = at(0, 30, 22);
  await h.tick();
  await h.settle();
  const kids = (await h.board.list()).filter(t => t.parentId === mother.id);
  assert.equal(kids.length, 1, '只补一次');
  assert.equal(kids[0].title, '每日巡检（11-22）');
  const m = await h.board.get(mother.id);
  assert.equal(m.schedule.missed.length, 2, '11-20、11-21 记成没赶上');
  const today = await todayOf(h);
  assert.equal(today.schedules.missed.count, 2);
  for (let i = 0; i < 3; i += 1) { h.state.clock += 20000; await h.tick(); await h.settle(); }
  assert.equal((await h.board.list()).filter(t => t.parentId === mother.id).length, 1);
});

test('错过超过 6 小时的不补：重复的不建子卡，一次性的标「没赶上」；今天页提示有 N 个定时没赶上', async () => {
  const h = await fixture();
  const mother = (await call(h.handler, '/board/tickets/new', { title: '晨间整理', to: 'research',
    schedule: { kind: 'daily', time: '09:00' } })).body.ticket;
  const once = (await call(h.handler, '/board/tickets/new', { title: '昨晚的事', to: 'content',
    schedule: { kind: 'once', at: iso(2, 0) } })).body.ticket; // 日本 11:00
  h.state.clock = at(11, 0, 20); // 日本 11-20 20:00：09:00 已过 11 小时；11:00 的一次性也已过很久
  await h.tick();
  await h.settle();
  assert.equal((await h.board.list()).filter(t => t.parentId === mother.id).length, 0);
  assert.equal(h.sent.length, 0, '没叫任何人');
  const o = await h.board.get(once.id);
  assert.equal(o.schedule.state, 'missed');
  assert.deepEqual(o.to, []);
  const today = await todayOf(h);
  assert.ok(today.schedules.missed.count >= 2, '今天页提示：' + today.schedules.missed.count);
  // 刚好没到 6 小时的还补：模板在 14:59 前
  const h2 = await fixture();
  const m2 = (await call(h2.handler, '/board/tickets/new', { title: '晨间整理', to: 'research',
    schedule: { kind: 'daily', time: '09:00' } })).body.ticket;
  h2.state.clock = at(5, 50, 20); // 日本 14:50，离 09:00 是 5 小时 50 分
  await h2.tick();
  assert.equal((await h2.board.list()).filter(t => t.parentId === m2.id).length, 1);
});

test('一键全停：到点也不派；恢复后（还在 6 小时内）补一次；暂停的模板不出子卡，恢复后接着出', async () => {
  const h = await fixture({ stopped: true });
  const once = (await call(h.handler, '/board/tickets/new', { title: '停着的时候到点', to: 'research',
    schedule: { kind: 'once', at: iso(2, 0) } })).body.ticket;
  h.state.clock = at(2, 5);
  await h.tick();
  await h.settle();
  assert.deepEqual((await h.board.get(once.id)).to, []);
  h.state.stopped = false;
  await h.tick();
  await h.settle();
  assert.deepEqual((await h.board.get(once.id)).to, ['research']);
  assert.equal(h.sent.filter(s => s.bot === 'research').length, 1);
  const mother = (await call(h.handler, '/board/tickets/new', { title: '可暂停', to: 'content',
    schedule: { kind: 'daily', time: '12:00' } })).body.ticket;
  assert.equal((await call(h.handler, `/board/tickets/${mother.id}/schedule`, { action: 'pause' })).status, 200);
  h.state.clock = at(3, 5);
  await h.tick();
  assert.equal((await h.board.list()).filter(t => t.parentId === mother.id).length, 0);
  await call(h.handler, `/board/tickets/${mother.id}/schedule`, { action: 'resume' });
  h.state.clock = at(3, 10);
  await h.tick();
  assert.equal((await h.board.list()).filter(t => t.parentId === mother.id).length, 1);
});

test('给已有的卡设定时、取消；只有主人能；有人在做的、接力卡不行', async () => {
  const h = await fixture();
  const t = await newCard(h);
  const set = await call(h.handler, `/board/tickets/${t.id}/schedule`, { action: 'set', assignee: 'research',
    schedule: { kind: 'once', at: iso(3) } });
  assert.equal(set.status, 200);
  assert.equal(set.body.ticket.schedule.assignee.name, 'research');
  assert.equal((await call(h.handler, `/board/tickets/${t.id}/schedule`, { action: 'clear' })).status, 200);
  assert.equal((await h.board.get(t.id)).schedule, undefined);
  await assert.rejects(() => h.board.scheduleSet(CHIEF, t.id, { kind: 'once', at: iso(3) }, null), { code: 'FORBIDDEN' });
  await assert.rejects(() => h.board.schedulePause({ name: 'codex', type: 'external' }, t.id, true), { code: 'FORBIDDEN' });
  const doing = await newCard(h, { to: 'research' });
  await h.board.claim({ name: 'research', type: 'assistant' }, doing.id);
  assert.equal((await call(h.handler, `/board/tickets/${doing.id}/schedule`, { action: 'set', schedule: { kind: 'once', at: iso(3) } })).status, 409);
  const relay = (await h.board.relayCreate(OWNER, { title: 'r', goal: 'r', steps: [
    { who: { name: 'research', type: 'assistant' }, task: 'a' }, { who: { name: 'content', type: 'assistant' }, task: 'b' }] })).ticket;
  assert.equal((await call(h.handler, `/board/tickets/${relay.id}/schedule`, { action: 'set', schedule: { kind: 'once', at: iso(3) } })).status, 409);
});

test('今天页「今天的固定任务」：列出今天到点的卡（一次性的和模板的），带当次子卡状态', async () => {
  const h = await fixture();
  await call(h.handler, '/board/tickets/new', { title: '下午的事', to: 'research', schedule: { kind: 'once', at: iso(6, 0) } });
  const mother = (await call(h.handler, '/board/tickets/new', { title: '每天对账', to: 'content',
    schedule: { kind: 'daily', time: '10:30' } })).body.ticket;
  await call(h.handler, '/board/tickets/new', { title: '明天的事', to: 'research', schedule: { kind: 'once', at: iso(6, 0, 20) } });
  h.state.clock = at(1, 40);
  await h.tick();
  const today = await todayOf(h);
  assert.equal(today.schedules.available, true);
  const titles = today.schedules.items.map(i => i.title);
  assert.deepEqual(titles.sort(), ['下午的事', '每天对账'].sort());
  const row = today.schedules.items.find(i => i.id === mother.id);
  assert.equal(row.template, true);
  assert.ok(row.child, '日本 10:40 已出了当次子卡');
});

test('旧卡完全不受影响：没有 schedule / arrange 字段的卡，定时检查碰都不碰', async () => {
  const h = await fixture();
  const plain = await newCard(h, { to: 'research' });
  const before = JSON.stringify(await h.board.get(plain.id));
  h.state.clock = at(23, 0, 20);
  await h.tick();
  await h.tick();
  assert.equal(JSON.stringify(await h.board.get(plain.id)), before);
});

test('主人自己动了定时的卡：一次性的定时作废；模板被挪走就不再出子卡', async () => {
  const h = await fixture();
  const once = (await call(h.handler, '/board/tickets/new', { title: '被拖走的', to: 'research',
    schedule: { kind: 'once', at: iso(2, 0) } })).body.ticket;
  const moved = (await call(h.handler, `/board/tickets/${once.id}/move`, { column: 'progress' })).body.ticket;
  assert.equal(moved.schedule, undefined, '主人自己挪了：定时作废');
  assert.equal(moved.arrange, undefined, '带定时的卡被拖不触发首席安排');
  h.state.clock = at(2, 5);
  await h.tick();
  await h.settle();
  assert.equal(h.sent.length, 0);
  const mother = (await call(h.handler, '/board/tickets/new', { title: '被挪走的模板', to: 'content',
    schedule: { kind: 'daily', time: '12:00' } })).body.ticket;
  await call(h.handler, `/board/tickets/${mother.id}/move`, { column: 'done' });
  h.state.clock = at(3, 5);
  await h.tick();
  assert.equal((await h.board.list()).filter(t => t.parentId === mother.id).length, 0);
});
