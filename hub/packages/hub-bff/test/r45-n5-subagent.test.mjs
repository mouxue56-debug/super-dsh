// 假的工具调用事件写卡片进度。不连本体，不造没收到的交回。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { testDirectory } from './fixtures.mjs';
import { createBoard } from '../lib/board.mjs';
import { createRelayWake } from '../lib/relay-wake.mjs';
import { validRelay } from '../lib/relay-model.mjs';
import {
  createSubagentNotes, ticketForSession, spawnTask, readRelaySessions,
} from '../lib/subagent-note.mjs';

const CHIEF = { name: 'chief', type: 'assistant' };
const RESEARCH = { name: 'research', type: 'assistant' };
const step = (who, extra = {}) => ({ who, task: '做' + who.name + '这件事', doneWhen: '交一份', ...extra });

function call(id, args) {
  return { type: 'tool/call', data: { name: 'subagent', callId: id, arguments: args } };
}
function result(id) {
  return { type: 'tool/result', data: { message: { toolCallId: id, isError: false, content: [{ type: 'text', text: 'started' }] } } };
}
function settled(id) {
  return {
    type: 'user/message',
    data: { source: { kind: 'subagent-settled', form: 'notice', senderSessionId: id }, content: [{ type: 'text', text: '好了' }] },
  };
}

async function world() {
  const dir = await testDirectory();
  const stateFile = join(dir, 'relay-wake.json');
  const known = new Map([['s-chief', 'chief']]);
  const sessions = {
    list: () => [...known].map(([id, bot]) => ({ id, bot })),
    create: async (bot) => {
      const id = 's-new-' + (known.size + 1);
      known.set(id, bot);
      return { id };
    },
    send: async () => {},
  };
  let wake;
  const board = createBoard({
    root: join(dir, 'board'), now: () => Date.UTC(2026, 10, 19, 10, 0),
    onEvent: (ev) => wake?.onEvent(ev), reservedNames: () => ['owner', 'chief', 'research'],
  });
  wake = createRelayWake({
    board, roster: new Map([['chief', { id: 'chief', status: 'active' }], ['research', { id: 'research', status: 'active' }]]),
    sessions, stateFile, now: () => Date.UTC(2026, 10, 19, 10, 0), isStopped: () => false,
    logger: { error() {} }, tickMs: 0, perTicketMs: 0,
  });
  const purpose = new Map();
  const notes = createSubagentNotes({
    board,
    sessionOf: (id) => (known.has(id) ? { bot: known.get(id), purpose: purpose.get(id) } : null),
    nameOf: (bot) => (bot === 'research' ? '调研员' : bot),
    tickets: () => board.list(),
    relaySessions: () => readRelaySessions(stateFile),
    logger: { error() {} },
  });
  const settle = async () => { await wake.drain(); await wake.flush(); await wake.drain(); };
  return { board, known, purpose, notes, settle, stateFile };
}

async function feed(notes, id, events) {
  for (const event of events) await notes.observe(id, event);
  await notes.end(id);
}

test('任务只取前 30 字，控制字符当空白，提示优先于短说明', () => {
  const long = '一二三四五六七八九十'.repeat(4);
  assert.equal(spawnTask({ prompt: long, description: '短' }), Array.from(long).slice(0, 30).join(''));
  assert.equal(spawnTask({ prompt: '甲\n乙\t丙' }), '甲 乙 丙');
  assert.equal(spawnTask({ prompt: '  ', description: '用说明' }), '用说明');
  assert.equal(spawnTask({}), '（没写要做什么）');
});

test('对不上唯一的卡就不写', () => {
  const one = { id: 'T-20261119-100000-aaaa', state: 'progress', claimedBy: 'research', claimedByType: 'assistant', sessions: { from: '', to: '' } };
  const two = { ...one, id: 'T-20261119-100001-bbbb' };
  assert.equal(ticketForSession({ sessionId: 's1', bot: 'research', purpose: 'board', tickets: [one, two] }), null);
  assert.equal(ticketForSession({ sessionId: 's1', bot: 'research', purpose: 'chat', tickets: [one] }), null);
  assert.equal(ticketForSession({ sessionId: 's1', bot: 'research', purpose: 'board', tickets: [one] }).id, one.id);
  assert.equal(ticketForSession({
    sessionId: 's1', bot: 'research', purpose: 'chat', tickets: [one, two],
    relaySessions: { [`${one.id}>research`]: 's1', [`${two.id}>research`]: 's1' },
  }), null);
});

test('接力这一棒：三条派工记成一句，工具结果不算交回，结算才算', async () => {
  const w = await world();
  const ticket = await w.board.relayCreate(CHIEF, {
    title: '查资料', goal: '把事做完', key: 'k-n5', sessions: { from: 's-chief', to: '' },
    steps: [step(RESEARCH), step(CHIEF)],
  }).then((row) => row.ticket);
  await w.settle();
  const id = [...w.known].find(([, bot]) => bot === 'research')[0];
  const long = '一二三四五六七八九十'.repeat(4);
  await feed(w.notes, id, [
    call('c1', { prompt: long, description: '不该用这句' }),
    call('c2', { prompt: '对照\n两家报价' }),
    call('c3', { description: '列清单' }),
    result('c1'), result('c2'), result('c3'),
  ]);
  let saved = await w.board.get(ticket.id);
  const texts = saved.progress.map((item) => item.text);
  assert.equal(texts.length, 1);
  assert.match(texts[0], /^调研员派了 3 个分身：/u);
  assert.equal(texts[0].includes('不该用这句'), false);
  assert.match(texts[0], /对照 两家报价/u);
  assert.match(texts[0], /列清单/u);
  assert.equal(texts[0].includes(long), false);
  assert.equal(texts.some((text) => text.startsWith('分身交回')), false);
  assert.equal(saved.relay.steps[0].clones, 3);
  assert.deepEqual(saved.relay.steps[0].cloneCalls, ['c1', 'c2', 'c3']);
  await feed(w.notes, id, [settled('child-1'), result('c9'), settled('child-1')]);
  saved = await w.board.get(ticket.id);
  assert.deepEqual(saved.progress.map((item) => item.text).filter((text) => text.startsWith('分身交回')), ['分身交回 1/3']);
  assert.equal(saved.relay.steps[0].clones, 3);
  await w.notes.observeSnapshot(id, [
    { event: call('c1', { prompt: long }) },
    { event: call('c2', { prompt: '对照\n两家报价' }) },
    { event: settled('child-1') },
    { event: settled('child-2') },
  ]);
  saved = await w.board.get(ticket.id);
  const back = saved.progress.map((item) => item.text).filter((text) => text.startsWith('分身交回'));
  assert.deepEqual(back, ['分身交回 1/3', '分身交回 2/3']);
  assert.equal(saved.progress.filter((item) => item.text.startsWith('调研员派了')).length, 1);
  assert.equal(validRelay(saved.relay), true);
  const broken = structuredClone(saved.relay);
  broken.steps[0].clones = 1.5;
  assert.equal(validRelay(broken), false);
  broken.steps[0].clones = 3;
  broken.steps[0].cloneCalls = [''];
  assert.equal(validRelay(broken), false);
});

test('普通卡只有唯一一张进行中才记；两张就不猜', async () => {
  const w = await world();
  const make = async (title) => {
    const ticket = await w.board.create(CHIEF, { title, goal: title + '的目标', to: ['research'] });
    await w.board.claim(RESEARCH, ticket.id);
    return ticket;
  };
  const first = await make('第一张');
  const second = await make('第二张');
  w.known.set('s-plain', 'research');
  w.purpose.set('s-plain', 'board');
  await feed(w.notes, 's-plain', [call('p1', { prompt: '做一件' }), result('p1')]);
  assert.equal((await w.board.get(first.id)).progress.length, 0);
  assert.equal((await w.board.get(second.id)).progress.length, 0);
  const only = await world();
  const ticket = await only.board.create(CHIEF, {
    title: '就这一张', goal: '做完', to: ['research'], sessions: { from: 's-from', to: '' },
  });
  await only.board.claim(RESEARCH, ticket.id);
  const other = await only.board.create(CHIEF, { title: '另一张', goal: '也做', to: ['research'] });
  await only.board.claim(RESEARCH, other.id);
  only.known.set('s-from', 'research');
  only.purpose.set('s-from', 'chat');
  await feed(only.notes, 's-from', [call('p2', { prompt: '对上发起会话' }), result('p2'), settled('child-9')]);
  const hit = await only.board.get(ticket.id);
  assert.match(hit.progress[0].text, /调研员派了 1 个分身：对上发起会话/u);
  assert.match(hit.progress[1].text, /分身交回 1\/1/u);
  assert.equal(hit.cloneTrack.clones, 1);
  assert.equal((await only.board.get(other.id)).progress.length, 0);
});
