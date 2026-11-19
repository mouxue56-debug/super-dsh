// 真壳、假后端、手机宽度。点助理头像拉群、讨论组里拉人移人、已读请求不再 400 / 404。端口 3795、3796。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubWeb } from '../server.mjs';
import { buildPresence } from '../../hub-bff/lib/ext/presence.mjs';

const require = createRequire(import.meta.url);
const WEB = 'web-r30-group';
const BFF = 'bff-r30-group';
const MOCK_PORT = 3795;
const WEB_PORT = 3796;
const shellFile = process.env.HUB_SHELL_DIST || '';
const NOW = '2026-11-19T08:00:00.000Z';

function playwrightCore() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const root = join(homedir(), '.npm', '_npx');
  if (!existsSync(root)) return '';
  for (const name of readdirSync(root)) {
    const dir = join(root, name, 'node_modules', 'playwright-core');
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return '';
}

function chromiumBin() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const bin = join(homedir(), 'Library', 'Caches', 'ms-playwright',
    'chromium_headless_shell-1243', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
  return existsSync(bin) ? bin : '';
}

function skipReason() {
  if (!shellFile || !existsSync(shellFile)) return '未设置 HUB_SHELL_DIST 或文件不在，跳过走查';
  if (!playwrightCore()) return '没有 playwright-core，跳过走查';
  if (!chromiumBin()) return '没有已安装的无头浏览器，跳过走查';
  return false;
}

function json(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
}


function startMock(port) {
  const state = {
    reads: [], created: [], added: [], removed: [], deviceless: 0,
    groups: [{
      id: 'g3', name: '周末', status: 'active', host: 'aa',
      members: [{ id: 'aa', name: '甲', role: 'host' }, { id: 'ab', name: '乙', role: 'member' },
        { id: 'ac', name: '丙', role: 'member' }],
      messages: [{ id: 1, from: 'aa', text: '早', ts: 1 }],
    }],
  };
  const names = { aa: '甲', ab: '乙', ac: '丙' };
  const history = [
    { id: '9', role: 'assistant', text: '第一句', ts: 1, seq: 9 },
    { id: '17', role: 'assistant', text: '第二句', ts: 2, seq: 17 },
    { id: '24', role: 'assistant', text: '第三句', ts: 3, seq: 24 },
  ];
  const memberRows = group => group.members.map(m => ({ id: m.id, name: m.name, role: m.role }));
  const listRow = group => ({
    id: group.id, name: group.name, status: group.status, host: group.host, members: memberRows(group),
    lastText: group.messages.at(-1)?.text || '', updatedAt: NOW,
  });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/^\/bff(?=\/)/, '') || '/';
    const method = req.method || 'GET';
    let body = {};
    try { body = JSON.parse(raw.toString() || '{}'); } catch { body = {}; }
    if (path === '/events' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': ok\n\n');
      return;
    }
    if (path === '/health') return json(res, 200, { ok: true, dsh: { connected: true } });
    if (path === '/status') {
      const bots = {};
      for (const id of Object.keys(names)) bots[id] = { running: false, pending: 0, unread: 0 };
      return json(res, 200, { ok: true, pendingTotal: 0, bots });
    }
    if (path === '/bots') {
      return json(res, 200, {
        ok: true,
        bots: Object.entries(names).map(([id, name], index) => ({
          id, name, status: 'active', role: index === 0 ? 'chief' : 'bot', order: index + 1, duty: '在组里' + name,
        })),
      });
    }
    if (path === '/sessions' && method === 'GET') {
      return json(res, 200, { sessions: [{
        id: 's-open', bot: 'aa', title: '周末去哪', updatedAt: NOW, lastText: '第三句',
      }] });
    }
    if (path === '/sessions' && method === 'POST') return json(res, 200, { id: 's-made', bot: 'aa' });
    if (path === '/sessions/s-open/history' && method === 'GET') return json(res, 200, { messages: history });
    if (path.endsWith('/history') && method === 'GET') return json(res, 200, { messages: [] });
    const bashCard = { id: 'card-bash', type: 'approval', status: 'pending', tool: 'bash', bot: 'aa', botName: '甲',
      sessionId: 's-open', seq: 19, createdAt: 3, what: '做什么：跑一条命令', where: '在哪做：本机',
      why: '为什么：要看看', text: 'echo hi', bodyPreview: 'echo hi',
      choices: [{ id: 'approve', label: '同意' }, { id: 'reject', label: '不要' }] };
    const longCard = { ...bashCard, id: 'card-long', seq: 20, createdAt: 4, tool: 'bash', cwd: '/tmp/x',
      command: 'echo ' + 'a'.repeat(200) + ' && printf ' + 'MIDDLE-PART-'.repeat(20) + ' && ls --tail-marker=END-Q7Z',
      bodyPreview: undefined, text: undefined, why: '为什么：看一眼' };
    if (path === '/sessions/s-open/cards' && method === 'GET') return json(res, 200, { cards: [bashCard, longCard] });
    if (path.endsWith('/cards') && method === 'GET') return json(res, 200, { cards: [] });
    if (path.endsWith('/read') && path !== '/unread/read') return json(res, 200, { ok: true });
    if (path === '/unread/' && method === 'GET') {
      return json(res, 200, { ok: true, conversations: { 's-open': 3 }, bots: { aa: 3 },
        groups: Object.fromEntries(state.groups.map(g => [g.id, 1])) });
    }
    if (path === '/unread/read' && method === 'POST') {
      // 照后端的规矩：会话号要是真会话或真讨论组；upTo 要是历史里真有的消息号。
      const group = state.groups.find(g => g.id === body.conversation);
      let status = 200;
      if (body.conversation !== 's-open' && !group) status = 404;
      else if (body.conversation === 's-open' && Object.prototype.hasOwnProperty.call(body, 'upTo') &&
        !history.some(row => row.id === String(body.upTo))) status = 400;
      state.reads.push({ body, status });
      if (status !== 200) return json(res, status, { error: { code: 'X', message: '不行' } });
      return json(res, 200, { ok: true });
    }
    if (path === '/presence' && method === 'GET') return json(res, 200, { ok: true, bots: {} });
    if (path === '/groups' && method === 'GET') return json(res, 200, { ok: true, groups: state.groups.map(listRow) });
    if (path === '/groups/create' && method === 'POST') {
      state.created.push(body);
      if (!req.headers['x-hub-device']) state.deviceless += 1;
      const id = 'gnew' + state.created.length;
      const group = {
        id, name: body.name, status: 'active', host: body.host || body.members[0],
        members: body.members.map(m => ({
          id: m, name: names[m], role: m === (body.host || body.members[0]) ? 'host' : 'member',
        })),
        messages: [{ id: 1, from: 'owner', system: true, eventType: 'join', text: '主人拉了' +
          body.members.map(m => names[m]).join('、') + '一起开了这个组', ts: 1 }],
      };
      state.groups.push(group);
      return json(res, 201, { group: listRow(group) });
    }
    const match = /^\/groups\/([A-Za-z0-9_-]+)(\/members(?:\/remove)?)?$/.exec(path);
    if (match) {
      const group = state.groups.find(g => g.id === match[1]);
      if (!group) return json(res, 404, { error: { code: 'NOT_FOUND', message: '没有这个讨论组' } });
      if (match[2] === '/members' && method === 'POST') {
        state.added.push(body);
        const fresh = body.ids.filter(id => !group.members.some(m => m.id === id));
        for (const id of fresh) group.members.push({ id, name: names[id], role: 'member' });
        group.messages.push({ id: group.messages.length + 1, from: 'owner', system: true, eventType: 'join',
          text: '主人把' + fresh.map(id => names[id]).join('、') + '拉进来了', ts: 2 });
        return json(res, 200, { group: listRow(group), added: fresh });
      }
      if (match[2] === '/members/remove' && method === 'POST') {
        state.removed.push(body);
        if (body.id === group.host) return json(res, 409, { error: { code: 'CONFLICT', message: '主持不能移出，换了主持再说' } });
        group.members = group.members.filter(m => m.id !== body.id);
        group.messages.push({ id: group.messages.length + 1, from: 'owner', system: true, eventType: 'leave',
          text: '主人把' + names[body.id] + '请出了这个组', ts: 3 });
        return json(res, 200, { group: listRow(group), removed: body.id });
      }
      if (!match[2] && method === 'GET') {
        return json(res, 200, { group: { ...listRow(group), members: memberRows(group) }, messages: group.messages,
          tickets: [], page: '# 项目页', summary: {} });
      }
    }
    if (path === '/approvals' && method === 'GET') return json(res, 200, { approvals: [bashCard, longCard] });
    if (path === '/panic/status') return json(res, 200, { ok: true, state: 'running', steps: {} });
    if (path === '/board/tickets') return json(res, 200, { ok: true, tickets: [] });
    return json(res, 200, { ok: true });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      state,
      async close() {
        await new Promise(done => server.close(done));
        server.closeAllConnections?.();
      },
    }));
  });
}

describe('第30轮 拉群（真壳、假后端、手机宽度）', { concurrency: 1, skip: skipReason() }, () => {
  let mock;
  let web;
  let origin;

  before(async () => {
    mock = await startMock(MOCK_PORT);
    const root = join(tmpdir(), 'r30-group');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'web-'));
    const shell = join(dir, 'shell');
    await mkdir(shell);
    await copyFile(shellFile, join(shell, 'index.html'));
    await writeFile(join(dir, 'web.key'), WEB, { mode: 0o600 });
    await writeFile(join(dir, 'bff.key'), BFF, { mode: 0o600 });
    web = await createHubWeb({
      HUB_WEB_PORT: String(WEB_PORT), HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
      HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'),
      BFF_URL: 'http://127.0.0.1:' + MOCK_PORT,
    }, { log() {} });
    origin = 'http://127.0.0.1:' + WEB_PORT;
  });

  after(async () => {
    await web?.close();
    await mock?.close();
  });

  test('点助理头像拉群、讨论组里再拉人和请人出去、已读请求都不报错', async () => {
    const playwright = require(playwrightCore());
    const browser = await playwright.chromium.launch({
      executablePath: chromiumBin(), headless: true, args: ['--disable-dev-shm-usage'],
    });
    const errors = [];
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      page.on('dialog', dialog => dialog.accept());
      await page.route('**/*', route => {
        const target = new URL(route.request().url());
        if (target.hostname === '127.0.0.1' && target.port === String(WEB_PORT)) return route.continue();
        return route.abort();
      });
      const shot = async name => {
        await page.waitForTimeout(450);
        if (process.env.R30_SHOTS) await page.screenshot({ path: join(process.env.R30_SHOTS, name) });
      };
      await page.goto(origin + '/?key=' + WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('[data-real-group="g3"]', { timeout: 20000 });
      // 首页「最近」旁有入口
      await page.waitForSelector('[data-r30-new-group]', { timeout: 10000 });
      await shot('r1-home.png');

      // 打开带待批确认卡的会话：已读请求不能 400（用的是会话历史里的消息号，不是确认卡的序号）
      await page.locator('[data-real-open="s-open"]').click();
      await page.waitForSelector('[data-real-card="card-bash"]', { timeout: 10000 });
      await page.evaluate(() => { const t = document.querySelector('.thread'); if (t) t.scrollTop = t.scrollHeight; });
      await page.waitForTimeout(600);
      assert.ok(mock.state.reads.length >= 1, '应该发过已读请求');
      assert.deepEqual(mock.state.reads.filter(r => r.status !== 200), [], JSON.stringify(mock.state.reads));
      const sent = mock.state.reads.filter(r => r.body.conversation === 's-open');
      assert.ok(sent.every(r => !('upTo' in r.body) || ['9', '17', '24'].includes(String(r.body.upTo))));

      // 很长的需确认命令：外面一行可以省略但要标明，细节里要能看到完整命令（批准前必须看得全）
      const long = page.locator('[data-real-card="card-long"]');
      await long.scrollIntoViewIfNeeded();
      const outer = await long.locator('.m-plain-talk-line').innerText();
      assert.match(outer, /已省略/);
      assert.match(outer, /点开看全/);
      assert.ok(!outer.includes('MIDDLE-PART-MIDDLE-PART-MIDDLE-PART-MIDDLE'), '外面那行不放全文');
      await long.locator('[data-plain-details] summary').click();
      const full = await long.locator('[data-r30-full-command]').innerText();
      assert.ok(full.includes('echo ' + 'a'.repeat(200)) && full.includes('END-Q7Z') &&
        full.includes('MIDDLE-PART-'.repeat(20)), '细节里是完整命令');
      const box = await long.locator('[data-r30-full-command]').evaluate(node => {
        const style = getComputedStyle(node);
        return { wrap: style.whiteSpace, overflowY: style.overflowY, w: node.scrollWidth <= node.clientWidth + 1 };
      });
      assert.ok(['pre-wrap', 'break-spaces'].includes(box.wrap) && box.w, '换行且不横向撑开');
      await shot('r0-long-command.png');
      // 点开之后卡被重画（轮询、倒计时、新消息）也不能自己合上
      await page.evaluate(() => { if (window.render) window.render(); });
      await page.waitForTimeout(3500);
      assert.equal(await page.locator('[data-real-card="card-long"] details').evaluate(n => n.open), true,
        '细节点开后重画仍是开着的');
      await page.evaluate(() => { document.querySelector('[data-real-card="card-long"] details').open = false; });

      // 单聊：点顶栏头像出面板，设置入口还在
      assert.equal(await page.locator('.chat-header [data-r29-settings]').count(), 1);
      await page.locator('.chat-header [data-r30-bot-sheet]').click();
      await page.waitForSelector('.r30g-sheet');
      const rows = await page.locator('.r30g-row').evaluateAll(list => list.map(n => n.getAttribute('data-r30-pick')));
      assert.deepEqual(rows, ['ab', 'ac']);
      await shot('r2-sheet.png');
      await page.locator('[data-r30-pick="ab"]').click();
      const name = await page.locator('[data-r30-name]').inputValue();
      assert.equal(name, '周末去哪', '话题带过去当组名默认值');
      await page.locator('[data-r30-name]').fill('周末小组');
      await page.locator('[data-r30-go]').click();
      await page.waitForSelector('.r29-group-head [data-r29-group-toggle]', { timeout: 10000 });
      await page.waitForSelector('.r29-group-event[data-r29-kind="joined"]', { timeout: 10000 });
      assert.deepEqual(mock.state.created, [{ name: '周末小组', members: ['aa', 'ab'], host: 'aa' }]);
      assert.equal(await page.locator('.chat-header .r22-nameplate').innerText(), '周末小组');
      assert.equal(await page.locator('[data-focus="composer"]').getAttribute('placeholder'), '在组里说一句');
      await shot('r3-newgroup.png');

      // 成员面板：再拉人
      await page.locator('[data-r29-group-toggle]').click();
      await page.waitForSelector('[data-r30-add]');
      assert.equal(await page.locator('.r29-group-member').count(), 2);
      assert.equal(await page.locator('[data-r30-remove]').count(), 0, '只剩两位时不给移出');
      await page.locator('[data-r30-add]').click();
      await page.waitForSelector('.r30g-sheet');
      const left = await page.locator('.r30g-row').evaluateAll(list => list.map(n => n.getAttribute('data-r30-pick')));
      assert.deepEqual(left, ['ac']);
      await page.locator('[data-r30-pick="ac"]').click();
      await page.locator('[data-r30-go]').click();
      await page.waitForFunction(() => document.querySelectorAll('.r29-group-member').length === 3, null,
        { timeout: 10000 });
      assert.deepEqual(mock.state.added, [{ ids: ['ac'] }]);
      await page.waitForSelector('.r29-group-event[data-r29-kind="joined"]');
      await shot('r4-members.png');
      // 请出去：点两下，主持没有这个按钮
      assert.equal(await page.locator('[data-r30-remove="aa"]').count(), 0);
      await page.locator('[data-r30-remove="ac"]').click();
      assert.equal(await page.locator('[data-r30-remove="ac"]').innerText(), '确定请出去');
      assert.deepEqual(mock.state.removed, []);
      await page.locator('[data-r30-remove="ac"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.r29-group-member').length === 2, null,
        { timeout: 10000 });
      assert.deepEqual(mock.state.removed, [{ id: 'ac' }]);
      await page.waitForSelector('.r29-group-event[data-r29-kind="left"]');
      assert.equal(mock.state.deviceless, 0);
      await shot('r5-removed.png');

      // 打开已有讨论组：已读请求不报 404
      const before = mock.state.reads.length;
      await page.evaluate(() => { document.querySelector('.chat-header [data-act="back"]').click(); });
      await page.locator('[data-real-group="g3"]').click();
      await page.waitForSelector('[data-r29-group-thread="g3"]', { timeout: 10000 });
      await page.waitForTimeout(800);
      if (process.env.R30_DEBUG) console.log(JSON.stringify(mock.state.reads));
      assert.deepEqual(mock.state.reads.filter(r => r.status !== 200), [], JSON.stringify(mock.state.reads));
      assert.ok(mock.state.reads.length >= before);
      assert.ok(mock.state.reads.some(r => r.body.conversation === 'g3' && r.status === 200), '打开组后这个组被标成已读');
      assert.equal(errors.length, 0, errors.join('\n'));
    } catch (error) {
      if (process.env.R30_SHOTS) {
        const pages = browser.contexts()[0]?.pages() || [];
        if (pages[0]) await pages[0].screenshot({ path: join(process.env.R30_SHOTS, 'fail.png') });
      }
      throw error;
    } finally {
      await browser.close();
    }
  });
});
