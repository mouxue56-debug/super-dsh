import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHandler, createMeetingService, readTodayMinutes, __tick } from '../lib/ext/meetings.mjs';

const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'meeting-ext-'));
const marker = path.join(base, 'EXECUTED');
const agent = path.join(base, 'agent');
fs.writeFileSync(agent, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
after(() => assert.equal(fs.existsSync(marker), false));
const date = '2026-01-02';
let serial = 0;

function fixture(options = {}) {
  const dir = path.join(base, String(++serial));
  fs.mkdirSync(dir);
  const calls = [];
  const cards = [];
  const deps = {
    dataDir: dir,
    configDir: dir,
    now: () => Date.parse(date + 'T18:00:00Z'),
    roster: [{ id: 'a1', name: '甲', role: 'assistant' }, { id: 'a2', name: '乙', role: 'assistant' }],
    hubConfig: { meetings: { utcOffsetMinutes: 0, kb: { kbAgentPath: agent } } },
    sessions: { list: async () => [], create: async id => id, send: async id => id === 'a1' ?
      { accepted: true, requestId: id, reply: Promise.resolve({ text: `经验 ${id}`, failed: false, toolEvents: [] }) } :
      `经验 ${id}` },
    cards: { ask: card => {
      cards.push(card);
      return options.decision;
    } },
    kbExecFile: (file, args, opts, cb) => {
      calls.push(args);
      const result = args[2] === 'record' ? { state: 'queued', id: 'receipt' } :
        { event: 'receipt', state: 'pushed', commit: 'a'.repeat(40) };
      cb(null, JSON.stringify(result));
    },
  };
  return { deps, dir, calls, cards, service: createMeetingService(deps) };
}

async function request(handler, method, url, input) {
  const req = Readable.from(input === undefined ? [] : [input]);
  req.url = url;
  req.method = method;
  req.headers = {};
  const res = { writeHead(status) { this.status = status; }, end(value) { this.value = JSON.parse(value); } };
  const handled = await handler(req, res);
  return { handled, ...res };
}

test('晚会生成汇报、学习与草稿', async () => {
  const f = fixture();
  const result = await f.service.run({ type: 'evening', date });
  const text = fs.readFileSync(result.file, 'utf8');
  assert.match(text, /甲 给首席/);
  assert.match(text, /乙 给首席/);
  assert.match(text, /经验 a1/);
  assert.equal(result.drafts, 2);
  assert.equal(result.learned.a1, true);
});
test('HTTP 手动运行', async () => {
  const f = fixture();
  const r = await request(createHandler(f.deps), 'POST', '/meetings/run', '{"type":"morning"}');
  assert.equal(r.status, 200);
  assert.equal(r.value.type, 'morning');
});
test('HTTP 非法类型', async () => {
  const r = await request(createHandler(fixture().deps), 'POST', '/meetings/run', '{"type":"bad"}');
  assert.equal(r.status, 400);
});
test('HTTP 坏 JSON', async () => {
  const r = await request(createHandler(fixture().deps), 'POST', '/meetings/run', '{');
  assert.equal(r.status, 400);
});
test('HTTP 超限', async () => {
  const r = await request(createHandler(fixture().deps), 'POST', '/meetings/run', 'x'.repeat(65537));
  assert.equal(r.status, 413);
});
test('HTTP 方法限制与路由边界', async () => {
  const handler = createHandler(fixture().deps);
  assert.equal((await request(handler, 'GET', '/meetings/run')).status, 405);
  assert.equal((await request(handler, 'GET', '/other')).handled, false);
});
test('重复会议不重复追加和出卡', async () => {
  const f = fixture();
  const first = await f.service.run({ type: 'evening', date });
  await f.service.idle();
  const text = fs.readFileSync(first.file, 'utf8');
  const second = await f.service.run({ type: 'evening', date });
  await f.service.idle();
  assert.equal(fs.readFileSync(first.file, 'utf8'), text);
  assert.equal(second.appended, false);
  assert.equal(f.cards.length, 2);
});
test('确认卡保留草稿且不执行投递', async () => {
  const f = fixture();
  const r = await f.service.run({ type: 'evening', date });
  await f.service.idle();
  assert.equal(f.cards.length, 2);
  assert.ok(f.cards[0].what && f.cards[0].where && f.cards[0].why);
  assert.equal(f.cards[0].actions.length, 3);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(path.join(f.dir, 'meetings', 'kb-pending', r.cards[0].draftId + '.json')), true);
});
test('拒绝后不投且不再出卡', async () => {
  const f = fixture({ decision: { decision: 'reject' } });
  await f.service.run({ type: 'evening', date });
  await f.service.idle();
  await f.service.run({ type: 'evening', date });
  await f.service.idle();
  assert.equal(f.cards.length, 2);
  assert.equal(f.calls.length, 0);
  assert.match(fs.readFileSync(path.join(f.dir, 'meetings', 'kb-log.jsonl'), 'utf8'), /rejected/);
});
test('HTTP 拒绝删除待处理', async () => {
  const f = fixture();
  const result = await f.service.run({ type: 'evening', date });
  const id = result.cards[0].draftId;
  const r = await request(createHandler(f.deps), 'POST', `/meetings/cards/${id}/reject`, '{}');
  assert.equal(r.value.state, 'rejected');
  assert.equal(fs.existsSync(path.join(f.dir, 'meetings', 'kb-pending', id + '.json')), false);
  assert.equal(f.calls.length, 0);
});
test('未决定的卡可查询', async () => {
  const f = fixture();
  await f.service.run({ type: 'evening', date });
  const r = await request(createHandler(f.deps), 'GET', '/meetings/cards');
  assert.equal(r.value.cards.length, 2);
  assert.equal(f.calls.length, 0);
});
test('单次投递无放权', async () => {
  const f = fixture();
  const result = await f.service.run({ type: 'evening', date });
  const r = await f.service.apply(result.cards[0].draftId, 'approve');
  assert.equal(r.state, 'delivered');
  assert.equal(f.calls.length, 2);
  assert.equal(fs.existsSync(path.join(f.dir, 'kb-contribute-grants.json')), false);
});
test('放权后同类自动投递', async () => {
  const f = fixture();
  const result = await f.service.run({ type: 'evening', date });
  const r = await f.service.apply(result.cards[0].draftId, 'approve-always', 'owner');
  assert.equal(r.state, 'delivered');
  const grants = JSON.parse(fs.readFileSync(path.join(f.dir, 'kb-contribute-grants.json')));
  assert.equal(grants.grants[0].by, 'owner');
  assert.equal(grants.grants[0].on, date);
  f.deps.sessions.send = async id => `新经验 ${id}`;
  const next = await f.service.run({ type: 'evening', date });
  assert.equal(next.submitted.length, 2);
});
test('未配置投递时保留草稿', async () => {
  const f = fixture();
  delete f.deps.hubConfig.meetings.kb.kbAgentPath;
  const service = createMeetingService(f.deps);
  const result = await service.run({ type: 'evening', date });
  assert.deepEqual(await service.apply(result.cards[0].draftId, 'approve'),
    { state: 'pending', reason: 'kb-not-configured' });
  assert.equal(f.calls.length, 0);
});
test('无会话时纪要显示无', async () => {
  const f = fixture();
  delete f.deps.sessions;
  const result = await createMeetingService(f.deps).run({ type: 'morning', date });
  assert.match(fs.readFileSync(result.file, 'utf8'), /学到的一条\n（无）/);
});
test('会话错误与超时降级', async () => {
  const f = fixture();
  f.deps.hubConfig.meetings.learnTimeoutMs = 5;
  f.deps.sessions.send = id => id === 'a1' ? Promise.reject(new Error()) : new Promise(() => {});
  const result = await createMeetingService(f.deps).run({ type: 'morning', date });
  assert.deepEqual(result.learned, { a1: false, a2: false });
});
test('并发同类 HTTP 返回冲突', async () => {
  const f = fixture();
  const releases = [];
  f.deps.sessions.send = () => new Promise(resolve => { releases.push(resolve); });
  const handler = createHandler(f.deps);
  const first = request(handler, 'POST', '/meetings/run', '{"type":"morning"}');
  await new Promise(resolve => setTimeout(resolve, 10));
  const second = await request(handler, 'POST', '/meetings/run', '{"type":"morning"}');
  assert.equal(second.status, 409);
  releases.forEach(resolve => resolve('经验'));
  await first;
});
test('定时窗口与文件幂等', async () => {
  const f = fixture();
  f.deps.hubConfig.meetings.times = { morning: '18:01' };
  assert.deepEqual(await __tick(f.deps), []);
  f.deps.hubConfig.meetings.times.morning = '18:00';
  assert.deepEqual(await __tick(f.deps), ['morning']);
  assert.deepEqual(await __tick(f.deps), []);
});
test('超过窗口或未配置时间不开', async () => {
  const f = fixture();
  f.deps.hubConfig.meetings.times = { morning: '09:00' };
  assert.deepEqual(await __tick(f.deps), []);
  delete f.deps.hubConfig.meetings.times;
  assert.deepEqual(await __tick(f.deps), []);
});
test('读取今天两份纪要及 latest', async () => {
  const f = fixture();
  assert.deepEqual(readTodayMinutes(f.deps).minutes, []);
  await f.service.run({ type: 'morning', date });
  await f.service.run({ type: 'evening', date });
  assert.equal(readTodayMinutes(f.deps).minutes.length, 2);
  const r = await request(createHandler(f.deps), 'GET', '/meetings/today');
  assert.equal(r.value.minutes.length, 2);
  assert.equal(fs.existsSync(path.join(f.dir, 'meetings', 'latest.json')), true);
});
test('穿越参数被拒', async () => {
  const handler = createHandler(fixture().deps);
  assert.equal((await request(handler, 'GET', '/meetings/minutes?date=../x&type=morning')).status, 400);
  assert.ok([400, 404].includes((await request(handler, 'POST', '/meetings/cards/%2e%2e%2fx/approve', '{}')).status));
});
test('源码卫生', () => {
  for (const file of ['../lib/ext/meetings.mjs', '../lib/meetings-sources.mjs']) {
    const text = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.ok(text.split('\n').every(line => [...line].length <= 120));
    assert.doesNotMatch(text, /\/Users\/|execSync|\bexec\(|shell:/);
  }
});

test('失败定时任务十分钟内不重试', async () => {
  const f = fixture();
  let ms = Date.parse(date + 'T18:00:00Z');
  let failures = 0;
  f.deps.now = () => ms;
  f.deps.log = () => { failures += 1; };
  f.deps.hubConfig.meetings.times = { morning: '18:00' };
  const target = path.join(f.dir, 'invalid');
  fs.writeFileSync(target, 'x');
  f.deps.hubConfig.meetings.minutesDir = target;
  assert.deepEqual(await __tick(f.deps), []);
  assert.equal(failures, 1);
  ms += 9 * 60000;
  assert.deepEqual(await __tick(f.deps), []);
  assert.equal(failures, 1);
  ms += 60000;
  assert.deepEqual(await __tick(f.deps), []);
  assert.equal(failures, 2);
});

test('配置错误保留待投草稿', async () => {
  const f = fixture();
  f.deps.hubConfig.meetings.kb.kbAgentPath = path.join(f.dir, 'missing');
  const service = createMeetingService(f.deps);
  const result = await service.run({ type: 'evening', date });
  const id = result.cards[0].draftId;
  assert.deepEqual(await service.apply(id, 'approve'), { state: 'pending', reason: 'config-error' });
  assert.equal(fs.existsSync(path.join(f.dir, 'meetings', 'kb-pending', id + '.json')), true);
  assert.equal(f.calls.length, 0);
});

test('不同项目的草稿不继承放权', async () => {
  const f = fixture();
  f.deps.hubConfig.meetings.projectMap = { byAssistant: { a1: 'alpha', a2: 'beta' }, default: 'alpha' };
  const service = createMeetingService(f.deps);
  const result = await service.run({ type: 'evening', date });
  await service.apply(result.cards.find(x => x.project === 'alpha').draftId, 'approve-always', 'owner');
  f.deps.sessions.send = async id => `新经验 ${id}`;
  const next = await service.run({ type: 'evening', date });
  assert.equal(next.submitted.length, 1);
  assert.deepEqual(next.cards.map(x => x.project), ['beta']);
});
