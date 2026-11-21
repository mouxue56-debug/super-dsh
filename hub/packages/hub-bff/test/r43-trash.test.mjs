import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assistantEvent, fixture, request, userEvent } from './fixtures.mjs';
import {
  TRASH_WINDOW_MS,
  createTrash,
  filterMessages,
  isMessageDeleted,
  isSegmentDeleted,
} from '../lib/trash.mjs';

const DEVICE = '0123456789abcdef';
const SECRET = '要删掉的机密正文';

function row(id, extra = {}) {
  return {
    id,
    bot: 'chief',
    title: extra.title ?? '',
    lastText: extra.lastText ?? '',
    lastRole: extra.lastRole ?? null,
    updatedAt: extra.updatedAt ?? 1000,
    unread: extra.unread ?? 0,
    running: extra.running ?? false,
    ...extra,
  };
}

async function directory() {
  return mkdtemp(join(tmpdir(), 'r43-trash-'));
}

async function call(handler, options = {}) {
  const headers = { 'x-hub-device': DEVICE, ...(options.headers ?? {}) };
  const pending = request(handler, { ...options, headers });
  await pending.done;
  let body;
  try {
    body = pending.res.text ? JSON.parse(pending.res.text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: pending.res.status, body, text: pending.res.text };
}

test('纯函数：整段清空、单条按号或序号去掉，过期仍算删', () => {
  const state = {
    batches: [
      { kind: 'message', session: 's1', messageId: '2', seq: 2 },
      { kind: 'segment', session: 's2' },
      { kind: 'thread', sessions: ['s3', 's4'], restoredAt: 5 },
    ],
  };
  const messages = [{ id: '2', seq: 2, text: SECRET }, { id: '3', text: '留着' }];
  assert.equal(isMessageDeleted(state, 's1', '2'), true);
  assert.equal(isMessageDeleted(state, 's1', { id: 'x', seq: 2 }), true);
  assert.deepEqual(filterMessages(state, 's1', messages).map((item) => item.id), ['3']);
  assert.deepEqual(filterMessages(state, 's2', messages), []);
  assert.equal(isSegmentDeleted(state, 's3'), false);
});

test('幂等、恢复、30 天不再列出但文件还在、坏文件保全后重建', async (t) => {
  const dir = await directory();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'trash.json');
  let now = 1_000;
  const trash = createTrash({ file, now: () => now });
  await trash.ready;
  const buried = '标题'.repeat(40) + SECRET;
  const first = await trash.removeMessage({
    session: 's1', messageId: '2', seq: 2, bot: 'chief', by: DEVICE, label: buried,
  });
  const again = await trash.removeMessage({
    session: 's1', messageId: '2', seq: 2, bot: 'chief', by: DEVICE, label: '不该再记',
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.item.label.includes(SECRET), false);
  assert.equal([...first.body.item.label].length, 80);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.item.id, first.body.item.id);
  assert.equal(trash.isMessageDeleted('s1', 2), true);
  const back = await trash.restore(first.body.item.id);
  assert.equal(back.status, 200);
  assert.equal(trash.isMessageDeleted('s1', '2'), false);
  const twice = await trash.restore(first.body.item.id);
  assert.equal(twice.body.duplicate, true);
  assert.equal(twice.body.item.restoredAt, back.body.item.restoredAt);

  const segment = await trash.removeSegment({
    session: 's9', bot: 'chief', by: DEVICE, label: '一段',
  });
  assert.equal(segment.body.item.daysLeft, 30);
  now = segment.body.item.deletedAt + TRASH_WINDOW_MS;
  assert.deepEqual(trash.list(), []);
  assert.equal(trash.isSegmentDeleted('s9'), true);
  assert.equal((await trash.restore(segment.body.item.id)).status, 404);
  const kept = await readFile(file, 'utf8');
  assert.equal(kept.includes(segment.body.item.id), true);
  assert.equal(kept.includes(SECRET), false);
  assert.equal((await stat(file)).mode & 0o777, 0o600);

  const broken = join(dir, 'broken.json');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(broken, '{"v":1,"batches":[', { mode: 0o600 });
  const rebuilt = createTrash({ file: broken, now: () => 1 });
  await rebuilt.ready;
  const names = readdirSync(dir);
  assert.ok(names.some((name) => name.startsWith('broken.json.corrupt-')));
  assert.deepEqual(JSON.parse(await readFile(broken, 'utf8')).batches, []);
  const backup = names.find((name) => name.startsWith('broken.json.corrupt-'));
  assert.equal(readFileSync(join(dir, backup), 'utf8').includes('batches'), true);
});

test('20 个并发删和恢复不丢批次', async (t) => {
  const dir = await directory();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const trash = createTrash({ file: join(dir, 'trash.json'), now: () => 50 });
  await trash.ready;
  const made = await Promise.all(Array.from({ length: 20 }, (_, index) => trash.removeSegment({
    session: 'p' + index, bot: 'chief', by: DEVICE, label: '并发' + index,
  })));
  assert.equal(new Set(made.map((item) => item.body.item.id)).size, 20);
  assert.equal(trash.deletedSessionIds().length, 20);
  const same = await Promise.all(Array.from({ length: 20 }, () => trash.removeMessage({
    session: 's1', messageId: '9', bot: 'chief', by: DEVICE, label: '同一条',
  })));
  assert.equal(new Set(same.map((item) => item.body.item.id)).size, 1);
  const restored = await Promise.all(made.map((item) => trash.restore(item.body.item.id)));
  assert.equal(restored.every((item) => item.status === 200), true);
  assert.equal(trash.deletedSessionIds().length, 0);
  assert.equal(trash.isMessageDeleted('s1', '9'), true);
});

test('接口：越权、删一条后未读和搜索不见、删段、运行中、清空和晚到的消息', async () => {
  let clock = 10_000;
  const f = await fixture({ handlerOptions: { now: () => clock } });
  const history = {
    s1: [userEvent(1, '主人这句'), assistantEvent(2, SECRET), assistantEvent(3, '还留着的回复')],
  };
  f.source.recordsFor = (id) => history[id] ?? [];
  const store = f.handler.runtime.store;
  await store.update('s1', { lastText: SECRET, lastRole: 'assistant', unread: 2 });
  const ask = (options) => call(f.handler, options);
  try {
    const loggedOut = await ask({
      method: 'POST', path: '/bff/trash/messages', key: null,
      value: { session: 's1', id: '2' }, headers: {},
    });
    assert.equal(loggedOut.status, 401);
    const external = await ask({
      method: 'POST', path: '/bff/trash/segments', key: null,
      value: { session: 's1' },
      headers: { authorization: 'Bearer external-token', 'x-hub-device': DEVICE },
    });
    assert.equal(external.status, 401);
    const assistant = await ask({
      method: 'POST', path: '/bff/trash/threads', key: null,
      value: { bot: 'chief' },
      headers: { authorization: 'Bearer assistant-token' },
    });
    assert.equal(assistant.status, 401);
    const otherDevice = await ask({
      method: 'POST', path: '/bff/trash/messages',
      value: { session: 's1', id: '2' },
      headers: { 'x-hub-device': 'other-device' },
    });
    assert.equal(otherDevice.status, 403);
    assert.equal(otherDevice.body.error.code, 'FORBIDDEN');
    assert.equal(existsSync(f.handler.trash.file), false);
    const pub = { url: '/trash/messages', method: 'POST', headers: { 'x-hub-bff-key': f.key } };
    const sink = { headersSent: false, writeHead() {}, end() {} };
    assert.equal(await f.handler.extensions.handle(pub, sink, 'public'), false);

    const unreadBefore = await ask({ path: '/unread/' });
    assert.equal(unreadBefore.body.conversations.s1, 2);
    const deleted = await ask({
      method: 'POST', path: '/bff/trash/messages', value: { session: 's1', id: '2' },
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.item.label, '首席助理 · 1 条消息');
    assert.equal(deleted.body.item.daysLeft, 30);
    const repeat = await ask({
      method: 'POST', path: '/bff/trash/messages', value: { session: 's1', id: '2' },
    });
    assert.equal(repeat.body.duplicate, true);
    assert.equal(repeat.body.item.id, deleted.body.item.id);
    const unreadAfter = await ask({ path: '/unread/' });
    assert.equal(unreadAfter.body.conversations.s1, 1);
    const listed = await ask({ path: '/bff/sessions' });
    const s1 = listed.body.sessions.find((item) => item.id === 's1');
    assert.equal(s1.lastText, '还留着的回复');
    assert.equal(JSON.stringify(listed.body).includes(SECRET), false);
    const opened = await ask({ path: '/bff/sessions/s1/history' });
    assert.equal(opened.status, 200);
    assert.equal(JSON.stringify(opened.body).includes(SECRET), false);
    assert.equal(opened.body.messages.some((item) => item.id === '3'), true);
    const tomb = await readFile(f.handler.trash.file, 'utf8');
    assert.equal(tomb.includes(SECRET), false);
    assert.equal(store.get('s1').lastText, SECRET);

    await store.add(row('meet-1', { purpose: 'meeting', title: '晨会', updatedAt: 3000 }));
    await store.add(row('relay-1', { purpose: 'board', title: '接力：选题', updatedAt: 4000 }));
    await store.update('s1', { running: true });
    const running = await ask({
      method: 'POST', path: '/bff/trash/segments', value: { session: 's1' },
    });
    assert.equal(running.status, 409);
    assert.equal(running.body.error.code, 'RUNNING');
    assert.equal(running.body.error.message, '它还在做事，先停下？');
    assert.equal(f.source.named('session/cancel').length, 0);
    const forced = await ask({
      method: 'POST', path: '/bff/trash/segments', value: { session: 's1', force: true },
    });
    assert.equal(forced.status, 200);
    assert.equal(f.source.named('session/cancel').length, 1);
    assert.equal(trashGone(await ask({ path: '/bff/sessions/s1/history' })), true);
    const blocked = await ask({
      method: 'POST', path: '/bff/sessions/s1/messages', value: { text: '还想说' },
    });
    assert.equal(blocked.status, 404);
    assert.equal((await ask({ path: '/bff/sessions/s1/stream' })).status, 404);
    history.s1.push(assistantEvent(6, '晚到的回复'));
    await store.update('s1', (item) => ({ unread: item.unread + 1, lastText: '晚到的回复' }));
    const unreadLate = await ask({ path: '/unread/' });
    assert.equal(unreadLate.body.conversations.s1, undefined);
    const listedLate = await ask({ path: '/bff/sessions?bot=chief' });
    assert.equal(listedLate.body.sessions.some((item) => item.id === 's1'), false);
    assert.equal(f.handler.deps.sessions.list({ all: true }).some((item) => item.id === 's1'), true);
    assert.equal(f.handler.deps.sessions.list().some((item) => item.id === 's1'), false);
    assert.equal(f.handler.trash.isSegmentDeleted('s1'), true);
    assert.equal(f.handler.runtime.status().bots.chief.runningSessionId === 's1', false);

    clock += 1000;
    const thread = await ask({
      method: 'POST', path: '/bff/trash/threads', value: { bot: 'chief' },
    });
    assert.equal(thread.status, 200);
    assert.equal(thread.body.item.label, '和首席助理的全部对话');
    assert.deepEqual(thread.body.item.sessions, ['relay-1', 's1']);
    const relay = thread.body.item.sessions.includes('relay-1');
    assert.equal(relay, true);
    assert.equal(f.handler.trash.isSegmentDeleted('meet-1'), false);
    const repeatThread = await ask({
      method: 'POST', path: '/bff/trash/threads', value: { bot: 'chief' },
    });
    assert.equal(repeatThread.body.duplicate, true);
    assert.equal(repeatThread.body.item.id, thread.body.item.id);
    await store.add(row('fresh-1', { title: '新的一段', updatedAt: 9000 }));
    assert.equal(f.handler.trash.isSegmentDeleted('fresh-1'), false);
    assert.equal(f.handler.deps.sessions.list().some((item) => item.id === 'fresh-1'), true);
    const relayLabel = await ask({
      method: 'POST', path: '/bff/trash/segments', value: { session: 'relay-1' },
    });
    assert.equal(relayLabel.body.duplicate, true);

    const restored = await ask({
      method: 'POST', path: '/bff/trash/' + forced.body.item.id + '/restore', value: {},
    });
    assert.equal(restored.status, 200);
    assert.equal(f.handler.trash.isSegmentDeleted('s1'), true);
    const threadBack = await ask({
      method: 'POST', path: '/bff/trash/' + thread.body.item.id + '/restore', value: {},
    });
    assert.equal(threadBack.status, 200);
    assert.equal(f.handler.trash.isSegmentDeleted('s1'), false);
    assert.equal((await ask({ path: '/bff/sessions' })).body.sessions.some((item) => item.id === 's1'), true);
    clock += TRASH_WINDOW_MS;
    const hidden = await ask({ path: '/bff/trash' });
    assert.equal(hidden.body.items.some((item) => item.id === thread.body.item.id), false);
    const tooLate = await ask({
      method: 'POST', path: '/bff/trash/' + deleted.body.item.id + '/restore', value: {},
    });
    assert.equal(tooLate.status, 404);
    assert.equal((await readFile(f.handler.trash.file, 'utf8')).includes(deleted.body.item.id), true);
  } finally {
    await f.dispose();
  }
});

function trashGone(result) {
  return result.status === 404 && result.body.error.code === 'NOT_FOUND'
    && !JSON.stringify(result.body).includes(SECRET);
}
