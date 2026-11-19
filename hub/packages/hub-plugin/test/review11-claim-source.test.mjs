import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../tools/claim.mjs';

test('R11-908 首席读开放认领卡后当前会话应标记内部资料来源', async () => {
  const sessionId = 'fixture-session';
  const card = {
    id: 'T-20261119-030000-Ab12', title: '整理读书会说明', goal: '写一行议程', state: 'queued',
    openClaim: { state: 'open', openedAt: '2026-11-19T03:00:00.000Z' },
  };
  const tools = new Map();
  const marked = [];
  register({ tools: { register: tool => tools.set(tool.name, tool) } }, {
    board: { list: async () => [card] },
    roster: [{ id: 'leader', name: '首席', role: 'chief', status: 'active' }],
    state: id => ({ markInternalRead: () => marked.push(id) }),
    material: text => [{ text }],
  });

  const output = await tools.get('claim_view').execute({}, {}, { bot: 'leader', sessionId });

  assert.match(output, /整理读书会说明/u, '应成功读到开放认领卡');
  assert.deepEqual(marked, [sessionId], '读到卡片资料后应将当前会话标记为内部来源');
});
