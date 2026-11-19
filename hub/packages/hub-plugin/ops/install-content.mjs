#!/usr/bin/env node
// 内容安装:把 defaults/(家规、手册、模板)按配置装进一个显式指定的运行目录。
// 默认只演练;加 --apply 才落盘;覆盖前把旧文件留进带时间戳的副本目录。
// 内核启动时 DSH_AGENTS_HOME 必须指向运行根，家规才进入指令链。
// 本脚本里没有任何默认的个人路径,目标目录必须显式传入。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {agents} from '../../hub-bff/lib/roster.mjs';

const BOT_ID = /^[a-z][a-z0-9-]{1,23}$/u;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SLOT = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gu;
const BACKUP_DIR = '.content-backup';

const defaultDefaults = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../defaults');

// 判断值是不是普通对象。
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// 把模板里的 {{名}} 换成值;返回文本和没有值的占位名。
export function fillSlots(text, values) {
  const missing = new Set();
  const out = text.replace(SLOT, (whole, name) => {
    if (Object.hasOwn(values, name) && typeof values[name] === 'string') {
      return values[name];
    }
    missing.add(name);
    return whole;
  });
  return {text: out, missing: [...missing]};
}

// 读取并校验 defaults/manifest.json。
export function loadManifest(defaultsDir) {
  const file = path.join(defaultsDir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ok = m.version === 1
    && typeof m.houseRules === 'string'
    && Array.isArray(m.manuals)
    && Array.isArray(m.templates)
    && Array.isArray(m.seeds);
  if (!ok) {
    throw Error('manifest.json 格式不对');
  }
  for (const manual of m.manuals) {
    if (!KEBAB.test(manual.id ?? '')) {
      throw Error('手册 id 须为小写连字符:' + manual.id);
    }
  }
  return m;
}

// 校验安装配置:占位符表和每个助理的模板、手册、人设文件。
export function validateConfig(config, manifest) {
  if (!isObject(config) || !isObject(config.placeholders) || !isObject(config.bots)) {
    throw Error('配置须含 placeholders 与 bots 两个对象');
  }
  const manualIds = manifest.manuals.map(m => m.id);
  const templateIds = manifest.templates.map(t => t.id);
  for (const [id, bot] of Object.entries(config.bots)) {
    if (!BOT_ID.test(id) || !isObject(bot)) {
      throw Error('助理 id 不合法:' + id);
    }
    if (bot.template !== undefined && !templateIds.includes(bot.template)) {
      throw Error(id + ' 的模板不存在:' + bot.template);
    }
    if (bot.persona_file !== undefined && !path.isAbsolute(bot.persona_file)) {
      throw Error(id + ' 的 persona_file 须为绝对路径');
    }
    if (bot.manuals !== undefined) {
      const bad = !Array.isArray(bot.manuals) || bot.manuals.some(x => !manualIds.includes(x));
      if (bad) {
        throw Error(id + ' 的 manuals 含不存在的手册');
      }
    }
  }
}

// 目标目录必须是显式传入的绝对路径、已存在、不是符号链接。
export function checkTarget(target) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) {
    throw Error('必须用 --target 显式传入绝对路径的运行目录');
  }
  const st = fs.lstatSync(target, {throwIfNoEntry: false});
  if (!st || st.isSymbolicLink() || !st.isDirectory()) {
    throw Error('目标目录不存在或是链接:' + target);
  }
}

// 某个助理最终装哪些手册:配置里写了就用配置,没写就用 manifest 里默认装的。
function manualsFor(bot, manifest) {
  const ids = bot.manuals ?? manifest.manuals.filter(m => m.default).map(m => m.id);
  return manifest.manuals.filter(m => ids.includes(m.id));
}

// 生成安装计划:每条是 {rel, text, kind, missing};不碰磁盘上的目标目录内容。
export function planInstall({defaultsDir = defaultDefaults, config}) {
  const manifest = loadManifest(defaultsDir);
  validateConfig(config, manifest);
  const read = rel => fs.readFileSync(path.join(defaultsDir, rel), 'utf8');
  const shared = config.placeholders;
  const items = [];
  const add = (rel, raw, values, kind) => {
    const {text, missing} = fillSlots(raw, values);
    items.push({rel, text, kind, missing});
  };
  const house = fillSlots(read(manifest.houseRules), shared);
  items.push({rel: 'AGENTS.md', ...house, kind: 'overwrite'});
  for (const seed of manifest.seeds) {
    add(seed.to, read(seed.from), shared, 'seed');
  }
  for (const [id, bot] of Object.entries(config.bots)) {
    const manuals = manualsFor(bot, manifest);
    const values = {
      ...shared,
      ...(isObject(bot.values) ? bot.values : {}),
      bot_name: bot.name ?? id,
      manuals: manuals.map(m => m.title).join('、'),
    };
    const persona = bot.persona_file
      ? fs.readFileSync(bot.persona_file, 'utf8')
      : bot.template
        ? read(manifest.templates.find(t => t.id === bot.template).file)
        : '';
    if (persona.includes('<!-- hub:identity -->') || persona.includes('<!-- /hub:identity -->')) {
      throw Error(id + ' 的人设正文不能包含 identity 标记');
    }
    const filled = fillSlots(persona, values);
    const identity = {
      name: values.bot_name,
      duty: bot.duty ?? values.duty ?? '',
      notDuty: bot.notDuty ?? values.not_duty ?? '',
    };
    const text = agents(identity, filled.text);
    const missing = filled.missing;
    items.push({rel: `bots/${id}/AGENTS.md`, text, kind: 'overwrite', missing});
    for (const m of manuals) {
      add(`bots/${id}/.agents/skills/${m.id}/SKILL.md`, read(`manuals/${m.id}/SKILL.md`), values, 'overwrite');
    }
  }
  return {items, manifest, botIds: Object.keys(config.bots)};
}

// 逐项对照目标目录,标出新建、更新、不变、已存在不动。
export function diffPlan(target, plan) {
  const rows = plan.items.map(item => {
    const file = path.join(target, item.rel);
    const st = fs.lstatSync(file, {throwIfNoEntry: false});
    if (st && (st.isSymbolicLink() || !st.isFile())) {
      throw Error('目标位置不是普通文件:' + item.rel);
    }
    let action = 'create';
    if (st) {
      const same = fs.readFileSync(file, 'utf8') === item.text;
      action = same ? 'unchanged' : item.kind === 'seed' ? 'keep' : 'update';
    }
    return {...item, action, file};
  });
  for (const id of plan.botIds ?? []) {
    const legacy = path.join(target, 'bots', id, 'skills');
    const stat = fs.lstatSync(legacy, {throwIfNoEntry: false});
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
      continue;
    }
    for (const entry of fs.readdirSync(legacy, {withFileTypes: true})) {
      if (!entry.isDirectory()) {
        continue;
      }
      const rel = `bots/${id}/skills/${entry.name}/SKILL.md`;
      const file = path.join(target, rel);
      const old = fs.lstatSync(file, {throwIfNoEntry: false});
      if (old && old.isFile() && !old.isSymbolicLink()) {
        rows.push({rel, file, action: '旧位置，可删', missing: []});
      }
    }
  }
  return rows;
}

// 逐级建目录,每一级都不许是符号链接。
function mkdirSafe(root, dir) {
  const rel = path.relative(root, dir);
  let cur = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    const st = fs.lstatSync(cur, {throwIfNoEntry: false});
    if (!st) {
      fs.mkdirSync(cur, {mode: 0o700});
    } else if (st.isSymbolicLink() || !st.isDirectory()) {
      throw Error('路径上有链接或非目录:' + cur);
    }
  }
}

// 把计划落盘:有缺失占位符就整体拒绝;覆盖前先把旧文件副本留进 .content-backup/<时间戳>/。
export function applyPlan(target, plan, {now = new Date()} = {}) {
  checkTarget(target);
  const rows = diffPlan(target, plan);
  const missing = rows.filter(r => r.missing.length);
  if (missing.length) {
    const names = missing.map(r => r.rel + ' 缺 ' + r.missing.join(',')).join(';');
    throw Error('占位符没有值,不落盘:' + names);
  }
  const stamp = now.toISOString().replace(/[:.]/gu, '-');
  const backupRoot = path.join(target, BACKUP_DIR, stamp);
  const done = [];
  for (const row of rows) {
    if (row.action === 'unchanged' || row.action === 'keep' || row.action === '旧位置，可删') {
      done.push({rel: row.rel, action: row.action});
      continue;
    }
    if (row.action === 'update') {
      const copy = path.join(backupRoot, row.rel);
      mkdirSafe(target, path.dirname(copy));
      fs.copyFileSync(row.file, copy, fs.constants.COPYFILE_EXCL);
    }
    mkdirSafe(target, path.dirname(row.file));
    const tmp = `${row.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, row.text, {flag: 'wx', mode: 0o600});
    fs.renameSync(tmp, row.file);
    done.push({rel: row.rel, action: row.action});
  }
  const changed = done.filter(d => d.action === 'create' || d.action === 'update');
  if (changed.length) {
    mkdirSafe(target, backupRoot);
    fs.writeFileSync(path.join(backupRoot, 'installed.json'), JSON.stringify(done, null, 2) + '\n', {mode: 0o600});
  }
  return {backupRoot: changed.length ? backupRoot : null, done};
}

// 解析命令行参数。
function parseArgs(argv) {
  const out = {apply: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') {
      out.apply = true;
    } else if (a === '--target' || a === '--config' || a === '--defaults') {
      out[a.slice(2)] = argv[++i];
    } else {
      throw Error('不认识的参数:' + a);
    }
  }
  return out;
}

// 命令行入口:默认演练,打印将要做什么。
export function main(argv) {
  const args = parseArgs(argv);
  if (!args.target || !args.config) {
    throw Error('用法: install-content.mjs --target <运行目录> --config <配置.json> [--defaults <目录>] [--apply]');
  }
  checkTarget(args.target);
  const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  const plan = planInstall({defaultsDir: args.defaults ?? defaultDefaults, config});
  const rows = diffPlan(args.target, plan);
  console.log(args.apply ? '【真装】' : '【演练,不落盘;加 --apply 才真装】');
  for (const r of rows) {
    const warn = r.missing.length ? '  !缺占位符:' + r.missing.join(',') : '';
    console.log(`${r.action.padEnd(9)}${r.rel}${warn}`);
  }
  if (!args.apply) {
    return;
  }
  const result = applyPlan(args.target, plan);
  console.log(result.backupRoot ? '旧文件副本与清单在:' + result.backupRoot : '没有改动');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error('失败:' + e.message);
    process.exit(1);
  }
}
