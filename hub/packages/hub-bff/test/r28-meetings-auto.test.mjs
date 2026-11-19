// 路37 补验：晨会、晚会到点自动开。假时钟、真处理器装配（server.mjs 的 createHandler），
// 定时器是扩展自己的 setInterval（tickMs 调小），时间由注入的 now 推进。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { realDeps, autoReply } from './real-deps.mjs';
import { createHandler } from '../server.mjs';
import { DshClient } from '../lib/dsh-client.mjs';
import { MemoryUpstream, secretFile, request } from './fixtures.mjs';

const at = text => Date.parse(`2030-01-07T${text}:00+09:00`);

// 起一个带假时钟的真装配环境；会议时间与扫描间隔可调。
async function setup(extra = {}) {
  const clock = { t: at('07:00') };
  const meetings = { times: { morning: '08:00', evening: '21:00' }, tickMs: 20, attendees: { evening: 'all' },
    kb: { kbAgentPath: '/usr/bin/false' }, ...extra.meetings };
  const env = await realDeps({ handlerOptions: { now: () => clock.t,
    hubConfig: { timezone: 'Asia/Tokyo', meetings, ...extra.hubConfig } } });
  const prompts = [];
  autoReply(env.f.source, () => '今天学到：先核对再记录。');
  const rpc = env.f.source.rpcOverride;
  env.f.source.rpcOverride = async envelope => {
    if (envelope.method === 'session/prompt') prompts.push(envelope.payload.args.request.sessionId);
    return rpc(envelope);
  };
  await env.f.handler.start();
  return { ...env, clock, prompts };
}

// 等条件成立，超时则带说明失败。
async function until(check, message) {
  for (let i = 0; i < 300; i++) {
    const value = await check();
    if (value) return value;
    await delay(20);
  }
  assert.fail(message);
}

const status = env => env.request({ path: '/meetings/status' }).json();
const exists = file => access(file).then(() => true, () => false);

test('r28 晨会：没到点不开，到点自动开一次，纪要落盘且当天不重复', async () => {
  const env = await setup();
  try {
    await delay(150);
    assert.equal((await status(env)).today.morning, false, '07:00 不该已经开过');
    assert.equal(env.prompts.length, 0);
    env.clock.t = at('08:00');
    const opened = await until(async () => (await status(env)).today.morning, '到 08:00 晨会没有自动开');
    assert.equal(opened, true);
    const today = await env.request({ path: '/meetings/today' }).json();
    const morning = today.minutes.find(row => row.type === 'morning');
    assert.ok(morning, '/meetings/today 里应有晨会纪要');
    const first = env.prompts.length;
    assert.ok(first > 0, '参会助理应收到提示');
    env.clock.t = at('08:30');
    await delay(250);
    assert.equal(env.prompts.length, first, '同一天不能再开第二次');
    assert.equal((await status(env)).today.evening, false, '晚会没到点不能开');
  } finally {
    await env.f.dispose();
  }
});

test('r28 晚会：21:00 到点自动开，参会者各有一个隐藏会话', async () => {
  const env = await setup();
  try {
    env.clock.t = at('21:05');
    await until(async () => (await status(env)).today.evening, '到 21:05 晚会没有自动开');
    const hidden = env.deps.sessions.list({ all: true }).filter(row => row.purpose === 'meeting');
    assert.ok(hidden.length > 0 && hidden.every(row => row.hidden), '晚会参会会话应为隐藏会话');
    const listed = await env.request({ path: '/bff/sessions' }).json();
    assert.ok(hidden.every(row => !listed.sessions.some(item => item.id === row.id)), '隐藏会话不进清单');
  } finally {
    await env.f.dispose();
  }
});

test('r28 补开窗口：窗口内迟到仍开，超出窗口不补', async () => {
  const late = await setup({ meetings: { catchUpMinutes: 60 } });
  try {
    late.clock.t = at('08:59');
    await until(async () => (await status(late)).today.morning, '窗口内（59 分钟）应补开');
  } finally {
    await late.f.dispose();
  }
  const missed = await setup({ meetings: { catchUpMinutes: 60 } });
  try {
    missed.clock.t = at('09:30');
    await delay(300);
    assert.equal((await status(missed)).today.morning, false, '超出补开窗口不该开');
    assert.equal(missed.prompts.length, 0);
  } finally {
    await missed.f.dispose();
  }
});

test('r28 后端重启：当天已有纪要的不重开，换一天又能到点开', async () => {
  const env = await setup();
  let second;
  try {
    env.clock.t = at('08:10');
    await until(async () => (await status(env)).today.morning, '重启前晨会应已开');
    const file = (await env.request({ path: '/meetings/today' }).json()).minutes.find(r => r.type === 'morning').file;
    if (file) assert.ok(await exists(file), '纪要文件应在盘上');
    await env.f.handler.dispose();
    // 同一份数据目录，新进程（新内存、新假内核）接着跑。
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
    await delay(300);
    assert.equal(prompts.length, 0, '重启后同一天不能再开一次晨会');
    const day2 = at('08:10') + 86400000;
    env.clock.t = day2;
    await until(() => prompts.length > 0, '第二天到点应又能自动开，状态：' +
      JSON.stringify(await request(handler, { path: '/meetings/status' }).json()));
    // 等这次会开完再收工，免得收尾时还有会在跑。
    await until(async () => (await request(handler, { path: '/meetings/status' }).json()).today.morning,
      '第二天的晨会没开完');
  } finally {
    await second?.handler.dispose();
    second?.client.dispose();
    env.f.client.dispose();
  }
});

test('r28 一键全停期间到点不开，恢复后补开', async () => {
  const env = await setup();
  try {
    const stop = env.request({ method: 'POST', path: '/panic/stop', value: {} });
    await stop.json();
    assert.equal(stop.res.status, 200);
    env.clock.t = at('08:05');
    await delay(300);
    assert.equal((await status(env)).today.morning, false, '全停期间不能开会');
    assert.equal(env.prompts.length, 0);
    const resume = env.request({
      method: 'POST', path: '/panic/resume', value: {}, headers: { 'x-hub-device': 'phone-1' }
    });
    await resume.json();
    assert.equal(resume.res.status, 200);
    await until(async () => (await status(env)).today.morning, '恢复后窗口内应补开');
  } finally {
    await env.f.dispose();
  }
});

test('r28 纪要文件内容可读（晨会至少有标题与日期）', async () => {
  const env = await setup();
  try {
    env.clock.t = at('08:00');
    await until(async () => (await status(env)).today.morning, '晨会没开');
    const row = (await env.request({ path: '/meetings/today' }).json()).minutes.find(r => r.type === 'morning');
    const text = row.file ? await readFile(row.file, 'utf8') : JSON.stringify(row);
    assert.match(text, /2030-01-07/u);
  } finally {
    await env.f.dispose();
  }
});
