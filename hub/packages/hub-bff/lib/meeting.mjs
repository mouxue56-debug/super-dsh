import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ownerQuoteCount, scanDraft, stripOwnerTags } from './kb-contribute.mjs';
const cols = ['new', 'working', 'done', 'failed', 'blocked'];

const one = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();

// 将文本清洗为单行并按长度截断。
const cut = (s, n) => {
  const v = one(s);
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
};

const hash = (algorithm, s) => createHash(algorithm).update(s).digest('hex');

const label = (type) => {
  if (!['morning', 'evening'].includes(type)) {
    throw Error('会议类型无效');
  }
  return type === 'morning' ? '晨会' : '晚会';
};

// 按配置的时区偏移计算事件日期。
const day = (ts, cfg) => {
  const n = Date.parse(ts);
  return Number.isFinite(n)
    ? new Date(n + (cfg.utcOffsetMinutes ?? 0) * 60000).toISOString().slice(0, 10)
    : '';
};

// 纪要日期必须是真实存在的 YYYY-MM-DD。
const validDate = (date) =>
  typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;

// 按会议类型整理参会计划。
export function meetingPlan(cfg, type) {
  label(type);
  const ids = cfg.attendees?.[type];
  // 真实名册的角色是 chief / bot（旧约定写 assistant 也认）；首席主持不在参会名单里，停用的不参会。
  const attendees = cfg.roster.filter((x) =>
    ['assistant', 'bot'].includes(x.role) && (x.status === undefined || x.status === 'active') &&
    (ids === 'all' || Array.isArray(ids) && ids.includes(x.id))
  ).map(({ id, name }) => ({ id, name }));
  return { type, time: cfg.times?.[type], attendees };
}

// 读取看板工单及其进度。
export function readBoard(boardDir) {
  const out = [];
  for (const col of cols) {
    const dir = path.join(boardDir, col);
    let names;
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) {
        continue;
      }
      names = fs.readdirSync(dir).sort();
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
        continue;
      }
      throw e;
    }
    for (const name of names) {
      if (!/^T-\d{8}-\d{6}-[a-zA-Z0-9]{4}\.md$/.test(name)) {
        continue;
      }
      const file = path.join(dir, name);
      let stat;
      try {
        stat = fs.lstatSync(file);
      } catch (e) {
        if (e.code === 'ENOENT') {
          continue;
        }
        throw e;
      }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) {
        continue;
      }
      const raw = fs.readFileSync(file, 'utf8'),
        header = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
      if (!header) {
        continue;
      }
      const meta = {};
      for (const line of header[1].split(/\r?\n/)) {
        const m = line.match(/^([^:]+):\s*(.*)$/);
        if (m) {
          meta[m[1].trim()] = m[2].trim();
        }
      }
      // 提取工单中指定标题下的正文。
      const section = (n) => {
        const m = raw.match(
          new RegExp('^## ' + n + '\\s*\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))', 'm'),
        );
        return m ? m[1].trim() : '';
      };
      const task = section('任务'),
        progress = section('进度').split(/\r?\n/).map((x) => x.match(/^-\s+(\S+)\s+(.+)$/)).filter(
          Boolean,
        ).map((m) => ({ ts: m[1], text: m[2] }));
      out.push({
        id: meta.id,
        col,
        meta,
        title: meta.title || cut(task.split(/\r?\n/)[0], 60),
        task,
        progress,
        report: section('回报'),
        file,
      });
    }
  }
  return out;
}

// 读取事件文件中的有效对象。
export function readEventsJsonl(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }
  return raw.split(/\r?\n/).flatMap((line) => {
    try {
      const x = JSON.parse(line);
      return x && typeof x === 'object' && !Array.isArray(x) ? [x] : [];
    } catch {
      return [];
    }
  });
}

// 汇总助理在指定会议上的汇报。
export function collectBrief({ assistant, date, type, tickets, events, learned, cfg }) {
  const meeting = label(type),
    id = assistant.id,
    name = cfg.roster.find((x) => x.id === id)?.name || id,
    own = tickets.filter((t) => t.meta?.assignee === id || t.meta?.creator === id),
    ev = events.filter((e) => e.assistant === id),
    today = (e) => day(e.ts, cfg) === date;
  const done = own.filter((t) => t.col === 'done' && day(t.meta.updatedAt, cfg) === date).map(
    (t) => ({ id: t.id, title: t.title }),
  );
  const failed = own.filter((t) => t.col === 'failed' && day(t.meta.updatedAt, cfg) === date).map(
    (t) => ({
      id: t.id,
      title: t.title,
      reason: String(t.report ?? '').split(/\r?\n/).filter((x) => x.trim()).at(-1)?.trim() ||
        t.progress?.at(-1)?.text || '未记录',
    }),
  );
  const waiting = own.filter((t) =>
    ['new', 'working', 'blocked'].includes(t.col) && !['done', 'failed'].includes(t.meta.status)
  ).map((t) => ({ id: t.id, title: t.title, status: t.meta.status }));
  const approvals = ev.filter((e) => e.kind === 'approval_pending' && e.resolved !== true).map(
    (e) => ({ text: e.text }),
  );
  const select = (k) => ev.filter((e) => e.kind === k && today(e)).map((e) => ({ text: e.text }));
  const ownerQuotes = ev.filter((e) => e.kind === 'owner_quote' && today(e) && e.ownerQuote).map(
    (e) => ({
      text: e.ownerQuote.text,
      source: e.ownerQuote.source,
      sourceText: e.ownerQuote.sourceText,
    }),
  );
  learned = cut(learned, 120) || undefined;
  const data = {
    done,
    failed,
    waiting,
    approvals,
    decisions: select('decision'),
    practices: select('practice'),
    handoffs: select('handoff'),
    ownerQuotes,
    learned,
  };
  const group = (
    title,
    arr,
    fn,
  ) => [
    `## ${title}（${arr.length}）`,
    ...(arr.length ? arr.map((x) => cut('- ' + fn(x), 120)) : ['（无）']),
  ];
  const markdown = [
    cut(`# ${name} 给首席的${meeting}汇报 · ${date}`, 120),
    cut(
      `来源：${id} · 看板工单 + 事件账，由代码整理 · 标签：【AI归纳】【Owner未确认】`,
      120,
    ),
    ...group('做成的', done, (x) => `${x.id} ${x.title}`),
    ...group('失败的', failed, (x) => `${x.id} ${x.title} —— 原因：${x.reason}`),
    ...group('在等的', waiting, (x) => `${x.id} ${x.title}（${x.status}）`),
    ...group('要主人点头的', approvals, (x) => x.text),
    '## 学到的一条',
    learned || '（无）',
  ].join('\n');
  return { assistantId: id, assistantName: name, date, type, markdown, data };
}

// 汇编并追加会议纪要。
export function compileMinutes({ date, type, briefs, minutesDir, cfg, now = new Date() }) {
  const meeting = label(type);
  if (!path.isAbsolute(minutesDir)) {
    throw Error('纪要目录必须是绝对路径');
  }
  // 日期只接受真实存在的 YYYY-MM-DD，否则不写任何文件。
  if (!validDate(date)) {
    return { file: null, appended: false, text: '', entries: [], absent: [], rejected: [], date, type,
      error: 'invalid-date' };
  }
  const plan = meetingPlan(cfg, type),
    allowed = new Set(plan.attendees.map((x) => x.id)),
    accepted = briefs.filter((b) => allowed.has(b.assistantId)),
    rejected = briefs.filter((b) => !allowed.has(b.assistantId)).map((b) => ({
      assistantId: b.assistantId,
      reason: 'not-attendee',
    })),
    absent = plan.attendees.filter((a) => !accepted.some((b) => b.assistantId === a.id)).map((a) =>
      a.id
    );
  const dir = path.join(minutesDir, '会议');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${date}-${meeting}.md`);
  let old = '';
  let exists = true;
  try {
    old = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
    exists = false;
  }
  const seen = new Set(),
    fresh = accepted.filter((b) => {
      const mark = `<!-- brief:${hash('sha256', b.markdown).slice(0, 8)} ${b.assistantId} -->`;
      if (old.includes(mark) || seen.has(mark)) {
        return false;
      }
      seen.add(mark);
      return true;
    });
  const entries = [];
  for (const b of accepted) {
    const d = b.data;
    const add = (category, text) =>
      entries.push({ assistantId: b.assistantId, assistantName: b.assistantName, category, text });
    for (const x of d.decisions) {
      add('decision', x.text);
    }
    for (const x of d.failed) {
      add('failure', `${x.title}：${x.reason}`);
    }
    for (const x of d.practices) {
      add('practice', x.text);
    }
    for (const x of d.handoffs) {
      add('handoff', x.text);
    }
    for (const q of d.ownerQuotes) {
      add('decision', '主人原话摘录');
      entries.at(-1).ownerQuote = q;
    }
  }
  const render = (b) =>
    `<!-- brief:${hash('sha256', b.markdown).slice(0, 8)} ${b.assistantId} -->\n` +
    b.markdown.replace(/^(#{1,2}) /gm, '#$1 ');
  const summary = () => {
    const keys = [['做成的', 'done'], ['失败的', 'failed'], ['在等的', 'waiting'], [
      '要主人点头的',
      'approvals',
    ]];
    return [
      '## 汇总',
      ...keys.map(([n, k]) => `${n}：${accepted.reduce((sum, b) => sum + b.data[k].length, 0)}`),
      ...accepted.flatMap((b) =>
        b.data.approvals.map((a) => `- ${one(b.assistantName)}：${one(a.text)}`)
      ),
    ].join('\n');
  };
  let text = '';
  if (!exists) {
    text = [
      `# ${date} ${meeting}纪要`,
      `出席：${plan.attendees.map((a) => a.name).join('、') || '（无）'}`,
      `未交汇报：${
        absent.map((id) => plan.attendees.find((a) => a.id === id)?.name || id).join('、') ||
        '（无）'
      }`,
      ...fresh.map(render),
      summary(),
    ].join('\n\n') + '\n';
  } else if (fresh.length) {
    const hhmm = new Date(new Date(now).getTime() + (cfg.utcOffsetMinutes ?? 0) * 60000)
      .toISOString().slice(11, 16);
    text = (old.endsWith('\n') ? '\n' : '\n\n') +
      [`## 补充 ${hhmm}`, ...fresh.map(render), summary()].join('\n\n') + '\n';
  }
  if (text) {
    const fd = fs.openSync(file, 'a', 0o600);
    try {
      fs.writeFileSync(fd, text);
    } finally {
      fs.closeSync(fd);
    }
  }
  return { file, appended: !!text, text, entries, absent, rejected, date, type };
}

// 检查草稿中的敏感内容、主人标签及必填字段（密钥与个人信息规则与直投入口共用 scanDraft）。
export function filterDraft(draft, cfg) {
  const scan = scanDraft(draft, { bannedTerms: cfg?.bannedTerms, maxChatLines: cfg?.maxChatLines });
  const reasons = [...scan.reasons];
  const add = (b, code) => {
    if (b && !reasons.includes(code)) {
      reasons.push(code);
    }
  };
  add(!one(draft.project), 'no-project');
  add(!one(draft.summary) || !one(draft.body), 'invalid-field');
  return { ok: reasons.length === 0, reasons };
}

// 从晚会纪要中筛选知识库草稿。
// opts.resolveSource(source, text)：宿主按消息号从消息库取出主人原文；认不出就返回空，这条降级为转述。
export function pickForKb(minutes, cfg, opts = {}) {
  const resolve = opts.resolveSource ?? cfg?.resolveOwnerSource;
  if (minutes.type !== 'evening') {
    return { drafts: [], blocked: [], skipped: 'not-evening' };
  }
  const drafts = [],
    blocked = [],
    ids = new Set(),
    map = { decision: 'decision', failure: 'incident', practice: 'work', handoff: 'handoff' };
  for (const entry of minutes.entries) {
    const project = cfg.projectMap?.byAssistant?.[entry.assistantId] ?? cfg.projectMap?.default,
      kind = map[entry.category];
    const entryText = stripOwnerTags(entry.text),
      assistantName = stripOwnerTags(entry.assistantName),
      assistantId = stripOwnerTags(entry.assistantId);
    let summary = cut(entryText, 80);
    if (summary.startsWith('-')) {
      summary = cut('条目：' + summary, 80);
    }
    const body = [
      `来源助理：${assistantName}（${assistantId}）`,
      `日期：${minutes.date}（晚会）`,
      '标签：【AI归纳】【Owner未确认】',
      '',
      entryText,
    ];
    let quoteDowngraded = false,
      verifiedQuote;
    if (entry.ownerQuote) {
      const q = entry.ownerQuote,
        normalize = (s) => String(s ?? '').replace(/\s+/g, ' ').trim(),
        text = normalize(stripOwnerTags(q.text)),
        source = one(stripOwnerTags(q.source));
      // 只认宿主按消息号取回的原文；事件自带的 sourceText 一概不信。
      let original;
      try {
        original = typeof resolve === 'function' && source ? resolve(source, text) : undefined;
      } catch {
        original = undefined;
      }
      const sentences = typeof original === 'string' ? original.match(/[^。！？!?\r\n]+[。！？!?]?/g) ?? [] : [];
      const fragments = sentences.map((sentence) => sentence.replace(/[。！？!?]$/, ''));
      const matches = typeof original === 'string' &&
        [original, ...sentences, ...fragments].some((sentence) => normalize(sentence) === text);
      if (text.length >= 4 && source && matches) {
        body.push(`主人原话（逐字，出处：${source}）：「${text}」【Owner要求】`);
        verifiedQuote = { source, text };
      } else {
        body.push(`转述（非逐字，不作主人原话）：${text}`);
        quoteDowngraded = true;
      }
    }
    const value = body.join('\n'),
      id = 'dshm-' + minutes.date + '-' +
        hash('sha1', [project, kind, summary, value].join('|')).slice(0, 10),
      draft = {
        schemaVersion: 1,
        id,
        project,
        kind,
        summary,
        body: value,
        source: 'dsh-meeting-' + minutes.date + '-evening',
        evidence: ['晚会纪要 ' + minutes.date],
        next: entry.category === 'handoff' ? one(entryText.split(/\r?\n/)[0]) : '',
        assistantId,
        assistantName,
        date: minutes.date,
        labels: ['AI归纳', 'Owner未确认'],
        ...(quoteDowngraded ? { quoteDowngraded: true } : {}),
        ...(verifiedQuote ? { verifiedQuote } : {}),
      };
    const check = filterDraft(draft, cfg);
    if (!check.ok) {
      blocked.push({
        entry: {
          assistantId: entry.assistantId,
          assistantName: entry.assistantName,
          category: entry.category,
        },
        reasons: check.reasons,
      });
    } else if (!ids.has(id)) {
      ids.add(id);
      drafts.push(draft);
    }
  }
  return { drafts, blocked };
}

// 编排会议汇报、纪要和草稿处理。
export async function runMeeting(
  { date, type, boardDir, eventsFile, minutesDir, cfg, learnedByAssistant = {}, now, submit },
) {
  const tickets = readBoard(boardDir),
    events = readEventsJsonl(eventsFile),
    briefs = meetingPlan(cfg, type).attendees.map((assistant) =>
      collectBrief({
        assistant,
        date,
        type,
        tickets,
        events,
        learned: learnedByAssistant[assistant.id],
        cfg,
      })
    ),
    minutes = compileMinutes({ date, type, briefs, minutesDir, cfg, now }),
    { drafts, blocked } = pickForKb(minutes, cfg),
    submitted = [],
    pendingCards = [];
  if ((cfg.kbSubmit ?? 'card') === 'auto' && typeof submit === 'function') {
    for (const draft of drafts) {
      if (ownerQuoteCount(draft)) {
        pendingCards.push(draft);
        continue;
      }
      try {
        submitted.push(await submit(draft));
      } catch {
        submitted.push({ id: draft.id, state: 'error', reason: 'submit-threw' });
      }
    }
  } else if ((cfg.kbSubmit ?? 'card') === 'card') {
    pendingCards.push(...drafts);
  }
  return { minutes, drafts, blocked, submitted, pendingCards, kbSubmit: cfg.kbSubmit ?? 'card' };
}
