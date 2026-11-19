// 看板上的「开放认领」操作（谁有空谁接）。由 board.mjs 在建看板时把内部工具递过来，这里不碰文件。
// 规则：只有明确挂成开放认领的卡才算（旧卡、没写负责人的卡不会自动变成开放）。
// 一张开放卡同一时刻只有一个出路：首席派给某位助理 / 外部身份领走 / 主人自己派或挪走 / 首席转问主人。
// 这些出路都走 mutate（按单加锁，写盘前核对版本），所以两边同时来只会成功一个，后到的得到「已被 X 接走」。
// 【AI建议】
import { BoardError } from './board-errors.mjs';
import { OPEN_INIT } from './ticket.mjs';

const error = (code, message) => {
  throw new BoardError(code, message);
};
const NAME = /^[A-Za-z0-9_.-]{1,64}$/u;
const cut = (value, max) => Array.from(String(value ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim()).slice(0, max).join('');

// 这张卡现在是不是「挂着没人接」。
export const isOpenWaiting = (ticket) =>
  ticket?.openClaim?.state === 'open' && ticket.state === 'queued' && !ticket.claimedBy;

export function createClaimOps({ mutate, createWithMeta, guardActor }) {
  return {
    // 主人新建一张开放认领的卡。
    async openCreate(actor, input) {
      guardActor(actor);
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      const { ticket } = await createWithMeta(actor, { ...input, to: [], [OPEN_INIT]: true });
      return ticket;
    },

    // 主人把一张还没人接的旧卡改成「谁有空谁接」。已有负责人、已在做、接力卡都不行。
    async ownerOpen(actor, id) {
      if (actor?.type !== 'owner') error('FORBIDDEN', 'Not permitted');
      return mutate(actor, id, 'owner_open', (ticket, ts) => {
        if (ticket.relay) error('CONFLICT', 'Relay ticket cannot be opened');
        if (ticket.state !== 'queued' || ticket.claimedBy) error('CONFLICT', 'Ticket already has a worker');
        ticket.to = [];
        ticket.openClaim = { state: 'open', openedAt: ts };
      });
    },

    // 首席把一张开放卡派给某位内部助理，并留一句为什么。
    async openAssign(actor, id, { bot, shown, reason }) {
      if (actor?.type !== 'assistant') error('FORBIDDEN', 'Not permitted');
      if (typeof bot !== 'string' || !NAME.test(bot)) error('INVALID', 'Invalid assignee');
      const why = cut(reason, 300);
      if (!why) error('INVALID', 'Invalid reason');
      return mutate(actor, id, 'open_assigned', (ticket, ts) => {
        if (ticket.openClaim?.state === 'taken') error('CONFLICT', 'Already taken');
        if (ticket.openClaim?.state !== 'open' || ticket.state !== 'queued' || ticket.claimedBy) {
          error('CONFLICT', 'Not open for claiming');
        }
        ticket.to = [bot];
        ticket.openClaim = {
          ...ticket.openClaim, state: 'taken', takenBy: bot, takenType: 'assistant',
          takenShown: cut(shown ?? bot, 40) || bot, via: 'chief', reason: why, at: ts,
        };
        return { detail: why, assignedTo: bot };
      });
    },

    // 首席拿不准：把卡转成「等你」问主人。主人回答后卡回到「谁有空谁接」，再叫首席。
    async openAsk(actor, id, question) {
      if (actor?.type !== 'assistant') error('FORBIDDEN', 'Not permitted');
      const q = cut(question, 400);
      if (!q) error('INVALID', 'Invalid question');
      return mutate(actor, id, 'open_asked', (ticket, ts) => {
        if (ticket.openClaim?.state === 'taken') error('CONFLICT', 'Already taken');
        if (ticket.openClaim?.state !== 'open' || ticket.state !== 'queued' || ticket.claimedBy) {
          error('CONFLICT', 'Not open for claiming');
        }
        ticket.state = 'waiting-human';
        ticket.open_ask = { text: q, ts };
        ticket.openClaim = { ...ticket.openClaim, state: 'asked', at: ts };
        return { detail: q, attention: true, attentionKind: 'waiting-human', reason: q };
      });
    },
  };
}
