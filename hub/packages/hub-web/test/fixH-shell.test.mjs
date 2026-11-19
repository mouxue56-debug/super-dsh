import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync(new URL('../shell/DSH-Hub.html', import.meta.url), 'utf8');

test('助理名在输入框、看板和粒子图转义', { skip: '按旧版壳的变量名写的源码形状检查，待按新版壳改写' }, () => {
  assert.match(shell, /esc\(botBy\(state\.bot\)\.name\)/u);
  assert.match(shell, /esc\(botBy\(c\.bot\)\.name\)/u);
  assert.match(shell, /esc\(botBy\(c\.bot\)\.name\.slice\(0,2\)\)/u);
});
