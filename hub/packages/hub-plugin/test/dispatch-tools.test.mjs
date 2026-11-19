import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoard } from '../../hub-bff/lib/board.mjs';
import { validLevels } from '../tools/index.mjs';
import { createDispatchClient, levels, register } from '../tools/dispatch.mjs';

function setup() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-tools-test-')));
  const board = createBoard({ root: path.join(dir, 'board') });
  const tools = {};
  const calls = [];
  const state = { known: true, readExternal: false };
  const deps = {
    board,
    roster: [{ id: 'bot', status: 'active', can_dispatch_external: true }],
    hubConfig: {},
    state: () => state,
    dispatchClient: { dispatch: async body => {
      calls.push(body);
      return deps.reply;
    } },
    reply: { status: 202, data: { status: 'awaiting_approval' } },
  };
  register({ tools: { register: tool => { tools[tool.name] = tool; } } }, deps);
  const call = { bot: 'bot', sessionId: 'session' };
  const args = {
    worker: 'worker',
    model: 'model-1',
    title: '任务',
    brief: '完成任务正文',
    acceptance: [{ check: '检查', expect: '通过' }],
    forbidden: ['不得修改其他文件'],
  };
  return { dir, board, tools, calls, state, deps, call, args };
}

test('工具级别合法且都是 L1', () => {
  assert.equal(validLevels(levels), true);
  assert.deepEqual(levels, { dispatch_prepare: 'L1', dispatch_external: 'L1' });
});

test('prepare 校验权限、验收清单和名称格式', async () => {
  const h = setup();
  const run = args => h.tools.dispatch_prepare.execute(args, {}, h.call);
  h.deps.hubConfig.dispatch = { allow_bots: [] };
  await assert.rejects(run(h.args), /没有外派/);
  h.deps.hubConfig.dispatch.allow_bots = ['*'];
  for (const acceptance of [[], [{ check: '', expect: 'x' }], [{ check: 'x' }]]) {
    await assert.rejects(run({ ...h.args, acceptance }), /验收清单/);
  }
  for (const patch of [{ worker: 'BAD NAME' }, { model: 'bad model' }]) {
    await assert.rejects(run({ ...h.args, ...patch }), /格式/);
  }
});

test('两个工具按启用状态和显式外派名单判断', async () => {
  const h = setup();
  const prepare = () => h.tools.dispatch_prepare.execute(h.args, {}, h.call);
  const external = () => h.tools.dispatch_external.execute({ ticket: 'T-20261117-123456-abcd' }, {}, h.call);
  h.deps.roster[0].can_dispatch_external = false;
  for (const allow of [undefined, '*', ['*'], ['bot']]) {
    h.deps.hubConfig.dispatch = allow === undefined ? {} : { allow_bots: allow };
    await prepare();
    await external();
  }
  for (const allow of [[], ['other']]) {
    h.deps.hubConfig.dispatch = { allow_bots: allow };
    await assert.rejects(prepare(), /没有外派/);
    await assert.rejects(external(), /没有外派/);
  }
  h.deps.hubConfig.dispatch = {};
  h.deps.roster[0].status = 'disabled';
  await assert.rejects(prepare(), /没有外派/);
  await assert.rejects(external(), /没有外派/);
});

test('prepare 保存内容、会话污点并按同会话幂等', async () => {
  const h = setup();
  const run = (args, call) => h.tools.dispatch_prepare.execute(args, {}, call);
  const first = await run(h.args, h.call);
  assert.equal(await run(h.args, h.call), first);
  let tickets = await h.board.list();
  assert.equal(tickets.length, 1);
  assert.deepEqual(tickets[0].to, ['worker']);
  assert.deepEqual(tickets[0].routing, {
    requestedBy: 'bot', via: 'dispatch_prepare', hint: '', worker: 'worker', model: 'model-1',
  });
  assert.deepEqual(tickets[0].acceptance, h.args.acceptance);
  assert.deepEqual(tickets[0].forbidden, h.args.forbidden);
  assert.equal(tickets[0].readExternalContent, false);
  h.state.readExternal = true;
  await run({ ...h.args, brief: '另一项' }, { ...h.call, sessionId: 'second' });
  h.state.readExternal = false;
  h.state.known = false;
  await run({ ...h.args, brief: '第三项' }, { ...h.call, sessionId: 'third' });
  tickets = await h.board.list();
  assert.equal(tickets.find(t => t.goal === '另一项').readExternalContent, true);
  assert.equal(tickets.find(t => t.goal === '第三项').readExternalContent, true);
});

test('external 传递会话污点并翻译后端结果', async () => {
  const h = setup();
  const args = { ticket: 'T-20261117-123456-abcd' };
  const run = call => h.tools.dispatch_external.execute(args, {}, call);
  await assert.rejects(h.tools.dispatch_external.execute({ ticket: 'bad' }, {}, h.call), /工单号/);
  assert.match(await run(h.call), /确认卡/);
  assert.equal(h.calls.at(-1).readExternal, false);
  await run({ ...h.call, readExternal: true });
  assert.equal(h.calls.at(-1).readExternal, true);
  h.state.known = false;
  await run(h.call);
  assert.equal(h.calls.at(-1).readExternal, true);
  h.state.known = true;
  h.state.readExternal = true;
  await run(h.call);
  assert.equal(h.calls.at(-1).readExternal, true);
  h.deps.reply = { status: 200, data: { status: 'running', run: { worker: 'worker', runId: 'r' } } };
  assert.match(await run(h.call), /在跑/);
  h.deps.reply = { status: 201, data: { status: 'started', run: { worker: 'worker', runId: 'r' } } };
  assert.match(await run(h.call), /放权直接开工/);
  for (const [code, regex] of [['TAINTED', /只能转给主人/], ['BUSY', /不要自己换目录绕开/]]) {
    h.deps.reply = { status: code === 'BUSY' ? 409 : 403, data: { error: { code } } };
    await assert.rejects(run(h.call), regex);
  }
  h.deps.reply = { status: 403, data: { error: { reasons: [{ message: '不在白名单' }] } } };
  await assert.rejects(run(h.call), /不在白名单/);
  h.deps.reply = { status: 200, data: {} };
  await assert.rejects(run(h.call), /看不懂/);
  h.deps.dispatchClient.dispatch = async () => { throw Error('offline'); };
  await assert.rejects(run(h.call), /连不上/);
});

test('客户端限定回环，密钥只进请求头并验证文件权限', async () => {
  const h = setup();
  const file = path.join(h.dir, 'key');
  const secret = 'test-key-value';
  fs.writeFileSync(file, secret, { mode: 0o600 });
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, options });
    return { status: 202, json: async () => ({ status: 'awaiting_approval' }) };
  };
  const make = bff_url => createDispatchClient({ dispatch: { bff_url, bff_key_file: file } }, { fetchImpl });
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    assert.ok(make(`http://${host}:1234`));
  }
  for (const url of ['https://localhost', 'http://example.test', 'http://u:p@localhost', 'invalid']) {
    assert.equal(make(url), undefined);
  }
  assert.equal(createDispatchClient({}), undefined);
  const client = make('http://localhost:1234/base');
  const body = { ticket: 'T-20261117-123456-abcd', bot: 'bot', readExternal: false };
  await client.dispatch(body);
  assert.equal(seen[0].url, 'http://localhost:1234/dispatch/runs');
  assert.equal(seen[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(seen[0].options.body), body);
  assert.equal(seen[0].options.headers['x-hub-bff-key'], secret);
  assert.ok(!seen[0].url.includes(secret) && !seen[0].options.body.includes(secret));
  await client.run('a/b');
  assert.equal(seen[1].url, 'http://localhost:1234/dispatch/runs/a%2Fb');
  assert.equal(seen[1].options.method, 'GET');
  fs.chmodSync(file, 0o644);
  await assert.rejects(client.dispatch(body), error => !error.message.includes(secret));
});
