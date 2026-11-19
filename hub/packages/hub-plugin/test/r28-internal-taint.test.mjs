// 修G：只读过自己人写的内容时只读命令照常跑，其余先问；外部来源照旧全部先问。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyCommand} from '../command-policy.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r28-internal-')));
const own = path.join(home, 'hub', 'bots', 'a');
fs.mkdirSync(own, {recursive: true});
fs.writeFileSync(path.join(own, 'x.txt'), 'x\n');
fs.writeFileSync(path.join(own, 'run.sh'), 'echo hi\n');

function level(command, extra = {}) {
  return classifyCommand({
    command, cwd: own, roots: {own, readable: [own], writable: [own]}, home,
    hubHome: path.join(home, 'hub'), selfAddrs: [], sandboxActive: true, ...extra,
  }).level;
}

const internal = {internalTainted: true};

test('内部来源：只读命令照常直接跑', () => {
  for (const command of ['ls', 'pwd', 'cat x.txt', 'ls nope 2>/dev/null || echo 没有', 'grep -n x x.txt | head -3']) {
    assert.equal(level(command, internal), 'run', command);
  }
});

test('内部来源：写文件、跑脚本、内联代码、联网仍先问；命令替换照旧拒', () => {
  for (const command of ['echo y > y.txt', 'tee y.txt', 'sh run.sh', 'node -e 1', 'curl https://example.com']) {
    assert.equal(level(command, internal), 'ask', command);
  }
  assert.equal(level('echo y > y.txt'), 'run');
  assert.equal(level('cat $(ls)', internal), 'deny');
  assert.equal(level('cat ~/.ssh/id_rsa', internal), 'deny');
});

test('外部来源或两种都有：只读也先问', () => {
  assert.equal(level('ls', {tainted: true}), 'ask');
  assert.equal(level('ls', {tainted: true, internalTainted: true}), 'ask');
});

test('内部来源下放行规则不替代 主人 点头', () => {
  const grant = {id: 'g1', bot: 'a', program: 'curl', dir: own, until: '2999-01-01', caps: {network: true}};
  assert.equal(level('curl https://example.com', {bot: 'a', grants: [grant]}), 'run');
  assert.equal(level('curl https://example.com', {bot: 'a', grants: [grant], ...internal}), 'ask');
});
