import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEvidence } from '../lib/group-review.mjs';
import { validName } from '../lib/roster.mjs';

test('占位证据的全角与空白变体被拒绝', () => {
  // 修H 收窄：省略号等符号本身不再算占位，这里只留占位话的变体。
  for (const value of ['查看 a.md （写 看到了什么）', '查看 <文件路径> 已核对', '查看 a.md 后看到了 什么']) {
    assert.equal(checkEvidence(value).ok, false, value);
  }
});

test('名字允许文字与安全标点，拒绝危险符号', () => {
  for (const name of ['名字·一', '甲 (二)', '名称-3']) assert.equal(validName(name), true);
  for (const name of ['甲`乙', '甲&乙', '甲<乙', '甲\n乙', '甲"乙']) {
    assert.equal(validName(name), false);
  }
});

import fs from 'node:fs';
import path from 'node:path';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { setGroupStatus } from '../lib/group.mjs';
import { ROSTER, fakeSessions, planInput, tempDir } from './group-runtime-fixture.mjs';

async function setup(reply) {
  const dataDir = tempDir('fixh-data-');
  const hubHome = fs.realpathSync(tempDir('fixh-home-'));
  const sessions = fakeSessions(reply ? { '*': async () => reply } : {});
  const rt = createGroupRuntime({ dataDir, hubHome, roster: ROSTER, sessions });
  const input = planInput();
  input.tickets = [input.tickets[0]];
  const { group } = await rt.propose(input);
  const { tickets } = await rt.confirm(group.id, { approved: true });
  await rt.idle();
  return { dataDir, hubHome, rt, group, ticket: tickets[0], sessions };
}

test('交单拒绝缺失文件、空格文件名及符号链接，资料块包住真实路径', async () => {
  const h = await setup();
  const own = path.join(h.hubHome, 'group-work', h.group.id, h.ticket.assignee);
  // 产出要有可引的原文（第一行会被系统摘作例子，验收引第二行）。
  fs.writeFileSync(path.join(own, 'valid.txt'), [
    '第一行留给系统摘作例子，这一行是产出说明',
    '第二行写着三家竞品的卖点和价格都已经列清',
    '第三行核实资料来源并写明了推荐选择理由', '',
  ].join('\n'));
  fs.writeFileSync(path.join(own, 'bad name.txt'), '内容');
  fs.symlinkSync('valid.txt', path.join(own, 'link.txt'));
  for (const file of ['missing.txt', 'bad name.txt', 'link.txt']) {
    await assert.rejects(h.rt.submit(h.group.id, h.ticket.id, { by: h.ticket.assignee, summary: '完成', file }));
  }
  await h.rt.submit(h.group.id, h.ticket.id, { by: h.ticket.assignee, summary: '完成', file: 'valid.txt' });
  await h.rt.idle();
  const wake = h.sessions.sent.findLast((row) => row.text.includes('做的人的产出在'))?.text;
  assert.ok(wake.indexOf('<<资料-') < wake.indexOf('做的人的产出在'));
  assert.ok(wake.indexOf('做的人的产出在') < wake.indexOf('<<资料完-'));
  const fake = h.ticket.checklist.map((_, item) => ({ item, verdict: 'pass', evidence: '查看了 missing.txt 第一行' }));
  assert.equal((await h.rt.verify(h.group.id, h.ticket.id, { by: h.ticket.verifier, verdicts: fake })).ok, false);
  const real = h.ticket.checklist.map((_, item) => ({
    item, verdict: 'pass', evidence: `查看了 ${path.join(own, 'valid.txt')} 第二行：「${
      item === 0 ? '第二行写着三家竞品的卖点和价格都已经列清'
        : '第三行核实资料来源并写明了推荐选择理由'}」`,
  }));
  assert.equal((await h.rt.verify(h.group.id, h.ticket.id, { by: h.ticket.verifier, verdicts: real })).ok, true);
  h.rt.stop();
});

test('暂停组拒绝恢复交单，组编号不向非成员泄露', async () => {
  const h = await setup();
  await h.rt.__storeFor(h.group.id).update(h.ticket.id, {
    status: 'wait_owner', waitReason: 'no_submit', waitFrom: 'todo',
  });
  const outsider = ROSTER.find((row) => !h.group.members.some((member) => member.id === row.id));
  assert.throws(() => h.rt.resolve({ member: outsider.id, group: h.group.id, action: 'read' }));
  setGroupStatus(h.dataDir, h.group.id, 'paused');
  await assert.rejects(h.rt.submit(h.group.id, h.ticket.id, { by: h.ticket.assignee, summary: '完成' }));
  assert.equal((await h.rt.__storeFor(h.group.id).get(h.ticket.id)).status, 'wait_owner');
  h.rt.stop();
});


test('否定完成的多种说法不触发交单追问', async () => {
  for (const reply of ['还没做完', '没做完', '未做完', '未完成', '没完成', '尚未完成', '不算做完', '做完之前']) {
    const h = await setup(reply);
    assert.equal(h.sessions.sent.some((row) => row.text.includes('你说做完了但没交单')), false, reply);
    h.rt.stop();
  }
});

// 只拒示例占位话本身及其明显变体，……等符号本身不拒。
test('修H 收窄：带【AI 写】【Owner未确认】的真实引文加真实文件指针 → 收', async () => {
  const { checkEvidence: check } = await import('../lib/group-review.mjs');
  const ok = check('看了 notes/a.md 第 2 行：「【AI 写】【Owner未确认】新杯子保温十二小时，杯盖可拆洗……」');
  assert.equal(ok.ok, true, ok.reason);
});

test('修H 收窄：带全角括号说明的真实证据 → 收', async () => {
  const { checkEvidence: check } = await import('../lib/group-review.mjs');
  const ok = check('看了 drafts/out.md（第 2 段，标题下面）写的是「三家竞品价格分别是九十九元和一百二十元」');
  assert.equal(ok.ok, true, ok.reason);
});

test('修H 收窄：原样照抄示例、占位话后只加一两个字、只有指针 → 拒', async () => {
  const { checkEvidence: check } = await import('../lib/group-review.mjs');
  for (const text of ['证据：看了哪个文件的哪一处、看到了什么', '证据：看了哪个文件的哪一处、看到了什么好的',
    '证据： 看了 哪个文件 的 哪一处 、看到了 什么 ok', '看了 <文件路径> 里……（写看到了什么）',
    '看了 notes/a.md 里……（写看到了什么）', 'notes/a.md', '看了 notes/a.md', '看了 notes/a.md ……', '#3']) {
    assert.equal(check(text).ok, false, text);
  }
});
