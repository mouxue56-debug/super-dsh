/* 手机独立窗口的细节检查。端口只在 3744–3745。不请求外网。 */
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
const pets = path.resolve(__dirname, '..', '..', '..', '..', '..',
  '源码快照-第25轮收工-20261118', 'hub-art', 'pets-build-r22', 'pets');
const hasPets = fs.existsSync(path.join(pets, 'pack.json'));

function inside(file, base) {
  const dir = path.resolve(base);
  const target = path.resolve(file);
  return target === dir || target.startsWith(dir + path.sep);
}

function serve(port) {
  const types = {
    '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json'
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    let file = '';
    let base = root;
    if (rel.startsWith('/pets/')) {
      if (!hasPets) { res.writeHead(404); res.end('no pets'); return; }
      base = pets;
      file = path.resolve(pets, rel.slice('/pets/'.length));
    } else {
      file = path.resolve(root, '.' + rel);
    }
    if (!inside(file, base)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      const type = types[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function listen() {
  return serve(3744).catch((err) => {
    if (err && err.code === 'EADDRINUSE') return serve(3745);
    throw err;
  });
}

const SIZES = [
  { name: '390', width: 390, height: 844, keyboard: false },
  { name: '430', width: 430, height: 932, keyboard: false },
  { name: '375', width: 375, height: 667, keyboard: false },
  { name: 'key', width: 390, height: 500, keyboard: true }
];
const SCREENS = [
  'home', 'empty', 'long', 'confirm', 'rec', 'attach',
  'settings', 'more', 'perm', 'board', 'today', 'stage'
];

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const server = await listen();
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port + '/index.html';
  const browser = await playwright.chromium.launch({ executablePath: chromium, headless: true });
  const failures = [];
  const notes = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    page.on('pageerror', (error) => notes.push('pageerror ' + error.message));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      const local = url.protocol === 'data:' || url.protocol === 'blob:'
        || (url.hostname === '127.0.0.1' && url.port === String(port));
      return local ? route.continue() : route.abort();
    });
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 47, left: 0, right: 0, bottom: 34 }
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Hub && document.querySelector('#app .shell'));
    await page.evaluate(() => {
      history.go = function () {};
      history.back = function () {};
    });
    await page.waitForTimeout(300);

    const audit = () => page.evaluate(() => {
      const problems = [];
      const vw = innerWidth;
      const vh = innerHeight;
      if (document.documentElement.scrollWidth > vw + 1) {
        problems.push('横向溢出 ' + document.documentElement.scrollWidth);
      }
      function clipped(el) {
        for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
          if (node.id === 'app') continue;
          const style = getComputedStyle(node);
          const mode = style.overflowX + ' ' + style.overflow;
          if (!/hidden|auto|scroll|clip/.test(mode)) continue;
          const box = node.getBoundingClientRect();
          if (box.width > 0 && box.left >= -1 && box.right <= vw + 1) return true;
        }
        return false;
      }
      const seen = new Set();
      document.querySelectorAll('body *').forEach((el) => {
        const box = el.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) return;
        if (box.right <= vw + 1 && box.left >= -1) return;
        if (clipped(el)) return;
        const key = (el.className && String(el.className).slice(0, 40)) || el.tagName;
        if (seen.has(key)) return;
        seen.add(key);
        if (seen.size <= 6) problems.push('伸出 ' + key + ' ' + Math.round(box.left) + ',' + Math.round(box.right));
      });
      function shown(el) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0 || el.closest('[hidden]')) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        const box = el.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) return false;
        if (box.bottom <= 0 || box.top >= vh || box.right <= 0 || box.left >= vw) return false;
        return box;
      }
      function hitOf(el, box) {
        let top = box.top;
        let left = box.left;
        let right = box.right;
        let bottom = box.bottom;
        ['::before', '::after'].forEach((pseudo) => {
          const style = getComputedStyle(el, pseudo);
          if (!style || style.content === 'none' || style.content === 'normal') return;
          if (style.pointerEvents === 'none') return;
          const edgeTop = parseFloat(style.top);
          const edgeLeft = parseFloat(style.left);
          const edgeRight = parseFloat(style.right);
          const edgeBottom = parseFloat(style.bottom);
          if (Number.isFinite(edgeTop)) top = Math.min(top, box.top + edgeTop);
          if (Number.isFinite(edgeLeft)) left = Math.min(left, box.left + edgeLeft);
          if (Number.isFinite(edgeRight)) right = Math.max(right, box.right - edgeRight);
          if (Number.isFinite(edgeBottom)) bottom = Math.max(bottom, box.bottom - edgeBottom);
        });
        return { w: right - left, h: bottom - top };
      }
      let tiny = 0;
      document.querySelectorAll('button, summary, a[href], [role="button"], .searchdock').forEach((el) => {
        if (el.closest('.inputpill') && el.tagName === 'TEXTAREA') return;
        const box = shown(el);
        if (!box) return;
        const hit = hitOf(el, box);
        if (hit.w >= 43.5 && hit.h >= 43.5) return;
        tiny += 1;
        if (tiny <= 8) {
          const name = el.getAttribute('aria-label') || el.className || el.tagName;
          problems.push('热区 ' + String(name).slice(0, 32) + ' ' + Math.round(hit.w) + 'x' + Math.round(hit.h));
        }
      });
      const field = document.querySelector('.composer-area textarea');
      if (field && shown(field) && field.getBoundingClientRect().height > 40) {
        problems.push('输入框偏高 ' + Math.round(field.getBoundingClientRect().height));
      }
      const mic = document.querySelector('.composer-area .voicebtn');
      const micBox = mic ? mic.getBoundingClientRect() : null;
      if (micBox && micBox.width > 1) {
        if (micBox.width < 47 || micBox.height < 47) problems.push('麦克风偏小 ' + Math.round(micBox.width));
        if (micBox.bottom > vh - 34 + 1) problems.push('麦克风进安全区 ' + Math.round(micBox.bottom));
      }
      const top = document.querySelector('.home-top, .chat-header');
      if (top) {
        const topBox = top.getBoundingClientRect();
        if (topBox.height > 1 && topBox.top < 46) problems.push('顶栏进刘海 ' + Math.round(topBox.top));
      }
      const door = document.querySelector('.r29-go-stage');
      if (door && shown(door) && door.getBoundingClientRect().right > vw + 1) {
        problems.push('去站台超出 ' + Math.round(door.getBoundingClientRect().right));
      }
      let low = 0;
      if (document.documentElement.dataset.theme === 'dark') {
        function channel(value) {
          const ratio = value / 255;
          return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
        }
        function lum(color) {
          return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
        }
        function parse(text) {
          const match = String(text || '').match(/rgba?\(([^)]+)\)/);
          if (!match) return null;
          const parts = match[1].split(',').map((item) => parseFloat(item));
          return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
        }
        const sample = 'button, small, p, h1, h2, h3, summary, label';
        document.querySelectorAll(sample).forEach((el) => {
          if (low >= 5 || !shown(el) || el.closest('svg')) return;
          const text = [...el.childNodes].some((node) => {
            return node.nodeType === 3 && node.textContent.trim();
          });
          if (!el.childNodes || !text) return;
          const style = getComputedStyle(el);
          const fg = parse(style.color);
          if (!fg || fg.a < 0.85 || parseFloat(style.fontSize) > 18) return;
          let bg = null;
          for (let node = el; node; node = node.parentElement) {
            const paint = parse(getComputedStyle(node).backgroundColor);
            if (paint && paint.a >= 0.85) { bg = paint; break; }
          }
          if (!bg) return;
          const light = lum(fg);
          const dark = lum(bg);
          const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
          if (ratio >= 3) return;
          low += 1;
          problems.push('对比 ' + ratio.toFixed(2) + ' ' + (el.className || el.tagName).toString().slice(0, 28));
        });
      }
      const scroll = document.querySelector('.bot-scroll');
      return {
        problems,
        overflowY: scroll ? getComputedStyle(scroll).overflowY : '',
        micBottom: micBox ? Math.round(micBox.bottom) : 0,
        fieldH: field ? Math.round(field.getBoundingClientRect().height) : 0
      };
    });

    async function settle() {
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    }
    async function blur() {
      await page.evaluate(() => {
        const node = document.activeElement;
        if (node && node.blur) node.blur();
      });
    }
    async function show(screen) {
      await blur();
      await page.evaluate((name) => {
        function home() {
          state.detail = false;
          state.drawer = null;
          state.mode = 'chat';
          state.attachments = [];
          state.r29PlusOpen = false;
          render();
        }
        if (name === 'home') { home(); return; }
        state.detail = true;
        state.drawer = null;
        state.mode = 'chat';
        state.attachments = [];
        state.r29PlusOpen = false;
        if (name === 'empty') {
          window.__x6Thread = state.threads[state.bot];
          state.threads[state.bot] = [];
          render();
          return;
        }
        if (window.__x6Thread) state.threads[state.bot] = window.__x6Thread;
        if (name === 'board') { Hub.navigate({ view: 'kanban' }); return; }
        if (name === 'today') { Hub.navigate({ view: 'persona-today' }); return; }
        if (name === 'stage') { Hub.navigate({ view: 'stage' }); return; }
        if (name === 'more') { Hub.openPanel('more'); return; }
        if (name === 'perm') { Hub.openPanel('permission'); return; }
        Hub.navigate({ view: 'chat', bot: state.bot });
        render();
        if (name === 'attach') {
          state.attachments = [{ name: 'notes.txt', url: null, fail: false }];
          render();
        }
      }, screen);
      if (screen === 'settings') {
        await page.waitForSelector('[data-r29-settings]', { timeout: 4000 });
        await page.click('[data-r29-settings]');
      }
      if (screen === 'rec') {
        await page.evaluate(() => {
          const mic = document.querySelector('.composer-area .voicebtn');
          const slot = document.querySelector('[data-r29-voice-slot]');
          if (mic) mic.setAttribute('data-r29-phase', 'recording');
          if (!slot) return;
          slot.replaceChildren();
          const live = document.createElement('span');
          live.className = 'r29-voice-live';
          live.textContent = '正在录音';
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'r29-voice-action';
          cancel.textContent = '取消';
          slot.append(live, cancel);
        });
      }
      if (screen === 'confirm') {
        await page.evaluate(() => {
          const card = document.querySelector('.r22-letter .actions, .shell-level-sticker');
          if (card) card.scrollIntoView({ block: 'center' });
        });
      }
      await settle();
      if (!page.url().includes('127.0.0.1')) {
        notes.push(screen + ' 离开了本地页');
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.Hub && document.querySelector('#app .shell'));
      }
    }

    async function petCut(slot) {
      if (!hasPets) return [];
      return page.evaluate(async (want) => {
        const images = [...document.querySelectorAll('.chief-pet-stage img')].filter((img) => {
          return img.closest('[data-pet-stage]')?.dataset.petStage === want;
        });
        const found = [];
        for (const img of images) {
          if (!img.complete || !img.naturalWidth) continue;
          const box = img.getBoundingClientRect();
          if (box.width < 2 || box.height < 2) continue;
          const canvas = document.createElement('canvas');
          const step = 4;
          canvas.width = Math.max(1, Math.round(img.naturalWidth / step));
          canvas.height = Math.max(1, Math.round(img.naturalHeight / step));
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          let data = null;
          try { data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; }
          catch (err) { found.push('读不到像素'); continue; }
          let minY = canvas.height;
          let maxY = -1;
          for (let y = 0; y < canvas.height; y += 1) {
            for (let x = 0; x < canvas.width; x += 1) {
              if (data[(y * canvas.width + x) * 4 + 3] > 16) {
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxY < 0) continue;
          const scaleY = box.height / canvas.height;
          const rawTop = box.top + minY * scaleY;
          const rawBottom = box.top + (maxY + 1) * scaleY;
          let top = rawTop;
          let bottom = rawBottom;
          for (let node = img.parentElement; node && node !== document.body; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (!/hidden|clip/.test(style.overflow + style.overflowY)) continue;
            const frame = node.getBoundingClientRect();
            top = Math.max(top, frame.top);
            bottom = Math.min(bottom, frame.bottom);
          }
          if (rawTop < top - 1) found.push(want + ' 裁头 ' + (top - rawTop).toFixed(1));
          if (rawBottom > bottom + 1) found.push(want + ' 裁脚 ' + (rawBottom - bottom).toFixed(1));
          if (found.length > 4) break;
        }
        return found;
      }, slot);
    }

    for (const theme of ['light', 'dark']) {
      await page.evaluate((name) => { state.theme = name; applyTheme(); render(); }, theme);
      for (const size of SIZES) {
        if (size.keyboard) {
          await page.setViewportSize({ width: 390, height: 844 });
          await show('long');
        }
        await blur();
        await page.setViewportSize({ width: size.width, height: size.height });
        await client.send('Emulation.setSafeAreaInsetsOverride', {
          insets: { top: 47, left: 0, right: 0, bottom: 34 }
        });
        if (size.keyboard) {
          await page.focus('.composer-area textarea');
          await page.waitForFunction(() => document.body.classList.contains('keyboard'), null, { timeout: 3000 });
        }
        for (const screen of SCREENS) {
          if (size.keyboard && screen !== 'long') continue;
          await show(screen);
          const report = await audit();
          report.problems.forEach((item) => {
            const line = theme + ' ' + size.name + ' ' + screen + ' ' + item;
            failures.push(line);
            console.log(line);
          });
          if (screen === 'more' || screen === 'settings') {
            if (report.overflowY !== 'hidden') {
              failures.push(theme + ' ' + size.name + ' ' + screen + ' 背后还能滚 ' + report.overflowY);
            }
          }
          const shot = size.name === '390' || (theme === 'light' && (size.keyboard || screen === 'home'));
          if (shot) {
            const file = 'after-' + screen + '-' + theme + '-' + size.name + '.png';
            await page.screenshot({ path: path.join(shots, file) });
          }
        }
        if (theme === 'light' && size.name === '390') {
          const homeCuts = await (async () => { await show('home'); return petCut('home'); })();
          const chatCuts = await (async () => { await show('long'); return petCut('chat'); })();
          homeCuts.concat(chatCuts).forEach((item) => failures.push('角色 ' + item));
          if (!hasPets) notes.push('角色像素没验：素材目录不在');
          await show('home');
          await page.evaluate(() => {
            const bot = state.bots.find((item) => item.id === state.bot) || state.bots[0];
            window.__x6Name = bot.name;
            bot.name = '很长的名字很长的名字很长的名字';
            render();
          });
          const namePlate = await page.evaluate(() => {
            const plate = document.querySelector('.pin.on .r22-nameplate, .pin .r22-nameplate');
            const pin = plate && plate.closest('.pin');
            if (!plate || !pin) return '无名牌';
            const plateBox = plate.getBoundingClientRect();
            const pinBox = pin.getBoundingClientRect();
            const style = getComputedStyle(plate);
            if (plateBox.right > pinBox.right + 1) return '名牌出格';
            if (style.textOverflow !== 'ellipsis') return '名牌没省略';
            return '';
          });
          if (namePlate) failures.push('长名 ' + namePlate);
          await page.screenshot({ path: path.join(shots, 'after-home-longname.png') });
          await page.evaluate(() => {
            const bot = state.bots.find((item) => item.id === state.bot) || state.bots[0];
            if (window.__x6Name) bot.name = window.__x6Name;
            render();
          });
          await show('more');
          const before = await page.evaluate(() => document.querySelector('.bot-scroll')?.scrollTop || 0);
          await page.mouse.move(4, 80);
          await page.mouse.wheel(0, 480);
          const after = await page.evaluate(() => document.querySelector('.bot-scroll')?.scrollTop || 0);
          if (Math.abs(after - before) > 1) failures.push('滚轮仍带动背后 ' + before + '→' + after);
        }
        if (size.keyboard && theme === 'light' && hasPets) {
          const cuts = await petCut('chat');
          cuts.forEach((item) => failures.push('键盘 ' + item));
        }
      }
    }
    if (!hasPets) notes.push('首页和对话的角色头脚没验');
    console.log('端口 ' + port + ' 问题 ' + failures.length);
    failures.slice(0, 40).forEach((item) => console.log(item));
    notes.forEach((item) => console.log('备注 ' + item));
    assert.equal(failures.length, 0, failures.slice(0, 12).join(' | '));
    console.log('r29-polish-browser 通过');
  } finally {
    await browser.close();
    await new Promise((ok) => server.close(ok));
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
