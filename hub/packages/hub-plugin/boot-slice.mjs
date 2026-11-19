// 开工切片的硬上限。
const MAX_LINES = 7;
const MAX_TOKENS = 150;

// 清除文本中的控制字符，避免影响摘要显示。
const clean = v => String(v ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

// 按字符数量截断文本并在必要时添加省略号。
const clip = (s, n) => {
  const a = Array.from(clean(s));
  return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
};

// 估算文本中的中日韩字符和其他字符所需的 token 数量。
export function estimateTokens(text) {
  let cjk = 0, other = 0;
  // 将中日韩文字按字符计数，其他文字按四字符一个 token 估算。
  for (const c of String(text ?? '')) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(c)) {
      cjk++;
    } else {
      other++;
    }
  }
  return cjk + Math.ceil(other / 4);
}

// 生成开工切片：最多 7 行、估算不超过 150 token；等待的工单最多 3 张，空行省略。
// 超限时按优先级丢弃：日期 > 异常 > 等你批 > 知识库 > 等待工单（第 1 张最后丢）。
export function buildBootSlice(input = {}) {
  input = input && typeof input === 'object' ? input : {};
  const tickets = Array.isArray(input.tickets) ? input.tickets.filter(t => t && typeof t === 'object') : [];
  const lines = [{
    priority: 100,
    order: 0,
    text: `今天 ${clip(input.date, 20)}，待办 ${
      tickets.filter(t => !['done', 'failed'].includes(t.status)).length
    } 张`,
  }];
  if (Number(input.pendingApprovals) > 0) {
    lines.push({ priority: 80, order: 1, text: `等你批：${clean(input.pendingApprovals)} 张` });
  }
  // 有规矩就提醒先读（优先级 60：比等待的工单高、比知识库低）。
  const rules = Number(input.rules);
  if (Number.isSafeInteger(rules) && rules > 0) {
    lines.push({ priority: 60, order: 1.5, text: `你有 ${rules} 条规矩，先读（rules_read）` });
  }
  tickets
    .filter(t => ['queued', 'blocked', 'new'].includes(t.status))
    .slice(0, 3)
    .forEach((t, i) => lines.push({
      priority: 40 - i,
      order: 2 + i,
      text: `等待：${clip(t.id, 30)} ${clip(t.title, 30)}`,
    }));
  if ('kb' in input) {
    const kb = input.kb ?? {};
    const at = clean(kb.at).slice(0, 16).replace('T', ' ');
    let text = '知识库副本：状态未知';
    if (at && kb.state === 'pending') {
      text = `知识库副本：${at} 之后未确认同步`;
    } else if (at && ['pushed', 'up_to_date'].includes(kb.state)) {
      text = `知识库副本：${at} 同步（${kb.state}）`;
    }
    lines.push({ priority: 70, order: 5, text });
  }
  if (Array.isArray(input.anomalies) && input.anomalies.length) {
    lines.push({
      priority: 90,
      order: 6,
      text: '异常：' + input.anomalies.slice(0, 2).map(x => clip(x, 40)).join('；'),
    });
  }
  while (lines.length > MAX_LINES) {
    lines.splice(lines.findIndex(x => x.priority === Math.min(...lines.map(y => y.priority))), 1);
  }
  const output = () => lines.slice().sort((a, b) => a.order - b.order).map(x => x.text).join('\n');
  while (estimateTokens(output()) > MAX_TOKENS && lines.length > 1) {
    lines.splice(lines.findIndex(x => x.priority === Math.min(...lines.map(y => y.priority))), 1);
  }
  if (estimateTokens(output()) > MAX_TOKENS) {
    lines[0].text = clip(lines[0].text, 100);
  }
  return output();
}
