import path from 'node:path';
import { canonicalize, within } from './policy.mjs';
import { expandConfiguredPath } from './hub-config.mjs';
import { sensitiveEditPath } from './permission-mode.mjs';

// The shell and the native file tools use the same private path exclusions.
export const PRIVATE_NAME = [
  '[.]env([.][^/]*)?', '[.]secrets', 'secrets', '[.]ssh', '[.]gnupg', '[.]credentials',
  'credentials([.][^/]*)?', 'auth[.]json', '[.]netrc', 'id_rsa[^/]*', 'id_ed25519[^/]*',
  '[^/]*[.](pem|key|p12|pfx)', '[^/]*[-_]tokens?([.](json|yaml|yml|txt|env))?', '[.]hub-opencode-key[^/]*',
].join('|');
const privateName = new RegExp('(^|/)(' + PRIVATE_NAME + ')(/|$)', 'iu');
const files = new Set(['read', 'list_files', 'write', 'edit']);

export function creatorPaths(config) {
  const { home, hubHome, self_edit: edit } = config;
  const physical = value => canonicalize(expandConfiguredPath(value, config), '/');
  const sourcePath = typeof edit?.source_dir === 'string' ? expandConfiguredPath(edit.source_dir, config) : '';
  const source = edit?.enabled === true && path.isAbsolute(sourcePath) ? physical(sourcePath) : null;
  const inaccessible = [
    ...['.dsh', '.secrets', '.ssh', '.gnupg', '.codex', '.claude', '.grok', '.config',
      '.local/share/opencode', 'Library/Keychains'].map(name => path.join(home, name)),
    ...(typeof edit?.tool_key_file === 'string' ? [edit.tool_key_file] : []),
    ...(typeof edit?.health_key_file === 'string' ? [edit.health_key_file] : []),
    ...(typeof process.env.HUB_WEB_KEY_FILE === 'string' ? [process.env.HUB_WEB_KEY_FILE] : []),
    ...(Array.isArray(edit?.main_dsh_paths) ? edit.main_dsh_paths.filter(p => typeof p === 'string') : []),
  ].map(physical);
  const control = ['permission-mode.json', 'bots.yaml', 'bot-exposure.json', 'group-taint.log',
    'chat-only-sessions.json', 'command-grants.json'].map(name => physical(path.join(hubHome, 'config', name)));
  const data = [
    config.data_dir ?? path.join(hubHome, 'hub-data'), config.board_dir ?? path.join(hubHome, 'board'),
    config.ledger_dir ?? path.join(hubHome, 'ledger'), path.join(hubHome, 'tickets'),
    path.join(hubHome, 'self-edit'), path.join(hubHome, 'runtime'),
    ...(typeof edit?.runtime_dir === 'string' ? [edit.runtime_dir] : []),
    ...(source && Array.isArray(edit?.exclude_paths) ? edit.exclude_paths.filter(value =>
      typeof value === 'string' && !path.isAbsolute(value) && !value.split('/').includes('..'))
      .map(value => path.join(source, value)) : []),
  ].map(physical);
  return { source, inaccessible, control, data, hubHome: physical(hubHome) };
}

export function creatorFileDecision(decision, facts, tool) {
  if (!files.has(tool) || !decision.path) return decision;
  const target = decision.path;
  const write = tool === 'write' || tool === 'edit';
  const inSource = facts.source && within(target, facts.source);
  const inaccessible = privateName.test(target) || facts.inaccessible.some(root => within(target, root)) ||
    within(target, facts.hubHome) && /^dev-home[^/]*(?:\/|$)/iu.test(path.relative(facts.hubHome, target));
  if (inaccessible || write && /(?:^|\/)[.]git(?:\/|$)/iu.test(target)) {
    return {...decision, level: 'L4', reason: '主线服务、Git 内部记录和凭据读取使用各自的入口'};
  }
  const controlled = write && [...facts.data,...facts.control].some(root => within(target,root));
  return {...decision, level: write ? 'L1' : 'L0', controlled,
    ...(inSource ? {area: 'self_source'} : {})};
}

export function creatorCommand({ args, cwd, roots, bounds, timeoutMs, legacy }) {
  const workdir = canonicalize(args.workdir ?? cwd, cwd);
  const inSource = bounds.source && [workdir,...legacy.writePaths].find(target=>within(target,bounds.source));
  const command=args.command;
  const targets=[...legacy.readPaths,...legacy.writePaths];
  if ([workdir,...targets].some(target => bounds.inaccessible.some(root => within(target, root))
    || privateName.test(target)) || bounds.inaccessible.some(root => command.includes(root))
    || /(?:localhost|127\.0\.0\.1|\[::1\]):3081\b/iu.test(command)) {
    return {level: 'deny', reason: '目标在主线 DSH 或凭据存放区，请从对应入口处理'};
  }
  const readOnly = legacy?.level === 'run' && legacy.sideEffect !== true;
  const sensitiveWrites=legacy.writePaths.filter(target=>sensitiveEditPath(target)
    || [...bounds.control,...bounds.data].some(root=>within(target,root)));
  const knownLocalRead=legacy.programs.every(program=>['curl','wget','git'].includes(program)) &&
    legacy.segments.every(segment=>segment.program==='git'
      ? ['fetch','ls-remote','clone'].includes(segment.sub)
      : ['curl','wget'].includes(segment.program) && !segment.sends &&
        !segment.options?.some(option=>['-K','--config','-X','--request'].includes(option.name)));
  return {
    level: 'run', creator: true, sourceMutation: inSource && !readOnly ? inSource : null,
    reason: '全开档沿用创造模式', workdir, timeoutMs,
    programs: legacy.programs, readPaths: legacy.readPaths, writePaths: legacy.writePaths,
    segments: legacy.segments, sensitiveWrites, legacyDenied: legacy.level==='deny',
    caps: {network: knownLocalRead, longRunning:legacy.caps.longRunning, writeRoots: []},
    sideEffect: !readOnly, writeUnknown: !readOnly, roots, bounds,
  };
}
