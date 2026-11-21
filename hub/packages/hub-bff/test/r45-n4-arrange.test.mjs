// 请首席安排、给安排结论，只留给主人和在任首席。反向用例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createBoard } from '../lib/board.mjs';
import { fixture, OWNER, CHIEF, newCard, good } from './r38-helpers.mjs';

const RESEARCH = { name: 'research', type: 'assistant' };
const EXTERNAL = { name: 'codex', type: 'external' };

test('请首席安排：主人或在任首席可以，别的助理和外部身份被拒绝并说明原因', async () => {
  const h = await fixture();
  const card = await newCard(h);
  await assert.rejects(() => h.board.arrangeAsk(RESEARCH, card.id), (err) => {
    assert.equal(err.code, 'FORBIDDEN');
    assert.match(err.message, /只有主人或首席助理能用/u);
    return true;
  });
  await assert.rejects(() => h.board.arrangeAsk(EXTERNAL, card.id), (err) => {
    assert.equal(err.code, 'FORBIDDEN');
    assert.match(err.message, /只有主人或首席助理能用/u);
    return true;
  });
  const asked = await h.board.arrangeAsk(OWNER, card.id);
  assert.equal(asked.arrange.state, 'wanted');
  const other = await newCard(h, { title: '另一张', goal: '也是普通卡' });
  const byChief = await h.board.arrangeAsk(CHIEF, other.id);
  assert.equal(byChief.arrange.state, 'wanted');
});

test('安排结论只有在任首席能给；停用的首席、别的助理、外部身份、主人都不行', async () => {
  const h = await fixture();
  const card = await newCard(h);
  await h.board.arrangeAsk(OWNER, card.id);
  await assert.rejects(() => h.board.arrangeSet(RESEARCH, card.id, good(), h.view()), (err) => {
    assert.equal(err.code, 'FORBIDDEN');
    assert.match(err.message, /只有首席助理能给/u);
    return true;
  });
  await assert.rejects(() => h.board.arrangeSet(EXTERNAL, card.id, good(), h.view()), (err) => {
    assert.equal(err.code, 'FORBIDDEN');
    assert.match(err.message, /只有首席助理能给/u);
    return true;
  });
  await assert.rejects(() => h.board.arrangeSet(OWNER, card.id, good(), h.view()), { code: 'FORBIDDEN' });
  const off = await fixture({ chiefStatus: 'disabled' });
  const held = await newCard(off);
  await off.board.arrangeAsk(OWNER, held.id);
  await assert.rejects(() => off.board.arrangeAsk(CHIEF, held.id), { code: 'FORBIDDEN' });
  await assert.rejects(() => off.board.arrangeSet(CHIEF, held.id, good(), off.view()), { code: 'FORBIDDEN' });
  const done = await h.board.arrangeSet(CHIEF, card.id, good(), h.view());
  assert.deepEqual(done.to, ['research']);
});

test('看板没接上名册判断时，安排结论一律拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r45-n4-arrange-'));
  const board = createBoard({ root: join(dir, 'board'), reservedNames: ['owner', 'chief'] });
  const card = await board.create(OWNER, { title: '普通卡', goal: '没有首席判断' });
  await assert.rejects(() => board.arrangeSet(CHIEF, card.id, good()), { code: 'FORBIDDEN' });
  await assert.rejects(() => board.arrangeAsk(RESEARCH, card.id), { code: 'FORBIDDEN' });
  const asked = await board.arrangeAsk(OWNER, card.id);
  assert.equal(asked.arrange.state, 'wanted');
});
