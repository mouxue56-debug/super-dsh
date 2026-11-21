// 演示包：长按、左滑、确认、撤销、最近删除。只访问随机端口，不启动模型。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const home = os.homedir();
const {chromium} = require(process.env.PLAYWRIGHT_CORE ||
  path.join(home, 'node_modules/playwright-core'));
const executablePath = process.env.CHROMIUM || path.join(home, 'Library/Caches/ms-playwright',
  'chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell');
let checks = 0;
function check(label, value) { assert(value, label); checks++; console.log('通过 ' + label); }

async function hold(page, locator) {
  const box = await locator.boundingBox();
  assert(box, '没有可按住的位置');
  await page.mouse.move(box.x + Math.min(24, box.width / 2), box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(560);
  await page.mouse.up();
}

async function swipe(page, selector, dx, edge) {
  if (!selector) {
    const marked = await page.evaluate(() => {
      document.querySelector('[data-r43-swipe-target]')?.removeAttribute('data-r43-swipe-target');
      const thread = document.querySelector('.thread');
      if (!thread) return false;
      const visible = element => {
        const box = thread.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return rect.bottom > box.top + 8 && rect.top < box.bottom - 8 && rect.height > 30;
      };
      const articles = [...thread.querySelectorAll('article.msg')];
      let article = articles.find(element => visible(element) && element.getBoundingClientRect().left < 24) ||
        articles.find(visible);
      if (!article) {
        const parked = [...articles].reverse().find(element => element.getBoundingClientRect().height > 30);
        if (!parked) return false;
        const box = thread.getBoundingClientRect();
        const rect = parked.getBoundingClientRect();
        thread.scrollTop += rect.top - (box.top + 80);
        article = articles.find(element => visible(element) && element.getBoundingClientRect().left < 24) ||
          articles.find(visible);
      }
      if (!article) return false;
      article.setAttribute('data-r43-swipe-target', '1');
      return true;
    });
    assert(marked, '视口里没有可滑的消息');
    selector = '[data-r43-swipe-target]';
  }
  const box = await page.locator(selector).first().boundingBox();
  assert(box && box.y >= 0 && box.y < 900, '滑动目标不在视口里 ' + selector);
  const y = box.y + Math.min(box.height / 2, 24);
  const x = edge ? box.x + 2 : Math.max(box.x + 36, 28);
  if (edge) assert(x < 24, '左缘起点不在 24 像素内');
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y, id: 1}]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx / 2, y, id: 1}]});
  await page.waitForTimeout(40);
  await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + dx, y, id: 1}]});
  // 停一下再松手，避免被当成快速甩动而直接归档。
  await page.waitForTimeout(160);
  await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await client.detach();
  return {ok: true, x, open: await page.locator('[data-r43-swipe-delete]').count() > 0};
}

(async function () {
  const server = http.createServer((req, res) => {
    const file = path.join(__dirname, req.url === '/will' ? 'dist/DSH-Hub.html' : 'dist-generic/DSH-Hub.html');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath, headless: true});
  try {
    for (const demo of ['generic']) {
      const page = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => { errors.push('dialog:' + dialog.type()); dialog.dismiss(); });
      await page.addInitScript(() => {
        window.alert = () => { throw new Error('不该弹出 alert'); };
        window.confirm = () => { throw new Error('不该弹出 confirm'); };
        window.prompt = () => { throw new Error('不该弹出 prompt'); };
      });
      await page.goto('http://127.0.0.1:' + server.address().port + '/' + demo);
      await page.waitForFunction(() => !!window.R43Delete && !!window.Hub);
      await page.evaluate(() => {
        state.welcomeDismissed = true;
        document.querySelector('[data-r29-welcome]')?.remove();
        Hub.navigate({view: 'chat', bot: 'chief'});
      });
      await page.waitForSelector('[data-message-id="r43-demo-answer"]');
      const message = page.locator('[data-message-id="r43-demo-answer"]');
      await message.scrollIntoViewIfNeeded();
      await hold(page, message);
      check(demo + ' 长按出现复制和删除', (await page.locator('[data-r43-menu]').innerText()).includes('复制') &&
        (await page.locator('[data-r43-menu]').innerText()).includes('删除这一条'));
      await page.keyboard.press('Escape');
      check(demo + ' Esc 关掉菜单', await page.locator('[data-r43-menu]').count() === 0);
      await message.click({button: 'right'});
      await page.locator('[data-r43-menu] [role="menuitem"]', {hasText: '复制'}).click();
      await page.waitForFunction(() => /已复制|请长按选中复制/.test(document.getElementById('toast')?.textContent || ''));
      check(demo + ' 复制有反馈', true);
      await message.click({button: 'right'});
      const before = await page.evaluate(() => {
        const thread = document.querySelector('.thread');
        const room = Math.max(0, thread.scrollHeight - thread.clientHeight);
        if (room > 40) thread.scrollTop = Math.min(180, room);
        return {top: thread.scrollTop, mode: state.mode, detail: state.detail, conv: state.conversation, bot: state.bot};
      });
      await page.locator('[data-r43-menu] [role="menuitem"]', {hasText: '删除这一条'}).click();
      await page.waitForFunction(() => !document.querySelector('[data-message-id="r43-demo-answer"]'));
      const after = await page.evaluate(() => ({
        top: document.querySelector('.thread')?.scrollTop, mode: state.mode, detail: state.detail,
        conv: state.conversation, bot: state.bot, toast: document.getElementById('toast')?.textContent || ''
      }));
      check(demo + ' 删一条不离开对话', after.mode === before.mode && after.detail === before.detail &&
        after.conv === before.conv && after.bot === before.bot);
      check(demo + ' 删除后滚动还在附近', Math.abs((after.top || 0) - before.top) < 240);
      check(demo + ' 轻提示可撤销', after.toast.includes('已删除') && await page.locator('[data-r43-undo]').count() === 1);
      await page.locator('[data-r43-undo]').click();
      await page.waitForSelector('[data-message-id="r43-demo-answer"]');
      check(demo + ' 撤销后消息回来', true);
      await page.evaluate(() => {
        const thread = document.querySelector('.thread');
        const articles = [...thread.querySelectorAll('article.msg')];
        const parked = [...articles].reverse().find(element => element.getBoundingClientRect().height > 30);
        if (!parked) return;
        const box = thread.getBoundingClientRect();
        const rect = parked.getBoundingClientRect();
        thread.scrollTop += rect.top - (box.top + 80);
      });
      await page.waitForTimeout(150);
      const left = await swipe(page, null, -90, false);
      check(demo + ' 左滑露出删除', left.open === true);
      await page.keyboard.press('Escape');
      const edge = await swipe(page, null, -90, true);
      check(demo + ' 左缘滑动不触发删除', edge.open === false && edge.x < 24);
      const right = await swipe(page, null, 90, false);
      check(demo + ' 右滑没有删除', right.open === false);
      await page.evaluate(() => {
        if (!state.detail) Hub.navigate({view: 'chat', bot: 'chief'});
      });
      await page.waitForSelector('.thread [data-r43-segment]', {state: 'visible'});
      const segment = page.locator('[data-r43-segment="demo-chief-meal"]');
      await segment.scrollIntoViewIfNeeded();
      await segment.click({button: 'right'});
      await page.locator('[data-r43-menu] [role="menuitem"]', {hasText: '删除这个话题'}).click();
      const topicBody = await page.locator('[data-r43-dialog]').innerText();
      check(demo + ' 话题确认写明可以找回', topicBody.includes('这个话题里的消息会进最近删除，30 天内能找回'));
      await page.locator('[data-r43-dialog] button', {hasText: '删除这个话题'}).click();
      await page.waitForFunction(() => !document.querySelector('[data-r43-segment="demo-chief-meal"]'));
      check(demo + ' 话题删掉后分隔线消失', true);
      const card = page.locator('[data-r43-event="demo-chief-board"]');
      await card.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const row = state.threads.chief.find(item => item.kind === 'segment' && item.session === 'demo-chief-board');
        row.state = 'running';
      });
      await card.click({button: 'right'});
      await page.locator('[data-r43-menu] [role="menuitem"]', {hasText: '删除这一段'}).click();
      const running = await page.locator('[data-r43-dialog]').innerText();
      check(demo + ' 正在做的段先问停不停', running.includes('它还在做事，先停下？') &&
        running.includes('先停下再删') && running.includes('不删了'));
      await page.locator('[data-r43-dialog] button', {hasText: '不删了'}).click();
      check(demo + ' 不删了就留着', await page.locator('[data-r43-event="demo-chief-board"]').count() === 1);
      await card.click({button: 'right'});
      await page.locator('[data-r43-menu] [role="menuitem"]', {hasText: '删除这一段'}).click();
      await page.locator('[data-r43-dialog] button', {hasText: '先停下再删'}).click();
      await page.waitForFunction(() => !document.querySelector('[data-r43-event="demo-chief-board"]'));
      check(demo + ' 先停下再删会去掉这一段', true);
      await page.keyboard.press('Escape');
      const segmentBox = page.locator('[data-r43-segment]').first();
      await segmentBox.focus();
      await page.keyboard.press('Enter');
      check(demo + ' 回车打开话题菜单', await page.locator('[data-r43-menu]').count() === 1);
      await page.keyboard.press('Escape');
      const wide = await page.evaluate(() => {
        state.theme = 'dark'; applyTheme(); render();
        return document.documentElement.scrollWidth <= window.innerWidth + 1 &&
          document.documentElement.dataset.theme === 'dark';
      });
      await page.setViewportSize({width: 1440, height: 900});
      await page.waitForTimeout(200);
      const desk = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      check(demo + ' 深色和宽屏不横向溢出', wide && desk);
      await page.setViewportSize({width: 390, height: 844});
      await page.evaluate(() => { state.theme = 'light'; applyTheme(); state.detail = false; state.drawer = null; render(); });
      await page.waitForSelector('.home-recent-list [data-r22-row="chief"] [data-r43-home-action="delete"]');
      const home = await page.evaluate(() => {
        const chief = document.querySelector('.home-recent-list [data-r22-row="chief"]');
        const fixed = [...document.querySelectorAll('.home-recent-list .r22-swipe-row')]
          .filter(row => row.querySelector('[data-fixed-task-open]'));
        const groups = [...document.querySelectorAll('.home-recent-list .r22-swipe-row')]
          .filter(row => row.querySelector('[data-r29-group-open]'));
        return {
          read: !!chief.querySelector('[data-r43-home-action="read"]'),
          del: !!chief.querySelector('[data-r43-home-action="delete"]'),
          pin: !!chief.querySelector('[data-r22-row-action="pin"]'),
          fixedPin: fixed.every(row => row.querySelector('[data-r22-row-action="pin"]') &&
            !row.querySelector('[data-r43-home-action]')),
          groupPin: groups.every(row => !row.querySelector('[data-r43-home-action]'))
        };
      });
      check(demo + ' 首页助理行是删除和标已读', home.read && home.del && !home.pin && home.fixedPin && home.groupPin);
      const revealed = await swipe(page, '.home-recent-list [data-r22-row="chief"] .conversation', -140, false);
      const opened = await page.evaluate(() => {
        const row = document.querySelector('.home-recent-list [data-r22-row="chief"]');
        return row?.dataset.r22Open === 'true' || row?.classList.contains('r22-row-complete');
      });
      check(demo + ' 首页左滑露出操作', revealed.ok === true && opened);
      await page.locator('.home-recent-list [data-r22-row="chief"] [data-r43-home-action="read"]').click({force: true});
      await page.waitForFunction(() => (document.getElementById('toast')?.textContent || '').includes('已标为已读'));
      check(demo + ' 标已读有反馈', true);
      // 标已读会重画首页，行收回去，要再滑一次才能点删除。
      await swipe(page, '.home-recent-list [data-r22-row="chief"] .conversation', -140, false);
      await page.locator('.home-recent-list [data-r22-row="chief"] [data-r43-home-action="delete"]').click({force: true});
      const clearBody = await page.locator('[data-r43-dialog]').innerText();
      check(demo + ' 清空对话先说明助理还在', clearBody.includes('会清掉和它的全部对话，助理本身还在'));
      await page.locator('[data-r43-dialog] button', {hasText: /^删除$/}).click();
      await page.waitForFunction(() => (state.threads.chief || []).length === 0 && !!botBy('chief'));
      check(demo + ' 对话清掉了，助理还在', true);
      await page.evaluate(() => { state.settingsTab = 'r43-trash'; openPanel('settings'); });
      await page.waitForSelector('[data-r43-trash-item]');
      const trash = await page.locator('[data-r43-trash]').innerText();
      check(demo + ' 最近删除有种子和页脚', trash.includes('演示 · 一条旧消息') &&
        trash.includes('超过 30 天的不再显示在这里，但内容没有被物理删除'));
      const beforeCount = await page.locator('[data-r43-trash-item]').count();
      await page.locator('[data-r43-trash-item] button', {hasText: '恢复'}).first().click();
      await page.waitForFunction(count => document.querySelectorAll('[data-r43-trash-item]').length < count, beforeCount);
      while (await page.locator('[data-r43-trash-item] button', {hasText: '恢复'}).count()) {
        await page.locator('[data-r43-trash-item] button', {hasText: '恢复'}).first().click();
        await page.waitForTimeout(50);
      }
      await page.waitForFunction(() => (document.querySelector('[data-r43-trash]')?.innerText || '')
        .includes('最近 30 天没有删除过东西'));
      check(demo + ' 全部恢复后是空状态', true);
      const phone = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      check(demo + ' 手机宽度不横向溢出', phone);
      check(demo + ' 无脚本异常', errors.length === 0);
      await page.close();
    }
    console.log('第43轮删除界面 ' + checks + ' 项通过');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
