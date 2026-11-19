// Z1：真壳、假后端、手机宽度。讨论组新页、已读不带 0、状态句。端口 3791、3792。
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
const WEB = 'web-r29d-z1';
const BFF = 'bff-r29d-z1';
const MOCK_PORT = 3791;
const WEB_PORT = 3792;
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

function presenceBody() {
  return buildPresence({
    now: Date.parse(NOW),
    tickets: [
      { claimedBy: 'aa', state: 'blocked', review: 'none', title: 'Ada 原话转达：定下周一', updatedAt: NOW },
      { claimedBy: 'ab', state: 'progress', review: 'none', title: '整理 abcdefghijk', updatedAt: NOW },
      { claimedBy: 'ac', state: 'waiting-human', review: 'none', title: '【标签】原话转达：', updatedAt: NOW },
    ],
  });
}

function startMock(port) {
  const state = {
    reads: [], groupPosts: [], answers: [],
    // 事件类型要由后端结构化给出，适配层不再从正文猜（Z2 回执、复核 10 第 15 项）。
    messages: [
      { id: 1, from: 'aa', text: '早', ts: 1 },
      { id: 2, from: 'aa', text: '交给乙，做到验收算完', system: true, eventType: 'handoff', ts: 2 },
      { id: 3, from: 'ab', text: '等主人定日期', system: true, eventType: 'ask', ts: 3 },
      { id: 4, from: 'ac', text: '验收通过', system: true, eventType: 'accept', ts: 4 },
    ],
  };
  const names = { aa: '甲', ab: '乙', ac: '丙' };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/^\/bff(?=\/)/, '') || '/';
    const method = req.method || 'GET';
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
          id, name, status: 'active', role: index === 0 ? 'chief' : 'bot', order: index + 1, duty: '在组里',
        })),
      });
    }
    if (path === '/sessions' && method === 'GET') {
      return json(res, 200, { sessions: [{
        id: 's-empty', bot: 'aa', title: '空会话', updatedAt: NOW, lastText: '',
      }] });
    }
    if (path === '/sessions' && method === 'POST') {
      return json(res, 200, { id: 's-made', bot: 'aa' });
    }
    if (path.endsWith('/history') && method === 'GET') return json(res, 200, { messages: [] });
    if (path.endsWith('/cards') && method === 'GET') return json(res, 200, { cards: [] });
    if (path.endsWith('/read') && path !== '/unread/read') return json(res, 200, { ok: true });
    if (path === '/unread/' && method === 'GET') {
      return json(res, 200, { ok: true, conversations: { 's-empty': 1 }, bots: { aa: 1 }, groups: {} });
    }
    if (path === '/unread/read' && method === 'POST') {
      let body = {};
      try { body = JSON.parse(raw.toString() || '{}'); } catch { body = {}; }
      const bad = Object.prototype.hasOwnProperty.call(body, 'upTo') && !(Number(body.upTo) > 0);
      state.reads.push({ body, status: bad ? 400 : 200 });
      if (bad) return json(res, 400, { error: { code: 'INVALID_INPUT', message: '已读位置不在这段会话里' } });
      return json(res, 200, { ok: true });
    }
    if (path === '/presence' && method === 'GET') return json(res, 200, presenceBody());
    if (path === '/groups' && method === 'GET') {
      return json(res, 200, { ok: true, groups: [{
        id: 'g3', name: '周末', status: 'active', host: 'aa',
        members: ['aa', 'ab', 'ac'], lastText: '早', updatedAt: NOW,
      }] });
    }
    if (path === '/groups/g3' && method === 'GET') {
      return json(res, 200, {
        group: {
          id: 'g3', name: '周末', status: 'active', host: 'aa',
          members: [
            { id: 'aa', name: '甲', role: 'host' },
            { id: 'ab', name: '乙', role: 'member' },
            { id: 'ac', name: '丙', role: 'member' },
          ],
        },
        messages: state.messages,
        tickets: [{ id: 't1', title: '定日期', assignee: 'ab', status: 'progress' }],
        page: '# 项目页', summary: {},
      });
    }
    if (path === '/groups/g3/messages' && method === 'POST') {
      const body = JSON.parse(raw.toString() || '{}');
      state.groupPosts.push(body);
      state.messages.push({ id: state.messages.length + 1, from: body.from, text: body.text, ts: Date.now() });
      return json(res, 200, { ok: true });
    }
    if (path === '/approvals' && method === 'GET') {
      return json(res, 200, { approvals: [{
        id: 'card-g', type: 'approval', status: 'pending', kind: 'group_plan', bot: 'aa', botName: '甲',
        sessionId: 's-empty', groupId: 'g3', what: '做什么：一起定周末', where: '在哪做：讨论组里',
        why: '为什么：要分工', text: '完整分工表正文', bodyPreview: '第一行全文\n第二行全文',
        choices: [{ id: 'approve', label: '确认，开工' }, { id: 'reject', label: '先不要' }],
      }] });
    }
    if (path === '/approvals/card-g/answer' && method === 'POST') {
      state.answers.push(raw.toString());
      return json(res, 200, { ok: true, card: {
        id: 'card-g', type: 'approval', status: 'approved', kind: 'group_plan', bot: 'aa',
        sessionId: 's-empty', groupId: 'g3', text: '完整分工表正文',
      } });
    }
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

describe('Z1 讨论组接上新页面', { concurrency: 1, skip: skipReason() }, () => {
  let mock;
  let web;
  let origin;

  before(async () => {
    mock = await startMock(MOCK_PORT);
    const root = join(tmpdir(), 'r29d-z1');
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

  test('手机上打开三人组、发一句、打开会话不 400', async () => {
    const playwright = require(playwrightCore());
    const browser = await playwright.chromium.launch({
      executablePath: chromiumBin(), headless: true, args: ['--disable-dev-shm-usage'],
    });
    const errors = [];
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      page.on('dialog', dialog => dialog.accept());
      await page.route('**/*', route => {
        const target = new URL(route.request().url());
        if (target.hostname === '127.0.0.1' && target.port === String(WEB_PORT)) return route.continue();
        return route.abort();
      });
      await page.goto(origin + '/?key=' + WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('[data-real-group="g3"]', { timeout: 20000 });
      await page.waitForFunction(() => {
        const node = document.querySelector('[data-bot-tree="aa"] [data-r29-presence]');
        return node && node.textContent.includes('定下周一') && !node.textContent.includes('Ada');
      }, null, { timeout: 10000 });
      const captions = await page.locator('[data-r29-presence]').allInnerTexts();
      assert.ok(captions.some(text => text.includes('定下周一') && !text.includes('：')));
      // 标题「整理 abcdefghijk」含半截英文，取不出完整短语，只显示状态词（Z2 回执）。
      assert.ok(captions.some(text => text === '在干活' || text.includes('在干活')));
      await page.locator('[data-real-group="g3"]').click();
      await page.waitForSelector('.r29-group-head .r29-stack[data-r29-n="3"]', { timeout: 10000 });
      await page.waitForSelector('.r29-group-status', { timeout: 10000 });
      const status = await page.locator('.r29-group-status').innerText();
      assert.equal(status, '在一起做');
      await page.waitForSelector('.r29-group-msg .r29-group-face .r29-face', { timeout: 10000 });
      await page.waitForSelector('.r29-group-event[data-r29-kind="handoff"]', { timeout: 10000 });
      await page.waitForSelector('.r29-group-ask', { timeout: 10000 });
      const ask = await page.locator('.r29-group-ask').innerText();
      assert.match(ask, /等你回答/);
      await page.waitForFunction(() => document.body.innerText.includes('完整分工表正文'), null, { timeout: 10000 });
      await page.waitForSelector('[data-real-approval="card-g"][data-real-answer="approve"]', { timeout: 10000 });
      await page.locator('[data-real-approval="card-g"][data-real-answer="approve"]').click();
      await page.waitForFunction(() => document.body.innerText.includes('已确认') ||
        document.body.innerText.includes('完整分工表正文'), null, { timeout: 10000 });
      assert.equal(mock.state.answers.length >= 1, true);
      await page.locator('[data-focus="composer"]').fill('定在周六');
      await page.locator('.composer-area [data-act="send"]').click();
      await page.waitForFunction(() => document.body.innerText.includes('定在周六'), null, { timeout: 10000 });
      assert.equal(mock.state.groupPosts.length >= 1, true);
      assert.deepEqual(mock.state.groupPosts[0], { from: 'owner', text: '定在周六' });
      const before = mock.state.reads.length;
      // 390 宽时叠头像压住返回键中心，点左上角才能点到。
      await page.locator('.chat-header [data-act="back"]').click({ position: { x: 2, y: 2 } });
      await page.locator('[data-real-open="s-empty"]').click();
      await page.waitForFunction(() => {
        const bag = window.HubUnread && HubUnread.counts();
        const open = document.querySelector('[data-message-id], .thread');
        return bag && open && !document.querySelector('[data-r29-group-thread]');
      }, null, { timeout: 10000 });
      await page.evaluate(() => { if (window.HubUnread) HubUnread.markRead('s-empty'); });
      await page.waitForTimeout(400);
      assert.ok(mock.state.reads.length >= before);
      assert.equal(mock.state.reads.some(item => item.status === 400), false);
      assert.equal(mock.state.reads.some(item => Object.prototype.hasOwnProperty.call(item.body, 'upTo') &&
        !(Number(item.body.upTo) > 0)), false);
      assert.equal(errors.length, 0, errors.join('\n'));
    } finally {
      await browser.close();
    }
  });
});
