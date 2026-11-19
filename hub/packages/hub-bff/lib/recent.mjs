// 「刚刚发生的」：今天页里最近发生的事，全部从后端已有的真记录算出来，不编。
// 来源只有两类：1) 已经答过的确认卡（卡库里的 status 和 resolvedAt）；2) 看板工单自己的流水（history）。
// 哪一类读不到就不给哪一类，并在 sources 里说明；两类都读不到时 items 为空，由界面如实说没有。
const CARD_LABEL = { approved: '已批准', denied: '已拒绝', rejected: '已拒绝', revised: '让它改了',
  timeout: '没等到你点头', answered: '你答了' };
// 工单流水里认的动作 → 人话。其余（认领、进展、改字段等）不算「发生了什么」，不列。
const TICKET_LABEL = { owner_assign: '你交办了', handoff: '你交办了', submitted: '交回了', reported: '交回了',
  accepted: '已验收', sent_back: '被退回', blocked: '卡住了', failed: '做不了' };

const clip = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim() : '';
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') + '…' : text;
};
const stamp = value => { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null; };
const nameOf = (roster, id) => roster.find(bot => bot?.id === id)?.name ?? '';

export function cardEvents(cards, roster) {
  const out = [];
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || typeof c.id !== 'string' || c.status === 'pending') continue;
    const state = CARD_LABEL[c.status];
    const at = stamp(c.resolvedAt ?? c.updatedAt);
    if (!state || at === null) continue;
    const bot = typeof c.bot === 'string' ? c.bot : '';
    out.push({ kind: 'card', id: c.id, bot, name: nameOf(roster, bot),
      title: clip(c.action ?? c.title ?? c.summary, 60) || '一次确认', state, at });
  }
  return out;
}

export function ticketEvents(tickets, roster) {
  const out = [];
  for (const t of Array.isArray(tickets) ? tickets : []) {
    if (!t || typeof t.id !== 'string' || !Array.isArray(t.history)) continue;
    const title = clip(t.title, 60) || '一张卡';
    const worker = typeof t.claimedBy === 'string' ? t.claimedBy : (Array.isArray(t.to) ? t.to[0] : '') ?? '';
    for (const h of t.history) {
      const state = TICKET_LABEL[h?.action];
      const at = stamp(h?.ts);
      if (!state || at === null) continue;
      // 交办给谁看工单的接单人；交回、卡住、做不了是那位接单人自己的事。
      const bot = typeof worker === 'string' && roster.some(b => b?.id === worker) ? worker : '';
      out.push({ kind: 'ticket', id: t.id, bot, name: nameOf(roster, bot), title, state, at });
    }
  }
  return out;
}

export async function buildRecent(deps = {}, { limit = 20 } = {}) {
  let roster = [];
  try {
    const value = typeof deps.roster?.list === 'function' ? await deps.roster.list() : deps.roster;
    roster = Array.isArray(value) ? value : [];
  } catch { roster = []; }
  const sources = { cards: false, tickets: false };
  let events = [];
  try {
    if (typeof deps.cards?.recent === 'function') {
      events = events.concat(cardEvents(await deps.cards.recent(), roster));
      sources.cards = true;
    }
  } catch { sources.cards = false; }
  try {
    if (typeof deps.board?.list === 'function') {
      events = events.concat(ticketEvents(await deps.board.list(), roster));
      sources.tickets = true;
    }
  } catch { sources.tickets = false; }
  // 同一张单同一种动作连着记了两条（例如交回后又补报）只算一条。
  events.sort((a, b) => b.at - a.at);
  const seen = new Set();
  const items = [];
  for (const e of events) {
    const key = e.kind + '|' + e.id + '|' + e.state;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ...e, at: new Date(e.at).toISOString() });
    if (items.length >= limit) break;
  }
  return { items, sources };
}
