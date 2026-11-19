// 给上线的人用的一次性脚本：把还没有已读位置的单聊和讨论组记到最新。
// 已经有位置的不动。不调用内核。单聊原文不在磁盘上，要另给 --history-dir。
// 不自动执行。演练只打印，不写文件。读不了的已读记录直接停下，不隔离、不覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants } from 'node:fs';
import { listGroups, readMessages } from '../lib/group.mjs';
import { createUnread, nextGroupCursor, nextSessionCursor } from '../lib/unread.mjs';

const SESSION_ID = /^[A-Za-z0-9_.:-]{1,200}$/u;
const GROUP_ID = /^[A-Za-z0-9_-]{1,40}$/;

function fail(message) {
  throw new Error(message);
}

function readFlags(argv) {
  const opts = { dry: false };
  const valued = new Set(['--data-dir', '--store', '--history-dir']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dry = true;
    else if (valued.has(arg) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      opts[arg] = argv[i + 1];
      i += 1;
    } else fail('参数无法识别：' + arg);
  }
  if (!opts['--data-dir']) fail('必须给出 --data-dir');
  return opts;
}

function absoluteDir(file, label) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail(label + '必须是绝对路径');
  let info;
  try { info = fs.statSync(file); } catch { fail(label + '不存在'); }
  if (!info.isDirectory()) fail(label + '不是目录');
  return file;
}

function readRegular(file, label) {
  let handle;
  try {
    handle = fs.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fs.fstatSync(handle);
    if (!info.isFile()) fail(label + '不是普通文件，没有改已读位置');
    return fs.readFileSync(handle, 'utf8');
  } catch (error) {
    if (error instanceof Error && error.message.includes('没有改已读位置')) throw error;
    fail(label + '读不了，没有改已读位置');
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  return '';
}

function acceptSession(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
    && (value.seq === undefined || Number.isInteger(value.seq));
}

function acceptGroup(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger(value.id) && value.id >= 0;
}

function takeEntries(source, accept, label) {
  if (source === undefined) return Object.create(null);
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('已读记录里有认不出的位置，没有改它（' + label + '）');
  }
  const target = Object.create(null);
  for (const [key, value] of Object.entries(source)) {
    if (!SESSION_ID.test(key) || !accept(value)) {
      fail('已读记录里有认不出的位置，没有改它（' + label + '）');
    }
    target[key] = value;
  }
  return target;
}

function loadCursors(dataDir) {
  const file = path.join(dataDir, 'unread-cursors.json');
  if (!fs.existsSync(file)) {
    return { missing: true, conversations: Object.create(null), groups: Object.create(null) };
  }
  let value;
  try { value = JSON.parse(readRegular(file, '已读记录')); }
  catch (error) {
    if (error instanceof Error && error.message.includes('没有改')) throw error;
    fail('已读记录读不了，没有改它');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1) {
    fail('已读记录版本不对，没有改它');
  }
  return {
    missing: false,
    conversations: takeEntries(value.conversations, acceptSession, '单聊'),
    groups: takeEntries(value.groups, acceptGroup, '讨论组'),
  };
}

function loadStore(file) {
  if (!file) return [];
  if (!path.isAbsolute(file)) fail('会话名单必须是绝对路径');
  let value;
  try { value = JSON.parse(readRegular(file, '会话名单')); }
  catch (error) {
    if (error instanceof Error && error.message.includes('没有改')) throw error;
    fail('会话名单读不了，没有改已读位置');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.sessions)) {
    fail('会话名单格式不对，没有改已读位置');
  }
  const rows = [];
  for (const row of value.sessions) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('会话名单里有认不出的一段');
    if (typeof row.id !== 'string' || !SESSION_ID.test(row.id)) fail('会话号无效，没有改已读位置');
    if (typeof row.bot !== 'string' || !row.bot) fail('会话没有助理号，没有改已读位置');
    const grouped = typeof row.groupId === 'string' && row.groupId.length > 0;
    if (!grouped) rows.push({ id: row.id, bot: row.bot });
  }
  return rows;
}

function historyFile(dir, id) {
  const root = path.resolve(dir);
  const file = path.resolve(root, id + '.json');
  if (path.dirname(file) !== root) fail('会话历史路径越出了给定目录');
  return file;
}

function loadHistory(dir, sessions) {
  const found = new Map();
  if (!dir) return found;
  absoluteDir(dir, '会话历史目录');
  for (const row of sessions) {
    const file = historyFile(dir, row.id);
    if (!fs.existsSync(file)) continue;
    let value;
    try { value = JSON.parse(readRegular(file, '会话历史')); }
    catch (error) {
      if (error instanceof Error && error.message.includes('没有改')) throw error;
      fail('会话历史读不了，没有改已读位置');
    }
    const messages = Array.isArray(value) ? value : value?.messages;
    if (!Array.isArray(messages)) fail('会话历史格式不对，没有改已读位置');
    found.set(row.id, messages);
  }
  return found;
}

function sameSession(before, after) {
  return Boolean(after) && before.id === after.id && before.seq === after.seq;
}

function sameGroup(before, after) {
  return Boolean(after) && before.id === after.id;
}

export async function main(argv, { stdout = process.stdout } = {}) {
  const opts = readFlags(argv);
  const dataDir = absoluteDir(opts['--data-dir'], '数据目录');
  const prior = loadCursors(dataDir);
  const sessions = loadStore(opts['--store']);
  const history = loadHistory(opts['--history-dir'], sessions);
  const changes = [];
  for (const row of sessions) {
    if (prior.conversations[row.id]) continue;
    const messages = history.get(row.id);
    if (!messages) continue;
    const next = nextSessionCursor(messages, undefined, { latest: true });
    if (next?.cursor) changes.push({ id: row.id, kind: 'session' });
  }
  const sessionIds = new Set(changes.filter(item => item.kind === 'session').map(item => item.id));
  for (const group of listGroups(dataDir)) {
    if (!group || typeof group.id !== 'string' || !GROUP_ID.test(group.id)) continue;
    if (prior.groups[group.id] || sessionIds.has(group.id)) continue;
    const next = nextGroupCursor(readMessages(dataDir, group.id), undefined, { latest: true });
    if (next?.cursor) changes.push({ id: group.id, kind: 'group' });
  }
  const line = (opts.dry ? '演练：将改 ' : '改了 ') + changes.length + ' 段\n';
  if (opts.dry || changes.length === 0) {
    stdout.write(line);
    return { changed: changes.length, dry: opts.dry };
  }
  const wanted = new Set(changes.filter(item => item.kind === 'session').map(item => item.id));
  const core = createUnread({
    dataDir,
    sessions: {
      async list() {
        return sessions.filter(row => wanted.has(row.id));
      },
      async history(id) {
        const messages = history.get(id);
        if (!messages) throw Object.assign(new Error('no-history'), { code: 'NO_HISTORY' });
        return messages;
      },
    },
  });
  for (const item of changes) {
    const result = await core.mark({ conversation: item.id, upTo: '' });
    if (!result?.ok || result.body?.ok !== true) fail('记下已读位置失败，已停下');
  }
  const after = loadCursors(dataDir);
  for (const [id, cursor] of Object.entries(prior.conversations)) {
    if (!sameSession(cursor, after.conversations[id])) fail('已有的已读位置被改动了');
  }
  for (const [id, cursor] of Object.entries(prior.groups)) {
    if (!sameGroup(cursor, after.groups[id])) fail('已有的已读位置被改动了');
  }
  stdout.write(line);
  return { changed: changes.length, dry: false };
}

const invoked = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : '未读起点没有跑成');
    process.exitCode = 1;
  });
}
