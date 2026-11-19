// 轮过的外部身份只留自己那一棒和交给自己的交接说明。正在做的仍看整张路线。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createBoard } from '../lib/board.mjs';
import { createBoardHandler } from '../lib/board-http.mjs';
import { issueToken } from '../lib/board-tokens.mjs';

const OWNER = { name: 'owner', type: 'owner' };
const CHIEF = { name: 'chief', type: 'assistant' };
const RESEARCH = { name: 'research', type: 'assistant' };
const CODEX = { name: 'codex', type: 'external' };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'fixq-crop-'));
  const configDir = join(dir, 'cfg');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const board = createBoard({ root: join(dir, 'board'), reservedNames: ['owner', 'chief', 'research', 'writer'] });
  const token = (await issueToken(configDir, { name: 'codex', scope: 'work+create' })).token;
  const server = http.createServer((req, res) => {
    createBoardHandler({ board, configDir, prefix: '/board', reservedNames: () => ['owner', 'chief', 'research', 'writer'] })(req, res)
      .then(done => done || res.end());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/board`;
  const api = (method, path) => fetch(base + path, { method, headers: { Authorization: 'Bearer ' + token } })
    .then(async response => ({ status: response.status, body: await response.json() }));
  return { board, api, close: () => server.close() };
}

test('正在做的外部身份看整张路线，交棒之后只剩自己那一棒和交接说明', async () => {
  const h = await setup();
  try {
    const { ticket } = await h.board.relayCreate(CHIEF, {
      title: '接力裁剪', goal: '对外目标',
      steps: [
        { who: RESEARCH, task: '查内部底稿SECRET-A', doneWhen: '内部标准SECRET-DA' },
        { who: CODEX, task: '写对外稿', doneWhen: '一份对外稿' },
        { who: { name: 'writer', type: 'assistant' }, task: '改内部终稿SECRET-B', doneWhen: '内部标准SECRET-DB' },
      ],
    });
    await h.board.progress(RESEARCH, ticket.id, '进度机密SECRET-P');
    await h.board.relayDeliver(RESEARCH, ticket.id, '交给你的交接说明HANDOFF');
    const doing = await h.api('GET', `/tickets/${ticket.id}`);
    const doingText = JSON.stringify(doing.body);
    assert.equal(doing.status, 200);
    assert.match(doingText, /SECRET-A/u, '正在做的人要看到上一棒要做什么');
    assert.match(doingText, /SECRET-B/u, '正在做的人要看到后面的路线');
    assert.match(doingText, /HANDOFF/u);

    await h.board.relayDeliver(CODEX, ticket.id, '我这一棒写完了');
    const stored = await h.board.get(ticket.id);
    assert.match(stored.relay.steps[0].task, /SECRET-A/u, '裁剪只发生在返回的视图上');
    assert.match(stored.relay.steps[2].task, /SECRET-B/u);
    const later = await h.api('GET', `/tickets/${ticket.id}`);
    const text = JSON.stringify(later.body);
    assert.equal(later.status, 200);
    assert.equal(later.body.ticket.relay.steps[1].who.name, 'codex');
    assert.match(text, /写对外稿/u);
    assert.match(text, /HANDOFF/u);
    assert.equal(later.body.ticket.relay.steps[0].task, '');
    assert.equal(later.body.ticket.relay.steps[2].task, '');
    assert.equal(later.body.ticket.open_ask, null);
    for (const secret of ['SECRET-A', 'SECRET-B', 'SECRET-P', 'SECRET-DA', 'SECRET-DB']) {
      assert.equal(text.includes(secret), false, secret);
    }
    const listText = JSON.stringify((await h.api('GET', '/tickets')).body);
    assert.match(listText, /写对外稿/u);
    assert.equal(listText.includes('SECRET-B'), false);
    assert.equal(listText.includes('SECRET-P'), false);
  } finally {
    h.close();
  }
});
