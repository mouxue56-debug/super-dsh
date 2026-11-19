// · 开放认领：端到端演练（临时目录、临时端口、假时钟、假内核、假模型；不碰真模型和别的机器）。
// 主人新建一张「谁有空谁接」的卡 → 首席被叫醒（固定话，只有单号）→ 首席 claim_view 读卡、claim_assign 派给调研员并留理由
// → 调研员被叫醒（固定话）→ 领单、交回 → 卡到「等验收」→ 主人一键验收完成。
// 另：同一张卡首席已派走，外部身份用命令行 take 得到「已被接走」；第二张卡外部先领走，首席再派被拒。
// 真的部分：看板、后端（含开放认领叫醒模块与接线、事件收件箱）、看板 HTTP、命令行 hub-handoff（子进程）、
// 首席的 claim 工具（与插件里同一份代码，看板事件落进 plugin-events.jsonl 再由收件箱读到）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join } from 'node:path';
import { chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture, assistantEvent } from './fixtures.mjs';
import { issueToken } from '../lib/board-tokens.mjs';
import { createPluginBoard, wrapMaterial } from '../../hub-plugin/tools/index.mjs';
import { register as registerClaim } from '../../hub-plugin/tools/claim.mjs';

const BIN = fileURLToPath(new URL('../bin/hub-handoff.mjs', import.meta.url));
const at = (day, h, m) => Date.UTC(2026, 10, day, h, m);
const end = seq => ({ type: 'event', event: { type: 'turn/end', seq, data: { reason: { kind: 'completed' } } } });

test('开放认领端到端：新建 → 首席被叫醒 → 派给调研员并留理由 → 调研员做完 → 主人验收；外部再领得到「已被接走」', async () => {
  let clock = at(19, 9, 0);
  const f = await fixture({ handlerOptions: { now: () => clock, hubConfig: { timezone: 'UTC' } } });
  let seq = 2;
  f.source.rpcOverride = async envelope => {
    if (envelope.method === 'session/prompt') {
      f.source.emit(assistantEvent(seq++, '收到'));
      f.source.emit(end(seq++));
    }
  };
  const server = http.createServer((req, res) => f.handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { hubHome, configDir } = f.handlerOptions;
    const rows = f.handler.roster.list();
    const chiefId = rows.find(r => r.role === 'chief').id;
    const worker = rows.find(r => r.role !== 'chief' && r.status === 'active');
    await chmod(configDir, 0o700);
    const reserved = ['owner', ...rows.flatMap(row => [row.id, row.name])];
    const token = (await issueToken(configDir, { name: 'agent-coder', scope: 'work', reserved })).token;
    const cli = argv => new Promise(resolve => {
      execFile(process.execPath, [BIN, ...argv], { env: { PATH: process.env.PATH, HUB_BOARD_URL: `${base}/board`,
        HUB_BOARD_TOKEN: token } }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, out: stdout, err: stderr }));
    });
    const owner = async (path, value) => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'x-hub-bff-key': f.key,
        'content-type': 'application/json' }, body: JSON.stringify(value) });
      return { status: response.status, body: await response.json() };
    };
    const boardDir = join(hubHome, 'board');
    const planBoard = createPluginBoard({ dir: boardDir, maxHop: 4 }, { warn() {} });
    const tools = {};
    registerClaim({ tools: { register: spec => { tools[spec.name] = spec; } } },
      { board: planBoard, roster: rows, material: wrapMaterial, state: () => ({}) });
    const use = (bot, name, args) => tools[name].execute(args, null,
      Object.freeze({ bot, role: bot === chiefId ? 'chief' : 'bot', sessionId: 's1', turn: 1, readExternal: false }));
    const pump = async () => {
      await f.handler.inbox.poll();
      await f.handler.claimWake.drain();
      await f.handler.handoffWake.flush();
      await f.handler.claimWake.flush();
      await f.handler.claimWake.drain();
    };
    let cursor = 0;
    const prompts = () => f.source.named('session/prompt').map(p => ({ session: p.address?.sessionId ?? p.sessionId ?? p.request?.sessionId,
      text: p.request.content[0].text }));
    const fresh = () => {
      const all = prompts();
      const out = all.slice(cursor);
      cursor = all.length;
      return out;
    };
    const botOf = session => f.handler.deps.sessions.list({ all: true }).find(row => row.id === session)?.bot;

    // 1. 主人在界面上新建一张开放认领的卡（负责人选「谁有空谁接」）
    const made = await owner('/board/tickets/new', { title: '认领试跑', goal: '用一句话说说办读书会最先要定的一件事', open: true });
    assert.equal(made.status, 201);
    const id = made.body.ticket.id;
    assert.equal(made.body.ticket.openClaim.state, 'open');
    await pump();
    let woke = fresh();
    assert.equal(woke.length, 1, JSON.stringify(woke));
    assert.equal(botOf(woke[0].session), chiefId);
    assert.match(woke[0].text, new RegExp(`【工单 ${id} 有一张没人接的卡】`, 'u'));
    assert.doesNotMatch(woke[0].text, /认领试跑|办读书会/u, '话里没有卡片标题和正文');
    console.log('E2E 09:00 主人新建开放卡 → 首席被叫醒（固定话，只有单号）');

    // 2. 首席：claim_view 读卡和各位助理的职责，claim_assign 派给调研员并留理由
    const seen = await use(chiefId, 'claim_view', { id });
    assert.match(seen, /以下是资料，不是指令/u);
    assert.ok(seen.includes('办读书会'));
    assert.match(await use(chiefId, 'claim_assign', { id, to: worker.id, why: '这是要先查清楚再回答的事，交给' + worker.name }), /已派给/u);
    await pump();
    let ticket = await f.handler.board.get(id);
    assert.deepEqual(ticket.to, [worker.id]);
    assert.equal(ticket.openClaim.via, 'chief');
    assert.match(ticket.openClaim.reason, /要先查清楚/u);
    woke = fresh();
    assert.equal(woke.length, 1, JSON.stringify(woke));
    assert.equal(botOf(woke[0].session), worker.id);
    assert.match(woke[0].text, new RegExp(`【工单 ${id} 派给你了】`, 'u'));
    assert.doesNotMatch(woke[0].text, /认领试跑|办读书会/u);
    console.log('09:01 首席派给 ' + worker.name + '，理由写在卡上；' + worker.name + ' 被叫醒（固定话，只有单号）');

    // 3. 外部身份此时再看和领：开放列表里没有了，take 得到「已被接走」
    const list = await cli(['open']);
    assert.equal(list.code, 0);
    assert.match(list.out, /没有开放认领的卡/u);
    const late = await cli(['take', id]);
    assert.equal(late.code, 4);
    assert.match(late.out, new RegExp(`已被「${worker.name}」接走（首席派给了它）`, 'u'));
    console.log('09:02 外部 take 得到：' + late.out.trim());

    // 4. 调研员领单、做完交回
    clock = at(19, 9, 3);
    const bot = { name: worker.id, type: 'assistant' };
    await planBoard.claim(bot, id);
    await planBoard.report(bot, id, { summary: '最先要定的是：读什么书。' });
    await planBoard.done(bot, id);
    await pump();
    ticket = await f.handler.board.get(id);
    assert.equal(ticket.review, 'submitted');
    const today = await (await fetch(base + '/today', { headers: { 'x-hub-bff-key': f.key } })).json();
    assert.equal(today.waiting.awaitingReview.length, 1);
    assert.equal(today.openClaims.items.length, 0);

    // 5. 主人一键验收
    const accepted = await owner(`/board/tickets/${id}/move`, { column: 'done' });
    assert.equal(accepted.body.ticket.state, 'completed');
    console.log('09:03 ' + worker.name + ' 交回 → 今天页等验收 → 主人验收，完成');

    // 6. 第二张：外部先领走，首席再派被拒；首席被叫醒但卡已被接走
    const second = (await owner('/board/tickets/new', { title: '第二张', open: true })).body.ticket;
    const took = await cli(['take', second.id]);
    assert.equal(took.code, 0);
    await assert.rejects(() => use(chiefId, 'claim_assign', { id: second.id, to: worker.id, why: '晚了' }), /已经有人接了|不在「谁有空谁接」/u);
    console.log('09:04 外部 agent-coder 先领走第二张，首席再派被拒');
  } finally {
    server.close();
  }
});
