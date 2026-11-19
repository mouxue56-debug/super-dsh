import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buildPresence, createHandler, FRESH_MS, LINE_MAX } from '../lib/ext/presence.mjs';

const NOW = Date.parse('2026-11-19T00:00:00.000Z');

function ticket(over) {
  return {
    claimedBy: 'bot-a',
    state: 'progress',
    review: 'none',
    title: '整理记录稿',
    updatedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

function at(ms) {
  return new Date(ms).toISOString();
}

test('长标题使用状态词，控制符不当代码', () => {
  const long = '整理一份很长的记录稿呀后面不要';
  const html = '<b>记录稿</b>加长';
  const view = buildPresence({
    now: NOW,
    tickets: [
      ticket({ title: long }),
      ticket({ claimedBy: 'bot-b', title: '记录\u0000稿', state: 'blocked' }),
      ticket({ claimedBy: 'bot-c', title: html, state: 'progress' }),
    ],
  });
  assert.deepEqual(Array.from(view.bots['bot-a'].line).length <= LINE_MAX, true);
  assert.deepEqual(view.bots['bot-a'], { state: 'working', line: '在干活' });
  assert.deepEqual(view.bots['bot-b'], { state: 'stuck', line: '卡在记录 稿' });
  assert.deepEqual(view.bots['bot-c'].line, '在干活');
});

test('没领的单不算在做，别人的单不记到这位头上', () => {
  const view = buildPresence({
    now: NOW,
    tickets: [
      ticket({ claimedBy: null, to: ['bot-a'], title: '还没人领' }),
      ticket({ claimedBy: 'bot-b', title: '别人的活' }),
    ],
    status: { 'bot-a': { running: false, pending: 0, delegated: { running: false, queued: 0 } } },
  });
  assert.deepEqual(view.bots['bot-a'], undefined);
  assert.deepEqual(view.bots['bot-b'].line, '在别人的活');
});

test('待批和等人回答压过干活，卡住压过交回', () => {
  const waiting = buildPresence({
    now: NOW,
    status: { 'bot-a': { running: true, pending: 2, delegated: { running: true, queued: 0 } } },
    tickets: [ticket()],
  });
  assert.deepEqual(waiting.bots['bot-a'], { state: 'waiting', line: '等你点头' });
  const human = buildPresence({
    now: NOW,
    tickets: [ticket({ state: 'waiting-human', title: '要你定日期' })],
  });
  assert.deepEqual(human.bots['bot-a'].state, 'waiting');
  const stuck = buildPresence({
    now: NOW,
    tickets: [
      ticket({ state: 'blocked', title: '外部回信', updatedAt: at(NOW) }),
      ticket({ review: 'submitted', state: 'progress', title: '已经交了', updatedAt: at(NOW - 1) }),
    ],
  });
  assert.deepEqual(stuck.bots['bot-a'], { state: 'stuck', line: '卡在外部回信' });
});

test('会话在跑但没有工单标题就是在想，派工在跑就是在干活', () => {
  const thinking = buildPresence({
    now: NOW,
    status: { 'bot-a': { running: true, pending: 0, delegated: { running: false, queued: 0 } } },
  });
  assert.deepEqual(thinking.bots['bot-a'], { state: 'thinking', line: '在想' });
  const busy = buildPresence({
    now: NOW,
    status: { 'bot-a': { running: true, pending: 0, delegated: { running: true, queued: 1 } } },
  });
  assert.deepEqual(busy.bots['bot-a'], { state: 'working', line: '在干活' });
  const queued = buildPresence({
    now: NOW,
    status: { 'bot-a': { running: false, pending: 0, delegated: { running: false, queued: 2 } } },
  });
  assert.deepEqual(queued.bots['bot-a'], { state: 'working', line: '在干活' });
  const fuzzy = buildPresence({
    now: NOW,
    status: { 'bot-a': { running: 'yes', pending: 1.5, delegated: { queued: '1' } } },
  });
  assert.deepEqual(fuzzy.bots['bot-a'], undefined);
  const titled = buildPresence({
    now: NOW,
    status: { 'bot-a': { running: true, pending: 0 } },
    tickets: [ticket({ title: '整理记录稿' })],
  });
  assert.deepEqual(titled.bots['bot-a'], { state: 'working', line: '在整理记录稿' });
});

test('交回未验收一直算刚做完；验收后只留十二小时', () => {
  const handed = buildPresence({
    now: NOW,
    tickets: [ticket({ review: 'submitted', state: 'progress', title: '记录稿', updatedAt: at(NOW - FRESH_MS - 5) })],
  });
  assert.deepEqual(handed.bots['bot-a'], { state: 'done', line: '做完记录稿' });
  const fresh = buildPresence({
    now: NOW,
    tickets: [ticket({ state: 'completed', review: 'accepted', title: '记录稿', updatedAt: at(NOW - FRESH_MS) })],
  });
  assert.deepEqual(fresh.bots['bot-a'].state, 'done');
  const old = buildPresence({
    now: NOW,
    tickets: [ticket({ state: 'completed', review: 'accepted', updatedAt: at(NOW - FRESH_MS - 1) })],
    status: { 'bot-a': { running: false, pending: 0 } },
  });
  assert.deepEqual(old.bots['bot-a'], undefined);
});

test('名册以外的键丢掉；看板没读到时仍用状态文件', () => {
  const allowed = new Set(['bot-a']);
  const view = buildPresence({
    now: NOW,
    allowed,
    status: {
      'bot-a': { running: true, pending: 0 },
      '../nope': { running: true, pending: 0 },
    },
    tickets: null,
  });
  assert.deepEqual(Object.keys(view.bots), ['bot-a']);
  assert.deepEqual(view.bots['bot-a'].state, 'thinking');
});

test('显示名能对上名册才算领走', () => {
  const allowed = new Set(['bot-a']);
  const view = buildPresence({
    now: NOW,
    allowed,
    resolve: name => (name === '记录员' ? 'bot-a' : ''),
    tickets: [ticket({ claimedBy: '记录员', title: '整理记录稿' })],
  });
  assert.deepEqual(view.bots['bot-a'].line, '在整理记录稿');
});

function call(handler, { method = 'GET', path = '/presence' } = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.url = path;
  const res = { status: 0, text: '', headersSent: false };
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
    res.headersSent = true;
  };
  res.end = chunk => {
    if (chunk) res.text += chunk;
  };
  return handler(req, res).then(handled => ({
    handled,
    status: res.status,
    body: res.text ? JSON.parse(res.text) : undefined,
  }));
}

function demoHandler(over = {}) {
  return createHandler({
    isTrusted: () => over.trusted !== false,
    board: over.board || { async list() { return [ticket()]; } },
    roster: over.roster || { list: () => [{ id: 'bot-a' }], resolve: id => id },
    logger: { error() {} },
    configDir: over.configDir,
  });
}

test('没钥匙不给看，别的方法拒绝，旁路路径不接', async () => {
  const denied = await call(demoHandler({ trusted: false }));
  assert.deepEqual(denied.status, 401);
  const posted = await call(demoHandler(), { method: 'POST' });
  assert.deepEqual(posted.status, 405);
  const other = await call(demoHandler(), { path: '/presence-extra' });
  assert.deepEqual(other.handled, false);
  const ok = await call(demoHandler());
  assert.deepEqual(ok.status, 200);
  assert.deepEqual(ok.body.bots['bot-a'].state, 'working');
});

test('状态文件坏了或是链接就不采用，看板失败也不编', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'presence-'));
  await writeFile(join(dir, 'bot-status.json'), '{', 'utf8');
  const broken = createHandler({
    configDir: dir,
    isTrusted: () => true,
    board: { async list() { throw new Error('down'); } },
    roster: { list: () => [{ id: 'bot-a' }] },
    logger: { error() {} },
  });
  const bad = await call(broken);
  assert.deepEqual(bad.body.bots['bot-a'], undefined);
  const linkDir = await mkdtemp(join(tmpdir(), 'presence-link-'));
  await mkdir(join(linkDir, 'real'));
  await writeFile(join(linkDir, 'real', 'bot-status.json'), '{"bots":{"bot-a":{"running":true}}}\n');
  await symlink(join(linkDir, 'real', 'bot-status.json'), join(linkDir, 'bot-status.json'));
  const linked = createHandler({
    configDir: linkDir,
    isTrusted: () => true,
    roster: { list: () => [{ id: 'bot-a' }] },
    logger: { error() {} },
  });
  const skipped = await call(linked);
  assert.deepEqual(skipped.body.ok, true);
  assert.deepEqual(skipped.body.bots['bot-a'], undefined);
});

test('状态文件里的在跑能读出来', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'presence-ok-'));
  await writeFile(join(dir, 'bot-status.json'), JSON.stringify({
    bots: { 'bot-a': { running: true, pending: 0, delegated: { running: false, queued: 0 } } },
    ts: NOW,
  }));
  const handler = createHandler({
    configDir: dir,
    isTrusted: () => true,
    board: { async list() { return []; } },
    roster: { list: () => [{ id: 'bot-a' }] },
    logger: { error() {} },
  });
  const result = await call(handler);
  assert.deepEqual(result.body.bots['bot-a'], { state: 'thinking', line: '在想' });
});
