import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { startFakeBff } from './fake-bff.mjs';
import { checkContract } from '../ops/check-adapter-contract.mjs';
const require = createRequire(import.meta.url);
const { markdown, previewText, messageDate, friendlyError, eventParser, sortTimeline, surfaceEntries, toolText } = require('../hub-real.js');
const { environment } = require('./dom-double.cjs');

test('Markdown：标题、列表、粗体、代码、表格与安全链接', () => {
  const html = markdown('# 标题\n- **一**\n- `二`\n1. 三\n2. 四\n| 项目 | 状态 |\n| --- | --- |\n| 一 | 好 |\n```js\n<script>alert(1)</script>\n```\n[安全](https://example.com) [危险](javascript:alert)');
  for (const tag of ['h1','ul','ol','strong','code','pre','table']) assert(html.includes('<' + tag));
  assert(html.includes('rel="noopener noreferrer"')); assert(!html.includes('javascript:')); assert(!html.includes('<script>'));
});
test('Markdown：原始 HTML、属性注入、代码内链接均不可执行', () => {
  const html = markdown('<img src=x onerror=alert(1)>\n[x](https://x.test/"onclick="evil)\n`[x](javascript:evil)`\n**<svg/onload=evil>**');
  assert(!html.includes('<img')); assert(!html.includes('<svg')); assert(!html.includes('"onclick="')); assert(html.includes('&quot;')); assert(html.includes('<code>[x](javascript:evil)</code>'));
});
test('长回复：一万字局部 Markdown 可渲染', () => {
  const html = markdown('长文本'.repeat(4000)); assert(html.length > 12000);
});
test('会话预览：只留文字，不暴露 Markdown 记号', () => {
  assert.equal(previewText('## **首席助理**\n- `代码` [链接](https://example.com) ~~草稿~~'), '首席助理 代码 链接 草稿');
  assert.equal(previewText('![照片](https://example.com/a.png)\n> 说明'), '照片 说明');
});
test('真实日期：按消息时间，不为缺失或非法时间编日期', () => {
  assert.deepEqual(messageDate(new Date(2026, 10, 16, 9, 7).toISOString()), { day: '2026年11月16日', time: '09:07' });
  for (const ts of [undefined, null, '', 'invalid']) assert.equal(messageDate(ts), null);
});
test('连接故障：中文反馈不暴露上游原文，区分未发出与确认未知', () => {
  for (const context of ['send','history','reply']) {
    assert(!/BFF|unavailable|fetch|Error/.test(friendlyError(new Error('BFF unavailable'), context)));
  }
  assert.match(friendlyError({ definitelyUnsent:true }), /这句没发出去/);
  assert.match(friendlyError(new TypeError('Failed to fetch')), /这句没发出去/);
  assert.match(friendlyError({ status:409 }), /上一条还在回复/);
});
test('SSE：CRLF 分片、多行 data、心跳、state 替换与定稿', () => {
  const seen = [], parse = eventParser((event, data) => seen.push([event, data]));
  for (const part of [': 心跳\r', '\n\r\nevent: state\r\ndata: {"running":true,\r\ndata: "partial":"先"}\r\n\r', '\nevent: delta\ndata: {"text":"后"}\n\nevent: message\ndata: {"role":"assistant","text":"全文"}\n\nevent: done\ndata: {}\n\n']) parse(part);
  assert.deepEqual(seen.map(e => e[0]), ['state','delta','message','done']); assert.equal(seen[0][1].partial, '先');
});
test('SSE：超大无边界帧拒绝', () => { const parse = eventParser(() => {}); assert.throws(() => parse('a'.repeat(2000001))); });
test('样例隔离：非六助理发送在任何 fetch 之前拒绝', async () => {
  const env = environment(); let calls = 0; env.ctx.fetch = () => { calls++; throw Error('不得联网'); };
  vm.runInContext(await readFile(new URL('../hub-real.js', import.meta.url), 'utf8'), env.ctx);
  for (const bot of ['machine-steward','ledger-steward','board-steward','memory-steward','connect-steward','unknown']) assert.throws(() => env.ctx.HubReal.sendText(bot, '不得真发'), /样例隔离断言/);
  assert.equal(calls, 0);
});
test('契约缺项逐条报告，输入无接口时全部失败', () => { const checks = checkContract('</body>'); assert(checks.filter(c => !c.ok).length > 40); assert(checks.find(c => c.name === 'body 注入锚点').ok); });
test('离线 BFF：六助理、服务器历史、未读、非法助理与取消', async () => {
  const app = await startFakeBff(); const req = async (path, body) => { const res = await fetch(app.url + '/bff' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); return { status: res.status, data: await res.json() }; };
  try {
    assert.equal((await req('/sessions', { bot: 'machine-steward' })).status, 400);
    for (const bot of ['chief','support','content','pm','art','research']) { const result = await req('/sessions', { bot }); assert.equal(result.status, 201); assert.equal(result.data.bot, bot); }
    assert.equal((await req('/sessions')).data.sessions.length, 6);
    const id = (await req('/sessions?bot=chief')).data.sessions[0].id;
    assert.equal((await req('/sessions/' + id + '/messages', { text: '慢回复验证' })).status, 202);
    assert.equal((await req('/status')).data.bots.chief.running, true);
    assert.equal((await req('/sessions/' + id + '/cancel', {})).data.ok, true);
    assert.equal((await req('/status')).data.bots.chief.running, false);
    assert.equal((await req('/sessions/' + id + '/history')).data.messages[0].text, '慢回复验证');
    assert.equal((await req('/sessions/' + id + '/read', {})).data.ok, true);
  } finally { await app.close(); }
});

 test('有序列表跨段落保留起号与显式序号', () => {
  const html = markdown('3. 第三项\n4. 第四项\n\n说明\n\n5. 第五项\n8. 第八项');
  assert.match(html, /<ol start="3"><li value="3">第三项<\/li><li value="4">第四项/);
  assert.match(html, /<ol start="5"><li value="5">第五项<\/li><li value="8">第八项/);
 });

test('C4：空白步骤不产生回复；工具按稳定 id 去重并保留正文与拒绝', () => {
  const tool = {id:'call-1',name:'write',path:'notes/a.md',level:'L1',status:'running'};
  const entries = surfaceEntries([{role:'assistant',text:'  '},{role:'assistant',text:'',seq:2,tools:[tool]},
    {role:'assistant',text:'已整理',seq:4,tools:[{...tool,status:'ok'}]},{role:'tool',text:'原始工具输出不可直接展示'}]);
  assert.equal(entries.length,2); assert.equal(entries[0].kind,'tool'); assert.equal(entries[0].seq,2);
  assert.equal(entries[0].status,'ok'); assert.equal(entries[1].text,'已整理');
  assert.match(toolText(entries[0]),/L1 已记录/);
  assert.match(toolText({...tool,status:'denied',brief:'路径或工具不在本轮授权范围'}),/被拒：路径或工具不在本轮授权范围/);
  assert.match(toolText({...tool,status:'pending'},{status:'approved'}),/已批准/);
  assert.doesNotMatch(toolText({...tool,status:'pending'},{status:'approved'}),/已完成|已记录/);
  assert.match(toolText({...tool,status:'error',brief:'写入失败'},{status:'approved'}),/失败：写入失败/);
});
test('C4：无时间消息按统一 seq 穿插两张审批卡与派工卡，更新不移位', () => {
  const rows = [{id:'拒绝卡',seq:2,ts:'2026-11-17T12:00:00Z'},{id:'下一张卡',seq:6,ts:'2026-11-17T11:00:00Z'},
    {id:'回复',seq:3},{id:'追问',seq:4},{id:'答复',seq:5},{id:'派工卡',seq:7}];
  assert.deepEqual(sortTimeline(rows).map(m=>m.id),['拒绝卡','回复','追问','答复','下一张卡','派工卡']);
  rows[0].resolvedAt='2026-11-18T00:00:00Z';sortTimeline(rows);
  assert.equal(rows[0].id,'拒绝卡');
});
test('C4：时间轴统一用时间回退，同毫秒稳定排序；缺坐标不按零排序', () => {
  const rows=[{id:'卡',ts:200},{id:'消息',ts:100},{id:'同毫秒',ts:200}];
  assert.deepEqual(sortTimeline(rows).map(m=>m.id),['消息','卡','同毫秒']);
  const unknown=[{id:'旧消息'},{id:'卡',ts:100}];assert.deepEqual(sortTimeline(unknown),unknown);
  const live=[{id:'旧回复',seq:10},{id:'本地追问',timelineLocal:true,timelineAfterSeq:10},{id:'回复占位',timelineLocal:true},{id:'工具',seq:12},{id:'审批',seq:13}];
  assert.deepEqual(sortTimeline(live).map(m=>m.id),['旧回复','本地追问','工具','审批','回复占位']);
});

test('C5：审批动作按工具、区域和已有改动生成，不从预览编造目的', () => {
  const { approvalTitle } = require('../hub-real.js');
  const base={tool:'write',path:'/Users/example/dsh-work/shared/交付物.md',preview:'请替我改系统'};
  assert.equal(approvalTitle(base),'把一份文件写进共享区');
  assert.equal(approvalTitle({...base,diff:'- 旧\n+ 新'}),'改共享区里的一份文件');
  assert.equal(approvalTitle({...base,tool:'edit',path:'/Users/example/dsh-work/shared/项目日志.md'}),'改共享区里的项目日志');
  assert.equal(approvalTitle({tool:'ticket_update'}),'改别人建的工单');
  assert.equal(approvalTitle({tool:'ticket_move'}),'移动别人建的工单');
});
test('C5：只合并相邻工具，不跨正文、审批卡或用户回合，保留顺序和稳定工具 id', () => {
  const { toolRun } = require('../hub-real.js');
  const t=(id)=>({hubToolId:id,parts:[{data:{id,name:'read',status:'ok'}}]});
  const entries=[{role:'user'},t('a'),t('b'),t('c'),{parts:[{type:'hub-real-approval'}]},t('d'),{role:'user'},t('e'),{role:'bot',text:'正文'},t('f')];
  for(const id of ['a','b','c'])assert.deepEqual(toolRun(entries,id).map(t=>t.id),['a','b','c']);
  for(const id of ['d','e','f'])assert.deepEqual(toolRun(entries,id).map(t=>t.id),[id]);
  assert.deepEqual(toolRun(entries,'不存在'),[]);
  assert.match(toolText({name:'ticket_create',status:'ok',level:'L1'}),/建了一张工单/);
  assert.match(toolText({name:'write',path:'/Users/example/dsh-work/bots/chief/notes/x.md',status:'ok'}),/写了 notes\/x.md/);
});

test('C5：工具未完成前不用完成语态，批准与失败仍按实际状态显示', () => {
  for(const status of ['running','pending','approved','error','denied']) {
    assert.doesNotMatch(toolText({name:'write',path:'notes/x.md',status}),/写了/);
    assert.doesNotMatch(toolText({name:'ticket_create',status}),/建了一张/);
  }
});
