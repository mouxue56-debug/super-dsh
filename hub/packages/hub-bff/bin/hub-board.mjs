#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stoppedAt } from '../lib/panic-marker.mjs';
const usage = [
  'Usage: hub-board list [--state s] [--assignee a] [--creator c] [--inbox name]',
  '       [--attention] [--json]',
  '       | show|claim|resume|accept|timeout <id>',
  '       | progress|send-back|answer|uncertain <id> <text>',
  '       | report <id> --file <path> | report <id> --progress <text>',
  '       | block <id> <reason> [--wait-human]',
  '       | done <id> [--outcome s --checked s --unchecked s --artifact p]',
  '       | next [--json]',
  '       | watch [--assignee a] [--state s] [--tag t]',
  '         [--timeout ms] [--interval ms] [--json]',
].join('\n');
const bad = () => {
  throw new UsageError();
};
class UsageError extends Error {}
const STATES = Object.freeze([
  'queued', 'progress', 'completed', 'blocked', 'waiting-human',
  'failed', 'waiting-timeout', 'uncertain',
]);

function isProgressReport(command, args) {
  return command === 'report' && args.includes('--progress');
}

function isRichDone(command, args) {
  return command === 'done' && args.some(arg =>
    arg === '--outcome' || arg === '--checked' || arg === '--unchecked' || arg === '--artifact');
}

function takeFlags(args, allowed) {
  const flags = {};
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (!allowed.includes(key)) return null;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) return null;
    index += 1;
    if (key === 'artifact') {
      flags.artifact = [...(flags.artifact ?? []), value];
    } else if (Object.hasOwn(flags, key)) {
      return null;
    } else {
      flags[key] = value;
    }
  }
  return { flags, rest };
}

function intFlag(value, min, max) {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) return null;
  return number;
}

function redact(text, token) {
  return String(text).split(token).join('[redacted]');
}

function clipSummary(text) {
  let summary = '';
  let size = 0;
  for (const char of text) {
    const bytes = Buffer.byteLength(char);
    if (size + bytes > 2000) break;
    summary += char;
    size += bytes;
  }
  if (summary.length < text.length) summary += '…（全文见 file）';
  return summary;
}

function timerOf(io) {
  return {
    now: typeof io?.now === 'function' ? io.now : () => Date.now(),
    sleep: typeof io?.sleep === 'function' ? io.sleep : ms => new Promise(resolve => {
      setTimeout(resolve, ms);
    }),
  };
}

async function boardCall(fetcher, base, token, method, path, body) {
  const headers = { Authorization: `Bearer ${token}` };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return fetcher(base.toString().replace(/\/$/u, '') + path, init);
}

function httpExit(err, status) {
  err.write(`Request failed (HTTP ${status})\n`);
  if (status === 401 || status === 403) return 3;
  if (status === 409) return 4;
  return 1;
}

function emit(out, token, asJson, payload, human) {
  const text = asJson ? `${JSON.stringify(payload, null, 2)}\n` : human;
  out.write(redact(text, token));
}

function ticketLines(head, ticket) {
  const lines = [head];
  if (ticket?.id) lines.push(`工单 ${ticket.id}`);
  if (ticket?.title) lines.push(`标题：${ticket.title}`);
  if (ticket?.state) lines.push(`状态：${ticket.state}`);
  if (Array.isArray(ticket?.to) && ticket.to.length) lines.push(`派给：${ticket.to.join('、')}`);
  if (typeof ticket?.goal === 'string' && ticket.goal) lines.push(`目标：${ticket.goal}`);
  return `${lines.join('\n')}\n`;
}

function assignedTo(ticket, name) {
  return Array.isArray(ticket?.to) && ticket.to.includes(name);
}

function byAge(left, right) {
  const created = String(left?.createdAt ?? '').localeCompare(String(right?.createdAt ?? ''));
  if (created) return created;
  return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
}

function hasTag(ticket, tag) {
  if (!tag) return true;
  if (ticket?.project === tag) return true;
  return Array.isArray(ticket?.tags) && ticket.tags.includes(tag);
}

async function mustJson(ctx, method, path, body) {
  const response = await boardCall(ctx.fetcher, ctx.base, ctx.token, method, path, body);
  if (!response || response.ok !== true) {
    const error = new Error('http');
    error.http = true;
    error.status = response?.status ?? 0;
    throw error;
  }
  return response.json();
}

// 只认显式给出的停机目录。没配路径时不领单检查不会被当成全停。
function haltClaim(env, io) {
  try {
    if (typeof io?.stopped === 'function') return io.stopped() === true;
    if (io?.stopped === true) return true;
  } catch {
    return true;
  }
  const dirs = [];
  if (typeof env?.HUB_PANIC_DIR === 'string' && env.HUB_PANIC_DIR) dirs.push(env.HUB_PANIC_DIR);
  if (typeof env?.HUB_DATA_DIR === 'string' && env.HUB_DATA_DIR) {
    dirs.push(join(env.HUB_DATA_DIR, 'panic'));
  }
  if (!dirs.length) return false;
  try {
    return dirs.some(dir => stoppedAt(dir));
  } catch {
    return true;
  }
}

async function runNext(ctx) {
  const parsed = takeFlags(ctx.args, []);
  if (!parsed || parsed.rest.length) throw new UsageError();
  if (haltClaim(ctx.env, ctx.io)) {
    emit(ctx.out, ctx.token, parsed.flags.json, { ok: false, reason: 'stopped' }, '已一键全停，没有领取\n');
    return 6;
  }
  const me = await mustJson(ctx, 'GET', '/whoami');
  if (typeof me?.name !== 'string' || !me.name) {
    ctx.err.write('Operation failed\n');
    return 1;
  }
  const query = `assignee=${encodeURIComponent(me.name)}&state=queued`;
  const listed = await mustJson(ctx, 'GET', `/tickets?${query}`);
  const tickets = Array.isArray(listed?.tickets) ? listed.tickets : [];
  const mine = tickets.filter(ticket =>
    ticket?.state === 'queued' && !ticket.claimedBy && assignedTo(ticket, me.name)).sort(byAge);
  if (!mine.length) {
    emit(ctx.out, ctx.token, parsed.flags.json, { ok: false, reason: 'none' }, '没有可领的单\n');
    return 5;
  }
  const id = mine[0].id;
  if (typeof id !== 'string' || !id) {
    ctx.err.write('Operation failed\n');
    return 1;
  }
  const claimed = await mustJson(ctx, 'POST', `/tickets/${encodeURIComponent(id)}/claim`);
  const ticket = claimed?.ticket ?? mine[0];
  emit(ctx.out, ctx.token, parsed.flags.json, claimed, ticketLines(`已领取 ${ticket.id ?? id}`, ticket));
  return 0;
}

async function runWatch(ctx) {
  const parsed = takeFlags(ctx.args, ['assignee', 'state', 'status', 'tag', 'timeout', 'interval']);
  if (!parsed || parsed.rest.length) throw new UsageError();
  const flags = parsed.flags;
  if (flags.state && flags.status) throw new UsageError();
  const state = flags.state ?? flags.status;
  if (state && !STATES.includes(state)) throw new UsageError();
  const timeout = flags.timeout === undefined ? 60000 : intFlag(flags.timeout, 0, 86400000);
  const interval = flags.interval === undefined ? 2000 : intFlag(flags.interval, 200, 3600000);
  if (timeout === null || interval === null) throw new UsageError();
  const me = await mustJson(ctx, 'GET', '/whoami');
  if (typeof me?.name !== 'string' || !me.name) {
    ctx.err.write('Operation failed\n');
    return 1;
  }
  if (flags.assignee && flags.assignee !== me.name) {
    ctx.err.write('只能看派给自己的单\n');
    return 2;
  }
  const { now, sleep } = timerOf(ctx.io);
  const deadline = now() + timeout;
  const query = new URLSearchParams();
  query.set('assignee', me.name);
  if (state) query.set('state', state);
  const path = `/tickets?${query}`;
  const maxPolls = timeout === 0 ? 1 : Math.ceil(timeout / interval) + 2;
  for (let polls = 0; polls < maxPolls; polls += 1) {
    const listed = await mustJson(ctx, 'GET', path);
    const tickets = Array.isArray(listed?.tickets) ? listed.tickets : [];
    const hit = tickets.filter(ticket =>
      (assignedTo(ticket, me.name) || ticket?.claimedBy === me.name) &&
      (!state || ticket?.state === state) && hasTag(ticket, flags.tag)).sort(byAge)[0];
    if (hit) {
      emit(ctx.out, ctx.token, flags.json, { ok: true, ticket: hit }, ticketLines('出现符合条件的单', hit));
      return 0;
    }
    const remain = deadline - now();
    if (remain <= 0) break;
    await sleep(Math.min(interval, remain));
  }
  emit(ctx.out, ctx.token, flags.json, { ok: false, reason: 'timeout' }, '超时，没有符合条件的单\n');
  return 3;
}

async function runProgress(ctx) {
  const parsed = takeFlags(ctx.args, ['progress']);
  if (!parsed || parsed.rest.length !== 1 || parsed.rest[0].startsWith('-')) throw new UsageError();
  if (!parsed.flags.progress || !parsed.flags.progress.trim() || ctx.args.includes('--file')) throw new UsageError();
  const id = parsed.rest[0];
  const result = await mustJson(ctx, 'POST', `/tickets/${encodeURIComponent(id)}/progress`, {
    text: parsed.flags.progress,
  });
  emit(ctx.out, ctx.token, parsed.flags.json, result, `已报进度 ${id}\n${parsed.flags.progress}\n`);
  return 0;
}

async function runRichDone(ctx) {
  const parsed = takeFlags(ctx.args, ['outcome', 'checked', 'unchecked', 'artifact']);
  if (!parsed || parsed.rest.length !== 1 || parsed.rest[0].startsWith('-')) throw new UsageError();
  const { outcome, checked, unchecked, artifact, json } = parsed.flags;
  if (!outcome?.trim() || !checked?.trim() || !unchecked?.trim() || !artifact?.length) throw new UsageError();
  const id = parsed.rest[0];
  const where = artifact.map(item => `产物在哪：${item}`).join('\n');
  const full = `执行者自述\n成果：${outcome}\n怎么验的：${checked}\n没验的：${unchecked}\n${where}`;
  await mustJson(ctx, 'POST', `/tickets/${encodeURIComponent(id)}/report`, {
    summary: clipSummary(full),
    file: artifact[0],
    sha256: createHash('sha256').update(full).digest('hex'),
    artifacts: artifact,
  });
  const done = await mustJson(ctx, 'POST', `/tickets/${encodeURIComponent(id)}/done`);
  emit(ctx.out, ctx.token, json, done, ticketLines(`已交付 ${id}，待验收`, done?.ticket));
  return 0;
}

// 新动作走这里。已有的 list/show/claim/report --file/done/block 仍走原来的路径。
async function runAgent(ctx) {
  try {
    if (ctx.command === 'next') return await runNext(ctx);
    if (ctx.command === 'watch') return await runWatch(ctx);
    if (ctx.command === 'report') return await runProgress(ctx);
    return await runRichDone(ctx);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (error?.http) return httpExit(ctx.err, error.status);
    throw error;
  }
}
// 执行看板命令
export async function main(argv = process.argv.slice(2), env = process.env, io = {}) {
  const out = io.stdout ?? process.stdout,
    err = io.stderr ?? process.stderr,
    fetcher = io.fetch ?? globalThis.fetch;
  try {
    if (argv.some(_argument => /^--[^=]*token/i.test(_argument))) {
      bad();
    }
    let url = env.HUB_BOARD_URL,
      token = env.HUB_BOARD_TOKEN;
    if (env.HUB_BOARD_CONFIG) {
      let config;
      try {
        const info = await stat(env.HUB_BOARD_CONFIG);
        if (!info.isFile() || (info.mode & 0o7777) !== 0o600) {
          throw new Error();
        }
        config = JSON.parse(await readFile(env.HUB_BOARD_CONFIG, 'utf8'));
      } catch {
        throw new UsageError();
      }
      url ??= config?.url;
      token ??= config?.token;
    }
    if (typeof url !== 'string' || !url || typeof token !== 'string' || !token) {
      bad();
    }
    let base;
    try {
      base = new URL(url);
    } catch {
      bad();
    }
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      bad();
    }
    const [command, ...args] = argv;
    if (command === 'next' || command === 'watch' || isProgressReport(command, args) || isRichDone(command, args)) {
      return await runAgent({ command, args, base, token, fetcher, out, err, io, env });
    }
    let path = '/tickets',
      method = 'GET',
      body;
    if (command === 'list') {
      const query = new URLSearchParams();
      for (let _index = 0; _index < args.length; _index++) {
        if (args[_index] === '--json') {
          continue;
        }
        if (args[_index] === '--attention') {
          query.set('attention', '1');
          continue;
        }
        if (!['--state', '--status', '--assignee', '--creator', '--inbox'].includes(args[_index]) || !args[
          _index + 1] || args[_index + 1].startsWith('--')) {
          bad();
        }
        const key = args[_index] === '--status' ? 'state' : args[_index].slice(2);
        query.set(key, args[++_index]);
      }
      if (query.size) {
        path += `?${query}`;
      }
    } else {
      if (!['show', 'claim', 'resume', 'progress', 'report', 'block', 'done', 'accept', 'send-back', 'answer',
        'timeout', 'uncertain'].includes(command) || !args[0] || args[0].startsWith('-')) {
        bad();
      }
      path += `/${encodeURIComponent(args[0])}`;
      if (command !== 'show') {
        method = 'POST';
        path += `/${command === 'send-back' ? 'send_back' : command}`;
      }
      if (['show', 'claim', 'resume', 'done', 'accept', 'timeout'].includes(command) && args.length !== 1) {
        bad();
      }
      if (command === 'progress') {
        if (args.length !== 2 || !args[1]) {
          bad();
        }
        body = {
          text: args[1]
        };
      }
      if (['send-back', 'answer', 'uncertain'].includes(command)) {
        if (args.length !== 2 || !args[1]) {
          bad();
        }
        body = {
          [command === 'answer' ? 'text' : 'note']: args[1]
        };
      }
      if (command === 'report') {
        if (args.length !== 3 || args[1] !== '--file' || !args[2]) {
          bad();
        }
        const bytes = await readFile(args[2]);
        const text = bytes.toString('utf8');
        let summary = '',
          size = 0;
        for (const char of text) {
          const _byteLength = Buffer.byteLength(char);
          if (size + _byteLength > 2000) {
            break;
          }
          summary += char;
          size += _byteLength;
        }
        if (summary.length < text.length) {
          summary += '…（全文见 file）';
        }
        body = {
          summary,
          file: args[2],
          sha256: createHash('sha256').update(bytes).digest('hex')
        };
      }
      if (command === 'block') {
        if (![2, 3].includes(args.length) || !args[1] || args.length === 3 && !['--wait-human',
          '--needs-human'].includes(args[2])) {
          bad();
        }
        body = {
          reason: args[1],
          ...(args.length === 3 ? {
            waitHuman: true
          } : {})
        };
      }
    }
    const endpoint = base.toString().replace(/\/$/, '') + path;
    const response = await fetcher(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? {
          'Content-Type': 'application/json'
        } : {})
      },
      ...(body ? {
        body: JSON.stringify(body)
      } : {})
    });
    if (!response.ok) {
      err.write(`Request failed (HTTP ${response.status})\n`);
      return response.status === 401 || response.status === 403 ? 3 : response.status === 409 ? 4 : 1;
    }
    const result = await response.json();
    // Treat the server response as untrusted and never echo credentials.
    out.write(JSON.stringify(result, null, 2).split(token).join('[redacted]') + '\n');
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      err.write(usage + '\n');
      return 2;
    }
    err.write('Operation failed\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
