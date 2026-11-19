import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { loadGroup, saveGroup } from '../lib/group.mjs';
import { ROSTER, planInput, tempDir } from './group-runtime-fixture.mjs';
import { fixture, request } from './fixtures.mjs';

// 核验长卡文与分工表篡改保护。
test('长分工表保留全文校验，修改后不能确认', async () => {
  const dataDir = tempDir();
  const rt = createGroupRuntime({ dataDir, roster: ROSTER });
  const input = planInput();
  // 收口：单条验收项上限 200 字（X1），改用多条把卡文撑长；卡文截断格式随「看全文」改了，只断言不超 1000 字。
  input.tickets[0].checklist = Array.from({ length: 8 }, (_, i) => `第${i}条` + '验收'.repeat(90));
  const proposed = await rt.propose(input);
  const group = loadGroup(dataDir, proposed.group.id);
  assert.equal(group.planDigest.length, 64);
  assert.equal(proposed.card.summary, `分工表校验 ${group.planDigest.slice(0, 12)}`);
  assert.ok([...proposed.card.text].length <= 1000);
  assert.ok(rt.view(group.id).page.includes(input.tickets[0].checklist[7]));
  group.plan.tickets[0].goal = '改过的目标';
  saveGroup(dataDir, group);
  await assert.rejects(rt.confirm(group.id, { approved: true }), { code: 'CONFLICT' });
  assert.equal(rt.view(group.id).group.status, 'proposed');
  rt.stop();
});

// 核验同键并发去重以及读取接口的筛选。
test('消息幂等键并发重试与读取', async () => {
  const f = await fixture();
  try {
    const input = planInput();
    const members = f.handler.runtime.roster.list();
    input.by = members[0].id;
    input.members = members.slice(1, 3).map((member) => member.id);
    input.tickets = [{ title: '工作', goal: '完成', assignee: input.members[0], checklist: ['完成'] }];
    const proposed = await request(f.handler, { method: 'POST', path: '/groups/propose', value: input }).json();
    const base = `/groups/${proposed.group.id}`;
    const device = { 'x-hub-device': 'device' };
    await request(f.handler, { method: 'POST', path: `${base}/confirm`, headers: device,
      value: { approved: true } }).done;
    const headers = { ...device, 'idempotency-key': createHash('sha256').update('same').digest('hex') };
    const send = () => request(f.handler, { method: 'POST', path: `${base}/messages`, headers,
      value: { text: '消息', idem: 'ignored' } }).json();
    const [first, second] = await Promise.all([send(), send()]);
    assert.deepEqual(first, second);
    const read = await request(f.handler, { path: `${base}/messages?after=0&limit=1` }).json();
    assert.equal(read.messages.length, 1);
    assert.equal(read.messages[0].text, '消息');
    const page = await request(f.handler, { path: `${base}/page` }).json();
    assert.equal(typeof page.page, 'string');
  } finally {
    await f.handler.dispose();
    f.client.dispose();
  }
});
