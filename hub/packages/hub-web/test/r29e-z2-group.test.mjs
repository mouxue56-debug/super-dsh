import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
const start = source.indexOf('  function r29FeedMessages(');
const end = source.indexOf('  async function r29PullGroup(', start);
const kindStart = source.indexOf('  function r29ShellKind(');
const kindEnd = source.indexOf('  function r29Duty(', kindStart);
const context = { r29PlanMessages: () => [] };
context.r29ShellKind = vm.runInNewContext('(' + source.slice(kindStart, kindEnd).trim() + ')');
const feed = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', context);

test('真实工单状态映射事件，普通发言不能冒充', () => {
  const statuses = ['todo', 'review', 'done', 'rework', 'wait_owner'];
  const tickets = statuses.map((status, i) => ({ id: String(i), status, title: '工单' }));
  const messages = [{ id: 1, from: 'aa', text: '等主人验收通过' }];
  const rows = feed({ id: 'g' }, { members: [], tickets, messages });
  assert.equal(rows[0].type, undefined);
  assert.deepEqual(Array.from(rows.slice(1), row => row.type), ['handoff', 'handback', 'accept', 'reject', 'ask']);
});
