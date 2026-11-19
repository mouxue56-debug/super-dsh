#!/usr/bin/env node
// 量表:数每个助理自带内容的字数和粗估 token,分项列出。
// 只读指定的运行目录;不起实例、不调模型。真实提示大小要在集成时用内核报的数核对。
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {estimateTokens} from '../boot-slice.mjs';

// 目标:自带部分(家规、人设、手册简介、开工切片、工具说明)合计不超过这个粗估 token 数。
export const OWN_TOKEN_LIMIT = 1700;
export const CATALOG_DESC_MAX = 80;
export const CATALOG_MAX_ENTRIES = 8;

// 读一个文本文件,不存在返回 null;拒绝符号链接。
function readText(file) {
  const st = fs.lstatSync(file, {throwIfNoEntry: false});
  if (!st) {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    throw Error('不是普通文件:' + file);
  }
  return fs.readFileSync(file, 'utf8');
}

// 数一段文字:字数(含标点、不含空白)、字节、粗估 token。
export function countText(text) {
  const chars = Array.from(text.replace(/\s/gu, '')).length;
  return {chars, bytes: Buffer.byteLength(text, 'utf8'), tokens: estimateTokens(text)};
}

// 从 SKILL.md 读 name 和 description;格式不对返回 null。
export function parseSkill(text) {
  const m = /^---\n([\s\S]*?)\n---\n/u.exec(text);
  if (!m) {
    return null;
  }
  const name = /^name:\s*(.+)$/mu.exec(m[1])?.[1]?.trim();
  const description = /^description:\s*(.+)$/mu.exec(m[1])?.[1]?.trim();
  return name && description ? {name, description} : null;
}

// 量一个助理:返回分项列表、手册全文(按需才读,不计入开机)和警告。
export function measureBot({root, id, sliceTokens, toolTokens}) {
  const items = [];
  const warnings = [];
  const house = readText(path.join(root, 'AGENTS.md'));
  const persona = readText(path.join(root, 'bots', id, 'AGENTS.md'));
  items.push({name: '家规', ...(house === null ? {missing: true} : countText(house))});
  items.push({name: '人设', ...(persona === null ? {missing: true} : countText(persona))});
  const skillsDir = path.join(root, 'bots', id, '.agents', 'skills');
  const catalog = [];
  const manuals = [];
  const dirs = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).sort() : [];
  for (const dir of dirs) {
    const text = readText(path.join(skillsDir, dir, 'SKILL.md'));
    const skill = text === null ? null : parseSkill(text);
    if (!skill) {
      warnings.push(`手册 ${dir} 缺 SKILL.md 或缺 name/description`);
      continue;
    }
    if (skill.name !== dir || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(skill.name)) {
      warnings.push(`手册 ${dir} 的 name(${skill.name})须是和目录同名的小写连字符`);
    }
    if (Array.from(skill.description).length > CATALOG_DESC_MAX) {
      warnings.push(`手册 ${dir} 简介超过 ${CATALOG_DESC_MAX} 字`);
    }
    catalog.push(`${skill.name}: ${skill.description}`);
    manuals.push({name: skill.name, ...countText(text)});
  }
  if (catalog.length > CATALOG_MAX_ENTRIES) {
    warnings.push(`手册 ${catalog.length} 本,超过 ${CATALOG_MAX_ENTRIES} 本`);
  }
  items.push({name: `手册简介(${catalog.length} 条)`, ...countText(catalog.join('\n'))});
  items.push(sliceTokens === undefined ? {name: '开工切片', unmeasured: true} : {name: '开工切片', tokens: sliceTokens});
  items.push(toolTokens === undefined ? {name: '工具说明', unmeasured: true} : {name: '工具说明', tokens: toolTokens});
  const total = items.reduce((sum, i) => sum + (i.tokens ?? 0), 0);
  const unmeasured = items.filter(i => i.unmeasured || i.missing).map(i => i.name);
  if (total > OWN_TOKEN_LIMIT) {
    warnings.push(`自带部分粗估 ${total} token,超过目标 ${OWN_TOKEN_LIMIT}`);
  }
  return {id, items, total, unmeasured, manuals, warnings};
}

// 列出运行目录下有人设或手册的助理 id。
export function listBots(root) {
  const botsDir = path.join(root, 'bots');
  if (!fs.existsSync(botsDir)) {
    return [];
  }
  return fs.readdirSync(botsDir, {withFileTypes: true}).filter(d => d.isDirectory()).map(d => d.name).sort();
}

// 把量表渲染成 Markdown(每个助理一张分项表)。
export function renderTable(results) {
  const out = [];
  for (const r of results) {
    out.push(`### ${r.id}`, '', '| 项 | 字数 | 字节 | 粗估 token |', '|---|---:|---:|---:|');
    for (const i of r.items) {
      const note = i.unmeasured ? '未量' : i.missing ? '缺' : null;
      out.push(`| ${i.name} | ${note ?? i.chars ?? '-'} | ${note ?? i.bytes ?? '-'} | ${note ?? i.tokens} |`);
    }
    out.push(`| **自带合计** | | | **${r.total}**(目标 ≤ ${OWN_TOKEN_LIMIT}) |`, '');
    if (r.unmeasured.length) {
      out.push(`未计入:${r.unmeasured.join('、')}`, '');
    }
    for (const m of r.manuals) {
      out.push(`- 手册全文(用到才读,不计入开机):${m.name} ${m.chars} 字 / ${m.tokens} token`);
    }
    for (const w of r.warnings) {
      out.push(`- 警告:${w}`);
    }
    out.push('');
  }
  out.push('token 为粗估:中日韩字符每个按 1,其余每 4 字符按 1(同 boot-slice.mjs),与内核报的真实提示大小会有出入。');
  return out.join('\n');
}

// 命令行入口。
export function main(argv) {
  const args = {json: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      args.json = true;
    } else if (['--dir', '--slice-tokens', '--tool-tokens'].includes(a)) {
      args[a.slice(2)] = argv[++i];
    } else {
      throw Error('不认识的参数:' + a);
    }
  }
  if (!args.dir || !path.isAbsolute(args.dir)) {
    throw Error('用法: measure-boot.mjs --dir <绝对路径的运行目录> [--slice-tokens N] [--tool-tokens N] [--json]');
  }
  const num = v => (v === undefined ? undefined : Number(v));
  const results = listBots(args.dir).map(id => measureBot({
    root: args.dir,
    id,
    sliceTokens: num(args['slice-tokens']),
    toolTokens: num(args['tool-tokens']),
  }));
  console.log(args.json ? JSON.stringify(results, null, 2) : renderTable(results));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error('失败:' + e.message);
    process.exit(1);
  }
}
