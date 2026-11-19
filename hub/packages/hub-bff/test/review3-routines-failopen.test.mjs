// 路31 第三轮复核：固定任务的暂停状态文件坏了，不该等于「没暂停」。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBoard} from '../lib/board.mjs';
import {createRoutineService} from '../lib/routines.mjs';

// 发现 10（中）：loadState 读不出来就当空状态，pause() 过的任务到点照跑（失败后默认放行）。
test('R3-10 暂停后状态文件损坏，定时检查不得照常开跑', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r3-routine-')));
  const created = [];
  const deps = {
    dataDir: dir, now: () => Date.parse('2026-11-18T10:05:00Z'),
    hubConfig: {routines: {utcOffsetMinutes: 0, items: [{id: 'daily-one', assistant: 'bot', at: '10:00',
      prompt: '做一件事', done: '写回报', escape: {maxSteps: 1, maxMinutes: 5}}]}},
    board: createBoard({root: path.join(dir, 'board')}),
    roster: {get: () => ({status: 'active'})},
    sessions: {create: async () => { created.push(1); return {id: 's1'}; }, send: async () => ({}), cancel: async () => {}},
    logger: {error() {}},
  };
  const svc = createRoutineService(deps);
  svc.pause();
  fs.writeFileSync(path.join(dir, 'routines', 'state.json'), '{坏了');
  const out = await svc.tick();
  assert.equal(created.length, 0, '暂停状态读不出时任务照常开跑了：' + JSON.stringify(out));
});
