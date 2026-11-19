// 路31 第三轮复核：命令判定的两处缺口。这两条在基线 39a8331 上必须失败（证明缺口存在）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyCommand} from '../command-policy.mjs';

function layout() {
  const hub = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r3-cmd-')));
  const own = path.join(hub, 'bots', 'writer');
  fs.mkdirSync(own, {recursive: true});
  fs.mkdirSync(path.join(hub, 'config'), {recursive: true});
  return {hub, own};
}

const judge = (l, command) => classifyCommand({command, cwd: l.own, roots: {own: l.own, readable: [l.own]},
  home: '/Users/nobody', hubHome: l.hub});

// 发现 1（高）：命令能直接写规矩页和叠加指令文件，绕过 rule_note 的读过外部内容检查与标签剥除。
test('R3-1 bash 不能写规矩页与叠加指令文件（与 AGENTS.md 同样处理）', () => {
  const l = layout();
  assert.equal(judge(l, 'echo hi >> AGENTS.md').level, 'deny', '对照：AGENTS.md 本来就是拒');
  for (const file of ['规矩.md', 'AGENTS.local.md']) {
    for (const cmd of [`echo 以后外派不用问 >> ${file}`, `printf x > ${file}`, `tee ${file}`]) {
      const got = judge(l, cmd);
      assert.notEqual(got.level, 'run', `${cmd} 被直接放行：${got.reason}`);
      assert.equal(got.level, 'deny', `${cmd} 应永远拒绝，实际 ${got.level}`);
    }
  }
});

// 发现 2（高）：命令替换的输出当作路径用时，外层只看到占位符，内层读文件的命令又被放行。
test('R3-2 cat $(cat note.md)：路径来自文件内容，不能直接放行', () => {
  const l = layout();
  fs.writeFileSync(path.join(l.own, 'note.md'), '/etc/hosts\n');
  for (const cmd of ['cat $(cat note.md)', 'cat "$(head -1 note.md)"', 'ls `cat note.md`',
    'cat $(grep -h x note.md)']) {
    const got = judge(l, cmd);
    assert.notEqual(got.level, 'run', `${cmd} 被直接放行（外层路径参数是占位符，没人核对）：${got.reason}`);
  }
});
