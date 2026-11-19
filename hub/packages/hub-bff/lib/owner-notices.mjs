// 主人只收三种站内话：晨间一句、验收有据的一句、确需主人回答的一句。
// 句子由模板拼出，不调用模型，不发推送、邮件或消息。
// 尺度全部暂定，可被安装配置 notices 段覆盖。
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from './board-lock.mjs';
import { depsStopped } from './panic-marker.mjs';
import { offsetFor } from './meetings-sources.mjs';

export const NOTICE_DEFAULTS = Object.freeze({
  quietStartMin: 22 * 60,
  quietEndMin: 8 * 60,
  morningMin: 8 * 60 + 30,
  morningEndMin: 12 * 60,
  dayCap: 2,
  mergeMs: 30 * 60 * 1000,
  checkMs: 5 * 60 * 1000,
  itemMaxChars: 80,
});

const CONV = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DAY_KEEP = 14;
const SEEN_KEEP = 500;

function intIn(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

// 坏值退回暂定默认，不把尺度放大。
export function resolveNoticeConfig(section) {
  const src = section && typeof section === 'object' && !Array.isArray(section) ? section : {};
  const base = NOTICE_DEFAULTS;
  return {
    quietStartMin: intIn(src.quietStartMin, base.quietStartMin, 0, 24 * 60),
    quietEndMin: intIn(src.quietEndMin, base.quietEndMin, 0, 24 * 60),
    morningMin: intIn(src.morningMin, base.morningMin, 0, 24 * 60),
    morningEndMin: intIn(src.morningEndMin, base.morningEndMin, 0, 24 * 60),
    dayCap: intIn(src.dayCap, base.dayCap, 0, 2),
    mergeMs: intIn(src.mergeMs, base.mergeMs, 60 * 1000, 60 * 60 * 1000),
    checkMs: intIn(src.checkMs, base.checkMs, 60 * 1000, 60 * 60 * 1000),
    itemMaxChars: intIn(src.itemMaxChars, base.itemMaxChars, 20, 120),
  };
}

export function blankState() {
  return { version: 1, booted: false, lastCheckAt: null, active: null, seen: {}, days: {} };
}

function clip(value, max) {
  const text = typeof value === 'string'
    ? value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim() : '';
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') + '…' : text;
}

function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function localParts(ms, offsetMinutes) {
  const shifted = new Date(ms + offsetMinutes * 60000);
  if (!Number.isFinite(shifted.getTime())) return null;
  return {
    day: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function startOfLocalDay(ms, offset) {
  const parts = localParts(ms, offset);
  if (!parts) return ms;
  return Date.parse(parts.day + 'T00:00:00.000Z') - offset * 60000;
}

function knownAssistant(roster, id) {
  return typeof id === 'string' && roster.some(bot =>
    bot && bot.id === id && bot.status !== 'disabled');
}

function chiefId(roster) {
  const chief = roster.find(bot => bot && bot.role === 'chief' && bot.status !== 'disabled');
  return chief?.id ?? null;
}

// 原接话的助理：先看来源，再看接手，对不上名册就空着。
function speakerOf(ticket, roster) {
  if (ticket.from?.type === 'assistant' && knownAssistant(roster, ticket.from.name)) {
    return ticket.from.name;
  }
  if (knownAssistant(roster, ticket.claimedBy)) return ticket.claimedBy;
  if (Array.isArray(ticket.to)) {
    const hit = ticket.to.find(id => knownAssistant(roster, id));
    if (hit) return hit;
  }
  return null;
}

function entryOf(ticket) {
  const from = ticket.sessions?.from;
  const to = ticket.sessions?.to;
  if (typeof from === 'string' && CONV.test(from)) return { type: 'conversation', id: from };
  if (typeof to === 'string' && CONV.test(to)) return { type: 'conversation', id: to };
  return { type: 'ticket', id: ticket.id };
}

function acceptMs(ticket) {
  const row = [...(ticket.history ?? [])].reverse().find(item => item?.action === 'accepted');
  const ms = Date.parse(row?.ts ?? ticket.updatedAt ?? '');
  return Number.isFinite(ms) ? ms : 0;
}

function isResult(ticket) {
  if (!ticket || ticket.state !== 'completed' || ticket.review !== 'accepted') return false;
  return (ticket.verification ?? []).some(item => item && item.verdict === 'pass');
}

function askText(ticket) {
  if (!ticket || ticket.state !== 'waiting-human') return '';
  // 首席建议（等你点头）有今天页和卡上的三个操作，不当成「等你回答」在对话里念。
  if (ticket.arrange?.state === 'proposed') return '';
  return clip(ticket.open_ask?.text, 500);
}

function sessionLink(ticket) {
  const from = ticket?.sessions?.from;
  const to = ticket?.sessions?.to;
  if (typeof from === 'string' && CONV.test(from)) return from;
  if (typeof to === 'string' && CONV.test(to)) return to;
  return '';
}

// 等你回答只认主人发起，或顺着上级工单、会话号能回到那条线。
// 会话号只认工单上格式正确的号。空的、坏的、链路转圈或断了，都不算。
function asksOwner(ticket, byId) {
  const seen = new Set();
  let current = ticket;
  for (let hop = 0; current && hop < 8; hop += 1) {
    const id = typeof current.id === 'string' ? current.id : '';
    if (id) {
      if (seen.has(id)) return false;
      seen.add(id);
    }
    if (current.from?.type === 'owner') return true;
    if (sessionLink(current)) return true;
    const parentId = current.parentId;
    if (typeof parentId !== 'string' || !parentId) return false;
    current = byId.get(parentId);
  }
  return false;
}

function resultKey(ticket) {
  return 'result:' + ticket.id + ':' + new Date(acceptMs(ticket)).toISOString();
}

function askKey(ticket, text) {
  return 'ask:' + ticket.id + ':' + hashText(text);
}

function collect(snap, state) {
  const items = [];
  const byId = new Map();
  for (const ticket of snap.tickets) {
    if (ticket && typeof ticket.id === 'string') byId.set(ticket.id, ticket);
  }
  const dayStart = startOfLocalDay(snap.nowMs, snap.offset) - 86400000;
  for (const ticket of snap.tickets) {
    if (!ticket || typeof ticket.id !== 'string') continue;
    if (isResult(ticket)) {
      const atMs = acceptMs(ticket);
      const key = resultKey(ticket);
      if (state.seen[key]) continue;
      if (!state.booted && atMs < dayStart) continue;
      const sample = clip(ticket.report?.summary || ticket.title, snap.config.itemMaxChars);
      items.push({
        kind: 'result', key, atMs, ticketId: ticket.id, sample,
        speakerId: speakerOf(ticket, snap.roster), entry: entryOf(ticket),
      });
      continue;
    }
    const text = askText(ticket);
    if (!text || !asksOwner(ticket, byId)) continue;
    const key = askKey(ticket, text);
    if (state.seen[key]) continue;
    const atMs = Date.parse(ticket.open_ask?.ts ?? '');
    items.push({
      kind: 'ask', key, atMs: Number.isFinite(atMs) ? atMs : 0, ticketId: ticket.id,
      sample: clip(text, snap.config.itemMaxChars),
      speakerId: speakerOf(ticket, snap.roster), entry: entryOf(ticket),
    });
  }
  return items;
}

function sentence(parts, sayMorning) {
  const asks = parts.filter(item => item.kind === 'ask');
  const results = parts.filter(item => item.kind === 'result');
  const n = results.length;
  const m = asks.length;
  const hello = sayMorning ? '早。' : '';
  if (sayMorning) {
    if (n === 1 && m === 0) {
      const body = results[0].sample
        ? results[0].sample + '，点开就能看。'
        : '有一件结果已经核过，点开就能看。';
      return hello + body;
    }
    if (n > 1 && m === 0) return hello + '有' + n + '件结果已经核过，点开就能看。';
    if (n === 0 && m === 1) return hello + '有一处等你定。';
    if (n === 0 && m > 1) return hello + '有' + m + '处等你定。';
    if (n && m) return hello + '有' + n + '件结果已经核过，还有' + m + '处等你定。';
    return '';
  }
  if (n === 1 && m === 0) {
    return results[0].sample
      ? results[0].sample + '，点开就能看。'
      : '已经核过，点开就能看。';
  }
  if (n === 0 && m === 1) return asks[0].sample || '有一处等你定。';
  if (n === 0 && m > 1) return '有' + m + '处等你定。';
  if (m === 0 && n > 1) return '有' + n + '件结果已经核过，点开就能看。';
  if (n && m) return '有' + n + '件结果已经核过，还有' + m + '处等你定。';
  return '';
}

function cluster(items, lastCheckAt, now, config) {
  if (!items.length) return [];
  const gap = Number.isFinite(lastCheckAt) ? now - lastCheckAt : Infinity;
  if (gap >= config.mergeMs) return items.slice();
  const sorted = items.slice().sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));
  const start = sorted[0].atMs;
  return sorted.filter(item => item.atMs - start <= config.mergeMs);
}

function primary(items) {
  const asks = items.filter(item => item.kind === 'ask');
  const pool = asks.length ? asks : items;
  return pool.slice().sort((a, b) => b.atMs - a.atMs || a.key.localeCompare(b.key))[0];
}

function markSeen(state, items, now, day) {
  for (const item of items) state.seen[item.key] = { at: now, day };
}

function prune(state) {
  const days = Object.keys(state.days).sort();
  for (const day of days.slice(0, Math.max(0, days.length - DAY_KEEP))) delete state.days[day];
  const rows = Object.entries(state.seen);
  if (rows.length <= SEEN_KEEP) return;
  const asks = rows.filter(([key]) => key.startsWith('ask:'));
  const results = rows.filter(([key]) => !key.startsWith('ask:'))
    .sort((a, b) => (a[1]?.at ?? 0) - (b[1]?.at ?? 0));
  let extra = rows.length - SEEN_KEEP;
  for (const [key] of results) {
    if (extra <= 0) break;
    delete state.seen[key];
    extra -= 1;
  }
  if (extra <= 0) return;
  const oldAsks = asks.sort((a, b) => (a[1]?.at ?? 0) - (b[1]?.at ?? 0));
  for (const [key] of oldAsks) {
    if (extra <= 0) break;
    delete state.seen[key];
    extra -= 1;
  }
}

function toPublic(active) {
  if (!active) return null;
  return {
    id: active.id,
    kind: active.kind,
    text: active.text,
    speakerId: active.speakerId,
    ticketId: active.ticketId,
    entry: active.entry,
    at: new Date(active.atMs).toISOString(),
  };
}

function hideBecauseViewing(active, viewing) {
  return !!(active && viewing && active.entry?.type === 'conversation' &&
    active.entry.id === viewing);
}

function remembered(active) {
  const parts = [];
  for (let index = 0; index < (active.resultCount || 0); index += 1) {
    parts.push({ kind: 'result', sample: index === 0 ? (active.oneSample || '') : '', atMs: 0, key: '' });
  }
  for (let index = 0; index < (active.askCount || 0); index += 1) {
    parts.push({ kind: 'ask', sample: index === 0 && !active.resultCount ? (active.oneSample || '') : '',
      atMs: 0, key: '' });
  }
  return parts;
}

// 纯决定。state 会被复制，不改调用方手里的那份。
export function decide(rawState, snap) {
  const state = rawState ? JSON.parse(JSON.stringify(rawState)) : blankState();
  if (!state.seen || typeof state.seen !== 'object') state.seen = {};
  if (!state.days || typeof state.days !== 'object') state.days = {};
  const quietOut = { state, notice: null, quiet: false, stopped: false, wrote: false };
  if (snap.stopped) return { ...quietOut, stopped: true };
  const now = snap.nowMs;
  const here = localParts(now, snap.offset);
  if (!here) return quietOut;
  const config = snap.config;
  const quiet = here.minutes >= config.quietStartMin || here.minutes < config.quietEndMin;
  // 08:00 已出静默，晨句仍等到暂定的 08:30，这半小时不记成已说过。
  const holding = !quiet && here.minutes < config.morningMin;
  const gated = Number.isFinite(state.lastCheckAt) && now >= state.lastCheckAt &&
    now - state.lastCheckAt < config.checkMs;
  if (quiet || holding) {
    if (!state.active && gated) {
      return { state, notice: null, quiet, stopped: false, wrote: false };
    }
    state.lastCheckAt = now;
    state.active = null;
    return { state, notice: null, quiet, stopped: false, wrote: true };
  }
  if (gated) {
    if (hideBecauseViewing(state.active, snap.viewing)) {
      state.active = null;
      state.lastCheckAt = now;
      return { state, notice: null, quiet: false, stopped: false, wrote: true };
    }
    return { state, notice: toPublic(state.active), quiet: false, stopped: false, wrote: false };
  }
  if (state.active && state.active.day !== here.day) state.active = null;
  const items = collect(snap, state);
  const viewed = [];
  const rest = [];
  for (const item of items) {
    if (snap.viewing && item.entry.type === 'conversation' && item.entry.id === snap.viewing) {
      viewed.push(item);
    } else rest.push(item);
  }
  markSeen(state, viewed, now, here.day);
  const day = state.days[here.day] ?? { morning: 0, daytime: 0, morningDecided: false };
  state.days[here.day] = day;
  const last = Number.isFinite(state.lastCheckAt) ? localParts(state.lastCheckAt, snap.offset) : null;
  const slept = !last || last.day < here.day || last.minutes < config.morningMin;
  const inWindow = here.minutes >= config.morningMin && here.minutes < config.morningEndMin;
  const morningTurn = !day.morningDecided && here.minutes >= config.morningMin && (inWindow || slept);
  let chosen = [];
  let kind = 'result';
  let extend = false;
  if (morningTurn) {
    day.morningDecided = true;
    if (rest.length) {
      chosen = rest;
      kind = 'morning';
      day.morning = 1;
    }
  } else if (rest.length && state.active && here.day === state.active.day &&
    now - state.active.atMs <= config.mergeMs) {
    chosen = rest;
    kind = state.active.kind === 'morning' ? 'morning' : (rest.some(item => item.kind === 'ask') ||
      state.active.askCount ? 'ask' : 'result');
    extend = true;
  } else if (rest.length && day.daytime < config.dayCap) {
    chosen = cluster(rest, state.lastCheckAt, now, config);
    kind = chosen.some(item => item.kind === 'ask') ? 'ask' : 'result';
    day.daytime += 1;
  }
  if (chosen.length) {
    markSeen(state, chosen, now, here.day);
    const previous = extend && state.active ? remembered(state.active) : [];
    const parts = previous.concat(chosen);
    const sayMorning = kind === 'morning' && here.minutes < config.morningEndMin;
    const text = sentence(parts, sayMorning);
    const focus = primary(chosen);
    const single = parts.filter(item => item.kind === 'result').length +
      parts.filter(item => item.kind === 'ask').length === 1;
    state.active = {
      id: extend && state.active ? state.active.id : randomBytes(8).toString('hex'),
      kind, text,
      speakerId: kind === 'morning' ? chiefId(snap.roster) : focus.speakerId,
      ticketId: focus.ticketId,
      entry: focus.entry,
      keys: [...(extend && state.active ? state.active.keys : []), ...chosen.map(item => item.key)],
      atMs: extend && state.active ? state.active.atMs : now,
      day: here.day,
      resultCount: parts.filter(item => item.kind === 'result').length,
      askCount: parts.filter(item => item.kind === 'ask').length,
      oneSample: single ? (parts.find(item => item.sample)?.sample || '') : '',
    };
  }
  state.lastCheckAt = now;
  state.booted = true;
  prune(state);
  const notice = hideBecauseViewing(state.active, snap.viewing) ? null : toPublic(state.active);
  if (hideBecauseViewing(state.active, snap.viewing)) state.active = null;
  return { state, notice, quiet: false, stopped: false, wrote: true };
}

function offsetOf(deps, nowMs) {
  const section = deps.hubConfig?.notices;
  if (Number.isInteger(section?.utcOffsetMinutes)) return section.utcOffsetMinutes;
  return offsetFor({
    timezone: deps.hubConfig?.timezone,
    utcOffsetMinutes: deps.hubConfig?.routines?.utcOffsetMinutes ??
      (deps.hubConfig?.timezone ? undefined : deps.utcOffsetMinutes),
  }, nowMs);
}

async function readState(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, state: blankState() };
    return { ok: false };
  }
  try {
    const state = JSON.parse(text);
    if (!state || state.version !== 1 || typeof state !== 'object' || Array.isArray(state)) {
      return { ok: false };
    }
    return { ok: true, state };
  } catch {
    return { ok: false };
  }
}

async function saveState(file, state) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomBytes(6).toString('hex');
  await writeFile(tmp, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  await rename(tmp, file);
}

function safeView(value) {
  return typeof value === 'string' && CONV.test(value) ? value : '';
}

// 读看板和名册，决定现在该不该说一句，并把去重键写进数据目录。
export function createOwnerNotices(deps = {}) {
  const dir = typeof deps.dataDir === 'string' && path.isAbsolute(deps.dataDir)
    ? path.join(deps.dataDir, 'notices') : '';
  const file = dir ? path.join(dir, 'state.json') : '';
  const lock = dir ? path.join(dir, 'state.lock') : '';

  async function current({ viewing = '' } = {}) {
    if (!file) return { ok: false, notice: null, stopped: false, quiet: false };
    if (depsStopped(deps)) return { ok: true, notice: null, stopped: true, quiet: false };
    const nowMs = Number(deps.now?.() ?? Date.now());
    if (!Number.isFinite(nowMs)) return { ok: false, notice: null, stopped: false, quiet: false };
    let tickets;
    try {
      const value = await deps.board?.list?.();
      if (!Array.isArray(value)) return { ok: false, notice: null, stopped: false, quiet: false };
      tickets = value;
    } catch {
      return { ok: false, notice: null, stopped: false, quiet: false };
    }
    let roster = [];
    try {
      const value = typeof deps.roster?.list === 'function' ? await deps.roster.list() : deps.roster;
      roster = Array.isArray(value) ? value : [];
    } catch {
      roster = [];
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return withFileLock(lock, async () => {
      const loaded = await readState(file);
      if (!loaded.ok) return { ok: false, notice: null, stopped: false, quiet: false };
      const outcome = decide(loaded.state, {
        nowMs, offset: offsetOf(deps, nowMs), stopped: false, viewing: safeView(viewing),
        tickets, roster, config: resolveNoticeConfig(deps.hubConfig?.notices),
      });
      if (outcome.wrote) await saveState(file, outcome.state);
      return {
        ok: true, notice: outcome.notice, quiet: outcome.quiet, stopped: false,
      };
    });
  }

  return { current };
}
