/* 讨论组对话页。手机 390×844。端口 3743。演示注入三人组，再看真实模式空组。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const taskDir = path.resolve(__dirname, '..', '..');
const pageDir = path.join(root, 'dist-generic');
const shots = path.join(taskDir, 'shots');
const petsDir = path.resolve(taskDir, '..', '..', '..',
  '源码快照-第25轮收工-20261118', 'hub-art', 'pets-build-r22', 'pets');
const port = 3743;

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
    'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
]);
assert(fs.existsSync(path.join(pageDir, 'DSH-Hub.html')), '先运行 python3 build.py');
assert(playwrightPath && chromiumPath, '缺少已安装的浏览器或 playwright-core');
const playwright = require(playwrightPath);

function readUnder(dir, rel) {
  const file = path.resolve(dir, '.' + rel);
  if (!file.startsWith(dir)) return null;
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}
function typeOf(file) {
  const types = {
    '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.webp': 'image/webp', '.svg': 'image/svg+xml'
  };
  return types[path.extname(file)] || 'application/octet-stream';
}
function serve() {
  const petsRoot = fs.existsSync(petsDir) ? petsDir : '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/DSH-Hub.html';
    let buf = null;
    let file = '';
    if (petsRoot && rel.startsWith('/pets/')) {
      file = path.resolve(petsRoot, rel.slice('/pets/'.length));
      if (file.startsWith(petsRoot)) buf = fs.existsSync(file) ? fs.readFileSync(file) : null;
    } else {
      file = path.resolve(pageDir, '.' + rel);
      if (file.startsWith(pageDir)) buf = readUnder(pageDir, rel);
    }
    if (!buf) { res.writeHead(404); res.end('missing'); return; }
    res.writeHead(200, {'Content-Type': typeOf(file)});
    res.end(buf);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function installGroup() {
  const bots = state.bots.filter((bot) => !bot.steward && !bot.parent && bot.enabled !== false);
  const a = bots[0];
  const b = bots[1];
  const c = bots[2];
  const nasty = '<img src=x onerror="window.__xss=1">';
  window.__xss = 0;
  state.decisions.push({
    id: 'd-r29-group', kind: '转派', title: '把这一段交给下一位',
    bot: a.id, from: a.id, to: b.id, summary: '写完交给下一位看',
    status: 'pending', level: 'L1', project: state.project
  });
  const line = a.name + '在写，' + b.name + '在等';
  window.HubGroups = {
    status(id) {
      if (id !== 'g-night') return null;
      return {
        line: line,
        members: [
          {id: a.id, duty: '写开头', status: '在写'},
          {id: b.id, duty: '补来源', status: '在等', name: nasty},
          {id: c.id}
        ]
      };
    }
  };
  state.groups = [{
    id: 'g-night', name: '夜班三人', updatedAt: Date.now(),
    members: [a.id, b.id, c.id],
    messages: [
      {id: 'm-user', role: 'user', text: '我先说一句'},
      {id: 'm-a', from: a.id, text: '我先写开头'},
      {id: 'm-b', from: c.id, text: '我等着补来源'},
      {id: 'm-xss', from: b.id, name: nasty, text: '这一句的名字不该执行'},
      {id: 'm-tag', from: a.id, text: '<b>不是标签</b><script>window.__xss=1</script>'},
      {id: 'm-fyi', type: 'fyi', from: a.id, text: '顺便说一下进度'},
      {id: 'm-handoff', type: 'handoff', from: a.id, to: b.id, done: '写完第一段'},
      {id: 'm-back', type: 'handback', text: '交回这一段'},
      {id: 'm-ok', type: 'accepted'},
      {id: 'm-return', type: 'returned', text: '退回，缺一段'},
      {id: 'm-ask', type: 'ask', from: c.id, text: '这一段用不用？'},
      {id: 'm-asked', type: 'ask', from: c.id, answered: true, text: '这句已经答过'},
      {id: 'm-card', from: a.id, card: {type: 'handoff', id: 'd-r29-group'}}
    ]
  }];
  render();
  const opener = document.querySelector('[data-r29-group-open="g-night"]');
  if (opener) opener.click();
  return {line: line, who: b.name, nasty: nasty};
}

function readGroup(expect) {
  const stack = document.querySelector('.chat-header .r29-stack');
  const plate = document.querySelector('.chat-header .r22-nameplate');
  const status = document.querySelector('[data-r29-group-status]');
  const events = [...document.querySelectorAll('.r29-group-event')];
  const handoff = document.querySelector('[data-message-id="m-handoff"]');
  const tag = document.querySelector('[data-message-id="m-tag"] .r29-group-bubble');
  const xss = document.querySelector('[data-message-id="m-xss"] .r29-group-name');
  const ask = document.querySelector('.r29-group-ask');
  const card = document.querySelector('[data-message-id="m-card"]');
  const fyi = document.querySelector('[data-message-id="m-fyi"]');
  const speeches = [...document.querySelectorAll('.r29-group-msg')];
  return {
    stackW: stack ? getComputedStyle(stack).width : '',
    faces: stack ? stack.querySelectorAll('.r29-face').length : 0,
    n: stack ? stack.getAttribute('data-r29-n') : '',
    plate: plate ? plate.textContent : '',
    status: status ? status.textContent : '',
    events: events.map((node) => ({
      kind: node.getAttribute('data-r29-kind'),
      text: node.textContent,
      bubble: node.classList.contains('bubble') || !!node.querySelector('.bubble')
    })),
    handoff: handoff ? handoff.textContent : '',
    tag: tag ? tag.textContent : '',
    xss: xss ? xss.textContent : '',
    ask: ask ? ask.textContent : '',
    askCount: ask ? ask.getAttribute('data-r29-ask-count') : '',
    askJump: ask ? ask.getAttribute('data-r29-group-jump') : '',
    card: !!(card && card.querySelector('.mcard, .r22-letter, .m-plain-talk-card')),
    fyiSpeech: !!(fyi && fyi.classList.contains('r29-group-msg')),
    user: !!document.querySelector('.r29-group-msg.is-user .r29-group-you'),
    named: speeches.every((node) => node.querySelector('.r29-group-name')
      && (node.querySelector('.r29-face') || node.querySelector('.r29-group-you'))),
    speechCount: speeches.length,
    hit: window.__xss || 0,
    onerror: !!document.querySelector('[onerror]'),
    expectLine: expect.line,
    expectWho: expect.who,
    expectNasty: expect.nasty
  };
}

(async () => {
  fs.mkdirSync(shots, {recursive: true});
  const server = await serve();
  const browser = await playwright.chromium.launch({
    executablePath: chromiumPath, headless: true
  });
  const checks = [];
  const check = (label, value) => {
    assert.ok(value, label);
    checks.push(label);
    console.log('通过：' + label);
  };
  try {
    const errors = [];
    const page = await browser.newPage({
      viewport: {width: 390, height: 844}, deviceScaleFactor: 1
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      const local = url.protocol === 'data:' || url.protocol === 'blob:'
        || (url.hostname === '127.0.0.1' && url.port === String(port));
      return local ? route.continue() : route.abort();
    });
    await page.goto('http://127.0.0.1:' + port + '/DSH-Hub.html');
    await page.waitForFunction(() => window.Hub && state.bots && state.bots.length >= 3);
    const expect = await page.evaluate(installGroup);
    await page.waitForSelector('[data-r29-group-thread="g-night"]');
    const seen = await page.evaluate(readGroup, expect);
    check('顶栏叠三张 32 像素的脸', seen.stackW === '32px' && seen.faces === 3 && seen.n === '3');
    check('顶栏是组名', seen.plate === '夜班三人');
    check('顶栏小字来自状态钩子', seen.status === seen.expectLine && seen.status.length > 0);
    check('四条交接是居中事件条', seen.events.length === 4 && seen.events.every((item) => !item.bubble));
    check('交给谁做到哪算完', seen.handoff === '交给' + seen.expectWho + '，做到写完第一段算完');
    check('交回、验收通过、退回按类型显示',
      seen.events.some((item) => item.kind === 'handback' && item.text === '交回这一段')
      && seen.events.some((item) => item.kind === 'accepted' && item.text === '验收通过')
      && seen.events.some((item) => item.kind === 'returned' && item.text === '退回，缺一段'));
    check('发言带名字和头像', seen.named && seen.user && seen.speechCount >= 8);
    check('判断不了的类型仍是发言', seen.fyiSpeech);
    check('尖括号名字和正文不被执行',
      seen.xss === seen.expectNasty && seen.tag.includes('<b>') && seen.tag.includes('<script>')
      && seen.hit === 0 && !seen.onerror);
    check('等你回答只有一条，指向最早的未答问题',
      seen.ask === '等你回答' && seen.askCount === '1' && seen.askJump === 'm-ask');
    check('分工表沿用现有卡片', seen.card);
    await page.screenshot({path: path.join(shots, 'group-thread.png')});

    await page.evaluate(() => document.querySelector('[data-r29-group-toggle]').click());
    await page.waitForSelector('[data-r29-group-members]');
    const members = await page.evaluate((nasty) => {
      const rows = [...document.querySelectorAll('.r29-group-member')];
      return {
        count: rows.length,
        faces: rows.every((row) => row.querySelector('.r29-face')),
        text: rows.map((row) => row.textContent),
        hit: window.__xss || 0,
        onerror: !!document.querySelector('[onerror]'),
        nastyShown: rows.some((row) => row.textContent.includes(nasty))
      };
    }, expect.nasty);
    check('成员列表三人，各有头像、这次负责和现在状态',
      members.count === 3 && members.faces
      && members.text[0].includes('这次 写开头') && members.text[0].includes('现在 在写')
      && members.text[1].includes('这次 补来源') && members.text[1].includes('现在 在等')
      && members.text[2].includes('这次 暂无') && members.text[2].includes('现在 暂无'));
    check('成员名字里的尖括号不被执行', members.nastyShown && members.hit === 0 && !members.onerror);
    await page.screenshot({path: path.join(shots, 'group-members.png')});

    await page.evaluate(() => {
      if (state.r29GroupMembersOpen) {
        state.r29GroupMembersOpen = false;
        render();
      }
      const thread = document.querySelector('[data-r29-group-thread]');
      if (thread) thread.scrollTop = 0;
    });
    await page.evaluate(() => document.querySelector('.r29-group-ask').click());
    await page.waitForTimeout(400);
    const jumped = await page.evaluate(() => {
      const thread = document.querySelector('[data-r29-group-thread]');
      const msg = document.querySelector('[data-message-id="m-ask"]');
      if (!thread || !msg) return false;
      const pane = thread.getBoundingClientRect();
      const box = msg.getBoundingClientRect();
      const mid = (box.top + box.bottom) / 2;
      return mid > pane.top && mid < pane.bottom;
    });
    check('点等你回答跳到那条', jumped);
    await page.screenshot({path: path.join(shots, 'group-ask.png')});
    check('演示页没有脚本错误', errors.length === 0);
    if (errors.length) console.log(errors.join('\n'));

    const realErrors = [];
    const real = await browser.newPage({
      viewport: {width: 390, height: 844}, deviceScaleFactor: 1
    });
    real.on('pageerror', (err) => realErrors.push(String(err)));
    await real.addInitScript(() => {
      const apply = () => {
        const root = document.documentElement;
        if (!root) return false;
        root.dataset.hubMode = 'real';
        return true;
      };
      if (apply()) return;
      const watcher = new MutationObserver(() => { if (apply()) watcher.disconnect(); });
      watcher.observe(document, {childList: true});
    });
    await real.goto('http://127.0.0.1:' + port + '/DSH-Hub.html');
    await real.waitForFunction(() => window.Hub && state.bots && state.bots.length);
    const empty = await real.evaluate(() => {
      const bot = state.bots.find((item) => !item.steward && !item.parent && item.enabled !== false);
      window.HubGroups = {status() { return ''; }};
      state.groups = [{
        id: 'g-empty', name: '空组', members: [bot.id], messages: [], updatedAt: Date.now()
      }];
      render();
      const opener = document.querySelector('[data-r29-group-open="g-empty"]');
      if (opener) opener.click();
      return !!opener;
    });
    check('真实模式能打开空组', empty === true);
    await real.waitForFunction(() => {
      const thread = document.querySelector('[data-r29-group-thread="g-empty"]');
      if (!thread) return false;
      return thread.textContent.replace(/\s+/g, '') === '暂无';
    });
    const quiet = await real.evaluate(() => {
      const thread = document.querySelector('[data-r29-group-thread="g-empty"]');
      return {
        mode: document.documentElement.dataset.hubMode,
        text: thread ? thread.textContent.replace(/\s+/g, '') : '',
        status: !!document.querySelector('[data-r29-group-status]'),
        date: thread ? thread.textContent.includes('今天，11 月') : true
      };
    });
    check('真实模式空组显示暂无', quiet.mode === 'real' && quiet.text === '暂无' && !quiet.date);
    check('状态钩子是空串时不显示小字', quiet.status === false);
    check('真实模式没有脚本错误', realErrors.length === 0);
    if (realErrors.length) console.log(realErrors.join('\n'));
    await real.screenshot({path: path.join(shots, 'group-real.png')});
    console.log('合计通过 ' + checks.length);
    console.log('角色图目录：' + (fs.existsSync(petsDir) ? '已挂 /pets/' : '没有，头像用首字'));
  } finally {
    await browser.close();
    await closeServer(server);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
