import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, main, normalizeRules } from '../lib/board-triggers.mjs';

const env = { HUB_BOARD_URL: 'http://localhost/board', HUB_BOARD_TOKEN: 'dsb_trigger_secret' };
const at = Date.parse('2026-11-18T09:00:30.000Z');

function rules(list, extra = {}) {
  return { version: 1, ...extra, rules: list };
}

function ticket(key, to = ['agent-a']) {
  return { title: '跟进', goal: '请处理', to, key, project: '日报' };
}

function harness(reply) {
  const requests = [];
  const io = {
    out: '',
    err: '',
    now: () => at,
    stdout: { write(text) { io.out += text; } },
    stderr: { write(text) { io.err += text; } },
    fetch: async (url, options) => {
      const parsed = new URL(url);
      const req = {
        path: parsed.pathname,
        method: options.method,
        body: options.body ? JSON.parse(options.body) : undefined,
      };
      requests.push(req);
      return reply(req);
    },
  };
  return { io, requests };
}

function ok(payload, status = 200) {
  return { ok: true, status, json: async () => payload };
}

async function run(dir, body, io) {
  const file = join(dir, 'rules.json');
  await writeFile(file, JSON.stringify(body));
  const code = await main(['--rules', file], env, io);
  return { code, file };
}

test('四种条件：超时未领、被阻断、每天到点、新文件', async () => {
  const old = '2026-11-18T07:00:30.000Z';
  const young = '2026-11-18T08:30:31.000Z';
  const normalized = normalizeRules(rules([
    {
      id: 'late',
      when: { kind: 'unclaimed', olderThan: '2h', state: 'queued', project: '日报' },
      ticket: ticket('late'),
    },
    { id: 'stuck', when: { kind: 'blocked', id: 'T-20261118-000000-bbbb' }, ticket: ticket('stuck') },
  ]));
  const late = decide(normalized[0], {
    now: at,
    tickets: [
      { state: 'queued', claimedBy: null, project: '日报', to: ['agent-a'], createdAt: young },
      { state: 'queued', claimedBy: 'agent-a', project: '日报', to: ['agent-a'], createdAt: old },
      { state: 'queued', claimedBy: null, project: '其他', to: ['agent-a'], createdAt: old },
      { state: 'queued', claimedBy: null, project: '日报', to: ['agent-a'], createdAt: old },
    ],
  });
  assert.equal(late.fire, true);
  assert.equal(late.key, 'late');
  assert.equal(decide(normalized[0], {
    now: at,
    tickets: [{ state: 'queued', claimedBy: null, project: '日报', to: ['agent-a'], createdAt: young }],
  }).fire, false);
  assert.equal(decide(normalized[1], {
    now: at,
    tickets: [{ id: 'T-20261118-000000-cccc', state: 'blocked' }],
  }).fire, false);
  assert.equal(decide(normalized[1], {
    now: at,
    tickets: [{ id: 'T-20261118-000000-bbbb', state: 'waiting-human' }],
  }).fire, true);
  assert.equal(decide(normalized[1], {
    now: at,
    tickets: [{ id: 'T-20261118-000000-bbbb', state: 'failed' }],
  }).fire, false);
  const daily = normalizeRules(rules([
    { id: 'morning', when: { kind: 'daily', at: '09:00' }, ticket: ticket('morning') },
  ]))[0];
  assert.equal(decide(daily, { now: at }).key, 'morning.2026-11-18');
  assert.equal(decide(daily, { now: Date.parse('2026-11-18T09:01:00.000Z') }).fire, false);
  const fresh = normalizeRules(rules([
    { id: 'inbox', when: { kind: 'new-file', dir: 'inbox', suffix: '.txt' }, ticket: ticket('inbox') },
  ]))[0];
  assert.equal(decide(fresh, { available: true, seen: null, current: ['a.txt'] }).reason, '建立基线');
  const second = decide(fresh, { available: true, seen: ['a.txt'], current: ['a.txt', 'b.txt'] });
  assert.equal(second.fire, true);
  assert.match(second.goal, /b\.txt/);
  assert.equal(decide(fresh, { available: true, seen: ['a.txt', 'b.txt'], current: ['a.txt', 'b.txt'] }).fire, false);

  const dir = await mkdtemp(join(tmpdir(), 'r29-trigger-'));
  const posts = [];
  const { io, requests } = harness(req => {
    if (req.path.endsWith('/whoami')) return ok({ name: 'agent-a', scope: 'work+create' });
    if (req.method === 'GET') {
      return ok({
        tickets: [
          { state: 'queued', claimedBy: null, project: '日报', to: ['agent-a'], createdAt: old },
          { id: 'T-20261118-000000-bbbb', state: 'blocked', project: '日报' },
        ],
      });
    }
    posts.push(req.body);
    return ok({ ticket: { id: 'T-20261118-010101-zzzz' } }, 201);
  });
  const { code } = await run(dir, rules([
    { id: 'late', when: { kind: 'unclaimed', olderThanMs: 7200000, project: '日报' }, ticket: ticket('late') },
    { id: 'stuck', when: { kind: 'blocked' }, ticket: ticket('stuck') },
    { id: 'morning', when: { kind: 'daily', at: '09:00' }, ticket: ticket('morning') },
  ]), io);
  assert.equal(code, 0);
  assert.deepEqual(requests.map(req => req.method), ['GET', 'GET', 'POST', 'POST', 'POST']);
  assert.deepEqual(posts.map(body => body.key), ['late', 'stuck', 'morning.2026-11-18']);
  assert.equal(posts.every(body => !body.command && !body.from && !body.to.includes('owner')), true);
  assert.match(io.out, /late：建单/);
});

test('新文件第一次只记基线，之后只为新文件建一张单', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r29-inbox-'));
  const inbox = join(dir, 'inbox');
  await mkdir(inbox);
  await writeFile(join(inbox, 'a.txt'), 'old');
  await writeFile(join(inbox, 'skip.dat'), 'no');
  await symlink(join(inbox, 'a.txt'), join(inbox, 'link.txt'));
  const body = rules([{
    id: 'inbox',
    when: { kind: 'new-file', dir: inbox, suffix: '.txt' },
    ticket: ticket('inbox'),
  }]);
  const file = join(dir, 'rules.json');
  await writeFile(file, JSON.stringify(body));
  const posts = () => {
    const seen = [];
    const io = harness(req => {
      if (req.path.endsWith('/whoami')) return ok({ name: 'agent-a', scope: 'work+create' });
      if (req.method === 'POST') seen.push(req.body);
      return ok({ ticket: { id: 'T-20261118-010101-zzzz' } }, req.method === 'POST' ? 201 : 200);
    });
    return { ...io, seen };
  };
  const first = posts();
  assert.equal(await main(['--rules', file, '--state', join(dir, 'seen.json')], env, first.io), 0);
  assert.equal(first.seen.length, 0);
  assert.match(first.io.out, /建立基线/);
  const saved = JSON.parse(await readFile(join(dir, 'seen.json'), 'utf8'));
  assert.deepEqual(saved.files[inbox], ['a.txt']);
  assert.equal((await lstat(join(dir, 'seen.json'))).mode & 0o777, 0o600);
  await writeFile(join(inbox, 'b.txt'), 'new');
  const second = posts();
  assert.equal(await main(['--rules', file, '--state', join(dir, 'seen.json')], env, second.io), 0);
  assert.equal(second.seen.length, 1);
  assert.match(second.seen[0].goal, /b\.txt/);
  assert.equal(second.seen[0].goal.includes('a.txt'), false);
  assert.equal(second.requests.every(req => req.path.endsWith('/whoami') || req.path.endsWith('/tickets')), true);
  assert.equal(second.requests.some(req => req.path.endsWith('/claim') || req.path.endsWith('/done')), false);
  const third = posts();
  assert.equal(await main(['--rules', file, '--state', join(dir, 'seen.json')], env, third.io), 0);
  assert.equal(third.seen.length, 0);
  assert.match(third.io.out, /没有新文件/);
});

test('目录不存在或是链接时不建单，也不把基线写成空', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r29-missing-'));
  const link = join(dir, 'linked');
  await symlink(dir, link);
  const file = join(dir, 'rules.json');
  await writeFile(file, JSON.stringify(rules([
    { id: 'gone', when: { kind: 'new-file', dir: join(dir, 'nope') }, ticket: ticket('gone') },
    { id: 'link', when: { kind: 'new-file', dir: link }, ticket: ticket('link') },
  ])));
  const who = { name: 'agent-a', scope: 'work+create' };
  const { io, requests } = harness(req => ok(req.path.endsWith('/whoami') ? who : {}));
  assert.equal(await main(['--rules', file], env, io), 0);
  assert.equal(requests.some(req => req.method === 'POST'), false);
  assert.match(io.out, /gone：未触发（目录不可用）/);
  assert.match(io.out, /link：未触发（目录不可用）/);
});

test('坏规则、令牌参数和过宽的配置文件都不发请求', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r29-bad-'));
  const file = join(dir, 'rules.json');
  const { io, requests } = harness(() => { throw new Error('不应请求'); });
  await writeFile(file, JSON.stringify(rules([
    { id: 'bad', when: { kind: 'unclaimed', olderThan: '1h' }, ticket: ticket('bad', ['owner']) },
  ])));
  assert.equal(await main(['--rules', file], env, io), 2);
  await writeFile(file, JSON.stringify(rules([
    { id: 'run', when: { kind: 'daily', at: '09:00' }, ticket: ticket('run'), command: 'do-it' },
  ])));
  assert.equal(await main(['--rules', file, '--token', 'dsb_trigger_secret'], env, io), 2);
  assert.equal(io.err.includes('dsb_trigger_secret'), false);
  const config = join(dir, 'config.json');
  await writeFile(config, JSON.stringify({ url: env.HUB_BOARD_URL, token: env.HUB_BOARD_TOKEN }), { mode: 0o644 });
  await writeFile(file, JSON.stringify(rules([
    { id: 'morning', when: { kind: 'daily', at: '09:00' }, ticket: ticket('morning') },
  ])));
  assert.equal(await main(['--rules', file], { HUB_BOARD_CONFIG: config }, io), 2);
  assert.equal(requests.length, 0);
  const sneaky = {
    version: 1,
    rules: [{ id: 'x', when: { kind: 'daily', at: '09:00', exec: '1' }, ticket: ticket('x') }],
  };
  assert.throws(() => normalizeRules(sneaky));
});

test('建单被拒绝时退出码 3，不把令牌写出来', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r29-auth-'));
  const file = join(dir, 'rules.json');
  await writeFile(file, JSON.stringify(rules([
    { id: 'morning', when: { kind: 'daily', at: '09:00' }, ticket: ticket('morning') },
  ])));
  const { io } = harness(() => ({ ok: false, status: 403, json: async () => ({ error: env.HUB_BOARD_TOKEN }) }));
  assert.equal(await main(['--rules', file, '--json'], env, io), 3);
  assert.match(io.err, /HTTP 403/);
  assert.equal(`${io.out}${io.err}`.includes(env.HUB_BOARD_TOKEN), false);
});

test('同一天再次到点会走幂等键，输出已有单', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r29-dedupe-'));
  const file = join(dir, 'rules.json');
  await writeFile(file, JSON.stringify(rules([
    { id: 'morning', when: { kind: 'daily', at: '09:00' }, ticket: ticket('morning') },
  ])));
  const { io, requests } = harness(req => {
    if (req.method === 'GET') return ok({ name: 'agent-a', scope: 'work+create' });
    return ok({ ticket: { id: 'T-20261118-090000-abcd' } }, 200);
  });
  assert.equal(await main(['--rules', file], env, io), 0);
  assert.equal(requests.at(-1).body.key, 'morning.2026-11-18');
  assert.match(io.out, /已有单 T-20261118-090000-abcd/);
});
