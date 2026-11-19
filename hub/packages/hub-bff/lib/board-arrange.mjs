// 看板上的「首席安排」与「卡片定时」操作。由 board.mjs 在建看板时把内部工具递过来，这里不碰文件。
// 一张卡同一时刻只有一个出路，都走 mutate（按单加锁、写盘前核对版本），并发来只会成功一个。
// 【AI建议】
import { BoardError } from './board-errors.mjs';
import { begin, newRelay, parseRoute } from './relay-model.mjs';
import {
  ARRANGE_INIT, SCHEDULE_INIT, TIERS, TIER_TAG, approvalNeeds, arrangeNote, checkConclusion, cut,
  isQuiet, whoText,
} from './arrange-model.mjs';

const error = (code, message) => {
  throw new BoardError(code, message);
};
const PENDING = ['wanted', 'proposed'];
const MAX_ATTEMPTS = 2;

// 这张卡现在能不能请首席安排：普通的、没有负责人、没在做、不是接力、不在「谁有空谁接」里。
export function canArrange(ticket) {
  return !!ticket && !ticket.legacy && !ticket.relay && ticket.state === 'queued' && !ticket.claimedBy &&
    !(ticket.to ?? []).length && ticket.openClaim?.state !== 'open' && !PENDING.includes(ticket.arrange?.state) &&
    !(ticket.schedule?.state === 'waiting' && ticket.schedule.template);
}

export function createArrangeOps({ mutate, createWithMeta, guardActor, now, offset = () => 0 }) {
  const stamp = () => new Date(now()).toISOString();
  const nameOf = (names, id) => names?.[id] ?? id;

  // 把一份已经定好的安排落到卡上（在 mutate 里调用）。返回事件里要带的额外字段。
  function applyPlan(ticket, plan, ts, { decision, names }) {
    // 主人在新建时自己定了时间：时间听主人的，首席只挑人。
    const owned = ticket.schedule?.by === 'owner' && ticket.schedule.state === 'waiting' && !ticket.schedule.assignee;
    let when = plan.when;
    if (owned) {
      const s = ticket.schedule;
      when = s.kind === 'once' ? { kind: 'once', at: s.at } : s.kind === 'daily' ? { kind: 'daily', time: s.time }
        : { kind: 'weekly', time: s.time, days: s.days };
    }
    // 定时到点才请首席安排的：时间已经到了，首席只挑人，现在就做。
    if (ticket.arrange?.via === 'schedule') when = { kind: 'now' };
    const final = { ...plan, when };
    if (final.kind === 'relay' && ['daily', 'weekly'].includes(when.kind)) {
      error('INVALID', 'Relay cannot repeat');
    }
    // 外部身份带档位：把档位标签写进说明，接单器按它选模型；说明里已经有标签就不重复。
    if (final.tier && !TIER_TAG.test(`${ticket.title}\n${ticket.goal}`)) {
      ticket.goal = `${ticket.goal.trim()}\n${TIERS[final.tier]}`;
    }
    const note = arrangeNote({ plan: final, nameOf: id => nameOf(names, id), offset: offset(), applied: true });
    ticket.arrange = {
      ...ticket.arrange, state: 'applied', plan: final, note, appliedAt: ts, decidedAt: ts, decision,
    };
    delete ticket.arrange.stalled;
    ticket.state = 'queued';
    ticket.open_ask = null;
    const extra = { arranged: true };
    if (when.kind === 'now') {
      Object.assign(extra, startNow(ticket, final, ts));
    } else {
      ticket.schedule = {
        kind: when.kind, ...(when.kind === 'once' ? { at: when.at } : { time: when.time }),
        ...(when.kind === 'weekly' ? { days: when.days } : {}),
        assignee: final.kind === 'relay' ? null : { name: final.who.name, type: final.who.type === 'external' ? 'external' : 'assistant' },
        tier: final.tier ?? null, template: when.kind !== 'once', state: 'waiting', by: owned ? 'owner' : 'chief',
        createdAt: ticket.schedule?.createdAt ?? ts,
      };
      if (final.kind === 'relay') ticket.schedule.relay = true;
    }
    return { detail: note, ...extra };
  }

  // 现在就开始：内部助理或外部身份写成负责人；接力就把卡变成接力。
  function startNow(ticket, plan, ts) {
    if (plan.kind === 'relay') {
      const items = parseRoute(plan.steps);
      ticket.relay = newRelay(items);
      ticket.to = [items[0].who.name];
      ticket.expects_reply = true;
      ticket.routing = { requestedBy: 'owner', via: 'arrange', hint: '' };
      begin(ticket, ts);
      return { relayStarted: true };
    }
    ticket.to = [plan.who.name];
    return plan.who.type === 'assistant' ? { assignedTo: plan.who.name } : { assignedExternal: plan.who.name };
  }

  return {
    // 主人新建一张「交给首席安排」的卡（可同时选了时间：时间听主人的）。
    async arrangeCreate(actor, input) {
      guardActor(actor);
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      const { schedule, ...rest } = input ?? {};
      const made = await createWithMeta(actor, {
        ...rest, to: [], [ARRANGE_INIT]: { via: 'new' },
        ...(schedule ? { [SCHEDULE_INIT]: { ...schedule, assignee: null, by: 'owner', template: schedule.kind !== 'once',
          tier: schedule.tier ?? null } } : {}),
      });
      return made.ticket;
    },

    // 主人新建一张带「什么时候做」的卡：负责人先记在定时里，到点才写到卡上并叫醒（没选人就到点请首席安排）。
    async scheduleCreate(actor, input) {
      guardActor(actor);
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      const { schedule, assignee, ...rest } = input ?? {};
      const made = await createWithMeta(actor, {
        ...rest, to: [],
        [SCHEDULE_INIT]: { ...schedule, assignee: assignee ?? null, by: 'owner', template: schedule.kind !== 'once',
          tier: schedule.tier ?? null },
      });
      return made.ticket;
    },

    // 请首席安排这张卡（按钮、拖动、定时到点没人选）。
    async arrangeAsk(actor, id, via = 'button') {
      if (!['owner', 'assistant'].includes(actor?.type)) error('FORBIDDEN', 'Not permitted');
      return mutate(actor, id, 'arrange_asked', (ticket, ts) => {
        if (!canArrange(ticket)) error('CONFLICT', 'Cannot arrange this ticket');
        ticket.arrange = { state: 'wanted', via, requestedAt: ts, attempts: 0 };
        return { detail: via };
      });
    },

    // 首席给出结论。ctx = { roster, externals, external_approval, names }。结论不合法：记一次、抛 INVALID 把原因还给首席；
    // 两次都不合法，卡转成「等你」，不再让首席重试。
    async arrangeSet(actor, id, input, ctx = {}) {
      if (actor?.type !== 'assistant') error('FORBIDDEN', 'Not permitted');
      let rejected = null;
      const ticket = await mutate(actor, id, 'arrange_set', (t, ts) => {
        if (t.arrange?.state !== 'wanted') error('CONFLICT', 'Not waiting for an arrangement');
        if (t.state !== 'queued' || t.claimedBy) error('CONFLICT', 'Ticket changed');
        const checked = checkConclusion(input, { roster: ctx.roster, externals: ctx.externals, nowMs: now() });
        if (!checked.ok) {
          const attempts = (t.arrange.attempts ?? 0) + 1;
          t.arrange = { ...t.arrange, attempts };
          rejected = { reason: checked.reason, attempts };
          if (attempts < MAX_ATTEMPTS) return { detail: '结论不合格：' + checked.reason };
          // 第二次还是不合格：转给主人。
          const text = cut('首席两次没能给出合法的安排（' + checked.reason + '），请你来定：交给谁、什么时候做。', 400);
          t.arrange = { ...t.arrange, state: 'proposed', proposedAt: ts,
            needs: [{ code: 'invalid', text: '首席两次没给出合法的结论' }] };
          t.state = 'waiting-human';
          t.open_ask = { text, ts };
          return { detail: '结论两次不合格，转给主人：' + checked.reason, attention: true, attentionKind: 'waiting-human',
            reason: text };
        }
        const needs = approvalNeeds({ plan: checked.plan, ticket: t, cfg: { external_approval: ctx.external_approval } });
        if (needs.length) {
          const note = arrangeNote({ plan: checked.plan, nameOf: id2 => nameOf(ctx.names, id2), offset: offset(), applied: false });
          t.arrange = { ...t.arrange, state: 'proposed', plan: checked.plan, needs, note, proposedAt: ts };
          t.state = 'waiting-human';
          t.open_ask = { text: cut(note + '（' + needs.map(n => n.text).join('；') + '）', 400), ts };
          // 夜间不打扰：不发提醒，早上在今天页出现（今天页按时间决定什么时候显示）。
          const quiet = isQuiet(now(), offset());
          return { detail: note, ...(quiet ? {} : { attention: true, attentionKind: 'waiting-human', reason: t.open_ask.text }),
            proposed: true };
        }
        return applyPlan(t, checked.plan, ts, { decision: 'auto', names: ctx.names });
      });
      if (rejected) {
        const failure = new BoardError('INVALID', rejected.reason);
        failure.attempts = rejected.attempts;
        failure.escalated = rejected.attempts >= MAX_ATTEMPTS;
        throw failure;
      }
      return ticket;
    },

    // 主人对首席建议的三个操作：就这么办（ok）/ 换个人（swap，带 who）/ 先不做（skip）。
    async arrangeDecide(actor, id, decision, ctx = {}) {
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      const action = decision?.action;
      if (!['ok', 'swap', 'skip'].includes(action)) error('INVALID', 'Invalid decision');
      return mutate(actor, id, 'arrange_' + action, (t, ts) => {
        if (t.arrange?.state !== 'proposed' || t.state !== 'waiting-human') error('CONFLICT', 'Nothing to decide');
        if (action === 'skip') {
          t.arrange = { ...t.arrange, state: 'declined', decision: 'skip', decidedAt: ts };
          t.state = 'queued';
          t.open_ask = null;
          if (t.schedule?.by === 'chief') delete t.schedule;
          else if (t.schedule?.state === 'waiting') t.schedule = { ...t.schedule, state: 'paused' };
          return { detail: '主人说先不做' };
        }
        if (action === 'ok') {
          if (!t.arrange.plan) error('CONFLICT', 'No plan to approve');
          return applyPlan(t, t.arrange.plan, ts, { decision: 'ok', names: ctx.names });
        }
        const who = decision.who;
        if (!who || typeof who.name !== 'string' || !['assistant', 'external'].includes(who.type)) error('INVALID', 'Invalid assignee');
        const base = t.arrange.plan ?? { when: { kind: 'now' }, why: '主人自己选的人', askOwner: false, askReason: '' };
        const plan = { ...base, kind: who.type === 'external' ? 'external' : 'bot', who: { name: who.name, type: who.type },
          why: cut(base.why, 150) + '（主人换了人）' };
        delete plan.steps;
        if (who.type !== 'external') delete plan.tier;
        return applyPlan(t, plan, ts, { decision: 'swap', names: ctx.names });
      });
    },

    // 首席两次没动静（或首席停用）：转成「等你」，不让卡无声挂着。
    async arrangeStall(actor, id, reason) {
      return mutate(actor, id, 'arrange_stalled', (t, ts) => {
        if (t.arrange?.state !== 'wanted') error('CONFLICT', 'Not waiting');
        const text = cut(reason || '首席没来得及安排这张卡，请你来定：交给谁、什么时候做。', 400);
        t.arrange = { ...t.arrange, state: 'proposed', proposedAt: ts, stalled: true,
          needs: [{ code: 'stalled', text: '首席没有给出安排' }] };
        t.state = 'waiting-human';
        t.open_ask = { text, ts };
        return { detail: text, attention: true, attentionKind: 'waiting-human', reason: text };
      });
    },

    // ---------- 定时 ----------
    // 主人给一张还没人动的卡设「什么时候做」。assignee 为空，到点就请首席安排。
    async scheduleSet(actor, id, schedule, assignee) {
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      return mutate(actor, id, 'schedule_set', (t, ts) => {
        if (t.relay || t.legacy || t.claimedBy || !['queued'].includes(t.state)) error('CONFLICT', 'Cannot schedule this ticket');
        if (t.openClaim?.state === 'open' || PENDING.includes(t.arrange?.state)) error('CONFLICT', 'Ticket is in another flow');
        const who = assignee ?? ((t.to ?? [])[0] ? { name: t.to[0], type: 'assistant' } : null);
        t.schedule = { ...schedule, assignee: who, state: 'waiting', by: 'owner', createdAt: ts, template: schedule.kind !== 'once',
          tier: schedule.tier ?? null };
        t.to = [];
        return { detail: schedule.kind };
      });
    },

    async scheduleClear(actor, id) {
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      return mutate(actor, id, 'schedule_clear', (t) => {
        if (!t.schedule) error('CONFLICT', 'No schedule');
        delete t.schedule;
      });
    },

    async schedulePause(actor, id, paused) {
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      return mutate(actor, id, paused ? 'schedule_paused' : 'schedule_resumed', (t) => {
        if (!t.schedule || t.schedule.state === 'fired') error('CONFLICT', 'No active schedule');
        t.schedule = { ...t.schedule, state: paused ? 'paused' : 'waiting' };
      });
    },

    // 一次性定时到点：负责人写上去（或请首席安排）。系统调用。重复调用只有第一次生效。
    async scheduleFire(actor, id, { late = false, relayPlan } = {}) {
      return mutate(actor, id, 'schedule_fired', (t, ts) => {
        const s = t.schedule;
        if (!s || s.kind !== 'once' || s.state !== 'waiting') error('CONFLICT', 'Nothing to fire');
        if (t.state !== 'queued' || t.claimedBy) error('CONFLICT', 'Ticket changed');
        t.schedule = { ...s, state: 'fired', firedAt: ts, lastSlot: s.at };
        const text = late ? '定时的点已过，补做一次' : '定时到点';
        if (relayPlan) return { detail: text, ...startNow(t, relayPlan, ts) };
        if (s.assignee) {
          t.to = [s.assignee.name];
          return { detail: text, ...(s.assignee.type === 'assistant' ? { assignedTo: s.assignee.name }
            : { assignedExternal: s.assignee.name }) };
        }
        t.arrange = { state: 'wanted', via: 'schedule', requestedAt: ts, attempts: 0 };
        return { detail: text + '，请首席安排', arrangeWanted: true };
      });
    },

    // 一次性定时错过太久：不补，标记，今天页提示。
    async scheduleMiss(actor, id) {
      return mutate(actor, id, 'schedule_missed', (t, ts) => {
        const s = t.schedule;
        if (!s || s.state !== 'waiting') error('CONFLICT', 'Nothing to miss');
        t.schedule = { ...s, state: 'missed', firedAt: ts, ...(s.kind === 'once' ? { lastSlot: s.at } : {}) };
      });
    },

    // 重复定时到点：生成当次的子卡（标题带日期）；母卡留着当模板。同一个时刻只生成一次（用幂等键）。
    async scheduleSpawn(id, { slotIso, date, late = false, mother }) {
      const actor = { name: mother.from.name, type: mother.from.type };
      const s = mother.schedule;
      const tier = s.tier && !TIER_TAG.test(`${mother.title}\n${mother.goal}`) ? `\n${TIERS[s.tier]}` : '';
      const input = {
        title: cut(`${mother.title}（${date.slice(5)}）`, 120),
        goal: `${mother.goal.trim()}${tier}`,
        to: s.assignee ? [s.assignee.name] : [],
        key: `sched:${mother.id}:${slotIso}`,
        parentId: mother.id, project: mother.project ?? '',
        routing: { requestedBy: 'schedule', via: 'schedule', hint: mother.id },
        ...(s.assignee ? {} : { [ARRANGE_INIT]: { via: 'schedule' } }),
      };
      const made = await createWithMeta(actor, input);
      if (!made.deduped) {
        await mutate({ name: 'schedule', type: 'assistant' }, mother.id, 'schedule_spawned', (t, ts) => {
          if (!t.schedule) error('CONFLICT', 'Schedule gone');
          t.schedule = { ...t.schedule, lastSlot: slotIso, firedAt: ts };
          return { detail: (late ? '补做 ' : '') + date };
        }).catch(() => {});
      }
      return made;
    },

    // 重复定时错过的时刻：记下来（不补），今天页提示；lastIso 是这次处理到的最后一个时刻。
    async scheduleSlotsMissed(id, isoList, lastIso) {
      return mutate({ name: 'schedule', type: 'assistant' }, id, 'schedule_missed', (t) => {
        if (!t.schedule) error('CONFLICT', 'Schedule gone');
        const missed = [...(t.schedule.missed ?? []), ...isoList].slice(-20);
        t.schedule = { ...t.schedule, lastSlot: lastIso ?? t.schedule.lastSlot, missed };
        return { detail: isoList.length + ' 个没赶上' };
      });
    },
  };
}

export { PENDING as ARRANGE_PENDING };
export { whoText };
