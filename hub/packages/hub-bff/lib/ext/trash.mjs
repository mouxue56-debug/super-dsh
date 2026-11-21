// 最近删除的扩展口。加载器按文件名挂在 /trash；网页和本文件也认 /bff/trash。
// 只放行主人设备。助理令牌、外部身份、未登录、别的设备一律拒绝。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publicError } from '../errors.mjs';
import { clipData, createTrash, isChatSegment } from '../trash.mjs';

const LIMIT = 16384;
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,200}$/u;
const BOT_ID = /^[a-z][a-z0-9-]{1,23}$/u;
const BATCH_ID = /^tb_[a-f0-9]{16}$/u;

function send(res, status, value) {
  const payload = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function fail(status, code, message) {
  return { status, body: { error: { code, message } } };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > LIMIT) return { error: 'too-large' };
    chunks.push(data);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'json' };
    return { value };
  } catch {
    return { error: 'json' };
  }
}

function onlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function deviceOf(req) {
  const value = req.headers?.['x-hub-device'];
  return typeof value === 'string' ? value : '';
}

function botName(deps, bot) {
  const rows = typeof deps.roster?.list === 'function' ? deps.roster.list() : [];
  const row = Array.isArray(rows) ? rows.find((item) => item?.id === bot) : null;
  return clipData(row?.name || '助理', 12) || '助理';
}

function segmentLabel(name, title, count) {
  const clean = clipData(title, 40);
  const tagged = /^(接力|派工|验收|分派|安排)[：:]\s*(.*)$/u.exec(clean);
  if (tagged) {
    const body = clipData(tagged[2], 16) || '未命名';
    return `${tagged[1]}『${body}』`;
  }
  if (clean) return clipData(`${name} · ${clean}`, 40);
  if (Number.isInteger(count) && count >= 0) return `${name} · ${count} 条消息`;
  return `${name} · 一段对话`;
}

async function rowsOf(deps) {
  if (typeof deps.sessions?.list !== 'function') return null;
  const rows = await deps.sessions.list({ all: true });
  return Array.isArray(rows) ? rows : null;
}

async function historyOf(deps, sessionId) {
  if (typeof deps.sessions?.history !== 'function') return null;
  try {
    const value = await deps.sessions.history(sessionId);
    const messages = Array.isArray(value) ? value : value?.messages;
    return Array.isArray(messages) ? messages : null;
  } catch {
    return null;
  }
}

function findHit(messages, id) {
  return messages.find((message) => message && (message.id === id || String(message.seq) === id)) ?? null;
}

async function mergedSources(deps, targetId) {
  if (typeof deps.dataDir !== 'string' || !deps.dataDir) return [];
  let text;
  try {
    text = await readFile(join(deps.dataDir, 'topics.json'), 'utf8');
  } catch {
    return [];
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const merges = data?.merges;
  if (!merges || typeof merges !== 'object' || Array.isArray(merges)) return [];
  const canon = (id) => {
    const seen = new Set();
    let current = id;
    while (merges[current]?.target) {
      if (seen.has(current)) return current;
      seen.add(current);
      current = merges[current].target;
    }
    return current;
  };
  return Object.keys(merges).filter((id) => id !== targetId && canon(id) === targetId);
}

async function stopRunning(deps, rows, force) {
  const running = rows.filter((row) => row.running === true);
  if (!running.length) return null;
  if (force !== true) return fail(409, 'RUNNING', '它还在做事，先停下？');
  if (typeof deps.sessions?.cancel !== 'function') return fail(503, 'UNAVAILABLE', '现在停不下来');
  for (const row of running) await deps.sessions.cancel(row.id);
  return null;
}

function trashFrom(deps) {
  if (deps.trash) return deps.trash;
  const file = typeof deps.dataDir === 'string' && deps.dataDir ? join(deps.dataDir, 'trash.json') : '';
  return createTrash({
    file,
    now: typeof deps.now === 'function' ? deps.now : () => Date.now(),
    logger: deps.logger,
  });
}

export function createHandler(deps = {}) {
  const trash = trashFrom(deps);
  return async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return false;
    }
    const path = url.pathname.replace(/\/+$/u, '') || '/';
    const bare = path.startsWith('/bff/trash') ? path.slice(4) : path;
    if (bare !== '/trash' && !bare.startsWith('/trash/')) return false;
    if (deps.isTrusted?.(req) !== true) {
      send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'BFF key required' } });
      return true;
    }
    if (deps.isOwnerDevice?.(req) !== true) {
      send(res, 403, { error: { code: 'FORBIDDEN', message: '只有主人在自己的设备上可以删除或恢复' } });
      return true;
    }
    try {
      await trash.ready;
      const result = await route(deps, trash, req, bare);
      send(res, result.status, result.body);
    } catch (error) {
      const safe = publicError(error);
      if (!res.headersSent) send(res, safe.status, { error: { code: safe.code, message: safe.message } });
      else res.end();
    }
    return true;
  };
}

async function route(deps, trash, req, path) {
  if (path === '/trash') {
    if (req.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', '请求方法不支持');
    const nowMs = typeof deps.now === 'function' ? deps.now() : Date.now();
    return { status: 200, body: { ok: true, items: trash.list({ now: nowMs }) } };
  }
  const restore = /^\/trash\/(tb_[a-f0-9]{16})\/restore$/u.exec(path);
  if (restore) {
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', '请求方法不支持');
    const body = await readBody(req);
    if (body.error === 'too-large') return fail(413, 'INVALID_INPUT', '请求体过大');
    if (body.error) return fail(400, 'INVALID_INPUT', '请求体不是 JSON 对象');
    if (!onlyKeys(body.value, [])) return fail(400, 'INVALID_INPUT', '请求里有不认识的字段');
    if (!BATCH_ID.test(restore[1])) return fail(404, 'NOT_FOUND', '没有这批删除记录');
    return trash.restore(restore[1]);
  }
  if (path === '/trash/messages' || path === '/trash/segments' || path === '/trash/threads') {
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', '请求方法不支持');
    const body = await readBody(req);
    if (body.error === 'too-large') return fail(413, 'INVALID_INPUT', '请求体过大');
    if (body.error) return fail(400, 'INVALID_INPUT', '请求体不是 JSON 对象');
    if (path === '/trash/messages') return deleteMessage(deps, trash, req, body.value);
    if (path === '/trash/segments') return deleteSegment(deps, trash, req, body.value);
    return deleteThread(deps, trash, req, body.value);
  }
  return fail(404, 'NOT_FOUND', '路径不存在');
}

async function deleteMessage(deps, trash, req, body) {
  if (!onlyKeys(body, ['session', 'id'])) return fail(400, 'INVALID_INPUT', '请求里有不认识的字段');
  if (typeof body.session !== 'string' || !SESSION_ID.test(body.session)) {
    return fail(400, 'INVALID_INPUT', '会话号无效');
  }
  const key = typeof body.id === 'number' && Number.isSafeInteger(body.id) && body.id >= 0
    ? String(body.id)
    : body.id;
  if (typeof key !== 'string' || !key || key.length > 200 || /[\u0000-\u001f\u007f]/u.test(key)) {
    return fail(400, 'INVALID_INPUT', '消息号无效');
  }
  const rows = await rowsOf(deps);
  if (!rows) return fail(503, 'UNAVAILABLE', '暂时读不到会话');
  const row = rows.find((item) => item.id === body.session);
  if (!row) return fail(404, 'NOT_FOUND', '没有这段对话');
  const prior = trash.deletionOfMessage(body.session, key);
  if (prior) return prior;
  if (trash.isSegmentDeleted(body.session)) {
    const cover = trash.deletionOfSession(body.session);
    if (cover) return cover;
  }
  const messages = await historyOf(deps, body.session);
  if (!messages) return fail(503, 'UNAVAILABLE', '暂时读不到这段对话');
  const hit = findHit(messages, key);
  if (!hit) return fail(404, 'NOT_FOUND', '没有这条消息');
  const seq = Number.isInteger(hit.seq) ? hit.seq : undefined;
  const messageId = typeof hit.id === 'string' && hit.id ? hit.id : key;
  return trash.removeMessage({
    session: row.id,
    messageId,
    seq,
    bot: row.bot,
    by: deviceOf(req),
    label: `${botName(deps, row.bot)} · 1 条消息`,
  });
}

async function deleteSegment(deps, trash, req, body) {
  if (!onlyKeys(body, ['session', 'force'])) return fail(400, 'INVALID_INPUT', '请求里有不认识的字段');
  if (typeof body.session !== 'string' || !SESSION_ID.test(body.session)) {
    return fail(400, 'INVALID_INPUT', '会话号无效');
  }
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    return fail(400, 'INVALID_INPUT', 'force 只能是 true 或 false');
  }
  const rows = await rowsOf(deps);
  if (!rows) return fail(503, 'UNAVAILABLE', '暂时读不到会话');
  const row = rows.find((item) => item.id === body.session);
  if (!row) return fail(404, 'NOT_FOUND', '没有这段对话');
  if (!isChatSegment(row)) return fail(400, 'INVALID_INPUT', '这段不能从对话里删');
  const sourceIds = await mergedSources(deps, row.id);
  const extras = rows.filter((item) => sourceIds.includes(item.id) && item.bot === row.bot
    && isChatSegment(item) && !trash.isSegmentDeleted(item.id));
  const pending = [row, ...extras].filter((item) => !trash.isSegmentDeleted(item.id));
  const prior = trash.deletionOfSession(row.id);
  if (!pending.length && prior) return prior;
  const blocked = await stopRunning(deps, pending, body.force);
  if (blocked) return blocked;
  const made = [];
  for (const item of pending) {
    const messages = await historyOf(deps, item.id);
    const count = messages ? messages.length : null;
    const result = await trash.removeSegment({
      session: item.id,
      bot: item.bot,
      by: deviceOf(req),
      label: segmentLabel(botName(deps, item.bot), item.title, count),
    });
    if (!result.ok) return result;
    made.push(result);
  }
  const primary = prior || made.find((item) => item.body.item.session === row.id) || made[0];
  const related = made.map((item) => item.body.item.id).filter((id) => id !== primary.body.item.id);
  if (!related.length) return primary;
  return { ...primary, body: { ...primary.body, related } };
}

async function deleteThread(deps, trash, req, body) {
  if (!onlyKeys(body, ['bot', 'force'])) return fail(400, 'INVALID_INPUT', '请求里有不认识的字段');
  if (typeof body.bot !== 'string' || !BOT_ID.test(body.bot)) return fail(400, 'INVALID_INPUT', '助理号无效');
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    return fail(400, 'INVALID_INPUT', 'force 只能是 true 或 false');
  }
  const known = typeof deps.roster?.get === 'function' ? deps.roster.get(body.bot) : null;
  const listed = typeof deps.roster?.list === 'function'
    ? deps.roster.list().some((item) => item?.id === body.bot)
    : false;
  if (!known && !listed) return fail(404, 'NOT_FOUND', '没有这位助理');
  const rows = await rowsOf(deps);
  if (!rows) return fail(503, 'UNAVAILABLE', '暂时读不到会话');
  const mine = rows.filter((row) => row.bot === body.bot && isChatSegment(row));
  const ids = mine.map((row) => row.id).sort();
  if (!ids.length) return fail(404, 'NOT_FOUND', '没有可清的对话');
  const prior = trash.deletionOfThread(body.bot, ids);
  if (prior) return prior;
  const pending = mine.filter((row) => !trash.isSegmentDeleted(row.id));
  const blocked = await stopRunning(deps, pending, body.force);
  if (blocked) return blocked;
  return trash.removeThread({
    bot: body.bot,
    sessions: ids,
    by: deviceOf(req),
    label: `和${botName(deps, body.bot)}的全部对话`,
  });
}
