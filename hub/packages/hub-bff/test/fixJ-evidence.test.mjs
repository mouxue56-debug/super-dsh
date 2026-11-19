import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyQuotedEvidence } from '../lib/group-evidence.mjs';

const ticket = { id: 'W1', assignee: 'a', title: '标题', goal: '目标', checklist: [], report: {} };
const text = '这是做的人自己写的足够长的一段产出内容';

test('只认做的人自己写且单号完整的消息', () => {
  for (const row of [
    { id: 1, from: 'a', text: `[W1] ${text}`, system: true },
    { id: 1, from: 'a', text: `[W12] ${text}`, own: true },
    { id: 1, from: 'a', text: `W1x ${text}`, own: true },
  ]) {
    const result = verifyQuotedEvidence(`引自 #1：「${text}」`, { ticket, messages: [row] });
    assert.match(result.reason, /不是.*消息/u);
  }
});

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { validPatch } from '../lib/roster.mjs';
import { ROSTER, fakeClock, fakeSessions, planInput, tempDir } from './group-runtime-fixture.mjs';

const first = '这一行留给系统摘例子作为验收提示内容';
const one = '这份资料逐家记录了竞品价格和具体的来源';
const two = '推荐结论明确解释了不同方案的选择原因';
const failed = (result, reason) => assert.match(result.reason ?? (result.errors ?? []).join(''), reason);

function fileContext(body) {
  const cell = tempDir('fixj-file-');
  const file = path.join(cell, 'out.txt');
  fs.writeFileSync(file, body);
  const bytes = fs.readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { file, cell, ticket: { ...ticket, report: { file, sha256, size: bytes.length } } };
}

function check(ctx, quote) {
  return verifyQuotedEvidence(`引自 out.txt：「${quote}」`, ctx);
}

test('成员消息标记、完整单号与自己写的部分', () => {
  const context = { ticket, messages: [{ id: 3, from: 'a', own: true, text: `[W1] @copy 【外部来源】${text}` }] };
  assert.equal(verifyQuotedEvidence(`引自 #3：「${text}」`, context).ok, true);
  failed(verifyQuotedEvidence('引自 #3：「【外部来源】」', context), /太短|标题/u);
  for (const action of ['交验', '接单', '退回', '验收通过']) {
    const messages = [{ id: 3, from: 'a', system: true, text: `[W1] ${action}：${text}` }];
    failed(verifyQuotedEvidence(`引自 #3：「${text}」`, { ticket, messages }), /不是.*消息/u);
  }
});

test('标题目标清单及标签不能冒充产出', () => {
  const title = '这是一条足够长的工单标题用于验证';
  const goal = '这是一条足够长的工单目标用于验证';
  const item = '这是一条足够长的工单清单原文用于验证';
  for (const quote of [title, goal, `${item}完成了`, `【外部来源】${item}`]) {
    const ctx = fileContext(`${first}\n${quote}\n`);
    ctx.ticket = { ...ctx.ticket, title, goal, checklist: [{ text: item }] };
    failed(check(ctx, quote), /主要是工单标题/u);
  }
});

test('校验和锁住交单文件及旧交单', () => {
  for (const mutation of ['byte', 'same', 'missing', 'old']) {
    const ctx = fileContext(`${first}\n${one}\n`);
    if (mutation === 'byte') fs.appendFileSync(ctx.file, 'x');
    if (mutation === 'same') fs.writeFileSync(ctx.file, Buffer.alloc(fs.statSync(ctx.file).size, 65));
    if (mutation === 'missing') fs.renameSync(ctx.file, `${ctx.file}.moved`);
    if (mutation === 'old') ctx.ticket.report.sha256 = null;
    failed(check(ctx, one), /重新交单/u);
  }
});

test('仅匹配同一行且英文数字间空格保留', () => {
  const ctx = fileContext(`${first}\n数量是 1 2 家而且其他内容已经详细写清楚\n${one}\n${two}\n`);
  failed(check(ctx, '数量是12家而且其他内容已经详细写清楚'), /没找到/u);
  failed(check(ctx, `${one}${two}`), /没找到/u);
  assert.equal(check(ctx, one).ok, true);
});

test('二进制、非法编码、超大文件的明确理由', () => {
  for (const body of [Buffer.from([0, 65]), Buffer.from([0xff, 65])]) {
    failed(check(fileContext(body), one), /二进制或不是 UTF-8/u);
  }
  failed(check(fileContext(Buffer.alloc(2 * 1024 * 1024 + 1, 65)), one), /过大/u);
});

test('每个引文都必须真实存在', () => {
  const ctx = fileContext(`${first}\n${one}\n${two}\n`);
  const result = verifyQuotedEvidence(`引自 out.txt：「${one}」「完全编造的内容」`, ctx);
  failed(result, /完全编造的内容.*没找到/u);
  assert.equal(verifyQuotedEvidence(`引自 out.txt：「${one}」「${two}」`, ctx).ok, true);
});

test('旧名字拒绝所有指定格式控制字符', () => {
  for (const ch of ['\u202e', '\u200b', '\u2066', '\ufeff', '\u0001']) {
    assert.equal(validPatch({ name: `旧${ch}名` }, null, { legacy: true }), false);
  }
  assert.equal(validPatch({ name: '旧名字&' }, null, { legacy: true }), true);
});

async function runtime() {
  const hubHome = fs.realpathSync(tempDir('fixj-hub-'));
  const rt = createGroupRuntime({
    dataDir: tempDir('fixj-data-'), roster: ROSTER, sessions: fakeSessions(), now: fakeClock(), hubHome,
  });
  const input = planInput({ members: ['research', 'copy'] });
  input.tickets = [input.tickets[0]];
  const { group } = await rt.propose(input);
  await rt.confirm(group.id, { approved: true });
  await rt.idle();
  const file = path.join(hubHome, 'group-work', group.id, 'research', 'out.txt');
  fs.writeFileSync(file, `${first}\n${one}\n${two}\n${one}还有额外的说明文字\n`);
  await rt.submit(group.id, 'W1', { by: 'research', summary: '完成', file });
  await rt.idle();
  return { rt, gid: group.id };
}

test('每条清单引文不得相同或互相包含', async () => {
  for (const second of [one, `${one}还有额外的说明文字`]) {
    const env = await runtime();
    const verdicts = [one, second].map((q, i) => ({
      item: i, verdict: 'pass', evidence: `引自 out.txt：「${q}」`,
    }));
    failed(await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts }), /第 2 条和第 1 条用了同一句引文/u);
    env.rt.stop();
  }
  const env = await runtime();
  const verdicts = [one, two].map((q, i) => ({ item: i, verdict: 'pass', evidence: `引自 out.txt：「${q}」` }));
  assert.equal((await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts })).ok, true);
  const history = env.rt.view(env.gid).tickets.find((t) => t.id === 'W1').history;
  assert.match(history.at(-1).verdicts[0].sha256, /^[a-f0-9]{64}$/u);
  env.rt.stop();
});

test('清单原文作为 item 时按真实下标核对退回理由', async () => {
  const env = await runtime();
  const checklist = env.rt.view(env.gid).tickets.find((t) => t.id === 'W1').checklist;
  const verdicts = [
    { item: checklist[1].text, verdict: 'fail', evidence: '看了文件',
      reason: '第 1 条没达到需要补充详细资料' },
    { item: checklist[0].text, verdict: 'pass', evidence: `引自 out.txt：「${one}」` },
  ];
  failed(await env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts }), /清单第 2 条/u);
  env.rt.stop();
});
