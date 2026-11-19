import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFile as nodeExecFile } from 'node:child_process';

// 折叠全角、零宽字符和大小写，便于识别各种写法的标签。
const fold = (s) =>
  String(s ?? '').normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, '').toLowerCase();

// 「Owner要求 / Owner确认」类主人标签的各种变体（全角半角、大小写、中间加空格、带括号）。
const OWNER_TAG = /o\s*w\s*n\s*e\s*r[\s:\-_]*(?:要\s*求|确\s*认|確\s*認|原\s*话|指\s*令)/;

// 判断文本里是否出现主人标签字样。
export function hasOwnerTag(s) {
  return OWNER_TAG.test(fold(s));
}

// 剥掉文本里所有主人标签字样（含括号），反复剥到稳定为止。
export function stripOwnerTags(s) {
  const gap = String.raw`[\s​-‏⁠﻿]*`;
  const will = ['[OoｏＯ]', '[WwｗＷ]', '[NnｎＮ]', '[EeｅＥ]', '[RrｒＲ]'].join(gap);
  const word = ['要求', '确认', '確認', '原话', '指令'].map(w => [...w].join(gap)).join('|');
  const re = new RegExp(
    String.raw`[【\[［〔「『(（]?` + gap + will + String.raw`[\s\u200b-\u200f\u2060\ufeff:：\-_]*(?:${word})` + gap +
      String.raw`[】\]］〕」』)）]?`,
    'gu',
  );
  let v = String(s ?? '');
  for (let i = 0; i < 6; i++) {
    const next = v.replace(re, '');
    if (next === v) break;
    v = next;
  }
  return v;
}

// 草稿的稳定校验和：键排序后做 sha256。
export function draftDigest(d) {
  const norm = (v) => Array.isArray(v) ? v.map(norm) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(norm(d))).digest('hex');
}

// 检查草稿里的密钥、联系方式、证件号、聊天原文和主人标签；直投与会议两条路径共用。
export function scanDraft(d, opts = {}) {
  const reasons = [];
  const add = (b, code) => {
    if (b && !reasons.includes(code)) reasons.push(code);
  };
  const body = String(d?.body ?? '');
  const parts = [d?.project, d?.summary, body, d?.next, d?.source,
    ...(Array.isArray(d?.evidence) ? d.evidence : [d?.evidence])].map(x => String(x ?? ''));
  const all = parts.join('\n');
  const f = fold(all);
  // 密钥：常见凭据格式加长随机令牌。
  const tokens = all.match(/[A-Za-z0-9+/_=\-]{32,}/g) || [];
  const random = tokens.some(t => t.split('/').some(x => x.length >= 32 && /[A-Za-z]/.test(x) && /\d/.test(x)));
  add(new RegExp(
    String.raw`sk-[A-Za-z0-9_-]{16,}|-----BEGIN [^-\r\n]*PRIVATE KEY-----|` +
      String.raw`\bAKIA[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|` +
      String.raw`\bBearer\s+[A-Za-z0-9._~+\/=-]{20,}|\b[0-9a-fA-F]{40,}\b`,
  ).test(all) || random, 'secret');
  // 邮箱与电话（含带空格的国际号码、座机）。
  add(new RegExp(
    String.raw`[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|` +
      String.raw`\+\s*\d(?:[\s().-]*\d){9,}|(?<!\d)0?\d{2,4}[- ]\d{3,4}[- ]\d{4}(?!\d)`,
    'i',
  ).test(f), 'contact');
  // 证件号：18 位与 15 位身份证、护照。
  add(new RegExp(
    String.raw`(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dx](?!\d)|` +
      String.raw`(?<!\d)[1-9]\d{5}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}(?!\d)|` +
      String.raw`(?:护照|passport)[^\n]{0,12}[a-z]\d{7,8}`,
    'i',
  ).test(f), 'personal-id');
  add((opts.bannedTerms || []).some(t => t && f.includes(fold(t))), 'banned-term');
  // 聊天原文：引用行、时间戳行、任意「说话人：」行，超过上限就拦。
  const speaker = /^\s*(?:>|\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*\S|[^\s：:，,。.;；、>]{1,12}\s*[：:]\s*\S)/;
  add(body.split(/\r?\n/).filter(l => speaker.test(l)).length > (opts.maxChatLines ?? 20), 'chat-log');
  // 主人标签：只放行与 verifiedQuote 完全一致的那一行；「主人原话（逐字」开头的行只能是那一行。
  const vq = d?.verifiedQuote;
  const okLine = vq && typeof vq.source === 'string' && typeof vq.text === 'string'
    ? `主人原话（逐字，出处：${vq.source}）：「${vq.text}」【Owner要求】` : null;
  let used = false;
  const rest = all.split(/\r?\n/).filter(l => {
    if (okLine !== null && !used && l === okLine) {
      used = true;
      return false;
    }
    return true;
  });
  add(rest.some(l => OWNER_TAG.test(fold(l)) || /^\s*主人原话\s*[（(]\s*逐字/.test(l)), 'owner-tag');
  return { ok: reasons.length === 0, reasons };
}

// 检查单行字段的长度、控制字符及命令参数前缀。
const line = (v, max = Infinity, empty = false) =>
  typeof v === 'string' && (empty || !!v.trim()) && v.length <= max && !/[\r\n\0]/.test(v) && !v.startsWith('-');

// 检查投递草稿的字段是否符合要求。
export function validateDraft(d) {
  if (!d || typeof d !== 'object') {
    return { ok: false, reason: 'draft' };
  }
  if (d.schemaVersion !== 1) {
    return { ok: false, reason: 'schemaVersion' };
  }
  // ID 以字母或数字开头，其余只允许安全的标识符字符。
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,80}$/.test(d.id ?? '')) {
    return { ok: false, reason: 'id' };
  }
  if (!['work', 'research', 'decision', 'incident', 'rule', 'handoff'].includes(d.kind)) {
    return { ok: false, reason: 'kind' };
  }
  if (!line(d.project, 60)) {
    return { ok: false, reason: 'project' };
  }
  if (!line(d.summary, 120)) {
    return { ok: false, reason: 'summary' };
  }
  if (!line(d.source)) {
    return { ok: false, reason: 'source' };
  }
  if (typeof d.body !== 'string' || !d.body.trim() || Buffer.byteLength(d.body) > 128 * 1024 ||
      d.body.includes('\0')) {
    return { ok: false, reason: 'body' };
  }
  if (!Array.isArray(d.evidence) || d.evidence.length > 5 || !d.evidence.every(e => line(e, 200, true))) {
    return { ok: false, reason: 'evidence' };
  }
  if (!line(d.next, Infinity, true)) {
    return { ok: false, reason: 'next' };
  }
  if (!Array.isArray(d.labels) || d.labels.some(x => typeof x !== 'string' || hasOwnerTag(x))) {
    return { ok: false, reason: 'labels' };
  }
  return { ok: true, reason: '' };
}

// 检查执行程序、工作目录和投递配置。
function config(c) {
  const fail = () => {
    const e = new Error('invalid configuration');
    e.state = 'config-error';
    throw e;
  };
  // 贡献者标识只允许小写字母、数字和连字符。
  if (!c || typeof c.kbAgentPath !== 'string' || !path.isAbsolute(c.kbAgentPath) ||
      typeof c.workDir !== 'string' || !path.isAbsolute(c.workDir) ||
      (c.pendingDir !== undefined && (typeof c.pendingDir !== 'string' || !path.isAbsolute(c.pendingDir))) ||
      !/^[a-z][a-z0-9-]{1,40}$/.test(c.contributor ?? '') || !['auto', 'card'].includes(c.approval ?? 'card') ||
      (c.grantsFile !== undefined && (typeof c.grantsFile !== 'string' || !path.isAbsolute(c.grantsFile)))) {
    fail();
  }
  try {
    fs.accessSync(c.kbAgentPath, fs.constants.X_OK);
    if (!fs.statSync(c.kbAgentPath).isFile() || !fs.statSync(c.workDir).isDirectory()) {
      fail();
    }
  } catch {
    fail();
  }
}

// 将尚未确认投递的草稿保存在本地待处理目录。
function save(d, c) {
  if (!c.pendingDir) {
    return;
  }
  fs.mkdirSync(c.pendingDir, { recursive: true, mode: 0o700 });
  const file = path.join(c.pendingDir, d.id + '.json');
  const fd = fs.openSync(file, 'w', 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify(d));
  } finally {
    fs.closeSync(fd);
  }
  writeCardDigest(c.pendingDir, d);
}

// 确认卡出示时记下草稿校验和（先写先得，不被后来的草稿覆盖）。
export function writeCardDigest(pendingDir, d) {
  fs.mkdirSync(pendingDir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(path.join(pendingDir, d.id + '.sha256'), draftDigest(d), { mode: 0o600, flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

// 读取确认卡上的校验和；没有这个文件返回 null。
function cardDigest(pendingDir, id) {
  try {
    return fs.readFileSync(path.join(pendingDir, id + '.sha256'), 'utf8').trim();
  } catch {
    return null;
  }
}

// 从逐行输出中提取有效的 JSON 对象。
function rows(s) {
  return String(s ?? '').split(/\r?\n/).flatMap(l => {
    try {
      const v = JSON.parse(l);
      return v && typeof v === 'object' ? [v] : [];
    } catch {
      return [];
    }
  });
}

// 执行投递命令并将同步异常和回调错误统一为结果。
function run(file, args, opts, fn) {
  return new Promise(resolve => {
    try {
      fn(file, args, opts, (err, stdout) => resolve({ err, stdout: stdout ?? err?.stdout ?? '' }));
    } catch (err) {
      resolve({ err, stdout: err?.stdout ?? '' });
    }
  });
}

const cardApproved = Symbol('cardApproved');

// 统计正文中标记为逐字原话的行。
export function ownerQuoteCount(d) {
  return String(d?.body ?? '').split(/\r?\n/).filter(line => /^主人原话（逐字，出处：/.test(line)).length;
}

// 校验并投递一份草稿，或在未确认时保存待处理状态。
export async function submit(d, c, deps = {}) {
  const valid = validateDraft(d);
  if (!valid.ok) {
    return { state: 'invalid', reason: valid.reason };
  }
  config(c);
  // 直投入口自己也过滤：不依赖调用方有没有先过滤。
  const scan = scanDraft(d, { bannedTerms: c.bannedTerms, maxChatLines: c.maxChatLines });
  if (!scan.ok) {
    return { state: 'blocked', reasons: scan.reasons };
  }
  // 默认先出确认卡；这一类（项目加 kind）被主人点过「以后这类不用问」才直接投。
  if (!deps[cardApproved] && (ownerQuoteCount(d) || (c.approval ?? 'card') === 'card' && !isGranted(d, c))) {
    save(d, c);
    return {
      state: 'card',
      card: {
        title: '知识库投递确认', summary: d.summary, project: d.project, kind: d.kind,
        bodyPreview: d.body.slice(0, 600), bodyTruncated: d.body.length > 600, bodyLength: d.body.length,
        ownerQuoteCount: ownerQuoteCount(d),
        draftId: d.id,
        alwaysAllow: { label: '以后这类不用问', key: grantKey(d) },
      },
      draft: d,
    };
  }
  let file;
  try {
    file = path.join(c.workDir, '.body-' + randomBytes(16).toString('hex'));
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, d.body);
    } finally {
      fs.closeSync(fd);
    }
    const opts = {
      timeout: c.timeoutMs ?? 120000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: Object.fromEntries(['PATH', 'HOME'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])),
    };
    const execute = deps.execFile ?? nodeExecFile;
    const args = [
      '--contributor', c.contributor, 'record', '--project', d.project, '--kind', d.kind, '--summary', d.summary,
      '--body-file', file, '--id', d.id, '--source', d.source, ...d.evidence.flatMap(e => ['--evidence', e]),
      ...(d.next ? ['--next', d.next] : []),
    ];
    const record = await run(c.kbAgentPath, args, opts, execute);
    const rec = rows(record.stdout).find(x => typeof x.state === 'string' && typeof x.id === 'string');
    if (record.err || !rec || !['queued', 'already_delivered'].includes(rec.state)) {
      save(d, c);
      return {
        state: 'pending',
        reason: 'record-failed:' +
          (record.err ? 'process error' : rec?.state === 'rejected' ? 'rejected' : 'invalid receipt'),
        draft: d,
      };
    }
    if (rec.state === 'already_delivered') {
      return { state: 'delivered', receipt: 'already_delivered', id: rec.id };
    }
    const flush = await run(c.kbAgentPath, ['--contributor', c.contributor, 'flush'], opts, execute);
    const receipt = rows(flush.stdout).find(x => x.event === rec.id);
    // 回执中的提交哈希必须为 40 至 64 位小写十六进制字符。
    if (!flush.err && receipt && ['pushed', 'up_to_date'].includes(receipt.state) &&
        /^[0-9a-f]{40,64}$/.test(receipt.commit ?? '') &&
        (receipt.reason === undefined || receipt.reason === null || receipt.reason === '')) {
      try {
        c.activity?.({
          ts: new Date().toISOString(),
          text: `知识库投递成功 ${d.project}/${d.kind} ${d.summary} 回执 ${receipt.state}`,
        });
      } catch {
      }
      return { state: 'delivered', receipt: receipt.state, commit: receipt.commit, id: rec.id };
    }
    save(d, c);
    return {
      state: 'pending',
      reason: 'flush-unconfirmed:' +
        (flush.err ? 'process error' : receipt ? 'unconfirmed receipt' : 'missing receipt'),
      id: rec.id,
      draft: d,
    };
  } finally {
    if (file) {
      try {
        fs.unlinkSync(file);
      } catch {
      }
    }
  }
}

// 放权的粒度：同一个项目名加同一个 kind 算「这一类」。
export function grantKey(d) {
  return `${d.project}/${d.kind}`;
}

// 读取放权记录；文件不存在、损坏或没配置都当作没有放权。
export function readGrants(c) {
  if (!c?.grantsFile) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(c.grantsFile, 'utf8'));
    return Array.isArray(data.grants) ? data.grants.filter(g => g && typeof g.key === 'string') : [];
  } catch {
    return [];
  }
}

// 判断这一类是否已被主人放权为自动投。
function isGranted(d, c) {
  return readGrants(c).some(g => g.key === grantKey(d));
}

// 主人点了「以后这类不用问」：把这一类改成自动投，并留一条记录（谁、哪天）。
export function grantAuto(d, c, { by, date }) {
  config(c);
  if (!c.grantsFile) {
    throw new Error('未配置 grantsFile，无法记录放权');
  }
  if (typeof by !== 'string' || !/^[^\r\n\0]{1,80}$/.test(by.trim()) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw new Error('放权记录需要「谁」和 YYYY-MM-DD 日期');
  }
  const key = grantKey(d);
  const grants = readGrants(c);
  if (!grants.some(g => g.key === key)) {
    grants.push({ key, by: by.trim(), on: date });
    fs.mkdirSync(path.dirname(c.grantsFile), { recursive: true, mode: 0o700 });
    const tmp = c.grantsFile + '.tmp-' + randomBytes(6).toString('hex');
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ grants }, null, 2) + '\n');
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, c.grantsFile);
    try {
      const text = `知识库投递放权 ${key} 由 ${by.trim()} 于 ${date}`;
      c.activity?.({ ts: new Date().toISOString(), text });
    } catch {
      // 活动记录失败不影响放权
    }
  }
  return { key, by: by.trim(), on: date };
}

// 确认卡被点头后投递；options.always 为真时先放权（需要 by 与 date，来自主人点击的记录）。
// 批准的草稿必须与确认卡上出示的那份校验和一致，不一致就不投、不放权。
export function approveCard(d, c, deps, options = {}) {
  const expected = options.expectedDigest ??
    (c?.pendingDir && d && typeof d.id === 'string' ? cardDigest(c.pendingDir, d.id) : null);
  const pendingFile = c?.pendingDir && d && typeof d.id === 'string'
    ? path.join(c.pendingDir, d.id + '.json') : null;
  const hasCard = expected !== null && expected !== undefined;
  const orphan = !hasCard && pendingFile !== null && fs.existsSync(pendingFile);
  if (orphan || (hasCard && expected !== draftDigest(d))) {
    return Promise.resolve({ state: 'invalid', reason: 'card-mismatch' });
  }
  if (options.always) {
    grantAuto(d, c, options);
  }
  return submit(d, { ...c, approval: 'auto' }, { ...deps, [cardApproved]: true });
}

// 逐份提交草稿并隔离单份投递异常。
export async function submitAll(drafts, c, deps) {
  const results = [];
  for (const d of drafts) {
    try {
      results.push(await submit(d, c, deps));
    } catch {
      results.push({ state: 'error', reason: 'submission failed' });
    }
  }
  return results;
}
