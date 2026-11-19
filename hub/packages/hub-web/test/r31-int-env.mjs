// 集成：给浏览器检查用的环境——真适配层 + 真后端处理器 + 界面壳 HUB_SHELL_DIST。
import http from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubWeb } from '../server.mjs';
import { realDeps } from '../../hub-bff/test/real-deps.mjs';

const require = createRequire(import.meta.url);
export const WEB = 'web-r31-int';
export const shellFile = process.env.HUB_SHELL_DIST || '';
export const shots = process.env.R31_SHOTS || '';

export function playwrightCore() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const direct = join(homedir(), 'node_modules/playwright-core');
  if (existsSync(join(direct, 'package.json'))) return direct;
  const root = join(homedir(), '.npm', '_npx');
  if (!existsSync(root)) return '';
  for (const name of readdirSync(root)) {
    const dir = join(root, name, 'node_modules', 'playwright-core');
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return '';
}
export function chromiumBin() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const bin = join(homedir(), 'Library', 'Caches', 'ms-playwright',
    'chromium_headless_shell-1243', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
  return existsSync(bin) ? bin : '';
}
export function skipReason() {
  if (!shellFile || !existsSync(shellFile)) return '未设置 HUB_SHELL_DIST 或文件不在，跳过';
  if (!playwrightCore()) return '没有 playwright-core，跳过';
  if (!chromiumBin()) return '没有已安装的无头浏览器，跳过';
  return false;
}

export async function start(handlerOptions) {
  const env = await realDeps({ handlerOptions: handlerOptions || { hubConfig: { timezone: 'Asia/Tokyo', meetings: { times: {} } } } });
  await env.f.handler.start();
  const bff = http.createServer((req, res) => { void env.f.handler(req, res); });
  await new Promise(resolve => bff.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'r31-int-'));
  await mkdir(join(dir, 'shell'));
  await copyFile(shellFile, join(dir, 'shell', 'index.html'));
  await writeFile(join(dir, 'web.key'), WEB, { mode: 0o600 });
  await writeFile(join(dir, 'bff.key'), 'synthetic-bff-key', { mode: 0o600 });
  const web = await createHubWeb({ HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1',
    HUB_WEB_SHELL_DIR: join(dir, 'shell'), HUB_WEB_KEY_FILE: join(dir, 'web.key'),
    BFF_KEY_FILE: join(dir, 'bff.key'), BFF_URL: `http://127.0.0.1:${bff.address().port}` }, { log() {} });
  const origin = `http://127.0.0.1:${web.servers[0].address().port}`;
  const playwright = require(playwrightCore());
  const browser = await playwright.chromium.launch({ executablePath: chromiumBin(), headless: true });
  async function open({ width = 390, height = 844, scheme = 'light' } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 700,
      isMobile: width < 700, deviceScaleFactor: width < 700 ? 2 : 1, colorScheme: scheme });
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', e => problems.push('pageerror ' + e));
    page.on('console', m => {
      if (m.type() !== 'warning' && m.type() !== 'error') return;
      const text = m.text();
      if (/Failed to load resource/u.test(text)) return;
      problems.push(m.type() + ' ' + text);
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      const local = url.hostname === '127.0.0.1' && url.origin === origin;
      if (!local && url.protocol !== 'data:' && url.protocol !== 'blob:') return route.abort();
      return route.continue();
    });
    await page.goto(origin + '/?key=' + WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.sidebar .pinned [data-bot-tree]'), null, { timeout: 20000 });
    await page.waitForTimeout(600);
    return { context, page, problems };
  }
  async function stop() {
    await browser?.close();
    await web?.close();
    await new Promise(resolve => bff?.close(resolve));
    bff?.closeAllConnections?.();
    await env?.f.dispose();
  }
  return { env, open, stop, origin };
}
