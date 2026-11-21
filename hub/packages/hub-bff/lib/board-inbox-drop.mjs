// 投文件口：监视镜像 inbox/<身份名>/，走和命令行相同的外部身份校验与同一批 board 函数。
// 正文只当资料。默认关闭；board.externals.<名>.inbox === true 才处理。
import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { BoardError } from './board-errors.mjs';
import {
  EXTERNAL_HINT_CANT_TAKE, EXTERNAL_HINT_NOT_YOURS, externalActor, externalInvolved,
} from './board-external.mjs';
import { ID_PATTERN } from './ticket.mjs';

const LIMIT = 64 * 1024;
const PER_MINUTE = 20;
const NAME = /^[A-Za-z0-9_.-]{1,64}$/u;
const CLOSED = '该身份没开投文件口';

export function inboxFileIssue(name) {
  if (typeof name !== 'string' || !name || name !== basename(name) || name.includes('/') ||
    name.includes('\\') || name.includes('../') || name.includes('..\\') || name === '.' || name === '..') {
    return '文件名不合法（要是普通的 .md，不能带 ../）。';
  }
  if (!name.endsWith('.md') || name === '.md') return '只接受普通的 .md 文件。';
  return '';
}

export function inboxEnabled(externals, name) {
  const raw = typeof externals === 'function' ? externals() : externals;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const item = raw[name];
  return !!item && typeof item === 'object' && !Array.isArray(item) && item.inbox === true;
}

function parseDrop(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(text);
  if (!match) return { error: '文件开头要有 YAML 头（两行 --- 包住），并写上 action 和 card。' };
  const meta = {};
  const evidence = [];
  for (const line of match[1].split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const row = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line);
    if (!row) return { error: 'YAML 头有一行读不懂。请写成 action: take 这种样子，不要嵌套。' };
    let value = row[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (row[1] === 'evidence') evidence.push(value);
    else if (Object.hasOwn(meta, row[1])) return { error: 'YAML 头里同一个字段写了两次。' };
    else meta[row[1]] = value;
  }
  if (!meta.action || !meta.card) return { error: 'YAML 头缺 action 或 card。' };
  if (!['take', 'note', 'deliver', 'stuck'].includes(meta.action)) {
    return { error: 'action 只能是 take、note、deliver、stuck。' };
  }
  if (!ID_PATTERN.test(meta.card)) return { error: 'card 不是看板单号。' };
  return { meta: { ...meta, evidence }, body: match[2] };
}

function clip(text, maxBytes) {
  let out = '';
  let size = 0;
  for (const char of text) {
    const bytes = Buffer.byteLength(char);
    if (size + bytes > maxBytes) return out + '…（全文见产物）';
    out += char;
    size += bytes;
  }
  return out;
}

async function sha256Of(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) return null;
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch {
    return null;
  }
}

function human(error, action) {
  if (typeof error?.hint === 'string' && error.hint.trim()) return error.hint.trim();
  if (error instanceof BoardError && error.code === 'FORBIDDEN') {
    return action === 'take' ? EXTERNAL_HINT_CANT_TAKE : EXTERNAL_HINT_NOT_YOURS;
  }
  if (error instanceof BoardError && error.code === 'NOT_FOUND') return '没有这张卡。';
  if (error instanceof BoardError && error.code === 'CONFLICT') {
    return '这张卡的状态对不上（可能已被别人领走，或不是你在做）。';
  }
  if (error instanceof BoardError && error.code === 'INVALID') return '内容不符合看板的要求，没有改卡。';
  return '没做成，看板没有改。';
}

// 监视 <镜像>/inbox/<身份>/。启动先扫一遍，fs.watch 加上低频轮询，免得漏掉。
export function createInboxDrop({
  board, dir, externals = {}, now = Date.now, logger = console, pollMs = 5000, enabled = () => true,
}) {
  const inboxRoot = join(dir, 'inbox');
  const rates = new Map();
  const busy = new Set();
  let watcher;
  let timer;
  let watchRetry;
  let started = false;
  let scanning = false;
  let again = false;
  let stopped = false;

  const allow = (name, at) => {
    const fresh = (rates.get(name) ?? []).filter(ts => at - ts < 60_000);
    if (fresh.length >= PER_MINUTE) {
      rates.set(name, fresh);
      return false;
    }
    fresh.push(at);
    rates.set(name, fresh);
    return true;
  };

  async function privateDir(path) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }

  async function uniqueDest(folder, name) {
    await privateDir(folder);
    let target = join(folder, name);
    let n = 2;
    while (await lstat(target).then(() => true, () => false)) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      target = join(folder, stem + '-' + n + ext);
      n += 1;
    }
    return target;
  }

  async function finish(src, identity, name, ok, reason) {
    const folder = join(inboxRoot, identity, ok ? 'done' : 'rejected');
    const target = await uniqueDest(folder, name);
    await rename(src, target);
    if (!ok) {
      const note = join(dirname(target), basename(target) + '.reason.txt');
      await writeFile(note, reason.trim() + '\n', { mode: 0o600, flag: 'wx' });
    }
  }

  async function markSymlinkDir(name) {
    if (!NAME.test(name)) return;
    const note = join(inboxRoot, name + '.reason.txt');
    if (await lstat(note).then(() => true, () => false)) return;
    await writeFile(note, '身份目录是符号链接，没有跟着读。\n', { mode: 0o600, flag: 'wx' });
  }

  async function takenReason(id, name, error) {
    if (!(error instanceof BoardError) || error.code !== 'CONFLICT') return human(error, 'take');
    const nowTicket = await board.get(id).catch(() => null);
    const taken = nowTicket?.openClaim?.state === 'taken' ? nowTicket.openClaim : null;
    if (taken && taken.takenBy !== name) {
      const who = String(taken.takenShown || taken.takenBy || '别人');
      return '这张卡已被「' + who + '」接走，你换一张。';
    }
    return human(error, 'take');
  }

  async function apply(identity, meta, body) {
    const actor = externalActor(identity, 'file');
    const id = meta.card;
    if (meta.action === 'take') {
      try {
        await board.claim(actor, id);
      } catch (error) {
        throw Object.assign(error, { hint: await takenReason(id, identity, error) });
      }
      return;
    }
    const ticket = await board.get(id);
    if (!externalInvolved(ticket, identity)) {
      const error = new BoardError('FORBIDDEN', 'Not permitted');
      error.hint = EXTERNAL_HINT_NOT_YOURS;
      throw error;
    }
    if (meta.action === 'note') {
      const text = body.trim();
      if (!text) throw Object.assign(new BoardError('INVALID', 'Invalid progress'), { hint: '进度文字是空的。' });
      await board.progress(actor, id, text);
      return;
    }
    if (meta.action === 'stuck') {
      const question = (meta.question || body).trim();
      if (!question) throw Object.assign(new BoardError('INVALID', 'Invalid reason'), { hint: '问题是空的。' });
      const waitHuman = meta.blocked !== 'true';
      await board.block(actor, id, question, { waitHuman });
      return;
    }
    const result = body.trim();
    const evidence = (meta.evidence ?? []).map(item => String(item).trim()).filter(Boolean);
    if (!result || !evidence.length) {
      throw Object.assign(new BoardError('INVALID', 'Invalid report'), {
        hint: '交回要写成果，并在 YAML 头给出 evidence 产物路径。',
      });
    }
    const lines = ['执行者自述', '成果：' + result];
    if (meta.handoff?.trim()) lines.push('交接说明（给下一棒）：' + meta.handoff.trim());
    if (meta.checked?.trim()) lines.push('怎么验的：' + meta.checked.trim());
    if (meta.unchecked?.trim()) lines.push('没验的：' + meta.unchecked.trim());
    for (const item of evidence) lines.push('产物在哪：' + item);
    const summary = clip(lines.join('\n'), 2000);
    const sha256 = await sha256Of(evidence[0]);
    await board.report(actor, id, { summary, file: evidence[0], sha256, artifacts: evidence });
    if (!ticket.relay) await board.done(actor, id);
  }

  async function handle(identity, name, src) {
    if (busy.has(src)) return;
    busy.add(src);
    try {
      if (stopped || !enabled()) return;
      const info = await lstat(src).catch(() => null);
      if (!info) return;
      let reason = '';
      if (info.isSymbolicLink()) reason = '这是符号链接，没有跟着读。';
      else if (!info.isFile()) reason = '只接受普通的 .md 文件。';
      else if (info.size > LIMIT) reason = '文件超过 64KB，没有处理。';
      else if (!allow(identity, now())) reason = '这个身份这一分钟里最多处理 20 份。';
      else if (!inboxEnabled(externals, identity)) reason = CLOSED;
      if (reason) {
        await finish(src, identity, name, false, reason);
        return;
      }
      const parsed = parseDrop(await readFile(src, 'utf8'));
      if (parsed.error) {
        await finish(src, identity, name, false, parsed.error);
        return;
      }
      try {
        await apply(identity, parsed.meta, parsed.body);
      } catch (error) {
        await finish(src, identity, name, false, error?.hint || human(error, parsed.meta.action));
        return;
      }
      await finish(src, identity, name, true);
    } catch (error) {
      logger.warn?.('BOARD_INBOX_DROP');
      if (error?.code !== 'ENOENT') {
        try {
          await finish(src, identity, name, false, '没做成，看板没有改。');
        } catch { /* 文件可能已经挪走 */ }
      }
    } finally {
      busy.delete(src);
    }
  }

  async function scanIdentity(name) {
    const folder = join(inboxRoot, name);
    const info = await lstat(folder).catch(() => null);
    if (!info) return;
    if (info.isSymbolicLink()) {
      await markSymlinkDir(name);
      return;
    }
    if (!info.isDirectory()) return;
    const entries = await readdir(folder, { withFileTypes: true });
    const jobs = [];
    for (const entry of entries) {
      if (entry.name === 'done' || entry.name === 'rejected') continue;
      const issue = inboxFileIssue(entry.name);
      const src = join(folder, entry.name);
      if (issue) {
        if (entry.isSymbolicLink() || entry.isFile()) jobs.push(handleNamed(name, entry.name, src, issue));
        continue;
      }
      jobs.push(handle(name, entry.name, src));
    }
    await Promise.all(jobs);
  }

  async function handleNamed(identity, name, src, issue) {
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      await markUnsafe(identity, issue);
      if (!name.includes('/') && !name.includes('\\')) await handle(identity, name, src);
      return;
    }
    if (busy.has(src)) return;
    busy.add(src);
    try {
      const info = await lstat(src).catch(() => null);
      if (!info || info.isDirectory()) return;
      await finish(src, identity, name, false, issue);
    } catch {
      logger.warn?.('BOARD_INBOX_DROP');
    } finally {
      busy.delete(src);
    }
  }

  async function markUnsafe(identity, issue) {
    if (!NAME.test(identity)) return;
    const note = join(inboxRoot, identity, 'rejected');
    await privateDir(note);
    const path = join(note, 'unsafe-name.reason.txt');
    if (await lstat(path).then(() => true, () => false)) return;
    await writeFile(path, issue.trim() + '\n', { mode: 0o600, flag: 'wx' });
  }

  async function scanOnce() {
    if (stopped || !enabled()) return;
    const root = await lstat(inboxRoot).catch(() => null);
    if (!root || root.isSymbolicLink() || !root.isDirectory()) return;
    ensureWatch();
    const entries = await readdir(inboxRoot, { withFileTypes: true });
    const jobs = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (!NAME.test(entry.name)) continue;
      jobs.push(scanIdentity(entry.name));
    }
    await Promise.all(jobs);
  }

  async function scan() {
    if (scanning) {
      again = true;
      return;
    }
    scanning = true;
    try {
      do {
        again = false;
        await scanOnce();
      } while (again && !stopped);
    } finally {
      scanning = false;
    }
  }

  function ensureWatch() {
    if (watcher || stopped || !started) return;
    try {
      watcher = watch(inboxRoot, { persistent: false, recursive: true }, () => { void scan(); });
      watcher.unref?.();
    } catch {
      watcher = undefined;
    }
  }

  function start() {
    if (started) return;
    started = true;
    stopped = false;
    ensureWatch();
    // 镜像目录可能比监视器晚出现。目录一出来就挂上 fs.watch，不必干等整轮轮询。
    if (!watcher) {
      watchRetry = setInterval(() => {
        ensureWatch();
        void scan();
        if (watcher || stopped) {
          clearInterval(watchRetry);
          watchRetry = undefined;
        }
      }, 200);
      watchRetry.unref?.();
    }
    const wait = Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 5000;
    timer = setInterval(() => { void scan(); }, wait);
    timer.unref?.();
    void scan();
  }

  async function stop() {
    stopped = true;
    started = false;
    clearInterval(timer);
    clearInterval(watchRetry);
    timer = undefined;
    watchRetry = undefined;
    watcher?.close();
    watcher = undefined;
    while (scanning || busy.size) await new Promise(resolve => setTimeout(resolve, 10));
  }

  return { start, stop, scan, inboxRoot };
}
