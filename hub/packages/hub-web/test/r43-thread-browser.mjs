import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubWeb } from '../server.mjs';
import { startThreadMock } from './r43-thread-mock.mjs';

const require = createRequire(import.meta.url);
const shellFile = process.env.HUB_SHELL_DIST || '';

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

export function skipReason() {
  if (!shellFile || !existsSync(shellFile)) return '请设置 HUB_SHELL_DIST 为已构建的真壳';
  if (!playwrightCore() || !chromiumBin()) return '没有已安装的 playwright-core 或无头浏览器';
  return false;
}

// 所有端口由系统分配。每次只运行这一例的浏览器，结束后关闭服务并点名清理临时文件。
export async function withThreadApp(options, run) {
  const { viewport = { width: 390, height: 844 }, colorScheme = 'light', captureName, ...mockOptions } = options;
  const mock = await startThreadMock(mockOptions);
  const dir = await mkdtemp(join(tmpdir(), 'r43-thread-'));
  const shell = join(dir, 'shell');
  let web;
  let browser;
  const errors = [];
  try {
    await mkdir(shell);
    await copyFile(shellFile, join(shell, 'index.html'));
    await writeFile(join(dir, 'web.key'), 'r43-local-web-fixture', { mode: 0o600 });
    await writeFile(join(dir, 'bff.key'), 'r43-local-bff-fixture', { mode: 0o600 });
    web = await createHubWeb({
      HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
      HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'), BFF_URL: mock.url,
    }, { log() {} });
    const port = web.servers[0].address().port;
    browser = await require(playwrightCore()).chromium.launch({
      executablePath: chromiumBin(), headless: true, args: ['--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      viewport, hasTouch: true, isMobile: viewport.width < 700, deviceScaleFactor: 2, colorScheme,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(String(error)));
    await page.route('**/*', route => {
      const target = new URL(route.request().url());
      return target.hostname === '127.0.0.1' && target.port === String(port)
        ? route.continue() : route.abort();
    });
    await page.goto('http://127.0.0.1:' + port + '/?key=r43-local-web-fixture', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForSelector('[data-real-group="g3"]', { timeout: 20000 });
    await run({ page, mock, context, errors });
    if (captureName && process.env.R43_SCREENSHOT_DIR) {
      await mkdir(process.env.R43_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.R43_SCREENSHOT_DIR, captureName + '.png') });
    }
    assert.deepEqual(errors, [], '浏览器不应产生异常');
  } finally {
    await browser?.close();
    await web?.close();
    await mock.close();
    for (const file of [join(shell, 'index.html'), join(dir, 'web.key'), join(dir, 'bff.key')]) {
      await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await rmdir(shell).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(dir);
  }
}

export async function openBot(page, bot = 'aa') {
  await page.locator('[data-bot-tree="' + bot + '"] [data-act="bot"]').tap();
  await page.waitForSelector('.thread [data-message-id]', { timeout: 10000 });
}

export async function goHome(page) {
  await page.evaluate(() => document.querySelector('.chat-header [data-act="back"]')?.click());
  await page.waitForSelector('[data-bot-tree="aa"]');
}

export async function until(page, check, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!check() && Date.now() < deadline) await page.waitForTimeout(50);
  assert.ok(check(), '等待状态更新超时');
}

export const badge = (page, selector) => page.evaluate(value =>
  document.querySelector(value + ' [data-r29-unread]')?.textContent || '', selector);
