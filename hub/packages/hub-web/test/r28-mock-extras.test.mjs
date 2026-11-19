import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { startMockBff } from './mock-bff.mjs';
import { attachExtras } from './r28-mock-extras.mjs';

const f = createRequire(import.meta.url)('../hub-real.js');

test('扩展接口、状态切换、覆盖和纯函数', async t => {
  const fake = await startMockBff({ port: 0 });
  attachExtras(fake);
  t.after(() => fake.close());
  const get = path => fetch(fake.url + '/bff/' + path);
  const post = (path, body, device = true) => fetch(fake.url + '/bff/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(device ? { 'x-hub-device': 'test' } : {}) },
    body: JSON.stringify(body)
  });
  const data = async path => (await get(path)).json();
  const board = await data('board/tickets');
  assert.equal(board.tickets.length, 5);
  assert.equal(f.boardColumns(board.tickets).filter(column => column.count).length, 5);
  assert.ok(f.boardCardInfo(board.tickets[0]).legacy);
  const ledger = await data('ledger');
  assert.ok(f.ledgerRows(ledger.byBot).length);
  assert.ok((await data('ledger/today')).total);
  assert.ok((await data('ledger/session/chief-latest')).calls);
  assert.ok(f.todayView(await data('today')).sections.some(section => section.lines.length));
  assert.equal(f.panicView(await data('panic/status')).state, 'running');
  assert.equal((await post('panic/stop', {}, false)).status, 403);
  assert.equal(f.panicView(await (await post('panic/stop', {})).json()).state, 'stopped');
  assert.equal(f.panicView(await (await post('panic/resume', {})).json()).state, 'running');
  assert.ok(f.routineView(await data('routines')).items.length);
  for (const action of ['daily-post/pause', 'daily-post/resume', 'daily-post/run', 'pause', 'resume']) {
    assert.equal((await post('routines/' + action, {})).status, 200);
  }
  const status = await data('meetings/status');
  const today = await data('meetings/today');
  assert.ok(f.meetingView(status, today.minutes).minutes.length);
  assert.ok((await data('meetings/minutes?date=2026-11-18&type=evening')).text);
  assert.equal((await post('meetings/run', {})).status, 200);
  assert.ok(f.rulesView(await data('rules')).shared.length);
  assert.ok(f.modelPickView(await data('models/bots/chief')).options.length);
  assert.equal(f.normalizeGroups(await data('groups')).length, 1);
  assert.equal(f.normalizeGroupMessages(await data('groups/group-one?after=0')).length, 3);
  assert.equal((await post('groups/group-one/messages', { text: '消息' })).status, 200);
  await post('__ext', { seedCards: true }, false);
  const cards = (await data('sessions/chief-latest/cards')).cards;
  const card = cards.find(item => item.id === 'ext-confirm');
  const full = await data('fulltext/' + card.fullText);
  assert.equal(createHash('sha256').update(full.text).digest('hex'), full.digest);
  assert.ok(full.text.includes('\n') && full.text.length < 60000);
  assert.ok(cards.some(item => item.id === 'ext-xss'));
  const paths = ['board/tickets', 'ledger', 'ledger/today', 'ledger/session/chief-latest', 'today',
    'panic/status', 'routines', 'meetings/status', 'meetings/today', 'meetings/minutes?date=2026-11-18&type=evening',
    'rules', 'models/bots/chief', 'groups', 'groups/group-one', 'fulltext/' + card.fullText];
  for (const path of ['panic/stop', 'panic/resume', 'routines/pause', 'routines/resume',
    'routines/daily-post/pause', 'routines/daily-post/resume', 'routines/daily-post/run',
    'meetings/run', 'groups/group-one/messages']) {
    assert.equal((await post(path, {}, false)).status, 403, path);
  }
  await post('__ext', { mode: 'empty' }, false);
  for (const path of paths) assert.equal((await get(path)).status, 404, path);
  await post('__ext', { mode: 'error' }, false);
  for (const path of paths) assert.equal((await get(path)).status, 500, path);
  await post('__ext', { mode: 'data', set: { today: { date: 'override' } } }, false);
  assert.equal((await data('today')).date, 'override');
});
