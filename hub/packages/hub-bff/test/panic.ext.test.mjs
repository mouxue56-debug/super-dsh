// 一键全停 HTTP 扩展。真起本机 http 服务（端口 0），子系统全部用假的。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandler, start, stop } from '../lib/ext/panic.mjs';

const quiet = { error() {}, log() {} };
let counter = 0;

function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panic-ext-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// 假的会话子系统：cancel 之后 delayMs 毫秒才把 running 改成 false；stuck 的永远不停。
function fakeSessions(rows, { delayMs = 10, noCancel = false, stuck = [], throwing = [] } = {}) {
  const log = { cancelled: [], sent: [], created: [] };
  const sessions = {
    list: async () => rows.map(row => ({ ...row })),
    send: async (id, text) => {
      log.sent.push(id);
      return '好';
    },
    create: async bot => {
      log.created.push(bot);
      return 's-new';
    },
  };
  if (!noCancel) {
    sessions.cancel = async id => {
      if (throwing.includes(id)) throw new Error('refused');
      log.cancelled.push(id);
      if (stuck.includes(id)) return;
      setTimeout(() => {
        const row = rows.find(item => item.id === id);
        if (row) row.running = false;
      }, delayMs);
    };
  }
  return { sessions, log };
}

// 在临时目录里写假的子系统模块；每次调用都记到 globalThis 的日志里。
function fakeModule(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.mjs'), body);
}

function timerModule(token, label, { failStop = false } = {}) {
  return `const log = (globalThis.__panicLog ??= {});
(log['${token}'] ??= []);
export function stop() {
  log['${token}'].push('${label}.stop');
  ${failStop ? "throw new Error('timer stuck');" : ''}
}
export function start() { log['${token}'].push('${label}.start'); }
`;
}

function setup(t, over = {}) {
  const dataDir = over.dataDir ?? tmpdir(t);
  const seamRoot = tmpdir(t);
  const token = 'tok' + (++counter);
  const extDir = path.join(seamRoot, 'ext');
  const libDir = path.join(seamRoot, 'lib');
  fs.mkdirSync(extDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  const deps = {
    dataDir,
    hubConfig: { panic: { verifyWaitMs: 200, verifyPollMs: 10, reapplyDelayMs: 30, ...(over.panic ?? {}) } },
    now: () => 1700000000000,
    logger: quiet,
    panicSeams: { extDir, libDir },
    ...(over.sessions ? { sessions: over.sessions } : {}),
    ...(over.isTrusted ? { isTrusted: over.isTrusted } : {}),
  };
  const handler = createHandler(deps);
  const server = http.createServer(async (req, res) => {
    if (!await handler(req, res)) {
      res.writeHead(418);
      res.end();
    }
  });
  const ready = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    stop();
    await new Promise(resolve => server.close(resolve));
  });
  const call = async (method, route, body) => {
    await ready;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method,
      // 恢复要网页层重建的设备头；这里模拟已登录设备。
      headers: { 'x-hub-device': 'test-device' },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
    }
    return { status: response.status, json };
  };
  const calls = () => globalThis.__panicLog?.[token] ?? [];
  return { deps, call, extDir, libDir, token, dataDir, calls, handler };
}

test('没有任何子系统：全是 absent，仍然如实报全停；闸门步骤也是 absent', async t => {
  const env = setup(t);
  const stopped = await env.call('POST', '/panic/stop', {});
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.state, 'stopped');
  assert.equal(stopped.json.steps.gate.status, 'absent');
  assert.equal(stopped.json.steps.sessions.status, 'absent');
  assert.equal(stopped.json.steps['timer:meetings'].status, 'absent');
  assert.equal(stopped.json.steps.dispatch.status, 'absent');
  assert.equal(fs.existsSync(path.join(env.dataDir, 'panic', 'stopped.flag')), true);
});

test('会话：在跑的回合被取消并回查为 0；停机期间 send/create 被拒；恢复后放行', async t => {
  const rows = [{ id: 's1', running: true }, { id: 's2', running: true, hidden: true }, { id: 's3', running: false }];
  const fake = fakeSessions(rows);
  const env = setup(t, { sessions: fake.sessions });
  const before = await env.deps.sessions.send('s3', 'hi');
  assert.equal(before, '好');
  const stopped = await env.call('POST', '/panic/stop', { reason: '测试' });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.steps.sessions.status, 'ok');
  assert.deepEqual(fake.log.cancelled.sort(), ['s1', 's2']);
  await assert.rejects(() => env.deps.sessions.send('s3', 'x'), { code: 'PANIC_STOPPED' });
  await assert.rejects(() => env.deps.sessions.create('chief'), { code: 'PANIC_STOPPED' });
  assert.equal(fake.log.sent.length, 1);
  const resumed = await env.call('POST', '/panic/resume');
  assert.equal(resumed.status, 200);
  assert.equal(resumed.json.state, 'running');
  assert.equal(await env.deps.sessions.send('s3', 'back'), '好');
});

test('会话：有在跑的但没有取消入口 -> 不许报全停', async t => {
  const rows = [{ id: 's1', running: true }];
  const fake = fakeSessions(rows, { noCancel: true });
  const env = setup(t, { sessions: fake.sessions });
  const stopped = await env.call('POST', '/panic/stop', {});
  assert.equal(stopped.status, 503);
  assert.equal(stopped.json.ok, false);
  assert.equal(stopped.json.state, 'partial');
  assert.equal(stopped.json.steps.sessions.status, 'failed');
  assert.match(stopped.json.steps.sessions.detail, /cancel/u);
  assert.equal(stopped.json.marker, true);
  await assert.rejects(() => env.deps.sessions.send('s1', 'x'), { code: 'PANIC_STOPPED' });
});

test('会话：取消发了但有一个一直不停 -> 回查发现，partial；取消被拒也如实写', async t => {
  const rows = [{ id: 's1', running: true }, { id: 's2', running: true }];
  const fake = fakeSessions(rows, { stuck: ['s2'], throwing: ['s1'] });
  const env = setup(t, { sessions: fake.sessions });
  const stopped = await env.call('POST', '/panic/stop', {});
  assert.equal(stopped.status, 503);
  assert.equal(stopped.json.steps.sessions.status, 'failed');
  assert.match(stopped.json.steps.sessions.detail, /仍有 2/u);
  assert.match(stopped.json.steps.sessions.detail, /取消被拒 1/u);
});

test('没有在跑的会话时不需要 cancel 入口', async t => {
  const fake = fakeSessions([{ id: 's1', running: false }], { noCancel: true });
  const env = setup(t, { sessions: fake.sessions });
  const stopped = await env.call('POST', '/panic/stop', {});
  assert.equal(stopped.json.state, 'stopped');
  assert.equal(stopped.json.steps.sessions.status, 'ok');
});

test('定时器：存在的被停，不存在的跳过，没有 stop 的标 absent；恢复时只重启存在的', async t => {
  const env = setup(t);
  fakeModule(env.extDir, 'meetings', timerModule(env.token, 'meetings'));
  fakeModule(env.extDir, 'routines', 'export const note = 1;\n');
  const stopped = await env.call('POST', '/panic/stop', {});
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.steps['timer:meetings'].status, 'ok');
  assert.equal(stopped.json.steps['timer:groups'].status, 'absent');
  assert.equal(stopped.json.steps['timer:routines'].status, 'absent');
  assert.deepEqual(env.calls(), ['meetings.stop']);
  await env.call('POST', '/panic/resume');
  assert.deepEqual(env.calls(), ['meetings.stop', 'meetings.start']);
});

test('定时器 stop 抛错 -> partial，其余步骤照常做完', async t => {
  const env = setup(t);
  fakeModule(env.extDir, 'meetings', timerModule(env.token, 'meetings', { failStop: true }));
  fakeModule(env.extDir, 'groups', timerModule(env.token, 'groups'));
  const stopped = await env.call('POST', '/panic/stop', {});
  assert.equal(stopped.status, 503);
  assert.equal(stopped.json.steps['timer:meetings'].status, 'failed');
  assert.equal(stopped.json.steps['timer:groups'].status, 'ok');
  assert.deepEqual(env.calls(), ['meetings.stop', 'groups.stop']);
});

test('定时器模块自己有语法错误：报失败而不是当成不存在', async t => {
  const env = setup(t);
  fakeModule(env.extDir, 'meetings', 'export function stop( {');
  const stopped = await env.call('POST', '/panic/stop', {});
  assert.equal(stopped.json.steps['timer:meetings'].status, 'failed');
  assert.equal(stopped.json.state, 'partial');
});

test('配置能改定时器名单（暂定）', async t => {
  const env = setup(t, { panic: { timers: ['extra'] } });
  fakeModule(env.extDir, 'extra', timerModule(env.token, 'extra'));
  fakeModule(env.extDir, 'meetings', timerModule(env.token, 'meetings'));
  await env.call('POST', '/panic/stop', {});
  assert.deepEqual(env.calls(), ['extra.stop']);
});

test('外包运行器：存在则 stopAll 并回查 listRunning；回查还有就失败', async t => {
  const env = setup(t);
  fakeModule(env.libDir, 'dispatch-runner', `
let running = ['w1', 'w2'];
export const listRunning = () => running.map(id => ({ id }));
export const stopAll = async () => { running = []; };
`);
  const stopped = await env.call('POST', '/panic/stop', {});
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.steps.dispatch.status, 'ok');
  assert.match(stopped.json.steps.dispatch.detail, /原有 2 个/u);
  const bad = setup(t);
  fakeModule(bad.libDir, 'dispatch-runner', `
export const listRunning = () => [{ id: 'w1' }];
export const stopAll = async () => {};
`);
  const failed = await bad.call('POST', '/panic/stop', {});
  assert.equal(failed.status, 503);
  assert.equal(failed.json.steps.dispatch.status, 'failed');
  assert.match(failed.json.steps.dispatch.detail, /仍有 1/u);
});

test('外包运行器缺导出：失败（不能假装停了）；stopAll 抛错：失败', async t => {
  const missing = setup(t);
  fakeModule(missing.libDir, 'dispatch-runner', 'export const listRunning = () => [];\n');
  assert.equal((await missing.call('POST', '/panic/stop', {})).json.steps.dispatch.status, 'failed');
  const throwing = setup(t);
  fakeModule(throwing.libDir, 'dispatch-runner', `
export const listRunning = () => [{ id: 'a' }];
export const stopAll = () => { throw new Error('kill failed'); };
`);
  const result = await throwing.call('POST', '/panic/stop', {});
  assert.equal(result.json.steps.dispatch.status, 'failed');
  assert.match(result.json.steps.dispatch.detail, /kill failed/u);
});

test('重启后仍是停的：新实例读到状态，闸门重装，start 把重新拉起的定时器再停一遍', async t => {
  const dataDir = tmpdir(t);
  const rows = [{ id: 's1', running: false }];
  const first = setup(t, { dataDir, sessions: fakeSessions(rows).sessions });
  fakeModule(first.extDir, 'meetings', timerModule(first.token, 'meetings'));
  await first.call('POST', '/panic/stop', {});
  stop();
  const second = setup(t, { dataDir, sessions: fakeSessions(rows).sessions });
  fakeModule(second.extDir, 'meetings', timerModule(second.token, 'meetings'));
  const status = await second.call('GET', '/panic/status');
  assert.equal(status.json.state, 'stopped');
  await assert.rejects(() => second.deps.sessions.send('s1', 'x'), { code: 'PANIC_STOPPED' });
  await start(second.deps);
  assert.deepEqual(second.calls(), ['meetings.stop']);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.deepEqual(second.calls(), ['meetings.stop', 'meetings.stop']);
  await second.call('POST', '/panic/resume');
  assert.equal(second.calls().at(-1), 'meetings.start');
  assert.equal((await second.call('GET', '/panic/status')).json.state, 'running');
});

test('重启：没停过时 start 什么也不做', async t => {
  const env = setup(t);
  fakeModule(env.extDir, 'meetings', timerModule(env.token, 'meetings'));
  await start(env.deps);
  assert.deepEqual(env.calls(), []);
});

test('重复停机、重复恢复：幂等；重复停机时失败步骤能被重试', async t => {
  const rows = [{ id: 's1', running: false }];
  const fake = fakeSessions(rows, { noCancel: true });
  const env = setup(t, { sessions: fake.sessions });
  rows[0].running = true;
  const first = await env.call('POST', '/panic/stop', {});
  assert.equal(first.json.state, 'partial');
  rows[0].running = false;
  const second = await env.call('POST', '/panic/stop', {});
  assert.equal(second.status, 200);
  assert.equal(second.json.state, 'stopped');
  assert.equal(second.json.since, first.json.since);
  assert.equal((await env.call('POST', '/panic/resume')).json.state, 'running');
  const again = await env.call('POST', '/panic/resume');
  assert.equal(again.status, 200);
  assert.equal(again.json.noop, true);
});

test('状态接口：未停时 running；返回当前在跑的会话数与外包数（拿不到就是 null）', async t => {
  const rows = [{ id: 's1', running: true }, { id: 's2', running: false }];
  const env = setup(t, { sessions: fakeSessions(rows).sessions });
  fakeModule(env.libDir, 'dispatch-runner', `
export const listRunning = () => [{ id: 'a' }];
export const stopAll = async () => {};
`);
  const status = await env.call('GET', '/panic/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.state, 'running');
  assert.equal(status.json.live.runningSessions, 1);
  assert.equal(status.json.live.runningExternal, 1);
  const bare = await setup(t).call('GET', '/panic/status');
  assert.equal(bare.json.live.runningSessions, null);
  assert.equal(bare.json.live.runningExternal, null);
});

test('标记文件是单独的文件，内容是 JSON，恢复后被删掉', async t => {
  const env = setup(t);
  const marker = path.join(env.dataDir, 'panic', 'stopped.flag');
  assert.equal(fs.existsSync(marker), false);
  await env.call('POST', '/panic/stop', {});
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).stopped, true);
  await env.call('POST', '/panic/resume');
  assert.equal(fs.existsSync(marker), false);
});

test('路径与方法：别的路径不处理，未知 404，方法不对 405', async t => {
  const env = setup(t);
  assert.equal((await env.call('GET', '/other')).status, 418);
  assert.equal((await env.call('GET', '/panicx/status')).status, 418);
  assert.equal((await env.call('GET', '/panic/nope')).status, 404);
  assert.equal((await env.call('GET', '/panic/stop')).status, 405);
  assert.equal((await env.call('POST', '/panic/status', {})).status, 405);
  assert.equal((await env.call('DELETE', '/panic/resume')).status, 405);
  assert.equal(fs.existsSync(path.join(env.dataDir, 'panic', 'stopped.flag')), false);
});

test('请求体：坏 JSON 和超大体 400，且不会触发停机', async t => {
  const env = setup(t);
  assert.equal((await env.call('POST', '/panic/stop', '{坏')).status, 400);
  assert.equal((await env.call('POST', '/panic/stop', ['a'])).status, 400);
  assert.equal((await env.call('POST', '/panic/stop', { reason: 'x'.repeat(5000) })).status, 400);
  assert.equal((await env.call('GET', '/panic/status')).json.state, 'running');
});

test('身份：deps.isTrusted 存在且不放行时 401，不执行任何动作', async t => {
  const env = setup(t, { isTrusted: () => false });
  const denied = await env.call('POST', '/panic/stop', {});
  assert.equal(denied.status, 401);
  assert.equal(fs.existsSync(path.join(env.dataDir, 'panic', 'stopped.flag')), false);
  const open = setup(t, { isTrusted: () => true });
  assert.equal((await open.call('POST', '/panic/stop', {})).status, 200);
});

test('没有数据目录：503，不假装能落盘', async t => {
  const env = setup(t);
  const bare = http.createServer(async (req, res) => {
    await createHandler({ logger: quiet })(req, res);
  });
  await new Promise(resolve => bare.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => bare.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${bare.address().port}/panic/stop`, { method: 'POST' });
  assert.equal(response.status, 503);
  assert.ok(env);
});

test('reason 只是备注：长度截断后落盘，不影响行为', async t => {
  const env = setup(t);
  const result = await env.call('POST', '/panic/stop', { reason: 'r'.repeat(300) });
  assert.equal(result.json.reason.length, 200);
});
