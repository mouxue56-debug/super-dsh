// 一键全停期间，所有「会起动作」的入口都要拒：固定任务（手动与到点）、晨晚会（手动与到点，
// 晚会不许写出空纪要）、讨论组（发言、批准分工表、定时唤醒）、助理互派、看板转单。外包派工见 fixE-panic。
// 全停用真实的停机标记文件表示（<数据目录>/panic/stopped.flag），与后端、插件同一处。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBoard} from '../lib/board.mjs';
import {createRoutineService} from '../lib/routines.mjs';
import {createMeetingService, __tick} from '../lib/ext/meetings.mjs';
import {createGroupRuntime} from '../lib/group-runtime.mjs';
import {Delegations} from '../lib/delegation.mjs';
import {createBoardInbox} from '../lib/board-inbox.mjs';
import {ROSTER, fakeClock, fakeSessions, planInput, tempDir} from './group-runtime-fixture.mjs';

// 在数据目录写停机标记；返回解除函数。
function panicStop(dataDir) {
  const flag = path.join(dataDir, 'panic', 'stopped.flag');
  fs.mkdirSync(path.dirname(flag), {recursive: true});
  fs.writeFileSync(flag, '{"stopped":true}');
  return () => fs.rmSync(flag);
}

const tmp = label => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), label)));

test('固定任务：全停时手动运行明说已全停，不建单不开会话；到点也不触发；恢复后照常', async () => {
  const dir = tmp('fixe-ent-routine-');
  const created = [];
  const board = createBoard({root: path.join(dir, 'board')});
  const svc = createRoutineService({dataDir: dir, now: () => Date.parse('2026-11-18T10:05:00Z'),
    hubConfig: {routines: {utcOffsetMinutes: 0, items: [{id: 'daily-one', assistant: 'bot', at: '10:00',
      prompt: '做一件事', done: '写回报', escape: {maxSteps: 1, maxMinutes: 5}}]}},
    board, roster: {get: () => ({status: 'active'})},
    sessions: {create: async () => {
      created.push(1);
      return {id: 's' + created.length};
    }, send: async () => ({}), cancel: async () => {}},
    logger: {error() {}}});
  const resume = panicStop(dir);
  const manual = await svc.runNow('daily-one');
  assert.equal(manual.state, 'stopped');
  assert.match(manual.reason, /已一键全停，恢复后再运行/u);
  assert.deepEqual(await svc.tick(), []);
  assert.equal(created.length, 0);
  assert.equal((await board.list()).length, 0, '全停时建了工单');
  resume();
  await svc.tick();
  assert.equal(created.length, 1, '恢复后到点应照常');
});

// 晨晚会夹具：两位助理，经验回答走假会话。
function meetingDeps(sessionsHook) {
  const dir = tmp('fixe-ent-meeting-');
  const deps = {dataDir: dir, configDir: dir, now: () => Date.parse('2026-01-02T18:00:00Z'),
    roster: [{id: 'a1', name: '甲', role: 'assistant'}, {id: 'a2', name: '乙', role: 'assistant'}],
    hubConfig: {meetings: {utcOffsetMinutes: 0, times: {morning: '08:00', evening: '17:30'},
      kb: {kbAgentPath: path.join(dir, 'no-agent')}}},
    sessions: {list: async () => [], create: async id => {
      sessionsHook?.();
      return id;
    }, send: async id => `经验 ${id}`},
    cards: {ask: () => undefined},
    kbExecFile: () => {
      throw new Error('测试里不许调知识库');
    }};
  return {dir, deps};
}

// 找出写下的所有纪要文件。
function minutesFiles(dir) {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

test('晨晚会：全停时手动开晚会被拒、到点不开，都不写纪要', async () => {
  const {dir, deps} = meetingDeps();
  panicStop(dir);
  const svc = createMeetingService(deps);
  await assert.rejects(svc.run({type: 'evening', date: '2026-01-02'}), e => e.code === 'PANIC_STOPPED');
  assert.deepEqual(await __tick(deps), []);
  assert.deepEqual(minutesFiles(dir), [], '全停时写出了纪要');
});

test('晨晚会：开到一半全停了，不写出人人缺席的空纪要', async () => {
  let dir;
  const made = meetingDeps(() => panicStop(dir));
  dir = made.dir;
  await assert.rejects(createMeetingService(made.deps).run({type: 'evening', date: '2026-01-02'}),
    e => e.code === 'PANIC_STOPPED');
  assert.deepEqual(minutesFiles(dir), [], '中途全停仍写了纪要');
});

test('讨论组：全停时发言、批准分工表都明说已全停；定时与唤醒都不开会话', async () => {
  const dir = tempDir();
  const sessions = fakeSessions();
  const rt = createGroupRuntime({dataDir: dir, roster: ROSTER, sessions, now: fakeClock()});
  const {group} = await rt.propose(planInput());
  const resume = panicStop(dir);
  await assert.rejects(rt.confirm(group.id, {approved: true, by: 'owner'}), e => e.code === 'PANIC_STOPPED');
  resume();
  await rt.confirm(group.id, {approved: true, by: 'owner'});
  await rt.idle();
  const before = sessions.sent.length;
  panicStop(dir);
  await assert.rejects(rt.post(group.id, {from: 'owner', text: '大家开始吧'}), e => e.code === 'PANIC_STOPPED');
  await rt.tick();
  await rt.idle();
  assert.equal(sessions.sent.length, before, '全停时还在唤醒成员');
});

test('助理互派：全停时不派新活、续做被拒；排队的单不标失败', async () => {
  let stopped = true;
  const creates = [];
  const d = new Delegations({runtime: {}, ticketsDir: tmp('fixe-ent-deleg-'), bots: () => [], send: async () => {},
    client: {createSession: async () => {
      creates.push(1);
      return {id: 'x'};
    }}, store: {ready: Promise.resolve(), cards: [], list: () => []}, roster: {}, ledger: {},
    isStopped: () => stopped, logger: {error() {}}});
  await d.tick();
  assert.equal(creates.length, 0);
  await assert.rejects(d.continue('D-1', 'phone-1'), e => e.status === 503);
  const broken = new Delegations({runtime: {}, ticketsDir: '/nonexistent', bots: () => [], send: async () => {},
    client: {}, store: {}, roster: {}, ledger: {}, isStopped: () => {
      throw new Error('坏了');
    }});
  assert.equal(broken.halted(), true, '判断出错应按停着');
  stopped = false;
});

test('看板转单：全停时不开会话，恢复后补送一次', async () => {
  const dir = tmp('fixe-ent-inbox-');
  fs.writeFileSync(path.join(dir, 'plugin-events.jsonl'), JSON.stringify({type: 'created', id: 'T-1', ts: 1}) + '\n');
  let stopped = true;
  const sent = [];
  const roster = new Map([['a', {id: 'a', name: '甲', role: 'bot', status: 'active'}],
    ['b', {id: 'b', name: '乙', role: 'bot', status: 'active'}]]);
  const ticket = {id: 'T-1', from: {name: 'a', type: 'assistant'}, to: ['b'], state: 'queued', claimedBy: null,
    title: '整理', goal: '整理周报', readExternalContent: false};
  const inbox = createBoardInbox({boardDir: dir, stateFile: path.join(dir, 'state.json'),
    board: {get: async () => ticket}, roster, logger: {error() {}}, isStopped: () => stopped,
    sessions: {create: async () => ({id: 's1'}), send: async (id, text) => sent.push(text), list: () => []}});
  await inbox.poll();
  assert.equal(sent.length, 0);
  stopped = false;
  await inbox.poll();
  await inbox.poll();
  assert.equal(sent.length, 1);
});
