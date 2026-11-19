// 路31 第三轮复核：任务书机器检查里的密钥字样，用不可见字符就能拆开。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectDispatch, normalizeConfig} from '../lib/dispatch-runner.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r3-scan-')));
const config = normalizeConfig({root, run_dir: path.join(root, 'runs'),
  workers: {worker: {argv: ['/bin/true'], models: ['m1']}}});
const base = {id: 'T-20261118-000000-abcd', legacy: false, state: 'queued', from: {name: 'bot', type: 'assistant'},
  to: ['worker'], routing: {model: 'm1'}, title: 't', forbidden: [], workdir: {path: null, writable: []},
  acceptance: [{check: '看', expect: '对'}], readExternalContent: false};
const check = goal => inspectDispatch({ticket: {...base, goal}, bot: 'bot', config, readExternal: false});

// 发现 6（低）：软连字符、双向控制符、不可见运算符夹在字样中间，机器检查认不出（NFKC 不会去掉它们）。
test('R3-6 夹不可见字符的密钥路径字样也要被拒', () => {
  assert.equal(check('读 ~/.secrets/x').ok, false, '对照：明文必须拒');
  for (const sep of ['­', '‮', '⁤', '؜', '͏', '️']) {
    const got = check(`读 ~/.sec${sep}rets/x`);
    assert.equal(got.ok, false, `U+${sep.codePointAt(0).toString(16)} 夹在中间被放过了`);
  }
});
