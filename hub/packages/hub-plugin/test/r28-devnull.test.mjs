// 丢弃输出到字面上的 /dev/null 不算写文件；其余判定不放松。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyCommand} from '../command-policy.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r28-devnull-')));
const own = path.join(home, 'hub', 'bots', 'a');
fs.mkdirSync(own, {recursive: true});
fs.writeFileSync(path.join(own, 'x.txt'), 'x\n');
fs.symlinkSync('/dev/null', path.join(own, 'null-link'));

function level(command) {
  return classifyCommand({
    command,
    cwd: own,
    roots: {own, readable: [own], writable: [own]},
    home,
    hubHome: path.join(home, 'hub'),
    selfAddrs: [],
  }).level;
}

test('只读命令把输出或错误输出丢进 /dev/null 直接跑', () => {
  for (const command of [
    'ls x.txt 2>/dev/null || echo 没有',
    'ls nope 2>/dev/null || echo "没有"',
    'cat x.txt >/dev/null',
    'ls x.txt >/dev/null 2>&1',
    'ls x.txt &>/dev/null',
    'ls x.txt &>>/dev/null',
    'ls x.txt 2>>/dev/null',
    'ls x.txt 2> /dev/null',
    'ls x.txt 2>&1 | head -5',
    'ls -la . 2>/dev/null && cat x.txt 2>/dev/null || echo 没有',
  ]) {
    assert.equal(level(command), 'run', command);
  }
});

test('不是字面上的 /dev/null 一律不算丢弃', () => {
  for (const command of [
    'ls 2>/dev/../dev/null',
    'ls 2>/dev//null',
    'ls 2>/dev/null/',
    'ls 2>/dev/nullx',
    'ls 2>null-link',
    'ls &>/dev/./null',
  ]) {
    assert.notEqual(level(command), 'run', command);
  }
  for (const command of [
    'ls 2>"$N"',
    'ls 2>$NULL',
    'ls 2>/dev/nul?',
    'ls 2>$(echo /dev/null)',
    'ls 2>`echo /dev/null`',
  ]) {
    assert.equal(level(command), 'deny', command);
  }
});

test('其余判定照旧：命令替换、受保护文件、凭据、后台进程', () => {
  assert.equal(level('cat $(ls) 2>/dev/null'), 'deny');
  assert.equal(level('echo hi >AGENTS.md 2>/dev/null'), 'deny');
  assert.equal(level('echo hi &>AGENTS.md'), 'deny');
  assert.equal(level('cat ~/.ssh/id_rsa 2>/dev/null'), 'deny');
  assert.equal(level('ls 2>/dev/null &'), 'ask');
  assert.equal(level('ls &>/etc/hosts'), 'deny');
  assert.equal(level('curl https://example.com 2>/dev/null'), 'ask');
  assert.equal(level('ls 2>/dev/null; codex'), 'ask');
});
