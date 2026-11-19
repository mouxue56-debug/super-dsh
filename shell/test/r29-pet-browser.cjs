/* 手机尺寸走查：戳、甩、哄、入睡、唤醒、事件序列。只连本机 3608。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');
const evidence = path.join(root, '..', 'evidence');
const port = 3608;
const playwrightPath = process.env.PLAYWRIGHT_CORE
  || path.join(os.homedir(), 'node_modules/playwright-core');
const browsers = [
  process.env.CHROMIUM,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(os.homedir(), 'Library/Caches/ms-playwright',
    'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')
].filter(Boolean);
const executablePath = browsers.find((item) => fs.existsSync(item));
assert.ok(executablePath, '找不到已安装的浏览器');
assert.ok(fs.existsSync(playwrightPath), '找不到已安装的 playwright-core');
const playwright = require(playwrightPath);

function startServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('missing'); return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  const server = await startServer();
  const browser = await playwright.chromium.launch({ executablePath, headless: true });
  const errors = [];
  const checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      const local = url.protocol === 'data:' || url.protocol === 'blob:'
        || (url.hostname === '127.0.0.1' && url.port === String(port));
      return local ? route.continue() : route.abort();
    });
    const check = (label, value) => {
      assert.ok(value, label);
      checks.push(label);
      console.log('通过：' + label);
    };
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.Hub && window.HubPetStage);
    await page.evaluate(() => Hub.navigate({ view: 'stage' }));
    await page.waitForSelector('[data-r29-pet-slot] .r29-mover');
    await page.waitForTimeout(400);
    const id = await page.getAttribute('[data-r29-pet-slot]', 'data-r29-pet-slot');
    check('舞台上有桌宠', !!id);
    const frames = [];
    let last = 0;
    for (const t of [0, 400, 800, 1600]) {
      if (t) await page.waitForTimeout(t - last);
      last = t;
      frames.push(await page.locator('.r29-mover').evaluate((el, at) => {
        const anim = el.getAnimations().map((item) => ({
          name: item.animationName, time: item.currentTime
        }));
        return { at, transform: getComputedStyle(el).transform, motion: el.getAttribute('data-motion'), anim };
      }, t));
    }
    const moved = new Set(frames.map((item) => item.transform)).size > 1
      || frames.some((item, i) => i && item.anim[0] && frames[0].anim[0]
        && item.anim[0].time !== frames[0].anim[0].time);
    check('逐帧取样能看出在动', moved && frames.every((item) => item.motion));
    fs.writeFileSync(path.join(evidence, 'frames.json'), JSON.stringify(frames, null, 2));
    await page.screenshot({ path: path.join(evidence, '01-stage.png') });

    await page.click('[data-r29-poke]');
    await page.waitForFunction(() => document.querySelector('[data-r29-stage]').dataset.r29Pose === 'surprised');
    check('戳一下变成吃惊', true);
    await page.screenshot({ path: path.join(evidence, '02-poke.png') });

    async function shakeOnce() {
      await page.evaluate(() => {
        const actor = document.querySelector('[data-r29-actor]');
        const fire = (type, x) => actor.dispatchEvent(new PointerEvent(type, {
          bubbles: true, clientX: x, clientY: 220, pointerId: 1
        }));
        fire('pointerdown', 0);
        fire('pointermove', 30);
        fire('pointermove', 60);
        fire('pointermove', 30);
        fire('pointermove', 60);
        fire('pointerup', 60);
      });
    }
    for (let i = 0; i < 8; i += 1) {
      await shakeOnce();
      await page.evaluate(() => HubPetStage.advance(301));
    }
    const shaken = await page.evaluate(() => HubPetStage.snapshot().anger);
    check('甩动让生气上升', shaken >= 20);
    await page.screenshot({ path: path.join(evidence, '03-shake.png') });
    await page.click('[data-r29-pat]');
    const coaxed = await page.evaluate(() => document.querySelector('[data-r29-stage]').dataset.r29Pose);
    check('摸一下是哄', coaxed === 'coaxed' || coaxed === 'forgiven');
    await page.screenshot({ path: path.join(evidence, '04-coax.png') });

    await page.evaluate((bot) => HubPetStage.event(bot, 'idle'), id);
    await page.evaluate(() => HubPetStage.advance(640000));
    const asleep = await page.evaluate(() => document.querySelector('[data-r29-stage]').dataset.r29Pose);
    check('闲置后入睡', asleep === 'sleeping');
    await page.screenshot({ path: path.join(evidence, '05-sleep.png') });
    await page.click('[data-r29-poke]');
    const wake = await page.evaluate(() => ({
      pose: document.querySelector('[data-r29-stage]').dataset.r29Pose,
      line: document.querySelector('[data-r29-bubble]').textContent
    }));
    check('戳醒并说话', wake.pose === 'yawn' && wake.line.indexOf('回来') >= 0);
    await page.screenshot({ path: path.join(evidence, '06-wake.png') });

    const sequence = await page.evaluate(async (bot) => {
      const stage = window.HubPetStage;
      const seen = [];
      const step = (name, ms) => {
        stage.event(bot, name);
        if (ms) stage.advance(ms);
        seen.push(document.querySelector('[data-r29-stage]').dataset.r29Pose);
      };
      step('send', 2500);
      step('working', 2500);
      step('tool-done', 2500);
      step('done', 0);
      return seen;
    }, id);
    check('事件序列听、写、想、完成', JSON.stringify(sequence) === JSON.stringify(['thinking', 'writing', 'thinking', 'happy']));
    await page.screenshot({ path: path.join(evidence, '07-events.png') });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check('手机宽度没有横向溢出', wide);
    check('浏览器没有脚本错误', errors.length === 0);
    fs.writeFileSync(path.join(evidence, 'browser.json'), JSON.stringify({
      checks, errors, frames: frames.length, browser: browser.version()
    }, null, 2));
    console.log('浏览器走查 ' + checks.length + ' 项通过');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
