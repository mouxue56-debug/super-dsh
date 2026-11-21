import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {boardConfig, chatOnlyReader} from '../tools/index.mjs';
import {register} from '../tools/bots.mjs';

// 在允许的测试目录内创建隔离目录。
function fixture() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
  fs.mkdirSync(dir, {recursive: true});
  return fs.mkdtempSync(path.join(dir, 'seam-'));
}

// 用内存看板验证派单接缝。
function setup(limit = 2) {
  const dir = fixture();
  const tools = {};
  const rows = [];
  let count = 0;
  let turn = 1;
  const board = {
    async list() {
      return rows;
    },
    async get(id) {
      return rows.find(row => row.id === id);
    },
    async createWithMeta(_actor, input) {
      const ticket = {...input, id: String(rows.length + 1), state: 'queued'};
      rows.push(ticket);
      return {ticket, deduped: false};
    },
  };
  const deps = {
    board,
    hubConfig: {board: {...boardConfig({hubHome: dir}), dir, maxSendPerTurn: limit}},
    roster: [{id: 'a', status: 'active'}, {id: 'b', status: 'active', name: '乙'}],
    state() {
      return {
        readExternal: false,
        reserveSend(current, maximum) {
          if (count >= maximum) {
            throw Error(`本轮已派 ${count} 张（暂定上限）`);
          }
          count++;
          return () => {
            if (turn === current) {
              count--;
            }
          };
        },
      };
    },
  };
  register({tools: {register: tool => {
    tools[tool.name] = tool;
  }}}, deps);
  return {
    tools,
    rows,
    next: () => {
      turn++;
      count = 0;
    },
    call: () => ({bot: 'a', sessionId: 's', turn}),
  };
}

test('配置上限及本轮重置', async () => {
  assert.equal(boardConfig({hubHome: fixture()}).maxSendPerTurn, 3);
  assert.equal(boardConfig({hubHome: fixture(), board: {max_send_per_turn: 2}}).maxSendPerTurn, 2);
  assert.throws(() => boardConfig({hubHome: fixture(), board: {max_send_per_turn: 0}}));
  const h = setup();
  const send = message => h.tools.send_to_bot.execute({to: 'b', message, owner_ok: true}, {}, h.call());
  await send('一');
  await send('二');
  await assert.rejects(() => send('三'), /本轮已派 2 张（暂定上限）/u);
  h.next();
  await send('四');
});

test('自动选择最近更新的本人未完成工单', async () => {
  const h = setup();
  h.rows.push({id: 'old', claimedBy: 'a', state: 'progress', updatedAt: '2020', hop: 0, root: 'old'});
  h.rows.push({id: 'new', claimedBy: 'a', state: 'blocked', updatedAt: '2021', hop: 2, root: 'old'});
  h.rows.push({id: 'done', claimedBy: 'a', state: 'done', updatedAt: '2022', hop: 0});
  await h.tools.send_to_bot.execute({to: 'b', message: '处理', owner_ok: true}, {}, h.call());
  assert.equal(h.rows.at(-1).parentId, 'new');
  assert.equal(h.rows.at(-1).hop, 3);
});

test('名单权限变化、异常格式及恢复均对全部会话生效', () => {
  const file = path.join(fixture(), 'sessions.json');
  const logs = [];
  const read = chatOnlyReader(file, {warn: text => logs.push(text)});
  assert.equal(read('a'), false);
  fs.writeFileSync(file, JSON.stringify({v: 1, sessions: ['a']}), {mode: 0o600});
  assert.equal(read('a'), true);
  assert.equal(read('b'), false);
  fs.chmodSync(file, 0o644);
  assert.equal(read('b'), true);
  assert.ok(logs.length > 0);
  fs.chmodSync(file, 0o600);
  assert.equal(read('b'), false);
  fs.writeFileSync(file, '{');
  assert.equal(read('b'), true);
});
