// 第三轮复核 R3-1（命令写指令文件与规矩页）与 R3-2（命令替换）的补充变形用例。
// 这些是监工自己想到的写法，复核员的 review3-* 原样不动。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {classifyCommand} from '../command-policy.mjs';
import {buildProfile} from '../command-sandbox.mjs';
import {PROTECTED_FILES, protectedFileNames, isProtectedName} from '../protected-files.mjs';

const tick = String.fromCharCode(96);

// 搭一个最小的家目录与助理目录；返回判定函数。
function layout() {
  const hub = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fixe-cmd-')));
  const own = path.join(hub, 'bots', 'writer');
  const other = path.join(hub, 'bots', 'other');
  for (const d of [own, other, path.join(hub, 'config'), path.join(own, 'sub')]) {
    fs.mkdirSync(d, {recursive: true});
  }
  for (const f of [...PROTECTED_FILES, 'data.txt', 'note.md']) {
    fs.writeFileSync(path.join(own, f), '/etc/hosts\n');
    fs.writeFileSync(path.join(other, f), 'x\n');
  }
  fs.symlinkSync('规矩.md', path.join(own, 'rules-link'));
  fs.linkSync(path.join(own, 'AGENTS.local.md'), path.join(own, 'hard-copy.md'));
  const judge = (command, extra = {}) => classifyCommand({command, cwd: own,
    roots: {own, readable: [own], writable: [own]}, home: '/Users/nobody', hubHome: hub, ...extra});
  return {hub, own, judge};
}

test('受保护名单：三个内置文件，配置只能往上加，坏配置不减', () => {
  assert.deepEqual([...PROTECTED_FILES], ['AGENTS.md', '规矩.md', 'AGENTS.local.md']);
  assert.ok(protectedFileNames({page_file: '我的规矩.md'}).includes('我的规矩.md'));
  assert.ok(protectedFileNames({overlay_file: 'X.local.md'}).includes('X.local.md'));
  assert.deepEqual(protectedFileNames({bad_key: 1}), [...PROTECTED_FILES]);
  assert.ok(isProtectedName('agents.LOCAL.md'));
  assert.ok(isProtectedName('ＡＧＥＮＴＳ.md'));
  assert.ok(!isProtectedName('notes.md'));
});

test('R3-1 变形：重定向、tee、cp、mv、ln、sed 原地改、变量、上级目录、链接、内联 shell 全部拒', () => {
  const l = layout();
  for (const f of PROTECTED_FILES) {
    for (const cmd of [`echo x >> ${f}`, `echo x>${f}`, `echo x 1>> ${f}`, `cat data.txt > ${f}`, `> ${f}`,
      `printf x > ./${f}`, `tee ${f}`, `tee -a ${f}`, `echo x | tee -a ${f}`, `cp data.txt ${f}`,
      `mv data.txt ${f}`, `mv ${f} gone.md`, `ln data.txt ${f}`, `ln ${f} hard`, `ln -s ${f} soft`,
      `sed -i '' s/a/b/ ${f}`, `sed -i.bak s/a/b/ ${f}`, `sed --in-place=.bak s/a/b/ ${f}`, `sed -Ei s/a/b/ ${f}`,
      `echo x >> sub/../${f}`, `echo x >> ../writer/${f}`, `echo x >> ${l.own}/${f}`, `echo x >> ../other/${f}`,
      `f=${f}; echo x >> $f`, `f=${f}; echo x >> "$f"`, `echo x >> "${f}"`, `echo x >> '${f}'`,
      `bash -c 'echo x >> ${f}'`, `sh -c "printf x > ${f}"`, `python3 -c "open('${f}','a')"`,
      `node -e "require('fs').appendFileSync('${f}','x')"`, `vi ${f}`, `truncate -s 0 ${f}`, `dd if=data.txt of=${f}`,
      `rm ${f}`, `touch ${f}`, `git checkout HEAD ${f}`, `awk -i inplace 1 ${f}`, `perl -pi -e s/a/b/ ${f}`,
      `install data.txt ${f}`, `echo x >> sub/${f}`]) {
      const got = l.judge(cmd);
      assert.equal(got.level, 'deny', `${cmd} 应永远拒绝，实际 ${got.level}：${got.reason}`);
      assert.equal(got.grantKey, null, cmd);
    }
  }
  for (const cmd of ['echo x >> agents.LOCAL.md', 'echo x >> 规*.md', 'echo x >> AGENTS.?ocal.md',
    'echo x >> rules-link', 'echo x >> hard-copy.md', 'tee rules-link', 'cp data.txt rules-link']) {
    assert.equal(l.judge(cmd).level, 'deny', cmd);
  }
  assert.equal(l.judge('echo x >> 我的规矩.md', {protectedNames: ['我的规矩.md']}).level, 'deny');
});

test('R3-1 只读查看受保护文件照旧放行，写普通文件照旧放行', () => {
  const l = layout();
  for (const cmd of ['cat 规矩.md', 'head -n 3 AGENTS.local.md', 'grep -n x AGENTS.md', 'wc -l 规矩.md',
    'echo ok > result.txt', 'echo ok >> data.txt', 'tee result.txt']) {
    assert.equal(l.judge(cmd).level, 'run', cmd + '：' + l.judge(cmd).reason);
  }
});

test('R3-2 变形：带引号、嵌套、换行、参数中间、进程替换、内联 shell 一律拒', () => {
  const l = layout();
  for (const cmd of ['cat $(cat note.md)', 'cat "$(cat note.md)"', 'cat "x$(cat note.md)y"', 'cat a$(cat note.md)',
    'cat $( cat note.md )', 'cat $(echo $(cat note.md))', 'cat $(\ncat note.md\n)', `cat ${tick}cat note.md${tick}`,
    `cat "${tick}cat note.md${tick}"`, `cat x${tick}cat note.md${tick}y`, 'diff <(cat data.txt) data.txt',
    'cat <(cat note.md)', 'echo x | tee >(cat)', 'echo ok && cat $(cat note.md)', 'ls -l $(cat note.md)',
    'head -n $(cat note.md) data.txt', 'grep x $(cat note.md)', 'cat -- $(cat note.md)',
    "bash -c 'cat $(cat note.md)'", 'sh -c "cat \\$(cat note.md)"', "ssh host 'cat $(id)'",
    "awk '{print $(1)}' data.txt", 'cat ${x:-$(cat note.md)}', 'echo $((1+2))', 'echo $(date)',
    'cat $(cat note.md) 2>/dev/null', 'echo x > $(cat note.md)']) {
    const got = l.judge(cmd);
    assert.equal(got.level, 'deny', `${cmd} 应永远拒绝，实际 ${got.level}：${got.reason}`);
    assert.equal(got.grantKey, null, cmd);
  }
  assert.equal(l.judge("echo '$(date)'").level, 'run', '单引号里只是字面量');
  assert.equal(l.judge("grep -n '$(' data.txt").level, 'run', '纯查看的字面量参数不拒');
  assert.equal(l.judge('echo \\$(date)').level, 'ask');
});

test('R3-1 真沙箱：受保护文件直接写、改名、删、链接、脚本写都被挡，普通文件照写', () => {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fixe-sb-')));
  const own = path.join(home, 'work', 'bots', 'w');
  fs.mkdirSync(path.join(own, '.tmp'), {recursive: true});
  for (const f of [...PROTECTED_FILES, '我的规矩.md', 'ok.txt']) {
    fs.writeFileSync(path.join(own, f), 'orig\n');
  }
  fs.symlinkSync('规矩.md', path.join(own, 'sl'));
  const profile = buildProfile({home, hubHome: path.join(home, 'work'), own, readable: [own],
    protectedNames: ['我的规矩.md']});
  const run = command => spawnSync('/usr/bin/sandbox-exec', ['-p', profile, '--', '/bin/bash', '--noprofile', '--norc',
    '-c', command], {cwd: own, encoding: 'utf8', env: {PATH: '/usr/bin:/bin', HOME: home, TMPDIR: own + '/.tmp'}});
  for (const cmd of ['echo x >> 规矩.md', 'echo x > AGENTS.local.md', 'echo x > agents.LOCAL.md', 'echo x >> AGENTS.md',
    'echo x >> sl', 'mv 规矩.md moved', 'rm AGENTS.local.md', 'ln 规矩.md hard', 'cp ok.txt 规矩.md',
    'echo x > 我的规矩.md', 'mkdir -p sub && echo x > sub/规矩.md',
    '/usr/bin/python3 -B -c "open(\'规矩.md\',\'a\').write(\'x\')"']) {
    const r = run(cmd);
    assert.notEqual(r.status, 0, cmd + ' 竟然成功');
  }
  for (const f of [...PROTECTED_FILES, '我的规矩.md']) {
    assert.equal(fs.readFileSync(path.join(own, f), 'utf8'), 'orig\n', f + ' 被改了');
  }
  assert.ok(!fs.existsSync(path.join(own, 'hard')));
  assert.equal(run('echo y >> ok.txt && echo z > new.txt').status, 0);
  assert.equal(fs.readFileSync(path.join(own, 'ok.txt'), 'utf8'), 'orig\ny\n');
});
