// 接力：一件事按顺序经过几位，一棒交一棒。【AI建议】
// 这个文件只有纯函数：路线校验、卡上的接力数据结构、每一种状态怎么往下走。
// 谁来触发（助理工具、外部命令行、主人在界面上点、叫醒模块）都在别处；这里只管「卡变成什么样」。
// 没有路线的普通卡完全不经过这里（ticket.relay 不存在）。
import { BoardError } from './board-errors.mjs';

export const RELAY_MIN_STEPS = 2;
export const RELAY_MAX_STEPS = 8;
export const OWNER_NAME = 'owner';
const NAME = /^[A-Za-z0-9_.-]{1,64}$/u;
const WHO_TYPES = ['assistant', 'external', 'owner'];
export const RELAY_PHASES = ['running', 'gate', 'stuck', 'final', 'done', 'failed', 'halted'];
const STEP_STATUS = ['waiting', 'active', 'gate', 'stuck', 'done', 'failed'];
const iso = (value) => value === null || value === undefined ||
  (typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const maybeText = (value, max) => value === null || value === undefined || (typeof value === 'string' && value.length <= max);
const obj = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const bad = (message) => {
  throw new BoardError('INVALID', message);
};

// 去掉控制字符；按「字」截断。
export const flat = (value, max) => {
  const chars = Array.from(String(value ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/gu, ' ').trim());
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('');
};
// 多行文字：保留换行，去掉别的控制字符；按字数截断。
export const block = (value, max) => {
  const chars = Array.from(String(value ?? '').replace(/\r\n?/gu, '\n')
    .replace(/(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim());
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('');
};
// 按字节截断（报告摘要上限 2048 字节）。
export function clipBytes(text, maxBytes) {
  let out = '';
  let size = 0;
  for (const char of String(text ?? '')) {
    const bytes = Buffer.byteLength(char);
    if (size + bytes > maxBytes) return out + '…';
    out += char;
    size += bytes;
  }
  return out;
}

// 校验并整理路线。steps 里每一棒：{ who:{name,type}, task, doneWhen?, gate? }。
// who 已由调用方按名册和外部名单解析好；这里只管形状与规则。
export function parseRoute(steps, { min = RELAY_MIN_STEPS, first = true } = {}) {
  if (!Array.isArray(steps) || steps.length < min || steps.length > RELAY_MAX_STEPS) {
    bad(`接力要 ${RELAY_MIN_STEPS}–${RELAY_MAX_STEPS} 棒`);
  }
  return steps.map((raw, index) => {
    if (!obj(raw) || !obj(raw.who) || !NAME.test(raw.who.name ?? '') || !WHO_TYPES.includes(raw.who.type)) {
      bad(`第 ${index + 1} 棒没写清谁接`);
    }
    const task = flat(raw.task, 300);
    if (!task) bad(`第 ${index + 1} 棒没写要做什么`);
    const who = { name: raw.who.name, type: raw.who.type };
    if (who.type === 'owner') {
      if (index === 0 && first) bad('第 1 棒不能是主人，要先有人动手');
      who.name = OWNER_NAME;
    }
    if (raw.aside === true && who.type !== 'assistant') bad(`第 ${index + 1} 棒「另开一段会话」只适用于助理`);
    return {
      who,
      task,
      doneWhen: flat(raw.doneWhen ?? raw.done_when, 300),
      gate: who.type === 'owner' ? false : raw.gate === true,
      ...(raw.aside === true ? { aside: true } : {}),
    };
  });
}

const blankStep = (item) => ({
  who: item.who, task: item.task, doneWhen: item.doneWhen, gate: item.gate,
  ...(item.aside === true ? { aside: true } : {}),
  status: 'waiting', startedAt: null, deliveredAt: null, note: null, noteBy: null,
  question: null, stuckAt: null, resumedAt: null, gateAt: null, releasedAt: null, returnedNote: null,
  stalledAt: null, nudgedAt: null,
});

// 把整理好的路线做成卡上的 relay 数据（还没开始）。
export function newRelay(items) {
  return { v: 1, phase: 'running', current: 0, finalAt: null, steps: items.map(blankStep) };
}

const CLONE_ID = /^[^\p{Cc}\p{Zl}\p{Zp}]{1,80}$/u;
function cloneIdsOk(value) {
  return Array.isArray(value) && value.length <= 32 &&
    value.every((item) => typeof item === 'string' && CLONE_ID.test(item));
}
// 这一棒用过几个分身。缺省当作没有。坏数字或坏编号整段接力作废。
function clonesOk(step) {
  const countOk = step.clones == null ||
    Number.isSafeInteger(step.clones) && step.clones >= 0 && step.clones <= 32;
  if (!countOk) return false;
  if (step.cloneCalls != null && !cloneIdsOk(step.cloneCalls)) return false;
  if (step.cloneBack != null && !cloneIdsOk(step.cloneBack)) return false;
  return true;
}

// 结构校验：给 validateTicket 用。没有 relay 的卡不调用。
export function validRelay(relay) {
  if (!obj(relay) || relay.v !== 1 || !RELAY_PHASES.includes(relay.phase) || !Array.isArray(relay.steps)) return false;
  if (relay.steps.length < RELAY_MIN_STEPS || relay.steps.length > RELAY_MAX_STEPS) return false;
  if (!Number.isSafeInteger(relay.current) || relay.current < 0 || relay.current > relay.steps.length) return false;
  if (!iso(relay.finalAt)) return false;
  if (relay.halt !== undefined && relay.halt !== null && !(obj(relay.halt) && maybeText(relay.halt.name, 64) && iso(relay.halt.at))) return false;
  return relay.steps.every((step) => obj(step) && obj(step.who) && NAME.test(step.who.name ?? '') &&
    WHO_TYPES.includes(step.who.type) && typeof step.task === 'string' && step.task.length > 0 && step.task.length <= 600 &&
    maybeText(step.doneWhen, 600) && typeof step.gate === 'boolean' && STEP_STATUS.includes(step.status) &&
    ['startedAt', 'deliveredAt', 'stuckAt', 'resumedAt', 'gateAt', 'releasedAt', 'stalledAt', 'nudgedAt'].every((key) => iso(step[key])) &&
    maybeText(step.note, 8000) && maybeText(step.noteBy, 64) && maybeText(step.question, 4000) &&
    maybeText(step.returnedNote, 4000) && (step.aside == null || typeof step.aside === 'boolean') &&
    clonesOk(step));
}

export const stepOf = (ticket) => ticket.relay?.steps?.[ticket.relay.current] ?? null;
export const isRelay = (ticket) => Boolean(ticket?.relay);

// 让这一棒的人接上这张卡（单据上写成：负责人是他，进行中）。
function hand(ticket, step) {
  ticket.to = [step.who.name];
  ticket.claimedBy = step.who.name;
  ticket.claimedByType = step.who.type;
  ticket.state = 'progress';
  ticket.review = 'none';
  ticket.open_ask = null;
}

// 轮到第 j 棒（j 等于总棒数 = 全部走完，等发起人总验收）。返回 { wake } 供事件带出去。
export function activate(ticket, j, ts) {
  const relay = ticket.relay;
  relay.current = j;
  if (j >= relay.steps.length) {
    relay.phase = 'final';
    relay.finalAt = ts;
    ticket.state = 'progress';
    ticket.review = 'submitted';
    ticket.open_ask = null;
    return { relayEvent: 'final', ...(ticket.from?.type === 'owner'
      ? { attention: true, attentionKind: 'review', reason: '接力走完了，等你验收' } : {}) };
  }
  const step = relay.steps[j];
  step.startedAt = ts;
  if (step.who.type === 'owner') {
    step.status = 'gate';
    step.gateAt = ts;
    relay.phase = 'gate';
    ticket.to = [OWNER_NAME];
    ticket.claimedBy = OWNER_NAME;
    ticket.claimedByType = 'owner';
    ticket.state = 'waiting-human';
    ticket.review = 'none';
    ticket.open_ask = { text: `接力第 ${j + 1} 棒要你来：${step.task}`, ts };
    return { relayEvent: 'gate', attention: true, attentionKind: 'waiting-human', reason: ticket.open_ask.text };
  }
  step.status = 'active';
  relay.phase = 'running';
  hand(ticket, step);
  return { relayEvent: 'step' };
}

// 建卡时用的内部口令：只有后端代码拿得到，外面传来的 JSON 里带不了 Symbol，所以外部令牌没法借建卡接口塞进自己写的路线。
export const RELAY_INIT = Symbol('relay-init');

// 开始（建卡时）。
export function begin(ticket, ts) {
  return activate(ticket, 0, ts);
}

// 当前这一棒交回：记交接说明；有「要主人看」的就停在等你，否则交给下一棒（最后一棒就走向总验收）。
// reported=true 表示报告已经由别的路径（外部命令行的 report）写进卡里，这里不再重复写。
export function deliver(ticket, note, by, ts, { reported = false } = {}) {
  const relay = ticket.relay;
  const step = relay.steps[relay.current];
  const text = block(note, 6000);
  step.status = 'done';
  step.deliveredAt = ts;
  step.note = text || '（没写交接说明）';
  step.noteBy = by;
  step.question = null;
  if (!reported) {
    const summary = clipBytes(step.note, 2000);
    ticket.report = { ts, by, summary, file: null, sha256: null, selfReported: true };
    ticket.reports.push({ ...ticket.report, artifacts: [] });
  }
  if (step.gate) {
    relay.phase = 'gate';
    step.gateAt = ts;
    // 关口上的负责人改成主人。接棒人不再算「正在做的人」，普通恢复碰不到这张卡。
    ticket.to = [OWNER_NAME];
    ticket.claimedBy = OWNER_NAME;
    ticket.claimedByType = 'owner';
    ticket.state = 'waiting-human';
    ticket.review = 'none';
    ticket.open_ask = { text: `接力第 ${relay.current + 1} 棒做完了，等你看一眼再放行`, ts };
    return { relayEvent: 'gate', attention: true, attentionKind: 'waiting-human', reason: ticket.open_ask.text };
  }
  return activate(ticket, relay.current + 1, ts);
}

// 这一棒卡住：停下，问人。
export function stuck(ticket, question, ts) {
  const relay = ticket.relay;
  const step = relay.steps[relay.current];
  step.status = 'stuck';
  step.stuckAt = ts;
  step.question = block(question, 2000) || ticket.open_ask?.text?.slice(0, 2000) || '（没写问题）';
  relay.phase = 'stuck';
  return { relayEvent: 'stuck' };
}

// 回答之后接着做这一棒。
export function resume(ticket, ts) {
  const relay = ticket.relay;
  const step = relay.steps[relay.current];
  step.status = 'active';
  step.resumedAt = ts;
  relay.phase = 'running';
  ticket.state = 'progress';
  ticket.open_ask = null;
  return { relayEvent: 'resume' };
}

// 主人放行的是最后一棒，而且这张接力是主人自己发起的：放行就是验收，直接完成，不再多点一下。
// 助理发起的接力不在此列：最后仍叫发起人总验收（它答应过要验）。
function finishIfLast(ticket, result, ts) {
  const relay = ticket.relay;
  if (relay.phase !== 'final' || ticket.from?.type !== 'owner') return result;
  relay.phase = 'done';
  ticket.state = 'completed';
  ticket.review = 'accepted';
  ticket.open_ask = null;
  relay.finalAt = relay.finalAt ?? ts;
  return { relayEvent: 'done', notify: true };
}


// 主人在「等你」上放行（redo=false），或退回这一棒重做（redo=true，带一句话）。
export function release(ticket, ts, { redo = false, note = '' } = {}) {
  const relay = ticket.relay;
  const step = relay.steps[relay.current];
  step.releasedAt = ts;
  if (step.who.type === 'owner') {
    if (redo) bad('主人自己的这一棒不用退回');
    step.status = 'done';
    step.deliveredAt = ts;
    step.note = block(note, 2000) || '主人看过，放行';
    step.noteBy = OWNER_NAME;
    return finishIfLast(ticket, activate(ticket, relay.current + 1, ts), ts);
  }
  if (redo) {
    step.status = 'active';
    step.returnedNote = block(note, 2000) || '主人让这一棒再做一次';
    step.resumedAt = ts;
    step.deliveredAt = null;
    relay.phase = 'running';
    hand(ticket, step);
    return { relayEvent: 'resume' };
  }
  return finishIfLast(ticket, activate(ticket, relay.current + 1, ts), ts);
}

// 发起人总验收时退回：回到最后一棒。最后一棒是主人时，回到等主人放行的关口，不把主人标成「正在做」。
export function reopenLast(ticket, note, ts) {
  const relay = ticket.relay;
  const j = relay.steps.length - 1;
  const step = relay.steps[j];
  relay.current = j;
  relay.finalAt = null;
  step.returnedNote = block(note, 2000) || '发起人验收时退回，请补做';
  step.resumedAt = ts;
  step.deliveredAt = null;
  if (step.who.type === 'owner') {
    step.status = 'gate';
    step.gateAt = ts;
    relay.phase = 'gate';
    ticket.state = 'waiting-human';
    ticket.review = 'none';
    ticket.to = [OWNER_NAME];
    ticket.claimedBy = OWNER_NAME;
    ticket.claimedByType = 'owner';
    ticket.open_ask = { text: `接力第 ${j + 1} 棒要你来：${step.task}`, ts };
    return { relayEvent: 'gate', attention: true, attentionKind: 'waiting-human', reason: ticket.open_ask.text };
  }
  relay.phase = 'running';
  step.status = 'active';
  ticket.state = 'progress';
  ticket.open_ask = null;
  ticket.claimedBy = step.who.name;
  ticket.claimedByType = step.who.type;
  ticket.to = [step.who.name];
  return { relayEvent: 'resume' };
}

// 卡被人从别处挪回「待领」之类：把这一棒重新交给原来的人。
export function rehand(ticket, ts) {
  const relay = ticket.relay;
  const step = relay.steps[relay.current];
  step.status = 'active';
  step.resumedAt = ts;
  hand(ticket, step);
  return { relayEvent: 'resume' };
}

// 给人和助理读的路线摘要（纯文本，不带外来内容以外的东西）。
export function routeLines(ticket) {
  const relay = ticket.relay;
  const word = { waiting: '还没轮到', active: '正在做', gate: '等主人', stuck: '卡住了', done: '已交回', failed: '做不了' };
  return relay.steps.map((step, i) => `第 ${i + 1} 棒 ${step.who.type === 'owner' ? '主人' : step.who.name}`
    + (step.aside === true ? '（另开一段会话）' : '')
    + `（${word[step.status] ?? step.status}）：${step.task}`);
}

// ---- ----
// 接棒的助理停用或不在名册里：停下，等主人换人。步骤状态不动（还是这一棒），卡进「等你」。
export function halt(ticket, ts, { name, shown }) {
  const relay = ticket.relay;
  const text = `接力停在这里：${flat(shown || name, 30)}已停用，换个人接？`;
  relay.phase = 'halted';
  relay.halt = { name, at: ts };
  ticket.state = 'waiting-human';
  ticket.open_ask = { text, ts };
  return { relayEvent: 'halt', attention: true, attentionKind: 'waiting-human', reason: text };
}

// 给这一棒换人并继续（停用后换人、超时后换人）。新的人从这一刻起算，会被叫醒。
export function reassign(ticket, who, ts) {
  const relay = ticket.relay;
  const step = relay.steps[relay.current];
  step.who = { name: who.name, type: who.type };
  step.status = 'active';
  step.startedAt = ts;
  step.resumedAt = null;
  step.stuckAt = null;
  step.stalledAt = null;
  step.stalledMin = null;
  step.nudgedAt = null;
  step.question = null;
  relay.phase = 'running';
  relay.halt = null;
  hand(ticket, step);
  return { relayEvent: 'step' };
}

// 被叫醒后太久没动静：记一笔，今天页「等你处理」里出现提醒。不换人、不再叫；卡的状态不变（对方仍可交棒）。
export function markStalled(ticket, ts, minutes) {
  const step = ticket.relay.steps[ticket.relay.current];
  step.stalledAt = ts;
  step.stalledMin = Number.isSafeInteger(minutes) && minutes > 0 ? minutes : 30;
  return { relayEvent: 'stalled' };
}

// 主人点「再叫一次」：清掉提醒，再叫醒这一棒的人一次（叫醒模块按 nudgedAt 认这是新的一次）。
export function nudge(ticket, ts) {
  const step = ticket.relay.steps[ticket.relay.current];
  step.stalledAt = null;
  step.stalledMin = null;
  step.nudgedAt = ts;
  return { relayEvent: 'nudge' };
}
