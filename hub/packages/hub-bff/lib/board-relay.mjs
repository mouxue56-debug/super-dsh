// 看板上的接力操作。由 board.mjs 在建看板时把内部工具递过来（锁、读写、事件），这里不碰文件。
// 【AI建议】
import { BoardError } from './board-errors.mjs';
import {
  deliver, parseRoute, rehand, release, reopenLast, resume, stuck, RELAY_INIT,
  RELAY_MAX_STEPS, newRelay, block as blockText, stepOf, halt, reassign, markStalled, nudge,
} from './relay-model.mjs';

const error = (code, message) => {
  throw new BoardError(code, message);
};
const SYSTEM = Object.freeze({ name: 'relay', type: 'assistant' });
const NOTHING = { nothing: true };
const same = (step, actor) => step && step.who.name === actor.name && step.who.type === actor.type;
const startOf = (step) => Date.parse(step.resumedAt ?? step.startedAt ?? 0) || 0;

// 这张卡现在该不该由系统往下推一步；返回动作名或 null。只看卡本身，不信事件里带的字。
export function planSync(ticket) {
  const relay = ticket?.relay;
  if (!relay) return null;
  if (ticket.state === 'completed') return relay.phase === 'done' ? null : 'done';
  if (ticket.state === 'failed') return ['failed', 'done'].includes(relay.phase) ? null : 'failed';
  const step = stepOf(ticket);
  switch (relay.phase) {
    case 'running':
      if (!step || step.who.type === 'owner') return null;
      if (ticket.review === 'submitted' && ticket.report && ticket.report.by === step.who.name &&
        ticket.claimedBy === step.who.name && Date.parse(ticket.report.ts) >= startOf(step)) return 'deliver';
      if (['blocked', 'waiting-human'].includes(ticket.state)) return 'stuck';
      if (ticket.state === 'queued') return 'rehand';
      return null;
    case 'stuck':
      return ticket.state === 'progress' ? 'resume' : null;
    case 'gate':
      // 关口只由已经核验过的主人动作放行。进行中这个字段，接棒人普通恢复也能改到，不能当成主人点了头。
      return null;
    case 'final':
      return ticket.review === 'sent_back' ? 'reopen' : null;
    default:
      return null;
  }
}

export function createRelayOps({ mutate, locked, readNative, checkId, guardActor, createWithMeta }) {
  const needRelay = (ticket) => {
    if (!ticket.relay) error('CONFLICT', 'Not a relay ticket');
    return ticket.relay;
  };

  return {
    // 发起一条接力：建卡并让第 1 棒接手。steps 里的 who 已由调用方按名册和外部名单解析好。
    async relayCreate(actor, input) {
      guardActor(actor);
      if (!['assistant', 'owner'].includes(actor.type)) error('FORBIDDEN', 'Not permitted');
      const items = parseRoute(input?.steps);
      const first = items[0].who;
      const { steps: _steps, ...rest } = input;
      const { ticket, deduped } = await createWithMeta(actor, {
        ...rest,
        to: [first.name],
        expects_reply: true,
        routing: rest.routing ?? { requestedBy: actor.name, via: 'relay', hint: '' },
        [RELAY_INIT]: items,
      });
      return { ticket, deduped };
    },

    // 当前这一棒的人交棒：写交接说明，卡自动往下走。
    async relayDeliver(actor, id, note) {
      if (typeof note !== 'string' || !note.trim()) error('INVALID', 'Invalid note');
      return mutate(actor, id, 'relay_passed', (ticket, ts) => {
        const relay = needRelay(ticket);
        if (relay.phase !== 'running') error('CONFLICT', 'Not your turn');
        if (!same(stepOf(ticket), actor)) error('FORBIDDEN', 'Not responsible');
        if (ticket.state !== 'progress') error('CONFLICT', 'Ticket is not in progress');
        return deliver(ticket, note, actor.name, ts);
      });
    },

    // 当前这一棒卡住：停下，问人。
    async relayStuck(actor, id, question) {
      if (typeof question !== 'string' || !question.trim()) error('INVALID', 'Invalid question');
      return mutate(actor, id, 'relay_stuck', (ticket, ts) => {
        const relay = needRelay(ticket);
        if (relay.phase !== 'running') error('CONFLICT', 'Not your turn');
        if (!same(stepOf(ticket), actor)) error('FORBIDDEN', 'Not responsible');
        const text = blockText(question, 2000);
        ticket.state = 'waiting-human';
        ticket.open_ask = { text, ts };
        const result = stuck(ticket, text, ts);
        return { ...result, attention: true, attentionKind: 'waiting-human', reason: text };
      });
    },

    // 主人在「等你」上放行或退回这一棒。
    async relayRelease(actor, id, { redo = false, note = '' } = {}) {
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      return mutate(actor, id, 'relay_released', (ticket, ts) => {
        const relay = needRelay(ticket);
        if (relay.phase !== 'gate' || ticket.state !== 'waiting-human') error('CONFLICT', 'Nothing to release');
        return { ...release(ticket, ts, { redo: redo === true, note }), detail: redo ? 'redo' : 'ok' };
      });
    },

    // 改还没轮到的几棒（已交回的和正在做的不动）。主人或发起人可以改，别的助理不行。
    async relayReroute(actor, id, steps) {
      guardActor(actor);
      return mutate(actor, id, 'relay_rerouted', (ticket) => {
        const relay = needRelay(ticket);
        if (actor.type !== 'owner' && !(ticket.from.name === actor.name && ticket.from.type === actor.type)) {
          error('FORBIDDEN', 'Not permitted');
        }
        if (!['running', 'gate', 'stuck'].includes(relay.phase)) error('CONFLICT', 'Route is closed');
        const kept = relay.steps.slice(0, relay.current + 1);
        const added = parseRoute(steps, { min: 0, first: false });
        const fresh = newRelay([...kept.map((s) => ({ who: s.who, task: s.task, doneWhen: s.doneWhen, gate: s.gate })),
          ...added]);
        if (fresh.steps.length > RELAY_MAX_STEPS) error('INVALID', 'Too many steps');
        relay.steps = [...kept, ...fresh.steps.slice(kept.length)];
        return { detail: String(relay.steps.length) };
      });
    },

    // 交棒时发现下一棒的助理停用/不在名册里（由叫醒模块判断后调用）：停下，等主人换人。
    async relayHalt(id, { name, shown }) {
      return mutate(SYSTEM, id, 'relay_halted', (ticket, ts) => {
        const relay = needRelay(ticket);
        const step = stepOf(ticket);
        if (relay.phase !== 'running' || !step || step.who.type !== 'assistant' || step.who.name !== name) throw NOTHING;
        return halt(ticket, ts, { name, shown });
      }).catch((e) => {
        if (e === NOTHING) return null;
        throw e;
      });
    },

    // 主人给这一棒换人并继续。停用后（halted）、卡住（stuck）、超时提醒后（running）都可以。
    async relayReassign(actor, id, who) {
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      if (!who || !['assistant', 'external'].includes(who.type) || typeof who.name !== 'string') error('INVALID', 'Invalid assignee');
      return mutate(actor, id, 'relay_reassigned', (ticket, ts) => {
        const relay = needRelay(ticket);
        const step = stepOf(ticket);
        if (!step || !['halted', 'stuck', 'running'].includes(relay.phase)) error('CONFLICT', 'Nothing to reassign');
        if (step.who.type === 'owner') error('CONFLICT', 'Nothing to reassign');
        return { ...reassign(ticket, who, ts), detail: `${step.who.name}>${who.name}` };
      });
    },

    // 超时催办。叫醒模块发现这一棒被叫醒后太久没动静，记一笔（只记一次）。
    async relayStall(id, expectStartedAt, minutes) {
      return mutate(SYSTEM, id, 'relay_stalled', (ticket, ts) => {
        const relay = needRelay(ticket);
        const step = stepOf(ticket);
        const windowMs = (Number.isSafeInteger(minutes) && minutes > 0 ? minutes : 30) * 60000;
        const progressAt = (ticket.progress ?? []).reduce((latest, row) => {
          if (row?.by !== step?.who?.name) return latest;
          const at = Date.parse(row.ts);
          return Number.isFinite(at) ? Math.max(latest, at) : latest;
        }, 0);
        const acted = Math.max(
          Date.parse(step?.startedAt ?? '') || 0,
          Date.parse(step?.resumedAt ?? '') || 0,
          Date.parse(ticket.updatedAt ?? '') || 0,
          progressAt,
        );
        // 扫描开始后如果这一棒又有了进度，这次结果就过期了，不能把旧的「没动静」写回去。
        if (relay.phase !== 'running' || !step || step.who.type !== 'assistant' || step.stalledAt ||
          (expectStartedAt && step.startedAt !== expectStartedAt) ||
          Date.parse(ts) - acted < windowMs) throw NOTHING;
        return markStalled(ticket, ts, minutes);
      }).catch((e) => {
        if (e === NOTHING) return null;
        throw e;
      });
    },

    // 主人点「再叫一次」。
    async relayNudge(actor, id) {
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      return mutate(actor, id, 'relay_nudged', (ticket, ts) => {
        const relay = needRelay(ticket);
        const step = stepOf(ticket);
        if (relay.phase !== 'running' || !step || step.who.type !== 'assistant') error('CONFLICT', 'Nothing to nudge');
        return nudge(ticket, ts);
      });
    },

    // 系统往下推一步：外部命令行交回、卡住、主人挪了列、被回答之后，卡的接力数据要跟上。
    // 没有要做的就什么都不写；做了就返回 { acted, ticket }。可以重复调，不会重复推进。
    async relaySync(id) {
      checkId(id);
      const peek = await readNative(id).catch((e) => {
        if (e.code !== 'NOT_FOUND') throw e;
        return null;
      });
      if (!peek || !planSync(peek)) return { acted: null, ticket: peek };
      try {
        const ticket = await mutate(SYSTEM, id, 'relay_sync', (ticket, ts) => {
          const act = planSync(ticket);
          if (!act) throw NOTHING;
          const relay = ticket.relay;
          if (act === 'done') {
            relay.phase = 'done';
            return { relayEvent: 'done', detail: act };
          }
          if (act === 'failed') {
            const step = stepOf(ticket);
            relay.phase = 'failed';
            if (step) step.status = 'failed';
            return { relayEvent: 'failed', detail: act };
          }
          if (act === 'deliver') return { ...deliver(ticket, ticket.report.summary, ticket.report.by, ts, { reported: true }), detail: act };
          if (act === 'stuck') {
            const question = ticket.open_ask?.text ?? '被外因挡住了（对方没写原因）';
            return { ...stuck(ticket, question, ts), detail: act };
          }
          if (act === 'resume') return { ...resume(ticket, ts), detail: act };
          if (act === 'rehand') return { ...rehand(ticket, ts), detail: act };
          if (act === 'release') return { ...release(ticket, ts, { note: '主人把这张卡挪到了进行中，放行' }), detail: act };
          const note = [...ticket.progress].reverse().find((p) => p.text)?.text ?? '';
          return { ...reopenLast(ticket, note, ts), detail: act };
        });
        return { acted: ticket.history.at(-1)?.detail ?? null, ticket };
      } catch (e) {
        if (e === NOTHING) return { acted: null, ticket: peek };
        throw e;
      }
    },
  };
}
