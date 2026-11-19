// · 看板交接：共用小函数（外部身份名单、敏感内容拦截、建单入参、夜间静默）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalNames, scanSecrets, buildHandoffInput, isQuiet, DEFAULT_RETURN_WAY } from '../lib/handoff.mjs';
import { buildTicket } from '../lib/ticket.mjs';

test('外部身份名单：只认配置里合格的名字，去重；没配或配错都是空', () => {
  assert.deepEqual(externalNames({ externals: ['codex', 'grok-bot', 'codex', 'a b', '', 3, '../x'] }),
    ['codex', 'grok-bot']);
  for (const bad of [undefined, null, {}, { externals: 'codex' }, { externals: { a: 1 } }]) {
    assert.deepEqual(externalNames(bad), []);
  }
});

test('敏感内容拦截：各种像密钥、令牌的写法被拦，普通任务书不误伤', () => {
  const hits = [
    'key 是 sk-abcdefghijklmnop1', '令牌 dsb_abcdefghijklmnopqrstuvwx', 'ghp_abcdefghijklmnopqrstuvwxyz',
    'AKIAABCDEFGHIJKLMNOP', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz', '-----BEGIN ' + 'RSA PRIVATE KEY-----',
    'api_key=abcd1234efgh', '密码：hunter2hunter2', '去读 /Users/x/.secrets/deepseek', 'Zx9Qw3Er7Ty1Ui5Op2As4Df6Gh8Jk0Lq',
  ];
  for (const text of hits) assert.ok(scanSecrets(text), '应拦：' + text);
  const fine = [
    '把本周选题整理成清单，写进 /Users/x/work/topics.md', '基于提交 0123456789abcdef0123456789abcdef01234567 改',
    '完成标准：清单 10 条以内，每条一句话', 'token 数量统计一下（只是个词）', '',
  ];
  for (const text of fine) assert.equal(scanSecrets(text), null, '不该拦：' + text);
});

test('建单入参：派单人、接单身份、目标、完成标准、交回方式都落进工单，且能通过工单校验', () => {
  const input = buildHandoffInput({ from: 'chief', to: 'codex', title: '整理选题', goal: '把选题整理成清单',
    done: '10 条以内', returnWay: '放进 /work/out.md 后交回', sessionId: 's1', key: 'k1' });
  const ticket = buildTicket({ ...input, id: 'T-20261119-010203-abcd' }, { name: 'chief', type: 'assistant' });
  assert.deepEqual(ticket.to, ['codex']);
  assert.equal(ticket.from.name, 'chief');
  assert.equal(ticket.goal, '把选题整理成清单');
  assert.deepEqual(ticket.acceptance, [{ check: '完成标准', expect: '10 条以内' }]);
  assert.equal(ticket.routing.hint, '放进 /work/out.md 后交回');
  assert.equal(ticket.routing.requestedBy, 'chief');
  assert.equal(ticket.routing.via, 'handoff');
  assert.equal(ticket.sessions.from, 's1');
  assert.equal(ticket.expects_reply, true);
  const plain = buildHandoffInput({ from: 'chief', to: 'codex', goal: '做 A', done: '有 A' });
  assert.equal(plain.routing.hint, DEFAULT_RETURN_WAY);
  assert.equal(plain.title, '做 A');
});

test('建单入参：读过外部内容的会话，正文带「先核实」提醒并标记；缺目标或完成标准、坏名字、坏 key 都拒', () => {
  const tainted = buildHandoffInput({ from: 'chief', to: 'codex', goal: '做 A', done: '有 A', readExternal: true });
  assert.match(tainted.goal, /先核实/u);
  assert.equal(tainted.readExternalContent, true);
  for (const bad of [{ goal: '', done: 'x' }, { goal: 'x', done: ' ' }, { goal: 'x', done: 'y', to: '../a' },
    { goal: 'x', done: 'y', from: '' }, { goal: 'x', done: 'y', key: '带 空格' }]) {
    assert.throws(() => buildHandoffInput({ from: 'chief', to: 'codex', ...bad }), /无效|都要写|key/u);
  }
});

test('夜间静默：22:00 到 08:00 按配置时区算，边界准确', () => {
  const at = (h, m = 0) => Date.UTC(2026, 10, 19, h, m);
  assert.equal(isQuiet(at(21, 59)), false);
  assert.equal(isQuiet(at(22, 0)), true);
  assert.equal(isQuiet(at(2, 10)), true);
  assert.equal(isQuiet(at(7, 59)), true);
  assert.equal(isQuiet(at(8, 0)), false);
  assert.equal(isQuiet(at(14, 0), 8 * 60), true, '东八区的 14:00 UTC 是 22:00');
  assert.equal(isQuiet(NaN), false);
});
