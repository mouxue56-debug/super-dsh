// 收下一小段音频，按配置转成文字交回界面。
// 不替主人发消息，也不调用会话的 send。失败和没配引擎都把音频留下。
// asr_url 可指向私网或本机的 OpenAI 兼容转写。公网地址拒绝启动。
// engine: native 用 DeepSeek Harness 本体自带的本地语音转写
// （sherpa-onnx + SenseVoice 小模型），按需起进程、无常驻。
// engine 可以写成 remote，或按顺序写 native 与 remote。
// 前一档超时或失败才用后一档。单独写 native 仍不与地址混用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { BffError } from './errors.mjs';
import { ttsPlan } from './voice-tts.mjs';
import { depsStopped } from './panic-marker.mjs';
import {
  declaredTooLarge, drain, fail, findSession, limitBytes, locateInbox,
  normalizeMime, peekFinal, readBounded, readableName, requestKey, section, withReceipt, writeNew,
} from './uploads.mjs';

// 本体自带的转写资源。测试可用 deps.nativeVoice 换成假命令。
const NATIVE_BIN_DEFAULT =
    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node';
const NATIVE_LIB_DEFAULT =
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar.unpacked/dsh/node_modules/sherpa-onnx-darwin-arm64';
const NATIVE_SCRIPT_DEFAULT = fileURLToPath(new URL('../native/sensevoice-transcribe.cjs', import.meta.url));

export const DEFAULT_AUDIO = Object.freeze({
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
});

const AUDIO_MIME = /^audio\/[a-z0-9.+-]{1,40}$/u;
const AUDIO_EXT = /^[a-z0-9]{1,8}$/u;
const STDOUT_CAP = 200000;

function audioMap(cfg) {
  if (cfg.types == null) return DEFAULT_AUDIO;
  if (typeof cfg.types !== 'object' || Array.isArray(cfg.types)) {
    throw fail(500, 'config', '音频类型配置无效');
  }
  const out = {};
  for (const [mime, ext] of Object.entries(cfg.types)) {
    const key = normalizeMime(mime);
    const value = typeof ext === 'string' ? ext.toLowerCase() : '';
    if (!AUDIO_MIME.test(key) || !AUDIO_EXT.test(value)) throw fail(500, 'config', '音频类型配置无效');
    out[key] = value;
  }
  if (Object.keys(out).length === 0) throw fail(500, 'config', '音频类型配置无效');
  return Object.freeze(out);
}

function timeoutMs(cfg) {
  if (cfg.timeout_ms == null) return 30000;
  const n = cfg.timeout_ms;
  if (!Number.isSafeInteger(n) || n < 100 || n > 120000) throw fail(500, 'config', '转写超时配置无效');
  return n;
}

function modelName(cfg) {
  const picked = cfg.asr_model != null && cfg.asr_model !== '' ? cfg.asr_model : cfg.model;
  if (picked == null || picked === '') return '';
  if (typeof picked !== 'string' || !/^[A-Za-z0-9_.:/+-]{1,80}$/u.test(picked)) return null;
  return picked;
}

function languageName(cfg) {
  if (cfg.language == null || cfg.language === '') return '';
  if (typeof cfg.language !== 'string') return null;
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/u.test(cfg.language)) return null;
  return cfg.language;
}

function audioByteCap(cfg, hard) {
  if (cfg.max_audio_bytes == null) return hard;
  const n = cfg.max_audio_bytes;
  if (!Number.isSafeInteger(n) || n < 1 || n > hard) throw fail(500, 'config', '音频大小上限配置无效');
  return n;
}

function audioSecondCap(cfg) {
  if (cfg.max_audio_seconds == null) return 300;
  const n = cfg.max_audio_seconds;
  if (!Number.isSafeInteger(n) || n < 1 || n > 24 * 60 * 60) {
    throw fail(500, 'config', '音频时长上限配置无效');
  }
  return n;
}

function ipv4Private(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/u.test(part))) return false;
  const nums = parts.map(Number);
  if (nums.some(n => n > 255)) return false;
  const a = nums[0];
  const b = nums[1];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return a === 100 && b >= 64 && b <= 127;
}

function ipv6Private(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  const head = lower.split(':')[0];
  if (!/^[0-9a-f]{1,4}$/u.test(head)) return false;
  const word = Number.parseInt(head, 16);
  return word >= 0xfc00 && word <= 0xfdff;
}

function isPrivateIp(ip) {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Private(ip);
  if (kind === 6) return ipv6Private(ip);
  return false;
}

function asrHost(hostname) {
  let host = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.toLowerCase();
  return host;
}

// 只许回环、私网、Tailscale 100.64/10，以及 localhost / *.ts.net。不接受账号。
function parseAsrUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) {
    return { ok: false, reason: 'public' };
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'public' };
  }
  if (url.username || url.password) return { ok: false, reason: 'userinfo' };
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: 'protocol' };
  if (url.hash) return { ok: false, reason: 'public' };
  const host = asrHost(url.hostname);
  if (!host || host.includes(' ')) return { ok: false, reason: 'public' };
  const named = host === 'localhost' || (host.endsWith('.ts.net') && host.length > '.ts.net'.length);
  if (named) return { ok: true, kind: 'name', host, href: url.href };
  if (isIP(host) !== 0) {
    if (!isPrivateIp(host)) return { ok: false, reason: 'public', host };
    return { ok: true, kind: 'ip', host, href: url.href };
  }
  return { ok: false, reason: 'public', host };
}

async function defaultLookup(host) {
  const rows = await dnsLookup(host, { all: true, verbatim: true });
  return rows.map(row => row.address);
}

async function resolvePrivate(host, lookup) {
  let ips;
  try {
    ips = await (lookup ?? defaultLookup)(host);
  } catch {
    return { ok: false, reason: 'lookup' };
  }
  const list = Array.isArray(ips) ? ips.map(item => String(item)) : [];
  if (list.length === 0 || list.some(ip => !isPrivateIp(ip))) return { ok: false, reason: 'dns' };
  return { ok: true, ips: list };
}

function redirectThrown(error) {
  return /redirect/i.test(String(error?.message ?? ''));
}

async function defaultProbe(url) {
  const response = await fetch(url, {
    method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(3000),
  });
  await response.body?.cancel?.()?.catch?.(() => {});
  return response.status >= 300 && response.status < 400;
}

function startupReason(parsed, label = '转写') {
  const host = parsed?.host && parsed.reason !== 'userinfo' ? `（${parsed.host}）` : '';
  if (parsed?.reason === 'userinfo') return `${label}地址带了用户名或密码，语音只走自己的机器`;
  if (parsed?.reason === 'protocol') return `${label}地址只允许 http 或 https，已拒绝启动${host}`;
  if (parsed?.reason === 'dns') return `${label}地址解析到了公网，语音只走自己的机器${host}`;
  if (parsed?.reason === 'lookup') return `${label}地址解析失败，无法确认它在私网，已拒绝启动${host}`;
  return `${label}地址不在私网或本机，语音只走自己的机器${host}`;
}

// 配了地址才检查。探测连不上不拦启动；只有地址不合法或明确跳转才拒绝。
async function assertEndpoint(raw, label, options) {
  if (raw == null || raw === '') return;
  if (typeof raw !== 'string') {
    throw new BffError('CONFIGURATION', `${label}地址无效，已拒绝启动`, 503);
  }
  const parsed = parseAsrUrl(raw);
  if (!parsed.ok) throw new BffError('CONFIGURATION', startupReason(parsed, label), 503);
  if (parsed.kind === 'name') {
    const resolved = await resolvePrivate(parsed.host, options.lookup);
    if (!resolved.ok) {
      const reason = startupReason({ host: parsed.host, reason: resolved.reason }, label);
      throw new BffError('CONFIGURATION', reason, 503);
    }
  }
  let jumped = false;
  try {
    jumped = await (options.probe ?? defaultProbe)(parsed.href) === true;
  } catch (error) {
    jumped = redirectThrown(error);
  }
  if (jumped) throw new BffError('CONFIGURATION', `${label}地址会跳转到别处，已拒绝启动`, 503);
}

// 配了 asr_url 或 tts_url 才检查。探测连不上不拦启动；只有地址不合法或明确跳转才拒绝。
export async function assertVoiceStartup(cfg, options = {}) {
  if (cfg == null) return;
  if (typeof cfg !== 'object' || Array.isArray(cfg)) {
    throw new BffError('CONFIGURATION', '语音配置段无效', 503);
  }
  await assertEndpoint(cfg.asr_url, '转写', options);
  await assertEndpoint(cfg.tts_url, '合成', options);
  if (cfg.tts_url != null && cfg.tts_url !== '') {
    const plan = ttsPlan(cfg);
    if (plan.state === 'bad') throw new BffError('CONFIGURATION', plan.message, 503);
  }
}

export async function guardUrl(raw, lookup) {
  const parsed = parseAsrUrl(raw);
  if (!parsed.ok) return parsed;
  if (parsed.kind === 'name') {
    const resolved = await resolvePrivate(parsed.host, lookup);
    if (!resolved.ok) return { ok: false, reason: resolved.reason, host: parsed.host };
  }
  return parsed;
}

function listedEngines(value) {
  if (Array.isArray(value)) return value.map(item => (typeof item === 'string' ? item.trim() : item));
  if (typeof value === 'string' && value.includes(',')) {
    return value.split(',').map(part => part.trim()).filter(Boolean);
  }
  return null;
}

export function engines(cfg) {
  const listed = listedEngines(cfg.engine);
  const hasUrl = cfg.asr_url != null && cfg.asr_url !== '';
  const hasCmd = cfg.asr_cmd != null;
  if (listed) {
    const names = listed.filter(name => name !== '');
    const known = names.every(name => name === 'native' || name === 'remote');
    if (!known || names.length < 1 || names.length > 4 || new Set(names).size !== names.length) {
      return { kind: 'bad' };
    }
    if (hasCmd || (hasUrl && !names.includes('remote')) || (names.includes('remote') && !hasUrl)) {
      return { kind: 'both' };
    }
    if (names.length === 1 && names[0] === 'native') return { kind: 'native' };
    if (names.length === 1) return { kind: 'url', url: String(cfg.asr_url) };
    return { kind: 'order', order: names };
  }
  const declared = cfg.engine == null || cfg.engine === '' ? null : cfg.engine;
  if (declared === 'remote') {
    if (!hasUrl || hasCmd) return { kind: 'both' };
    return { kind: 'url', url: String(cfg.asr_url) };
  }
  if (declared !== null && declared !== 'native') return { kind: 'bad' };
  if (declared === 'native') {
    if (hasUrl || hasCmd) return { kind: 'both' };
    return { kind: 'native' };
  }
  if (hasUrl && hasCmd) return { kind: 'both' };
  if (hasUrl) return { kind: 'url', url: String(cfg.asr_url) };
  if (hasCmd) return { kind: 'cmd', cmd: cfg.asr_cmd };
  return { kind: 'none' };
}

function nativeVoiceSpec(deps) {
  const native = deps?.nativeVoice;
  const pick = (value, fallback) => {
    if (typeof value !== 'string' || !value || !path.isAbsolute(value)) return fallback;
    return value;
  };
  return {
    bin: pick(native?.bin, NATIVE_BIN_DEFAULT),
    script: pick(native?.script, NATIVE_SCRIPT_DEFAULT),
    dylib: pick(native?.dylib, NATIVE_LIB_DEFAULT),
  };
}

// 模板里的 {file}、{model} 必须单独占一格，避免拼进 shell 字符串。
function commandArgs(cmd, file, model) {
  if (!Array.isArray(cmd) || cmd.length < 1 || cmd.length > 32) return null;
  if (!cmd.some(part => part === '{file}')) return null;
  if (typeof cmd[0] !== 'string' || !path.isAbsolute(cmd[0])) return null;
  if (cmd[0] === '{file}' || cmd[0] === '{model}') return null;
  const args = [];
  for (const part of cmd) {
    if (typeof part !== 'string' || part.length < 1 || part.length > 400) return null;
    if (part.includes('\0')) return null;
    if (part === '{file}') args.push(file);
    else if (part === '{model}') {
      if (!model) return null;
      args.push(model);
    } else args.push(part);
  }
  return args;
}

const ASR_TAG = /<\|[^|>]{0,40}\|>/gu;
const ASR_DOWN = '转文字暂时不可用，录音已保存';

function stripAsrMarkup(text) {
  let value = String(text);
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const inner = JSON.parse(trimmed);
      if (inner && typeof inner === 'object' && !Array.isArray(inner) && typeof inner.content === 'string') {
        value = inner.content;
      }
    } catch {
      // 普通文本里碰巧以花括号开头。
    }
  }
  return value.replace(ASR_TAG, '');
}

function clipText(text) {
  const value = stripAsrMarkup(text).replace(/^\s+/u, '').replace(/\s+$/u, '');
  if ([...value].length > 100000) throw fail(502, 'asr-failed', '转写结果过长');
  return value;
}

function transcriptOf(data) {
  if (data && typeof data.text === 'string') return clipText(data.text);
  if (data && typeof data.content === 'string') return clipText(data.content);
  return null;
}

async function transcribeUrl(url, model, bytes, mime, filename, timeout, language) {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: mime }), filename);
  form.set('model', model);
  if (language) form.set('language', language);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw fail(504, 'asr-timeout', ASR_DOWN);
    }
    throw fail(502, 'asr-failed', ASR_DOWN);
  }
  if (!response.ok) {
    await response.body?.cancel?.()?.catch?.(() => {});
    throw fail(502, 'asr-failed', ASR_DOWN);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw fail(502, 'asr-failed', ASR_DOWN);
  }
  const text = transcriptOf(data);
  if (text == null) throw fail(502, 'asr-failed', ASR_DOWN);
  return text;
}

function killGroup(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // 进程已经退出。
    }
  }
}

function transcribeCmd(args, timeout, extraEnv = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...(extraEnv ?? {}) },
    });
    const out = [];
    let size = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      killGroup(child);
      finish(reject, fail(504, 'asr-timeout', '转写超时，音频已留下'));
    }, timeout);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > STDOUT_CAP) {
        killGroup(child);
        finish(reject, fail(502, 'asr-failed', '转写结果过长'));
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', () => {});
    child.on('error', () => finish(reject, fail(502, 'asr-failed', '转写失败，音频已留下')));
    child.on('close', code => {
      if (code !== 0) {
        finish(reject, fail(502, 'asr-failed', '转写失败，音频已留下'));
        return;
      }
      try {
        finish(resolve, clipText(Buffer.concat(out).toString('utf8')));
      } catch (error) {
        finish(reject, error);
      }
    });
  });
}

function durationOf(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{1,9}$/u.test(value)) throw fail(400, 'bad-duration', '时长无效');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > 24 * 60 * 60 * 1000) throw fail(400, 'bad-duration', '时长无效');
  return n;
}

function voiceError(code) {
  const message = {
    'asr-unavailable': '没有配置转写，音频已留下',
    stopped: '已一键全停，这次只把音频留下了',
    'asr-failed': '转写失败，音频已留下',
    'asr-timeout': '转写超时，音频已留下',
    'asr-misconfigured': '转写配置无效，音频已留下',
  }[code] ?? '转写没有完成，音频已留下';
  return { ok: false, error: code, message };
}

async function savedFile(box, previous, ext, bytes) {
  if (previous?.name && previous.body?.id && previous.body?.path) {
    return { name: previous.name, id: previous.body.id, path: previous.body.path };
  }
  const id = randomBytes(8).toString('hex');
  const leaf = `voice-${id}.${ext}`;
  readableName(leaf);
  const slot = await writeNew(box.sessionDir, leaf, bytes);
  return { name: slot.name, id, path: `${box.rel}/${slot.name}` };
}

async function readSaved(dir, name) {
  return fs.promises.readFile(path.join(dir, name));
}

function misconfigured(sticky = true) {
  const error = fail(500, 'asr-misconfigured', '转写配置无效，音频已留下');
  error.keepFinal = sticky;
  return error;
}

function canFallBack(error) {
  if (error?.error === 'asr-timeout' || error?.error === 'asr-failed') return true;
  return error?.error === 'asr-misconfigured' && error?.keepFinal === false;
}

async function runOrdered(order, cfg, deps, file, bytes, mime, filename, timeout, lookup) {
  let last;
  for (let i = 0; i < order.length; i += 1) {
    const engine = order[i] === 'remote'
      ? { kind: 'url', url: String(cfg.asr_url) }
      : { kind: 'native' };
    try {
      return await runEngine(engine, cfg, deps, file, bytes, mime, filename, timeout, lookup);
    } catch (error) {
      last = error;
      if (!canFallBack(error) || i === order.length - 1) throw error;
    }
  }
  throw last;
}

async function runEngine(engine, cfg, deps, file, bytes, mime, filename, timeout, lookup) {
  if (engine.kind === 'url') {
    const guarded = await guardUrl(engine.url, lookup);
    const model = modelName(cfg);
    const language = languageName(cfg);
    if (!guarded.ok || !model || language == null) {
      const sticky = guarded.ok || (guarded.reason !== 'dns' && guarded.reason !== 'lookup');
      throw misconfigured(sticky);
    }
    return transcribeUrl(guarded.href, model, bytes, mime, filename, timeout, language);
  }
  if (engine.kind === 'native') {
    const spec = nativeVoiceSpec(deps);
    // DYLD_LIBRARY_PATH 只带本体原生库目录，不是用户配置，也不会把密钥带进去。
    return transcribeCmd([spec.bin, spec.script, file], timeout, { DYLD_LIBRARY_PATH: spec.dylib });
  }
  const model = modelName(cfg);
  if (model == null) throw misconfigured(true);
  const args = commandArgs(engine.cmd, file, model);
  if (!args) throw misconfigured(true);
  return transcribeCmd(args, timeout);
}

export async function acceptVoice(deps, input) {
  try {
    return await performVoice(deps, input);
  } catch (error) {
    await drain(input?.req);
    throw error;
  }
}

async function performVoice(deps, input) {
  const session = await findSession(deps, input.conversation, input.bot);
  const cfg = section(deps, 'voice');
  const hard = limitBytes(cfg);
  const audioMax = audioByteCap(cfg, hard);
  const audioSeconds = audioSecondCap(cfg);
  const timeout = timeoutMs(cfg);
  const durationMs = durationOf(input.durationMs);
  const key = requestKey('voice', input.requestId);
  if (key) {
    const existing = await locateInbox(deps, cfg, session, false);
    if (existing) {
      const hit = await peekFinal(existing.sessionDir, key);
      if (hit?.body) {
        input.req?.destroy?.();
        return { status: hit.status ?? 200, body: hit.body };
      }
    }
  }
  const mime = normalizeMime(input.mime);
  const ext = audioMap(cfg)[mime];
  if (!ext) throw fail(415, 'type-not-allowed', '音频类型不在允许范围');
  if (declaredTooLarge(input.req, hard)) {
    input.req?.destroy?.();
    throw fail(413, 'too-large', '文件超过大小上限');
  }
  let bytes = Buffer.isBuffer(input.bytes) ? input.bytes : null;
  if (!bytes) {
    const payload = await readBounded(input.req, hard);
    if (payload.tooLarge) throw fail(413, 'too-large', '文件超过大小上限');
    bytes = payload.bytes;
  } else if (bytes.length > hard) {
    throw fail(413, 'too-large', '文件超过大小上限');
  }
  if (!bytes.length) throw fail(400, 'empty', '音频是空的');
  readableName(session.id);
  if (typeof cfg.dir === 'string') readableName(cfg.dir);
  const box = await locateInbox(deps, cfg, session, true);
  readableName(box.rel);
  const run = async previous => {
    const kept = await savedFile(box, previous, ext, bytes);
    const base = { id: kept.id, path: kept.path, durationMs };
    const parts = kept.path.split('/');
    if (!kept.path || kept.path.startsWith('/') || parts.some(part => !part || part === '.' || part === '..')) {
      throw fail(500, 'path', '相对路径无效');
    }
    const engine = engines(cfg);
    const connected = engine.kind === 'url' || engine.kind === 'cmd' ||
      engine.kind === 'native' || engine.kind === 'order';
    if (bytes.length > audioMax) {
      return {
        final: true, name: kept.name, status: 413,
        body: {
          ok: false, error: 'audio-too-large', asr: connected,
          message: `录音超过大小上限（${audioMax} 字节），已留下`, ...base,
        },
      };
    }
    if (durationMs != null && durationMs > audioSeconds * 1000) {
      return {
        final: true, name: kept.name, status: 400,
        body: {
          ok: false, error: 'audio-too-long', asr: connected,
          message: `录音超过时长上限（${audioSeconds} 秒），已留下`, ...base,
        },
      };
    }
    if (depsStopped(deps, { whenUnknown: false })) {
      return { final: false, name: kept.name, body: { ...voiceError('stopped'), ...base } };
    }
    if (engine.kind === 'none') {
      return { final: true, name: kept.name, body: { ...voiceError('asr-unavailable'), asr: false, ...base } };
    }
    if (engine.kind === 'both' || engine.kind === 'bad') {
      return { final: true, name: kept.name, body: { ...voiceError('asr-misconfigured'), asr: false, ...base } };
    }
    try {
      const audio = await readSaved(box.sessionDir, kept.name);
      const file = path.join(box.sessionDir, kept.name);
      const text = engine.kind === 'order'
        ? await runOrdered(engine.order, cfg, deps, file, audio, mime, kept.name, timeout, deps.asrLookup)
        : await runEngine(engine, cfg, deps, file, audio, mime, kept.name, timeout, deps.asrLookup);
      return { final: true, name: kept.name, status: 200, body: { ok: true, text, asr: true, ...base } };
    } catch (error) {
      const code = error?.error === 'asr-timeout' ? 'asr-timeout'
        : error?.error === 'asr-misconfigured' ? 'asr-misconfigured' : 'asr-failed';
      // 本体引擎与远程引擎一样：超时或失败都不是终态，录音已保存、可重试。
      const remote = (engine.kind === 'url' || engine.kind === 'native' || engine.kind === 'order') &&
        (code === 'asr-timeout' || code === 'asr-failed');
      const body = { ...voiceError(code), ...base };
      if (remote) {
        body.message = ASR_DOWN;
        body.retryable = true;
        body.asr = true;
      }
      return {
        final: remote ? false : error?.keepFinal !== false,
        name: kept.name,
        status: remote ? (code === 'asr-timeout' ? 504 : 502) : 200,
        body,
      };
    }
  };
  const record = key ? await withReceipt(box.sessionDir, key, run) : await run(null);
  return { status: record.status ?? 200, body: record.body };
}
