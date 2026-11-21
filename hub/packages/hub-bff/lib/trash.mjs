// 最近删除：只在新文件里记墓碑。不改内核会话，不改会话清单里已有字段。
// 过期只是不再出现在列表里，文件和原数据都留着，也不能再恢复。
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, open, rename } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
export const TRASH_WINDOW_MS = 30 * DAY_MS;
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,200}$/u;
const BATCH_ID = /^tb_[a-f0-9]{16}$/u;
const DEVICE_ID = /^[a-f0-9]{16}$/u;
const BOT_ID = /^[a-z][a-z0-9-]{1,23}$/u;
const LABEL_MAX = 80;

function blank() {
  return { v: 1, batches: [] };
}

function fail(status, code, message) {
  return { ok: false, status, body: { error: { code, message } } };
}

function done(body, status = 200) {
  return { ok: true, status, body };
}

// 标题和名字只当一段文字：去掉控制字符，超长就截断。
export function clipData(value, max) {
  const text = typeof value === 'string'
    ? value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim()
    : '';
  const chars = Array.from(text);
  if (chars.length <= max) return chars.join('');
  if (max <= 1) return '…';
  return chars.slice(0, max - 1).join('') + '…';
}

// 会进某位助理长对话的段。会议、固定任务、组内会话不算。
export function isChatSegment(row) {
  if (!row || row.hidden === true || row.groupId) return false;
  if (typeof row.id !== 'string' || typeof row.bot !== 'string') return false;
  const purpose = row.purpose;
  if (purpose === 'meeting' || purpose === 'routine') return false;
  if (typeof purpose === 'string' && purpose.startsWith('group-')) return false;
  return true;
}

function activeBatches(state) {
  return state.batches.filter((batch) => !batch.restoredAt);
}

function sameIds(left, right) {
  if (left.length !== right.length) return false;
  const have = new Set(right);
  return left.every((id) => have.has(id));
}

// 仍生效的墓碑（含已过期、未恢复）。过期只影响列表和恢复，不把内容放回来。
export function deletedSessionIds(state) {
  const ids = new Set();
  for (const batch of activeBatches(state)) {
    if (batch.kind === 'segment') ids.add(batch.session);
    if (batch.kind === 'thread') {
      for (const id of batch.sessions) ids.add(id);
    }
  }
  return [...ids].sort();
}

export function isSegmentDeleted(state, sessionId) {
  return deletedSessionIds(state).includes(sessionId);
}

function refParts(ref) {
  if (ref && typeof ref === 'object') {
    const id = typeof ref.id === 'string' && ref.id ? ref.id : '';
    const seq = Number.isInteger(ref.seq) ? ref.seq : null;
    return { id, seq };
  }
  if (typeof ref === 'number' && Number.isInteger(ref)) return { id: String(ref), seq: ref };
  if (typeof ref === 'string' && ref) {
    return { id: ref, seq: /^\d{1,15}$/u.test(ref) ? Number(ref) : null };
  }
  return { id: '', seq: null };
}

function messageHit(batch, ref) {
  if (batch.kind !== 'message') return false;
  const parts = refParts(ref);
  if (parts.id && batch.messageId === parts.id) return true;
  if (parts.seq !== null && (batch.seq === parts.seq || batch.messageId === String(parts.seq))) return true;
  return false;
}

export function isMessageDeleted(state, sessionId, ref) {
  if (isSegmentDeleted(state, sessionId)) return true;
  return activeBatches(state).some((batch) => batch.session === sessionId && messageHit(batch, ref));
}

export function hasMessageDeletion(state, sessionId) {
  return activeBatches(state).some((batch) => batch.kind === 'message' && batch.session === sessionId);
}

// 整段删了就什么都不留。只删了其中几条时，按消息号或序号去掉那几条。
export function filterMessages(state, sessionId, messages) {
  if (!Array.isArray(messages)) return [];
  if (isSegmentDeleted(state, sessionId)) return [];
  const batches = activeBatches(state);
  return messages.filter((message) => !batches.some((batch) =>
    batch.session === sessionId && messageHit(batch, message)));
}

function daysLeft(deletedAt, nowMs) {
  const left = deletedAt + TRASH_WINDOW_MS - nowMs;
  if (left <= 0) return 0;
  return Math.ceil(left / DAY_MS);
}

function publicItem(batch, nowMs) {
  const item = {
    id: batch.id,
    kind: batch.kind,
    bot: batch.bot,
    label: batch.label,
    deletedAt: batch.deletedAt,
    by: batch.by,
    daysLeft: batch.restoredAt ? 0 : daysLeft(batch.deletedAt, nowMs),
  };
  if (batch.kind === 'thread') item.sessions = [...batch.sessions];
  else item.session = batch.session;
  if (batch.kind === 'message') {
    item.messageId = batch.messageId;
    if (batch.seq !== undefined) item.seq = batch.seq;
  }
  if (batch.restoredAt) item.restoredAt = batch.restoredAt;
  return item;
}

export function listItems(state, nowMs) {
  return activeBatches(state)
    .filter((batch) => daysLeft(batch.deletedAt, nowMs) > 0)
    .sort((a, b) => b.deletedAt - a.deletedAt || (a.id < b.id ? -1 : 1))
    .map((batch) => publicItem(batch, nowMs));
}

function validIdList(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 2000
    && value.every((id) => typeof id === 'string' && SESSION_ID.test(id))
    && new Set(value).size === value.length;
}

function validBatch(batch) {
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) return false;
  if (typeof batch.id !== 'string' || !BATCH_ID.test(batch.id)) return false;
  if (!['message', 'segment', 'thread'].includes(batch.kind)) return false;
  if (typeof batch.bot !== 'string' || !BOT_ID.test(batch.bot)) return false;
  if (!Number.isSafeInteger(batch.deletedAt) || batch.deletedAt < 0) return false;
  if (typeof batch.by !== 'string' || !DEVICE_ID.test(batch.by)) return false;
  if (typeof batch.label !== 'string' || Array.from(batch.label).length > LABEL_MAX) return false;
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(batch.label)) return false;
  if (batch.restoredAt !== undefined && (!Number.isSafeInteger(batch.restoredAt) || batch.restoredAt < 0)) {
    return false;
  }
  if (batch.kind === 'thread') return validIdList(batch.sessions);
  if (typeof batch.session !== 'string' || !SESSION_ID.test(batch.session)) return false;
  if (batch.kind === 'segment') return true;
  if (typeof batch.messageId !== 'string' || !batch.messageId || batch.messageId.length > 200) return false;
  if (/[\u0000-\u001f\u007f]/u.test(batch.messageId)) return false;
  if (batch.seq !== undefined && !Number.isInteger(batch.seq)) return false;
  return true;
}

function packBatch(batch) {
  const row = {
    id: batch.id,
    kind: batch.kind,
    bot: batch.bot,
    deletedAt: batch.deletedAt,
    by: batch.by,
    label: batch.label,
  };
  if (batch.restoredAt) row.restoredAt = batch.restoredAt;
  if (batch.kind === 'thread') row.sessions = [...batch.sessions];
  else row.session = batch.session;
  if (batch.kind === 'message') {
    row.messageId = batch.messageId;
    if (batch.seq !== undefined) row.seq = batch.seq;
  }
  return row;
}

function parseState(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.v !== 1) throw new Error('shape');
  if (!Array.isArray(value.batches) || value.batches.length > 5000) throw new Error('shape');
  const batches = [];
  const seen = new Set();
  for (const raw of value.batches) {
    if (!validBatch(raw) || seen.has(raw.id)) throw new Error('shape');
    seen.add(raw.id);
    batches.push(packBatch(raw));
  }
  return { v: 1, batches };
}

function clockOf(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function newId(batches) {
  const used = new Set(batches.map((batch) => batch.id));
  for (let i = 0; i < 8; i += 1) {
    const id = 'tb_' + randomBytes(8).toString('hex');
    if (!used.has(id)) return id;
  }
  return null;
}

// 建一块可注入路径和时钟的墓碑库。读函数看内存里的当前墓碑，写在进程内排队。
export function createTrash({ file, now = () => Date.now(), logger = console } = {}) {
  const enabled = typeof file === 'string' && isAbsolute(file);
  let state = blank();
  let frozen = !enabled;
  let tail = Promise.resolve();
  let generation = 0;

  function log(code) {
    try {
      logger?.error?.(code);
    } catch {
      // 日志失败不影响墓碑读写。
    }
  }

  function exclusive(task) {
    const run = tail.then(task, task);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async function writeState() {
    const text = JSON.stringify({ v: 1, batches: state.batches.map(packBatch) }) + '\n';
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + '.tmp';
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
      await rename(temporary, file);
      await chmod(file, 0o600);
    } catch (error) {
      log('HUB_TRASH_WRITE_FAILED');
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async function load() {
    if (!enabled) return;
    let handle;
    let text;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile()) {
        frozen = true;
        log('HUB_TRASH_UNREADABLE');
        return;
      }
      text = await handle.readFile('utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      frozen = true;
      log('HUB_TRASH_UNREADABLE');
      return;
    } finally {
      await handle?.close();
    }
    try {
      state = parseState(text);
    } catch {
      try {
        await rename(file, file + '.corrupt-' + Date.now());
      } catch {
        frozen = true;
        state = blank();
        log('HUB_TRASH_QUARANTINE_FAILED');
        return;
      }
      log('HUB_TRASH_CORRUPT');
      state = blank();
      try {
        await writeState();
      } catch {
        frozen = true;
        log('HUB_TRASH_WRITE_FAILED');
      }
    }
  }

  const ready = load();

  function unavailable() {
    return fail(503, 'UNAVAILABLE', '最近删除暂时不能写入');
  }

  function view(batch, nowMs, extra) {
    return done({ ok: true, ...extra, item: publicItem(batch, nowMs) });
  }

  async function commit(recipe) {
    await ready;
    return exclusive(async () => {
      if (frozen) return unavailable();
      const nowMs = clockOf(now);
      if (nowMs === null) return unavailable();
      const made = recipe(nowMs);
      if (made.result) return made.result;
      const snapshot = state.batches;
      state.batches = snapshot.concat(made.batch);
      try {
        await writeState();
      } catch {
        state.batches = snapshot;
        return unavailable();
      }
      generation += 1;
      return view(made.batch, nowMs, { duplicate: false });
    });
  }

  function findMessageBatch(sessionId, ref) {
    return activeBatches(state).find((batch) => batch.session === sessionId && messageHit(batch, ref));
  }

  function findSegmentBatch(sessionId) {
    return activeBatches(state).find((batch) => batch.kind === 'segment' && batch.session === sessionId);
  }

  function findThreadBatch(bot, sessions) {
    return activeBatches(state).find((batch) =>
      batch.kind === 'thread' && batch.bot === bot && sameIds(batch.sessions, sessions));
  }

  function findCoveringSession(sessionId) {
    return activeBatches(state)
      .filter((batch) => (batch.kind === 'segment' && batch.session === sessionId)
        || (batch.kind === 'thread' && batch.sessions.includes(sessionId)))
      .sort((a, b) => b.deletedAt - a.deletedAt || (a.id < b.id ? -1 : 1))[0] ?? null;
  }

  function duplicateView(batch) {
    const nowMs = clockOf(now);
    if (!batch || nowMs === null) return null;
    return view(batch, nowMs, { duplicate: true });
  }

  return {
    ready,
    file: enabled ? file : '',
    isSegmentDeleted(sessionId) {
      return isSegmentDeleted(state, sessionId);
    },
    isMessageDeleted(sessionId, ref) {
      return isMessageDeleted(state, sessionId, ref);
    },
    hasMessageDeletion(sessionId) {
      return hasMessageDeletion(state, sessionId);
    },
    filterMessages(sessionId, messages) {
      return filterMessages(state, sessionId, messages);
    },
    deletedSessionIds() {
      return deletedSessionIds(state);
    },
    deletionOfMessage(sessionId, ref) {
      return duplicateView(findMessageBatch(sessionId, ref));
    },
    deletionOfSession(sessionId) {
      return duplicateView(findCoveringSession(sessionId));
    },
    deletionOfThread(bot, sessions) {
      return duplicateView(findThreadBatch(bot, [...sessions].sort()));
    },
    list({ now: at } = {}) {
      const nowMs = at === undefined ? clockOf(now) : at;
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) return [];
      return listItems(state, nowMs);
    },
    async removeMessage({ session, messageId, seq, bot, by, label }) {
      return commit((nowMs) => {
        const again = findMessageBatch(session, { id: messageId, seq });
        if (again) return { result: view(again, nowMs, { duplicate: true }) };
        const id = newId(state.batches);
        if (!id) return { result: unavailable() };
        const batch = {
          id,
          kind: 'message',
          bot,
          session,
          messageId,
          deletedAt: nowMs,
          by,
          label: clipData(label, LABEL_MAX),
        };
        if (seq !== undefined) batch.seq = seq;
        return { batch };
      });
    },
    async removeSegment({ session, bot, by, label }) {
      return commit((nowMs) => {
        const again = findSegmentBatch(session);
        if (again) return { result: view(again, nowMs, { duplicate: true }) };
        const id = newId(state.batches);
        if (!id) return { result: unavailable() };
        return {
          batch: {
            id,
            kind: 'segment',
            bot,
            session,
            deletedAt: nowMs,
            by,
            label: clipData(label, LABEL_MAX),
          },
        };
      });
    },
    async removeThread({ bot, sessions, by, label }) {
      const ids = [...sessions].sort();
      if (!ids.length) return fail(404, 'NOT_FOUND', '没有可清的对话');
      return commit((nowMs) => {
        const again = findThreadBatch(bot, ids);
        if (again) return { result: view(again, nowMs, { duplicate: true }) };
        const id = newId(state.batches);
        if (!id) return { result: unavailable() };
        return {
          batch: {
            id,
            kind: 'thread',
            bot,
            sessions: ids,
            deletedAt: nowMs,
            by,
            label: clipData(label, LABEL_MAX),
          },
        };
      });
    },
    async restore(batchId) {
      await ready;
      return exclusive(async () => {
        if (frozen) return unavailable();
        const nowMs = clockOf(now);
        if (nowMs === null) return unavailable();
        const batch = state.batches.find((item) => item.id === batchId);
        if (!batch) return fail(404, 'NOT_FOUND', '没有这批删除记录');
        if (batch.restoredAt) return view(batch, nowMs, { duplicate: true });
        if (daysLeft(batch.deletedAt, nowMs) <= 0) return fail(404, 'NOT_FOUND', '这批已经不在最近删除里');
        const snapshot = state.batches;
        state.batches = snapshot.map((item) => (item.id === batch.id ? { ...item, restoredAt: nowMs } : item));
        try {
          await writeState();
        } catch {
          state.batches = snapshot;
          return unavailable();
        }
        generation += 1;
        const saved = state.batches.find((item) => item.id === batch.id);
        return view(saved, nowMs, { duplicate: false });
      });
    },
    // 内存缓存用它作废。只在成功写入后增加，重复删同一条不增加。
    stamp() {
      return generation;
    },
  };
}
