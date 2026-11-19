// 第三轮复核 R3-4（停机标记位置统一）、R3-5（外包派工认停机）、R3-11（恢复要设备头）的补充用例。
// 监工自己想到的变形；复核员的 review3-* 原样不动。假工人只是本地一个立刻退出的脚本。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createBoard} from '../lib/board.mjs';
import * as ext from '../lib/ext/dispatch.mjs';
import * as panic from '../lib/ext/panic.mjs';
import {panicStateDir, panicStateDirs, stoppedAt, anyStopped} from '../lib/panic-marker.mjs';

// 直接调处理器，不起端口。
async function request(handler, url, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.url = url;
  req.method = body === undefined ? 'GET' : 'POST';
  req.headers = headers;
  const res = {text: ''};
  res.writeHead = s => { res.status = s; };
  res.end = t => { res.text += t ?? ''; };
  await handler(req, res);
  return {status: res.status, body: res.text ? JSON.parse(res.text) : undefined};
}

// 外包派工与一键全停共用同一组依赖，和后端真接线一样。
async function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fixe-panic-')));
  const root = path.join(dir, 'work');
  fs.mkdirSync(root);
  const script = path.join(dir, 'worker.mjs');
  fs.writeFileSync(script, "import fs from 'node:fs';fs.writeFileSync(process.argv[2],'done');");
  const board = createBoard({root: path.join(dir, 'board')});
  const resolvers = [];
  const events = [];
  const cards = [];
  const roster = [{id: 'bot', status: 'active'}];
  const deps = {board, configDir: dir, dataDir: dir, now: Date.now, utcOffsetMinutes: 0, isTrusted: () => true,
    roster: {list: () => roster, get: id => roster.find(r => r.id === id)},
    cards: {ask: card => new Promise(resolve => {
      cards.push(card);
      resolvers.push(resolve);
    })},
    notify: e => events.push(e), ledger: {record() {}}, logger: {error() {}},
    hubConfig: {panic: {timers: []}, dispatch: {root, run_dir: path.join(dir, 'runs'), poll_ms: 0, heartbeat_ms: 100,
      stop_wait_ms: 100, workers: {worker: {argv: [process.execPath, script, '{result_file}'], models: ['model-1']}}}}};
  const handler = ext.createHandler(deps);
  const panicHandler = panic.createHandler(deps);
  await ext.start(deps);
  t.after(async () => {
    for (const r of resolvers) r({status: 'timeout'});
    await ext.waitIdle(deps);
    for (const run of ext.listRunning()) {
      try {
        process.kill(-run.pid, 'SIGKILL');
      } catch {
        // 已退出
      }
    }
    ext.stop();
    panic.stop();
  });
  const ticket = () => board.create({name: 'bot', type: 'assistant'}, {title: 't', goal: '任务书正文',
    to: ['worker'],
    routing: {requestedBy: 'bot', hint: '', worker: 'worker', model: 'model-1', via: 'dispatch_prepare'},
    acceptance: [{check: '检查', expect: '通过'}], forbidden: [], readExternalContent: false});
  const post = id => request(handler, '/dispatch/runs', {ticket: id, bot: 'bot', readExternal: false});
  const device = {'x-hub-device': 'phone-1'};
  const stop = () => request(panicHandler, '/panic/stop', {}, device);
  const resume = (headers = device) => request(panicHandler, '/panic/resume', {}, headers);
  return {dir, deps, ticket, post, stop, resume, resolvers, events, cards};
}

test('R3-5 变形：全停再恢复后批准旧卡也不起工人，旧卡作废，同一张单重新出卡', async t => {
  const h = await fixture(t);
  const a = await h.ticket();
  assert.equal((await h.post(a.id)).status, 202);
  assert.equal((await h.stop()).status, 200);
  assert.equal((await h.resume()).status, 200);
  const again = await h.post(a.id);
  assert.equal(again.status, 202);
  assert.notEqual(again.body.repeated, true, '恢复后应重新出卡，不能沿用作废的旧卡');
  assert.equal(h.cards.length, 2);
  h.resolvers.shift()({id: 'card-old', status: 'answered', choice: 'approve', device: 'd1'});
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(ext.listRunning(), [], '作废的旧卡被批准后起了工人');
  assert.ok(h.events.some(e => e.code === 'PANIC_STOPPED'), '没有告诉主人旧卡作废');
});

test('R3-5 变形：停着时直接派工 503，不出卡；停机状态文件坏了也按停着', async t => {
  const h = await fixture(t);
  const a = await h.ticket();
  await h.stop();
  const got = await h.post(a.id);
  assert.equal(got.status, 503);
  assert.equal(got.body.error.code, 'PANIC_STOPPED');
  assert.equal(h.cards.length, 0);
  assert.equal((await h.resume()).status, 200);
  fs.writeFileSync(path.join(h.dir, 'panic', 'state.json'), '{坏');
  assert.equal((await h.post(a.id)).status, 503, '状态文件坏了仍放行派工');
});

// 停机发生在「卡已批、运行器还没起工人」之间：运行器自己的两道闸各拦一次。
for (const [label, from, failed] of [['运行器入口', 3, false], ['领单之后、起进程之前', 5, true]]) {
  test('R3-5 变形：批准之后才全停，' + label + '也不起工人', async t => {
    const h = await fixture(t);
    const a = await h.ticket();
    let calls = 0;
    h.deps.panic = {isStopped: () => ++calls >= from};
    assert.equal((await h.post(a.id)).status, 202);
    h.resolvers.shift()({id: 'card-1', status: 'answered', choice: 'approve', device: 'd1'});
    await ext.waitIdle(h.deps);
    assert.deepEqual(ext.listRunning(), [], '停机后起了工人');
    assert.ok(h.events.some(e => e.kind === 'refused' && /一键全停/u.test(e.text)), JSON.stringify(h.events));
    const after = await h.deps.board.get(a.id);
    assert.equal(after.state === 'failed', failed, '工单状态：' + after.state);
  });
}

test('R3-5 变形：停机闸门自己出错按停着', async t => {
  const h = await fixture(t);
  const a = await h.ticket();
  h.deps.panic = {isStopped: () => {
    throw new Error('坏了');
  }};
  assert.equal((await h.post(a.id)).status, 503);
});

test('R3-11 变形：解除全停没有设备头、设备头格式不对都 403，停机状态不变', async t => {
  const h = await fixture(t);
  await h.stop();
  for (const headers of [{}, {'x-hub-device': ''}, {'x-hub-device': 'a b'}, {'x-hub-device': 'x'.repeat(65)}]) {
    assert.equal((await h.resume(headers)).status, 403, JSON.stringify(headers));
  }
  assert.ok(stoppedAt(path.join(h.dir, 'panic')));
});

test('R3-4 变形：停机目录的唯一定义，自定义目录、$HUB_HOME 写法、环境变量、默认位置都列到', () => {
  const hubHome = '/h';
  assert.equal(panicStateDir({dataDir: '/d'}), '/d/panic');
  assert.equal(panicStateDir({dataDir: '/d', hubConfig: {panic: {stateDir: '/s'}}}), '/s');
  assert.equal(panicStateDir({dataDir: '/d', hubConfig: {panic: {stateDir: '$HUB_HOME/s'}}, hubHome}), '/h/s');
  assert.equal(panicStateDir({dataDir: '/d', hubConfig: {panic: {stateDir: 'relative'}}}), '/d/panic');
  assert.equal(panicStateDir({}), undefined);
  const dirs = panicStateDirs({hubHome, home: '/u', hubConfig: {data_dir: '~/x'}, env: {HUB_DATA_DIR: '/e'}});
  assert.deepEqual(dirs, ['/e/panic', '/u/x/panic', '/h/hub-data/panic']);
  assert.equal(anyStopped([]), true, '一处都算不出按停着');
});

test('R3-4 变形：标记在、状态文件写着停、状态文件坏了都算停；全新与已恢复不算停', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixe-marker-'));
  assert.equal(stoppedAt(dir), false);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({stopped: false, lastResumeAt: 1}));
  assert.equal(stoppedAt(dir), false);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({stopped: true}));
  assert.equal(stoppedAt(dir), true);
  fs.writeFileSync(path.join(dir, 'state.json'), '[');
  assert.equal(stoppedAt(dir), true);
  fs.writeFileSync(path.join(dir, 'state.json'), '{}');
  fs.writeFileSync(path.join(dir, 'stopped.flag'), '');
  assert.equal(stoppedAt(dir), true);
  assert.equal(stoppedAt('relative/dir'), true);
});
