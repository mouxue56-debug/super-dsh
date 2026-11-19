import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendArchive,
  appendMessage,
  createGroup,
  DEFAULT_LIMITS,
  listGroups,
  loadGroup,
  OWNER,
  parseMarks,
  parseMentions,
  readArchive,
  readMessages,
  readPage,
  saveGroup,
  setGroupStatus,
  writePage,
} from '../lib/group.mjs';
const members = [{ id: 'm-host', kind: 'assistant', role: 'member', name: '主持' }, {
  id: 'm-1',
  kind: 'external',
  role: 'member',
  name: '研究',
}, { id: 'm-10', kind: 'assistant', role: 'member' }];
const make = (extra = {}) =>
  createGroup({ id: 'g', name: '组', goal: '目标', members, host: 'm-host', ...extra });
test('construction and validation', () => {
  assert.equal(OWNER, 'owner');
  assert.equal(make().limits.idleLimit, DEFAULT_LIMITS.idleLimit);
  assert.equal(make({ host: undefined, createdBy: 'm-1' }).host, 'm-1');
  for (
    const bad of [
      { host: undefined },
      { host: 'missing' },
      { id: '../x' },
      { members: [] },
      { members: [...members, members[0]] },
      { members: members.map((m) => ({ ...m, role: 'host' })) },
      { limits: { idleLimit: 0 } },
    ]
  ) {
    assert.throws(() => make(bad));
  }
});

test('storage, messages and atomic replacement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'group-'));
  const g = make();
  assert.equal(loadGroup(root, 'g'), null);
  saveGroup(root, g);
  saveGroup(root, make({ id: 'a' }));
  assert.deepEqual(listGroups(root).map((x) => x.id), ['a', 'g']);
  assert.deepEqual(loadGroup(root, 'g'), g);
  assert.equal(readPage(root, 'g'), '');
  writePage(root, 'g', 'page');
  assert.equal(readPage(root, 'g'), 'page');
  assert.equal(readArchive(root, 'g'), '');
  appendArchive(root, 'g', 'one', 12);
  appendArchive(root, 'g', 'two', 13);
  assert.match(readArchive(root, 'g'), /<!-- 归档 12 -->\none\n<!-- 归档 13 -->\ntwo/);
  for (let i = 0; i < 4; i++) {
    assert.equal(appendMessage(root, 'g', { from: OWNER, text: '@研究', ts: i }).id, i + 1);
  }
  assert.deepEqual(readMessages(root, 'g', { afterId: 1, limit: 2 }).map((m) => m.id), [3, 4]);
  assert.deepEqual(readMessages(root, 'g')[0].to, ['m-1']);
  assert.throws(() => appendMessage(root, 'g', { from: 'bad', text: 'x' }));
  assert.throws(() => appendMessage(root, 'g', { from: OWNER, text: ' ' }));
  setGroupStatus(root, 'g', 'paused', 'reason');
  assert.equal(loadGroup(root, 'g').pausedReason, 'reason');
  setGroupStatus(root, 'g', 'active');
  assert.equal(loadGroup(root, 'g').pausedReason, undefined);
  assert.ok(fs.readdirSync(path.join(root, 'groups', 'g')).every((n) => !n.endsWith('.tmp')));
});

test('mentions and marks', () => {
  assert.equal(parseMentions('@ALL', members), 'all');
  assert.equal(parseMentions('@全员', members), 'all');
  assert.deepEqual(parseMentions('@m-10 @研究 @m-10', members), ['m-10', 'm-1']);
  assert.deepEqual(parseMentions('none', members), []);
  assert.deepEqual(parseMarks('〔决定〕〔异议〕'), {
    decision: true,
    objection: true,
    pass: false,
  });
  for (const x of ['过', ' [PASS] ', '〔过〕']) {
    assert.equal(parseMarks(x).pass, true);
  }
  assert.equal(parseMarks('过了').pass, false);
});

test('成员重名被拒；残行后追加不粘连、编号不回退', async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const mk = (id, name) => ({ id, name, kind: 'assistant', role: 'member' });
  const members = [{ ...mk('h', 'H'), role: 'host' }, mk('x', 'H')];
  assert.throws(() => createGroup({ id: 'g', name: 'g', goal: 'x', createdBy: 'h', members }));
  const root = mkdtempSync(join(tmpdir(), 'grp-'));
  saveGroup(root, createGroup({ id: 'g', name: 'g', goal: 'x', createdBy: 'h', members: [members[0], mk('y', 'Y')] }));
  appendMessage(root, 'g', { from: 'owner', text: 'one' });
  writeFileSync(join(root, 'groups', 'g', 'messages.jsonl'), '{"id":2,"ts', { flag: 'a' });
  const m = appendMessage(root, 'g', { from: 'owner', text: 'two' });
  assert.equal(m.id, 2);
  assert.deepEqual(readMessages(root, 'g').map((x) => x.text), ['one', 'two']);
  assert.ok(readFileSync(join(root, 'groups', 'g', 'messages.jsonl'), 'utf8').endsWith('\n'));
});
