// 验收证据改成结构性检查后的变形用例（引文要在这张单交的文件或做的人这张单下的消息里逐字找到）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { sampleQuote } from '../lib/group-evidence.mjs';
import { validRosterCard } from '../lib/roster.mjs';
import { ROSTER, fakeClock, fakeSessions, planInput, tempDir } from './group-runtime-fixture.mjs';

const LINES = [
  '第一行：这是系统会摘作例子的那一句话',
  '第二行：三家竞品的卖点和价格都已经逐一列清楚',
  '第三行：文案控制在三十字以内并用上一个卖点',
];

// 搭一个配了组文件夹的组，research 做、copy 验，research 交了 out.md。
async function start() {
  const sessions = fakeSessions();
  const hubHome = fs.realpathSync(tempDir('fixi-hub-'));
  const dataDir = tempDir('fixi-data-');
  const rt = createGroupRuntime({ dataDir, roster: ROSTER, sessions, now: fakeClock(), hubHome });
  const input = planInput({ members: ['research', 'copy'] });
  input.tickets = [input.tickets[0]];
  const { group } = await rt.propose(input);
  await rt.confirm(group.id, { approved: true });
  await rt.idle();
  const cell = (id) => path.join(hubHome, 'group-work', group.id, id);
  const file = path.join(cell('research'), 'out.md');
  fs.writeFileSync(file, LINES.join('\n') + '\n');
  await rt.submit(group.id, 'W1', { by: 'research', summary: '做完了', file });
  await rt.idle();
  return { rt, gid: group.id, cell, sessions };
}

const both = (evidence) => [1, 2].map((item) => ({
  item, verdict: 'pass', evidence: item === 2 && evidence.includes(LINES[1])
    ? evidence.replace(LINES[1], LINES[2]) : item === 2 && evidence.includes('三​十')
      ? evidence.replace(/「[^」]+」/u, `「${LINES[1]}」`) : evidence,
}));

test('修I 引交单文件里的真原文（非系统例子）→ 收', async () => {
  const env = await start();
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: both(`引自 out.md：「${LINES[1]}」`) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  env.rt.stop();
});

test('修I 出处只写文件名、或写做的人那格里的相对路径 → 收', async () => {
  for (const name of ['out.md', 'research/out.md']) {
    const env = await start();
    const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: both(`引自 ${name}：「${LINES[1]}」`) });
    assert.equal(r.ok, true, name + JSON.stringify(r.errors));
    env.rt.stop();
  }
});

test('修I 原样用系统摘的例子 → 拒，并说明要另摘', async () => {
  const env = await start();
  const sample = sampleQuote(LINES.join('\n'));
  const wake = env.sessions.sent.filter((row) => row.bot === 'copy').map((row) => row.text).join('\n');
  assert.ok(wake.includes(sample), '叫醒消息里的例子要是从真实产出摘的');
  assert.ok(wake.includes('原样用系统这句会被拒'));
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: both(`引自 out.md：「${sample}」`) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(''), /系统摘给你的例子/);
  env.rt.stop();
});

test('修I 改写过的引文、太短的引文、引自验收人自己格子的文件 → 拒', async () => {
  const env = await start();
  fs.writeFileSync(path.join(env.cell('copy'), 'mine.md'), '我自己写的这一句话足够长足够长足够长\n');
  for (const evidence of [
    '引自 out.md：「三家竞品卖点价格都列清楚了，没问题啊」',
    '引自 out.md：「三家竞品」',
    '引自 copy/mine.md：「我自己写的这一句话足够长足够长足够长」',
    '引自 #1：「第二行：三家竞品的卖点和价格都已经逐一列清楚」',
  ]) {
    const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: both(evidence) });
    assert.equal(r.ok, false, evidence);
  }
  env.rt.stop();
});

test('修I 夹零宽字符、全角空格的真引文仍认得出（只比实字）', async () => {
  const env = await start();
  const quote = LINES[2].replace('三十', '三​十').replace('卖点', '卖　点');
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: both(`引自 out.md：「${quote}」`) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  env.rt.stop();
});

test('修I 退回：理由太短或没指明哪一条 → 拒；写清第几条 → 收', async () => {
  const env = await start();
  const fail = (reason) => [{ item: 1, verdict: 'fail', evidence: '看了 out.md', reason },
    { item: 2, verdict: 'pass', evidence: `引自 out.md：「${LINES[1]}」` }];
  for (const reason of ['少一家', '这里写得还不够好需要再改一改才行吧']) {
    const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: fail(reason) });
    assert.equal(r.ok, false, reason);
  }
  const ok = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: fail('第 1 条没达到：只列了两家竞品，少一家') });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  env.rt.stop();
});

test('修I 旧名字改名卡：before 认旧名字，after 仍按新规则', () => {
  const kinds = { roles: ['helper'], shapes: ['circle'], colors: ['blue'] };
  const card = (before, after) => ({
    v: 1, bot: 'bchief0001', sessionId: 's1', level: 'L3', action: '改助理', tool: 'bot_update',
    path: '/x/config/bots.yaml', chars: 0, preview: '改助理', target: 'bhelper001', before, after, why: '改名',
  });
  assert.equal(validRosterCard(card({ name: '小帮&' }, { name: '小帮' }), kinds), true);
  assert.equal(validRosterCard(card({ name: '小帮' }, { name: '小帮！' }), kinds), false);
  assert.equal(validRosterCard(card({ name: '小/帮' }, { name: '小帮' }), kinds), false);
});
