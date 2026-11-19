// 集成修：转发头、25MB、只读模型，以及单文件壳的手机走查。端口 3641、3642。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHubWeb } from '../server.mjs';
import { startR29ShellMock } from './r29-shell-mock.mjs';

const require = createRequire(import.meta.url);
const { r29CreateHooks } = require('../hub-real.js');
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const WEB = 'web-r29-shell';
const BFF = 'bff-r29-shell';
const shellFile = process.env.HUB_SHELL_DIST || '';
const shellSkip = shellFile && existsSync(shellFile) ? false : '未设置 HUB_SHELL_DIST 或文件不在，跳过单文件壳走查';

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
  const root = join(homedir(), 'Library', 'Caches', 'ms-playwright', 'chromium_headless_shell-1243');
  const bin = join(root, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
  return existsSync(bin) ? bin : '';
}

test('说人话、桌宠、讨论组和 25MB 写在适配层里', () => {
  assert.match(source, /HubPlainTalk/);
  assert.match(source, /renderProject/);
  assert.match(source, /HubPetStage/);
  assert.match(source, /tool-done/);
  assert.match(source, /HubGroups/);
  assert.match(serverSource, /x-request-id/);
  assert.match(serverSource, /25\*1024\*1024/);
  assert.equal(/r29Body\?8\*1024\*1024/.test(serverSource), false);
});

describe('第29轮集成修走查', { concurrency: 1, skip: shellSkip }, () => {
  let mock;
  let web;
  let origin;
  let cookie;

  before(async () => {
    mock = await startR29ShellMock(3641);
    const root = join(process.cwd(), 'test', 'scratch');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'r29-shell-'));
    const shell = join(dir, 'shell');
    await mkdir(shell);
    await copyFile(shellFile, join(shell, 'index.html'));
    await writeFile(join(dir, 'web.key'), WEB, { mode: 0o600 });
    await writeFile(join(dir, 'bff.key'), BFF, { mode: 0o600 });
    web = await createHubWeb({
      HUB_WEB_PORT: '3642', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
      HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'),
      BFF_URL: 'http://127.0.0.1:3641'
    }, { log() {} });
    origin = 'http://127.0.0.1:3642';
    const login = await fetch(origin + '/?key=' + WEB, { redirect: 'manual' });
    cookie = login.headers.get('set-cookie').split(';')[0];
  });

  after(async () => {
    await web?.close();
    await mock?.close();
  });

  function hooks() {
    return r29CreateHooks({
      request(path, options = {}) {
        const headers = { ...(options.headers || {}), cookie, origin };
        return fetch(origin + '/bff' + path, { ...options, headers });
      },
      deliver() {},
      busy: () => false,
      upTo: () => 1
    });
  }

  test('模型只读时不发写入，超限正文被挡住，请求号会转发', async () => {
    const api = hooks();
    const before = mock.state.seen.length;
    const settings = await api.HubSettings.get();
    assert.equal(settings.permission.mode, 'ask');
    assert.deepEqual(settings.models, []);
    assert.equal(settings.modelsWritable, false);
    assert.equal(mock.state.seen.filter(item => item.method === 'PUT').length, 0);
    assert.deepEqual(await api.HubSettings.setBot('aa', { model: 'm', effort: 'low' }),
      { ok: false, error: 'readonly' });
    assert.equal(mock.state.seen.filter(item => item.path.startsWith('/settings/bots/')).length, 0);
    const big = Buffer.alloc(600 * 1024, 1);
    const uploaded = await fetch(origin + '/bff/uploads/?conversation=c1&bot=aa', {
      method: 'POST',
      headers: {
        cookie, origin, 'content-type': 'application/octet-stream',
        'x-filename': 'a.txt', 'x-request-id': 'rid-1'
      },
      body: big
    });
    assert.equal(uploaded.status, 200);
    const hit = mock.state.seen.find(item => item.headers['x-request-id'] === 'rid-1');
    assert.ok(hit);
    assert.equal(hit.headers['x-filename'], 'a.txt');
    const blockedBefore = mock.state.seen.length;
    const blocked = await fetch(origin + '/bff/health', {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/octet-stream' },
      body: big
    });
    assert.equal(blocked.status, 413);
    assert.equal(mock.state.seen.length, blockedBefore);
    assert.ok(mock.state.seen.length > before);
  });

  test('手机尺寸走完首页、会话、未读、文件、语音、更多和权限', async () => {
    const core = playwrightCore();
    const bin = chromiumBin();
    assert.ok(core, '没有 playwright-core');
    assert.ok(bin, '没有已安装的无头浏览器');
    const playwright = require(core);
    const browser = await playwright.chromium.launch({
      executablePath: bin, headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
    });
    const errors = [];
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, permissions: ['microphone']
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      page.on('dialog', dialog => dialog.accept());
      await page.route('**/*', route => {
        const target = new URL(route.request().url());
        if (target.protocol === 'data:' || target.protocol === 'blob:' ||
            (target.hostname === '127.0.0.1' && target.port === '3642')) return route.continue();
        return route.abort();
      });
      await page.goto(origin + '/?key=' + WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => document.querySelectorAll(
        '.sidebar .pinned [data-pet-stage="home"]').length >= 6, null, { timeout: 20000 });
      const home = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('.sidebar .pinned [data-bot-tree]')];
        return {
          stages: cells.filter(cell => cell.querySelector('[data-pet-stage="home"]')).length,
          covered: cells.filter(cell => cell.querySelector(
            'img.hub-real-avatar, img[src*="avatar-96"]')).length
        };
      });
      assert.equal(home.stages, 6);
      assert.equal(home.covered, 0);
      await page.waitForFunction(() => {
        const badge = document.querySelector('.sidebar .pinned [data-r29-unread]');
        return badge && badge.textContent.indexOf('+') === 0;
      }, null, { timeout: 10000 });
      await page.waitForFunction(() => {
        const list = window.HubGroups && HubGroups.list();
        const group = list && list[0];
        return group && group.id === 'g1' && group.members && group.members[0] === 'aa' &&
          group.messages && group.messages[0].text;
      }, null, { timeout: 10000 });
      await page.locator('.sidebar .pinned [data-act="bot"]').first().click();
      await page.waitForSelector('[data-plain-line]', { timeout: 10000 });
      const line = await page.locator('[data-plain-line]').first().innerText();
      assert.match(line, /想/);
      assert.equal(line.includes('ls'), false);
      await page.evaluate(() => {
        window.__pet = [];
        const stage = window.HubPetStage;
        if (!stage || typeof stage.event !== 'function') return;
        const orig = stage.event.bind(stage);
        stage.event = (id, name) => { window.__pet.push(name); return orig(id, name); };
      });
      await page.locator('[data-focus="composer"]').fill('你好');
      await page.waitForSelector('.composer-area [data-act="send"]');
      await page.locator('.composer-area [data-act="send"]').click();
      await page.waitForFunction(() => document.body.innerText.includes('假回复'), null, { timeout: 15000 });
      const pets = await page.evaluate(() => window.__pet || []);
      assert.ok(pets.includes('thinking'));
      assert.ok(pets.includes('done'));
      await page.evaluate(() => {
        const thread = document.querySelector('.thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
      });
      await page.waitForFunction(() => {
        const bag = window.HubUnread && HubUnread.counts();
        return bag && !Number(bag.bots && bag.bots.aa);
      }, null, { timeout: 10000 });
      await page.waitForFunction(() => window.HubReal.state().jobs.length === 0, null, { timeout: 10000 });
      await page.locator('[data-r29-plus]').click();
      await page.setInputFiles('[data-r29-file="any"]', {
        name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hi')
      });
      await page.locator('[data-focus="composer"]').fill('看一下');
      await page.waitForSelector('.composer-area [data-act="send"]');
      await page.locator('.composer-area [data-act="send"]').click();
      await page.waitForFunction(() => document.body.innerText.includes('附了文件'), null, { timeout: 15000 });
      await page.waitForFunction(() => window.HubReal.state().jobs.length === 0, null, { timeout: 10000 });
      await page.locator('[data-r29-mic]').click();
      await page.waitForFunction(() => document.body.innerText.includes('正在录音'), null, { timeout: 10000 });
      await page.locator('[data-r29-mic]').click();
      await page.waitForFunction(() => document.body.innerText.includes('转文字还没接上'), null, { timeout: 10000 });
      await page.locator('[data-r29-settings]').click();
      await page.waitForSelector('[data-r29-readonly="true"]', { timeout: 10000 });
      // 看板、活动首页底栏本来就有，更多第一层不再重复；账本打开的账本页，不再是旧抽屉。
      // 集成：更多第一层只剩五项；权限、外观进了设置，今天在底栏。
      const nine = [
        ['roster', 'hub-real-bots'], ['tasks', 'hub-real-routines'], ['ledger', 'LEDGER-VIEW'],
        ['settings', 'r31-settings'], ['stop', 'hub-real-panic']
      ];
      for (const [id, drawer] of nine) {
        await page.evaluate(() => { state.detail = false; state.drawer = null; state.view = 'chat'; render(); });
        await page.locator('button[data-act="more"]:visible').first().click();
        await page.waitForFunction(() => state.drawer === 'more');
        if (id === 'settings') assert.equal(mock.state.permissionPuts.length, 0);
        await page.locator('[data-r29-more="' + id + '"]').first().click();
        if (drawer === 'LEDGER-VIEW') await page.waitForFunction(() => state.view === 'ledger', null, { timeout: 8000 });
        else await page.waitForFunction(expected => state.drawer === expected, drawer, { timeout: 8000 });
        if (id === 'activity') {
          const spoken = await page.locator('.drawer [data-plain-line]').first().innerText();
          assert.match(spoken, /想/);
        }
        if (id === 'settings') {
          // 权限三档从设置里进
          await page.locator('[data-r31-setting="permissions"]').click();
          await page.waitForFunction(() => state.drawer === 'permission', null, { timeout: 8000 });
          await page.locator('[data-r29-permission="open"]').click();
          const start = Date.now();
          while (!mock.state.permissionPuts.length) {
            if (Date.now() - start > 8000) throw new Error('权限没送到后端');
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          assert.match(mock.state.permissionPuts[0], /"mode":"open"/);
        }
      }
      await page.evaluate(() => { state.detail = false; state.drawer = null; state.view = 'chat'; render(); });
      // 底栏「今天」取代「活动」：待批确认卡在今天页的「等你处理」里。
      await page.locator('.r22-home-dock [data-today-open]:visible').first().click();
      await page.waitForFunction(() => state.drawer === 'hub-real-today', null, { timeout: 8000 });
      await page.waitForFunction(() => /等你处理|暂无|读不到/u.test(document.querySelector('.drawer')?.innerText || ''),
        null, { timeout: 8000 });
      await page.evaluate(() => { state.detail = false; state.drawer = null; render(); });
      await page.locator('button[data-act="more"]:visible').first().click();
      assert.equal(await page.locator('[data-hub-more-item]').count(), 0, '真实模式更多里不再挂晨会晚会纪要等入口');
      await page.evaluate(() => Hub.openPanel('hub-real-meetings'));
      await page.waitForFunction(() => state.drawer === 'hub-real-meetings');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
});
