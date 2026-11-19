/* 集成走查。手机 390×844。演示一遍，模拟真实再一遍。端口 3631。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pageDir = path.join(root, 'dist-generic');
const shots = path.resolve(__dirname, '..', '..', 'shots');
const port = 3631;
const PROMPT = '帮我新建一个助理，负责：';
const DRAFT = '走查草稿';

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
assert(fs.existsSync(path.join(pageDir, 'DSH-Hub.html')), '先运行 python3 build.py');
assert(playwrightPath && chromiumPath, '缺少已安装的浏览器或 playwright-core');
const playwright = require(playwrightPath);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

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
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function closeDrawer(page) {
  for (let i = 0; i < 5; i += 1) {
    const open = await page.evaluate(() => !!state.drawer);
    if (!open) return;
    const title = await page.locator('.drawer h2').innerText();
    await page.locator('.drawer [data-act="close"]').first().click();
    await page.waitForFunction((previous) => {
      if (!state.drawer) return true;
      const heading = document.querySelector('.drawer h2');
      return !heading || heading.textContent !== previous;
    }, title, {timeout: 4000});
  }
  await page.waitForFunction(() => !state.drawer);
}

async function armMic(page) {
  await page.evaluate(() => {
    class FakeRecorder {
      constructor() {
        this.state = 'inactive';
        this.mimeType = 'audio/webm';
        this.listeners = {};
      }
      addEventListener(type, fn) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(fn);
      }
      start() {
        this.state = 'recording';
        const blob = new Blob([new Uint8Array([1, 2, 3])], {type: 'audio/webm'});
        (this.listeners.dataavailable || []).forEach((fn) => fn({data: blob}));
      }
      stop() {
        this.state = 'inactive';
        (this.listeners.stop || []).forEach((fn) => fn({}));
      }
    }
    FakeRecorder.isTypeSupported = function () { return true; };
    window.MediaRecorder = FakeRecorder;
    const track = {stop() {}, addEventListener() {}};
    const stream = {
      getAudioTracks() { return [track]; },
      getTracks() { return [track]; }
    };
    const devices = navigator.mediaDevices || {};
    devices.getUserMedia = function () { return Promise.resolve(stream); };
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: devices});
    }
  });
}

async function pass(browser, real) {
  const tag = real ? 'real' : 'demo';
  const errors = [];
  const checks = [];
  const page = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  page.on('pageerror', (err) => errors.push(err.stack || String(err)));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const local = url.protocol === 'data:' || url.protocol === 'blob:'
      || (url.hostname === '127.0.0.1' && url.port === String(port));
    return local ? route.continue() : route.abort();
  });
  if (real) {
    await page.addInitScript(() => {
      // 真实方式下权限要由适配层的设置钩子落地并回读；这里给一个记得住的假钩子。
      let savedMode = 'open';
      window.HubSettings = {
        get: () => Promise.resolve({permission: {mode: savedMode}, bots: {}, models: []}),
        setPermission: mode => { savedMode = mode; return Promise.resolve({ok: true}); }
      };
      const apply = () => {
        const root = document.documentElement;
        if (!root) return false;
        root.dataset.hubMode = 'real';
        return true;
      };
      if (apply()) return;
      const watcher = new MutationObserver(() => {
        if (apply()) watcher.disconnect();
      });
      watcher.observe(document, {childList: true});
    });
  }
  const check = (label, value) => {
    assert.ok(value, tag + '：' + label);
    checks.push(label);
    console.log('通过：' + tag + ' / ' + label);
  };
  await page.goto('http://127.0.0.1:' + port + '/DSH-Hub.html');
  await page.waitForFunction(() => window.Hub && state.bots && state.bots.length);
  if (real) {
    const mode = await page.evaluate(() => document.documentElement.dataset.hubMode);
    check('模拟真实模式', mode === 'real');
    await page.evaluate(() => {
      const bot = state.bots.find((item) => !item.steward && !item.parent && item.enabled !== false);
      const conv = bot.id + '-013';
      const counts = {conversations: {}, bots: {}, groups: {}};
      counts.conversations[conv] = 3;
      counts.bots[bot.id] = 3;
      window.HubUnread = {
        counts() { return counts; },
        subscribe() {},
        markRead() {}
      };
      render();
    });
  }
  await page.screenshot({path: path.join(shots, tag + '-01-home.png')});
  await page.locator('.pinned .pin').first().click();
  await page.waitForSelector('.chat-header [data-r29-settings]');
  check('顶栏有返回', await page.locator('.chat-header .backbtn').isVisible());
  const headerFace = page.locator(
    '.chat-header .r29-avatar .r29-face, .chat-header .r29-avatar .r29-stack, .chat-header .r29-avatar .chief-pet-avatar'
  ).first();
  check('顶栏有头像', await headerFace.isVisible());
  check('顶栏有名字', await page.locator('.chat-header .r22-nameplate').isVisible());
  const size = await page.evaluate(() => {
    const face = document.querySelector('.chat-header .r29-avatar .r29-face, .chat-header .r29-avatar .r29-stack, .chat-header .r29-avatar .chief-pet-avatar');
    return face ? getComputedStyle(face).width : '';
  });
  check('顶栏头像是 32', size === '32px');
  const stacked = await page.evaluate(() => {
    const bots = state.bots.filter((item) => !item.steward && !item.parent).slice(0, 2);
    const previous = state.groups;
    state.groups = [{
      id: 'g-walk', name: '两人', title: '话题',
      members: [bots[0].id, bots[1].id], conversation: state.conversation
    }];
    render();
    const node = document.querySelector('.chat-header .r29-stack');
    const ok = !!(node && getComputedStyle(node).width === '32px' && node.querySelectorAll('.r29-face').length === 2);
    state.groups = previous;
    render();
    return ok;
  });
  check('讨论组顶栏用叠头像', stacked);
  const lively = await page.evaluate(() => {
    const platform = document.querySelector('.r22-pet-platform');
    if (!platform) return 'missing';
    const active = window.chiefPet && chiefPet.active && chiefPet.active(state.bot);
    if (active) return platform.querySelector('[data-pet-stage]') ? 'on' : 'off';
    return 'idle';
  });
  check('对话站台仍由形象引擎驱动', lively === 'on' || lively === 'idle');

  await page.locator('[data-r29-plus]').click();
  await page.waitForSelector('[data-r29-plus-panel]');
  const plus = await page.locator('[data-r29-plus-panel] button').allInnerTexts();
  check('加号只有传图片和传文件', plus.length === 2 && plus.includes('传图片') && plus.includes('传文件'));
  await page.locator('[data-r29-file="any"]').setInputFiles({
    name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello')
  });
  await page.waitForSelector('[data-r29-previews] .r29-file-name');
  check('选文件后有预览', (await page.locator('[data-r29-previews]').innerText()).includes('note.txt'));
  await page.screenshot({path: path.join(shots, tag + '-02-preview.png')});
  await page.locator('[data-act="remove-attach"]').click();
  await page.waitForFunction(() => !state.attachments || !state.attachments.length);

  await armMic(page);
  await page.locator('[data-r29-mic]').click();
  await page.waitForFunction(() => {
    const slot = document.querySelector('[data-r29-voice-slot]');
    return slot && (slot.textContent || '').includes('正在录音');
  });
  check('点麦克风出状态条', true);
  await page.screenshot({path: path.join(shots, tag + '-03-mic.png')});
  await page.locator('[data-r29-mic]').click();
  await page.waitForSelector('.r29-voice-bubble');
  check('再点发出语音气泡', await page.locator('.r29-voice-bubble').count() >= 1);

  await page.locator('[data-focus="composer"]').fill(DRAFT);
  await page.waitForFunction((text) => state.input === text, DRAFT);
  await page.locator('.chat-header [data-r29-settings]').click();
  await page.waitForSelector('[data-r29-settings-page]');
  check('设置页打开', /的设置$/.test(await page.locator('.drawer h2').innerText()));
  await page.locator('[data-r29-open-permissions]').click();
  await page.waitForSelector('[data-r29-permissions]');
  check('权限页打开', (await page.locator('.drawer h2').innerText()) === '权限');
  await page.locator('[data-r29-permission="ask"]').click();
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-r29-permission="ask"]');
    return node && node.getAttribute('aria-checked') === 'true';
  });
  check('选中改动前问我', true);
  await page.screenshot({path: path.join(shots, tag + '-04-permission.png')});
  await closeDrawer(page);
  check('回到对话草稿还在', await page.locator('[data-focus="composer"]').inputValue() === DRAFT);

  const moreBtn = page.locator('.r22-home-dock [data-act="more"]');
  if (await moreBtn.count() && await moreBtn.first().isVisible()) await moreBtn.first().click();
  else {
    await page.locator('.chat-header .backbtn').click();
    await page.waitForTimeout(300);
    if (await moreBtn.count() && await moreBtn.first().isVisible()) await moreBtn.first().click();
    else await page.evaluate(() => Hub.openPanel('more'));
  }
  await page.waitForSelector('[data-r29-more-list]');
  const ids = await page.locator('[data-r29-more-list] [data-r29-more]').evaluateAll((nodes) => {
    return nodes.map((node) => node.getAttribute('data-r29-more'));
  });
  check('更多第一层五项（今天、看板在首页底栏；权限、外观在设置里；新建助理在名册里）',
    ids.join(',') === 'roster,tasks,ledger,settings,stop');
  const hidden = await page.evaluate(() => {
    const root = document.querySelector('.r29-legacy');
    const style = root ? getComputedStyle(root) : null;
    const box = root ? root.getBoundingClientRect() : {width: 0, height: 0};
    const drawer = document.querySelector('.drawer');
    const text = drawer ? drawer.innerText : '';
    const words = ['三分钟看完', '待输入', '完整模式', '会话、文件与更多操作'];
    return {
      display: style ? style.display : '',
      area: box.width * box.height,
      tiles: root ? root.querySelectorAll('[data-feature-open]').length : 0,
      leaked: words.filter((word) => text.includes(word))
    };
  });
  check('三分钟和待输入看不见', hidden.display === 'none' && hidden.area === 0 && hidden.leaked.length === 0);
  check('七个功能砖还在旧层里', hidden.tiles === 7);
  await page.screenshot({path: path.join(shots, tag + '-05-more.png')});
  // 新建助理搬进了名册，更多里少这一项；名册页的内容由演示页或适配层画，这里直接点同一个挂点。
  await page.evaluate(() => {
    const probe = document.createElement('button');
    probe.setAttribute('data-new-bot-open', '');
    document.body.append(probe);
    probe.click();
  });
  await page.waitForFunction((text) => {
    const input = document.querySelector('[data-focus="composer"]');
    return input && input.value === text;
  }, PROMPT);
  const chief = await page.evaluate(() => {
    const bot = state.bots.find((item) => item.role === 'chief');
    return state.bot === bot.id && state.conversation === bot.id + '-013';
  });
  check('新建助理进首席且输入框是开头', chief);

  await page.locator('.chat-header .backbtn').click();
  await page.waitForSelector('.home-recent-list');
  const recent = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.home-recent-list strong')].map((node) => node.textContent);
    const badges = [...document.querySelectorAll('.home-recent-list .r29-unread')].map((node) => node.textContent);
    return {
      topic: titles.some((text) => text.includes(' · ')),
      unread: badges.some((text) => /^\+\d+$/.test(text) || text === '99+')
    };
  });
  check('最近列表有名字和话题', recent.topic);
  check('最近列表有未读数字', recent.unread);
  await page.screenshot({path: path.join(shots, tag + '-06-recent.png')});

  await page.evaluate(() => Hub.navigate({view: 'stage'}));
  await page.waitForSelector('[data-r29-pet-slot] [data-r29-mover]');
  check('站台页是桌宠槽', await page.locator('[data-r29-pet-slot] [data-r29-stage]').count() === 1);
  const firstFrame = await page.evaluate(() => {
    const mover = document.querySelector('[data-r29-mover]');
    const img = mover.querySelector('img');
    return {transform: getComputedStyle(mover).transform, src: img ? img.currentSrc || img.src : ''};
  });
  await page.waitForTimeout(800);
  const secondFrame = await page.evaluate(() => {
    const mover = document.querySelector('[data-r29-mover]');
    const img = mover.querySelector('img');
    return {transform: getComputedStyle(mover).transform, src: img ? img.currentSrc || img.src : ''};
  });
  check('站台形象在动',
    firstFrame.transform !== secondFrame.transform || firstFrame.src !== secondFrame.src);
  await page.screenshot({path: path.join(shots, tag + '-07-stage.png')});

  await page.evaluate(() => Hub.openPanel('appearance'));
  await page.waitForSelector('.drawer');
  const look = await page.locator('.drawer').innerText();
  check('完整模式和会话折叠看不见', !look.includes('完整模式') && !look.includes('会话、文件与更多操作'));
  await closeDrawer(page);

  if (!real) {
    const blocked = await page.evaluate(() => {
      const before = state.bots.length;
      const field = document.createElement('input');
      field.setAttribute('data-new-bot-duty', '');
      field.value = '看进度';
      document.body.append(field);
      const choice = document.createElement('button');
      choice.setAttribute('data-new-bot-choice', 'chief');
      document.body.append(choice);
      choice.click();
      const input = document.querySelector('[data-focus="composer"]');
      const title = document.querySelector('.drawer h2');
      const draftCard = [...document.querySelectorAll('.mcard')].some((node) => {
        const text = node.textContent || '';
        const card = node.querySelector('[data-assistant-change], h3');
        return text.includes('看进度') && !!card;
      });
      return {
        bots: state.bots.length === before,
        text: input && input.value === '帮我新建一个助理，负责：看进度',
        sheet: !title || title.textContent !== '新建助理',
        card: !draftCard
      };
    });
    check('旧新建按钮不进草稿确认卡',
      blocked.bots && blocked.text && blocked.sheet && blocked.card);
    const lead = await page.evaluate(() => {
      const decision = (state.decisions || []).find((item) => item && item.id);
      if (!decision || typeof builtinCardHTML !== 'function') return false;
      const kind = decision.kind === '转派' ? 'handoff' : decision.kind === '草稿' ? 'draft' : 'approval';
      const box = document.createElement('div');
      box.innerHTML = builtinCardHTML({type: kind, id: decision.id});
      const first = box.querySelector('.mcard') && box.querySelector('.mcard').firstElementChild;
      return !!(first && first.classList.contains('r29-confirm-face') && first.querySelector('.r29-face'));
    });
    check('确认卡第一行有头像', lead);
  }

  if (errors.length) console.log(errors.join('\n'));
  check('页面脚本错误为零', errors.length === 0);
  await page.close();
  return checks.length;
}

(async () => {
  fs.mkdirSync(shots, {recursive: true});
  const server = await serve();
  const browser = await playwright.chromium.launch({executablePath: chromiumPath, headless: true});
  try {
    const demo = await pass(browser, false);
    const real = await pass(browser, true);
    console.log('总走查通过 演示 ' + demo + ' 项，真实 ' + real + ' 项');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
