// POST /uploads/。文件名在 x-filename，会话和助理在查询参数里。
import { acceptUpload, headerValue, routePath, sendFailure, sendJson } from '../uploads.mjs';

export function createHandler(deps = {}) {
  return async (req, res) => {
    const pathname = routePath(req);
    if (pathname !== '/uploads') return false;
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method', message: '只接受 POST' });
      return true;
    }
    if (deps.isTrusted?.(req) !== true) {
      sendJson(res, 401, { ok: false, error: 'unauthorized', message: '需要密钥' });
      return true;
    }
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const result = await acceptUpload(deps, {
        req,
        conversation: url.searchParams.get('conversation') ?? '',
        bot: url.searchParams.get('bot') ?? '',
        filename: headerValue(req, 'x-filename'),
        requestId: headerValue(req, 'x-request-id'),
        mime: headerValue(req, 'content-type'),
      });
      sendJson(res, result.status, result.body);
    } catch (error) {
      sendFailure(res, error, '收件没有完成');
    }
    return true;
  };
}
