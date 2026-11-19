// 第六轮复核（路61）：旧名字改名卡的 before 放得太宽。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validRosterCard } from '../lib/roster.mjs';

const kinds = { roles: ['helper'], shapes: ['circle'], colors: ['blue'] };
const card = (before, after) => ({
  v: 1, bot: 'bchief0001', sessionId: 's1', level: 'L3', action: '改助理', tool: 'bot_update',
  path: '/x/config/bots.yaml', chars: 0, preview: '改助理', target: 'bhelper001', before, after, why: '改名',
});

test('R6-R1 before.name 带双向控制符或零宽字符（Cf 类）→ 审批卡应拒，免得 主人 看到的名字被伪装', () => {
  for (const name of ['小‮帮', '小​帮', '小⁦帮']) {
    assert.equal(validRosterCard(card({ name }, { name: '小帮' }), kinds), false, JSON.stringify(name));
  }
});
