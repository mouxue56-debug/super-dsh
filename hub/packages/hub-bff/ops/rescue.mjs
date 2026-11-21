#!/usr/bin/env node
// 独立救援入口，只依赖 Node 和 Git。上线时复制到 runtime/self-edit/rescue.mjs。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const secretName = new RegExp([
  '^(?:\\.env(?:\\..*)?|.*\\.env|.*\\.(?:key|pem|p12)',
  '|secrets?|credentials?|auth\\.json',
  '|[^/]*(?:tokens?|secrets?|credentials?|trusted-devices)[^/]*\\.(?:json|ya?ml|txt|env))$',
].join(''), 'iu');
const dataName = /^(?:data|hub-data|runtime|ledger|tickets|sessions|node_modules|\.git|\.dsh|\.secrets)$/iu;
export function excluded(file, config = {}) {
  const parts = file.split(/[\\/]/u);
  return parts.some(part => secretName.test(part) || dataName.test(part)) ||
    /\.(?:sqlite3?|db|jsonl|log)$/iu.test(file) ||
    (config.exclude_paths ?? []).some(item => file === item || file.startsWith(item + '/'));
}
export function redact(text) {
  return String(text).replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/giu, '[凭据已隐藏]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/giu, '$1[已隐藏]');
}
export function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID();
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}
export function readRows(file) {
  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(rows)) throw Error('改动记录格式损坏');
    return rows;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
export function append(file, row) {
  const rows = readRows(file);
  rows.push(row);
  atomic(file, rows);
}
export const filesAt = config => ({
  points: path.join(config.runtime_dir, 'restore-points.json'),
  changes: path.join(config.runtime_dir, 'changes.json'),
  lock: path.join(config.runtime_dir, 'operation.lock'),
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function locked(config, task) {
  const file = filesAt(config).lock;
  fs.mkdirSync(config.runtime_dir, { recursive: true, mode: 0o700 });
  let descriptor;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      descriptor = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(descriptor, String(process.pid));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (pid > 0) {
        try { process.kill(pid, 0); } catch (failure) {
          if (failure.code === 'ESRCH') { fs.unlinkSync(file); continue; }
        }
      }
      await sleep(20);
    }
  }
  if (descriptor === undefined) throw Error('已有改自己操作在执行，请稍后再试');
  try { return await task(); } finally { fs.closeSync(descriptor); fs.unlinkSync(file); }
}
export function run(argv, { cwd, timeoutMs = 120000, env = {}, limit = 8192 } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(value => typeof value !== 'string' || /\0/u.test(value))) {
    throw Error('检查、打包和重启命令须配置成参数数组');
  }
  return new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', ...env },
    });
    let output = '';
    let truncated = false;
    let timedOut = false;
    const collect = bytes => {
      const text = bytes.toString('utf8');
      if (output.length + text.length > limit) truncated = true;
      output += text.slice(0, Math.max(0, limit - output.length));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, timeoutMs);
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, output: '命令无法启动', truncated, timedOut });
    });
    child.once('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, output: redact(output), truncated, timedOut });
    });
  });
}
export async function git(config, args, extra = {}) {
  const result = await run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false',
    '-c', 'user.name=DSH Self Edit', '-c', 'user.email=self-edit@localhost', ...args], {
    cwd: config.source_dir, limit: 16 * 1024 * 1024,
    env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', ...extra },
  });
  if (!result.ok || result.truncated) throw Error('源码 Git 操作失败');
  return result.output;
}
export function validateRoot(config) {
  const root = config.source_dir;
  if (!path.isAbsolute(root ?? '') || fs.realpathSync(root) !== root || !fs.statSync(root).isDirectory()) {
    throw Error('源码目录须使用真实绝对路径');
  }
  const forbidden = config.main_dsh_paths ?? [];
  if (forbidden.some(item => inside(path.resolve(item), root) || inside(root, path.resolve(item)))) {
    throw Error('主线 DSH 不在改自己范围');
  }
  if (/(?:^|\/)(?:\.dsh|dsh-main|main-dsh)(?:\/|$)/u.test(root)) throw Error('主线 DSH 不在改自己范围');
}
function healthKey(file) {
  if (!path.isAbsolute(file) || fs.realpathSync(file) !== file) throw Error('健康检查凭据路径无效');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > 4096 ||
      info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || (info.mode & 0o400) === 0) {
      throw Error('健康检查凭据文件权限无效');
    }
    const bytes = Buffer.alloc(4097);
    const length = fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    if (length > 4096) throw Error('健康检查凭据过长');
    const value = bytes.subarray(0, length).toString('utf8').trim();
    if (!value || /[\r\n\0]/u.test(value)) throw Error('健康检查凭据格式无效');
    return value;
  } finally { fs.closeSync(descriptor); }
}
export async function health(config) {
  try {
    const url = new URL(config.health_url);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/bff/health' ||
      url.port === '3081') throw Error('健康检查地址无效');
    const headers = config.health_key_file ? { 'x-hub-bff-key': healthKey(config.health_key_file) } : {};
    const response = await fetch(url, { headers, redirect: 'error',
      signal: AbortSignal.timeout(config.health_request_timeout_ms ?? 2000) });
    const reader = response.body.getReader();
    let body = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        body += Buffer.from(chunk.value).toString('utf8');
        if (Buffer.byteLength(body) > 8192) throw Error('健康检查返回过长');
      }
    } finally { await reader.cancel(); }
    const value = JSON.parse(body);
    return { ok: response.ok && value.ok === true && value.status !== 'error', at: new Date().toISOString() };
  } catch { return { ok: false, at: new Date().toISOString() }; }
}
export async function stable(config) {
  const end = Date.now() + (config.health_timeout_ms ?? 30000);
  let passed = 0;
  do {
    const result = await health(config);
    passed = result.ok ? passed + 1 : 0;
    if (passed >= (config.health_successes ?? 3)) return true;
    await sleep(config.health_interval_ms ?? 1000);
  } while (Date.now() < end);
  return false;
}
export async function safePaths(config) {
  const raw = await git(config, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  return [...new Set(raw.split('\0').filter(Boolean))].filter(file => !excluded(file, config));
}
export async function snapshot(config, message) {
  validateRoot(config);
  if (!fs.existsSync(path.join(config.source_dir, '.git'))) await git(config, ['init', '--quiet']);
  const index = path.join(config.runtime_dir, 'index-' + randomUUID());
  const environment = { GIT_INDEX_FILE: index };
  let parent = '';
  try { parent = (await git(config, ['rev-parse', '--verify', 'HEAD'])).trim(); } catch {}
  try {
    if (parent) await git(config, ['read-tree', parent], environment);
    else await git(config, ['read-tree', '--empty'], environment);
    const tracked = (await git(config, ['ls-files', '-z'], environment)).split('\0').filter(Boolean);
    for (const file of tracked.filter(value => excluded(value, config))) {
      await git(config, ['update-index', '--force-remove', '--', file], environment);
    }
    const paths = await safePaths(config);
    for (let offset = 0; offset < paths.length; offset += 100) {
      await git(config, ['add', '--all', '--force', '--', ...paths.slice(offset, offset + 100)], environment);
    }
    const tree = (await git(config, ['write-tree'], environment)).trim();
    const head = (await git(config, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message])).trim();
    await git(config, ['update-ref', 'HEAD', head, ...(parent ? [parent] : [])]);
    await git(config, ['read-tree', head]);
    return head;
  } finally { if (fs.existsSync(index)) fs.unlinkSync(index); }
}
function validateRestorePaths(config, files) {
  validateRoot(config);
  for (const file of files) {
    const parts = file.split('/');
    if (parts.some(part => !part || part === '.' || part === '..') || !inside(config.source_dir,
      path.resolve(config.source_dir, file))) throw Error('还原路径超出源码目录');
    for (let count = 1; count < parts.length; count += 1) {
      const parent = path.join(config.source_dir, ...parts.slice(0, count));
      try {
        const info = fs.lstatSync(parent);
        if (info.isSymbolicLink() || !info.isDirectory()) throw Error('还原路径包含符号链接或非目录');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}
export async function restoreTree(config, point) {
  if (!/^[a-f0-9]{40,64}$/u.test(point.commit ?? '')) throw Error('还原点提交无效');
  const now = await safePaths(config);
  const target = (await git(config, ['ls-tree', '-r', '--name-only', '-z', point.commit]))
    .split('\0').filter(Boolean).filter(file => !excluded(file, config));
  validateRestorePaths(config, [...now, ...target]);
  await snapshot(config, '退回之前保存当前源码');
  const targetSet = new Set(target);
  for (const file of now) {
    if (targetSet.has(file)) continue;
    validateRestorePaths(config, [file]);
    const absolute = path.join(config.source_dir, file);
    try { fs.unlinkSync(absolute); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (let offset = 0; offset < target.length; offset += 100) {
    const batch = target.slice(offset, offset + 100);
    validateRestorePaths(config, batch);
    await git(config, ['restore', '--source', point.commit, '--worktree', '--', ...batch]);
  }
  return snapshot(config, '退回到还原点：' + point.id);
}
export async function command(config, kind) {
  const argv = config[kind + '_command'];
  if (!argv) throw Error('还没有配置' + (kind === 'build' ? '打包' : '重启') + '命令');
  const result = await run(argv, { cwd: config.source_dir, timeoutMs: (config.timeout_seconds ?? 120) * 1000 });
  if (!result.ok) throw Error((kind === 'build' ? '打包' : '重启') + (result.timedOut ? '超时' : '失败'));
  return result;
}
export function currentChanges(config) {
  const latest = new Map();
  for (const row of readRows(filesAt(config).changes)) latest.set(row.id, row);
  return [...latest.values()];
}
export async function applyChange(config, id, mode = 'restart') {
  return locked(config, async () => {
    const change = currentChanges(config).find(row => row.id === id);
    if (!change || !['restarting', 'restoring'].includes(change.status)) throw Error('没有待执行的改动');
    const point = readRows(filesAt(config).points).find(row => row.id === change.restorePointId);
    if (!point) throw Error('找不到还原点');
    let row = { ...change };
    let fallback = mode === 'restore' ? null : point;
    try {
      if (mode === 'restore') {
        const targetFiles = (await git(config, ['ls-tree', '-r', '--name-only', '-z', point.commit]))
          .split('\0').filter(Boolean).filter(file => !excluded(file, config));
        validateRestorePaths(config, [...await safePaths(config), ...targetFiles]);
        const commit = await snapshot(config, '手动退回之前保存当前源码');
        fallback = { id: randomUUID(), commit, changeId: row.id, bot: row.bot,
          summary: '手动退回之前的版本', createdAt: new Date().toISOString(),
          health: await health(config), buildTime: row.buildTime ?? null };
        append(filesAt(config).points, fallback);
        row.fallbackRestorePointId = fallback.id;
        append(filesAt(config).changes, row);
        await restoreTree(config, point);
      }
      await command(config, 'build');
      await command(config, 'restart');
      if (!await stable(config)) throw Error('健康检查超时');
      row.status = mode === 'restore' ? 'restored' : 'healthy';
      row.reason = mode === 'restore' ? '已退回到这里' : '';
    } catch (error) {
      const reason = redact(error.message);
      try {
        if (!fallback) throw Error('没有完成退回前的备份，源码尚未切换');
        await restoreTree(config, fallback);
        await command(config, 'build');
        await command(config, 'restart');
        if (!await stable(config)) throw Error('退回后的健康检查仍未通过');
        row.status = 'rolled_back';
        row.reason = mode === 'restore' ? '这次退回未成功，已恢复到退回之前的版本，原因是' + reason :
          '刚才那次改坏了，已退回，原因是' + reason;
      } catch (failure) {
        row.status = 'recovery_failed';
        row.reason = '已尝试退回，需要终端救援。' + reason + '；' + redact(failure.message);
      }
    }
    row.finishedAt = new Date().toISOString();
    row.canRestore = true;
    append(filesAt(config).changes, row);
    return row;
  });
}
export function exportConfig(config, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const text = Object.entries(config).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n';
  const temporary = file + '.' + randomUUID();
  fs.writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}
export function readConfig(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), JSON.parse(line.slice(split + 1))];
  }));
}
async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--config');
  const file = index >= 0 ? args.splice(index, 2)[1] :
    path.join(process.env.HUB_HOME || path.join(os.homedir(), 'dsh-work'),
      'runtime', 'self-edit', 'rescue.env');
  const config = readConfig(file);
  validateRoot(config);
  const [action, id] = args;
  if (action === 'list') return readRows(filesAt(config).points);
  if (action === 'status') return health(config);
  if (action === 'restart') return command(config, 'restart');
  if (action === 'run') return applyChange(config, id, args[2]);
  if (action === 'restore') {
    const change = await locked(config, async () => {
      const point = readRows(filesAt(config).points).find(row => row.id === id);
      if (!point) throw Error('找不到这个还原点');
      for (const previous of currentChanges(config)) {
        if (['restarting', 'restoring'].includes(previous.status)) throw Error('已有重启或退回正在执行');
        if (previous.lease && Date.parse(previous.lease.expiresAt) > Date.now()) {
          throw Error('还有一次源码操作正在执行');
        }
        if (previous.status === 'editing') append(filesAt(config).changes,
          { ...previous, status: 'finished', finishedAt: new Date().toISOString() });
      }
      const row = { id: randomUUID(), restorePointId: point.id, bot: '终端救援',
        summary: '退回到这里', createdAt: new Date().toISOString(), status: 'restoring', files: [] };
      append(filesAt(config).changes, row);
      return row;
    });
    return applyChange(config, change.id, 'restore');
  }
  throw Error('用法：rescue.mjs [--config rescue.env] list|restore <id>|restart|status');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(value => {
    console.log(JSON.stringify(value, null, 2));
    if (value?.status === 'recovery_failed' || value?.ok === false) process.exitCode = 1;
  }).catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
}
