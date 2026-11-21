// 带状态的假后端。未读按「每段会话一个已读位置」算，和真后端同一规矩；讨论组可以后台塞助理回复。
import http from 'node:http';

const NOW = Date.parse('2026-11-19T08:00:00.000Z');

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

export function startMock(port, options = {}) {
  const names = { aa: '甲', ab: '乙', ac: '丙' };
  const st = {
    reads: [], delayRead: 0, unreadCalls: 0, failRead: 0, failReadStatus: 503, delayUnread: 0, groupGets: 0, sessionMarks: [],
    // 会话：updatedAt 越大越新。s-new 是最新一段、没有未读；未读在更早的 s-old。
    sessions: [
      { id: 's-new', bot: 'aa', title: '最近一段', updatedAt: NOW + 5000, purpose: options.newPurpose },
      { id: 's-old', bot: 'aa', title: '更早一段', updatedAt: NOW + 4000 },
      { id: 's-b', bot: 'ab', title: '乙的话题', updatedAt: NOW + 3000 },
      { id: 's-board', bot: 'ac', title: '派工：T-1', updatedAt: NOW + 2000, purpose: 'board' },
      { id: 's-hidden', bot: 'ac', title: '组内工作', updatedAt: NOW + 1000, hidden: true, groupId: 'g3' },
    ],
    history: {
      's-new': [{ id: '3', role: 'assistant', text: '最近的回复', seq: 3, ts: NOW }],
      's-old': [
        { id: '5', role: 'assistant', text: '早先的第一句', seq: 5, ts: NOW },
        { id: '9', role: 'assistant', text: '早先的第二句', seq: 9, ts: NOW },
      ],
      's-b': [{ id: '4', role: 'assistant', text: '乙的回复', seq: 4, ts: NOW }],
      's-board': [{ id: '6', role: 'assistant', text: '派工做完了', seq: 6, ts: NOW }],
      's-hidden': [{ id: '8', role: 'assistant', text: '组内干活的话', seq: 8, ts: NOW }],
    },
    cursors: { 's-new': '3' },
    groupCursors: {},
    groups: [{
      id: 'g3', name: '周末', status: 'active', host: 'aa',
      members: [{ id: 'aa', name: '甲', role: 'host' }, { id: 'ab', name: '乙', role: 'member' }],
      messages: [{ id: 1, from: 'aa', text: '早', ts: NOW }],
    }],
    pushGroup(from, text) {
      const group = st.groups[0];
      group.messages.push({ id: group.messages.length + 1, from, text, ts: Date.now() });
    },
  };
  const visible = () => st.sessions.filter(row => row.hidden !== true);
  const counted = row => row.hidden !== true && !row.groupId;
  function sessionUnread(row) {
    const cursor = st.cursors[row.id];
    return (st.history[row.id] || []).filter(m => m.role === 'assistant' && m.text &&
      (cursor === undefined || Number(m.id) > Number(cursor))).length;
  }
  function groupUnread(group) {
    const cursor = st.groupCursors[group.id] || 0;
    return group.messages.filter(m => m.id > cursor && m.from !== 'owner' && m.from !== 'system').length;
  }
  function unreadBody() {
    const conversations = {}; const bots = {};
    for (const row of st.sessions.filter(counted)) {
      if (row.purpose === 'board' && options.excludeBoard === true) continue;
      const n = sessionUnread(row);
      conversations[row.id] = n;
      bots[row.bot] = (bots[row.bot] || 0) + n;
    }
    for (const id of Object.keys(names)) bots[id] = bots[id] || 0;
    const groups = {};
    for (const group of st.groups) groups[group.id] = groupUnread(group);
    return { ok: true, conversations, bots, groups };
  }
  const listRow = group => ({
    id: group.id, name: group.name, status: group.status, host: group.host,
    members: group.members.map(m => ({ id: m.id, name: m.name, role: m.role })),
    lastText: group.messages.at(-1)?.text || '', updatedAt: new Date(NOW).toISOString(),
  });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/^\/bff(?=\/)/, '') || '/';
    const method = req.method || 'GET';
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { body = {}; }
    if (path === '/events' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': ok\n\n');
      return;
    }
    if (path === '/health') return send(res, 200, { ok: true, dsh: { connected: true } });
    if (path === '/status') {
      const bots = {};
      for (const id of Object.keys(names)) bots[id] = { running: false, pending: 0, unread: 0 };
      return send(res, 200, { ok: true, pendingTotal: 0, bots });
    }
    if (path === '/bots') {
      return send(res, 200, { ok: true, bots: Object.entries(names).map(([id, name], index) => ({
        id, name, status: 'active', role: index === 0 ? 'chief' : 'bot', order: index + 1, duty: '在组里' + name })) });
    }
    if (path === '/sessions' && method === 'GET') {
      return send(res, 200, { sessions: visible().map(row => ({
        id: row.id, bot: row.bot, title: row.title, updatedAt: row.updatedAt, unread: 0, running: false,
        lastText: st.history[row.id]?.at(-1)?.text || '', lastRole: 'assistant',
        ...(row.purpose ? { purpose: row.purpose } : {}) })) });
    }
    if (path === '/sessions' && method === 'POST') return send(res, 200, { id: 's-made', bot: body.bot || 'aa' });
    let m = /^\/sessions\/([^/]+)\/history$/.exec(path);
    if (m && method === 'GET') return send(res, 200, { messages: st.history[m[1]] || [] });
    m = /^\/sessions\/([^/]+)\/read$/.exec(path);
    if (m && method === 'POST') { st.sessionMarks.push(m[1]); return send(res, 200, { ok: true }); }
    if (/\/cards$/.test(path) && method === 'GET') return send(res, 200, { cards: [] });
    if (path === '/approvals') return send(res, 200, { approvals: [] });
    if (path === '/unread/' && method === 'GET') {
      st.unreadCalls += 1;
      if (st.delayUnread) await new Promise(done => setTimeout(done, st.delayUnread));
      return send(res, 200, unreadBody());
    }
    if (path === '/unread/read' && method === 'POST') {
      if (st.delayRead) await new Promise(done => setTimeout(done, st.delayRead));
      const entry = { body, status: 200 };
      st.reads.push(entry);
      if (st.failRead > 0) {
        st.failRead -= 1;
        entry.status = st.failReadStatus;
        return send(res, entry.status, { error: { code: 'X', message: '暂时不行' } });
      }
      const group = st.groups.find(g => g.id === body.conversation);
      const row = st.sessions.find(s => s.id === body.conversation);
      if (row) {
        const rows = st.history[row.id] || [];
        const target = Object.prototype.hasOwnProperty.call(body, 'upTo')
          ? rows.find(r => r.id === String(body.upTo)) : rows.at(-1);
        if (!target) { entry.status = 400; return send(res, 400, { error: { code: 'INVALID_INPUT', message: '位置不对' } }); }
        if (st.cursors[row.id] === undefined || Number(target.id) > Number(st.cursors[row.id])) st.cursors[row.id] = target.id;
        return send(res, 200, { ok: true });
      }
      if (group) {
        const id = Object.prototype.hasOwnProperty.call(body, 'upTo') ? Number(body.upTo) : group.messages.at(-1).id;
        st.groupCursors[group.id] = Math.max(st.groupCursors[group.id] || 0, id);
        return send(res, 200, { ok: true });
      }
      entry.status = 404;
      return send(res, 404, { error: { code: 'NOT_FOUND', message: '没有这段会话' } });
    }
    if (path === '/presence') return send(res, 200, { ok: true, bots: {} });
    if (path === '/groups' && method === 'GET') return send(res, 200, { ok: true, groups: st.groups.map(listRow) });
    m = /^\/groups\/([A-Za-z0-9_-]+)$/.exec(path);
    if (m && method === 'GET') {
      st.groupGets += 1;
      const group = st.groups.find(g => g.id === m[1]);
      if (!group) return send(res, 404, { error: { code: 'NOT_FOUND', message: '没有' } });
      const after = Number(url.searchParams.get('after') || 0);
      return send(res, 200, { group: { ...listRow(group) }, messages: group.messages.filter(x => x.id > after),
        tickets: [], page: '# 项目页', summary: {} });
    }
    m = /^\/groups\/([A-Za-z0-9_-]+)\/messages$/.exec(path);
    if (m && method === 'POST') {
      const group = st.groups.find(g => g.id === m[1]);
      group.messages.push({ id: group.messages.length + 1, from: 'owner', text: body.text, ts: Date.now() });
      st.lastOwner = body.text;
      if (typeof options.onOwnerLine === 'function') options.onOwnerLine(st, body.text);
      return send(res, 200, { ok: true });
    }
    if (path === '/panic/status') return send(res, 200, { ok: true, state: 'running', steps: {} });
    if (path === '/board/tickets') return send(res, 200, { ok: true, tickets: [] });
    return send(res, 200, { ok: true });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      port: server.address().port,
      state: st,
      async close() { await new Promise(done => server.close(done)); server.closeAllConnections?.(); },
    }));
  });
}
