// 需要环境变量 PLAYWRIGHT_CORE（playwright-core 路径）与 CHROMIUM（无头 chromium 可执行文件）。
// 先由监工启动 node test/r28-shell-env.mjs <壳目录> <工作目录内临时目录>。
// HUB_R28_SHELL=new HUB_R28_SHOTS=<截图目录> node test/r28-shell-browser.cjs
// 旧壳将 HUB_R28_SHELL 改为 old；此脚本不负责启动服务。
const { chromium } = require(process.env.PLAYWRIGHT_CORE);
const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');

const binary = process.env.CHROMIUM;
const shots = process.env.HUB_R28_SHOTS;
const shell = process.env.HUB_R28_SHELL || 'new';
if (!shots || !['new', 'old'].includes(shell)) throw Error('需要 HUB_R28_SHOTS 与有效的 HUB_R28_SHELL');
let passed = 0;
let failed = 0;
let serial = 0;
const errors = [];

function check(name, condition) {
  console.log((condition ? '通过 ' : '失败 ') + name);
  if (condition) passed++;
  else failed++;
}

async function scenario(page, name, action) {
  serial++;
  let ok = false;
  try {
    ok = Boolean(await action());
  } catch (error) {
    console.error(name + '：' + error.message);
  }
  check(name, ok);
  try {
    await page.screenshot({ path: join(shots, String(serial).padStart(2, '0') + '-' + name + '.png') });
  } catch (error) {
    console.error('截图失败：' + error.message);
    failed++;
  }
}

async function api(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const options = body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    };
    const response = await fetch('/bff/' + path, options);
    return response.json();
  }, { path, body });
}

// 已知无关的资源 404：壳的角色图缺静态帧；空数据模式下扩展口按设计返回 404。
function ignorable(url) {
  return /\/pets\//.test(url) || /\/bff\/(board|ledger|groups|models|panic|routines|meetings|today|rules)/.test(url);
}

let routeCleared = false;

// 壳会在刷新后恢复上次路由；每次进首页前先清掉记住的路由，保证落在首页。
async function home(page) {
  if (!routeCleared) {
    routeCleared = true;
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('hub-r22-route');
        localStorage.removeItem('hub-real-route-v1');
      } catch {}
    });
  }
  await page.goto('http://127.0.0.1:3596/?key=r28-offline-web');
  await page.waitForSelector('.home-recent-list [data-real-open]');
}

async function openChief(page) {
  await home(page);
  await page.locator('.home-recent-list [data-real-open="chief-latest"]').click();
  await page.waitForSelector('[data-real-card="approval-1"]');
}

async function homepage(page) {
  await home(page);
  const roster = await api(page, 'bots');
  const sessions = await api(page, 'sessions');
  const text = await page.locator('body').innerText();
  return roster.bots.length === 6 && sessions.sessions.length === 7 &&
    (await page.locator('.home-recent-list [data-real-open]').count()) === 7 &&
    roster.bots.every(bot => text.includes(bot.name)) && !/演示|离线样张/.test(text);
}

async function chat(page) {
  await openChief(page);
  const input = page.locator('[data-focus="composer"]');
  await input.fill('请核对离线测试');
  await page.locator('[data-act="send"]').first().click();
  await page.getByText('已收到开场短语，假模型离线回复。').first().waitFor();
  return (await input.inputValue()) === '';
}

async function approval(page) {
  await openChief(page);
  await page.locator('[data-real-card="approval-1"] [data-real-answer="approve"]').click();
  await page.waitForFunction(() => fetch('/bff/__stats').then(r => r.json())
    .then(s => s.answers.some(a => a.decision === 'approve')));
  return true;
}

async function seed(page) {
  await api(page, '__ext', { seedCards: true });
  await openChief(page);
  await page.waitForSelector('[data-real-card="ext-confirm"]');
}

async function fulltext(page) {
  await seed(page);
  await page.locator('[data-real-card="ext-confirm"]').getByText('看全文').click();
  await page.getByText('分工全文 <b>粗体</b>', { exact: false }).first().waitFor();
  return !(await page.locator('[data-real-card="ext-confirm"] b').count());
}

async function xss(page) {
  await seed(page);
  await page.waitForSelector('[data-real-card="ext-xss"]');
  return (await page.locator('img[src="x"]').count()) === 0 &&
    await page.evaluate(() => typeof window.__xss === 'undefined');
}

async function panel(page, id) {
  await home(page);
  await page.locator('.r22-home-dock [data-act="more"]').click();
  await page.locator('[data-hub-more-item="hub-real-' + id + '"]').click();
  await page.waitForTimeout(350);
  return page.locator('body').innerText();
}

async function morePages(page) {
  const cases = [['today', '今日待办'], ['panic', '正常运行'], ['routines', '固定任务'],
    ['meetings', '晚会纪要'], ['rules', '共享规矩'], ['board', '看板工单'], ['ledger', '1,234']];
  for (const [id, expected] of cases) {
    const text = await panel(page, id);
    if (!text.includes(expected) || /演示|离线样张/.test(text)) return false;
    if (id === 'panic') {
      await page.locator('[data-real-r28="panic-stop"]').last().click();
      await page.locator('[data-real-r28="panic-stop"]').last().click();
      await page.getByText('已全停', { exact: false }).first().waitFor();
      await page.locator('[data-real-r28="panic-resume"]').last().click();
      await page.locator('[data-real-r28="panic-resume"]').last().click();
      await page.getByText('正常运行', { exact: false }).first().waitFor();
    }
  }
  return true;
}

async function featurePages(page) {
  await api(page, '__fixture', { type: 'grants', grants: [{ id: 'grant-one', bot: 'chief',
    program: 'mock-permission', dir: '/mock', until: '2099-01-01', status: 'active' }] });
  for (const id of ['board', 'schedule', 'memory', 'ledger', 'permissions', 'devices', 'connections']) {
    await home(page);
    await page.evaluate(id => window.Hub.openFeature(id), id);
    await page.waitForTimeout(500);
    const text = await page.locator('body').innerText();
    if (/演示|离线|样张|原始演示记录|演示基准/.test(text)) return false;
    if (['memory', 'devices', 'connections'].includes(id) && !text.includes('暂无')) return false;
    if (id === 'board' && !text.includes('看板工单')) return false;
    if (id === 'ledger' && !text.includes('1,234')) return false;
    if (id === 'schedule' && !text.includes('日更')) return false;
    if (id === 'permissions' && !text.includes('mock-permission')) return false;
  }
  return true;
}

async function profile(page) {
  await home(page);
  await page.evaluate(() => window.AssistantProfiles.openProfile('chief'));
  const root = page.locator('[data-assistant-profile-page="chief"]');
  await root.waitFor();
  const before = await root.innerText();
  if (!before.includes('首席助理') || !before.includes('本地职责')) return false;
  await root.locator('[data-profile-edit="name"]').click();
  await root.locator('[data-profile-field="name"]').fill('首席测试');
  await root.locator('[data-profile-preview]').click();
  await page.locator('[data-assistant-confirm]').click();
  await page.waitForFunction(() => fetch('/bff/__stats').then(r => r.json())
    .then(s => s.patches.some(p => p.bot === 'chief' && p.patch.name === '首席测试')));
  const roster = await api(page, 'bots');
  if (roster.bots.find(b => b.id === 'chief').name !== '首席测试') return false;
  await page.evaluate(() => window.AssistantProfiles.openProfile('chief'));
  await root.locator('[data-profile-edit="name"]').click();
  await root.locator('[data-profile-field="name"]').fill('超过八个字的名字测试');
  await root.locator('[data-profile-preview]').click();
  if (await page.locator('[data-assistant-confirm]').count()) {
    await page.locator('[data-assistant-confirm]').click();
  }
  await page.waitForTimeout(300);
  const current = await api(page, 'bots');
  return current.bots.find(b => b.id === 'chief').name === '首席测试' &&
    /没改成|名字请写/.test(await page.locator('body').innerText());
}

async function group(page) {
  await home(page);
  await page.waitForTimeout(500);
  return (await page.locator('.home-recent-list').getByText('讨论组', { exact: false }).count()) === 1;
}

async function empty(page) {
  await api(page, '__ext', { mode: 'empty' });
  for (const id of ['today', 'panic', 'routines', 'meetings', 'rules', 'board', 'ledger']) {
    if (!(await panel(page, id)).includes('暂无')) return false;
  }
  // 权限页读的是核心口 /grants，不属于扩展口，空数据模式下仍有真数据。
  for (const id of ['board', 'schedule', 'memory', 'ledger', 'devices', 'connections']) {
    await home(page);
    await page.evaluate(id => window.Hub.openFeature(id), id);
    await page.waitForTimeout(600);
    const text = await page.locator('body').innerText();
    if (!text.includes('暂无') || text.includes('正在读取')) return false;
  }
  return errors.length === 0;
}

async function main() {
  await mkdir(shots, { recursive: true });
  const browser = await chromium.launch({ executablePath: binary, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' && ['3595', '3596'].includes(url.port) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !ignorable(message.location().url)) {
      errors.push(message.text());
    }
  });
  try {
    await scenario(page, '首页', () => homepage(page));
    await scenario(page, '会话', () => chat(page));
    await scenario(page, '审批', () => approval(page));
    if (shell === 'new') await scenario(page, '确认卡全文', () => fulltext(page));
    await scenario(page, '纯文本安全', () => xss(page));
    // 旧壳没有 registerMoreItem，「更多」里的新入口（今天、全停等）本来就不出现，只在新壳验。
    if (shell === 'new') await scenario(page, '更多页面', () => morePages(page));
    if (shell === 'new') {
      await scenario(page, '功能页', () => featurePages(page));
      await scenario(page, '助理资料', () => profile(page));
      await scenario(page, '讨论组', () => group(page));
      await scenario(page, '空数据', () => empty(page));
    }
    check('页面和控制台无错误', errors.length === 0);
    if (errors.length) console.error(errors.join('\n'));
  } finally {
    await browser.close();
  }
  console.log(`通过 ${passed} / 失败 ${failed}`);
  process.exitCode = Math.min(failed, 255);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
