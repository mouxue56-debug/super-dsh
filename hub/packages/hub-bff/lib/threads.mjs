import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BffError } from './errors.mjs';
import { BOT_ID } from './roster.mjs';
import { createUnread, isDirectReply, isDirectSession } from './unread.mjs';

const SESSION = /^[A-Za-z0-9_.:-]{1,200}$/u;
const invalid = message => new BffError('INVALID_INPUT', message, 400);
const missing = () => new BffError('NOT_FOUND', '找不到这条消息', 404);
const time = value => typeof value === 'number' ? value : Date.parse(value);
const compare = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2];
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const tuple = item => [time(item.ts ?? item.startedAt), item.session, item.seq ?? -1];
const locator = item => ({ id: item.id, session: item.session, seq: item.seq, ts: item.ts });

function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1400}$/u.test(value)) throw invalid('位置无效');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || encode(parsed) !== value) throw new Error();
    return parsed;
  } catch { throw invalid('位置无效'); }
}

function position(value) {
  const p = decode(value);
  if (p.length !== 3 || !Number.isFinite(p[0]) || p[0] < 0 || !SESSION.test(p[1])
    || !Number.isSafeInteger(p[2]) || p[2] < -1) throw invalid('翻页位置无效');
  return p;
}

function target(value) {
  const p = decode(value);
  if (p.length !== 4 || !SESSION.test(p[0]) || typeof p[1] !== 'string' || p[1].length > 200
    || !Number.isSafeInteger(p[2]) || p[2] < 0 || !Number.isFinite(p[3]) || p[3] < 0) {
    throw invalid('消息位置无效');
  }
  return { session: p[0], messageId: p[1], seq: p[2], ts: p[3], id: value };
}

function options(input = {}) {
  const limit = input.limit === undefined ? 40 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('每页条数应为 1 到 100');
  if ([input.before, input.after, input.around].filter(Boolean).length > 1) throw invalid('只能选一种位置');
  if (input.segment !== undefined && (!SESSION.test(input.segment)
    || input.before || input.after || input.around)) throw invalid('对话段位置无效');
  if (input.unread !== undefined && input.unread !== '1' && input.unread !== true) throw invalid('未读参数无效');
  return { limit, before: input.before ? position(input.before) : null,
    after: input.after ? position(input.after) : null, around: input.around ? target(input.around) : null,
    unread: input.unread === '1' || input.unread === true };
}

// 只读聚合。依赖可注入，缓存只在内存，更新段时按清单版本失效。
export function createThreads(deps = {}) {
  const cache = new Map();
  const unread = createUnread({ ...deps, readOnly: true });
  const readPositions = deps.readPositions ?? (() => unread.readPositions());
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.threadTimeoutMs ?? 10000;
  const searchMs = deps.threadSearchMs ?? 2000;

  function deadline(ms = timeoutMs) { return now() + ms; }
  async function bounded(promise, end) {
    const remaining = end - now();
    if (remaining <= 0) throw new BffError('TIMEOUT', '查找时间较长，请稍后再试', 503);
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new BffError('TIMEOUT', '查找时间较长，请稍后再试', 503)), remaining);
      })]);
    } finally { clearTimeout(timer); }
  }

  async function roster() {
    const rows = typeof deps.roster?.list === 'function' ? await deps.roster.list() : deps.roster;
    if (!Array.isArray(rows)) throw new BffError('UNAVAILABLE', '暂时读不到助理名册', 503);
    return rows.filter(row => row.status !== 'disabled');
  }

  async function rowsFor(bot) {
    if (!BOT_ID.test(bot ?? '') || !(await roster()).some(row => (row.id ?? row.bot) === bot)) {
      throw invalid('助理无效或已停用');
    }
    const rows = await deps.sessions.list({ all: true });
    return rows.filter(row => row.bot === bot && isDirectSession(row)
      && deps.trash?.isSegmentDeleted?.(row.id) !== true);
  }

  function dropped(sessionId, message) {
    if (typeof deps.trash?.isMessageDeleted !== 'function') return false;
    return deps.trash.isMessageDeleted(sessionId, { id: message.messageId ?? message.id, seq: message.seq });
  }

  function state(row) {
    const version = JSON.stringify([row.updatedAt, row.lastText, row.lastRole, row.running, row.title, row.purpose,
      deps.sessions.historyVersion?.(row.id), deps.trash?.stamp?.() ?? 0]);
    let s = cache.get(row.id);
    if (!s || s.version !== version || row.running && now() - s.at > 1000) {
      s = { version, at: now(), pages: new Map(), stats: new Map(), first: null, last: null };
      cache.set(row.id, s);
    }
    // 段元数据上限；单段页缓存另限 24 页，长聊不会在服务里再存一份全文。
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return s;
  }

  async function readPage(row, beforeSeq, limit, end) {
    const s = state(row);
    const key = String(beforeSeq ?? 'latest') + ':' + limit;
    if (s.pages.has(key) && deps.sessions.historyConnected?.() !== false) return s.pages.get(key);
    if (typeof deps.sessions.historyPage !== 'function') {
      throw new BffError('UNAVAILABLE', '内核暂时不能分页读取对话', 503);
    }
    const value = await bounded(deps.sessions.historyPage(row.id, { beforeSeq, limit }), end);
    if (!Array.isArray(value?.messages)) throw new BffError('INCOMPATIBLE', '对话历史格式无效');
    const messages = value.messages.map(message => {
      const ts = Number.isFinite(time(message.ts)) ? message.ts : 0;
      if (!Number.isSafeInteger(message.seq) || message.seq < 0 || typeof message.id !== 'string') {
        throw new BffError('INCOMPATIBLE', '对话缺少稳定的位置');
      }
      return { ...message, kind: 'message', session: row.id, messageId: message.id, ts,
        id: encode([row.id, message.id, message.seq, time(ts)]) };
    }).sort((a, b) => compare(tuple(a), tuple(b)));
    const page = { ...value, messages };
    if (value.context?.compacted && (!s.context || value.context.checkpointSeq > s.context.checkpointSeq)) {
      s.context = value.context;
    }
    if (page.hasMore && (!Number.isSafeInteger(page.nextBeforeSeq)
      || beforeSeq !== undefined && page.nextBeforeSeq >= beforeSeq)) {
      throw new BffError('INCOMPATIBLE', '对话翻页位置没有前进');
    }
    if (beforeSeq === undefined) {
      s.last = messages.at(-1) ?? null;
      s.maxSeq = value.maxSeq ?? messages.at(-1)?.seq ?? 0;
    }
    if (!page.hasMore && messages.length) s.first = messages[0];
    s.pages.set(key, page);
    if (s.pages.size > 24) s.pages.delete(s.pages.keys().next().value);
    return page;
  }

  // 内核按 seq 分页。用时间作二分查找，跨段跳转不用把较新的几千条先拉下来。
  async function seek(row, point, end) {
    const latest = await readPage(row, undefined, 40, end);
    if (!point || !latest.messages.length) return { page: latest, beforeSeq: undefined };
    const s = state(row);
    if (compare(tuple(latest.messages[0]), point) < 0 || !latest.hasMore) {
      return { page: latest, beforeSeq: undefined };
    }
    if (point[1] === row.id) {
      const beforeSeq = point[2] + 1;
      return { page: await readPage(row, beforeSeq, 40, end), beforeSeq };
    }
    let lo = 0, hi = s.maxSeq + 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const probe = await readPage(row, mid + 1, 1, end);
      const last = probe.messages.at(-1);
      if (!last || compare(tuple(last), point) < 0) lo = mid + 1;
      else hi = mid;
    }
    const beforeSeq = lo + 1;
    return { page: await readPage(row, beforeSeq, 40, end), beforeSeq };
  }

  async function firstOf(row, end) {
    const s = state(row);
    if (s.first) return s.first;
    const result = await seek(row, [0, '', -1], end);
    return result.page.messages[0] ?? null;
  }

  async function firstVisible(row, end) {
    const raw = await firstOf(row, end);
    if (!raw || !dropped(row.id, raw)) return raw;
    const next = await forward(row, tuple(raw), 1, end, false);
    return next[0] ?? null;
  }

  async function visibleTail(row, end) {
    let beforeSeq;
    let page;
    do {
      page = await readPage(row, beforeSeq, 100, end);
      const kept = page.messages.filter(item => !dropped(row.id, item));
      if (kept.length) return kept.at(-1);
      beforeSeq = page.nextBeforeSeq;
    } while (page.hasMore);
    return null;
  }

  async function ticketId(row) {
    const explicit = row.ticketId ?? row.title?.match(/\bT-[A-Za-z0-9-]+\b/u)?.[0];
    if (explicit) return explicit;
    const wake = state(row).first?.text?.match(/【[^】]*?工单\s+(T-[A-Za-z0-9-]+)/u)?.[1];
    if (wake) return wake;
    if (!deps.dataDir) return null;
    // 接力是现有叫醒文件中持久保存「单号/棒次 → 会话号」的一种。
    try {
      const value = JSON.parse(await readFile(join(deps.dataDir, 'relay-wake.json'), 'utf8'));
      const entry = Object.entries(value.sessions ?? {}).find(([, session]) => session === row.id);
      return entry?.[0].match(/^T-[A-Za-z0-9-]+/u)?.[0] ?? null;
    } catch { return null; }
  }

  function boardMarks(ticket) {
    const marks = {};
    const steps = Array.isArray(ticket?.relay?.steps) ? ticket.relay.steps : [];
    const fromSteps = steps.reduce((sum, step) => sum + (Number.isInteger(step?.clones) ? step.clones : 0), 0);
    const tracked = Number.isInteger(ticket?.cloneTrack?.clones) ? ticket.cloneTrack.clones : 0;
    const clones = fromSteps || tracked;
    if (clones > 0) marks.clones = clones;
    const rows = [...(ticket?.progress ?? []), ...(ticket?.history ?? [])];
    if (rows.some(item => item?.via === 'file')) marks.via = 'file';
    else if (rows.some(item => item?.via === 'cli')) marks.via = 'cli';
    return marks;
  }

  async function header(row, end, count) {
    const latest = await readPage(row, undefined, 40, end);
    const first = await firstVisible(row, end);
    if (!first) return null;
    const tail = await visibleTail(row, end);
    const kept = latest.messages.filter(item => !dropped(row.id, item));
    const ticket = await ticketId(row);
    const marks = /独立会话|另开一段会话/u.test(row.title ?? '') ? { aside: true } : {};
    if (ticket && typeof deps.board?.get === 'function') {
      try { Object.assign(marks, boardMarks(await deps.board.get(ticket))); }
      catch { /* 卡不在或读不到时，事件卡仍按会话标题显示。 */ }
    }
    return { kind: 'segment', session: row.id, purpose: row.purpose ?? '', title: row.title,
      startedAt: first.ts, endedAt: tail?.ts ?? first.ts,
      ts: row.purpose === 'board' ? tail?.ts ?? first.ts : first.ts,
      seq: -1, state: row.running ? 'running' : 'done', ticketId: ticket, ...marks,
      messages: latest.hasMore ? null : kept.length, unread: count ?? row.unread ?? 0,
      context: { ...(state(row).context ?? { compacted: null, exact: false }),
        firstText: first?.role === 'user' ? first.text?.slice(0, 60) : '',
        note: state(row).context?.compacted
          ? '较早内容已压成摘要，助理还带着近期原文；需要时可查保存的资料。'
          : '这里显示这段聊天的起点；助理可能已把较早内容压成摘要，当前无法确认完整边界。' } };
  }

  async function statistics(row, cursor, end) {
    const s = state(row), key = JSON.stringify(cursor ?? null);
    if (s.stats.has(key)) return s.stats.get(key);
    let page, beforeSeq, count = 0, first = null;
    const seen = new Set();
    do {
      page = await readPage(row, beforeSeq, 100, end);
      for (const item of [...page.messages].reverse()) {
        if (seen.has(item.messageId)) continue;
        seen.add(item.messageId);
        const atCursor = cursor && (item.messageId === cursor.id
          || Number.isInteger(cursor.seq) && item.seq <= cursor.seq);
        if (dropped(row.id, item)) {
          if (!atCursor) continue;
          const stopped = { count, first };
          s.stats.set(key, stopped);
          return stopped;
        }
        if (atCursor) {
          const result = { count, first };
          s.stats.set(key, result);
          return result;
        }
        if (isDirectReply({ ...item, id: item.messageId })) { count++; first = locator(item); }
      }
      beforeSeq = page.nextBeforeSeq;
    } while (page.hasMore);
    const result = { count, first };
    s.stats.set(key, result);
    if (s.stats.size > 4) s.stats.delete(s.stats.keys().next().value);
    return result;
  }

  async function positions(end) {
    try { return (await bounded(readPositions(), end)).conversations ?? {}; }
    catch (error) {
      if (error instanceof BffError) throw error;
      throw new BffError('UNAVAILABLE', '已读位置暂时无法读取', 503);
    }
  }

  async function list() {
    const end = deadline(), cursors = await positions(end), threads = [];
    for (const bot of await roster()) {
      const id = bot.id ?? bot.bot, rows = await rowsFor(id);
      const counts = await Promise.all(rows.map(row => statistics(row, cursors[row.id], end)));
      const ordered = [...rows].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      let last = ordered[0];
      let lastText = last?.lastText ?? '';
      let lastRole = last?.lastRole ?? null;
      let updatedAt = last?.updatedAt ?? 0;
      if (rows.some(row => deps.trash?.hasMessageDeletion?.(row.id) === true)) {
        last = null; lastText = ''; lastRole = null; updatedAt = 0;
        for (const row of ordered) {
          if (deps.trash?.hasMessageDeletion?.(row.id) === true) {
            const tail = await visibleTail(row, end);
            if (!tail) continue;
            last = row;
            lastText = typeof tail.text === 'string' ? tail.text : '';
            lastRole = tail.role === 'user' || tail.role === 'assistant' ? tail.role : null;
            updatedAt = Number.isFinite(time(tail.ts)) ? time(tail.ts) : 0;
            break;
          }
          last = row;
          lastText = row.lastText ?? '';
          lastRole = row.lastRole ?? null;
          updatedAt = row.updatedAt ?? 0;
          break;
        }
      }
      threads.push({ bot: id, lastText, lastRole, updatedAt,
        unread: counts.reduce((sum, count) => sum + count.count, 0),
        running: rows.some(row => row.running), segments: rows.length });
    }
    return { threads: threads.sort((a, b) => b.updatedAt - a.updatedAt || a.bot.localeCompare(b.bot)) };
  }

  async function current(bot) {
    const rows = (await rowsFor(bot)).filter(row => !row.purpose);
    const end = deadline();
    const dated = await Promise.all(rows.map(async row => ({ row,
      start: time((await firstVisible(row, end))?.ts ?? row.updatedAt) })));
    dated.sort((a, b) => b.start - a.start || b.row.id.localeCompare(a.row.id));
    return { current: dated[0]?.row ?? null };
  }

  async function backward(row, point, limit, end, includeHeader) {
    if (includeHeader && row.purpose === 'board') {
      const h = await header(row, end);
      return h && (!point || compare(tuple(h), point) < 0) ? [h] : [];
    }
    let { page } = await seek(row, point, end);
    const items = [], seen = new Set();
    while (true) {
      for (const item of [...page.messages].reverse()) {
        if (dropped(row.id, item)) continue;
        if (point && compare(tuple(item), point) >= 0 || seen.has(item.id)) continue;
        seen.add(item.id); items.push(item);
      }
      if (items.length >= limit || !page.hasMore) break;
      page = await readPage(row, page.nextBeforeSeq, 40, end);
    }
    if (includeHeader && !page.hasMore) {
      const h = await header(row, end);
      if (h && (!point || compare(tuple(h), point) < 0)) items.push(h);
    }
    return items.sort((a, b) => compare(tuple(b), tuple(a))).slice(0, limit);
  }

  async function forward(row, point, limit, end, includeHeader) {
    if (includeHeader && row.purpose === 'board') {
      const h = await header(row, end);
      return h && compare(tuple(h), point) > 0 ? [h] : [];
    }
    const found = await seek(row, point, end), s = state(row);
    let upper = found.beforeSeq ?? s.maxSeq + 1;
    let window = Math.max(limit * 4, 40), items;
    while (true) {
      upper = Math.min(s.maxSeq + 1, upper + window);
      const page = await readPage(row, upper, Math.min(100, limit + 1), end);
      items = page.messages.filter(item => compare(tuple(item), point) > 0 && !dropped(row.id, item));
      if (items.length >= limit || upper >= s.maxSeq + 1) break;
      window *= 2;
    }
    // 如果探针超出所需范围，退回向前扫描至边界，避免跳过紧随游标的消息。
    let scan = await readPage(row, upper, 100, end);
    const seen = new Map(items.map(item => [item.id, item]));
    for (const item of scan.messages) {
      if (compare(tuple(item), point) > 0 && !dropped(row.id, item)) seen.set(item.id, item);
    }
    while (scan.hasMore && (!scan.messages.length || compare(tuple(scan.messages[0]), point) > 0)) {
      scan = await readPage(row, scan.nextBeforeSeq, 100, end);
      for (const item of scan.messages) {
        if (compare(tuple(item), point) > 0 && !dropped(row.id, item)) seen.set(item.id, item);
      }
    }
    items = [...seen.values()];
    if (includeHeader) {
      const h = await header(row, end);
      if (h && compare(tuple(h), point) > 0) items.push(h);
    }
    return items.sort((a, b) => compare(tuple(a), tuple(b))).slice(0, limit);
  }

  async function collect(rows, point, limit, end, direction, includeHeader) {
    if (limit <= 0) return [];
    const parts = await Promise.all(rows.map(row => direction === 'after'
      ? forward(row, point, limit, end, includeHeader) : backward(row, point, limit, end, includeHeader)));
    const items = parts.flat().sort((a, b) => compare(tuple(a), tuple(b)));
    return direction === 'after' ? items.slice(0, limit) : items.slice(-limit);
  }

  async function page(bot, input = {}, session) {
    const opts = options(input), end = deadline();
    const all = await rowsFor(bot);
    if (session !== undefined && (!SESSION.test(session) || !all.some(row => row.id === session))) {
      throw new BffError('NOT_FOUND', '没有这段对话', 404);
    }
    const rows = session ? all.filter(row => row.id === session) : all;
    let focus = opts.around, firstUnread = null;
    if (input.segment) {
      const row = rows.find(item => item.id === input.segment);
      if (!row) throw missing();
      const first = await firstOf(row, end);
      if (first) focus = target(first.id);
    }
    if (opts.unread) {
      const cursors = await positions(end);
      const firsts = await Promise.all(rows.map(async row => (await statistics(row, cursors[row.id], end)).first));
      firstUnread = firsts.filter(Boolean).sort((a, b) => compare(tuple(a), tuple(b)))[0] ?? null;
      if (firstUnread) firstUnread.segment = !session
        && rows.find(row => row.id === firstUnread.session)?.purpose === 'board';
      focus = firstUnread ? target(firstUnread.id) : focus;
    }
    let around, items;
    if (focus) {
      const row = rows.find(row => row.id === focus.session);
      if (!row) throw missing();
      const found = await backward(row, [focus.ts, row.id, focus.seq + 1], 1, end, false);
      if (found[0]?.id !== focus.id) throw missing();
      const card = !session && row.purpose === 'board';
      const center = card ? await header(row, end) : found[0];
      const point = tuple(center);
      const left = await collect(rows, point, Math.floor(opts.limit / 2), end, 'before', !session);
      const right = await collect(rows, point, opts.limit - left.length - 1, end, 'after', !session);
      items = [...left, center, ...right];
      around = { id: focus.id, session: row.id, segment: card };
    } else {
      const point = opts.before ?? opts.after;
      items = await collect(rows, point, opts.limit, end, opts.after ? 'after' : 'before', !session);
    }
    const earlier = items.length
      ? await collect(rows, tuple(items[0]), 1, end, 'before', !session) : [];
    const later = items.length
      ? await collect(rows, tuple(items.at(-1)), 1, end, 'after', !session) : [];
    const cards = items.filter(item => item.kind === 'segment' && item.purpose === 'board');
    if (cards.length) {
      const cursors = await positions(end);
      for (const card of cards) {
        const row = rows.find(item => item.id === card.session);
        card.unread = (await statistics(row, cursors[row.id], end)).count;
      }
    }
    return { items, nextBefore: earlier.length ? encode(tuple(items[0])) : null,
      nextAfter: later.length ? encode(tuple(items.at(-1))) : null, firstUnread, ...(around ? { around } : {}) };
  }

  async function search(bot, input = {}) {
    const { limit } = options({ limit: input.limit });
    if (typeof input.q !== 'string' || !input.q.trim() || input.q.length > 200
      || /[\u0000-\u001f\u007f]/u.test(input.q)) throw invalid('搜索内容应为 1 到 200 字');
    const rows = await rowsFor(bot), end = deadline(searchMs), items = [];
    let scanned = 0, truncated = false;
    try {
      for (const row of [...rows].sort((a, b) => b.updatedAt - a.updatedAt)) {
        let beforeSeq, page;
        do {
          page = await readPage(row, beforeSeq, 100, end);
          for (const message of [...page.messages].reverse()) {
            if (dropped(row.id, message)) continue;
            scanned++;
            const at = message.text?.indexOf(input.q.trim()) ?? -1;
            if (at >= 0) items.push({ ...locator(message),
              snippet: message.text.slice(Math.max(0, at - 50), at + input.q.trim().length + 80) });
            if (items.length >= limit || scanned >= 20000) { truncated = true; break; }
          }
          beforeSeq = page.nextBeforeSeq;
        } while (page.hasMore && !truncated);
        if (truncated) break;
      }
    } catch (error) {
      if (error.code !== 'TIMEOUT') throw error;
      truncated = true;
    }
    return { items: items.sort((a, b) => compare(tuple(b), tuple(a))), truncated };
  }

  return { list, current, page, search };
}
