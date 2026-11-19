// 安装监听器，在每个会话首次执行时注入启动摘要。
export function installBootSlice(ctx, opts) {
  const name = opts.name ?? 'boot-slice', seen = new WeakSet();
  return ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
    const decision = await next();
    if (decision.kind === 'reject' || signal?.aborted) {
      return decision;
    }
    const session = agent?.session;
    if (!session || (typeof session !== 'object' && typeof session !== 'function')) {
      return decision;
    }
    if (seen.has(session)) {
      return decision;
    }
    try {
      if (Number.isSafeInteger(session.seq) && typeof session.eventAt === 'function') {
        for (let i = session.seq; i > Math.max(-1, session.seq - 2000); i--) {
          const event = session.eventAt(i);
          if (event?.type === 'user/message' && event.data?.source?.kind === name) {
            seen.add(session);
            return decision;
          }
        }
      }
    } catch {
    }
    try {
      const text = await opts.getSlice({ agent, turn, step });
      if (typeof text !== 'string' || !text) {
        return decision;
      }
      const message = opts.createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: name, form: 'snapshot', sections: [{ name, text }] },
      });
      const result = { ...decision, messages: [...decision.messages, message] };
      seen.add(session);
      return result;
    } catch {
      return decision;
    }
  }, { prepend: false });
}
