import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { acceptTicket } from '../lib/group-review.mjs';
import { ROSTER, fakeClock, fakeSessions, planInput, withEvidence } from './group-runtime-fixture.mjs';

/** 建立独立测试组，并在测试结束后清理临时目录。 */
async function setup(t, answer = { status: 'answered', choice: 'approve' }, plan = planInput()) {
  const dir = fs.mkdtempSync(os.tmpdir() + '/r27-seam-group-');
  // 成员不回话（回 null）。原来默认回「过」；开工时回「过」现在会被追问并转主人，
  // 而本文件测的是存取与并发，与此无关。
  const sessions = fakeSessions({ '*': () => null });
  const rt = createGroupRuntime({
    dataDir: dir,
    roster: ROSTER,
    sessions,
    now: fakeClock(),
    cards: { ask: async () => answer },
  });
  t.after(async () => {
    await rt.idle();
    rt.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  withEvidence(rt, dir);
  const { group, card } = await rt.propose(plan);
  await rt.idle();
  return { rt, dir, sessions, gid: group.id, card };
}

/** 查找已投递的成员会话。 */
function memberSession(sessions, member) {
  const row = sessions.sent.find((entry) => entry.bot === member && entry.purpose === 'group-turn');
  assert.ok(row);
  return row.sid;
}

test('真实工具事件阻断空转，无事件的同文累计至暂停', async (t) => {
  const { rt, gid, sessions } = await setup(t);
  const member = rt.view(gid).tickets[0].assignee;
  const sid = memberSession(sessions, member);
  const limit = rt.view(gid).group.limits.idleLimit;
  for (let i = 0; i < limit - 1; i++) {
    await rt.onSessionReply(sid, { text: '谢谢' });
  }
  const reply = await rt.onSessionReply(sid, { text: '谢谢', toolEvents: [{ name: 'read' }, { name: 'write' }] });
  assert.equal(reply.message.toolCalls, 2);
  assert.equal(reply.pausedNow, false);
  for (let i = 0; i < limit; i++) {
    const result = await rt.onSessionReply(sid, { text: '谢谢' });
    assert.equal(result.pausedNow, i === limit - 1);
  }
  assert.equal(rt.view(gid).group.status, 'paused');
});

test('会话回话自报工具次数不能阻止空转', async (t) => {
  const { rt, gid, sessions } = await setup(t);
  const member = rt.view(gid).tickets[0].assignee;
  const sid = memberSession(sessions, member);
  const limit = rt.view(gid).group.limits.idleLimit;
  for (let i = 0; i < limit; i++) {
    const result = await rt.onSessionReply(sid, { text: '收到', toolCalls: 5 });
    assert.equal(result.message.toolCalls, 0);
    assert.equal(result.pausedNow, i === limit - 1);
  }
});

test('运行时看到的接单动作阻断空转', async (t) => {
  const { rt, gid, sessions } = await setup(t);
  const ticket = rt.view(gid).tickets[0];
  const sid = memberSession(sessions, ticket.assignee);
  const limit = rt.view(gid).group.limits.idleLimit;
  for (let i = 0; i < limit - 1; i++) {
    await rt.onSessionReply(sid, { text: '好的' });
  }
  await rt.accept(gid, ticket.id, { by: ticket.assignee, restatement: ticket.goal });
  const result = await rt.onSessionReply(sid, { text: '好的' });
  assert.equal(result.message.toolCalls, 1);
  assert.equal(result.pausedNow, false);
});

test('非执行者在运行时和工单层均不能接单', async (t) => {
  const { rt, gid } = await setup(t);
  const ticket = rt.view(gid).tickets[0];
  await assert.rejects(rt.accept(gid, ticket.id, { by: ticket.verifier, restatement: ticket.goal }), /只有做的人/);
  await assert.rejects(acceptTicket({
    store: rt.__storeFor(gid),
    ticketId: ticket.id,
    by: ticket.verifier,
    restatement: ticket.goal,
  }), /只有执行者/);
});

test('并发期望状态更新仅一次成功，仅写一次文件', async (t) => {
  const { rt, dir, gid } = await setup(t);
  const ticket = rt.view(gid).tickets[0];
  const store = rt.__storeFor(gid);
  const target = path.join(dir, 'groups', gid, 'tickets.json');
  const rename = fs.renameSync;
  let writes = 0;
  fs.renameSync = (...args) => {
    if (args[1] === target) {
      writes++;
    }
    return rename(...args);
  };
  let results;
  try {
    results = await Promise.allSettled([
      store.update(ticket.id, { status: 'doing' }, { expect: { status: 'todo' } }),
      store.update(ticket.id, { status: 'doing' }, { expect: { status: 'todo' } }),
    ]);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected']);
  assert.match(results[1].reason.message, /工单状态已变，冲突/);
  assert.equal(writes, 1);
  assert.equal((await store.get(ticket.id)).status, 'doing');
});

test('期望状态不符时文件内容不变', async (t) => {
  const { rt, dir, gid } = await setup(t);
  const ticket = rt.view(gid).tickets[0];
  const file = path.join(dir, 'groups', gid, 'tickets.json');
  const before = fs.readFileSync(file);
  await assert.rejects(rt.__storeFor(gid).update(ticket.id, { status: 'doing' }, {
    expect: { status: 'todo', rejections: 1 },
  }), /工单状态已变，冲突/);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('并发验收只成功一次，状态变化后不再写工单', async (t) => {
  const { rt, dir, gid } = await setup(t);
  const ticket = rt.view(gid).tickets[0];
  await rt.accept(gid, ticket.id, { by: ticket.assignee, restatement: ticket.goal });
  await rt.submit(gid, ticket.id, { by: ticket.assignee, summary: '结果见 drafts/result.md' });
  await rt.idle();
  const verdicts = ticket.checklist.map((item, i) => ({
    item: i,
    verdict: 'pass',
    evidence: `已核对 drafts/result.md 第 ${i + 1} 项`,
  }));
  const target = path.join(dir, 'groups', gid, 'tickets.json');
  const rename = fs.renameSync;
  let writes = 0;
  fs.renameSync = (...args) => {
    if (args[1] === target) {
      writes++;
    }
    return rename(...args);
  };
  let results;
  try {
    results = await Promise.all([
      rt.verify(gid, ticket.id, { by: ticket.verifier, verdicts }),
      rt.verify(gid, ticket.id, { by: ticket.verifier, verdicts }),
    ]);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(results.map((result) => result.ok).sort(), [false, true]);
  assert.match(results.find((result) => !result.ok).errors.join(' '), /工单不在验收状态/);
  assert.equal(writes, 1);
});

test('卡片批准后开工，保留每张单的做与验', async (t) => {
  const plan = planInput({ name: '长标题'.repeat(13) }); // 收口：组名上限 40 字（X1）
  const { rt, gid, card } = await setup(t, { status: 'answered', choice: 'approve' }, plan);
  assert.equal(rt.view(gid).group.status, 'active');
  assert.ok([...card.title].length <= 40);
  assert.ok(!card.what.startsWith('做什么'));
  for (const ticket of rt.view(gid).tickets) {
    const assignee = ROSTER.find((row) => row.id === ticket.assignee).name;
    const verifier = ROSTER.find((row) => row.id === ticket.verifier).name;
    assert.ok(card.bodyPreview.includes(`做：${assignee}，验：${verifier}`));
  }
});

test('卡片超时保留待确认，拒绝则取消', async (t) => {
  const timed = await setup(t, { status: 'timeout', choice: null });
  assert.equal(timed.rt.view(timed.gid).group.status, 'proposed');
  await timed.rt.confirm(timed.gid, { approved: true });
  assert.equal(timed.rt.view(timed.gid).group.status, 'active');
  const rejected = await setup(t, { status: 'answered', choice: 'reject' });
  assert.equal(rejected.rt.view(rejected.gid).group.status, 'cancelled');
});
