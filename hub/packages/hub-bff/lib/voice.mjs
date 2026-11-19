// 收下一小段音频，按配置转成文字交回界面。
// 不替主人发消息，也不调用会话的 send。失败和没配引擎都把音频留下。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { depsStopped } from './panic-marker.mjs';
import {
  declaredTooLarge, drain, fail, findSession, limitBytes, locateInbox, normalizeMime,
  peekFinal, readBounded, readableName, requestKey, section, withReceipt, writeNew,
} from './uploads.mjs';

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
  if (cfg.asr_model == null || cfg.asr_model === '') return '';
  if (typeof cfg.asr_model !== 'string' || !/^[A-Za-z0-9_.:/+-]{1,80}$/u.test(cfg.asr_model)) return null;
  return cfg.asr_model;
}

// 只许本机回环。不跟随重定向，也不接受带账号的地址。
function loopback(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (url.username || url.password || url.hash) return null;
  const host = url.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return null;
  return url;
}

function engines(cfg) {
  const hasUrl = cfg.asr_url != null && cfg.asr_url !== '';
  const hasCmd = cfg.asr_cmd != null;
  if (hasUrl && hasCmd) return { kind: 'both' };
  if (hasUrl) return { kind: 'url', url: String(cfg.asr_url) };
  if (hasCmd) return { kind: 'cmd', cmd: cfg.asr_cmd };
  return { kind: 'none' };
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

function clipText(text) {
  const value = String(text).replace(/\s+$/u, '');
  if ([...value].length > 100000) throw fail(502, 'asr-failed', '转写结果过长');
  return value;
}

async function transcribeUrl(url, model, bytes, mime, filename, timeout) {
  const form = new FormData();
  form.set('model', model);
  form.set('file', new Blob([bytes], { type: mime }), filename);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw fail(504, 'asr-timeout', '转写超时，音频已留下');
    }
    throw fail(502, 'asr-failed', '转写失败，音频已留下');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw fail(502, 'asr-failed', '转写失败，音频已留下');
  }
  if (!response.ok || typeof data?.text !== 'string') throw fail(502, 'asr-failed', '转写失败，音频已留下');
  return clipText(data.text);
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

function transcribeCmd(args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
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

async function runEngine(engine, cfg, file, bytes, mime, filename, timeout) {
  if (engine.kind === 'url') {
    const url = loopback(engine.url);
    const model = modelName(cfg);
    if (!url || !model) throw fail(500, 'asr-misconfigured', '转写配置无效，音频已留下');
    return transcribeUrl(url.href, model, bytes, mime, filename, timeout);
  }
  const model = modelName(cfg);
  if (model == null) throw fail(500, 'asr-misconfigured', '转写配置无效，音频已留下');
  const args = commandArgs(engine.cmd, file, model);
  if (!args) throw fail(500, 'asr-misconfigured', '转写配置无效，音频已留下');
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
  const max = limitBytes(cfg);
  const durationMs = durationOf(input.durationMs);
  const key = requestKey('voice', input.requestId);
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
  const mime = normalizeMime(input.mime);
  const ext = audioMap(cfg)[mime];
  if (!ext) throw fail(415, 'type-not-allowed', '音频类型不在允许范围');
  if (declaredTooLarge(input.req, max)) {
    input.req?.destroy?.();
    throw fail(413, 'too-large', '文件超过大小上限');
  }
  let bytes = Buffer.isBuffer(input.bytes) ? input.bytes : null;
  if (!bytes) {
    const payload = await readBounded(input.req, max);
    if (payload.tooLarge) throw fail(413, 'too-large', '文件超过大小上限');
    bytes = payload.bytes;
  } else if (bytes.length > max) {
    throw fail(413, 'too-large', '文件超过大小上限');
  }
  if (!bytes.length) throw fail(400, 'empty', '音频是空的');
  readableName(session.id);
  if (typeof cfg.dir === 'string') readableName(cfg.dir);
  const box = await locateInbox(deps, cfg, session, true);
  readableName(box.rel);
  const timeout = timeoutMs(cfg);
  const run = async previous => {
    const kept = await savedFile(box, previous, ext, bytes);
    const base = { id: kept.id, path: kept.path, durationMs };
    const parts = kept.path.split('/');
    if (!kept.path || kept.path.startsWith('/') || parts.some(part => !part || part === '.' || part === '..')) {
      throw fail(500, 'path', '相对路径无效');
    }
    if (depsStopped(deps, { whenUnknown: false })) {
      return { final: false, name: kept.name, body: { ...voiceError('stopped'), ...base } };
    }
    const engine = engines(cfg);
    if (engine.kind === 'none') {
      return { final: true, name: kept.name, body: { ...voiceError('asr-unavailable'), ...base } };
    }
    if (engine.kind === 'both') {
      return { final: true, name: kept.name, body: { ...voiceError('asr-misconfigured'), ...base } };
    }
    try {
      const audio = await readSaved(box.sessionDir, kept.name);
      const file = path.join(box.sessionDir, kept.name);
      const text = await runEngine(engine, cfg, file, audio, mime, kept.name, timeout);
      return { final: true, name: kept.name, body: { ok: true, text, ...base } };
    } catch (error) {
      const code = error?.error === 'asr-timeout' ? 'asr-timeout'
        : error?.error === 'asr-misconfigured' ? 'asr-misconfigured' : 'asr-failed';
      return { final: true, name: kept.name, body: { ...voiceError(code), ...base } };
    }
  };
  const record = key ? await withReceipt(box.sessionDir, key, run) : await run(null);
  return { status: 200, body: record.body };
}
