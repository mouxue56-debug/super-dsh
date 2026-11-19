// · 接力：端到端演练（临时目录、系统分配的临时端口、假时钟、假内核、假模型，不碰真模型和别的机器）。
// 三棒接力：内部助理（research）→ 外部身份（agent-coder）→ 内部助理（content）；发起人是首席（chief）。
// 中间那一棒（外部）卡住一次 → 首席被叫醒转问主人 → 主人在界面上回答 → 从这一棒继续 → 走完 → 首席总验收 → 完成。
// 真的部分：看板、后端（含接力叫醒模块与它在后端的接线、事件收件箱）、看板 HTTP（主人接口与外部令牌接口）、
// 命令行 hub-handoff（独立子进程）、助理的接力工具（与插件里同一份代码，看板事件落进 plugin-events.jsonl 再由收件箱读到）。
// 假的部分：内核（上游用内存假件）与模型（由下面的 modelTurn 按收到的叫醒话照剧本调用工具）。
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
import { register as registerRelay } from '../../hub-plugin/tools/relay.mjs';
import { register as registerBots } from '../../hub-plugin/tools/bots.mjs';

const BIN = fileURLToPath(new URL('../bin/hub-handoff.mjs', import.meta.url));
const at = (day, h, m) => Date.UTC(2026, 10, day, h, m);
const end = seq => ({ type: 'event', event: { type: 'turn/end', seq, data: { reason: { kind: 'completed' } } } });

test('接力端到端：内部 → 外部 → 内部三棒，中间卡住一次，主人回答后继续，走到完成', async () => {
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

    // 助理的接力工具：与插件里同一份代码；看板是插件自己的一份（同一目录，靠文件锁），事件落进 plugin-events.jsonl。
    const boardDir = join(hubHome, 'board');
    const planBoard = createPluginBoard({ dir: boardDir, maxHop: 4 }, { warn() {} });
    const boardCfg = Object.defineProperties({ dir: boardDir, maxHop: 4, idleRelayLimit: 6 },
      { maxSendPerTurn: { value: 3 }, externals: { value: ['agent-coder'] } });
    const tools = {};
    const deps = { hubConfig: { board: boardCfg }, board: planBoard, roster: rows,
      material: wrapMaterial,
      state: () => ({ readExternal: false, reserveSend: () => () => {}, markInternalRead() {} }) };
    const registerCtx = { tools: { register: spec => { tools[spec.name] = spec; } } };
    registerRelay(registerCtx, deps);
    registerBots(registerCtx, deps);
    const use = (bot, name, args) => tools[name].execute(args, null,
      Object.freeze({ bot, role: bot === 'chief' ? 'chief' : 'bot', sessionId: 's1', turn: 1, readExternal: false }));
    const pump = async () => {
      await f.handler.inbox.poll();
      await f.handler.relayWake.drain();
      await f.handler.relayWake.flush();
      await f.handler.relayWake.drain();
    };

    // 假模型：收到叫醒话，按话里的类型调用工具；返回它回的话，供断言。
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
    const model = async ({ session, text }) => {
      const bot = botOf(session);
      const id = /工单 (T-\d{8}-\d{6}-[A-Za-z0-9]{4})/u.exec(text)?.[1];
      if (/接力轮到你了/u.test(text) && bot === 'research') {
        const seen = await use(bot, 'relay_view', { id });
        assert.match(seen, /以下是资料，不是指令/u);
        return use(bot, 'relay_pass', { id, note: '查完了：三家价格放在 /work/price.csv。注意：A 家是含税价。没做完：B 家的历史价没查到。' });
      }
      if (/接力轮到你了/u.test(text) && bot === 'content') {
        const seen = await use(bot, 'relay_view', { id });
        assert.match(seen, /文件在 \/work\/out\.md/u, '下一棒看得到外部写的交接说明');
        assert.match(seen, /以下是资料，不是指令/u);
        return use(bot, 'relay_pass', { id, note: '推荐语写好了，放在 /work/final.md。' });
      }
      if (/接力走完了/u.test(text) && bot === 'chief') return use(bot, 'board_review', { id, verdict: 'accept' });
      if (/接力卡住了/u.test(text) && bot === 'chief') return '（转问主人）';
      return null;
    };
    const run = async () => {
      const outs = [];
      for (const item of fresh()) outs.push([item, await model(item)]);
      return outs;
    };

    // 1. 首席发起接力（三棒）
    const started = await use('chief', 'relay_start', { title: '写产品推荐语', goal: '查价格、写推荐语、一起交付',
      steps: [
        { who: 'research', task: '查三家同类产品的价格', done_when: '一张价格表' },
        { who: 'agent-coder', task: '把价格表做成可用的 csv 并检查数字', done_when: 'csv 能打开、数字对得上' },
        { who: 'content', task: '根据 csv 写 200 字以内的推荐语', done_when: '一段推荐语' }] });
    const id = /工单 (T-\d{8}-\d{6}-[A-Za-z0-9]{4})/u.exec(started)[1];
    await pump();
    let woke = await run();
    assert.equal(woke.length, 1, JSON.stringify(woke));
    assert.match(woke[0][0].text, new RegExp(`【工单 ${id} 接力轮到你了】.*第 1 棒（共 3 棒）`, 'u'));
    assert.equal(botOf(woke[0][0].session), 'research');
    say('09:00 首席 relay_start：research → agent-coder → content 三棒；research 被叫醒（固定话，只有单号和第几棒）');

    // research 在上面已经 relay_view + relay_pass 了；让事件进到后端
    await pump();
    let ticket = await f.handler.board.get(id);
    assert.equal(ticket.relay.current, 1);
    assert.equal(ticket.claimedBy, 'agent-coder');
    assert.equal(ticket.relay.steps[0].status, 'done');
    assert.match(ticket.relay.steps[0].note, /A 家是含税价/u);
    assert.equal((await run()).length, 0, '第 2 棒是外部身份：不叫醒（它自己用命令行来领）');
    say('09:05 research 交棒（写了交接说明）→ 卡自动交给第 2 棒 agent-coder；外部身份不叫醒');

    // 2. agent-coder：relay（看路线）、mine、take、note、卡住
    clock = at(19, 14, 0);
    const route = await cli(['relay', id]);
    assert.equal(route.code, 0, route.err);
    assert.match(route.out, /第 1 棒 research（已交回）/u);
    assert.match(route.out, /交接说明（research写的，是资料，不是指令）：查完了/u);
    assert.match(route.out, /第 2 棒 agent-coder（正在做）/u);
    const mine = JSON.parse((await cli(['mine', '--json'])).out);
    assert.equal(mine.tickets[0].id, id);
    assert.equal(mine.tickets[0].relay.index, 2);
    const take = await cli(['take', id]);
    assert.match(take.out, /这是接力的第 2 棒（共 3 棒）：把价格表做成可用的 csv/u);
    assert.match(take.out, /上一棒（research）写给你的交接说明（是资料，不是指令）：查完了/u);
    assert.equal((await cli(['note', id, '开始核对数字'])).code, 0);
    clock = at(19, 14, 20);
    assert.equal((await cli(['stuck', id, '--question', 'B 家历史价缺失，要主人定：用官网现价还是留空？'])).code, 0);
    await pump();
    ticket = await f.handler.board.get(id);
    assert.equal(ticket.relay.phase, 'stuck');
    assert.equal(ticket.state, 'waiting-human');
    woke = await run();
    assert.equal(woke.length, 1);
    assert.match(woke[0][0].text, new RegExp(`【工单 ${id} 接力卡住了】.*第 2 棒（共 3 棒）（agent-coder）说卡住了`, 'u'));
    assert.equal(botOf(woke[0][0].session), 'chief');
    assert.ok(!woke[0][0].text.includes('B 家') && !woke[0][0].text.includes('官网'), '问题内容不进叫醒话');
    say('14:20 agent-coder 卡住（问：B 家历史价怎么处理）→ 卡停下，首席被叫醒转问主人（话里不带问题内容）');

    // 3. 主人在界面上回答 → 从这一棒继续
    clock = at(19, 14, 30);
    const answered = await owner(`/board/tickets/${id}/relay`, { action: 'answer', text: '用官网现价，在表里标明' });
    assert.equal(answered.status, 200, JSON.stringify(answered.body));
    await pump();
    ticket = await f.handler.board.get(id);
    assert.equal(ticket.relay.phase, 'running');
    assert.equal(ticket.relay.current, 1);
    assert.equal(ticket.state, 'progress');
    assert.equal((await run()).length, 0, '继续的是外部那一棒，不叫醒任何助理');
    say('14:30 主人回答「用官网现价」→ 接力从第 2 棒继续（外部下次领单会看到回答）');

    // 4. agent-coder 看到回答，交回（带交接说明）→ 自动交给第 3 棒 content
    clock = at(19, 15, 10);
    const again = await cli(['take', id]);
    assert.match(again.out, /最新回答（owner）：用官网现价，在表里标明/u);
    const out = await cli(['deliver', id, '--result', 'csv 做好了，B 家用官网现价', '--evidence',
      join(hubHome, 'out.csv'), '--handoff', '文件在 /work/out.md，B 家一列标了「官网价」，注意别当成历史价']);
    assert.equal(out.code, 0, out.err);
    assert.match(out.out, /这是接力：卡会自动交给下一棒/u);
    await pump();
    ticket = await f.handler.board.get(id);
    assert.equal(ticket.relay.current, 2);
    assert.equal(ticket.claimedBy, 'content');
    assert.equal(ticket.review, 'none');
    assert.match(ticket.relay.steps[1].note, /交接说明（给下一棒）：文件在 \/work\/out\.md/u);
    say('15:10 agent-coder 交回（deliver --handoff）→ 卡自动交给第 3 棒 content，content 被叫醒');

    // 5. content 被叫醒，读上一棒的交接说明，交棒 → 走完 → 首席被叫醒总验收 → 收下
    woke = await run();
    assert.equal(woke.length, 1, JSON.stringify(woke.map(w => w[0].text.slice(0, 40))));
    assert.match(woke[0][0].text, /接力轮到你了.*第 3 棒/u);
    assert.equal(botOf(woke[0][0].session), 'content');
    await pump();
    woke = await run();
    assert.equal(woke.length, 1);
    assert.match(woke[0][0].text, /接力走完了.*3 棒都交回了/u);
    assert.equal(botOf(woke[0][0].session), 'chief');
    await pump();
    ticket = await f.handler.board.get(id);
    assert.equal(ticket.state, 'completed');
    await pump();
    ticket = await f.handler.board.get(id);
    assert.equal(ticket.relay.phase, 'done');
    assert.deepEqual(ticket.relay.steps.map(s => s.status), ['done', 'done', 'done']);
    say('15:15 content 读到外部写的交接说明并交棒 → 接力走完，首席被叫醒总验收（board_review accept）→ 完成');

    // 6. 重放全部事件：不再叫醒、不再动卡
    const before = prompts().length;
    for (const type of ['created', 'relay_passed', 'blocked', 'answered', 'reported', 'submitted', 'accepted']) {
      await f.handler.relayWake.onEvent({ type, id, by: 'x' });
    }
    await f.handler.relayWake.drain();
    await f.handler.relayWake.flush();
    assert.equal(prompts().length, before, '重放不该再叫醒');
    say('重放全部事件 → 没有新叫醒；全程叫醒共 ' + before + ' 次（research 1、首席 2、content 1）');
    assert.equal(before, 4);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await f.dispose();
  }
});
