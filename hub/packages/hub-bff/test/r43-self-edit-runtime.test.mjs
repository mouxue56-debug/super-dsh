import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createSelfEdit } from '../lib/self-edit.mjs';
import { run, health, restoreTree } from '../ops/rescue.mjs';

const caller = { bot: 'chief', sessionId: 'self-test' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function clean(dir) {
  for (const row of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, row.name);
    if (row.isDirectory()) clean(file);
    else fs.unlinkSync(file);
  }
  fs.rmdirSync(dir);
}
function git(root, ...args) {
  return execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' }).trim();
}
async function fixture(t, override = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'self-runtime-')));
  const source = path.join(root, 'source');
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(source);
  fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(source, 'app.txt'), 'good');
  fs.writeFileSync(path.join(source, '.gitignore'), 'ignored.txt\n');
  git(source, 'init', '--quiet');
  git(source, 'add', 'app.txt', '.gitignore');
  git(source, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'baseline');
  const server = http.createServer((_req, res) => {
    const good = fs.readFileSync(path.join(source, 'app.txt'), 'utf8') !== 'bad';
    res.writeHead(good ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: good }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const actions = path.join(root, 'actions.txt');
  const script = path.join(root, 'fake.mjs');
  fs.writeFileSync(script, 'import fs from "node:fs"; fs.appendFileSync(process.argv[2],process.argv[3]+"\\n");');
  const config = { enabled: true, source_dir: source,
    checks: { test: [process.execPath, '-e', 'console.log("通过")'] },
    build_command: [process.execPath, script, actions, 'build'],
    restart_command: [process.execPath, script, actions, 'restart'],
    health_url: 'http://127.0.0.1:' + server.address().port + '/bff/health',
    health_timeout_ms: 200, health_interval_ms: 10, health_successes: 2, timeout_seconds: 2,
    ...override };
  const notices = [];
  const core = createSelfEdit({ config, runtimeDir: runtime, notice: row => notices.push(row) });
  const call = (action, args = {}, identity = caller) => core.execute(action, args, identity);
  async function settled(id) {
    for (let index = 0; index < 600; index += 1) {
      const row = (await core.log()).changes.find(item => item.id === id);
      if (['healthy', 'rolled_back', 'restored', 'recovery_failed'].includes(row?.status)) return row;
      await sleep(20);
    }
    throw Error('worker did not finish');
  }
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    clean(root);
  });
  return { root, source, runtime, core, call, config, notices, settled, actions };
}

test('第一次写入自动存脏源码，同一会话只存一次，权限源码可以改', async t => {
  const h = await fixture(t);
  fs.writeFileSync(path.join(h.source, 'dirty.txt'), '用户尚未提交');
  fs.writeFileSync(path.join(h.source, '.env'), 'SYNTHETIC=example');
  fs.mkdirSync(path.join(h.source, 'data'));
  fs.writeFileSync(path.join(h.source, 'data', 'customer.txt'), 'synthetic user data');
  fs.writeFileSync(path.join(h.source, 'ignored.txt'), 'ignore');
  const first = await h.call('start', { summary: '改自己' });
  const again = await h.call('start');
  assert.equal(first.change.id, again.change.id);
  await h.call('write', { path: 'policy.mjs', text: 'export const example = true;' });
  await h.call('write', { path: 'board-tokens.mjs', text: 'export const example = true;' });
  await h.call('patch', { path: 'app.txt', search: 'good', replacement: 'better' });
  const log = await h.core.log();
  assert.equal(log.restorePoints.length, 1);
  const point = log.restorePoints[0];
  assert.equal(git(h.source, 'show', point.commit + ':dirty.txt'), '用户尚未提交');
  const names = git(h.source, 'ls-tree', '-r', '--name-only', point.commit);
  assert.ok(!names.includes('.env'));
  assert.ok(!names.includes('data/'));
  assert.ok(!names.includes('ignored'));
  assert.equal(fs.readFileSync(path.join(h.source, '.env'), 'utf8'), 'SYNTHETIC=example');
  assert.equal(point.health.ok, true);
  await assert.rejects(h.call('write', { path: '../outside', text: 'x' }));
  assert.equal((await h.core.review('read', { path: '.env' }, caller)).confirmationTotal, 2);
  assert.equal((await h.call('read', { path: '.env' })).text, '[凭据文件内容已隐藏]');
  await assert.rejects(h.call('write', { path: 'app.txt', text: 'x' }, { bot: 'other' }));
});

test('prepare 为通用文件工具先存还原点，符号链接与主线路径拒绝', async t => {
  const h = await fixture(t);
  const prepared = await h.call('prepare', { path: path.join(h.source, 'app.txt'), summary: '通用写入' });
  await assert.rejects(h.call('restart'), /源码操作/);
  await assert.rejects(h.core.restore(prepared.change.restorePointId), /源码操作/);
  await h.call('release', { id: prepared.change.id, leaseId: prepared.lease.id });
  assert.equal((await h.core.log()).restorePoints.length, 1);
  fs.symlinkSync(h.root, path.join(h.source, 'escape'));
  await assert.rejects(h.call('read', { path: 'escape/actions.txt' }));
  const blocked = createSelfEdit({ runtimeDir: h.runtime,
    config: { ...h.config, main_dsh_paths: [h.source] } });
  await assert.rejects(blocked.execute('start', {}, caller), /主线/);
});

test('直接检查打包重启成功，记录结束并可开始新会话', async t => {
  const h = await fixture(t);
  await h.call('start');
  await h.call('write', { path: 'app.txt', text: 'better' });
  assert.equal((await h.call('check')).change.checks[0].ok, true);
  assert.equal((await h.call('build')).change.build.ok, true);
  const result = await h.call('restart');
  assert.equal(result.change.status, 'restarting');
  const end = await h.settled(result.change.id);
  assert.equal(end.status, 'healthy', JSON.stringify(end));
  assert.equal(end.fileCount, 1);
  assert.ok(h.notices.length > 0);
  assert.notEqual((await h.call('start')).change.id, result.change.id);
});

test('健康检查失败自动退回，保留坏版本历史与通知，一键退回可重试', async t => {
  const h = await fixture(t);
  await h.call('start');
  await h.call('write', { path: 'app.txt', text: 'bad' });
  const result = await h.call('restart');
  const end = await h.settled(result.change.id);
  assert.equal(end.status, 'rolled_back', JSON.stringify(end));
  assert.equal(fs.readFileSync(path.join(h.source, 'app.txt'), 'utf8'), 'good');
  assert.ok(git(h.source, 'log', '--oneline').split('\n').length >= 5);
  assert.match(end.reason, /已退回/);
  assert.ok(h.notices.some(row => row.text.includes('已退回')));
  const log = await h.core.log();
  const restored = await h.core.restore(log.restorePoints[0].id);
  const duplicate = await h.core.restore(log.restorePoints[0].id);
  assert.equal(restored.change.id, duplicate.change.id);
  assert.equal((await h.settled(restored.change.id)).status, 'restored');
  const afterRestore = (await h.core.log()).restorePoints;
  assert.deepEqual(afterRestore.slice(0, log.restorePoints.length), log.restorePoints);
  assert.equal(afterRestore.length, log.restorePoints.length + 1);
});

test('救援 list/restore 在 BFF 停着时可运行，纯配置与独立脚本即可', async t => {
  const h = await fixture(t);
  await h.call('start');
  await h.call('write', { path: 'app.txt', text: 'bad' });
  const point = (await h.core.log()).restorePoints[0];
  const rescue = path.join(h.runtime, 'self-edit', 'rescue.mjs');
  const env = path.join(h.runtime, 'self-edit', 'rescue.env');
  const list = await run([process.execPath, rescue, '--config', env, 'list'], { cwd: h.root });
  assert.equal(list.ok, true);
  assert.equal(JSON.parse(list.output)[0].id, point.id);
  const restored = await run([process.execPath, rescue, '--config', env, 'restore', point.id], { cwd: h.root });
  assert.equal(restored.ok, true, restored.output);
  assert.equal(JSON.parse(restored.output).status, 'restored');
  assert.equal(fs.readFileSync(path.join(h.source, 'app.txt'), 'utf8'), 'good');
});

test('关闭时人话说明，命令超时与输出截断', async t => {
  const h = await fixture(t, { enabled: false });
  await assert.rejects(h.call('start'), /还没开通/);
  const timed = await run([process.execPath, '-e', 'setTimeout(()=>{},10000)'], {
    cwd: h.root, timeoutMs: 30,
  });
  assert.equal(timed.timedOut, true);
  const output = await run([process.execPath, '-e', 'console.log("a".repeat(20000))'], { cwd: h.root });
  assert.equal(output.truncated, true);
  assert.equal(output.output.length, 8192);
});

test('已跟踪的数据和令牌从新还原点树排除，文件保留', async t => {
  const h = await fixture(t);
  fs.writeFileSync(path.join(h.source, '.env'), 'SYNTHETIC=fixture');
  git(h.source, 'add', '.env');
  git(h.source, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'fixture');
  await h.call('start');
  await h.call('write', { path: 'app.txt', text: 'better' });
  const point = (await h.core.log()).restorePoints[0];
  assert.ok(!git(h.source, 'ls-tree', '--name-only', point.commit).includes('.env'));
  assert.equal(fs.readFileSync(path.join(h.source, '.env'), 'utf8'), 'SYNTHETIC=fixture');
});

test('敏感路径要求两步确认，写入凭据的文件自动退出源码快照并在重启后继续排除', async t => {
  const h = await fixture(t);
  await h.call('start');
  for (const name of ['policy.mjs', 'permission-mode.mjs', 'board-tokens.mjs', '.env']) {
    const review = await h.core.review('write', {path: name, text: 'example'}, caller);
    assert.equal(review.confirmationTotal, 2);
    assert.deepEqual(review.targets, [name]);
    assert.equal(review.targetCount, 1);
  }
  const content = 'token=synthetic-test-value';
  const review = await h.core.review('write', {path: 'app.txt', text: content}, caller);
  assert.equal(review.confirmationTotal, 2);
  await h.call('write', {path: 'app.txt', text: content});
  const point = (await h.core.log()).restorePoints[0];
  assert.equal(git(h.source, 'ls-tree', '--name-only', point.commit).includes('app.txt'), false);
  assert.equal((await h.call('read', {path: 'app.txt'})).text.includes('synthetic-test-value'), false);
  await h.call('finish');
  const recovered = createSelfEdit({config: h.config, runtimeDir: h.runtime});
  await recovered.execute('start', {}, caller);
  await recovered.execute('write', {path: 'new.txt', text: 'ordinary'}, caller);
  const latest = (await recovered.log()).restorePoints.at(-1);
  assert.equal(git(h.source, 'ls-tree', '--name-only', latest.commit).includes('app.txt'), false);
});


test('健康检查只访问本机 HTTP，不跟重定向，凭据只读私有普通文件', async t => {
  const h = await fixture(t);
  const key = path.join(h.root, 'health-key');
  fs.writeFileSync(key, 'synthetic-health-key', { mode: 0o600 });
  let received = 0;
  let redirected = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/bff/health') {
      received += 1;
      assert.equal(request.headers['x-hub-bff-key'], 'synthetic-health-key');
      response.writeHead(302, { location: '/leak' });
      response.end();
    } else {
      redirected += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const config = { health_url: base + '/bff/health', health_key_file: key };
  assert.equal((await health(config)).ok, false);
  assert.equal(received, 1);
  assert.equal(redirected, 0);
  for (const health_url of [base + '/bff/health?extra=1', base + '/bff/health#hash',
    base.replace('http://', 'http://someone@') + '/bff/health', 'http://127.0.0.1:3081/bff/health',
    'https://127.0.0.1/bff/health', 'http://192.0.2.1/bff/health']) {
    assert.equal((await health({ ...config, health_url })).ok, false);
  }
  fs.chmodSync(key, 0o644);
  assert.equal((await health(config)).ok, false);
  fs.chmodSync(key, 0o600);
  const link = path.join(h.root, 'health-link');
  fs.symlinkSync(key, link);
  assert.equal((await health({ ...config, health_key_file: link })).ok, false);
  fs.writeFileSync(key, 'x'.repeat(4097));
  assert.equal((await health(config)).ok, false);
  assert.equal(received, 1);
  assert.equal(JSON.stringify(await health(config)).includes('synthetic-health-key'), false);
});

test('还原前检查所有父路径，目录被换成链接时不会删除源码外的文件', async t => {
  const h = await fixture(t);
  const base = git(h.source, 'rev-parse', 'HEAD');
  const nested = path.join(h.source, 'nested');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'file.txt'), 'source');
  git(h.source, 'add', 'nested/file.txt');
  git(h.source, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'nested');
  const before = git(h.source, 'rev-parse', 'HEAD');
  const outside = path.join(h.root, 'outside');
  fs.mkdirSync(outside);
  const preserved = path.join(outside, 'file.txt');
  fs.writeFileSync(preserved, 'must preserve');
  fs.unlinkSync(path.join(nested, 'file.txt'));
  fs.rmdirSync(nested);
  fs.symlinkSync(outside, nested);
  await assert.rejects(restoreTree({ ...h.config, runtime_dir: path.join(h.runtime, 'self-edit') },
    { id: 'before-nested', commit: base }), /符号链接/);
  assert.equal(fs.readFileSync(preserved, 'utf8'), 'must preserve');
  assert.equal(git(h.source, 'rev-parse', 'HEAD'), before);
});

test('手动退回到坏版本失败时恢复退回前的版本，并追加保底还原点', async t => {
  const h = await fixture(t);
  fs.writeFileSync(path.join(h.source, 'app.txt'), 'bad');
  await h.call('start');
  await h.call('write', { path: 'app.txt', text: 'good' });
  const applied = await h.call('restart');
  assert.equal((await h.settled(applied.change.id)).status, 'healthy');
  const original = (await h.core.log()).restorePoints;
  const requested = await h.core.restore(original[0].id);
  const result = await h.settled(requested.change.id);
  assert.equal(result.status, 'rolled_back', JSON.stringify(result));
  assert.match(result.reason, /恢复到退回之前/);
  assert.equal(fs.readFileSync(path.join(h.source, 'app.txt'), 'utf8'), 'good');
  const after = (await h.core.log()).restorePoints;
  assert.equal(after.length, original.length + 1);
  assert.deepEqual(after.slice(0, original.length), original);
  assert.equal(after.at(-1).id, result.fallbackRestorePointId);
  assert.equal(git(h.source, 'show', after.at(-1).commit + ':app.txt'), 'good');
});
