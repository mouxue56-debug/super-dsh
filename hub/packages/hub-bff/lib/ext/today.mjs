import { buildToday } from '../today.mjs';
import { buildRecent } from '../recent.mjs';
import { routineServiceFor } from '../routines.mjs';

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function validDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return false;
  const ms = Date.parse(text + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

// 「今天」扩展：挂在密钥校验之后，只读，只认 /today 开头的路径。
export function createHandler(deps = {}) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname.replace(/\/+$/u, '');
    if (pathname !== '/today' && pathname !== '/today/recent') return false;
    if (req.method !== 'GET') {
      send(res, 405, { error: 'Method not allowed' });
      return true;
    }
    // 「刚刚发生的」最近 20 条，从已答过的确认卡和看板流水里算，只读。
    if (pathname === '/today/recent') {
      try {
        send(res, 200, await buildRecent(deps, { limit: 20 }));
      } catch {
        send(res, 500, { error: 'Internal error' });
      }
      return true;
    }
    const date = url.searchParams.get('date') ?? undefined;
    if (date !== undefined && !validDate(date)) {
      send(res, 400, { error: 'Invalid request' });
      return true;
    }
    try {
      send(res, 200, await buildToday(deps, { date, routines: routineServiceFor(deps) }));
    } catch {
      send(res, 500, { error: 'Internal error' });
    }
    return true;
  };
}
