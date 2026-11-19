#!/usr/bin/env node
// 条件触发：读规则，判断一次，最多建单，然后退出。不执行工单里的动作。
import { createHash } from 'node:crypto';
import { chmod, lstat, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readHubYaml } from './ext/index.mjs';
import { stoppedAt } from './panic-marker.mjs';
import { ID_PATTERN, TICKET_STATES } from './ticket.mjs';

const usage = [
  'Usage: board-triggers --rules <规则.json> [--state <状态.json>] [--json]',
  '种类：unclaimed、blocked、needs-owner、daily、new-file。跑一次就退出，只建单。',
].join('\n');
const NAME = /^[A-Za-z0-9_.-]{1,64}$/u;
const KEY = /^[A-Za-z0-9_.:-]{1,64}$/u;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const SUFFIX = /^\.[A-Za-z0-9]{1,16}$/u;
const BLOCKED = new Set(['blocked', 'waiting-human']);

class UsageError extends Error {}

function only(value, allowed) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key));
}

function durationMs(when) {
  const hasNumber = Object.hasOwn(when, 'olderThanMs');
  const hasText = Object.hasOwn(when, 'olderThan');
  if (hasNumber === hasText) return null;
  if (hasNumber) {
    return Number.isSafeInteger(when.olderThanMs) && when.olderThanMs >= 1 ? when.olderThanMs : null;
  }
  const match = /^(\d{1,4})(m|h|d)$/u.exec(when.olderThan ?? '');
  if (!match) return null;
  const unit = match[2] === 'm' ? 60000 : match[2] === 'h' ? 3600000 : 86400000;
  const total = Number(match[1]) * unit;
  return Number.isSafeInteger(total) && total >= 1 ? total : null;
}

function normalizeWhen(when) {
  if (!when || typeof when !== 'object' || Array.isArray(when)) return null;
  if (when.kind === 'unclaimed' && only(when, ['kind', 'olderThanMs', 'olderThan', 'state', 'project', 'assignee'])) {
    const olderThanMs = durationMs(when);
    const state = when.state ?? 'queued';
    if (!olderThanMs || !TICKET_STATES.includes(state)) return null;
    if (when.project !== undefined && typeof when.project !== 'string') return null;
    if (when.assignee !== undefined && !NAME.test(when.assignee)) return null;
    return {
      kind: 'unclaimed', olderThanMs, state,
      ...(when.project ? { project: when.project } : {}),
      ...(when.assignee ? { assignee: when.assignee } : {}),
    };
  }
  if (when.kind === 'blocked' && only(when, ['kind', 'id', 'project'])) {
    if (when.id !== undefined && (typeof when.id !== 'string' || !ID_PATTERN.test(when.id))) return null;
    if (when.project !== undefined && typeof when.project !== 'string') return null;
    return {
      kind: 'blocked',
      ...(when.id ? { id: when.id } : {}),
      ...(when.project ? { project: when.project } : {}),
    };
  }
  if (when.kind === 'daily' && only(when, ['kind', 'at', 'tz', 'catchUp'])) {
    if (typeof when.at !== 'string' || !CLOCK.test(when.at)) return null;
    if (when.tz !== undefined && when.tz !== 'UTC' && when.tz !== 'instance') return null;
    if (when.catchUp !== undefined && typeof when.catchUp !== 'boolean') return null;
    return {
      kind: 'daily', at: when.at,
      ...(when.tz ? { tz: when.tz } : {}),
      ...(when.catchUp !== undefined ? { catchUp: when.catchUp } : {}),
    };
  }
  if (when.kind === 'needs-owner' && only(when, ['kind', 'id', 'project'])) {
    if (when.id !== undefined && (typeof when.id !== 'string' || !ID_PATTERN.test(when.id))) return null;
    if (when.project !== undefined && typeof when.project !== 'string') return null;
    return {
      kind: 'needs-owner',
      ...(when.id ? { id: when.id } : {}),
      ...(when.project ? { project: when.project } : {}),
    };
  }
  if (when.kind === 'new-file' && only(when, ['kind', 'dir', 'suffix'])) {
    if (typeof when.dir !== 'string' || !when.dir || when.dir.length > 500 || when.dir.includes('\0')) return null;
    if (when.suffix !== undefined && (typeof when.suffix !== 'string' || !SUFFIX.test(when.suffix))) return null;
    return { kind: 'new-file', dir: when.dir, ...(when.suffix ? { suffix: when.suffix } : {}) };
  }
  return null;
}

function normalizeTicket(ticket, banned) {
  if (!only(ticket, ['title', 'goal', 'to', 'key', 'project'])) return null;
  if (typeof ticket.title !== 'string' || !ticket.title.trim() || ticket.title.length > 200) return null;
  if (typeof ticket.goal !== 'string' || !ticket.goal.trim() || ticket.goal.length > 4000) return null;
  if (typeof ticket.key !== 'string' || !KEY.test(ticket.key)) return null;
  if (ticket.project !== undefined && (typeof ticket.project !== 'string' || ticket.project.length > 200)) return null;
  if (!Array.isArray(ticket.to) || !ticket.to.length || ticket.to.length > 8) return null;
  if (!ticket.to.every(name => NAME.test(name) && !banned.has(name))) return null;
  return {
    title: ticket.title, goal: ticket.goal, to: [...ticket.to], key: ticket.key, project: ticket.project ?? '',
  };
}

// 校验并收成内部规则。不合法就抛用法错误，调用方不会发请求。
export function normalizeRules(input) {
  if (!only(input, ['version', 'rules', 'reserved']) || input.version !== 1 || !Array.isArray(input.rules)) {
    throw new UsageError();
  }
  if (!input.rules.length || input.rules.length > 32) throw new UsageError();
  const banned = new Set(['owner']);
  if (input.reserved !== undefined) {
    if (!Array.isArray(input.reserved) || input.reserved.some(name => typeof name !== 'string' || !NAME.test(name))) {
      throw new UsageError();
    }
    for (const name of input.reserved) banned.add(name);
  }
  const rules = [];
  const seen = new Set();
  for (const rule of input.rules) {
    if (!only(rule, ['id', 'when', 'ticket'])) throw new UsageError();
    if (typeof rule.id !== 'string' || !KEY.test(rule.id) || seen.has(rule.id)) throw new UsageError();
    const when = normalizeWhen(rule.when);
    const ticket = normalizeTicket(rule.ticket, banned);
    if (!when || !ticket) throw new UsageError();
    seen.add(rule.id);
    rules.push({ id: rule.id, when, ticket });
  }
  return rules;
}

function listed(ticket, name) {
  return Array.isArray(ticket?.to) && ticket.to.includes(name);
}

// 规则自己建出的单不再当作下一次的来源，避免一条规则连环生单。
function selfMade(ticket, ctx) {
  const self = ctx?.self;
  return typeof self === 'string' && self.length > 0 && ticket?.from?.name === self;
}

// 没写 tz 或写 UTC：仍按 UTC，旧配置保持原义。instance 才用实例时区。
// 补跑只在 instance 时默认打开（当天一次）；UTC 必须显式 catchUp 才补，避免旧的「过了这一分钟就不响」。
function instanceOffset(ctx, now) {
  if (Number.isInteger(ctx?.utcOffsetMinutes)) return ctx.utcOffsetMinutes;
  const name = ctx?.timeZone;
  if (typeof name !== 'string' || !name) return null;
  if (name === 'UTC') return 0;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: name, timeZoneName: 'longOffset' });
    const zone = fmt.formatToParts(new Date(now)).find(part => part.type === 'timeZoneName')?.value;
    if (zone === 'GMT') return 0;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(zone ?? '');
    if (!match) return null;
    return (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]));
  } catch {
    return null;
  }
}

function dailyClock(rule, ctx) {
  const zone = rule.when.tz ?? 'UTC';
  const catchUp = zone === 'instance' ? rule.when.catchUp !== false : rule.when.catchUp === true;
  if (zone === 'UTC') {
    const date = new Date(ctx.now);
    if (Number.isNaN(date.getTime())) return null;
    return {
      hour: date.getUTCHours(), minute: date.getUTCMinutes(),
      day: date.toISOString().slice(0, 10), catchUp,
    };
  }
  const offset = instanceOffset(ctx, ctx.now);
  if (!Number.isInteger(offset)) return null;
  const shifted = new Date(ctx.now + offset * 60000);
  if (Number.isNaN(shifted.getTime())) return null;
  return {
    hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(),
    day: shifted.toISOString().slice(0, 10), catchUp,
  };
}

function ownerGoal(rule, ticket) {
  const ask = String(ticket.open_ask?.text ?? '').trim().replace(/\s+/gu, ' ').slice(0, 240);
  const goal = `${rule.ticket.goal}\n待回答：${ticket.id} ${ask}`;
  return goal.length > 4000 ? goal.slice(0, 4000) : goal;
}

// 纯判断：给一条规则和这一次看到的事实，决定建不建、用什么幂等键。
export function decide(rule, ctx) {
  if (rule.when.kind === 'unclaimed') {
    const hits = (ctx.tickets ?? []).filter(ticket => {
      if (selfMade(ticket, ctx)) return false;
      if (ticket?.state !== rule.when.state || ticket.claimedBy) return false;
      if (rule.when.project && ticket.project !== rule.when.project) return false;
      if (rule.when.assignee && !listed(ticket, rule.when.assignee)) return false;
      const created = Date.parse(ticket?.createdAt ?? '');
      return Number.isFinite(created) && ctx.now - created >= rule.when.olderThanMs;
    });
    if (!hits.length) return { fire: false, reason: '没有超时未领的单' };
    return { fire: true, reason: '有单超过时限未领', key: rule.ticket.key, goal: rule.ticket.goal };
  }
  if (rule.when.kind === 'blocked') {
    const hits = (ctx.tickets ?? []).filter(ticket => {
      if (selfMade(ticket, ctx)) return false;
      if (!BLOCKED.has(ticket?.state)) return false;
      if (rule.when.id && ticket.id !== rule.when.id) return false;
      if (rule.when.project && ticket.project !== rule.when.project) return false;
      return true;
    });
    if (!hits.length) return { fire: false, reason: '没有被阻断的单' };
    return { fire: true, reason: '有单被标阻断', key: rule.ticket.key, goal: rule.ticket.goal };
  }
  if (rule.when.kind === 'daily') {
    const date = new Date(ctx.now);
    if (Number.isNaN(date.getTime())) return { fire: false, reason: '时间无效' };
    const clock = dailyClock(rule, ctx);
    if (!clock) return { fire: false, reason: '没有实例时区' };
    const [hour, minute] = rule.when.at.split(':').map(Number);
    const target = hour * 60 + minute;
    const nowMin = clock.hour * 60 + clock.minute;
    if (nowMin < target || (!clock.catchUp && nowMin !== target)) {
      return { fire: false, reason: '未到点' };
    }
    const late = clock.catchUp && nowMin !== target;
    return {
      fire: true,
      reason: late ? '错过整点，当天补一次' : '到点',
      key: `${rule.ticket.key}.${clock.day}`,
      goal: rule.ticket.goal,
    };
  }
  if (rule.when.kind === 'needs-owner') {
    const hits = (ctx.tickets ?? []).filter(ticket => {
      if (selfMade(ticket, ctx)) return false;
      if (ticket?.state !== 'waiting-human') return false;
      if (typeof ticket.id !== 'string' || !ID_PATTERN.test(ticket.id)) return false;
      const ask = ticket.open_ask;
      if (!ask || typeof ask.text !== 'string' || !ask.text.trim()) return false;
      if (rule.when.id && ticket.id !== rule.when.id) return false;
      if (rule.when.project && ticket.project !== rule.when.project) return false;
      return true;
    }).sort((left, right) => left.id.localeCompare(right.id));
    if (!hits.length) return { fire: false, reason: '没有缺主人信息的单' };
    return {
      fire: true,
      reason: '有单缺主人信息，待回答',
      items: hits.map(ticket => ({ key: `${rule.ticket.key}.${ticket.id}`, goal: ownerGoal(rule, ticket) })),
    };
  }
  if (ctx.available === false) return { fire: false, reason: '目录不可用' };
  if (!Array.isArray(ctx.seen)) return { fire: false, reason: '建立基线', baseline: true };
  const fresh = (ctx.current ?? []).filter(name => !ctx.seen.includes(name)).sort();
  if (!fresh.length) return { fire: false, reason: '没有新文件' };
  const mark = createHash('sha256').update(fresh.join('\n')).digest('hex').slice(0, 16);
  const shown = fresh.slice(0, 20).join('，');
  const more = fresh.length > 20 ? ` 等 ${fresh.length} 个` : '';
  return {
    fire: true,
    reason: '出现新文件',
    key: `${rule.ticket.key}.${mark}`,
    goal: `${rule.ticket.goal}\n新文件：${shown}${more}`,
  };
}

function takeFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      if (flags.json) return null;
      flags.json = true;
      continue;
    }
    if (arg !== '--rules' && arg !== '--state') return null;
    const key = arg.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith('--') || flags[key]) return null;
    flags[key] = value;
    index += 1;
  }
  return flags.rules ? flags : null;
}

// 只认显式给出的停机目录。算不出目录时不当成全停，避免没配路径就拒绝建单。
function panicDirs(env) {
  const dirs = [];
  if (typeof env?.HUB_PANIC_DIR === 'string' && env.HUB_PANIC_DIR) dirs.push(env.HUB_PANIC_DIR);
  if (typeof env?.HUB_DATA_DIR === 'string' && env.HUB_DATA_DIR) {
    dirs.push(join(env.HUB_DATA_DIR, 'panic'));
  }
  return dirs;
}

function halted(env, io) {
  try {
    if (typeof io?.stopped === 'function') return io.stopped() === true;
    if (io?.stopped === true) return true;
  } catch {
    return true;
  }
  const dirs = panicDirs(env);
  if (!dirs.length) return false;
  try {
    return dirs.some(dir => stoppedAt(dir));
  } catch {
    return true;
  }
}

function readInstanceZone(env) {
  const direct = typeof env?.HUB_TIMEZONE === 'string' ? env.HUB_TIMEZONE.trim() : '';
  if (direct) return direct;
  const dirs = [];
  if (typeof env?.HUB_CONFIG_DIR === 'string' && env.HUB_CONFIG_DIR) dirs.push(env.HUB_CONFIG_DIR);
  if (typeof env?.HUB_HOME === 'string' && env.HUB_HOME) dirs.push(join(env.HUB_HOME, 'config'));
  for (const dir of dirs) {
    try {
      const hub = readHubYaml(dir);
      if (typeof hub?.timezone === 'string' && hub.timezone.trim()) return hub.timezone.trim();
    } catch {
      // 安装配置读不出就不把它当成实例时区。
    }
  }
  return '';
}

function instanceClock(env, io) {
  if (Number.isInteger(io?.utcOffsetMinutes)) return { utcOffsetMinutes: io.utcOffsetMinutes };
  if (typeof io?.timeZone === 'string' && io.timeZone.trim()) return { timeZone: io.timeZone.trim() };
  const name = readInstanceZone(env);
  return name ? { timeZone: name } : {};
}

async function loadAuth(env) {
  let url = env.HUB_BOARD_URL;
  let token = env.HUB_BOARD_TOKEN;
  if (env.HUB_BOARD_CONFIG) {
    try {
      const info = await stat(env.HUB_BOARD_CONFIG);
      if (!info.isFile() || (info.mode & 0o7777) !== 0o600) throw new Error('mode');
      const config = JSON.parse(await readFile(env.HUB_BOARD_CONFIG, 'utf8'));
      if (url == null) url = config?.url;
      if (token == null) token = config?.token;
    } catch {
      throw new UsageError();
    }
  }
  if (typeof url !== 'string' || !url || typeof token !== 'string' || !token) throw new UsageError();
  let base;
  try {
    base = new URL(url);
  } catch {
    throw new UsageError();
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new UsageError();
  }
  return { base, token };
}

async function request(auth, fetcher, method, path, body) {
  const headers = { Authorization: `Bearer ${auth.token}` };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const endpoint = auth.base.toString().replace(/\/$/u, '') + path;
  const response = await fetcher(endpoint, init);
  if (!response || response.ok !== true) {
    const error = new Error('http');
    error.http = true;
    error.status = response?.status ?? 0;
    throw error;
  }
  return { status: response.status, payload: await response.json() };
}

async function readNames(dir, suffix) {
  let info;
  try {
    info = await lstat(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false };
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return { ok: false };
  const names = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    if (suffix && !entry.name.endsWith(suffix)) continue;
    names.push(entry.name);
  }
  names.sort();
  return { ok: true, names };
}

async function readState(file) {
  try {
    const info = await stat(file);
    if (!info.isFile() || (info.mode & 0o7777) !== 0o600) throw new UsageError();
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data?.version !== 1 || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) {
      throw new UsageError();
    }
    for (const value of Object.values(data.files)) {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new UsageError();
    }
    return data.files;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (error?.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) throw new UsageError();
    throw error;
  }
}

async function writeState(file, files) {
  await writeFile(file, `${JSON.stringify({ version: 1, files })}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}

function redact(text, token) {
  return String(text).split(token).join('[redacted]');
}

function printResults(out, token, asJson, results) {
  if (asJson) {
    out.write(`${redact(JSON.stringify({ ok: true, results }, null, 2), token)}\n`);
    return;
  }
  for (const item of results) {
    const line = item.fired
      ? `${item.id}：${item.deduped ? '已有单' : '建单'} ${item.ticket}\n`
      : `${item.id}：未触发（${item.reason}）\n`;
    out.write(redact(line, token));
  }
}

// 跑一次规则。令牌只来自环境变量或权限 0600 的配置文件。
export async function main(argv = process.argv.slice(2), env = process.env, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  const fetcher = io.fetch ?? globalThis.fetch;
  try {
    if (argv.some(arg => /^--[^=]*token/iu.test(arg))) throw new UsageError();
    const flags = takeFlags(argv);
    if (!flags) throw new UsageError();
    const info = await stat(flags.rules);
    if (!info.isFile() || info.size > 65536) throw new UsageError();
    let raw;
    try {
      raw = JSON.parse(await readFile(flags.rules, 'utf8'));
    } catch {
      throw new UsageError();
    }
    const rules = normalizeRules(raw);
    if (halted(env, io)) {
      const token = typeof env?.HUB_BOARD_TOKEN === 'string' ? env.HUB_BOARD_TOKEN : '';
      const results = rules.map(rule => ({ id: rule.id, fired: false, reason: '已一键全停' }));
      printResults(out, token, flags.json, results);
      return 0;
    }
    const auth = await loadAuth(env);
    const who = await request(auth, fetcher, 'GET', '/whoami');
    if (typeof who.payload?.name !== 'string' || !who.payload.name) {
      err.write('Operation failed\n');
      return 1;
    }
    const nowFn = typeof io.now === 'function' ? io.now : () => Date.now();
    const now = nowFn();
    const clock = instanceClock(env, io);
    const needsList = rules.some(rule =>
      rule.when.kind === 'unclaimed' || rule.when.kind === 'blocked' || rule.when.kind === 'needs-owner');
    let tickets = [];
    if (needsList) {
      const listed = await request(auth, fetcher, 'GET', '/tickets');
      if (!Array.isArray(listed.payload?.tickets)) {
        err.write('Operation failed\n');
        return 1;
      }
      tickets = listed.payload.tickets;
    }
    const needsFiles = rules.some(rule => rule.when.kind === 'new-file');
    const statePath = flags.state ?? `${flags.rules}.seen.json`;
    const seenMap = needsFiles ? await readState(statePath) : {};
    const updates = {};
    const results = [];
    for (const rule of rules) {
      const ctx = { now, tickets, self: who.payload.name, ...clock };
      if (rule.when.kind === 'new-file') {
        const dir = await readNames(rule.when.dir, rule.when.suffix);
        if (!dir.ok) {
          results.push({ id: rule.id, fired: false, reason: '目录不可用' });
          continue;
        }
        ctx.available = true;
        ctx.current = dir.names;
        ctx.seen = Object.hasOwn(seenMap, rule.when.dir) ? seenMap[rule.when.dir] : null;
        updates[rule.when.dir] = dir.names;
      }
      const decision = decide(rule, ctx);
      if (!decision.fire) {
        results.push({ id: rule.id, fired: false, reason: decision.reason });
        continue;
      }
      const items = Array.isArray(decision.items) && decision.items.length
        ? decision.items
        : [{ key: decision.key, goal: decision.goal }];
      for (const item of items) {
        const created = await request(auth, fetcher, 'POST', '/tickets', {
          title: rule.ticket.title,
          goal: item.goal,
          to: rule.ticket.to,
          key: item.key,
          project: rule.ticket.project,
        });
        results.push({
          id: rule.id,
          fired: true,
          reason: decision.reason,
          ticket: created.payload?.ticket?.id ?? '',
          deduped: created.status === 200,
        });
      }
    }
    if (Object.keys(updates).length) await writeState(statePath, { ...seenMap, ...updates });
    printResults(out, auth.token, flags.json, results);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      err.write(`${usage}\n`);
      return 2;
    }
    if (error?.http) {
      err.write(`Request failed (HTTP ${error.status})\n`);
      if (error.status === 401 || error.status === 403) return 3;
      if (error.status === 409) return 4;
      return 1;
    }
    err.write('Operation failed\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
