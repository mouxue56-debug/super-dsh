// 首页六格的状态。只读 config/bot-status.json 和看板，不新造一套状态。
// 没有把握的来源就空着，不编一句。
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { BOT_ID } from '../roster.mjs';

export const LINE_MAX = 12;
// 验收完成后再挂「刚做完」的时间。任务书没写窗口，取 12 小时，免得旧单一直挂着。
export const FRESH_MS = 12 * 60 * 60 * 1000;
const STUCK = new Set(['blocked', 'failed', 'waiting-timeout', 'uncertain']);
const RANK = { waiting: 5, stuck: 4, working: 3, done: 2, thinking: 1 };
const STATUS_CAP = 1_000_000;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function plain(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

// 标题里的套话和标签。方括号成对去掉；拉丁字母开头、紧挨「原话转达」的是称呼，不写进句子。
function informative(title) {
  let text = plain(title);
  let prev = '';
  while (text !== prev) {
    prev = text;
    text = text.replace(/^[\[【〔][^\]】〕]{0,40}[\]】〕]\s*/u, '');
  }
  text = text.replace(/^[A-Za-z][A-Za-z0-9_-]{0,40}\s*(?=原话转达)/u, '');
  text = text.replace(/^原话转达\s*[：:]?\s*/u, '');
  return text.trim();
}

function withPrefix(prefix, title, fallback) {
  const body = informative(title);
  // 无可靠分词时只接受完整的短标题，不截断，也不复述可能包含隐私的内容。
  if (!body || Array.from(prefix + body).length > LINE_MAX) return fallback;
  if (/[\/~@\\]|[A-Za-z0-9._%+-]{16,}|[A-Za-z]:|https?:|www\./iu.test(body)) return fallback;
  if (/[A-Za-z]/u.test(body) || /主人|你|您的|自己/u.test(body)) return fallback;
  if (/^[在的了和与及把被将为给向从至于]|[在的了和与及把被将为给向从至于]$/u.test(body)) return fallback;
  if (/[。！？，、；：!?,.;:]/u.test(body) || prefix.endsWith(body[0])) return fallback;
  return prefix + body;
}

function sentence(item) {
  // 接力里正在做的那一棒、卡住的那一棒，句子写明第几棒（只用数字，不复述卡里的任何文字）。
  if (item.relay && item.state === 'working') return `接力第${item.relay.index}棒/共${item.relay.total}棒`;
  if (item.relay && item.state === 'stuck') return `接力卡在第${item.relay.index}棒`;
  if (item.state === 'waiting') return '等你点头';
  if (item.state === 'thinking') return '在想';
  if (item.state === 'stuck') return withPrefix('卡在', item.title, '卡住了');
  if (item.state === 'done') return withPrefix('做完', item.title, '刚做完');
  if (item.state === 'working') return withPrefix('在', item.title, '在干活');
  return '';
}

function stamp(value) {
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : 0;
}

function keepId(id, allowed) {
  if (typeof id !== 'string' || !BOT_ID.test(id)) return '';
  if (allowed && !allowed.has(id)) return '';
  return id;
}

function claimId(ticket, allowed, resolve) {
  const raw = ticket?.claimedBy;
  if (typeof raw !== 'string' || !raw) return '';
  const direct = keepId(raw, allowed);
  if (direct) return direct;
  if (typeof resolve !== 'function') return '';
  try {
    return keepId(resolve(raw), allowed);
  } catch {
    return '';
  }
}

// 只认已经领走的单。名单里有名字但还没人领，不算这位在做。
function ticketSignal(ticket, now) {
  if (!ticket || typeof ticket !== 'object') return null;
  const state = ticket.state;
  const at = stamp(ticket.updatedAt);
  const title = ticket.title;
  const relay = ticket.relay && Array.isArray(ticket.relay.steps) && Number.isSafeInteger(ticket.relay.current)
    ? { index: ticket.relay.current + 1, total: ticket.relay.steps.length, phase: ticket.relay.phase } : null;
  if (relay && relay.phase === 'running' && state === 'progress' && ticket.review !== 'submitted') {
    return { state: 'working', title, at, relay };
  }
  if (relay && relay.phase === 'stuck' && ['waiting-human', 'blocked'].includes(state)) {
    return { state: 'stuck', title, at, relay };
  }
  if (state === 'waiting-human') return { state: 'waiting', title, at };
  if (STUCK.has(state)) return { state: 'stuck', title, at };
  if (state === 'completed') {
    if (!at || at > now || now - at > FRESH_MS) return null;
    return { state: 'done', title, at };
  }
  if (ticket.review === 'submitted') return { state: 'done', title, at };
  if (state === 'progress') return { state: 'working', title, at };
  return null;
}

function pushStatus(signals, row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return;
  if (Number.isSafeInteger(row.pending) && row.pending > 0) {
    signals.push({ state: 'waiting', at: 0 });
  }
  const delegated = row.delegated;
  const queued = delegated && Number.isSafeInteger(delegated.queued) && delegated.queued > 0;
  if (delegated?.running === true || queued) signals.push({ state: 'working', at: 0 });
  if (row.running === true) signals.push({ state: 'thinking', at: 0 });
}

function better(item, win) {
  if (RANK[item.state] !== RANK[win.state]) return RANK[item.state] > RANK[win.state] ? 1 : -1;
  const itemTitle = plain(item.title) ? 1 : 0;
  const winTitle = plain(win.title) ? 1 : 0;
  if (itemTitle !== winTitle) return itemTitle > winTitle ? 1 : -1;
  if ((item.at || 0) !== (win.at || 0)) return (item.at || 0) > (win.at || 0) ? 1 : -1;
  return 0;
}

// status：bot-status.json 里的 bots。tickets 为 null 表示看板这次没读到。
// allowed：名册 id；不传就只认符合名册 id 形状的键。
export function buildPresence({ status, tickets, allowed, resolve, now = Date.now() } = {}) {
  const statusBots = status && typeof status === 'object' && !Array.isArray(status) ? status : {};
  const ids = new Set();
  for (const id of Object.keys(statusBots)) {
    const clean = keepId(id, allowed);
    if (clean) ids.add(clean);
  }
  const byBot = new Map();
  if (Array.isArray(tickets)) {
    for (const ticket of tickets) {
      const id = claimId(ticket, allowed, resolve);
      if (!id) continue;
      ids.add(id);
      const view = ticketSignal(ticket, now);
      if (!view) continue;
      const bag = byBot.get(id) || [];
      bag.push(view);
      byBot.set(id, bag);
    }
  }
  const bots = {};
  for (const id of ids) {
    const signals = [...(byBot.get(id) || [])];
    pushStatus(signals, statusBots[id]);
    const best = signals.reduce((win, item) => (!win || better(item, win) > 0 ? item : win), null);
    if (!best) continue;
    const line = sentence(best);
    if (!line || Array.from(line).length > LINE_MAX) continue;
    bots[id] = { state: best.state, line };
  }
  return { ok: true, bots };
}

async function readStatus(configDir) {
  if (typeof configDir !== 'string' || !configDir || configDir.includes('\0')) return null;
  let fh;
  try {
    fh = await open(join(configDir, 'bot-status.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await fh.stat();
    if (!info.isFile() || info.size > STATUS_CAP) return null;
    const data = JSON.parse(await fh.readFile({ encoding: 'utf8' }));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const bots = data.bots;
    if (!bots || typeof bots !== 'object' || Array.isArray(bots)) return null;
    return bots;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

export function createHandler(deps = {}) {
  return async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return false;
    }
    const pathname = url.pathname.replace(/\/+$/u, '') || '/';
    if (pathname !== '/presence') return false;
    if (deps.isTrusted?.(req) !== true) {
      send(res, 401, { ok: false, error: 'unauthorized' });
      return true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, { ok: false, error: 'method' });
      return true;
    }
    try {
      const status = await readStatus(deps.configDir);
      let tickets = null;
      if (typeof deps.board?.list === 'function') {
        try {
          tickets = await deps.board.list();
          if (!Array.isArray(tickets)) tickets = null;
        } catch {
          deps.logger?.error?.('HUB_PRESENCE_BOARD_UNREADABLE');
          tickets = null;
        }
      }
      let allowed = null;
      try {
        const list = deps.roster?.list?.();
        if (Array.isArray(list)) {
          allowed = new Set(list.map(bot => bot?.id).filter(id => BOT_ID.test(id || '')));
        }
      } catch {
        allowed = null;
      }
      const body = buildPresence({
        status, tickets, allowed, resolve: value => deps.roster?.resolve?.(value), now: Date.now(),
      });
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end();
        return true;
      }
      send(res, 200, body);
    } catch {
      if (!res.headersSent) send(res, 500, { ok: false, error: 'unavailable' });
      else res.end();
    }
    return true;
  };
}
