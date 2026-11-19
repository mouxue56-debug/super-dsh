import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { appendMessage, createGroup, saveGroup, OWNER } from '../lib/group.mjs';
import { countSessionUnread, createUnread } from '../lib/unread.mjs';
import { createHandler } from '../lib/ext/unread.mjs';
import { realDeps } from './real-deps.mjs';
import { assistantEvent, userEvent } from './fixtures.mjs';

const reply = (id, text, extra = {}) => ({
  role: 'assistant', id, text, seq: Number(id), ...extra,
});
const user = (id, text) => ({ role: 'user', id, text, seq: Number(id) });

function invoke(handler, { method = 'GET', path = '/unread/', value, raw } = {}) {
  const payload = raw ?? (value === undefined ? '' : JSON.stringify(value));
  const req = Readable.from(payload ? [Buffer.from(payload)] : []);
  req.method = method;
  req.url = path;
  req.headers = {};
  const res = { status: 0, text: '', headersSent: false };
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers;
    res.headersSent = true;
  };
  res.end = (chunk) => {
    if (chunk) res.text += chunk;
  };
  return handler(req, res).then((handled) => ({
    handled,
    status: res.status,
    body: res.text ? JSON.parse(res.text) : undefined,
  }));
}

async function directory() {
  return mkdtemp(join(tmpdir(), 'unread-'));
}

function direct(id, bot) {
  return { id, bot, title: '', hidden: false };
}

test('单聊：主人、系统、工具、空白和重放都不计入，流式分段只算一条', () => {
  const streamed = [reply('4', '你'), reply('4', '你好')];
  const messages = [
    user('1', '我说的'),
    reply('2', '系统提示', { system: true }),
    { role: 'assistant', id: 'tool:c1', text: '命令输出', seq: 3 },
    reply('4', '   '),
    ...streamed,
    reply('5', '第二条'),
    reply('5', '第二条重放'),
  ];
  assert.equal(countSessionUnread(messages, null), 2);
  assert.equal(countSessionUnread(messages.concat(messages), null), 2);
  assert.equal(countSessionUnread([reply('8', ''), reply('8', '后来补上的正文')], null), 1);
});

test('锚点丢了时按序号，没有序号就不把没把握的当成已读', () => {
  assert.equal(countSessionUnread([reply('9', '新')], { id: '2', seq: 2 }), 1);
  assert.equal(countSessionUnread([reply('1', '旧')], { id: '8', seq: 8 }), 0);
  assert.equal(countSessionUnread([reply('x', '无序号')], { id: 'gone' }), 1);
});

test('bots 只合计单聊，讨论组的消息只出现在 groups', async () => {
  const dir = await directory();
  const members = [
    { id: 'm-a', kind: 'assistant', role: 'member' },
    { id: 'm-x', kind: 'external', role: 'member' },
  ];
  saveGroup(dir, createGroup({ id: 'g-alpha', name: '组', goal: '说完', members, host: 'm-a' }));
  appendMessage(dir, 'g-alpha', { from: OWNER, text: '主人这句' });
  appendMessage(dir, 'g-alpha', { from: 'm-a', text: '助理这句', toolCalls: 3 });
  appendMessage(dir, 'g-alpha', { from: 'm-x', text: '外部这句' });
  appendMessage(dir, 'g-alpha', { from: 'm-a', text: '系统样板', system: true });
  const file = join(dir, 'groups', 'g-alpha', 'messages.jsonl');
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  appendFileSync(file, '\n' + lines[1] + '\n');
  const history = {
    s1: [user('1', '问'), reply('2', '答一'), reply('3', '答二')],
    s2: [reply('1', '另一段单聊')],
    s3: [],
    'g-work': [reply('1', '不该进合计'), reply('2', '也不该')],
  };
  const sessions = [
    direct('s1', 'bot-a'),
    direct('s2', 'bot-a'),
    direct('s3', 'bot-b'),
    { id: 'g-work', bot: 'bot-a', groupId: 'g-alpha', hidden: true },
  ];
  const core = createUnread({
    dataDir: dir,
    sessions: {
      list: async () => sessions,
      history: async (id) => ({ messages: history[id] ?? [] }),
    },
  });
  const body = (await core.counts()).body;
  assert.equal(body.ok, true);
  assert.equal(body.conversations.s1, 2);
  assert.equal(body.conversations.s2, 1);
  assert.equal(body.conversations.s3, 0);
  assert.equal(body.conversations['g-work'], undefined);
  assert.equal(body.bots['bot-a'], 3);
  assert.equal(body.bots['bot-b'], 0);
  assert.equal(body.groups['g-alpha'], 1);
  assert.equal((await core.counts()).body.groups['g-alpha'], 1);
});

test('空 upTo 读到最新；更旧的 upTo 不往回拨；不存在的位置不改', async () => {
  const dir = await directory();
  const messages = [user('1', '问'), reply('2', '答'), reply('3', '再答')];
  const deps = {
    dataDir: dir,
    sessions: {
      list: async () => [direct('s1', 'bot-a')],
      history: async () => ({ messages }),
    },
  };
  const core = createUnread(deps);
  const latest = await core.mark({ conversation: 's1', upTo: '' });
  assert.equal(latest.body.upTo, '3');
  assert.equal((await core.counts()).body.conversations.s1, 0);
  const older = await core.mark({ conversation: 's1', upTo: '1' });
  assert.equal(older.body.upTo, '3');
  assert.equal((await core.counts()).body.conversations.s1, 0);
  const missing = await core.mark({ conversation: 's1', upTo: '没有这条' });
  assert.equal(missing.status, 400);
  assert.equal((await core.counts()).body.conversations.s1, 0);
  const again = createUnread(deps);
  assert.equal((await again.counts()).body.conversations.s1, 0);
  const raw = await readFile(join(dir, 'unread-cursors.json'), 'utf8');
  assert.equal(raw.includes('再答'), false);
  assert.equal((await stat(join(dir, 'unread-cursors.json'))).mode & 0o777, 0o600);
});

test('并发时后完成的更旧 read 不能覆盖更远的位置', async () => {
  const dir = await directory();
  const messages = ['1', '2', '3', '4', '5', '6'].map((id) => reply(id, '正文' + id));
  let slow = false;
  const core = createUnread({
    dataDir: dir,
    sessions: {
      list: async () => [direct('s1', 'bot-a')],
      history: async () => {
        if (slow) await new Promise((resolve) => setTimeout(resolve, 80));
        return { messages };
      },
    },
  });
  slow = true;
  const older = core.mark({ conversation: 's1', upTo: '2' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  slow = false;
  const newer = await core.mark({ conversation: 's1', upTo: '5' });
  const first = await older;
  assert.equal(first.body.upTo, '2');
  assert.equal(newer.body.upTo, '5');
  assert.equal((await core.counts()).body.conversations.s1, 1);
  const raw = await readFile(join(dir, 'unread-cursors.json'), 'utf8');
  assert.equal(raw.includes('正文'), false);
});

test('没有这段会话、坏位置、坏文件、历史读不到', async () => {
  const dir = await directory();
  const deps = {
    dataDir: dir,
    sessions: {
      list: async () => [direct('s1', 'bot-a')],
      history: async () => ({ messages: [reply('1', '在')] }),
    },
  };
  const core = createUnread(deps);
  assert.equal((await core.mark({ conversation: 'missing-session', upTo: '' })).status, 404);
  assert.equal(existsSync(join(dir, 'unread-cursors.json')), false);
  assert.equal((await core.mark({ conversation: '../etc', upTo: '' })).status, 400);
  assert.equal((await core.mark({ conversation: 's1', upTo: { at: 1 } })).status, 400);
  const handler = createHandler({ ...deps, isTrusted: () => true });
  const extra = await invoke(handler, {
    method: 'POST', path: '/unread/read', value: { conversation: 's1', upTo: '', note: 'x' },
  });
  assert.equal(extra.status, 400);
  assert.equal((await invoke(handler, { method: 'POST', path: '/unread/' })).status, 405);
  assert.equal((await invoke(handler, { method: 'GET', path: '/unread/read' })).status, 405);
  assert.equal((await invoke(handler, { method: 'GET', path: '/unread/nope' })).status, 404);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'unread-cursors.json'), '{', { mode: 0o600 });
  const afterCorrupt = await core.counts();
  assert.equal(afterCorrupt.body.conversations.s1, 1);
  assert.equal(existsSync(join(dir, 'unread-cursors.json')), false);
  assert.ok(readdirSync(dir).some((name) => name.startsWith('unread-cursors.json.corrupt-')));
  deps.sessions.history = async () => {
    throw new Error('upstream secret');
  };
  const down = await core.counts();
  assert.equal(down.status, 503);
  assert.equal(JSON.stringify(down.body).includes('secret'), false);
});

test('别的身份进不了扩展：不可信或没有可信钩子时不读历史也不落盘', async () => {
  const dir = await directory();
  let reads = 0;
  const sessions = {
    list: async () => {
      reads += 1;
      return [direct('s1', 'bot-a')];
    },
    history: async () => {
      reads += 1;
      return { messages: [reply('1', '在')] };
    },
  };
  const denied = createHandler({ dataDir: dir, sessions, isTrusted: () => false });
  const missing = createHandler({ dataDir: dir, sessions });
  assert.equal((await invoke(denied)).status, 401);
  assert.equal((await invoke(missing, { method: 'POST', path: '/unread/read', raw: '{' })).status, 401);
  assert.equal(reads, 0);
  assert.equal(existsSync(join(dir, 'unread-cursors.json')), false);
});

test('会话号和组号相同时按会话记，不把讨论组标成已读', async () => {
  const dir = await directory();
  const members = [{ id: 'm-a', kind: 'assistant', role: 'member' }];
  saveGroup(dir, createGroup({ id: 'g1', name: '组', goal: '说完', members, host: 'm-a' }));
  appendMessage(dir, 'g1', { from: 'm-a', text: '组里还有' });
  const core = createUnread({
    dataDir: dir,
    sessions: {
      list: async () => [direct('g1', 'bot-a')],
      history: async () => ({ messages: [reply('1', '单聊')] }),
    },
  });
  assert.equal((await core.mark({ conversation: 'g1', upTo: '' })).body.upTo, '1');
  const body = (await core.counts()).body;
  assert.equal(body.conversations.g1, 0);
  assert.equal(body.groups.g1, 1);
});

test('真 deps：历史投影、身份顺序、不存在的会话、已读落盘', async () => {
  const { f, request } = await realDeps();
  const call = async (options) => {
    const pending = request(options);
    const body = await pending.json();
    return { status: pending.res.status, body, text: pending.res.text };
  };
  try {
    const internal = userEvent(2, '系统提示');
    internal.event.data.source = { kind: 'runtime-context' };
    const records = [
      userEvent(1, '主人这句'),
      internal,
      assistantEvent(3, '第一段'),
      assistantEvent(3, '第一段重放'),
      assistantEvent(4, '第二段'),
      {
        type: 'event',
        event: {
          type: 'tool/call', seq: 5, time: 5000,
          data: { callId: 'c1', name: 'bash', arguments: '{}' },
        },
      },
    ];
    f.source.recordsFor = (id) => (id === 's1' ? records : [assistantEvent(1, '工作会话里的回复')]);
    await f.handler.runtime.store.add({
      id: 'g-work', bot: 'bot-a', title: '', lastText: '', lastRole: null,
      updatedAt: 2, unread: 9, running: false, hidden: true, groupId: 'g-alpha',
    });
    const dir = f.handler.deps.dataDir;
    const members = [
      { id: 'm-a', kind: 'assistant', role: 'member' },
      { id: 'm-x', kind: 'external', role: 'member' },
    ];
    saveGroup(dir, createGroup({
      id: 'g-alpha', name: '组', goal: '说完', members, host: 'm-a',
    }));
    appendMessage(dir, 'g-alpha', { from: OWNER, text: '主人在组里' });
    appendMessage(dir, 'g-alpha', { from: 'm-a', text: '助理在组里' });
    appendMessage(dir, 'g-alpha', { from: 'm-x', text: '外部在组里' });
    appendMessage(dir, 'g-alpha', { from: 'm-a', text: '样板', system: true });

    const before = f.source.calls.length;
    const noKey = await call({ method: 'POST', path: '/unread/read', key: null, raw: '{' });
    assert.equal(noKey.status, 401);
    assert.equal(noKey.text.includes('第一段'), false);
    const wrong = await call({ method: 'GET', path: '/unread/', key: 'other-identity' });
    assert.equal(wrong.status, 401);
    const bearer = await call({
      method: 'GET', path: '/unread/', key: null,
      headers: { authorization: 'Bearer external-token' },
    });
    assert.equal(bearer.status, 401);
    assert.equal(f.source.calls.length, before);
    const plain = { url: '/unread/', method: 'GET', headers: {} };
    const sink = { headersSent: false, writeHead() {}, end() {} };
    assert.equal(await f.handler.extensions.handle(plain, sink, 'public'), false);
    const trusted = {
      headersSent: false, status: 0, text: '',
      writeHead(status) { this.status = status; this.headersSent = true; },
      end(chunk) { this.text += chunk ?? ''; },
    };
    assert.equal(await f.handler.extensions.handle(plain, trusted, 'private'), true);
    assert.equal(trusted.status, 401);

    const first = await call({ path: '/unread/' });
    const listed = await f.handler.deps.sessions.list({ all: true });
    const bot = listed.find((row) => row.id === 's1').bot;
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.conversations.s1, 2);
    assert.equal(first.body.conversations['g-work'], undefined);
    assert.equal(first.body.bots[bot], 2);
    assert.equal(first.body.bots['bot-a'], undefined);
    assert.equal(first.body.groups['g-alpha'], 1);

    const absent = await call({
      method: 'POST', path: '/unread/read', value: { conversation: 'missing-session', upTo: '' },
    });
    assert.equal(absent.status, 404);
    const read = await call({
      method: 'POST', path: '/unread/read', value: { conversation: 's1', upTo: '' },
    });
    assert.equal(read.body.upTo, '4');
    records.push(assistantEvent(6, '新的一条'));
    const mid = await call({ path: '/unread/' });
    assert.equal(mid.body.conversations.s1, 1);
    const rewind = await call({
      method: 'POST', path: '/unread/read', value: { conversation: 's1', upTo: '3' },
    });
    assert.equal(rewind.body.upTo, '4');
    assert.equal((await call({ path: '/unread/' })).body.conversations.s1, 1);
    const [left, right] = await Promise.all([
      call({ method: 'POST', path: '/unread/read', value: { conversation: 's1', upTo: '4' } }),
      call({ method: 'POST', path: '/unread/read', value: { conversation: 's1', upTo: '6' } }),
    ]);
    assert.equal(left.body.ok && right.body.ok, true);
    const afterRace = await call({ path: '/unread/' });
    assert.equal(afterRace.body.conversations.s1, 0);
    const groupRead = await call({
      method: 'POST', path: '/unread/read', value: { conversation: 'g-alpha', upTo: '' },
    });
    assert.equal(groupRead.body.upTo, 4);
    const done = await call({ path: '/unread/' });
    assert.equal(done.body.groups['g-alpha'], 0);
    assert.equal(done.body.conversations.s1, 0);
    const restarted = createUnread({
      dataDir: dir, sessions: f.handler.deps.sessions,
    });
    const kept = await restarted.counts();
    assert.equal(kept.body.conversations.s1, 0);
    assert.equal(kept.body.groups['g-alpha'], 0);
    const saved = await readFile(join(dir, 'unread-cursors.json'), 'utf8');
    assert.equal(saved.includes('第一段'), false);
    assert.equal(saved.includes('助理在组里'), false);
  } finally {
    await f.dispose();
  }
});
