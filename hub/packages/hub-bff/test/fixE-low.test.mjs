// 第三轮复核 R3-6（任务书密钥字样夹不可见字符）的补充变形。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectDispatch, normalizeConfig} from '../lib/dispatch-runner.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fixe-scan-')));
const config = normalizeConfig({root, run_dir: path.join(root, 'runs'),
  workers: {worker: {argv: ['/bin/true'], models: ['m1']}}});
const base = {id: 'T-20261118-000000-abcd', legacy: false, state: 'queued', from: {name: 'bot', type: 'assistant'},
  to: ['worker'], routing: {model: 'm1'}, title: 't', forbidden: [], workdir: {path: null, writable: []},
  acceptance: [{check: '看', expect: '对'}], readExternalContent: false};
const check = goal => inspectDispatch({ticket: {...base, goal}, bot: 'bot', config, readExternal: false});

test('R3-6 变形：标签字符、韩文填充符、蒙古文变体符、多个混夹、全角写法都认得出', () => {
  for (const sep of ['\u{E0020}', 'ㅤ', '᠋', '­‍⁦', '️\u{E0101}', 'ᅟ']) {
    assert.equal(check(`读 ~/.sec${sep}rets/x`).ok, false, `U+${sep.codePointAt(0).toString(16)} 被放过`);
  }
  assert.equal(check('读 ～／．ｓｅｃｒｅｔｓ／x').ok, false, '全角写法被放过');
});

test('R3-6 变形：正常中文、表情任务书不受影响', () => {
  assert.equal(check('把周报整理成三段，标题用 👨‍👩‍👧 表情').ok, true);
});
