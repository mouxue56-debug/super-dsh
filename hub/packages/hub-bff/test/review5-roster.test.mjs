// 第五轮独立复核（路51）：助理名字。每条测试都在 87bf901 上失败，证明对应发现；通过即视为已修。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validRosterCard, validName } from '../lib/roster.mjs';

const kinds = { roles: ['helper'], shapes: ['circle'], colors: ['blue'] };
const card = (before, after) => ({
  v: 1, bot: 'bchief0001', sessionId: 's1', level: 'L3', action: '改助理', tool: 'bot_update',
  path: '/x/config/bots.yaml', chars: 0, preview: '改助理', target: 'bhelper001', before, after, why: '改名',
});

// R5-R1（中）：收紧后，已有的「旧名字」（比如带全角感叹号、&）能读出来，但想把它改成合规名字的审批卡
// 因为 before.name 也要过新的 validName 而整张卡无效——旧名字只能留着，改名这条出路被堵死。
test('R5-R1 把旧的不合规名字改成合规名字，审批卡应有效', () => {
  assert.equal(validName('小帮！'), false, '前提：旧名字按新规则不合规');
  assert.equal(validRosterCard(card({ name: '小帮！' }, { name: '小帮' }), kinds), true);
});
