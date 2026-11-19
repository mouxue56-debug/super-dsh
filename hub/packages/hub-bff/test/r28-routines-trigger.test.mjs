// 路37 补验：固定任务到点触发。假时钟、真处理器装配（server.mjs 的 createHandler），
// 定时器是固定任务服务自己的 setInterval（tickMs 调小），时间由注入的 now 推进。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { realDeps, autoReply } from './real-deps.mjs';
import { createHandler } from '../server.mjs';
import { DshClient } from '../lib/dsh-client.mjs';
import { MemoryUpstream, secretFile, request } from './fixtures.mjs';

const at = (day, text) => Date.parse(`2030-01-${day}T${text}:00+09:00`);
const item = (extra = {}) => ({ id: 'daily-post', name: '日更', assistant: 'content', at: '07:30',
  prompt: '写今天的一篇短文', done: '草稿已放到指定目录', escape: { maxSteps: 2, maxMinutes: 30 }, ...extra });

// 起一个带假时钟的真装配环境；固定任务扫描间隔调小。
async function setup(items = [item()], routines = {}) {
  const clock = { t: at('07', '07:00') };
  const env = await realDeps({ handlerOptions: { now: () => clock.t, hubConfig: { timezone: 'Asia/Tokyo',
    routines: { items, tickMs: 20, ...routines } } } });
  const prompts = [];
  autoReply(env.f.source, () => '收到，在做。');
  const rpc = env.f.source.rpcOverride;
  env.f.source.rpcOverride = async envelope => {
    if (envelope.method === 'session/prompt') {
      const { sessionId, content } = envelope.payload.args.request;
      prompts.push({ sessionId, text: content.map(part => part.text ?? '').join('') });
    }
    return rpc(envelope);
  };
  await env.f.handler.start();
  return { ...env, clock, prompts, items };
}

// 等条件成立，超时则带说明失败。
async function until(check, message) {
  for (let i = 0; i < 300; i++) {
    const value = await check();
    if (value) return value;
    await delay(20);
  }
  assert.fail(typeof message === 'function' ? message() : message);
}

const runs = env => env.request({ path: '/routines/runs' }).json().then(body => body.runs);
const final = row => ['reported', 'incomplete', 'timeout', 'blocked', 'failed'].includes(row.state);

test('r28 固定任务：没到点不跑，到点自动跑一次（建单、开会话、发提示），当天不重复', async () => {
  const env = await setup();
  try {
    await delay(150);
    assert.deepEqual(await runs(env), [], '07:00 不该有运行记录');
    assert.equal(env.prompts.length, 0);
    env.clock.t = at('07', '07:31');
    const done = await until(async () => (await runs(env)).find(final), async () => 'to-time 没触发：' +
      JSON.stringify(await runs(env)));
    assert.equal(done.id, 'daily-post');
    assert.equal(done.manual, false);
    assert.ok(done.ticket, '应建了看板工单');
    const ticket = await env.deps.board.get(done.ticket);
    assert.match(ticket.title, /固定任务：日更/u);
    assert.ok(env.prompts.some(row => /固定任务「日更」/u.test(row.text)), '助理应收到固定任务提示');
    assert.ok(env.deps.sessions.list({ all: true }).some(row => row.purpose === 'routine' && row.bot === 'content'));
    const count = env.prompts.length;
    env.clock.t = at('07', '07:40');
    await delay(250);
    assert.equal(env.prompts.length, count, '同一天不重复跑');
    assert.equal((await runs(env)).filter(row => row.state === 'started').length, 1);
    const list = await env.request({ path: '/routines' }).json();
    assert.equal(list.routines?.[0]?.id ?? list.items?.[0]?.id, 'daily-post');
  } finally {
    await env.f.dispose();
  }
});

test('r28 固定任务：全部暂停时到点不跑，恢复后（仍在宽限内）补跑', async () => {
  const env = await setup();
  try {
    const pause = env.request({ method: 'POST', path: '/routines/pause', value: {} });
    await pause.json();
    assert.equal(pause.res.status, 200);
    env.clock.t = at('07', '07:32');
    await delay(250);
    assert.deepEqual(await runs(env), [], '暂停中不能有运行');
    await env.request({ method: 'POST', path: '/routines/resume', value: {} }).json();
    await until(async () => (await runs(env)).find(final), '恢复后宽限期内应跑');
  } finally {
    await env.f.dispose();
  }
});

test('r28 固定任务：只暂停一条，别的照跑', async () => {
  const env = await setup([item(), item({ id: 'evening-note', name: '晚记', assistant: 'pm' })]);
  try {
    const one = env.request({ method: 'POST', path: '/routines/daily-post/pause', value: {} });
    await one.json();
    assert.equal(one.res.status, 200);
    env.clock.t = at('07', '07:31');
    await until(async () => (await runs(env)).some(row => row.id === 'evening-note' && final(row)), '另一条应照跑');
    assert.equal((await runs(env)).some(row => row.id === 'daily-post'), false, '被暂停的那条不能跑');
  } finally {
    await env.f.dispose();
  }
});

test('r28 固定任务：超出宽限不补做只记一行；安静时段内的只记跳过', async () => {
  const env = await setup([item(), item({ id: 'night-note', name: '夜记', assistant: 'pm', at: '07:20',
    quiet: { from: '07:00', to: '07:25' } })], { graceMinutes: 5 });
  try {
    env.clock.t = at('07', '07:50');
    await until(async () => {
      const rows = await runs(env);
      return rows.some(row => row.id === 'daily-post') && rows.some(row => row.id === 'night-note');
    }, '两条都应有一行记录');
    const rows = await runs(env);
    assert.equal(rows.find(row => row.id === 'daily-post').state, 'missed');
    assert.equal(rows.find(row => row.id === 'night-note').state, 'skipped-quiet');
    assert.equal(env.prompts.length, 0, '错过和安静时段都不发提示');
  } finally {
    await env.f.dispose();
  }
});

test('r28 固定任务：手动跑一次立刻执行，全停期间到点和手动都不执行', async () => {
  const env = await setup();
  try {
    const manual = env.request({ method: 'POST', path: '/routines/daily-post/run', value: {} });
    const body = await manual.json();
    assert.equal(manual.res.status, 200);
    assert.ok(['reported', 'incomplete', 'timeout', 'blocked', 'failed'].includes(body.state), JSON.stringify(body));
    assert.ok((await runs(env)).some(row => row.manual === true && final(row)));
    const stop = env.request({ method: 'POST', path: '/panic/stop', value: {} });
    await stop.json();
    assert.equal(stop.res.status, 200);
    const before = (await runs(env)).length;
    const promptsBefore = env.prompts.filter(row => row.text.includes('固定任务「日更」')).length;
    env.clock.t = at('07', '07:31');
    await delay(250);
    assert.equal((await runs(env)).filter(row => row.manual === false).length, 0, '全停期间到点不能跑');
    const blocked = env.request({ method: 'POST', path: '/routines/daily-post/run', value: {} });
    const result = await blocked.json();
    // 修 E 之后：全停期间手动运行回 stopped、不发任何提示（路 37 原先记的是建一张 failed 工单）。
    assert.equal(result.state, 'stopped', '全停期间手动运行必须被拒：' + JSON.stringify(result));
    assert.equal(env.prompts.filter(row => row.text.includes('固定任务「日更」')).length,
      promptsBefore, '全停期间不能再向助理发提示');
    assert.ok((await runs(env)).length >= before);
  } finally {
    await env.f.dispose();
  }
});

test('r28 固定任务：后端重启后，跑过的不重跑、暂停还在、停机期间错过的记一行', async () => {
  const env = await setup([item(), item({ id: 'evening-note', name: '晚记', assistant: 'pm', at: '21:00' }),
    item({ id: 'noon-note', name: '午记', assistant: 'art', at: '12:00' })]);
  let second;
  try {
    env.clock.t = at('07', '07:31');
    await until(async () => (await runs(env)).some(row => row.id === 'daily-post' && final(row)), '重启前应已跑');
    await env.request({ method: 'POST', path: '/routines/evening-note/pause', value: {} }).json();
    await env.f.handler.dispose();
    const source = new MemoryUpstream();
    source.nextId = 1000; // 新的假内核另起编号，免得和已存的会话号撞上
    const client = new DshClient({ url: 'http://127.0.0.1:13290', tokenFile: await secretFile(),
      fetchImpl: source.fetch, socketFactory: source.socketFactory, timeoutMs: 1000 });
    const prompts = [];
    autoReply(source, () => '好');
    const rpc = source.rpcOverride;
    source.rpcOverride = async envelope => {
      if (envelope.method === 'session/prompt') prompts.push(envelope.payload.args.request.sessionId);
      return rpc(envelope);
    };
    const handler = createHandler({ client, key: env.f.key, ...env.f.handlerOptions });
    await handler.ready;
    await handler.start();
    second = { handler, client };
    env.clock.t = at('07', '07:45');
    await delay(300);
    assert.equal(prompts.length, 0, '同一天已跑过的不能因重启再跑');
    const list = await request(handler, { path: '/routines' }).json();
    const rows = list.routines ?? list.items;
    assert.ok(JSON.stringify(rows.find(row => row.id === 'evening-note')).match(/paused|暂停|true/iu),
      '重启后单条暂停应保留：' + JSON.stringify(rows));
    // 停机期间错过了一整天：第二天首次扫描时，昨天没记的要记 missed。
    env.clock.t = at('08', '07:10');
    await delay(300);
    const all = (await request(handler, { path: '/routines/runs' }).json()).runs;
    assert.ok(all.some(row => row.id === 'daily-post' && row.state === 'started'), '重启前的记录应还在');
    const missed = all.find(row => row.id === 'noon-note' && row.date === '2030-01-07');
    assert.equal(missed?.state, 'missed', '停机错过的那一天应记一行 missed：' + JSON.stringify(all));
    const state = JSON.parse(await readFile(join(env.f.handlerOptions.hubHome, 'hub-data', 'routines',
      'state.json'), 'utf8'));
    assert.ok(state.pausedIds.includes('evening-note'));
    assert.ok(state.slots['daily-post'].includes('2030-01-07'));
  } finally {
    await second?.handler.dispose();
    second?.client.dispose();
    env.f.client.dispose();
  }
});
