// 手机尺寸无头检查。只连 127.0.0.1:3606。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const home = os.homedir();
function exists(file) { try { return !!(file && fs.existsSync(file)); } catch (e) { return false; } }
const playwrightPath = process.env.PLAYWRIGHT_CORE || [
  path.join(home, 'node_modules/playwright-core')
].find(exists);
const chromium = process.env.CHROMIUM || [
  path.join(home, 'Library/Caches/ms-playwright',
    'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell')
].find(exists);
assert(playwrightPath && chromium, '缺少本机浏览器或 playwright-core');
const shots = path.join(__dirname, '..', 'shots');
const playwright = require(playwrightPath);
const port = 3632;
const dist = path.join(__dirname, 'dist-generic');
const base = 'http://127.0.0.1:' + port + '/DSH-Hub.html';
function serveDist() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/DSH-Hub.html';
    const file = path.resolve(dist, '.' + rel);
    if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
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
function check(label, value) { assert(value, label); console.log('通过：' + label); }
(async () => {
  fs.mkdirSync(shots, {recursive: true});
  const server = await serveDist();
  const browser = await playwright.chromium.launch({executablePath: chromium, headless: true});
  const page = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const ok = url.protocol === 'data:' || url.protocol === 'blob:' ||
      (url.hostname === '127.0.0.1' && url.port === String(port));
    return ok ? route.continue() : route.abort();
  });
  await page.goto(base);
  await page.waitForFunction(() => window.Hub && document.querySelector('.home-recent-list .conversation'));
  const home = await page.evaluate(() => {
    const plain = (message) => {
      if (!message) return '';
      if (typeof message.text === 'string' && message.text) return message.text;
      return Hub.messageText(message).replace(/\s+/g, ' ').trim();
    };
    const bots = Hub.state.bots.filter((bot) => !bot.steward && !bot.parent && bot.enabled !== false);
    const problems = [];
    bots.forEach((bot) => {
      const row = document.querySelector('.home-recent-list .conversation[data-id="' + bot.id + '"]');
      if (!row) { problems.push('缺行 ' + bot.id); return; }
      const title = row.querySelector('.line strong').textContent;
      const topic = Hub.state.sessionNames[bot.id] || '';
      const prefixed = !topic || topic === bot.name || topic.indexOf(bot.name + ' · ') === 0;
      const expected = prefixed ? (topic || bot.name) : bot.name + ' · ' + topic;
      if (title !== expected) problems.push('标题 ' + title + ' != ' + expected);
      const face = row.querySelector('.r29-face');
      if (!face || face.getAttribute('data-bot-avatar') !== bot.id) problems.push('单聊脸 ' + bot.id);
      const messages = Hub.assistantMessages(bot.id);
      const last = messages.length ? plain(messages[messages.length - 1]) : '';
      const lastMessage = messages.at(-1);
      const lastTopic = R43Thread.topics(bot.id).find(item => item.id === lastMessage?.session);
      const preview = lastTopic ? lastTopic.title + ' · ' + last : last;
      if (last && row.querySelector('.preview').textContent !== preview) problems.push('第二行 ' + bot.id);
      const badge = row.querySelector('.home-row-meta .r29-unread');
      const text = badge ? badge.textContent : '';
      const want = bot.unread > 99 ? '99+' : bot.unread > 0 ? '+' + bot.unread : '';
      if (text !== want) problems.push('行未读 ' + bot.id + ' ' + text);
      const pin = document.querySelector('.pinned .pin[data-id="' + bot.id + '"] .r29-unread');
      if ((pin ? pin.textContent : '') !== want) problems.push('格未读 ' + bot.id);
      if (pin && !pin.classList.contains('bot-unread')) problems.push('格缺类名');
    });
    const task = Hub.state.fixedTasks[0];
    const taskSel = '.home-recent-list .conversation[data-id="' + task.taskId + '"]';
    const taskRow = document.querySelector(taskSel);
    const parent = botBy(task.ownerAssistantId).name;
    if (taskRow.querySelector('.line strong').textContent !== parent + ' · ' + task.taskName) problems.push('固定任务标题');
    if (!taskRow.querySelector('[data-bot-avatar="' + task.ownerAssistantId + '"]')) problems.push('固定任务脸');
    if (taskRow.querySelector('[data-bot-avatar="' + task.taskId + '"]')) problems.push('固定任务独立脸');
    if (document.querySelectorAll('.conversation').length !== 11) problems.push('会话行数量');
    const labels = [...document.querySelectorAll('.sidebar .section-label')];
    if (labels.map((el) => el.textContent).join('') !== '最近') problems.push('最近');
    return problems;
  });
  check('最近列表单聊两行、头像和未读数字', home.length === 0);
  if (home.length) console.log(home.join('\n'));
  await page.screenshot({path: path.join(shots, 'home.png')});
  const groups = await page.evaluate(() => {
    const bots = Hub.state.bots.filter((bot) => !bot.steward && !bot.parent).slice(0, 3);
    Hub.state.groups = [
      {id: 'g-two', name: '两人组', members: [bots[0].id, bots[1].id], title: '对齐进度',
        messages: [{text: '先看第一句。'}, {text: '最后这句两人。'}], updatedAt: Date.now()},
      {id: 'g-three', name: '<img src=x onerror="window.__xss=1">组',
        members: bots.map((bot) => bot.id), topic: '三个人',
        messages: [{text: '三人最后一句。'}], updatedAt: Date.now() + 1}
    ];
    render();
    const two = document.querySelector('[data-r29-group="g-two"]');
    const three = document.querySelector('[data-r29-n="3"]');
    const twoBox = two.querySelector('.r29-stack').getBoundingClientRect();
    const faces = [...two.querySelectorAll('.r29-face')].map((el) => el.getBoundingClientRect().width);
    return {
      talks: document.querySelectorAll('.conversation').length,
      n2: two.querySelector('[data-r29-n="2"]')?.getAttribute('data-r29-n') || '',
      title: two.querySelector('strong').textContent,
      preview: two.querySelector('.preview').textContent,
      klass: two.querySelector('button').className,
      width: Math.round(twoBox.width),
      face: Math.round(faces[0] || 0),
      count: faces.length,
      threeTitle: document.querySelector('[data-r29-group="g-three"] strong').textContent,
      threeN: three?.getAttribute('data-r29-n') || '',
      threeCount: three ? three.querySelectorAll('.r29-face').length : 0,
      xss: window.__xss || 0,
      onerror: !!document.querySelector('[onerror]')
    };
  });
  check('两人叠头像占一个位置', groups.n2 === '2' && groups.count === 2 &&
    groups.width >= 36 && groups.width <= 48 && groups.face < groups.width);
  check('讨论组第一行有组名、第二行是最后一句',
    groups.title.includes('两人组') && groups.title.includes('对齐进度') && groups.preview === '最后这句两人。');
  check('讨论组行不占用单聊会话计数', groups.talks === 11 && !groups.klass.includes('conversation'));
  check('三人只取前三张，组名按文本显示', groups.threeN === '3' && groups.threeCount === 3 &&
    groups.threeTitle.includes('<img') && groups.xss === 0 && !groups.onerror);
  await page.screenshot({path: path.join(shots, 'groups.png')});
  const board = await page.evaluate(() => {
    const cards = Hub.state.cards;
    const other = Hub.state.bots.find((bot) => bot.id !== cards[0].bot && !bot.steward && !bot.parent);
    cards[0].assignedBy = other.id;
    Hub.navigate({view: 'kanban'});
    const rows = [...document.querySelectorAll('.kcard .r29-assign')];
    const first = rows[0];
    const face = first.querySelector('.r29-face');
    return {
      count: rows.length,
      cards: document.querySelectorAll('.kcard').length,
      arrow: first.textContent.includes('→'),
      size: face ? face.style.getPropertyValue('--r29-size') : '',
      name: first.textContent.includes(botBy(cards[0].bot).name) && first.textContent.includes(other.name)
    };
  });
  check('看板每张单有 28 像素头像，能对上派单人时画出箭头',
    board.cards === 15 && board.count === 15 && board.arrow && board.size === '28px' && board.name);
  await page.screenshot({path: path.join(shots, 'board.png')});
  const task = await page.evaluate(() => {
    Hub.state.mode = 'task';
    Hub.state.detail = true;
    render();
    const owner = document.querySelector('.r29-owner');
    const who = document.querySelector('.r29-who-line');
    const face = owner && owner.querySelector('.r29-face');
    return {
      owner: !!(owner && owner.textContent.includes('负责人') && face &&
        face.style.getPropertyValue('--r29-size') === '28px'),
      who: !!(who && who.textContent && (who.querySelector('.r29-face') || who.textContent.includes('用户')))
    };
  });
  check('任务负责人名前有 28 像素头像', task.owner && task.who);
  await page.screenshot({path: path.join(shots, 'tasks.png')});
  await page.evaluate(() => { Hub.state.mode = 'chat'; Hub.state.detail = false; render(); });
  // 首页底栏的「活动」换成了「今天」；老的活动中心（演示包）还从电脑右栏和折叠栏的铃铛进，这里直接点那一个。
  await page.evaluate(() => document.querySelector('[data-activity-open]').click());
  await page.locator('[data-activity-tab="decide"]').click();
  await page.waitForSelector('.shell-activity-column.on .r29-activity-face');
  const activity = await page.evaluate(() => {
    const face = document.querySelector('.shell-activity-column.on .r29-face');
    const meta = document.querySelector('.shell-activity-meta .muted');
    const head = !!document.querySelector('.shell-activity-head label strong');
    return {
      size: face ? face.style.getPropertyValue('--r29-size') : '',
      meta: meta ? meta.textContent.includes(' · ') : false,
      head: head
    };
  });
  check('活动行有 28 像素头像且原说明还在', activity.size === '28px' && activity.meta && activity.head);
  await page.screenshot({path: path.join(shots, 'activity.png')});
  const unread = await page.evaluate(() => {
    const bot = Hub.state.bots.find((item) => !item.steward && !item.parent);
    const conv = bot.id + '-013';
    const listeners = [];
    window.__marks = [];
    window.__counts = {conversations: {}, bots: {}, groups: {}};
    window.__counts.conversations[conv] = 2;
    window.__counts.bots[bot.id] = 2;
    window.HubUnread = {
      counts() { return window.__counts; },
      subscribe(fn) { listeners.push(fn); },
      markRead(id) {
        window.__marks.push(id);
        window.__counts.conversations[id] = 0;
        if (id === conv) window.__counts.bots[bot.id] = 0;
        listeners.slice().forEach((fn) => fn());
      }
    };
    render();
    const pin = () => {
      const el = document.querySelector('.pinned .pin[data-id="' + bot.id + '"] .r29-unread');
      return el ? el.textContent : '';
    };
    const row = () => {
      const sel = '.home-recent-list .conversation[data-id="' + bot.id + '"] .r29-unread';
      const el = document.querySelector(sel);
      return el ? el.textContent : '';
    };
    const first = {pin: pin(), row: row()};
    window.__counts.bots[bot.id] = 5;
    window.__counts.conversations[conv] = 5;
    listeners.slice().forEach((fn) => fn());
    const second = {pin: pin(), row: row()};
    window.__counts.bots[bot.id] = 120;
    listeners.slice().forEach((fn) => fn());
    const capped = pin();
    window.__counts.bots[bot.id] = 4;
    window.__counts.conversations[conv] = 4;
    listeners.slice().forEach((fn) => fn());
    Hub.state.detail = false;
    render();
    return {id: bot.id, conv: conv, first: first, second: second, capped: capped};
  });
  check('未读数字跟着 subscribe 从 +2 变到 +5，超过 99 显示 99+',
    unread.first.pin === '+2' && unread.first.row === '+2' &&
    unread.second.pin === '+5' && unread.second.row === '+5' && unread.capped === '99+');
  await page.evaluate((conv) => Hub.navigate({view: 'chat', conversation: conv}), unread.conv);
  await page.waitForFunction((conv) => Array.isArray(window.__marks) && window.__marks.includes(conv), unread.conv);
  const cleared = await page.evaluate((id) => {
    const pin = document.querySelector('.pinned .pin[data-id="' + id + '"] .r29-unread');
    return {gone: !pin, marks: window.__marks.slice()};
  }, unread.id);
  check('读到底后 markRead 清掉这段未读', cleared.gone && cleared.marks.includes(unread.conv));
  const xss = await page.evaluate(() => {
    const bot = Hub.state.bots.find((item) => !item.steward && !item.parent);
    const old = bot.name;
    bot.name = '<img src=x onerror="window.__xss=1">';
    window.__xss = 0;
    const html = HubAvatars.html(bot.id, 32);
    const stack = HubAvatars.stackHtml([bot.id, bot.id], 40);
    Hub.state.detail = false;
    render();
    const plate = document.querySelector('.pinned .r22-nameplate');
    const bad = !!document.querySelector('[onerror]');
    const raw = html.includes('<img src=x') || stack.includes('<img src=x');
    const result = {
      ran: window.__xss, bad: bad, raw: raw,
      escaped: html.includes('&lt;img') && stack.includes('&lt;'),
      text: plate.textContent.includes('<img')
    };
    bot.name = old;
    render();
    return result;
  });
  check('名字里的尖括号没有当成页面代码', xss.ran === 0 && !xss.bad && !xss.raw && xss.escaped && xss.text);
  const real = await page.evaluate(() => {
    delete window.HubUnread;
    document.documentElement.dataset.hubMode = 'real';
    Hub.state.detail = false;
    render();
    const shown = document.querySelectorAll('.pinned .r29-unread, .home-recent-list .r29-unread').length;
    delete document.documentElement.dataset.hubMode;
    render();
    return shown;
  });
  check('真实方式没有钩子时不露出演示未读', real === 0);
  assert(errors.length === 0, '页面报错 ' + errors.join(' | '));
  await browser.close();
  server.close();
  console.log('浏览器检查通过');
})().catch((error) => { console.error(error); process.exit(1); });
