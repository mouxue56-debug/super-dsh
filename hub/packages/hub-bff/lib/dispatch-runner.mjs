// 外包派工运行器。把一张看板工单交给外部命令行工人（Codex、Grok 一类）去做。
// 只校验、不决定：派给谁、用什么模型由工单写，这里只检查合不合规矩。
// 子进程一律用参数数组起，不经 shell；命令模板写在配置里。
// 本文件也是「守护壳」：以 `node dispatch-runner.mjs --wrap <运行目录>` 起，壳独立于后端进程，
// 壳起真正的工人、落退出码，后端重启后凭运行目录里的文件认回正在跑的。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { textDigest } from './fulltext.mjs';

let activeRunner;

// 接入当前派工运行器，供全停入口使用。
export function setActiveRunner(runner) {
  activeRunner = runner;
}

// 回查当前外派任务。
export function listRunning() {
  return activeRunner?.listRunning() ?? [];
}

// 停止当前外派任务。
export async function stopAll(options) {
  return activeRunner ? activeRunner.stopAll(options) : { stopped: [], stillRunning: [], errors: [] };
}

const SELF = fileURLToPath(import.meta.url);
const NAME = /^[a-z][a-z0-9_-]{0,31}$/u;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const PLACEHOLDERS = ['model', 'workdir', 'brief_file', 'result_file'];
const ACTIVE = ['running', 'timeout'];
const PERMANENT = ['NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'INVALID'];

// 所有数字都是暂定值，全部可在配置里改。不含任何费用上限。
export const DISPATCH_DEFAULTS = Object.freeze({
  timeout_ms: 5400000,
  grant_days: 14,
  card_text_max: 1000,
  card_ttl_ms: 21600000,
  poll_ms: 3000,
  heartbeat_ms: 5000,
  lost_after_ms: 20000,
  stop_wait_ms: 3000,
  max_changed_files: 200,
  max_scan_entries: 5000,
  result_max_bytes: 1500,
  env_pass: Object.freeze(['PATH', 'HOME', 'LANG', 'TMPDIR']),
});

// 任务书首行自动加上的固定禁项。
export const FIXED_FORBIDDEN_LINE =
  '【固定禁项】不投知识库、不读密钥目录、不 push、不部署、不起常驻、不删工作目录外的文件。';

// 任务书里出现这些就直接拒：密钥路径一类。
const SECRET_PATTERNS = [
  /\.secrets\b/iu, /\.credentials/iu, /auth\.json/iu, /\.ssh\b/iu, /\bid_(?:rsa|ed25519|ecdsa)\b/iu,
  /\.aws\b/iu, /\.netrc\b/iu, /\.gnupg\b/iu, /\.dsh/iu, /(?:^|[\s/"'`])\.env(?:\b|$)/iu,
  /\bkeychain\b/iu, /\/etc\/(?:passwd|shadow|sudoers)/iu, /-----BEGIN [A-Z ]*PRIVATE KEY/u,
];
// 提权、绕过一类字样。
const ESCALATION_PATTERNS = [
  /\bsudo\b/iu, /\bsu\s+-/iu, /提权/u, /绕过/u, /越权/u, /\bbypass/iu, /privilege[ -]?escalat/iu,
  /dangerously/iu, /skip[- ]?permission/iu, /--yolo/iu, /sandbox[_-]?permissions/iu, /\bsetuid\b/iu,
  /忽略(?:之前|以上|上面|前面)/u, /ignore (?:all |the )?(?:previous|prior|above)/iu,
];

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isAbs = v => typeof v === 'string' && path.isAbsolute(v) && !/[\0\r\n]/u.test(v);
// 只用于机器检查的比对文本。去掉全部格式字符（\p{Cf}：软连字符、双向控制、不可见运算符等）
// 与默认可忽略字符（组合用连接符 U+034F、变体选择符、韩文填充符等），NFKC 前后各去一次。
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const clean = text => String(text ?? '').replace(INVISIBLE, '').normalize('NFKC').replace(INVISIBLE, '');
const sha256 = text => createHash('sha256').update(text).digest('hex');
const inside = (child, parent) =>
  child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

function positive(value, fallback, label, max = 2 ** 31) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`外包派工配置 ${label} 无效`);
  return value;
}

// 校验并规整外包派工配置；缺根目录或工人表就报错（没配置就是没开通）。
export function normalizeConfig(raw, { defaultRunDir } = {}) {
  if (!isObject(raw)) throw new Error('外包派工未配置');
  if (!isAbs(raw.root)) throw new Error('外包派工配置 root 须为绝对路径');
  const worktrees = raw.worktree_roots ?? [];
  if (!Array.isArray(worktrees) || worktrees.length > 32 || !worktrees.every(isAbs)) {
    throw new Error('外包派工配置 worktree_roots 无效');
  }
  const runDir = raw.run_dir ?? defaultRunDir;
  if (!isAbs(runDir)) throw new Error('外包派工配置 run_dir 须为绝对路径');
  if (!isObject(raw.workers) || !Object.keys(raw.workers).length || Object.keys(raw.workers).length > 16) {
    throw new Error('外包派工配置 workers 无效');
  }
  const workers = {};
  for (const [name, w] of Object.entries(raw.workers)) {
    if (!NAME.test(name) || !isObject(w)) throw new Error('外包派工配置 工人名无效');
    if (!Array.isArray(w.argv) || !w.argv.length || w.argv.length > 64 ||
      !w.argv.every(a => typeof a === 'string' && !a.includes('\0')) || !w.argv[0] || /\{[a-z_]+\}/u.test(w.argv[0])) {
      throw new Error(`外包派工配置 ${name}.argv 无效`);
    }
    for (const arg of w.argv) {
      for (const [, holder] of arg.matchAll(/\{([a-z_]+)\}/gu)) {
        if (!PLACEHOLDERS.includes(holder)) throw new Error(`外包派工配置 ${name}.argv 占位符无效`);
      }
    }
    if (!Array.isArray(w.models) || !w.models.length || w.models.length > 32 || !w.models.every(m => MODEL.test(m))) {
      throw new Error(`外包派工配置 ${name}.models 无效`);
    }
    const stdin = w.stdin ?? 'brief';
    if (!['brief', 'none'].includes(stdin)) throw new Error(`外包派工配置 ${name}.stdin 无效`);
    workers[name] = Object.freeze({ argv: Object.freeze([...w.argv]), models: Object.freeze([...w.models]), stdin });
  }
  const extra = raw.extra_deny_patterns ?? [];
  if (!Array.isArray(extra) || extra.length > 50 || !extra.every(p => typeof p === 'string' && p && p.length <= 200)) {
    throw new Error('外包派工配置 extra_deny_patterns 无效');
  }
  const envPass = raw.env_pass ?? DISPATCH_DEFAULTS.env_pass;
  if (!Array.isArray(envPass) || !envPass.every(n => typeof n === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(n))) {
    throw new Error('外包派工配置 env_pass 无效');
  }
  const allow = raw.allow_bots === undefined || raw.allow_bots === '*' ? ['*'] : raw.allow_bots;
  const idOk = b => typeof b === 'string' && /^[A-Za-z0-9_*-]{1,64}$/u.test(b);
  if (!Array.isArray(allow) || allow.length > 64 || !allow.every(idOk)) {
    throw new Error('外包派工配置 allow_bots 无效');
  }
  const num = key => positive(raw[key], DISPATCH_DEFAULTS[key], key);
  return Object.freeze({
    root: path.resolve(raw.root),
    worktreeRoots: Object.freeze(worktrees.map(p => path.resolve(p))),
    runDir: path.resolve(runDir),
    workers: Object.freeze(workers),
    allowBots: Object.freeze([...allow]),
    denyPatterns: Object.freeze(extra.map(p => new RegExp(p, 'iu'))),
    envPass: Object.freeze([...envPass]),
    timeoutMs: num('timeout_ms'), grantDays: num('grant_days'), cardTextMax: num('card_text_max'),
    cardTtlMs: num('card_ttl_ms'), pollMs: num('poll_ms'), heartbeatMs: num('heartbeat_ms'),
    lostAfterMs: num('lost_after_ms'), stopWaitMs: num('stop_wait_ms'), maxChangedFiles: num('max_changed_files'),
    maxScanEntries: num('max_scan_entries'), resultMaxBytes: num('result_max_bytes'),
  });
}

// 解析真实路径：存在的部分取 realpath，不存在的部分拼回去；悬空符号链接直接报错。
function resolveReal(target) {
  let current = target;
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...rest.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      let exists = true;
      try {
        fs.lstatSync(current);
      } catch {
        exists = false;
      }
      if (exists) throw new Error('路径里有悬空的符号链接');
      const parent = path.dirname(current);
      if (parent === current) throw error;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

// 检查工作目录：只能在外包根目录下该工单自己的子目录里，或配置列出的工作树根里。
export function resolveWorkdir(ticket, config) {
  const wanted = ticket.workdir?.path ?? path.join(config.root, ticket.id);
  if (!isAbs(wanted) || path.normalize(wanted).replace(/\/+$/u, '') !== wanted.replace(/\/+$/u, '')) {
    throw new Error('工作目录须是规整的绝对路径');
  }
  const dir = path.resolve(wanted);
  const real = resolveReal(dir);
  const ownBase = path.join(resolveReal(config.root), ticket.id);
  const ownOk = inside(real, ownBase);
  const treeOk = config.worktreeRoots.some(r => {
    try {
      return inside(real, resolveReal(r));
    } catch {
      return false;
    }
  });
  if (!ownOk && !treeOk) throw new Error('工作目录不在该工单自己的外包子目录，也不在配置的工作树根里');
  for (const w of ticket.workdir?.writable ?? []) {
    if (!isAbs(w) || !inside(resolveReal(path.resolve(w)), real)) throw new Error('可写路径必须在工作目录里面');
  }
  return { dir: real, create: ownOk && !fs.existsSync(real) };
}

// 被退回重做时，派单人写的最后一条退回意见。
function backNote(ticket) {
  if (ticket?.review !== 'sent_back') return '';
  const note = [...(ticket.progress ?? [])].reverse().find(p => p.by === ticket.from?.name);
  return note ? String(note.text) : '';
}

// 放权用：工作目录落在哪个根下（外包根或某个工作树根），返回那个根的真实路径；不在任何根下返回 null。
export function rootOf(workdir, config) {
  for (const root of [config.root, ...config.worktreeRoots]) {
    try {
      const real = resolveReal(root);
      if (inside(workdir, real)) return real;
    } catch {
      // 这个根解析不了就跳过
    }
  }
  return null;
}

// 把工单拼成发给工人的任务书：首行是固定禁项，之后是本单禁项、验收清单、任务书正文、退回意见。
export function composeBrief(ticket) {
  const lines = [FIXED_FORBIDDEN_LINE];
  const extra = (ticket.forbidden ?? []).map(s => String(s).trim()).filter(Boolean);
  if (extra.length) lines.push('【本单禁项】' + extra.join('；'));
  lines.push('【验收清单】');
  (ticket.acceptance ?? []).forEach((a, i) => lines.push(`${i + 1}. ${a.check} → ${a.expect}`));
  lines.push('【任务书】', String(ticket.goal ?? '').trim());
  const back = backNote(ticket);
  if (back) lines.push('【上一轮被退回的意见】', back);
  return lines.join('\n');
}

// 第三道闸：这张工单或发起的会话读过外部内容，就不许派，只能转给主人。
export function checkTaint({ ticket, readExternal }) {
  if (ticket?.readExternalContent !== false) {
    return { code: 'TAINTED', message: '这张工单读过外部内容，不能外派，只能转给主人看' };
  }
  if (readExternal !== false) {
    return { code: 'TAINTED', message: '发起的会话本轮读过外部内容（或无法核实），不能外派，只能转给主人看' };
  }
  return null;
}

// 第二道闸：机器检查任务书。返回 {ok, spec} 或 {ok:false, code, reasons}；不决定任何事，只校验。
export function inspectDispatch({ ticket, bot, config, readExternal, rosterNames = [] }) {
  const taint = checkTaint({ ticket, readExternal });
  if (taint) return { ok: false, code: taint.code, reasons: [taint] };
  const reasons = [];
  const add = (code, message) => reasons.push({ code, message });
  if (!ticket || ticket.legacy === true) add('BAD_STATE', '旧工单不能外派');
  if (ticket?.from?.name !== bot || ticket?.from?.type !== 'assistant') add('NOT_SENDER', '只有派单的助理能把这张工单外派');
  const worker = Array.isArray(ticket?.to) && ticket.to.length === 1 ? ticket.to[0] : undefined;
  const workerCfg = worker ? config.workers[worker] : undefined;
  if (!workerCfg) add('BAD_WORKER', '工单的接收者不是配置里的外部工人');
  if (worker && rosterNames.includes(worker)) add('BAD_WORKER', '工人名与助理名册冲突');
  const model = ticket?.routing?.model;
  if (typeof model !== 'string' || !workerCfg?.models.includes(model)) add('BAD_MODEL', '工单写的模型不在该工人的白名单里');
  const resumable = ticket?.state === 'progress' && ticket.review === 'sent_back' &&
    ticket.claimedBy === worker && ticket.claimedByType === 'external';
  if (ticket && ticket.state !== 'queued' && !resumable) add('BAD_STATE', '工单状态不是待领取（或被退回重做）');
  const accept = ticket?.acceptance;
  const filled = a => String(a?.check ?? '').trim() && String(a?.expect ?? '').trim();
  if (!Array.isArray(accept) || !accept.length || !accept.every(filled)) {
    add('NO_ACCEPTANCE', '验收清单至少要有一条，每条写清检查什么、期望什么');
  }
  if (typeof ticket?.goal !== 'string' || !ticket.goal.trim()) add('BAD_BRIEF', '任务书是空的');
  const material = clean([ticket?.title, ticket?.goal, ...(ticket?.forbidden ?? []),
    ...(accept ?? []).flatMap(a => [a?.check, a?.expect]), ticket?.workdir?.path, backNote(ticket)].join('\n'));
  if (SECRET_PATTERNS.some(p => p.test(material))) add('SECRET_PATH', '任务书里出现了密钥路径一类的字样');
  if (ESCALATION_PATTERNS.some(p => p.test(material))) add('ESCALATION', '任务书里出现了提权、绕过一类的字样');
  if (config.denyPatterns.some(p => p.test(material))) add('DENY_PATTERN', '任务书命中了配置的禁用字样');
  let work;
  try {
    work = resolveWorkdir(ticket, config);
  } catch (error) {
    add('BAD_WORKDIR', error.message);
  }
  if (reasons.length) return { ok: false, code: reasons[0].code, reasons };
  const brief = composeBrief(ticket);
  const specSha = sha256(JSON.stringify({ worker, model, workdir: work.dir, brief }));
  return { ok: true, spec: Object.freeze({ ticketId: ticket.id, bot, worker, model, workdir: work.dir,
    createWorkdir: work.create, brief, briefSha: sha256(brief), specSha, acceptance: ticket.acceptance }) };
}

// 渲染给人看的确认卡正文：任务书全文，加工人、模型、目录。放不下就返回 null（不许删减后让人签）。
export function renderCardText(spec, max = Infinity) {
  const text = [`工人：${spec.worker}｜模型：${spec.model}`, `工作目录：${spec.workdir}`,
    '——任务书全文（含固定禁项、验收清单）——', spec.brief].join('\n');
  return Array.from(text).length <= max ? text : null;
}

// 列出目录树的文件指纹（不跟随符号链接，跳过 .git 与 node_modules，条目数有上限）。
function scanTree(root, limit) {
  const found = new Map();
  let truncated = false;
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        if (found.size >= limit) {
          truncated = true;
          continue;
        }
        const st = fs.lstatSync(path.join(root, child));
        found.set(child, `${st.size}:${Math.trunc(st.mtimeMs)}`);
      }
    }
  }
  return { entries: Object.fromEntries(found), truncated };
}

// 对比开工前后的文件指纹，得到改动文件清单。
function diffTrees(before, after) {
  const changes = [];
  for (const [file, stamp] of Object.entries(after)) {
    if (!(file in before)) changes.push(file);
    else if (before[file] !== stamp) changes.push(file);
  }
  for (const file of Object.keys(before)) if (!(file in after)) changes.push(file + '（已删除）');
  return changes.sort();
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomic(file, text, mode = 0o600) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, { mode, flag: 'wx' });
  fs.renameSync(tmp, file);
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// 读文件末尾最多 max 字节，按 UTF-8 截；不存在返回空串。
function tailText(file, max) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(size, max));
      fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
      return buffer.toString('utf8').replace(/^�+/u, '');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

const printable = text => String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ');

// 创建运行器。board、ledger、notify 由后端注入；不注入就不写对应位置。
// canStart：修E（R3-5）注入的停机闸门，返回 false 或抛错都不起工人；不传等于不设闸（只给旧调用方兼容）。
export function createRunner({ config, board, ledger, notify, now = Date.now, logger = console, canStart }) {
  const runs = new Map();
  const locks = path.join(config.runDir, '.workdir-locks');
  let timer;
  let chain = Promise.resolve();
  const serial = fn => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  const lockPath = dir => path.join(locks, sha256(dir).slice(0, 32));
  // 一键全停闸门；闸门本身出错也按停着。
  const halted = () => {
    if (typeof canStart !== 'function') return false;
    try {
      return canStart() !== true;
    } catch {
      return true;
    }
  };
  const haltedError = () => Object.assign(new Error('已一键全停'), { code: 'PANIC_STOPPED' });
  const haltedResult = () => ({ ok: false, code: 'PANIC_STOPPED',
    reasons: [{ code: 'PANIC_STOPPED', message: '已一键全停，没有启动' }] });
  const actorOf = state => ({ name: state.worker, type: 'external' });
  const say = event => {
    try {
      notify?.({ source: 'dispatch', ...event });
    } catch {
      logger.error?.('HUB_DISPATCH_NOTIFY_FAILURE');
    }
  };
  const save = state => writeAtomic(path.join(state.dir, 'state.json'), JSON.stringify(state, null, 1) + '\n');
  const view = s => ({ runId: s.runId, ticket: s.ticket, bot: s.bot, worker: s.worker, model: s.model,
    workdir: s.workdir, status: s.status, timedOut: s.timedOut === true, startedAt: s.startedAt,
    endedAt: s.endedAt ?? null, exitCode: s.exitCode ?? null, approval: s.approval, changed: s.changed?.length ?? null,
    pid: s.pid ?? null });
  const releaseLock = state => {
    try {
      const dir = lockPath(state.workdir);
      if (fs.readFileSync(path.join(dir, 'owner'), 'utf8').trim() === state.runId) fs.rmSync(dir, { recursive: true });
    } catch {
      // 锁已经不在了
    }
  };
  const takeLock = (dir, runId) => {
    fs.mkdirSync(locks, { recursive: true, mode: 0o700 });
    const target = lockPath(dir);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.mkdirSync(target, { mode: 0o700 });
        fs.writeFileSync(path.join(target, 'owner'), runId + '\n', { mode: 0o600 });
        return true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner = '';
        try {
          owner = fs.readFileSync(path.join(target, 'owner'), 'utf8').trim();
        } catch {
          // 刚建好还没写 owner，当作被占用
        }
        if (owner === runId) return true;
        const live = runs.get(owner);
        if (!owner || (live && ACTIVE.includes(live.status))) return false;
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
    return false;
  };

  // 现读工单再跑第二、三道闸（出确认卡前和真正启动前各一次，两次都现读，不信调用方递来的工单）。
  async function inspect({ ticketId, bot, readExternal, rosterNames = [] }) {
    let ticket;
    try {
      ticket = await board.get(ticketId);
    } catch (error) {
      const code = error?.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BOARD_UNAVAILABLE';
      return { ok: false, code, reasons: [{ code, message: code === 'NOT_FOUND' ? '看板上没有这张工单' : '看板暂时读不了' }] };
    }
    const inspected = inspectDispatch({ ticket, bot, config, readExternal, rosterNames });
    return inspected.ok ? { ...inspected, ticket } : inspected;
  }

  // 运行器自己再跑一遍第二、三道闸；第一道闸（确认卡或放权）要有凭据才放行。
  async function start({ ticketId, bot, sessionId = null, readExternal, approval, expectSha, expectText,
    rosterNames = [] }) {
    const valid = isObject(approval) && ['card', 'grant'].includes(approval.by) &&
      typeof approval.id === 'string' && approval.id;
    if (!valid) {
      return { ok: false, code: 'NO_APPROVAL', reasons: [{ code: 'NO_APPROVAL', message: '没有确认卡或放权凭据，不放行' }] };
    }
    // 同一张工单已经在跑：只告诉他进展，不再起第二个（此时工单已被领走，状态检查不适用）。
    const running = [...runs.values()].find(s => s.ticket === ticketId && ACTIVE.includes(s.status));
    if (running && running.bot === bot) return { ok: true, existing: true, run: view(running) };
    const inspected = await inspect({ ticketId, bot, readExternal, rosterNames });
    if (!inspected.ok) return inspected;
    const ticket = inspected.ticket;
    const { spec } = inspected;
    if (expectText && textDigest(renderCardText(spec)) !== expectText) {
      logger?.error?.('HUB_DISPATCH_FULLTEXT_CHANGED');
      return { ok: false, code: 'CHANGED', reasons: [{ code: 'CHANGED', message: '任务书全文已改变，请重新出卡' }] };
    }
    if (expectSha && expectSha !== spec.specSha) {
      return { ok: false, code: 'CHANGED', reasons: [{ code: 'CHANGED', message: '批准之后工单内容变了，请重新出卡' }] };
    }
    return serial(async () => {
      for (const s of runs.values()) {
        if (s.ticket === spec.ticketId && ACTIVE.includes(s.status)) return { ok: true, existing: true, run: view(s) };
      }
      const runId = 'D-' + new Date(now()).toISOString().replace(/\D/gu, '').slice(0, 14) + '-' +
        randomBytes(2).toString('hex');
      if (halted()) {
        return haltedResult();
      }
      if (spec.createWorkdir) fs.mkdirSync(spec.workdir, { recursive: true, mode: 0o700 });
      if (!takeLock(spec.workdir, runId)) {
        return { ok: false, code: 'BUSY', reasons: [{ code: 'BUSY', message: '这个工作目录里已经有一张在跑' }] };
      }
      const dir = path.join(config.runDir, runId);
      const state = { v: 1, runId, dir, ticket: spec.ticketId, bot, sessionId, worker: spec.worker, model: spec.model,
        workdir: spec.workdir, briefSha: spec.briefSha, approval: { by: approval.by, id: approval.id },
        startedAt: now(), timeoutMs: config.timeoutMs, status: 'running', timedOut: false, pid: null };
      let claimed = false;
      try {
        const worker = config.workers[spec.worker];
        // 上锁之后、起进程之前再核一次真实路径（防止检查之后目录被换成指到别处的符号链接）。
        if (resolveWorkdir(ticket, config).dir !== spec.workdir) throw new Error('工作目录在检查之后变了');
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(dir, 'brief.md'), spec.brief + '\n', { mode: 0o600 });
        const before = scanTree(spec.workdir, config.maxScanEntries);
        writeAtomic(path.join(dir, 'manifest-before.json'), JSON.stringify(before));
        const vars = { model: spec.model, workdir: spec.workdir, brief_file: path.join(dir, 'brief.md'),
          result_file: path.join(dir, 'result.txt') };
        const argv = worker.argv.map(a => a.replace(/\{([a-z_]+)\}/gu, (_m, k) => vars[k]));
        const env = Object.fromEntries(config.envPass.filter(k => process.env[k] !== undefined)
          .map(k => [k, process.env[k]]));
        writeAtomic(path.join(dir, 'spec.json'), JSON.stringify({ argv, cwd: spec.workdir, env, stdin: worker.stdin,
          heartbeatMs: config.heartbeatMs }));
        if (halted()) throw haltedError();
        if (ticket.state === 'queued') {
          await board.claim(actorOf(state), spec.ticketId);
          claimed = true;
        }
        // 起工人前最后再看一次停机标记。
        if (halted()) throw haltedError();
        const wrapper = spawn(process.execPath, [SELF, '--wrap', dir], { cwd: spec.workdir, detached: true,
          stdio: 'ignore', env, shell: false });
        wrapper.on('error', () => logger.error?.('HUB_DISPATCH_WRAPPER_ERROR'));
        if (!wrapper.pid) throw new Error('壳没起来');
        wrapper.unref();
        state.pid = wrapper.pid;
        writeAtomic(path.join(dir, 'pid'), String(wrapper.pid) + '\n');
        runs.set(runId, state);
        save(state);
        try {
          await board?.progress(actorOf(state), spec.ticketId,
            `已外派：${spec.worker}｜模型 ${spec.model}｜运行号 ${runId}｜任务书 sha256 ${spec.briefSha.slice(0, 12)}`);
        } catch {
          logger.error?.('HUB_DISPATCH_BOARD_PROGRESS_FAILURE');
        }
        ensureTimer();
        return { ok: true, existing: false, run: view(state) };
      } catch (error) {
        releaseLock(state);
        runs.delete(runId);
        const stopped = error?.code === 'PANIC_STOPPED';
        if (claimed) {
          const why = stopped ? '已一键全停，外包没有启动' : '外包进程没能启动，没做';
          await board.fail(actorOf(state), spec.ticketId, why).catch(() => {});
        }
        if (stopped) {
          return haltedResult();
        }
        const code = PERMANENT.includes(error?.code) ? 'BOARD_REFUSED' : 'START_FAILED';
        logger.error?.('HUB_DISPATCH_START_FAILURE ' + (error?.code ?? ''));
        return { ok: false, code, reasons: [{ code, message: '没能启动：' + (error?.code ?? '出错了') }] };
      }
    });
  }

  function ensureTimer() {
    if (timer || !config.pollMs) return;
    timer = setInterval(() => {
      collect().catch(() => logger.error?.('HUB_DISPATCH_COLLECT_FAILURE'));
    }, config.pollMs);
    timer.unref?.();
  }

  // 壳还活着吗：进程在，且心跳没断（防止进程号被别的进程复用后误认、误杀）。
  function isAlive(state) {
    let beat = null;
    try {
      beat = fs.statSync(path.join(state.dir, 'beat')).mtimeMs;
    } catch {
      // 还没写过心跳
    }
    return pidAlive(state.pid) && now() - (beat ?? state.startedAt) < config.lostAfterMs;
  }

  // 收一张在跑的：有退出码就收尾，进程没了就标丢失，超了时限只标超时。
  async function settle(state) {
    const exit = readJson(path.join(state.dir, 'exit'));
    if (exit) return finalize(state, exit);
    const t = now();
    if (!isAlive(state)) {
      const late = readJson(path.join(state.dir, 'exit'));
      return finalize(state, late ?? { lost: true, endedAt: t });
    }
    if (state.status === 'running' && t - state.startedAt > state.timeoutMs) {
      state.status = 'timeout';
      state.timedOut = true;
      save(state);
      try {
        await board?.markTimeout(actorOf(state), state.ticket);
      } catch {
        logger.error?.('HUB_DISPATCH_TIMEOUT_MARK_FAILURE');
      }
      say({ kind: 'timeout', ticket: state.ticket, runId: state.runId, worker: state.worker,
        text: `外包工人 ${state.worker} 超过时限还在跑（只标了超时，没有杀）` });
    }
    return view(state);
  }

  async function finalize(state, exit) {
    const ended = exit.endedAt ?? now();
    const wall = Math.max(0, ended - state.startedAt);
    const lost = exit.lost === true;
    const stopped = state.stopRequested === true && !lost && !(exit.code === 0 && !exit.signal);
    const ok = !lost && !stopped && exit.code === 0 && !exit.error;
    if (!state.collected) {
      const before = readJson(path.join(state.dir, 'manifest-before.json')) ?? { entries: {}, truncated: false };
      const after = scanTree(state.workdir, config.maxScanEntries);
      state.changed = diffTrees(before.entries, after.entries);
      state.manifestTruncated = before.truncated || after.truncated;
      const resultFile = path.join(state.dir, 'result.txt');
      let last = tailText(resultFile, config.resultMaxBytes);
      state.resultSource = last ? 'result' : 'log';
      if (!last) last = tailText(path.join(state.dir, 'log'), config.resultMaxBytes);
      state.lastMessage = printable(last).trim();
      state.exitCode = exit.code ?? null;
      state.exitSignal = exit.signal ?? null;
      state.endedAt = ended;
      state.collected = true;
      state.finalStatus = lost ? 'lost' : stopped ? 'stopped' : ok ? 'done' : 'failed';
      save(state);
    }
    const sec = Math.round(wall / 1000);
    const note = state.manifestTruncated ? '（文件清单可能不全）' : '';
    const head = `【外部工人自述，未验证】${state.worker}｜${state.model}｜退出码 ${state.exitCode ?? '无'}` +
      `${state.exitSignal ? '｜信号 ' + state.exitSignal : ''}｜用时 ${sec} 秒｜运行号 ${state.runId}${note}`;
    const maxFiles = config.maxChangedFiles;
    const artifacts = state.changed.slice(0, maxFiles).map(f => f.slice(0, 300));
    const more = state.changed.length > maxFiles ? `；改动文件共 ${state.changed.length} 个，仅列前 ${maxFiles}` : '';
    const cut = text => Buffer.from(text, 'utf8').subarray(0, 1900).toString('utf8').replace(/�+$/u, '');
    const summary = cut(`${head}${more}\n最后一条消息：${state.lastMessage || '（没有）'}`);
    const actor = actorOf(state);
    if (!state.boardDone) {
      try {
        const final = state.finalStatus;
        if (final === 'done') {
          const ticket = await board.get(state.ticket);
          if (ticket.state === 'waiting-timeout') await board.resume(actor, state.ticket);
          await board.report(actor, state.ticket, { summary, artifacts });
        } else if (final === 'lost') {
          await board.markUncertain(actor, state.ticket, cut(`外包进程已不在，也没留下退出码；运行号 ${state.runId}`));
        } else {
          const why = final === 'stopped' ? '被一键全停停掉，没做完' : `外部工人没做成（退出码 ${state.exitCode ?? '无'}）`;
          await board.fail(actor, state.ticket, cut(`${why}｜${head}\n${state.lastMessage.slice(0, 600)}`));
        }
      } catch (error) {
        if (!PERMANENT.includes(error?.code)) {
          logger.error?.('HUB_DISPATCH_BOARD_RETRY');
          return view(state);
        }
        state.boardError = String(error.code);
      }
      state.boardDone = true;
      save(state);
    }
    if (!state.ledgerDone) {
      try {
        await ledger?.record({ kind: 'dispatch', id: 'dispatch:' + state.runId, tsMs: ended, bot: state.bot,
          sessionId: state.sessionId, ticket: state.ticket, worker: state.worker, wallMs: wall,
          exitCode: state.exitCode, tokens: null, parentSessionId: state.sessionId, workerModel: state.model,
          outcome: state.finalStatus });
      } catch {
        logger.error?.('HUB_DISPATCH_LEDGER_FAILURE');
      }
      state.ledgerDone = true;
    }
    state.status = state.finalStatus;
    save(state);
    releaseLock(state);
    say({ kind: state.finalStatus, ticket: state.ticket, runId: state.runId, worker: state.worker,
      text: `外包工人 ${state.worker} 结束：${state.finalStatus}` });
    return view(state);
  }

  // 回收所有在跑的结果；任何时候有人查看都可以调。
  function collect() {
    return serial(async () => {
      const out = [];
      for (const state of [...runs.values()]) {
        if (ACTIVE.includes(state.status)) out.push(await settle(state));
      }
      return out;
    });
  }

  // 启动时调用：读运行目录，认回还在跑的；没收尾的接着收。
  async function recover() {
    let names = [];
    try {
      names = fs.readdirSync(config.runDir).filter(n => /^D-\d{14}-[0-9a-f]{4}$/u.test(n)).sort();
    } catch {
      return [];
    }
    for (const name of names) {
      const state = readJson(path.join(config.runDir, name, 'state.json'));
      if (!state || state.v !== 1 || state.runId !== name) continue;
      state.dir = path.join(config.runDir, name);
      runs.set(name, state);
      if (ACTIVE.includes(state.status)) {
        try {
          state.pid = Number(fs.readFileSync(path.join(state.dir, 'pid'), 'utf8').trim());
        } catch {
          state.pid = null;
        }
        const wasLocked = takeLock(state.workdir, name);
        if (!wasLocked) logger.error?.('HUB_DISPATCH_RECOVER_LOCK_CONFLICT');
      }
    }
    if (locks && fs.existsSync(locks)) {
      for (const lock of fs.readdirSync(locks)) {
        const owner = (() => {
          try {
            return fs.readFileSync(path.join(locks, lock, 'owner'), 'utf8').trim();
          } catch {
            return '';
          }
        })();
        if (!runs.has(owner) || !ACTIVE.includes(runs.get(owner).status)) {
          fs.rmSync(path.join(locks, lock), { recursive: true, force: true });
        }
      }
    }
    if ([...runs.values()].some(s => ACTIVE.includes(s.status))) ensureTimer();
    return collect();
  }

  // 现在还在跑的（含已超时但没结束的）。给「一键全停」用。
  function listRunning() {
    return [...runs.values()].filter(s => ACTIVE.includes(s.status)).map(view);
  }

  // 停掉所有在跑的：向进程组发 SIGTERM，等一会儿，如实回报哪些停了、哪些还活着。不自动 SIGKILL，除非明说。
  async function stopAll({ kill = false } = {}) {
    const targets = [...runs.values()].filter(s => ACTIVE.includes(s.status));
    const result = { stopped: [], stillRunning: [], errors: [] };
    for (const state of targets) {
      state.stopRequested = true;
      save(state);
      if (!isAlive(state)) continue;
      try {
        process.kill(-state.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') {
          result.errors.push({ runId: state.runId, error: String(error.code ?? error.message) });
        }
      }
    }
    const deadline = now() + config.stopWaitMs;
    for (;;) {
      const alive = targets.filter(s => isAlive(s) && !fs.existsSync(path.join(s.dir, 'exit')));
      if (!alive.length || now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (kill) {
      for (const state of targets) {
        if (isAlive(state) && !fs.existsSync(path.join(state.dir, 'exit'))) {
          try {
            process.kill(-state.pid, 'SIGKILL');
          } catch {
            // 已经没了
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await collect();
    for (const state of targets) {
      (isAlive(state) && ACTIVE.includes(state.status) ? result.stillRunning : result.stopped).push(state.runId);
    }
    return result;
  }

  return {
    start, inspect, collect, recover, listRunning, stopAll,
    list: () => [...runs.values()].map(view),
    get: runId => (runs.has(runId) ? view(runs.get(runId)) : null),
    forTicket: ticket => [...runs.values()].filter(s => s.ticket === ticket).map(view),
    // 只停定时回收，不动已经起来的工人（后端重启后工人照跑）。
    dispose() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}

// 守护壳：独立于后端进程，起真正的工人（参数数组、不经 shell），落退出码和心跳。
function wrapperMain(runDir) {
  const spec = readJson(path.join(runDir, 'spec.json'));
  if (!spec || !Array.isArray(spec.argv) || !spec.argv.length) process.exit(2);
  const logFd = fs.openSync(path.join(runDir, 'log'), 'a', 0o600);
  const stdin = spec.stdin === 'brief' ? fs.openSync(path.join(runDir, 'brief.md'), 'r') : 'ignore';
  let done = false;
  const finish = info => {
    if (done) return;
    done = true;
    writeAtomic(path.join(runDir, 'exit'), JSON.stringify({ ...info, endedAt: Date.now() }));
    process.exit(0);
  };
  process.on('SIGTERM', () => {});
  process.on('SIGHUP', () => {});
  const beat = () => {
    try {
      fs.writeFileSync(path.join(runDir, 'beat'), String(Date.now()));
    } catch {
      // 写不了心跳不影响工人
    }
  };
  beat();
  setInterval(beat, spec.heartbeatMs || 5000);
  let child;
  try {
    child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: spec.env, stdio: [stdin, logFd, logFd],
      shell: false });
  } catch (error) {
    finish({ code: null, signal: null, error: 'spawn_failed:' + (error.code ?? '') });
    return;
  }
  child.on('error', error => finish({ code: null, signal: null, error: 'spawn_failed:' + (error.code ?? '') }));
  child.on('exit', (code, signal) => finish({ code, signal }));
  if (child.pid) writeAtomic(path.join(runDir, 'child.pid'), String(child.pid) + '\n');
}

if (process.argv[2] === '--wrap' && process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF)) {
  wrapperMain(process.argv[3]);
}
