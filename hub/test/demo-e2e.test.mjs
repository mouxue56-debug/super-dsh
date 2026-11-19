// 演示模式端到端：scripts/start.sh --demo 真起一个隔离实例（内核 + 网页/后端/假模型），
// 用命令行方式（fetch）走一遍：首页、发一句话收到假模型回复、看板与账本有数据、停干净。
// 没装 DSH 内核的机器上，端到端一段自动跳过并写明原因；参数检查那几条不需要内核，照常跑。
// 端口：环境变量 HUB_DEMO_PORT、HUB_DEMO_KERNEL_PORT（都不设就各挑一个空闲端口）。
// 目录：环境变量 HUB_DEMO_TEST_TARGET（不设就在系统临时目录下建一个新的）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = name => path.join(repo, 'scripts', name);
const APP_DSH = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';

// 跑一个脚本，返回退出码与合并输出。
function sh(name, args, env = {}) {
  const r = spawnSync('/bin/bash', [script(name), ...args], {
    encoding: 'utf8', env: {...process.env, ...env}, timeout: 180000,
  });
  return {code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`};
}

// 找得到可用的 dsh 吗：环境变量、PATH、桌面版默认位置，依次看。
function findDsh() {
  const candidates = [process.env.DSH_BIN];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) candidates.push(path.join(dir, 'dsh'));
  candidates.push(APP_DSH);
  return candidates.find(file => file && fs.existsSync(file));
}

// 向系统要一个空闲端口。
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => resolve(port));
    });
  });
}

// 端口上是否有东西在听。
function busy(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('start.sh 不给目录、给相对目录、不加 --demo 都拒绝', () => {
  assert.notEqual(sh('start.sh', ['--demo']).code, 0);
  const relative = sh('start.sh', ['--demo', '--target', 'relative/dir']);
  assert.notEqual(relative.code, 0);
  assert.match(relative.out, /绝对路径/);
  const noDemo = sh('start.sh', ['--target', path.join(os.tmpdir(), 'hub-demo-never')]);
  assert.notEqual(noDemo.code, 0);
  assert.match(noDemo.out, /--demo/);
});

test('start.sh 不往不是演示实例的非空目录里写', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hub-demo-notmine-'));
  try {
    fs.writeFileSync(path.join(dir, 'keep.txt'), '别人的文件');
    const r = sh('start.sh', ['--demo', '--target', dir, '--port', '18391', '--kernel-port', '18392']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /不是演示实例目录/);
    assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('doctor.sh 找不到内核时失败，并写明怎么办', () => {
  const dir = path.join(fs.realpathSync(os.tmpdir()), 'hub-demo-doctor-none');
  const r = sh('doctor.sh', ['--target', dir], {DSH_BIN: path.join(dir, 'no-such-dsh')});
  assert.notEqual(r.code, 0);
  assert.match(r.out, /找不到 DSH 内核/);
  assert.match(r.out, /怎么办/);
  assert.equal(fs.existsSync(dir), false, 'doctor 是只读的，不能建目录');
});

test('stop.sh 对没有运行记录的目录什么也不做', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hub-demo-stop-'));
  try {
    const r = sh('stop.sh', ['--target', dir]);
    assert.equal(r.code, 0);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

const dsh = findDsh();
test('演示实例端到端：起、首页、聊天、看板与账本、停', {
  skip: dsh ? false : '本机没有 DSH 内核（DSH_BIN、PATH、桌面版默认位置都没找到 dsh），端到端无法进行',
  timeout: 240000,
}, async t => {
  const port = Number(process.env.HUB_DEMO_PORT) || await freePort();
  let kernelPort = Number(process.env.HUB_DEMO_KERNEL_PORT) || await freePort();
  if (kernelPort === port) kernelPort = await freePort();
  const target = process.env.HUB_DEMO_TEST_TARGET
    ?? path.join(fs.realpathSync(os.tmpdir()), `hub-demo-e2e-${process.pid}`);
  const env = {DSH_BIN: dsh};
  const origin = `http://127.0.0.1:${port}`;
  const startArgs = ['--demo', '--target', target, '--port', String(port), '--kernel-port', String(kernelPort)];
  t.after(async () => {
    sh('stop.sh', ['--target', target], env);
    if (!process.env.HUB_DEMO_TEST_TARGET) fs.rmSync(target, {recursive: true, force: true});
  });

  await t.test('体检通过（起之前端口空闲）', () => {
    const r = sh('doctor.sh', ['--target', target, '--port', String(port), '--kernel-port', String(kernelPort)], env);
    assert.equal(r.code, 0, r.out);
  });

  let loginUrl;
  await t.test('start.sh --demo 起得来，打印本机访问地址', () => {
    const r = sh('start.sh', startArgs, env);
    assert.equal(r.code, 0, r.out);
    loginUrl = new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?key=[0-9a-f]+`).exec(r.out)?.[0];
    assert.ok(loginUrl, `没打印访问地址：${r.out}`);
  });

  let cookie;
  await t.test('不带 cookie 进不去；带钥匙地址换到 cookie 后首页能打开', async () => {
    assert.equal((await fetch(`${origin}/`)).status, 401);
    const login = await fetch(loginUrl, {redirect: 'manual'});
    assert.equal(login.status, 303);
    cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert.ok(cookie);
    const home = await fetch(`${origin}/`, {headers: {cookie}});
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /<html/i);
    assert.ok(html.length > 10000);
  });

  const api = (p, init = {}) => fetch(origin + p, {
    ...init, headers: {cookie, origin, 'content-type': 'application/json', ...init.headers},
  });

  let sessionId;
  await t.test('三个示例助理在名册里；给「写作」发一句话，收到假模型的回复', async () => {
    const bots = (await (await api('/bff/bots')).json()).bots.map(b => b.id);
    assert.deepEqual(bots, ['chief', 'writer', 'research']);
    const made = await api('/bff/sessions', {method: 'POST', body: JSON.stringify({bot: 'writer'})});
    assert.equal(made.status, 201);
    sessionId = (await made.json()).id;
    const sent = await api(`/bff/sessions/${sessionId}/messages`, {
      method: 'POST', body: JSON.stringify({text: '你好，演示一下'}),
    });
    assert.equal(sent.status, 202);
    let reply;
    for (let i = 0; i < 80 && !reply; i++) {
      const {messages} = await (await api(`/bff/sessions/${sessionId}/history`)).json();
      reply = messages.find(m => m.role === 'assistant' && m.text.includes('演示模型回显'));
      if (!reply) await pause(250);
    }
    assert.ok(reply, '20 秒内没收到假模型的回复');
    assert.match(reply.text, /你好，演示一下/);
  });

  await t.test('看板有四张演示工单，账本里有这次调用', async () => {
    const board = await (await api('/bff/board/tickets')).json();
    assert.equal(board.tickets.length, 4);
    let today;
    for (let i = 0; i < 40; i++) {
      today = await (await api('/bff/ledger/today')).json();
      if (today.total?.calls >= 1) break;
      await pause(250);
    }
    assert.ok(today.total.calls >= 1, JSON.stringify(today));
    assert.ok(today.total.tokens.input > 0);
    const session = await (await api(`/bff/ledger/session/${sessionId}`)).json();
    assert.ok(session.calls >= 1);
  });

  await t.test('再跑一次 start.sh 不重复起；stop.sh 停干净，两个端口都释放', async () => {
    const again = sh('start.sh', startArgs, env);
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /已在运行/);
    const stopped = sh('stop.sh', ['--target', target], env);
    assert.equal(stopped.code, 0, stopped.out);
    await pause(300);
    assert.equal(await busy(port), false, `端口 ${port} 没释放`);
    assert.equal(await busy(kernelPort), false, `端口 ${kernelPort} 没释放`);
  });
});
