import { checkEvidenceShape } from './group-evidence.mjs';

export const OWNER = 'owner';
export const TICKET_STATUS = Object.freeze({
  TODO: 'todo', DOING: 'doing', REVIEW: 'review', REWORK: 'rework', DONE: 'done', WAIT_OWNER: 'wait_owner'
});

/** 同一进程内按工单串行化的队尾；防止并发的读后写互相覆盖。 */
const ticketLocks = new Map();

/** 在工单锁里执行 fn：同一工单的调用排队，先到先做，后到的会读到最新状态。 */
async function withTicketLock(key, fn) {
  const prev = ticketLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  ticketLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (ticketLocks.get(key) === tail) {
      ticketLocks.delete(key);
    }
  }
}

/** 选择流水线中的下一位合格验收者。 */
export function pickVerifier({ ticket, group, overrides = {} }) {
  if (overrides[ticket.assignee] !== undefined) {
    return overrides[ticket.assignee];
  }
  const ids = group.pipeline ?? group.members.map(m => m.id);
  if (ids.length < 2) {
    return null;
  }
  const index = ids.indexOf(ticket.assignee);
  if (index < 0) {
    return ids.find(id => id !== ticket.assignee) ?? null;
  }
  for (let n = 1; n <= ids.length; n++) {
    const id = ids[(index + n) % ids.length];
    if (id !== ticket.assignee) {
      return id;
    }
  }
  return null;
}

/** 校验并创建带验收清单的工单。 */
export async function assignTicket({ store, group, input }) {
  if (!input.title?.trim() || !input.goal?.trim()) {
    throw new Error('标题和目标不能为空');
  }
  if (!group.members.some(m => m.id === input.assignee)) {
    throw new Error('执行者必须是组成员');
  }
  if (!Array.isArray(input.checklist) || !input.checklist.length ||
    input.checklist.some(x => typeof x !== 'string' || !x.trim())) {
    throw new Error('验收清单必须包含非空条目');
  }
  const verifier = input.verifier ?? pickVerifier({
    ticket: input, group
  });
  if (verifier === input.assignee) {
    throw new Error('验收者不能与执行者相同');
  }
  if (!verifier || (!group.members.some(m => m.id === verifier) && verifier !== group.reviewer)) {
    throw new Error('验收者必须是组成员或指定复核者');
  }
  return store.create({
    type: 'work',
    groupId: group.id,
    title: input.title,
    goal: input.goal,
    assignee: input.assignee,
    verifier,
    checklist: input.checklist.map(text => ({ text })),
    milestone: !!input.milestone,
    status: 'todo',
    acked: false,
    rejections: 0
  });
}

/** 生成去除空白后的相邻字符对集合。 */
function bigrams(s) {
  const a = Array.from(s.replace(/\s+/gu, ''));
  const set = new Set();
  for (let i = 0; i < a.length - 1; i++) {
    set.add(a[i] + a[i + 1]);
  }
  return set;
}

/** 比较复述与目标和验收清单的相似度。 */
export function checkAck({ ticket, restatement, minScore = 0.25 }) {
  const target = [
    ticket.goal, ...ticket.checklist.map(x => x.text)
  ].join(' ');
  const a = bigrams(target);
  const b = bigrams(restatement ?? '');
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([
    ...a, ...b
  ]).size;
  const score = union ? intersection / union : 0;
  const goalFragments = [...bigrams(ticket.goal)];
  const goalMentioned = goalFragments.some(x => (restatement ?? '').replace(/\s+/gu, '').includes(x));
  const missing = [];
  if (!goalMentioned) {
    missing.push('目标关键片段');
  }
  if (score < minScore) {
    missing.push('复述相似度不足');
  }
  return {
    ok: missing.length === 0,
    score,
    missing,
    correction: missing.length
      ? `请按目标重述：${ticket.goal}；验收：${ticket.checklist.map(x => x.text).join('、')}`
      : ''
  };
}

/** 复述符合要求后接收工单。 */
export function acceptTicket({ store, ticketId, restatement, minScore, by }) {
  return withTicketLock(ticketId, () => acceptTicketNow({ store, ticketId, restatement, minScore, by }));
}

/** 接单的实际过程（在工单锁内执行）；传了 by 就必须是执行者本人。 */
async function acceptTicketNow({ store, ticketId, restatement, minScore, by }) {
  const ticket = await store.get(ticketId);
  if (!ticket) {
    throw new Error('工单不存在');
  }
  if (by !== undefined && by !== ticket.assignee) {
    throw new Error('只有执行者可以接单');
  }
  if (ticket.status !== 'todo') {
    throw new Error('只有待办工单可以接单');
  }
  // 复述对不上只给提示，不拦开工：照常开工，acked 记录复述是否对得上
  const result = checkAck({
    ticket, restatement, minScore
  });
  const updated = await store.update(ticketId, {
    status: 'doing', acked: result.ok
  }, { expect: { status: 'todo' } });
  return {
    ok: true,
    ticket: updated,
    score: result.score,
    warning: !result.ok,
    correction: result.ok ? '' : result.correction
  };
}

/** 将执行中的工单提交验收。 */
export function submitForReview({ store, ticketId, by }) {
  return withTicketLock(ticketId, () => submitForReviewNow({ store, ticketId, by }));
}

/** 提交验收的实际过程（在工单锁内执行）。 */
async function submitForReviewNow({ store, ticketId, by }) {
  const ticket = await store.get(ticketId);
  if (!ticket) {
    throw new Error('工单不存在');
  }
  if (by !== ticket.assignee) {
    throw new Error('只有执行者可以提交');
  }
  if (![
    'doing', 'rework'
  ].includes(ticket.status)) {
    throw new Error('工单状态不能提交验收');
  }
  return store.update(ticketId, {
    status: 'review', history: [
      ...(ticket.history ?? []), {
        by, at: Date.now(), result: 'review'
      }
    ]
  }, { expect: { status: ticket.status } });
}

const placeholders = new Set([
  '无', '没有', '-', '—', 'n/a', '无证据', '略', '同上', '见上', 'none', 'ok', 'okay', 'done', 'pass', 'passed',
  'yes', 'lgtm', '好', '好的', '行', '可以', '通过', '已通过', '没问题', '确认', '已确认', '完成', '已完成', '收到'
]);
/** 证据最短长度（按码点，去掉首尾空白后）。 */
export const MIN_EVIDENCE_LENGTH = 8;
/** 可核对的指针：消息号、文件路径、带扩展名的文件名、反引号命令或常见命令行。 */
const POINTERS = [
  /#\d+/u,
  /[\p{L}\p{N}_.~-]+\/[\p{L}\p{N}_.~/-]+/u,
  /[\p{L}\p{N}_-]+\.[A-Za-z][A-Za-z0-9]{0,7}(?![\p{L}\p{N}])/u,
  /`[^`\n]{2,}`/u,
  /(?:^|[\s：:])(?:npm|npx|pnpm|yarn|node|git|curl|grep|rg|ls|cat|diff|sh|bash|make|pytest|python3?|cargo|go)\s+\S+/iu,
];

// 只认示例里那几句占位话本身及其明显变体；……等符号本身不算占位。
const PLACEHOLDER_PHRASES = [
  '证据：看了哪个文件的哪一处、看到了什么', '看了哪个文件的哪一处', '看了哪个文件', '哪个文件', '哪一处', '看到了什么',
  '写看到了什么', '你实际看到的', '实际看到的', '你看到的', '产出文件路径', '文件路径', '通过或退回', 'pass 或 fail',
  'pass or fail', '<文件路径>', '<你实际看到的>',
];

// 把一句占位话变成「字之间可有空白」的正则。
function phraseRegex(phrase) {
  const chars = [...phrase.normalize('NFKC').replace(/\s+/gu, '')];
  return new RegExp(chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s*'), 'giu');
}

// 长的先去，免得短的先吃掉一半留下零头。
const PLACEHOLDER_RES = [...PLACEHOLDER_PHRASES].sort((x, y) => y.length - x.length).map(phraseRegex);
// 只剩这些「看」的字眼不算说了看到什么。
const LOOK_WORDS = /看了|看过|查看|打开|见|看|证据|里|中|的|写|填/gu;

// 去掉已知占位话，返回剩下的原文（保留空白，便于认指针）。
function stripPlaceholders(text) {
  let rest = text.normalize('NFKC');
  for (const re of PLACEHOLDER_RES) {
    rest = rest.replace(re, ' ');
  }
  return rest.replace(/\s+/gu, ' ').trim();
}

// 旧的「像不像占位话」判断只留作更友好的报错提示，不再决定通过与否。
function looksLikePlaceholder(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  const bare = value.toLowerCase().replace(/[\s\p{P}\p{S}\p{Cf}]/gu, '');
  if (!value || placeholders.has(value.toLowerCase()) || placeholders.has(bare)) {
    return true;
  }
  return stripPlaceholders(value.replace(/\p{Cf}/gu, '')) !== value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/**
 * 证据格式检查（不读文件）。通过要有至少 12 字的引文并写明出处；退回要有至少 12 字的理由。
 * 第二个参数给了非空理由就按「退回」查；第三个参数可显式给 verdict。
 */
export function checkEvidence(evidence, reason = '', { verdict } = {}) {
  const mode = verdict ?? (typeof reason === 'string' && reason.trim() ? 'fail' : 'pass');
  const shape = checkEvidenceShape(evidence, { verdict: mode, reason });
  if (shape.ok || !looksLikePlaceholder(evidence)) {
    return shape;
  }
  return { ok: false, reason: `${shape.reason}（像是照抄了示例里的占位话）` };
}
// 纯函数层（没有文件可核对）仍用修H 的格式检查；结构性引文核对在运行时 verify 里做，生产只走那条路。
function legacyEvidenceCheck(evidence, reason = '') {
  const text = typeof evidence === 'string' ? evidence.trim() : '';
  const bare = text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  if (!text || placeholders.has(text.toLowerCase()) || placeholders.has(bare)) {
    return { ok: false, reason: '缺少有效证据' };
  }
  // 先去掉示例里的占位话，剩下的再判够不够长、有没有指针、有没有说看到了什么。
  const rest = stripPlaceholders(text);
  const placeholder = rest !== text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const tooShort = placeholder ? '证据去掉示例占位话后太短，请写你实际看到的内容' : `证据太短（至少 ${MIN_EVIDENCE_LENGTH} 字）`;
  if ([...rest.replace(/\s+/gu, '')].length < MIN_EVIDENCE_LENGTH) {
    return { ok: false, reason: tooShort };
  }
  if (!POINTERS.some((re) => re.test(rest))) {
    return { ok: false, reason: '证据缺可核对的指针（文件路径、消息号或命令）' };
  }
  let said = rest;
  for (const re of POINTERS) {
    said = said.replace(new RegExp(re.source, 'gu'), ' ');
  }
  // 退回时「看到了什么」可以写在 reason 里。
  said = `${said}${typeof reason === 'string' ? stripPlaceholders(reason) : ''}`;
  said = said.replace(/[\s\p{P}\p{S}]/gu, '').replace(LOOK_WORDS, '');
  if (!said) {
    return { ok: false, reason: '证据只有指针，没说看到了什么' };
  }
  return { ok: true, reason: '' };
}
// 将验收条目解析为清单的实际下标。
export function verdictItemIndex(ticket, item) {
  return typeof item === 'number' ? item : ticket.checklist.findIndex((x) => x.text === item);
}

/** 校验验收者、清单覆盖、结论和证据。 */
export function validateVerdicts({ ticket, verifier, verdicts }) {
  const errors = [];
  if (verifier === ticket.assignee) {
    errors.push('验收者不能与执行者相同');
  }
  if (verifier !== ticket.verifier) {
    errors.push('验收者不是工单指定人员');
  }
  if (ticket.status !== 'review') {
    errors.push('工单不在验收状态');
  }
  if (!Array.isArray(verdicts)) {
    return {
      ok: false, errors: [
        ...errors, '验收结果必须是数组'
      ]
    };
  }
  const covered = new Set();
  for (const v of verdicts) {
    const index = verdictItemIndex(ticket, v.item);
    if (!Number.isInteger(index) || index < 0 || index >= ticket.checklist.length || covered.has(index)) {
      errors.push('验收条目无效或重复');
      continue;
    }
    covered.add(index);
    if (![
      'pass', 'fail'
    ].includes(v.verdict)) {
      errors.push(`第 ${index + 1} 项结论无效`);
    }
    const checked = legacyEvidenceCheck(v.evidence, v.verdict === 'fail' ? v.reason : '');
    if (!checked.ok) {
      errors.push(`第 ${index + 1} 项${checked.reason}`);
    }
    if (v.verdict === 'fail' && (typeof v.reason !== 'string' || !v.reason.trim())) {
      errors.push(`第 ${index + 1} 项缺少退回理由`);
    }
  }
  if (covered.size !== ticket.checklist.length) {
    errors.push('验收清单未逐条覆盖');
  }
  return {
    ok: errors.length === 0, errors
  };
}

/** 创建里程碑复核工单或说明无法分配的原因。 */
export function makeReviewTicket({ ticket, group }) {
  if (!group.reviewer) {
    return {
      needsOwner: true, reason: '未配置复核者'
    };
  }
  if (group.reviewer === ticket.assignee) {
    return null;
  }
  // 验收者不能是做的人、复核者本人，也不能是原来验这张单的人；优先主持，其次其他成员
  const barred = new Set([ticket.assignee, group.reviewer, ticket.verifier]);
  const verifier = [group.host, ...group.members.map(m => m.id)].find(id => id && !barred.has(id));
  if (!verifier) {
    return {
      needsOwner: true, reason: '没有既不是做的人、也不是原验收者的合格验收者'
    };
  }
  return {
    type: 'review',
    parentId: ticket.id,
    groupId: ticket.groupId,
    title: `复核：${ticket.title}`,
    goal: ticket.goal,
    assignee: group.reviewer,
    verifier,
    checklist: [
      ...ticket.checklist.map(x => ({ ...x })), { text: '对照主人原话与目标，产出是否真的满足' }
    ], milestone: false, status: 'todo', rejections: 0, acked: false
  };
}

/** 确定事件是否通知主人以及通知级别。 */
export function ownerNoticePolicy(event) {
  if ([
    'plan_ready', 'needs_approval', 'stuck', 'needsOwner'
  ].includes(event)) {
    return {
      notify: true, level: 'ask'
    };
  }
  if ([
    'milestone', 'finished'
  ].includes(event)) {
    return {
      notify: true, level: 'inform'
    };
  }
  return {
    notify: false, level: 'silent'
  };
}

/** 记录有效验收并处理退回或里程碑复核。 */
export function submitVerification({ store, group, ticketId, verifier, verdicts }) {
  return withTicketLock(ticketId, () => submitVerificationNow({ store, group, ticketId, verifier, verdicts }));
}

/** 验收的实际过程（在工单锁内执行：先比较状态再写，并发只算一次）。 */
async function submitVerificationNow({ store, group, ticketId, verifier, verdicts }) {
  const ticket = await store.get(ticketId);
  if (!ticket) {
    throw new Error('工单不存在');
  }
  const validation = validateVerdicts({
    ticket, verifier, verdicts
  });
  if (!validation.ok) {
    return {
      ok: false,
      status: ticket.status,
      rejections: ticket.rejections,
      ownerNotice: null,
      followUps: [],
      errors: validation.errors
    };
  }
  const failed = verdicts.some(v => v.verdict === 'fail');
  const rejections = (ticket.rejections ?? 0) + (failed ? 1 : 0);
  const limit = group.limits?.rejectLimit ?? 2;
  const status = failed ? (rejections >= limit ? 'wait_owner' : 'rework') : 'done';
  const savedVerdicts = verdicts.map(v => v.verdict === 'fail' ? {
    ...v, reason: v.reason.includes('〔异议〕') ? v.reason : `〔异议〕${v.reason}`
  } : { ...v });
  const history = [
    ...(ticket.history ?? []), {
      by: verifier, at: Date.now(), result: status, verdicts: savedVerdicts
    }
  ];
  try {
    await store.update(ticketId, {
      status, rejections, verdicts: savedVerdicts, history
    }, { expect: { status: 'review', rejections: ticket.rejections ?? 0 } });
  } catch (e) {
    if (e?.code !== 'CONFLICT') {
      throw e;
    }
    return {
      ok: false, status: ticket.status, rejections: ticket.rejections, ownerNotice: null, followUps: [],
      errors: ['工单已被别处改动，请重读后再验']
    };
  }
  let ownerNotice = status === 'wait_owner' ? 'stuck' : null;
  const followUps = [];
  const errors = [];
  if (!failed && ticket.milestone) {
    ownerNotice = 'milestone';
    const review = makeReviewTicket({
      ticket, group
    });
    if (!review || review.needsOwner) {
      ownerNotice = 'needsOwner';
      errors.push(review?.reason ?? '复核者不能是原执行者');
    } else {
      followUps.push(await store.create(review));
    }
  }
  return {
    ok: true, status, rejections, ownerNotice, followUps, errors
  };
}
