import { parseMentions } from './group.mjs';
const OWNER = 'owner';
const ACK_WORDS = [
  '好的',
  '收到',
  '明白',
  '了解',
  '谢谢',
  '感谢',
  '辛苦',
  'ok',
  '好',
  '嗯',
  '行',
  '没问题',
  '同意',
];
/** 统一文本大小写并移除空白及标点。 */
const normalize = (s) => String(s ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** 复制会被更新的唤醒状态。 */
const copy = (s) => ({
  ...s,
  round: { ...s.round, woken: [...s.round.woken] },
  pending: [...s.pending],
  handoffs: { ...s.handoffs },
});

/** 创建空的可序列化唤醒状态。 */
export function initialWakeState() {
  return {
    round: { ownerMsgId: 0, woken: [] },
    pending: [],
    pendingSince: null,
    idleCount: 0,
    paused: false,
    pausedReason: null,
    handoffs: {},
  };
}

/** 判断文本是否为过话消息。 */
export function isPassMessage(text) {
  return /^(?:过|\[PASS\]|〔过〕)$/.test(String(text).replace(/\s/gu, ''));
}

/**
 * 数出一条消息有据可查的工具调用数：只认运行时传入的记录
 * （每条形如 { messageId, tool }，tool 为非空字符串），不信消息里自报的 toolCalls；没有记录就是 0。
 */
export function verifiedToolCalls(msg, toolRecords) {
  if (!Array.isArray(toolRecords)) {
    return 0;
  }
  return toolRecords.filter((r) =>
    r && r.messageId === msg.id && typeof r.tool === 'string' && r.tool.trim() !== ''
  ).length;
}

/** 识别没有工具调用的应答和重复消息；工具调用以 options.toolRecords 为准。 */
export function isIdleMessage(msg, recent = [], options = {}) {
  if (verifiedToolCalls(msg, options.toolRecords) !== 0 || isPassMessage(msg.text)) {
    return false;
  }
  const value = normalize(msg.text);
  if (recent.slice(-6).some((m) => normalize(m.text) === value)) {
    return true;
  }
  if (!value || [...value].length > 12) {
    return false;
  }
  const words = [...ACK_WORDS, ...(options.ackWords ?? [])].map(normalize).filter(Boolean).sort((
    a,
    b,
  ) => b.length - a.length);
  let remaining = value;
  while (remaining) {
    const word = words.find((w) => remaining.startsWith(w));
    if (!word) {
      return false;
    }
    remaining = remaining.slice(word.length);
  }
  return true;
}

/** 决定一条消息唤醒哪些成员。 */
export function decideWake({ group, message, state, now = Date.now(), recent = [], toolRecords }) {
  const next = copy(state);
  const wake = [], rejected = [], reasons = {};
  let pausedNow = false;
  const result = () => ({ wake, reasons, rejected, pausedNow, state: next });
  if (isPassMessage(message.text)) {
    return result();
  }
  if (message.from === OWNER) {
    next.paused = false;
    next.pausedReason = null;
    next.idleCount = 0;
    next.round = { ownerMsgId: message.id, woken: [] };
  } else {
    if (next.paused) {
      rejected.push({ id: null, reason: 'paused' });
      return result();
    }
    next.idleCount = isIdleMessage(message, recent, { toolRecords }) ? next.idleCount + 1 : 0;
    if (next.idleCount >= (group.limits?.idleLimit ?? 6)) {
      next.paused = true;
      next.pausedReason = `连续 ${next.idleCount} 条空转`;
      pausedNow = true;
      return result();
    }
  }
  let targets = message.to ?? parseMentions(message.text, group.members);
  let reason = 'mentioned';
  if (targets === 'all') {
    if (message.from !== OWNER && message.from !== group.host) {
      rejected.push({ id: null, reason: 'all_not_allowed' });
      targets = [];
    } else {
      targets = group.members.map((m) => m.id);
    }
  }
  if (!targets.length && message.from === OWNER && !rejected.length) {
    targets = [group.host];
    reason = 'host_default';
  }
  if (!targets.length && message.from !== OWNER) {
    next.pending.push(message);
    if (next.pendingSince === null) {
      next.pendingSince = now;
    }
  }
  for (const id of targets) {
    if (id === message.from) {
      continue;
    }
    if (!group.members.some((m) => m.id === id)) {
      rejected.push({ id, reason: 'not_member' });
      continue;
    }
    if (next.round.woken.includes(id)) {
      rejected.push({ id, reason: 'already_woken' });
      continue;
    }
    next.round.woken.push(id);
    wake.push(id);
    reasons[id] = reason;
  }
  return result();
}

/** 待处理消息达到数量或时间阈值时批量投递。 */
export function flushPending({ group, state, now = Date.now() }) {
  const next = copy(state);
  if (
    next.paused || !next.pending.length ||
    (next.pending.length < (group.limits?.batchMessages ?? 5) &&
      (next.pendingSince === null ||
        now - next.pendingSince < (group.limits?.batchSeconds ?? 30) * 1000))
  ) {
    return { deliver: [], state: next };
  }
  const deliver = group.members.map((m) => ({
    to: m.id,
    messages: next.pending.filter((msg) => msg.from !== m.id),
  })).filter((entry) => entry.messages.length);
  next.pending = [];
  next.pendingSince = null;
  return { deliver, state: next };
}

/** 检查是否允许再次交接。 */
export function checkHandoff(state, key, limits = {}) {
  const count = state.handoffs[key] ?? 0;
  return { ok: count < (limits.maxHandoffs ?? 4), count };
}

/** 记录一次交接，不修改输入状态。 */
export function recordHandoff(state, key) {
  const next = copy(state);
  next.handoffs[key] = (next.handoffs[key] ?? 0) + 1;
  return next;
}

/** 按 Unicode 码点检查消息长度。 */
export function checkLength(text, limits = {}) {
  const length = [...text].length, max = limits.maxChars ?? 150, over = Math.max(0, length - max);
  return {
    ok: over === 0,
    length,
    max,
    over,
    ...(over ? { hint: '长内容请落文件，发言里只给路径' } : {}),
  };
}
