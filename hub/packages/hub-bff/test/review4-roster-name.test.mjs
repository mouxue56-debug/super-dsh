// 第四轮独立复核（路41）：助理名字允许 < > " & ' 等 HTML 字符；新界面壳把名字拼进 HTML 字符串时没有转义（见 hub-web 的 review4-shell 测试）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validName } from '../lib/roster.mjs';
import { validateRoster } from '../../hub-plugin/roster.mjs';

// 发现 R4-12（中）：名册名字校验放过 HTML 元字符，后端来的名字可以在界面壳里伪造出标签（8 字以内如 <button>、"><u>）。
test('R4-12 名字不能含 < > " \' & 这类 HTML 元字符（后端校验）', () => {
  for (const name of ['<button>', '"><u>', 'a&b', "a'b", '<style>']) {
    assert.equal(validName(name), false, name);
  }
});

test('R4-12 插件侧名册校验同样不能放过', () => {
  const row = (name, id = 'helper', role = 'bot') => ({ id, name, role, preset: 'hub-' + id, status: 'active',
    avatar: { kind: 'role', role: 'helper' }, nameColor: 'blue', duty: '写笔记', notDuty: '', phrases: [], order: 0,
    createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z' });
  const roster = (name) => ({ version: 1, bots: [row('总管', 'leader', 'chief'), row(name)] });
  assert.doesNotThrow(() => validateRoster(roster('小文')), '前提：正常名字通过');
  for (const name of ['<button>', '"><u>']) {
    assert.throws(() => validateRoster(roster(name)), undefined, name);
  }
});
