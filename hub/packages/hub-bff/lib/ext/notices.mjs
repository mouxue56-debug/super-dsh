// 站内一句的 HTTP 入口。只读 GET，不发推送、邮件或消息。
//
import { createOwnerNotices } from '../owner-notices.mjs';

function send(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(value));
}

async function drain(req) {
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) break;
  }
}

// 挂在密钥校验之后。路径只认 /notices。
export function createHandler(deps = {}) {
  const core = createOwnerNotices(deps);
  return async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      return false;
    }
    const pathname = url.pathname.replace(/\/+$/u, '') || '/';
    if (pathname !== '/notices') return false;
    if (deps.isTrusted?.(req) !== true) {
      send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'BFF key required' } });
      return true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      await drain(req);
      send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } });
      return true;
    }
    try {
      const result = await core.current({ viewing: url.searchParams.get('viewing') ?? '' });
      const body = {
        ok: result.ok === true,
        notice: result.ok ? result.notice : null,
        quiet: result.quiet === true,
        stopped: result.stopped === true,
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end();
        return true;
      }
      send(res, 200, body);
    } catch {
      if (!res.headersSent) {
        send(res, 500, { ok: false, notice: null, error: { code: 'INTERNAL', message: '这句话暂时算不出来' } });
      } else {
        res.end();
      }
    }
    return true;
  };
}
