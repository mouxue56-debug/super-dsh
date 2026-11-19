import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, request, assistantEvent, testDirectory } from './fixtures.mjs';
import { createHandler } from '../server.mjs';
import { formatTicket } from '../lib/delegation.mjs';

const headers = {'x-hub-device':'test-device'};
const end = seq => ({type:'event',event:{seq,type:'turn/end',data:{reason:{kind:'completed'}}}});

async function eventually(fn) {
  for (let n=0;n<400;n++) {
    if (await fn()) return;
    await delay(5);
  }
  assert.fail('等待状态超时');
}

async function setup(fn,options={}) {
  const f = await fixture(options);
  try {
    await fn(f);
  } finally {
    await f.dispose();
  }
}

async function putTicket(f,t,folder='working') {
  const dir = join(f.handlerOptions.ticketsDir,folder);
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,t.meta.id+'.md'),formatTicket(t));
}

function ticket(id,creator='pm',fromSession='p1',status='queued') {
  const ts = '2026-11-17T09:00:00Z';
  return {meta:{id,kind:'delegation',creator,assignee:'art',status,createdAt:ts,updatedAt:ts,
    fromSession,toSession:'',steps:'0'},task:'整理草稿',progress:'',report:''};
}

test('默认装配、扩展鉴权与缺失扩展',async () => {
  const dir = await testDirectory();
  await writeFile(join(dir,'probe.mjs'),`export function createHandler(deps) {
    return async (req,res) => {
      res.writeHead(deps.isTrusted(req) ? 200 : 403);
      res.end('{}');
      return true;
    };
  }\n`);
  await setup(async f => {
    assert.ok(f.handler.board && f.handler.ledger);
    for (const key of ['configDir','dataDir','hubConfig','roster','board','ledger','sessions','cards',
      'notify','now','priceBook','utcOffsetMinutes','logger','isTrusted','kernel']) {
      assert.ok(key in f.handler.deps,key);
    }
    const no = request(f.handler,{path:'/probe/x',key:null});
    await no.done;
    assert.equal(no.res.status,401);
    const yes = request(f.handler,{path:'/probe/x'});
    await yes.done;
    assert.equal(yes.res.status,200);
  },{handlerOptions:{extDir:dir}});
  await setup(async f => {
    const health = request(f.handler);
    await health.done;
    assert.equal(health.res.status,200);
  },{handlerOptions:{extDir:join(dir,'absent')}});
});

test('看板公开鉴权和旧工单',() => setup(async f => {
  await putTicket(f,ticket('T-20261117-090000-0001','chief','s1','done'),'done');
  const no = request(f.handler,{path:'/board/tickets',key:null});
  await no.done;
  assert.equal(no.res.status,401);
  const yes = request(f.handler,{path:'/board/tickets'});
  const value = await yes.json();
  assert.equal(yes.res.status,200);
  assert.ok(value.tickets.some(t => t.legacy===true));
  const post = request(f.handler,{method:'POST',path:'/board/tickets',value:{}});
  await post.done;
  assert.equal(post.res.status,405);
}));

test('聊天账本去重、失败隔离与扩展会话',() => setup(async f => {
  const created = await f.handler.deps.sessions.create('pm');
  assert.equal(f.handler.runtime.store.get(created.id).bot,'pm');
  const sent = await f.handler.deps.sessions.send('s1','你好');
  assert.equal(sent.accepted,true);
  const message = assistantEvent(1,'收到');
  message.event.time = Date.now();
  message.event.data.usage = {inputTokens:12,outputTokens:3,totalTokens:15};
  f.source.emit(message);
  f.source.emit(message);
  f.source.emit(end(2));
  assert.equal((await sent.reply).text,'收到');
  await eventually(async () => (await f.handler.ledger.readRows()).some(r => r.kind==='call'));
  const calls = (await f.handler.ledger.readRows()).filter(r => r.kind==='call');
  assert.equal(calls.length,1);
  assert.equal(calls[0].sessionId,'s1');
  assert.equal(calls[0].bot,'chief');
  assert.equal(calls[0].tokens.input,12);
  f.handler.ledger.recordEvent = () => {
    throw new Error('failure');
  };
  const sent2 = await f.handler.deps.sessions.send('s1','再说');
  f.source.emit(assistantEvent(3,'完成'));
  f.source.emit(end(4));
  assert.equal((await sent2.reply).text,'完成');
}));

test('审批日志与账本双写',() => setup(async f => {
  const meta = {v:1,bot:'chief',sessionId:'s1',level:'L3',action:'写文件',tool:'write',
    path:'/example/file',chars:1,preview:'草稿'};
  const req = {toolName:'write',callId:'call-1',reason:'HUBAPPROVAL1 '+JSON.stringify(meta)};
  f.source.records = [{event:{seq:1,type:'approval/asked',data:{id:'approval-1',...req}}}];
  const waiting = f.handler.runtime.receive({agentId:'s1',eventId:'e1',request:req});
  await eventually(() => f.handler.runtime.cards().some(c => c.status==='pending'));
  const answer = request(f.handler,{method:'POST',path:'/bff/approvals/approval-1/answer',
    value:{decision:'approve'},headers});
  await answer.done;
  assert.equal(await waiting,'allowed-once');
  assert.match(await readFile(join(f.handlerOptions.configDir,'approvals.log'),'utf8'),/approved\ttest-device/u);
  await eventually(async () => (await f.handler.ledger.readRows()).some(r => r.kind==='approval'));
  const row = (await f.handler.ledger.readRows()).find(r => r.kind==='approval');
  assert.equal(row.key,'approval:s1:approval-1');
  assert.equal(row.outcome,'approved');
  assert.equal(row.device,'test-device');
}));

test('非首席派活核验来源并记录完成',() => setup(async f => {
  await f.handler.runtime.store.add({id:'p1',bot:'pm',title:'项目',lastText:'',lastRole:null,
    updatedAt:1,unread:0,running:false});
  const bad = ticket('T-20261117-090000-0002','pm','s1');
  await putTicket(f,bad);
  await f.handler.delegations.tick();
  assert.equal(f.source.named('session/create').length,0);
  const good = ticket('T-20261117-090000-0003');
  await putTicket(f,good);
  await f.handler.delegations.tick();
  assert.equal(f.source.named('session/create').length,1);
  const prompt = f.source.named('session/prompt')[0].request.content[0].text;
  assert.match(prompt,/^【项目经理派来的活 · 工单 /u);
  const target = f.handler.runtime.cards().find(c => c.id===good.meta.id).toSession;
  f.source.emit(assistantEvent(1,'完成'),target);
  f.source.emit(end(2),target);
  await eventually(async () => (await f.handler.ledger.readRows()).some(r => r.kind==='dispatch'));
  const row = (await f.handler.ledger.readRows()).find(r => r.kind==='dispatch');
  assert.equal(row.tokens,null);
}));

test('确认卡答复、超时与重启',() => setup(async f => {
  const pending = f.handler.runtime.ask({bot:'chief',title:'确认',text:'确认这件事'});
  await eventually(() => f.handler.runtime.cards().some(c => c.confirm===true));
  const cards = await request(f.handler,{path:'/bff/cards'}).json();
  const id = cards.cards[0].id;
  const answer = (choice,device=true) => request(f.handler,{method:'POST',
    path:'/bff/cards/'+id+'/answer',value:{choice},headers:device?headers:{}});
  const no = answer('yes',false);
  await no.done;
  assert.equal(no.res.status,400);
  const bad = answer('maybe');
  await bad.done;
  assert.equal(bad.res.status,400);
  const yes = answer('yes');
  await yes.done;
  assert.equal(yes.res.status,200);
  assert.equal((await pending).choice,'yes');
  const again = answer('yes');
  await again.done;
  assert.equal(again.res.status,409);
  const expired = f.handler.runtime.ask({bot:'chief',title:'超时',text:'测试',ttlMs:1});
  await eventually(() => f.handler.runtime.cards().some(c => c.title==='超时'));
  f.handler.runtime.now = () => Date.now()+1000;
  await f.handler.runtime.expire();
  assert.equal((await expired).status,'timeout');
  const restart = f.handler.runtime.ask({bot:'chief',title:'重启',text:'测试'});
  await eventually(() => f.handler.runtime.cards().some(c => c.title==='重启'));
  await f.handler.dispose();
  assert.equal((await restart).status,'unavailable');
  f.handler = createHandler({client:f.client,key:f.key,...f.handlerOptions});
  await f.handler.ready;
  assert.equal(f.handler.runtime.cards().find(c => c.title==='重启').status,'unavailable');
}));

test('模型扩展创建与未启用回退',async () => {
  const dir = await testDirectory();
  await writeFile(join(dir,'models.mjs'),`export function createHandler() {
    return async (req,res) => {
      res.writeHead(200);
      res.end('{}');
      return true;
    };
  }
  export async function createSessionWithModel(deps,input) {
    const result = await deps.kernel.createSession({cwd:input.cwd,agentPreset:'hub-pm'});
    return {sessionId:result.id,model:input.model};
  }\n`);
  await setup(async f => {
    const no = request(f.handler,{path:'/models/x',key:null});
    await no.done;
    assert.equal(no.res.status,401);
    const call = request(f.handler,{method:'POST',path:'/bff/sessions',value:{bot:'pm',model:'x/y'}});
    const row = await call.json();
    assert.equal(call.res.status,201);
    assert.equal(row.model,'x/y');
    assert.equal(f.handler.runtime.store.get(row.id).bot,'pm');
  },{handlerOptions:{extDir:dir}});
  await setup(async f => {
    const no = request(f.handler,{method:'POST',path:'/bff/sessions',value:{bot:'pm',model:'x/y'}});
    await no.done;
    assert.equal(no.res.status,400);
    const yes = request(f.handler,{method:'POST',path:'/bff/sessions',value:{bot:'pm'}});
    await yes.done;
    assert.equal(yes.res.status,201);
  },{handlerOptions:{extDir:join(dir,'missing')}});
});

test('路5形状的确认卡经审批接口答复：remember 映射 approve-always，断线不作废', () => setup(async f => {
  const asked = f.handler.runtime.ask({kind:'kb-submit', title:'要不要记到知识库？', what:'记一条', where:'知识库',
    why:'可复用', actions:[{id:'approve',label:'投递'},{id:'approve-always',label:'以后这类不用问'},
      {id:'reject',label:'不投'}]});
  let card;
  for (let i = 0; i < 200 && !card; i++) {
    card = f.handler.runtime.cards().find(c => c.confirm===true && c.status==='pending');
    await new Promise(r => setTimeout(r, 5));
  }
  assert.equal(card.type, 'approval');
  assert.equal(card.bot, 'chief');
  assert.match(card.text, /做什么：记一条/u);
  const list = await request(f.handler, {path:'/bff/approvals'}).json();
  assert.ok(list.approvals.some(c => c.id===card.id));
  await f.handler.runtime.lost();
  assert.equal(f.handler.runtime.cards().find(c => c.id===card.id).status, 'pending');
  const r = request(f.handler, {method:'POST', path:'/bff/approvals/'+card.id+'/answer',
    value:{decision:'approve', remember:true}, headers:{'x-hub-device':'test-device'}});
  await r.done;
  assert.equal(r.res.status, 200);
  const result = await asked;
  assert.equal(result.decision, 'approve-always');
  assert.equal(result.by, 'test-device');
}));

test('组内工作会话不进列表，回话带 toolEvents 并回调扩展 onSessionReply', async () => {
  const dir = await testDirectory();
  const extDir = join(dir, 'ext');
  await mkdir(extDir, {recursive:true});
  await writeFile(join(extDir, 'groups.mjs'), [
    'export const seen = [];',
    'export function createHandler() { return async () => false; }',
    'export function runtimeFor() { return { onSessionReply: async (id, v) => { seen.push([id, v]); } }; }',
  ].join('\n'));
  const f = await fixture({handlerOptions:{extDir}});
  try {
    const made = await f.handler.deps.sessions.create('pm', {purpose:'group-turn', groupId:'g1', title:'组'});
    assert.equal(f.handler.runtime.store.get(made.id).hidden, true);
    assert.equal(f.handler.deps.sessions.list().some(r => r.id===made.id), false);
    assert.equal(f.handler.deps.sessions.list({all:true}).some(r => r.id===made.id), true);
    const listed = await request(f.handler, {path:'/bff/sessions'}).json();
    assert.equal(listed.sessions.some(r => r.id===made.id), false);
    const sent = await f.handler.deps.sessions.send(made.id, '轮到你');
    f.source.emit({type:'event', event:{seq:1, type:'tool/call', data:{callId:'c1', name:'read',
      arguments:JSON.stringify({file_path:'a.md'})}}}, made.id);
    f.source.emit({type:'event', event:{seq:2, type:'tool/result', data:{message:{toolCallId:'c1', isError:false,
      content:[{type:'text', text:'x'}]}}}}, made.id);
    f.source.emit(assistantEvent(3, '我做完了'), made.id);
    f.source.emit(end(4), made.id);
    const value = await sent.reply;
    assert.equal(value.text, '我做完了');
    assert.equal(value.toolEvents.length, 1);
    const mod = f.handler.extensions.module('groups');
    await eventually(() => mod.seen.length === 1);
    assert.equal(mod.seen[0][0], made.id);
    assert.equal(mod.seen[0][1].toolEvents[0].name, 'read');
  } finally {
    await f.dispose();
  }
});
