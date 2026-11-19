import { computeCost } from './prices.mjs';
const fields = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'];
const round = (n) => Math.round(n * 1e6) / 1e6;
const dateKey = (ms, offset) => new Date(ms + offset * 60000).toISOString().slice(0, 10);
const bucket = () => ({
  calls: 0,
  tokens: Object.fromEntries(fields.map((k) => [k, 0])),
  unreportedFields: Object.fromEntries(fields.map((k) => [k, 0])),
  cost: { byCurrency: {}, pendingCalls: 0, expiredCalls: 0, planCalls: 0, planReference: {}, localCalls: 0 },
});
const entry = (obj, key, create) => {
  if (!Object.hasOwn(obj, key)) {
    Object.defineProperty(obj, key, {
      value: create(),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return obj[key];
};
function addCall(b, r, book, now) {
  b.calls++;
  for (const k of fields) {
    const n = r.tokens?.[k];
    if (n == null) b.unreportedFields[k]++;
    else b.tokens[k] += n;
  }
  const c = computeCost(r, book, now), cost = b.cost;
  if (c.status === 'pending') cost.pendingCalls++;
  if (c.status === 'expired') cost.expiredCalls++;
  if (c.status === 'plan') cost.planCalls++;
  if (c.status === 'local') cost.localCalls++;
  if (c.status === 'ok' || c.status === 'expired') {
    const currency = entry(cost.byCurrency, c.currency, () => ({ ok: 0, expired: 0 }));
    currency[c.status] = round(currency[c.status] + c.amount);
  }
  if (c.status === 'plan' && c.reference !== null) {
    const previous = entry(cost.planReference, c.referenceCurrency, () => 0);
    Object.defineProperty(cost.planReference, c.referenceCurrency, {
      value: round(previous + c.reference),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

// 汇总账本记录。
export function summarize(rows, { priceBook, nowMs = Date.now(), groupBy, utcOffsetMinutes = 0 } = {}) {
  const total = bucket(), byBot = {}, byDay = {}, bySession = {}, byTicket = {};
  const counts = { approvals: 0, actions: 0, changes: 0, dispatches: 0, dispatchWallMs: null };
  for (const r of rows) {
    if (r.kind !== 'call') {
      const k =
        { approval: 'approvals', action: 'actions', change: 'changes', dispatch: 'dispatches' }[r.kind];
      if (k) counts[k]++;
      if (r.kind === 'dispatch' && r.wallMs != null) {
        counts.dispatchWallMs = (counts.dispatchWallMs ?? 0) + r.wallMs;
      }
      continue;
    }
    for (
      const b of [
        total,
        entry(byBot, r.bot ?? '(无助理)', bucket),
        entry(byDay, dateKey(r.tsMs, utcOffsetMinutes), bucket),
        entry(bySession, r.sessionId ?? '(无会话)', bucket),
        entry(byTicket, r.ticket ?? '(无工单)', bucket),
      ]
    ) addCall(b, r, priceBook, nowMs);
  }
  const today = dateKey(nowMs, utcOffsetMinutes), end = Date.parse(`${today}T00:00:00Z`), days = [];
  const sevenTotal = bucket();
  for (let i = 6; i >= 0; i--) {
    const date = dateKey(end - i * 86400000, 0);
    const day = byDay[date] ?? bucket();
    days.push({ date, ...day });
  }
  const start = end - 6 * 86400000;
  for (const r of rows) {
    if (r.kind === 'call') {
      const day = Date.parse(`${dateKey(r.tsMs, utcOffsetMinutes)}T00:00:00Z`);
      if (day >= start && day <= end) addCall(sevenTotal, r, priceBook, nowMs);
    }
  }
  return { total, byBot, byDay, bySession, byTicket, last7Days: { days, total: sevenTotal }, counts };
}
