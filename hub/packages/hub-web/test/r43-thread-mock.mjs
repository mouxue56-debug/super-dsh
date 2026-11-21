// 浏览器用状态后端，只有 localhost 假消息，不调用内核或模型。
import http from 'node:http';

const NOW = Date.parse('2026-11-19T08:00:00.000Z');
const names = { aa: '甲', ab: '乙', ac: '丙' };
export const TICKET = 'T-20261119-080000-ab12';
const eligible = row => !row.hidden && !row.groupId && (!row.purpose || row.purpose === 'board');
const compound = (session, id) => Buffer.from(JSON.stringify([session, id])).toString('base64url');

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function seed(options) {
  const size = options.size || 120;
  const split = Math.floor(size / 2);
  const state = {
    requests: [], reads: [], sent: [], created: [], stopped: [], streams: new Set(), trash: [],
    runningSessions: new Set(),
    failRead: options.failRead || 0, delayRead: 0, cursors: {}, history: {}, sessions: [], groupCursor: 0,
    failSend: options.failSend || 0, holdStream: options.holdStream || false, runningStreams: new Map(),
    approvals: [], answers: [],
    groupMessages: [{ id: 1, from: 'ab', text: '组里的第一句', ts: NOW }],
  };
  const add = (id, bot, title, messages, extra = {}) => {
    state.sessions.push({ id, bot, title, updatedAt: messages.at(-1)?.ts || NOW, ...extra });
    state.history[id] = messages;
    state.cursors[id] = messages.at(-1)?.seq || 0;
  };
  const lines = Array.from({ length: size }, (_, index) => ({
    id: String(index + 1), seq: index + 1, ts: NOW + index * 1000,
    role: index % 2 ? 'assistant' : 'user',
    text: index === 10 ? '旧话题里约好星期三去看展览' : '第' + (index + 1) + '句，讨论今天的安排。',
  }));
  add('s-old', 'aa', '早先的话题', lines.slice(0, split));
  add('s-current', 'aa', '新会话', lines.slice(split));
  add('s-board', 'aa', '派工：周末安排', [
    { id: '1', seq: 1, ts: NOW + (size - 12) * 1000, role: 'assistant', text: '事件卡里面的交回说明' },
    { id: '2', seq: 2, ts: NOW + (size - 11) * 1000, role: 'assistant', text: '活动清单已经核对', tools: [{
      id: 'tool-board', name: 'read', path: '/box/活动清单.md', seq: 3,
      ts: NOW + (size - 11) * 1000 + 1, status: 'ok', brief: '',
    }] },
  ], { purpose: 'board', ticketId: TICKET });
  add('s-b', 'ab', '乙的话题', [{ id: '1', seq: 1, ts: NOW - 1000, role: 'assistant', text: '乙的回复' }]);
  add('s-hidden', 'aa', '组内', [{ id: '1', seq: 1, ts: NOW, role: 'assistant', text: '隐藏原文' }], {
    hidden: true, groupId: 'g3', purpose: 'group-work',
  });
  add('s-routine', 'aa', '固定任务', [{ id: '1', seq: 1, ts: NOW, role: 'assistant', text: '例行原文' }], {
    purpose: 'routine',
  });
  add('s-meeting', 'aa', '会议', [{ id: '1', seq: 1, ts: NOW, role: 'assistant', text: '会议原文' }], {
    purpose: 'meeting',
  });
  if (options.unread) {
    state.cursors['s-old'] = 11;
    state.cursors['s-current'] = size - 2;
    state.cursors['s-board'] = 0;
  }
  if (options.approvals) {
    for (const id of ['s-old', 's-board']) state.approvals.push({
      type: 'approval', id: 'approval-' + id, bot: 'aa', sessionId: id, status: 'pending', tool: 'write',
      action: '写入核对结果', path: '/box/核对结果.md', diff: '+ 已经核对', chars: 5,
      createdAt: state.history[id].at(-1).ts, expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
  }
  state.add = add;
  return state;
}

export async function startThreadMock(options = {}) {
  const state = seed(options);
  const pending = new Map();
  const merged = new Map();
  const displayTopic = new Map();
  const find = id => state.sessions.find(row => row.id === id);
  const topicId = (row, message) => {
    const id = displayTopic.get(compound(row.id, message.id)) || row.id;
    return merged.get(id) || id;
  };
  const createTopic = (bot, title) => {
    const id = 's-made-' + (state.created.length + 1);
    state.add(id, bot, title || '新会话', [], { updatedAt: Date.now() });
    state.created.push(id);
    return id;
  };
  const admit = (id, body) => {
    state.sent.push({ session: id, ...body });
    const seq = (state.history[id].at(-1)?.seq || 0) + 1;
    state.history[id].push({ id: String(seq), seq, role: 'user', text: body.text,
      classification: body.classification, ts: Date.now() });
    if (!state.holdStream) state.history[id].push({ id: String(seq + 1), seq: seq + 1, role: 'assistant',
      text: '收到这句新消息', ts: Date.now() + 1 });
    find(id).updatedAt = Date.now() + 1;
  };
  const covered = id => state.trash.some(item => !item.restored && (
    (item.kind === 'segment' && (item.session === id || item.sessions?.includes(id))) ||
    (item.kind === 'thread' && item.sessions?.includes(id))));
  const messageGone = (session, message) => covered(session) || state.trash.some(item => !item.restored &&
    item.kind === 'message' && item.session === session &&
    (item.messageId === message.id || String(message.seq) === String(item.messageId)));
  const visibleHistory = row => (state.history[row.id] || []).filter(message => !messageGone(row.id, message));
  const count = row => visibleHistory(row)
    .filter(message => message.role === 'assistant' && message.seq > (state.cursors[row.id] || 0)).length;
  const meta = row => {
    const tail = row.id ? visibleHistory(row).at(-1) : null;
    return { ...row, unread: row.id ? count(row) : 0, running: !!(row.id && state.runningSessions.has(row.id)),
      lastRole: tail?.role || '', lastText: tail?.text || '' };
  };
  const messages = row => visibleHistory(row).map(message => {
    const topic = topicId(row, message);
    const moved = displayTopic.has(compound(row.id, message.id));
    return { ...message, kind: 'message', messageId: message.id, id: compound(row.id, message.id),
      session: row.id,
      ...(options.topics ? { topic, topicTitle: find(topic)?.title } : {}),
      ...(moved ? { moved, contextNote: '助理原有聊天上下文仍保存在原话题里' } : {}) };
  });
  const segment = row => ({
    kind: 'segment', session: row.id, purpose: row.purpose || '', title: row.title, state: 'done',
    startedAt: state.history[row.id][0]?.ts, endedAt: state.history[row.id].at(-1)?.ts,
    ts: state.history[row.id][0]?.ts, messages: state.history[row.id].length,
    ticketId: row.ticketId || '', unread: count(row), ...(options.topics ? {
      topic: merged.get(row.id) || row.id, topicTitle: find(merged.get(row.id))?.title || row.title,
      context: row.purpose ? null : { text: '更早的内容助理已不带着，需要时可以回查' },
    } : {}),
  });
  const rowsFor = bot => state.sessions.filter(row => row.bot === bot && eligible(row) && !covered(row.id));
  const allItems = bot => rowsFor(bot).filter(row => state.history[row.id].length)
    .flatMap(row => row.purpose === 'board' ? [segment(row)] : [segment(row), ...messages(row)])
    .sort((a, b) => a.ts - b.ts || a.session.localeCompare(b.session) || (a.seq || -1) - (b.seq || -1));
  const topicInfo = id => ({ id, title: find(id).title });
  function receipt(entry, id = entry.receipt.session) {
    const row = find(id);
    const kind = entry.body.newTopic ? 'new' : 'continue';
    return { ...entry.receipt, session: id, topic: topicInfo(id), classification: {
      ...entry.receipt.classification, kind, label: (kind === 'new' ? '新话题：' : '接着聊：') + row.title,
    } };
  }
  function dispatchTopic(entry) {
    if (!entry.receipt.pending) return;
    const { session, classification } = entry.receipt;
    admit(session, { ...entry.body, classification });
    entry.receipt = { ...entry.receipt, pending: false, status: 'dispatched' };
  }
  function topicRoute(res, bot, route, method, body) {
    if (route === 'topics' && method === 'GET') return send(res, 200, { topics: rowsFor(bot).map(row => ({
      ...topicInfo(row.id), updatedAt: row.updatedAt, system: row.purpose === 'board', mergedInto: merged.get(row.id),
      summary: '一起讨论的事项',
    })) });
    if (route === 'send' && method === 'POST') {
      const id = 'thread-' + body.idem;
      if (!pending.has(id)) {
        const created = body.newTopic || /另开事项/.test(body.text);
        const session = created ? createTopic(bot, '新办事项') : body.topic || 's-old';
        const entry = { body: { ...body, newTopic: created }, receipt: {
          session, accepted: true, pending: true, status: 'pending', requestId: id, classification: { requestId: id },
        } };
        entry.receipt = receipt(entry);
        pending.set(id, entry);
        if (!options.pendingTopic) dispatchTopic(entry);
      }
      return send(res, 202, pending.get(id).receipt);
    }
    const action = /^send\/([^/]+)(?:\/(hold|cancel))?$/.exec(route);
    if (action) {
      const entry = pending.get(action[1]);
      if (!entry) return send(res, 404, {});
      if (action[2] === 'cancel' && entry.receipt.pending) {
        entry.receipt = { ...entry.receipt, pending: false, status: 'cancelled' };
      }
      if (!action[2] && state.releaseTopic) dispatchTopic(entry);
      return send(res, 200, entry.receipt);
    }
    if (route === 'reassign' && method === 'POST') {
      const target = body.newTopic ? createTopic(bot, body.title) : body.topic;
      if (body.mode === 'message') {
        const entry = pending.get(body.requestId);
        entry.body.newTopic = !!body.newTopic;
        entry.receipt = receipt(entry, target);
        return send(res, 200, entry.receipt);
      }
      const session = pending.get(body.requestId)?.receipt.session;
      const [id, message] = body.messageId ? JSON.parse(Buffer.from(body.messageId, 'base64url').toString())
        : [session, state.history[session].find(row => row.classification?.requestId === body.requestId)?.id];
      const at = state.history[id].findIndex(row => row.id === message);
      const next = state.history[id][at + 1];
      displayTopic.set(compound(id, message), target);
      if (next?.role === 'assistant') displayTopic.set(compound(id, next.id), target);
      return send(res, 200, { ok: true, topic: topicInfo(target), moved: next ? 2 : 1 });
    }
    const topic = /^topics\/([^/]+)(?:\/(merge|unmerge))?$/.exec(route);
    if (!topic) return send(res, 404, {});
    if (method === 'PATCH') find(topic[1]).title = body.title;
    if (topic[2] === 'merge') merged.set(topic[1], body.target);
    if (topic[2] === 'unmerge') merged.delete(topic[1]);
    return send(res, 200, { ok: true });
  }
  const itemKey = item => item.id || 'segment-' + item.session;
  const unreadBody = () => {
    const conversations = {};
    const bots = Object.fromEntries(Object.keys(names).map(id => [id, 0]));
    for (const row of state.sessions.filter(eligible)) {
      conversations[row.id] = count(row);
      bots[row.bot] += count(row);
    }
    const groups = { g3: state.groupMessages.filter(m => m.from !== 'owner' && m.id > state.groupCursor).length };
    return { ok: true, conversations, bots, groups };
  };
  const firstUnread = bot => rowsFor(bot).flatMap(row => messages(row)
    .filter(m => m.role === 'assistant' && m.seq > (state.cursors[row.id] || 0))
    .map(m => ({ id: m.id, session: row.id, seq: m.seq, ts: m.ts, segment: row.purpose === 'board' })))
    .sort((a, b) => a.ts - b.ts)[0] || null;
  const pageOf = (items, url, target) => {
    const limit = Math.min(100, Number(url.searchParams.get('limit')) || 40);
    let end = items.length;
    const before = url.searchParams.get('before');
    const after = url.searchParams.get('after');
    if (before) end = Math.max(0, items.findIndex(item => itemKey(item) === before));
    let start = Math.max(0, end - limit);
    if (after) {
      start = items.findIndex(item => itemKey(item) === after) + 1;
      end = Math.min(items.length, start + limit);
    }
    if (target) {
      const index = items.findIndex(item => itemKey(item) === target || item.session === target);
      start = Math.max(0, index - Math.floor(limit / 2));
      end = Math.min(items.length, start + limit);
    }
    const page = items.slice(start, end);
    return { items: page, nextBefore: start ? itemKey(page[0]) : null,
      nextAfter: end < items.length ? itemKey(page.at(-1)) : null };
  };
  async function mark(res, body) {
    const row = state.sessions.find(value => value.id === body.conversation);
    const entry = { body, status: 200 };
    state.reads.push(entry);
    if (state.delayRead) await new Promise(done => setTimeout(done, state.delayRead));
    if (state.failRead > 0) {
      state.failRead -= 1;
      entry.status = 503;
      return send(res, 503, { error: { code: 'UNAVAILABLE', message: '暂时没连上' } });
    }
    if (body.conversation === 'g3') state.groupCursor = state.groupMessages.at(-1)?.id || 0;
    else if (row) state.cursors[row.id] = state.history[row.id].at(-1)?.seq || 0;
    return send(res, 200, { ok: true });
  }
  function trashId() {
    return 'tb_' + (state.trash.length + 1).toString(16).padStart(16, '0');
  }
  function publicTrash(item) {
    return { id: item.id, kind: item.kind, bot: item.bot || '', label: item.label || '',
      deletedAt: item.deletedAt, daysLeft: 30, session: item.session, messageId: item.messageId,
      sessions: item.sessions };
  }
  function rememberTrash(kind, extra) {
    const item = { id: trashId(), kind, deletedAt: Date.now(), restored: false, ...extra };
    state.trash.unshift(item);
    return item;
  }
  function trashRoute(res, path, method, body) {
    if (!path.startsWith('/trash')) return false;
    if (path === '/trash' && method === 'GET') {
      send(res, 200, { items: state.trash.filter(item => !item.restored).map(publicTrash) });
      return true;
    }
    if (path === '/trash/messages' && method === 'POST') {
      const item = rememberTrash('message', { session: body.session, messageId: body.id,
        bot: find(body.session)?.bot || '', label: '1 条' });
      send(res, 200, { ok: true, item: publicTrash(item) });
      return true;
    }
    if (path === '/trash/segments' && method === 'POST') {
      if (state.runningSessions.has(body.session) && body.force !== true) {
        send(res, 409, { error: { code: 'RUNNING', message: '它还在做事，先停下？' } });
        return true;
      }
      if (body.force === true) state.stopped.push(body.session);
      const item = rememberTrash('segment', { session: body.session, sessions: [body.session],
        bot: find(body.session)?.bot || '', label: find(body.session)?.title || '话题' });
      send(res, 200, { ok: true, item: publicTrash(item) });
      return true;
    }
    if (path === '/trash/threads' && method === 'POST') {
      const sessions = state.sessions.filter(row => row.bot === body.bot && eligible(row)).map(row => row.id);
      if (sessions.some(id => state.runningSessions.has(id)) && body.force !== true) {
        send(res, 409, { error: { code: 'RUNNING', message: '它还在做事，先停下？' } });
        return true;
      }
      if (body.force === true) {
        for (const id of sessions) if (state.runningSessions.has(id)) state.stopped.push(id);
      }
      const item = rememberTrash('thread', { bot: body.bot, sessions, label: '和助理的对话' });
      send(res, 200, { ok: true, item: publicTrash(item) });
      return true;
    }
    const restore = /^\/trash\/([^/]+)\/restore$/.exec(path);
    if (restore && method === 'POST') {
      const item = state.trash.find(row => row.id === decodeURIComponent(restore[1]));
      if (!item) {
        send(res, 404, { error: { code: 'NOT_FOUND', message: '没有这批' } });
        return true;
      }
      item.restored = true;
      send(res, 200, { ok: true, item: publicTrash(item) });
      return true;
    }
    return false;
  }
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/^\/bff(?=\/)/, '');
    const method = req.method || 'GET';
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch {}
    state.requests.push({ method, path, query: url.search, body });
    if (path === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': connected\n\n');
      state.streams.add(res);
      res.on('close', () => state.streams.delete(res));
      return;
    }
    if (path === '/bots') return send(res, 200, { bots: Object.entries(names).map(([id, name], index) => ({
      id, name, status: 'active', role: index ? 'bot' : 'chief', order: index + 1, duty: '协助安排',
    })) });
    if (path === '/health') return send(res, 200, { ok: true, dsh: { connected: true } });
    if (path === '/status') return send(res, 200, { ok: true, pendingTotal: 0, bots: {} });
    if (path === '/presence') return send(res, 200, { ok: true, bots: {} });
    if (path === '/unread/' || path === '/unread') return send(res, 200, unreadBody());
    if (path === '/unread/read') return mark(res, body);
    if (path === '/voice/' && options.holdVoice) {
      await new Promise(resolve => { state.releaseVoice = resolve; });
      return send(res, 200, { ok: true, text: '录音转写留在开口时的话题' });
    }
    if (path.startsWith('/threads') && options.legacy) {
      return send(res, 404, { error: { code: 'NOT_FOUND', message: '旧后端没有这个接口' } });
    }
    if (path === '/threads') {
      const threads = Object.keys(names).map(bot => {
        const rows = rowsFor(bot).sort((a, b) => b.updatedAt - a.updatedAt);
        return { bot, ...meta(rows[0] || { id: '', bot }), segments: rows.length,
          ...(options.topics ? { topicTitle: rows[0]?.title } : {}),
          unread: rows.reduce((sum, row) => sum + count(row), 0) };
      });
      return send(res, 200, { threads });
    }
    const topicRequest = /^\/threads\/([^/]+)\/((?:topics|send|reassign)(?:\/.*)?)$/.exec(path);
    if (topicRequest) {
      if (!options.topics) return send(res, 404, {});
      return topicRoute(res, topicRequest[1], topicRequest[2], method, body);
    }
    let match = /^\/threads\/([^/]+)\/current$/.exec(path);
    if (match) return send(res, 200, { current: rowsFor(match[1]).filter(row => !row.purpose)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null });
    match = /^\/threads\/([^/]+)\/search$/.exec(path);
    if (match) {
      const q = url.searchParams.get('q') || '';
      const items = rowsFor(match[1]).flatMap(row => messages(row)).filter(message => message.text.includes(q))
        .map(message => ({ ...message, snippet: message.text })).slice(0, 50);
      return send(res, 200, { items, truncated: false });
    }
    match = /^\/threads\/([^/]+)\/segment\/([^/]+)$/.exec(path);
    if (match) {
      const row = rowsFor(match[1]).find(value => value.id === match[2]);
      if (!row) return send(res, 404, { error: { code: 'NOT_FOUND', message: '没有这段' } });
      return send(res, 200, pageOf(messages(row), url, url.searchParams.get('around')));
    }
    match = /^\/threads\/([^/]+)$/.exec(path);
    if (match) {
      const unread = firstUnread(match[1]);
      const requested = url.searchParams.get('around') || (url.searchParams.get('unread') ? unread?.id : '');
      const found = rowsFor(match[1]).flatMap(row => messages(row)).find(message => message.id === requested);
      const row = found && rowsFor(match[1]).find(value => value.id === found.session);
      const around = found ? { id: found.id, session: found.session, segment: row.purpose === 'board' } : null;
      const target = around?.segment ? around.session : requested;
      const topic = url.searchParams.get('topic');
      const items = allItems(match[1]).filter(item => !topic || item.topic === topic);
      return send(res, 200, { ...pageOf(items, url, target), firstUnread: unread, around });
    }
    if (path === '/sessions' && method === 'GET') {
      return send(res, 200, { sessions: state.sessions.filter(row => !row.hidden).map(meta) });
    }
    if (path === '/sessions' && method === 'POST') {
      const id = createTopic(body.bot, body.title);
      return send(res, 200, { id, bot: body.bot });
    }
    match = /^\/sessions\/([^/]+)\/(history|read|messages|stream|cancel)$/.exec(path);
    if (match) {
      const [_, id, action] = match;
      if (action === 'history') return send(res, 200, { messages: state.history[id] || [] });
      if (action === 'read') return mark(res, { conversation: id, ...body });
      if (action === 'cancel') {
        state.stopped.push(id);
        state.runningStreams.get(id)?.end('event: done\ndata: {"reason":"user_cancel"}\n\n');
        return send(res, 200, { ok: true });
      }
      if (action === 'messages') {
        state.sent.push({ session: id, ...body });
        if (state.failSend > 0) {
          state.failSend -= 1;
          return send(res, 503, { error: { code: 'UNAVAILABLE', message: '暂时没接上' } });
        }
        const seq = (state.history[id].at(-1)?.seq || 0) + 1;
        state.history[id].push({ id: String(seq), seq, role: 'user', text: body.text, ts: Date.now() });
        if (!state.holdStream) state.history[id].push({ id: String(seq + 1), seq: seq + 1, role: 'assistant',
          text: '收到这句新消息', ts: Date.now() + 1 });
        state.sessions.find(row => row.id === id).updatedAt = Date.now() + 1;
        return send(res, 200, { accepted: true, requestId: 'request-' + state.sent.length });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (state.holdStream) {
        res.write('event: delta\ndata: {"text":"我正在整理这件事"}\n\n');
        state.runningStreams.set(id, res);
        res.on('close', () => state.runningStreams.delete(id));
        return;
      }
      const last = state.history[id].at(-1);
      res.end('event: delta\ndata: {"text":"收到这句新消息"}\n\nevent: message\ndata: ' +
        JSON.stringify(last) + '\n\nevent: done\ndata: {}\n\n');
      return;
    }
    if (path.endsWith('/cards')) return send(res, 200, {
      cards: state.approvals.filter(card => card.sessionId === path.split('/')[2]),
    });
    if (path === '/approvals') return send(res, 200, { approvals: state.approvals });
    match = /^\/approvals\/([^/]+)\/answer$/.exec(path);
    if (match) {
      const card = state.approvals.find(value => value.id === match[1]);
      state.answers.push({ id: match[1], ...body });
      card.status = body.decision === 'approve' ? 'approved' : 'rejected';
      return send(res, 200, { ok: true, card });
    }
    if (path === '/groups') return send(res, 200, { groups: [{
      id: 'g3', name: '周末讨论', status: 'active', host: 'aa', updatedAt: new Date(NOW).toISOString(),
      members: [{ id: 'aa', name: '甲', role: 'host' }, { id: 'ab', name: '乙', role: 'member' }],
      lastText: state.groupMessages.at(-1).text,
    }] });
    if (path === '/groups/g3/messages') {
      state.groupMessages.push({ id: state.groupMessages.length + 1, from: 'owner', text: body.text, ts: NOW });
      state.groupMessages.push({ id: state.groupMessages.length + 1, from: 'ab', text: '乙在群里接话', ts: NOW });
      return send(res, 200, { ok: true });
    }
    if (path === '/groups/g3') return send(res, 200, {
      group: { id: 'g3', name: '周末讨论', status: 'active', host: 'aa', members: [
        { id: 'aa', name: '甲', role: 'host' }, { id: 'ab', name: '乙', role: 'member' },
      ] }, messages: state.groupMessages.filter(m => m.id > Number(url.searchParams.get('after') || 0)),
      tickets: [], page: '# 讨论', summary: {},
    });
    if (path === '/board/tickets') return send(res, 200, { tickets: [{
      id: TICKET, title: '周末安排', state: 'review', claimedBy: 'aa', claimedByType: 'assistant',
      from: { type: 'owner', name: '主人' }, updatedAt: new Date(NOW).toISOString(),
    }] });
    if (path === '/board/tickets/' + TICKET) return send(res, 200, { ticket: {
      id: TICKET, title: '周末安排', state: 'review', body: '核对周末的安排',
    } });
    if (path === '/panic/status') return send(res, 200, { ok: true, state: 'running', steps: {} });
    if (trashRoute(res, path, method, body)) return;
    return send(res, 200, { ok: true });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { state, compound, url: 'http://127.0.0.1:' + server.address().port,
    async close() {
      for (const stream of state.streams) stream.end();
      for (const stream of state.runningStreams.values()) stream.end();
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
    } };
}
