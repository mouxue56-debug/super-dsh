import { serviceFor as selfEditService } from './ext/self-edit.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createPriceBook } from './prices.mjs';
import { summarize } from './ledger-summary.mjs';
import { localDate, offsetFor } from './meetings-sources.mjs';
import { readTodayMinutes } from './ext/meetings.mjs';
import { isOpenWaiting } from './board-claim.mjs';
import { listTokenNames } from './board-tokens.mjs';
import { externalNames, isQuiet } from './handoff.mjs';
import { isoWeekday, nextMorning, whenText, whoText } from './arrange-model.mjs';

// 「今天」一页的数字全部在这里由代码算好；模型只负责念，不许改数。
// 暂定的配置项放在 hubConfig.today 段：minutesLookbackDays、minutesMaxChars、itemMaxChars。
export const TODAY_DEFAULTS = Object.freeze({ minutesLookbackDays: 14, minutesMaxChars: 6000, itemMaxChars: 200 });

const TOKEN_FIELDS = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'];
const WAITING = ['blocked', 'waiting-timeout', 'uncertain', 'failed'];
const clip = (value, max) => {
  const text = typeof value === 'string' ? value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim() : '';
  return Array.from(text).length > max ? Array.from(text).slice(0, max).join('') + '…' : text;
};
const owner = ticket => ticket.claimedBy ?? ticket.to?.[0] ?? '(未分配)';

async function section(fn) {
  try {
    return { available: true, ...(await fn()) };
  } catch {
    return { available: false, reason: '读取失败' };
  }
}

function nameOf(roster, id) {
  // 主人自己不显示成内部名「owner」。
  if (id === 'owner' || id === 'owner') return '你';
  return roster.find(bot => bot.id === id)?.name ?? id;
}

// 接力卡的摘要用一句人话（卡片标题加「接力 N 棒走完了」），不用交接说明长文的截断。
function relaySummary(ticket, max) {
  const n = ticket.relay?.steps?.length;
  return clip(`「${clip(ticket.title, 40) || '无标题'}」接力 ${n} 棒走完了`, max);
}

// 把原始工单整理成一行摘要，文本只截断不改写。
function brief(ticket, max) {
  const last = ticket.history?.at(-1);
  return {
    id: ticket.id, title: clip(ticket.title, max), assistant: owner(ticket), state: ticket.state,
    since: ticket.updatedAt,
    reason: clip(ticket.open_ask?.text ?? ticket.progress?.at(-1)?.text ?? last?.detail, max),
  };
}

// 工单被接受（完成）的本地日期，取最后一条 accepted 记录，没有就用更新时间。
function completedDate(ticket, offset) {
  const entry = [...(ticket.history ?? [])].reverse().find(item => item.action === 'accepted');
  return localDate(Date.parse(entry?.ts ?? ticket.updatedAt), offset);
}

// 一个助理一天用量的展示口径：没有价格就是「待定价」，绝不估算。
export function costView(bucket) {
  const cost = bucket.cost;
  const amounts = {};
  for (const [currency, value] of Object.entries(cost.byCurrency)) {
    amounts[currency] = Math.round((value.ok + value.expired) * 1e6) / 1e6;
  }
  const priced = Object.keys(amounts).length > 0;
  const view = { amounts, pendingCalls: cost.pendingCalls, expiredCalls: cost.expiredCalls,
    planCalls: cost.planCalls, localCalls: cost.localCalls };
  if (cost.pendingCalls === 0) {
    view.label = priced ? '已计价' : (cost.planCalls > 0 ? '订阅（不计价）' : (cost.localCalls > 0 ? '本地（0）' : '无调用'));
  } else {
    view.label = priced ? '部分待定价' : '待定价';
  }
  return view;
}

function usageRow(id, name, bucket) {
  const tokens = Object.fromEntries(TOKEN_FIELDS.map(key => [key, bucket.tokens[key]]));
  return {
    id, name, calls: bucket.calls, tokens,
    tokenTotal: TOKEN_FIELDS.reduce((sum, key) => sum + bucket.tokens[key], 0),
    // 只数缺输入或输出的调用（缓存写、推理不少模型从不报），与网页账本页同口径。
    unreportedCalls: Math.max(bucket.unreportedFields.input, bucket.unreportedFields.output),
    cost: costView(bucket),
  };
}

function kbDrafts(deps) {
  const meet = deps.hubConfig?.meetings ?? {};
  const minutes = meet.minutesDir ?? (deps.dataDir && path.join(deps.dataDir, 'meetings'));
  const dir = meet.kb?.pendingDir ?? (minutes && path.join(minutes, 'kb-pending'));
  if (!dir) return [];
  let names;
  try {
    names = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return names.flatMap(name => {
    try {
      const draft = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      return draft?.id ? [{ id: draft.id, kind: 'kb-submit', summary: clip(draft.summary, 200),
        project: clip(draft.project, 80),
        since: typeof draft.createdAt === 'string' ? draft.createdAt : '' }] : [];
    } catch {
      return [];
    }
  });
}

const HEADLINE_CLEAR = '今天没有等你处理的事';
const HEADLINE_UNREAD = '暂时读不到';

// 同一档里等得最久的在前；没有时间的排后；再按编号，保证每次一样。
function byAge(left, right) {
  const a = String(left?.since || '');
  const b = String(right?.since || '');
  if (a !== b) {
    if (!a) return 1;
    if (!b) return -1;
    return a < b ? -1 : 1;
  }
  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

function focusTitle(item) {
  return '「' + (item?.title || '（无标题）') + '」';
}

function focusBase(kind, item) {
  const named = focusTitle(item);
  if (kind === 'answer') {
    return item?.reason ? ('等你回答' + named + '：' + item.reason) : ('等你回答' + named);
  }
  if (kind === 'approval') {
    return '等你点头' + named + (item?.detail ? '：' + item.detail : '');
  }
  if (item?.checked) return '已验的结果' + named + (item?.detail ? '：' + item.detail : '');
  return '等你看结果' + named + (item?.detail ? '：' + item.detail : '');
}

// 只挑一件。标题撞车时把编号写进句子，避免两张相似的单看起来一样。
function chooseHeadline(items, kind, place) {
  const ranked = items.slice().sort(byAge);
  const winner = ranked[0];
  let text = clip(focusBase(kind, winner), 180);
  const twins = ranked.filter(item => clip(focusBase(kind, item), 180) === text);
  if (twins.length > 1) text += '（' + winner.id + '）';
  return { status: 'item', kind, id: String(winner.id), place, text };
}

function nodCandidates(approvals, arrangements) {
  const cards = (Array.isArray(approvals?.cards) ? approvals.cards : []).flatMap(card => (
    card && card.id ? [{ id: String(card.id), title: card.title || '', since: card.since || '',
      detail: card.ask || '' }] : []
  ));
  const drafts = (Array.isArray(approvals?.kbDrafts) ? approvals.kbDrafts : []).flatMap(draft => (
    draft && draft.id ? [{ id: String(draft.id), title: draft.summary || draft.project || '',
      since: draft.since || '', detail: draft.summary || '' }] : []
  ));
  const arrItems = arrangements?.available === true && Array.isArray(arrangements.items) ? arrangements.items : [];
  const proposals = arrItems.map(item =>
    ({ id: String(item.id), title: item.title || '', since: item.since || '', detail: item.text || '' }));
  return cards.concat(drafts, proposals);
}

// 已验过的，或已经交回等看的。做完并验收过的不放进来，那件已经不需要再处理。
function resultCandidates(tickets, max) {
  const items = [];
  for (const ticket of tickets) {
    if (!ticket || typeof ticket.id !== 'string') continue;
    if (ticket.state === 'completed' || ticket.state === 'waiting-human') continue;
    const checks = Array.isArray(ticket.verification) ? ticket.verification : [];
    const last = checks.length ? checks[checks.length - 1] : null;
    if (!last && ticket.review !== 'submitted') continue;
    const raw = last ? (last.note || last.verdict || '') : (ticket.report?.summary || '');
    const since = (last && typeof last.ts === 'string' ? last.ts : '') || ticket.updatedAt || '';
    items.push({
      id: ticket.id, title: clip(ticket.title, max), detail: clip(String(raw), max),
      since, checked: !!last,
    });
  }
  return items;
}

// 先具体待答，再待点头，最后已验或已交回的结果。上一档没读到就不能说下面没有，也不另挑一件。
function pickHeadline(waiting, approvals, results, arrangements) {
  const unread = { status: 'unread', text: HEADLINE_UNREAD };
  if (!waiting || waiting.available !== true || !Array.isArray(waiting.waitingAnswer)) return unread;
  // 有待答却缺编号，就不能改口去挑下一档，也不能说没事。
  if (waiting.waitingAnswer.some(item => !item || !item.id)) return unread;
  if (waiting.waitingAnswer.length) return chooseHeadline(waiting.waitingAnswer, 'answer', 'question');
  const nodsLive = approvals && approvals.available === true && approvals.cardsSource === 'live';
  if (!nodsLive) return unread;
  const nods = nodCandidates(approvals, arrangements);
  if (nods.length) return chooseHeadline(nods, 'approval', 'card');
  if (!results || results.available !== true || !Array.isArray(results.items)) return unread;
  if (results.items.length) return chooseHeadline(results.items, 'verified', 'result');
  return { status: 'clear', text: HEADLINE_CLEAR };
}

// 汇总「今天」一页的结构化数据。每一段独立容错，缺哪段就明说缺，不报错、不估算。
export async function buildToday(deps = {}, { date, routines } = {}) {
  const cfg = { ...TODAY_DEFAULTS, ...(deps.hubConfig?.today ?? {}) };
  const nowMs = Number(deps.now?.() ?? Date.now());
  const tz = { timezone: deps.hubConfig?.timezone, utcOffsetMinutes: deps.hubConfig?.routines?.utcOffsetMinutes ??
    (deps.hubConfig?.timezone ? undefined : deps.utcOffsetMinutes) };
  const offset = offsetFor(tz, nowMs);
  const today = date ?? localDate(nowMs, offset);
  const yesterday = localDate(Date.parse(today + 'T00:00:00Z') - 86400000, 0);
  let roster = [];
  try {
    const value = typeof deps.roster?.list === 'function' ? await deps.roster.list() : deps.roster;
    roster = Array.isArray(value) ? value : [];
  } catch {
  }
  let tickets = null;
  try {
    const value = await deps.board?.list?.();
    tickets = Array.isArray(value) ? value : null;
  } catch {
  }
  const max = cfg.itemMaxChars;
  const boardOff = { available: false, reason: '看板不可用' };

  const waiting = tickets === null ? boardOff : await section(() => ({
    blocked: tickets.filter(t => WAITING.includes(t.state)).map(t => brief(t, max)),
    // 首席建议（等你点头）有自己的三个操作，不混进「等你回答」。
    waitingAnswer: tickets.filter(t => t.state === 'waiting-human' && t.arrange?.state !== 'proposed')
      .map(t => brief(t, max)),
    awaitingReview: tickets.filter(t => t.review === 'submitted' && t.state !== 'completed').map(t =>
      ({ ...brief(t, max), creator: t.from?.name ?? null })),
  }));
  if (waiting.available) {
    waiting.counts = { blocked: waiting.blocked.length, waitingAnswer: waiting.waitingAnswer.length,
      awaitingReview: waiting.awaitingReview.length };
  }

  const done = tickets === null ? boardOff : await section(() => {
    const by = {};
    for (const t of tickets.filter(x => x.state === 'completed' && completedDate(x, offset) === yesterday)) {
      (by[owner(t)] ??= []).push({ id: t.id, title: clip(t.title, max), summary: Array.isArray(t.relay?.steps)
          ? relaySummary(t, max) : clip(t.report?.summary, max),
        selfReported: true });
    }
    const list = Object.entries(by).map(([id, items]) =>
      ({ id, name: nameOf(roster, id), count: items.length, items }));
    return { date: yesterday, byAssistant: list, total: list.reduce((sum, row) => sum + row.count, 0) };
  });

  // 挂着没人接的（谁有空谁接）。超过 open_claim_minutes（默认 15 分钟）还没人接的标成过期；
  // 首席停用或不在名册时，开放的卡一张都不会被叫醒派出去，今天页要明说，等主人自己挑。
  const openMinutesRaw = deps.hubConfig?.open_claim_minutes;
  const openMinutes = Number.isSafeInteger(openMinutesRaw) && openMinutesRaw >= 1 ? openMinutesRaw : 15;
  const openClaims = tickets === null ? boardOff : await section(() => {
    const chief = roster.find(bot => bot?.role === 'chief');
    const items = tickets.filter(isOpenWaiting).map(t => {
      const since = t.openClaim.reopenedAt ?? t.openClaim.openedAt;
      const waited = Math.max(0, Math.floor((nowMs - Date.parse(since)) / 60000));
      return { id: t.id, title: clip(t.title, max), since, waitedMinutes: waited, overdue: waited >= openMinutes };
    }).sort(byAge);
    return { minutes: openMinutes, chiefUsable: !!chief && chief.status === 'active',
      chiefName: chief?.name ?? '首席助理', items };
  });

  // 接单的外部身份已失效（令牌被吊销，或配置 board.externals 里删掉了它）：名下进行中的卡不能无声挂着。
  // 看不到令牌库（没有 configDir）时不判断，免得误报；配置里没写 externals 时只按令牌判。
  const externalLost = tickets === null ? boardOff : await section(async () => {
    if (typeof deps.configDir !== 'string' || !deps.configDir) throw new Error('no config dir');
    const live = new Set((await listTokenNames(deps.configDir)).map(row => row.name));
    const cfgBoard = deps.hubConfig?.board;
    const raw = cfgBoard?.externals;
    const listed = raw && typeof raw === 'object' ? new Set(externalNames(cfgBoard)) : null;
    const busy = ['progress', 'blocked', 'waiting-human', 'waiting-timeout', 'uncertain'];
    const items = tickets.filter(t => t.claimedByType === 'external' && busy.includes(t.state) &&
      (!live.has(t.claimedBy) || (listed && !listed.has(t.claimedBy)))).map(t => ({
      id: t.id, title: clip(t.title, max), name: t.claimedBy, since: t.updatedAt ?? '',
      reason: !live.has(t.claimedBy) ? 'token' : 'config' })).sort(byAge);
    return { items };
  });

  // 首席建议（等你点头）。夜间生成的，早上 08:00 才出现在今天页；每条带原因和三个操作所需的信息。
  const nameFor = id => nameOf(roster, id);
  const arrangements = tickets === null ? boardOff : await section(() => {
    const items = [];
    let hidden = 0;
    for (const t of tickets) {
      const a = t.arrange;
      if (a?.state !== 'proposed' || t.state !== 'waiting-human') continue;
      const proposedMs = Date.parse(a.proposedAt ?? t.updatedAt);
      if (isQuiet(proposedMs, offset) && nowMs < nextMorning(proposedMs, offset)) {
        hidden += 1;
        continue;
      }
      items.push({ id: t.id, title: clip(t.title, max), since: a.proposedAt ?? t.updatedAt, stalled: a.stalled === true,
        planKind: a.plan?.kind ?? null, who: a.plan ? whoText(a.plan, nameFor) : '',
        whoId: a.plan?.kind === 'relay' ? null : a.plan?.who?.name ?? null, whoType: a.plan?.who?.type ?? null,
        when: a.plan ? whenText(a.plan.when, offset) : '', why: clip(a.plan?.why ?? '', max),
        needs: (a.needs ?? []).map(n => ({ code: n.code, text: clip(n.text, max) })),
        text: clip(a.plan ? `首席建议：交给 ${whoText(a.plan, nameFor)}，${whenText(a.plan.when, offset)}做，因为${a.plan.why}`
          : (t.open_ask?.text ?? '首席没能安排这张卡，请你来定'), 300) });
    }
    return { items: items.sort(byAge), hidden };
  });

  // 今天的定时（一次性的到点、重复的模板今天该出的子卡）和「没赶上」的。
  const schedules = tickets === null ? boardOff : await section(() => {
    const todayItems = [];
    const missed = [];
    const since = nowMs - 3 * 86400000; // 近三天没赶上的才提示
    for (const t of tickets) {
      const sc = t.schedule;
      if (!sc) continue;
      const base = { id: t.id, title: clip(t.title, max), kind: sc.kind, state: sc.state,
        assignee: sc.assignee?.name ?? null, assigneeType: sc.assignee?.type ?? null, by: sc.by ?? null };
      if (sc.kind === 'once') {
        const at = Date.parse(sc.at);
        if (localDate(at, offset) === today) {
          todayItems.push({ ...base, at: sc.at, text: whenText({ kind: 'once', at: sc.at }, offset) });
        }
        if (sc.state === 'missed' && at >= since) missed.push({ id: t.id, title: base.title, at: sc.at });
      } else {
        if (sc.state !== 'paused' && (sc.kind === 'daily' || sc.days.includes(isoWeekday(today)))) {
          const child = tickets.filter(c => c.parentId === t.id && localDate(Date.parse(c.createdAt), offset) === today)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          const rule = sc.kind === 'daily' ? { kind: 'daily', time: sc.time }
            : { kind: 'weekly', time: sc.time, days: sc.days };
          todayItems.push({ ...base, time: sc.time, text: whenText(rule, offset), template: true,
            child: child ? { id: child.id, state: child.state } : null });
        }
        for (const iso of sc.missed ?? []) {
          if (Date.parse(iso) >= since) missed.push({ id: t.id, title: base.title, at: iso });
        }
      }
    }
    todayItems.sort((a, b) => String(a.at ?? a.time ?? '').localeCompare(String(b.at ?? b.time ?? '')));
    return { items: todayItems, missed: { count: missed.length, items: missed.slice(-10) } };
  });

  // 叫外部接单器没叫动的（还没解决的才列：卡仍在排队、没人领）。
  const launchFailed = tickets === null ? boardOff : await section(() => {
    const failures = typeof deps.extLaunch?.failures === 'function' ? deps.extLaunch.failures() : [];
    const byId = new Map(tickets.map(t => [t.id, t]));
    const items = failures.flatMap(f => {
      const t = byId.get(f.id);
      if (!t || t.state !== 'queued' || t.claimedBy) return [];
      return [{ id: t.id, title: clip(t.title, max), name: f.name, since: f.ts, reason: clip(f.reason, 160) }];
    }).sort(byAge);
    return { items };
  });

  const usage = await section(async () => {
    if (typeof deps.ledger?.readRows !== 'function') throw new Error('no ledger');
    const rows = (await deps.ledger.readRows({ from: yesterday, to: yesterday })).filter(r =>
      r.kind === 'call' && localDate(r.tsMs, offset) === yesterday);
    const priceBook = deps.priceBook ?? createPriceBook([]);
    const summary = summarize(rows, { priceBook, nowMs, utcOffsetMinutes: offset });
    const list = Object.entries(summary.byBot).map(([id, bucket]) => usageRow(id, nameOf(roster, id), bucket));
    return { date: yesterday, byAssistant: list, total: usageRow('total', '合计', summary.total) };
  });

  const minutes = await section(() => {
    for (let back = 0; back < cfg.minutesLookbackDays; back++) {
      const day = localDate(Date.parse(today + 'T00:00:00Z') - back * 86400000, 0);
      const found = readTodayMinutes(deps, { date: day }).minutes.find(item => item.type === 'evening');
      if (found) {
        const text = found.text.length > cfg.minutesMaxChars ? found.text.slice(0, cfg.minutesMaxChars) : found.text;
        return { date: day, file: path.basename(found.file), text, truncated: text.length < found.text.length };
      }
    }
    return { date: null, file: null, text: '', truncated: false };
  });

  const cards = await section(async () => {
    const asked = typeof deps.cards?.pending === 'function' ? await deps.cards.pending() : null;
    const live = Array.isArray(asked);
    const list = live ? asked.map(c => ({ id: c.id ?? null, kind: c.kind ?? null,
      title: clip(c.title ?? c.summary ?? c.action, max), assistant: c.bot ?? null,
      since: typeof c.createdAt === 'string' ? c.createdAt : '',
      ask: clip(c.text ?? c.summary ?? c.consequence ?? '', max) })) : [];
    const drafts = kbDrafts(deps);
    return { cards: list, kbDrafts: drafts, count: list.length + drafts.length,
      cardsSource: live ? 'live' : 'unavailable' };
  });

  const routineSection = routines ? await section(() => routines.list({ date: today })) : { available: false,
    reason: '固定任务未启用' };

  let checkedResults = { available: false, items: [] };
  if (tickets !== null) {
    try {
      checkedResults = { available: true, items: resultCandidates(tickets, max) };
    } catch {
      checkedResults = { available: false, items: [] };
    }
  }
  const headline = pickHeadline(waiting, cards, checkedResults, arrangements);
  const mirrorNotice = deps.mirror?.status().message;
  const selfEdit = await section(async () => {
    const log = await selfEditService(deps).log();
    return {available: log.enabled, items: log.changes.slice(-10).reverse()};
  });

  return {
    date: today, yesterday, generatedAt: new Date(nowMs).toISOString(), utcOffsetMinutes: offset,
    note: '数字由代码算好；金额没有价格就是待定价；成果摘要是助理自述。',
    headline, checkedResults, selfEdit,
    ...(mirrorNotice ? { mirrorNotice } : {}),
    approvals: cards, waiting, openClaims, externalLost, arrangements, schedules, launchFailed,
    yesterdayDone: done, yesterdayUsage: usage,
    lastEveningMinutes: minutes,
    routines: routineSection,
  };
}
