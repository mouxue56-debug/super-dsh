// · 看板交接：端到端演练（临时目录、系统分配的临时端口、假时钟、假模型，不碰真模型和别的机器）。
// 派两张卡给两个外部身份 → 一个交回、一个卡住 → 派单的助理被叫醒 → 回答、验收，两张都完成。
// 真的部分：看板、后端（含叫醒模块与它在后端的接线）、看板 HTTP、命令行 hub-handoff（独立子进程）、助理的两个看板工具。
// 假的部分：内核（上游用内存假件）与模型（由下面的 assistantTurn 按收到的叫醒话照剧本调用工具）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join } from 'node:path';
import { writeFile, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture, assistantEvent } from './fixtures.mjs';
import { createBoard } from '../lib/board.mjs';
import { issueToken } from '../lib/board-tokens.mjs';
import { register as registerHandoff } from '../../hub-plugin/tools/handoff.mjs';
import { register as registerBots } from '../../hub-plugin/tools/bots.mjs';

const BIN = fileURLToPath(new URL('../bin/hub-handoff.mjs', import.meta.url));
const at = (day, h, m) => Date.UTC(2026, 10, day, h, m);
const end = seq => ({ type: 'event', event: { type: 'turn/end', seq, data: { reason: { kind: 'completed' } } } });

test('交接端到端：两张卡给两个外部身份，交回与卡住都叫醒派单助理，夜间不打扰，验收完成', async () => {
  let clock = at(19, 20, 20);
  const f = await fixture({ handlerOptions: { now: () => clock, hubConfig: { timezone: 'UTC' } } });
  // 假内核：每收到一条提示就让这个回合立刻结束，下一次叫醒才不会排在上一次后面。
  let seq = 2;
  f.source.rpcOverride = async envelope => {
    if (envelope.method === 'session/prompt') {
      f.source.emit(assistantEvent(seq++, '收到'));
      f.source.emit(end(seq++));
    }
  };
  const server = http.createServer((req, res) => f.handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/board`;
  const log = [];
  const say = line => {
    log.push(line);
    console.log('E2E ' + line);
  };
  try {
    const { hubHome, configDir } = f.handlerOptions;
    const rows = f.handler.roster.list();
    await chmod(configDir, 0o700);
    const reserved = ['owner', ...rows.flatMap(row => [row.id, row.name])];
    const tokens = {};
    for (const name of ['agent-research', 'agent-coder']) {
      tokens[name] = (await issueToken(configDir, { name, scope: 'work', reserved })).token;
    }
    const cli = (who, argv) => new Promise(resolve => {
      execFile(process.execPath, [BIN, ...argv], { env: { PATH: process.env.PATH, HUB_BOARD_URL: url,
        HUB_BOARD_TOKEN: tokens[who] } }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, out: stdout,
        err: stderr }));
    });

    // 派单助理的工具：与插件里同一份代码，看板是它自己的一份（与后端共用同一个目录，靠文件锁）。
    const planBoard = createBoard({ root: join(hubHome, 'board'), maxHop: 4 });
    const boardCfg = Object.defineProperties({ dir: join(hubHome, 'board'), maxHop: 4, idleRelayLimit: 6 },
      { maxSendPerTurn: { value: 3 }, externals: { value: ['agent-research', 'agent-coder'] } });
    const tools = {};
    const deps = { hubConfig: { board: boardCfg }, board: planBoard, roster: rows,
      material: c => [{ type: 'text', text: c }],
      state: () => ({ readExternal: false, reserveSend: () => () => {} }) };
    const registerCtx = { tools: { register: spec => { tools[spec.name] = spec; } } };
    registerHandoff(registerCtx, deps);
    registerBots(registerCtx, deps);
    const call = Object.freeze({ bot: 'chief', role: 'chief', sessionId: 's1', turn: 1, readExternal: false });
    const use = (name, args) => tools[name].execute(args, null, call);

    // 假模型：收到叫醒话，按话里的工单号和类型调用工具。其余的话它不理。
    let cursor = 0;
    const prompts = () => f.source.named('session/prompt').map(p => p.request.content[0].text);
    const fresh = () => {
      const all = prompts();
      const out = all.slice(cursor);
      cursor = all.length;
      return out;
    };
    const assistantTurn = async text => {
      const id = /工单 (T-\d{8}-\d{6}-[A-Za-z0-9]{4})/u.exec(text)?.[1];
      if (/交回了/u.test(text)) return use('board_review', { id, verdict: 'accept' });
      if (/有问题等人回答/u.test(text)) return use('board_answer', { id, text: '写给刚入门的人看，300 字以内' });
      return null;
    };

    // 1. 助理派两张卡（第三次尝试带了密钥，被拦）
    await assert.rejects(() => use('board_handoff', { to: 'agent-research', goal: '用 sk-abcdefghijklmnop1 查',
      done: '有结果' }), /不能写进/u);
    const mk = (to, title, goal, done) => use('board_handoff', { to, title, goal, done,
      return_way: '写进文件后用 hub-handoff deliver 交回' });
    await mk('agent-research', '整理本周选题清单', '把本周的选题整理成清单', '10 条以内，每条一句话');
    await mk('agent-coder', '写一段选题介绍', '给上面的清单写一段介绍', '300 字以内，写明读者');
    const queued = await planBoard.list({ state: 'queued' });
    assert.equal(queued.length, 2);
    assert.ok(queued.every(t => t.from.name === 'chief' && t.sessions.from === 's1'));
    say('20:20 助理派出 2 张卡：agent-research、agent-coder（带完成标准和交回方式；带密钥的那次被拦）');

    // 2. agent-research：mine → take → note → deliver（白天）
    const mineR = JSON.parse((await cli('agent-research', ['mine', '--json'])).out);
    assert.equal(mineR.tickets.length, 1);
    assert.equal(mineR.tickets[0].title, '整理本周选题清单');
    const idR = mineR.tickets[0].id;
    assert.equal((await cli('agent-research', ['take', idR])).code, 0);
    assert.equal((await cli('agent-research', ['note', idR, '读完材料，开始整理'])).code, 0);
    const evidence = join(hubHome, 'topics.md');
    await writeFile(evidence, '# 选题\n');
    clock = at(19, 20, 25);
    const delivered = await cli('agent-research', ['deliver', idR, '--result', '清单整理好了，共 8 条',
      '--evidence', evidence, '--checked', '逐条核过出处', '--unchecked', '没验热度']);
    assert.equal(delivered.code, 0, delivered.err);
    await f.handler.handoffWake.flush();
    const wokeR = fresh();
    assert.equal(wokeR.length, 1, '交回后派单助理应被叫醒一次：' + JSON.stringify(wokeR));
    assert.match(wokeR[0], new RegExp(`【工单 ${idR} 交回了】agent-research`, 'u'));
    assert.doesNotMatch(wokeR[0], /夜间静默/u);
    assert.ok(!wokeR[0].includes('清单整理好了') && !wokeR[0].includes(evidence), '叫醒话里不带外部写的内容');
    say('20:25 agent-research 交回 → 助理被叫醒一次（白天，话里只有工单号和外部身份名）');
    await assistantTurn(wokeR[0]);
    // 外部交回的卡，助理的「收下」只记一句意见，卡停在等验收；主人点完成才算。
    const noted = await f.handler.board.get(idR);
    assert.equal(noted.state, 'progress');
    assert.equal(noted.review, 'submitted');
    assert.ok(noted.history.some(h => h.action === 'review_noted'));
    await f.handler.board.ownerMove({ name: 'owner', type: 'owner' }, idR, 'done');
    assert.equal((await f.handler.board.get(idR)).state, 'completed');
    say('20:25 助理验收只记意见（board_review accept）→ 主人点完成 → 完成');

    // 3. agent-coder：take → 夜里卡住（带问题）
    const mineC = JSON.parse((await cli('agent-coder', ['mine', '--json'])).out);
    const idC = mineC.tickets[0].id;
    assert.equal((await cli('agent-coder', ['take', idC])).code, 0);
    clock = at(20, 2, 10);
    assert.equal((await cli('agent-coder', ['stuck', idC, '--question', '这段介绍写给谁看？'])).code, 0);
    await f.handler.handoffWake.flush();
    const wokeC = fresh();
    assert.equal(wokeC.length, 1);
    assert.match(wokeC[0], new RegExp(`【工单 ${idC} 卡住了】agent-coder.*有问题等人回答`, 'u'));
    assert.match(wokeC[0], /夜间静默时段/u, '夜里叫醒要求别打扰主人');
    assert.ok(!wokeC[0].includes('写给谁看'), '问题内容不进叫醒话，助理自己去看板读');
    say('02:10 agent-coder 卡住（问：写给谁看）→ 助理被叫醒一次，话里带夜间静默要求');

    // 4. 助理回答（假模型），外部在早上继续并交回，助理再被叫醒验收
    await assistantTurn(wokeC[0]);
    assert.equal((await f.handler.board.get(idC)).state, 'progress');
    say('02:10 助理回答（board_answer）→ 卡片回到进行中');
    clock = at(20, 8, 30);
    const back = await cli('agent-coder', ['take', idC]);
    assert.match(back.out, /最新回答（chief）：写给刚入门的人看，300 字以内/u);
    const out2 = await cli('agent-coder', ['deliver', idC, '--result', '介绍写好了，约 280 字', '--evidence',
      join(hubHome, 'intro.md')]);
    assert.equal(out2.code, 0, out2.err);
    await f.handler.handoffWake.flush();
    const wokeC2 = fresh();
    assert.equal(wokeC2.length, 1);
    assert.doesNotMatch(wokeC2[0], /夜间静默/u, '早上 08:30 已过静默时段');
    say('08:30 agent-coder 看到回答、继续并交回 → 助理被叫醒一次（早上，无静默句）');
    await assistantTurn(wokeC2[0]);
    assert.equal((await f.handler.board.get(idC)).state, 'progress'); // 停在等验收，等主人点
    await f.handler.board.ownerMove({ name: 'owner', type: 'owner' }, idC, 'done');
    const finalRows = await f.handler.board.list();
    assert.deepEqual(finalRows.map(t => t.state), ['completed', 'completed']);
    say('08:30 助理验收 → 两张都完成');

    // 5. 去重：把已处理的事件重放一遍，不再叫醒
    for (const id of [idR, idC]) {
      for (const type of ['reported', 'submitted', 'blocked']) {
        const by = id === idR ? 'agent-research' : 'agent-coder';
        await f.handler.handoffWake.onEvent({ type, id, by, ts: 'replay' });
      }
    }
    assert.equal(fresh().length, 0, '重放不该再叫醒');
    say('重放全部事件 → 没有新叫醒');
    assert.equal(prompts().length, 3, '全程一共叫醒 3 次：交回、卡住、再交回');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await f.dispose();
  }
});
