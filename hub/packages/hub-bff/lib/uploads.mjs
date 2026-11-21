// 会话收件。文件只放在该助理的工作目录里，返回相对路径。
// 助理用现成的 read 工具就能读（自己的目录是 L0）。这里不调用会话发送。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { expandConfiguredPath } from '../../hub-plugin/hub-config.mjs';
import { sessionId } from './dsh-client.mjs';

export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

// 与插件权限表禁用字样一致。路径里带上这些，read 会被拒绝。
const UNREADABLE = Object.freeze([
  '医院', '病历', '医疗', '密钥', '凭据', 'secrets', '.env', '聊天记录',
]);

export const DEFAULT_UPLOAD_TYPES = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
});

const MIME_ALIAS = Object.freeze({
  'image/jpg': 'image/jpeg',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/mp3': 'audio/mpeg',
  'audio/x-m4a': 'audio/mp4',
});

const MIME_RE = /^(image|audio|text|application)\/[a-z0-9.+-]{1,80}$/u;
const EXT_RE = /^[a-z0-9]{1,10}$/u;

export function fail(status, error, message) {
  const err = new Error(message);
  err.status = status;
  err.error = error;
  return err;
}

export function sendJson(res, status, value) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (status === 405) headers.allow = 'POST';
  res.writeHead(status, headers);
  res.end(JSON.stringify(value));
}

// 扩展处理失败时只回我们自己的字样，不把异常栈或本机路径写进响应。
export function sendFailure(res, error, fallback) {
  if (!res || res.headersSent) return;
  const known = typeof error?.error === 'string' && typeof error?.message === 'string';
  const status = Number.isInteger(error?.status) ? error.status : 500;
  sendJson(res, status, {
    ok: false,
    error: known ? error.error : 'internal',
    message: known ? error.message : fallback,
  });
}

// 只认本扩展自己的路径。去掉末尾斜杠后必须正好是前缀，多出来的段交给别的路由。
export function routePath(req) {
  if (!req || typeof req.url !== 'string' || !req.url) return null;
  try {
    return new URL(req.url, 'http://127.0.0.1').pathname.replace(/\/+$/u, '') || '/';
  } catch {
    return null;
  }
}

// 请求头声明的长度已经超过上限时，不再把正文读进来。
export function declaredTooLarge(req, max) {
  const raw = headerValue(req, 'content-length').trim();
  if (!/^\d{1,12}$/u.test(raw)) return false;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > max;
}

export function section(deps, name) {
  const raw = deps?.hubConfig?.[name];
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail(500, 'config', '配置段无效');
  return raw;
}

// 上限可在配置里调低。超过暂定的 25MB 视为配置无效，避免一次读进过大的正文。
export function limitBytes(cfg) {
  if (cfg.max_bytes == null) return DEFAULT_MAX_BYTES;
  const n = cfg.max_bytes;
  if (!Number.isSafeInteger(n) || n < 1 || n > DEFAULT_MAX_BYTES) {
    throw fail(500, 'config', '大小上限配置无效');
  }
  return n;
}

export function uploadTypes(cfg) {
  if (cfg.types == null) return DEFAULT_UPLOAD_TYPES;
  if (typeof cfg.types !== 'object' || Array.isArray(cfg.types)) {
    throw fail(500, 'config', '类型白名单配置无效');
  }
  const out = {};
  for (const [ext, mime] of Object.entries(cfg.types)) {
    const key = String(ext).toLowerCase();
    const value = typeof mime === 'string' ? mime.toLowerCase() : '';
    if (!EXT_RE.test(key) || !MIME_RE.test(value)) throw fail(500, 'config', '类型白名单配置无效');
    out[key] = value;
  }
  if (Object.keys(out).length === 0) throw fail(500, 'config', '类型白名单配置无效');
  return Object.freeze(out);
}

export function headerValue(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return typeof value === 'string' ? value : '';
}

export function normalizeMime(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const mime = value.split(';')[0].trim().toLowerCase();
  return MIME_ALIAS[mime] ?? mime;
}

function rawName(value) {
  if (typeof value !== 'string') return '';
  let name = value.trim();
  if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) name = name.slice(1, -1);
  const utf8 = /^UTF-8''(.+)$/iu.exec(name);
  if (utf8) name = utf8[1];
  return name;
}

function keepChar(ch) {
  const code = ch.codePointAt(0);
  if (code <= 31 || code === 127) return false;
  if (code >= 0x202a && code <= 0x202e) return false;
  if (code >= 0x2066 && code <= 0x2069) return false;
  return /[\p{L}\p{N}._ -]/u.test(ch);
}

// 去掉路径、控制字符和花哨符号。调用方再按扩展名决定收不收。
export function cleanFileName(raw) {
  let name = rawName(raw);
  if (!name) return 'file';
  try {
    name = decodeURIComponent(name);
  } catch {
    // 不是百分号编码就保持原样，后面仍会去掉路径。
  }
  name = name.replaceAll('\\', '/').split('/').at(-1) ?? '';
  name = [...name.normalize('NFC')].filter(keepChar).join('').replace(/^\.+/u, '').trim();
  if (!name || name === '.' || name === '..') return 'file';
  const chars = [...name];
  if (chars.length <= 80) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? [...name.slice(dot)] : [];
  const stem = chars.slice(0, Math.max(1, 80 - ext.length)).join('');
  return stem + ext.join('');
}

export function readableName(name) {
  const folded = name.normalize('NFC').toLowerCase();
  if (UNREADABLE.some(word => folded.includes(word.toLowerCase()))) {
    throw fail(400, 'bad-name', '文件名含助理不能读的字样');
  }
}

function storedUploadName(cleaned, types) {
  const dot = cleaned.lastIndexOf('.');
  if (dot <= 0 || dot === cleaned.length - 1) return null;
  const ext = cleaned.slice(dot + 1).toLowerCase();
  const mime = types[ext];
  if (!mime) return null;
  const stem = cleaned.slice(0, dot);
  if (!stem) return null;
  return { name: `${stem}.${ext}`, mime };
}

export async function readBounded(req, max) {
  if (!req?.[Symbol.asyncIterator]) return { tooLarge: false, bytes: Buffer.alloc(0) };
  const chunks = [];
  let size = 0;
  for await (const part of req) {
    const buf = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += buf.length;
    if (size > max) {
      chunks.length = 0;
      req.destroy?.();
      return { tooLarge: true, size };
    }
    chunks.push(buf);
  }
  return { tooLarge: false, bytes: Buffer.concat(chunks), size };
}

export async function drain(req, max = DEFAULT_MAX_BYTES) {
  if (!req?.[Symbol.asyncIterator]) return;
  let size = 0;
  try {
    for await (const part of req) {
      size += Buffer.isBuffer(part) ? part.length : Buffer.byteLength(part);
      if (size > max) {
        req.destroy?.();
        return;
      }
    }
  } catch {
    // 连接已经断了就不再读。
  }
}

export function requestKey(kind, raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') throw fail(400, 'bad-request-id', '请求号无效');
  const id = raw.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/u.test(id) || id === '.' || id === '..') {
    throw fail(400, 'bad-request-id', '请求号无效');
  }
  return `${kind}-${id}`;
}

export async function findSession(deps, conversation, bot) {
  if (typeof conversation !== 'string' || !conversation || typeof bot !== 'string' || !bot) {
    throw fail(400, 'bad-query', '缺少会话或助理');
  }
  let id;
  try {
    id = sessionId(conversation);
  } catch {
    throw fail(400, 'bad-session', '会话号无效');
  }
  if (id === '.' || id === '..') throw fail(400, 'bad-session', '会话号无效');
  if (!/^[A-Za-z0-9_.:-]{1,64}$/u.test(bot)) throw fail(400, 'bad-bot', '助理号无效');
  if (typeof deps.sessions?.list !== 'function') throw fail(503, 'no-sessions', '会话清单不可用');
  const rows = await deps.sessions.list({ all: true });
  const row = (Array.isArray(rows) ? rows : []).find(item => item && item.id === id);
  if (!row) throw fail(404, 'session-not-found', '会话不存在');
  if (row.bot !== bot) throw fail(400, 'bot-mismatch', '助理与会话不符');
  if (!/^[A-Za-z0-9_.:-]{1,200}$/u.test(row.id) || row.id === '.' || row.id === '..') {
    throw fail(400, 'bad-session', '会话号无效');
  }
  return row;
}

function configuredAbsolute(value, deps) {
  if (typeof value !== 'string' || !deps?.hubHome) return undefined;
  try {
    const result = expandConfiguredPath(value, { home: os.homedir(), hubHome: deps.hubHome });
    return path.isAbsolute(result) && !/[\0\r\n]/u.test(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function relativeDir(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return null;
  if (value.startsWith('~') || value.startsWith('$')) return null;
  const parts = value.split(/[\\/]/u);
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  if (parts.some(part => !/^[A-Za-z0-9._-]{1,40}$/u.test(part))) return null;
  return parts.join('/');
}

function resolveBase(cwd, cfg, deps) {
  if (cfg.dir == null || cfg.dir === '') return path.join(cwd, 'inbox');
  const rel = relativeDir(cfg.dir);
  if (rel) return path.join(cwd, rel);
  const abs = configuredAbsolute(cfg.dir, deps);
  if (!abs) throw fail(500, 'config', '收件目录配置无效');
  const fromCwd = path.relative(cwd, abs);
  if (!fromCwd || fromCwd.startsWith('..') || path.isAbsolute(fromCwd)) {
    throw fail(500, 'config', '收件目录不在助理可读范围内');
  }
  return abs;
}

async function assertRealDir(cwd, target) {
  const fromCwd = path.relative(cwd, target);
  if (!fromCwd || fromCwd.startsWith('..') || path.isAbsolute(fromCwd)) {
    throw fail(500, 'path', '收件目录不在助理可读范围内');
  }
  const cwdStat = await fs.promises.lstat(cwd);
  if (!cwdStat.isDirectory()) throw fail(503, 'no-cwd', '会话目录不可用');
  let current = cwd;
  for (const part of fromCwd.split(path.sep)) {
    if (!part || part === '.' || part === '..') throw fail(500, 'path', '收件目录不在助理可读范围内');
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.promises.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw fail(500, 'path', '收件目录不在助理可读范围内');
    }
  }
}

export function toRel(cwd, file) {
  const rel = path.relative(cwd, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join('/');
  if (posix.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return posix;
}

// create 为假时目录不存在就返回 null，不新建。
export async function locateInbox(deps, cfg, session, create) {
  const cwd = typeof deps.botCwd === 'function' ? deps.botCwd(session.bot) : undefined;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw fail(503, 'no-cwd', '会话目录不可用');
  const base = resolveBase(cwd, cfg, deps);
  const sessionDir = path.join(base, session.id);
  await assertRealDir(cwd, sessionDir);
  if (!create) {
    try {
      const stat = await fs.promises.lstat(sessionDir);
      if (!stat.isDirectory()) return null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  } else {
    await fs.promises.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(sessionDir, 0o700);
    const parent = path.dirname(sessionDir);
    if (parent !== cwd) await fs.promises.chmod(parent, 0o700).catch(() => {});
  }
  const root = await fs.promises.realpath(cwd);
  const dest = await fs.promises.realpath(sessionDir);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw fail(500, 'path', '收件目录不在助理可读范围内');
  }
  const posix = toRel(cwd, sessionDir);
  if (!posix) throw fail(500, 'path', '收件目录不在助理可读范围内');
  return { cwd, sessionDir, rel: posix };
}

async function readJson(file) {
  try {
    const value = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw fail(500, 'receipt', '回执读不了');
  }
}

async function atomicWrite(file, text) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await fs.promises.open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(text);
  } finally {
    await handle.close();
  }
  await fs.promises.chmod(tmp, 0o600);
  await fs.promises.rename(tmp, file);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function peekFinal(dir, key) {
  const value = await readJson(path.join(dir, '.receipts', `${key}.json`)).catch(error => {
    if (error?.error === 'receipt') throw error;
    return null;
  });
  return value?.final === true && value.body ? value : null;
}

async function dropStaleLock(lock) {
  try {
    const stat = await fs.promises.lstat(lock);
    if (Date.now() - stat.mtimeMs > 30000) await fs.promises.unlink(lock);
  } catch {
    // 没有锁，或锁正在被使用。
  }
}

// 同一个请求号只跑一次 run。final 的回执直接交回，不再写文件。
export async function withReceipt(dir, key, run) {
  const folder = path.join(dir, '.receipts');
  await fs.promises.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(folder, 0o700);
  const file = path.join(folder, `${key}.json`);
  const lock = `${file}.lock`;
  const first = await readJson(file);
  if (first?.final === true && first.body) return first;
  await dropStaleLock(lock);
  let handle;
  const start = Date.now();
  while (!handle) {
    try {
      handle = await fs.promises.open(lock, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const again = await readJson(file);
      if (again?.final === true && again.body) return again;
      if (Date.now() - start > 10000) throw fail(409, 'busy', '请求仍在处理');
      await delay(20);
    }
  }
  try {
    const again = await readJson(file);
    if (again?.final === true && again.body) return again;
    const produced = await run(again);
    const record = {
      v: 1,
      final: produced.final !== false,
      name: produced.name ?? again?.name ?? null,
      body: produced.body,
    };
    if (Number.isInteger(produced.status) && produced.status >= 100 && produced.status <= 599) {
      record.status = produced.status;
    }
    await atomicWrite(file, JSON.stringify(record));
    return record;
  } finally {
    await handle.close();
    await fs.promises.unlink(lock).catch(() => {});
  }
}

export async function writeNew(dir, safeName, bytes) {
  const dot = safeName.lastIndexOf('.');
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const ext = dot > 0 ? safeName.slice(dot) : '';
  for (let n = 0; n < 1000; n += 1) {
    const name = n === 0 ? safeName : `${stem}-${n + 1}${ext}`;
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      throw fail(400, 'bad-name', '文件名无效');
    }
    const full = path.join(dir, name);
    let handle;
    try {
      handle = await fs.promises.open(full, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    try {
      await handle.writeFile(bytes);
    } catch (error) {
      await handle.close();
      await fs.promises.unlink(full).catch(() => {});
      throw error;
    }
    await handle.close();
    await fs.promises.chmod(full, 0o600);
    const stat = await fs.promises.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      await fs.promises.unlink(full).catch(() => {});
      throw fail(500, 'path', '收件文件没有写成普通文件');
    }
    return { name, full };
  }
  throw fail(409, 'name-busy', '同名文件过多');
}

async function payloadOf(input, max) {
  if (input.tooLarge === true) return { tooLarge: true, bytes: Buffer.alloc(0) };
  if (Buffer.isBuffer(input.bytes)) {
    return input.bytes.length > max
      ? { tooLarge: true, bytes: Buffer.alloc(0) }
      : { tooLarge: false, bytes: input.bytes };
  }
  return readBounded(input.req, max);
}

export async function acceptUpload(deps, input) {
  try {
    return await performUpload(deps, input);
  } catch (error) {
    await drain(input?.req);
    throw error;
  }
}

async function performUpload(deps, input) {
  const session = await findSession(deps, input.conversation, input.bot);
  const cfg = section(deps, 'uploads');
  const max = limitBytes(cfg);
  const key = requestKey('upload', input.requestId);
  if (key) {
    const existing = await locateInbox(deps, cfg, session, false);
    if (existing) {
      const hit = await peekFinal(existing.sessionDir, key);
      if (hit?.body) {
        input.req?.destroy?.();
        return { status: 200, body: hit.body };
      }
    }
  }
  if (declaredTooLarge(input.req, max)) {
    input.req?.destroy?.();
    throw fail(413, 'too-large', '文件超过大小上限');
  }
  const payload = await payloadOf(input, max);
  if (payload.tooLarge) throw fail(413, 'too-large', '文件超过大小上限');
  if (!payload.bytes.length) throw fail(400, 'empty', '文件是空的');
  const types = uploadTypes(cfg);
  const named = storedUploadName(cleanFileName(input.filename), types);
  if (!named) throw fail(415, 'type-not-allowed', '文件类型不在允许范围');
  const headerMime = normalizeMime(input.mime);
  if (headerMime && headerMime !== named.mime) {
    throw fail(415, 'type-not-allowed', '文件类型不在允许范围');
  }
  readableName(named.name);
  readableName(session.id);
  if (typeof cfg.dir === 'string') readableName(cfg.dir);
  const box = await locateInbox(deps, cfg, session, true);
  const save = async previous => {
    if (previous?.body?.ok && previous.body.path) {
      return { final: true, name: previous.name, body: previous.body };
    }
    readableName(box.rel);
    readableName(named.name);
    const slot = await writeNew(box.sessionDir, named.name, payload.bytes);
    const rel = `${box.rel}/${slot.name}`;
    if (!rel || rel.startsWith('/') || rel.split('/').some(part => !part || part === '.' || part === '..')) {
      throw fail(500, 'path', '相对路径无效');
    }
    return {
      final: true,
      name: slot.name,
      body: {
        ok: true,
        id: randomBytes(8).toString('hex'),
        name: slot.name,
        size: payload.bytes.length,
        mime: named.mime,
        path: rel,
      },
    };
  };
  const record = key ? await withReceipt(box.sessionDir, key, save) : await save(null);
  return { status: 200, body: record.body };
}
