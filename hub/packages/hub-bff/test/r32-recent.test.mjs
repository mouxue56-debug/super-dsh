// 今天页「刚刚发生的」从后端真记录来：已答的确认卡 + 看板流水，最近 20 条；没有的那类不编。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecent } from '../lib/recent.mjs';
import { createHandler } from '../lib/ext/today.mjs';

const roster = [{ id: 'pm', name: '项目经理' }, { id: 'research', name: '调研员' }];
const T = n => new Date(Date.UTC(2026, 10, 19, 1, n)).toISOString();
const ticket = (id, title, to, history, extra = {}) => ({ id, title, to: [to], history, ...extra });

test('确认卡与看板流水合在一起，按时间新的在前，只留最近 20 条', async () => {
  const cards = [
    { id: 'c1', type: 'approval', bot: 'pm', action: '对外发送或公开发布', status: 'denied', resolvedAt: T(10) },
    { id: 'c2', type: 'approval', bot: 'pm', action: '写文件', status: 'pending', createdAt: T(11) },
    { id: 'c3', confirm: true, type: 'approval', bot: 'research', title: '要不要继续', status: 'answered', resolvedAt: T(12) },
    { id: 'c4', type: 'approval', bot: 'pm', action: '运行命令', status: 'approved', resolvedAt: T(5) },
  ];
  const tickets = [
    ticket('T-1', '验收报告', 'research', [
      { ts: T(1), by: 'owner', action: 'created' }, { ts: T(2), by: 'owner', action: 'owner_assign' },
      { ts: T(3), by: 'research', action: 'progress' }, { ts: T(20), by: 'research', action: 'submitted' },
      { ts: T(30), by: 'owner', action: 'accepted' }], { claimedBy: 'research' }),
  ];
  const r = await buildRecent({ roster, cards: { recent: () => cards }, board: { list: () => tickets } });
  assert.deepEqual(r.sources, { cards: true, tickets: true });
  assert.deepEqual(r.items.map(i => i.state), ['已验收', '交回了', '你答了', '已拒绝', '已批准', '你交办了']);
  assert.equal(r.items[0].title, '验收报告');
  assert.equal(r.items[0].name, '调研员');
  assert.ok(!r.items.some(i => i.id === 'c2'), '待答的不算已发生');
  assert.ok(!r.items.some(i => /progress|created/u.test(i.state)), '进展、新建不列');
  const many = Array.from({ length: 40 }, (_, i) => ({ id: 'k' + i, type: 'approval', bot: 'pm', action: 'x' + i,
    status: 'approved', resolvedAt: T(i) }));
  const big = await buildRecent({ roster, cards: { recent: () => many } });
  assert.equal(big.items.length, 20);
  assert.equal(big.items[0].title, 'x39');
});

test('后端没有的那类就不给，也不编；全都没有就是空', async () => {
  const onlyBoard = await buildRecent({ roster, board: { list: () => [] } });
  assert.deepEqual(onlyBoard.sources, { cards: false, tickets: true });
  assert.deepEqual(onlyBoard.items, []);
  const broken = await buildRecent({ roster, cards: { recent: () => { throw new Error('x'); } },
    board: { list: async () => { throw new Error('y'); } } });
  assert.deepEqual(broken.sources, { cards: false, tickets: false });
  assert.deepEqual(broken.items, []);
});

test('接口 GET /today/recent 只读；POST 被拒', async () => {
  const handler = createHandler({ roster, cards: { recent: () => [
    { id: 'c1', type: 'approval', bot: 'pm', action: 'a', status: 'approved', resolvedAt: T(1) }] } });
  const run = async method => {
    const res = { headers: {}, writeHead(s) { this.status = s; }, end(t) { this.text = t; } };
    const handled = await handler({ url: '/today/recent', method }, res);
    return { handled, res };
  };
  const ok = await run('GET');
  assert.equal(ok.handled, true);
  assert.equal(ok.res.status, 200);
  assert.equal(JSON.parse(ok.res.text).items[0].state, '已批准');
  assert.equal((await run('POST')).res.status, 405);
});
