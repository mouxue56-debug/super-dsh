import { createUnread } from '../unread.mjs';

const LIMIT = 65536;

function send(res, status, value) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= LIMIT) chunks.push(chunk);
  }
  if (size > LIMIT) return { error: 'too-large' };
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return { error: 'json' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'object' };
  return { value };
}

// 挂在密钥校验之后。不登记进加载器的公开名单，也不在这里自己读密钥。
export function createHandler(deps = {}) {
  const core = createUnread(deps);
  return async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      return false;
    }
    const pathname = url.pathname.replace(/\/+$/u, '') || '/';
    if (pathname !== '/unread' && !pathname.startsWith('/unread/')) return false;
    if (deps.isTrusted?.(req) !== true) {
      send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'BFF key required' } });
      return true;
    }
    try {
      if (pathname === '/unread') {
        if (req.method !== 'GET') {
          send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } });
          return true;
        }
        const result = await core.counts();
        send(res, result.status, result.body);
        return true;
      }
      if (pathname !== '/unread/read') {
        send(res, 404, { error: { code: 'NOT_FOUND', message: '路径不存在' } });
        return true;
      }
      if (req.method !== 'POST') {
        send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } });
        return true;
      }
      const body = await readBody(req);
      if (body.error === 'too-large') {
        send(res, 413, { error: { code: 'INVALID_INPUT', message: '请求体过大' } });
        return true;
      }
      if (body.error) {
        send(res, 400, { error: { code: 'INVALID_INPUT', message: '请求体不是 JSON 对象' } });
        return true;
      }
      if (Object.keys(body.value).some((key) => key !== 'conversation' && key !== 'upTo')) {
        send(res, 400, { error: { code: 'INVALID_INPUT', message: '请求里有不认识的字段' } });
        return true;
      }
      const result = await core.mark(body.value);
      send(res, result.status, result.body);
    } catch {
      if (!res.headersSent) {
        send(res, 500, { error: { code: 'INTERNAL', message: '未读暂时算不出来' } });
      } else {
        res.end();
      }
    }
    return true;
  };
}
