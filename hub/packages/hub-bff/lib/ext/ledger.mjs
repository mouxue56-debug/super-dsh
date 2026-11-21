import { createLedgerHandlers } from '../ledger-http.mjs';
import { createNativePriceBook } from '../prices.mjs';
import { readNativeLedger } from '../native-ledger.mjs';
import { readPluginLedger, resolvePluginSource } from '../plugin-ledger.mjs';

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

// 账本扩展：提供汇总、当日和会话的只读接口。
export function createHandler(deps) {
  const pluginSource = resolvePluginSource(deps.hubConfig);
  const handlers = deps.ledger && createLedgerHandlers({
    ledger: deps.ledger,
    priceBook: deps.priceBook ?? createNativePriceBook(),
    now: deps.now ?? Date.now,
    utcOffsetMinutes: deps.utcOffsetMinutes ?? 0,
    resolveBot: value => deps.roster?.resolve?.(value) ?? value,
    readNative: () => readNativeLedger(deps.hubConfig?.nativeLedger),
    readPlugins: () => readPluginLedger(pluginSource, {
      now: deps.now ? deps.now() : Date.now(),
      utcOffsetMinutes: deps.utcOffsetMinutes ?? 0,
    }),
    // 逐次明细里「哪段会话」用会话清单里的标题；清单里没有就留空。
    sessionTitle: id => (typeof id === 'string' && typeof deps.sessions?.list === 'function'
      ? deps.sessions.list({ all: true }).find(row => row.id === id)?.title : '') ?? '',
  });
  return async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    if (pathname !== '/ledger' && !pathname.startsWith('/ledger/')) return false;
    if (!handlers) {
      send(response, 503, { error: { code: 'UNAVAILABLE', message: '账本未启用' } });
      return true;
    }
    if (pathname !== '/ledger' && pathname !== '/ledger/today' &&
        !/^\/ledger\/session\/[^/]+$/u.test(pathname)) {
      send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      return true;
    }
    const rewritten = '/api' + pathname + url.search;
    return handlers.handle({ method: request.method, url: rewritten, headers: request.headers }, response);
  };
}
