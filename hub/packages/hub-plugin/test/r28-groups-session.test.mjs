import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../tools/groups.mjs';

test('建组会话来自执行上下文，覆盖模型参数', async () => {
  const tools = {};
  let received;
  register({ tools: { register: (tool) => { tools[tool.name] = tool; } } }, {
    state: () => ({ bot: 'chief' }),
    groups: { propose: async (input) => {
      received = input;
      return { group: { id: 'g', name: '组' } };
    } },
  });
  await tools.group_create.execute({ session: 'other' }, { agent: { id: 'trusted', session: { big: 'object' } } });
  assert.equal(received.session, 'trusted');
});
