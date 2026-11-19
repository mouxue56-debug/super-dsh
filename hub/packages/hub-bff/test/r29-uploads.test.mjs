// 收件。不听端口，不连内核。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { request } from './fixtures.mjs';
import { createHandler } from '../lib/ext/uploads.mjs';
import { DEFAULT_MAX_BYTES } from '../lib/uploads.mjs';

async function sandbox(extra = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'b2-up-'));
  const cwd = path.join(root, 'work');
  await fs.mkdir(cwd);
  const sent = [];
  const deps = {
    hubHome: root,
    dataDir: path.join(root, 'data'),
    hubConfig: extra.hubConfig ?? {},
    sessions: {
      list: async query => {
        deps.listed = query;
        return extra.sessions ?? [{ id: 's1', bot: 'b1', hidden: true }];
      },
      send: () => {
        sent.push(1);
        throw new Error('不应发送');
      },
    },
    botCwd: () => cwd,
    isTrusted: () => extra.trusted ?? true,
  };
  return {
    root, cwd, deps, sent,
    handler: createHandler(deps),
    async dispose() { await fs.rm(root, { recursive: true, force: true }); },
  };
}

async function leaves(dir) {
  const out = [];
  async function walk(current, rel) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === '.receipts') continue;
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink() || !entry.isDirectory()) out.push(next);
      else await walk(full, next);
    }
  }
  await walk(dir, '');
  return out.sort();
}

async function post(box, options = {}) {
  const {
    method = 'POST', raw = 'hello', filename = 'note.txt', headers = {},
    conversation = 's1', bot = 'b1', query, key = 'synthetic-bff-key',
  } = options;
  const url = query ?? `/uploads/?conversation=${conversation}&bot=${bot}`;
  const res = request(box.handler, {
    method, path: url, raw, key,
    headers: {
      ...(filename === undefined ? {} : { 'x-filename': filename }),
      ...headers,
    },
  });
  const handled = await res.done;
  let body = null;
  if (res.res.text) {
    try { body = JSON.parse(res.res.text); } catch { body = { raw: res.res.text }; }
  }
  return { status: res.res.status, body, handled, headersSent: res.res.headersSent };
}

test('默认上限是 25MB，再调高就算配置无效', () => {
  assert.equal(DEFAULT_MAX_BYTES, 25 * 1024 * 1024);
});

test('加载处理器时不写盘，多出来的路径不接', async () => {
  const handler = createHandler({});
  assert.equal(typeof handler, 'function');
  const missed = request(handler, { method: 'POST', path: '/uploads/extra', raw: 'x' });
  assert.equal(await missed.done, false);
  assert.equal(missed.res.headersSent, false);
});

test('收下文本并交回工作目录里的相对路径，不发消息', async () => {
  const box = await sandbox();
  try {
    const result = await post(box, {
      raw: '你好', filename: '我的 笔记.TXT',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.name, '我的 笔记.txt');
    assert.equal(result.body.mime, 'text/plain');
    assert.equal(result.body.size, Buffer.byteLength('你好'));
    assert.match(result.body.id, /^[a-f0-9]{16}$/u);
    assert.equal(result.body.path, `inbox/s1/${result.body.name}`);
    assert.equal(result.body.path.includes('..'), false);
    const text = await fs.readFile(path.join(box.cwd, ...result.body.path.split('/')), 'utf8');
    assert.equal(text, '你好');
    assert.equal(box.sent.length, 0);
    assert.deepEqual(box.deps.listed, { all: true });
    const mode = (await fs.stat(path.join(box.cwd, ...result.body.path.split('/')))).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    await box.dispose();
  }
});

test('路径穿越、绝对路径和空字节都只留下文件名', async () => {
  const box = await sandbox();
  try {
    const names = ['../secret.txt', '..\\..\\secret.txt', 'foo/../../x.txt', 'a\u0000.txt', '..\u0000/../../z.txt'];
    for (const filename of names) {
      const result = await post(box, { filename, raw: filename });
      assert.equal(result.status, 200, filename);
      assert.equal(result.body.path.startsWith('inbox/s1/'), true);
      assert.equal(result.body.path.split('/').includes('..'), false);
    }
    const absolute = await post(box, { filename: '/etc/passwd', raw: 'no' });
    assert.equal(absolute.status, 415);
    assert.equal(absolute.body.message, '文件类型不在允许范围');
    const stored = await leaves(box.cwd);
    assert.equal(stored.every(name => name.startsWith('inbox/s1/')), true);
    assert.equal(stored.some(name => name.includes('..')), false);
  } finally {
    await box.dispose();
  }
});

test('超限、空文件、类型不符、会话和助理对不上，各有自己的字样', async () => {
  const box = await sandbox({ hubConfig: { uploads: { max_bytes: 4 } } });
  try {
    const big = await post(box, { raw: 'hello' });
    assert.equal(big.status, 413);
    assert.equal(big.body.message, '文件超过大小上限');
    const declared = await post(box, { raw: 'hi', headers: { 'content-length': '9' } });
    assert.equal(declared.status, 413);
    const empty = await post(box, { raw: '' });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.message, '文件是空的');
    const kind = await post(box, { filename: 'run.exe', raw: 'x' });
    assert.equal(kind.status, 415);
    const clash = await post(box, { raw: 'x', headers: { 'content-type': 'image/png' } });
    assert.equal(clash.status, 415);
    const octet = await post(box, { raw: 'x', headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(octet.status, 415);
    const missing = await post(box, { conversation: 'none' });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.message, '会话不存在');
    const bot = await post(box, { bot: 'b2' });
    assert.equal(bot.status, 400);
    assert.equal(bot.body.message, '助理与会话不符');
    const query = await post(box, { query: '/uploads/' });
    assert.equal(query.status, 400);
    assert.equal(query.body.message, '缺少会话或助理');
    assert.deepEqual(await leaves(box.cwd), []);
  } finally {
    await box.dispose();
  }
});

test('文件名或会话号带上读工具会拒的字样时不落盘', async () => {
  const box = await sandbox();
  try {
    const bad = await post(box, { filename: '密钥.txt' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.message, '文件名含助理不能读的字样');
    box.deps.sessions.list = async () => [{ id: 'secrets', bot: 'b1' }];
    const session = await post(box, { conversation: 'secrets', filename: 'a.txt' });
    assert.equal(session.status, 400);
    assert.equal(session.body.message, '文件名含助理不能读的字样');
    assert.deepEqual(await leaves(box.cwd), []);
  } finally {
    await box.dispose();
  }
});

test('收件目录是符号链接，或配到工作目录外面，都拒绝', async () => {
  const box = await sandbox();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'b2-out-'));
  try {
    await fs.mkdir(path.join(box.cwd, 'inbox'));
    await fs.symlink(outside, path.join(box.cwd, 'inbox', 's1'));
    const linked = await post(box);
    assert.equal(linked.status, 500);
    assert.equal(linked.body.message, '收件目录不在助理可读范围内');
    assert.deepEqual(await fs.readdir(outside), []);
    await fs.unlink(path.join(box.cwd, 'inbox', 's1'));
    box.deps.hubConfig = { uploads: { dir: outside } };
    const escaped = await post(box, { filename: 'b.txt' });
    assert.equal(escaped.status, 500);
    assert.equal(escaped.body.message, '收件目录不在助理可读范围内');
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await box.dispose();
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('同一文件名并发收下时加序号，同一个请求号只留一份', async () => {
  const box = await sandbox();
  try {
    const many = await Promise.all(Array.from({ length: 6 }, () => post(box, { raw: 'x' })));
    assert.equal(many.every(item => item.status === 200), true);
    const names = new Set(many.map(item => item.body.name));
    assert.equal(names.size, 6);
    assert.equal(names.has('note.txt'), true);
    assert.equal([...names].every(name => name === 'note.txt' || /^note-\d+\.txt$/u.test(name)), true);
    const raced = await Promise.all([
      post(box, { raw: 'one', filename: 'race.txt', headers: { 'x-request-id': 'race-1' } }),
      post(box, { raw: 'two', filename: 'race.txt', headers: { 'x-request-id': 'race-1' } }),
    ]);
    assert.equal(raced[0].body.path, raced[1].body.path);
    const again = await post(box, {
      raw: 'three', filename: 'other.txt', headers: { 'x-request-id': 'race-1' },
    });
    assert.equal(again.body.path, raced[0].body.path);
    assert.equal(again.body.id, raced[0].body.id);
    const kept = await fs.readFile(path.join(box.cwd, ...again.body.path.split('/')), 'utf8');
    assert.equal(kept === 'one' || kept === 'two', true);
    assert.notEqual(kept, 'three');
    const raceFiles = (await leaves(box.cwd)).filter(name => name.endsWith('/race.txt') || name.includes('/race-'));
    assert.equal(raceFiles.length, 1);
  } finally {
    await box.dispose();
  }
});

test('两个会话可以用同一个请求号，各存各的', async () => {
  const box = await sandbox({
    sessions: [{ id: 's1', bot: 'b1' }, { id: 's2', bot: 'b1' }],
  });
  try {
    const first = await post(box, { headers: { 'x-request-id': 'same' } });
    const second = await post(box, { conversation: 's2', headers: { 'x-request-id': 'same' } });
    assert.equal(first.body.path, 'inbox/s1/note.txt');
    assert.equal(second.body.path, 'inbox/s2/note.txt');
    assert.notEqual(first.body.id, second.body.id);
  } finally {
    await box.dispose();
  }
});

test('没密钥、错方法、坏请求号和过高的上限', async () => {
  const open = await sandbox();
  try {
    const get = await post(open, { method: 'GET' });
    assert.equal(get.status, 405);
    assert.equal(get.body.message, '只接受 POST');
    const badId = await post(open, { headers: { 'x-request-id': '..' } });
    assert.equal(badId.status, 400);
    assert.equal(badId.body.message, '请求号无效');
    open.deps.hubConfig = { uploads: { max_bytes: DEFAULT_MAX_BYTES + 1 } };
    const high = await post(open, { filename: 'b.txt' });
    assert.equal(high.status, 500);
    assert.equal(high.body.message, '大小上限配置无效');
  } finally {
    await open.dispose();
  }
  const closed = await sandbox({ trusted: false });
  try {
    const denied = await post(closed);
    assert.equal(denied.status, 401);
    assert.equal(denied.body.message, '需要密钥');
    assert.deepEqual(await leaves(closed.cwd), []);
  } finally {
    await closed.dispose();
  }
});
