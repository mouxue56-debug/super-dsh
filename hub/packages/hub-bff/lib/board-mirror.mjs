import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSecrets, oneLine } from './handoff.mjs';
import { createMirrorGit } from './board-mirror-git.mjs';
import { renderMirror } from './board-mirror-render.mjs';
import { renderBoardScript } from './board-script.mjs';

const LOG = '.mirror-log';
const handoffBinDefault = fileURLToPath(new URL('../bin/hub-handoff.mjs', import.meta.url));
const REMOTE = '任务板文件版：发现远端配置，已停写';
const UNAVAILABLE = '任务板文件版：目录不可写或暂时无法重建';
const SHARED = new Set(['.git', LOG, 'board', 'inbox']);
const GENERATED_DIRS = ['cards', 'archive', 'mine'];
const changeLabels = {
  created: '建单', claimed: '认领', owner_edit: '编辑', owner_delete: '归档',
  progress: '记进度', reported: '交回', relay_passed: '交棒', relay_sync: '推进接力',
};
const stat = path => lstat(path).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
const textAt = async (path, info) => info?.isFile() ? readFile(path, 'utf8') : null;
const contains = (dir, candidate) => {
  const tail = relative(dir, candidate);
  return !isAbsolute(tail) && tail !== '..' && !tail.startsWith('..' + sep);
};

async function atomicallyWrite(path, value, beforeRename) {
  const tmp = join(dirname(path), '.mirror-' + randomBytes(8).toString('hex') + '.tmp');
  try {
    await writeFile(tmp, value, { mode: 0o600, flag: 'wx' });
    if (beforeRename) await beforeRename(path);
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function privateDir(path) {
  const info = await stat(path);
  if (info && !info.isDirectory()) await rm(path, { force: true });
  if (!info?.isDirectory()) await mkdir(path, { recursive: true, mode: 0o700 });
  else if ((info.mode & 0o777) !== 0o700) await chmod(path, 0o700);
  return Boolean(info && !info.isDirectory());
}

function identities(roster) {
  return [...new Set(roster)].filter(name => /^[A-Za-z0-9_.-]{1,64}$/u.test(name) &&
    name !== '.' && name !== '..' && redactSecrets(name) === name);
}

// 镜像只读看板快照。重建串行执行，事件到来时只预约下一次重建。
export function createMirror({
  board, dir, roster = [], people = () => [], logger = console, now = Date.now,
  enabled = true, throttleMs = 1500, gitBin, protectedDirs = [], dataDir, __beforeRename,
  handoffBin = handoffBinDefault,
}) {
  const git = createMirrorGit(dir, gitBin);
  let state = enabled ? 'idle' : 'disabled';
  let history = false;
  let lastUpdated = null;
  let published = new Map();
  let timer, event, busy;
  let disposed = false;
  const status = () => ({
    enabled, dir, lastUpdated, state, history,
    message: state === 'remote' ? REMOTE : state === 'unavailable' ? UNAVAILABLE : null,
  });
  const canWrite = () => enabled && !disposed && state !== 'remote';
  function stopForRemote() {
    state = 'remote';
    history = false;
    clearTimeout(timer);
    timer = undefined;
  }
  async function checkRemote() {
    if (await git.hasRemote()) stopForRemote();
    return state === 'remote';
  }
  async function rebuildFiles(reason) {
    if (!canWrite()) return;
    if (protectedDirs.some(path => contains(dir, path) || contains(path, dir)) ||
      (dataDir && contains(dir, dataDir))) throw new Error('镜像目录与正本重合');
    const root = await stat(dir);
    if (root && !root.isDirectory()) throw new Error('镜像路径不是目录');
    const dotGit = await stat(join(dir, '.git'));
    let gitState;
    try {
      gitState = await git.inspect(dotGit);
    } catch {
      gitState = 'failed';
    }
    if (gitState === 'remote') return stopForRemote();
    if (gitState === 'wrong-root') throw new Error('镜像 Git 目录无效');
    const entries = root ? await readdir(dir) : [];
    const logPath = join(dir, LOG);
    const logInfo = await stat(logPath);
    // 只接管空目录或已由镜像初始化的目录。回写口的预留路径可以先建。
    const known = logInfo?.isFile() || published.size > 0 || (root && await hasMirrorGuide());
    if (!known && entries.some(name => !SHARED.has(name) || name === LOG)) throw new Error('目录含有其他数据');
    if (dotGit && gitState === 'failed' && !known) throw new Error('无法识别现有 Git 仓库');

    const active = await board.list();
    const archived = await board.listArchived?.() ?? [];
    const archivedIds = new Set(archived.map(ticket => ticket.id));
    const tickets = active.filter(ticket => !archivedIds.has(ticket.id));
    const external = identities(typeof roster === 'function' ? roster() : roster);
    const assistants = await people();
    if (gitState === 'ready' && await checkRemote()) return;
    if (!canWrite()) return;
    await privateDir(dir);
    let repairs = Number(Boolean(known && !logInfo?.isFile()));
    if (!logInfo?.isFile()) {
      if (logInfo?.isDirectory()) await rm(logPath, { recursive: true });
      await atomicallyWrite(logPath, '');
    }
    for (const folder of [...GENERATED_DIRS, 'inbox']) repairs += Number(await privateDir(join(dir, folder)));
    for (const name of external) repairs += Number(await privateDir(join(dir, 'inbox', name)));
    if (gitState === 'new') {
      try {
        await git.init();
        gitState = 'ready';
      } catch {
        gitState = 'failed';
      }
    }

    const stamp = new Date(now()).toISOString();
    const log = await readFile(logPath, 'utf8');
    // 启动时从上次日志恢复时间；无变动时连总览也可以保持原样。
    const previous = lastUpdated ?? /^更新于 (\S+)$/mu.exec(log)?.[1];
    const priorTime = previous && previous === new Date(Date.parse(previous)).toJSON() ? previous : stamp;
    const render = updatedAt => renderMirror({ tickets, archived, roster: external, people: assistants, updatedAt });
    let pages = render(priorTime);
    let changed = false;
    const disk = new Map();
    for (const [file, wanted] of pages) {
      const path = join(dir, file);
      const info = await stat(path);
      const current = await textAt(path, info);
      disk.set(file, { info, current });
      if (current !== wanted || (info?.mode & 0o777) !== 0o600) changed = true;
      if ((!published.size && info && current !== wanted) ||
        (published.has(file) && current !== published.get(file))) repairs++;
    }
    const obsolete = entries.filter(name => !SHARED.has(name) &&
      !GENERATED_DIRS.includes(name) && !pages.has(name));
    for (const folder of GENERATED_DIRS) {
      for (const name of await readdir(join(dir, folder))) {
        const path = folder + '/' + name;
        if (!pages.has(path)) obsolete.push(path);
      }
    }
    for (const file of obsolete) {
      if (!published.has(file)) repairs++;
    }
    const updatedAt = changed || obsolete.length ? stamp : priorTime;
    if (updatedAt !== priorTime) pages = render(updatedAt);
    for (const [file, wanted] of pages) {
      const { info, current } = disk.get(file);
      if (current === wanted && (info.mode & 0o777) === 0o600) continue;
      const path = join(dir, file);
      if (info?.isDirectory()) await rm(path, { recursive: true });
      await atomicallyWrite(path, wanted, __beforeRename);
    }
    for (const file of obsolete) await rm(join(dir, file), { recursive: true, force: true });

    // 包装脚本内容固定（绝对路径写死），权限 0700。第一次出现不算修复，免得把旧测试的计数顶上去。
    const scriptBody = renderBoardScript(handoffBin);
    const scriptPath = join(dir, 'board');
    const scriptInfo = await stat(scriptPath);
    const scriptText = await textAt(scriptPath, scriptInfo);
    const scriptReady = scriptInfo?.isFile() && !scriptInfo.isSymbolicLink() &&
      scriptText === scriptBody && (scriptInfo.mode & 0o777) === 0o700;
    if (!scriptReady) {
      if (scriptInfo) repairs += 1;
      if (scriptInfo && !scriptInfo.isFile()) await rm(scriptPath, { recursive: true, force: true });
      await atomicallyWrite(scriptPath, scriptBody, __beforeRename);
      await chmod(scriptPath, 0o700);
    }

    const ticket = reason?.id && (tickets.find(item => item.id === reason.id) ??
      archived.find(item => item.id === reason.id));
    const actor = assistants.find(person => person.id === reason?.by)?.name ?? reason?.by;
    const summary = typeof reason === 'string' ? reason :
      (actor ? actor + ' ' : '') + (changeLabels[reason?.type] ?? '更新任务板') + (ticket ? '：' + ticket.title : '');
    const label = oneLine(redactSecrets(summary), 120);
    if (gitState === 'ready') {
      try {
        const commitPaths = new Set(pages.keys());
        commitPaths.add('board');
        if (await checkRemote() || await git.commit(commitPaths, label) === 'remote') {
          return stopForRemote();
        }
      } catch {
        gitState = 'failed';
      }
    }
    const logLines = log.split('\n').filter(line =>
      /^\S+ (?:Git 历史暂不可用|已恢复被改动或多出的文件，共 \d+ 项)$/u.test(line));
    if (repairs) logLines.push(stamp + ' 已恢复被改动或多出的文件，共 ' + repairs + ' 项');
    if (gitState === 'failed' && (history || !logLines.at(-1)?.endsWith('Git 历史暂不可用'))) {
      logLines.push(stamp + ' Git 历史暂不可用');
    }
    const nextLog = ['更新于 ' + updatedAt, ...logLines.slice(-100)].join('\n') + '\n';
    if (nextLog !== log || (logInfo && (logInfo.mode & 0o777) !== 0o600)) await atomicallyWrite(logPath, nextLog);
    published = pages;
    lastUpdated = updatedAt;
    history = gitState === 'ready';
    state = 'ready';
  }
  async function hasMirrorGuide() {
    const guide = join(dir, 'AGENTS.md');
    return await textAt(guide, await stat(guide)) === renderMirror().get('AGENTS.md');
  }
  function rebuild(reason = '重建一次') {
    clearTimeout(timer);
    timer = undefined;
    event = undefined;
    if (!canWrite()) return Promise.resolve(status());
    const run = (busy ?? Promise.resolve()).then(async () => {
      try {
        await rebuildFiles(reason);
      } catch {
        if (state !== 'unavailable') logger.warn?.('HUB_BOARD_MIRROR_UNAVAILABLE');
        state = 'unavailable';
        history = false;
      }
      return status();
    });
    busy = run;
    void run.finally(() => {
      if (busy === run) busy = undefined;
    });
    return run;
  }
  return {
    onEvent(ev) {
      if (!canWrite()) return;
      event = ev;
      if (timer) return;
      timer = setTimeout(() => void rebuild(event ?? '更新任务板'), Math.min(throttleMs, 2 ** 31 - 1));
      timer.unref();
    },
    rebuild,
    status,
    async dispose() {
      disposed = true;
      clearTimeout(timer);
      await busy;
    },
  };
}
