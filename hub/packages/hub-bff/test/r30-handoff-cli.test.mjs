// · 看板交接：外部 agent 的命令行 hub-handoff（五条命令、人读与 --json、令牌不外露、出错的退出码）。
// 起一个真的看板 HTTP 服务（临时目录、系统分配的临时端口），命令行用真的 fetch 去连。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join } from 'node:path';
import { writeFile, chmod, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testDirectory } from './fixtures.mjs';
import { createBoard } from '../lib/board.mjs';
import { createBoardHandler } from '../lib/board-http.mjs';
import { issueToken, revokeToken } from '../lib/board-tokens.mjs';
import { buildHandoffInput } from '../lib/handoff.mjs';
import { main } from '../bin/hub-handoff.mjs';

const CHIEF = { name: 'chief', type: 'assistant' };
const BIN = fileURLToPath(new URL('../bin/hub-handoff.mjs', import.meta.url));

async function stack() {
  const dir = await testDirectory();
  const configDir = join(dir, 'config');
  const board = createBoard({ root: join(dir, 'board'), reservedNames: () => ['owner', 'chief'] });
  const handler = createBoardHandler({ board, configDir, prefix: '/board', reservedNames: () => ['owner', 'chief'] });
  const server = http.createServer((req, res) => handler(req, res).then(done => done || res.end()));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/board`;
  const tokens = {};
  for (const name of ['codex', 'grok']) tokens[name] = (await issueToken(configDir, { name, scope: 'work' })).token;
  const send = (to, extra = {}) => board.create(CHIEF, buildHandoffInput({ from: 'chief', to, goal: `给 ${to} 的活`,
    done: '做完有产物', returnWay: '放到 /work 后交回', sessionId: 's1', key: 'k' + Math.random(), ...extra }));
  const run = async (who, argv, extraEnv = {}) => {
    let out = '';
    let err = '';
    const code = await main(argv, { HUB_BOARD_URL: url, HUB_BOARD_TOKEN: tokens[who], ...extraEnv },
      { stdout: { write: text => { out += text; } }, stderr: { write: text => { err += text; } } });
    return { code, out, err };
  };
  return { dir, configDir, board, server, url, tokens, send, run,
    close: () => new Promise(resolve => server.close(resolve)) };
}

test('mine：只列派给我的、没做完的卡；人读与 --json 都有；--all 才带已完成', async () => {
  const s = await stack();
  try {
    const mineA = (await s.send('codex')).id;
    await s.send('grok');
    const done = (await s.send('codex')).id;
    await s.board.claim({ name: 'codex', type: 'external' }, done);
    await s.board.report({ name: 'codex', type: 'external' }, done, { summary: '好了' });
    // 外部做的卡，助理只能记意见，主人点完成才算（external_accept 默认 owner）。
    await s.board.ownerMove({ name: 'owner', type: 'owner' }, done, 'done');
    const human = await s.run('codex', ['mine']);
    assert.equal(human.code, 0);
    assert.match(human.out, /派给 codex 的单（1 张）/u);
    assert.ok(human.out.includes(mineA) && !human.out.includes(done));
    assert.ok(!human.out.includes(s.tokens.codex));
    const json = JSON.parse((await s.run('codex', ['mine', '--json'])).out);
    assert.equal(json.ok, true);
    assert.equal(json.me, 'codex');
    assert.deepEqual(json.tickets.map(t => t.id), [mineA]);
    assert.equal(json.tickets[0].done, '做完有产物');
    assert.equal(json.tickets[0].returnWay, '放到 /work 后交回');
    const all = JSON.parse((await s.run('codex', ['mine', '--all', '--json'])).out);
    assert.equal(all.tickets.length, 2);
    assert.match((await s.run('grok', ['mine'])).out, /1 张/u);
  } finally {
    await s.close();
  }
});

test('take：领单并讲清目标、完成标准、交回方式；再 take 一次是复述不是报错；别人的单领不了', async () => {
  const s = await stack();
  try {
    const id = (await s.send('codex')).id;
    const first = await s.run('codex', ['take', id]);
    assert.equal(first.code, 0);
    assert.match(first.out, new RegExp(`已领取 ${id}`, 'u'));
    assert.match(first.out, /目标：给 codex 的活/u);
    assert.match(first.out, /完成标准：做完有产物/u);
    assert.match(first.out, /交回方式：放到 \/work 后交回/u);
    assert.equal((await s.board.get(id)).state, 'progress');
    const again = await s.run('codex', ['take', id, '--json']);
    assert.equal(again.code, 0);
    assert.equal(JSON.parse(again.out).ticket.state, 'progress');
    const other = await s.run('grok', ['take', id]);
    assert.equal(other.code, 5, '别人在做的单：第37轮起 grok 看不到它，只得到「不是你的」');
    assert.match(other.out, /没有派给你，也不是「谁有空谁接」的开放卡/u);
    const stranger = (await s.send('grok')).id;
    const wrong = await s.run('codex', ['take', stranger]);
    assert.ok([3, 4, 5].includes(wrong.code), '不是派给我的单领不了：' + wrong.code);
    assert.equal((await s.board.get(stranger)).state, 'queued');
    assert.equal((await s.run('codex', ['take', 'T-20200101-000000-zzzz'])).code, 5);
  } finally {
    await s.close();
  }
});

test('note：追加进度，人读与 --json；没领的单不能报进度', async () => {
  const s = await stack();
  try {
    const id = (await s.send('codex')).id;
    assert.equal((await s.run('codex', ['note', id, '先看看'])).code, 3, '没领的单不归我，不能报进度');
    await s.run('codex', ['take', id]);
    const ok = await s.run('codex', ['note', id, '读完材料，开始写']);
    assert.equal(ok.code, 0);
    assert.match(ok.out, /已记进度/u);
    assert.deepEqual((await s.board.get(id)).progress.map(p => p.text), ['读完材料，开始写']);
    assert.equal(JSON.parse((await s.run('codex', ['note', id, '第二条', '--json'])).out).ok, true);
  } finally {
    await s.close();
  }
});

test('deliver：交回带结果和证据路径，单进入待验收；证据文件在本机就算校验值；没写证据就拒', async () => {
  const s = await stack();
  try {
    const id = (await s.send('codex')).id;
    await s.run('codex', ['take', id]);
    const evidence = join(s.dir, 'out.md');
    await writeFile(evidence, '# 成果\n');
    assert.equal((await s.run('codex', ['deliver', id, '--result', '好了'])).code, 2, '没证据路径要拒');
    const ok = await s.run('codex', ['deliver', id, '--result', '清单写完，共 8 条', '--evidence', evidence,
      '--evidence', '/work/extra.txt', '--checked', '逐条对过', '--unchecked', '没跑全量']);
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /等派单人验收/u);
    const ticket = await s.board.get(id);
    assert.equal(ticket.review, 'submitted');
    assert.match(ticket.report.summary, /成果：清单写完，共 8 条/u);
    assert.match(ticket.report.summary, /怎么验的：逐条对过/u);
    assert.deepEqual(ticket.reports.at(-1).artifacts, [evidence, '/work/extra.txt']);
    assert.match(ticket.report.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(ticket.report.file, evidence);
    const json = JSON.parse((await s.run('grok', ['mine', '--json'])).out);
    assert.deepEqual(json.tickets, []);
  } finally {
    await s.close();
  }
});

test('stuck：标卡住带问题，默认是等人回答，--blocked 是被外因挡住；回答之后 take 能看到', async () => {
  const s = await stack();
  try {
    const a = (await s.send('codex')).id;
    const b = (await s.send('codex')).id;
    await s.run('codex', ['take', a]);
    await s.run('codex', ['take', b]);
    const asked = await s.run('codex', ['stuck', a, '--question', '这段介绍写给谁看？']);
    assert.equal(asked.code, 0);
    assert.equal((await s.board.get(a)).state, 'waiting-human');
    assert.equal((await s.board.get(a)).open_ask.text, '这段介绍写给谁看？');
    const blocked = await s.run('codex', ['stuck', b, '--question', '没有仓库权限', '--blocked', '--json']);
    assert.equal(JSON.parse(blocked.out).waitHuman, false);
    assert.equal((await s.board.get(b)).state, 'blocked');
    await s.board.answer(CHIEF, a, '写给刚入门的人看，300 字内');
    const back = await s.run('codex', ['take', a]);
    assert.match(back.out, /最新回答（chief）：写给刚入门的人看，300 字内/u);
    assert.equal((await s.board.get(a)).state, 'progress');
  } finally {
    await s.close();
  }
});

test('令牌：不许放在命令行参数里；任何输出（含服务端回显）都不含令牌；配置文件须 0600；撤销后退出码 3', async () => {
  const s = await stack();
  try {
    assert.equal((await s.run('codex', ['mine', '--token', s.tokens.codex])).code, 2);
    // 工单里被写进了令牌（比如外部自己的话回显）：输出时隐去
    const id = (await s.send('codex')).id;
    await s.run('codex', ['take', id]);
    await s.board.progress({ name: 'codex', type: 'external' }, id, '我的令牌是 ' + s.tokens.codex);
    await s.board.progress({ name: 'codex', type: 'external' }, id, 'x');
    await s.board.report({ name: 'codex', type: 'external' }, id, { summary: '好了' });
    await s.board.sendBack(CHIEF, id, '令牌 ' + s.tokens.codex + ' 别写进来');
    const shown = await s.run('codex', ['take', id]);
    assert.ok(!shown.out.includes(s.tokens.codex) && !shown.err.includes(s.tokens.codex));
    const leak = await s.run('codex', ['deliver', id, '--result', '附 ' + s.tokens.codex, '--evidence', '/x']);
    assert.equal(leak.code, 2);
    assert.ok(!leak.out.includes(s.tokens.codex) && !leak.err.includes(s.tokens.codex));
    // 配置文件
    const file = join(s.dir, 'hub-board.json');
    await writeFile(file, JSON.stringify({ url: s.url, token: s.tokens.codex }), { mode: 0o666 });
    await chmod(file, 0o644);
    const quiet = { stdout: { write() {} }, stderr: { write() {} } };
    assert.equal(await main(['mine'], { HUB_BOARD_CONFIG: file }, quiet), 2);
    await chmod(file, 0o600);
    let out = '';
    assert.equal(await main(['mine', '--json'], { HUB_BOARD_CONFIG: file }, { stdout: { write: t => { out += t; } },
      stderr: { write() {} } }), 0);
    assert.equal(JSON.parse(out).me, 'codex');
    await revokeToken(s.configDir, 'codex');
    assert.equal((await s.run('codex', ['mine'])).code, 3);
    assert.equal((await s.run('codex', ['mine'], { HUB_BOARD_TOKEN: 'dsb_bad' })).code, 3);
  } finally {
    await s.close();
  }
});

test('用法错误给中文用法并退出 2；没配地址令牌退出 2；工单里的控制字符不会原样打到终端', async () => {
  const s = await stack();
  try {
    for (const argv of [[], ['nope'], ['take'], ['note', 'T-1'], ['stuck', 'T-1'], ['mine', 'extra']]) {
      const r = await s.run('codex', argv);
      assert.equal(r.code, 2, JSON.stringify(argv));
      assert.match(r.err, /用法/u);
    }
    assert.equal((await main(['mine'], {}, { stdout: { write() {} }, stderr: { write() {} } })), 2);
    const id = (await s.send('codex', { goal: '前\u001b[31m红色\u001b]0;标题\u0007后' })).id;
    const shown = await s.run('codex', ['take', id]);
    assert.ok(!/[\u001b\u0007]/u.test(shown.out), '控制字符不该原样输出');
  } finally {
    await s.close();
  }
});

test('一键全停时 take 不领单（退出 6），单还在待领；停机目录来自环境变量', async () => {
  const s = await stack();
  try {
    const id = (await s.send('codex')).id;
    const panic = join(s.dir, 'panic');
    await mkdir(panic, { recursive: true });
    await writeFile(join(panic, 'stopped.flag'), '1');
    const stopped = await s.run('codex', ['take', id], { HUB_PANIC_DIR: panic });
    assert.equal(stopped.code, 6);
    assert.match(stopped.out, /已一键全停/u);
    assert.equal((await s.board.get(id)).state, 'queued');
    const asJson = await s.run('codex', ['take', id, '--json'], { HUB_PANIC_DIR: panic });
    assert.equal(JSON.parse(asJson.out).reason, 'stopped');
    assert.equal((await s.run('codex', ['mine'], { HUB_PANIC_DIR: panic })).code, 0, '看一眼不受全停影响');
    const free = await s.run('codex', ['take', id], { HUB_PANIC_DIR: join(s.dir, 'other-panic-ok') });
    assert.equal(free.code, 0, '停机目录里没有标记就照常领');
  } finally {
    await s.close();
  }
});

test('作为独立命令运行：没配环境时退出 2、不打印令牌', () => {
  const r = spawnSync(process.execPath, [BIN, 'mine'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /用法/u);
});
