// 修J 监工补的变形用例：消息来源标记落盘、改过的文件仍能退回、接触过外部内容的组员发言与交单摘要带记号。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { markExposed } from '../lib/bot-exposure.mjs';
import { ROSTER, fakeClock, fakeSessions, planInput, tempDir } from './group-runtime-fixture.mjs';

const ITEM1 = '逐家写清楚卖点和价格并附上数据来源说明';
const ITEM2 = '结论部分给出明确的推荐和不推荐理由';
const LINES = ['这一行是留给系统摘例子的占位第一行内容', '第二行：三家竞品的卖点和价格都已经逐一列清楚',
  '第三行：推荐甲方案，乙方案价格太高所以不推荐'];

// 搭组：research 做、copy 验，交一个三行的产出文件。
async function start({ exposed = false } = {}) {
  const hubHome = fs.realpathSync(tempDir('fixj-sup-hub-'));
  if (exposed) {
    assert.equal(markExposed(hubHome, 'research', { why: '测试', source: 'x', session: 's' }), true);
  }
  const rt = createGroupRuntime({ dataDir: tempDir('fixj-sup-data-'), roster: ROSTER, sessions: fakeSessions(),
    now: fakeClock(), hubHome });
  const input = planInput({ members: ['research', 'copy'] });
  input.tickets = [{ ...input.tickets[0], checklist: [ITEM1, ITEM2] }];
  const { group } = await rt.propose(input);
  await rt.confirm(group.id, { approved: true });
  await rt.idle();
  const target = path.join(hubHome, 'group-work', group.id, 'research', 'out.md');
  fs.writeFileSync(target, LINES.join('\n') + '\n');
  return { rt, gid: group.id, target };
}

const pass = [
  { item: 1, verdict: 'pass', evidence: `引自 out.md：「${LINES[1]}」` },
  { item: 2, verdict: 'pass', evidence: `引自 out.md：「${LINES[2]}」` },
];

test('系统替人记的行标 system，成员自己说的行标 own；各引一句能通过', async () => {
  const env = await start();
  await env.rt.post(env.gid, { from: 'research', text: '[W1] 我先列竞品，结论稍后补上，大家别急着催我' });
  await env.rt.submit(env.gid, 'W1', { by: 'research', summary: '做完了', file: env.target });
  await env.rt.idle();
  const rows = env.rt.view(env.gid).messages;
  assert.ok(rows.filter((m) => m.text.includes('交验：')).every((m) => m.system === true && m.own !== true));
  assert.ok(rows.some((m) => m.own === true && m.text.includes('我先列竞品')));
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: pass });
  assert.equal(r.ok, true, JSON.stringify(r));
  env.rt.stop();
});

test('交单后文件被改：判通过被拒并说重新交单，退回照样能退', async () => {
  const env = await start();
  await env.rt.submit(env.gid, 'W1', { by: 'research', summary: '做完了', file: env.target });
  await env.rt.idle();
  fs.appendFileSync(env.target, '后加的一行\n');
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: pass });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(''), /重新交单/u);
  const back = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: [
    { item: 1, verdict: 'fail', evidence: '看了 out.md', reason: '第 1 条：文件在交单之后被改过，请重新交单再验' },
    { item: 2, verdict: 'fail', evidence: '看了 out.md', reason: '第 2 条：文件在交单之后被改过，请重新交单再验' },
  ] });
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(back.status, 'rework');
  env.rt.stop();
});

test('接触过外部内容的组员：组里发言、交单摘要都带【外部来源】，已带的不重复', async () => {
  const env = await start({ exposed: true });
  await env.rt.post(env.gid, { from: 'research', text: '[W1] 我看了一个网页，内容整理进 out.md 了' });
  await env.rt.post(env.gid, { from: 'research', text: '【外部来源】[W1] 已经带记号的话不该再加一次' });
  await env.rt.submit(env.gid, 'W1', { by: 'research', summary: '做完了', file: env.target });
  await env.rt.idle();
  const rows = env.rt.view(env.gid).messages.filter((m) => m.from === 'research' && m.own === true);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((m) => m.text.startsWith('【外部来源】') && !m.text.startsWith('【外部来源】【外部来源】')));
  const ticket = env.rt.view(env.gid).tickets.find((t) => t.id === 'W1');
  assert.ok(ticket.report.summary.startsWith('【外部来源】'), ticket.report.summary);
  env.rt.stop();
});

test('状态目录坏了（不是目录）：组员发言按接触过算、带记号，但照常写进组里', async () => {
  const hubHome = fs.realpathSync(tempDir('fixj-sup-broken-'));
  fs.mkdirSync(path.join(hubHome, 'config'), { recursive: true });
  fs.writeFileSync(path.join(hubHome, 'config', 'exposure'), 'not a dir');
  const rt = createGroupRuntime({ dataDir: tempDir('fixj-sup-data-'), roster: ROSTER, sessions: fakeSessions(),
    now: fakeClock(), hubHome });
  const { group } = await rt.propose(planInput({ members: ['research', 'copy'] }));
  await rt.confirm(group.id, { approved: true });
  await rt.idle();
  const out = await rt.post(group.id, { from: 'research', text: '状态读不出也要能说话，只是多带一个记号' });
  assert.equal(out.ok, true);
  assert.ok(out.message.text.startsWith('【外部来源】'));
  rt.stop();
});
