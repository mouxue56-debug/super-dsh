import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { endShare, openShare, reconcileShares } from '../lib/group-share.mjs';
import { ROSTER, fakeSessions, planInput } from './group-runtime-fixture.mjs';

function setup() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'group-share-')));
  const dataDir = path.join(base, 'data');
  fs.mkdirSync(dataDir);
  const sessions = fakeSessions();
  const notices = [];
  const rt = createGroupRuntime({ dataDir, hubHome: base, roster: ROSTER, sessions,
    notify: (item) => notices.push(item) });
  const read = () => JSON.parse(fs.readFileSync(path.join(base, 'config', 'group-shares.json'), 'utf8'));
  return { base, dataDir, sessions, notices, rt, read };
}

test('批准展示放权并建目录，叫醒和验收包含路径，完成即撤权', async () => {
  const h = setup();
  const { group, card } = await h.rt.propose(planInput({ tickets: [planInput().tickets[0]] }));
  const dir = path.join(h.base, 'group-work', group.id);
  assert.match(card.bodyPreview, /确认即放权/);
  assert.match(card.text, /确认即放权/);
  const { tickets } = await h.rt.confirm(group.id, { approved: true });
  await h.rt.idle();
  const own = path.join(dir, tickets[0].assignee);
  assert.equal(h.read().shares[0].status, 'active');
  assert.equal(fs.statSync(own).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(h.base, 'config', 'group-shares.json')).mode & 0o777, 0o600);
  assert.ok(h.sessions.sent.some((item) => item.text.includes(`产出写到 ${own}/`)));
  const outside = path.join(h.base, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(own, 'escape'));
  for (const file of ['../copy/x', path.join(outside, 'x'), 'escape/x', '../COPY/x']) {
    await assert.rejects(h.rt.submit(group.id, tickets[0].id, { by: tickets[0].assignee, summary: '完成', file }),
      /交单文件必须在/);
  }
  // 交单文件必须真实存在于自己那一格。
  // 产出要有可引的原文（第一行会被系统摘作例子，验收引第二行）。
  fs.writeFileSync(path.join(own, 'result.txt'), [
    '第一行留给系统摘作例子，这一行是产出说明',
    '第二行写着三家竞品的卖点和价格都已经列清',
    '第三行核实资料来源并写明了推荐选择理由', '',
  ].join('\n'));
  await h.rt.submit(group.id, tickets[0].id, { by: tickets[0].assignee, summary: '完成', file: 'result.txt' });
  await h.rt.idle();
  assert.ok(h.sessions.sent.some((item) => item.text.includes(`做的人的产出在 ${own}/result.txt`)));
  await h.rt.verify(group.id, tickets[0].id, { by: tickets[0].verifier,
    verdicts: tickets[0].checklist.map((_, item) => ({
      item, verdict: 'pass', evidence: `${own}/result.txt 已核对：「${
        item === 0 ? '第二行写着三家竞品的卖点和价格都已经列清'
          : '第三行核实资料来源并写明了推荐选择理由'}」`,
    })) });
  assert.equal(h.read().shares[0].status, 'ended');
  h.rt.stop();
});

test('拒绝分工不建目录；启动撤销不在运行中的旧登记', async () => {
  const h = setup();
  const { group } = await h.rt.propose(planInput());
  await h.rt.confirm(group.id, { approved: false });
  assert.equal(fs.existsSync(path.join(h.base, 'group-work', group.id)), false);
  openShare({ hubHome: h.base, gid: group.id, members: ['research'] });
  h.rt.start();
  assert.equal(h.read().shares[0].status, 'ended');
  h.rt.stop();
});

test('结束登记保留文件，暂停登记保持有效', () => {
  const h = setup();
  const gid = 'g20261118120000abcd';
  openShare({ hubHome: h.base, gid, members: ['research'] });
  const file = path.join(h.base, 'group-work', gid, 'research', 'x');
  fs.writeFileSync(file, 'data');
  reconcileShares({ hubHome: h.base, statusOf: () => 'paused' });
  assert.equal(h.read().shares[0].status, 'active');
  endShare({ hubHome: h.base, gid });
  assert.equal(h.read().shares[0].status, 'ended');
  assert.equal(fs.readFileSync(file, 'utf8'), 'data');
});

test('目录创建失败时继续开工并通知，登记不放权', async () => {
  const h = setup();
  fs.writeFileSync(path.join(h.base, 'group-work'), 'blocked');
  const { group } = await h.rt.propose(planInput());
  const result = await h.rt.confirm(group.id, { approved: true });
  assert.equal(result.group.status, 'active');
  assert.ok(h.rt.view(group.id).messages.some((message) => message.text.includes('组文件夹没建成')));
  assert.ok(h.notices.some((item) => JSON.stringify(item).includes('组文件夹没建成')));
  assert.equal(fs.existsSync(path.join(h.base, 'config', 'group-shares.json')), false);
  await h.rt.idle();
  h.rt.stop();
});
