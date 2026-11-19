// 仓库级「开源卫生」扫描：个人信息、地址、密钥形状、超大文件。
// 已知命中登记在 publish-scan.baseline.json（待清理基线），只许减少，不许新增。
// 私有词表：环境变量 DSH_PUBLISH_SCAN_WORDLIST 指向一个文本文件（一行一词，# 开头为注释）；
// 没设或文件不存在时，只跳过「私有词表」这一段，其余照扫。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 仓库根默认是本文件上一级；可用环境变量 DSH_PUBLISH_SCAN_ROOT 指向别的仓库根（只读扫描）。
// 基线默认取该仓库根下 test/publish-scan.baseline.json，也可用 DSH_PUBLISH_SCAN_BASELINE 指定。
const repoRoot = process.env.DSH_PUBLISH_SCAN_ROOT
  ? path.resolve(process.env.DSH_PUBLISH_SCAN_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = process.env.DSH_PUBLISH_SCAN_BASELINE
  ?? path.join(repoRoot, 'test', 'publish-scan.baseline.json');
const maxFileBytes = 1024 * 1024;
const selfFiles = new Set(['test/publish-scan.test.mjs', 'test/publish-scan.baseline.json']);

// 规则：名字 -> 正则（逐行匹配）。正则源码里不写出完整样例，免得扫描器扫到自己。
export const lineRules = {
  'user-home-path': new RegExp(
    '(?:/Users|/home)/(?!<|\\$|\\{|\\.\\.\\.|example\\b|user(?:name)?\\b|name\\b|you\\b|me\\b|runner\\b|x+\\b)'
      + '[A-Za-z0-9._-]+/',
  ),
  'tailnet-name': /\b[a-z0-9-]+\.ts\.net\b|\btail[0-9a-f]{4,}\.net\b/i,
  'cgnat-address': /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/,
  'sk-token': /\bsk-[A-Za-z0-9_-]{20,}/,
  'private-key-header': /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
};

// lstat 一个路径（不跟随符号链接）；不存在或读不了返回 null。
function lstatOrNull(full) {
  try {
    return fs.lstatSync(full);
  } catch {
    return null;
  }
}

// 取仓库里的文件清单：已跟踪加未跟踪但未被忽略的；没有 git 时退回遍历目录。
export function listRepoFiles(root = repoRoot) {
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });
    return out
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .filter((file) => lstatOrNull(path.join(root, file)) !== null);
  } catch {
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else found.push(path.relative(root, full));
      }
    };
    walk(root);
    return found;
  }
}

// 读私有词表；没设环境变量或读不到就返回 null。
export function loadWordlist(env = process.env) {
  const file = env.DSH_PUBLISH_SCAN_WORDLIST;
  if (!file || !fs.existsSync(file)) return null;
  const words = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return words.length ? words : null;
}

// 判断是不是二进制（含 NUL 字节），二进制不按行扫。
function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

// 扫描一组文件，返回命中列表：{file, line, rule, text}。大文件单独记一条 oversize-file。
export function scanFiles(files, { root = repoRoot, wordlist = null, skip = selfFiles } = {}) {
  const hits = [];
  for (const file of files) {
    if (skip.has(file)) continue;
    const full = path.join(root, file);
    const info = lstatOrNull(full);
    if (info === null) {
      hits.push({ file, line: 0, rule: 'skipped-unreadable', text: '无法 lstat' });
      continue;
    }
    if (info.isSymbolicLink()) {
      hits.push({ file, line: 0, rule: 'skipped-symlink', text: '符号链接，未扫内容' });
      continue;
    }
    if (info.isDirectory()) {
      hits.push({ file, line: 0, rule: 'skipped-directory', text: '目录（可能是子模块），未扫内容' });
      continue;
    }
    if (!info.isFile()) {
      hits.push({ file, line: 0, rule: 'skipped-unreadable', text: '不是普通文件' });
      continue;
    }
    const size = info.size;
    if (size > maxFileBytes) hits.push({ file, line: 0, rule: 'oversize-file', text: `${size} bytes` });
    if (size > maxFileBytes * 8) continue;
    let buffer;
    try {
      buffer = fs.readFileSync(full);
    } catch (error) {
      hits.push({ file, line: 0, rule: 'skipped-unreadable', text: `读取失败 ${error.code ?? ''}`.trim() });
      continue;
    }
    if (isBinary(buffer)) continue;
    const lines = buffer.toString('utf8').split('\n');
    lines.forEach((text, index) => {
      for (const [rule, pattern] of Object.entries(lineRules)) {
        if (!pattern.test(text)) continue;
        hits.push({ file, line: index + 1, rule, text: text.trim().slice(0, 100) });
      }
      for (const word of wordlist ?? []) {
        if (text.includes(word)) hits.push({ file, line: index + 1, rule: 'private-word', text: '(词表命中，不回显)' });
      }
    });
  }
  return hits;
}

// 把命中按「文件|规则」归并成计数，基线就是这个形状。
export function countByKey(hits) {
  const counts = {};
  for (const hit of hits) {
    const key = `${hit.file}|${hit.rule}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// 读待清理基线：{ "文件|规则": 允许的最大命中数 }。
export function loadBaseline() {
  if (!fs.existsSync(baselinePath)) return {};
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).allowed ?? {};
}

// 读测试夹具段：{ "文件|规则": {reason} }，按「文件加规则」放行，不计数。
export function loadFixtures() {
  if (!fs.existsSync(baselinePath)) return {};
  const fixtures = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).fixtures ?? {};
  for (const [key, entry] of Object.entries(fixtures)) {
    if (!entry || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`fixtures 条目缺 reason：${key}`);
    }
  }
  return fixtures;
}

// 找出超出基线的新增命中（没登记的键，或数量比登记的多）；fixtures 里的「文件|规则」直接放行。
export function newHits(hits, baseline, fixtures = {}) {
  hits = hits.filter((hit) => !Object.hasOwn(fixtures, `${hit.file}|${hit.rule}`));
  const counts = countByKey(hits);
  const over = new Set(Object.keys(counts).filter((key) => counts[key] > (baseline[key] ?? 0)));
  return hits.filter((hit) => over.has(`${hit.file}|${hit.rule}`));
}

test('扫描规则能认出各类样例（自检，样例运行时拼接）', () => {
  const user = ['/Users', 'someone', 'x.txt'].join('/');
  const tail = ['my-box', 'ts', 'net'].join('.');
  const addr = ['100', '100', '1', '2'].join('.');
  const token = `${'s'}${'k'}-${'a'.repeat(24)}`;
  const header = `-----BEGIN ${'OPENSSH'} PRIVATE KEY-----`;
  assert.ok(lineRules['user-home-path'].test(user));
  assert.ok(lineRules['tailnet-name'].test(tail));
  assert.ok(lineRules['cgnat-address'].test(addr));
  assert.ok(lineRules['sk-token'].test(token));
  assert.ok(lineRules['private-key-header'].test(header));
  assert.ok(!lineRules['cgnat-address'].test(['100', '128', '0', '1'].join('.')));
  assert.ok(!lineRules['cgnat-address'].test(['100', '63', '0', '1'].join('.')));
  assert.ok(!lineRules['user-home-path'].test('/Users/<name>/x'));
});

test('扫描器能扫出临时目录里的命中、超大文件，并跳过二进制', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'scan-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), `ok\nhome ${['/Users', 'someone', 'x'].join('/')}\n`);
    fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(maxFileBytes + 10));
    fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
    const hits = scanFiles(['a.txt', 'big.txt', 'bin.dat'], { root: dir });
    const names = hits.map((hit) => `${hit.file}:${hit.rule}`).sort();
    assert.deepEqual(names, ['a.txt:user-home-path', 'big.txt:oversize-file']);
    const withWords = scanFiles(['a.txt'], { root: dir, wordlist: ['home'] });
    assert.ok(withWords.some((hit) => hit.rule === 'private-word'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('清单里有目录、符号链接、读不了的项时，分别记类并点名，不抛错', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'scan-'));
  try {
    fs.writeFileSync(path.join(dir, 'real.txt'), 'plain\n');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.symlinkSync('real.txt', path.join(dir, 'link.txt'));
    fs.symlinkSync('nowhere', path.join(dir, 'broken'));
    const hits = scanFiles(['real.txt', 'sub', 'link.txt', 'broken', 'gone'], { root: dir });
    const names = hits.map((hit) => `${hit.file}:${hit.rule}`).sort();
    assert.deepEqual(names, [
      'broken:skipped-symlink',
      'gone:skipped-unreadable',
      'link.txt:skipped-symlink',
      'sub:skipped-directory',
    ]);
    assert.deepEqual(listRepoFiles(dir).sort(), ['broken', 'link.txt', 'real.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('新增命中判定：基线之内放行，超出或未登记报出', () => {
  const hits = [
    { file: 'a', line: 1, rule: 'r', text: '' },
    { file: 'a', line: 2, rule: 'r', text: '' },
    { file: 'b', line: 1, rule: 'r', text: '' },
  ];
  assert.equal(newHits(hits, { 'a|r': 2, 'b|r': 1 }).length, 0);
  assert.equal(newHits(hits, { 'a|r': 1, 'b|r': 1 }).length, 2);
  assert.equal(newHits(hits, {}).length, 3);
  assert.equal(newHits(hits, {}, { 'a|r': { reason: 'x' } }).length, 1);
  assert.equal(newHits(hits, { 'a|r': 1 }, { 'b|r': { reason: 'x' } }).length, 2);
});

test('仓库里没有超出「待清理基线」的个人信息、地址、密钥形状或超大文件', () => {
  const hits = scanFiles(listRepoFiles());
  const fresh = newHits(hits, loadBaseline(), loadFixtures());
  const report = fresh.map((hit) => `${hit.file}:${hit.line} [${hit.rule}] ${hit.text}`).join('\n');
  assert.equal(fresh.length, 0, `发现基线之外的命中：\n${report}`);
});

test('私有词表扫描（没设 DSH_PUBLISH_SCAN_WORDLIST 就跳过）', (t) => {
  const wordlist = loadWordlist();
  if (!wordlist) return t.skip('未提供私有词表');
  const hits = scanFiles(listRepoFiles(), { wordlist }).filter((hit) => hit.rule === 'private-word');
  const fresh = newHits(hits, loadBaseline(), loadFixtures());
  const report = fresh.map((hit) => `${hit.file}:${hit.line}`).join('\n');
  assert.equal(fresh.length, 0, `私有词表命中（不回显词）：\n${report}`);
});
