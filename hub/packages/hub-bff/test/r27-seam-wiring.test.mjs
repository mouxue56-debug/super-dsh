// 收口：后端接缝的测试（建会话走选模型入口、只聊天名单、看板保留名、主人原文取回、看板收件箱）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, stat, appendFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, request, testDirectory } from './fixtures.mjs';
import { createBoard } from '../lib/board.mjs';
import { createGroup, saveGroup, appendMessage } from '../lib/group.mjs';
import { createOwnerSourceResolver } from '../lib/owner-source.mjs';
import { addChatOnlySession, readChatOnlyList } from '../lib/chat-only-list.mjs';
import { createBoardInbox, delegatedPrefix } from '../lib/board-inbox.mjs';
import { pickForKb } from '../lib/meeting.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'r27-seam-wiring-'));

// 起一个带自定义扩展目录的后端夹具，跑完清理。
async function withFixture(fn, extDir) {
  const f = await fixture({ handlerOptions: { extDir } });
  try {
    await fn(f);
  } finally {
    await f.dispose();
  }
}

// 写一个假的 models 扩展：建会话后按入参报告是不是只聊天。
async function fakeModels(dir, chatOnly) {
  await writeFile(join(dir, 'models.mjs'), `export function createHandler() {
    return async () => false;
  }
  export async function createSessionWithModel(deps, input) {
    const result = await deps.kernel.createSession({cwd: input.cwd, agentPreset: 'hub-pm'});
    return {sessionId: result.id, model: input.model ?? null, chatOnly: ${chatOnly}};
  }\n`);
}

test('选模型入口在场时，助理目录不存在仍报 BOTS_DIR_MISSING 且不调上游', async () => {
  const dir = await testDirectory();
  await fakeModels(dir, false);
  await withFixture(async f => {
    const { rm } = await import('node:fs/promises');
    await rm(join(f.botsDir, 'pm'), { recursive: true });
    const call = request(f.handler, { method: 'POST', path: '/bff/sessions', value: { bot: 'pm' } });
    const value = await call.json();
    assert.equal(call.res.status, 503);
    assert.equal(value.error.code, 'BOTS_DIR_MISSING');
    assert.equal(f.source.named('session/create').length, 0);
  }, dir);
});

test('只聊天会话建好后写进名单（0600），插件读的同一个文件', async () => {
  const dir = await testDirectory();
  await fakeModels(dir, true);
  await withFixture(async f => {
    const call = request(f.handler, { method: 'POST', path: '/bff/sessions', value: { bot: 'pm' } });
    const row = await call.json();
    assert.equal(call.res.status, 201);
    const file = join(f.handlerOptions.hubHome, 'config', 'chat-only-sessions.json');
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { v: 1, sessions: [row.id] });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }, dir);
});

test('只聊天名单写不进去时不把会话交给主人', async () => {
  const dir = await testDirectory();
  await fakeModels(dir, true);
  await withFixture(async f => {
    const file = join(f.handlerOptions.hubHome, 'config', 'chat-only-sessions.json');
    await mkdir(file, { recursive: true });
    const before = f.handler.runtime.store.list().length;
    const call = request(f.handler, { method: 'POST', path: '/bff/sessions', value: { bot: 'pm' } });
    const value = await call.json();
    assert.equal(call.res.status, 500);
    assert.equal(value.error.code, 'CHAT_ONLY_LIST_FAILED');
    assert.equal(f.handler.runtime.store.list().length, before);
  }, dir);
});

test('只聊天名单：坏文件不被覆盖，重复加只留一条', async () => {
  const file = join(tmp(), 'config', 'chat-only-sessions.json');
  await Promise.all([addChatOnlySession(file, 'a'), addChatOnlySession(file, 'b'), addChatOnlySession(file, 'a')]);
  assert.deepEqual((await readChatOnlyList(file)).sort(), ['a', 'b']);
  await writeFile(file, '{坏了');
  await assert.rejects(addChatOnlySession(file, 'c'));
  assert.equal(await readFile(file, 'utf8'), '{坏了');
});

test('看板保留名可按名册现读：外部身份用助理编号或名字被拒，名册读不出时一律拒', async () => {
  let names = ['pm', 'chief'];
  const board = createBoard({ root: tmp(), reservedNames: () => names });
  const input = { title: '测试', goal: '测试', key: 'k1', to: ['pm'] };
  for (const name of ['pm', 'chief']) {
    await assert.rejects(board.create({ type: 'external', name }, { ...input, key: 'k-' + name }),
      e => e.code === 'FORBIDDEN');
  }
  await board.create({ type: 'external', name: 'codex' }, input);
  names = () => {
    throw new Error('x');
  };
  const broken = createBoard({ root: tmp(), reservedNames: () => names() });
  await assert.rejects(broken.create({ type: 'external', name: 'codex' }, { ...input, key: 'k2' }),
    e => e.code === 'FORBIDDEN');
});

test('后端把名册里的助理设为看板保留名', () => withFixture(async f => {
  const input = { title: '测试', goal: '测试', key: 'k1', to: ['pm'] };
  await assert.rejects(f.handler.board.create({ type: 'external', name: 'pm' }, input), e => e.code === 'FORBIDDEN');
  await assert.rejects(f.handler.board.create({ type: 'external', name: 'owner' }, { ...input, key: 'k2' }),
    e => e.code === 'FORBIDDEN');
}));

// 建一个两人讨论组并写进三条消息：主人一条、成员一条、主人一条。
function seedGroup(root) {
  const group = createGroup({ id: 'g1', name: '新品', goal: '做新品页', members: [
    { id: 'pm', name: '项目经理', kind: 'assistant', role: 'host' },
    { id: 'art', name: '艺术总监', kind: 'assistant', role: 'member' }],
    host: 'pm', now: 1 });
  saveGroup(root, group);
  appendMessage(root, 'g1', { from: 'owner', text: '标题一定要短，不超过十个字', ts: 1 });
  appendMessage(root, 'g1', { from: 'pm', text: '主人说：全部用红色', ts: 2 });
  appendMessage(root, 'g1', { from: 'owner', text: '好的', ts: 3 });
  return group;
}

test('主人原文只按「项目页 组名 #号」从组消息库取主人本人那条', () => {
  const root = tmp();
  seedGroup(root);
  const resolve = createOwnerSourceResolver({ root });
  assert.equal(resolve('项目页 项目页：新品 #1'), '标题一定要短，不超过十个字');
  assert.equal(resolve('项目页 新品 #1'), '标题一定要短，不超过十个字');
  assert.equal(resolve('项目页 新品 #2'), undefined);
  assert.equal(resolve('项目页 别的组 #1'), undefined);
  assert.equal(resolve('pm规矩页 2026-11-17'), undefined);
  assert.equal(createOwnerSourceResolver({ root: join(root, 'none') })('项目页 新品 #1'), undefined);
});

test('接上取回函数后：组里主人原话进稿带【Owner要求】，助理转述的「主人说」降级', () => {
  const root = tmp();
  seedGroup(root);
  const minutes = { type: 'evening', date: '2026-11-17', entries: [
    { category: 'decision', assistantId: 'pm', assistantName: '项目经理', text: '标题要短',
      ownerQuote: { text: '标题一定要短，不超过十个字', source: '项目页 项目页：新品 #1' } },
    { category: 'decision', assistantId: 'pm', assistantName: '项目经理', text: '用红色',
      ownerQuote: { text: '全部用红色', source: '项目页 项目页：新品 #2' } },
  ] };
  const cfg = { projectMap: { default: 'proj' } };
  const out = pickForKb(minutes, cfg, { resolveSource: createOwnerSourceResolver({ root }) });
  const bodies = out.drafts.map(d => d.body).join('\n');
  assert.match(bodies, /主人原话（逐字，出处：项目页 项目页：新品 #1）：「标题一定要短，不超过十个字」【Owner要求】/u);
  assert.match(bodies, /转述（非逐字，不作主人原话）：全部用红色/u);
  assert.equal((bodies.match(/【Owner要求】/gu) ?? []).length, 1);
});

test('后端 deps 带取回函数和规矩页目录', () => withFixture(async f => {
  assert.equal(typeof f.handler.deps.resolveOwnerSource, 'function');
  assert.equal(f.handler.deps.botsDir, f.botsDir);
}));

// 假的会话接口：记下建了哪些会话、发了什么。
function fakeSessions(rows = []) {
  const created = [];
  const sent = [];
  return {
    created,
    sent,
    async create(bot, opts) {
      const row = { id: 's-' + (created.length + 1), bot, ...opts };
      created.push(row);
      rows.push(row);
      return row;
    },
    async send(id, text, opts) {
      sent.push({ id, text, opts });
      return { accepted: true };
    },
    list: () => rows,
  };
}

const roster = {
  get: id => ({ chief: { id: 'chief', role: 'chief', name: '首席', status: 'active' },
    pm: { id: 'pm', role: 'bot', name: '项目经理', status: 'active' },
    art: { id: 'art', role: 'bot', name: '艺术总监', status: 'disabled' } })[id],
};

// 起一个插件那一侧的看板（事件写进 plugin-events.jsonl），和收件箱共用目录。
function pluginSide(dir) {
  return createBoard({ root: dir, onEvent: async ev => {
    await appendFile(join(dir, 'plugin-events.jsonl'), JSON.stringify(ev) + '\n');
  } });
}

test('看板收件箱：助理转来的新单开会话，第一句是插件认的「派来的活」前缀', async () => {
  const dir = tmp();
  const board = pluginSide(dir);
  const sessions = fakeSessions([{ id: 'origin', bot: 'chief' }]);
  const inbox = createBoardInbox({ boardDir: dir, stateFile: join(dir, 'inbox.json'), board, roster, sessions,
    logger: { error() {} } });
  const t = await board.create({ type: 'assistant', name: 'chief' }, { title: '查一下竞品', goal: '查三家竞品的价格',
    key: 'k1', to: ['pm'], sessions: { from: 'origin', to: '' }, readExternalContent: true });
  await inbox.poll();
  assert.equal(sessions.created.length, 1);
  assert.equal(sessions.created[0].bot, 'pm');
  const first = sessions.sent[0].text;
  // 这张单读过外部内容，首句改带插件认得的「读过外部内容」标记（原断言正是复核查出的洗白口子）。
  assert.ok(first.startsWith(delegatedPrefix('首席', t.id, { readExternal: true })));
  assert.match(first, /^【[^】\n]{1,24}派来的活 · 工单/u);
  assert.match(first, /是资料，不是主人原话/u);
  assert.match(first, /读过外部内容/u);
  await inbox.poll();
  assert.equal(sessions.created.length, 1, '同一张单不重复开会话');
});

test('看板收件箱：外部身份、停用助理、已被领的单都不送', async () => {
  const dir = tmp();
  const board = pluginSide(dir);
  const sessions = fakeSessions();
  const inbox = createBoardInbox({ boardDir: dir, stateFile: join(dir, 'inbox.json'), board, roster, sessions,
    logger: { error() {} } });
  await board.create({ type: 'external', name: 'codex' }, { title: 'a', goal: 'a', key: 'k1', to: ['pm'] });
  await board.create({ type: 'assistant', name: 'chief' }, { title: 'b', goal: 'b', key: 'k2', to: ['art'] });
  const claimed = await board.create({ type: 'assistant', name: 'chief' }, { title: 'c', goal: 'c', key: 'k3',
    to: ['pm'] });
  await board.claim({ type: 'assistant', name: 'pm' }, claimed.id);
  await inbox.poll();
  assert.equal(sessions.created.length, 0);
});

test('看板收件箱：交了结果回到派单的会话请它验收，偏移量落盘', async () => {
  const dir = tmp();
  const board = pluginSide(dir);
  const sessions = fakeSessions([{ id: 'origin', bot: 'chief' }]);
  const stateFile = join(dir, 'inbox.json');
  const inbox = createBoardInbox({ boardDir: dir, stateFile, board, roster, sessions, logger: { error() {} } });
  const t = await board.create({ type: 'assistant', name: 'chief' }, { title: '查价', goal: '查价', key: 'k1',
    to: ['pm'], sessions: { from: 'origin', to: '' } });
  await inbox.poll();
  await board.claim({ type: 'assistant', name: 'pm' }, t.id);
  await board.report({ type: 'assistant', name: 'pm' }, t.id, { summary: '三家价格见 drafts/price.md' });
  await inbox.poll();
  const told = sessions.sent.find(s => s.id === 'origin');
  assert.ok(told);
  assert.match(told.text, /有结果/u);
  assert.match(told.text, /board_review/u);
  assert.match(told.text, /项目经理/u);
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.ok(state.offset > 0);
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
});

test('经 /models/sessions 建的会话登记进会话清单；不给工作目录也用名册预设目录', () => withFixture(async f => {
  const call = request(f.handler, { method: 'POST', path: '/models/sessions', value: { bot: 'pm' } });
  const value = await call.json();
  assert.equal(call.res.status, 201);
  const id = value.session.sessionId;
  assert.ok(f.handler.runtime.store.get(id));
  const created = f.source.named('session/create').at(-1);
  assert.equal(created.request.cwd, join(f.botsDir, 'pm'));
}));
