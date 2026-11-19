import fs from 'node:fs';
import path from 'node:path';

const kinds = new Set(['call', 'approval', 'action', 'change', 'dispatch']);
const tokenNames = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'];
const queues = new Map();
const maxLine = 8192;
const maxTokens = 1e12;

// 按时区偏移取得日期。
export function dayOf(tsMs, utcOffsetMinutes = 0) {
  return new Date(tsMs + utcOffsetMinutes * 60000).toISOString().slice(0, 10);
}

// 审批事件的去重键；没有会话号时带上助理名，避免不同助理的同号审批撞键。
function approvalKey(sessionId, bot, id) {
  return sessionId != null ? `approval:${sessionId}:${id}` : `approval:nosession:${bot ?? ''}:${id}`;
}

// 创建事件转换器。
export function createEventTranslator() {
  let currentSession = null;
  const starts = new Map(), asked = new Map();
  const scope = (...parts) => JSON.stringify(parts);
  return {
    translate(event, ctx = {}) {
      if (event.type === 'session') {
        currentSession = event.id ?? null;
        return null;
      }
      const sessionId = ctx.sessionId ?? currentSession;
      const data = event.data ?? {};
      if (event.type === 'step/start') {
        starts.set(scope(sessionId, data.turn, data.step), event.time);
        return null;
      }
      if (event.type === 'approval/asked') {
        asked.set(scope(sessionId, data.id), event);
        return null;
      }
      if (event.type !== 'assistant/message' && event.type !== 'approval/decided') return null;
      const common = {
        seq: event.seq,
        tsMs: event.time,
        bot: ctx.bot ?? null,
        sessionId,
        ticket: ctx.ticket ?? null,
        ...(ctx.backfill ? { backfill: true } : {}),
      };
      if (event.type === 'assistant/message') {
        const usage = data.usage ?? {}, source = data.message?.source ?? {};
        const start = starts.get(scope(sessionId, data.turn, data.step));
        return {
          ...common,
          kind: 'call',
          channel: source.provider ?? null,
          model: source.model ?? null,
          tokens: Object.fromEntries(tokenNames.map((k) => [k, usage[k + 'Tokens'] ?? null])),
          totalTokens: usage.totalTokens ?? null,
          turn: data.turn ?? null,
          step: data.step ?? null,
          durationMs: Number.isFinite(start) && Number.isFinite(event.time) ? event.time - start : null,
        };
      }
      const request = asked.get(scope(sessionId, data.id));
      let info = {};
      const reason = request?.data?.reason;
      if (typeof reason === 'string' && reason.startsWith('HUBAPPROVAL1 ')) {
        try {
          info = JSON.parse(reason.slice('HUBAPPROVAL1 '.length)) ?? {};
        } catch { /* malformed request metadata */ }
      }
      return {
        ...common,
        kind: 'approval',
        ...(data.id ? { key: approvalKey(sessionId, ctx.bot, data.id) } : {}),
        approvalId: data.id ?? null,
        tool: info.tool ?? request?.data?.toolName ?? null,
        level: info.level ?? null,
        action: info.action ?? null,
        target: info.path ?? null,
        device: ctx.device ?? null,
        outcome: data.outcome ?? null,
        askedTsMs: request?.time ?? null,
      };
    },
  };
}

function normalize(input, now) {
  const row = { ...input };
  if (!kinds.has(row.kind)) throw new Error('Invalid ledger kind');
  row.v = 1;
  row.tsMs = row.tsMs ?? (row.ts != null ? Date.parse(row.ts) : now());
  if (!Number.isInteger(row.tsMs) || !Number.isFinite(row.tsMs)) throw new Error('Invalid timestamp');
  row.ts = new Date(row.tsMs).toISOString();
  row.bot ??= null;
  row.sessionId ??= null;
  row.ticket ??= null;
  if (!row.key) {
    if (row.sessionId != null && Number.isInteger(row.seq)) {
      row.key = `${row.kind}:${row.sessionId}:${row.seq}`;
    } else if (row.id != null && String(row.id).length) row.key = `${row.kind}:id:${row.id}`;
    else throw new Error('Cannot generate ledger key');
  }
  if (typeof row.key !== 'string' || !row.key.length) throw new Error('Invalid ledger key');
  if (row.kind === 'call' || row.kind === 'dispatch') {
    if (
      row.kind === 'call' &&
      (row.tokens == null || typeof row.tokens !== 'object' || Array.isArray(row.tokens))
    ) throw new Error('Invalid call tokens');
    if (row.tokens != null) {
      if (typeof row.tokens !== 'object' || Array.isArray(row.tokens)) throw new Error('Invalid tokens');
      for (const k of tokenNames) {
        const n = row.tokens[k];
        if (n !== null && (!Number.isSafeInteger(n) || n < 0 || n > maxTokens)) {
          throw new Error('Invalid token value');
        }
      }
      if (row.kind === 'dispatch' && tokenNames.every((k) => row.tokens[k] === 0)) {
        throw new Error('Dispatch tokens cannot all be zero');
      }
    }
  }
  if (row.backfill !== true) delete row.backfill;
  return row;
}

function serialize(row) {
  let line = JSON.stringify(row) + '\n';
  if (Buffer.byteLength(line) <= maxLine) return line;
  row.truncated = true;
  // Preserve identifiers and numerical fields. Recursively shrink other string values.
  const protectedFields = new Set(['key', 'kind', 'ts', 'sessionId', 'bot', 'ticket']);

  function shorten(obj, limit) {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && !protectedFields.has(k) && v.length > limit) {
        obj[k] = Array.from(v).slice(0, limit).join('');
      } else if (v && typeof v === 'object') shorten(v, limit);
    }
  }
  for (const limit of [1024, 512, 256, 128, 64, 0]) {
    shorten(row, limit);
    line = JSON.stringify(row) + '\n';
    if (Buffer.byteLength(line) <= maxLine) return line;
  }
  throw new Error('Ledger row cannot fit in 8KB without truncating identifiers');
}

// 创建账本。
export function createLedger({ dir, utcOffsetMinutes = 0, now = () => Date.now() }) {
  if (typeof dir !== 'string' || !dir) throw new Error('Ledger dir required');
  const root = path.resolve(dir), eventsDir = path.join(root, 'events');
  const translator = createEventTranslator(), seenSeq = new Map();
  let index = null, signature = null;

  // 各日文件大小的签名：账只追加，别的进程写过大小就会变。
  function signatureOf() {
    try {
      return fs.readdirSync(eventsDir).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort()
        .map((n) => `${n}:${fs.statSync(path.join(eventsDir, n)).size}`).join('|');
    } catch (e) {
      if (e.code === 'ENOENT') return '';
      throw e;
    }
  }

  function updateMax(map, sid, seq) {
    if (sid != null && Number.isInteger(seq)) map.set(sid, Math.max(map.get(sid) ?? -Infinity, seq));
  }

  async function listDays() {
    try {
      return fs.readdirSync(eventsDir, { withFileTypes: true }).filter((d) =>
        d.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(d.name)
      ).map((d) => d.name.slice(0, 10)).sort();
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  async function readRows({ from, to } = {}) {
    const rows = [], seen = new Set();
    let skipped = 0;
    for (const day of await listDays()) {
      if ((from && day < from) || (to && day > to)) continue;
      const content = fs.readFileSync(path.join(eventsDir, day + '.jsonl'), 'utf8');
      const parts = content.split('\n');
      if (parts.at(-1) !== '') {
        skipped++;
        parts.pop();
      } else parts.pop();
      for (const line of parts) {
        try {
          const row = JSON.parse(line);
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
          // 同一个键只算一条（另一个进程重复写入时，读的时候也去重）。
          if (typeof row.key === 'string') {
            if (seen.has(row.key)) continue;
            seen.add(row.key);
          }
          rows.push(row);
        } catch {
          skipped++;
        }
      }
    }
    Object.defineProperty(rows, 'skippedLines', { value: skipped, enumerable: false });
    return rows;
  }

  async function initIndex() {
    const now = signatureOf();
    if (index && signature === now) return;
    const keys = new Set(), calls = new Map(), persisted = new Map();
    for (const row of await readRows()) {
      if (typeof row.key === 'string') keys.add(row.key);
      if (row.kind === 'call') updateMax(calls, row.sessionId, row.seq);
      if (row.kind === 'call' || row.kind === 'approval') updateMax(persisted, row.sessionId, row.seq);
    }
    index = { keys, calls, persisted };
    signature = now;
  }

  async function record(input) {
    const row = normalize(input, now);
    const previous = queues.get(root) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      // Scan under the process-wide lock so separate instances see each other's writes.
      await initIndex();
      if (index.keys.has(row.key)) return { written: false, key: row.key };
      const line = serialize(row);
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      fs.mkdirSync(eventsDir, { recursive: true, mode: 0o700 });
      const fd = fs.openSync(
        path.join(eventsDir, dayOf(row.tsMs, utcOffsetMinutes) + '.jsonl'),
        fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW,
        0o600,
      );
      try {
        // 文件末尾若是写到一半的残行（没有换行），先补一个换行，免得新行接在残行后面读不出来。
        const size = fs.fstatSync(fd).size, last = Buffer.alloc(1);
        const torn = size > 0 && fs.readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 0x0a;
        const bytes = Buffer.from(torn ? '\n' + line : line);
        if (fs.writeSync(fd, bytes) !== bytes.length) throw new Error('Short ledger write');
      } finally {
        fs.closeSync(fd);
      }
      signature = signatureOf();
      index.keys.add(row.key);
      if (row.kind === 'call') updateMax(index.calls, row.sessionId, row.seq);
      if (row.kind === 'call' || row.kind === 'approval') updateMax(index.persisted, row.sessionId, row.seq);
      return { written: true, key: row.key };
    });
    queues.set(root, run);
    try {
      return await run;
    } finally {
      if (queues.get(root) === run) queues.delete(root);
    }
  }

  async function recordEvent(event, ctx = {}) {
    const row = translator.translate(event, ctx);
    const sid = ctx.sessionId ?? (event.type === 'session' ? event.id : row?.sessionId) ?? currentSession;
    if (event.type === 'session') currentSession = event.id ?? null;
    updateMax(seenSeq, sid, event.seq);
    return row ? record(row) : { written: false, skipped: true };
  }
  let currentSession = null;

  async function ingest(events, ctx = {}) {
    const result = { written: 0, duplicate: 0, skipped: 0 };
    for (const event of events) {
      const r = await recordEvent(event, ctx);
      result[r.skipped ? 'skipped' : r.written ? 'written' : 'duplicate']++;
    }
    return result;
  }

  async function lastSeq(sessionId) {
    await initIndex();
    return index.calls.get(sessionId) ?? null;
  }

  async function catchUp({ sessionId, fetchSince, ctx = {} }) {
    await initIndex();
    const p = index.persisted.get(sessionId), s = seenSeq.get(sessionId);
    const since = p == null ? (s ?? null) : s == null ? p : Math.max(p, s);
    return ingest(await fetchSince(since), { ...ctx, sessionId });
  }
  return { record, recordEvent, ingest, lastSeq, catchUp, readRows, listDays };
}
