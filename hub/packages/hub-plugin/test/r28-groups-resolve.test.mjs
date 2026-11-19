import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../tools/groups.mjs';

// 验证省略组和工单时先解析再提交。
test('自动解析组和工单', async () => {
  const tools = {};
  const calls = [];
  register({ tools: { register: (tool) => { tools[tool.name] = tool; } } }, {
    state: () => ({ bot: 'research' }),
    groups: {
      resolve: async (body) => {
        calls.push(body);
        return { group: 'g1', ticket: 'W1', autoFilled: ['group', 'ticket'] };
      },
      submit: async (...args) => {
        calls.push(args);
        return { ok: true };
      },
    },
  });
  assert.deepEqual(tools.group_ticket_submit.parameters.required, ['summary']);
  const result = await tools.group_ticket_submit.execute({ summary: '完成' }, { agent: { id: 's' } });
  assert.match(result, /已自动补上.*g1.*W1/u);
  assert.equal(calls[0].action, 'submit');
  assert.equal(calls[1][0], 'g1');
  assert.equal(calls[1][1], 'W1');
});

// 验证歧义说明原样交给模型。
test('解析失败保留候选', async () => {
  const tools = {};
  register({ tools: { register: (tool) => { tools[tool.name] = tool; } } }, {
    state: () => ({ bot: 'research' }),
    groups: { resolve: async () => { throw new Error('请选择：g1（甲）、g2（乙）'); } },
  });
  const result = await tools.group_read.execute({}, { agent: { id: 's' } });
  assert.equal(result, '请选择：g1（甲）、g2（乙）');
});
