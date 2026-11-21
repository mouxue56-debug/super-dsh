// POST /voice/。正文是原始音频，转写结果交回调用方，不替主人发消息。
// POST /voice/speak 按这条回复的文字取音频。
import { drain, headerValue, routePath, sendFailure, sendJson } from '../uploads.mjs';
import { acceptVoice } from '../voice.mjs';
import { acceptSpeech } from '../voice-tts.mjs';

export function createHandler(deps = {}) {
  return async (req, res) => {
    const pathname = routePath(req);
    if (pathname === '/voice/speak') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method', message: '只接受 POST' });
        return true;
      }
      if (deps.isTrusted?.(req) !== true) {
        sendJson(res, 401, { ok: false, error: 'unauthorized', message: '需要密钥' });
        return true;
      }
      try {
        const result = await acceptSpeech(deps, req);
        sendJson(res, result.status, result.body);
      } catch (error) {
        await drain(req);
        sendFailure(res, error, '这会儿念不出来');
      }
      return true;
    }
    if (pathname !== '/voice') return false;
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
      const result = await acceptVoice(deps, {
        req,
        conversation: url.searchParams.get('conversation') ?? '',
        bot: url.searchParams.get('bot') ?? '',
        requestId: headerValue(req, 'x-request-id'),
        mime: headerValue(req, 'content-type'),
        durationMs: url.searchParams.get('durationMs'),
      });
      sendJson(res, result.status, result.body);
    } catch (error) {
      sendFailure(res, error, '转写没有完成');
    }
    return true;
  };
}
