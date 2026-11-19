import fs from 'node:fs';
import path from 'node:path';
import { parsePage } from './group-page.mjs';

const limit = 256 * 1024;
const noon = (date, offset) => new Date(Date.parse(date + 'T00:00:00Z') - offset * 60000 + 43200000).toISOString();
const safeId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && id !== '..';

function read(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function directory(dir) {
  if (!dir || !path.isAbsolute(dir)) return [];
  let current = path.parse(dir).root;
  for (const part of path.resolve(dir).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
    } catch {
      return [];
    }
  }
  try {
    const stat = fs.lstatSync(dir);
    return stat.isDirectory() && !stat.isSymbolicLink() ? fs.readdirSync(dir).sort() : [];
  } catch {
    return [];
  }
}

// 按指定偏移计算本地日期。
export function localDate(ms, offsetMinutes) {
  const n = new Date(ms).getTime();
  return Number.isFinite(n) ? new Date(n + offsetMinutes * 60000).toISOString().slice(0, 10) : '';
}

// 按配置、时区或系统时区计算偏移。
export function offsetFor(config, ms) {
  if (Number.isInteger(config?.utcOffsetMinutes)) return config.utcOffsetMinutes;
  if (config?.timezone) {
    try {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, timeZoneName: 'longOffset' });
      const name = fmt.formatToParts(new Date(ms)).find(x => x.type === 'timeZoneName')?.value;
      const match = (name ?? '').match(/^GMT(?:([+-])(\d{2}):(\d{2}))?$/);
      if (match) return match[1] ? (match[1] === '+' ? 1 : -1) * (+match[2] * 60 + +match[3]) : 0;
    } catch {
    }
  }
  return -new Date(ms).getTimezoneOffset();
}

// 将原始工单转换为会议汇报所需的格式。
export function toTickets(rawTickets) {
  const cols = { queued: 'new', progress: 'working', completed: 'done', failed: 'failed' };
  return (Array.isArray(rawTickets) ? rawTickets : []).map(t => ({
    id: t.id,
    col: cols[t.state] ?? 'blocked',
    meta: {
      assignee: t.claimedBy ?? t.to?.[0],
      creator: t.from?.name,
      status: t.state === 'completed' ? 'done' : t.state,
      updatedAt: t.updatedAt,
    },
    title: t.title,
    task: t.goal,
    progress: (t.progress ?? []).map(({ ts, text }) => ({ ts, text })),
    report: t.report?.summary,
  }));
}

// 从当日核验和转交的工单提取晚会事件。
export function ticketEvents({ tickets = [], date, offsetMinutes = 0, type }) {
  if (type !== 'evening') return [];
  const events = [];
  for (const t of tickets) {
    const assistant = t.claimedBy ?? t.to?.[0];
    if (!assistant) continue;
    const add = (kind, text) => events.push({
      ts: noon(date, offsetMinutes), assistant, kind, text, ticket: t.id, key: `${kind}:${t.id}:${date}`,
    });
    if (t.report?.summary && (t.verification ?? []).some(v =>
      v.verdict === 'pass' && localDate(v.ts, offsetMinutes) === date)) {
      add('practice', `${t.title}：${t.report.summary}（核验通过）`);
    }
    if (!['completed', 'failed'].includes(t.state) && t.hop > 0 && localDate(t.updatedAt, offsetMinutes) === date) {
      add('handoff', `${t.title} 已转交，目前 ${t.state}`);
    }
  }
  return events;
}

// 读取当日项目页，提取已归属的决定与原话。
export function groupPageEvents({ dir, date, offsetMinutes = 0, attendees = [], seen = new Set() }) {
  const events = [];
  const seenAdd = [];
  let unattributed = 0;
  const files = [];
  for (const name of directory(dir)) {
    const file = path.join(dir, name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isFile() && name.endsWith('.md')) files.push(file);
      if (stat.isDirectory()) {
        // 讨论组目录里只认项目页；归档.md 是旧页的堆叠，读了会重复计数。
        for (const child of directory(file)) {
          if (child === '项目页.md') files.push(path.join(file, child));
        }
      }
    } catch {
    }
  }
  for (const file of files) {
    const text = read(file);
    if (text === null || localDate(fs.lstatSync(file).mtimeMs, offsetMinutes) !== date) continue;
    const page = parsePage(text);
    const group = page.title || path.basename(file, '.md');
    const assignment = page.sections['分工与谁来验'].map(x => x.text).join('\n');
    const matches = attendees.flatMap(a => [a.id, a.name].filter(Boolean).map(value =>
      ({ assistant: a, index: assignment.indexOf(value) }))).filter(x => x.index >= 0);
    matches.sort((a, b) => a.index - b.index);
    const assistant = matches[0]?.assistant;
    const decisions = page.sections['已定的决定'].filter(x => x.refs.length);
    const quotes = page.sections['主人说过的'];
    if (!assistant) {
      unattributed += decisions.filter(x => x.refs.some(n => !seen.has(`${group}#${n}`))).length + quotes.length;
      continue;
    }
    const base = { ts: noon(date, offsetMinutes), assistant: assistant.id };
    for (const item of decisions) {
      const fresh = item.refs.filter(n => !seen.has(`${group}#${n}`));
      if (!fresh.length) continue;
      const key = `${group}#${fresh[0]}`;
      const event = { ...base, kind: 'decision', text: item.text, key };
      events.push(event);
      seenAdd.push(...fresh.map(n => `${group}#${n}`));
    }
    for (const item of quotes) {
      const original = item.lines[0].slice(2);
      const quote = original.replace(/^\[#\d+\]\s*/, '').trim();
      const ref = item.refs[0] ?? '';
      const quoteKey = `${group}#q${ref}`;
      if (ref !== '' && seen.has(quoteKey)) continue;
      if (ref !== '') seenAdd.push(quoteKey);
      const ownerQuote = { text: quote, source: `项目页 ${group} #${ref}`, sourceText: original };
      events.push({ ...base, kind: 'owner_quote', text: quote, ownerQuote });
    }
  }
  return { events, seenAdd, unattributed };
}

// 读取参会者规矩页中的当日记录。
export function rulesEvents({ dir, date, offsetMinutes = 0, attendees = [] }) {
  const events = [];
  for (const assistant of attendees) {
    if (!safeId(assistant.id) || !directory(dir).includes(assistant.id)) continue;
    const sub = path.join(dir, assistant.id);
    if (!directory(dir).includes(assistant.id) || !directory(sub).includes('规矩.md')) continue;
    const text = read(path.join(sub, '规矩.md'));
    if (text === null) continue;
    for (const original of text.split(/\r?\n/)) {
      const line = original.slice(0, 300);
      const match = line.match(/^- (\d{4}-\d{2}-\d{2})\s+(.+)$/);
      if (!match || match[1] !== date) continue;
      const quote = match[2].match(/「([^」]+)」/);
      const event = { ts: noon(date, offsetMinutes), assistant: assistant.id, text: match[2] };
      if (quote) {
        event.kind = 'owner_quote';
        event.ownerQuote = { text: quote[1], source: `${assistant.id}规矩页 ${date}`, sourceText: line };
      } else {
        event.kind = 'practice';
      }
      events.push(event);
    }
  }
  return events;
}
