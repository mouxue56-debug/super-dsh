// 全家共用的权限档位。插件每次判定现读这个小文件；读不到或内容坏了按「改动前问」。
// 全开档的四类确认是固定行为。只有主人交代的回合会扩大普通工具范围。
import fs from 'node:fs';
import path from 'node:path';
import { commandShape, findExecs } from './permission-shape.mjs';

export const MODES = Object.freeze(['open', 'ask', 'readonly']);
export const MODE_FILE = 'permission-mode.json';
const MODE_TEXT = /^\{"v":1,"mode":"(open|ask|readonly)"\}\n?$/u;
const READ_TOOLS = new Set(['read', 'list_files', 'bot_status', 'bot_list', 'skill']);
const WRITE_TOOLS = new Set(['write', 'edit', 'ticket_create', 'ticket_update', 'ticket_move']);
const MGMT_TOOLS = new Set(['bot_create', 'bot_update', 'bot_set_status']);
const PAY_PROGRAMS = new Set(['codex', 'grok', 'opencode']);
const SEND_PROGRAMS = new Set(['scp', 'ssh', 'sendmail', 'mail', 'mutt', 'msmtp', 'ssmtp']);
const ADMIN_PROGRAMS = new Set([
  'sudo', 'su', 'doas', 'launchctl', 'systemctl', 'service', 'shutdown', 'reboot', 'halt',
  'diskutil', 'scutil', 'networksetup', 'pmset', 'csrutil', 'spctl', 'security', 'dscl',
  'defaults', 'crontab', 'kubectl', 'terraform', 'helm', 'ansible-playbook', 'kamal',
  'wrangler', 'vercel', 'fly', 'flyctl', 'docker', 'podman',
]);
const PAY_WORDS = ['付款', '支付', '充值', '扣费', '收银台', '积分'];
const fold = (value) => String(value).normalize('NFKC').normalize('NFC').toLowerCase();

export function modeFilePath(hubHome) {
  return path.join(hubHome, 'config', MODE_FILE);
}

function warnMode(message) {
  console.warn('权限档位不可信，按改动前问：' + message);
}

// 只认紧凑的一行。打开后用同一个文件描述符核对：普通文件、当前用户、不宽于 0600。
// 多键、换序、符号链接、太大、属主或权限不对，都按改动前问。后两种另记一条告警。
export function readPermissionMode(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) {
      warnMode('不是普通文件');
      return { mode: 'ask', source: 'corrupt' };
    }
    if (typeof process.getuid !== 'function' || st.uid !== process.getuid()) {
      warnMode('不属于当前用户');
      return { mode: 'ask', source: 'insecure' };
    }
    if ((st.mode & 0o777 & ~0o600) !== 0) {
      warnMode('权限宽于 0600');
      return { mode: 'ask', source: 'insecure' };
    }
    if (st.size > 4096) return { mode: 'ask', source: 'corrupt' };
    const text = fs.readFileSync(fd, 'utf8');
    const matched = MODE_TEXT.exec(text);
    if (!matched) return { mode: 'ask', source: 'corrupt' };
    return { mode: matched[1], source: 'file' };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      const link = error?.code === 'ELOOP';
      if (link) warnMode('不是普通文件');
    }
    return { mode: 'ask', source: error?.code === 'ENOENT' ? 'missing' : 'corrupt' };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* 描述符已关 */ }
    }
  }
}

export function writePermissionMode(file, mode) {
  if (!MODES.includes(mode)) throw new Error('档位无效');
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('档位文件不能是符号链接');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const tmp = path.join(dir, `.${MODE_FILE}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `{"v":1,"mode":"${mode}"}\n`, { mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* 临时文件清不掉不影响拒绝 */ }
    throw error;
  }
}

const DELETE_PROGRAMS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash']);
const PAY_TOKENS = new Set(['付款', '支付', '充值', '扣费', '收银台', '积分', 'payment', 'checkout', 'stripe', 'billing']);
const ADMIN_TOKENS = new Set(['线上', 'deploy', 'production', '--prod']);
const CREDENTIAL = new RegExp(
  '(?:^|/)(?:\\.ssh|\\.secrets|\\.env)(?:/|$)|id_rsa|id_ed25519|credentials|auth\\.json|\\.pem(?:$|[^a-z0-9_])',
  'iu');

function within(child, parent) {
  const left = path.resolve(child);
  const right = path.resolve(parent);
  return left === right || left.startsWith(right + path.sep);
}

function expandShape(shape, out) {
  if (!shape) return;
  out.push(shape);
  if (shape.inner) expandShape(shape.inner, out);
  if (shape.program === 'find') {
    for (const cmd of findExecs(shape.words)) {
      if (!cmd.length) {
        out.push({ program: '', uncertain: true, opaque: false, words: [] });
        continue;
      }
      expandShape(commandShape(cmd[0], cmd.slice(1)), out);
    }
  }
}

function shapesOf(decision, command) {
  const segments = decision.cmd?.segments;
  if (Array.isArray(segments) && segments.length && segments.every((item) => item && item.program)) {
    const out = [];
    for (const segment of segments) expandShape(segment, out);
    return out;
  }
  if (!command) return [];
  return [{ program: '', uncertain: true, opaque: false, words: [], options: [], operands: [] }];
}

function fileStat(target) {
  if (typeof target !== 'string' || !target) return null;
  try {
    const st = fs.lstatSync(target);
    return { symlink: st.isSymbolicLink(), file: st.isFile(), dir: st.isDirectory() };
  } catch {
    return null;
  }
}

function hasBackup(target) {
  const dir = path.dirname(target);
  const base = path.basename(target);
  for (const name of [`${base}.bak`, `${base}~`, `${base}.orig`]) {
    try {
      if (fs.lstatSync(path.join(dir, name)).isFile()) return true;
    } catch { /* 没有这份备份 */ }
  }
  return false;
}

function userPath(args, cwd) {
  const raw = args?.file_path ?? args?.path;
  if (typeof raw !== 'string' || !raw || raw.includes('\0')) return null;
  if (path.isAbsolute(raw)) return raw;
  return cwd ? path.join(cwd, raw) : raw;
}

function outsideWorkspace(area) {
  return !['own', 'shared', 'group_own'].includes(area);
}

const PAY_HIT = { id: 'pay', reason: '这会付款或消耗额外积分，要先确认' };
const PUBLISH_HIT = { id: 'publish', reason: '这是对外发送或公开发布，要先确认' };
const DELETE_HIT = { id: 'destroy', reason: '这是删除，要先确认' };
const OVERWRITE_HIT = { id: 'destroy', reason: '会覆盖没有备份的已有文件，要先确认' };
const LINK_HIT = { id: 'destroy', reason: '写到符号链接，要先确认' };
const ADMIN_HIT = { id: 'admin', reason: '这是动线上、改系统、扩大授权或读凭据，要先确认' };
const OPAQUE_HIT = { id: 'destroy', reason: '看不清会不会改已有文件，要先确认' };
const UNCLEAR_HIT = { id: 'admin', reason: '看不清这条命令的结构，要先确认' };

function optionNamed(shape, names) {
  return (shape.options ?? []).some((option) => names.includes(option.name));
}

function tokenHit(shape) {
  const bag = [shape.program, shape.sub, ...(shape.operands ?? []), ...(shape.words ?? [])];
  for (const option of shape.options ?? []) bag.push(option.name, option.value);
  for (const raw of bag) {
    const token = fold(raw ?? '');
    if (!token) continue;
    if (PAY_TOKENS.has(token) || PAY_WORDS.some((word) => token === fold(word))) return PAY_HIT;
    if (ADMIN_TOKENS.has(token)) return ADMIN_HIT;
    if (CREDENTIAL.test(token)) return ADMIN_HIT;
    if (DELETE_PROGRAMS.has(token) && token !== shape.program) return DELETE_HIT;
  }
  return null;
}

function landingPaths(shape, cwd) {
  const program = shape.program;
  if (!['cp', 'mv', 'ln', 'install', 'rsync'].includes(program)) return null;
  if (shape.remote) return null;
  if (shape.uncertain) return { uncertain: true, paths: [] };
  const targetOpt = (shape.options ?? []).find((option) =>
    option.name === '-t' || option.name === '--target-directory');
  const noTarget = optionNamed(shape, ['-T', '--no-target-directory']);
  const operands = shape.operands ?? [];
  let target = targetOpt?.value ?? null;
  let sources = operands;
  if (targetOpt) sources = operands;
  else if (operands.length === 0) return { uncertain: true, paths: [] };
  else {
    target = operands[operands.length - 1];
    sources = operands.slice(0, -1);
  }
  if (!target || sources.length === 0) return { uncertain: true, paths: [] };
  if ([target, ...sources].some((item) => /[$*?[\]]/u.test(item))) return { uncertain: true, paths: [] };
  const abs = (raw) => path.resolve(cwd || '.', raw);
  const dest = abs(target);
  const destStat = fileStat(dest);
  if (destStat?.symlink) return { uncertain: false, paths: [dest] };
  const asDir = destStat?.dir === true || /[\\/]$/u.test(target);
  if (/[\\/]$/u.test(target) && !destStat?.dir) return { uncertain: true, paths: [] };
  if (noTarget) {
    if (sources.length !== 1) return { uncertain: true, paths: [] };
    return { uncertain: false, paths: [dest] };
  }
  if (asDir) {
    if (!destStat?.dir) return { uncertain: true, paths: [] };
    return { uncertain: false, paths: sources.map((item) => path.join(dest, path.basename(abs(item)))) };
  }
  if (sources.length !== 1) return { uncertain: true, paths: [] };
  return { uncertain: false, paths: [dest] };
}

function pathHit(target) {
  const st = fileStat(target);
  if (st?.symlink) return LINK_HIT;
  if (st?.file && !hasBackup(target)) return OVERWRITE_HIT;
  return null;
}

function shapeHit(shape, cwd) {
  if (!shape || shape.uncertain) return UNCLEAR_HIT;
  const program = shape.program;
  if (!program) return UNCLEAR_HIT;
  if (PAY_PROGRAMS.has(program)) return PAY_HIT;
  if (DELETE_PROGRAMS.has(program)) return DELETE_HIT;
  if (program === 'find' && (shape.words ?? []).includes('-delete')) return DELETE_HIT;
  if (program === 'git' && (shape.sub === 'clean' || shape.sub === 'rm')) return DELETE_HIT;
  if (program === 'git' && shape.sub === 'push') return PUBLISH_HIT;
  if (program === 'git' && optionNamed(shape, ['-c', '--config-env', '--exec-path'])) return ADMIN_HIT;
  if (program === 'rsync' && optionNamed(shape, ['--delete'])) return DELETE_HIT;
  if (shape.sends || shape.remote) return PUBLISH_HIT;
  if (SEND_PROGRAMS.has(program) || program === 'nc' || program === 'telnet') return PUBLISH_HIT;
  if ((program === 'npm' || program === 'pnpm' || program === 'yarn') && shape.sub === 'publish') {
    return PUBLISH_HIT;
  }
  if (ADMIN_PROGRAMS.has(program)) return ADMIN_HIT;
  if (program === 'alias') return { id: 'admin', reason: '别名会改后面的命令，要先确认' };
  const landing = landingPaths(shape, cwd);
  if (landing?.uncertain) return OVERWRITE_HIT;
  if (landing) {
    for (const target of landing.paths) {
      const hit = pathHit(target);
      if (hit) return hit;
    }
  }
  if (program === 'dd') {
    const of = (shape.words ?? []).find((word) => word.startsWith('of='));
    if (!of || of.length < 4) return OVERWRITE_HIT;
    const hit = pathHit(path.resolve(cwd || '.', of.slice(3)));
    if (hit) return hit;
  }
  return tokenHit(shape);
}

const embeddedDelete = /(?:\b(?:rm|rmdir|unlink|shred)\s|\b(?:unlink|rm|rmdir)(?:Sync)?\s*\()/u;
const embeddedWrites = [
  /\bwriteFile(?:Sync)?\s*\(\s*(['"])([^'"]+)\1/gu,
  /\bopen\s*\(\s*(['"])([^'"]+)\1\s*,\s*['"]w/gu,
  /(?:^|\s)>\s*(?:['"])?([^\s'">&]+)\b/gmu,
];
const embeddedAdmin = /\b(?:chmod|chown|launchctl|systemctl|sudo|killall|pkill)\s|\b(?:chmod|chown|kill)(?:Sync)?\s*\(/u;
const embeddedSend = /\b(?:sendmail|scp|ssh)\s|\b(?:curl|wget)\b[^\n]*(?:--data|--upload-file| -[dFT])|\bgit\s+push\b/u;
const sensitiveFile = /(?:^|\/)(?:config|runtime|hub-data)(?:\/|$)|(?:^|\/)[^/]*(?:policy|permission|protected-files|tokens?|secrets?|credentials?|grants?)[^/]*$/iu;
export const sensitiveEditPath = target => sensitiveFile.test(target) ||
  /(?:^|\/)(?:AGENTS\.md|\.env(?:\.[^/]*)?|[^/]+\.key)$/iu.test(target);

function scriptText(shape,cwd,canRead) {
  const first=shape.words?.[0];
  if (shape.inline || (shape.words ?? []).some(word=>/^-(?:c|e)$|^--eval$/u.test(word))) {
    return (shape.words ?? []).join(' ');
  }
  const candidate = shape.scriptPath ?? (shape.opaque && first && !first.startsWith('-') ? first : '');
  if (!candidate || !cwd) return '';
  const target=path.resolve(cwd,candidate);
  try {
    const physical=fs.realpathSync.native(target);
    if (!canRead(physical)) return '';
    const fd=fs.openSync(physical,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try {
      if (!fs.fstatSync(fd).isFile()) return '';
      const data=Buffer.alloc(65536);
      return data.subarray(0,fs.readSync(fd,data,0,data.length,0)).toString();
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

function opaqueRisk(shape,cwd,canRead,{includeWrites=false}={}) {
  const text=scriptText(shape,cwd,canRead);
  if (embeddedDelete.test(text)) return DELETE_HIT;
  if (embeddedAdmin.test(text)) return ADMIN_HIT;
  if (embeddedSend.test(text)) return PUBLISH_HIT;
  if (includeWrites && embeddedWrites.some(pattern=>[...text.matchAll(pattern)].some(match=>{
    const target=path.resolve(cwd,match[2] ?? match[1]);
    return sensitiveEditPath(target) || fileStat(target)?.file;
  }))) return OVERWRITE_HIT;
  return null;
}

function operationTargets(shape,workdir,hit) {
  const words=shape.operands ?? [];
  if (hit===OVERWRITE_HIT || hit===LINK_HIT) {
    const outputs=landingPaths(shape,workdir)?.paths ?? [];
    if (outputs.length) return outputs;
  }
  if (hit.id==='destroy' && DELETE_PROGRAMS.has(shape.program)) {
    return words.flatMap(word=>{
      if (/[*?\[]/u.test(word)) {
        const matches=fs.globSync(word,{cwd:workdir}).map(item=>path.resolve(workdir,item));
        if (matches.length) return matches;
      }
      return [path.resolve(workdir,word)];
    });
  }
  if (shape.program==='find' && (shape.words ?? []).includes('-delete')) {
    return [path.resolve(workdir,words[0] ?? '.')];
  }
  return words.filter(word=>typeof word==='string' && word.trim()).slice(0,25);
}

export function creatorRisk({tool,args,decision,cwd,tainted=false,owner=true}={}) {
  const cmd=decision.cmd ?? {};
  const workdir=cmd.workdir ?? cwd;
  const writes=cmd.writePaths ?? [];
  const risks=[];
  const record=(hit,targets=[],extra=false)=>risks.push({hit,targets,extra});
  if (tool==='bash') {
    const shapes=shapesOf(decision,args.command);
    const paidEndpoint=shapes.some(shape=>shape.sends &&
      shape.operands.some(value=>/\b(?:payments?|checkout|billing|purchases?)\b/iu.test(value)));
    if (paidEndpoint) record(PAY_HIT,shapes.filter(shape=>shape.sends).flatMap(shape=>shape.operands),true);
    for (const shape of shapes) {
      const hit=shapeHit(shape,workdir);
      const found=hit!==UNCLEAR_HIT ? hit : null;
      if (found) record(found,operationTargets(shape,workdir,found),
        found===OVERWRITE_HIT || found===LINK_HIT || found.id==='admin' &&
        /^(?:chmod|chown|chgrp|sudo|su|doas|security|dscl)$/u.test(shape.program)
        || found.id==='destroy' &&
        (optionNamed(shape,['-r','-R','--recursive']) || (shape.words ?? []).some(v=>/^-[a-z]*r/iu.test(v)))
        || found.id==='publish' && (/(?:群发|mailing-list|--all|--recursive)/iu.test(args.command)
          || ['mail','sendmail','mutt','msmtp','ssmtp'].includes(shape.program) && shape.operands.length>1));
      const opaque=opaqueRisk(shape,workdir,target=>within(target,workdir) && !sensitiveEditPath(target),
        {includeWrites:true});
      if (opaque) record(opaque,[],opaque!==PUBLISH_HIT);
      if (/^(?:chmod|chown|chgrp|chflags)$/u.test(shape.program)) record(ADMIN_HIT,shape.operands,true);
      if (/^(?:kill|killall|pkill)$/u.test(shape.program)) record(ADMIN_HIT,shape.operands);
      if (shape.program==='truncate') record(OVERWRITE_HIT,writes.filter(file=>fileStat(file)?.file),true);
      if (shape.program==='git' && (shape.sub==='restore' || shape.sub==='reset' &&
        optionNamed(shape,['--hard']))) record(DELETE_HIT,shape.operands,true);
    }
    for (const target of [...new Set([...writes,...(cmd.sensitiveWrites ?? [])])]) {
      if (sensitiveEditPath(target) || cmd.sensitiveWrites?.includes(target)) record(ADMIN_HIT,[target],true);
      if (fileStat(target)?.symlink) record(LINK_HIT,[target],true);
    }
    if (cmd.level==='deny' && !risks.length) record(ADMIN_HIT,[workdir],true);
  } else if (MGMT_TOOLS.has(tool)) {
    record(ADMIN_HIT,[decision.management?.target ?? decision.path],true);
  } else if (['board_handoff','board_answer'].includes(tool)) {
    record(PUBLISH_HIT,[args.to ?? args.id ?? decision.path],false);
  } else if (WRITE_TOOLS.has(tool) && decision.path && decision.area!=='self_source'
    && (sensitiveEditPath(decision.path) || decision.controlled)) {
    record(ADMIN_HIT,[decision.path],true);
  }
  if (!risks.length) return null;
  const [{hit}]=risks;
  const targets=[...new Set(risks.flatMap(item=>item.targets ?? []).filter(Boolean))];
  const safeTargets=(targets.length ? targets : [tool==='bash' ? args.command : decision.path])
    .map(value=>String(value).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu,' ').slice(0,500));
  const multiple=hit.id==='destroy' && targets.length>1;
  const confirmationTotal=hit.id==='pay' || risks.some(item=>item.extra) || multiple || tainted ? 2 : 1;
  return {reason:hit.reason,confirmationTotal,targets:safeTargets,targetCount:safeTargets.length,
    network:risks.some(item=>['publish','pay'].includes(item.hit.id)),
    consequence:hit.reason.replace(/，要先确认$/u,''),
    rollback:hit.id==='destroy' || hit.id==='publish' || hit.id==='pay'
      ? '这一步造成的外部影响或物理删除可能无法撤回。' : '能否撤回取决于目标，请核对操作和现有备份。',
    ...(owner && !tainted && risks.every(item=>item.hit.id===hit.id) ? {category:hit.id} : {})};
}

function sandboxHoldsOpaque(decision, hubHome) {
  if (decision.sandboxActive !== true) return false;
  if (decision.cmd?.caps?.network === true) return false;
  const own = decision.roots?.own;
  const writable = decision.roots?.writable;
  if (!own || !Array.isArray(writable) || !writable.length || !hubHome) return false;
  const shared = path.join(hubHome, 'shared');
  return writable.every((root) => within(root, own) || within(root, shared));
}

// 卡片文字过四类（付款、对外发送、删除找不回的东西、动线上服务）——与上面命令判定用同一组命中结果
// （PAY_HIT 等，id 与原因一样），只是对象换成卡片的标题和说明。命中词越宽越保守：宁可多问主人一次。
// 【AI建议】
const TEXT_WORDS = [
  [PAY_HIT, [...PAY_TOKENS, '转账', '汇款', '收款', '购买', '下单', '订阅费']],
  [PUBLISH_HIT, ['对外', '公众号', '发布', '发送', '群发', '发邮件', '发给', '发到', '推送', '转发', '发微博', '发推',
    '公开', 'publish', 'send to', 'tweet', 'email', 'post to']],
  [DELETE_HIT, ['删除', '删掉', '清空', '销毁', '格式化', '抹掉', '永久', 'rm -rf', 'drop table', 'delete']],
  [ADMIN_HIT, [...ADMIN_TOKENS, '线上', '生产环境', '部署', '上线', '重启服务', '密钥', '令牌', '凭据', '密码',
    'api key', 'apikey', 'token', 'credential']],
];
// 返回命中的四类之一 {id, reason}，没命中返回 null。
export function sensitiveText(text) {
  const folded = fold(typeof text === 'string' ? text : '');
  if (!folded) return null;
  for (const [hit, words] of TEXT_WORDS) {
    if (words.some((word) => folded.includes(fold(word)))) return hit;
  }
  return null;
}

// 四类只看分类器给出的程序、子命令、选项和路径。认不出的解释器与脚本，
// 沙箱开着、禁联网、且只写自己的工作区和共享区时，全开可以放行。
export function sensitiveKind({ tool, args = {}, decision = {}, cwd, hubHome } = {}) {
  if (MGMT_TOOLS.has(tool)) return { id: 'admin', reason: '改助理名册或授权，要先确认' };
  const command = tool === 'bash' && typeof args.command === 'string' ? args.command : '';
  if (command) {
    const workdir = decision.cmd?.workdir || cwd;
    const shapes = shapesOf(decision, command);
    if (!shapes.length) return UNCLEAR_HIT;
    let opaque = false;
    for (const shape of shapes) {
      if (shape.opaque) opaque = true;
      const hit = shapeHit(shape, workdir);
      if (hit) return hit;
      const risk=opaqueRisk(shape,workdir,target=>within(target,decision.roots?.own ?? workdir)
        && !sensitiveEditPath(target),{includeWrites:true});
      if (risk) return risk;
    }
    const writes = decision.cmd?.writePaths ?? [];
    for (const target of writes) {
      const hit = pathHit(target);
      if (hit) return hit;
    }
    if (['tee', 'cp', 'mv', 'ln', 'install', 'dd', 'truncate', 'touch'].some((name) =>
      shapes.some((shape) => shape.program === name))
      && symlinkArg(command, workdir)) {
      return LINK_HIT;
    }
    const notes = decision.cmd?.notes ?? [];
    const why = `${decision.cmd?.reason ?? ''}\n${notes.join('\n')}`;
    if (notes.some((note) => typeof note === 'string' && note.includes('here-doc'))) return OPAQUE_HIT;
    if (opaque) {
      // 沙箱守住时，解释器和自有脚本按裁定放行。脚本不在自己目录、读不到，仍出卡。
      const outside = /自己目录|无法读取脚本|没有明确的自有脚本|不属于已知系统程序/.test(why);
      if (!sandboxHoldsOpaque(decision, hubHome) || outside) return OPAQUE_HIT;
    } else if (/危险|删除/.test(why) || /凭据|提权|系统保护/.test(why)) {
      return ADMIN_HIT;
    }
  }
  if (WRITE_TOOLS.has(tool)) {
    const asked = userPath(args, cwd);
    const askedStat = fileStat(asked);
    if (askedStat?.symlink || fileStat(decision.path)?.symlink) {
      return { id: 'destroy', reason: '写到符号链接，要先确认' };
    }
    if (outsideWorkspace(decision.area)) {
      return { id: 'destroy', reason: '写到助理工作区和共享区以外，要先确认' };
    }
    const target = decision.path || asked;
    const st = fileStat(target);
    if (st?.file && !hasBackup(target)) return { id: 'destroy', reason: '会覆盖没有备份的已有文件，要先确认' };
  }
  if (tool === 'read' || tool === 'list_files') {
    const target = fold(decision.path || userPath(args, cwd) || '');
    if (/\/\.ssh(?:\/|$)|\/\.secrets(?:\/|$)|id_rsa|id_ed25519|\/\.env(?:\.|$)|credentials|auth\.json/.test(target)) {
      return { id: 'admin', reason: '这是读密钥或凭据，要先确认' };
    }
  }
  return null;
}

function symlinkArg(command, workdir) {
  if (!workdir) return false;
  for (const token of command.split(/\s+/u)) {
    if (!token || token.startsWith('-') || token.includes('\0')) continue;
    const target = path.isAbsolute(token) ? token : path.join(workdir, token);
    if (fileStat(target)?.symlink) return true;
  }
  return false;
}

function touchesModeFile(decision, args, hubHome) {
  if (!hubHome) return false;
  const file = path.resolve(modeFilePath(hubHome));
  const candidates = [decision?.path, args?.file_path, args?.path, ...(decision?.cmd?.writePaths ?? [])];
  return candidates.some(item => {
    if (typeof item !== 'string' || !item) return false;
    const resolved = path.resolve(item);
    return resolved === file || resolved.startsWith(file + path.sep);
  });
}

function readonlyDecision(decision, tool) {
  if (decision.level === 'L0' && READ_TOOLS.has(tool)) return decision;
  if (tool === 'bash') {
    const cmd = decision.cmd ?? {};
    const network = cmd.caps?.network === true;
    const fileWrite = (cmd.writePaths?.length ?? 0) > 0 || cmd.writeUnknown === true;
    if (network) {
      return { ...decision, level: 'L4', reason: '只读档只许读和回答，这次是联网' };
    }
    if (fileWrite) return { ...decision, level: 'L4', reason: '只读档只许读和回答，这次是写' };
    if (cmd.level === 'run' && cmd.sideEffect !== true) return decision;
    const why = cmd.level === 'run' ? '写' : '执行';
    return { ...decision, level: 'L4', reason: `只读档只许读和回答，这次是${why}` };
  }
  if (decision.level === 'L0') return decision;
  const why = WRITE_TOOLS.has(tool) || MGMT_TOOLS.has(tool) ? '写' : '执行';
  return { ...decision, level: 'L4', reason: `只读档只许读和回答，这次是${why}` };
}

// ask 原样返回（同一对象）。L4 不放宽。全停由入口在调用前处理。
export function creatorMode(_config, mode) {
  return mode === 'open';
}

export function applyPermissionMode(decision, ctx = {}) {
  if (!decision || decision.level === 'L4') return decision;
  const mode = ctx.mode === 'open' || ctx.mode === 'readonly' ? ctx.mode : 'ask';
  if (mode === 'ask') return decision;
  if (touchesModeFile(decision, ctx.args, ctx.hubHome) && !ctx.ownerTurn) {
    return { ...decision, level: 'L4', reason: '档位只能由主人在设置里改' };
  }
  if (mode === 'readonly') return readonlyDecision(decision, ctx.tool);
  if (ctx.creatorActive) {
    const risk=ctx.risk;
    if (risk) return {...decision,level:'L3',reason:risk.reason,modeHold:risk.reason,risk};
    return decision;
  }
  const hit = sensitiveKind({
    tool: ctx.tool, args: ctx.args, decision, cwd: ctx.cwd, hubHome: ctx.hubHome,
  });
  if (hit) return { ...decision, level: 'L3', reason: hit.reason, modeHold: hit.reason };
  if (decision.cmd?.tainted === true) return decision;
  if (decision.level === 'L3' && decision.area === 'plugin') return decision;
  if (decision.level === 'L3') return { ...decision, level: 'L1' };
  return decision;
}
