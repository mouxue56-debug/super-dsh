// 路31 第三轮复核：讨论组运行状态文件缺失。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createGroupRuntime} from '../lib/group-runtime.mjs';
import {ROSTER, fakeClock, fakeSessions, planInput, tempDir} from './group-runtime-fixture.mjs';

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) return full;
  }
  return null;
}

// 发现 9（中）：readState 里把 ENOENT 写成了 'ENOOENT'，状态文件不存在时抛原始错误而不是按新状态处理，组卡死。
test('R3-9 运行状态文件不存在时按全新状态处理（落盘中途崩溃的场景）', async () => {
  const dir = tempDir();
  const rt = createGroupRuntime({dataDir: dir, roster: ROSTER, sessions: fakeSessions(), now: fakeClock()});
  const {group} = await rt.propose(planInput());
  const file = findFile(dir, 'runtime.json');
  assert.ok(file, '夹具里没找到 runtime.json');
  fs.rmSync(file);
  await assert.doesNotReject(rt.confirm(group.id, {approved: true, by: 'owner'}), '缺状态文件时确认直接抛错');
});
