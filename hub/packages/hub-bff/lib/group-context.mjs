import { parseMentions } from './group.mjs';
const OWNER = 'owner';
const names = ['目标', '主人说过的', '已定的决定', '分工与谁来验', '进度', '卡点', '下一步'];

/** 把一段文本压成缩进后的多行：续行一律缩进，行首前缀（#号、发言人）不可被正文复刻。 */
export function indentLines(text) {
  return String(text ?? '').split(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/).join('\n    ');
}

/** 把字段压成单行（工单标题等），换行变空格。 */
const oneLine = (v) => String(v ?? '').replace(/[\r\n\v\f\u0085\u2028\u2029]+/gu, ' ');

/** 按中日韩字符计一、其他字符计四分之一估算 token。 */
export function estimateTokens(text) {
  let count = 0;
  for (const ch of text) {
    count += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch)
      ? 1
      : 0.25;
  }
  return Math.ceil(count);
}

/** 按二级标题拆分 Markdown 页面。 */
export function splitPage(pageText) {
  const sections = Object.fromEntries(names.map((n) => [n, []]));
  const order = [], head = [];
  let current = null;
  for (const line of pageText.split('\n')) {
    const match = /^## (.+)$/.exec(line);
    if (match) {
      current = match[1];
      order.push(current);
      sections[current] ??= [];
    } else {
      if (current === null) {
        head.push(line);
      } else {
        sections[current].push(line);
      }
    }
  }
  return { head, sections, order };
}

/** 组装预算内的上下文并保留受保护内容。 */
export function buildContext(
  { group, memberId, page = '', tickets = [], messages = [], lastSpokeId = 0, options = {} },
) {
  const budget = options.tokenBudget ?? group.limits?.tokenBudget ?? 1200,
    k = options.contextMessages ?? group.limits?.contextMessages ?? 8;
  const parsed = splitPage(page);
  const dropped = [], notes = [], droppedTickets = [];
  let removedEntries = 0;
  const relevant = tickets.filter((t) =>
    !['done', 'wait_owner'].includes(t.status) &&
    (t.assignee === memberId || t.verifier === memberId)
  ).map((t) => ({ ticket: t, full: true }));
  const mentioned = messages.filter((m) => {
    if (m.id <= lastSpokeId) {
      return false;
    }
    const to = m.to ?? parseMentions(m.text, group.members);
    return to === 'all' || (Array.isArray(to) && to.includes(memberId));
  });
  const mentionedIds = new Set(mentioned.map((m) => m.id));
  let recent = (k > 0 ? messages.slice(-k) : []).filter((m) => !mentionedIds.has(m.id));
  // 最新一条主人消息即使滑出窗口，在项目页记入它之前也必须可见
  const lastOwner = [...messages].reverse().find((m) => m.from === OWNER);
  if (
    lastOwner && !mentionedIds.has(lastOwner.id) && !recent.some((m) => m.id === lastOwner.id) &&
    !page.includes(lastOwner.text)
  ) {
    recent = [lastOwner, ...recent];
  }
  const line = (m) => `#${m.id} ${oneLine(m.from)}：${indentLines(m.text)}`;
  const pageString = () => {
    if (!page) {
      return '';
    }
    const lines = [...parsed.head];
    for (const name of parsed.order) {
      lines.push(`## ${name}`, ...parsed.sections[name]);
    }
    return lines.map((line) => `    ${line}`).join('\n');
  };
  const render = () => {
    const pageValue = pageString();
    const ticketLines = relevant.map(({ ticket: t, full }) =>
      `[${oneLine(t.id)}] ${oneLine(t.title)}｜做:${oneLine(t.assignee)} 验:${oneLine(t.verifier)}｜状态:${
        oneLine(t.status)
      }${full ? `｜验收:${(t.checklist ?? []).map((c) => oneLine(c.text)).join('；')}` : ''}`
    );
    const arrays = {
      page: pageValue ? [pageValue] : [],
      tickets: ticketLines,
      mentions: mentioned.map(line),
      recent: recent.map(line),
    };
    const labels = {
      page: '项目页',
      tickets: '你的未完工单',
      mentions: '点名你的消息',
      recent: '最近消息',
    };
    const parts = {}, blocks = [];
    for (const key of Object.keys(arrays)) {
      const body = arrays[key].join('\n');
      const block = body ? `### ${labels[key]}\n${body}` : '';
      const prefix = block && blocks.length ? '\n\n' : '';
      parts[key] = { tokens: estimateTokens(prefix + block), items: arrays[key].length };
      if (block) {
        blocks.push(block);
      }
    }
    return {
      text: blocks.join('\n\n'),
      parts,
      used: Object.values(parts).reduce((n, p) => n + p.tokens, 0),
    };
  };
  let built = render();
  while (built.used > budget) {
    const i = recent.findIndex((m) => m.from !== OWNER);
    if (i < 0) {
      break;
    }
    dropped.push(recent[i].id);
    recent = recent.filter((_, j) => j !== i);
    built = render();
  }
  const mutable = new Set(['进度', '卡点', '下一步', '分工与谁来验']);
  while (built.used > budget) {
    let removed = false;
    for (const name of ['进度', '卡点', '下一步', '分工与谁来验']) {
      if (!mutable.has(name) || !parsed.sections[name]) {
        continue;
      }
      const lines = parsed.sections[name];
      const i = lines.findIndex((s) => s.startsWith('- '));
      if (i < 0) {
        continue;
      }
      let end = i + 1;
      while (end < lines.length && lines[end].startsWith('  ')) {
        end++;
      }
      lines.splice(i, end - i);
      removedEntries++;
      removed = true;
      break;
    }
    if (!removed) {
      break;
    }
    built = render();
  }
  if (removedEntries) {
    notes.push(`项目页裁去 ${removedEntries} 条目`);
  }
  for (const onlyVerifier of [true, false]) {
    for (const entry of [...relevant]) {
      if (built.used <= budget) {
        break;
      }
      if ((entry.ticket.assignee !== memberId) !== onlyVerifier) {
        continue;
      }
      if (entry.full) {
        entry.full = false;
        built = render();
      }
      if (built.used > budget) {
        relevant.splice(relevant.indexOf(entry), 1);
        droppedTickets.push(entry.ticket.id);
        notes.push(`工单 ${entry.ticket.id} 因超预算未带入上下文`);
        built = render();
      }
    }
  }
  const overBudget = built.used > budget;
  if (overBudget) {
    notes.push('受保护内容超过预算，已完整保留');
  }
  return { ...built, budget, dropped, droppedTickets, overBudget, notes };
}
