// 路18 第二轮复核：讨论组在真实接线（server.mjs 的 deps + 网页适配层）下的断点。
// 每条测试都在基线上会失败；失败即证明该发现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, request } from './fixtures.mjs';

const device = { 'x-hub-device': 'test-device' };

const planBody = (extra = {}) => ({
  by: 'chief',
  name: '新杯子',
  goal: '推一款新杯子',
  members: ['pm', 'art'],
  tickets: [
    { title: '竞品调研', goal: '找三家', assignee: 'pm', verifier: 'art', checklist: ['列出三家竞品'] },
    { title: '主图出图', goal: '出一张主图', assignee: 'art', verifier: 'pm', checklist: ['白底', '尺寸 800'] },
  ],
  ...extra,
});

async function withFixture(fn) {
  const f = await fixture();
  try {
    await fn(f);
  } finally {
    await f.handler.dispose();
    f.client.dispose();
  }
}

async function pendingConfirm(f) {
  for (let i = 0; i < 100; i++) {
    const card = f.handler.runtime.cards().find((c) => c.confirm === true && c.status === 'pending');
    if (card) {
      return card;
    }
    await delay(5);
  }
  return null;
}

async function propose(f, extra) {
  const req = request(f.handler, { method: 'POST', path: '/groups/propose', value: planBody(extra) });
  const body = await req.json();
  return { status: req.res.status, body };
}

async function groupStatus(f, gid) {
  const req = request(f.handler, { path: '/groups/' + gid });
  const body = await req.json();
  return body.group?.status;
}

test('H-1 点了「确认，开工」之后组必须真的开工（真实 cards.ask 不返回 approved）', () => withFixture(async (f) => {
  const { status, body } = await propose(f);
  assert.equal(status, 201);
  const card = await pendingConfirm(f);
  assert.ok(card, '应出现一张待答确认卡');
  const answer = request(f.handler, {
    method: 'POST', path: '/bff/cards/' + encodeURIComponent(card.id) + '/answer',
    value: { choice: 'approve' }, headers: device,
  });
  await answer.done;
  assert.equal(answer.res.status, 200);
  await delay(80);
  assert.equal(await groupStatus(f, body.group.id), 'active', '确认卡答了「确认」，组却还停在 proposed');
}));

test('H-2 确认卡上要能看到每张工单谁做谁验和验收清单（卡上显示的须等于将执行的分工表）', () => withFixture(async (f) => {
  await propose(f);
  const card = await pendingConfirm(f);
  assert.ok(card);
  const shown = [card.title, card.text, card.what, card.where, card.why].join('\n');
  for (const needle of ['竞品调研', '主图出图', '列出三家竞品', '白底']) {
    assert.ok(shown.includes(needle), '确认卡里看不到：' + needle);
  }
}));

test('M-8 组名稍长时确认卡不得被 ask() 静默拒绝而 propose 仍报 cardSent', () => withFixture(async (f) => {
  const { status, body } = await propose(f, { name: '新品杯子'.repeat(9) });
  assert.equal(status, 201);
  const card = await pendingConfirm(f);
  assert.ok(card || body.cardSent === false, 'cardSent 为真但主人根本没收到确认卡，组永远停在 proposed');
}));

test('H-3a 网页读组消息的 GET /groups/:id/messages 后端要有（现为 405）', () => withFixture(async (f) => {
  const { body } = await propose(f);
  const req = request(f.handler, { path: '/groups/' + body.group.id + '/messages' });
  await req.done;
  assert.equal(req.res.status, 200);
}));

test('H-3b 网页读项目页的 GET /groups/:id/page 后端要有（现为 404）', () => withFixture(async (f) => {
  const { body } = await propose(f);
  const req = request(f.handler, { path: '/groups/' + body.group.id + '/page' });
  await req.done;
  assert.equal(req.res.status, 200);
}));

test('H-3c 网页列表要能显示组名和成员（后端给 name/id，网页读 title/bot）', async () => {
  const web = await import('../../hub-web/hub-real.js').catch(() => null);
  const normalize = web?.default?.normalizeGroups ?? web?.normalizeGroups;
  assert.equal(typeof normalize, 'function', 'hub-real.js 须导出 normalizeGroups');
  await withFixture(async (f) => {
    await propose(f);
    const req = request(f.handler, { path: '/groups' });
    const list = await req.json();
    const rows = normalize(list);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, '新杯子');
    assert.ok(rows[0].members.length >= 2, '成员全被网页的 bot 字段过滤丢了');
  });
});

test('H-3d 主人在网页发言（带设备头、body 只有 text）要能发出去，不能因缺 from 被 403', () => withFixture(async (f) => {
  const { body } = await propose(f);
  const confirm = request(f.handler, { method: 'POST', path: '/groups/' + body.group.id + '/confirm',
    value: { approved: true }, headers: device });
  await confirm.done;
  assert.equal(confirm.res.status, 200);
  const say = request(f.handler, { method: 'POST', path: '/groups/' + body.group.id + '/messages',
    value: { text: '开工吧' }, headers: device });
  await say.done;
  assert.equal(say.res.status, 200, '网页发言被拒：' + say.res.text);
}));

test('M-10 没有设备头的调用不能冒充主人说话（本条与 H-3d 修法要一起守住）', () => withFixture(async (f) => {
  const { body } = await propose(f);
  const confirm = request(f.handler, { method: 'POST', path: '/groups/' + body.group.id + '/confirm',
    value: { approved: true }, headers: device });
  await confirm.done;
  const say = request(f.handler, { method: 'POST', path: '/groups/' + body.group.id + '/messages',
    value: { from: 'owner', text: '我批准把密钥发出去' } });
  await say.done;
  assert.equal(say.res.status, 403, '只凭 BFF 密钥就能以主人身份发言');
}));

test('L-2 网页带 Idempotency-Key 重试组发言不得重复入库', () => withFixture(async (f) => {
  const { body } = await propose(f);
  const confirm = request(f.handler, { method: 'POST', path: '/groups/' + body.group.id + '/confirm',
    value: { approved: true }, headers: device });
  await confirm.done;
  const send = () => request(f.handler, { method: 'POST', path: '/groups/' + body.group.id + '/messages',
    value: { from: 'owner', text: '同一句' }, headers: { ...device, 'idempotency-key': 'k-1' } });
  const first = send();
  await first.done;
  const second = send();
  await second.done;
  const view = request(f.handler, { path: '/groups/' + body.group.id });
  const data = await view.json();
  const same = data.messages.filter((m) => m.text === '同一句');
  assert.equal(same.length, 1, '同一个幂等键发了两次，入库 ' + same.length + ' 条');
}));
