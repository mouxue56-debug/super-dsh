// 集成修 2 总走查。手机尺寸，真适配层加假后端。壳走 HUB_SHELL_DIST。
// 没给壳、没有浏览器时整段跳过，不算失败。端口 3731、3732。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubWeb } from '../server.mjs';

const require = createRequire(import.meta.url);
const WEB = 'web-r29b-walk';
const BFF = 'bff-r29b-walk';
const MOCK_PORT = 3731;
const WEB_PORT = 3732;
const shellFile = process.env.HUB_SHELL_DIST || '';
const TICKET = 'T-20261119-120000-ab12';

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
  if (!shellFile || !existsSync(shellFile)) return '未设置 HUB_SHELL_DIST 或文件不在，跳过总走查';
  if (!playwrightCore()) return '没有 playwright-core，跳过总走查';
  if (!chromiumBin()) return '没有已安装的无头浏览器，跳过总走查';
  return false;
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function todayBody() {
  return {
    date: '2026-11-19',
    headline: {
      status: 'item', id: TICKET, place: 'question',
      text: '等你回答「定日期」', kind: 'answer',
    },
    waiting: {
      available: true,
      waitingAnswer: [{ id: TICKET, title: '定日期' }],
      blocked: [],
      awaitingReview: [],
    },
    approvals: { available: true, cardsSource: 'live', cards: [], kbDrafts: [] },
    checkedResults: { available: true, items: [] },
    yesterdayDone: { available: true, byAssistant: [] },
    yesterdayUsage: { available: true, byAssistant: [], total: null },
    lastEveningMinutes: { available: true, text: '' },
    routines: { available: true, items: [] },
  };
}

function startWalkMock(port) {
  const state = {
    reads: 0,
    messages: [],
    voice: [],
    voiceSeen: 0,
    unread: {
      conversations: { 's-buy': 2, 's-edit': 3 },
      bots: { aa: 5 },
      groups: {},
    },
    replied: new Map(),
  };
  let release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  const names = ['甲', '乙', '丙', '丁', '戊', '己'];
  const duties = { aa: '排期', ab: '推进', ac: '调研', ad: '写作', ae: '视觉', af: '协调' };
  const ids = ['aa', 'ab', 'ac', 'ad', 'ae', 'af'];
  const server = http.createServer(async (req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
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
    if (path.endsWith('/stream') && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write('event: delta\ndata: {"text":"假回复"}\n\n');
      res.write('event: message\ndata: {"role":"assistant","id":"m2","seq":2,"text":"假回复"}\n\n');
      res.write('event: done\ndata: {}\n\n');
      res.end();
      return;
    }
    if (path === '/health') return json(res, 200, { ok: true, dsh: { connected: true } });
    if (path === '/status') {
      const bots = {};
      for (const id of ids) bots[id] = { running: false, pending: 0, unread: 0 };
      return json(res, 200, { ok: true, pendingTotal: 0, bots });
    }
    if (path === '/bots') {
      return json(res, 200, {
        ok: true,
        bots: ids.map((id, index) => ({
          id, name: names[index], status: 'active', role: index === 0 ? 'chief' : 'bot',
          order: index + 1, duty: duties[id],
        })),
      });
    }
    if (path === '/sessions' && method === 'GET') {
      return json(res, 200, { sessions: [
        {
          id: 's-buy', bot: 'aa', title: '买菜', unread: 2,
          updatedAt: '2026-11-19T08:00:00.000Z', lastText: '记得买菜',
        },
        {
          id: 's-edit', bot: 'aa', title: '改稿', unread: 3,
          updatedAt: '2026-11-19T07:00:00.000Z', lastText: '改一版',
        },
      ] });
    }
    if (path === '/sessions' && method === 'POST') {
      const asked = JSON.parse(raw.toString() || '{}');
      return json(res, 200, { id: 's-made', bot: asked.bot || 'ac' });
    }
    if (path.endsWith('/history') && method === 'GET') {
      const id = path.split('/')[2];
      const text = state.replied.get(id);
      const messages = text ? [
        { role: 'user', text, id: 'm1', seq: 1, ts: Date.now() },
        { role: 'assistant', text: '假回复', id: 'm2', seq: 2, ts: Date.now() },
      ] : [];
      return json(res, 200, { messages });
    }
    if (path.endsWith('/messages') && method === 'POST') {
      const asked = JSON.parse(raw.toString() || '{}');
      state.messages.push({ path, text: String(asked.text || '') });
      state.replied.set(path.split('/')[2], String(asked.text || ''));
      return json(res, 200, { accepted: true, requestId: 'req-1' });
    }
    if (path === '/unread/' && method === 'GET') {
      return json(res, 200, { ok: true, ...state.unread });
    }
    if (path === '/unread/read' && method === 'POST') {
      state.reads += 1;
      let body = {};
      try { body = JSON.parse(raw.toString() || '{}'); } catch { body = {}; }
      const id = typeof body.conversation === 'string' ? body.conversation : '';
      const bag = state.unread.conversations;
      if (id && Object.prototype.hasOwnProperty.call(bag, id)) {
        const taken = Number(bag[id]) || 0;
        bag[id] = 0;
        if (id === 's-buy' || id === 's-edit') {
          const left = (Number(state.unread.bots.aa) || 0) - taken;
          state.unread.bots.aa = left > 0 ? left : 0;
        }
      }
      return json(res, 200, { ok: true });
    }
    if (path === '/presence' && method === 'GET') {
      return json(res, 200, { ok: true, bots: {
        aa: { state: 'thinking', line: '在想' },
        ab: { state: 'working', line: '在干活' },
        ac: { state: 'waiting', line: '等你点头' },
        ad: { state: 'stuck', line: '卡住了' },
        ae: { state: 'done', line: '刚做完' },
        af: { state: 'working', line: '在写' },
      } });
    }
    if (path.startsWith('/notices') && method === 'GET') {
      return json(res, 200, { ok: true, notice: {
        kind: 'ask', speakerId: 'ac', text: '等你回答定日期', ticketId: TICKET,
      } });
    }
    if (path === '/today' && method === 'GET') return json(res, 200, { ok: true, ...todayBody() });
    if (path === '/board/tickets/' + TICKET && method === 'GET') {
      return json(res, 200, {
        ok: true,
        ticket: { id: TICKET, title: '定日期', open_ask: { text: '哪天' } },
      });
    }
    if (path === '/board/tickets' && method === 'GET') {
      return json(res, 200, { ok: true, tickets: [{
        id: TICKET, title: '定日期', state: 'progress',
        from: { name: 'aa', type: 'assistant' },
        claimedBy: 'ab', claimedByType: 'assistant',
        updatedAt: '2026-11-19T12:00:00.000Z',
      }] });
    }
    if (path.startsWith('/voice/') && method === 'POST') {
      state.voiceSeen += 1;
      state.voice.push({
        requestId: String(req.headers['x-request-id'] || ''),
        query: url.search,
      });
      await gate;
      return json(res, 200, { ok: true, text: '语音原句' });
    }
    if (path === '/groups') return json(res, 200, { ok: true, groups: [] });
    if (path === '/panic/status') {
      return json(res, 200, {
        ok: true, state: 'running', steps: {}, live: { runningSessions: 0, runningExternal: 0 },
      });
    }
    if (path === '/settings/' && method === 'GET') {
      return json(res, 200, {
        ok: true, permission: { mode: 'ask' }, bots: {}, models: [], modelsWritable: false,
      });
    }
    return json(res, 200, { ok: true });
  });
  server.on('clientError', (_error, socket) => { try { socket.end(); } catch { /* 对端已断 */ } });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      state,
      releaseVoice() { release(); },
      async close() {
        release();
        await new Promise(done => server.close(done));
        server.closeAllConnections?.();
      },
    }));
  });
}

async function home(page) {
  await page.evaluate(() => {
    state.detail = false;
    state.drawer = null;
    state.view = 'chat';
    render();
  });
}

describe('第29轮集成修2总走查', { concurrency: 1, skip: skipReason() }, () => {
  let mock;
  let web;
  let origin;

  before(async () => {
    mock = await startWalkMock(MOCK_PORT);
    const dir = await mkdtemp(join(tmpdir(), 'r29b-walk-'));
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

  test('手机尺寸走完状态、提醒、示例句、最近、看板、今天和语音', async () => {
    const playwright = require(playwrightCore());
    const browser = await playwright.chromium.launch({
      executablePath: chromiumBin(), headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    const errors = [];
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, permissions: ['microphone'],
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      page.on('dialog', dialog => dialog.accept());
      await page.route('**/*', route => {
        const target = new URL(route.request().url());
        const local = target.hostname === '127.0.0.1' && target.port === String(WEB_PORT);
        if (target.protocol === 'data:' || target.protocol === 'blob:' || local) return route.continue();
        return route.abort();
      });
      await page.goto(origin + '/?key=' + WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => {
        const cell = document.querySelector('[data-bot-tree="aa"] small');
        return cell && cell.textContent.trim() === '在想';
      }, null, { timeout: 20000 });
      const lines = await page.evaluate(() => [...document.querySelectorAll(
        '.sidebar .pinned [data-bot-tree]')].map(cell => ({
        id: cell.dataset.botTree,
        line: (cell.querySelector('small')?.textContent || '').trim(),
      })));
      const expectLines = {
        aa: '在想', ab: '在干活', ac: '等你点头', ad: '卡住了', ae: '刚做完', af: '在写',
      };
      for (const [id, line] of Object.entries(expectLines)) {
        const found = lines.find(row => row.id === id);
        assert.equal(found && found.line, line, id);
      }
      await page.waitForSelector('[data-owner-notice-go]', { timeout: 15000 });
      assert.equal((await page.locator('[data-owner-notice-go]').innerText()).trim(), '打开今天');
      await page.locator('[data-owner-notice-go]').click();
      await page.waitForFunction(() => state.drawer === 'hub-real-today', null, { timeout: 10000 });
      await home(page);
      await page.locator('.sidebar .pinned [data-bot-tree="ac"] [data-act="bot"]').click();
      await page.waitForSelector('[data-r29-opening]', { timeout: 15000 });
      const opening = (await page.locator('[data-r29-opening]').innerText()).trim();
      assert.equal(opening, '这个说法有没有出处，查一下。');
      const beforeSend = mock.state.messages.length;
      await page.locator('[data-r29-opening]').click();
      assert.equal(await page.locator('[data-focus="composer"]').inputValue(), opening);
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.equal(mock.state.messages.length, beforeSend);
      await page.locator('.composer-area [data-act="send"]').click();
      await page.waitForFunction(() => document.body.innerText.includes('假回复'), null, {
        timeout: 15000,
      });
      await page.locator('button[data-act="back"]').click();
      await page.waitForFunction(() => {
        const list = document.querySelector('.hub-real-recents');
        const text = list ? list.innerText : '';
        return text.includes('甲 · 买菜') && text.includes('甲 · 改稿');
      }, null, { timeout: 15000 });
      const badges = await page.evaluate(() => [...document.querySelectorAll(
        '.hub-real-recents [data-real-open]')].map(row => ({
        id: row.getAttribute('data-real-open'),
        title: row.querySelector('strong')?.textContent || '',
        badge: row.querySelector('[data-r29-unread]')?.textContent || '',
      })));
      const buy = badges.find(row => row.id === 's-buy');
      const edit = badges.find(row => row.id === 's-edit');
      assert.equal(buy && buy.title, '甲 · 买菜');
      assert.equal(edit && edit.title, '甲 · 改稿');
      assert.equal(buy.badge, '+2');
      assert.equal(edit.badge, '+3');
      await page.locator('[data-real-open="s-buy"]').click();
      await page.waitForFunction(() => {
        const row = document.querySelector('[data-real-open="s-buy"]');
        const other = document.querySelector('[data-real-open="s-edit"] [data-r29-unread]');
        return row && !row.querySelector('[data-r29-unread]') && other && other.textContent === '+3';
      }, null, { timeout: 15000 });
      await page.locator('button[data-act="back"]').click();
      await home(page);
      // 看板入口只留首页底栏那一个（新看板）；这里直接核对旧看板抽屉里的接手文字。
      await page.evaluate(() => Hub.openPanel('hub-real-board'));
      await page.waitForFunction(() => state.drawer === 'hub-real-board', null, { timeout: 10000 });
      const boardLine = await page.locator('.hub-real-board-line').first().innerText();
      assert.match(boardLine, /已接手/);
      assert.equal(boardLine.includes('发起'), false);
      await home(page);
      // 今天从底栏进；后端挑的最该先看的一件排在「等你处理」第一行，点开落到看板上这张卡（详情里有完整问题）。
      await page.locator('.r22-home-dock [data-today-open]:visible').first().click();
      await page.waitForFunction(() => {
        const row = document.querySelector('.r30l-b-wait .r30l-trow');
        return Boolean(row && row.textContent.includes('定日期'));
      }, null, { timeout: 10000 });
      await page.locator('.r30l-b-wait .r30l-trow').first().click();
      await page.waitForFunction(() => {
        const sheet = document.querySelector('#r30-sheet .r30-sheet');
        return Boolean(sheet && sheet.textContent.includes('定日期'));
      }, null, { timeout: 10000 });
      await page.locator('#r30-sheet [data-r30-close]').first().click();
      await home(page);
      await page.locator('.sidebar .pinned [data-bot-tree="aa"] [data-act="bot"]').click();
      await page.waitForSelector('[data-r29-mic]', { timeout: 10000 });
      await page.locator('[data-r29-mic]').click();
      await page.waitForFunction(() => document.body.innerText.includes('正在录音'), null, {
        timeout: 10000,
      });
      await page.locator('[data-r29-mic]').click();
      const voiceStart = Date.now();
      while (mock.state.voiceSeen < 1) {
        if (Date.now() - voiceStart > 15000) throw new Error('语音请求没有发出');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await page.locator('button[data-act="back"]').click();
      await page.locator('.sidebar .pinned [data-bot-tree="ab"] [data-act="bot"]').click();
      await page.waitForFunction(() => {
        const shell = document.querySelector('.shell');
        return shell && shell.classList.contains('mobile-detail') && state.bot === 'ab';
      }, null, { timeout: 10000 });
      mock.releaseVoice();
      const landed = Date.now();
      let voiceHit = null;
      while (!voiceHit) {
        voiceHit = mock.state.messages.find(item => item.text.includes('语音原句')) || null;
        if (voiceHit) break;
        if (Date.now() - landed > 15000) throw new Error('语音文字没有送进原会话');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const asked = new URL('http://127.0.0.1' + mock.state.voice[0].query).searchParams.get('conversation');
      assert.ok(mock.state.voice[0].requestId);
      assert.equal(voiceHit.path.includes('/' + asked + '/'), true);
      // 改：s-buy 前面已经点开读过；点甲的头像现在落到还有未读的 s-edit，语音自然记在它名下。
      assert.equal(asked, 's-edit');
      const shown = await page.locator('.thread').innerText();
      assert.equal(shown.includes('语音原句'), false);
      assert.deepEqual(errors, []);
      assert.ok(mock.state.reads <= 12, '全程已读请求 ' + mock.state.reads + ' 次');
    } finally {
      await browser.close();
    }
  });
});
