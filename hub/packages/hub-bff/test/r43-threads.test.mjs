import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createThreads } from '../lib/threads.mjs';
import { createUnread } from '../lib/unread.mjs';
import { fixture, request, assistantEvent, userEvent, testDirectory } from './fixtures.mjs';

const row = (id, extra = {}) => ({ id, bot: 'chief', title: id, lastText: '', lastRole: null,
  updatedAt: 10000, unread: 0, running: false, ...extra });
const message = (seq, ts = seq, text = '消息' + seq) => ({ id: String(seq), seq, ts, text,
  role: seq % 2 ? 'user' : 'assistant', ...(seq % 2 ? {} : { tools: [] }) });
const order = (a, b) => Number(a.ts) - Number(b.ts) || a.session.localeCompare(b.session) || a.seq - b.seq;

function setup(histories, rows = Object.keys(histories).map(id => row(id)), extras = {}) {
  const calls = [];
  const deps = { roster: [{ id: 'chief', status: 'active' }, { id: 'art', status: 'active' }],
    readPositions: async () => ({ conversations: {} }), sessions: {
      list: async () => rows,
      history: async id => ({ messages: histories[id] }),
      historyPage: async (id, { beforeSeq = Infinity, limit = 40 }) => {
        calls.push({ id, beforeSeq, limit });
        const source = histories[id];
        let lo = 0, hi = source.length;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          if (source[mid].seq < beforeSeq) lo = mid + 1;
          else hi = mid;
        }
        const start = Math.max(0, lo - limit), messages = source.slice(start, lo);
        return { messages, hasMore: start > 0, nextBeforeSeq: start > 0 ? messages[0].seq : null,
          maxSeq: messages.at(-1)?.seq ?? 0 };
      },
    }, ...extras };
  return { core: createThreads(deps), deps, calls, rows };
}

test('交叠多段与同毫秒逐页向前读完，265 条无丢失、无重复、顺序稳定', async () => {
  const histories = { a: [], b: [], c: [] };
  for (let n = 1; n <= 265; n++) histories[['a', 'b', 'c'][n % 3]].push(message(n, Math.floor(n / 4)));
  const { core } = setup(histories);
  const seen = [], pages = [];
  let before;
  do {
    const result = await core.page('chief', { limit: 17, before });
    assert.ok(result.items.length <= 17);
    pages.unshift(result.items);
    before = result.nextBefore;
  } while (before);
  for (const item of pages.flat()) if (item.kind === 'message') seen.push(item);
  const expected = Object.entries(histories).flatMap(([session, list]) => list.map(item => ({ ...item, session })));
  expected.sort(order);
  assert.deepEqual(seen.map(item => [item.session, item.seq]), expected.map(item => [item.session, item.seq]));
  assert.equal(new Set(seen.map(item => item.id)).size, 265);
  assert.equal(pages.flat().filter(item => item.kind === 'segment').length, 3);
});

test('派工整段折叠，按需读正文与工具，搜索 around 能定位卡内正文', async () => {
  const tool = { id: 'call1', name: 'bash', status: 'pending', approvalId: 'approval1', command: 'pwd' };
  const { core } = setup({ chat: [message(1, 1), message(3, 3)],
    board: [{ ...message(2, 2, '中文目标'), tools: [tool] }, message(4, 4)] },
  [row('chat'), row('board', { purpose: 'board', title: '验收：T-20261119-1234', running: true, unread: 2 })]);
  const page = await core.page('chief');
  assert.equal(page.items.filter(item => item.session === 'board').length, 1);
  const card = page.items.find(item => item.session === 'board');
  assert.equal(card.kind, 'segment'); assert.equal(card.state, 'running'); assert.equal(card.unread, 2);
  assert.equal(card.ticketId, 'T-20261119-1234');
  const hits = await core.search('chief', { q: '中文目标' });
  assert.equal(hits.items.length, 1);
  const around = await core.page('chief', { around: hits.items[0].id });
  assert.deepEqual(around.around, { id: hits.items[0].id, session: 'board', segment: true });
  const child = await core.page('chief', { around: hits.items[0].id }, 'board');
  assert.deepEqual(child.items.find(item => item.id === hits.items[0].id).tools, [tool]);
});

test('hidden、群、会议、固定任务均排除，空普通段只作当前段，派工不抢当前段', async () => {
  const rows = [row('chat', { updatedAt: 10 }), row('empty', { updatedAt: 20 }),
    row('board', { purpose: 'board', updatedAt: 30 }), row('hidden', { hidden: true }),
    row('meeting', { purpose: 'meeting' }), row('routine', { purpose: 'routine' }),
    row('group', { purpose: 'group-work' }), row('groupid', { groupId: 'g1' })];
  const histories = Object.fromEntries(rows.map(item => [item.id, item.id === 'empty' ? [] : [message(2)]]));
  const { core } = setup(histories, rows);
  assert.equal((await core.current('chief')).current.id, 'empty');
  assert.equal((await core.current('art')).current, null);
  const result = await core.page('chief');
  assert.deepEqual([...new Set(result.items.map(item => item.session))].sort(), ['board', 'chat']);
  assert.deepEqual((await core.search('chief', { q: '消息' })).items.map(item => item.session).sort(), ['board', 'chat']);
});

test('未读合计沿用 unread 口径，首次未读定位跨段，原已读文件只读', async () => {
  const dataDir = await testDirectory();
  const cursors = { v: 1, conversations: { a: { id: '2', seq: 2 } }, groups: {} };
  await writeFile(join(dataDir, 'unread-cursors.json'), JSON.stringify(cursors));
  const histories = { a: [message(1), message(2), message(3), message(4)],
    b: [message(2, 2.5), { ...message(4), id: 'tool:c', text: '' }, { ...message(6), system: true }] };
  const setupValue = setup(histories, [row('a'), row('b', { purpose: 'board' })]);
  const deps = { ...setupValue.deps, dataDir };
  delete deps.readPositions;
  const core = createThreads(deps);
  const legacy = (await createUnread(deps).counts()).body;
  const summary = (await core.list()).threads.find(item => item.bot === 'chief');
  assert.equal(summary.unread, legacy.bots.chief);
  assert.equal(summary.unread, 2);
  const page = await core.page('chief', { unread: '1', limit: 3 });
  assert.equal(page.firstUnread.session, 'b');
  assert.equal(page.firstUnread.seq, 2);
  assert.equal(page.around.segment, true);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'unread-cursors.json'), 'utf8')), cursors);
});

test('around 普通消息可向前后翻页，同毫秒 id 不撞号', async () => {
  const { core } = setup({ a: Array.from({ length: 250 }, (_, n) => message(n + 1, Math.floor(n / 3))) });
  const hit = (await core.search('chief', { q: '消息125', limit: 1 })).items[0];
  let page = await core.page('chief', { around: hit.id, limit: 9 });
  assert.ok(page.items.some(item => item.id === hit.id));
  assert.equal(page.around.segment, false);
  const firstPage = page.items;
  const tail = [];
  while (page.nextAfter) {
    page = await core.page('chief', { after: page.nextAfter, limit: 9 });
    tail.push(...page.items);
  }
  assert.deepEqual(tail.map(item => item.seq), Array.from({ length: 250 - firstPage.at(-1).seq },
    (_, n) => firstPage.at(-1).seq + n + 1));
});

test('旧段迟到回复不抢新话题，段入口可定位，缺少时间的旧消息 id 保持稳定', async () => {
  const missingTime = { id: '1', seq: 1, role: 'user', text: '旧数据无时间' };
  const { core, rows } = setup({ old: [message(1, 10), message(2, 100)],
    fresh: [message(1, 20)], legacy: [missingTime] },
  [row('old', { updatedAt: 100 }), row('fresh', { updatedAt: 20 }), row('legacy', { updatedAt: 1 })]);
  assert.equal((await core.current('chief')).current.id, 'fresh');
  const first = await core.page('chief', { segment: 'fresh' });
  assert.equal(first.around.session, 'fresh');
  const before = (await core.page('chief', {}, 'legacy')).items[0].id;
  rows.find(item => item.id === 'legacy').updatedAt = 1000;
  assert.equal((await core.page('chief', {}, 'legacy')).items[0].id, before);
});

test('搜索限制条数与时间，坏参数在读取历史前拒绝', async () => {
  const { core, calls } = setup({ a: Array.from({ length: 250 }, (_, n) => message(n + 1)) });
  for (const input of [{ limit: 101 }, { before: 'bogus' }, { after: '!!' }, { unread: 'no' }]) {
    await assert.rejects(core.page('chief', input), error => error.code === 'INVALID_INPUT');
  }
  await assert.rejects(core.page('../chief'), error => error.status === 400);
  await assert.rejects(core.search('chief', { q: '中'.repeat(201) }), error => error.status === 400);
  assert.equal(calls.length, 0);
  const hits = await core.search('chief', { q: '消息', limit: 3 });
  assert.equal(hits.items.length, 3); assert.equal(hits.truncated, true);
  const slow = setup({ a: [] }, undefined, { threadSearchMs: 10 });
  slow.deps.sessions.historyPage = () => new Promise(() => {});
  assert.equal((await slow.core.search('chief', { q: '消息' })).truncated, true);
});

test('真扩展链只准主人设备；未知助理、越段读取、断开的内核都是规范错误', async () => {
  const f = await fixture();
  const owner = { 'x-hub-device': '0123456789abcdef' };
  try {
    f.source.records = [userEvent(1), assistantEvent(2)];
    const call = async (path, headers = owner, key = f.key) => {
      const r = request(f.handler, { path, headers, key });
      return { body: await r.json(), status: r.res.status };
    };
    assert.equal((await call('/threads', {}, null)).status, 401);
    assert.equal((await call('/threads', {})).status, 403);
    assert.equal((await call('/threads/chief', { 'x-hub-device': 'worker' })).status, 403);
    assert.equal((await call('/threads/no-bot')).status, 400);
    assert.equal((await call('/threads/chief?limit=101')).status, 400);
    assert.equal((await call('/threads?before=invalid')).status, 400);
    assert.equal((await call('/threads/chief/current?around=invalid')).status, 400);
    assert.equal((await call('/threads/art/segment/s1')).status, 404);
    const ok = await call('/threads/chief');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.items.filter(item => item.kind === 'message').length, 2);
    f.source.rpcOverride = envelope => {
      if (envelope.method === 'session/events') throw new Error('connection lost');
    };
    const broken = await call('/threads/art');
    assert.equal(broken.status, 200);
  } finally { await f.dispose(); }
  const broken = await fixture();
  try {
    broken.source.rpcOverride = envelope => {
      if (envelope.method === 'session/events') throw new Error('connection lost');
    };
    const fresh = request(broken.handler, { path: '/threads/chief', headers: owner });
    const body = await fresh.json();
    assert.ok([502, 503].includes(fresh.res.status));
    assert.ok(body.error.code);
  } finally { await broken.dispose(); }
});

test('坏已读文件返回不可用，GET 不重命名或覆盖数据', async () => {
  const dataDir = await testDirectory(), file = join(dataDir, 'unread-cursors.json');
  await writeFile(file, 'broken input');
  const { deps } = setup({ a: [message(2)] });
  delete deps.readPositions;
  const core = createThreads({ ...deps, dataDir });
  await assert.rejects(core.list(), error => error.code === 'UNAVAILABLE');
  assert.equal(await readFile(file, 'utf8'), 'broken input');
});

test('内核分页落在工具结果上时补齐调用与审批，沿用 Timeline 消息形状', async () => {
  const f = await fixture();
  try {
    const event = (seq, type, data) => ({ event: { seq, type, time: seq * 1000, data } });
    const records = [userEvent(1), assistantEvent(2, '我来检查'),
      event(3, 'tool/call', { callId: 'call1', name: 'bash', arguments: { command: 'pwd' } }),
      event(4, 'approval/asked', { callId: 'call1', id: 'approval1' }),
      event(5, 'approval/decided', { id: 'approval1', outcome: 'allowed-once' }),
      event(6, 'tool/result', { message: { toolCallId: 'call1', isError: false,
        content: [{ type: 'text', text: '完成' }] } })];
    f.source.rpcOverride = envelope => {
      if (envelope.method !== 'session/events') return;
      const request = envelope.payload.args.request;
      const eligible = records.filter(record => record.event.seq < (request.beforeSeq ?? Infinity));
      return f.source.response(envelope, { ok: true, value: { records: eligible.slice(-request.maxMessages),
        cursor: 6, hasMore: eligible.length > request.maxMessages } });
    };
    const result = await f.client.historyPage('s1', { limit: 2 });
    const reply = result.messages.find(item => item.role === 'assistant');
    const tool = reply.tools[0];
    assert.equal(tool.status, 'ok'); assert.equal(tool.approvalId, 'approval1');
    assert.equal(tool.command, 'pwd'); assert.equal(tool.output, '完成');
    assert.equal(reply.id, '2');
    assert.ok(f.source.named('session/events').length >= 3);
  } finally { await f.dispose(); }
});

test('内核替换消息覆盖多个原始页，翻向旧页时被替换内容不再出现', async () => {
  const f = await fixture();
  try {
    const replacement = userEvent(9, '最新替换');
    replacement.event.surfaceOp = { op: 'replace', startSeq: 3, endSeq: 5 };
    const records = [...Array.from({ length: 8 }, (_, i) => userEvent(i + 1)), replacement];
    f.source.rpcOverride = envelope => {
      if (envelope.method !== 'session/events') return;
      const { beforeSeq = Infinity, maxMessages } = envelope.payload.args.request;
      const eligible = records.filter(record => record.event.seq < beforeSeq);
      return f.source.response(envelope, { ok: true, value: {
        records: eligible.slice(-maxMessages), cursor: 9, hasMore: eligible.length > maxMessages,
      } });
    };
    const latest = await f.client.historyPage('s1', { limit: 2 });
    const earlier = await f.client.historyPage('s1', { beforeSeq: latest.nextBeforeSeq, limit: 2 });
    const ids = [...earlier.messages, ...latest.messages].map(row => row.seq).sort((a, b) => a - b);
    assert.deepEqual(ids, [1, 2, 6, 7, 8, 9]);
  } finally { await f.dispose(); }
});

test('性能 5000 条乘 30 段，首页及向前五页按需读取', async () => {
  const histories = Object.fromEntries(Array.from({ length: 30 }, (_, segment) => ['part-' + segment,
    Array.from({ length: 5000 }, (_, n) => message(n + 1, n * 30 + segment))]));
  const { core, calls } = setup(histories);
  const timings = [], ids = new Set();
  let before;
  for (let n = 0; n < 6; n++) {
    const start = performance.now();
    const page = await core.page('chief', { limit: 40, before });
    timings.push(Number((performance.now() - start).toFixed(2)));
    assert.equal(page.items.length, 40);
    for (const item of page.items) { assert.equal(ids.has(item.id), false); ids.add(item.id); }
    before = page.nextBefore;
  }
  console.log('R43 后端 150000 条，首页与向前五页耗时 ms', JSON.stringify(timings));
  console.log('R43 后端分页调用', calls.length, '最大单页条数', Math.max(...calls.map(call => call.limit)));
  assert.ok(calls.every(call => call.limit <= 100));
  assert.ok(calls.length < 2000, '首页和五页不能遍历 150000 条');
});
