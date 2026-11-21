import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProcess as run } from './self-edit-process.mjs';
import { EditError, pathParts, checkedPath, readText, writeText } from './self-edit-files.mjs';
import {
  inside, excluded, redact, atomic, readRows, append, filesAt, locked, git, validateRoot,
  health, snapshot, currentChanges, exportConfig, readConfig,
} from '../ops/rescue.mjs';

const workerSource = fileURLToPath(new URL('../ops/rescue.mjs', import.meta.url));
const terminal = new Set(['healthy', 'rolled_back', 'restored', 'finished', 'recovery_failed']);
const active = config => currentChanges(config).find(row => !terminal.has(row.status));
const leased = row => row?.lease && Date.parse(row.lease.expiresAt) > Date.now();
const fail = message => new EditError('SELF_EDIT', message);
const text = (value, max = 200) => redact(String(value ?? '')).slice(0, max);
const sensitiveSource = file => /(?:^|\/)(?:config|AGENTS\.md)(?:\/|$)/iu.test(file) ||
  /(?:policy|permission|protected-files|tokens?|secrets?|credentials?|grants)/iu.test(path.basename(file));
const credentialFile = file => /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.secrets|secrets?|credentials?)\b/iu.test(file) ||
  /(?:\.(?:key|pem|p12)$|(?:auth|tokens?|secrets?|credentials?)[^/]*\.(?:json|ya?ml|txt|env)$)/iu.test(file);

export function createSelfEdit({ config: input = {}, runtimeDir, notice } = {}) {
  const config = { ...input, runtime_dir: path.join(runtimeDir, 'self-edit') };
  if (config.source_dir && inside(config.source_dir, config.runtime_dir)) {
    config.exclude_paths = [...(config.exclude_paths ?? []), path.relative(config.source_dir, config.runtime_dir)];
  }
  const enabled = config.enabled === true;
  let configFile;
  const save = row => append(filesAt(config).changes, row);
  function ensure() {
    if (!enabled) throw fail('改自己还没开通，需要 主人 在配置里开。可以先说明改法。');
    validateRoot(config);
    fs.mkdirSync(config.runtime_dir, { recursive: true, mode: 0o700 });
    configFile = path.join(config.runtime_dir, 'rescue.env');
    if (fs.existsSync(configFile)) {
      config.exclude_paths = [...new Set([...(config.exclude_paths ?? []),
        ...(readConfig(configFile).exclude_paths ?? [])])];
    }
  }
  function publicRow(row) {
    const { lease: _lease, ...visible } = row;
    return { ...visible, canRestore: !!row.restorePointId && !['restarting', 'restoring'].includes(row.status) };
  }
  function get(args, caller, readOnly = false) {
    const row = args.id ? currentChanges(config).find(item => item.id === args.id) : active(config);
    if (!row) throw fail('请先开始一次改自己。');
    if (row.bot !== caller.bot || row.sessionId !== (caller.sessionId ?? '')) {
      throw fail('这次改动正由另一位助理或另一段对话负责。');
    }
    if (!readOnly && (terminal.has(row.status) || ['restarting', 'restoring'].includes(row.status))) {
      throw fail('这次改动已结束或正在重启，请查看改动记录。');
    }
    return row;
  }
  function start(args, caller) {
    const existing = active(config);
    if (existing) return get({ id: existing.id }, caller);
    const row = { id: randomUUID(), bot: text(caller.bot, 80), sessionId: caller.sessionId ?? '',
      summary: text(args.summary || '调整 SDS'), createdAt: new Date().toISOString(),
      status: 'editing', files: [], fileCount: 0, checks: [], restorePointId: null };
    // 复制独立救援程序，改坏项目源码后仍能执行同一份恢复程序。
    const worker = path.join(config.runtime_dir, 'rescue.mjs');
    const temporary = worker + '.' + randomUUID();
    fs.copyFileSync(workerSource, temporary);
    fs.chmodSync(temporary, 0o700);
    fs.renameSync(temporary, worker);
    const exported = {};
    for (const key of ['source_dir', 'runtime_dir', 'main_dsh_paths', 'exclude_paths', 'build_command',
      'restart_command', 'health_url', 'health_key_file', 'health_successes', 'health_timeout_ms',
      'health_interval_ms', 'health_request_timeout_ms', 'timeout_seconds']) {
      if (config[key] !== undefined) exported[key] = config[key];
    }
    exportConfig(exported, configFile);
    save(row);
    return row;
  }
  async function prepare(row) {
    if (row.restorePointId) return row;
    const runningHealth = await health(config);
    let runningCommit = null;
    try { runningCommit = (await git(config, ['rev-parse', '--verify', 'HEAD'])).trim(); } catch {}
    const commit = await snapshot(config, '改自己之前的还原点：' + row.bot + ' 要「' + row.summary + '」');
    let buildTime = config.build_time ?? null;
    if (config.build_artifact) {
      try { buildTime = fs.statSync(config.build_artifact).mtime.toISOString(); } catch {}
    }
    const point = { id: randomUUID(), changeId: row.id, bot: row.bot, summary: row.summary,
      createdAt: new Date().toISOString(), commit, buildTime,
      health: runningHealth, runningCommit, fileCount: 0 };
    append(filesAt(config).points, point);
    row.restorePointId = point.id;
    row.baseCommit = commit;
    save(row);
    return row;
  }
  function location(value, { root = false, missing = false } = {}) {
    const relative = path.isAbsolute(value ?? '') ? path.relative(config.source_dir, value) : value;
    const parts = pathParts(relative ?? '', root);
    const file = path.join(config.source_dir, ...parts);
    if (!inside(config.source_dir, file)) throw fail('这个路径不在这套系统的源码目录内。');
    for (const forbidden of config.main_dsh_paths ?? []) {
      if (inside(path.resolve(forbidden), file)) throw fail('主线 DSH 不在改自己范围。');
    }
    return { relative, ...checkedPath(config.source_dir, parts, { missing }) };
  }
  async function review(action, args = {}, caller = {}) {
    ensure();
    if (action === 'restore') {
      const point = readRows(filesAt(config).points).find(row => row.id === args.id);
      if (!point) throw fail('找不到这个还原点。');
      return { confirmationTotal: 1, title: '退回这次改动', targets: [point.id], targetCount: 1,
        consequence: '将恢复「' + point.summary + '」之前的源码并重启这套服务。',
        rollback: '会先保存当前源码，退回失败会自动恢复当前版本。' };
    }
    if (['start', 'status'].includes(action)) return null;
    const row = action === 'prepare' ? active(config) : get(args, caller, ['read', 'list', 'release'].includes(action));
    if (row && action === 'prepare') get({ id: row.id }, caller);
    if (action === 'restart') return { confirmationTotal: 1, title: '让这次改动生效',
      targets: [config.source_dir], targetCount: 1,
      consequence: '将重启这套服务，让「' + row.summary + '」生效，已记录 ' + row.fileCount + ' 个改动文件。',
      rollback: '启动失败会自动退回刚才的还原点，属于这次确认的补救。' };
    if (!['write', 'patch', 'prepare', 'read'].includes(action)) return null;
    const at = location(args.path, { root: action === 'prepare', missing: ['write', 'prepare'].includes(action) });
    const content = args.text ?? args.after ?? args.replacement ?? args.new_text ?? '';
    const privateFile = excluded(at.relative, config) || redact(content) !== content;
    if (!privateFile && (action === 'read' || !sensitiveSource(at.relative))) return null;
    return { confirmationTotal: 2, title: action === 'read' ? '查看敏感文件' : '改动权限或敏感文件',
      targets: [at.relative], targetCount: 1,
      consequence: action === 'read' ? '将读取这一个文件，返回时隐藏凭据值。' :
        '将改写这个文件，可能影响权限、配置、令牌或已有数据。',
      rollback: privateFile ? '此文件不进入源码还原点，请确认已有独立备份。' : '修改前保存源码还原点，可退回。' };
  }
  function changed(row, file) {
    row.files = [...new Map([...row.files, { path: file }].map(item => [item.path, item])).values()];
    row.fileCount = row.files.length;
    row.checks = [];
    save(row);
  }
  function launch(row, mode) {
    const child = spawn(process.execPath, [path.join(config.runtime_dir, 'rescue.mjs'),
      '--config', configFile, 'run', row.id, mode], { detached: true, stdio: 'ignore' });
    child.unref();
    child.on('error', () => {
      void locked(config, async () => {
        row.status = 'recovery_failed';
        row.reason = '恢复程序启动失败，请使用终端救援。';
        save(row);
      });
    });
  }
  async function execute(action, args = {}, caller = {}) {
    ensure();
    return locked(config, async () => {
      if (action === 'status') return log();
      if (action === 'start') return { change: publicRow(start(args, caller)), source_dir: config.source_dir };
      const row = action === 'prepare' ? start(args, caller) :
        get(args, caller, ['read', 'list', 'release'].includes(action));
      if (action === 'release') {
        if (!row.lease || row.lease.id !== args.leaseId) throw fail('这次源码操作的凭据已失效。');
        delete row.lease;
        save(row);
        return { change: publicRow(row) };
      }
      if (!['read', 'list'].includes(action) && leased(row)) {
        throw fail('还有一次源码操作正在执行，请等它完成后再继续。');
      }
      if (action === 'prepare') {
        location(args.path, { root: true, missing: true });
        await prepare(row);
        row.lease = { id: randomUUID(),
          expiresAt: new Date(Date.now() + (config.native_lease_ms ?? 660000)).toISOString() };
        changed(row, path.relative(config.source_dir, path.resolve(config.source_dir, args.path)) || '.');
        return { change: publicRow(row), lease: row.lease };
      }
      if (action === 'read') {
        const at = location(args.path);
        const content = readText(at.file, at.info);
        return { change: publicRow(row), text: credentialFile(at.relative) ? '[凭据文件内容已隐藏]' : redact(content) };
      }
      if (action === 'list') {
        const at = location(args.path ?? '', { root: true });
        if (!at.info.isDirectory()) throw fail('请选择目录。');
        const entries = fs.readdirSync(at.file, { withFileTypes: true })
          .filter(entry => !entry.isSymbolicLink() && !excluded(path.join(at.relative, entry.name), config))
          .map(entry => ({ name: entry.name, directory: entry.isDirectory() }));
        return { change: publicRow(row), entries };
      }
      if (['write', 'patch'].includes(action)) {
        const at = location(args.path, { missing: action === 'write' });
        let content = args.text;
        if (action === 'patch') {
          const old = readText(at.file, at.info);
          const search = args.search ?? args.old_text ?? args.before;
          if (typeof search !== 'string' || !search || old.split(search).length !== 2) {
            throw fail('补丁要准确匹配一处文字。');
          }
          content = old.replace(search, () => args.replacement ?? args.new_text ?? args.after ?? '');
        }
        if (redact(content) !== content && !excluded(at.relative, config)) {
          config.exclude_paths = [...(config.exclude_paths ?? []), at.relative];
          exportConfig({ ...readConfig(configFile), exclude_paths: config.exclude_paths }, configFile);
        }
        await prepare(row);
        writeText(at.file, at.info, content);
        changed(row, at.relative);
      } else if (action === 'check') {
        await prepare(row);
        const checks = args.name ? [[args.name, config.checks?.[args.name]]] : Object.entries(config.checks ?? {});
        if (!checks.length || checks.some(([, argv]) => !argv)) throw fail('还没有配置这项检查命令。');
        row.checks = [];
        for (const [name, argv] of checks) {
          const result = await run(argv, { cwd: config.source_dir, timeoutMs: (config.timeout_seconds ?? 120) * 1000 });
          row.checks.push({ name, ...result });
        }
        save(row);
      } else if (action === 'build') {
        await prepare(row);
        if (!config.build_command) throw fail('还没有配置打包命令。');
        const result = await run(config.build_command, {
          cwd: config.source_dir, timeoutMs: (config.timeout_seconds ?? 120) * 1000,
        });
        row.build = result;
        row.buildTime = new Date().toISOString();
        save(row);
      } else if (action === 'restart') {
        await prepare(row);
        row.commit = await snapshot(config, '助理改了自己：' + row.summary);
        const paths = (await git(config, ['diff', '--name-only', '-z', row.baseCommit, row.commit]))
          .split('\0').filter(Boolean).filter(file => !excluded(file, config));
        row.files = paths.map(file => ({ path: file }));
        row.fileCount = paths.length;
        row.status = 'restarting';
        save(row);
        launch(row, 'restart');
      } else if (action === 'finish') {
        row.status = 'finished';
        row.finishedAt = new Date().toISOString();
        save(row);
      } else throw fail('没有这个改自己操作。');
      return { change: publicRow(row) };
    });
  }
  async function log() {
    if (!enabled) return { enabled: false, changes: [], restorePoints: [] };
    const changes = currentChanges(config).map(publicRow);
    if (notice) {
      const file = path.join(config.runtime_dir, 'notified.json');
      const notified = new Set(readRows(file));
      for (const row of changes.filter(item => terminal.has(item.status) && !notified.has(item.id))) {
        await notice({ id: row.id, kind: 'self-edit', text: row.reason || '助理改了自己：' + row.summary,
          bot: row.bot, restorePointId: row.restorePointId });
        notified.add(row.id);
      }
      atomic(file, [...notified]);
    }
    return { enabled, changes, restorePoints: readRows(filesAt(config).points) };
  }
  async function restore(id, caller = {}) {
    ensure();
    return locked(config, async () => {
      const running = active(config);
      if (leased(running)) throw fail('还有一次源码操作正在执行，请等它完成后再退回。');
      if (running && ['restarting', 'restoring'].includes(running.status)) {
        if (running.restorePointId === id && running.status === 'restoring') return { change: publicRow(running) };
        throw fail('正在重启或退回，请稍候。');
      }
      const point = readRows(filesAt(config).points).find(row => row.id === id);
      if (!point) throw fail('找不到这个还原点。');
      if (running) save({ ...running, status: 'finished', finishedAt: new Date().toISOString() });
      const row = start({ summary: '退回到「' + point.summary + '」之前' }, { bot: caller.bot ?? '主人' });
      row.restorePointId = point.id;
      row.status = 'restoring';
      save(row);
      launch(row, 'restore');
      return { change: publicRow(row) };
    });
  }
  return { execute, log, restore, review };
}
