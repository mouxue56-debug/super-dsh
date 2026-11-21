// 主人跟谁说，谁答复。纯函数，不建工单、不读名册。
// 看板上主人亲手排的接力、开放认领、外部身份不在这里做决定。

// 非本职也不自动转单。主人点头后才允许整件交接。询问同事时仍由自己答复。
export function planOwnerTurn({outside = false, colleague = null, ownerAgreed = false} = {}) {
  if (ownerAgreed === true) {
    return {replyBy: 'self', ticket: true, consult: null, handoff: true};
  }
  return {
    replyBy: 'self',
    ticket: false,
    consult: outside ? colleague || null : null,
    handoff: false,
  };
}

// 这三类看板卡保持原行为，本模块不改它们的去向。
export function boardUntouched(kind) {
  return kind === 'owner-relay' || kind === 'owner-open' || kind === 'external';
}

// 没点头就调用整件交接时，给助理看的拒绝说明。
export function handoffRefusal(name) {
  const who = name || '同事';
  return '先问主人要不要交给' + who + '，主人点头后再交接（owner_ok 须为 true）。不要自动转单。'
    + '可以先用 ask_colleague 或分身拿结果，由你答复。';
}

// 一次性询问的回执：没有工单，原助理继续答复主人。
export function consultEnvelope({fromName, toName, answer}) {
  const body = answer ? String(answer) : '（对方没有返回正文）';
  return '已向' + toName + '做一次性询问，没有交接工单。对方结果：' + body
    + '。由你（' + fromName + '）答复主人。';
}
