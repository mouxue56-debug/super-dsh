import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBoard } from '../lib/board.mjs';
import { createBoardHandler } from '../lib/board-http.mjs';
import { issueToken, revokeToken } from '../lib/board-tokens.mjs';
test('HTTP authorization, concurrency, validation and events', async _testContext => {
  const dir = await mkdtemp(join(tmpdir(), 'board-http-')),
    configDir = join(dir, 'config'),
    events = [];
  const board = createBoard({
    root: join(dir, 'tickets'),
    onEvent: _event => events.push(_event)
  });
  const handler = createBoardHandler({
    board,
    configDir,
    maxBodyBytes: 256,
    readAll: true
  });
  const server = http.createServer(async (req, res) => {
    if (!(await handler(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  _testContext.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/board`;
  const tokens = {};
  for (const [name, scope] of [['reader', 'read'], ['worker', 'work'], ['other', 'work'], ['maker', 'work+create'],
    ['outsider', 'work+create']]) {
    tokens[name] = (await issueToken(configDir, {
      name,
      scope
    })).token;
  }

  async function request(path, token, method = 'GET', body) {
    const headers = token ? {
      Authorization: `Bearer ${token}`
    } : {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(base + path, {
      method,
      headers,
      ...(body !== undefined ? {
        body: typeof body === 'string' ? body : JSON.stringify(body)
      } : {})
    });
    return {
      status: response.status,
      body: await response.json()
    };
  }

  const make = async title => (await request('/tickets', tokens.maker, 'POST', {
    title,
    goal: 'goal',
    to: ['worker', 'other'] // 外部身份只能领派给它的卡
  })).body.ticket;
  assert.equal((await request('/whoami')).status, 401);
  assert.equal((await request('/whoami', 'wrong')).status, 401);
  const nonBearer = await fetch(base + '/whoami', {
    headers: {
      Authorization: 'Basic invalid'
    }
  });
  assert.equal(nonBearer.status, 401);
  assert.deepEqual((await request('/whoami', tokens.worker)).body, {
    name: 'worker',
    scope: 'work'
  });
  assert.equal((await request('/tickets', tokens.reader, 'POST', {})).status, 403);
  assert.equal((await request('/tickets', tokens.worker, 'POST', {})).status, 403);
  const payload = {
    title: 'idempotent',
    goal: 'goal',
    key: 'same-key'
  };
  const created = await request('/tickets', tokens.maker, 'POST', payload);
  const repeated = await request('/tickets', tokens.maker, 'POST', payload);
  assert.equal(created.status, 201);
  assert.equal(repeated.status, 200);
  assert.equal(created.body.ticket.id, repeated.body.ticket.id);
  assert.equal((await request('/tickets', tokens.maker, 'POST', {
    ...payload,
    goal: 'different'
  })).status, 409);
  const first = await make('first');
  assert.equal((await request(`/tickets/${first.id}/claim`, tokens.worker, 'POST', {
    actor: {
      name: 'other',
      type: 'owner'
    }
  })).body.ticket.claimedBy, 'worker');
  assert.equal((await request(`/tickets/${first.id}/claim`, tokens.other, 'POST', {})).status, 409);
  const second = await make('second');
  const race = await Promise.all(['worker', 'other'].map(workerName => request(`/tickets/${second.id}/claim`,
    tokens[workerName], 'POST', {})));
  assert.deepEqual(race.map(ticketResult => ticketResult.status).sort(), [200, 409]);
  assert.equal((await request('/tickets?status=progress&assignee=worker&creator=maker',
    tokens.reader)).body.tickets.some(ticketResult2 => ticketResult2.id === first.id), true);
  assert.equal((await request('/tickets?creator=missing', tokens.reader)).body.tickets.length, 0);
  assert.equal((await request('/tickets', tokens.maker, 'POST', 'x'.repeat(257))).status, 413);
  assert.equal((await request('/tickets', tokens.maker, 'POST', '{bad')).status, 400);
  assert.equal((await request('/tickets/bad', tokens.reader)).status, 400);
  assert.equal((await request('/unknown', tokens.reader)).status, 404);
  assert.equal((await request('/whoami', tokens.reader, 'POST', {})).status, 405);
  const report = await request(`/tickets/${first.id}/report`, tokens.worker, 'POST', {
    summary: 'result',
    file: 'result.md',
    sha256: 'a'.repeat(64),
    artifacts: ['artifact'],
    actor: {
      name: 'other'
    }
  });
  assert.equal(report.status, 200);
  assert.equal(report.body.ticket.report.by, 'worker');
  assert.equal(report.body.ticket.report.file, 'result.md');
  assert.equal(report.body.ticket.report.sha256, 'a'.repeat(64));
  assert.deepEqual(report.body.ticket.reports[0].artifacts, ['artifact']);
  assert.equal((await request(`/tickets/${first.id}/done`, tokens.worker, 'POST', {})).status, 200);
  assert.equal((await request('/tickets?inbox=maker', tokens.reader)).body.tickets.some(
    ticketResult3 => ticketResult3.id === first.id), true);
  assert.equal((await request(`/tickets/${first.id}/accept`, tokens.worker, 'POST', {})).status, 403);
  assert.ok([403, 409].includes((await request(`/tickets/${first.id}/accept`, tokens.outsider, 'POST', {})).status));
  assert.equal((await request(`/tickets/${first.id}/accept`, tokens.maker, 'POST', {})).body.ticket.state, 'completed');
  assert.equal((await request('/tickets?inbox=maker', tokens.reader)).body.tickets.some(
    ticketResult4 => ticketResult4.id === first.id), false);
  const third = await make('third');
  await request(`/tickets/${third.id}/claim`, tokens.worker, 'POST', {});
  await request(`/tickets/${third.id}/block`, tokens.worker, 'POST', {
    reason: 'help',
    waitHuman: true
  });
  assert.equal((await request('/tickets?attention=1', tokens.reader)).body.tickets.some(
    ticketResult5 => ticketResult5.id === third.id), true);
  assert.equal((await request(`/tickets/${third.id}/answer`, tokens.worker, 'POST', {
    text: 'answer'
  })).status, 403);
  assert.equal((await request(`/tickets/${third.id}/answer`, tokens.maker, 'POST', {
    text: 'answer'
  })).body.ticket.state, 'progress');
  assert.deepEqual(events.filter(_event2 => _event2.attention).map(_event3 => _event3.attentionKind), [
    'waiting-human']);
  const fourth = await make('fourth');
  await request(`/tickets/${fourth.id}/block`, tokens.maker, 'POST', {
    reason: 'waiting'
  });
  assert.equal(events.at(-1).attentionKind, 'blocked');
  assert.equal(events.at(-1).attention, true);
  assert.equal((await request(`/tickets/${third.id}/timeout`, tokens.worker, 'POST', {})).body.ticket.state,
    'waiting-timeout');
  assert.equal((await request(`/tickets/${third.id}/resume`, tokens.worker, 'POST', {})).status, 200);
  assert.equal((await request(`/tickets/${third.id}/uncertain`, tokens.worker, 'POST', {
    note: 'unclear'
  })).body.ticket.state, 'uncertain');
  assert.equal((await request(`/tickets/${third.id}/resume`, tokens.worker, 'POST', {})).status, 200);
  const fifth = await make('fifth');
  await request(`/tickets/${fifth.id}/claim`, tokens.worker, 'POST', {});
  await request(`/tickets/${fifth.id}/report`, tokens.worker, 'POST', {
    summary: 'review'
  });
  assert.equal((await request(`/tickets/${fifth.id}/send_back`, tokens.maker, 'POST', {
    note: 'revise'
  })).body.ticket.review, 'sent_back');
  const storePath = join(configDir, 'board-tokens.json'),
    store = JSON.parse(await readFile(storePath, 'utf8'));
  store.tokens.find(tokenEntry => tokenEntry.name === 'worker').scope = 'read';
  await writeFile(storePath, JSON.stringify(store));
  assert.equal((await request(`/tickets/${third.id}/resume`, tokens.worker, 'POST', {})).status, 403);
  await revokeToken(configDir, 'worker');
  assert.equal((await request(`/tickets/${third.id}/resume`, tokens.worker, 'POST', {})).status, 401);
  assert.equal((await request('/whoami', tokens.worker)).status, 401);
});
test('chunked request is rejected while reading', async _testContext2 => {
  const dir = await mkdtemp(join(tmpdir(), 'board-stream-')),
    configDir = join(dir, 'config');
  const token = (await issueToken(configDir, {
    name: 'maker',
    scope: 'work+create'
  })).token;
  const handler = createBoardHandler({
    board: createBoard({
      root: join(dir, 'tickets')
    }),
    configDir,
    maxBodyBytes: 16
  });
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  _testContext2.after(() => new Promise(resolve => server.close(resolve)));
  const status = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: '/board/tickets',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Transfer-Encoding': 'chunked'
      }
    }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write('x'.repeat(17));
  });
  assert.equal(status, 413);
});
