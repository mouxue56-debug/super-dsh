export const OWNER = 'owner';
export const SECTIONS = [
  '目标', '主人说过的', '已定的决定', '分工与谁来验', '进度', '卡点', '下一步'
];
/** 提取文本中的全部消息引用。 */
export function extractRefs(text) {
  return [...String(text).matchAll(/#(\d+)/g)].map(m => Number(m[1]));
}

/** 创建包含全部必需段落的项目页。 */
export function emptyPage({ name, goal }) {
  const flatName = String(name ?? '').replace(/[\r\n\v\f\u0085\u2028\u2029]+/gu, ' ');
  const flatGoal = String(goal ?? '').replace(/[\r\n\v\f\u0085\u2028\u2029]+/gu, ' ');
  const sections = SECTIONS.map(s => `## ${s}\n${s === '目标' ? `- ${flatGoal}\n` : ''}`).join('');
  return `# 项目页：${flatName}\n${sections}`;
}

/** 解析段落标题和条目并保留原始行。 */
export function parsePage(text) {
  const lines = String(text).split('\n');
  const sections = Object.fromEntries(SECTIONS.map(s => [
    s, []
  ]));
  const occurrences = [];
  let current = null;
  let entry = null;
  for (const line of lines) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      current = SECTIONS.includes(heading[1]) ? heading[1] : null;
      occurrences.push(heading[1]);
      entry = null;
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith('- ')) {
      entry = { lines: [line] };
      sections[current].push(entry);
    } else if (entry && line.startsWith('  ')) {
      entry.lines.push(line);
    } else {
      entry = null;
    }
  }
  for (const entries of Object.values(sections)) {
    for (const item of entries) {
      item.text = [
        item.lines[0].slice(2), ...item.lines.slice(1).map(l => l.slice(2))
      ].join('\n');
      item.refs = extractRefs(item.text);
      item.done = item.text.startsWith('✓ ');
      item.voided = item.text.includes('〔作废〕');
    }
  }
  const errors = [];
  for (const s of SECTIONS) {
    const count = occurrences.filter(x => x === s).length;
    if (!count) {
      errors.push(`缺少标题：${s}`);
    }
    if (count > 1) {
      errors.push(`重复标题：${s}`);
    }
  }
  if (occurrences.length !== SECTIONS.length || occurrences.some((s, i) => s !== SECTIONS[i])) {
    errors.push('标题顺序或内容不正确');
  }
  return {
    title: lines[0]?.startsWith('# ') ? lines[0].slice(2) : null, sections, errors, _raw: String(text)
  };
}

/** 按原始内容还原解析后的项目页。 */
export function renderPage(parsed) {
  return parsed._raw;
}

/** 查找指定段落的行范围。 */
function bounds(text, section) {
  const lines = text.split('\n');
  const start = lines.indexOf(`## ${section}`);
  if (start < 0) {
    return null;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) {
    end++;
  }
  return {
    lines, start, end
  };
}

/** 读取指定段落的内容行。 */
function sectionLines(text, section) {
  const b = bounds(text, section);
  return b ? b.lines.slice(b.start + 1, b.end) : [];
}

/** 替换指定段落的内容行。 */
function replaceSection(text, section, content) {
  const b = bounds(text, section);
  if (!b) {
    return text;
  }
  b.lines.splice(b.start + 1, b.end - b.start - 1, ...content);
  return b.lines.join('\n');
}

/** 向指定段落追加内容行。 */
function appendLines(text, section, addition) {
  const b = bounds(text, section);
  if (!b || !addition.length) {
    return text;
  }
  let pos = b.end;
  if (pos === b.lines.length && b.lines[pos - 1] === '') {
    pos--;
  }
  b.lines.splice(pos, 0, ...addition);
  return b.lines.join('\n');
}

/** 判断是否需要生成纪要并列出原因。 */
export function shouldSummarize({ messagesSinceSummary, ownerSpoke, ticketFinished, n = 20 }) {
  const reasons = [];
  if (messagesSinceSummary >= n) {
    reasons.push('消息数量达到阈值');
  }
  if (ownerSpoke) {
    reasons.push('主人发言');
  }
  if (ticketFinished) {
    reasons.push('工单完成');
  }
  return {
    due: reasons.length > 0, reasons
  };
}

/** 根据新消息和工单变化生成纪要骨架。 */
export function buildSkeleton({ messages, tickets = [], prevTicketStatus = {}, pageText }) {
  const ownerQuotes = messages.filter(m => m.from === OWNER).map(({ id, text }) => ({
    id, text
  }));
  const decisions = messages.filter(m => m.text.includes('〔决定〕')).map(({ id, from, text }) => ({
    id, from, text
  }));
  const objections = messages.filter(m => m.text.includes('〔异议〕')).map(({ id, from, text }) => ({
    id, from, text
  }));
  const ticketChanges = tickets.filter(t => prevTicketStatus[t.id] !== t.status).map(t => ({
    id: t.id, title: t.title, from: prevTicketStatus[t.id], to: t.status
  }));
  const prompt = `现有项目页：\n${pageText}\n骨架：\n${JSON.stringify({
    ownerQuotes, decisions, objections, ticketChanges
  })}\n只改写进度、卡点、下一步、分工与谁来验四段与新增决定的措辞；前两段不许动；每条决定必须带 #消息号。保持七个标题。`;
  return {
    ownerQuotes, decisions, objections, ticketChanges, prompt
  };
}

/** 追加尚未记录的主人原话并保留旧行。 */
export function appendOwnerQuotes(pageText, msgs) {
  const b = bounds(pageText, '主人说过的');
  if (!b) {
    return pageText;
  }
  const seen = new Set(
    parsePage(pageText).sections['主人说过的']
      .map(x => /^\[#(\d+)\]/.exec(x.text)?.[1])
      .filter(Boolean)
      .map(Number)
  );
  const added = [];
  for (const m of msgs) {
    if (m.from === OWNER && !seen.has(Number(m.id))) {
      const parts = m.text.split('\n');
      added.push(`- [#${m.id}] ${parts[0]}`, ...parts.slice(1).map(x => `  ${x}`));
      seen.add(Number(m.id));
    }
  }
  return appendLines(pageText, '主人说过的', added);
}

/** 检查主人原话、决定和异议是否覆盖。 */
export function checkCoverage({ pageText, messages }) {
  const p = parsePage(pageText);
  const missing = [];
  const notes = [...p.errors];
  for (const m of messages) {
    if (m.from === OWNER && !p.sections['主人说过的'].some(
      x => new RegExp(`^\\[#${Number(m.id)}\\] `).test(x.text) && x.text.slice(x.text.indexOf('] ') + 2) === m.text
    )) {
      missing.push({
        id: m.id, kind: 'owner'
      });
    }
    if (m.text.includes('〔决定〕') && !p.sections['已定的决定'].some(x => x.refs.includes(Number(m.id)))) {
      missing.push({
        id: m.id, kind: 'decision'
      });
    }
    if (m.text.includes('〔异议〕') && ![
      '卡点', '已定的决定'
    ].some(s => p.sections[s].some(x => x.refs.includes(Number(m.id))))) {
      missing.push({
        id: m.id, kind: 'objection'
      });
    }
  }
  return {
    complete: missing.length === 0 && notes.length === 0, missing, notes
  };
}

/** 计算文本的实际行数。 */
function countLines(text) {
  return text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/** 按顺序归档合格条目以控制项目页行数。 */
export function archiveOverflow(pageText, { maxLines = 60 } = {}) {
  const archived = [];
  let text = pageText;
  const stages = [
    [
      '进度', '卡点', '下一步', '分工与谁来验'
    ].map(s => [
      s, x => x.done
    ]), [[
        '已定的决定', x => x.voided
      ]], [[
        '进度', () => true
      ]]
  ];
  for (const stage of stages) {
    for (const [section, predicate] of stage) {
      while (countLines(text) > maxLines) {
        const item = parsePage(text).sections[section].find(predicate);
        if (!item) {
          break;
        }
        const b = bounds(text, section);
        let index = -1;
        for (let i = b.start + 1; i < b.end; i++) {
          if (item.lines.every((l, j) => b.lines[i + j] === l)) {
            index = i;
            break;
          }
        }
        if (index < 0) {
          break;
        }
        const removed = b.lines.splice(index, item.lines.length);
        archived.push(...removed.map(l => `[${section}] ${l}`));
        text = b.lines.join('\n');
      }
    }
  }
  const lineCount = countLines(text);
  return {
    pageText: text, archived, overLimit: lineCount > maxLines, lineCount
  };
}

/** 合并模型纪要并保留受保护的内容。 */
export function finalizeSummary({ oldPageText, modelPageText, messages, maxLines = 60 }) {
  const old = parsePage(oldPageText);
  const model = parsePage(modelPageText);
  const warnings = [];
  let text;
  if (model.errors.length || old.errors.length) {
    warnings.push('项目页标题格式不正确，沿用旧页');
    text = oldPageText;
  } else {
    text = modelPageText;
    for (const s of [
      '目标', '主人说过的'
    ]) {
      text = replaceSection(text, s, sectionLines(oldPageText, s));
    }
    const oldEntries = old.sections['已定的决定'];
    const seen = new Set(oldEntries.flatMap(x => x.refs));
    const added = [];
    // 新决定必须引用本批消息里真实存在、且确实带〔决定〕标记的消息号，模型自己编的一律丢弃
    const real = new Set(messages.filter(m => String(m.text).includes('〔决定〕')).map(m => Number(m.id)));
    for (const item of model.sections['已定的决定']) {
      if (!item.refs.length || item.refs.some(id => seen.has(id))) {
        continue;
      }
      if (item.refs.every(id => real.has(id))) {
        added.push(...item.lines);
        item.refs.forEach(id => seen.add(id));
      } else {
        warnings.push(`丢弃引用了不存在或非决定消息的决定：${item.refs.map(id => `#${id}`).join('、')}`);
      }
    }
    text = replaceSection(text, '已定的决定', sectionLines(oldPageText, '已定的决定'));
    text = appendLines(text, '已定的决定', added);
  }
  text = appendOwnerQuotes(text, messages);
  const coverage = checkCoverage({
    pageText: text, messages
  });
  if (!coverage.complete) {
    const labels = {
      owner: '主人', decision: '决定', objection: '异议'
    };
    text = appendLines(text, '卡点', [
      `- 〔纪要不完整〕缺：${coverage.missing.map(x => `#${x.id}（${labels[x.kind]}）`).join('、') || '项目页格式'}`
    ]);
    warnings.push('纪要不完整');
  }
  const result = archiveOverflow(text, { maxLines });
  if (result.overLimit) {
    warnings.push('项目页仍超过行数上限');
  }
  return {
    pageText: result.pageText, archived: result.archived, coverage, warnings, ok: coverage.complete
  };
}
