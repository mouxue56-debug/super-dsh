import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoard } from '../lib/board.mjs';
import { createBoardHandler } from '../lib/board-http.mjs';
import { issueToken } from '../lib/board-tokens.mjs';
import { main as boardMain } from '../bin/hub-board.mjs';
import { decide, main as triggers, normalizeRules } from '../lib/board-triggers.mjs';

const late = Date.parse('2026-11-18T10:18:00.000Z');
const nextMorning = Date.parse('2026-11-18T23:30:00.000Z');
const utcMinute = Date.parse('2026-11-18T09:00:30.000Z');
const utcLate = Date.parse('2026-11-18T09:01:00.000Z');

function pack(rules) {
  return normalizeRules({ version: 1, rules });
}

function daily(when) {
  return pack([{
    id: 'morning',
    when: { kind: 'daily', at: '09:00', ...when },
    ticket: {
      title: '看一眼', goal: '到点看', to: ['agent-a'], key: 'morning', project: 'day',
    },
  }])[0];
}

test('旧的每日规则仍按 UTC 整分钟，不因实例时区改义', () => {
  const rule = daily();
  const ctx = { utcOffsetMinutes: 540, timeZone: 'Asia/Tokyo' };
  assert.equal(decide(rule, { now: utcMinute, ...ctx }).key, 'morning.2026-11-18');
  assert.equal(decide(rule, { now: utcLate, ...ctx }).fire, false);
  const pinned = daily({ tz: 'UTC' });
  assert.equal(decide(pinned, { now: utcLate, ...ctx }).fire, false);
  const catchUp = daily({ tz: 'UTC', catchUp: true });
  assert.equal(decide(catchUp, { now: utcLate }).key, 'morning.2026-11-18');
  assert.equal(decide(catchUp, { now: Date.parse('2026-11-19T08:00:00.000Z') }).fire, false);
});

test('实例时区当天补一次，跨日不补，关闭补跑则过点不响', () => {
  const rule = daily({ tz: 'instance' });
  const hit = decide(rule, { now: late, utcOffsetMinutes: 540 });
  assert.equal(hit.fire, true);
  assert.equal(hit.key, 'morning.2026-11-18');
  assert.equal(hit.reason, '错过整点，当天补一次');
  assert.equal(decide(rule, { now: nextMorning, utcOffsetMinutes: 540 }).fire, false);
  assert.equal(decide(rule, { now: late }).reason, '没有实例时区');
  const exact = decide(rule, { now: Date.parse('2026-11-18T00:01:00.000Z'), timeZone: 'Asia/Tokyo' });
  assert.equal(exact.key, 'morning.2026-11-18');
  const quiet = daily({ tz: 'instance', catchUp: false });
  const localNine = Date.parse('2026-11-18T00:00:30.000Z');
  assert.equal(decide(quiet, { now: late, timeZone: 'Asia/Tokyo' }).fire, false);
  assert.equal(decide(quiet, { now: localNine, timeZone: 'Asia/Tokyo' }).fire, true);
  assert.throws(() => daily({ tz: 'local' }));
});

test('缺主人信息才进待回答，阻断和规则自己的单都不算', () => {
  const rule = pack([{
    id: 'ask',
    when: { kind: 'needs-owner' },
    ticket: {
      title: '待回答', goal: '看清问题', to: ['agent-a'], key: 'ask', project: 'ask',
    },
  }])[0];
  const ask = {
    id: 'T-20261118-000000-bbbb',
    state: 'waiting-human',
    open_ask: { text: '按周五还是周一？', ts: '2026-11-18T01:00:00.000Z' },
    from: { name: 'maker' },
  };
  const second = {
    ...ask,
    id: 'T-20261118-000000-cccc',
    open_ask: { text: '用哪一版？', ts: '2026-11-18T01:00:00.000Z' },
  };
  const decision = decide(rule, {
    self: 'rules',
    tickets: [
      { id: 'T-20261118-000000-dddd', state: 'blocked', open_ask: null },
      { id: 'T-20261118-000000-eeee', state: 'waiting-human', open_ask: null },
      {
        id: 'T-20261118-000000-ffff',
        state: 'waiting-human',
        open_ask: { text: '自己产生的', ts: '2026-11-18T01:00:00.000Z' },
        from: { name: 'rules' },
      },
      second,
      ask,
    ],
  });
  assert.equal(decision.fire, true);
  assert.deepEqual(decision.items.map(item => item.key), [
    'ask.T-20261118-000000-bbbb',
    'ask.T-20261118-000000-cccc',
  ]);
  assert.match(decision.items[0].goal, /待回答：T-20261118-000000-bbbb 按周五还是周一？/);
  const unclaimed = pack([{
    id: 'late',
    when: { kind: 'unclaimed', olderThan: '1h' },
    ticket: { title: '跟进', goal: '请处理', to: ['agent-a'], key: 'late', project: 'ops' },
  }])[0];
  const old = '2026-11-18T01:00:00.000Z';
  const mine = {
    state: 'queued', claimedBy: null, project: '', to: ['agent-a'], createdAt: old, from: { name: 'rules' },
  };
  assert.equal(decide(unclaimed, { now: utcMinute, self: 'rules', tickets: [mine] }).fire, false);
});

test('样例规则能通过校验，安装配置里的时区会驱动 instance', async () => {
  const samplePath = fileURLToPath(new URL(
    '../../../integrations/examples/board-triggers.sample.json',
    import.meta.url,
  ));
  const sample = JSON.parse(await readFile(samplePath, 'utf8'));
  const rules = normalizeRules(sample);
  assert.equal(rules.find(rule => rule.id === 'morning').when.tz, 'instance');
  assert.equal(rules.some(rule => rule.when.kind === 'needs-owner'), true);
  const dir = await mkdtemp(join(tmpdir(), 'r29b-zone-'));
  await writeFile(join(dir, 'hub.yaml'), 'timezone: "Asia/Tokyo"\n');
  const file = join(dir, 'rules.json');
  await writeFile(file, JSON.stringify({
    version: 1,
    rules: [{
      id: 'morning',
      when: { kind: 'daily', at: '09:00', tz: 'instance' },
      ticket: { title: '看一眼', goal: '到点看', to: ['agent-a'], key: 'morning', project: 'day' },
    }],
  }));
  const seen = [];
  const io = {
    now: () => Date.parse('2026-11-18T00:00:30.000Z'),
    stdout: { write(text) { io.out += text; } },
    stderr: { write(text) { io.err += text; } },
    out: '',
    err: '',
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      seen.push(options.method + path);
      if (path.endsWith('/whoami')) {
        return { ok: true, status: 200, json: async () => ({ name: 'rules', scope: 'work+create' }) };
      }
      return {
        ok: true, status: 201, json: async () => ({ ticket: { id: 'T-20261118-000000-abcd' } }),
      };
    },
  };
  const env = {
    HUB_BOARD_URL: 'http://127.0.0.1:9/board',
    HUB_BOARD_TOKEN: 'dsb_zone_secret',
    HUB_CONFIG_DIR: dir,
  };
  assert.equal(await triggers(['--rules', file], env, io), 0);
  assert.equal(seen.at(-1).startsWith('POST'), true);
  assert.match(io.out, /morning：建单/);
  const panic = join(dir, 'panic');
  await mkdir(panic);
  await writeFile(join(panic, 'stopped.flag'), '{}\n');
  const stopped = {
    stdout: { write(text) { stopped.out += text; } },
    stderr: { write(text) { stopped.err += text; } },
    out: '',
    err: '',
    fetch: async () => { throw new Error('全停不应请求'); },
  };
  const code = await triggers(['--rules', file], { ...env, HUB_PANIC_DIR: panic }, stopped);
  assert.equal(code, 0);
  assert.match(stopped.out, /已一键全停/);
  assert.equal(`${stopped.out}${stopped.err}`.includes(env.HUB_BOARD_TOKEN), false);
});

function capture() {
  const io = { out: '', err: '' };
  io.stdout = { write(text) { io.out += text; } };
  io.stderr = { write(text) { io.err += text; } };
  return io;
}

async function listen(server) {
  let last;
  for (const port of [3705, 3706]) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => {
          server.removeListener('listening', onOk);
          reject(error);
        };
        const onOk = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onOk);
        server.listen(port, '127.0.0.1');
      });
      return port;
    } catch (error) {
      last = error;
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw last;
}

async function api(port, method, path, token, body) {
  const response = await fetch(`http://127.0.0.1:${port}/board${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, payload: await response.json() };
}

async function cli(port, args, token, extra = {}) {
  const io = capture();
  const code = await boardMain(args, {
    HUB_BOARD_URL: `http://127.0.0.1:${port}/board`,
    HUB_BOARD_TOKEN: token,
    ...extra,
  }, io);
  return { code, out: io.out, err: io.err };
}

async function runRules(port, token, file, extra = {}, ioExtra = {}) {
  const io = capture();
  Object.assign(io, ioExtra);
  const code = await triggers(['--rules', file], {
    HUB_BOARD_URL: `http://127.0.0.1:${port}/board`,
    HUB_BOARD_TOKEN: token,
    ...extra,
  }, io);
  return { code, out: io.out, err: io.err };
}

test('两个模拟身份领单交回，双跑和全停只维持应有的单', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r29b-claim-'));
  const configDir = await mkdtemp(join(tmpdir(), 'r29b-token-'));
  const board = createBoard({ root: join(dir, 'board'), reservedNames: ['owner'] });
  const handler = createBoardHandler({ board, configDir, reservedNames: () => ['owner'] });
  const server = createServer((req, res) => { handler(req, res); });
  let port = 0;
  try {
    port = await listen(server);
    assert.ok(port === 3705 || port === 3706);
    const issue = (name, scope) => issueToken(configDir, { name, scope, reserved: ['owner'] });
    const maker = (await issue('maker', 'work+create')).token;
    const agentA = (await issue('agent-a', 'work')).token;
    const agentB = (await issue('agent-b', 'work')).token;
    const rules = (await issue('rules', 'work+create')).token;
    const created = await api(port, 'POST', '/tickets', maker, {
      title: '整理这一张', goal: '只交给 agent-a', to: ['agent-a'], project: 'loop',
    });
    assert.equal(created.status, 201);
    const id = created.payload.ticket.id;
    const skipped = await cli(port, ['next'], agentB);
    assert.equal(skipped.code, 5);
    assert.match(skipped.out, /没有可领的单/);
    assert.equal((await board.get(id)).claimedBy, null);
    const claimed = await cli(port, ['next'], agentA);
    assert.equal(claimed.code, 0, claimed.err);
    assert.equal((await board.get(id)).claimedBy, 'agent-a');
    assert.equal((await board.get(id)).state, 'progress');
    const progress = await cli(port, ['report', id, '--progress', '09:10 已开始整理'], agentA);
    assert.equal(progress.code, 0, progress.err);
    const shown = JSON.parse((await cli(port, ['show', id], maker)).out);
    assert.match(shown.ticket.progress.at(-1).text, /09:10 已开始整理/);
    const artifact = join(dir, 'out.txt');
    await writeFile(artifact, '结果\n');
    const handed = await cli(port, [
      'done', id, '--outcome', '整理完', '--checked', '看了进度',
      '--unchecked', '没上线', '--artifact', artifact,
    ], agentA);
    assert.equal(handed.code, 0, handed.err);
    const pending = await board.get(id);
    assert.equal(pending.review, 'submitted');
    assert.notEqual(pending.state, 'completed');
    assert.equal((await cli(port, ['accept', id], agentA)).code, 3);
    assert.notEqual((await board.get(id)).state, 'completed');
    const accepted = await cli(port, ['accept', id], maker);
    assert.equal(accepted.code, 0, accepted.err);
    assert.equal((await board.get(id)).state, 'completed');
    assert.equal((await board.get(id)).review, 'accepted');

    const inbox = join(dir, 'inbox');
    await mkdir(inbox);
    await writeFile(join(inbox, 'old.txt'), '旧');
    const fileRule = await writeRules(dir, 'files.json', [{
      id: 'files',
      when: { kind: 'new-file', dir: inbox, suffix: '.txt' },
      ticket: {
        title: '整理新文件', goal: '只处理新文件', to: ['agent-a'], key: 'files', project: 'files',
      },
    }]);
    const firstScan = await runRules(port, rules, fileRule);
    assert.equal(firstScan.code, 0, firstScan.err);
    assert.match(firstScan.out, /建立基线/);
    assert.equal((await board.list()).some(ticket => ticket.project === 'files'), false);
    await writeFile(join(inbox, 'new.txt'), '新');
    const secondScan = await runRules(port, rules, fileRule, {}, {});
    assert.equal(secondScan.code, 0, secondScan.err);
    const filed = (await board.list()).filter(ticket => ticket.project === 'files');
    assert.equal(filed.length, 1);
    assert.match(filed[0].goal, /new\.txt/);
    assert.equal(filed[0].goal.includes('old.txt'), false);
    const thirdScan = await runRules(port, rules, fileRule, {}, {});
    assert.equal((await board.list()).filter(ticket => ticket.project === 'files').length, 1);
    assert.match(thirdScan.out, /没有新文件/);

    // 规则身份只看得到自己发起或名下的卡，所以「缺信息」的来源卡把 rules 也列为负责人之一才看得到。
    const source = await api(port, 'POST', '/tickets', maker, {
      title: '缺一个日期', goal: '要主人选', to: ['agent-a', 'rules'], project: 'src',
    });
    const sourceId = source.payload.ticket.id;
    assert.equal((await cli(port, ['claim', sourceId], agentA)).code, 0);
    const blocked = await cli(port, ['block', sourceId, '按周五还是周一交？', '--wait-human'], agentA);
    assert.equal(blocked.code, 0, blocked.err);
    assert.equal((await board.get(sourceId)).state, 'waiting-human');
    const plain = await api(port, 'POST', '/tickets', maker, {
      title: '编译失败', goal: '不是缺信息', to: ['agent-a', 'rules'], project: 'src',
    });
    assert.equal((await cli(port, ['claim', plain.payload.ticket.id], agentA)).code, 0);
    assert.equal((await cli(port, ['block', plain.payload.ticket.id, '编译失败'], agentA)).code, 0);
    const own = await board.create(
      { name: 'rules', type: 'external' },
      { title: '规则自己的', goal: '不要再生', to: ['rules'], project: 'src' },
    );
    await board.claim({ name: 'rules', type: 'external' }, own.id);
    await board.block(
      { name: 'rules', type: 'external' }, own.id, '这是规则自己的问题', { waitHuman: true },
    );
    const askRule = await writeRules(dir, 'ask.json', [{
      id: 'ask',
      when: { kind: 'needs-owner' },
      ticket: { title: '待回答', goal: '看清问题', to: ['agent-a'], key: 'ask', project: 'ask' },
    }]);
    const asked = await runRules(port, rules, askRule);
    assert.equal(asked.code, 0, asked.err);
    const asks = (await board.list()).filter(ticket => ticket.project === 'ask');
    assert.equal(asks.length, 1);
    assert.equal(asks[0].key, `ask.${sourceId}`);
    assert.match(asks[0].goal, /待回答/);
    assert.match(asks[0].goal, /周五/);
    assert.equal((await board.get(sourceId)).state, 'waiting-human');
    const askedAgain = await runRules(port, rules, askRule);
    assert.equal((await board.list()).filter(ticket => ticket.project === 'ask').length, 1);
    assert.match(askedAgain.out, /已有单/);

    const dayRule = await writeRules(dir, 'day.json', [{
      id: 'day',
      when: { kind: 'daily', at: '09:00', tz: 'instance' },
      ticket: { title: '当天这一档', goal: '只建一张', to: ['agent-a'], key: 'daywatch', project: 'day' },
    }]);
    const clock = { utcOffsetMinutes: 540, now: () => late };
    const [left, right] = await Promise.all([
      runRules(port, rules, dayRule, {}, clock),
      runRules(port, rules, dayRule, {}, clock),
    ]);
    assert.equal(left.code, 0, left.err);
    assert.equal(right.code, 0, right.err);
    const days = () => board.list().then(list => list.filter(ticket => ticket.key === 'daywatch.2026-11-18'));
    assert.equal((await days()).length, 1);
    const restarted = await runRules(port, rules, dayRule, {}, clock);
    assert.equal((await days()).length, 1);
    assert.match(restarted.out, /已有单/);
    const crossed = await runRules(port, rules, dayRule, {}, { utcOffsetMinutes: 540, now: () => nextMorning });
    assert.equal(crossed.code, 0, crossed.err);
    assert.match(crossed.out, /未到点/);
    assert.equal((await days()).length, 1);

    const panic = join(dir, 'panic');
    await mkdir(panic);
    await writeFile(join(panic, 'stopped.flag'), '{}\n');
    const fresh = await api(port, 'POST', '/tickets', maker, {
      title: '停着时不要领', goal: '保持未领', to: ['agent-a'], project: 'stop',
    });
    const before = await board.list();
    const halted = await cli(port, ['next'], agentA, { HUB_PANIC_DIR: panic });
    assert.equal(halted.code, 6);
    assert.match(halted.out, /已一键全停，没有领取/);
    const after = await board.list();
    for (const ticket of before) {
      const current = after.find(item => item.id === ticket.id);
      assert.equal(current.claimedBy, ticket.claimedBy);
      assert.equal(current.state, ticket.state);
    }
    assert.equal((await board.get(fresh.payload.ticket.id)).claimedBy, null);
    const stopRule = await writeRules(dir, 'stop.json', [{
      id: 'stop',
      when: { kind: 'daily', at: '09:00', tz: 'instance' },
      ticket: { title: '停着不建', goal: '不要出现', to: ['agent-a'], key: 'paused', project: 'stop' },
    }]);
    const skippedCreate = await runRules(
      port, rules, stopRule, { HUB_PANIC_DIR: panic }, clock,
    );
    assert.equal(skippedCreate.code, 0, skippedCreate.err);
    assert.match(skippedCreate.out, /已一键全停/);
    assert.equal((await board.list()).some(ticket => ticket.key === 'paused.2026-11-18'), false);
    await unlink(join(panic, 'stopped.flag'));
    const resumed = await runRules(port, rules, stopRule, {}, clock);
    assert.equal(resumed.code, 0, resumed.err);
    assert.equal((await board.list()).filter(ticket => ticket.key === 'paused.2026-11-18').length, 1);
    const resumedAgain = await runRules(port, rules, stopRule, {}, clock);
    assert.equal((await board.list()).filter(ticket => ticket.key === 'paused.2026-11-18').length, 1);
    assert.match(resumedAgain.out, /已有单/);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});

async function writeRules(dir, name, rules) {
  const file = join(dir, name);
  await writeFile(file, JSON.stringify({ version: 1, rules }));
  return file;
}
