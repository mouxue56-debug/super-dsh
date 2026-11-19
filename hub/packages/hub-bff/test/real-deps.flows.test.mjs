import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createPluginBoard } from '../../hub-plugin/tools/index.mjs';
import { realDeps, autoReply } from './real-deps.mjs';

// 等待异步接线产生可观察的结果。
async function eventually(check, message) {
  for (let i = 0; i < 200; i++) {
    const value = await check();
    if (value) return value;
    await delay(20);
  }
  assert.fail(message);
}

// 调用真实处理器并检查响应状态。
async function call(env, path, value, headers = {}) {
  const req = env.request({method: value === undefined ? 'GET' : 'POST', path, value, headers});
  const body = await req.json();
  assert.ok(req.res.status >= 200 && req.res.status < 300, `${path}: ${req.res.text}`);
  return body;
}

test('插件看板派单唤醒接单助理', async () => {
  const env = await realDeps();
  const { f, deps } = env;
  try {
    autoReply(f.source, () => '收到并开始处理。');
    const board = createPluginBoard({dir: join(f.handlerOptions.hubHome, 'board'), maxHop: 4});
    await board.create({type: 'assistant', name: 'chief'}, {
      title: '整理计划', goal: '整理并提交计划', to: ['pm'], key: 'dispatch-one',
    });
    await eventually(() => f.source.named('session/prompt').length > 0, '派单没有唤醒会话');
    const created = f.source.named('session/create');
    assert.ok(created.some(row => row.request.cwd === deps.botCwd('pm')));
    const prompts = f.source.named('session/prompt');
    assert.match(prompts[0].request.content[0].text, /^【首席派来的活 · 工单 /u);
    assert.equal(f.handler.runtime.store.get(prompts[0].request.sessionId).bot, 'pm');
  } finally {
    await f.dispose();
  }
});

test('晚会真实回话进入隐藏会话和纪要，投递稿等待审批', async () => {
  const env = await realDeps({handlerOptions: {hubConfig: {meetings: {
    kb: {kbAgentPath: '/usr/bin/false'}, attendees: {evening: 'all'},
  }}}});
  const { f, deps } = env;
  try {
    autoReply(f.source, () => '学会先核对资料来源，再记录可复用的做法。');
    const result = await call(env, '/meetings/run', {type: 'evening'});
    const attendees = (await deps.roster.list()).filter(row => row.status === 'active' && row.role !== 'chief');
    const sessions = deps.sessions.list({all: true}).filter(row => row.purpose === 'meeting');
    assert.equal(sessions.length, attendees.length);
    assert.deepEqual(new Set(sessions.map(row => row.bot)), new Set(attendees.map(row => row.id)));
    assert.ok(sessions.every(row => row.hidden && result.learned[row.bot]));
    const listed = await call(env, '/bff/sessions');
    assert.ok(sessions.every(row => !listed.sessions.some(item => item.id === row.id)));
    assert.match(await readFile(result.file, 'utf8'), /学会先核对资料来源/u);
    assert.deepEqual(result.submitted, []);
    if (result.cards.length) {
      await eventually(() => f.handler.runtime.cards().filter(card => card.kind === 'kb-submit').length >=
        result.cards.length, '投递稿没有出现待答卡');
      const cards = f.handler.runtime.cards().filter(card => card.kind === 'kb-submit');
      assert.ok(cards.every(card => card.status === 'pending'));
    }
  } finally {
    await f.dispose();
  }
});

test('插件提组、审批、成员互验直至看板完成', async () => {
  const env = await realDeps();
  const { f, deps } = env;
  try {
    autoReply(f.source, () => '收到任务，我会按清单处理。');
    const plan = {by: 'chief', name: '协作计划', goal: '完成两份草稿', members: ['pm', 'art'], tickets: [
      {title: '整理计划', goal: '整理计划草稿', assignee: 'pm', verifier: 'art', checklist: ['写出计划']},
      {title: '制作草稿', goal: '制作设计草稿', assignee: 'art', verifier: 'pm', checklist: ['写出设计']},
    ]};
    const proposed = await call(env, '/groups/propose', plan);
    const gid = proposed.group.id;
    const card = await eventually(() => f.handler.runtime.cards().find(item =>
      item.kind === 'group_plan' && item.status === 'pending'), '没有收到分工确认卡');
    await call(env, `/bff/cards/${encodeURIComponent(card.id)}/answer`, {choice: 'approve'},
      {'x-hub-device': 'test-device'});
    await eventually(async () => (await call(env, `/groups/${gid}`)).group.status === 'active', '组没有开工');
    await eventually(() => ['pm', 'art'].every(bot => deps.sessions.list({all: true})
      .some(row => row.bot === bot && row.groupId === gid)), '成员没有收到会话');
    await eventually(() => ['pm', 'art'].every(bot => deps.sessions.list({all: true})
      .some(row => row.bot === bot && row.groupId === gid && row.lastRole === 'assistant')), '成员没有回话');
    for (const [id, by, verifier, restatement] of [
      ['W1', 'pm', 'art', '整理计划草稿并写出计划'],
      ['W2', 'art', 'pm', '制作设计草稿并写出设计'],
    ]) {
      const base = `/groups/${gid}/tickets/${id}`;
      await call(env, `${base}/accept`, {by, restatement});
      await call(env, `${base}/submit`, {by, summary: '结果已写入 drafts/a.md 第 1 段'});
      // 证据要指到组文件夹里真实存在的文件，这里替做的人把文件写进自己那一格。
      const cell = join(f.handlerOptions.hubHome, 'group-work', gid, by, 'drafts');
      await mkdir(cell, {recursive: true});
      await writeFile(join(cell, 'a.md'), '草稿\n');
      await call(env, `${base}/verify`, {by: verifier, verdicts: [
        // 没交文件时引交单摘要原文。
        {item: 0, verdict: 'pass', evidence: '看了 drafts/a.md 第 1 段，与清单第 1 条一致；引自 交单摘要：「结果已写入 drafts/a.md 第 1 段」'},
      ]});
    }
    assert.equal((await call(env, `/groups/${gid}`)).group.status, 'done');
    const tickets = await deps.board.list({project: `group:${gid}`});
    assert.equal(tickets.length, 2);
    assert.ok(tickets.every(ticket => ticket.state === 'completed'));
  } finally {
    await f.dispose();
  }
});
