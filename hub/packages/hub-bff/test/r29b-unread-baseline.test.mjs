import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendMessage, createGroup, saveGroup } from '../lib/group.mjs';
import { createUnread } from '../lib/unread.mjs';
import { main } from '../bin/unread-baseline.mjs';

const reply = (id, text) => ({ role: 'assistant', id, text, seq: Number(id) });
const user = (id, text) => ({ role: 'user', id, text, seq: Number(id) });

function capture() {
  let text = '';
  return { stdout: { write(chunk) { text += String(chunk); } }, text: () => text };
}

async function directory() {
  return mkdtemp(join(tmpdir(), 'unread-base-'));
}

function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
}

async function layout() {
  const root = await directory();
  const data = join(root, 'data');
  const history = join(root, 'history');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(data);
  mkdirSync(history);
  const members = [{ id: 'm-a', kind: 'assistant', role: 'host' }];
  saveGroup(data, createGroup({
    id: 'g-old', name: '旧组', goal: '说完', members, host: 'm-a',
  }));
  saveGroup(data, createGroup({
    id: 'g-new', name: '新组', goal: '说完', members, host: 'm-a',
  }));
  appendMessage(data, 'g-old', { from: 'm-a', text: '第一句' });
  appendMessage(data, 'g-old', { from: 'm-a', text: '第二句' });
  appendMessage(data, 'g-new', { from: 'm-a', text: '新的一句' });
  writeJson(join(history, 's-old.json'), {
    messages: [user('1', '问'), reply('2', '旧答复'), reply('3', '更新的答复')],
  });
  writeJson(join(history, 's-new.json'), [reply('1', '第一段'), reply('2', '第二段')]);
  writeJson(join(history, 's-empty.json'), { messages: [] });
  writeJson(join(root, 'store.json'), {
    sessions: [
      { id: 's-old', bot: 'bot-a' },
      { id: 's-new', bot: 'bot-a' },
      { id: 's-empty', bot: 'bot-a' },
      { id: 's-miss', bot: 'bot-a' },
      { id: 's-grouped', bot: 'bot-a', groupId: 'g-old' },
    ],
    cards: {},
    idempotency: {},
  });
  return { root, data, history, store: join(root, 'store.json') };
}

function args(box, extra = []) {
  return ['--data-dir', box.data, '--store', box.store, '--history-dir', box.history, ...extra];
}

test('演练只打印将改的段数，不改已有的已读文件', async () => {
  const box = await layout();
  const file = join(box.data, 'unread-cursors.json');
  writeJson(file, {
    v: 1,
    conversations: { 's-old': { id: '2', seq: 2 } },
    groups: { 'g-old': { id: 1 } },
  });
  const before = await readFile(file, 'utf8');
  const out = capture();
  const result = await main([...args(box), '--dry-run'], out);
  assert.equal(result.changed, 2);
  assert.equal(out.text(), '演练：将改 2 段\n');
  assert.equal(await readFile(file, 'utf8'), before);
});

test('没有位置的单聊和讨论组记到最新，已有位置不动，再跑一次是 0', async () => {
  const box = await layout();
  writeJson(join(box.data, 'unread-cursors.json'), {
    v: 1,
    conversations: { 's-old': { id: '2', seq: 2 } },
    groups: { 'g-old': { id: 1 } },
  });
  const out = capture();
  const result = await main(args(box), out);
  assert.equal(result.changed, 2);
  assert.equal(out.text(), '改了 2 段\n');
  const saved = JSON.parse(await readFile(join(box.data, 'unread-cursors.json'), 'utf8'));
  assert.deepEqual(saved.conversations['s-old'], { id: '2', seq: 2 });
  assert.deepEqual(saved.groups['g-old'], { id: 1 });
  assert.deepEqual(saved.conversations['s-new'], { id: '2', seq: 2 });
  assert.deepEqual(saved.groups['g-new'], { id: 1 });
  assert.equal(Object.hasOwn(saved.conversations, 's-empty'), false);
  assert.equal(Object.hasOwn(saved.conversations, 's-miss'), false);
  assert.equal(Object.hasOwn(saved.conversations, 's-grouped'), false);
  assert.equal((await stat(join(box.data, 'unread-cursors.json'))).mode & 0o777, 0o600);
  const history = {
    's-old': [user('1', '问'), reply('2', '旧答复'), reply('3', '更新的答复')],
    's-new': [reply('1', '第一段'), reply('2', '第二段')],
    's-empty': [],
    's-miss': [],
  };
  const core = createUnread({
    dataDir: box.data,
    sessions: {
      async list() {
        return [
          { id: 's-old', bot: 'bot-a' },
          { id: 's-new', bot: 'bot-a' },
          { id: 's-empty', bot: 'bot-a' },
          { id: 's-miss', bot: 'bot-a' },
        ];
      },
      async history(id) { return history[id] || []; },
    },
  });
  const counts = await core.counts();
  assert.equal(counts.body.conversations['s-old'], 1);
  assert.equal(counts.body.conversations['s-new'], 0);
  assert.equal(counts.body.groups['g-old'], 1);
  assert.equal(counts.body.groups['g-new'], 0);
  const afterFirst = await readFile(join(box.data, 'unread-cursors.json'), 'utf8');
  const again = capture();
  const second = await main(args(box), again);
  assert.equal(second.changed, 0);
  assert.equal(again.text(), '改了 0 段\n');
  const afterSecond = await readFile(join(box.data, 'unread-cursors.json'), 'utf8');
  assert.equal(afterFirst, afterSecond);
  const parsed = JSON.parse(afterSecond);
  assert.deepEqual(parsed.conversations['s-old'], { id: '2', seq: 2 });
  assert.deepEqual(parsed.groups['g-old'], { id: 1 });
});

test('已读记录损坏或版本不对时拒绝，不隔离也不改写', async () => {
  const box = await layout();
  const file = join(box.data, 'unread-cursors.json');
  writeFileSync(file, '{', { mode: 0o600 });
  await assert.rejects(main(args(box)), /没有改它/);
  assert.equal(await readFile(file, 'utf8'), '{');
  assert.equal(readdirSync(box.data).some(name => name.includes('.corrupt-')), false);
  writeFileSync(file, JSON.stringify({ v: 2, conversations: {}, groups: {} }), { mode: 0o600 });
  const raw = await readFile(file, 'utf8');
  await assert.rejects(main(args(box)), /没有改它/);
  assert.equal(await readFile(file, 'utf8'), raw);
  assert.equal(readdirSync(box.data).some(name => name.includes('.corrupt-')), false);
});

test('启动脚本不引用未读起点', () => {
  const scripts = new URL('../../../scripts/', import.meta.url);
  for (const name of readdirSync(scripts)) {
    if (!name.endsWith('.sh')) continue;
    const text = readFileSync(new URL(name, scripts), 'utf8');
    assert.equal(text.includes('unread-baseline'), false, name);
  }
});
