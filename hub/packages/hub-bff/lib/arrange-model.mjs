// 触发：首席安排与卡片定时的数据结构、校验、时间换算（纯函数，不碰文件）。【AI建议】
//
// 卡上两个可选字段（旧卡没有，完全不受影响）：
//   arrange  「首席安排」：state = wanted（等首席给结论）/ proposed（等主人点头）/ applied（已安排）/ declined（主人说先不做）
//   schedule 「什么时候做」：once（某一时刻）/ daily / weekly；重复的卡是「定时模板」，到点生成当次的子卡
// 两个字段都只由后端内部口令写（Symbol 或看板自己的操作），外面传来的 JSON 里同名字段一律不理。
import { parseRoute } from './relay-model.mjs';
import { isQuiet } from './handoff.mjs';
import { sensitiveText } from '../../hub-plugin/permission-mode.mjs';

export const ARRANGE_INIT = Symbol('arrange-init');
export const SCHEDULE_INIT = Symbol('schedule-init');
export const ARRANGE_STATES = Object.freeze(['wanted', 'proposed', 'applied', 'declined']);
export const ARRANGE_VIA = Object.freeze(['new', 'drag', 'button', 'schedule']);
export const SCHEDULE_KINDS = Object.freeze(['once', 'daily', 'weekly']);
export const SCHEDULE_STATES = Object.freeze(['waiting', 'fired', 'missed', 'paused']);
// 档位：写在卡片说明里的标签，外部接单器按它选模型。
export const TIERS = Object.freeze({ simple: '【简单】', complex: '【复杂】', image: '要出图' });
export const TIER_TAG = /【简单】|【复杂】|【出图】|要出图|档\s*[:：]\s*\S+/u;
export const GRACE_MS_DEFAULT = 6 * 3600000;
const NAME = /^[A-Za-z0-9_.-]{1,64}$/u;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/u;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
export const cut = (value, max) => Array.from(String(value ?? '').replace(CONTROL, ' ').trim()).slice(0, max).join('');

// ---------- 结构校验（给 validateTicket 用） ----------
function validWho(who) {
  return who === null || (obj(who) && NAME.test(who.name ?? '') && ['assistant', 'external'].includes(who.type));
}

export function validPlan(plan) {
  if (!obj(plan)) return false;
  if (!['bot', 'external', 'relay'].includes(plan.kind)) return false;
  if (plan.kind !== 'relay' && !(obj(plan.who) && NAME.test(plan.who.name ?? '') &&
    ['assistant', 'external'].includes(plan.who.type))) return false;
  if (plan.tier !== undefined && plan.tier !== null && !(plan.tier in TIERS)) return false;
  if (plan.kind === 'relay' && !Array.isArray(plan.steps)) return false;
  if (!obj(plan.when) || !['now', 'once', 'daily', 'weekly'].includes(plan.when.kind)) return false;
  if (plan.when.kind === 'once' && !iso(plan.when.at)) return false;
  if (['daily', 'weekly'].includes(plan.when.kind) && !CLOCK.test(plan.when.time ?? '')) return false;
  if (plan.when.kind === 'weekly' && !(Array.isArray(plan.when.days) && plan.when.days.length &&
    plan.when.days.every(d => Number.isInteger(d) && d >= 1 && d <= 7))) return false;
  return typeof plan.why === 'string' && plan.why.length <= 600 &&
    typeof plan.askOwner === 'boolean' && typeof plan.askReason === 'string' && plan.askReason.length <= 400;
}

export function validArrange(value) {
  if (!obj(value) || !ARRANGE_STATES.includes(value.state) || !ARRANGE_VIA.includes(value.via)) return false;
  if (!iso(value.requestedAt)) return false;
  if (value.attempts !== undefined && !(Number.isInteger(value.attempts) && value.attempts >= 0 && value.attempts <= 20)) return false;
  if (value.plan !== undefined && !validPlan(value.plan)) return false;
  if (value.needs !== undefined && !(Array.isArray(value.needs) && value.needs.length <= 8 && value.needs.every(item =>
    obj(item) && typeof item.code === 'string' && item.code.length <= 20 && typeof item.text === 'string' &&
    item.text.length <= 400))) return false;
  if (value.note !== undefined && !(typeof value.note === 'string' && value.note.length <= 800)) return false;
  for (const key of ['proposedAt', 'decidedAt', 'appliedAt']) {
    if (value[key] !== undefined && !iso(value[key])) return false;
  }
  if (value.decision !== undefined && !['ok', 'swap', 'skip', 'auto'].includes(value.decision)) return false;
  if (value.stalled !== undefined && typeof value.stalled !== 'boolean') return false;
  return true;
}

export function validSchedule(value) {
  if (!obj(value) || !SCHEDULE_KINDS.includes(value.kind) || !SCHEDULE_STATES.includes(value.state)) return false;
  if (typeof value.template !== 'boolean' || value.template !== (value.kind !== 'once')) return false;
  if (value.kind === 'once' && !iso(value.at)) return false;
  if (value.kind !== 'once' && !CLOCK.test(value.time ?? '')) return false;
  if (value.kind === 'weekly' && !(Array.isArray(value.days) && value.days.length &&
    value.days.every(d => Number.isInteger(d) && d >= 1 && d <= 7))) return false;
  if (!validWho(value.assignee ?? null)) return false;
  if (value.tier !== undefined && value.tier !== null && !(value.tier in TIERS)) return false;
  for (const key of ['lastSlot', 'firedAt', 'createdAt']) {
    if (value[key] !== undefined && value[key] !== null && !iso(value[key])) return false;
  }
  if (value.missed !== undefined && !(Array.isArray(value.missed) && value.missed.length <= 20 &&
    value.missed.every(iso))) return false;
  if (value.by !== undefined && !['owner', 'chief'].includes(value.by)) return false;
  return true;
}

// ---------- 时间 ----------
const pad = n => String(n).padStart(2, '0');
const clockMin = text => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
const dayMs = 86400000;
// 本地日期（YYYY-MM-DD）与星期（周一 1 … 周日 7）
export const localDay = (ms, offset) => new Date(ms + offset * 60000).toISOString().slice(0, 10);
export const isoWeekday = date => (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7 + 1;
// 某个本地日期、HH:MM 对应的绝对时刻
export const slotMs = (date, time, offset) => Date.parse(date + 'T00:00:00Z') + clockMin(time) * 60000 - offset * 60000;
export const slotIso = (date, time, offset) => new Date(slotMs(date, time, offset)).toISOString();

// 重复卡：不晚于 nowMs 的最近一个排班时刻（往回最多找 8 天）；没有返回 null。
export function latestSlot(schedule, nowMs, offset) {
  if (!schedule || schedule.kind === 'once') return null;
  for (let back = 0; back <= 8; back += 1) {
    const date = localDay(nowMs - back * dayMs, offset);
    if (schedule.kind === 'weekly' && !schedule.days.includes(isoWeekday(date))) continue;
    const at = slotMs(date, schedule.time, offset);
    if (at <= nowMs) return { date, at, iso: new Date(at).toISOString() };
  }
  return null;
}

// 开区间 (fromMs, toMs) 里的排班时刻（最多 20 个，按时间顺序），数「被跳过的」用
export function slotsBetween(schedule, fromMs, toMs, offset) {
  if (!schedule || schedule.kind === 'once' || !(toMs > fromMs)) return [];
  const out = [];
  const first = localDay(fromMs, offset);
  for (let day = Date.parse(first + 'T00:00:00Z'); day <= toMs + 2 * dayMs && out.length < 20; day += dayMs) {
    const date = new Date(day).toISOString().slice(0, 10);
    if (schedule.kind === 'weekly' && !schedule.days.includes(isoWeekday(date))) continue;
    const at = slotMs(date, schedule.time, offset);
    if (at > fromMs && at < toMs) out.push(new Date(at).toISOString());
  }
  return out;
}

// 下一个排班时刻（给界面显示用）
export function nextSlot(schedule, nowMs, offset) {
  if (!schedule) return null;
  if (schedule.kind === 'once') return Date.parse(schedule.at);
  for (let ahead = 0; ahead <= 8; ahead += 1) {
    const date = localDay(nowMs + ahead * dayMs, offset);
    if (schedule.kind === 'weekly' && !schedule.days.includes(isoWeekday(date))) continue;
    const at = slotMs(date, schedule.time, offset);
    if (at > nowMs) return at;
  }
  return null;
}

// 夜间（22:00–08:00）之后的第一个早上 08:00（本地）
export function nextMorning(ms, offset) {
  const date = localDay(ms, offset);
  let at = slotMs(date, '08:00', offset);
  if (at <= ms) at += dayMs;
  return at;
}

export { isQuiet };

// ---------- 首席给出的结论：校验 ----------
// input 是「安排」工具收到的参数；ctx = { roster:[{id,name,status,can_receive,paused}], externals:Set|[], nowMs, now... }
// 返回 { ok:true, plan } 或 { ok:false, reason }（reason 是写给首席看的人话，让它改了再给一次）。
export function checkConclusion(input, ctx) {
  const no = reason => ({ ok: false, reason });
  if (!obj(input)) return no('结论要是一个对象');
  const roster = Array.isArray(ctx.roster) ? ctx.roster : [];
  const externals = new Set(ctx.externals ?? []);
  const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
  const why = cut(input.why, 200);
  if (!why) return no('要写一句「为什么这样安排」');
  const askOwner = input.ask_owner === true;
  const askReason = cut(input.ask_reason, 100);
  if (input.ask_owner !== undefined && typeof input.ask_owner !== 'boolean') return no('ask_owner 要写是或否（true/false）');
  if (askOwner && !askReason) return no('要主人先点头时，要写一句理由（ask_reason）');
  const findBot = ref => {
    const key = String(ref ?? '').trim();
    return roster.find(b => b && (b.id === key || b.name === key));
  };
  const usable = b => b && b.status === 'active' && b.paused !== true && b.can_receive !== false;
  let plan;
  const kind = input.kind;
  if (kind === 'bot') {
    const bot = findBot(input.who);
    if (!bot) return no(`名册里没有「${cut(input.who, 20)}」，请用 arrange_view 看各位助理再选`);
    if (!usable(bot)) return no(`${bot.name ?? bot.id} 停用或暂停了，现在不能接，换一位`);
    plan = { kind: 'bot', who: { name: bot.id, type: 'assistant' } };
  } else if (kind === 'external') {
    const name = String(input.who ?? '').trim();
    if (!NAME.test(name) || !externals.has(name)) {
      return no(`「${cut(input.who, 20)}」不是已配置的外部身份（${[...externals].join('、') || '目前没有'}）`);
    }
    plan = { kind: 'external', who: { name, type: 'external' } };
    if (input.tier !== undefined && input.tier !== null && input.tier !== '') {
      if (!(input.tier in TIERS)) return no('tier 只能是 simple、complex、image 之一');
      plan.tier = input.tier;
    }
  } else if (kind === 'relay') {
    if (!Array.isArray(input.steps)) return no('接力路线要写 steps（2 到 8 棒）');
    const steps = [];
    for (const [index, raw] of input.steps.entries()) {
      if (!obj(raw)) return no(`第 ${index + 1} 棒写得不对`);
      const ref = String(raw.who ?? '').trim();
      let who;
      if (ref === 'owner' || ref === '主人') who = { name: 'owner', type: 'owner' };
      else if (externals.has(ref)) who = { name: ref, type: 'external' };
      else {
        const bot = findBot(ref);
        if (!bot) return no(`第 ${index + 1} 棒的「${cut(ref, 20)}」不在名册里`);
        if (!usable(bot)) return no(`第 ${index + 1} 棒的 ${bot.name ?? bot.id} 停用或暂停了`);
        who = { name: bot.id, type: 'assistant' };
      }
      steps.push({ who, task: raw.task, doneWhen: raw.done_when ?? raw.doneWhen, gate: raw.gate === true });
    }
    try {
      parseRoute(steps);
    } catch (error) {
      return no('接力路线不合格：' + String(error?.message ?? error).slice(0, 100));
    }
    plan = { kind: 'relay', steps: parseRoute(steps).map(s => ({ who: s.who, task: s.task, doneWhen: s.doneWhen, gate: s.gate })) };
  } else {
    return no('kind 只能是 bot（内部助理）、external（外部身份）、relay（接力路线）');
  }
  // 什么时候做
  const when = input.when ?? 'now';
  if (when === 'now') plan.when = { kind: 'now' };
  else if (when === 'at') {
    const ms = Date.parse(String(input.at ?? ''));
    if (!Number.isFinite(ms)) return no('when 写 at 时，at 要是带时区的时刻，如 2026-11-20T09:00:00+09:00');
    if (ms <= nowMs + 30000) return no('at 的时刻要在未来（现在是 ' + new Date(nowMs).toISOString() + '）');
    if (ms > nowMs + 366 * dayMs) return no('at 离现在超过一年了');
    plan.when = { kind: 'once', at: new Date(ms).toISOString() };
  } else if (when === 'daily' || when === 'weekly') {
    if (plan.kind === 'relay') return no('接力路线不能做成重复的，请改成一次性的时间，或换成单个助理');
    if (!CLOCK.test(String(input.time ?? ''))) return no('daily / weekly 要写 time（HH:MM，按本地时间）');
    plan.when = { kind: when, time: input.time };
    if (when === 'weekly') {
      const days = Array.isArray(input.days) ? [...new Set(input.days)].sort() : [];
      if (!days.length || !days.every(d => Number.isInteger(d) && d >= 1 && d <= 7)) {
        return no('weekly 要写 days（周一为 1 … 周日为 7 的数组）');
      }
      plan.when.days = days;
    }
  } else return no('when 只能是 now、at、daily、weekly');
  plan.why = why;
  plan.askOwner = askOwner;
  plan.askReason = askOwner ? askReason : '';
  return { ok: true, plan };
}

// ---------- 要不要先让主人点头 ----------
// 返回原因列表；空数组 = 可以直接派。四类用现有的权限判定（permission-mode 的 PAY/PUBLISH/DELETE/ADMIN 命中结果）。
export function approvalNeeds({ plan, ticket, cfg = {} }) {
  const needs = [];
  if (plan.askOwner) needs.push({ code: 'chief', text: '首席觉得要你先点头：' + plan.askReason });
  const hit = sensitiveText(`${ticket?.title ?? ''}\n${ticket?.goal ?? ''}`);
  if (hit) needs.push({ code: hit.id, text: hit.reason });
  const externalNames = plan.kind === 'external' ? [plan.who.name]
    : plan.kind === 'relay' ? plan.steps.filter(s => s.who.type === 'external').map(s => s.who.name) : [];
  if (externalNames.length && cfg.external_approval !== false) {
    needs.push({ code: 'external', text: `要派给外部身份「${[...new Set(externalNames)].join('、')}」，外部 agent 干活默认要你点一次头` });
  }
  return needs;
}

// 「首席建议：交给 X，Y 时做，因为……」的人话（卡上记录与今天页都用它）
export function whenText(when, offset = 0) {
  if (!when || when.kind === 'now') return '现在';
  const days = '一二三四五六日';
  if (when.kind === 'once') {
    const local = new Date(Date.parse(when.at) + offset * 60000);
    return `${local.getUTCMonth() + 1} 月 ${local.getUTCDate()} 日 ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  }
  if (when.kind === 'daily') return `每天 ${when.time}`;
  return `每周${(when.days ?? []).map(d => days[d - 1]).join('、')} ${when.time}`;
}

export function whoText(plan, nameOf = id => id) {
  if (plan.kind === 'relay') {
    return '接力（' + plan.steps.map(s => s.who.type === 'owner' ? '你' : nameOf(s.who.name)).join(' → ') + '）';
  }
  return nameOf(plan.who.name);
}

// 卡上的一条人话记录
export function arrangeNote({ plan, nameOf, offset = 0, applied = true }) {
  const head = applied ? '首席安排' : '首席建议';
  return cut(`${head}：交给 ${whoText(plan, nameOf)}，${whenText(plan.when, offset)}做。因为${plan.why}`, 780);
}
