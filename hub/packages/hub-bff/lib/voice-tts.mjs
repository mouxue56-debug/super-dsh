// 把回复念出来。只打私网或回环上的 OpenAI 兼容 /v1/audio/speech。
// 没配合成地址时如实说「还没接上」，不改走别的服务。
import { fail, readBounded, section } from './uploads.mjs';
import { guardUrl } from './voice.mjs';

const NAME = /^[A-Za-z0-9_.:/+-]{1,80}$/u;
const SPEAK_BODY_MAX = 200000;
const TEXT_MAX = 20000;
const SEGMENT_CAP = 16;
const AUDIO_CAP = 6000000;
const NOT_READY = '还没接上';

function integerBetween(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

export function ttsPlan(cfg) {
  if (cfg == null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { state: 'bad', message: '语音配置段无效' };
  }
  const url = cfg.tts_url;
  if (url == null || url === '') return { state: 'off' };
  if (typeof url !== 'string') return { state: 'bad', message: '合成地址无效，已拒绝启动' };
  if (typeof cfg.tts_model !== 'string' || !NAME.test(cfg.tts_model)) {
    return { state: 'bad', message: '合成模型配置无效' };
  }
  if (typeof cfg.tts_voice !== 'string' || !NAME.test(cfg.tts_voice)) {
    return { state: 'bad', message: '合成音色配置无效' };
  }
  let timeout = 30000;
  if (cfg.tts_timeout_ms != null) {
    if (!integerBetween(cfg.tts_timeout_ms, 100, 120000)) {
      return { state: 'bad', message: '合成超时配置无效' };
    }
    timeout = cfg.tts_timeout_ms;
  } else if (cfg.timeout_ms != null) {
    if (!integerBetween(cfg.timeout_ms, 100, 120000)) {
      return { state: 'bad', message: '合成超时配置无效' };
    }
    timeout = cfg.timeout_ms;
  }
  let maxChars = 200;
  if (cfg.tts_max_chars != null) {
    if (!integerBetween(cfg.tts_max_chars, 1, 2000)) {
      return { state: 'bad', message: '合成字数上限配置无效' };
    }
    maxChars = cfg.tts_max_chars;
  }
  return {
    state: 'on', url, model: cfg.tts_model, voice: cfg.tts_voice, timeout, maxChars,
  };
}

export function cleanForSpeech(text) {
  let value = String(text ?? '').replace(/\r\n/g, '\n');
  value = value.replace(/```[\s\S]*?```/g, '\n');
  value = value.replace(/```[\s\S]*$/g, '\n');
  const kept = [];
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    const table = trimmed.startsWith('|') && trimmed.slice(1).includes('|');
    const rule = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(trimmed);
    if (!table && !rule) kept.push(line);
  }
  value = kept.join('\n');
  value = value.replace(/\[([^\]\n]{1,200})\]\((?:https?:\/\/|mailto:)[^)\s]+\)/gu, '$1');
  value = value.replace(/https?:\/\/[^\s)>\]]+/gu, ' ');
  value = value.replace(/[ \t]{2,}/g, ' ');
  value = value.replace(/[ \t]+([。！？!?；;，、])/gu, '$1');
  value = value.replace(/[ \t]*\n[ \t]*/g, '\n');
  value = value.replace(/\n{2,}/g, '\n');
  return value.trim();
}

function pushCapped(out, sentence, cap) {
  const chars = [...sentence];
  if (chars.length <= cap) {
    out.push(chars.join(''));
    return;
  }
  let current = '';
  const flush = () => {
    const piece = current.trim();
    current = '';
    if (!piece) return;
    const rest = [...piece];
    if (rest.length <= cap) out.push(rest.join(''));
    else {
      for (let i = 0; i < rest.length; i += cap) out.push(rest.slice(i, i + cap).join(''));
    }
  };
  for (const ch of chars) {
    current += ch;
    const size = [...current].length;
    const comma = '，、,'.includes(ch) && size >= Math.min(8, cap);
    if (size >= cap || (comma && size >= Math.ceil(cap * 0.6))) flush();
  }
  flush();
}

export function splitForSpeech(text, maxChars) {
  const cap = maxChars;
  const sentences = [];
  let buf = '';
  for (const ch of String(text)) {
    buf += ch;
    if ('。！？!?；;\n'.includes(ch)) {
      const piece = buf.trim();
      if (piece) sentences.push(piece);
      buf = '';
    }
  }
  if (buf.trim()) sentences.push(buf.trim());
  const out = [];
  for (const sentence of sentences) pushCapped(out, sentence, cap);
  return out.filter(Boolean);
}

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function oneSegment(plan, text, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(plan.url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: plan.model,
        input: text,
        voice: plan.voice,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(plan.timeout),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw fail(504, 'tts-timeout', '合成超时');
    }
    throw fail(502, 'tts-failed', '这会儿念不出来');
  }
  if (!response.ok) {
    await response.body?.cancel?.()?.catch?.(() => {});
    throw fail(502, 'tts-failed', '这会儿念不出来');
  }
  const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('audio/')) {
    await response.body?.cancel?.()?.catch?.(() => {});
    throw fail(502, 'tts-failed', '这会儿念不出来');
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw fail(502, 'tts-failed', '这会儿念不出来');
  return { mime, audio };
}

export async function speakPrepared(plan, text, fetchImpl = fetch) {
  const cleaned = cleanForSpeech(text);
  if (!cleaned) return { status: 200, body: { ok: false, error: 'tts-empty', message: '这段没有可念的字' } };
  const parts = splitForSpeech(cleaned, plan.maxChars);
  if (!parts.length) {
    return { status: 200, body: { ok: false, error: 'tts-empty', message: '这段没有可念的字' } };
  }
  const used = parts.slice(0, SEGMENT_CAP);
  const segments = [];
  let mime = 'audio/wav';
  let total = 0;
  for (const part of used) {
    const piece = await oneSegment(plan, part, fetchImpl);
    total += piece.audio.length;
    if (total > AUDIO_CAP) throw fail(502, 'tts-failed', '这段太长，这次没念完');
    mime = piece.mime;
    segments.push(b64(piece.audio));
  }
  return {
    status: 200,
    body: {
      ok: true,
      mime,
      segments,
      count: segments.length,
      ...(parts.length > used.length ? { truncated: true, note: '后面还有，这次没念完' } : {}),
    },
  };
}

async function readJson(req) {
  const payload = await readBounded(req, SPEAK_BODY_MAX);
  if (payload.tooLarge) throw fail(413, 'too-large', '要念的字太长');
  if (!payload.bytes?.length) throw fail(400, 'empty', '没有要念的字');
  try {
    return JSON.parse(payload.bytes.toString('utf8'));
  } catch {
    throw fail(400, 'bad-json', '正文不是 JSON');
  }
}

export async function acceptSpeech(deps, req) {
  const cfg = section(deps, 'voice');
  const plan = ttsPlan(cfg);
  if (plan.state === 'off') {
    await readBounded(req, SPEAK_BODY_MAX);
    return { status: 200, body: { ok: false, error: 'tts-unavailable', message: NOT_READY } };
  }
  if (plan.state === 'bad') {
    await readBounded(req, SPEAK_BODY_MAX);
    return { status: 200, body: { ok: false, error: 'tts-misconfigured', message: plan.message } };
  }
  const guarded = await guardUrl(plan.url, deps?.asrLookup);
  if (!guarded.ok) {
    await readBounded(req, SPEAK_BODY_MAX);
    return { status: 200, body: { ok: false, error: 'tts-misconfigured', message: '合成地址不在私网或本机' } };
  }
  const data = await readJson(req);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'bad-json', '正文不是 JSON');
  if (typeof data.text !== 'string') throw fail(400, 'empty', '没有要念的字');
  if ([...data.text].length > TEXT_MAX) throw fail(400, 'too-large', '要念的字太长');
  const ready = { ...plan, url: guarded.href };
  const spoken = await speakPrepared(ready, data.text, deps?.ttsFetch);
  if (typeof data.id === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/u.test(data.id)) {
    spoken.body.id = data.id;
  }
  return spoken;
}
