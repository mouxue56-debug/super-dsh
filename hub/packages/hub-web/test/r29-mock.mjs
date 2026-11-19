// 假后端：只听 127.0.0.1:3615。mode 为 ok / fail / missing。
import http from 'node:http';

export function startR29Mock(port = 3615) {
  const state = { mode: 'ok', seen: [] };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    state.seen.push({
      method: req.method, path: url.pathname, search: url.search,
      headers: req.headers, body
    });
    const fail = state.mode === 'fail';
    let status = 200;
    let payload = { ok: true };
    const path = url.pathname;
    if (state.mode === 'missing') {
      status = 404;
      payload = { ok: false };
    } else if (path === '/unread/' && req.method === 'GET') {
      if (fail) status = 500;
      else payload = { ok: true, conversations: { c1: 2 }, bots: { b1: 2 }, groups: { g1: 1 } };
    } else if (path === '/unread/read' && req.method === 'POST') {
      payload = fail ? { ok: false, error: 'rejected' } : { ok: true };
    } else if (path === '/voice/' && req.method === 'POST') {
      payload = fail
        ? { ok: false, error: 'asr-unavailable', id: 'v9' }
        : { ok: true, id: 'v1', text: '你好', durationMs: 800, audioUrl: '' };
    } else if (path === '/uploads/' && req.method === 'POST') {
      payload = fail
        ? { ok: false, error: 'rejected' }
        : { ok: true, id: 'u1', name: 'note.txt', size: body.length,
          mime: 'text/plain', path: '/box/note.txt' };
    } else if (path === '/settings/' && req.method === 'GET') {
      if (fail) status = 500;
      else payload = { ok: true, permission: { mode: 'ask' },
        bots: { b1: { model: 'm', effort: 'low' } }, models: ['m'] };
    } else if (path === '/settings/permission' && req.method === 'PUT') {
      payload = fail ? { ok: false, error: 'rejected' } : { ok: true };
    } else if (path.startsWith('/settings/bots/') && req.method === 'PUT') {
      payload = fail ? { ok: false, error: 'rejected' } : { ok: true };
    } else {
      status = 404;
      payload = { ok: false };
    }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      state,
      async close() {
        await new Promise(done => server.close(done));
        server.closeAllConnections?.();
      }
    }));
  });
}
