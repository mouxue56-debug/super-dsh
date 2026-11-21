/* S4 手机尺寸验收。只用本机已有的浏览器，不下载。端口 3633。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');

function firstExisting(list) {
  for (const item of list) if (item && fs.existsSync(item)) return item;
  return '';
}
const playwrightPath = process.env.PLAYWRIGHT_CORE || firstExisting([
  path.join(os.homedir(), 'node_modules/playwright-core'),
  path.join(os.homedir(), 'node_modules/playwright-core')
]);
const chromium = process.env.CHROMIUM || firstExisting([
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64',
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
]);
assert(playwrightPath && chromium, '缺少本机浏览器或 playwright-core');
const playwright = require(playwrightPath);
const root = path.resolve(__dirname, '..');
const shots = path.resolve(__dirname, '..', '..', 'shots');
const port = 3633;
const base = 'http://127.0.0.1:' + port + '/index.html';
const PROMPT = '帮我新建一个助理，负责：';
const OPEN_LINE = '助理直接干活。花钱、对外发送或公开发布、删除、上线或动线上服务，仍然先问你';
const ORDER = ['助理名册', '固定任务', '账本', '设置', '全部暂停'];
const GONE = ['三分钟看完', '手势', '完整模式', '会话、文件与更多操作'];

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      const types = {
        '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
        '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.json': 'application/json', '.webmanifest': 'application/manifest+json'
      };
      const type = types[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, {'Content-Type': type});
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  fs.mkdirSync(shots, {recursive: true});
  const server = await serve();
  const browser = await playwright.chromium.launch({executablePath: chromium, headless: true});
  const errors = [];
  const checks = [];
  const panic = [];
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/panic/.test(request.url())) panic.push(request.url());
    });
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      const local = url.protocol === 'data:' || url.protocol === 'blob:'
        || (url.hostname === '127.0.0.1' && url.port === String(port));
      return local ? route.continue() : route.abort();
    });
    const check = (label, value) => {
      assert(value, label);
      checks.push(label);
      console.log('通过：' + label);
    };
    await page.goto(base);
    await page.waitForFunction(() => window.Hub && Hub.state && Hub.state.botTemplates
      && Hub.state.botTemplates.length > 0);

    async function openMore() {
      const more = page.locator('.r22-home-dock [data-act="more"]');
      if (await more.count() && await more.first().isVisible()) await more.first().click();
      else await page.evaluate(() => Hub.openPanel('more'));
      await page.waitForSelector('[data-r29-more-list]');
    }
    async function drawerText() {
      return page.locator('.drawer .r22-sheet-content').innerText();
    }
    await openMore();
    const first = await page.locator('[data-r29-more-list]').innerText();
    let at = -1;
    for (const label of ORDER) {
      const next = first.indexOf(label, at + 1);
      check('第一层顺序含 ' + label, next > at);
      at = next;
    }
    const ids = await page.locator('[data-r29-more-list] [data-r29-more]').evaluateAll((nodes) => {
      return nodes.map((node) => node.getAttribute('data-r29-more'));
    });
    check('第一层标记顺序', ids.join(',') ===
      'roster,tasks,ledger,settings,stop');
    const moreText = await drawerText();
    for (const word of GONE) check('更多里看不见 ' + word, !moreText.includes(word));
    check('挂点 data-hub-more-items 还在',
      await page.locator('.more-drawer [data-hub-more-items]').count() === 1);
    check('第31轮：更多里不再放看板和活动（首页底栏有）',
      await page.locator('[data-r29-more="board"],[data-r29-more="activity"]').count() === 0);
    await page.screenshot({path: path.join(shots, 'more-demo.png')});

    await page.evaluate(() => { Hub.state.drawer = null; Hub.navigate({view: 'chat'}); });
    // 今天在首页底栏，不在更多里。
    await page.evaluate(() => document.querySelector('[data-today-open]').click());
    await page.waitForFunction(() => Hub.state.mode === 'persona-today' || !!document.querySelector('[data-r30l-today]'),
      null, {timeout: 5000}).catch(() => {});
    check('演示今天进今日页', await page.evaluate(() => Hub.state.mode === 'persona-today' ||
      !!document.querySelector('[data-r30l-today]')));
    await openMore();
    await page.locator('[data-r29-more="ledger"]').click();
    check('演示账本进第30轮的账本页', await page.evaluate(() => Hub.state.mode === 'ledger' &&
      !!document.querySelector('[data-r30l-ledger]')));
    await openMore();
    await page.locator('[data-r29-more="roster"]').click();
    check('演示名册打开助理页',
      await page.evaluate(() => Hub.state.drawer === 'assistant-directory'));
    await openMore();
    await page.locator('[data-r29-more="tasks"]').click();
    check('演示固定任务有清单',
      await page.locator('.drawer h2').innerText() === '固定任务'
      && await page.locator('[data-hub-sheet] p').count() > 0
      && !(await drawerText()).includes('请先填写负责什么项目'));
    await openMore();
    const botsBeforeStop = await page.evaluate(() => Hub.state.bots.length);
    await page.locator('[data-r29-more="stop"]').click();
    check('演示全停只改本页', await page.evaluate((n) => {
      return Hub.state.running === false
        && Hub.state.bots.every((bot) => bot.running === false)
        && Hub.state.bots.length === n;
    }, botsBeforeStop));
    check('演示全停不请求 panic', panic.length === 0);

    await page.evaluate(() => Hub.openPanel('permission'));
    await page.waitForSelector('[data-r29-permissions]');
    const perm = await drawerText();
    check('权限只有三档', await page.locator('[data-r29-permission]').count() === 3);
    check('全开默认选中',
      await page.locator('[data-r29-permission="open"]').getAttribute('aria-checked') === 'true');
    check('全开说明原文', perm.includes(OPEN_LINE));
    check('权限页没有计划', !perm.includes('计划'));
    check('权限页没有等级贴纸', !/L[0-4]/.test(perm));
    await page.screenshot({path: path.join(shots, 'permissions.png')});
    await page.locator('[data-r29-permission="ask"]').click();
    check('没钩子时本页记住改动前问我',
      await page.locator('[data-r29-permission="ask"]').getAttribute('aria-checked') === 'true');
    await page.evaluate(() => Hub.openPanel('more'));
    await page.evaluate(() => Hub.openPanel('permission'));
    check('再打开仍是改动前问我',
      await page.locator('[data-r29-permission="ask"]').getAttribute('aria-checked') === 'true');

    await page.evaluate(() => {
      window.__modes = [];
      window.HubSettings = {
        get() {
          return Promise.resolve({permission: {mode: 'readonly'}, bots: {}, models: []});
        },
        setPermission(mode) {
          window.__modes.push(mode);
          return Promise.resolve({ok: true});
        }
      };
      Hub.openPanel('more');
      Hub.openPanel('permission');
    });
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-r29-permission="readonly"]');
      return node && node.getAttribute('aria-checked') === 'true';
    });
    check('钩子 get 读到只读', true);
    await page.locator('[data-r29-permission="open"]').click();
    await page.waitForFunction(() => Array.isArray(window.__modes) && window.__modes.includes('open'));
    check('钩子 setPermission 收到 open', true);
    await page.evaluate(() => {
      window.HubSettings = {
        get() { return {permission: {mode: 'open'}}; },
        setPermission() { return Promise.reject(Error('no')); }
      };
      Hub.openPanel('more');
      Hub.openPanel('permission');
    });
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-r29-permission="open"]');
      return node && node.getAttribute('aria-checked') === 'true';
    });
    await page.locator('[data-r29-permission="readonly"]').click();
    await page.waitForFunction(() => {
      const note = document.querySelector('[data-r29-save-status]');
      return note && note.textContent.includes('没保存上');
    });
    check('钩子拒绝后仍是原来的',
      await page.locator('[data-r29-permission="open"]').getAttribute('aria-checked') === 'true');
    await page.evaluate(() => { delete window.HubSettings; });
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'r29-perm-probe';
      button.setAttribute('data-r29-open-permissions', '');
      button.textContent = '打开权限';
      document.body.append(button);
    });
    await page.evaluate(() => document.getElementById('r29-perm-probe').click());
    check('外部标记打开同一权限页',
      await page.locator('[data-r29-permissions]').count() === 1
      && await page.locator('.drawer h2').innerText() === '权限');

    await page.evaluate(() => Hub.openPanel('appearance'));
    const look = await drawerText();
    check('外观页看不见完整模式', !look.includes('完整模式'));
    check('外观页看不见会话文件入口', !look.includes('会话、文件与更多操作'));
    check('外观页还有主题', look.includes('跟随系统'));

    const snap = await page.evaluate(() => {
      const bot = Hub.state.bots.find((item) => item.role === 'chief');
      return {
        id: bot.id,
        messages: (Hub.state.threads[bot.id] || []).length,
        bots: Hub.state.bots.length
      };
    });
    await openMore();
    await page.locator('[data-r29-more-list] [data-r29-more="roster"]').click();
    await page.locator('.drawer [data-new-bot-open]').click();
    await page.waitForSelector('[data-focus="composer"]');
    const drafted = await page.evaluate((origin) => {
      const input = document.querySelector('[data-focus="composer"]');
      const bot = Hub.state.bots.find((item) => item.role === 'chief');
      return {
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
        conversation: Hub.state.conversation,
        messages: (Hub.state.threads[bot.id] || []).length,
        bots: Hub.state.bots.length,
        chief: bot.id === origin
      };
    }, snap.id);
    check('新建助理原文在输入框末尾',
      drafted.value === PROMPT && drafted.start === PROMPT.length && drafted.end === PROMPT.length);
    check('进的是首席对话且没发送',
      drafted.chief && drafted.conversation === snap.id + '-013'
      && drafted.messages === snap.messages && drafted.bots === snap.bots);
    check('没有正式接通提示',
      !await page.locator('body').innerText().then((text) => text.includes('还没有正式接通')));
    await page.screenshot({path: path.join(shots, 'new-bot.png')});

    await openMore();
    // 「从模板」不再在更多里放入口；旧的挂点仍响应，这里用探针点它。
    await page.evaluate(() => {
      const probe = document.createElement('button');
      probe.id = 'r31-template-probe';
      probe.setAttribute('data-r22-template-open', '');
      document.body.append(probe);
      probe.click();
    });
    await page.waitForSelector('[data-r29-template]');
    check('空职责也能看到模板',
      await page.locator('[data-r29-template]').count() > 0
      && !((await drawerText()).includes('请先填写负责什么项目')));
    await page.screenshot({path: path.join(shots, 'templates.png')});
    const template = await page.evaluate(() => {
      const item = Hub.state.botTemplates[0];
      return {name: item.name, duty: item.duty};
    });
    const beforeTemplate = await page.evaluate(() => Hub.state.bots.length);
    await page.locator('[data-r29-template]').first().click();
    await page.waitForFunction((name) => {
      const input = document.querySelector('[data-focus="composer"]');
      return input && (input.value || '').includes(name);
    }, template.name);
    const filled = await page.evaluate(() => {
      return document.querySelector('[data-focus="composer"]').value;
    });
    check('模板名字和职责写进输入框',
      filled.includes(template.name) && filled.includes(template.duty)
      && filled.startsWith('帮我新建一个助理，用模板「'));
    check('点模板不创建也不发送', await page.evaluate((n) => {
      const bot = Hub.state.bots.find((item) => item.role === 'chief');
      const last = (Hub.state.threads[bot.id] || []).slice(-1)[0];
      const value = document.querySelector('[data-focus="composer"]').value;
      const sent = last && (last.text === value
        || (last.parts || []).some((part) => part.md === value));
      return Hub.state.bots.length === n && !sent;
    }, beforeTemplate));

    await page.evaluate(() => {
      document.documentElement.dataset.hubMode = 'real';
      Hub.state.mode = 'chat';
      const bot = Hub.state.bots.find((item) => item.role === 'chief');
      Hub.state.conversation = bot.id + '-013';
      Hub.state.detail = true;
      Hub.registerMoreItem({id: 'probe-memory', label: '记忆', onClick() {}});
      Hub.openPanel('more');
    });
    await page.waitForSelector('[data-r29-more-list]');
    const realText = await page.locator('[data-r29-more-list]').innerText();
    let realAt = -1;
    for (const label of ORDER) {
      const next = realText.indexOf(label, realAt + 1);
      check('真实档第一层仍有 ' + label, next > realAt);
      realAt = next;
    }
    // 真实档更多里不再挂任何额外入口（晨会晚会纪要、规矩页、连接模式、记忆等都不挂）。
    check('真实档注入的额外入口一个都不挂', await page.locator('[data-hub-more-item]').count() === 0);
    await page.screenshot({path: path.join(shots, 'more-real.png')});
    const modeBefore = await page.evaluate(() => Hub.state.mode);
    await page.evaluate(() => { Hub.state.drawer = null; document.querySelector('[data-today-open]').click(); });
    await page.waitForTimeout(300);
    check('真实档今天（底栏进）没有数据就暂无',
      (await drawerText()).includes('暂无')
      && await page.evaluate((mode) => Hub.state.mode === mode, modeBefore));
    check('第31轮：真实档更多里也没有看板和活动', await page.locator(
      '[data-r29-more="board"],[data-r29-more="activity"]').count() === 0);
    await page.evaluate(() => Hub.openPanel('permission'));
    check('真实档权限页仍是三档', await page.locator('[data-r29-permission]').count() === 3);

    check('浏览器无脚本异常', errors.length === 0);
    fs.writeFileSync(path.join(shots, 'r29-browser-results.json'), JSON.stringify({
      checks, errors, panic
    }, null, 2));
    console.log('S4 浏览器验收 ' + checks.length + ' 项通过');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
