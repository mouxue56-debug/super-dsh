// 第五轮独立复核（路51）：后端讨论组运行时与验收证据。每条测试都在 87bf901 上失败，证明对应发现；通过即视为已修。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { checkEvidence } from '../lib/group-review.mjs';
import { ROSTER, fakeClock, fakeSessions, planInput, tempDir } from './group-runtime-fixture.mjs';

function plan() {
  const input = planInput({ members: ['research', 'copy'] });
  input.tickets = [input.tickets[0]];
  return input;
}

// 搭运行时并开工：research 做、copy 验；research 已交单（带真实文件 out.md）。
async function start({ realHome = true, withHome = true } = {}) {
  const sessions = fakeSessions();
  const dataDir = tempDir('r5-data-');
  const hubHome = realHome ? fs.realpathSync(tempDir('r5-hub-')) : tempDir('r5-hub-');
  const rt = createGroupRuntime({ dataDir, roster: ROSTER, sessions, now: fakeClock(), ...(withHome ? { hubHome } : {}) });
  const { group } = await rt.propose(plan());
  await rt.confirm(group.id, { approved: true });
  await rt.idle();
  const cell = (id) => path.join(hubHome, 'group-work', group.id, id);
  return { rt, gid: group.id, hubHome, dataDir, cell };
}

async function submitOut(env) {
  const file = path.join(env.cell('research'), 'out.md');
  fs.writeFileSync(file, '产出\n');
  await env.rt.submit(env.gid, 'W1', { by: 'research', summary: '做完了', file });
  await env.rt.idle();
}

const verdicts = (evidence) => [1, 2].map((item) => ({ item, verdict: 'pass', evidence }));

// R5-G1（中）：占位词表只在「整句证据」上比，「通过 + 一个文件名」就能蒙混：指针有了，「看到了什么」被当成「通过」两个字。
test('R5-G1 「通过 a.md」「pass notes/a.md」「lgtm」加文件名不应算证据', () => {
  for (const text of ['通过 notes/a.md', '已通过 report.md', 'pass notes/a.md', 'lgtm a.md', '没问题 out.md 完成']) {
    assert.equal(checkEvidence(text).ok, false, text);
  }
});

// R5-G2（中）：重复字符、乱码凑够长度加指针。
test('R5-G2 重复字符或无意义字母加指针不应算证据', () => {
  for (const text of ['notes/a.md aaaaaaaaaa', '#1 zzzzzzzzzzzz', 'notes/a.md 啊啊啊啊啊啊啊啊', 'a.md asdfghjkl']) {
    assert.equal(checkEvidence(text).ok, false, text);
  }
});

// R5-G3（中）：占位话里夹一个零宽字符/中点就不再被识别，剩下的整句占位话被当成「说了看到什么」。
test('R5-G3 占位话夹零宽字符、中点、点号后仍应拒绝', () => {
  for (const text of ['证据：看了哪个文件的哪一处、看到​了什么 notes/a.md', '看了 notes/a.md 看到了·什么',
    '看了哪个文件的哪一处，看到了什么。notes/a.md', '看了 notes/a.md 的 哪.个.文.件']) {
    assert.equal(checkEvidence(text).ok, false, JSON.stringify(text));
  }
});

// R5-G4（低）：退回时理由只要有一个字就让只有指针的证据通过。
test('R5-G4 退回理由只写一个字不应让「只有指针」的证据过关', () => {
  assert.equal(checkEvidence('notes/out.md', 'x').ok, false);
  assert.equal(checkEvidence('notes/out.md', '。。。。').ok, false);
});

// R5-G5（高）：证据只要指到组文件夹里任何真实文件就算数——验收人自己刚在自己那格写的空文件也行。
test('R5-G5 验收人指到自己刚写的文件，不应算证据', async () => {
  const env = await start();
  await submitOut(env);
  fs.writeFileSync(path.join(env.cell('copy'), 'mine.md'), 'x');
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: verdicts('看了 copy/mine.md 写得很完整很好') });
  assert.equal(r.ok, false, '指到验收人自己的文件被收了');
  env.rt.stop();
});

// R5-G6（高）：证据不必指到这张单交的文件，指到做的人格子里的任何别的文件（旧稿、别的单的产出）也算。
test('R5-G6 证据指到与交单文件无关的另一个文件，不应算证据', async () => {
  const env = await start();
  await submitOut(env);
  fs.writeFileSync(path.join(env.cell('research'), 'old-notes.md'), '上一张单的旧稿');
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: verdicts('看了 research/old-notes.md 内容完整无误') });
  assert.equal(r.ok, false, '指到无关文件被收了');
  env.rt.stop();
});

// R5-G7（高）：消息号只验「这个组里有这个号」，#1 是开工那条系统消息，任何组任何时候都存在。
test('R5-G7 证据只写「#1」之类每个组都有的消息号，不应算证据', async () => {
  const env = await start();
  await submitOut(env);
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: verdicts('看了 #1 里写的内容很完整') });
  assert.equal(r.ok, false, '#1 被收了');
  env.rt.stop();
});

// R5-G8（中）：格式检查明明认可命令类证据（反引号命令、npm test），后面的存在检查却只认文件和消息号，
// 做代码类的单子（清单是「测试通过」）验收人老实写命令和结果会被一律拒掉，且报的是「没指到文件」。
test('R5-G8 带命令和结果的证据（`node --test` 12 项通过）应能收，或至少报错说明要附文件', async () => {
  const env = await start();
  await submitOut(env);
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: verdicts('运行 `node --test` 看到 12 项通过 0 失败') });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  env.rt.stop();
});

// R5-G9（低）：自己那格里做一个指向组外文件的硬链接，交单时 lstat 看是普通文件、realpath 在格内，照收。
test('R5-G9 交单文件是指向组外的硬链接，应拒', async () => {
  const env = await start();
  const outside = path.join(tempDir('r5-outside-'), 'secret.txt');
  fs.writeFileSync(outside, '组外的内容');
  const link = path.join(env.cell('research'), 'linked.txt');
  fs.linkSync(outside, link);
  await assert.rejects(env.rt.submit(env.gid, 'W1', { by: 'research', summary: '做完了', file: link }));
  env.rt.stop();
});

// R5-G10（低）：没配 hubHome 时存在检查的根是运行时自己的组目录，里面有 tickets.json、runtime.json，
// 「指到 tickets.json」就算真实存在的文件。（生产配了 hubHome 则不受影响；这里说明回退口径不安全。）
test('R5-G10 没配 hubHome 时证据指到 tickets.json 不应算证据', async () => {
  const env = await start({ withHome: false });
  await env.rt.submit(env.gid, 'W1', { by: 'research', summary: '做完了' });
  await env.rt.idle();
  const r = await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts: verdicts('看了 tickets.json 里写的内容很完整') });
  assert.equal(r.ok, false, 'tickets.json 被收了');
  env.rt.stop();
});

// R5-G11（中）：外部来源记号经后端发言后是否还在、叫醒消息里是否原样带给读者。
test('R5-G11 带【外部来源】开头的发言，经后端进入叫醒消息时记号仍在', async () => {
  const sessions = fakeSessions();
  const dataDir = tempDir('r5-mark-');
  const hubHome = fs.realpathSync(tempDir('r5-markhub-'));
  const rt = createGroupRuntime({ dataDir, roster: ROSTER, sessions, now: fakeClock(), hubHome });
  const { group } = await rt.propose(plan());
  await rt.confirm(group.id, { approved: true });
  await rt.idle();
  const long = '【外部来源】' + '很长的发言'.repeat(8);
  await rt.post(group.id, { from: 'research', text: long + ' @copy', toolCalls: 0 });
  await rt.idle();
  const wakes = sessions.sent.filter((row) => row.bot === 'copy').map((row) => row.text);
  assert.ok(wakes.some((text) => text.includes('【外部来源】')), '叫醒消息里没有记号');
  rt.stop();
});
