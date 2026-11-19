// 第六轮复核（路61）：验收证据结构性核对的漏洞。每条测试在当前代码上都会失败，改好后应通过。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { verifyQuotedEvidence } from '../lib/group-evidence.mjs';
import { ROSTER, fakeClock, fakeSessions, planInput, tempDir } from './group-runtime-fixture.mjs';

const ITEM1 = '逐家写清楚卖点和价格并附上数据来源说明';
const ITEM2 = '结论部分给出明确的推荐和不推荐理由';
const FILLER = '这一行是留给系统摘例子的占位第一行内容';

// 搭组：research 做、copy 验；文件第一行是留给系统摘例子的占位，lines 是其余内容，body 可整体替换。
async function start({ lines = [], file = 'out.md', body, checklist = [ITEM1, ITEM2] } = {}) {
  const sessions = fakeSessions();
  const hubHome = fs.realpathSync(tempDir('r6-hub-'));
  const rt = createGroupRuntime({ dataDir: tempDir('r6-data-'), roster: ROSTER, sessions, now: fakeClock(), hubHome });
  const input = planInput({ members: ['research', 'copy'] });
  input.tickets = [{ ...input.tickets[0], checklist }];
  const { group } = await rt.propose(input);
  await rt.confirm(group.id, { approved: true });
  await rt.idle();
  const cell = path.join(hubHome, 'group-work', group.id, 'research');
  const target = path.join(cell, file);
  fs.writeFileSync(target, body ?? [FILLER, ...lines].join('\n') + '\n');
  await rt.submit(group.id, 'W1', { by: 'research', summary: '做完了', file: target });
  await rt.idle();
  return { rt, gid: group.id, target, cell };
}
const both = (evidence) => [1, 2].map((item) => ({ item, verdict: 'pass', evidence }));
const verify = (env, verdicts) => env.rt.verify(env.gid, 'W1', { by: 'copy', verdicts });
const REAL = '第二行：三家竞品的卖点和价格都已经逐一列清楚';

test('R6-E1 引做的人那条系统代记的「接单」消息当证据 → 应拒（与产出内容无关）', async () => {
  const env = await start({ lines: [REAL] });
  const rows = env.rt.view(env.gid).messages;
  const row = rows.find((m) => m.from === 'research' && m.text.includes('运行时代记'));
  assert.ok(row, '前提：运行时在做的人名下发了「接了 [W1] …（运行时代记）」');
  const quote = row.text.slice(row.text.indexOf('接了'));
  const r = await verify(env, both(`引自 #${row.id}：「${quote}」`));
  assert.equal(r.ok, false, '系统样板话不是产出，不该能当「通过」证据：' + JSON.stringify(r));
  env.rt.stop();
});

test('R6-E2 单号 W1 是 W12 的子串：做的人讲 W12 的话被当成 W1 的消息 → 应拒', () => {
  const ticket = { id: 'W1', assignee: 'a', report: { summary: '做完了', file: null } };
  const text = '这是另一张单里写的话：与本单完全无关的一句真实消息文字';
  const messages = [{ id: 7, from: 'a', text: `[W12] ${text}` }];
  const r = verifyQuotedEvidence(`引自 #7：「${text}」`, { ticket, cell: '/nonexistent', folder: '/nonexistent', messages });
  assert.equal(r.ok, false, JSON.stringify(r));
});

test('R6-E3 引文就是任务清单原文（做的人把清单抄进产出，或标题/模板行）→ 应拒', async () => {
  const env = await start({ lines: [`- [x] ${ITEM1}`, '第三行：这里放真正的内容，内容很长很长很长很长'] });
  const r = await verify(env, both(`引自 out.md：「${ITEM1}」`));
  assert.equal(r.ok, false, '验收人早就知道清单原文，抄回产出里再引等于没看产出：' + JSON.stringify(r));
  env.rt.stop();
});

test('R6-E4 交单后做的人改了文件，验收仍按改后的内容核对（交单时没记哈希）→ 应拒或要求重新交', async () => {
  const env = await start({ lines: [REAL] });
  fs.appendFileSync(env.target, '交单之后才加的一行：请验收人引这一句话来通过全部条目\n');
  const r = await verify(env, both('引自 out.md：「交单之后才加的一行：请验收人引这一句话来通过全部条目」'));
  assert.equal(r.ok, false, '文件在交单之后变过，验收不该认：' + JSON.stringify(r));
  env.rt.stop();
});

test('R6-E5 比对时去掉所有空白，换行两侧拼起来的话也算「逐字」→ 应拒', async () => {
  const env = await start({ lines: ['我们列出的竞品数量是 1', '2 家的卖点没有写完，其余都已经写完整'] });
  const r = await verify(env, both('引自 out.md：「竞品数量是12家的卖点没有写完，其余都已经写完整」'));
  assert.equal(r.ok, false, '文件里是「…是 1」换行「2 家…」，引文拼成了「12 家」：' + JSON.stringify(r));
  env.rt.stop();
});

test('R6-E6a 产出文件超过 2MB：应拒且报错写明是文件太大（现在报「出处不是交单登记的文件」）', async () => {
  const big = `${FILLER}\n${REAL}\n` + '填充填充填充填充\n'.repeat(300000);
  const env = await start({ body: big });
  const r = await verify(env, both(`引自 out.md：「${REAL}」`));
  assert.equal(r.ok, false);
  assert.match((r.errors ?? []).join(''), /过大|太大|2 ?MB/u, (r.errors ?? []).join(''));
  env.rt.stop();
});

test('R6-E6b 二进制文件里碰巧可读的字节串能被当引文 → 应拒（含 NUL 的文件不可引）', async () => {
  const body = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0xff]),
    Buffer.from(`${FILLER}\n`), Buffer.from('IHDR_ABCDEFGHIJKLMNOP_tEXtComment\n')]);
  const env = await start({ body });
  const r = await verify(env, both('引自 out.md：「IHDR_ABCDEFGHIJKLMNOP_tEXtComment」'));
  assert.equal(r.ok, false, JSON.stringify(r));
  env.rt.stop();
});

test('R6-E7 verdict 的 item 写清单原文时，退回理由是按数组位置而不是按真正被退回的那条核对 → 应拒', async () => {
  const env = await start({ lines: [REAL] });
  const r = await verify(env, [
    { item: ITEM2, verdict: 'fail', evidence: '看了 out.md', reason: '第 1 条没达到：这里随便写点什么凑够字数' },
    { item: ITEM1, verdict: 'pass', evidence: `引自 out.md：「${REAL}」` },
  ]);
  assert.equal(r.ok, false, '真正被退回的是第 2 条，理由却写「第 1 条」：' + JSON.stringify(r));
  env.rt.stop();
});

test('R6-E8 证据里除一句真话外再塞编造的引文：编造的不核对 → 应拒', async () => {
  const env = await start({ lines: [REAL] });
  const r = await verify(env, both(`引自 out.md：「${REAL}」；另外文件里还写了「全部测试已经在真实环境跑通并且零失败」`));
  assert.equal(r.ok, false, JSON.stringify(r));
  env.rt.stop();
});
