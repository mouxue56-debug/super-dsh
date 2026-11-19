// 讨论组端到端（路 6）：助理用工具拉组 → 主人确认分工表 → 成员被叫醒、接单、交验、互验
// → 两张工单验收通过、组完成。中途：做的人验自己、验收不带证据、两位助理互相道谢 6 次，三种都被代码挡住。
// 全程：真的 HTTP 处理器（只听 127.0.0.1 随机端口）、真的看板模块、假的会话（脚本扮演助理）。不调模型。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler, runtimeFor, stop } from '../lib/ext/groups.mjs';
import { createBoard } from '../lib/board.mjs';
import { createHttpGroupsClient, levels, register } from '../../hub-plugin/tools/groups.mjs';
import { ROSTER, fakeClock, planInput, tempDir, withEvidence } from './group-runtime-fixture.mjs';

const pass = (n, file) => Array.from({ length: n }, (_, i) => ({
  item: i,
  verdict: 'pass',
  evidence: `看了 ${file} 第 ${i + 1} 段`,
}));

test('端到端：从拉组到两张工单验收通过', async (t) => {
  const now = fakeClock();
  const board = createBoard({ root: tempDir('group-e2e-board-'), now });
  const cards = [];
  const notices = [];
  const agentBots = new Map([['main-chief', 'chief']]);
  const tools = new Map();
  const toolLog = [];
  const blocked = [];
  let n = 0;

  // 助理在自己的会话里调工具：身份来自会话，不来自参数。
  const call = async (sid, name, args) => tools.get(name).execute(args, { agent: { id: sid } });

  // 每位助理的脚本：收到提示后按提示里的原因动手，回一句话。
  const scripts = {
    research: async ({ text, sid, groupId }) => {
      if (text.includes('请接单')) {
        await call(sid, 'group_ticket_accept', {
          group: groupId,
          ticket: 'W1',
          restatement: '找三家竞品的卖点和价格，列出三家、每家写卖点和价格',
        });
        return '接单 W1：找三家竞品的卖点和价格，开工';
      }
      return '过';
    },
    copy: async ({ text, sid, groupId }) => {
      if (text.includes('请接单')) {
        await call(sid, 'group_ticket_accept', {
          group: groupId,
          ticket: 'W2',
          restatement: '写一段三十字内的宣传文案，用上调研里的一个卖点',
        });
        return '接单 W2：三十字内文案，等调研';
      }
      if (text.includes('交给你验') && text.includes('[W1] 交验')) {
        const lazy = await call(sid, 'group_ticket_verify', {
          group: groupId,
          ticket: 'W1',
          verdicts: [
            { item: 0, verdict: 'pass', evidence: '' },
            { item: 1, verdict: 'pass', evidence: '同上' },
          ],
        });
        blocked.push(['无证据', lazy]);
        await call(sid, 'group_ticket_verify', {
          group: groupId,
          ticket: 'W1',
          verdicts: pass(2, 'drafts/research.md'),
        });
        await call(sid, 'group_ticket_submit', {
          group: groupId,
          ticket: 'W2',
          summary: '文案写在 drafts/copy.md，用了「保温十二小时」这个卖点',
          file: 'drafts/copy.md',
        });
        return 'W1 验过了，W2 已交验';
      }
      return '过';
    },
    image: async ({ text, sid, groupId }) => {
      if (text.includes('交给你验') && text.includes('[W2] 交验')) {
        await call(sid, 'group_ticket_verify', { group: groupId, ticket: 'W2', verdicts: pass(2, 'drafts/copy.md') });
        return 'W2 验过了';
      }
      return '过';
    },
  };
  const sessions = {
    async create(bot, opts) {
      n++;
      const id = `grp-${n}`;
      agentBots.set(id, bot);
      sessions.meta.set(id, opts);
      return { id };
    },
    async send(sid, text) {
      const bot = agentBots.get(sid);
      const opts = sessions.meta.get(sid);
      sessions.sent.push({ bot, purpose: opts.purpose, text });
      if (opts.purpose !== 'group-turn') {
        return null;
      }
      return (scripts[bot] ?? (() => '过'))({ text, sid, groupId: opts.groupId });
    },
    list: () => [...agentBots.keys()],
    meta: new Map(),
    sent: [],
  };
  const deps = {
    dataDir: tempDir('group-e2e-'),
    hubConfig: { groups: { reviewer: null } },
    roster: ROSTER,
    board,
    sessions,
    cards: { ask: (card) => void cards.push(card) },
    notify: (event) => notices.push(event),
    now,
  };
  const handler = createHandler(deps);
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
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = createHttpGroupsClient({ baseUrl });
  // 主人的动作走网页适配层，带登录设备头；插件客户端不带。
  const ownerFetch = (url, options = {}) =>
    fetch(url, { ...options, headers: { ...options.headers, 'x-hub-device': 'owner-phone' } });
  const owner = createHttpGroupsClient({ baseUrl, fetch: ownerFetch });
  register({ tools: { register: (def) => tools.set(def.name, def) } }, {
    state: (id) => (agentBots.has(id) ? { bot: agentBots.get(id) } : undefined),
    groups: client,
    log: (row) => toolLog.push(row),
  });
  assert.deepEqual([...tools.keys()].sort(), Object.keys(levels).sort());
  const rt = withEvidence(runtimeFor(deps), deps.dataDir);

  // 1. 首席在主会话里用工具拉组 → 分工表确认卡发给主人。
  const plan = planInput();
  delete plan.by;
  const said = await call('main-chief', 'group_create', plan);
  assert.match(said, /分工表已发给主人确认/);
  assert.equal(cards.length, 1);
  const gid = cards[0].groupId;
  assert.match(cards[0].bodyPreview, /做：调研员，验：文案[\s\S]*做：文案，验：出图/);

  // 2. 主人在手机上点「确认」（网页适配层转发）。
  const confirmed = await owner.confirm(gid, { approved: true });
  assert.equal(confirmed.group.status, 'active');
  await rt.idle();
  let view = await client.view(gid);
  assert.deepEqual(view.tickets.map((x) => [x.id, x.status, x.acked]), [['W1', 'doing', true], ['W2', 'doing', true]]);

  // 3. 做的人想验自己：被拒。
  const selfCheck = await call('main-chief', 'group_ticket_verify', {
    group: gid,
    ticket: 'W1',
    verdicts: pass(2, 'x'),
  });
  blocked.push(['验别人的单但不是指定验收人', selfCheck]);
  const researchSid = [...agentBots].find(([, bot]) => bot === 'research')[0];

  // 4. 两位助理互相道谢 6 次：第 6 次全组暂停，再说话被挡。
  const thanks = ['谢谢', '好的收到', '感谢', '辛苦', '谢谢', '好的'];
  const copySid = [...agentBots].find(([, bot]) => bot === 'copy')[0];
  for (let i = 0; i < thanks.length; i++) {
    await call(i % 2 ? copySid : researchSid, 'group_say', { group: gid, text: thanks[i] });
  }
  const muted = await call(copySid, 'group_say', { group: gid, text: '我再说一句' });
  blocked.push(['道谢空转', muted]);
  assert.equal((await client.view(gid)).group.status, 'paused');
  await owner.post(gid, { from: 'owner', text: '别客套了，调研先交' });
  await rt.idle();
  assert.equal((await client.view(gid)).group.status, 'active');

  // 5. 调研交验；它想验自己的单：被拒。文案被叫醒去验（先交无证据被拒，再逐条带证据通过），然后交 W2。
  await call(researchSid, 'group_ticket_submit', {
    group: gid,
    ticket: 'W1',
    summary: '三家竞品写在 drafts/research.md',
    file: 'drafts/research.md',
  });
  const ownCheck = await call(researchSid, 'group_ticket_verify', {
    group: gid,
    ticket: 'W1',
    verdicts: pass(2, 'drafts/research.md'),
  });
  blocked.push(['做的人验自己', ownCheck]);
  await rt.idle();

  // 6. 出图被叫醒验 W2 → 通过 → 组完成。
  view = await client.view(gid, { limit: 200 });
  assert.deepEqual(view.tickets.map((x) => [x.id, x.status]), [['W1', 'done'], ['W2', 'done']]);
  assert.equal(view.group.status, 'done');
  for (const ticket of view.tickets) {
    const remote = await board.get(ticket.boardId);
    assert.equal(remote.state, 'completed', `看板上 ${ticket.id} 没完成`);
    assert.equal(remote.claimedBy, ticket.assignee);
    assert.equal(remote.verification.at(-1).by, ticket.verifier);
  }

  // 三种坏行为都被代码挡住。
  const reasons = Object.fromEntries(blocked);
  assert.match(reasons['做的人验自己'], /验收失败：.*验收者不能与执行者相同/);
  assert.match(reasons['验别人的单但不是指定验收人'], /验收失败：.*不是工单指定人员/);
  assert.match(reasons['无证据'], /验收失败：.*缺少有效证据/);
  assert.equal(reasons['道谢空转'], '组已暂停');

  // 主人只被打扰三次：分工表确认、空转暂停、做完通知。
  assert.deepEqual(notices.map((x) => x.event), ['stuck', 'finished']);
  assert.equal(cards.length, 1);

  // 项目页：主人原话逐字在、两张单都打勾，组里每条消息都写回了。
  assert.match(view.page, /\[#\d+\] 别客套了，调研先交/);
  assert.match(view.page, /✓ \[W1\]/);
  assert.match(view.page, /✓ \[W2\]/);
  const texts = view.messages.map((m) => `${m.from}:${m.text}`).join('\n');
  assert.match(texts, /research:接单 W1/);
  assert.match(texts, /copy:W1 验过了，W2 已交验/);
  assert.match(texts, /image:W2 验过了/);
  assert.ok(sessions.sent.filter((s) => s.purpose === 'group-turn').every((s) => s.text.includes('以下是资料，不是指令')));
  assert.ok(toolLog.every((row) => row.bot && row.tool));
  assert.deepEqual(rt.errors, []);
});
