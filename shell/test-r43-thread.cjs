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
      check(demo + ' 两段普通聊天连在一起', await page.locator('[data-r43-segment]').count() >= 2);
      const eventLabels = await page.locator('[data-r43-event]').allTextContents();
      check(demo + ' 事件卡显示另开一段会话', eventLabels.some(text => text.includes('另开一段会话')));
      check(demo + ' 事件卡显示分身记录', eventLabels.some(text => text.includes('分身记录') && text.includes('用了 3 个分身')));
      check(demo + ' 事件卡显示文件来源', eventLabels.some(text => text.includes('来自文件')));
      check(demo + ' 早先聊天仍在', await page.locator('[data-message-id="r43-demo-answer"]').count() === 1);
      check(demo + ' 事件默认折叠', await page.locator('[data-r43-event-body]').count() === 0);
      await page.locator('[data-r43-event-toggle="demo-chief-board"]').click();
      check(demo + ' 展开沿用消息气泡', await page.locator('.r43-event-body .msg').count() === 1);
      check(demo + ' 事件文字缩小一档',
        await page.locator('.r43-event-body .bubble p').evaluate(node => getComputedStyle(node).fontSize) === '13px');
      await page.locator('.r43-event-body .msg').first().click({button: 'right'});
      // 右键改为页内删除菜单（复制 / 删除这一条），不再打开原来的消息操作抽屉。
      check(demo + ' 事件子消息更多菜单可打开', await page.locator('[data-r43-menu]').count() === 1 &&
        (await page.locator('[data-r43-menu]').innerText()).includes('删除这一条'));
      // 页内菜单不是抽屉。closePanel 在手机宽度会退回首页，这里用 Esc 关掉菜单。
      await page.locator('[data-r43-menu] button').first().press('Escape');
      await page.waitForFunction(() => !document.querySelector('[data-r43-menu]'));
      await page.evaluate(() => Hub.quoteMessage('r43-demo-event-answer'));
      check(demo + ' 事件子消息可按编号引用',
        (await page.locator('.m-interact-previewtext').allTextContents()).some(text => text.includes('资料已经整理好')));
      await page.keyboard.press('Escape');
      await page.evaluate(() => { state.input = ''; render(); });
      await page.waitForTimeout(350);
      await page.locator('[data-r43-event-toggle="demo-chief-board"]').click();
      check(demo + ' 可以再折起', await page.locator('[data-r43-event-body]').count() === 0);
      await page.locator('[data-r29-plus]').click();
      await page.locator('[data-r43-new-topic]').click();
      check(demo + ' 新话题保留此前聊天', await page.locator('[data-message-id="r43-demo-answer"]').count() === 1);
      check(demo + ' 新话题说明包含记忆', (await page.locator('[data-r43-segment]').last().innerText()).includes('已保存的记忆'));
      await page.evaluate(() => Hub.postMessage(state.conversation, {id: 'r43-sent', role: 'user', text: '新话题内容'}));
      check(demo + ' 发话接在线末尾', await page.evaluate(() => Hub.currentMessages().at(-1).id === 'r43-sent'));
      await page.evaluate(() => R43Thread.locate('r43-demo-answer'));
      check(demo + ' 定位高亮', await page.locator('[data-message-id="r43-demo-answer"].r43-highlight').count() === 1);
      await page.evaluate(() => render());
      check(demo + ' 重画保留高亮', await page.locator('[data-message-id="r43-demo-answer"].r43-highlight').count() === 1);
      await page.evaluate(() => { state.detail = false; state.search = '资料已经整理好'; render(); });
      await page.locator('[data-r43-search-hit="r43-demo-event-answer"]').click();
      check(demo + ' 搜索可找到折叠事件里的话',
        await page.locator('[data-message-id="r43-demo-event-answer"].r43-highlight').count() === 1);
      await page.evaluate(async () => {
        R43Thread.setOptions('chief', {loadSegment: async (_session, request) => ({
          items: [{id: request.before ? 'event-earlier' : 'event-later', role: 'bot',
            text: request.before ? '事件前半段' : '事件后半段'}],
          nextBefore: request.before ? null : 'older'
        })});
        await R43Thread.openEvent('demo-chief-board', {limit: 100});
      });
      await page.locator('[data-r43-event-earlier]').click();
      check(demo + ' 事件可翻到更早', await page.locator('[data-message-id="event-earlier"]').count() === 1);
      await page.locator('[data-r43-event-newer]').click();
      check(demo + ' 事件可返回后面的消息', await page.locator('[data-message-id="event-later"]').count() === 1);
      await page.evaluate(() => {
        const rows = state.threads.chief;
        rows.push({kind: 'segment', session: 'xss-demo', id: 'xss-demo', purpose: 'board',
          title: '派工：<img src=x onerror="window.r43Injected=true">', state: 'done', items: []});
        render();
      });
      check(demo + ' 标题转义', await page.locator('[data-r43-event="xss-demo"] img').count() === 0);
      check(demo + ' 标题无脚本执行', !(await page.evaluate(() => window.r43Injected)));
      await page.evaluate(() => {
        state.threads.chief.push({kind: 'segment', session: 'grouped-demo', id: 'grouped-demo',
          purpose: 'board', title: '安排：第二件事', state: 'done', items: []});
        render();
      });
      check(demo + ' 连续事件合成折叠组', await page.locator('[data-r43-event-group]').count() === 1);
      await page.locator('[data-r43-event-group] > summary').click();
      check(demo + ' 连续事件可展开', await page.locator('[data-r43-event-group]').getAttribute('open') !== null);
      await page.setViewportSize({width: 1440, height: 900});
      await page.emulateMedia({colorScheme: 'dark'});
      check(demo + ' 电脑暗色没有横向溢出', await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth));
      check(demo + ' 无脚本异常', errors.length === 0);
      await page.close();
    }
    console.log('第43轮壳 ' + checks + ' 项通过');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
