import { constants } from 'node:fs';
import { mkdir, open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { listGroups, loadGroup, readMessages } from './group.mjs';

const SESSION_ID = /^[A-Za-z0-9_.:-]{1,200}$/u;
const FILE_NAME = 'unread-cursors.json';

function blank() {
  return { v: 1, conversations: Object.create(null), groups: Object.create(null) };
}

function fail(status, code, message) {
  return { ok: false, status, body: { error: { code, message } } };
}

function done(body, status = 200) {
  return { ok: true, status, body };
}

// 同一条回复的流式分段共用一个 id；没有稳定 id 的无法和重放区分，不进入清单。
export function transcript(messages) {
  const rows = [];
  const index = new Map();
  for (const message of messages ?? []) {
    if (!message || typeof message !== 'object') continue;
    if (typeof message.id !== 'string' || !message.id) continue;
    const at = index.get(message.id);
    if (at === undefined) {
      index.set(message.id, rows.length);
      rows.push(message);
      continue;
    }
    // 先到的是空分段、后到的才是完整正文时，仍只保留这一条，但要用能数的那次。
    if (!isDirectReply(rows[at]) && isDirectReply(message)) rows[at] = message;
  }
  return rows;
}

// 单聊里算未读的，只有助理写给主人的完整正文。工具占位、空文本、系统标记都不算。
export function isDirectReply(message) {
  if (!message || message.role !== 'assistant' || message.system === true) return false;
  if (typeof message.id !== 'string' || !message.id || message.id.startsWith('tool:')) return false;
  return typeof message.text === 'string' && message.text.trim().length > 0;
}

export function countSessionUnread(messages, cursor) {
  const rows = transcript(messages);
  const replies = rows.filter(isDirectReply);
  if (!cursor?.id) return replies.length;
  const at = rows.findIndex((row) => row.id === cursor.id);
  if (at >= 0) return rows.slice(at + 1).filter(isDirectReply).length;
  if (Number.isInteger(cursor.seq)) {
    return replies.filter((row) => Number.isInteger(row.seq) && row.seq > cursor.seq).length;
  }
  return replies.length;
}

function packSession(message) {
  const cursor = { id: message.id };
  if (Number.isInteger(message.seq)) cursor.seq = message.seq;
  return cursor;
}

// 比不出「新位置不更旧」时保持原位，避免把已读往回拨。
function sessionNotAfter(rows, current, target) {
  if (!current?.id) return false;
  const currentAt = rows.findIndex((row) => row.id === current.id);
  const targetAt = rows.findIndex((row) => row.id === target.id);
  if (currentAt >= 0 && targetAt >= 0) return targetAt <= currentAt;
  if (Number.isInteger(current.seq) && Number.isInteger(target.seq)) return target.seq <= current.seq;
  return true;
}

export function nextSessionCursor(messages, current, request) {
  const rows = transcript(messages);
  const target = request.latest ? rows.at(-1) : rows.find((row) => row.id === request.id);
  if (!target) {
    if (request.latest) return { cursor: current ?? null };
    return { error: 'unknown' };
  }
  if (sessionNotAfter(rows, current, target)) return { cursor: current ?? null };
  return { cursor: packSession(target) };
}

export function groupTranscript(messages) {
  const rows = [];
  const seen = new Set();
  for (const message of messages ?? []) {
    if (!message || !Number.isInteger(message.id) || message.id < 0 || seen.has(message.id)) continue;
    seen.add(message.id);
    rows.push(message);
  }
  return rows;
}

export function assistantIdsOf(group) {
  if (!Array.isArray(group?.members)) return null;
  const ids = new Set();
  for (const member of group.members) {
    if (member?.kind === 'assistant' && typeof member.id === 'string' && member.id) ids.add(member.id);
  }
  return ids;
}

// 讨论组只数助理写进组里的完整发言。主人、系统样板、外部成员、空文本都不算。
export function isGroupReply(message, assistantIds) {
  if (!message || message.system === true || message.from === 'owner') return false;
  if (typeof message.from !== 'string' || !message.from) return false;
  if (assistantIds && !assistantIds.has(message.from)) return false;
  return typeof message.text === 'string' && message.text.trim().length > 0;
}

export function countGroupUnread(messages, cursor, assistantIds) {
  const after = Number.isInteger(cursor?.id) ? cursor.id : -1;
  let count = 0;
  for (const message of groupTranscript(messages)) {
    if (message.id <= after) continue;
    if (isGroupReply(message, assistantIds)) count += 1;
  }
  return count;
}

export function nextGroupCursor(messages, current, request) {
  const rows = groupTranscript(messages);
  const target = request.latest ? rows.at(-1) : rows.find((row) => row.id === request.id);
  if (!target) {
    if (request.latest) return { cursor: current ?? null };
    return { error: 'unknown' };
  }
  if (Number.isInteger(current?.id) && target.id <= current.id) return { cursor: current };
  return { cursor: { id: target.id } };
}

function parseUpTo(value) {
  if (value === undefined || value === null || value === '') return { latest: true };
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return { latest: false, id: String(value), numeric: value };
  }
  if (typeof value !== 'string' || !value || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) {
    return null;
  }
  if (/^\d{1,15}$/u.test(value)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) return { latest: false, id: value, numeric };
  }
  return { latest: false, id: value, numeric: null };
}

function copyEntries(source, accept) {
  const target = Object.create(null);
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  for (const [key, value] of Object.entries(source)) {
    if (!SESSION_ID.test(key) || !accept(value)) continue;
    target[key] = value;
  }
  return target;
}

function acceptSessionCursor(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
    && (value.seq === undefined || Number.isInteger(value.seq));
}

function acceptGroupCursor(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger(value.id) && value.id >= 0;
}

export function isDirectSession(row) {
  return row.hidden !== true && !row.groupId && !['meeting', 'routine'].includes(row.purpose)
    && !(typeof row.purpose === 'string' && row.purpose.startsWith('group-'));
}

export function createUnread(deps = {}) {
  const filePath = typeof deps.dataDir === 'string' && deps.dataDir ? join(deps.dataDir, FILE_NAME) : '';
  let tail = Promise.resolve();
  let frozen = false;

  function exclusive(task) {
    const run = tail.then(task, task);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  function log(code) {
    try {
      deps.logger?.error?.(code);
    } catch {
      // 日志失败不影响未读读写。
    }
  }

  async function quarantine() {
    await rename(filePath, filePath + '.corrupt-' + Date.now());
  }

  async function readCursors() {
    if (!filePath) throw Object.assign(new Error('no-dir'), { code: 'NO_DIR' });
    if (frozen) throw Object.assign(new Error('frozen'), { code: 'FROZEN' });
    let handle;
    let text;
    try {
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile()) throw Object.assign(new Error('not-file'), { code: 'FROZEN' });
      text = await handle.readFile('utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return blank();
      frozen = true;
      log('UNREAD_CURSOR_UNREADABLE');
      throw error;
    } finally {
      await handle?.close();
    }
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1) {
        throw new Error('shape');
      }
      const conversations = copyEntries(value.conversations, acceptSessionCursor);
      const groups = copyEntries(value.groups, acceptGroupCursor);
      if (!conversations || !groups) throw new Error('shape');
      return { v: 1, conversations, groups };
    } catch (error) {
      if (error.code === 'FROZEN') throw error;
      // 长对话的 GET 只读位置，损坏时也不移动原文件。
      if (deps.readOnly === true) throw Object.assign(new Error('invalid-cursors'), { code: 'FROZEN' });
      try {
        await quarantine();
      } catch {
        frozen = true;
        log('UNREAD_CURSOR_QUARANTINE_FAILED');
        throw error;
      }
      log('UNREAD_CURSOR_CORRUPT');
      return blank();
    }
  }

  async function writeCursors(cursors) {
    if (frozen) throw Object.assign(new Error('frozen'), { code: 'FROZEN' });
    const text = JSON.stringify({
      v: 1,
      conversations: cursors.conversations,
      groups: cursors.groups,
    }) + '\n';
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = filePath + '.tmp';
    let handle;
    try {
      handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
        0o600,
      );
      await handle.chmod(0o600);
      await handle.writeFile(text);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, filePath);
    } catch (error) {
      log('UNREAD_CURSOR_WRITE_FAILED');
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async function listSessions() {
    const value = await deps.sessions?.list?.({ all: true });
    if (!Array.isArray(value)) throw Object.assign(new Error('no-sessions'), { code: 'NO_SESSIONS' });
    return value.filter((row) => row && typeof row.id === 'string' && typeof row.bot === 'string');
  }

  async function historyOf(id) {
    if (typeof deps.sessions?.history !== 'function') {
      throw Object.assign(new Error('no-history'), { code: 'NO_HISTORY' });
    }
    const value = await deps.sessions.history(id);
    const messages = Array.isArray(value) ? value : value?.messages;
    if (!Array.isArray(messages)) throw Object.assign(new Error('bad-history'), { code: 'NO_HISTORY' });
    return messages;
  }

  function unavailable(error) {
    if (error?.code === 'NO_DIR') return fail(503, 'UNAVAILABLE', '没有数据目录，未读位置无法落盘');
    if (error?.code === 'FROZEN') return fail(503, 'UNAVAILABLE', '已读记录无法安全读取，没有改动它');
    if (error?.code === 'NO_HISTORY' || error?.code === 'NO_SESSIONS') {
      return fail(503, 'UNAVAILABLE', '暂时读不到会话历史');
    }
    return fail(503, 'UNAVAILABLE', '未读暂时算不出来');
  }

  function readGroup(id) {
    if (!deps.dataDir) return null;
    try {
      return loadGroup(deps.dataDir, id);
    } catch (error) {
      if (error?.message === 'Invalid group id') return null;
      throw error;
    }
  }

  async function counts() {
    try {
      const cursors = await exclusive(() => readCursors());
      const sessions = await listSessions();
      const conversations = Object.create(null);
      const bots = Object.create(null);
      for (const row of sessions) {
        if (!isDirectSession(row)) continue;
        if (deps.trash?.isSegmentDeleted?.(row.id) === true) continue;
        const messages = await historyOf(row.id);
        const visible = typeof deps.trash?.filterMessages === 'function'
          ? deps.trash.filterMessages(row.id, messages)
          : messages;
        const count = countSessionUnread(visible, cursors.conversations[row.id]);
        conversations[row.id] = count;
        bots[row.bot] = (bots[row.bot] ?? 0) + count;
      }
      const groups = Object.create(null);
      if (deps.dataDir) {
        for (const group of listGroups(deps.dataDir)) {
          const messages = readMessages(deps.dataDir, group.id);
          groups[group.id] = countGroupUnread(
            messages,
            cursors.groups[group.id],
            assistantIdsOf(group),
          );
        }
      }
      return done({ ok: true, conversations, bots, groups });
    } catch (error) {
      return unavailable(error);
    }
  }

  async function mark(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return fail(400, 'INVALID_INPUT', '请求体必须是对象');
    }
    if (typeof input.conversation !== 'string' || !SESSION_ID.test(input.conversation)) {
      return fail(400, 'INVALID_INPUT', '会话号无效');
    }
    const request = parseUpTo(input.upTo);
    if (!request) return fail(400, 'INVALID_INPUT', '已读位置无效');
    try {
      return await exclusive(async () => {
        const cursors = await readCursors();
        const sessions = await listSessions();
        const session = sessions.find((row) => row.id === input.conversation);
        if (session) {
          const messages = await historyOf(session.id);
          const next = nextSessionCursor(messages, cursors.conversations[session.id], request);
          if (next.error) return fail(400, 'INVALID_INPUT', '已读位置不在这段会话里');
          if (next.cursor) cursors.conversations[session.id] = next.cursor;
          await writeCursors(cursors);
          return done({ ok: true, conversation: session.id, upTo: next.cursor?.id ?? null });
        }
        const group = readGroup(input.conversation);
        if (!group) return fail(404, 'NOT_FOUND', '没有这段会话');
        const groupRequest = request.latest
          ? { latest: true }
          : (request.numeric !== null && String(request.numeric) === request.id
            ? { latest: false, id: request.numeric }
            : null);
        if (!groupRequest) return fail(400, 'INVALID_INPUT', '讨论组的已读位置必须是消息号');
        const messages = readMessages(deps.dataDir, group.id);
        const next = nextGroupCursor(messages, cursors.groups[group.id], groupRequest);
        if (next.error) return fail(400, 'INVALID_INPUT', '已读位置不在这个讨论组里');
        if (next.cursor) cursors.groups[group.id] = next.cursor;
        await writeCursors(cursors);
        return done({ ok: true, conversation: group.id, upTo: next.cursor?.id ?? null });
      });
    } catch (error) {
      return unavailable(error);
    }
  }

  return { counts, mark, filePath, readPositions: () => exclusive(() => readCursors()) };
}
