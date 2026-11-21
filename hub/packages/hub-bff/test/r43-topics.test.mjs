import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createThreads } from '../lib/threads.mjs';
import { createTopics } from '../lib/topics.mjs';
import { topicModel } from '../lib/topic-model.mjs';
import { fixture, request, testDirectory } from './fixtures.mjs';

const NOW = 1800000000000;
const row = (id, extra = {}) => ({ id, bot: 'chief', title: id, lastText: '', lastRole: 'assistant',
  updatedAt: NOW - 3600000, running: false, unread: 0, ...extra });
const msg = (id, role = 'user', text = id, ts = NOW - 3600000) => ({ id, seq: Number(id), role, text, ts });

async function setup(extra = {}) {
  const rows = [row('a', { title: '网站获客' }), row('b', { title: '修电脑', updatedAt: NOW - 7200000 }),
    row('system', { title: '派工：检查图片', purpose: 'board' })];
  const histories = { a: [msg('1'), msg('2', 'assistant')], b: [msg('1')], system: [msg('1')] };
  const calls = [], sends = [];
  let serial = 0, clock = NOW;
  const dataDir = await testDirectory();
  const deps = { dataDir, now: () => clock, topicDispatchMs: 5, topicTimeoutMs: 15,
    roster: [{ id: 'chief' }, { id: 'art' }], readPositions: async () => ({ conversations: {} }),
    topicModel: async input => { calls.push(input); return '2'; },
    sessions: {
      list: () => rows,
      create: async (bot, { title }) => {
        const value = row('new-' + ++serial, { bot, title, updatedAt: clock });
        rows.push(value); histories[value.id] = []; return value;
      },
      send: async (id, text, options) => {
        options.onDispatch?.();
        sends.push({ id, text, options });
        const seq = histories[id].length + 1;
        histories[id].push({ ...msg(String(seq), 'user', text, clock), requestId: options.requestId },
          msg(String(seq + 1), 'assistant', '已办好', clock + 1));
        Object.assign(rows.find(row => row.id === id), { updatedAt: clock, lastText: '已办好', lastRole: 'assistant' });
        return { accepted: true, requestId: options.requestId,
          reply: Promise.resolve({ failed: false, text: '已办好' }) };
      },
      history: async id => ({ messages: histories[id] }),
      historyPage: async (id, { beforeSeq = Infinity, limit = 40 }) => {
        const values = histories[id].filter(item => item.seq < beforeSeq), messages = values.slice(-limit);
        return { messages, hasMore: messages.length < values.length,
          nextBeforeSeq: messages[0]?.seq, maxSeq: histories[id].at(-1)?.seq ?? 0 };
      },
    }, ...extra };
  const core = createTopics(deps, createThreads(deps));
  return { core, deps, rows, histories, sends, calls, dataDir, tick: n => { clock += n; } };
}

async function settled(core, requestId) {
  for (let i = 0; i < 100; i++) {
    const result = await core.getSend('chief', requestId);
    if (['done', 'failed', 'cancelled'].includes(result.status)) return result;
    await wait(5);
  }
  assert.fail('发送没有结束');
}

test('短延续和三分钟内接话走规则，单条只发一次，重试持久去重', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  const input = { text: '好的', idem: 'same' };
  const [first, repeated] = await Promise.all([f.core.send('chief', input), f.core.send('chief', input)]);
  assert.equal(first.session, 'a'); assert.equal(first.requestId, repeated.requestId);
  assert.equal(first.classification.source, 'rule'); assert.equal(f.calls.length, 0);
  await settled(f.core, first.requestId);
  // 长对话发送口只许主人设备；发出的话必须带主人回合标记，改自己才认。
  assert.equal(f.sends[0].options.ownerTurn, true);
  const again = await f.core.send('chief', input);
  assert.equal(again.duplicate, true); assert.equal(f.sends.length, 1);
  const next = await f.core.send('chief', { text: '补充刚才这个要求里提到的几条细节' });
  assert.equal(next.classification.source, 'rule'); assert.equal(f.calls.length, 0);
  await settled(f.core, next.requestId);
  const reloaded = createTopics(f.deps, createThreads(f.deps)); t.after(() => reloaded.stop());
  assert.equal((await reloaded.send('chief', input)).requestId, first.requestId);
  assert.equal(f.sends.length, 2);
  await assert.rejects(f.core.send('chief', { text: '不同的消息', idem: 'same' }), { code: 'CONFLICT' });
});

test('模型接旧话题，提示只含最多六个名字与摘要，记录Unicode字数', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  const result = await f.core.send('chief', { text: '今天检查一下电脑散热', idem: 'model' });
  assert.equal(result.session, 'b'); assert.equal(result.classification.source, 'model');
  assert.equal(result.classification.label, '接着聊：修电脑');
  assert.equal(result.classification.inputChars, Array.from(f.calls[0].prompt).length);
  assert.equal(result.classification.outputChars, 1);
  assert.doesNotMatch(f.calls[0].prompt, /派工/u);
  console.log('R43 归类样本 Unicode 输入/输出字数', result.classification.inputChars,
    result.classification.outputChars);
  await settled(f.core, result.requestId);
  assert.equal(f.sends[0].id, 'b');
});

test('模型新话题一步起名，消息进入独立会话；模型乱码和非法编号退回最近话题', async t => {
  for (const [answer, source, kind] of [['新:周末出游', 'model', 'new'], ['???', 'fallback', 'continue'],
    ['6', 'fallback', 'continue'], ['新:' + '超'.repeat(25), 'fallback', 'continue']]) {
    const f = await setup({ topicModel: async () => answer }); t.after(() => f.core.stop());
    const result = await f.core.send('chief', { text: '给我安排周末出游' });
    assert.equal(result.classification.source, source); assert.equal(result.classification.kind, kind);
    assert.equal(result.session, kind === 'new' ? 'new-1' : 'a');
    if (kind === 'new') assert.equal(result.topic.title, '周末出游');
    else assert.equal(result.topic.title, '网站获客');
    await settled(f.core, result.requestId); assert.equal(f.sends.length, 1);
  }
});

test('归类超时或抛错均兜底一次发送，晚到模型答案不能重新发送', async t => {
  for (const timedOut of [true, false]) {
    let release;
    const f = await setup({ topicModel: () => timedOut ? new Promise(r => { release = r; })
      : Promise.reject(new Error('模型失败')) });
    t.after(() => f.core.stop());
    const result = await f.core.send('chief', { text: '换个稍远的话题看看', idem: 'timeout' });
    assert.equal(result.session, 'a'); assert.equal(result.classification.source, 'fallback');
    await settled(f.core, result.requestId); release?.('新:别的话题'); await wait(10);
    assert.equal(f.sends.length, 1);
  }
});

test('没有普通话题时模型失败也新建再发送，手动选话题和附件正文隔离', async t => {
  const f = await setup({ topicModel: async () => { throw new Error(); } }); t.after(() => f.core.stop());
  f.rows.splice(0, 2);
  const first = await f.core.send('chief', { text: '你好，需要帮我办件事' });
  assert.equal(first.classification.kind, 'new'); await settled(f.core, first.requestId);
  const next = await f.core.send('chief', { text: '附带文件 /private/local-path',
    classificationText: '', topic: first.session });
  assert.equal(next.classification.source, 'manual'); await settled(f.core, next.requestId);
  const g = await setup(); t.after(() => g.core.stop());
  await g.core.send('chief', { text: '请分析\n附件 /private/local-path', classificationText: '请分析' });
  assert.doesNotMatch(g.calls[0].prompt, /private|local-path/u);
});

test('待发送改归和其实是新话题只发进修正目标，hold可延长一次，取消不发', async t => {
  const f = await setup({ topicDispatchMs: 5000 }); t.after(() => f.core.stop());
  const result = await f.core.send('chief', { text: '好的' });
  const held = await f.core.controlSend('chief', result.requestId, 'hold');
  assert.equal(held.pending, true);
  const changed = await f.core.reassign('chief', { requestId: result.requestId, topic: 'b' });
  assert.equal(changed.session, 'b'); assert.equal(changed.classification.source, 'manual');
  const fresh = await f.core.reassign('chief', { requestId: result.requestId, newTopic: true, title: '买电脑' });
  assert.equal(fresh.session, 'new-1');
  const cancelled = await f.core.controlSend('chief', result.requestId, 'cancel');
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.accepted, false);
  assert.equal((await f.core.controlSend('chief', result.requestId, 'cancel')).status, 'cancelled');
  assert.equal(f.sends.length, 0);
  const g = await setup({ topicDispatchMs: 30 }); t.after(() => g.core.stop());
  const sent = await g.core.send('chief', { text: '好的' });
  await g.core.reassign('chief', { requestId: sent.requestId, topic: 'b' });
  await settled(g.core, sent.requestId); assert.equal(g.sends.length, 1); assert.equal(g.sends[0].id, 'b');
  assert.equal((await g.core.controlSend('chief', sent.requestId, 'cancel')).status, 'done');
});

test('已回复只能整轮软改归，原内核消息保持不变，目标页和总线一致', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  const sent = await f.core.send('chief', { text: '好的' }); await settled(f.core, sent.requestId);
  await assert.rejects(f.core.reassign('chief', { requestId: sent.requestId, topic: 'b' }), { code: 'CONFLICT' });
  const before = structuredClone(f.histories);
  const moved = await f.core.reassign('chief', { requestId: sent.requestId, topic: 'b', mode: 'turn' });
  assert.equal(moved.moved, 2); assert.deepEqual(f.histories, before);
  const line = await f.core.page('chief'), topic = await f.core.page('chief', { topic: 'b' });
  assert.deepEqual(topic.items.map(item => item.id),
    line.items.filter(item => item.topic === 'b').map(item => item.id));
  assert.equal(topic.items.filter(item => item.moved).length, 2);
  assert.equal(topic.items.find(item => item.moved).session, 'a');
});

test('合并与撤销只改topics.json，禁止自环、跨助理和系统话题混并', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  const before = structuredClone(f.rows), history = structuredClone(f.histories);
  await f.core.merge('chief', 'b', { target: 'a' });
  assert.equal((await f.core.list('chief')).topics.find(row => row.id === 'b').mergedInto, 'a');
  const topic = await f.core.page('chief', { topic: 'a' });
  assert.ok(topic.items.some(item => item.session === 'b'));
  await assert.rejects(f.core.merge('chief', 'a', { target: 'b' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.core.merge('chief', 'system', { target: 'a' }), { code: 'NOT_FOUND' });
  await assert.rejects(f.core.merge('art', 'a', { target: 'b' }), { code: 'NOT_FOUND' });
  await f.core.unmerge('chief', 'b');
  assert.equal((await f.core.page('chief', { topic: 'a' })).items.some(item => item.session === 'b'), false);
  assert.deepEqual(f.rows, before); assert.deepEqual(f.histories, history);
});

test('系统分组、改名、最近活动话题名和原始行标题相互独立', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  await f.core.rename('chief', 'a', { title: '网站 <script> & 获客' });
  const topics = (await f.core.list('chief')).topics;
  assert.equal(topics.find(row => row.id === 'system').system, true);
  assert.equal(topics.find(row => row.id === 'a').system, false);
  assert.equal(f.rows[0].title, '网站获客');
  assert.equal((await f.core.threadList()).threads[0].topicTitle, '网站 <script> & 获客');
  assert.equal((await stat(join(f.dataDir, 'topics.json'))).mode & 0o777, 0o600);
});

test('每四次完成回复更新一句摘要，输入有上限，记录摘要字数', async t => {
  const calls = [];
  const f = await setup({ topicModel: async args => { calls.push(args); return '讨论网站获客的下一步'; } });
  t.after(() => f.core.stop());
  for (let i = 0; i < 4; i++) {
    const result = await f.core.send('chief', { text: '继续', idem: 'round-' + i });
    await settled(f.core, result.requestId);
    f.tick(5);
  }
  await f.core.updateSummary('chief', 'a');
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'summary');
  const data = await f.core.state.read();
  assert.equal(data.topics.a.summary, '讨论网站获客的下一步'); assert.equal(data.topics.a.summaryRound, 4);
  assert.ok(data.topics.a.summaryUsage.inputChars < 1000);
  await f.core.updateSummary('chief', 'a'); assert.equal(calls.length, 1);
});

test('话题筛选跨多页不丢不重，工具原形保留，软移动按稳定消息id寻址', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  f.histories.a = Array.from({ length: 125 }, (_, i) => msg(String(i + 1), i % 2 ? 'assistant' : 'user', 'A', i * 4));
  f.histories.b = Array.from({ length: 125 }, (_, i) => msg(String(i + 1), 'assistant', 'B', i * 4 + 2));
  const got = [];
  let before;
  do {
    const result = await f.core.page('chief', { topic: 'a', limit: 11, before });
    got.unshift(...result.items.filter(item => item.kind === 'message'));
    before = result.nextBefore;
  } while (before);
  assert.equal(got.length, 125); assert.equal(new Set(got.map(item => item.id)).size, 125);
  assert.ok(got.every(item => item.topic === 'a'));
});

test('损坏话题文件不覆盖；空对象和跨助理请求均拒绝', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  await assert.rejects(f.core.send('chief', {}), { code: 'INVALID_INPUT' });
  await assert.rejects(f.core.send('chief', { text: 'hello', topic: 'system' }), { code: 'NOT_FOUND' });
  await assert.rejects(f.core.reassign('art', { requestId: 'fake', topic: 'a' }), { code: 'NOT_FOUND' });
  await writeFile(join(f.dataDir, 'topics.json'), 'broken');
  const broken = createTopics(f.deps, createThreads(f.deps)); t.after(() => broken.stop());
  await assert.rejects(broken.list('chief'), { code: 'STORAGE_FAILURE' });
  assert.equal(await readFile(join(f.dataDir, 'topics.json'), 'utf8'), 'broken');
});

test('真扩展路由验证主人身份、POST发送、读取回执、改名及非法字段', async t => {
  const f = await fixture({ handlerOptions: { topicModel: async () => '1', topicDispatchMs: 5000 } });
  t.after(() => f.dispose());
  const owner = { 'x-hub-device': '0123456789abcdef' };
  const call = async (path, method = 'GET', value, headers = owner) => {
    const r = request(f.handler, { path, method, value, headers });
    return { body: await r.json(), status: r.res.status };
  };
  assert.equal((await call('/threads/chief/send', 'POST', { text: '好的' }, {})).status, 403);
  const result = await call('/threads/chief/send', 'POST', { text: '好的', idem: 'owner', topic: 's1' });
  assert.equal(result.status, 202); assert.equal(result.body.session, 's1');
  assert.equal((await call('/threads/art/send/' + result.body.requestId)).status, 404);
  assert.equal((await call('/threads/chief/send/' + result.body.requestId)).body.pending, true);
  const cancelled = await call('/threads/chief/send/' + result.body.requestId + '/cancel', 'POST', {});
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await call('/threads/chief/topics/s1', 'PATCH', { title: '改过的名字' })).status, 200);
  assert.equal((await call('/threads/chief/topics')).body.topics[0].title, '改过的名字');
  assert.equal((await call('/threads/chief/send', 'POST', { text: '好的', unknown: true })).status, 400);
});

test('短文字模型通道复用助理预设及专用无工具会话编号，完成后不再取消', async () => {
  const directory = await testDirectory(), calls = [];
  let sent = false;
  const deps = { configDir: directory, dataDir: directory, roster: { get: () => ({ preset: 'chief-preset' }) },
    botCwd: () => '/synthetic/chief', kernel: {
      createSession: async args => { calls.push(args); return { id: args.sessionId }; },
      follow: async () => ({ async *[Symbol.asyncIterator]() {
        assert.equal(sent, true);
        yield { type: 'message', role: 'assistant', text: '1' }; yield { type: 'done' };
      }, dispose() { calls.push('dispose'); } }),
      prompt: async id => {
        assert.match(id, /^hub-topic-[a-f0-9-]{36}$/u); sent = true; calls.push(id);
        await assert.rejects(readFile(join(directory, 'chat-only-sessions.json')), { code: 'ENOENT' });
      },
      cancel: async id => { calls.push('cancel:' + id); },
    } };
  const value = await topicModel(deps, { bot: 'chief', prompt: '只回1', signal: new AbortController().signal });
  assert.equal(value, '1'); assert.equal(calls[0].agentPreset, 'chief-preset');
  assert.equal(calls.some(value => typeof value === 'string' && value.startsWith('cancel:')), false);
});

test('隔六小时或跨日接聊标记在翻页后仍可识别，普通连续消息不误标', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  f.histories.a = [msg('1', 'user', '第一天', 1000), msg('2', 'assistant', '答复', 2000),
    msg('3', 'user', '第二天再聊', 86401000), msg('4', 'assistant', '接着答', 86402000)];
  const page = await f.core.page('chief', { topic: 'a', limit: 2 });
  assert.equal(page.items.find(item => item.session === 'a' && item.seq === 3)?.resumed, true);
  assert.equal(page.items.find(item => item.session === 'a' && item.seq === 4)?.resumed, undefined);
});

test('成功接纳后新元数据不留原文，相同短句按请求号准确标记与挪问答', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  const first = await f.core.send('chief', { text: '好的', idem: 'first' }); await settled(f.core, first.requestId);
  const second = await f.core.send('chief', { text: '好的', idem: 'second' }); await settled(f.core, second.requestId);
  const data = await f.core.state.read();
  assert.equal(Object.hasOwn(data.requests[first.requestId], 'text'), false);
  assert.equal(Object.hasOwn(data.requests[second.requestId], 'text'), false);
  const before = await f.core.page('chief');
  const user = before.items.filter(item => item.role === 'user' && item.text === '好的');
  assert.deepEqual(user.map(item => item.classification.requestId), [first.requestId, second.requestId]);
  await f.core.reassign('chief', { requestId: second.requestId, topic: 'b', mode: 'turn' });
  const after = await f.core.page('chief');
  assert.equal(after.items.find(item => item.requestId === first.requestId).topic, 'a');
  assert.equal(after.items.find(item => item.requestId === second.requestId).topic, 'b');
  assert.equal((await f.core.threadList()).threads[0].topicId, 'b');
});

test('真实发话入口传同一requestId给内核，回执和原会话流共同完成一轮', async t => {
  const f = await fixture({ handlerOptions: { topicModel: async () => '1', topicDispatchMs: 0 } });
  t.after(() => f.dispose());
  const headers = { 'x-hub-device': '0123456789abcdef' };
  const initial = request(f.handler, { path: '/threads/chief/send', method: 'POST', headers,
    value: { text: '好的', idem: 'normal-entry', topic: 's1' } });
  const value = await initial.json();
  for (let i = 0; i < 100 && !f.source.named('session/prompt').length; i++) await wait(5);
  assert.equal(f.source.named('session/prompt').length, 1);
  const sent = f.source.named('session/prompt')[0].request;
  assert.equal(sent.sessionId, value.session); assert.equal(sent.requestId, value.requestId);
  f.source.emit({ type: 'event', event: {
    type: 'turn/end', seq: 3, data: { reason: { kind: 'completed' } },
  } }, value.session);
  let done;
  for (let i = 0; i < 100; i++) {
    const current = request(f.handler, { path: '/threads/chief/send/' + value.requestId, headers });
    done = await current.json(); if (done.status === 'done') break; await wait(5);
  }
  assert.equal(done.status, 'done');
  const retried = request(f.handler, { path: '/threads/chief/send', method: 'POST', headers,
    value: { text: '好的', idem: 'normal-entry', topic: 's1' } });
  assert.equal((await retried.json()).duplicate, true); assert.equal(f.source.named('session/prompt').length, 1);
});

test('归类最多六个候选与600字原话，超长正文不会扩大提示开销', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  for (let i = 0; i < 9; i++) {
    const id = 'extra-' + i;
    f.rows.push(row(id, { title: '话'.repeat(100), lastText: '摘'.repeat(200), updatedAt: NOW - 1000000 - i }));
    f.histories[id] = [];
  }
  const value = await f.core.send('chief', { text: '原'.repeat(20000) });
  assert.ok(value.classification.inputChars < 1300);
  assert.equal(f.calls[0].prompt.match(/^\d /gmu).length, 6);
  assert.equal(f.calls[0].prompt.split('消息：')[1].length, 600);
  console.log('R43 满额归类 Unicode 输入/输出字数', value.classification.inputChars,
    value.classification.outputChars);
});

test('重启自动继续待发队列，取消的新空话题不会抢最近话题', async t => {
  const f = await setup({ topicDispatchMs: 30 }); t.after(() => f.core.stop());
  const pending = await f.core.send('chief', { text: '准备重新启动', topic: 'a', idem: 'recover' });
  await f.core.stop();
  const resumed = createTopics(f.deps, createThreads(f.deps)); t.after(() => resumed.stop());
  for (let i = 0; i < 200 && !f.sends.length; i++) await wait(5);
  assert.equal(f.sends.length, 1); assert.equal(f.sends[0].options.requestId, pending.requestId);
  const cancelled = await resumed.send('chief', { text: '取消的新事', newTopic: true });
  await resumed.controlSend('chief', cancelled.requestId, 'cancel');
  const next = await resumed.send('chief', { text: '继续' });
  assert.equal(next.session, 'a');
});

test('确定未派发的失败可用同编号重试，不确定上游回执保持一次派发', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  const original = f.deps.sessions.send; let attempts = 0;
  f.deps.sessions.send = async (...args) => {
    if (attempts++ === 0) throw Object.assign(new Error(), { code: 'DISCONNECTED' });
    return original(...args);
  };
  const input = { text: '好的', idem: 'safe-retry' };
  const first = await f.core.send('chief', input);
  const failed = await settled(f.core, first.requestId); assert.equal(failed.canRetry, true);
  const retried = await f.core.send('chief', { idem: input.idem, text: input.text });
  assert.equal(retried.requestId, first.requestId); await settled(f.core, retried.requestId);
  assert.equal(f.sends.length, 1);
  const g = await setup(); t.after(() => g.core.stop()); let dispatches = 0;
  g.deps.sessions.send = async (_id, _text, options) => {
    options.onDispatch(); dispatches++;
    throw new Error('回执丢失');
  };
  const uncertain = await g.core.send('chief', input);
  assert.equal((await settled(g.core, uncertain.requestId)).canRetry, false);
  assert.equal((await g.core.send('chief', input)).status, 'failed');
  assert.equal(dispatches, 1);
});

test('久未活动的话题直接从自己的来源分页，三万个别话题消息不会挡住它', async t => {
  const f = await setup(); t.after(() => f.core.stop());
  f.histories.a = [msg('1', 'user', '很早的话题', 1)];
  f.histories.b = Array.from({ length: 30000 }, (_, i) => msg(String(i + 1), 'user', '另一话题', 100 + i));
  const original = f.deps.sessions.historyPage, called = [];
  f.deps.sessions.historyPage = async (id, options) => { called.push(id); return original(id, options); };
  const result = await f.core.page('chief', { topic: 'a', limit: 10 });
  assert.equal(result.items.filter(item => item.kind === 'message').length, 1);
  assert.equal(result.items.find(item => item.kind === 'message').text, '很早的话题');
  assert.ok(called.length < 20); assert.ok(called.every(id => id === 'a'));
});
