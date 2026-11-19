/* 拉群。手机 390×844。端口 3746。 */
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
const port = 3746;

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


(async () => {
  fs.mkdirSync(shots, {recursive: true});
  const server = await serve();
  const browser = await playwright.chromium.launch({executablePath: chromiumPath, headless: true});
  const checks = [];
  const check = (label, value) => {
    assert.ok(value, label);
    checks.push(label);
    console.log('通过：' + label);
  };
  const shot = async (page, name) => {
    await page.waitForTimeout(450);
    await page.screenshot({path: path.join(shots, name)});
  };
  try {
    const errors = [];
    const page = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      const local = url.protocol === 'data:' || url.protocol === 'blob:'
        || (url.hostname === '127.0.0.1' && url.port === String(port));
      return local ? route.continue() : route.abort();
    });
    await page.goto('http://127.0.0.1:' + port + '/DSH-Hub.html');
    await page.waitForFunction(() => window.Hub && state.bots && state.bots.length >= 4);
    await page.waitForSelector('.home-recent .section-label');

    // 首页入口
    const home = await page.evaluate(() => ({
      entries: document.querySelectorAll('[data-r30-new-group]').length,
      text: (document.querySelector('[data-r30-new-group]') || {}).textContent || '',
      pins: document.querySelectorAll('.pinned .pin').length
    }));
    check('首页「最近」旁有一个拉群入口，六格布局还在', home.entries === 1 && home.text.includes('拉个群聊') && home.pins >= 6);
    await shot(page, 'g1-home.png');

    // 单聊：点顶栏头像出面板
    const botId = await page.evaluate(() => {
      const bots = state.bots.filter((b) => !b.steward && !b.parent && b.enabled !== false);
      window.__bots = bots.map((b) => ({id: b.id, name: b.name}));
      return bots[0].id;
    });
    await page.evaluate((id) => document.querySelector('.pinned .pin[data-id="' + id + '"]').click(), botId);
    await page.waitForSelector('.chat-header [data-r30-bot-sheet]');
    const gear = await page.evaluate(() => !!document.querySelector('.chat-header [data-r29-settings]'));
    check('单聊顶栏头像可点，右上角设置还在', gear);
    await shot(page, 'g2-chat.png');
    await page.evaluate(() => document.querySelector('.chat-header [data-r30-bot-sheet]').click());
    await page.waitForSelector('.r30g-sheet');
    const sheet = await page.evaluate((id) => {
      const rows = [...document.querySelectorAll('.r30g-row')];
      return {
        big: !!document.querySelector('.r30-bot-face .r29-face, .r30-bot-face img, .r30-bot-face *'),
        name: document.querySelector('.r30-bot-text strong').textContent,
        lead: document.querySelector('.r30-lead').textContent,
        rows: rows.length,
        ids: rows.map((r) => r.getAttribute('data-r30-pick')),
        self: rows.some((r) => r.getAttribute('data-r30-pick') === id),
        go: document.querySelector('[data-r30-go]').disabled,
        bots: window.__bots.length
      };
    }, botId);
    check('面板有大头像、名字，「拉其他助理进来」，列出其余助理且不含自己',
      sheet.big && sheet.name.length > 0 && sheet.lead === '拉其他助理进来' && !sheet.self && sheet.rows === sheet.bots - 1);
    check('没选人时「开始群聊」点不了', sheet.go === true);
    await shot(page, 'g3-bot-sheet.png');
    await page.evaluate(() => {
      const rows = document.querySelectorAll('.r30g-row');
      rows[0].click();
    });
    await page.evaluate(() => document.querySelectorAll('.r30g-row')[1].click());
    const picked = await page.evaluate(() => ({
      on: document.querySelectorAll('.r30g-row.is-on').length,
      go: document.querySelector('[data-r30-go]').disabled,
      label: document.querySelector('[data-r30-go]').textContent,
      name: document.querySelector('[data-r30-name]').value
    }));
    check('可多选，选了就能点「开始群聊」，群名有默认值', picked.on === 2 && picked.go === false && picked.name.length > 0
      && picked.label.includes('开始群聊'));
    await shot(page, 'g4-picked.png');
    // 群名可改，尖括号只当文字
    const nasty = '<img src=x onerror="window.__xss=1">';
    await page.fill('[data-r30-name]', nasty);
    await page.evaluate(() => document.querySelector('[data-r30-go]').click());
    await page.waitForSelector('[data-r29-group-thread]');
    await page.waitForTimeout(200);
    const grp = await page.evaluate((nasty) => {
      const plate = document.querySelector('.chat-header .r22-nameplate');
      const events = [...document.querySelectorAll('.r29-group-event')];
      const ta = document.querySelector('[data-focus="composer"]');
      return {
        sheetGone: !document.querySelector('.r30g-sheet'),
        plate: plate ? plate.textContent : '',
        nastyOk: plate ? plate.textContent === nasty : false,
        xss: window.__xss || 0,
        onerror: !!document.querySelector('[onerror]'),
        faces: document.querySelectorAll('.chat-header .r29-stack .r29-face').length,
        n: (document.querySelector('.chat-header .r29-stack') || {getAttribute: () => ''}).getAttribute('data-r29-n'),
        event: events.length === 1
          ? events[0].getAttribute('data-r29-kind') + '|' + events[0].textContent : String(events.length),
        ph: ta ? ta.getAttribute('placeholder') : '',
        group: state.groups.length
      };
    }, nasty);
    check('开始群聊后直接进组，群名可改且尖括号只当文字', grp.sheetGone && grp.nastyOk && grp.xss === 0 && !grp.onerror
      && grp.group === 1);
    check('顶栏是叠头像（三人）', grp.faces === 3 && grp.n === '3');
    check('组里第一条是居中事件条「主人拉了…」', /^joined\|主人拉了.+一起开了这个组/.test(grp.event));
    check('输入框占位是「在组里说一句」', grp.ph === '在组里说一句');
    await shot(page, 'g5-group.png');

    // 讨论组里发一句（演示）
    await page.fill('[data-focus="composer"]', '大家先各说一句');
    await page.evaluate(() => document.querySelector('.composer-area .voicebtn').click());
    await page.waitForFunction(() => document.querySelector('.r29-group-msg.is-user'));
    const said = await page.evaluate(() => {
      const mine = document.querySelector('.r29-group-msg.is-user');
      return {text: mine.textContent, face: !!mine.querySelector('.r29-group-you'),
        name: !!mine.querySelector('.r29-group-name')};
    });
    check('演示里组内发言带头像和名字', said.text.includes('大家先各说一句') && said.face && said.name);

    // 成员面板
    await page.evaluate(() => document.querySelector('[data-r29-group-toggle]').click());
    await page.waitForSelector('[data-r29-group-members]');
    const panel = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.r29-group-member')];
      return {
        rows: rows.length,
        host: rows.filter((r) => r.querySelector('.r30-host-tag')).length,
        removes: document.querySelectorAll('[data-r30-remove]').length,
        more: !!document.querySelector('[data-r30-add]'),
        hostRowHasRemove: rows.some((r) => r.querySelector('.r30-host-tag') && r.querySelector('[data-r30-remove]'))
      };
    });
    check('成员面板：三人、主持不可移出、其余可请出去、有「再拉人」',
      panel.rows === 3 && panel.host === 1 && panel.removes === 2 && panel.more && !panel.hostRowHasRemove);
    await shot(page, 'g6-members.png');
    // 再拉人
    await page.evaluate(() => document.querySelector('[data-r30-add]').click());
    await page.waitForSelector('.r30g-sheet');
    const add = await page.evaluate(() => ({
      title: document.querySelector('.r30-bot-text strong').textContent,
      rows: document.querySelectorAll('.r30g-row').length,
      noName: !document.querySelector('[data-r30-name]'),
      total: window.__bots.length
    }));
    check('再拉人只列还没进组的助理', add.title === '再拉人进来' && add.rows === add.total - 3 && add.noName);
    await shot(page, 'g7-add-more.png');
    await page.evaluate(() => document.querySelectorAll('.r30g-row')[0].click());
    await page.evaluate(() => document.querySelector('[data-r30-go]').click());
    await page.waitForFunction(() => !document.querySelector('.r30g-sheet'));
    const after = await page.evaluate(() => {
      const g = state.groups[0];
      const events = [...document.querySelectorAll('.r29-group-event')];
      return {members: g.members.length, events: events.map((n) => n.getAttribute('data-r29-kind'))};
    });
    check('拉进来后成员加一、组里多一条事件条', after.members === 4 && after.events.filter((k) => k === 'joined').length === 2);
    // 移出：先问一次再动手
    await page.evaluate(() => {
      if (document.querySelector('[data-r29-group-members]')) return;
      document.querySelector('[data-r29-group-toggle]').click();
    });
    await page.waitForSelector('[data-r30-remove]');
    const victim = await page.evaluate(
      () => document.querySelectorAll('[data-r30-remove]')[0].getAttribute('data-r30-remove'));
    await page.evaluate(() => document.querySelectorAll('[data-r30-remove]')[0].click());
    const asked = await page.evaluate(() => document.querySelector('[data-r30-remove].is-ask').textContent);
    check('请出去要点两下：第一下先变成「确定请出去」', asked === '确定请出去' && true);
    await shot(page, 'g8-remove-ask.png');
    await page.evaluate(() => document.querySelector('[data-r30-remove].is-ask').click());
    await page.waitForTimeout(100);
    const gone = await page.evaluate((victim) => {
      const g = state.groups[0];
      return {has: g.members.includes(victim), n: g.members.length,
        left: [...document.querySelectorAll('.r29-group-event')]
          .some((n) => n.getAttribute('data-r29-kind') === 'left')};
    }, victim);
    check('第二下才请出去，组里多一条「请出了这个组」', !gone.has && gone.n === 3 && gone.left);
    // 首页入口：不从某个助理出发，至少选两位
    await page.evaluate(() => {
      state.r29GroupMembersOpen = false;
      state.r29GroupFocus = '';
      state.mode = 'chat';
      state.detail = false;
      render();
    });
    await page.waitForSelector('[data-r30-new-group]');
    await page.evaluate(() => document.querySelector('[data-r30-new-group]').click());
    await page.waitForSelector('.r30g-sheet');
    await page.evaluate(() => document.querySelectorAll('.r30g-row')[0].click());
    const one = await page.evaluate(() => document.querySelector('[data-r30-go]').disabled);
    await page.evaluate(() => document.querySelectorAll('.r30g-row')[1].click());
    const two = await page.evaluate(() => ({go: document.querySelector('[data-r30-go]').disabled,
      rows: document.querySelectorAll('.r30g-row').length, total: window.__bots.length}));
    check('首页拉群：列出全部助理，至少选两位才能开始', one === true && two.go === false && two.rows === two.total);
    await shot(page, 'g9-home-new.png');
    await page.keyboard.press('Escape');
    check('按 Esc 关面板', await page.evaluate(() => !document.querySelector('.r30g-sheet')));
    check('演示页没有脚本错误', errors.length === 0);
    if (errors.length) console.log(errors.join('\n'));
    console.log('合计通过 ' + checks.length);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(() => resolve()));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
