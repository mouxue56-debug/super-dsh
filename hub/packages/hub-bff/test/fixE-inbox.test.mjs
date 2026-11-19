// 第三轮复核 R3-7（收件箱首句带读过外部内容标记）与 R3-8（状态文件坏了不重放、停机拒的补送）的补充用例。
//
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBoardInbox, delegatedPrefix, DELEGATED_FIRST, EXTERNAL_FIRST} from '../lib/board-inbox.mjs';

// 搭一个收件箱；sessions 可以注入失败。
function harness(tickets, {fail} = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fixe-inbox-')));
  const events = path.join(dir, 'plugin-events.jsonl');
  const add = id => fs.appendFileSync(events, JSON.stringify({type: 'created', id, ts: Date.now()}) + '\n');
  for (const t of tickets) add(t.id);
  const sent = [];
  const notices = [];
  const roster = new Map([['a', {id: 'a', name: '甲', role: 'bot', status: 'active'}],
    ['b', {id: 'b', name: '乙', role: 'bot', status: 'active'}],
    ['c', {id: 'c', name: '丙', role: 'bot', status: 'active'}]]);
  const sessions = {
    create: async target => {
      if (fail?.(target)) throw Object.assign(new Error('停了'), {code: 'PANIC_STOPPED'});
      return {id: 's' + (sent.length + 1) + target};
    },
    send: async (id, text) => {
      sent.push({id, text});
    },
    list: () => [],
  };
  const inbox = createBoardInbox({boardDir: dir, stateFile: path.join(dir, 'state.json'),
    board: {get: async id => tickets.find(t => t.id === id)}, roster, sessions, logger: {error() {}},
    onEvent: e => notices.push(e)});
  return {dir, sent, notices, inbox, add};
}

const ticket = extra => ({id: 'T-20261118-010203-abcd', from: {name: 'a', type: 'assistant'}, to: ['b'],
  state: 'queued', claimedBy: null, title: '整理', goal: '照网页上写的做', readExternalContent: true, ...extra});

test('R3-7 首句格式两边共用：读过外部内容的同时被认作派来的活与读过外部内容；没读过的只认派来的活', () => {
  const label = '二十个字的名字二十个字的名字二十个字的名';
  const dirty = delegatedPrefix(label, 'T-20261118-010203-abcd', {readExternal: true});
  assert.match(dirty, DELEGATED_FIRST);
  assert.match(dirty, EXTERNAL_FIRST);
  const long = delegatedPrefix('名', 'T-' + 'x'.repeat(200), {readExternal: true});
  assert.match(long, DELEGATED_FIRST, '编号太长时仍要认得是派来的活');
  assert.match(long, EXTERNAL_FIRST, '编号太长时也不能丢掉读过外部内容标记');
  const clean = delegatedPrefix('名', 'T-1');
  assert.match(clean, DELEGATED_FIRST);
  assert.doesNotMatch(clean, EXTERNAL_FIRST);
  const plugin = fs.readFileSync(new URL('../../hub-plugin/index.mjs', import.meta.url), 'utf8');
  assert.match(plugin, /import \{DELEGATED_FIRST,EXTERNAL_FIRST\} from '\.\.\/hub-bff\/lib\/board-inbox\.mjs'/u,
    '插件没有引用收件箱的同一份正则');
});

test('R3-7 变形：工单没写 readExternalContent 也按读过算；写明 false 才不带标记', async () => {
  const unknown = ticket({readExternalContent: undefined});
  const h = harness([unknown]);
  await h.inbox.poll();
  assert.match(h.sent[0].text.split('\n')[0], EXTERNAL_FIRST);
  const cleanTicket = ticket({id: 'T-2', readExternalContent: false});
  const c = harness([cleanTicket]);
  await c.inbox.poll();
  assert.doesNotMatch(c.sent[0].text.split('\n')[0], EXTERNAL_FIRST);
  assert.match(c.sent[0].text.split('\n')[0], DELEGATED_FIRST);
});

test('R3-8 变形：状态文件截断、字段类型不对都不重放；坏了之后新来的单照送，并提醒主人', async () => {
  for (const broken of ['{"offset":', JSON.stringify({offset: 5, woke: 'x'}), JSON.stringify({offset: -1})]) {
    const h = harness([ticket({readExternalContent: false})]);
    await h.inbox.poll();
    assert.equal(h.sent.length, 1);
    fs.writeFileSync(path.join(h.dir, 'state.json'), broken);
    await h.inbox.poll();
    assert.equal(h.sent.length, 1, '坏状态 ' + broken + ' 之后重放了');
    assert.ok(h.notices.some(e => e.type === 'inbox-failed' && e.attention), '没提醒主人');
    assert.ok(fs.readdirSync(h.dir).some(f => f.startsWith('state.json.corrupt-')), '坏文件没留底');
  }
  const tickets = [ticket({readExternalContent: false})];
  const h = harness(tickets);
  await h.inbox.poll();
  fs.writeFileSync(path.join(h.dir, 'state.json'), '{坏');
  await h.inbox.poll();
  tickets.push(ticket({id: 'T-new', readExternalContent: false}));
  h.add('T-new');
  await h.inbox.poll();
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1].text, /T-new/u);
});

test('R3-8 变形：停机闸门拒的单恢复后补送一次；已送到的接单人不重送', async () => {
  let stopped = true;
  const t = ticket({to: ['b', 'c'], readExternalContent: false});
  const h = harness([t], {fail: target => stopped && target === 'c'});
  await h.inbox.poll();
  assert.equal(h.sent.length, 1, '乙先送到');
  await h.inbox.poll();
  assert.equal(h.sent.length, 1, '还停着就不送');
  stopped = false;
  await h.inbox.poll();
  assert.equal(h.sent.length, 2, '恢复后补送丙');
  assert.match(h.sent[1].id, /c$/u);
  await h.inbox.poll();
  assert.equal(h.sent.length, 2, '不重复');
});

test('R3-8 变形：补送前工单已被领走就不再送', async () => {
  let stopped = true;
  const t = ticket({readExternalContent: false});
  const h = harness([t], {fail: () => stopped});
  await h.inbox.poll();
  assert.equal(h.sent.length, 0);
  t.claimedBy = 'b';
  stopped = false;
  await h.inbox.poll();
  assert.equal(h.sent.length, 0);
});
