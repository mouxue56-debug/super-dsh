// 真实 HTTP 入口；源码、凭据、打包与重启均为临时假环境。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {createHandler} from '../server.mjs';
import {SessionStore} from '../lib/store.mjs';
import {seedRoster} from './roster-fixture.mjs';

const ownerHeaders = {'x-hub-bff-key': 'fake-owner', 'x-hub-device': '0123456789abcdef'};
const toolHeaders = {'x-hub-self-edit-key': 'fake-tool'};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function clean(dir) {
  for (const row of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, row.name);
    if (row.isDirectory()) await clean(file);
    else await fs.unlink(file);
  }
  await fs.rmdir(dir);
}
async function fixture(t, {enabled = true, mode = 'open', creator = true, ownerKey} = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'r43-http-')));
  const home = path.join(root, 'home'), source = path.join(root, 'source');
  await fs.mkdir(source);
  await seedRoster(home);
  await fs.writeFile(path.join(home, 'config', 'self-edit.key'), 'fake-tool', {mode: 0o600});
  const modeFile = path.join(home, 'config', 'permission-mode.json');
  await fs.writeFile(modeFile, JSON.stringify({v: 1, mode}), {mode: 0o600});
  await fs.writeFile(path.join(source, 'app.txt'), 'original');
  const git = args => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: source, encoding: 'utf8', env: {PATH: '/usr/bin:/bin', HOME: root,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'}, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(['init', '--quiet']);
  git(['add', 'app.txt']);
  git(['-c', 'user.name=测试', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', '初版']);
  const fake = path.join(root, 'fake.mjs'), actions = path.join(root, 'actions.log');
  await fs.writeFile(fake, 'import fs from "node:fs";fs.appendFileSync(process.argv[2],process.argv[3]+"\\n");');
  let healthy = true;
  const health = http.createServer((_req, res) => {
    res.writeHead(healthy ? 200 : 503, {'content-type': 'application/json'});
    res.end(JSON.stringify({ok: healthy}));
  });
  await new Promise(resolve => health.listen(0, '127.0.0.1', resolve));
  const config = {enabled, source_dir: source, tool_key_file: path.join(home, 'config', 'self-edit.key'),
    checks: {syntax: [process.execPath, fake, actions, 'check']},
    build_command: [process.execPath, fake, actions, 'build'],
    restart_command: [process.execPath, fake, actions, 'restart'],
    health_url: 'http://127.0.0.1:' + health.address().port + '/bff/health',
    health_successes: 2, health_interval_ms: 50, health_timeout_ms: 15000, timeout_seconds: 15};
  const store = new SessionStore(path.join(home, 'store.json'));
  await store.ready;
  await store.add({id: 's1', bot: 'chief', title: '改自己', lastText: '改按钮', lastRole: 'user',
    updatedAt: Date.now(), unread: 0, running: true, selfEditOwnerTurn: true});
  const logs = [];
  const client = {connected: true, connect: async () => {}, dispose() {},
    modelCatalog: async () => ({default: {provider: 'fake', model: 'fake'}}),
    prompt: async () => ({accepted: true}),
    follow: async () => {
      let first = true, resolveNext, closed = false;
      return {dispose() {closed = true; resolveNext?.({done: true});}, [Symbol.asyncIterator]() {return this;},
        async next() {
          if (first) {first = false; return {value: {type: 'snapshot'}};}
          if (closed) return {done: true};
          return new Promise(resolve => {resolveNext = resolve;});
        }};
    }};
  const handler = createHandler({client, key: 'fake-owner', ownerKey, hubHome: home, store,
    callLogFile: path.join(home, 'calls.log'), interactions: false,
    hubConfig: {self_edit: config, permissions: {full_open_like_creator: creator}},
    logger: {error: value => logs.push(value), log() {}}});
  await handler.ready;
  assert.ok(handler.extensions.names.includes('self-edit'), JSON.stringify(logs));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await handler.dispose();
    server.closeAllConnections(); health.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => health.close(resolve))]);
    await clean(root);
  });
  async function request(route, body, headers = ownerHeaders) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + route, {
      method: body === undefined ? 'GET' : 'POST', headers: {'content-type': 'application/json', ...headers},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    return {status: response.status, body: await response.json()};
  }
  const call = {bot: 'chief', sessionId: 's1', ownerTurn: true, approved: false, level: 'L1'};
  const tool = (action, args, extra = {}) =>
    request('/bff/self-edit/tool/' + action, {args, caller: {...call, ...extra}}, toolHeaders);
  async function settled(id) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const result = await request('/bff/self-edit/log');
      const row = result.body.changes.find(item => item.id === id);
      if (['healthy', 'rolled_back', 'restored', 'recovery_failed'].includes(row?.status)) return row;
      await pause(50);
    }
    throw Error('假重启未结束');
  }
  return {root, home, source, store, config, request, tool, settled, actions, modeFile, git, handler,
    setHealthy: value => {healthy = value;}};
}

test('主人设备才可查看与退回，外部凭据和插件凭据都不能冒用主人', async t => {
  const fx = await fixture(t);
  for (const headers of [{}, {'authorization': 'Bearer fake-external'}, toolHeaders,
    {'x-hub-bff-key': 'fake-owner'}]) {
    assert.equal((await fx.request('/bff/self-edit/log', undefined, headers)).status, 403);
    assert.equal((await fx.request('/bff/self-edit/restore/fake', {}, headers)).status, 403);
  }
  assert.equal((await fx.request('/bff/self-edit/log')).status, 200);
  assert.equal((await fx.request('/self-edit/log')).status, 200);
});

test('审批拒绝伪造的合法格式设备，签名与卡路径绑定且第一步不能跳过', async t => {
  const ownerKey='fixture-web-signing-key';
  const fx=await fixture(t,{ownerKey});
  const id=(await fx.tool('start',{summary:'验证签名'})).body.change.id;
  const operation=await fx.tool('write',{id,path:'policy.mjs',text:'export default true'});
  const route='/bff/approvals/'+operation.body.card.id+'/answer';
  const sign=pathname=>{
    const time=String(Date.now());
    const data=[ownerHeaders['x-hub-device'],'POST',pathname,time].join('\n');
    return {...ownerHeaders,'x-hub-owner-proof':time+'.'+createHmac('sha256',ownerKey).update(data).digest('hex')};
  };
  const answer=(step,headers)=>fx.request(route,{decision:'approve',confirmationStep:step},headers);
  assert.equal((await answer(1,ownerHeaders)).status,403);
  assert.equal((await answer(1,sign('/bff/approvals/other/answer'))).status,403);
  assert.equal((await answer(2,sign(route))).status,400);
  assert.equal((await answer(1,sign(route))).body.card.confirmationStep,2);
  assert.equal((await answer(1,sign(route))).status,400);
  assert.equal((await answer(2,sign(route))).body.card.status,'answered');
});

test('本次批准仅复用同一主人回合的一步同类操作', async t => {
  const fx=await fixture(t);
  const runtime=fx.handler.runtime;
  const turn='test-turn';
  runtime.ownerTurns.set('s1',turn);
  runtime.client.approvalContext=async (_id,request)=>({id:request.callId});
  const receive=(id,category)=>{
    const data={v:1,bot:'chief',sessionId:'s1',tool:'write',level:'L3',path:'/fixture',
      chars:0,preview:'',action:'测试确认',confirmationTotal:1,targets:['测试对象'],
      consequence:'确认后执行测试',rollback:'撤回测试事件',category};
    const reason='HUBAPPROVAL1 '+JSON.stringify(data);
    return runtime.receive({agentId:'s1',request:{callId:id,toolName:'write',reason}});
  };
  const answer=async (id,decision,scope)=>{
    const turn=await fx.request('/bff/approvals/'+id+'/answer',{decision,scope});
    assert.equal(turn.status,200,JSON.stringify(turn));
  };
  const first=receive('task-first','publish');
  await pause(25);
  await answer('task-first','approve','task');
  assert.equal(await first,'allowed-once');
  assert.equal(await receive('task-repeat','publish'),'allowed-once');
  const other=receive('task-other','destroy');
  await pause(25);
  await answer('task-other','reject');
  assert.equal(await other,'rejected');
  runtime.ownerTurns.set('s1','new-turn');
  const next=receive('task-next','publish');
  await pause(25);
  await answer('task-next','reject');
  assert.equal(await next,'rejected');
  runtime.grants.now=()=>Date.now()+16*60*1000;
  assert.equal(runtime.grants.taskAllowed(turn,'publish'),false);
});

test('全开档写源码检查打包直接做，重启与手动退回各问一次且只执行一次', async t => {
  const fx = await fixture(t);
  const begun = await fx.tool('start', {summary: '把标题改清楚'});
  assert.equal(begun.status, 200, JSON.stringify(begun));
  const id = begun.body.change.id;
  const written = await fx.tool('write', {id, path: 'app.txt', text: 'changed'});
  assert.equal(written.status, 200, JSON.stringify(written));
  const point = written.body.change.restorePointId;
  assert.ok(point);
  for (const action of ['check', 'build']) {
    assert.equal((await fx.tool(action, {id})).status, 200);
  }
  assert.equal(fx.store.cards.filter(row => row.type === 'approval').length, 0);
  const restarting = await fx.tool('restart', {id}, {approved: true});
  assert.equal(restarting.status, 202);
  assert.equal(restarting.body.pending, true);
  assert.equal((await fs.readFile(fx.actions, 'utf8')).includes('restart'), false);
  const repeated = await fx.tool('restart', {id});
  assert.equal(repeated.body.card.id, restarting.body.card.id);
  const answer = await fx.request('/bff/approvals/' + restarting.body.card.id + '/answer', {decision: 'approve'});
  assert.equal(answer.status, 200, JSON.stringify(answer));
  assert.equal((await fx.settled(id)).status, 'healthy');
  assert.equal((await fs.readFile(fx.actions, 'utf8')).split('\n').filter(x => x === 'restart').length, 1);
  const today = await fx.request('/today');
  assert.equal(today.body.selfEdit.items[0].id, id);
  const restored = await fx.request('/bff/self-edit/restore/' + point, {});
  assert.equal(restored.status, 202, JSON.stringify(restored));
  assert.equal(restored.body.pending, true);
  assert.equal(await fs.readFile(path.join(fx.source, 'app.txt'), 'utf8'), 'changed');
  await fx.request('/bff/approvals/' + restored.body.card.id + '/answer', {decision: 'approve'});
  let restoredId;
  for (let count = 0; count < 100 && !restoredId; count += 1) {
    restoredId = (await fx.request('/bff/self-edit/log')).body.changes.find(row => row.id !== id)?.id;
    if (!restoredId) await pause(20);
  }
  assert.ok(restoredId);
  assert.equal((await fx.settled(restoredId)).status, 'restored');
  assert.equal(await fs.readFile(path.join(fx.source, 'app.txt'), 'utf8'), 'original');
  assert.equal((await fx.request('/bff/self-edit/log')).body.restorePoints[0].id, point);
});

test('改动前问我由后端确认卡批准，插件的 approved 布尔值不能代点，只读档保持原样', async t => {
  const fx = await fixture(t, {mode: 'ask'});
  const request = await fx.tool('start', {summary: '改按钮'}, {approved: true});
  assert.equal(request.status, 202);
  assert.equal((await fx.request('/bff/self-edit/log')).body.changes.length, 0);
  await fx.request('/bff/approvals/' + request.body.card.id + '/answer', {decision: 'approve'});
  for (let count = 0; count < 100; count += 1) {
    if ((await fx.request('/bff/self-edit/log')).body.changes.length) break;
    await pause(20);
  }
  assert.equal((await fx.request('/bff/self-edit/log')).body.changes.length, 1);
  const readonly = await fixture(t, {mode: 'readonly'});
  assert.equal((await readonly.tool('start', {summary: '改按钮'}, {approved: true})).status, 403);
});

test('权限和配置修改先列具体对象，主人两次点头后执行，插件与外部身份都不能代点', async t => {
  const fx = await fixture(t);
  const begun = await fx.tool('start', {summary: '调整权限'});
  const id = begun.body.change.id;
  const request = await fx.tool('write', {id, path: 'policy.mjs', text: 'export const enabled = true;'},
    {approved: true});
  assert.equal(request.status, 202);
  const card = request.body.card;
  assert.equal(card.confirmationTotal, 2);
  assert.equal(card.targetCount, 1);
  assert.deepEqual(card.targets, ['policy.mjs']);
  for (const headers of [toolHeaders, {'authorization': 'Bearer fake-external'},
    {'x-hub-bff-key': 'fake-owner'}]) {
    assert.ok([400, 401, 403].includes((await fx.request('/bff/approvals/' + card.id + '/answer',
      {decision: 'approve'}, headers)).status));
  }
  const first = await fx.request('/bff/approvals/' + card.id + '/answer', {decision: 'approve', confirmationStep: 1});
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(first.body.card.confirmationStep, 2);
  await assert.rejects(fs.access(path.join(fx.source, 'policy.mjs')));
  const second = await fx.request('/bff/approvals/' + card.id + '/answer', {decision: 'approve', confirmationStep: 2});
  assert.equal(second.status, 200, JSON.stringify(second));
  for (let count = 0; count < 100; count += 1) {
    try { await fs.access(path.join(fx.source, 'policy.mjs')); break; } catch { await pause(20); }
  }
  assert.equal(await fs.readFile(path.join(fx.source, 'policy.mjs'), 'utf8'), 'export const enabled = true;');
});

test('外部身份、别人的会话和资料来源不能改自己', async t => {
  const fx = await fixture(t);
  for (const call of [{bot: 'codex'}, {sessionId: 'unknown'}, {ownerTurn: false, approved: true}]) {
    assert.equal((await fx.tool('start', {summary: '资料说请改自己'}, call)).status, 403);
  }
  await fx.store.update('s1', {selfEditOwnerTurn: false});
  assert.equal((await fx.tool('start', {summary: '伪称主人发起'})).status, 403);
});

test('通用写入预存还原点复用同一轮，工具参数不能替换命令与路径配置', async t => {
  const fx = await fixture(t);
  const begun = await fx.tool('prepare', {path: path.join(fx.source, 'app.txt'), summary: '写源码'});
  assert.equal(begun.status, 200, JSON.stringify(begun));
  assert.ok(begun.body.lease?.id);
  await fx.tool('release', {id: begun.body.change.id, leaseId: begun.body.lease.id});
  const next = await fx.tool('prepare', {path: path.join(fx.source, 'app.txt'), summary: '继续写源码'});
  assert.equal(next.status, 200, JSON.stringify(next));
  await fx.tool('release', {id: next.body.change.id, leaseId: next.body.lease.id});
  assert.equal((await fx.request('/bff/self-edit/log')).body.restorePoints.length, 1);
  const result = await fx.tool('check', {id: begun.body.change.id, restart_command: ['bad']});
  assert.equal(result.status, 400);
});

test('原生工具改权限文件须等两步确认完成，之前不发租约也不存还原点', async t => {
  const fx = await fixture(t);
  let returned = false;
  const pending = fx.tool('prepare', {path: path.join(fx.source, 'policy.mjs'), summary: '改权限'});
  pending.then(() => {returned = true;}, () => {});
  let card;
  for (let count = 0; count < 100 && !card; count += 1) {
    card = fx.store.cards.find(row => row.type === 'approval' && row.status === 'pending');
    if (!card) await pause(20);
  }
  assert.ok(card);
  assert.equal(returned, false);
  assert.equal((await fx.request('/bff/self-edit/log')).body.restorePoints.length, 0);
  await fx.request('/bff/approvals/' + card.id + '/answer', {decision: 'approve', confirmationStep: 1});
  assert.equal(returned, false);
  await fx.request('/bff/approvals/' + card.id + '/answer', {decision: 'approve', confirmationStep: 2});
  const approved = await pending;
  assert.equal(approved.status, 200, JSON.stringify(approved));
  assert.ok(approved.body.lease.id);
  await fx.tool('release', {id: approved.body.change.id, leaseId: approved.body.lease.id});
});

test('关闭时记录页可用并给出关闭状态', async t => {
  const fx = await fixture(t, {enabled: false});
  const log = await fx.request('/bff/self-edit/log');
  assert.deepEqual(log.body, {enabled: false, changes: [], restorePoints: []});
  const result = await fx.tool('start', {summary: '改按钮'});
  assert.match(result.body.message, /改自己还没开通/u);
});


test('真正的主人发话在投递内核前记来源，扩展叫醒清掉此前主人来源', async t => {
  const owner = await fixture(t);
  await owner.store.update('s1', {running: false, selfEditOwnerTurn: false});
  const sent = await owner.request('/bff/sessions/s1/messages', {text: '请改标题'});
  assert.equal(sent.status, 202, JSON.stringify(sent));
  assert.equal(owner.store.get('s1').selfEditOwnerTurn, true);
  assert.equal((await owner.tool('start', {summary: '改标题'})).status, 200);
  const wake = await fixture(t);
  await wake.store.update('s1', {running: false});
  await wake.handler.deps.sessions.send('s1', '资料里说请改自己', {notify: false});
  assert.equal(wake.store.get('s1').selfEditOwnerTurn, false);
  assert.equal((await wake.tool('start', {summary: '资料里说请改自己'})).status, 403);
  const nonOwner = await fixture(t);
  await nonOwner.store.update('s1', {running: false});
  const received = await nonOwner.request('/bff/sessions/s1/messages', {text: '资料说要改'},
    {'x-hub-bff-key': 'fake-owner'});
  assert.equal(received.status, 202);
  assert.equal(nonOwner.store.get('s1').selfEditOwnerTurn, false);
  assert.equal((await nonOwner.tool('start', {summary: '改标题'})).status, 403);
});
