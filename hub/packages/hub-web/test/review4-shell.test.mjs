// 第四轮独立复核（路41）：新界面壳拼 HTML 字符串时，来自名册的名字没转义。
// 壳文件默认取本克隆的 shell/DSH-Hub.html；可用环境变量 R4_SHELL 指到别处的壳。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = fs.readFileSync(process.env.R4_SHELL ?? path.join(here, '..', 'shell', 'DSH-Hub.html'), 'utf8');

// 发现 R4-13（中）：输入框 placeholder、助理下拉 option 里直接拼名字；名字含引号或尖括号即可跳出属性或伪造标签。
test('R4-13 壳里拼 HTML 的地方，助理名字都要经过 esc()', () => {
  const unescaped = [
    /placeholder="向 '\+botBy\(state\.bot\)\.name\+'/,
    /'>'\+x\.name\+'<\/option>'/,
    /'<p class="muted">'\+botBy\([a-z.]+\)\.name\+/,
  ];
  for (const re of unescaped) {
    assert.equal(re.test(shell), false, '壳里还有未转义的名字：' + re);
  }
});
