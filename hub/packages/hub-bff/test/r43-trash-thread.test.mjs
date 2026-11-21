import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createThreads } from '../lib/threads.mjs';
import { createTopics } from '../lib/topics.mjs';
import { createTrash } from '../lib/trash.mjs';
import { assistantEvent, fixture, request, userEvent } from './fixtures.mjs';

const DEVICE = '0123456789abcdef';
const row = (id, extra = {}) => ({ id, bot: 'chief', title: id, lastText: '旧摘要', lastRole: 'assistant',
  updatedAt: 10000, unread: 0, running: false, ...extra });
const message = (seq, text = '消息' + seq, role = seq % 2 ? 'user' : 'assistant', ts = seq * 1000) => ({
  id: String(seq), seq, ts, text, role,
});

async function world(histories, rows = Object.keys(histories).map(id => row(id))) {
  const dir = await mkdtemp(join(tmpdir(), 'r43-trash-thread-'));
  let clock = 1_000_000;
  const trash = createTrash({ file: join(dir, 'trash.json'), now: () => clock });
  await trash.ready;
  const calls = [];
  const models = { fn: async () => '1' };
  const deps = {
    dataDir: dir, now: () => clock, roster: [{ id: 'chief', status: 'active' }, { id: 'art', status: 'active' }],
    readPositions: async () => ({ conversations: {} }), trash, topicDispatchMs: 5, topicTimeoutMs: 20,
    topicModel: input => models.fn(input),
    isTrusted: () => true, isOwnerDevice: () => true,
    sessions: {
      list: async () => rows,
      history: async id => ({ messages: histories[id] ?? [] }),
      historyPage: async (id, { beforeSeq = Infinity, limit = 40 }) => {
        calls.push({ id, beforeSeq, limit });
        const source = histories[id] ?? [];
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
      create: async (bot, { title }) => {
        const made = row('fresh', { bot, title, updatedAt: clock, lastText: '', lastRole: null });
        rows.push(made); histories.fresh = []; return made;
      },
      send: async (id, text) => {
        const seq = (histories[id]?.at(-1)?.seq ?? 0) + 1;
        histories[id].push(message(seq, text, 'user', clock));
        const found = rows.find(item => item.id === id);
        if (found) Object.assign(found, { lastText: text, lastRole: 'user', updatedAt: clock });
        return { accepted: true, reply: Promise.resolve({ failed: false, text: '' }) };
      },
    },
  };
  const threads = createThreads(deps);
  const topics = createTopics(deps, threads);
  return { deps, trash, threads, topics, histories, rows, calls, models, dir,
    tick(ms) { clock += ms; },
    async bye() { await topics.stop(); } };
}

function texts(page) {
  return page.items.filter(item => item.kind === 'message').map(item => item.text);
}

async function walk(core, limit = 7) {
  const seen = [];
  let before;
  do {
    const page = await core.page('chief', { limit, before });
    assert.ok(page.items.filter(item => item.kind === 'message').length <= limit);
    seen.unshift(...page.items.filter(item => item.kind === 'message'));
    before = page.nextBefore;
  } while (before);
  return seen;
}

test('删一条后总线、游标、搜索、未读和首页摘要都跳过它，恢复后回到原处', async () => {
  const histories = { a: Array.from({ length: 24 }, (_, n) => message(n + 1,
    n === 9 ? '只有这句机密' : '留着' + (n + 1))) };
  const f = await world(histories, [row('a', { lastText: '只有这句机密', updatedAt: 24000 })]);
  try {
    const gone = await f.trash.removeMessage({
      session: 'a', messageId: '10', seq: 10, bot: 'chief', by: DEVICE, label: '首席助理 · 1 条消息',
    });
    assert.equal(gone.ok, true);
    const seen = await walk(f.threads);
    assert.equal(seen.length, 23);
    assert.equal(seen.some(item => item.text === '只有这句机密' || item.seq === 10), false);
    assert.equal(new Set(seen.map(item => item.id)).size, 23);
    const seqs = seen.map(item => item.seq);
    assert.deepEqual(seqs.slice(0, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(seqs[9], 11);
    assert.equal(seqs.at(-1), 24);
    const hits = await f.threads.search('chief', { q: '只有这句机密' });
    assert.equal(hits.items.length, 0);
    const home = (await f.threads.list()).threads.find(item => item.bot === 'chief');
    assert.equal(home.segments, 1);
    assert.equal(home.lastText, '留着24');
    assert.equal(home.unread, 11);
    await f.trash.restore(gone.body.item.id);
    const back = await walk(f.threads);
    assert.equal(back.length, 24);
    assert.equal(back.some(item => item.seq === 10 && item.text === '只有这句机密'), true);
    assert.equal((await f.threads.search('chief', { q: '只有这句机密' })).items.length, 1);
    assert.equal((await f.threads.list()).threads[0].unread, 12);
  } finally { await f.bye(); }
});

test('删整段、清空整条线之后，当前话题、候选和搜索都不认它；新消息另起一段', async () => {
  const histories = { old: [message(1, '旧话题', 'user', 5000), message(2, '旧回复', 'assistant', 6000)],
    keep: [message(1, '留下的', 'user', 1000)] };
  const rows = [row('old', { title: '旧话题', updatedAt: 6000, lastText: '旧回复' }),
    row('keep', { title: '留下的', updatedAt: 1000, lastText: '留下的', lastRole: 'user' })];
  const f = await world(histories, rows);
  try {
    assert.equal((await f.threads.current('chief')).current.id, 'old');
    await f.trash.removeSegment({ session: 'old', bot: 'chief', by: DEVICE, label: '旧话题' });
    assert.equal((await f.threads.current('chief')).current.id, 'keep');
    await assert.rejects(f.threads.page('chief', {}, 'old'), error => error.status === 404);
    assert.equal((await f.threads.search('chief', { q: '旧话题' })).items.length, 0);
    const topics = await f.topics.list('chief');
    assert.equal(topics.topics.some(item => item.id === 'old'), false);
    assert.equal((await f.threads.list()).threads[0].segments, 1);
    assert.equal((await f.threads.list()).threads[0].lastText, '留下的');
    const prompt = [];
    f.models.fn = async input => { prompt.push(input.prompt); return '2'; };
    const sent = await f.topics.send('chief', { text: '这句不该进已删话题', idem: 'next' });
    assert.equal(sent.session, 'keep');
    assert.equal(prompt.some(text => text.includes('旧话题')), false);
    await f.trash.removeThread({ bot: 'chief', sessions: ['keep'], by: DEVICE, label: '和首席助理的全部对话' });
    assert.equal((await f.threads.page('chief')).items.length, 0);
    assert.equal((await f.threads.current('chief')).current, null);
    const again = await f.topics.send('chief', { text: '清空以后重新开始', idem: 'fresh' });
    assert.equal(again.classification.kind, 'new');
    assert.equal(again.session, 'fresh');
    assert.equal(f.trash.isSegmentDeleted('fresh'), false);
    for (let i = 0; i < 40 && !f.histories.fresh?.some(item => item.text === '清空以后重新开始'); i += 1) {
      await wait(5);
    }
    const page = await f.threads.page('chief');
    assert.deepEqual(texts(page), ['清空以后重新开始']);
  } finally { await f.bye(); }
});

test('合并后删成员或删目标，改归的消息一并消失，撤销合并不会揭掉墓碑', async () => {
  const histories = {
    a: [message(1, '甲的问题', 'user', 1000), message(2, '甲的回复', 'assistant', 2000)],
    b: [message(1, '乙的问题', 'user', 3000), message(2, '乙的回复', 'assistant', 4000)],
  };
  const rows = [row('a', { title: '话题甲', updatedAt: 2000 }), row('b', { title: '话题乙', updatedAt: 4000 })];
  const f = await world(histories, rows);
  try {
    const user = (await f.topics.page('chief', { topic: 'a' })).items.find(item => item.text === '甲的问题');
    await f.topics.reassign('chief', { messageId: user.id, topic: 'b', mode: 'turn' });
    assert.equal((await f.topics.page('chief', { topic: 'b' })).items.some(item => item.text === '甲的问题'), true);
    await f.topics.merge('chief', 'b', { target: 'a' });
    await f.trash.removeMessage({
      session: 'a', messageId: '1', seq: 1, bot: 'chief', by: DEVICE, label: '一条',
    });
    assert.equal((await f.topics.page('chief')).items.some(item => item.text === '甲的问题'), false);
    assert.equal((await f.topics.page('chief', { topic: 'b' })).items.some(item => item.text === '甲的问题'), false);
    await f.trash.removeSegment({ session: 'b', bot: 'chief', by: DEVICE, label: '话题乙' });
    const merged = await f.topics.page('chief', { topic: 'a' });
    assert.equal(merged.items.some(item => item.session === 'b' || item.text === '乙的问题'), false);
    await f.topics.unmerge('chief', 'b');
    assert.equal((await f.threads.page('chief')).items.some(item => item.session === 'b'), false);
    assert.equal((await f.topics.list('chief')).topics.some(item => item.id === 'b'), false);
    const covered = f.trash.deletionOfSession('b');
    await f.trash.restore(covered.body.item.id);
    assert.equal((await f.topics.list('chief')).topics.some(item => item.id === 'b'), true);
    assert.equal((await f.threads.search('chief', { q: '乙的问题' })).items.length, 1);
  } finally { await f.bye(); }
});

test('同时删同一条只留一批，恢复后搜索才再次命中', async () => {
  const f = await world({ a: [message(1, '并发这句', 'user', 1000), message(2, '回复', 'assistant', 2000)] });
  try {
    const [first, second] = await Promise.all([
      f.trash.removeMessage({ session: 'a', messageId: '1', seq: 1, bot: 'chief', by: DEVICE, label: '一条' }),
      f.trash.removeMessage({ session: 'a', messageId: '1', seq: 1, bot: 'chief', by: DEVICE, label: '一条' }),
    ]);
    assert.equal(first.body.item.id, second.body.item.id);
    const during = await f.threads.search('chief', { q: '并发这句' });
    assert.equal(during.items.length, 0);
    await f.trash.restore(first.body.item.id);
    assert.equal((await f.threads.search('chief', { q: '并发这句' })).items.length, 1);
  } finally { await f.bye(); }
});

const owner = { 'x-hub-device': DEVICE };

async function ask(handler, options) {
  const headers = { ...owner, ...(options.headers ?? {}) };
  const pending = request(handler, { ...options, headers });
  await pending.done;
  let body;
  try { body = pending.res.text ? JSON.parse(pending.res.text) : undefined; }
  catch { body = undefined; }
  return { status: pending.res.status, body };
}

test('接口：越权、翻页、运行中先停下、force 取消后再记墓碑、清空后新段可见', async () => {
  const f = await fixture({ handlerOptions: { topicModel: async () => '1', topicDispatchMs: 20 } });
  const history = {
    s1: [userEvent(1, '早上这句'), assistantEvent(2, '要删的这句'), assistantEvent(3, '还留着的这句')],
  };
  for (let seq = 4; seq <= 18; seq += 1) history.s1.push(userEvent(seq, '第' + seq + '句'));
  f.source.recordsFor = id => history[id] ?? [];
  const store = f.handler.runtime.store;
  await store.update('s1', { lastText: '要删的这句', lastRole: 'assistant', unread: 2, title: '早上' });
  try {
    assert.equal((await ask(f.handler, { path: '/threads/chief', key: null, headers: {} })).status, 401);
    assert.equal((await ask(f.handler, {
      method: 'POST', path: '/bff/trash/messages', key: null, headers: {}, value: { session: 's1', id: '2' },
    })).status, 401);
    assert.equal((await ask(f.handler, {
      method: 'POST', path: '/bff/trash/segments', value: { session: 's1' },
      headers: { 'x-hub-device': 'worker' },
    })).status, 403);
    const before = await ask(f.handler, { path: '/threads/chief?limit=5' });
    assert.equal(before.status, 200);
    assert.equal(before.body.items.some(item => item.text === '要删的这句'), false);
    let cursor = before.body.nextBefore, pages = before.body.items.slice();
    while (cursor) {
      const older = await ask(f.handler, { path: '/threads/chief?limit=5&before=' + encodeURIComponent(cursor) });
      assert.equal(older.status, 200);
      pages = older.body.items.concat(pages);
      cursor = older.body.nextBefore;
    }
    assert.equal(pages.filter(item => item.kind === 'message' && item.text === '要删的这句').length, 1);
    const deleted = await ask(f.handler, {
      method: 'POST', path: '/bff/trash/messages', value: { session: 's1', id: '2' },
    });
    assert.equal(deleted.status, 200);
    const home = await ask(f.handler, { path: '/threads' });
    assert.equal(home.body.threads.find(item => item.bot === 'chief').lastText.includes('要删的这句'), false);
    const found = await ask(f.handler, { path: '/threads/chief/search?q=' + encodeURIComponent('要删的这句') });
    assert.equal(found.body.items.length, 0);
    const kept = await ask(f.handler, { path: '/threads/chief/search?q=' + encodeURIComponent('还留着的这句') });
    assert.equal(kept.body.items.length, 1);
    await store.update('s1', { running: true });
    const blocked = await ask(f.handler, { method: 'POST', path: '/bff/trash/segments', value: { session: 's1' } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'RUNNING');
    assert.equal(blocked.body.error.message, '它还在做事，先停下？');
    assert.equal(f.source.named('session/cancel').length, 0);
    assert.equal((await ask(f.handler, { path: '/threads/chief/segment/s1' })).status, 200);
    const badForce = await ask(f.handler, {
      method: 'POST', path: '/bff/trash/segments', value: { session: 's1', force: 'yes' },
    });
    assert.equal(badForce.status, 400);
    f.source.rpcOverride = envelope => {
      if (envelope.method === 'session/cancel') throw new Error('stop failed');
    };
    const failed = await ask(f.handler, {
      method: 'POST', path: '/bff/trash/segments', value: { session: 's1', force: true },
    });
    assert.equal(failed.status, 502);
    assert.equal(f.handler.trash.isSegmentDeleted('s1'), false);
    assert.equal((await ask(f.handler, { path: '/threads/chief/segment/s1' })).status, 200);
    const cancels = () => f.source.named('session/cancel').length;
    const afterFail = cancels();
    f.source.rpcOverride = null;
    const forced = await ask(f.handler, {
      method: 'POST', path: '/bff/trash/segments', value: { session: 's1', force: true },
    });
    assert.equal(forced.status, 200);
    assert.equal(cancels(), afterFail + 1);
    assert.equal((await ask(f.handler, { path: '/threads/chief/segment/s1' })).status, 404);
    assert.equal((await ask(f.handler, { path: '/threads/chief/current' })).body.current, null);
    const hidden = await ask(f.handler, {
      path: '/threads/chief/search?q=' + encodeURIComponent('还留着的这句'),
    });
    assert.equal(hidden.body.items.length, 0);
    const topics = await ask(f.handler, { path: '/threads/chief/topics' });
    assert.equal(topics.body.topics.some(item => item.id === 's1'), false);
    await f.handler.trash.restore(forced.body.item.id);
    await store.update('s1', { running: false });
    assert.equal((await ask(f.handler, { path: '/threads/chief/segment/s1' })).status, 200);
    await store.add({ id: 's2', bot: 'chief', title: '话题乙', lastText: '乙的一句', lastRole: 'user',
      updatedAt: 8000, unread: 0, running: true });
    history.s2 = [userEvent(1, '乙的一句')];
    await ask(f.handler, { method: 'POST', path: '/threads/chief/topics/s2/merge', value: { target: 's1' } });
    const deny = await ask(f.handler, { method: 'POST', path: '/bff/trash/segments', value: { session: 's1' } });
    assert.equal(deny.status, 409);
    assert.equal(f.handler.trash.isSegmentDeleted('s1'), false);
    assert.equal(f.handler.trash.isSegmentDeleted('s2'), false);
    const beforeBoth = cancels();
    const both = await ask(f.handler, {
      method: 'POST', path: '/bff/trash/segments', value: { session: 's1', force: true },
    });
    assert.equal(both.status, 200);
    assert.equal(both.body.related.length, 1);
    assert.equal(f.handler.trash.isSegmentDeleted('s2'), true);
    assert.equal(cancels(), beforeBoth + 1);
    const line = await ask(f.handler, {
      method: 'POST', path: '/bff/trash/threads', value: { bot: 'chief', force: true },
    });
    assert.equal(line.status, 200);
    await store.add({ id: 's3', bot: 'chief', title: '新段', lastText: '清空后的新句子', lastRole: 'user',
      updatedAt: 9000, unread: 0, running: false });
    history.s3 = [userEvent(1, '清空后的新句子')];
    const fresh = await ask(f.handler, { path: '/threads/chief' });
    const freshText = fresh.body.items.filter(item => item.kind === 'message').map(item => item.text);
    assert.deepEqual(freshText, ['清空后的新句子']);
    const summary = (await ask(f.handler, { path: '/threads' })).body.threads.find(item => item.bot === 'chief');
    assert.equal(summary.segments, 1);
  } finally { await f.dispose(); }
});
