import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createOwnerNotices, resolveNoticeConfig, NOTICE_DEFAULTS } from '../lib/owner-notices.mjs';
import { createHandler } from '../lib/ext/notices.mjs';

const roster = [
  { id: 'lead-1', name: '领头', role: 'chief', status: 'active' },
  { id: 'hand-1', name: '接手', role: 'bot', status: 'active' },
];

function at(iso) {
  return Date.parse(iso);
}

function ticket(over = {}) {
  return {
    id: 'T-20261119-010000-abcd',
    title: '事项',
    state: 'completed',
    review: 'accepted',
    from: { name: 'hand-1', type: 'assistant' },
    to: ['hand-1'],
    claimedBy: 'hand-1',
    sessions: { from: 'conv-1', to: '' },
    open_ask: null,
    report: { summary: '已经对过', ts: '2026-11-19T01:00:00.000Z' },
    verification: [{ verdict: 'pass', note: '对过' }],
    history: [{ ts: '2026-11-19T01:00:00.000Z', action: 'accepted' }],
    updatedAt: '2026-11-19T01:00:00.000Z',
    ...over,
  };
}

function ask(over = {}) {
  return ticket({
    state: 'waiting-human',
    review: 'none',
    report: null,
    verification: [],
    history: [],
    open_ask: { text: '走哪条？', ts: '2026-11-19T09:00:00.000Z' },
    ...over,
  });
}

async function directory() {
  return mkdtemp(join(tmpdir(), 'notices-'));
}

function setup(dir, extra = {}) {
  const clock = { ms: at('2026-11-19T08:30:00.000Z') };
  const box = { tickets: [], sends: 0, lists: 0 };
  const core = createOwnerNotices({
    dataDir: dir,
    now: () => clock.ms,
    hubConfig: { notices: { utcOffsetMinutes: 0, ...(extra.notices || {}) } },
    panic: { isStopped: () => extra.stopped?.() === true },
    board: { list: async () => { box.lists += 1; return box.tickets; } },
    roster: { list: async () => roster },
    sessions: { send: () => { box.sends += 1; } },
  });
  return { clock, box, core };
}

async function saved(dir) {
  return JSON.parse(await readFile(join(dir, 'notices', 'state.json'), 'utf8'));
}

test('暂定尺度的坏值退回默认，白天上限不被放大', () => {
  const config = resolveNoticeConfig({ dayCap: 9, quietStartMin: -1, mergeMs: 1 });
  assert.equal(config.dayCap, NOTICE_DEFAULTS.dayCap);
  assert.equal(config.quietStartMin, NOTICE_DEFAULTS.quietStartMin);
  assert.equal(config.mergeMs, NOTICE_DEFAULTS.mergeMs);
  assert.equal(resolveNoticeConfig({ dayCap: 0 }).dayCap, 0);
});

test('晨间把结果和待答合成一句，入口指向原会话', async () => {
  const dir = await directory();
  const { box, core } = setup(dir);
  box.tickets = [
    ticket({ history: [{ ts: '2026-11-19T08:00:00.000Z', action: 'accepted' }] }),
    ask({ id: 'T-20261119-080100-ask1', sessions: { from: 'conv-ask', to: '' } }),
  ];
  const first = await core.current();
  assert.equal(first.ok, true);
  assert.equal(first.notice.kind, 'morning');
  assert.equal(first.notice.speakerId, 'lead-1');
  assert.match(first.notice.text, /^早。/);
  assert.match(first.notice.text, /1件结果/);
  assert.match(first.notice.text, /1处等你定/);
  assert.deepEqual(first.notice.entry, { type: 'conversation', id: 'conv-ask' });
  const again = await core.current();
  assert.equal(again.notice.id, first.notice.id);
  assert.equal((await saved(dir)).days['2026-11-19'].morning, 1);
  assert.equal((await saved(dir)).days['2026-11-19'].daytime, 0);
});

test('没有新变化就略过晨句', async () => {
  const dir = await directory();
  const { core } = setup(dir);
  const first = await core.current();
  assert.equal(first.notice, null);
  const state = await saved(dir);
  assert.equal(state.days['2026-11-19'].morningDecided, true);
  assert.equal(state.days['2026-11-19'].morning, 0);
  assert.equal((await core.current()).notice, null);
});

test('夜里和 08:30 前不说话，到点才补晨句', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  box.tickets = [ticket({
    history: [{ ts: '2026-11-19T06:00:00.000Z', action: 'accepted' }],
  })];
  clock.ms = at('2026-11-19T23:10:00.000Z');
  assert.equal((await core.current()).notice, null);
  assert.equal((await core.current()).quiet, true);
  clock.ms = at('2026-11-20T07:40:00.000Z');
  assert.equal((await core.current()).notice, null);
  clock.ms = at('2026-11-20T08:10:00.000Z');
  assert.equal((await core.current()).notice, null);
  clock.ms = at('2026-11-20T08:30:00.000Z');
  const morning = await core.current();
  assert.match(morning.notice.text, /^早。/);
  assert.equal(morning.notice.kind, 'morning');
});

test('跨午夜不重复已经说过的那句，当天睡过点只补一条', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  await core.current();
  box.tickets = [ticket({
    history: [{ ts: '2026-11-19T16:00:00.000Z', action: 'accepted' }],
    updatedAt: '2026-11-19T16:00:00.000Z',
  })];
  clock.ms = at('2026-11-19T16:05:00.000Z');
  const day = await core.current();
  assert.equal(day.notice.kind, 'result');
  assert.equal(day.notice.speakerId, 'hand-1');
  assert.match(day.notice.text, /已经对过/);
  clock.ms = at('2026-11-19T22:30:00.000Z');
  assert.equal((await core.current()).notice, null);
  clock.ms = at('2026-11-20T00:20:00.000Z');
  assert.equal((await core.current()).notice, null);
  clock.ms = at('2026-11-20T09:00:00.000Z');
  assert.equal((await core.current()).notice, null);
  const dir2 = await directory();
  const clock2 = { ms: at('2026-11-19T07:00:00.000Z') };
  const box2 = { tickets: [ticket({
    id: 'T-20261119-060000-slp2',
    history: [{ ts: '2026-11-19T06:30:00.000Z', action: 'accepted' }],
  })] };
  const slept = createOwnerNotices({
    dataDir: dir2, now: () => clock2.ms,
    hubConfig: { notices: { utcOffsetMinutes: 0 } },
    board: { list: async () => box2.tickets }, roster,
  });
  assert.equal((await slept.current()).notice, null);
  clock2.ms = at('2026-11-19T10:00:00.000Z');
  const catchup = await slept.current();
  assert.match(catchup.notice.text, /^早。/);
  clock2.ms = at('2026-11-19T10:40:00.000Z');
  const same = await slept.current();
  assert.equal(same.notice.id, catchup.notice.id);
  assert.equal((await saved(dir2)).days['2026-11-19'].daytime, 0);
});

test('白天最多两句，30 分钟内合成一句，再喂十次也不另起', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  await core.current();
  const ids = ['T-20261119-130000-aa01', 'T-20261119-150000-aa02', 'T-20261119-170000-aa03'];
  const times = ['2026-11-19T13:00:00.000Z', '2026-11-19T15:00:00.000Z', '2026-11-19T17:00:00.000Z'];
  const shown = [];
  for (let index = 0; index < 3; index += 1) {
    box.tickets.push(ticket({
      id: ids[index],
      history: [{ ts: times[index], action: 'accepted' }],
      report: { summary: '结果' + (index + 1) },
    }));
    clock.ms = at(times[index]) + 6 * 60 * 1000;
    shown.push(await core.current());
  }
  assert.equal(shown[0].notice.kind, 'result');
  assert.equal(shown[1].notice.kind, 'result');
  assert.notEqual(shown[0].notice.id, shown[1].notice.id);
  assert.equal(shown[2].notice?.id, shown[1].notice.id);
  assert.equal((await saved(dir)).days['2026-11-19'].daytime, 2);
  const firstId = shown[0].notice.id;
  for (let index = 0; index < 10; index += 1) {
    clock.ms += 6 * 60 * 1000;
    const again = await core.current();
    assert.equal(again.notice.id, shown[1].notice.id);
    assert.notEqual(again.notice.id, firstId);
  }
  assert.equal((await saved(dir)).days['2026-11-19'].daytime, 2);

  const dirMerge = await directory();
  const merged = setup(dirMerge);
  await merged.core.current();
  merged.clock.ms = at('2026-11-19T10:00:00.000Z');
  await merged.core.current();
  merged.box.tickets = [
    ticket({ id: 'T-20261119-100500-mm01', history: [{ ts: '2026-11-19T10:05:00.000Z', action: 'accepted' }] }),
    ticket({ id: 'T-20261119-102000-mm02', history: [{ ts: '2026-11-19T10:20:00.000Z', action: 'accepted' }] }),
  ];
  merged.clock.ms = at('2026-11-19T10:25:00.000Z');
  const one = await merged.core.current();
  assert.match(one.notice.text, /2件结果/);
  assert.equal((await saved(dirMerge)).days['2026-11-19'].daytime, 1);
  const keys = Object.keys((await saved(dirMerge)).seen).filter(key => key.startsWith('result:'));
  assert.equal(keys.length, 2);
});

test('相距超过 30 分钟的两件分成两句', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  clock.ms = at('2026-11-19T08:30:00.000Z');
  await core.current();
  clock.ms = at('2026-11-19T11:00:00.000Z');
  await core.current();
  box.tickets = [
    ticket({ id: 'T-20261119-100000-ff01', history: [{ ts: '2026-11-19T10:00:00.000Z', action: 'accepted' }] }),
    ticket({ id: 'T-20261119-113000-ff02', history: [{ ts: '2026-11-19T11:30:00.000Z', action: 'accepted' }] }),
  ];
  clock.ms = at('2026-11-19T11:20:00.000Z');
  const early = await core.current();
  assert.match(early.notice.text, /已经对过|点开就能看/);
  assert.doesNotMatch(early.notice.text, /2件/);
  clock.ms = at('2026-11-19T12:00:00.000Z');
  const later = await core.current();
  assert.notEqual(later.notice.id, early.notice.id);
  assert.equal((await saved(dir)).days['2026-11-19'].daytime, 2);
});

test('同一张单同一个问题不重复问，换了问法才再算一句', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  await core.current();
  box.tickets = [ask({ open_ask: { text: '走哪条？', ts: '2026-11-19T15:00:00.000Z' } })];
  clock.ms = at('2026-11-19T15:05:00.000Z');
  const first = await core.current();
  assert.equal(first.notice.kind, 'ask');
  assert.equal(first.notice.text, '走哪条？');
  assert.equal(first.notice.speakerId, 'hand-1');
  clock.ms = at('2026-11-19T16:00:00.000Z');
  assert.equal((await core.current()).notice.id, first.notice.id);
  box.tickets = [ask({ open_ask: { text: '留下还是重做？', ts: '2026-11-19T17:00:00.000Z' } })];
  clock.ms = at('2026-11-19T17:05:00.000Z');
  const second = await core.current();
  assert.equal(second.notice.text, '留下还是重做？');
  assert.notEqual(second.notice.id, first.notice.id);
  clock.ms = at('2026-11-20T08:30:00.000Z');
  box.tickets = [ask({ open_ask: { text: '走哪条？', ts: '2026-11-19T15:00:00.000Z' } })];
  assert.equal((await core.current()).notice, null);
});

test('已经答过或取消的卡点，次日早晨不再问', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  await core.current();
  box.tickets = [ask()];
  clock.ms = at('2026-11-19T15:05:00.000Z');
  assert.equal((await core.current()).notice.kind, 'ask');
  box.tickets = [ticket({
    state: 'queued', review: 'none', verification: [], report: null, open_ask: null, history: [],
  })];
  clock.ms = at('2026-11-20T08:30:00.000Z');
  assert.equal((await core.current()).notice, null);
});

test('领走、处理中、没有核验通过的完成都不开口', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  await core.current();
  box.tickets = [
    ticket({ id: 'T-20261119-130000-pr01', state: 'progress', review: 'none', verification: [] }),
    ticket({ id: 'T-20261119-130100-pr02', state: 'queued', review: 'none', verification: [] }),
    ticket({ id: 'T-20261119-130200-pr03', verification: [] }),
  ];
  clock.ms = at('2026-11-19T13:10:00.000Z');
  assert.equal((await core.current()).notice, null);
  assert.equal((await saved(dir)).days['2026-11-19'].daytime, 0);
});

test('没有来源会话时只指向工单', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  await core.current();
  box.tickets = [ticket({
    sessions: { from: '', to: '' },
    history: [{ ts: '2026-11-19T13:00:00.000Z', action: 'accepted' }],
  })];
  clock.ms = at('2026-11-19T13:10:00.000Z');
  const body = await core.current();
  assert.deepEqual(body.notice.entry, { type: 'ticket', id: 'T-20261119-010000-abcd' });
});

test('正看着那段会话就不再提，刷新和重启还是同一句', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  await core.current();
  box.tickets = [ticket({
    history: [{ ts: '2026-11-19T13:00:00.000Z', action: 'accepted' }],
  })];
  clock.ms = at('2026-11-19T13:10:00.000Z');
  const shown = await core.current();
  assert.equal(shown.notice.entry.id, 'conv-1');
  clock.ms = at('2026-11-19T13:20:00.000Z');
  assert.equal((await core.current({ viewing: 'conv-1' })).notice, null);
  clock.ms = at('2026-11-19T13:40:00.000Z');
  assert.equal((await core.current()).notice, null);
  const restarted = createOwnerNotices({
    dataDir: dir, now: () => clock.ms,
    hubConfig: { notices: { utcOffsetMinutes: 0 } },
    board: { list: async () => box.tickets }, roster,
  });
  assert.equal((await restarted.current()).notice, null);
  const other = await directory();
  const keep = setup(other);
  await keep.core.current();
  keep.box.tickets = [ticket({
    id: 'T-20261119-140000-kp01',
    history: [{ ts: '2026-11-19T14:00:00.000Z', action: 'accepted' }],
  })];
  keep.clock.ms = at('2026-11-19T14:10:00.000Z');
  const banner = await keep.core.current();
  const again = createOwnerNotices({
    dataDir: other, now: () => keep.clock.ms,
    hubConfig: { notices: { utcOffsetMinutes: 0 } },
    board: { list: async () => keep.box.tickets }, roster,
  });
  assert.equal((await again.current()).notice.id, banner.notice.id);
});

test('双标签同时来只记一份', async () => {
  const dir = await directory();
  const { clock, box, core } = setup(dir);
  await core.current();
  box.tickets = [ticket({
    history: [{ ts: '2026-11-19T13:00:00.000Z', action: 'accepted' }],
  })];
  clock.ms = at('2026-11-19T13:10:00.000Z');
  const rows = await Promise.all(Array.from({ length: 8 }, () => core.current()));
  const ids = new Set(rows.map(row => row.notice.id));
  assert.equal(ids.size, 1);
  assert.equal((await saved(dir)).days['2026-11-19'].daytime, 1);
});

test('一键全停时不记、不说，恢复后按假时钟补上', async () => {
  const dir = await directory();
  let stopped = true;
  const { clock, box, core } = setup(dir, { stopped: () => stopped });
  box.tickets = [ticket({
    history: [{ ts: '2026-11-19T09:00:00.000Z', action: 'accepted' }],
  })];
  clock.ms = at('2026-11-19T10:00:00.000Z');
  const held = await core.current();
  assert.equal(held.stopped, true);
  assert.equal(held.notice, null);
  assert.equal(box.lists, 0);
  stopped = false;
  const back = await core.current();
  assert.equal(back.stopped, false);
  assert.match(back.notice.text, /^早。/);
  stopped = true;
  const before = await readFile(join(dir, 'notices', 'state.json'), 'utf8');
  clock.ms = at('2026-11-19T11:00:00.000Z');
  assert.equal((await core.current()).notice, null);
  assert.equal(await readFile(join(dir, 'notices', 'state.json'), 'utf8'), before);
});

test('坏掉的记录原样留着，不当成没有说过', async () => {
  const dir = await directory();
  const { core } = setup(dir);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'notices'), { recursive: true });
  const file = join(dir, 'notices', 'state.json');
  await writeFile(file, '{', { mode: 0o600 });
  const body = await core.current();
  assert.equal(body.ok, false);
  assert.equal(body.notice, null);
  assert.equal(await readFile(file, 'utf8'), '{');
});

test('去重文件只有主人目录能读，也不去叫模型', async () => {
  const dir = await directory();
  const { box, core } = setup(dir);
  box.tickets = [ticket({
    history: [{ ts: '2026-11-19T08:00:00.000Z', action: 'accepted' }],
  })];
  assert.equal((await core.current()).ok, true);
  assert.equal(box.sends, 0);
  assert.equal((await stat(join(dir, 'notices', 'state.json'))).mode & 0o777, 0o600);
});

test('看板读失败不报成没事', async () => {
  const dir = await directory();
  const core = createOwnerNotices({
    dataDir: dir, now: () => at('2026-11-19T10:00:00.000Z'),
    hubConfig: { notices: { utcOffsetMinutes: 0 } },
    board: { list: async () => { throw new Error('down'); } },
    roster,
  });
  const body = await core.current();
  assert.equal(body.ok, false);
  assert.equal(body.notice, null);
});

function invoke(handler, { method = 'GET', path = '/notices/', headers = {} } = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.url = path;
  req.headers = headers;
  const res = { status: 0, text: '', headersSent: false };
  res.writeHead = (status) => { res.status = status; res.headersSent = true; };
  res.end = (chunk) => { if (chunk) res.text += chunk; };
  return handler(req, res).then(handled => ({
    handled, status: res.status, body: res.text ? JSON.parse(res.text) : undefined,
  }));
}

test('接口只答 GET，没钥匙不计算', async () => {
  const dir = await directory();
  let trusted = false;
  const handler = createHandler({
    dataDir: dir, now: () => at('2026-11-19T10:00:00.000Z'),
    hubConfig: { notices: { utcOffsetMinutes: 0 } },
    isTrusted: () => trusted,
    board: { list: async () => [] }, roster,
  });
  const denied = await invoke(handler);
  assert.equal(denied.status, 401);
  trusted = true;
  const ok = await invoke(handler, { path: '/notices/?viewing=conv-1' });
  assert.equal(ok.handled, true);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.notice, null);
  const posted = await invoke(handler, { method: 'POST' });
  assert.equal(posted.status, 405);
  const other = await invoke(handler, { path: '/notices-extra' });
  assert.equal(other.handled, false);
});
