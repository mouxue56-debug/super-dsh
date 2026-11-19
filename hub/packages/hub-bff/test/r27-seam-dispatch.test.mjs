import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createBoard } from '../lib/board.mjs';
import * as dispatch from '../lib/ext/dispatch.mjs';
import { createHandler as panicHandler } from '../lib/ext/panic.mjs';

// 无监听地调用扩展入口。
async function request(handler, route) {
  const req = Readable.from([Buffer.from('{}')]);
  req.url = route;
  req.method = 'POST';
  const res = { text: '' };
  res.writeHead = status => { res.status = status; };
  res.end = text => { res.text += text ?? ''; };
  await handler(req, res);
  return { status: res.status, body: JSON.parse(res.text) };
}

// 等待守护壳实际启动工人。
async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('等待工人启动超时');
}

test('全停入口连接真实派工运行器并标停工单', async t => {
  const tmp = path.resolve('test/.tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const dir = fs.mkdtempSync(path.join(tmp, 'seam-dispatch-'));
  const root = path.join(dir, 'work');
  fs.mkdirSync(root);
  const board = createBoard({ root: path.join(dir, 'board') });
  const deps = {
    board,
    configDir: dir,
    dataDir: dir,
    logger: { error() {} },
    hubConfig: { dispatch: {
      root,
      run_dir: path.join(dir, 'runs'),
      poll_ms: 0,
      stop_wait_ms: 2000,
      workers: { worker: { argv: [process.execPath, '-e', 'setInterval(() => {}, 1000)'], models: ['model'] } },
    } },
  };
  const originalRemove = fs.rmSync;
  fs.rmSync = () => {};
  t.after(() => {
    fs.rmSync = originalRemove;
    dispatch.stop();
  });
  await dispatch.start(deps);
  const ticket = await board.create({ name: 'assistant', type: 'assistant' }, {
    title: '测试任务',
    goal: '完成任务',
    to: ['worker'],
    acceptance: [{ check: '结果', expect: '完成' }],
    routing: { requestedBy: 'assistant', via: 'test', hint: '', model: 'model' },
    readExternalContent: false,
  });
  const runner = dispatch.stateFor(deps).runner;
  const result = await runner.start({
    ticketId: ticket.id,
    bot: 'assistant',
    readExternal: false,
    approval: { by: 'card', id: 'approved' },
  });
  assert.equal(result.ok, true);
  t.after(() => {
    if (dispatch.listRunning().length) {
      try {
        process.kill(-result.run.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  });
  await waitFor(() => fs.existsSync(path.join(dir, 'runs', result.run.runId, 'child.pid')));
  assert.equal(dispatch.listRunning().length, 1);
  const stopped = await request(panicHandler(deps), '/panic/stop');
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.steps.dispatch.status, 'ok');
  assert.deepEqual(dispatch.listRunning(), []);
  assert.equal(runner.get(result.run.runId).status, 'stopped');
  assert.equal((await board.get(ticket.id)).state, 'failed');
});
