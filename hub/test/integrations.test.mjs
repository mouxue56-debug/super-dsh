// 接入包文档里出现的每条 hub-board / hub-board-admin 命令，都必须能被真实命令行的参数解析接受。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../packages/hub-bff/bin/hub-board.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = [
  'integrations/README.md',
  'integrations/claude-code/skills/hub-board/SKILL.md',
  'integrations/codex/AGENTS.hub-board.md',
  'integrations/grok-bot/看板用法.md',
];
const adminBin = path.join(repoRoot, 'packages/hub-bff/bin/hub-board-admin.mjs');

// 读文档全文。
function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

// 把占位符换成可执行的具体值。
function fill(text) {
  return text
    .replace(/<结果文件>/g, 'result.md')
    .replace(/<工单号>|<id>/g, 'T-20261117-120000-ab12')
    .replace(/<你的名字>/g, 'codex')
    .replace(/<[^>]+>/g, 'x1');
}

// 简易分词：支持双引号，不经 shell。
function tokenize(line) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2]);
  return out;
}

// 取出文档里所有以给定命令名开头的命令（行内代码和围栏代码块）。
export function extract(text, name) {
  const found = [];
  const add = (raw) => {
    const first = raw.split(' | ')[0].trim();
    if (first.startsWith(`${name} `)) found.push(first);
  };
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    for (const part of m[1].split('；')) add(part);
  }
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    else if (inFence) add(line);
  }
  return [...new Set(found)];
}

// 在临时目录里用假的网络层跑一条 hub-board 命令，返回退出码。
async function runBoard(command) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'integ-'));
  const cwd = process.cwd();
  try {
    fs.writeFileSync(path.join(dir, 'result.md'), '执行者自述：测试\n');
    process.chdir(dir);
    let err = '';
    const io = {
      stdout: { write() {} },
      stderr: { write: (s) => { err += s; } },
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    };
    const env = { HUB_BOARD_URL: 'http://127.0.0.1:1/board', HUB_BOARD_TOKEN: 'dsb_test_placeholder' };
    const [, ...args] = tokenize(fill(command));
    const code = await main(args, env, io);
    return { code, err };
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('文档里的每条 hub-board 命令都被命令行接受', async () => {
  let count = 0;
  for (const file of docs) {
    for (const command of extract(read(file), 'hub-board')) {
      const { code, err } = await runBoard(command);
      assert.equal(code, 0, `${file}: ${command} 退出码 ${code} ${err}`);
      count += 1;
    }
  }
  assert.ok(count >= 20, `只找到 ${count} 条命令`);
});

test('文档里的 hub-board-admin 命令被管理命令接受', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'integ-admin-'));
  try {
    const seen = new Set();
    const commands = docs.flatMap((file) => extract(read(file), 'hub-board-admin'));
    const ordered = [...new Set(commands)].sort((a, b) => Number(a.includes('revoke')) - Number(b.includes('revoke')));
    assert.ok(ordered.some((c) => c.includes('issue')) && ordered.some((c) => c.includes('revoke')));
    for (const command of ordered) {
      const [, ...args] = tokenize(fill(command));
      if (args[0] === 'issue' && seen.has(args[1])) continue;
      if (args[0] === 'issue') seen.add(args[1]);
      const env = { PATH: process.env.PATH, HUB_BOARD_CONFIG_DIR: dir };
      const out = execFileSync(process.execPath, [adminBin, ...args], { env, encoding: 'utf8' });
      assert.ok(out.length > 0, command);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('文档里没有令牌、令牌参数、个人路径或内网地址', () => {
  for (const file of docs) {
    const text = read(file);
    assert.doesNotMatch(text, /dsb_[A-Za-z0-9_-]{8,}/, `${file} 含令牌形状`);
    assert.doesNotMatch(text, /--[a-z-]*token/i, `${file} 含令牌参数`);
    assert.doesNotMatch(text, /(?:\/Users|\/home)\/[A-Za-z0-9._-]+\//, `${file} 含个人路径`);
    assert.doesNotMatch(text, /\.ts\.net|\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b/, `${file} 含内网地址`);
  }
});

test('Grok Bot 一页如实写明网络是否可达待验', () => {
  assert.match(read('integrations/grok-bot/看板用法.md'), /网络是否可达待验/);
  assert.match(read('integrations/README.md'), /网络是否可达待验/);
});

test('接入包文档每行不超过 120 字符（代码块除外）', () => {
  for (const file of docs) {
    let inFence = false;
    read(file).split('\n').forEach((line, i) => {
      if (line.startsWith('```')) inFence = !inFence;
      if (inFence) return; // 代码块里的一行式命令不折行
      assert.ok(Array.from(line).length <= 120, `${file}:${i + 1}`);
    });
  }
});

test('三份说明与五步都在', () => {
  const readme = read('integrations/README.md');
  for (const step of ['第 1 步', '第 2 步', '第 3 步', '第 4 步', '第 5 步']) assert.ok(readme.includes(step), step);
  for (const file of docs.slice(1)) {
    const text = read(file);
    for (const word of ['claim', 'report', 'block', '执行者自述', '没验']) assert.ok(text.includes(word), `${file} 缺 ${word}`);
  }
});
