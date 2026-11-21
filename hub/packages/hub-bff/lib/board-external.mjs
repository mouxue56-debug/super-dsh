// 外部身份能碰哪些卡。命令行 HTTP 和投文件口共用这一份，不要各自写一套。
export const EXTERNAL_HINT_NOT_YOURS =
  '这张卡不是你的（没有派给你，也不是你发起的），不能查看或操作。';
export const EXTERNAL_HINT_CANT_TAKE =
  '这张卡没有派给你，也不是「谁有空谁接」的开放卡，不能领；只能领派给你的和开放认领的卡。';

// 自己发起的、明确派给它的、它已领取的。
export const externalInvolved = (ticket, name) => ticket?.from?.name === name || ticket?.claimedBy === name ||
  Array.isArray(ticket?.to) && ticket.to.includes(name);
// 开放认领、还没人接走的卡：可以看，可以领；别的动作不行。
export const externalOpenWaiting = ticket => ticket?.openClaim?.state === 'open' &&
  ticket.state === 'queued' && !ticket.claimedBy;
// 接力卡：它做过或正在做的那一棒。没轮到之前读不到。
export const externalOnRoute = (ticket, name) => Array.isArray(ticket?.relay?.steps) &&
  ticket.relay.steps.some(step => step?.who?.name === name && step.who.type === 'external' &&
    step.status !== 'waiting');
export const externalReadable = (ticket, name) => externalInvolved(ticket, name) ||
  externalOpenWaiting(ticket) || externalOnRoute(ticket, name);

export function externalActor(name, via) {
  const actor = { name, type: 'external' };
  if (via === 'file' || via === 'cli') actor.via = via;
  return actor;
}
