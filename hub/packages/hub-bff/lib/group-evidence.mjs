// 验收证据的结构性检查——「通过」的证据要带一段引文，代码去这张单交的文件
// （或这张单名下、做的人发的组消息）里逐字核对。通过与否只看这里，占位词表只用来把报错说得更友好。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** 引文去掉空白和标点后至少多少字。 */
export const MIN_QUOTE_CORE = 12;
/** 退回理由去掉空白和标点后至少多少字。 */
export const MIN_REASON_CORE = 12;
/** 核对时最多读产出文件多少字节。 */
export const MAX_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024;

const QUOTE_RES = [/「([^「」]+)」/gu, /『([^『』]+)』/gu, /“([^“”]+)”/gu, /"([^"\n]+)"/gu];
const PATH_RE = /(?:\/|[\p{L}\p{N}_.~-]+\/)*[\p{L}\p{N}_.~-]+\.[\p{L}\p{N}_-]+/gu;
const MSG_RE = /#(\d+)(?!\d)/gu;
// 出处写「交单摘要」：引做的人交单时登记的那句结果（看板外部复核者交回时只有这句）。
const SUMMARY_RE = /交单摘要/u;

/** 去零宽等格式符、统一全半角、去掉所有空白，用于逐字比对。 */
export function flat(text) {
  return String(text ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/gu, ' ')
    .replace(/(?<![A-Za-z0-9]) | (?![A-Za-z0-9])/gu, '');
}

/** 去掉空白、标点、符号、格式符后的「实字」。 */
export function core(text) {
  return flat(text).replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 去掉引文后的其余文字（用来找文件名和消息号，免得引文里的字被当成指针）。 */
function outsideQuotes(text) {
  let rest = String(text ?? '');
  for (const re of QUOTE_RES) {
    rest = rest.replace(new RegExp(re.source, 'gu'), ' ');
  }
  return rest;
}

/** 拆出证据里的引文、文件指针、消息号。 */
export function parseEvidence(text) {
  const value = typeof text === 'string' ? text : '';
  const quotes = [];
  for (const re of QUOTE_RES) {
    for (const match of value.matchAll(new RegExp(re.source, 'gu'))) {
      quotes.push(match[1]);
    }
  }
  const rest = outsideQuotes(value);
  const files = rest.match(PATH_RE) ?? [];
  const messages = [...rest.matchAll(MSG_RE)].map((match) => Number(match[1]));
  return { quotes, files, messages };
}

/** 格式检查（不看文件）：通过要有够长的引文和出处；退回要有够长的理由。 */
export function checkEvidenceShape(evidence, { verdict = 'pass', reason = '' } = {}) {
  if (verdict === 'fail') {
    const said = core(reason);
    if (said.length < MIN_REASON_CORE || new Set(said).size < 4) {
      return { ok: false, reason: `退回理由太短或没意义（至少 ${MIN_REASON_CORE} 字，写清清单第几条没达到、差在哪）` };
    }
    if (!flat(evidence)) {
      return { ok: false, reason: '缺少有效证据' };
    }
    return { ok: true, reason: '' };
  }
  const { quotes, files, messages } = parseEvidence(evidence);
  const long = quotes.filter((q) => core(q).length >= MIN_QUOTE_CORE);
  if (!long.length) {
    const hint = quotes.length ? `引文太短（去掉空白标点至少 ${MIN_QUOTE_CORE} 字）` : '缺少有效证据（没有引文）';
    return {
      ok: false,
      reason: `${hint}：通过要从做的人交的文件里逐字摘一句放进「」里，并写明引自哪个文件；` +
        '命令输出请让做的人写进产出文件后再引',
    };
  }
  if (!files.length && !messages.length && !SUMMARY_RE.test(outsideQuotes(evidence))) {
    return { ok: false, reason: '没写引文出自哪个文件（或做的人的哪条消息 #编号）' };
  }
  return { ok: true, reason: '' };
}

/** 从产出文件摘一句给验收人当例子（第一条够长的行，截到 40 字内）。 */
export function sampleQuote(content) {
  for (const line of String(content ?? '').split(/\r?\n/u)) {
    const trimmed = line.trim().replace(/[「」『』“”"]/gu, '');
    if (core(trimmed).length < MIN_QUOTE_CORE) {
      continue;
    }
    const chars = [...trimmed];
    let cut = chars.length;
    for (let n = MIN_QUOTE_CORE; n <= chars.length; n++) {
      if (core(chars.slice(0, n).join('')).length >= MIN_QUOTE_CORE && n >= Math.min(chars.length, 24)) {
        cut = n;
        break;
      }
    }
    return chars.slice(0, Math.min(cut, 40)).join('');
  }
  return '';
}

/**
 * 读做的人交的那个文件：必须在做的人那格、是普通文件、只有一个链接；不合格返回 null。
 * nested：没配组文件夹时 cell 是运行时自己的组目录，只认其子目录里的文件（顶层是 tickets.json 等运行文件）。
 */
export function readSubmittedFile(file, cell, { nested = false } = {}) {
  if (typeof file !== 'string' || typeof cell !== 'string') {
    return null;
  }
  try {
    const base = fs.realpathSync.native(cell);
    const target = path.resolve(base, file);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      return null;
    }
    const real = fs.realpathSync.native(target);
    if (!real.startsWith(`${base}${path.sep}`)) {
      return null;
    }
    if (nested && !path.relative(base, real).includes(path.sep)) {
      return null;
    }
    const bytes = fs.readFileSync(real);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const result = { real, sha256, size: bytes.length, content: '' };
    if (bytes.length > MAX_EVIDENCE_FILE_BYTES) {
      return { ...result, error: '交单文件过大（超过 2MB），读不了；' +
        '请让做的人另写一份不超过 2MB 的摘要文件再交单' };
    }
    try {
      if (bytes.includes(0)) {
        throw new Error('NUL');
      }
      result.content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      result.error = '交单文件是二进制或不是 UTF-8 文本，不能引；' +
        '请让做的人把要验的内容写成文本文件再交单';
    }
    return result;
  } catch {
    return null;
  }
}

/** 证据里写的文件名是否就是交单文件（绝对路径、相对组文件夹、相对做的人那格三种写法）。 */
function pointsTo(item, real, { folder, cell }) {
  // 只写文件名也认——比对对象只有交单登记的那一个文件，不会指偏。
  if (!item.includes('/') && path.basename(real) === item) {
    return true;
  }
  const bases = [folder, cell].filter((x) => typeof x === 'string');
  const tries = path.isAbsolute(item) ? [item] : bases.map((b) => path.resolve(b, item));
  return tries.some((p) => {
    try {
      return fs.realpathSync.native(p) === real;
    } catch {
      return false;
    }
  });
}

/**
 * 结构性核对一条「通过」证据。
 * ctx：ticket、cell（做的人那格，配了组文件夹才有）、folder（组文件夹）、messages（组消息数组）。
 * 引文只认：交单登记的文件里逐字有的、或这张单名下（正文带单号）做的人发的消息里逐字有的。
 */
export function verifyQuotedEvidence(evidence, ctx) {
  const shape = checkEvidenceShape(evidence);
  if (!shape.ok) {
    return shape;
  }
  const { ticket, cell, folder, messages = [], nested = false } = ctx;
  const { quotes, files, messages: ids } = parseEvidence(evidence);
  const submitted = ticket?.report?.file && cell ? readSubmittedFile(ticket.report.file, cell, { nested }) : null;
  if (ticket?.report?.file) {
    if (!ticket.report.sha256) {
      return { ok: false, reason: '交单时没记下文件校验，请让做的人重新交单' };
    }
    if (!submitted || submitted.sha256 !== ticket.report.sha256 || submitted.size !== ticket.report.size) {
      return { ok: false, reason: '文件在交单后被改过，请让做的人重新交单' };
    }
    if (submitted.error && files.length) {
      return { ok: false, reason: submitted.error };
    }
  }
  const sample = submitted ? flat(sampleQuote(submitted.content)) : '';
  const sources = [];
  for (const item of files) {
    if (submitted && !submitted.error && pointsTo(item, submitted.real, { folder, cell })) {
      sources.push({ name: item, lines: submitted.content.split(/\r?\n/u) });
    }
  }
  const summary = ticket?.report?.summary;
  if (SUMMARY_RE.test(outsideQuotes(evidence)) && typeof summary === 'string' && summary.trim()) {
    sources.push({ name: '交单摘要', lines: [summary] });
  }
  const escaped = String(ticket?.id ?? '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const ticketMark = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'u');
  for (const id of ids) {
    const row = messages.find((m) => m.id === id);
    if (row && row.own === true && row.system !== true && row.from === ticket?.assignee &&
        typeof row.text === 'string' && ticketMark.test(row.text)) {
      const own = row.text.replace(new RegExp(`\\[${escaped}\\]`, 'gu'), '')
        .replace(/@[^\s，。！？、]+/gu, '').replace(/【[^】]*】/gu, '')
        .replace(/…（超长截断，长内容请落文件）/gu, '');
      sources.push({ name: `#${id}`, lines: [own] });
    }
  }
  if (!sources.length) {
    const named = [...files, ...ids.map((id) => `#${id}`)].join('、') || '交单摘要';
    return { ok: false, reason: `引文出处「${named}」不是这张单交单登记的文件，` +
      '也不是做的人在这张单下发的消息' };
  }
  const templates = [ticket?.title, ticket?.goal, ...(ticket?.checklist ?? []).map((x) => x.text ?? x)]
    .filter((x) => typeof x === 'string' && x).map(flat);
  for (const quote of quotes) {
    const q = flat(quote);
    let remaining = q.replace(/【[^】]*】/gu, '').replace(new RegExp(escaped, 'gu'), '');
    for (const template of templates) {
      remaining = remaining.split(template).join('');
    }
    if (templates.some((template) => template.includes(q)) ||
        (core(q).length >= MIN_QUOTE_CORE && core(remaining).length < MIN_QUOTE_CORE)) {
      return { ok: false, reason: '这句主要是工单标题/清单原文/标签，不是做的人的产出' };
    }
    if (sample && (q === sample || sample.includes(q) || q.includes(sample))) {
      return { ok: false, reason: '这句是系统摘给你的例子，不能原样当证据；请自己读文件，另摘一句你核对过的' };
    }
    if (!sources.some((s) => s.lines.some((line) => flat(line).includes(q)))) {
      return { ok: false, reason: `引文「${[...quote].slice(0, 20).join('')}」在出处里没找到` +
        '（要逐字摘原文）' };
    }
  }
  return { ok: true, reason: '', sha256: submitted?.sha256 ?? null };

}

/** 退回理由要指明清单哪一条：写「第 N 条/项」或带上该条原文里的一段（4 字以上）。 */
export function reasonNamesItem(reason, index, itemText) {
  const r = flat(reason);
  const n = index + 1;
  if (new RegExp(`第${n}(?:条|项|点)|^${n}[.、)）]|[（(]${n}[)）]`, 'u').test(r)) {
    return true;
  }
  const t = core(itemText);
  for (let i = 0; i + 4 <= t.length; i++) {
    if (core(reason).includes(t.slice(i, i + 4))) {
      return true;
    }
  }
  return false;
}
