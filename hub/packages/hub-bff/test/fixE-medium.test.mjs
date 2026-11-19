// 第三轮复核 R3-9（讨论组运行状态缺失）、R3-10（固定任务状态坏了按暂停）、R3-12（只聊天名单写失败要放弃会话）
// 的补充用例。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBoard} from '../lib/board.mjs';
import {createRoutineService} from '../lib/routines.mjs';
import {createSessionWithModel} from '../lib/ext/models.mjs';
import {createDiscardList} from '../lib/discarded-sessions.mjs';
import {createGroupRuntime} from '../lib/group-runtime.mjs';
import {ROSTER, fakeClock, fakeSessions, planInput, tempDir} from './group-runtime-fixture.mjs';

// 递归找文件。
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

test('R3-9 变形：提案落盘后运行状态在、工单表在；状态文件缺了确认能重建；坏了仍按暂停等主人', async () => {
  const dir = tempDir();
  const rt = createGroupRuntime({dataDir: dir, roster: ROSTER, sessions: fakeSessions(), now: fakeClock()});
  const {group} = await rt.propose(planInput());
  const file = findFile(dir, 'runtime.json');
  assert.ok(file);
  assert.ok(fs.existsSync(path.join(path.dirname(file), 'group.json')));
  fs.rmSync(file);
  await rt.confirm(group.id, {approved: true, by: 'owner'});
  assert.ok(fs.existsSync(file), '确认之后应重建运行状态文件');
  const second = tempDir();
  const rt2 = createGroupRuntime({dataDir: second, roster: ROSTER, sessions: fakeSessions(), now: fakeClock()});
  const proposed = await rt2.propose(planInput());
  fs.writeFileSync(findFile(second, 'runtime.json'), '{坏');
  await assert.rejects(rt2.confirm(proposed.group.id, {approved: true, by: 'owner'}));
});

// 固定任务夹具：到点的一条任务，记下开了几个会话。
function routineDeps() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fixe-routine-')));
  const created = [];
  const errors = [];
  const deps = {
    dataDir: dir, now: () => Date.parse('2026-11-18T10:05:00Z'),
    hubConfig: {routines: {utcOffsetMinutes: 0, items: [{id: 'daily-one', assistant: 'bot', at: '10:00',
      prompt: '做一件事', done: '写回报', escape: {maxSteps: 1, maxMinutes: 5}}]}},
    board: createBoard({root: path.join(dir, 'board')}),
    roster: {get: () => ({status: 'active'})},
    sessions: {create: async () => {
      created.push(1);
      return {id: 's' + created.length};
    }, send: async () => ({}), cancel: async () => {}},
    logger: {error: e => errors.push(e)},
  };
  return {dir, deps, created, errors};
}

test('R3-10 变形：状态文件为 null、数组、字段类型不对、截断、是目录，都按暂停；并记日志', async () => {
  for (const write of [f => fs.writeFileSync(f, 'null'), f => fs.writeFileSync(f, '[]'),
    f => fs.writeFileSync(f, JSON.stringify({paused: 'no'})), f => fs.writeFileSync(f, JSON.stringify({pausedIds: 5})),
    f => fs.writeFileSync(f, JSON.stringify({slots: null})), f => fs.writeFileSync(f, '{"paused":fa'),
    f => fs.mkdirSync(f)]) {
    const h = routineDeps();
    const svc = createRoutineService(h.deps);
    svc.pause();
    const file = path.join(h.dir, 'routines', 'state.json');
    fs.rmSync(file);
    write(file);
    await svc.tick();
    assert.equal(h.created.length, 0, '坏状态下任务照跑了：' + write);
    assert.ok(h.errors.includes('HUB_ROUTINES_STATE_CORRUPT'));
  }
});

test('R3-10 变形：没有状态文件照常跑；坏了之后主人点恢复，重写状态后照常跑', async () => {
  const fresh = routineDeps();
  await createRoutineService(fresh.deps).tick();
  assert.equal(fresh.created.length, 1, '全新状态应照常开跑');
  const h = routineDeps();
  const svc = createRoutineService(h.deps);
  svc.pause();
  fs.writeFileSync(path.join(h.dir, 'routines', 'state.json'), '{坏');
  await svc.tick();
  assert.equal(h.created.length, 0);
  svc.resume();
  await svc.tick();
  assert.equal(h.created.length, 1, '主人恢复后应照常跑');
});

// 只聊天名单写不进去：配置目录是一个普通文件，建目录必失败。
function chatOnlyDeps(kernel) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fixe-chat-')));
  const configDir = path.join(dir, 'not-a-dir');
  fs.writeFileSync(configDir, 'x');
  const models = {enabled: true, channels: {'ch-b': {chatOnly: true}}, models: {'ch-b/model-y': {}},
    assistants: {'bot-b': {defaultModel: 'ch-b/model-y'}}, defaults: {chatOnlyPreset: 'preset-chat'}};
  return {configDir, dataDir: dir, hubConfig: {models}, kernel, logger: {error() {}}, botPreset: () => 'preset-main'};
}

// 最小假内核：能建会话、能选模型、能恢复默认。
function fakeKernel(extra = {}) {
  const calls = [];
  let current = {provider: 'ch-b', model: 'model-y'};
  return {calls, async modelCatalog() {
    return {default: {...current}, groups: [{id: 'ch-b', models: [{id: 'model-y'}]}], failures: []};
  }, async createSession() {
    calls.push('create');
    return {id: 'session-1'};
  }, async selectModel(args) {
    current = {provider: args.provider, model: args.model};
    return current;
  }, async restoreDefault(value) {
    current = {...value};
  }, ...extra};
}

test('R3-12 变形：名单写不进去时，有放弃入口就放弃；没有入口或放弃失败都报出来，不吞掉', async () => {
  const discards = [];
  const ok = fakeKernel({async discardSession(id) {
    discards.push(id);
  }});
  await assert.rejects(createSessionWithModel(chatOnlyDeps(ok), {bot: 'bot-b'}),
    e => e.code === 'MODEL_CHATONLY_LIST_FAILED');
  assert.deepEqual(discards, ['session-1']);
  await assert.rejects(createSessionWithModel(chatOnlyDeps(fakeKernel()), {bot: 'bot-b'}),
    e => e.code === 'MODEL_CHATONLY_DISCARD_UNAVAILABLE');
  const bad = fakeKernel({async discardSession() {
    throw new Error('坏了');
  }});
  await assert.rejects(createSessionWithModel(chatOnlyDeps(bad), {bot: 'bot-b'}),
    e => e.code === 'MODEL_CHATONLY_DISCARD_FAILED');
});

test('R3-12 变形：放弃名单内存当场生效、落盘后重启仍认；落盘失败也不影响当场拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixe-discard-'));
  const file = path.join(dir, 'discarded-sessions.json');
  const list = createDiscardList({file, logger: {error() {}}});
  assert.equal(list.has('s1'), false);
  list.add('s1');
  assert.equal(list.has('s1'), true);
  assert.equal(createDiscardList({file}).has('s1'), true, '重启后不认了');
  const errors = [];
  const broken = createDiscardList({file: path.join(file, 'under-a-file.json'), logger: {error: e => errors.push(e)}});
  broken.add('s2');
  assert.equal(broken.has('s2'), true);
  assert.ok(errors.includes('HUB_DISCARD_LIST_WRITE_FAILURE'));
  const source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(source, /if\(discarded\.has\(id\)\)throw new BffError\('SESSION_DISCARDED'/u,
    '送话入口没有拦放弃的会话');
});
