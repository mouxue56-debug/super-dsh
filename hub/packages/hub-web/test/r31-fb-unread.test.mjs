// 真壳、带状态的假后端、手机宽度。点开就算看过 / 点头像落到有未读那段 / 失败重试不弹回 /
// 旧数字不写回 / 看着时来了新回复自动读掉 / 另有未读入口 / 群里回复自己出现。端口由系统分配。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHubWeb } from '../server.mjs';
import { startMock } from './r31-fb-mock.mjs';

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

function skipReason() {
  if (!shellFile || !existsSync(shellFile)) return '未设置 HUB_SHELL_DIST 或文件不在，跳过走查';
  if (!playwrightCore()) return '没有 playwright-core，跳过走查';
  if (!chromiumBin()) return '没有已安装的无头浏览器，跳过走查';
  return false;
}

// 起一套假后端 + 网页服务 + 手机宽度浏览器，跑完整套收掉。
async function withApp(options, run) {
  const { viewport = { width: 390, height: 844 }, ...mockOptions } = options;
  const mock = await startMock(0, mockOptions);
  const dir = await mkdtemp(join(tmpdir(), 'r31-fb-'));
  const shell = join(dir, 'shell');
  await mkdir(shell);
  await copyFile(shellFile, join(shell, 'index.html'));
  await writeFile(join(dir, 'web.key'), 'web-r31', { mode: 0o600 });
  await writeFile(join(dir, 'bff.key'), 'bff-r31', { mode: 0o600 });
  const web = await createHubWeb({
    HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
    HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'),
    BFF_URL: 'http://127.0.0.1:' + mock.port,
  }, { log() {} });
  const origin = 'http://127.0.0.1:' + web.servers[0].address().port;
  const browser = await require(playwrightCore()).chromium.launch({
    executablePath: chromiumBin(), headless: true, args: ['--disable-dev-shm-usage'],
  });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.route('**/*', route => {
      const target = new URL(route.request().url());
      if (target.origin === origin) return route.continue();
      return route.abort();
    });
    await page.goto(origin + '/?key=web-r31', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('[data-real-group="g3"]', { timeout: 20000 });
    await run({ page, mock, errors });
    assert.equal(errors.length, 0, errors.join('\n'));
  } finally {
    await browser.close();
    await web.close();
    await mock.close();
  }
}

const homeBadge = (page, bot) => page.evaluate(id =>
  document.querySelector('[data-bot-tree="' + id + '"] [data-r29-unread]')?.textContent || '', bot);
const rowBadge = (page, id) => page.evaluate(sid =>
  document.querySelector('[data-real-open="' + sid + '"] [data-r29-unread]')?.textContent || '', id);
const groupBadge = (page, id) => page.evaluate(gid =>
  document.querySelector('[data-real-group="' + gid + '"] [data-r29-unread]')?.textContent || '', id);
const goHome = async page => {
  await page.evaluate(() => document.querySelector('.chat-header [data-act="back"]')?.click());
  await page.waitForSelector('[data-bot-tree="aa"]');
};
const until = async (page, check, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await page.waitForTimeout(200);
};

describe('第31轮 FB：未读点了就消、群里回复自己出现', { concurrency: 1, skip: skipReason() }, () => {
  test('三处数字一致：首页格子 = 这位助理名下各行之和；群行单独一个数', async () => {
    await withApp({}, async ({ page }) => {
      await page.waitForSelector('[data-real-open="s-old"] [data-r29-unread]');
      assert.equal(await homeBadge(page, 'aa'), '+2');
      assert.equal(await rowBadge(page, 's-old'), '+2');
      assert.equal(await rowBadge(page, 's-new'), '');
      assert.equal(await homeBadge(page, 'ab'), '+1');
      assert.equal(await rowBadge(page, 's-b'), '+1');
      assert.equal(await groupBadge(page, 'g3'), '+1');
      // 派工会话（purpose=board）算在 ac 名下，行上看得见
      assert.equal(await homeBadge(page, 'ac'), '+1');
      assert.equal(await rowBadge(page, 's-board'), '+1');
    });
  });

  test('电脑宽度首页载入：不拿壳自己编的会话号（如 aa-013）去标已读，不再 404', async () => {
    await withApp({ viewport: { width: 1440, height: 900 } }, async ({ page, mock }) => {
      await page.waitForTimeout(2500);
      assert.deepEqual(mock.state.reads.filter(r => r.status !== 200), [], JSON.stringify(mock.state.reads));
      assert.ok(!mock.state.reads.some(r => /-013$/.test(String(r.body.conversation))), JSON.stringify(mock.state.reads));
      // 直接调也不发
      await page.evaluate(() => window.HubUnread.markRead('aa-013'));
      await page.waitForTimeout(300);
      assert.ok(!mock.state.reads.some(r => r.body.conversation === 'aa-013'));
    });
  });

  test('点头像：落到有未读的那一段，头像、行上的数字立刻没了，后端读到最新', async () => {
    await withApp({}, async ({ page, mock }) => {
      await page.waitForSelector('[data-bot-tree="aa"] [data-r29-unread]');
      await page.locator('[data-bot-tree="aa"] [data-act="bot"]').click();
      await page.waitForFunction(() => /早先/.test(document.querySelector('.thread')?.innerText || ''),
        null, { timeout: 8000 });
      await page.waitForTimeout(500);
      assert.equal(mock.state.cursors['s-old'], '9');
      assert.deepEqual(mock.state.reads.filter(r => r.status !== 200), []);
      await goHome(page);
      assert.equal(await homeBadge(page, 'aa'), '');
      assert.equal(await rowBadge(page, 's-old'), '');
    });
  });

  test('点最近列表的一行：不用滚到底，数字当场没，只读这一段', async () => {
    await withApp({}, async ({ page, mock }) => {
      // 一条比屏幕还高的长回复排在最后：以前「滚到底才算读」，停在上半截就一直不算
      mock.state.history['s-b'] = [
        { id: '2', role: 'user', text: '问', seq: 2, ts: 1 },
        { id: '4', role: 'assistant', text: '很长的回复。\n\n'.repeat(120), seq: 4, ts: 2 },
      ];
      await page.waitForSelector('[data-real-open="s-b"] [data-r29-unread]');
      await page.locator('[data-real-open="s-b"]').click();
      await page.waitForSelector('.thread', { timeout: 8000 });
      await page.evaluate(() => { const t = document.querySelector('.thread'); if (t) t.scrollTop = 0; });
      await page.waitForTimeout(600);
      assert.equal(mock.state.cursors['s-b'], '4');
      assert.equal(mock.state.cursors['s-old'], undefined, '别的段没被连带标掉');
      await goHome(page);
      assert.equal(await homeBadge(page, 'ab'), '');
      assert.equal(await homeBadge(page, 'aa'), '+2');
    });
  });

  test('后端临时不收已读（503）：数字保持清掉不弹回，后端好了自己补上', { timeout: 40000 }, async () => {
    await withApp({}, async ({ page, mock }) => {
      mock.state.failRead = 2;
      await page.waitForSelector('[data-real-open="s-b"] [data-r29-unread]');
      await page.locator('[data-real-open="s-b"]').click();
      await page.waitForSelector('.thread', { timeout: 8000 });
      await page.waitForTimeout(300);
      assert.equal(mock.state.cursors['s-b'], undefined, '这时后端还没收到');
      // 回到前台会重新读未读数：读回来的还是旧的 1，但本地已清，不许写回
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(600);
      await goHome(page);
      assert.equal(await homeBadge(page, 'ab'), '', '后端没收到时数字也不弹回');
      assert.equal(await rowBadge(page, 's-b'), '');
      // 1.5 秒、4 秒后自己重试，第三次成功
      await until(page, () => mock.state.cursors['s-b'] !== undefined, 15000);
      assert.equal(mock.state.cursors['s-b'], '4', '重试之后后端收到了');
      assert.equal(mock.state.reads.filter(r => r.status === 503).length, 2);
      assert.equal(await homeBadge(page, 'ab'), '');
    });
  });

  test('已读请求在路上时又读了一次未读数：读回来的旧数字不能把本地已清的数字写回去', async () => {
    await withApp({}, async ({ page, mock }) => {
      await page.waitForSelector('[data-real-open="s-b"] [data-r29-unread]');
      mock.state.delayRead = 1200;
      await page.locator('[data-real-open="s-b"]').click();
      await page.waitForSelector('.thread', { timeout: 8000 });
      const seen = [];
      for (let i = 0; i < 14; i += 1) {
        if (i === 2 || i === 5) await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        seen.push(await page.evaluate(() => window.HubUnread.counts().conversations['s-b']));
        await page.waitForTimeout(150);
      }
      assert.ok(mock.state.unreadCalls >= 3, '期间确实又读过未读数');
      assert.deepEqual(seen.filter(n => n !== 0), [], '数字不能中途弹回：' + seen.join(','));
      await until(page, () => mock.state.cursors['s-b'] === '4', 6000);
      await goHome(page);
      assert.equal(await homeBadge(page, 'ab'), '');
    });
  });

  test('先发出的未读读取后回来（慢），不能盖掉后发出的', async () => {
    await withApp({}, async ({ page, mock }) => {
      await page.waitForSelector('[data-real-open="s-b"] [data-r29-unread]');
      mock.state.delayUnread = 1200;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.locator('[data-real-open="s-b"]').click();
      await page.waitForTimeout(2600);
      mock.state.delayUnread = 0;
      await goHome(page);
      assert.equal(await homeBadge(page, 'ab'), '');
      assert.equal(await rowBadge(page, 's-b'), '');
    });
  });

  test('看着这一段的时候又来了新回复：回到前台/下一次读到数字就自动读掉', async () => {
    await withApp({}, async ({ page, mock }) => {
      await page.waitForSelector('[data-real-open="s-b"] [data-r29-unread]');
      await page.locator('[data-real-open="s-b"]').click();
      await page.waitForSelector('.thread', { timeout: 8000 });
      await page.waitForTimeout(600);
      mock.state.history['s-b'].push({ id: '12', role: 'assistant', text: '看着的时候来的新回复', seq: 12, ts: 1 });
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await until(page, () => mock.state.cursors['s-b'] === '12');
      assert.equal(mock.state.cursors['s-b'], '12');
      await goHome(page);
      assert.equal(await homeBadge(page, 'ab'), '');
    });
  });

  test('在最近一段里：对话顶上有「另有 N 条未读」，点了进去，数字都消', async () => {
    await withApp({}, async ({ page, mock }) => {
      await page.waitForSelector('[data-real-open="s-new"]');
      await page.locator('[data-real-open="s-new"]').click();
      await page.waitForSelector('.r31-more-unread', { timeout: 8000 });
      assert.match(await page.locator('.r31-more-unread').innerText(), /另有 2 条未读/);
      await page.locator('.r31-more-unread').click();
      await page.waitForFunction(() => /早先/.test(document.querySelector('.thread')?.innerText || ''),
        null, { timeout: 8000 });
      await page.waitForTimeout(600);
      assert.equal(await page.locator('.r31-more-unread').count(), 0);
      assert.equal(mock.state.cursors['s-old'], '9');
      await goHome(page);
      assert.equal(await homeBadge(page, 'aa'), '');
    });
  });

  test('派工会话：数字看得见，点开就消', async () => {
    await withApp({}, async ({ page, mock }) => {
      await page.waitForSelector('[data-real-open="s-board"] [data-r29-unread]');
      await page.locator('[data-real-open="s-board"]').click();
      await page.waitForSelector('.thread', { timeout: 8000 });
      await page.waitForTimeout(600);
      assert.equal(mock.state.cursors['s-board'], '6');
      await goHome(page);
      assert.equal(await homeBadge(page, 'ac'), '');
    });
  });

  test('首页行上滑出的「已读」：这位助理所有有数字的会话一起读掉', async () => {
    await withApp({}, async ({ page, mock }) => {
      await page.waitForSelector('[data-bot-tree="aa"] [data-r29-unread]');
      await page.evaluate(() => window.HubUnread.markBotRead('aa'));
      await page.waitForTimeout(600);
      assert.equal(mock.state.cursors['s-old'], '9');
      assert.equal(await homeBadge(page, 'aa'), '');
      assert.equal(await homeBadge(page, 'ab'), '+1', '别的助理不动');
    });
  });

  test('讨论组：发话后助理的回复自己出现（多位先后回复，各带名字），不用退出重进', { timeout: 40000 }, async () => {
    const onOwnerLine = (st, text) => {
      setTimeout(() => st.pushGroup('aa', '甲答：收到「' + text + '」'), 700);
      setTimeout(() => st.pushGroup('ab', '乙答：我来补一句'), 4200);
    };
    await withApp({ onOwnerLine }, async ({ page, mock }) => {
      await page.locator('[data-real-group="g3"]').click();
      await page.waitForSelector('[data-r29-group-thread="g3"]', { timeout: 10000 });
      await page.waitForTimeout(500);
      assert.equal(mock.state.groupCursors.g3, 1, '进组就算看过');
      await page.locator('[data-focus="composer"]').fill('大家好');
      await page.locator('[data-act="send"]').click();
      await page.waitForFunction(() => /甲答/.test(document.querySelector('[data-r29-group-thread]')?.innerText || ''),
        null, { timeout: 15000 });
      await page.waitForFunction(() => /乙答/.test(document.querySelector('[data-r29-group-thread]')?.innerText || ''),
        null, { timeout: 15000 });
      const text = await page.locator('[data-r29-group-thread]').innerText();
      assert.match(text, /大家好/);
      assert.equal((text.match(/甲答/g) || []).length, 1, '不重复');
      const names = await page.locator('[data-r29-group-thread] .r29-group-msg:not(.is-user) .r29-group-name')
        .allInnerTexts();
      assert.ok(names.includes('甲') && names.includes('乙'), names.join(','));
      const faces = await page.locator('[data-r29-group-thread] .r29-group-msg:not(.is-user) [data-r29-avatar]')
        .evaluateAll(list => list.map(n => n.getAttribute('data-r29-avatar')));
      assert.ok(faces.includes('aa') && faces.includes('ab'), '每条发言带自己的头像：' + faces.join(','));
      // 看着组，新发言不累计未读
      await page.waitForTimeout(1500);
      assert.equal(await page.evaluate(() => window.HubUnread.counts().groups.g3), 0);
    });
  });

  test('讨论组：隔很久之后助理才回话（超过 45 秒的那种）也自己出现', { timeout: 30000 }, async () => {
    await withApp({}, async ({ page, mock }) => {
      await page.locator('[data-real-group="g3"]').click();
      await page.waitForSelector('[data-r29-group-thread="g3"]', { timeout: 10000 });
      await page.waitForTimeout(3200);
      mock.state.pushGroup('ab', '乙隔了很久才说');
      await page.waitForFunction(() => /隔了很久/.test(document.querySelector('[data-r29-group-thread]')?.innerText || ''),
        null, { timeout: 12000 });
      assert.ok(mock.state.groupGets >= 3, '看着组时在持续取新发言');
    });
  });
});
