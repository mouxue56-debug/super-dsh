/* · 单个助理设置页。只连本机 3633，手机尺寸。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pageDir = path.join(root, 'dist-generic');
const port = '3633';
const base = process.env.HUB_URL || ('http://127.0.0.1:' + port + '/DSH-Hub.html');
const shots = process.env.HUB_SHOTS || path.resolve(__dirname, '..', '..', 'shots');
function firstExisting(list) {
  for (const item of list) if (item && fs.existsSync(item)) return item;
  return '';
}
const playwrightPath = process.env.PLAYWRIGHT_CORE || firstExisting([
  path.join(os.homedir(), 'node_modules/playwright-core'),
  path.join(os.homedir(), 'node_modules/playwright-core')
]);
const chromiumPath = process.env.CHROMIUM || firstExisting([
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64',
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell')
]);
assert(fs.existsSync(path.join(pageDir, 'DSH-Hub.html')), '先运行 python3 build.py --demo generic');
assert(playwrightPath && chromiumPath, '缺少页面地址、截图目录或浏览器');
const allowed = new URL(base);
assert.equal(allowed.hostname, '127.0.0.1');
assert.equal(allowed.port, port);
const playwright = require(playwrightPath);

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/DSH-Hub.html';
    const file = path.resolve(pageDir, '.' + rel);
    if (!file.startsWith(pageDir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      const types = {
        '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
        '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        '.json': 'application/json'
      };
      const type = types[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, {'Content-Type': type});
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(port), '127.0.0.1', () => resolve(server));
  });
}
const banned = ['上下文', '额度', '工具箱', '画布', '分叉', '归档', '演示'];

(async () => {
  fs.mkdirSync(shots, {recursive: true});
  const server = await serve();
  const browser = await playwright.chromium.launch({
    executablePath: chromiumPath,
    headless: true
  });
  const errors = [];
  const checks = [];
  const check = (label, value) => {
    assert(value, label);
    checks.push(label);
    console.log('通过：' + label);
  };
  try {
    const page = await browser.newPage({
      viewport: {width: 390, height: 844},
      deviceScaleFactor: 1
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      const local = url.protocol === 'data:' || url.protocol === 'blob:'
        || (url.hostname === '127.0.0.1' && url.port === port);
      return local ? route.continue() : route.abort();
    });

    async function boot() {
      await page.goto(base, {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => window.Hub && window.state
        && state.bots && state.bots.length && window.R29Settings);
    }

    async function enter() {
      return page.evaluate(() => {
        const legacy = window.LEGACY_FEATURE_IDS || {};
        const bot = state.bots.find((item) => item && item.role === 'assistant'
          && !item.parent && !legacy[item.id]);
        if (!bot) throw Error('没有可测的助理');
        Hub.navigate({view: 'chat', bot: bot.id, conversation: bot.id + '-013'});
        state.detail = true;
        render();
        return {
          id: bot.id,
          conversation: state.conversation,
          model: state.model,
          strength: state.strength
        };
      });
    }

    async function draft() {
      const box = page.locator('[data-focus="composer"]');
      await box.fill('草稿还在');
      await page.waitForFunction(() => state.input === '草稿还在');
    }

    async function openSheet() {
      await page.evaluate(() => {
        const host = document.querySelector('.mainpane') || document.body;
        host.querySelectorAll('[data-r29-settings]').forEach((node) => node.remove());
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-r29-settings', '');
        button.textContent = '设置';
        host.append(button);
      });
      await page.evaluate(() => {
        const button = document.querySelector('[data-r29-settings]');
        if (!button) throw Error('设置按钮没放上');
        button.click();
      });
      await page.waitForSelector('[data-r29-settings-page]');
    }

    async function sheetText() {
      return page.locator('[data-r29-settings-page]').innerText();
    }

    async function closeOnce() {
      const title = await page.locator('.drawer h2').innerText();
      await page.locator('.drawer [data-act="close"]').click();
      await page.waitForFunction((previous) => {
        const heading = document.querySelector('.drawer h2');
        return !heading || heading.textContent !== previous;
      }, title, {timeout: 4000});
    }

    async function closeAll() {
      for (let i = 0; i < 4; i += 1) {
        if (await page.locator('.drawer').count() === 0) return;
        await closeOnce();
      }
      await page.waitForFunction(() => !document.querySelector('.drawer'), null, {timeout: 4000});
    }

    await boot();
    const demo = await enter();
    await draft();
    const before = await page.evaluate(() => state.conversation);
    await openSheet();
    const blocks = await page.locator('[data-r29-block]').evaluateAll((nodes) => {
      return nodes.map((node) => node.getAttribute('data-r29-block'));
    });
    check('无钩子只有身份、回答、会话、权限', JSON.stringify(blocks)
      === JSON.stringify(['identity', 'answer', 'sessions', 'permission']));
    const demoText = await sheetText();
    check('无钩子页没有工程项和演示字样', banned.every((word) => !demoText.includes(word)));
    check('无钩子回答只读且是当前值', await page.locator('[data-r29-readonly]').innerText()
      === demo.model + ' · ' + demo.strength && await page.locator('[data-r29-pick]').count() === 0);
    check('无钩子权限写全开并可去更多', demoText.includes('权限：全开（全家共用）')
      && await page.locator('[data-r29-open-permissions]').innerText() === '去更多里改');
    check('标题是某某的设置', (await page.locator('.drawer h2').innerText()).endsWith('的设置'));
    check('手机宽度没有横向溢出', await page.evaluate(() => {
      return document.documentElement.scrollWidth <= window.innerWidth + 1;
    }));
    await page.screenshot({path: path.join(shots, 'no-hook.png')});
    await closeAll();
    check('关掉后回到原会话且草稿还在', await page.locator('.drawer').count() === 0
      && await page.locator('[data-focus="composer"]').inputValue() === '草稿还在'
      && await page.evaluate(() => state.conversation) === before);

    await openSheet();
    await page.locator('[data-r29-edit="avatar"]').click();
    await page.waitForFunction(() => document.querySelector('.drawer h2')
      && document.querySelector('.drawer h2').textContent.includes('形象库'));
    check('点头像走原来的形象库', true);
    await closeAll();

    await openSheet();
    await page.locator('[data-r29-edit="name"]').click();
    await page.waitForSelector('[data-r29-form="name"] input');
    await page.locator('[data-r29-form="name"] input').fill('核对员');
    await page.locator('[data-r29-form="name"] button[type="submit"]').click();
    await page.waitForSelector('[data-assistant-confirm]');
    check('改名走预览', (await page.locator('.drawer h2').innerText()).includes('确认前预览'));
    await page.locator('[data-assistant-confirm]').click();
    await page.waitForFunction(() => state.bots.some((item) => item.name === '核对员'));
    check('确认后名字写回原资料', true);
    check('改名后草稿仍在', await page.locator('[data-focus="composer"]').inputValue() === '草稿还在');
    await closeAll();

    await openSheet();
    await page.locator('[data-r29-block="sessions"] [data-act="new-session"]').click();
    await page.waitForFunction(() => document.querySelector('.drawer h2')
      && document.querySelector('.drawer h2').textContent.includes('新建会话'));
    check('新开一段走原来的新建会话', true);
    await closeAll();

    await openSheet();
    await page.locator('[data-act="rename-session"]').click();
    await page.waitForFunction(() => document.querySelector('.drawer h2')
      && document.querySelector('.drawer h2').textContent.includes('重命名会话'));
    check('改名会话走原来的重命名', await page.locator('[data-act="save-rename"]').count() === 1);
    await closeAll();

    await page.evaluate(() => openPanel('model'));
    await page.waitForSelector('.drawer [data-r29-block="answer"]');
    const modelBlocks = await page.locator('.drawer [data-r29-block]').evaluateAll((nodes) => {
      return nodes.map((node) => node.getAttribute('data-r29-block'));
    });
    check('模型面板只留回答方式', JSON.stringify(modelBlocks) === JSON.stringify(['answer']));
    await closeAll();

    await page.evaluate(() => openPanel('profile'));
    await page.waitForSelector('.drawer [data-r29-settings-page]');
    check('资料面板仍是这五段里的可见段', (await page.locator('.drawer h2').innerText()) === '助理资料'
      && await page.locator('[data-r29-block="identity"]').count() === 1);
    await closeAll();

    await boot();
    const hooked = await enter();
    await page.evaluate((id) => {
      window.__saved = [];
      window.HubSettings = {
        get() {
          return Promise.resolve({
            permission: {mode: 'ask'},
            bots: {[id]: {model: '甲模型', effort: '深入'}},
            models: [
              {name: '甲模型', efforts: ['轻量', '深入']},
              {name: '乙模型', efforts: ['标准']}
            ]
          });
        },
        setBot(botId, patch) {
          window.__saved.push({id: botId, patch: patch});
          return Promise.resolve({ok: true});
        }
      };
      Hub.registerMemoryMounts(id, [{
        id: 'kept', title: '共享资料', source: '已保存', tokens: 8
      }]);
    }, hooked.id);
    await draft();
    await openSheet();
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-r29-block="answer"]');
      return node && node.textContent.includes('甲模型 · 深入');
    });
    const hookText = await sheetText();
    check('有钩子时显示钩子里的回答和权限', hookText.includes('甲模型 · 深入')
      && hookText.includes('权限：改动前问（全家共用）'));
    check('干净的记忆显示一行', (await page.locator('[data-r29-block="memory"]').innerText())
      .includes('共享资料') && !hookText.includes('演示'));
    await page.locator('[data-r29-pick]').click();
    await page.waitForSelector('[data-r29-model="乙模型"]');
    await page.screenshot({path: path.join(shots, 'hook-picker.png')});
    await page.locator('[data-r29-model="乙模型"]').click();
    await page.waitForFunction(() => window.__saved.length === 1);
    const saved = await page.evaluate(() => window.__saved[0]);
    check('选模型调用 setBot', saved.id === hooked.id && saved.patch.model === '乙模型'
      && saved.patch.effort === '标准');
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-r29-block="answer"]');
      return node && node.textContent.includes('乙模型 · 标准');
    });
    check('保存后当前行换成新值', true);
    await page.evaluate(() => {
      window.__perm = null;
      document.addEventListener('data-r29-open-permissions', (event) => {
        window.__perm = event.detail;
      });
    });
    await page.locator('[data-r29-open-permissions]').click();
    await page.waitForFunction(() => window.__perm && window.__perm.bot);
    check('去更多发出权限事件并打开权限页', await page.evaluate((id) => {
      const title = document.querySelector('.drawer h2');
      return window.__perm.bot === id
        && !!document.querySelector('[data-r29-permissions]')
        && !!title && title.textContent === '权限';
    }, hooked.id));
    check('有钩子时草稿还在', await page.locator('[data-focus="composer"]').inputValue() === '草稿还在');

    await boot();
    await enter();
    await page.evaluate(() => {
      document.documentElement.dataset.hubMode = 'real';
    });
    await draft();
    await openSheet();
    const realText = await sheetText();
    check('真实模式缺钩子时回答和权限是暂无', realText.includes('暂无')
      && realText.includes('权限：暂无（全家共用）')
      && !realText.includes('示例模型甲'));
    check('真实模式不出现演示字样', !realText.includes('演示'));
    await page.screenshot({path: path.join(shots, 'real-empty.png')});
    await closeAll();
    check('真实模式关掉后草稿还在', await page.locator('[data-focus="composer"]').inputValue()
      === '草稿还在');
    check('浏览器没有脚本异常', errors.length === 0);
    fs.writeFileSync(path.join(shots, 'results.json'), JSON.stringify({
      checks: checks, errors: errors, browser: browser.version()
    }, null, 2));
    console.log('设置页浏览器验收 ' + checks.length + ' 项通过');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
