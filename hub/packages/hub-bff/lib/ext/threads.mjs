import { createThreads } from '../threads.mjs';
import { createTopics } from '../topics.mjs';
import { BffError } from '../errors.mjs';

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    ...(status === 405 ? { allow: 'GET, HEAD, POST, PATCH' } : {}) });
  res.end(JSON.stringify(value));
}

const runtimes = new Set();
export async function stop() {
  await Promise.all([...runtimes].map(runtime => runtime.stop()));
  runtimes.clear();
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    const value = Buffer.from(chunk); size += value.length;
    if (size > 512000) throw new BffError('INVALID_INPUT', '请求内容太长', 413);
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new BffError('INVALID_INPUT', '请求内容无效', 400); }
}

export function createHandler(deps = {}) {
  const core = createThreads(deps), topics = createTopics(deps, core);
  runtimes.add(topics);
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/u, '');
    if (path !== '/threads' && !path.startsWith('/threads/')) return false;
    if (deps.isTrusted?.(req) !== true) {
      send(res, 401, { error: { code: 'UNAUTHORIZED', message: '需要登录' } });
      return true;
    }
    if (deps.isOwnerDevice?.(req) !== true) {
      send(res, 403, { error: { code: 'FORBIDDEN', message: '只能在主人的设备上查看' } });
      return true;
    }
    try {
      const parts = path.split('/').slice(2).map(value => {
        try { return decodeURIComponent(value); }
        catch { throw new BffError('INVALID_INPUT', '路径无效', 400); }
      });
      const opts = Object.fromEntries(url.searchParams);
      const position = ['before', 'after', 'around', 'limit', 'unread'];
      const allowed = parts[1] === 'search' ? ['q', 'limit'] : parts.length === 1 ? [...position, 'segment', 'topic'] :
        parts[1] === 'segment' ? position : [];
      if ([...url.searchParams.keys()].some(key => !allowed.includes(key))
        || [...url.searchParams.keys()].length !== Object.keys(opts).length) {
        throw new BffError('INVALID_INPUT', '请求参数无效', 400);
      }
      let value, status = 200;
      const get = ['GET', 'HEAD'].includes(req.method), action = parts[1], id = parts[2];
      if (get) {
        if (!parts.length) value = await topics.threadList();
        else if (parts.length === 1) value = await topics.page(parts[0], opts);
        else if (parts.length === 2 && action === 'current') value = await core.current(parts[0]);
        else if (parts.length === 2 && action === 'search') value = await core.search(parts[0], opts);
        else if (parts.length === 2 && action === 'topics') value = await topics.list(parts[0]);
        else if (parts.length === 3 && action === 'send') value = await topics.getSend(parts[0], id);
        else if (parts.length === 3 && action === 'segment') value = await topics.page(parts[0], opts, id);
        else throw new BffError('NOT_FOUND', '路径不存在', 404);
      } else {
        const input = await readBody(req);
        if (req.method === 'POST' && parts.length === 2 && action === 'send') {
          if (!input.idem && req.headers['idempotency-key']) input.idem = req.headers['idempotency-key'];
          value = await topics.send(parts[0], input); status = value.duplicate ? 200 : 202;
        } else if (req.method === 'POST' && parts.length === 2 && action === 'reassign') {
          value = await topics.reassign(parts[0], input);
        } else if (req.method === 'PATCH' && parts.length === 3 && action === 'topics') {
          value = await topics.rename(parts[0], id, input);
        } else if (req.method === 'POST' && parts.length === 4 && action === 'topics' && parts[3] === 'merge') {
          value = await topics.merge(parts[0], id, input);
        } else if (req.method === 'POST' && parts.length === 4 && action === 'topics' && parts[3] === 'unmerge') {
          if (Object.keys(input).length) throw new BffError('INVALID_INPUT', '请求字段无效', 400);
          value = await topics.unmerge(parts[0], id);
        } else if (req.method === 'POST' && parts.length === 4 && action === 'send'
          && ['hold', 'cancel'].includes(parts[3])) {
          if (Object.keys(input).length) throw new BffError('INVALID_INPUT', '请求字段无效', 400);
          value = await topics.controlSend(parts[0], id, parts[3]);
        } else throw new BffError('METHOD_NOT_ALLOWED', '请求方法不支持', 405);
      }
      send(res, status, value);
    } catch (error) {
      const known = error instanceof BffError;
      send(res, known ? error.status : 503, { error: {
        code: known ? error.code : 'UNAVAILABLE', message: known ? error.message : '暂时读不到对话，请稍后再试',
      } });
    }
    return true;
  };
}
