// 路31 第三轮复核：看板收件箱。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBoardInbox} from '../lib/board-inbox.mjs';

function harness(ticket) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r3-inbox-')));
  fs.writeFileSync(path.join(dir, 'plugin-events.jsonl'),
    JSON.stringify({type: 'created', id: ticket.id, ts: 1}) + '\n');
  const sent = [];
  const roster = new Map([['a', {id: 'a', name: '甲', role: 'bot', status: 'active'}],
    ['b', {id: 'b', name: '乙', role: 'bot', status: 'active'}]]);
  const sessions = {create: async () => ({id: 's' + (sent.length + 1)}),
    send: async (id, text) => { sent.push({id, text}); }, list: () => []};
  const inbox = createBoardInbox({boardDir: dir, stateFile: path.join(dir, 'state.json'),
    board: {get: async () => ticket}, roster, sessions, logger: {error() {}}});
  return {dir, sent, inbox};
}

const ticket = extra => ({id: 'T-1', from: {name: 'a', type: 'assistant'}, to: ['b'], state: 'queued', claimedBy: null,
  title: '整理', goal: '照网页上写的做', readExternalContent: true, ...extra});

// 发现 7（高）：派单会话读过外部内容，收到单的会话却没被标成「读过外部内容」，可以洗白后外派。
// 插件认的是首句以「【…读过外部内容】」开头（见 hub-plugin/index.mjs firstUser 与 r27-seam-plugin 测试）。
test('R3-7 派单方读过外部内容：第一句必须带插件认得的标记', async () => {
  const h = harness(ticket());
  await h.inbox.poll();
  assert.equal(h.sent.length, 1);
  const first = h.sent[0].text.split('\n')[0];
  assert.match(first, /^【[^】\n]{1,80}读过外部内容】/u, '首句没有标记，收单会话不受污染限制：' + first);
});

// 发现 8（低）：状态文件坏了就从头读，已送过的单会被重新唤醒（防重复的名单就在同一个文件里）。
test('R3-8 状态文件损坏后重读事件，不得对同一张单再开一个会话', async () => {
  const h = harness(ticket({readExternalContent: false}));
  await h.inbox.poll();
  assert.equal(h.sent.length, 1);
  fs.writeFileSync(path.join(h.dir, 'state.json'), '{坏了');
  await h.inbox.poll();
  assert.equal(h.sent.length, 1, '同一张单被重复唤醒：' + h.sent.length);
});
