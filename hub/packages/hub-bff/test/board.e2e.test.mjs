import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createBoard } from '../lib/board.mjs';
import { createBoardHandler } from '../lib/board-http.mjs';
import { issueToken } from '../lib/board-tokens.mjs';
import { main } from '../bin/hub-board.mjs';
test('CLI completes work through the HTTP handler', async _testContext => {
  const dir = await mkdtemp(join(tmpdir(), 'board-e2e-')),
    configDir = join(dir, 'config'),
    events = [];
  const board = createBoard({
    root: join(dir, 'tickets'),
    onEvent: _event => events.push(_event)
  });
  const token = (await issueToken(configDir, {
    name: 'worker',
    scope: 'work'
  })).token;
  const makerToken = (await issueToken(configDir, {
    name: 'maker',
    scope: 'work+create'
  })).token;
  const handler = createBoardHandler({
    board,
    configDir
  });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  _testContext.after(() => new Promise(resolve => server.close(resolve)));
  const env = {
    ...process.env,
    HUB_BOARD_URL: `http://127.0.0.1:${server.address().port}/board`,
    HUB_BOARD_TOKEN: token
  };
  const actor = {
    name: 'maker',
    type: 'external'
  };
  const first = await board.create(actor, {
      title: 'first',
      goal: 'goal',
      to: ['worker'] // 外部身份只能领派给它的卡
    }),
    second = await board.create(actor, {
      title: 'second',
      goal: 'goal',
      to: ['worker']
    });
  const file = join(dir, 'result.md');
  await writeFile(file, 'finished work');

  async function run(args, chosenToken = token) {
    let out = '',
      err = '';
    const code = await main(args, {
      ...env,
      HUB_BOARD_TOKEN: chosenToken
    }, {
      stdout: {
        write: _text => {
          out += _text;
        }
      },
      stderr: {
        write: _text2 => {
          err += _text2;
        }
      }
    });
    assert.equal(code, 0, err);
    assert.ok(!out.includes(token));
    return JSON.parse(out);
  }

  assert.equal((await run(['list'])).tickets.length, 2);
  assert.equal((await run(['show', first.id])).ticket.id, first.id);
  await run(['claim', first.id]);
  await run(['progress', first.id, 'working']);
  await run(['report', first.id, '--file', file]);
  await run(['done', first.id]);
  await run(['accept', first.id], makerToken);
  await run(['claim', second.id]);
  await run(['block', second.id, 'assistance', '--wait-human']);
  const result = await board.get(first.id),
    blocked = await board.get(second.id);
  assert.equal(result.state, 'completed');
  assert.equal(result.review, 'accepted');
  assert.equal(result.progress[0].text, 'working');
  assert.equal(result.reports[0].summary, 'finished work');
  assert.equal(result.reports[0].file, file);
  assert.match(result.reports[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(blocked.state, 'waiting-human');
  assert.equal(blocked.open_ask.text, 'assistance');
  assert.deepEqual(events.map(_event2 => _event2.type), ['created', 'created', 'claimed', 'progress', 'reported',
    'submitted', 'accepted', 'claimed', 'blocked']);
  assert.deepEqual(events.filter(_event3 => _event3.attention).map(_event4 => _event4.attentionKind), [
    'waiting-human']);
  const child = spawn(process.execPath, ['bin/hub-board.mjs', 'list'], {
    cwd: new URL('..', import.meta.url),
    env
  });
  let output = '',
    error = '';
  child.stdout.on('data', _chunk => {
    output += _chunk;
  });
  child.stderr.on('data', _chunk2 => {
    error += _chunk2;
  });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  assert.equal(code, 0, error);
  assert.ok(!output.includes(token));
  assert.equal(JSON.parse(output).tickets.length, 2);
});
