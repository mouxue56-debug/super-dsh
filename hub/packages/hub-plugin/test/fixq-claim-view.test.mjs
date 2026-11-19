import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../tools/claim.mjs';

const openCard = {
  id: 'T-20261119-030000-Ab12', title: '整理读书会说明', goal: '写一行议程', state: 'queued',
  openClaim: { state: 'open', openedAt: '2026-11-19T03:00:00.000Z' },
};

function harness(board) {
  const tools = new Map();
  const marked = [];
  register({ tools: { register: tool => tools.set(tool.name, tool) } }, {
    board,
    roster: [{ id: 'leader', name: '首席', role: 'chief', status: 'active' }],
    state: id => ({ markInternalRead: () => marked.push(id) }),
    material: text => [{ text }],
  });
  return { view: tools.get('claim_view'), marked };
}

test('开放认领卡按单号仍能读出标题，并标记当前会话', async () => {
  const h = harness({ get: async () => openCard });
  const output = await h.view.execute({ id: openCard.id }, {}, { bot: 'leader', sessionId: 's-open' });
  assert.match(output, /整理读书会说明/u);
  assert.match(output, /写一行议程/u);
  assert.deepEqual(h.marked, ['s-open']);
});

test('不在可派范围的卡按单号不返回标题、目标和主人回答', async () => {
  const hidden = [
    {
      id: 'T-20261119-030001-Cd34', title: '私人标题SECRET-TITLE', goal: '私人目标SECRET-GOAL',
      state: 'progress', claimedBy: 'writer',
      history: [{ action: 'answered', detail: '主人回答SECRET-ANSWER', by: 'owner' }],
    },
    {
      id: 'T-20261119-030002-Ef56', title: '已接标题SECRET-TAKEN', goal: '已接目标SECRET-TAKEN-GOAL',
      state: 'progress', claimedBy: 'writer',
      openClaim: { state: 'taken', openedAt: '2026-11-19T03:00:00.000Z', takenBy: 'writer' },
      history: [{ action: 'answered', detail: '主人回答SECRET-TAKEN-ANSWER', by: 'owner' }],
    },
  ];
  for (const card of hidden) {
    const h = harness({ get: async () => card });
    await assert.rejects(
      () => h.view.execute({ id: card.id }, {}, { bot: 'leader', sessionId: 's-hidden' }),
      error => !/SECRET-/u.test(error.message),
    );
    assert.deepEqual(h.marked, []);
  }
});
