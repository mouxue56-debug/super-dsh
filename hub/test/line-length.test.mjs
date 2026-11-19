// 「指定清单里的新文件，每行不超过 120 字符」。清单在 line-length.manifest.json。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库根默认是本文件上一级；可用环境变量 DSH_LINE_LENGTH_ROOT 指向别的仓库根（只读检查）。
const repoRoot = process.env.DSH_LINE_LENGTH_ROOT
  ? path.resolve(process.env.DSH_LINE_LENGTH_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'test', 'line-length.manifest.json'), 'utf8'));

// 把只含 * 的简单通配（不跨目录）展开成真实存在的文件相对路径。
export function expandGlob(pattern, root = repoRoot) {
  if (!pattern.includes('*')) return fs.existsSync(path.join(root, pattern)) ? [pattern] : [];
  const dir = path.dirname(pattern);
  const escaped = path.basename(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`^${escaped.replace(/\*/g, '[^/]*')}$`);
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((name) => matcher.test(name)).map((name) => path.join(dir, name));
}

// 找出一个文件里超长的行：返回 [{line, length}]，长度按字符（码点）算。
export function longLines(file, maxLine, root = repoRoot) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const found = [];
  text.split('\n').forEach((content, index) => {
    const length = Array.from(content).length;
    if (length > maxLine) found.push({ line: index + 1, length });
  });
  return found;
}

test('清单里的必需文件都存在', () => {
  const missing = manifest.files.filter((file) => !fs.existsSync(path.join(repoRoot, file)));
  assert.deepEqual(missing, []);
});

test(`清单里的文件每行不超过 ${manifest.maxLine} 字符`, () => {
  const targets = new Set(manifest.files);
  for (const pattern of manifest.optional ?? []) {
    for (const file of expandGlob(pattern)) targets.add(file);
  }
  const problems = [];
  for (const file of [...targets].sort()) {
    if (!fs.existsSync(path.join(repoRoot, file))) continue;
    for (const { line, length } of longLines(file, manifest.maxLine)) {
      problems.push(`${file}:${line} 有 ${length} 字符`);
    }
  }
  assert.equal(problems.length, 0, `超长的行：\n${problems.join('\n')}`);
});

test('超长行检测器自检', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'll-'));
  try {
    fs.writeFileSync(path.join(dir, 'x.mjs'), `${'a'.repeat(120)}\n${'中'.repeat(121)}\nok\n`);
    assert.deepEqual(longLines('x.mjs', 120, dir), [{ line: 2, length: 121 }]);
    assert.deepEqual(expandGlob('x.*', dir), ['x.mjs']);
    assert.deepEqual(expandGlob('nope/*.mjs', dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
