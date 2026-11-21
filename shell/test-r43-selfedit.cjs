// 随机本机端口、内存假后端。所有外部请求拦截，不执行真实重启。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const playwright = require(process.env.PLAYWRIGHT_CORE ||
  path.join(os.homedir(), 'node_modules/playwright-core'));
const chromium = process.env.CHROMIUM || path.join(os.homedir(), 'Library/Caches/ms-playwright',
  'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const dist = path.join(__dirname, 'dist-generic/DSH-Hub.html');
const shots = path.join(__dirname, 'tmp/r43-selfedit');
let passed = 0;
function check(label, value) { assert(value, label); passed += 1; console.log('通过：' + label); }
const initial = () => ({id: 'change-1', restorePointId: 'point-1', bot: 'chief', summary: '今天页更好找',
  createdAt: '2026-11-19T10:30:00+09:00', status: 'stable', fileCount: 2,
  files: [{path: 'js/today.js'}, {path: 'css/today.css'}], canRestore: true});
let change = initial();
let calls = 0;
let requests = 0;
let rejectAction = false;
let failRead = false;
let reads = 0;
let enabled = true;
let empty = false;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/DSH-Hub.html' || pathname === '/') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(fs.readFileSync(dist)); return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (pathname === '/bff/self-edit/log' && req.method === 'GET') {
    reads += 1;
    if (failRead) { res.statusCode = 503; res.end('{}'); return; }
    if (change.status === 'restoring' && reads > 1) change.status = 'restored';
    res.end(JSON.stringify({enabled, changes: empty ? [] : [change], restorePoints: empty ? [] : [
      {id: 'point-unused', bot: 'chief', summary: '早先的还原点', createdAt: '2026-11-18T09:10:00+09:00'},
      {id: 'point-1', bot: 'chief', summary: '对应这次改动'}]}));
    return;
  }
  if (pathname === '/bff/self-edit/restore/point-1' && req.method === 'POST') {
    requests += 1;
    if (rejectAction) {
      res.statusCode = 409;
      res.end(JSON.stringify({error: {message: '另一次退回还在进行，请稍等。'}})); return;
    }
    res.statusCode = 202; res.end(JSON.stringify({pending: true, card: {id: 'restore-approval',
      type: 'approval', bot: 'chief', sessionId: '', status: 'pending', tool: 'self_edit_restore',
      title: '退回这次改动', consequence: '会退回这次改动，并重启界面。',
      rollback: '当前版本会另存还原点，可以再退回。', targets: ['point-1'], targetCount: 1}})); return;
  }
  if (pathname === '/bff/approvals/restore-approval/answer' && req.method === 'POST') {
    calls += 1; change = {...change, id: 'restore-' + calls, status: 'restoring'}; reads = 0;
    res.end(JSON.stringify({ok: true})); return;
  }
  res.statusCode = 404; res.end('{}');
});
function raw(row) {
  return {date: '2026-11-19', waiting: {available: true, waitingAnswer: [], awaitingReview: [], blocked: []},
    approvals: {available: true, cards: [], kbDrafts: []}, selfEdit: {available: true, items: [row]}};
}
async function mount(page, row = change, name = '首席助理') {
  await page.evaluate(([data, nameOf]) => {
    document.getElementById('r43-test-host')?.remove();
    const host = document.createElement('div'); host.id = 'r43-test-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:var(--bg);padding:12px';
    document.getElementById('app').append(host);
    R30LT.mountToday(host, R30LT.normalizeToday(data, [], () => nameOf), {selfEditRequest: window.r43Request});
  }, [raw(row), name]);
}
async function open(browser, origin, width = 390, theme = 'light', demo = false) {
  const context = await browser.newContext({viewport: {width, height: 844}, colorScheme: theme,
    hasTouch: width === 390, isMobile: width === 390});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ['data:', 'blob:'].includes(url.protocol)
      ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', () => errors.push('出现了浏览器弹窗'));
  await page.goto(origin + '/DSH-Hub.html');
  await page.waitForFunction(() => !!window.R30LT && !!window.R43SelfEdit && !!window.Hub);
  await page.evaluate(({theme, real}) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.hubMode = real ? 'real' : 'demo';
    window.r43Request = async (p, options = {}) => {
      const response = await fetch('/bff' + p, {method: options.method || 'GET',
        headers: options.method ? {'Content-Type': 'application/json'} : {},
        body: options.method ? JSON.stringify(options.body || {}) : undefined});
      return {status: response.status, data: await response.json()};
    };
    R43SelfEdit.connect({request: window.r43Request, nameOf: () => '首席助理', openApproval(card) {
      document.getElementById('r43-approval')?.remove();
      const host = document.createElement('div'); host.id = 'r43-approval';
      host.style.cssText = 'position:fixed;inset:0;z-index:100000;background:var(--bg);padding:12px';
      host.append(HubPlainTalk.renderCard(card)); document.getElementById('app').append(host);
      host.onclick = async event => {
        const button = event.target.closest('[data-real-answer]');
        if (!button || button.disabled) return; button.disabled = true;
        if (button.dataset.realAnswer === 'approve') {
          await window.r43Request('/approvals/' + card.id + '/answer', {method: 'POST', body: {decision: 'approve'}});
        }
        host.remove();
      };
    }});
  }, {theme, real: !demo});
  return {page, context, errors};
}
async function settings(page) {
  await page.evaluate(() => {
    document.getElementById('r43-test-host')?.remove(); Hub.openPanel('settings');
  });
  await page.click('[data-act="settings-tab"][data-key="general"]');
  await page.click('[data-hub-setting="r43-selfedit"]');
  await page.waitForSelector('.r43-history');
}
const action = name => '[data-r43-action=' + name + ']';
const card = '.r43-selfedit';
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  fs.mkdirSync(shots, {recursive: true});
  const browser = await playwright.chromium.launch({executablePath: chromium, headless: true});
  try {
    let view = await open(browser, origin), page = view.page;
    await mount(page);
    check('今天页显示助理改了自己的通知', (await page.locator(card).innerText()).includes('助理改了自己'));
    check('显示时间、助理、摘要、文件数与正常结果', (await page.locator(card).innerText())
      .includes('首席助理') && (await page.locator('.r43-files summary').innerText()).includes('2 个') &&
      await page.locator('.r43-status').innerText() === '正常');
    check('通知里没有待批准与发布按钮', await page.locator('[data-r43-action=promote]').count() === 0 &&
      !(await page.locator(card).innerText()).includes('等你点头'));
    check('文件默认折叠', !(await page.locator('.r43-files').getAttribute('open')));
    await page.click('.r43-files summary');
    check('点开列出文件', (await page.locator('.r43-files').innerText()).includes('js/today.js'));
    await page.click(action('restore'));
    await page.waitForSelector('#r43-approval');
    check('请求确认卡后等待主人，尚未退回', requests === 1 && calls === 0);
    check('共用确认卡写清重启与退回办法', (await page.locator('#r43-approval').innerText())
      .includes('重启界面') && (await page.locator('#r43-approval').innerText()).includes('另存还原点'));
    await page.click('#r43-approval [data-real-answer=reject]');
    check('取消确认后没有执行退回', calls === 0);
    change = initial(); await mount(page);
    await page.click(action('restore')); await page.waitForSelector('#r43-approval');
    await page.locator('#r43-approval [data-real-answer=approve]').evaluate(node => { node.click(); node.click(); });
    await page.waitForFunction(() => !document.getElementById('r43-approval'));
    check('双击主人确认只执行一次退回', calls === 1);
    check('批准后产生新退回记录', change.id === 'restore-1');
    change = initial(); rejectAction = true; await mount(page);
    await page.click(action('restore'));
    await page.waitForSelector('.r43-error');
    check('接口失败显示实际原因', (await page.locator('.r43-error').innerText()).includes('另一次退回还在进行'));
    rejectAction = false;
    const bad = '<img src=x onerror="window.r43Bad=1">';
    await mount(page, {...initial(), summary: bad, files: [{path: bad}], reason: bad}, bad);
    check('摘要、助理、文件名和原因全部转义', await page.locator(card + ' img').count() === 0 &&
      await page.evaluate(() => !window.r43Bad));
    await mount(page, {...initial(), status: 'rolled_back'});
    check('自动退回有清楚结果', await page.locator('.r43-status').innerText() === '已自动退回');
    change = {...initial(), status: 'restoring'}; failRead = true; await mount(page, change);
    await page.waitForFunction(() => document.querySelector('.r43-error')?.textContent.includes('重新连接'));
    check('重启断连时继续等待并说明状态', (await page.locator('.r43-error').innerText()).includes('重新连接'));
    failRead = false;
    await page.waitForFunction(() => document.querySelector('.r43-status').textContent === '已退回');
    check('短暂断连后自动恢复读取', await page.locator('.r43-error').count() === 0);
    change = initial();
    await settings(page);
    check('设置正常入口打开改动记录', await page.locator('.r43-history ' + card).count() === 2);
    check('未关联改动的还原点也列出', (await page.locator('.r43-history').innerText()).includes('早先的还原点'));
    check('每条记录都有退回到这里', await page.getByRole('button', {name: '退回到这里', exact: true}).count() === 2);
    for (const obsoleteFlag of [true, false, undefined]) {
      await page.evaluate(flag => {
        window.HubSettings = {get: async () => ({permission: {mode: 'open', fullOpenLikeCreator: flag}})};
        Hub.openPanel('permission');
      }, obsoleteFlag);
      const words = await page.locator('[data-r29-permission=open]').innerText();
      check('旧开关不改变四类固定确认 ' + String(obsoleteFlag), words.includes('仍然先问你') &&
        words.includes('删除') && words.includes('再请你确认一次'));
      await page.evaluate(() => Hub.openPanel('settings'));
    }
    check('手机交互没有脚本错误或浏览器弹窗', view.errors.length === 0);
    await view.context.close();
    for (const width of [390, 1440]) {
      for (const theme of ['light', 'dark']) {
        view = await open(browser, origin, width, theme); page = view.page;
        await settings(page);
        await page.screenshot({path: path.join(shots, width + '-' + theme + '-records.png')});
        await page.locator(action('restore')).first().click();
        await page.waitForSelector('#r43-approval');
        const bounds = await page.locator('#r43-approval [data-real-card]').boundingBox();
        check(width + ' ' + theme + ' 记录不横向溢出', bounds.x >= 0 && bounds.x + bounds.width <= width);
        check(width + ' ' + theme + ' 退回操作至少 44 像素高',
          (await page.locator('#r43-approval [data-real-answer=approve]').boundingBox()).height >= 44);
        await page.screenshot({path: path.join(shots, width + '-' + theme + '.png')});
        check(width + ' ' + theme + ' 没有脚本错误', view.errors.length === 0);
        await view.context.close();
      }
    }
    view = await open(browser, origin, 390, 'light', true); page = view.page;
    await page.evaluate(() => Hub.openPanel('r30l-today')); await page.waitForSelector(card);
    const before = calls;
    check('演示今天页正常入口有一张通知', await page.locator(card).count() === 1);
    await page.click(action('restore')); await page.click(action('confirm'));
    await page.waitForFunction(() => document.querySelector('.r43-status').textContent === '已退回');
    check('演示通知可退回且不发请求', calls === before);
    await settings(page);
    check('演示设置有三条记录', await page.locator(card).count() === 3);
    await page.locator(action('restore')).last().click(); await page.click(action('confirm'));
    await page.waitForFunction(() => [...document.querySelectorAll('.r43-status')]
      .filter(node => node.textContent === '已退回').length === 2);
    check('演示记录退回可点且保留所有记录', calls === before && await page.locator(card).count() === 3);
    check('演示没有脚本错误', view.errors.length === 0);
    await view.context.close();
    empty = true; enabled = false;
    view = await open(browser, origin); page = view.page; await settings(page);
    check('关闭时友好说明', (await page.locator('.r43-history').innerText()).includes('改自己还没开通'));
    await view.context.close();
    const adapter = fs.readFileSync(path.join(__dirname, '../hub/packages/hub-web/hub-real.js'), 'utf8');
    check('真实适配层给通知和设置接同源认证请求', adapter.includes('selfEditRequest: extCall') &&
      adapter.includes('R43SelfEdit?.connect({request: extCall, nameOf: botName, openApproval(card)'));
    console.log('全部通过：' + passed + ' 项');
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
