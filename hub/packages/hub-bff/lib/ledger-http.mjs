import { summarize } from './ledger-summary.mjs';
const validDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// 创建账本 HTTP 处理器。
export function createLedgerHandlers(
  { ledger, priceBook, now = () => Date.now(), utcOffsetMinutes = 0, resolveBot, sessionTitle, readNative,
    readPlugins },
) {
  const summarizeRows = (rows, time) => summarize(rows, { priceBook, nowMs: time, utcOffsetMinutes });
  const bad = (error) => ({ status: 400, body: { error } });

  async function ledgerPage({ from, to } = {}) {
    if ((from != null && !validDate(from)) || (to != null && !validDate(to)) || (from && to && from > to)) {
      return bad('invalid date range');
    }
    const time = now();
    const [rows, native, plugins] = await Promise.all([
      ledger.readRows({ from, to }),
      Promise.resolve().then(() => readNative?.()).catch(() => ({
        ok: false, reason: '本体账本读取失败',
      })),
      Promise.resolve().then(() => readPlugins?.()).catch(() => ({
        ok: false, reason: '插件账本读取失败',
      })),
    ]);
    const body = { ...summarizeRows(rows, time), recent: recentCalls(rows, time) };
    if (native !== undefined) body.native = native;
    if (plugins !== undefined) body.plugins = plugins;
    const fromPlugins = plugins?.ok === true;
    body.pricing = {
      source: fromPlugins ? 'plugins' : 'prices',
      label: fromPlugins ? `来自 ${plugins.source}` : '按价目估算',
    };
    return { status: 200, body };
  }

  // 逐次明细。每次模型调用一行：哪位助理、哪段会话、什么时候、用量、价格；最近 60 次。
  // 每行的 bucket 只汇总这一次调用，沿用整页的价格和用量口径。
  const RECENT_MAX = 60;
  function recentCalls(rows, time) {
    return rows.filter((r) => r.kind === 'call' && Number.isFinite(r.tsMs))
      .sort((a, b) => b.tsMs - a.tsMs).slice(0, RECENT_MAX).map((r) => {
        let title = '';
        try {
          title = typeof sessionTitle === 'function' ? String(sessionTitle(r.sessionId) ?? '') : '';
        } catch { title = ''; }
        return {
          ts: new Date(r.tsMs).toISOString(), bot: r.bot ?? '', sessionId: r.sessionId ?? null,
          title: title.slice(0, 80), ticket: r.ticket ?? null, model: typeof r.model === 'string' ? r.model : null,
          bucket: summarizeRows([r], time).total,
        };
      });
  }

  async function sessionUsage(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return bad('invalid sessionId');
    const time = now();
    const rows = await ledger.readRows({});
    return { status: 200, body: summarizeRows(rows.filter((r) => r.sessionId === sessionId), time).total };
  }

  async function today({ bot } = {}) {
    if (bot !== undefined && (typeof bot !== 'string' || !bot.trim())) return bad('invalid bot');
    const time = now(), day = new Date(time + utcOffsetMinutes * 60000).toISOString().slice(0, 10);
    const chosen = bot !== undefined && resolveBot ? await resolveBot(bot) : bot;
    const rows = await ledger.readRows({ from: day, to: day });
    const selected = rows.filter((r) =>
      new Date(r.tsMs + utcOffsetMinutes * 60000).toISOString().slice(0, 10) === day &&
      (bot === undefined || r.bot === chosen)
    );
    const s = summarizeRows(selected, time);
    return { status: 200, body: { total: s.total, byBot: s.byBot, counts: s.counts } };
  }

  function route(method, urlString) {
    let url;
    try {
      url = new URL(urlString, 'http://base.invalid');
    } catch {
      return null;
    }
    const p = url.pathname;
    let handler, args;
    if (p === '/api/ledger') {
      handler = ledgerPage;
      args = { from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined };
    } else if (p === '/api/ledger/today') {
      handler = today;
      args = { bot: url.searchParams.has('bot') ? url.searchParams.get('bot') : undefined };
    } else if (/^\/api\/ledger\/session\/[^/]+$/.test(p)) {
      handler = sessionUsage;
      try {
        args = decodeURIComponent(p.slice('/api/ledger/session/'.length));
      } catch {
        return { status: 400, body: { error: 'invalid sessionId' } };
      }
    } else return null;
    return method === 'GET' ? { handler, args } : { status: 405, body: { error: 'method not allowed' } };
  }

  async function handle(req, res) {
    const match = route(req.method, req.url);
    if (!match) return false;
    let response;
    try {
      response = match.handler ? await match.handler(match.args) : match;
    } catch {
      response = { status: 500, body: { error: 'ledger request failed' } };
    }
    res.writeHead(response.status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(response.body));
    return true;
  }
  return { ledgerPage, sessionUsage, today, route, handle };
}
