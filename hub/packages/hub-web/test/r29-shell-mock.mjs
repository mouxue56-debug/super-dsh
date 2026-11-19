// 集成修的假后端。只听调用方给的 127.0.0.1 端口，测完关掉。
import http from 'node:http';

const IDS = ['aa', 'ab', 'ac', 'ad', 'ae', 'af'];
const NAMES = ['甲', '乙', '丙', '丁', '戊', '己'];

function bots() {
  return {
    ok: true,
    bots: IDS.map((id, index) => ({
      id, name: NAMES[index], status: 'active', role: index === 0 ? 'chief' : 'bot',
      order: index + 1, duty: '待命', avatar: { kind: 'role', role: id }
    }))
  };
}

function card() {
  return {
    id: 'card-1', type: 'approval', bot: 'aa', botName: '甲', sessionId: 's-aa',
    tool: 'bash', command: 'ls', cwd: '/work', why: '查看文件列表', status: 'pending',
    createdAt: new Date().toISOString(), path: 'note.txt', action: '要你点头'
  };
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export function startR29ShellMock(port) {
  const state = {
    seen: [], streams: [], replied: false, lastText: '', permissionPuts: [],
    unread: { conversations: { 'aa-013': 2 }, bots: { aa: 2 }, groups: { g1: 1 } }
  };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    state.seen.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body });
    // 壳对老接口保留 /bff 前缀，扩展接口会先剥掉。两种都认。
    const path = url.pathname.replace(/^\/bff(?=\/)/, '') || '/';
    if (path === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': ok\n\n');
      state.streams.push(res);
      return;
    }
    if (path.endsWith('/stream') && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write('event: delta\ndata: {"text":"假回复"}\n\n');
      res.write('event: message\ndata: {"role":"assistant","id":"m2","seq":2,"text":"假回复"}\n\n');
      res.write('event: done\ndata: {}\n\n');
      res.end();
      return;
    }
    if (path === '/health') return json(res, 200, { ok: true, dsh: { connected: true } });
    if (path === '/status') {
      const rows = {};
      for (const id of IDS) rows[id] = { running: false, pending: id === 'aa' ? 1 : 0, unread: 0 };
      return json(res, 200, { ok: true, pendingTotal: 1, hubHome: '/work', commandGrantDays: 30, bots: rows });
    }
    if (path === '/bots') return json(res, 200, bots());
    if (path === '/sessions' && req.method === 'GET') {
      return json(res, 200, { sessions: [{
        id: 's-aa', bot: 'aa', title: '会话', updatedAt: new Date().toISOString(), unread: 0
      }] });
    }
    if (path === '/sessions' && req.method === 'POST') {
      const asked = JSON.parse(body.toString() || '{}');
      return json(res, 200, { id: 's-new', bot: asked.bot || 'aa' });
    }
    if (path.endsWith('/history')) {
      const messages = state.replied ? [
        { role: 'user', text: state.lastText, id: 'm1', seq: 1, ts: Date.now() },
        { role: 'assistant', text: '假回复', id: 'm2', seq: 2, ts: Date.now() }
      ] : [];
      return json(res, 200, { messages });
    }
    if (path.endsWith('/cards') || path === '/approvals') {
      return json(res, 200, path === '/approvals' ? { approvals: [card()] } : { cards: [card()] });
    }
    if (path.endsWith('/messages') && req.method === 'POST') {
      state.lastText = JSON.parse(body.toString() || '{}').text || '';
      state.replied = true;
      return json(res, 200, { accepted: true, requestId: 'req-1' });
    }
    if (path.endsWith('/read') && path !== '/unread/read') return json(res, 200, { ok: true });
    if (path === '/unread/' && req.method === 'GET') return json(res, 200, { ok: true, ...state.unread });
    if (path === '/unread/read' && req.method === 'POST') {
      state.unread = { conversations: {}, bots: {}, groups: {} };
      return json(res, 200, { ok: true });
    }
    if (path === '/voice/' && req.method === 'POST') {
      return json(res, 200, { ok: false, error: 'asr-unavailable', id: 'v1' });
    }
    if (path === '/uploads/' && req.method === 'POST') {
      return json(res, 200, {
        ok: true, id: 'u1', name: 'note.txt', size: body.length, mime: 'text/plain', path: '/box/note.txt'
      });
    }
    if (path === '/settings/' && req.method === 'GET') {
      return json(res, 200, {
        ok: true, permission: { mode: 'ask' }, bots: { aa: { model: null, effort: null } },
        models: [], modelsWritable: false
      });
    }
    if (path === '/settings/permission' && req.method === 'PUT') {
      state.permissionPuts.push(body.toString());
      return json(res, 200, { ok: true });
    }
    if (path.startsWith('/settings/bots/')) return json(res, 200, { ok: true });
    if (path === '/groups') {
      return json(res, 200, { ok: true, groups: [{
        id: 'g1', name: '一组', status: 'active', members: ['aa', 'ab'],
        lastText: '刚说了一句', updatedAt: new Date().toISOString()
      }] });
    }
    if (path === '/panic/status') {
      return json(res, 200, {
        ok: true, state: 'running', steps: {}, live: { runningSessions: 0, runningExternal: 0 }
      });
    }
    if (path === '/board/tickets') return json(res, 200, { ok: true, tickets: [] });
    return json(res, 200, { ok: true });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      state,
      async close() {
        for (const stream of state.streams) { try { stream.end(); } catch { /* 已经断了 */ } }
        await new Promise(done => server.close(done));
        server.closeAllConnections?.();
      }
    }));
  });
}
