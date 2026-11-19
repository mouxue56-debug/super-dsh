import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupAccess, readGroupShares } from '../group-share.mjs';
import { evaluate, parsePolicy, policyText, policyForRoster } from '../policy.mjs';
import { classifyCommand } from '../command-policy.mjs';
import { buildProfile } from '../command-sandbox.mjs';

const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'group-fence-')));
const root = path.join(base, 'group-work');
const gid = 'g20261118120000abcd';
const dir = path.join(root, gid);
const own = path.join(dir, 'research');
const other = path.join(dir, 'copy');
fs.mkdirSync(own, { recursive: true });
fs.mkdirSync(other);
fs.mkdirSync(path.join(base, 'bots', 'research'), { recursive: true });
const share = { group: gid, dir, members: ['research', 'copy'], status: 'active', since: new Date().toISOString() };
const access = (bot = 'research', shares = [share]) => groupAccess({ shares, bot, hubHome: base });

test('登记和目录校验拒绝非法、结束、非组员及链接', () => {
  assert.deepEqual(readGroupShares(base), []);
  assert.deepEqual(access('image').read, []);
  assert.deepEqual(access('research', [{ ...share, group: 'bad' }]).read, []);
  assert.deepEqual(access('research', [{ ...share, status: 'ended' }]).write, []);
  const linked = path.join(root, 'g20261118120001abcd');
  fs.symlinkSync(dir, linked);
  assert.deepEqual(access('research', [{ ...share, group: path.basename(linked), dir: linked }]).read, []);
  const linkedMember = path.join(dir, 'image');
  fs.symlinkSync(own, linkedMember);
  assert.deepEqual(access('image', [{ ...share, members: ['image'] }]).write, []);
});

test('文件工具只允许组内读取和自己一格写入', () => {
  const parsed = parsePolicy(policyText(base, path.join(base, 'kb')));
  const policy = { ...policyForRoster(parsed, parsed.roster), group_access: access() };
  const level = (tool, file, bot = 'research', p = policy) =>
    evaluate(p, bot, tool, { file_path: file }, path.join(base, 'bots', 'research')).level;
  assert.equal(level('read', path.join(other, 'x')), 'L0');
  assert.equal(level('write', path.join(own, 'x')), 'L1');
  assert.equal(level('write', path.join(other, 'x')), 'L4');
  assert.equal(level('write', path.join(own, 'AGENTS.md')), 'L4');
  assert.equal(level('read', path.join(other, 'x'), 'research', { ...policy, group_access: access('image') }), 'L4');
  assert.equal(level('write', path.join(own, 'x'), 'research', {
    ...policy, group_access: access('research', [{ ...share, status: 'ended' }]),
  }), 'L4');
});

test('命令围栏校验真实路径，结束或非组员立即拒绝', () => {
  const botDir = path.join(base, 'bots', 'research');
  const fence = access();
  const roots = { own: botDir, readable: [botDir, ...fence.read], writable: [botDir, ...fence.write] };
  const check = (command, groupFence = fence) => classifyCommand({
    command, groupFence, roots, cwd: botDir, home: base, hubHome: base, sandboxActive: true,
  }).level;
  assert.equal(check(`cat ${other}/x`), 'run');
  assert.notEqual(check(`tee ${own}/x`), 'deny');
  assert.equal(check(`tee ${other}/x`), 'deny');
  assert.equal(check(`tee ${own}/../copy/x`), 'deny');
  assert.equal(check(`cat ${other}/x`, access('image')), 'deny');
  assert.equal(check(`cat ${root.toUpperCase()}/${gid}/x`, access('image')), 'deny');
  const alias = path.join(base, 'alias');
  fs.symlinkSync(other, alias);
  assert.equal(check(`cat ${alias}/x`, access('image')), 'deny');
  assert.equal(check(`cat ${other}/x`, access('research', [{ ...share, status: 'ended' }])), 'deny');
});

test('沙箱只加入组读根和自己的写根', () => {
  const botDir = path.join(base, 'bots', 'research');
  const fence = access();
  const profile = buildProfile({ home: base, hubHome: base, own: botDir,
    readable: fence.read, extraWrite: fence.write });
  assert.ok(profile.includes(`(subpath "${dir}")`));
  assert.ok(profile.includes(`(subpath "${own}")`));
  assert.ok(!profile.includes(`(subpath "${other}")`));
  const absent = buildProfile({ home: base, hubHome: base, own: botDir,
    readable: access('image').read, extraWrite: access('image').write });
  assert.ok(!absent.includes(`(subpath "${dir}")`));
});
