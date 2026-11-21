// 助理派了本体分身时，往卡片进度记人话。只认内核已经发出的事件。
// tool/call 名 subagent = 派出去（任务文字当资料，只取前 30 字）。
// tool/result 只说明「启动了」，不算交回。
// 交回只认父会话上的 user/message，且 source.kind 为 subagent-settled。
// 对不上唯一一张卡就不写，不猜。
import fs from 'node:fs';
import { flat } from './relay-model.mjs';
import { ID_PATTERN } from './ticket.mjs';

const CALL_ID = /^[^\p{Cc}\p{Zl}\p{Zp}]{1,80}$/u;
const SKIP = new Set(['FORBIDDEN', 'CONFLICT', 'NOT_FOUND', 'INVALID']);

export function spawnTask(args) {
  const bag = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const prompt = typeof bag.prompt === 'string' ? bag.prompt : '';
  const description = typeof bag.description === 'string' ? bag.description : '';
  const raw = prompt.trim() ? prompt : description;
  return flat(raw, 30) || '（没写要做什么）';
}

export function dispatchLine(name, tasks) {
  const who = flat(name, 32) || '助理';
  const bits = (Array.isArray(tasks) ? tasks : []).map((task) => flat(task, 30) || '（没写要做什么）');
  return `${who}派了 ${bits.length} 个分身：${bits.join('；')}`;
}

export function returnLine(done, total) {
  const left = Number.isSafeInteger(done) && done >= 0 ? done : 0;
  const right = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  return `分身交回 ${left}/${right}`;
}

function argsOf(data) {
  const raw = data?.arguments;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

export function spawnOf(event) {
  if (event?.type !== 'tool/call') return null;
  const data = event.data ?? {};
  if (data.name !== 'subagent' || !CALL_ID.test(data.callId ?? '')) return null;
  return { callId: data.callId, task: spawnTask(argsOf(data)) };
}

// 父会话收到的结算通知。子会话自己的工具结果不算。
export function settlementId(event) {
  if (event?.type !== 'user/message') return '';
  const data = event.data ?? {};
  const source = data.source ?? data.message?.source;
  if (source?.kind !== 'subagent-settled') return '';
  return CALL_ID.test(source.senderSessionId ?? '') ? source.senderSessionId : '';
}

export function readRelaySessions(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sessions = value?.sessions;
    if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) return {};
    return Object.fromEntries(Object.entries(sessions).filter(([, id]) => typeof id === 'string'));
  } catch {
    return {};
  }
}

// 会话对上哪张卡、哪一棒。对不上就返回 null。
export function ticketForSession({ sessionId, bot, purpose, tickets = [], relaySessions = {} } = {}) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const relayHits = [];
  for (const [key, id] of Object.entries(relaySessions)) {
    if (id !== sessionId) continue;
    const ticketId = String(key).split('>')[0];
    if (!ID_PATTERN.test(ticketId)) continue;
    const aside = String(key).match(/>aside#(\d+)#/u);
    const index = aside ? Number(aside[1]) : null;
    relayHits.push({ id: ticketId, index: Number.isSafeInteger(index) ? index : null });
  }
  if (relayHits.length > 1) return null;
  if (relayHits.length === 1) return relayHits[0];
  const direct = tickets.filter((ticket) => ticket?.sessions?.from === sessionId || ticket?.sessions?.to === sessionId);
  if (direct.length > 1) return null;
  if (direct.length === 1) return { id: direct[0].id, index: null };
  if (purpose !== 'board' || typeof bot !== 'string' || !bot) return null;
  const mine = tickets.filter((ticket) => ticket?.state === 'progress' && ticket.claimedBy === bot &&
    (ticket.claimedByType == null || ticket.claimedByType === 'assistant'));
  if (mine.length === 1) return { id: mine[0].id, index: null };
  return null;
}

function stepIndex(ticket, hit, bot) {
  const relay = ticket?.relay;
  if (!relay || !Array.isArray(relay.steps)) return null;
  if (Number.isInteger(hit?.index) && relay.steps[hit.index]?.who?.name === bot) return hit.index;
  if (relay.phase === 'running' && relay.steps[relay.current]?.who?.name === bot) return relay.current;
  return null;
}

function storedIds(value) {
  return Array.isArray(value) ? value.filter((id) => CALL_ID.test(id ?? '')).slice(0, 32) : [];
}

export function createSubagentNotes({
  board, sessionOf = () => null, nameOf = (bot) => bot, tickets = async () => [],
  relaySessions = () => ({}), logger = { error() {} },
} = {}) {
  const buffers = new Map();
  const backs = new Map();
  const tails = new Map();
  const enqueue = (sessionId, job) => {
    const prev = tails.get(sessionId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(job);
    tails.set(sessionId, next);
    next.catch((error) => {
      try { logger.error('分身进度没记上：' + (error?.message ?? error)); } catch { /* 日志失败也不打断跟随 */ }
    });
    return next;
  };
  const absorb = (sessionId, event) => {
    const spawn = spawnOf(event);
    if (spawn) {
      const batch = buffers.get(sessionId) ?? [];
      if (!batch.some((item) => item.callId === spawn.callId)) batch.push(spawn);
      buffers.set(sessionId, batch);
      return;
    }
    const back = settlementId(event);
    if (!back) return;
    const list = backs.get(sessionId) ?? [];
    if (!list.includes(back)) list.push(back);
    backs.set(sessionId, list);
  };
  const apply = async (sessionId, batch, returned) => {
    const row = sessionOf(sessionId);
    if (!row?.bot) return;
    const all = await tickets();
    const hit = ticketForSession({
      sessionId, bot: row.bot, purpose: row.purpose, tickets: all, relaySessions: relaySessions(),
    });
    if (!hit) return;
    const ticket = all.find((item) => item.id === hit.id) ?? null;
    if (!ticket) return;
    const index = stepIndex(ticket, hit, row.bot);
    if (ticket.relay && index == null) return;
    const step = Number.isInteger(index) ? ticket.relay.steps[index] : null;
    const prior = step ?? (ticket.cloneTrack && typeof ticket.cloneTrack === 'object' ? ticket.cloneTrack : {});
    const seenCalls = storedIds(prior.cloneCalls ?? prior.calls);
    const seenBacks = storedIds(prior.cloneBack ?? prior.backs);
    const accepted = [];
    for (const item of batch) {
      if (seenCalls.includes(item.callId) || accepted.some((one) => one.callId === item.callId)) continue;
      if (seenCalls.length + accepted.length >= 32) break;
      accepted.push(item);
    }
    const total = seenCalls.length + accepted.length;
    const newBacks = [];
    for (const id of returned) {
      if (seenBacks.includes(id) || newBacks.includes(id)) continue;
      if (total <= 0 || seenBacks.length + newBacks.length >= 32) break;
      newBacks.push(id);
    }
    if (!accepted.length && !newBacks.length) return;
    const lines = [];
    if (accepted.length) lines.push(dispatchLine(nameOf(row.bot), accepted.map((item) => item.task)));
    let done = seenBacks.length;
    for (const id of newBacks) {
      done += 1;
      lines.push(returnLine(done, total));
    }
    try {
      await board.noteClone({ name: row.bot, type: 'assistant' }, hit.id, {
        lines, index, callIds: accepted.map((item) => item.callId), backIds: newBacks,
      });
    } catch (error) {
      if (SKIP.has(error?.code)) return;
      throw error;
    }
  };
  const flush = async (sessionId) => {
    const batch = buffers.get(sessionId) ?? [];
    const returned = backs.get(sessionId) ?? [];
    buffers.set(sessionId, []);
    backs.set(sessionId, []);
    if (!batch.length && !returned.length) return;
    await apply(sessionId, batch, returned);
  };
  return {
    observe(sessionId, event) {
      return enqueue(sessionId, async () => {
        const spawn = spawnOf(event);
        absorb(sessionId, event);
        if (!spawn) await flush(sessionId);
      });
    },
    observeSnapshot(sessionId, records) {
      return enqueue(sessionId, async () => {
        for (const record of records ?? []) absorb(sessionId, record?.event ?? record);
        await flush(sessionId);
      });
    },
    end(sessionId) {
      return enqueue(sessionId, () => flush(sessionId));
    },
  };
}
