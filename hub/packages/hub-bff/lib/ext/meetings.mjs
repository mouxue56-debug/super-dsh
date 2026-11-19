import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { collectBrief, compileMinutes, meetingPlan, pickForKb } from '../meeting.mjs';
import { approveCard, grantKey, ownerQuoteCount, readGrants, writeCardDigest } from '../kb-contribute.mjs';
import { readLedgerEvents } from '../ledger-map.mjs';
import { depsStopped } from '../panic-marker.mjs';
import { groupPageEvents, localDate, offsetFor, rulesEvents, ticketEvents, toTickets } from '../meetings-sources.mjs';

const running = new Set();
const asked = new Set();
const attempts = new Map();
const jobs = new Set();
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{5,80}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
let timer;

// 验证由登录设备附加的标识格式。
function validDevice(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value);
}

function clock(deps) {
  const value = new Date(deps.now?.() ?? Date.now()).getTime();
  return Number.isFinite(value) ? value : Date.now();
}

function validDate(date) {
  return typeof date === 'string' && datePattern.test(date) &&
    Number.isFinite(Date.parse(date + 'T00:00:00Z')) &&
    new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
}

// 目录本身不能是符号链接；上层目录（如系统临时目录的别名）不限制。
function safeDir(dir) {
  if (!dir || !path.isAbsolute(dir)) return false;
  try {
    const stat = fs.lstatSync(dir);
    return !stat.isSymbolicLink() && stat.isDirectory();
  } catch (e) {
    return e.code === 'ENOENT';
  }
}

function read(file) {
  try {
    if (!safeDir(path.dirname(file))) return null;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function json(file, fallback) {
  try {
    return JSON.parse(read(file) ?? '');
  } catch {
    return fallback;
  }
}

function ensure(dir) {
  if (!safeDir(dir)) throw new Error('invalid directory');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function atomic(file, value) {
  ensure(path.dirname(file));
  const tmp = file + '.' + randomBytes(8).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}

function config(deps) {
  const c = deps.hubConfig?.meetings ?? {};
  const minutesDir = c.minutesDir ?? (deps.dataDir && path.join(deps.dataDir, 'meetings'));
  const ledgerDir = c.ledgerDir ?? deps.ledger?.dir ?? (deps.dataDir && path.join(deps.dataDir, 'ledger'));
  const kb = c.kb ?? {};
  // 讨论组项目页在 <dataDir>/groups/<组>/项目页.md；各助理规矩页在 <botsDir>/<助理>/规矩.md。没配就用这两处。
  const groupPagesDir = c.groupPagesDir ?? (deps.dataDir && path.join(deps.dataDir, 'groups'));
  const rulesDir = c.rulesDir ?? deps.botsDir;
  return { ...c, minutesDir, ledgerDir, groupPagesDir, rulesDir, kb: {
    ...kb,
    contributor: kb.contributor ?? 'dsh-chief',
    workDir: kb.workDir ?? (minutesDir && path.join(minutesDir, 'kb-work')),
    pendingDir: kb.pendingDir ?? (minutesDir && path.join(minutesDir, 'kb-pending')),
    grantsFile: kb.grantsFile ?? (deps.configDir && path.join(deps.configDir, 'kb-contribute-grants.json')),
    approval: 'card',
  } };
}

function minutesFile(dir, date, type) {
  return path.join(dir, '会议', `${date}-${type === 'morning' ? '晨会' : '晚会'}.md`);
}

function listFiles(dir) {
  try {
    if (!safeDir(dir)) return [];
    const stat = fs.lstatSync(dir);
    return stat.isDirectory() && !stat.isSymbolicLink() ? fs.readdirSync(dir).sort() : [];
  } catch {
    return [];
  }
}

function pendingDrafts(c) {
  if (!c.kb.pendingDir) return [];
  return listFiles(c.kb.pendingDir).flatMap(name => {
    const id = name.endsWith('.json') ? name.slice(0, -5) : '';
    if (!idPattern.test(id)) return [];
    const draft = json(path.join(c.kb.pendingDir, name), null);
    return draft?.id === id ? [draft] : [];
  });
}

function card(d) {
  return {
    id: 'kb-' + d.id,
    kind: 'kb-submit',
    title: '要不要把今天的一条记到知识库？',
    what: `把这一条（${d.summary}）记到知识库的「${d.project}」下`,
    where: '知识库（经固定的 kb-agent 通道，带 AI归纳 标签）',
    why: `晚会挑出的可复用条目；含主人原话 ${ownerQuoteCount(d)} 条`,
    project: d.project,
    summary: d.summary,
    draftId: d.id,
    draftKind: d.kind,
    bodyPreview: d.body.slice(0, 600),
    bodyTruncated: d.body.length > 600,
    bodyLength: d.body.length,
    actions: [
      { id: 'approve', label: '投递' },
      { id: 'approve-always', label: '以后这类不用问' },
      { id: 'reject', label: '不投' },
    ],
  };
}

function logEvent(deps, c, row) {
  if (!c.minutesDir) return;
  try {
    ensure(c.minutesDir);
    const file = path.join(c.minutesDir, 'kb-log.jsonl');
    if (fs.existsSync(file) && read(file) === null) return;
    fs.appendFileSync(file, JSON.stringify(row) + '\n', { mode: 0o600 });
  } catch {
  }
  try {
    Promise.resolve(deps.notify?.({ type: 'meeting-kb', ...row })).catch(() => {});
  } catch {
  }
}

function processed(c) {
  if (!c.minutesDir) return new Set();
  const text = read(path.join(c.minutesDir, 'kb-log.jsonl')) ?? '';
  return new Set(text.split('\n').flatMap(line => {
    try {
      const row = JSON.parse(line);
      return ['delivered', 'rejected'].includes(row.state) ? [row.id] : [];
    } catch {
      return [];
    }
  }));
}

function saveDraft(c, d) {
  ensure(c.kb.pendingDir);
  const file = path.join(c.kb.pendingDir, d.id + '.json');
  if (fs.existsSync(file)) return;
  fs.writeFileSync(file, JSON.stringify(d), { mode: 0o600, flag: 'wx' });
  // 出示确认卡的同时记下草稿校验和，批准时核对。
  writeCardDigest(c.kb.pendingDir, d);
}

function removeDraft(c, id) {
  const file = path.join(c.kb.pendingDir, id + '.json');
  if (read(file) !== null) fs.unlinkSync(file);
  try {
    fs.unlinkSync(path.join(c.kb.pendingDir, id + '.sha256'));
  } catch {
  }
}

function kbConfig(deps, c) {
  return { ...c.kb, activity: event => logEvent(deps, c, { state: 'activity', text: event.text, ts: event.ts }) };
}

async function roster(deps) {
  try {
    const value = Array.isArray(deps.roster) ? deps.roster :
      typeof deps.roster?.list === 'function' ? await deps.roster.list() : deps.roster?.bots;
    return (Array.isArray(value) ? value : []).filter(x => x && (!x.status || x.status === 'active'))
      .map(({ id, name, role }) => ({ id, name, role }));
  } catch {
    return [];
  }
}

// 为每位参会助理创建独立会话并等待学习内容。
async function learn(deps, assistant, type, c) {
  if (!deps.sessions?.send || !deps.sessions?.create) return '';
  let timeout;
  try {
    return await Promise.race([
      (async () => {
        const title = type === 'morning' ? '晨会' : '晚会';
        const created = await deps.sessions.create(assistant.id, { title, purpose: 'meeting', hidden: true });
        const id = typeof created === 'string' ? created : created?.id;
        if (!id) return '';
        const prompt = c.learnPrompt ?? `开${title}了。` +
          '请只用一句话写出你最近学到的一条（做法或教训）。' +
          '不要贴聊天原文，不含密钥和个人信息，不要调用任何工具。';
        const answer = await deps.sessions.send(id, prompt);
        const reply = answer?.reply === undefined ? answer : await answer.reply;
        if (answer?.failed || reply?.failed) return '';
        const value = typeof reply === 'string' ? reply : reply?.text ?? reply?.content ?? reply?.answer;
        return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim().slice(0, 200) : '';
      })(),
      new Promise(resolve => { timeout = setTimeout(() => resolve(''), c.learnTimeoutMs ?? 120000); }),
    ]);
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

// 读取指定日期的晨会与晚会纪要。
export function readTodayMinutes(deps = {}, { date } = {}) {
  const c = config(deps);
  const ms = clock(deps);
  date ??= localDate(ms, offsetFor(c, ms));
  if (!validDate(date) || !c.minutesDir || !safeDir(c.minutesDir)) return { date, minutes: [] };
  const minutes = ['morning', 'evening'].flatMap(type => {
    const file = minutesFile(c.minutesDir, date, type);
    const text = read(file);
    return text === null ? [] : [{ type, file, text }];
  });
  return { date, minutes };
}

// 创建会议服务，负责汇报、纪要和确认卡。
export function createMeetingService(deps = {}) {
  const c = config(deps);
  const kb = kbConfig(deps, c);
  async function apply(id, decision, by = 'owner') {
    if (!idPattern.test(id) || !c.kb.pendingDir) return { state: 'not-found' };
    const draft = json(path.join(c.kb.pendingDir, id + '.json'), null);
    if (!draft || draft.id !== id) return { state: 'not-found' };
    const row = { id, project: draft.project, kind: draft.kind, summary: draft.summary, by,
      ts: new Date(clock(deps)).toISOString() };
    if (decision === 'reject') {
      removeDraft(c, id);
      logEvent(deps, c, { ...row, state: 'rejected' });
      return { state: 'rejected' };
    }
    if (!c.kb.kbAgentPath || !path.isAbsolute(c.kb.kbAgentPath)) {
      return { state: 'pending', reason: 'kb-not-configured' };
    }
    try {
      ensure(c.kb.workDir);
      if (c.kb.grantsFile && fs.existsSync(c.kb.grantsFile) && read(c.kb.grantsFile) === null) {
        return { state: 'pending', reason: 'config-error' };
      }
      const options = { always: decision === 'approve-always', by,
        date: localDate(clock(deps), offsetFor(c, clock(deps))) };
      const result = await approveCard(draft, kb, { execFile: deps.kbExecFile }, options);
      if (result.state === 'delivered') {
        removeDraft(c, id);
        logEvent(deps, c, { ...row, state: 'delivered' });
      }
      return { state: result.state, ...(result.reason ? { reason: result.reason } : {}) };
    } catch {
      return { state: 'pending', reason: 'config-error' };
    }
  }
  // 一键全停期间晨会晚会都不开；开到一半停了也不写纪要（免得写出一份人人缺席的空纪要）。
  const halt = () => {
    if (!depsStopped(deps, { whenUnknown: false })) return;
    const e = new Error('已一键全停，恢复后再运行');
    e.code = 'PANIC_STOPPED';
    e.status = 503;
    throw e;
  };
  async function run({ type, date } = {}) {
    halt();
    const ms = clock(deps);
    const offset = offsetFor(c, ms);
    date ??= localDate(ms, offset);
    if (!['morning', 'evening'].includes(type) || !validDate(date)) {
      const e = new Error('invalid');
      e.code = 'INVALID';
      throw e;
    }
    const key = `${c.minutesDir}|${date}|${type}`;
    if (running.has(key)) {
      const e = new Error('running');
      e.code = 'RUNNING';
      throw e;
    }
    running.add(key);
    try {
      const cfg = { ...c, roster: await roster(deps), utcOffsetMinutes: offset,
        attendees: { morning: 'all', evening: 'all', ...c.attendees },
        projectMap: { byAssistant: {}, default: 'dsh', ...c.projectMap } };
      const attendees = meetingPlan(cfg, type).attendees;
      const answers = await Promise.allSettled(attendees.map(a => learn(deps, a, type, c)));
      const learned = Object.fromEntries(attendees.map((a, i) =>
        [a.id, answers[i].status === 'fulfilled' ? answers[i].value : '']));
      let raw = [];
      try {
        const value = await deps.board?.list?.();
        raw = Array.isArray(value) ? value : [];
      } catch {
      }
      let events = [];
      const previous = new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
      try {
        if (c.ledgerDir && safeDir(c.ledgerDir) && safeDir(path.join(c.ledgerDir, 'events'))) {
          const dates = [date, previous].filter(day =>
            read(path.join(c.ledgerDir, 'events', day + '.jsonl')) !== null);
          events = readLedgerEvents(c.ledgerDir, dates);
        }
      } catch {
      }
      const seenFile = c.minutesDir && path.join(c.minutesDir, 'seen.json');
      const savedSeen = seenFile ? json(seenFile, []) : [];
      const seen = new Set(Array.isArray(savedSeen) ? savedSeen : []);
      let additions = [];
      if (type === 'evening') {
        const group = groupPageEvents({ dir: c.groupPagesDir, date, offsetMinutes: offset, attendees, seen });
        additions = group.seenAdd;
        events.push(...ticketEvents({ tickets: raw, date, offsetMinutes: offset, type }), ...group.events);
        events.push(...rulesEvents({ dir: c.rulesDir, date, offsetMinutes: offset, attendees }));
      }
      const ts = new Date(Date.parse(date + 'T00:00:00Z') - offset * 60000 + 43200000).toISOString();
      events.push(...attendees.filter(a => learned[a.id]).map(a =>
        ({ ts, assistant: a.id, kind: 'practice', text: '学到的一条：' + learned[a.id] })));
      const briefs = attendees.map(assistant => collectBrief({ assistant, date, type, tickets: toTickets(raw),
        events, learned: learned[assistant.id], cfg }));
      if (!c.minutesDir || !safeDir(c.minutesDir) || !safeDir(path.join(c.minutesDir, '会议'))) {
        return { type, date, file: null, appended: false, absent: [], drafts: 0, blocked: [], cards: [],
          submitted: [], learned: Object.fromEntries(attendees.map(a => [a.id, !!learned[a.id]])) };
      }
      halt();
      const target = minutesFile(c.minutesDir, date, type);
      if (fs.existsSync(target) && read(target) === null) throw new Error('invalid file');
      const minutes = compileMinutes({ date, type, briefs, minutesDir: c.minutesDir, cfg, now: ms });
      const picked = pickForKb(minutes, cfg, { resolveSource: deps.resolveOwnerSource });
      const done = processed(c);
      const pending = new Set(pendingDrafts(c).map(d => d.id));
      const cards = [];
      const submitted = [];
      for (const draft of picked.drafts) {
        if (done.has(draft.id) || pending.has(draft.id)) continue;
        const granted = c.kb.grantsFile && read(c.kb.grantsFile) !== null &&
          readGrants(kb).some(g => g.key === grantKey(draft));
        if (granted && !ownerQuoteCount(draft) && c.kb.kbAgentPath && path.isAbsolute(c.kb.kbAgentPath)) {
          saveDraft(c, draft);
          const result = await apply(draft.id, 'approve');
          submitted.push({ id: draft.id, state: result.state });
          continue;
        }
        if (!c.kb.pendingDir) continue;
        saveDraft(c, draft);
        cards.push({ draftId: draft.id, summary: draft.summary, project: draft.project, kind: draft.kind });
        const askKey = `${c.kb.pendingDir}|${draft.id}`;
        if (deps.cards?.ask && !asked.has(askKey)) {
          asked.add(askKey);
          const job = Promise.resolve().then(() => deps.cards.ask(card(draft))).then(result => {
            if (['approve', 'approve-always', 'reject'].includes(result?.decision)) {
              const device = result.device;
              if (result.decision === 'reject' || validDevice(device)) {
                return apply(draft.id, result.decision, device ?? 'owner');
              }
            }
          }).catch(() => logEvent(deps, c, { id: draft.id, state: 'card-error',
            ts: new Date(clock(deps)).toISOString() }));
          jobs.add(job);
          job.finally(() => jobs.delete(job));
        }
      }
      const result = { type, date, file: minutes.file, appended: minutes.appended, absent: minutes.absent,
        drafts: picked.drafts.length, blocked: picked.blocked, cards, submitted,
        learned: Object.fromEntries(attendees.map(a => [a.id, !!learned[a.id]])) };
      atomic(path.join(c.minutesDir, 'latest.json'), { date, type, file: minutes.file,
        at: new Date(ms).toISOString(), counts: { drafts: result.drafts, cards: cards.length } });
      if (type === 'evening' && additions.length) atomic(seenFile, [...new Set([...seen, ...additions])]);
      try {
        await deps.notify?.({ type: 'meeting', meetingType: type, date, file: minutes.file });
      } catch {
      }
      return result;
    } finally {
      running.delete(key);
    }
  }
  return { run, apply, idle: async () => {
    while (jobs.size) await Promise.allSettled([...jobs]);
  } };
}

async function body(req) {
  const length = req.headers?.['content-length'];
  if (length && /^\d+$/.test(length) && BigInt(length) > 65536n) throw Object.assign(new Error(), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > 65536) throw Object.assign(new Error(), { status: 413 });
    chunks.push(data);
  }
  try {
    const value = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error(), { status: 400 });
  }
}

// 创建只处理会议路径的 HTTP 处理器。
export function createHandler(deps = {}) {
  const service = createMeetingService(deps);
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/meetings' && !url.pathname.startsWith('/meetings/')) return false;
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    try {
      const c = config(deps);
      const route = url.pathname.slice('/meetings'.length);
      const match = route.match(/^\/cards\/([^/]+)\/(approve|reject)$/);
      const methods = { '/run': 'POST', '/status': 'GET', '/today': 'GET', '/minutes': 'GET', '/cards': 'GET' };
      const method = match ? 'POST' : methods[route];
      if (!method) {
        send(404, { error: 'Not found' });
        return true;
      }
      if (req.method !== method) {
        send(405, { error: 'Method not allowed' });
        return true;
      }
      if (route === '/run') {
        const input = await body(req);
        send(200, await service.run(input));
      } else if (route === '/status') {
        const now = clock(deps);
        const date = localDate(now, offsetFor(c, now));
        const today = readTodayMinutes(deps, { date }).minutes;
        send(200, { times: c.times ?? {}, today: { morning: today.some(x => x.type === 'morning'),
          evening: today.some(x => x.type === 'evening') },
        running: [...running].filter(x => x.startsWith(`${c.minutesDir}|`)), pendingCount: pendingDrafts(c).length });
      } else if (route === '/today') {
        send(200, readTodayMinutes(deps));
      } else if (route === '/minutes') {
        const date = url.searchParams.get('date');
        const type = url.searchParams.get('type');
        if (!validDate(date) || !['morning', 'evening'].includes(type)) {
          send(400, { error: 'Invalid request' });
        } else {
          const item = readTodayMinutes(deps, { date }).minutes.find(x => x.type === type);
          if (item) send(200, { date, ...item });
          else send(404, { error: 'Not found' });
        }
      } else if (route === '/cards') {
        send(200, { cards: pendingDrafts(c).map(d => ({ draftId: d.id, summary: d.summary,
          project: d.project, kind: d.kind })) });
      } else {
        let id;
        try {
          id = decodeURIComponent(match[1]);
        } catch {
          id = '';
        }
        if (!idPattern.test(id) || id.includes('..')) {
          send(400, { error: 'Invalid request' });
        } else {
          const device = req.headers?.['x-hub-device'];
          if (match[2] === 'approve' && !validDevice(device)) {
            send(403, { error: 'Device required' });
            return true;
          }
          const input = await body(req);
          const decision = match[2] === 'reject' ? 'reject' : input.always ? 'approve-always' : 'approve';
          const result = await service.apply(id, decision, validDevice(device) ? device : 'owner');
          if (result.state === 'not-found') send(404, { error: 'Not found' });
          else send(200, result);
        }
      }
    } catch (e) {
      const status = e.code === 'RUNNING' ? 409 : e.code === 'INVALID' ? 400 : e.status ?? 500;
      const messages = { 400: 'Invalid request', 409: 'Already running', 413: 'Body too large', 500: 'Internal error',
        503: '已一键全停，恢复后再运行' };
      send(status, { error: messages[status] ?? 'Internal error' });
    }
    return true;
  };
}

// 按配置的时间窗口执行一次定时检查。
export async function __tick(deps = {}) {
  const c = config(deps);
  const now = clock(deps);
  const offset = offsetFor(c, now);
  const date = localDate(now, offset);
  const local = new Date(now + offset * 60000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const service = createMeetingService(deps);
  const opened = [];
  // 全停期间到点也不开会，也不记失败重试。
  if (depsStopped(deps, { whenUnknown: false })) return opened;
  for (const type of ['morning', 'evening']) {
    const match = (c.times?.[type] ?? '').match(/^(\d{2}):(\d{2})$/);
    if (!match || +match[1] > 23 || +match[2] > 59 || !c.minutesDir) continue;
    const target = +match[1] * 60 + +match[2];
    const key = `${c.minutesDir}|${date}|${type}`;
    if (minute < target || minute > target + (c.catchUpMinutes ?? 120) || running.has(key)) continue;
    let exists = false;
    try {
      const file = minutesFile(c.minutesDir, date, type);
      const stat = fs.lstatSync(file);
      exists = safeDir(path.dirname(file)) && stat.isFile() && !stat.isSymbolicLink();
    } catch {
    }
    if (exists || now - (attempts.get(key) ?? -Infinity) < 600000) {
      continue;
    }
    try {
      const result = await service.run({ type, date });
      if (result.file) opened.push(type);
      else throw new Error('no directory');
    } catch {
      attempts.set(key, now);
      try {
        deps.log?.('meeting attempt failed');
      } catch {
      }
    }
  }
  return opened;
}

// 启动进程内定时检查。
export function start(deps = {}) {
  stop();
  const service = createMeetingService(deps);
  const interval = config(deps).tickMs ?? 60000;
  timer = setInterval(() => { void __tick(deps); }, interval);
  timer.unref();
  return service;
}

// 停止进程内定时检查。
export function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
