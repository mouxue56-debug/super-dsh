// 更多页去重、真实模式不挂「样例」、编辑框保留原文且只提交改过的字、
// 看板删卡（页内确认、软删除）、一次清掉已完成的、账本用词、看板页无脚本警告。
// 真适配层 + 真后端处理器，壳走 HUB_SHELL_DIST，截图放 R31_SHOTS。没给壳或没有浏览器时整段跳过。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubWeb } from '../server.mjs';
import { realDeps } from '../../hub-bff/test/real-deps.mjs';

const require = createRequire(import.meta.url);
const WEB = 'web-r31-fa';
const shellFile = process.env.HUB_SHELL_DIST || '';
const shots = process.env.R31_SHOTS || '';

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
const key = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const bucket = (calls, tokens, yuan) => ({ calls,
  tokens: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  unreportedFields: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  cost: { byCurrency: { CNY: { ok: yuan, expired: 0 } }, pendingCalls: 0, expiredCalls: 0, planCalls: 0,
    planReference: {}, localCalls: 0 } });
const days = [...Array(14).keys()].map(i => [key(13 - i), bucket(3 + i, 90000 + i * 5000, 1 + i / 5)]);
const ledgerBody = { total: bucket(100, 1200000, 40),
  byBot: { chief: bucket(60, 700000, 20) }, byDay: Object.fromEntries(days),
  last7Days: { days: days.slice(7).map(([date, b]) => ({ date, ...b })), total: bucket(70, 800000, 20) },
  byTicket: {}, counts: {} };

describe('第31轮 FA：更多页、样例标记、编辑原文、删卡', { concurrency: 1, skip: skipReason() }, () => {
  let env, bff, web, origin, browser;
  before(async () => {
    env = await realDeps({ handlerOptions: { hubConfig: { timezone: 'Asia/Tokyo', meetings: { times: {} } } } });
    await env.f.handler.start();
    bff = http.createServer((req, res) => { void env.f.handler(req, res); });
    await new Promise(resolve => bff.listen(0, '127.0.0.1', resolve));
    const dir = await mkdtemp(join(tmpdir(), 'r31-fa-'));
    await mkdir(join(dir, 'shell'));
    await copyFile(shellFile, join(dir, 'shell', 'index.html'));
    await writeFile(join(dir, 'web.key'), WEB, { mode: 0o600 });
    await writeFile(join(dir, 'bff.key'), 'synthetic-bff-key', { mode: 0o600 });
    web = await createHubWeb({ HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1',
      HUB_WEB_SHELL_DIR: join(dir, 'shell'), HUB_WEB_KEY_FILE: join(dir, 'web.key'),
      BFF_KEY_FILE: join(dir, 'bff.key'), BFF_URL: `http://127.0.0.1:${bff.address().port}` }, { log() {} });
    origin = `http://127.0.0.1:${web.servers[0].address().port}`;
    const playwright = require(playwrightCore());
    browser = await playwright.chromium.launch({ executablePath: chromiumBin(), headless: true });
  });
  after(async () => {
    await browser?.close();
    await web?.close();
    await new Promise(resolve => bff?.close(resolve));
    bff?.closeAllConnections?.();
    await env?.f.dispose();
  });

  async function open({ width = 390, height = 844, mockLedger = false } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 700,
      isMobile: width < 700, deviceScaleFactor: width < 700 ? 2 : 1 });
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', e => problems.push('pageerror ' + e));
    page.on('console', m => {
      if (m.type() !== 'warning' && m.type() !== 'error') return;
      const text = m.text();
      // 离线试验台没带字体和宠物素材；已读 404 属于B 路的未读逻辑，另行处理。
      if (/Failed to load resource/u.test(text)) return;
      problems.push(m.type() + ' ' + text);
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      const local = url.hostname === '127.0.0.1' && url.origin === origin;
      if (!local && url.protocol !== 'data:' && url.protocol !== 'blob:') return route.abort();
      if (mockLedger && url.pathname === '/bff/ledger') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ledgerBody) });
      }
      return route.continue();
    });
    await page.goto(origin + '/?key=' + WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.sidebar .pinned [data-bot-tree]'), null,
      { timeout: 20000 });
    await page.waitForTimeout(600);
    return { context, page, problems };
  }
  const reset = async page => {
    await page.evaluate(() => { Hub.state.drawer = null; Hub.navigate({ view: 'chat' }); });
    await page.waitForTimeout(250);
  };
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, name) }); };
  const make = (page, body) => page.evaluate(async b => {
    const r = await fetch('/bff/board/tickets/new', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    return (await r.json()).ticket.id;
  }, body);
  const tickets = page => page.evaluate(async () =>
    (await (await fetch('/bff/board/tickets')).json()).tickets);
  const visibleLabels = page => page.evaluate(() => [...document.querySelectorAll('.drawer button')]
    .filter(b => b.offsetParent).map(b => (b.textContent || '').replace(/\s+/g, '').trim()).filter(Boolean));

  test('更多第一层：没有看板和活动，没有重复项，每一项都点得开且有内容', async () => {
    const { context, page, problems } = await open();
    try {
      await page.evaluate(() => Hub.openPanel('more'));
      await page.waitForSelector('[data-r29-more-list]');
      const labels = await visibleLabels(page);
      // 集成：更多第一层只剩五项；今天、看板在底栏，权限和外观在设置里，新建助理在名册里。
      assert.deepEqual(labels, ['助理名册', '固定任务', '账本', '设置', '全部暂停／恢复']);
      assert.equal(new Set(labels).size, labels.length, '不重复');
      assert.ok(!labels.some(t => /看板|活动|今天/u.test(t)), '看板和今天在首页底栏，更多里不放');
      await shot(page, 'more-after.png');
      // 首页底栏仍有看板和活动入口（另一处的那个入口）。
      await reset(page);
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.r22-home-dock button')]
        .map(b => b.textContent.trim())), ['更多', '看板', '今天']);
      for (let i = 0; i < labels.length; i += 1) {
        await reset(page);
        await page.evaluate(() => Hub.openPanel('more'));
        await page.waitForSelector('[data-r29-more-list]');
        const button = page.locator('.drawer button:visible').filter({ hasText: /\S/ }).nth(i);
        await button.click();
        await page.waitForTimeout(700);
        const seen = await page.evaluate(() => ({ drawer: Hub.state.drawer, view: Hub.state.view,
          text: (document.querySelector('.drawer') || document.querySelector('#hub-view') || document.body)
            .innerText.replace(/\s+/g, ' ').trim() }));
        const expectView = labels[i] === '账本' ? 'ledger' : null;
        if (expectView) assert.equal(seen.view, expectView, '账本打开的是第30轮的账本页');
        else assert.ok(seen.drawer, labels[i] + ' 应打开一页');
        assert.ok(seen.text.length > 12, labels[i] + ' 不是空页：' + seen.text);
      }
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });

  test('真实模式下看板、账本、舞台页标题旁不挂「样例」', async () => {
    const { context, page, problems } = await open({ width: 1440, height: 900 });
    try {
      for (const view of ['kanban', 'ledger', 'stage']) {
        await reset(page);
        await page.evaluate(v => Hub.navigate({ view: v }), view);
        await page.waitForTimeout(1200);
        assert.equal(await page.locator('.hub-real-sample').count(), 0, view + ' 页不该有样例角标');
        const text = await page.evaluate(() => document.body.innerText);
        assert.ok(!/样例|离线演示|本页演示/u.test(text), view + ' 页里有演示字样');
        if (view === 'kanban') await shot(page, 'desk-board-no-sample.png');
      }
      assert.deepEqual(problems, [], '电脑版开看板页没有脚本警告');
    } finally { await context.close(); }
  });

  test('编辑框是库里的原文；只改说明保存，标题（含「验收」）一字不动', async () => {
    const { context, page } = await open();
    try {
      const longTitle = '整理资料 验收一下' + '长'.repeat(60);
      const id = await make(page, { title: longTitle, goal: '先分年份，再做验收。' });
      await reset(page);
      await page.evaluate(() => Hub.navigate({ view: 'kanban' }));
      await page.waitForSelector('.r30-card');
      await page.locator('.r30-card:visible').first().click();
      await page.locator('[data-r30-edit]').click();
      const form = await page.evaluate(() => ({
        title: document.querySelector('[data-r30-form] [name=title]').value,
        goal: document.querySelector('[data-r30-form] [name=goal]').value }));
      assert.equal(form.title, longTitle, '编辑框里是原文，没被说人话替换，也没被截成 40 字');
      assert.equal(form.goal, '先分年份，再做验收。');
      await shot(page, 'edit-raw.png');
      await page.locator('[data-r30-form] [name=goal]').fill('先分年份，再做验收。补一句');
      await page.locator('[data-r30-save]').click();
      await page.waitForTimeout(800);
      const saved = (await tickets(page)).find(t => t.id === id);
      assert.equal(saved.title, longTitle, '没动过的标题原样留在库里');
      assert.equal(saved.goal, '先分年份，再做验收。补一句');
      assert.ok(!saved.title.includes('看过确认'));
      // 什么都没改直接保存：不发请求，库里的字不变。
      await page.locator('[data-r30-edit]').click();
      let posts = 0;
      page.on('request', r => { if (r.method() === 'POST' && /\/edit$/u.test(r.url())) posts += 1; });
      await page.locator('[data-r30-save]').click();
      await page.waitForTimeout(500);
      assert.equal(posts, 0);
      assert.equal((await tickets(page)).find(t => t.id === id).title, longTitle);
    } finally { await context.close(); }
  });

  test('看板卡「删掉这张」：页内二次确认，软删除；先不删则原样', async () => {
    const { context, page } = await open();
    try {
      const base = (await tickets(page)).length;
      const keep = await make(page, { title: '留着的卡' });
      const gone = await make(page, { title: '要删的卡' });
      await reset(page);
      await page.evaluate(() => Hub.navigate({ view: 'kanban' }));
      await page.waitForSelector('.r30-card');
      await page.locator('.r30-card:visible', { hasText: '要删的卡' }).click();
      await page.locator('[data-r30-del]').click();
      assert.equal(await page.locator('.r30-confirm').count(), 1, '页内确认条出现');
      assert.match(await page.locator('.r30-confirm').innerText(), /要删的卡/u);
      await shot(page, 'delete-confirm.png');
      let dialogs = 0;
      page.on('dialog', d => { dialogs += 1; void d.dismiss(); });
      await page.locator('[data-r30-del-no]').click();
      assert.equal((await tickets(page)).length, base + 2, '先不删：两张都在');
      await page.locator('[data-r30-del]').click();
      await page.locator('[data-r30-del-yes]').click();
      await page.waitForTimeout(900);
      assert.equal(dialogs, 0, '不用浏览器弹窗');
      const rest = (await tickets(page)).map(t => t.id);
      assert.ok(rest.includes(keep) && !rest.includes(gone) && rest.length === base + 1);
      assert.equal(await page.locator('.r30-card:visible', { hasText: '要删的卡' }).count(), 0);
    } finally { await context.close(); }
  });

  test('一次清掉已完成的：先确认，只清完成列，别的列不动', async () => {
    const { context, page } = await open();
    try {
      const before = (await tickets(page)).filter(t => t.state !== 'completed').length;
      await make(page, { title: '进行中的卡', column: 'progress' });
      await make(page, { title: '做完了甲', column: 'done' });
      await make(page, { title: '做完了乙', column: 'done' });
      await reset(page);
      await page.evaluate(() => Hub.navigate({ view: 'kanban' }));
      await page.waitForSelector('.r30-card');
      await page.locator('.r30-tab[data-r30-tab="done"]').click();
      await page.locator('[data-r30-clear]:visible').click();
      const doneCount = (await tickets(page)).filter(t => t.state === 'completed').length;
      assert.match(await page.locator('.r30-confirm:visible').innerText(), new RegExp(doneCount + ' 张', 'u'));
      await shot(page, 'clear-confirm.png');
      await page.locator('[data-r30-del-no]:visible').click();
      assert.equal((await tickets(page)).filter(t => t.state === 'completed').length, doneCount, '先不清：没动');
      await page.locator('[data-r30-clear]:visible').click();
      await page.locator('[data-r30-clear-yes]:visible').click();
      await page.waitForTimeout(1000);
      const left = await tickets(page);
      assert.equal(left.filter(t => t.state === 'completed').length, 0, '完成列清空');
      assert.equal(left.length, before + 1, '别的列一张没少');
      assert.ok(left.some(t => t.title === '进行中的卡'));
    } finally { await context.close(); }
  });

  test('账本页没有 token 这个词', async () => {
    const { context, page } = await open({ mockLedger: true });
    try {
      assert.equal(await page.locator('.ledger-shortcut').first().getAttribute('aria-label'), '打开账本');
      await page.evaluate(() => Hub.navigate({ view: 'ledger' }));
      await page.waitForSelector('[data-r30l-ledger="real"] .r30l-bars', { timeout: 15000 });
      await page.locator('[data-r30l-act="metric:tokens"]').click().catch(() => {});
      const text = await page.evaluate(() => document.body.innerText);
      assert.ok(!/token/iu.test(text), '账本页里还有 token：' + (text.match(/.{0,10}token.{0,10}/iu) || [''])[0]);
      assert.match(text, /用量/u);
      await shot(page, 'ledger-words.png');
    } finally { await context.close(); }
  });
});
