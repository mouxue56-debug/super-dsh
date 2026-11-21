// 演示包。只访问随机端口的本机服务，不启动模型。
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
      await page.goto('http://127.0.0.1:' + server.address().port + '/' + demo);
      await page.waitForFunction(() => !!window.R43Thread && !!window.Hub);
      await page.evaluate(() => {
        state.welcomeDismissed = true;
        document.querySelector('[data-r29-welcome]')?.remove();
        Hub.navigate({view: 'chat', bot: 'chief'});
      });
      await page.waitForTimeout(250);
      check(demo + ' 五个聊天话题和四个系统话题', await page.evaluate(() => R43Thread.topics().length === 9));
      check(demo + ' 两个话题隔天接着聊',
        (await page.locator('[data-r43-segment]').allTextContents()).filter(t => t.startsWith('接着聊：')).length === 2);
      check(demo + ' 显示话题内的上下文起点',
        (await page.locator('.r43-context').allTextContents()).some(t => t.includes('先把这周要做')));
      check(demo + ' 系统话题不混进聊天标签',
        await page.locator('[data-r43-topic="demo-chief-board"]').count() === 0);
      const allIds = await page.locator('.thread-inner > .msg').evaluateAll(
        nodes => nodes.map(n => n.dataset.messageId));
      await page.locator('[data-r43-topic="demo-chief-trip"]').click();
      const tripIds = await page.locator('.thread-inner > .msg').evaluateAll(
        nodes => nodes.map(n => n.dataset.messageId));
      check(demo + ' 话题页含隔天续聊的四条消息', tripIds.length === 4 && tripIds.every(id => allIds.includes(id)));
      check(demo + ' 话题页隔离别的话题', await page.locator('[data-message-id="r43-demo-answer"]').count() === 0);
      await page.locator('[data-r43-topic=""]').click();
      check(demo + ' 回到全部恢复原消息', await page.locator('.thread-inner > .msg').count() === allIds.length);
      await page.locator('[data-r43-topics-more]').click();
      check(demo + ' 系统话题在折叠分组', await page.locator('[data-r43-system-topics]').getAttribute('open') === null);
      const deleteButton = page.locator('[data-r43-topic-delete]').first();
      check(demo + ' 删除这个话题可以点', await deleteButton.isEnabled());
      await deleteButton.click();
      check(demo + ' 删除话题先说明能找回',
        (await page.locator('[data-r43-dialog]').innerText()).includes('30 天内能找回'));
      await page.locator('[data-r43-dialog] button').filter({ hasText: '不删了' }).click();
      await page.waitForFunction(() => !document.querySelector('[data-r43-dialog]'));
      await page.locator('[data-r43-system-topics] > summary').click();
      await page.locator('[data-r43-topic-pick="demo-chief-board"]').click();
      check(demo + ' 当前系统话题显示选中标签',
        await page.locator('[data-r43-topic="demo-chief-board"]').getAttribute('aria-pressed') === 'true');
      check(demo + ' 系统话题打开为事件卡', await page.locator('[data-r43-event]').count() === 1 &&
        await page.locator('.thread-inner > .msg').count() === 0);
      await page.locator('[data-r43-topic=""]').click();
      await page.locator('[data-r43-topics-more]').click();
      await page.locator('[data-r43-topic-search]').fill('预算');
      check(demo + ' 全部话题可搜索', await page.locator('[data-r43-topic-item]').count() === 1);
      await page.locator('[data-r43-rename="demo-chief-budget"]').click();
      await page.locator('[data-r43-topic-name]').fill('预算 <img src=x onerror="window.topicXss=true">');
      await page.evaluate(() => render());
      check(demo + ' 话题改名草稿经重画保留',
        (await page.locator('[data-r43-topic-name]').inputValue()).includes('<img'));
      await page.locator('[data-r43-rename-save]').click();
      check(demo + ' 改名保存并转义', (await page.locator('[data-r43-topic-pick="demo-chief-budget"]').innerText())
        .includes('<img') && await page.locator('[data-hub-sheet] img').count() === 0);
      await page.locator('[data-r43-topic-search]').fill('');
      await page.locator('[data-r43-merge="demo-chief-trip"]').click();
      await page.locator('[data-r43-reassign-target]').selectOption('demo-chief-earlier');
      await page.locator('[data-r43-merge-save]').click();
      check(demo + ' 合并留有撤销按钮', await page.locator('[data-r43-unmerge="demo-chief-trip"]').count() === 1);
      await page.locator('[data-r43-topic-pick="demo-chief-earlier"]').click();
      check(demo + ' 合并后八条消息同页', await page.locator('.thread-inner > .msg').count() === 8);
      await page.locator('[data-r43-topics-more]').click();
      await page.locator('[data-r43-unmerge="demo-chief-trip"]').click();
      await page.locator('[data-r43-topic-pick="demo-chief-earlier"]').click();
      check(demo + ' 撤销恢复原话题', await page.locator('.thread-inner > .msg').count() === 4);
      await page.locator('[data-r43-topic-label="r43-demo-user"]').click();
      check(demo + ' 已完成回复显示挪问答', (await page.locator('[data-r43-reassign-submit]').innerText()).includes('这轮问答'));
      await page.locator('[data-r43-reassign-target]').selectOption('demo-chief-meal');
      await page.locator('[data-r43-reassign-submit]').click();
      await page.locator('[data-r43-topic="demo-chief-meal"]').click();
      check(demo + ' 一轮问答整体软归属', await page.locator('[data-message-id="r43-demo-user"]').count() === 1 &&
        await page.locator('[data-message-id="r43-demo-answer"]').count() === 1);
      await page.locator('[data-r43-topic=""]').click();
      await page.evaluate(() => {
        Hub.postMessage(state.conversation, {id: 'topic-send', role: 'user', text: '继续周末出游的安排'});
      });
      check(demo + ' 演示发送自动归类',
        (await page.locator('[data-r43-topic-label="topic-send"]').innerText()).includes('周末出游'));
      await page.evaluate(() => R43Thread.newTopic());
      await page.evaluate(() => Hub.postMessage(state.conversation,
        {id: 'new-topic-send', role: 'user', text: '读书计划'}));
      check(demo + ' 手动新话题优先',
        (await page.locator('[data-r43-topic-label="new-topic-send"]').innerText()).includes('新话题：读书计划'));
      await page.evaluate(() => {
        const msg = state.threads.chief.find(m => m.id === 'new-topic-send');
        Object.assign(msg, {replyState: 'pending', serverId: 'native-message', requestId: 'pending-request'});
        R43Thread.setOptions('chief', {beginReassign: row => { window.reassignOpened = row.id; },
          reassignMessage: payload => { window.reassignedPayload = payload; }});
        render();
      });
      await page.locator('[data-r43-topic-label="new-topic-send"]').click();
      check(demo + ' 等回复时允许改归并通知后端延长等待',
        await page.locator('[data-r43-reassign-submit]').innerText() === '更改归属' &&
        await page.evaluate(() => window.reassignOpened === 'new-topic-send'));
      await page.locator('[data-r43-reassign-target]').selectOption('__new__');
      await page.locator('[data-r43-reassign-name]').fill('重新起的话题');
      await page.evaluate(() => render());
      check(demo + ' 改归选择和新标题经重画保留',
        await page.locator('[data-r43-reassign-target]').inputValue() === '__new__' &&
        await page.locator('[data-r43-reassign-name]').inputValue() === '重新起的话题');
      await page.locator('[data-r43-reassign-submit]').click();
      check(demo + ' 改归回调携带原消息编号和等待请求', await page.evaluate(() =>
        window.reassignedPayload.messageId === 'native-message' &&
        window.reassignedPayload.requestId === 'pending-request' && window.reassignedPayload.round === false));
      check(demo + ' 其实是新话题携带新标题', await page.evaluate(() =>
        window.reassignedPayload.newTopic === true && window.reassignedPayload.title === '重新起的话题'));
      await page.evaluate(() => {
        state.threads.chief.find(m => m.id === 'new-topic-send').replyState = 'running'; render();
      });
      await page.locator('[data-r43-topic-label="new-topic-send"]').click();
      check(demo + ' 已开始回复不会改动正在运行的上下文', await page.locator('[data-r43-reassign-submit]').isDisabled());
      await page.evaluate(() => closePanel());
      await page.waitForFunction(() => !state.drawer);
      for (const width of [390, 1440]) {
        await page.setViewportSize({width, height: 844});
        for (const theme of ['light', 'dark']) {
          await page.evaluate(theme => { state.theme = theme; applyTheme(); render(); }, theme);
          check(demo + ' ' + width + ' ' + theme + ' 无横向溢出', await page.evaluate(() =>
            document.documentElement.scrollWidth <= innerWidth));
          const shotDir = path.join(__dirname, 'tmp/r43-topics-tests/visual');
          fs.mkdirSync(shotDir, {recursive: true});
          await page.screenshot({path: path.join(shotDir, demo + '-' + width + '-' + theme + '.png')});
        }
      }
      check(demo + ' 无脚本异常', errors.length === 0);
      await page.close();
    }
    console.log('第43轮话题壳 ' + checks + ' 项通过');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
