// 路31 第三轮复核：一键全停之后，外包派工通道不该再开工（假工人只是本地一个立刻退出的脚本）。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createBoard} from '../lib/board.mjs';
import * as ext from '../lib/ext/dispatch.mjs';

async function request(handler, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.url = url;
  req.method = body === undefined ? 'GET' : 'POST';
  req.headers = {};
  const res = {text: ''};
  res.writeHead = s => { res.status = s; };
  res.end = t => { res.text += t ?? ''; };
  await handler(req, res);
  return {status: res.status, body: res.text ? JSON.parse(res.text) : undefined};
}

async function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r3-dispatch-')));
  const root = path.join(dir, 'work');
  fs.mkdirSync(root);
  const script = path.join(dir, 'worker.mjs');
  fs.writeFileSync(script, "import fs from 'node:fs';fs.writeFileSync(process.argv[2],'done');");
  const board = createBoard({root: path.join(dir, 'board')});
  const resolvers = [];
  const roster = [{id: 'bot', status: 'active'}];
  const deps = {board, configDir: dir, dataDir: dir, now: Date.now, utcOffsetMinutes: 0, isTrusted: () => true,
    roster: {list: () => roster, get: id => roster.find(r => r.id === id)},
    cards: {ask: () => new Promise(resolve => resolvers.push(resolve))},
    notify() {}, ledger: {record() {}}, logger: {error() {}},
    hubConfig: {dispatch: {root, run_dir: path.join(dir, 'runs'), poll_ms: 0, heartbeat_ms: 100, stop_wait_ms: 100,
      workers: {worker: {argv: [process.execPath, script, '{result_file}'], models: ['model-1']}}}}};
  const handler = ext.createHandler(deps);
  await ext.start(deps);
  t.after(async () => {
    for (const r of resolvers) r({status: 'timeout'});
    await ext.waitIdle(deps);
    for (const run of ext.listRunning()) {
      try { process.kill(-run.pid, 'SIGKILL'); } catch { /* 已退出 */ }
    }
    ext.stop();
  });
  const ticket = () => board.create({name: 'bot', type: 'assistant'}, {title: 't', goal: '任务书正文',
    to: ['worker'], routing: {requestedBy: 'bot', hint: '', worker: 'worker', model: 'model-1', via: 'dispatch_prepare'},
    acceptance: [{check: '检查', expect: '通过'}], forbidden: [], readExternalContent: false});
  const post = id => request(handler, '/dispatch/runs', {ticket: id, bot: 'bot', readExternal: false});
  const stop = () => {
    const flag = path.join(dir, 'panic', 'stopped.flag'); // 一键全停落的标记，见 lib/panic.mjs
    fs.mkdirSync(path.dirname(flag), {recursive: true});
    fs.writeFileSync(flag, JSON.stringify({stopped: true}));
  };
  return {dir, board, ticket, post, stop, resolvers, deps, handler};
}

// 发现 5（高）：全停前出的确认卡，全停后被点头，运行器照样起工人（派工通道自己不看停机标记）。
test('R3-5a 全停之后批准旧确认卡，不得启动外部工人', async t => {
  const h = await fixture(t);
  const ticket = await h.ticket();
  const first = await h.post(ticket.id);
  assert.equal(first.status, 202);
  h.stop();
  h.resolvers.shift()({id: 'card-1', status: 'answered', choice: 'approve', device: 'd1'});
  await ext.waitIdle(h.deps);
  assert.deepEqual(ext.listRunning(), [], '全停之后外包工人被启动了');
});

// 发现 5（高）：已有放权时，全停后 POST /dispatch/runs 直接开工，连卡都不出。
test('R3-5b 全停之后，已有放权也不得直接开工，应当拒绝', async t => {
  const h = await fixture(t);
  const a = await h.ticket();
  await h.post(a.id);
  h.resolvers.shift()({id: 'card-1', status: 'answered', choice: 'approve-always', device: 'd1'});
  await ext.waitIdle(h.deps);
  for (let i = 0; i < 100 && ext.listRunning().length; i++) await new Promise(r => setTimeout(r, 50));
  h.stop();
  const b = await h.ticket();
  const got = await h.post(b.id);
  assert.ok(got.status >= 400, `全停后放权仍直接开工：${got.status} ${JSON.stringify(got.body)}`);
});
