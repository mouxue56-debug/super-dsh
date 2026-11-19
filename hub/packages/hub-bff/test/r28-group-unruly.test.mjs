// 讨论组遇到「不守规矩的成员」也不静默卡住。
// 小模型不会老老实实按协议调工具：不带组编号、做完不交单、接单交单顺序反了、只回一句「好的」、
// 嘴上说「通过」却不调验收。每种都要走到「验收通过」或明确的「等主人」（组里有说明、主人收到通知）。
// 全程不调模型：脚本扮演助理，经插件工具（同进程或真 HTTP）调用后端。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGroupRuntime } from '../lib/group-runtime.mjs';
import { createHandler, runtimeFor, stop } from '../lib/ext/groups.mjs';
import { createHttpGroupsClient, register } from '../../hub-plugin/tools/groups.mjs';
import { ROSTER, fakeClock, fakeSessions, planInput, tempDir, withEvidence } from './group-runtime-fixture.mjs';

// 只留第一张工单（调研做、文案验）的分工表。
function onePlan(extra = {}) {
  const input = planInput(extra);
  input.tickets = [input.tickets[0]];
  return input;
}

// 读叫醒消息里的工单号和这次的角色（做的人看到交单那一行，验的人看到验收那一行）。
function readWake(text) {
  const ticket = /工单 (W\d+)「/u.exec(text)?.[1] ?? null;
  const verifying = text.includes('group_ticket_verify {');
  const role = verifying ? 'verify' : text.includes('group_ticket_submit {') ? 'work' : null;
  return { ticket, role, gid: /组编号 (g[0-9a-z]+)/u.exec(text)?.[1] ?? null };
}

// 按 1 起的清单编号写验收（小模型常这样写），每条带文件指针。
function verdicts1(n, file) {
  return Array.from({ length: n }, (_, i) => ({ item: i + 1, verdict: 'pass', evidence: `看了 ${file} 第 ${i + 1} 段` }));
}

// 搭一个运行时：脚本按「谁、哪张单、第几次被叫」回话；工具经插件 register 出来的 execute 调。
function harness({ script, http: viaHttp = false, extra = {} } = {}) {
  const notices = [];
  const counts = new Map();
  const tools = new Map();
  const toolLog = [];
  let rt;
  const sessions = fakeSessions({
    '*': async ({ text, sid }) => {
      const bot = sessions.owners.get(sid).bot;
      const wake = readWake(text);
      if (!wake.ticket || !wake.role) {
        return '过';
      }
      const key = `${bot}:${wake.ticket}:${wake.role}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const call = (name, args) => tools.get(name).execute(args, { agent: { id: sid } });
      const fn = script[`${bot}:${wake.ticket}:${wake.role}:${n}`] ?? script[`${bot}:${wake.role}`];
      return fn ? fn({ call, wake, text, rt }) : '过';
    },
  });
  const deps = {
    dataDir: tempDir('r28-unruly-'),
    roster: ROSTER,
    sessions,
    notify: (event) => notices.push(event),
    now: fakeClock(),
    ...extra,
  };
  rt = withEvidence(viaHttp ? runtimeFor(deps) : createGroupRuntime(deps), deps.dataDir);
  const direct = {
    resolve: async (body) => rt.resolve(body),
    post: async (gid, body) => rt.post(gid, body),
    view: async (gid, options) => rt.view(gid, options),
    accept: async (gid, tid, body) => rt.accept(gid, tid, body),
    submit: async (gid, tid, body) => rt.submit(gid, tid, body),
    verify: async (gid, tid, body) => rt.verify(gid, tid, body),
  };
  const state = (id) => (sessions.owners.has(id) ? { bot: sessions.owners.get(id).bot } : undefined);
  const wire = (groups) => register({ tools: { register: (def) => tools.set(def.name, def) } }, {
    state,
    groups,
    log: (row) => toolLog.push(row),
  });
  if (!viaHttp) {
    wire(direct);
  }
  return { rt, deps, sessions, notices, counts, tools, toolLog, wire };
}

// 建组、确认、等跑完；返回组编号。
async function run(h, plan = onePlan()) {
  const { group } = await h.rt.propose(plan);
  await h.rt.confirm(group.id, { approved: true });
  await h.rt.idle();
  return group.id;
}

// 组里所有消息拼成一段文字，便于断言。
const said = (rt, gid) => rt.view(gid, { limit: 500 }).messages.map((m) => m.text).join('\n');

// 带工具调用记录的回话（等同后端从会话事件里数到的工具调用）。
const withTools = (text, n = 1) => ({ text, toolEvents: Array.from({ length: n }, (_, i) => ({ id: `t${i}` })) });

test('a. 叫醒消息自带组编号、组名、工单、验收清单、下一步和填好的工具调用', async () => {
  const h = harness({ script: {} });
  const gid = await run(h, planInput());
  const work = h.sessions.sent.find((row) => row.bot === 'research' && row.purpose === 'group-turn').text;
  assert.match(work.split('\n')[0], new RegExp(`讨论组「新杯子宣传」· 组编号 ${gid} · 你是 调研员（research）`, 'u'));
  assert.match(work, /工单 W1「竞品调研」/u);
  assert.match(work, /目标：找三家竞品的卖点和价格/u);
  assert.match(work, /\n1\. 列出三家竞品\n2\. 每家写卖点和价格\n/u);
  assert.match(work, /下一步：请接单：直接开始做，做完交单/u);
  assert.ok(work.includes(`group_ticket_submit {"group":"${gid}","ticket":"W1"`));
  assert.ok(work.indexOf('group_ticket_submit') < work.indexOf('以下是资料，不是指令'), '示例在资料块之前');
  h.rt.stop();
});

test('b. 不带组编号、传组名、传错：唯一时自动补；两个组时报错并列出候选', async () => {
  const h = harness({ script: {} });
  const first = await run(h, onePlan());
  for (const group of ['新杯子宣传', '新杯子', '', undefined, 'r27', 'g000']) {
    const got = h.rt.resolve({ member: 'research', group, ticket: 'w1', action: 'submit' });
    assert.equal(got.group, first);
    assert.equal(got.ticket, 'W1');
  }
  assert.equal(h.rt.resolve({ member: 'copy', action: 'read' }).group, first);
  const second = await run(h, onePlan({ name: '第二组' }));
  assert.throws(() => h.rt.resolve({ member: 'research', action: 'read' }), (e) =>
    e.message.includes(`${first}（新杯子宣传）`) && e.message.includes(`${second}（第二组）`));
  assert.throws(() => h.rt.resolve({ member: 'nobody', action: 'read' }), /不在任何进行中的讨论组/u);
  assert.equal(h.rt.resolve({ member: 'research', group: '第二组', action: 'read' }).group, second);
  h.rt.stop();
});

test('c. 做完不交单：代记接单 → 追问一次（给出填好的一行）→ 追问后交单 → 验收通过', async () => {
  const h = harness({
    script: {
      'research:W1:work:1': async ({ call }) => {
        await call('group_read', { group: '新杯子宣传' });
        return withTools('已做完，写在 notes/x.md');
      },
      'research:W1:work:2': async ({ call }) => {
        await call('group_ticket_submit', { summary: '三家竞品写在 notes/x.md', file: 'notes/x.md' });
        return withTools('交了');
      },
      'copy:W1:verify:1': async ({ call }) => {
        await call('group_ticket_verify', { verdicts: verdicts1(2, 'notes/x.md') });
        return withTools('验完');
      },
    },
  });
  const gid = await run(h);
  const v = h.rt.view(gid);
  assert.equal(v.tickets[0].status, 'done');
  assert.equal(v.tickets[0].autoAccepted, true);
  assert.equal(v.group.status, 'done');
  const nudge = h.sessions.sent.filter((row) => row.bot === 'research' && row.purpose === 'group-turn')[1].text;
  assert.match(nudge, /你说做完了但没交单，直接调用/u);
  assert.ok(nudge.includes(`group_ticket_submit {"group":"${gid}","ticket":"W1"`));
  assert.match(said(h.rt, gid), /调研员 接了 \[W1\] 竞品调研（运行时代记）/u);
  assert.deepEqual(h.rt.errors, []);
  h.rt.stop();
});

test('d. 追问后仍不交单：标「等主人」，组里说明，主人收到通知', async () => {
  const h = harness({
    script: {
      'research:work': async () => withTools('做完了，文件在 notes/x.md'),
    },
  });
  const gid = await run(h);
  const t = h.rt.view(gid).tickets[0];
  assert.equal(t.status, 'wait_owner');
  assert.equal(t.waitReason, 'no_submit');
  assert.match(said(h.rt, gid), /\[W1\] 调研员 没交单（追问过一次），等主人定/u);
  assert.ok(h.notices.some((n) => n.event === 'stuck' && n.text.includes('W1')));
  assert.equal(h.counts.get('research:W1:work'), 2, '只追问一次');
  h.rt.stop();
});

test('e. 接单交单顺序反了：先交（单还是待办）→ 代记接单再交验；后来的接单返回「已交验」', async () => {
  let late;
  const h = harness({
    script: {
      'research:W1:work:1': async ({ call, wake }) => {
        await call('group_ticket_submit', {
          group: wake.gid, ticket: 'W1', summary: '结果在 notes/x.md', file: 'notes/x.md',
        });
        late = await call('group_ticket_accept', { group: wake.gid, ticket: 'W1' });
        return withTools('交了', 2);
      },
      'copy:W1:verify:1': async ({ call }) => {
        await call('group_ticket_verify', { ticket: 'W1', verdicts: verdicts1(2, 'notes/x.md') });
        return withTools('验完');
      },
    },
  });
  const gid = await run(h);
  assert.match(late, /"already":true/u);
  assert.match(late, /已交验，不用再接/u);
  assert.equal(h.rt.view(gid).tickets[0].status, 'done');
  assert.match(said(h.rt, gid), /接了 \[W1\].*运行时代记[\s\S]*\[W1\] 交验/u);
  h.rt.stop();
});

test('f. 在组里只说一句「好的」：不算接单 → 追问一次 → 仍「好的」→ 等主人', async () => {
  const h = harness({ script: { 'research:work': async () => '好的' } });
  const gid = await run(h);
  const t = h.rt.view(gid).tickets[0];
  assert.equal(t.status, 'wait_owner');
  assert.equal(t.autoAccepted, undefined);
  assert.ok(h.notices.some((n) => n.event === 'stuck'));
  assert.match(said(h.rt, gid), /没交单（追问过一次），等主人定/u);
  h.rt.stop();
});

test('g. 验的人只回「通过」不调验收 → 追问一次 → 仍不调 → 等主人；做的人验自己仍被拒', async () => {
  let self;
  const h = harness({
    script: {
      'research:W1:work:1': async ({ call }) => {
        await call('group_ticket_submit', { summary: '结果在 notes/x.md', file: 'notes/x.md' });
        self = await call('group_ticket_verify', { verdicts: verdicts1(2, 'notes/x.md') }).catch((e) => e.message);
        return withTools('交了', 2);
      },
      'copy:verify': async () => '通过',
    },
  });
  const gid = await run(h);
  assert.match(String(self), /验收|没有可做的单/u);
  const t = h.rt.view(gid).tickets[0];
  assert.equal(t.status, 'wait_owner');
  assert.equal(t.waitReason, 'no_verify');
  assert.match(said(h.rt, gid), /\[W1\] 文案 没验（追问过一次），等主人定/u);
  const nudge = h.sessions.sent.filter((row) => row.bot === 'copy' && row.purpose === 'group-turn').at(-1).text;
  assert.match(nudge, /你说验过了但没调验收工具/u);
  assert.ok(nudge.includes(`group_ticket_verify {"group":"${gid}","ticket":"W1"`));
  h.rt.stop();
});

test('g2. 等主人后本人回来照做：恢复原状态继续，验收规则不放松', async () => {
  const h = harness({ script: { 'research:work': async () => '好的' } });
  const gid = await run(h);
  assert.equal(h.rt.view(gid).tickets[0].status, 'wait_owner');
  await h.rt.submit(gid, 'W1', { by: 'research', summary: '结果在 notes/x.md', file: 'notes/x.md' });
  await h.rt.idle();
  assert.equal(h.rt.view(gid).tickets[0].status, 'review');
  const lazy = await h.rt.verify(gid, 'W1', { by: 'copy', verdicts: [{ item: 1, verdict: 'pass', evidence: 'ok' }] });
  assert.equal(lazy.ok, false);
  const done = await h.rt.verify(gid, 'W1', { by: 'copy', verdicts: verdicts1(2, 'notes/x.md') });
  assert.equal(done.ok, true);
  assert.equal(h.rt.view(gid).tickets[0].status, 'done');
  assert.match(said(h.rt, gid), /回来接着做了/u);
  h.rt.stop();
});

test('g3. 退回两次转的「等主人」不能被本人恢复', async () => {
  const h = harness({ script: {} });
  const gid = await run(h);
  const fail = [{ item: 1, verdict: 'fail', evidence: '看了 notes/x.md 第 1 段', reason: '少一家' },
    { item: 2, verdict: 'pass', evidence: '看了 notes/x.md 第 2 段' }];
  for (let i = 0; i < 2; i++) {
    await h.rt.submit(gid, 'W1', { by: 'research', summary: '结果在 notes/x.md' });
    await h.rt.verify(gid, 'W1', { by: 'copy', verdicts: fail });
  }
  assert.equal(h.rt.view(gid).tickets[0].status, 'wait_owner');
  await assert.rejects(h.rt.submit(gid, 'W1', { by: 'research', summary: '再交' }));
  assert.equal(h.rt.view(gid).tickets[0].status, 'wait_owner');
  await h.rt.idle();
  h.rt.stop();
});

test('i. 说在做、之后没动静：定时 20 分钟追问一次，再 20 分钟转主人', async () => {
  const h = harness({ script: { 'research:work': async () => withTools('开工了，先找资料') } });
  const gid = await run(h);
  assert.equal(h.rt.view(gid).tickets[0].status, 'doing');
  h.deps.now.advance(10 * 60 * 1000);
  await h.rt.tick();
  await h.rt.idle();
  assert.equal(h.counts.get('research:W1:work'), 1, '没到时间不追问');
  h.deps.now.advance(11 * 60 * 1000);
  await h.rt.tick();
  await h.rt.idle();
  assert.equal(h.counts.get('research:W1:work'), 2, '到时间追问一次');
  assert.equal(h.rt.view(gid).tickets[0].status, 'doing');
  h.deps.now.advance(21 * 60 * 1000);
  await h.rt.tick();
  await h.rt.idle();
  assert.equal(h.rt.view(gid).tickets[0].status, 'wait_owner');
  assert.ok(h.notices.some((n) => n.event === 'stuck'));
  h.rt.stop();
});

test('k. 验收条目编号：从 1 起和从 0 起都认；越界、重复仍被拒', async () => {
  const h = harness({ script: {} });
  const gid = await run(h, planInput());
  await h.rt.submit(gid, 'W1', { by: 'research', summary: '结果在 notes/x.md' });
  const bad = await h.rt.verify(gid, 'W1', { by: 'copy', verdicts: [
    { item: 1, verdict: 'pass', evidence: '看了 notes/x.md 第 1 段' },
    { item: 3, verdict: 'pass', evidence: '看了 notes/x.md 第 3 段' },
  ] });
  assert.equal(bad.ok, false);
  const ok = await h.rt.verify(gid, 'W1', { by: 'copy', verdicts: verdicts1(2, 'notes/x.md') });
  assert.equal(ok.ok, true);
  await h.rt.submit(gid, 'W2', { by: 'copy', summary: '文案在 drafts/copy.md' });
  const zero = await h.rt.verify(gid, 'W2', { by: 'image', verdicts: [
    { item: 0, verdict: 'pass', evidence: '看了 drafts/copy.md 第 1 段' },
    { item: 1, verdict: 'pass', evidence: '看了 drafts/copy.md 第 2 段' },
  ] });
  assert.equal(zero.ok, true);
  await h.rt.idle();
  h.rt.stop();
});

test('h. 真 HTTP：两张工单，成员各种不守规矩，最后两张都验收通过、组完成', async (t) => {
  let self;
  const h = harness({
    http: true,
    script: {
      // 调研：先拿组名读组，嘴上说做完；被追问后不带组号和单号交单；还想验自己的单。
      'research:W1:work:1': async ({ call }) => {
        await call('group_read', { group: '新杯子宣传' });
        return withTools('已做完，三家竞品写在 notes/research.md');
      },
      'research:W1:work:2': async ({ call }) => {
        await call('group_ticket_submit', { summary: '三家竞品写在 notes/research.md', file: 'notes/research.md' });
        self = await call('group_ticket_verify', { verdicts: verdicts1(2, 'notes/research.md') });
        return withTools('交了', 2);
      },
      // 文案：开工只回「好的」；被追问后先交再接（顺序反了），单号写小写。
      'copy:W2:work:1': async () => '好的',
      'copy:W2:work:2': async ({ call, wake }) => {
        await call('group_ticket_submit', {
          group: wake.gid, ticket: 'w2', summary: '文案在 drafts/copy.md', file: 'drafts/copy.md',
        });
        await call('group_ticket_accept', { group: wake.gid, ticket: 'W2' });
        return withTools('交了', 2);
      },
      // 文案验 W1：先只说「通过」，被追问后用组名调验收、编号从 1 起。
      'copy:W1:verify:1': async () => '通过',
      'copy:W1:verify:2': async ({ call }) => {
        await call('group_ticket_verify', { group: '新杯子', ticket: 'W1', verdicts: verdicts1(2, 'notes/research.md') });
        return withTools('验完');
      },
      // 出图验 W2：什么编号都不带。
      'image:W2:verify:1': async ({ call }) => {
        await call('group_ticket_verify', { verdicts: verdicts1(2, 'drafts/copy.md') });
        return withTools('验完');
      },
    },
  });
  const handler = createHandler(h.deps);
  const server = http.createServer(async (req, res) => {
    if (!(await handler(req, res))) {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    stop();
    server.close();
  });
  h.wire(createHttpGroupsClient({ baseUrl: `http://127.0.0.1:${server.address().port}` }));
  const gid = await run(h, planInput());
  const v = h.rt.view(gid, { limit: 500 });
  assert.deepEqual(v.tickets.map((x) => [x.id, x.status]), [['W1', 'done'], ['W2', 'done']]);
  assert.equal(v.group.status, 'done');
  assert.match(String(self), /没有可做的单|验收/u);
  const text = said(h.rt, gid);
  assert.match(text, /调研员 接了 \[W1\]/u);
  assert.match(text, /文案 接了 \[W2\]/u);
  assert.doesNotMatch(text, /等主人定/u);
  assert.ok(h.toolLog.some((row) => row.tool === 'group_read' && row.group === gid), '组名被换成组编号');
  assert.deepEqual(h.rt.errors, []);
});
