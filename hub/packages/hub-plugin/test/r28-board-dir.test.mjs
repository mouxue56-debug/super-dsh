// 插件读看板目录与 BFF 用同一个展开函数（上线时插件不展开 $HUB_HOME/，看板配置失效）。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {boardConfig} from '../tools/index.mjs';
import {configuredPath} from '../../hub-bff/lib/ext/index.mjs';

const home = path.join(path.sep, 'h', 'user');
const hubHome = path.join(path.sep, 'h', 'user', 'hub');

test('board_dir 写 $HUB_HOME/、$HOME/、~/ 时插件与 BFF 展开成同一个绝对路径', () => {
  for (const value of ['$HUB_HOME/board', '$HOME/hub/board', '~/hub/board']) {
    const plugin = boardConfig({home, hubHome, board_dir: value}).dir;
    const bff = configuredPath(value, {home, hubHome});
    assert.equal(plugin, path.join(hubHome, 'board'));
    assert.equal(plugin, bff);
  }
});

test('现有绝对路径照常可用，缺省仍是 HUB_HOME/board', () => {
  const abs = path.join(path.sep, 'data', 'board');
  assert.equal(boardConfig({home, hubHome, board_dir: abs}).dir, abs);
  assert.equal(boardConfig({home, hubHome}).dir, path.join(hubHome, 'board'));
});

test('board.dir 与 board_dir 一个写变量一个写绝对路径、展开后相同不算冲突；真不同仍停用', () => {
  const same = {home, hubHome, board_dir: path.join(hubHome, 'board'), board: {dir: '$HUB_HOME/board'}};
  assert.equal(boardConfig(same).dir, path.join(hubHome, 'board'));
  const diff = {home, hubHome, board_dir: '$HUB_HOME/a', board: {dir: '$HUB_HOME/b'}};
  assert.throws(() => boardConfig(diff), /不一致/u);
});

test('展开后仍不是绝对路径的照旧拒', () => {
  assert.throws(() => boardConfig({home, hubHome, board_dir: 'relative/board'}), /绝对路径/u);
});
