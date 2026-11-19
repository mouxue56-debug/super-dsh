// 账本页和今天页（真实方式）。真适配层加假后端，壳走 HUB_SHELL_DIST，截图放 R30_SHOTS。
// 没给壳、没有浏览器时整段跳过，不算失败。端口 3751、3752。
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
const WEB = 'web-r30l-ledger';
const BFF = 'bff-r30l-ledger';
const MOCK_PORT = 3751;
const WEB_PORT = 3752;
const shellFile = process.env.HUB_SHELL_DIST || '';
const shots = process.env.R30_SHOTS || '';

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
  if (!shellFile || !existsSync(shellFile)) return '未设置 HUB_SHELL_DIST 或文件不在，跳过';
  if (!playwrightCore()) return '没有 playwright-core，跳过';
  if (!chromiumBin()) return '没有已安装的无头浏览器，跳过';
  return false;
}
function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const keyOf = offset => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
const bucket = (calls, input, output, yuan) => ({
  calls, tokens: { input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  unreportedFields: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  cost: { byCurrency: { CNY: { ok: yuan, expired: 0 } }, pendingCalls: 0, expiredCalls: 0, planCalls: 0,
    planReference: {}, localCalls: 0 },
});
const shape = [2, 5, 3, 8, 6, 9, 7, 4, 6, 10, 8, 5, 11, 7];
const dayRows = shape.map((n, i) => [keyOf(13 - i), bucket(n * 3, n * 9000, n * 3000, n * 0.4)]);
const ledgerBody = {
  total: bucket(400, 3000000, 900000, 95.2),
  byBot: { aa: bucket(150, 1200000, 300000, 40.1), ab: bucket(120, 900000, 300000, 30),
    ac: bucket(80, 600000, 200000, 20.4),
    '(无助理)': bucket(10, 100000, 40000, 4.7) },
  byDay: Object.fromEntries(dayRows),
  last7Days: { days: dayRows.slice(7).map(([date, b]) => ({ date, ...b })), total: bucket(204, 1500000, 500000, 38) },
  byTicket: { 'T-20261119-120000-ab12': bucket(9, 80000, 20000, 2.2), '(无工单)': bucket(30, 200000, 50000, 6) },
  counts: { approvals: 1, actions: 2, changes: 3, dispatches: 4 },
};
const TICKET = 'T-20261119-120000-ab12';
const todayBody = () => ({
  date: keyOf(0), utcOffsetMinutes: 0,
  headline: { status: 'item', id: TICKET, place: 'question', text: '等你回答「定日期」', kind: 'answer' },
  waiting: { available: true,
    waitingAnswer: [{ id: TICKET, title: '定日期', assistant: 'ab', reason: '哪天合适？' }],
    blocked: [{ id: 'T-x', title: '连不上日历 <b>卡住</b>', assistant: 'ac', reason: '没有权限' }],
    awaitingReview: [{ id: 'T-y', title: '周报初稿', assistant: 'aa', reason: '' }] },
  approvals: { available: true, cardsSource: 'live',
    cards: [{ id: 'c1', title: '想拉个讨论组：选题', assistant: 'aa', ask: '要拉吗' }], kbDrafts: [] },
  checkedResults: { available: true, items: [] },
  yesterdayDone: { available: true, total: 3, byAssistant: [] },
  yesterdayUsage: { available: true, byAssistant: [], total: null },
  lastEveningMinutes: { available: true, text: '' },
  routines: { available: true, items: [
    { id: 'r1', name: '早间整理', assistant: 'aa', at: '07:30', todayState: 'reported' },
    { id: 'r2', name: '午间巡检', assistant: 'ab', at: '12:00', todayState: 'started', running: true },
    { id: 'r3', name: '晚会', assistant: 'ac', at: '21:00', todayState: 'pending' },
    { id: 'r4', name: '周报', assistant: 'aa', at: '18:00', todayState: 'missed' }] },
});
const ticketsBody = () => ({ tickets: [
  { id: 'T-p1', title: '整理资料 <i>草稿</i>', state: 'progress', claimedBy: 'ab',
    progress: [{ text: '读完第一份' }, { text: '开始对稿' }], updatedAt: new Date().toISOString() },
  { id: 'T-d1', title: '做好封面', state: 'completed', claimedBy: 'ac', report: { summary: '三选一已出' },
    history: [{ action: 'accepted', ts: new Date().toISOString() }], updatedAt: new Date().toISOString() },
] });

function startMock(port, mode) {
  const ids = ['aa', 'ab', 'ac'];
  const names = ['甲', '乙', '丙'];
  const server = http.createServer(async (req, res) => {
    req.on('error', () => {});
    for await (const chunk of req) void chunk;
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/^\/bff(?=\/)/, '') || '/';
    if (path === '/events' || path.endsWith('/stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': ok\n\n');
      return;
    }
    if (path === '/health') return json(res, 200, { ok: true, dsh: { connected: true } });
    if (path === '/status') {
      return json(res, 200, { ok: true, pendingTotal: 0,
        bots: Object.fromEntries(ids.map(id => [id, { running: false, pending: 0, unread: 0 }])) });
    }
    if (path === '/bots') {
      return json(res, 200, { ok: true, bots: ids.map((id, i) => ({ id, name: names[i], status: 'active',
        role: i === 0 ? 'chief' : 'bot', order: i + 1, duty: '示例' })) });
    }
    if (path === '/sessions') return json(res, 200, { sessions: [] });
    if (path === '/ledger') return mode.empty ? json(res, 200, { total: bucket(0, 0, 0, 0), byBot: {}, byDay: {},
      last7Days: { days: dayRows.slice(7).map(([date]) => ({ date, ...bucket(0, 0, 0, 0) })),
        total: bucket(0, 0, 0, 0) },
      byTicket: {}, counts: {} }) : json(res, 200, ledgerBody);
    if (path === '/ledger/today') return json(res, 200, { total: dayRows[13][1] });
    if (path === '/today') return json(res, 200, { ok: true, ...todayBody() });
    if (path === '/board/tickets') return json(res, 200, { ok: true, ...ticketsBody() });
    if (path === '/presence') return json(res, 200, { ok: true, bots: {} });
    if (path === '/unread/') return json(res, 200, { ok: true, conversations: {}, bots: {}, groups: {} });
    if (path === '/settings/') {
      return json(res, 200, { ok: true, permission: { mode: 'ask' }, bots: {}, models: [], modelsWritable: false });
    }
    return json(res, 200, { ok: true });
  });
  server.on('clientError', (_e, socket) => { try { socket.end(); } catch { /* 对端已断 */ } });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      async close() { await new Promise(done => server.close(done)); server.closeAllConnections?.(); },
    }));
  });
}

describe('第30轮 账本页和今天页（真实方式）', { concurrency: 1, skip: skipReason() }, () => {
  let mock;
  let web;
  let origin;
  before(async () => {
    mock = await startMock(MOCK_PORT, {});
    const dir = await mkdtemp(join(tmpdir(), 'r30l-ledger-'));
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
  after(async () => { await web?.close(); await mock?.close(); });

  const sizes = [['390', 390, 844], ['1440', 1440, 900]];
  for (const theme of ['light', 'dark']) {
    for (const [tag, width, height] of sizes) {
      test(`账本和今天 ${tag} ${theme}`, async () => {
        const playwright = require(playwrightCore());
        const browser = await playwright.chromium.launch({ executablePath: chromiumBin(), headless: true });
        const errors = [];
        try {
          const context = await browser.newContext({ viewport: { width, height } });
          const page = await context.newPage();
          page.on('pageerror', error => errors.push(String(error)));
          await page.route('**/*', route => {
            const target = new URL(route.request().url());
            const local = target.hostname === '127.0.0.1' && target.port === String(WEB_PORT);
            return target.protocol === 'data:' || target.protocol === 'blob:' || local
              ? route.continue() : route.abort();
          });
          await page.goto(origin + '/?key=' + WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForFunction(() => document.querySelector('.sidebar .pinned [data-bot-tree="aa"]'),
            null, { timeout: 20000 });
          await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
          await page.evaluate(() => { Hub.navigate({ view: 'ledger' }); });
          await page.waitForSelector('[data-r30l-ledger="real"] .r30l-bars', { timeout: 15000 }).catch(async error => {
            const info = await page.evaluate(() => JSON.stringify({ mode: document.documentElement.dataset.hubMode,
              view: state.mode,
              html: (document.querySelector('.hub-extension-view') || document.body).innerHTML.slice(0, 700) }));
            throw new Error(String(error.message).split('\n')[0] + ' ' + info);
          });
          await page.waitForFunction(() => document.querySelectorAll('.r30l-stat').length === 3);
          await page.waitForFunction(() => document.querySelectorAll('.r30l-col').length === 7);
          await page.locator('[data-r30l-act="range:14"]').click();
          await page.waitForFunction(() => document.querySelectorAll('.r30l-col').length === 14);
          await page.waitForFunction(() => document.querySelectorAll('.r30l-hrow').length >= 3);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert.ok(overflow <= 1, '横向溢出 ' + overflow);
          if (shots) await page.screenshot({ path: join(shots, `real-ledger-${tag}-${theme}.png`) });
          await page.evaluate(() => { Hub.navigate({ view: 'chat' }); });
          await page.evaluate(() => { Hub.openPanel('more'); });
          // 今天不在更多里，从底栏「今天」进；一句话总结和三组数字已删，第一件待办直接露出来。
          await page.evaluate(() => { Hub.state.drawer = null; Hub.openPanel('hub-real-today'); });
          await page.waitForSelector('[data-r30l-today="real"] .r30l-block', { timeout: 15000 });
          await page.waitForFunction(() => document.querySelectorAll('.r30l-block').length === 4
            && document.querySelector('.r30l-b-wait .r30l-trow'));
          assert.equal(await page.locator('.r30l-lead, .r30l-pill, [data-real-today-lead]').count(), 0, '没有总结句和三组数字');
          assert.ok(await page.locator('.r30l-b-wait .r30l-trow').count() >= 1, '第一件待办直接露出来');
          assert.equal(await page.locator('.r30l-b-doing .r30l-trow').count(), 1);
          assert.equal(await page.locator('.r30l-b-done .r30l-trow').count(), 1);
          assert.equal(await page.locator('.r30l-b-rout .r30l-trow').count(), 4);
          assert.equal(await page.locator('.r30l-today b, .r30l-today i').evaluateAll(
            nodes => nodes.filter(n => n.querySelector('b,i')).length), 0, '标题里的标签没有被转义');
          if (shots && width < 700) await page.setViewportSize({ width, height: 1800 });
          if (shots) {
            await page.locator('.drawer').first().screenshot({ path: join(shots, `real-today-${tag}-${theme}.png`) });
          }
          await page.locator('.r30l-b-wait .r30l-trow').first().click();
          assert.deepEqual(errors, []);
        } finally {
          await browser.close();
        }
      });
    }
  }
});
