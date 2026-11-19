const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const pick = function (list) {
  return list.find(function (item) { return item && fs.existsSync(item); });
};
const pw = require(pick([
  process.env.PLAYWRIGHT_CORE,
  path.join(os.homedir(), 'node_modules/playwright-core'),
  path.join(os.homedir(), 'node_modules/playwright-core')
]));
const chrome = pick([
  process.env.CHROMIUM,
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/' +
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243/' +
    'chrome-headless-shell-mac-arm64/chrome-headless-shell')
]);
let browser;

before(async function () {
  browser = await pw.chromium.launch({headless: true, executablePath: chrome});
});
after(async function () {
  if (browser) await browser.close();
});

async function page() {
  const p = await browser.newPage({viewport: {width: 390, height: 844}});
  await p.route('**/*', async function (route) {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.port !== '3781') return route.abort();
    const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(root, '.' + rel);
    if (!file.startsWith(root + path.sep)) return route.abort();
    try {
      const body = fs.readFileSync(file);
      const types = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.svg': 'image/svg+xml'
      };
      const contentType = types[path.extname(file)] || 'application/octet-stream';
      await route.fulfill({status: 200, contentType: contentType, body: body});
    } catch (error) {
      await route.fulfill({status: 404, body: 'missing'});
    }
  });
  await p.goto('http://127.0.0.1:3781/');
  await p.waitForFunction(function () {
    return window.Hub && window.state && state.bots.length;
  });
  return p;
}

test('抽屉打开后按 Esc 关掉，焦点不留在抽屉里', async function () {
  const p = await page();
  try {
    await p.evaluate(function () { Hub.openPanel('permission'); });
    await p.waitForSelector('.drawer');
    const focused = await p.evaluate(function () {
      const drawer = document.querySelector('.drawer');
      const button = drawer.querySelector('button');
      if (button) button.focus();
      return !!(document.activeElement && drawer.contains(document.activeElement));
    });
    assert.equal(focused, true);
    await p.keyboard.press('Escape');
    await p.waitForFunction(function () {
      return !document.querySelector('.drawer');
    }, null, {timeout: 1500});
    const stuck = await p.evaluate(function () {
      const drawer = document.querySelector('.drawer');
      const active = document.activeElement;
      return !!(drawer && active && drawer.contains(active));
    });
    assert.equal(stuck, false);
  } finally {
    await p.close();
  }
});

test('加号面板关着时附件选择器仍在，且只有一个', async function () {
  const p = await page();
  try {
    await p.locator('.pinned .pin').first().click();
    await p.waitForSelector('[data-focus="composer"]');
    assert.equal(await p.locator('[data-r29-file="any"]').count(), 1);
    assert.equal(await p.locator('[data-r29-file="image"]').count(), 1);
  } finally {
    await p.close();
  }
});

test('存储写满后换主题不白屏', async function () {
  const p = await page();
  try {
    const result = await p.evaluate(function () {
      Storage.prototype.setItem = function () { throw Error('full'); };
      Storage.prototype.getItem = function () { throw Error('full'); };
      let threw = false;
      try { applyTheme(); }
      catch (error) { threw = true; }
      return {
        threw: threw,
        pins: document.querySelectorAll('.pinned .pin').length,
        body: document.body ? document.body.childElementCount : 0
      };
    });
    assert.equal(result.threw, false);
    assert.ok(result.pins > 0);
    assert.ok(result.body > 0);
  } finally {
    await p.close();
  }
});

test('页面不可见时动画暂停标记被挂上', async function () {
  const p = await page();
  try {
    const result = await p.evaluate(function () {
      Object.defineProperty(document, 'hidden', {configurable: true, get: function () { return true; }});
      document.dispatchEvent(new Event('visibilitychange'));
      const stage = document.querySelector('[data-pet-stage]');
      const play = stage ? getComputedStyle(stage).animationPlayState : '';
      return {
        attr: document.documentElement.getAttribute('data-r29-page-hidden'),
        play: play
      };
    });
    assert.equal(result.attr, '1');
    if (result.play) assert.equal(result.play, 'paused');
  } finally {
    await p.close();
  }
});
