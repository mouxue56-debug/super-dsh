import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../bin/hub-board.mjs';

const env = { HUB_BOARD_URL: 'http://localhost/board', HUB_BOARD_TOKEN: 'dsb_test_secret' };
const mine = (id, createdAt, extra = {}) => ({
  id, createdAt, state: 'queued', claimedBy: null, to: ['agent-a'], title: id, goal: '做这一张', ...extra,
});

function harness(reply) {
  const requests = [];
  const io = {
    out: '',
    err: '',
    stdout: { write(text) { io.out += text; } },
    stderr: { write(text) { io.err += text; } },
    fetch: async (url, options) => {
      const parsed = new URL(url);
      const req = {
        url: parsed.pathname + parsed.search,
        method: options.method,
        auth: options.headers.Authorization,
        body: options.body ? JSON.parse(options.body) : undefined,
      };
      requests.push(req);
      return reply(req, requests);
    },
  };
  return { io, requests };
}

function ok(payload, status = 200) {
  return { ok: true, status, json: async () => payload };
}

test('next 只领派给自己、还没人领的最旧一张', async () => {
  const { io, requests } = harness(req => {
    if (req.url === '/board/whoami') return ok({ name: 'agent-a', scope: 'work' });
    if (req.method === 'GET') {
      return ok({
        tickets: [
          mine('T-20261118-000002-bbbb', '2026-11-18T00:00:02.000Z'),
          { ...mine('T-20261118-000000-aaaa', '2026-11-18T00:00:00.000Z'), goal: env.HUB_BOARD_TOKEN },
          { ...mine('T-20261118-000003-cccc', '2026-11-18T00:00:03.000Z'), to: [] },
          { ...mine('T-20261118-000001-dddd', '2026-11-18T00:00:01.000Z'), to: ['agent-b'] },
          { ...mine('T-20261118-000004-eeee', '2026-11-17T00:00:00.000Z'), claimedBy: 'agent-b' },
        ],
      });
    }
    return ok({ ticket: { id: 'T-20261118-000000-aaaa', title: '甲', state: 'progress', to: ['agent-a'], goal: '做' } });
  });
  assert.equal(await main(['next'], env, io), 0);
  assert.equal(requests[2].method, 'POST');
  assert.equal(requests[2].url, '/board/tickets/T-20261118-000000-aaaa/claim');
  assert.equal(requests[2].body, undefined);
  assert.equal(requests[2].auth, `Bearer ${env.HUB_BOARD_TOKEN}`);
  assert.match(io.out, /已领取 T-20261118-000000-aaaa/);
  assert.equal(io.out.includes(env.HUB_BOARD_TOKEN), false);
});

test('next 没有可领的单时退出码 5，且不发领单请求', async () => {
  const open = { ...mine('T-20261118-000000-aaaa', '2026-11-18T00:00:00.000Z'), to: [] };
  const { io, requests } = harness(req => ok(req.url.endsWith('/whoami')
    ? { name: 'agent-a', scope: 'work' } : { tickets: [open] }));
  assert.equal(await main(['next', '--json'], env, io), 5);
  assert.equal(requests.some(req => req.method === 'POST'), false);
  assert.deepEqual(JSON.parse(io.out), { ok: false, reason: 'none' });
});

test('next 认证失败仍是退出码 3，但文案和「没有单」不同', async () => {
  const { io, requests } = harness(() => ({ ok: false, status: 401, json: async () => ({}) }));
  assert.equal(await main(['next'], env, io), 3);
  assert.match(io.err, /HTTP 401/);
  assert.equal(io.out.includes('没有可领的单'), false);
  assert.equal(requests.length, 1);
});

test('watch 超时退出码 3；条件满足时返回匹配的单且不领取', async () => {
  let now = 1000;
  const seen = [];
  const { io, requests } = harness(req => {
    if (req.url.endsWith('/whoami')) return ok({ name: 'agent-a', scope: 'work' });
    seen.push(now);
    const tickets = now >= 1500 ? [
      { ...mine('T-20261118-000000-bbbb', '2026-11-18T00:00:01.000Z'), state: 'progress', project: '其他' },
      { ...mine('T-20261118-000000-aaaa', '2026-11-18T00:00:00.000Z'), state: 'queued', project: '日报', tags: ['日报'] },
      { ...mine('T-20261118-000000-cccc', '2026-11-18T00:00:02.000Z'), to: ['agent-b'], project: '日报' },
    ] : [];
    return ok({ tickets });
  });
  io.now = () => now;
  io.sleep = async ms => { now += ms; };
  const args = ['watch', '--state', 'queued', '--tag', '日报', '--timeout', '1000', '--interval', '500'];
  assert.equal(await main(args, env, io), 0);
  assert.deepEqual(seen, [1000, 1500]);
  assert.match(io.out, /出现符合条件的单/);
  assert.match(io.out, /T-20261118-000000-aaaa/);
  assert.equal(io.out.includes('cccc'), false);
  assert.equal(requests.some(req => req.method === 'POST'), false);
  assert.equal(requests.some(req => req.url.includes('tag=')), false);
  const empty = harness(req => ok(req.url.endsWith('/whoami') ? { name: 'agent-a', scope: 'work' } : { tickets: [] }));
  empty.io.now = () => 0;
  empty.io.sleep = async () => { throw new Error('timeout 0 不应等待'); };
  assert.equal(await main(['watch', '--timeout', '0', '--json'], env, empty.io), 3);
  assert.deepEqual(JSON.parse(empty.io.out), { ok: false, reason: 'timeout' });
});

test('watch 不能改看别人的单，坏参数不发请求', async () => {
  const who = { name: 'agent-a', scope: 'work' };
  const { io, requests } = harness(req => ok(req.url.endsWith('/whoami') ? who : { tickets: [] }));
  assert.equal(await main(['watch', '--assignee', 'agent-b', '--timeout', '0'], env, io), 2);
  assert.match(io.err, /只能看派给自己的单/);
  assert.equal(requests.some(req => req.url.includes('/tickets')), false);
  const bad = harness(() => { throw new Error('不应请求'); });
  assert.equal(await main(['watch', '--state', 'nope'], env, bad.io), 2);
  assert.equal(await main(['next', '--token', env.HUB_BOARD_TOKEN], env, bad.io), 2);
  assert.equal(bad.io.out.includes(env.HUB_BOARD_TOKEN), false);
});

test('report 报进度，done 交四项结果，block 写明要人处理什么', async () => {
  const { io, requests } = harness(() => ok({ ticket: { id: 'T-20261118-000000-aaaa', state: 'progress' } }));
  assert.equal(await main(['report', 'T-20261118-000000-aaaa', '--progress', '10:00 写完接口'], env, io), 0);
  assert.deepEqual(requests.at(-1), {
    url: '/board/tickets/T-20261118-000000-aaaa/progress',
    method: 'POST',
    auth: `Bearer ${env.HUB_BOARD_TOKEN}`,
    body: { text: '10:00 写完接口' },
  });
  assert.match(io.out, /已报进度/);
  const file = harness(() => ok({ ticket: { id: 'T-20261118-000000-aaaa' } }));
  const dir = await mkdtemp(join(tmpdir(), 'r29-board-'));
  const report = join(dir, 'result.md');
  await writeFile(report, '执行者自述\n成果：好了');
  assert.equal(await main(['report', 'T-20261118-000000-aaaa', '--file', report], env, file.io), 0);
  assert.equal(file.requests[0].url, '/board/tickets/T-20261118-000000-aaaa/report');
  assert.equal(file.requests[0].body.summary, '执行者自述\n成果：好了');
  const richTicket = { id: 'T-20261118-000000-aaaa', state: 'progress', title: '甲' };
  const rich = harness(req => ok({ ticket: richTicket }, req.url.endsWith('/done') ? 200 : 201));
  const artifact = join(dir, 'out.txt');
  assert.equal(await main([
    'done', 'T-20261118-000000-aaaa', '--outcome', '改好了', '--checked', '测试 4 过',
    '--unchecked', '没跑全量', '--artifact', artifact,
  ], env, rich.io), 0);
  const full = `执行者自述\n成果：改好了\n怎么验的：测试 4 过\n没验的：没跑全量\n产物在哪：${artifact}`;
  assert.equal(rich.requests[0].url, '/board/tickets/T-20261118-000000-aaaa/report');
  assert.equal(rich.requests[0].body.summary, full);
  assert.equal(rich.requests[0].body.file, artifact);
  assert.deepEqual(rich.requests[0].body.artifacts, [artifact]);
  assert.equal(rich.requests[0].body.sha256, createHash('sha256').update(full).digest('hex'));
  assert.equal(rich.requests[1].url, '/board/tickets/T-20261118-000000-aaaa/done');
  assert.equal(rich.requests[1].body, undefined);
  assert.match(rich.io.out, /已交付/);
  const bare = harness(() => ok({ ticket: { id: 'T-20261118-000000-aaaa' } }));
  assert.equal(await main(['done', 'T-20261118-000000-aaaa'], env, bare.io), 0);
  assert.equal(bare.requests.length, 1);
  assert.equal(bare.requests[0].url, '/board/tickets/T-20261118-000000-aaaa/done');
  const blocked = harness(() => ok({ ticket: { id: 'T-20261118-000000-aaaa', state: 'waiting-human' } }));
  assert.equal(await main(['block', 'T-20261118-000000-aaaa', '缺权限，请人补上再继续', '--wait-human'], env, blocked.io), 0);
  assert.deepEqual(blocked.requests[0].body, { reason: '缺权限，请人补上再继续', waitHuman: true });
});

test('交结果如果报告失败，就不再调用 done', async () => {
  const { io, requests } = harness(() => ({ ok: false, status: 403, json: async () => ({}) }));
  assert.equal(await main([
    'done', 'T-20261118-000000-aaaa', '--outcome', '甲', '--checked', '乙', '--unchecked', '丙', '--artifact', 'out.txt',
  ], env, io), 3);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.endsWith('/report'), true);
});

test('四项没写全是用法错误，不发请求', async () => {
  const { io, requests } = harness(() => { throw new Error('不应请求'); });
  assert.equal(await main(['done', 'T-20261118-000000-aaaa', '--outcome', '只有成果'], env, io), 2);
  assert.equal(requests.length, 0);
  assert.match(io.err, /Usage:/);
});

test('next 可从权限 0600 的配置读令牌，0644 拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r29-board-cfg-'));
  const config = join(dir, 'hub-board.json');
  await writeFile(config, JSON.stringify({ url: env.HUB_BOARD_URL, token: env.HUB_BOARD_TOKEN }), { mode: 0o600 });
  const { io, requests } = harness(req => ok(req.url.endsWith('/whoami')
    ? { name: 'agent-a', scope: 'work' } : { tickets: [] }));
  assert.equal(await main(['next'], { HUB_BOARD_CONFIG: config }, io), 5);
  assert.equal(requests[0].auth, `Bearer ${env.HUB_BOARD_TOKEN}`);
  await chmod(config, 0o644);
  const rejected = harness(() => { throw new Error('不应请求'); });
  assert.equal(await main(['next'], { HUB_BOARD_CONFIG: config }, rejected.io), 2);
});
