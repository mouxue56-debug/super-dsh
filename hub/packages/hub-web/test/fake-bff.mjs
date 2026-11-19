import http from 'node:http';
import { randomUUID } from 'node:crypto';

export const bots = ['chief', 'support', 'content', 'pm', 'art', 'research'];
// 纯内存、仅回环监听，不连接 DSH，不读取任何凭据。
export async function startFakeBff({ port = 0, key } = {}) {
  const sessions = new Map(), sockets = new Set();
  const stats = { creates: 0, messages: 0, streams: 0, cancels: 0, deltas: 0, reads: 0, requests: [] };
  const app = { connected: true, available: true, sessions, stats, failStreams: false, delayAdmission: 0, tickMs: null, statusOverride: null };
  app.disconnect = () => { app.available = false; for (const s of sessions.values()) for (const client of s.clients) client.destroy(); };
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  const fail = (res, status, text) => json(res, status, { error: { code: String(status), message: text } });
  async function body(req) { let text = ''; for await (const c of req) { text += c; if (text.length > 100000) throw Error('请求过长'); } return JSON.parse(text || '{}'); }
  function meta(s) { return { id: s.id, bot: s.bot, title: s.title, lastText: s.lastText, lastRole: s.lastRole, updatedAt: s.updatedAt, unread: s.unread, running: !!s.job && !s.job.done }; }
  function frame(s, type, data) {
    const text = 'event: ' + type + '\r\ndata: ' + JSON.stringify(data) + '\r\n\r\n';
    for (const c of s.clients) c.write(text);
  }
  function complete(s, error = false) {
    const j = s.job; if (!j || j.done) return;
    clearInterval(j.timer); j.done = true;
    if (error) { frame(s, 'error', { message: '离线夹具模拟出错，请重试' }); return; }
    s.history.push({ role: 'assistant', text: j.partial, ts: Date.now() });
    s.lastText = j.partial.slice(0, 120); s.lastRole = 'assistant'; s.updatedAt = Date.now(); s.unread++;
    frame(s, 'message', { role: 'assistant', text: j.partial }); frame(s, 'done', {});
  }
  function run(s, text) {
    const full = text.includes('长回复') ? '# 长回复\n\n' + '这是供本机验证的长段落。'.repeat(800) + '\n\n| 项目 | 状态 |\n| --- | --- |\n| 测试 | 完成 |\n\n```js\nconst n = 1;\n```' : '离线回显（' + s.bot + '）：' + text;
    const chunks = full.match(text.includes('长回复') ? /[\s\S]{1,450}/gu : /[\s\S]{1,3}/gu) || [''];
    const j = s.job = { partial: '', done: false, dropped: false, timer: null, text };
    let index = 0;
    j.timer = setInterval(() => {
      if (text.includes('出错') && index > 0) return complete(s, true);
      if (index >= chunks.length) return complete(s);
      const chunk = chunks[index++]; j.partial += chunk; stats.deltas++; frame(s, 'delta', { text: chunk });
      if (text.includes('断流') && !j.dropped && index === 2) { j.dropped = true; for (const c of s.clients) c.destroy(); }
    }, app.tickMs ?? (text.includes('慢') ? 240 : text.includes('长回复') ? 30 : 70));
  }
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      stats.requests.push({ method: req.method, path: url.pathname });
      if (key && req.headers['x-hub-bff-key'] !== key) return fail(res, 401, '未授权');
      if (!app.available) return fail(res, 502, 'BFF unavailable');
      if (url.pathname === '/bff/health') return json(res, 200, { ok: app.connected, dsh: { connected: app.connected }, model: 'offline-fixture', api: 'r23' });
      if (!app.connected) return fail(res, 503, '离线夹具暂不可用');
      if (url.pathname === '/bff/bots') return json(res,200,{bots:bots.map((id,i)=>({id,name:id,role:i===0?'chief':'bot',status:'active',order:i,avatar:{kind:'shape',shape:'circle',color:'yellow'},duty:'离线测试',phrases:[]})),avatarKinds:{roles:[],shapes:['circle'],colors:['yellow']}});
      if (url.pathname === '/bff/presets') return json(res, 200, { bots: bots.map(bot => ({ bot, preset: 'hub-' + bot, name: bot, cwd: '/offline/' + bot })) });
      if (url.pathname === '/bff/status') return json(res, 200, { bots: Object.fromEntries(bots.map(bot => {
        const list = [...sessions.values()].filter(s => s.bot === bot), running = list.find(s => s.job && !s.job.done);
        return [bot, app.statusOverride?.[bot] || { running: !!running, runningSessionId: running?.id || null, unread: list.reduce((n, s) => n + s.unread, 0) }];
      })), ts: Date.now() });
      if (url.pathname === '/bff/sessions') {
        if (req.method === 'GET') return json(res, 200, { sessions: [...sessions.values()].filter(s => !url.searchParams.has('bot') || s.bot === url.searchParams.get('bot')).map(meta).sort((a, b) => b.updatedAt - a.updatedAt) });
        if (req.method === 'POST') {
          const data = await body(req); if (!bots.includes(data.bot)) return fail(res, 400, '无效助理');
          const s = { id: randomUUID(), bot: data.bot, title: data.title || '', lastText: '', lastRole: null, updatedAt: Date.now(), unread: 0, history: [], clients: new Set(), job: null };
          sessions.set(s.id, s); stats.creates++; return json(res, 201, meta(s));
        }
      }
      const match = /^\/bff\/sessions\/([^/]+)\/(history|messages|stream|cancel|read)$/.exec(url.pathname);
      if (!match) return fail(res, 404, '未找到');
      const s = sessions.get(decodeURIComponent(match[1])); if (!s) return fail(res, 404, '会话不存在');
      if (match[2] === 'history' && req.method === 'GET') return json(res, 200, { messages: s.history });
      if (match[2] === 'read' && req.method === 'POST') { s.unread = 0; stats.reads++; return json(res, 200, { ok: true }); }
      if (match[2] === 'messages' && req.method === 'POST') {
        const data = await body(req); if (typeof data.text !== 'string' || !data.text.trim()) return fail(res, 400, '空消息');
        if (s.job && !s.job.done) return fail(res, 409, '正在回复');
        if (app.delayAdmission) await new Promise(ok => setTimeout(ok, app.delayAdmission));
        s.history.push({ role: 'user', text: data.text, ts: Date.now() });
        s.title ||= data.text.split(/[。！？!?\n]/)[0].slice(0, 24); stats.messages++; run(s, data.text);
        return json(res, 202, { accepted: true, requestId: randomUUID() });
      }
      if (match[2] === 'cancel' && req.method === 'POST') {
        stats.cancels++;
        if (s.job && !s.job.done) { clearInterval(s.job.timer); s.job.done = true; if (s.job.partial) s.history.push({ role: 'assistant', text: s.job.partial, ts: Date.now() }); frame(s, 'done', {}); }
        return json(res, 200, { ok: true });
      }
      if (match[2] === 'stream' && req.method === 'GET') {
        stats.streams++; if (app.failStreams) return fail(res, 503, '断流夹具');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.flushHeaders();
        s.clients.add(res); const heartbeat = setInterval(() => res.write(': 心跳\n\n'), 15000);
        res.once('close', () => { clearInterval(heartbeat); s.clients.delete(res); });
        res.write('event: state\r\ndata: ' + JSON.stringify({ running: !!s.job && !s.job.done, partial: s.job?.partial || '' }) + '\r\n\r\n');
        return;
      }
      return fail(res, 405, '方法不允许');
    } catch { if (!res.headersSent) fail(res, 400, '请求无效'); else res.destroy(); }
  };
  const server = http.createServer(handler);
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); });
  Object.assign(app, { handler, server, url: 'http://127.0.0.1:' + server.address().port });
  app.close = async () => { for (const s of sessions.values()) { clearInterval(s.job?.timer); for (const c of s.clients) c.end(); } for (const socket of sockets) socket.destroy(); await new Promise(ok => server.close(ok)); };
  return app;
}
