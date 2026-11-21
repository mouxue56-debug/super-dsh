import { randomUUID } from 'node:crypto';
import { createSessionWithModel } from './model-select.mjs';

// 复用内核已登录的提供方及助理模型选择。独立只聊天会话不登记进主人的会话清单。
export async function topicModel(deps, { bot, prompt, signal }) {
  if (typeof deps.kernel?.prompt !== 'function' || typeof deps.kernel?.follow !== 'function') {
    throw new Error('没有短文字模型通道');
  }
  const ownId = 'hub-topic-' + randomUUID();
  let id, stream, completed = false, cancelled = false;
  const cancelOwn = () => {
    if (id && !completed && !cancelled) {
      cancelled = true;
      void deps.kernel.cancel?.(id).catch(() => {});
    }
  };
  const check = () => { if (signal.aborted) throw new Error('话题归类超时'); };
  const abort = () => {
    stream?.dispose();
    cancelOwn();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    const isolated = { ...deps, kernel: { ...deps.kernel, createSession: async args => {
      const session = await deps.kernel.createSession({ ...args, sessionId: ownId });
      if (session.id !== ownId) throw new Error('话题整理会话编号不一致');
      id = ownId;
      return session;
    } } };
    const value = await createSessionWithModel(isolated, {
      bot, title: '话题整理', cwd: await deps.botCwd(bot),
    });
    id = value.sessionId;
    check();
    stream = await deps.kernel.follow(id);
    check();
    await deps.kernel.prompt(id, prompt);
    let text = '';
    for await (const event of stream) {
      check();
      if (event.type === 'message' && event.role === 'assistant') text = event.text ?? '';
      if (event.type === 'delta') text += event.text ?? '';
      if (text.length > 2048) throw new Error('话题归类回答太长');
      if (event.type === 'error') throw new Error('话题归类失败');
      if (event.type === 'done') { completed = true; return text; }
    }
    throw new Error('话题归类没有回答');
  } finally {
    signal.removeEventListener('abort', abort);
    stream?.dispose();
    cancelOwn();
  }
}
