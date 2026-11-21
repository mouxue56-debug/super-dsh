// 后端自建的单步文字归类会话。标识只收紧权限，不依赖会无限增长的只聊天名单。
export function isTopicSession(id) {
  return typeof id === 'string'
    && /^hub-topic-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id);
}
