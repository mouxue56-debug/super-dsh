// 常见凭据多拦几种；外部接触状态不完整就拒绝写入。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {register, secretKind} from '../tools/memory.mjs';

function setup(state) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), '.review8-fixL-memory-')));
  fs.mkdirSync(path.join(root, 'bots', 'writer'), {recursive: true});
  fs.mkdirSync(path.join(root, 'config'), {recursive: true});
  fs.writeFileSync(
    path.join(root, 'config', 'permission-mode.json'),
    '{"v":1,"mode":"open"}\n',
    {mode: 0o600},
  );
  const tools = {};
  register({
    tools: {register: item => { tools[item.name] = item; }},
    logger: {},
  }, {
    hubConfig: {hubHome: root, timezone: 'UTC'},
    state,
    now: () => new Date('2026-11-19T12:00:00Z'),
    log: () => {},
  });
  const change = (text, call = {}) => tools.memory_change.execute(
    {which: 'new', text},
    {},
    {bot: 'writer', sessionId: 'session', turn: 1, readExternal: false, ...call},
  );
  return {root, change};
}

test('令牌前缀、私钥头、名字=值、长高熵串都拦住，普通句子放过', () => {
  const token = 'ghp_' + 'A'.repeat(36);
  const gitlab = 'glpat-' + 'b'.repeat(20);
  const slack = 'xoxb-' + '1'.repeat(12) + '-' + 'a'.repeat(12);
  const header = '-----BEGIN ' + 'OPENSSH' + ' PRIVATE KEY-----';
  const named = 'GITHUB_TOKEN=' + 'c'.repeat(16);
  const noisy = 'aB3xY9kQ2vL8pN4sT7wZ1cX6bH0d';
  for (const text of [token, gitlab, slack, header, named, noisy]) {
    assert.equal(secretKind(text), 'key', text.slice(0, 12));
  }
  assert.equal(secretKind('password=abc123'), 'login');
  assert.equal(secretKind('喜欢短句'), null);
  assert.equal(secretKind('2026-11-19 开会'), null);
  assert.equal(secretKind('不要把密钥写进记忆'), null);
});

test('这些凭据写不进去，并说明只是尽力拦', async () => {
  const h = setup(() => ({readExternal: false}));
  await assert.rejects(h.change('hf_' + 'd'.repeat(20)), /不能记/);
  await assert.rejects(h.change('hf_' + 'd'.repeat(20)), /尽力拦/);
  await assert.rejects(h.change('-----BEGIN ' + 'PGP PRIVATE KEY BLOCK-----'), /不能记/);
  assert.equal(fs.existsSync(path.join(h.root, 'bots', 'writer', 'memory', '关于主人.md')), false);
});

test('状态是空、形状不对、会话对不上，都不能写；明确没接触过才能写', async () => {
  const blank = setup(() => ({}));
  await assert.rejects(blank.change('记住天气'), /外部内容/);
  const broken = setup(() => null);
  await assert.rejects(broken.change('记住天气'), /外部内容/);
  const text = setup(() => 'no');
  await assert.rejects(text.change('记住天气'), /外部内容/);
  const list = setup(() => ['readExternal']);
  await assert.rejects(list.change('记住天气'), /外部内容/);
  const other = setup(() => ({readExternal: false, bot: 'other'}));
  await assert.rejects(other.change('记住天气'), /外部内容/);
  const missingCall = setup(() => ({readExternal: false}));
  await assert.rejects(missingCall.change('记住天气', {readExternal: undefined}), /外部内容/);
  const clean = setup(() => ({readExternal: false, bot: 'writer'}));
  const saved = await clean.change('喜欢短句');
  assert.match(saved, /已新记一条/);
});
