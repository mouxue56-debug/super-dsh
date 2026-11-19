// 以后各扩展单测需要构造 deps 时，必须从本工厂取得真实接线。
import { fileURLToPath } from 'node:url';

process.env.HUB_BFF_TEST_TMP = fileURLToPath(new URL('./.tmp/', import.meta.url));
const { fixture, request, assistantEvent } = await import('./fixtures.mjs');

// 用真实处理器的装配结果创建测试环境。
export async function realDeps(options = {}) {
  const f = await fixture(options);
  return { f, deps: f.handler.deps, request: input => request(f.handler, input) };
}

// 在内核接受提示后，异步向对应会话发送回复和结束事件。
export function autoReply(source, responder) {
  const sequences = new Map();
  source.rpcOverride = async envelope => {
    if (envelope.method !== 'session/prompt') return undefined;
    const { sessionId, content } = envelope.payload.args.request;
    const text = content.map(item => item.text ?? '').join('');
    setImmediate(() => {
      const seq = (sequences.get(sessionId) ?? 0) + 1;
      sequences.set(sessionId, seq + 1);
      source.emit(assistantEvent(seq, responder(sessionId, text)), sessionId);
      source.emit({type: 'event', event: {seq: seq + 1, type: 'turn/end',
        data: {reason: {kind: 'completed'}}}}, sessionId);
    });
    return undefined;
  };
}
