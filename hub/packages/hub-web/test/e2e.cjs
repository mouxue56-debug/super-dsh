/* 离线 art4 真浏览器回归。只绑定回环，无 DSH/模型连接，无安装。 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

async function startBench() {
  const root = path.resolve(process.env.HUB_TEST_ROOT || path.join(__dirname, '..'));
  const shell = path.resolve(process.env.HUB_TEST_SHELL || path.join(root, 'index.html'));
  const html = (await fs.readFile(shell, 'utf8')).replace(/<\/body>/i, '<script src="/hub-real.js"></script></body>');
  const adapter = await fs.readFile(path.join(root, 'hub-real.js'));
  const { startFakeBff } = await import(pathToFileURL(path.join(__dirname, 'fake-bff.mjs')));
  const fake = await startFakeBff();
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/bff/')) return fake.handler(req, res);
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    if (url.pathname === '/hub-real.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(adapter); return; }
    if (url.pathname.startsWith('/pets/') && !url.pathname.includes('..')) {
      try { const data = await fs.readFile(path.join(root, url.pathname)); res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.json') ? 'application/json' : 'image/webp' }); res.end(data); return; } catch {}
    }
    res.writeHead(404); res.end('离线素材未旁挂');
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
  return { root, fake, server, url: 'http://127.0.0.1:' + server.address().port, close: async () => { for (const s of sockets) s.destroy(); await new Promise(ok => server.close(ok)); await fake.close(); } };
}

async function run() {
  const bench = await startBench();
  if (process.env.HUB_BENCH_ONLY === '1') { console.log('离线试验台 ' + bench.url); return; }
  const { chromium } = require(process.env.HUB_PLAYWRIGHT_CORE || require('os').homedir()+'/node_modules/playwright-core');
  const executablePath = process.env.HUB_CHROMIUM || path.join(require('node:os').homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell');
  const shots = path.join(bench.root, 'shots-F'); await fs.mkdir(shots, { recursive: true });
  let browser;
  const results = [], errors = [];
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    // 网络边界：所有请求只准向本次回环试验台。
    await context.route('**/*', route => {
      const url = route.request().url(); if (url.startsWith(bench.url + '/') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
      return route.abort();
    });
    await page.goto(bench.url); await page.waitForFunction(() => window.HubReal);
    assert.equal(await page.getAttribute('html', 'data-hub-mode'), 'real');
    assert.equal(bench.fake.stats.creates, 0, '打开首页不创建会话');
    await page.waitForFunction(() => Hub.petInfo().active, null, { timeout: 10000 });
    const petStates = [];
    async function bot(id) {
      await page.evaluate(id => Hub.navigate({ view: 'chat', bot: id }), id);
      await page.waitForFunction(id => Hub.state.bot === id && Hub.state.conversation.startsWith('hub-real-'), id);
    }
    async function send(text) { await page.locator('[data-focus="composer"]').fill(text); await page.locator('[data-focus="composer"]').press('Enter'); }
    async function waitState(state) { await page.waitForFunction(state => [...document.querySelectorAll('[data-real-reply]')].at(-1)?.dataset.realState === state, state, { timeout: 45000 }); }
    async function cleanChat() {
      for (const selector of ['.m-persona-today', '.r22-tool-call', '.chat-quick-slot', '.hub-quick', '.composer-area .hub-status', '.composer-area [data-context-mix]', '.thread [data-reply-wait]', '.thread .message-footer .token', '.thread-inner>.time-stamp:not(.hub-real-date)']) {
        assert.equal(await page.locator(selector + ':visible').count(), 0, '真实聊天隐藏 ' + selector);
      }
      const meta = await page.locator('.shell-title-meta').innerText();
      assert(meta.includes('DeepSeek V4.1 Flash')); assert(!/记忆切片|2\.1k/.test(meta));
      assert.equal(await page.locator('.floatinghead .hub-real-sample').count(), 0);
      const visible = await page.locator('.chatview').innerText();
      assert(!/今日摘要|今日卡|工作区候选|本页 bot 草稿|11 月 13 日|整理今天的待办|核对 每日简报交接|86k\/256k|34%|记忆 7|待批 3/.test(visible), visible);
    }
    // 首页只采用 status 的六助理状态，演示 busy 数不进入真实顶栏。
    await page.waitForFunction(() => HubReal.state().online);
    assert.equal(await page.locator('.r22-home-busy:visible').count(), 0);
    bench.fake.statusOverride = { art:{running:true,unread:2}, research:{running:true,unread:1} };
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => document.querySelector('.r22-home-busy')?.textContent === '● 2 在干活');
    for(const id of ['art','research']) {
      assert.equal(await page.getAttribute('[data-bot-tree="'+id+'"]','data-real-busy'),'true');
      assert.equal(await page.locator('[data-bot-tree="'+id+'"] .pin>small').innerText(),'忙碌');
      assert.equal(await page.locator('[data-bot-tree="'+id+'"] .pin .hub-real-busy').count(),0,'卡片副行显示忙碌，避免重叠');
      const host=page.locator('[data-bot-tree="'+id+'"]');
      assert.equal(await host.locator('.r22-unread-dot,.home-assistant-unread').count(),1);
    }
    const dotColor=await page.locator('[data-bot-tree="research"] .home-assistant-unread').evaluate(n=>({actual:getComputedStyle(n).backgroundColor,expected:getComputedStyle(document.documentElement).getPropertyValue('--badge').trim()}));
    await page.screenshot({path:path.join(shots,'home-status-two.png')});
    results.push({check:'新首页采用服务器在跑数与原生未读点',count:2,dotColor});
    bench.fake.statusOverride=null;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => document.querySelector('.r22-home-busy')?.hidden === true);
    await page.locator('.r22-home-dock [data-act="more"]').click();
    assert.equal(await page.locator('.drawer [data-real-mode-entry]').count(),1);
    await page.locator('[data-real-mode-entry]').click();
    assert.equal(await page.locator('[data-hub-mode="demo"]').count(),1);
    await page.evaluate(()=>{Hub.state.drawer=null;window.render();});
    results.push({check:'底栏更多菜单中的连接模式入口',passed:true});
    await bot('chief'); await cleanChat();
    assert.equal(await page.locator('.hub-real-empty').innerText(), '和首席助理说点什么');
    await page.screenshot({ path: path.join(shots, 'empty-chief.png') });
    results.push({ check: '真实新会话空状态与演示区隐藏', passed: true });
    await page.evaluate(() => {
      window.firstSpeaking = null;
      Hub.on('hub-real:state', e => { if (e.bot === 'chief' && e.state === 'speaking' && !window.firstSpeaking) queueMicrotask(() => { window.firstSpeaking = { pet: Hub.petState().actors.chief.state, label: document.querySelector('[data-pet-status]').textContent, text: [...document.querySelectorAll('.hub-real-text')].at(-1).textContent }; }); });
    });
    for (const id of ['chief','support','content','pm','art','research']) {
      await bot(id); await cleanChat();
      if (id === 'chief') {
        bench.fake.tickMs = 15;
        await page.locator('[data-focus="composer"]').fill('你好' + id);
        await page.evaluate(() => { window.sendBlurCount = 0; document.querySelector('[data-focus="composer"]').addEventListener('blur', () => window.sendBlurCount++); });
        const box = await page.locator('.composer-area [data-act="send"]').boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(() => Hub.currentMessages().some(m=>m.role==='user'));
        assert.equal(await page.evaluate(() => window.surfaceTouchActive),false,'触摸结束已到达壳，后续同会话可重绘');
        assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-focus="composer"]')), true);
        assert.equal(await page.evaluate(() => window.sendBlurCount), 0);
        await waitState('done'); bench.fake.tickMs = null;
        assert.equal(bench.fake.stats.messages, 1, '第一次触摸发送一次');
        assert.equal(bench.fake.stats.cancels, 0, '兼容 click 不误点停止');
        results.push({ check: '触摸发送一次成功且保持输入焦点', passed: true });
      } else { await send('你好' + id); await waitState('done'); }
      const text = await page.locator('[data-real-reply]').last().innerText(); assert(text.includes('离线回显（' + id + '）'));
      assert.equal(await page.locator('[data-stream]').count(), 0, '无演示流串入');
      await cleanChat();
      const reply = page.locator('[data-real-reply]').last();
      assert(await reply.evaluate(n => n.classList.contains('bubble')));
      assert.equal(await reply.locator('[data-nameplate-bot="' + id + '"]').innerText(), await page.evaluate(id => Hub.state.bots.find(b => b.id === id).name, id));
      const triangle = await reply.evaluate(n => { const css = getComputedStyle(n, '::after'); return { content: css.content, border: css.borderTopWidth }; });
      assert.equal(triangle.content, '""'); assert.equal(triangle.border, '8px');
      assert.equal(await reply.locator('button[data-real-stop],button[data-act="stop"]').count(), 0);
      assert(!/已保存|回复完成/.test(text));
      const states = await page.evaluate(id => HubReal.state().turns.filter(t => t.bot === id).map(t => t.state), id);
      for (const state of ['thinking','speaking','done']) assert(states.includes(state));
      await page.screenshot({ path: path.join(shots, id + '-done.png') }); results.push({ check: '六助理 ' + id, states });
    }
    const immediate = await page.evaluate(() => window.firstSpeaking);
    assert.equal(immediate.pet, 'working'); assert.equal(immediate.label, '在说'); assert.equal(immediate.text, '', '首个 delta 在 80ms 绘制前已切在说');
    results.push({ check: '首个 delta 先切在说，文字绘制仍节流', observed: immediate });

    // 合成同一触摸的兼容 click：不重发、不误停止；拖出与取消不发送。
    await bot('chief'); await page.locator('[data-focus="composer"]').fill('防重复验证');
    const beforePointer = { messages: bench.fake.stats.messages, cancels: bench.fake.stats.cancels };
    const gesture = await page.evaluate(() => {
      const b = document.querySelector('.composer-area [data-act="send"]'), box = b.getBoundingClientRect();
      const options = { bubbles:true, cancelable:true, pointerId:31, pointerType:'touch', isPrimary:true, button:0, clientX:box.x+box.width/2, clientY:box.y+box.height/2 };
      const down = new PointerEvent('pointerdown',options); b.dispatchEvent(down);
      b.dispatchEvent(new PointerEvent('pointerup',options));
      const click = new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}); b.dispatchEvent(click);
      return { down:down.defaultPrevented, click:click.defaultPrevented };
    });
    assert.deepEqual(gesture, { down:true, click:true });
    await page.waitForFunction(() => Hub.currentMessages().some(m=>m.role==='user'&&Hub.messageText(m)==='防重复验证')); await waitState('done');
    assert.equal(bench.fake.stats.messages, beforePointer.messages+1); assert.equal(bench.fake.stats.cancels, beforePointer.cancels);
    await page.locator('[data-focus="composer"]').fill('取消手势不发送');
    await page.evaluate(() => {
      const b=document.querySelector('.composer-area [data-act="send"]');
      const p={bubbles:true,cancelable:true,pointerId:32,pointerType:'touch',isPrimary:true,button:0,clientX:100,clientY:100};
      b.dispatchEvent(new PointerEvent('pointerdown',p)); b.dispatchEvent(new PointerEvent('pointercancel',p)); b.dispatchEvent(new PointerEvent('pointerup',p));
      b.dispatchEvent(new PointerEvent('pointerdown',{...p,pointerId:33})); b.dispatchEvent(new PointerEvent('pointerup',{...p,pointerId:33,clientX:160}));
    });
    await page.waitForTimeout(100); assert.equal(bench.fake.stats.messages, beforePointer.messages+1);
    await page.locator('[data-focus="composer"]').fill(''); results.push({ check: '兼容 click 防重、取消与拖出不发', passed:true });

    // 服务器预览包含 Markdown 时只展示纯文字。
    await send('**首席助理** · `草稿`'); await waitState('done');
    await page.locator('[data-real-list]').click(); await page.waitForFunction(() => document.querySelector('.hub-real-session small')?.textContent === '离线回显（chief）：首席助理 · 草稿');
    assert.equal(await page.locator('.hub-real-session small').first().innerText(), '离线回显（chief）：首席助理 · 草稿');
    await page.screenshot({ path:path.join(shots,'session-preview.png') });
    await page.locator('[data-real-open]').first().click();
    results.push({ check:'服务器清单预览去掉 Markdown', passed:true });
    await bot('chief'); await send('慢回复停止验证');
    await page.waitForFunction(() => HubReal.state().turns.at(-1)?.state === 'thinking');
    petStates.push(await page.evaluate(() => Hub.petState().actors.chief.state));
    await page.screenshot({ path: path.join(shots, 'thinking.png') }); await waitState('streaming');
    petStates.push(await page.evaluate(() => Hub.petState().actors.chief.state));
    await page.screenshot({ path: path.join(shots, 'speaking.png') });
    assert.equal(await page.locator('[data-real-reply] [data-real-stop]').count(), 0);
    assert.equal(await page.locator('.composer-area [data-act="stop"]:visible').count(), 1);
    await page.locator('.composer-area [data-act="stop"]').click(); await waitState('stopped'); assert.equal(bench.fake.stats.cancels, 1);
    results.push({ check: '停止', passed: true });

    await send('断流恢复验证'); await waitState('done');
    const final = await page.locator('[data-real-reply]').last().locator('.hub-real-text').innerText(); assert.equal(final, '离线回显（chief）：断流恢复验证');
    petStates.push(await page.evaluate(() => Hub.petState().actors.chief.state));
    assert(bench.fake.stats.streams > bench.fake.stats.messages, '断流建立额外订阅，未重发用户消息'); results.push({ check: '断流 state.partial 替换', passed: true });

    await send('出错验证'); await waitState('error');
    petStates.push(await page.evaluate(() => Hub.petState().actors.chief.state));
    await page.screenshot({ path: path.join(shots, 'error.png') }); assert.equal(await page.locator('[data-real-retry]').count(), 1);
    const beforeRetry = bench.fake.stats.messages; await page.locator('[data-real-retry]').click(); await waitState('error'); assert.equal(bench.fake.stats.messages, beforeRetry + 1);
    results.push({ check: '出错与原句重试', passed: true });

    await send('长回复验证');
    await page.evaluate(() => { window.testRenderCount = 0; window.testNode = document.querySelector('[data-focus="composer"]'); Hub.on('render', () => window.testRenderCount++); });
    await waitState('streaming');
    await page.locator('.thread').hover(); await page.mouse.wheel(0, -100000);
    await page.waitForTimeout(60);
    const scrollAfterIntent = await page.evaluate(() => ({ top: document.querySelector('.thread').scrollTop, reading: Hub.reading.state() }));
    await page.waitForTimeout(240);
    const scrollAfterStream = await page.evaluate(() => ({ top: document.querySelector('.thread').scrollTop, reading: Hub.reading.state() }));
    assert(Math.abs(scrollAfterStream.top - scrollAfterIntent.top) <= 4, '主动回看时流式不抢滚动：' + JSON.stringify({ scrollAfterIntent, scrollAfterStream }));
    await waitState('done');
    assert((await page.locator('[data-real-reply]').last().innerText()).length > 5000);
    assert.equal(await page.locator('[data-real-reply]').last().locator('table').count(), 1);
    assert.equal(await page.evaluate(() => document.querySelector('[data-focus="composer"]') === testNode), true, '流式不替换输入区');
    assert.equal(await page.evaluate(() => testRenderCount), 0, '流式无整页重绘');
    await page.screenshot({ path: path.join(shots, 'long-markdown.png') }); results.push({ check: '长回复局部渲染', passed: true });
    assert.deepEqual(petStates, ['thinking','working','done','confused']); results.push({ check: '真实 art4 角色状态', petStates });

    // 新会话只建草稿，发第一句才建服务器会话；设置切换不污染真实消息。
    const createsBeforeDraft = bench.fake.stats.creates;
    await page.locator('[data-real-list]').click(); await page.locator('[data-real-new]').click();
    assert.equal(bench.fake.stats.creates, createsBeforeDraft);
    assert.equal(await page.locator('[data-real-reply]').count(), 0);
    await send('新会话验证'); await waitState('done'); assert.equal(bench.fake.stats.creates, createsBeforeDraft + 1);
    await page.evaluate(() => { Hub.state.settingsTab = 'hub-real-mode'; Hub.openPanel('settings'); });
    await page.locator('[data-hub-mode="demo"]').click(); assert.equal(await page.getAttribute('html','data-hub-mode'), 'demo');
    assert.equal(await page.locator('.m-persona-today:visible').count(), 1, '演示模式保留演示内容');
    await page.evaluate(() => { Hub.state.drawer=null; window.render(); });
    await page.locator('[data-focus="composer"]').fill('演示发送焦点');
    const demoGesture = await page.evaluate(() => {
      const b=document.querySelector('.composer-area [data-act="send"]'), box=b.getBoundingClientRect();
      const p={bubbles:true,cancelable:true,pointerId:34,pointerType:'touch',isPrimary:true,button:0,clientX:box.x+box.width/2,clientY:box.y+box.height/2};
      const e=new PointerEvent('pointerdown',p); b.dispatchEvent(e); b.dispatchEvent(new PointerEvent('pointercancel',p)); return { prevented:e.defaultPrevented, focused:document.activeElement===document.querySelector('[data-focus="composer"]') };
    });
    assert.deepEqual(demoGesture,{ prevented:true,focused:true });
    await page.locator('[data-focus="composer"]').fill('');
    await page.evaluate(() => { Hub.state.settingsTab = 'hub-real-mode'; Hub.openPanel('settings'); });
    await page.locator('[data-hub-mode="real"]').click();
    await page.waitForFunction(() => HubReal.state().mode === 'real' && Hub.currentMessages().some(m => m.parts?.[0]?.data?.text?.includes('新会话验证')));
    await cleanChat();
    results.push({ check: '草稿延迟创建与模式缓冲隔离', passed: true });

    // 后台回复：首页显示忙碌，跑完未读；打开会话清零。
    await send('慢首页忙碌验证'); await waitState('streaming');
    await page.evaluate(() => { Hub.state.detail = false; window.render(); });
    assert.equal(await page.getAttribute('[data-bot-tree="chief"]','data-real-busy'), 'true');
    assert((await page.locator('[data-bot-tree="chief"] .pin>strong').boundingBox()).height >= 15, '忙碌时名字不被挤掉');
    await page.screenshot({ path: path.join(shots, 'home-busy.png') });
    await page.waitForFunction(() => document.querySelector('[data-bot-tree="chief"] .r22-unread-dot,[data-bot-tree="chief"] .bot-unread'), null, { timeout: 14000 });
    assert.equal(await page.locator('[data-bot-tree="chief"] .pin>strong').innerText(),'首席助理');
    assert((await page.locator('[data-bot-tree="chief"] .pin>strong').boundingBox()).height >= 15, '未读时名字不被挤掉');
    assert.equal(await page.locator('[data-bot-tree="chief"] .pin .bot-unread.home-assistant-unread').count(),1,'无分助理时使用壳的角色未读点');
    assert.equal(await page.locator('[data-bot-tree="chief"] .pin .bot-unread').evaluate(n=>getComputedStyle(n).position),'absolute');
    assert.equal(await page.locator('.home-top .hub-real-sample,.compact-bots .hub-real-sample').count(),0);
    const badge = page.locator('.home-recent-list .hub-real-sample').first(); assert(await badge.count());
    const badgeStyle = await badge.evaluate(n=>{ const s=getComputedStyle(n); return { size:parseFloat(s.fontSize), weight:Number(s.fontWeight),border:s.borderTopWidth,background:s.backgroundColor }; });
    assert(badgeStyle.size>=10&&badgeStyle.size<=11); assert.equal(badgeStyle.weight,400); assert.equal(badgeStyle.border,'0px'); assert.equal(badgeStyle.background,'rgba(0, 0, 0, 0)');
    results.push({ check:'首页名字、未读点定位与轻样例角标', observed:badgeStyle });
    await page.screenshot({ path: path.join(shots, 'home-unread.png') });
    await bot('chief'); await page.waitForFunction(() => Hub.state.bots.find(b => b.id === 'chief').unread === 0);
    results.push({ check: '首页忙碌与未读', passed: true });

    // 持续断流最多 30 秒，提示明确且提供重新加载；不重新 POST messages。
    bench.fake.failStreams = true; const sendsBeforeLost = bench.fake.stats.messages;
    await send('持续断流验证'); await waitState('disconnected');
    assert((await page.locator('[data-real-reply]').last().innerText()).includes('回复可能没收全'));
    assert.equal(bench.fake.stats.messages, sendsBeforeLost + 1); bench.fake.failStreams = false;
    await page.locator('[data-real-reload]').last().click();
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-real-reply]')].some(e => e.dataset.realState === 'disconnected'));
    results.push({ check: '持续断线提示与重新加载', passed: true });

    // 发送接纳与停止竞态；后台停轮询、前台按服务器恢复。
    bench.fake.delayAdmission = 300;
    const cancelBefore = bench.fake.stats.cancels;
    await send('慢接纳竞态验证'); await page.waitForTimeout(100); await page.locator('.composer-area [data-act="stop"]').click(); await waitState('stopped');
    assert.equal(bench.fake.stats.cancels, cancelBefore + 1); bench.fake.delayAdmission = 0;
    await send('慢后台恢复验证'); await waitState('streaming');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(700); const requestsWhileHidden = bench.fake.stats.requests.length;
    await page.waitForTimeout(5200); assert.equal(bench.fake.stats.requests.length, requestsWhileHidden, '后台不发轮询请求');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => Hub.currentMessages().some(m => m.parts?.[0]?.data?.text?.includes('慢后台恢复验证')));
    results.push({ check: '停止接纳竞态与后台恢复', passed: true });

    // 在第二个独立存储上下文恢复同一个服务器会话。
    const second = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await second.route('**/*', route => route.request().url().startsWith(bench.url + '/') || route.request().url().startsWith('blob:') ? route.continue() : route.abort());
    const p2 = await second.newPage(); p2.on('pageerror', e => errors.push(e.message)); await p2.goto(bench.url);
    await p2.waitForFunction(()=>window.HubReal?.state().online&&HubReal.state().sessions.length>0);
    await p2.evaluate(() => Hub.navigate({ view: 'chat', bot: 'chief' }));
    await p2.waitForFunction(() => Hub.currentMessages().some(m => m.parts?.[0]?.data?.text?.includes('慢后台恢复验证')));
    assert.equal(await p2.evaluate(() => localStorage.getItem('hub-web-sessions-v1')), null);
    const saved = [...bench.fake.sessions.values()].filter(s=>s.bot==='chief').at(-1);
    saved.history[0].ts=new Date(2026,10,15,9,7).toISOString(); saved.history[1].ts=new Date(2026,10,16,10,8).toISOString();
    await p2.reload(); await p2.waitForFunction(() => window.HubReal?.state().online&&HubReal.state().sessions.length>0);
    await p2.evaluate(() => Hub.navigate({view:'chat',bot:'chief'}));
    await p2.waitForFunction(() => [...document.querySelectorAll('.hub-real-date')].some(n=>n.textContent==='2026年11月15日'));
    const dates=await p2.locator('.hub-real-date').allInnerTexts(); assert(dates.includes('2026年11月16日'));
    assert.equal(await p2.locator('.thread-inner>.time-stamp:not(.hub-real-date):visible').count(),0);
    await p2.screenshot({path:path.join(shots,'history-dates.png')});
    results.push({check:'历史日期按消息 ts 分日显示',dates});
    results.push({ check: '新设备上下文恢复服务器历史', passed: true }); await second.close();

    const touchOnly=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    await touchOnly.addInitScript(()=>{window.PointerEvent=undefined;});
    await touchOnly.route('**/*',r=>r.request().url().startsWith(bench.url+'/')||/^(blob:|data:)/.test(r.request().url())?r.continue():r.abort());
    const p3=await touchOnly.newPage(); p3.on('pageerror',e=>errors.push(e.message));
    await p3.goto(bench.url); await p3.waitForFunction(()=>window.HubReal); await p3.evaluate(()=>Hub.navigate({view:'chat',bot:'chief'}));
    await p3.waitForFunction(()=>Hub.currentMessages().some(m=>m.parts?.[0]?.data?.text?.includes('慢后台恢复验证')));
    const beforeFallback=bench.fake.stats.messages;
    await p3.locator('[data-focus="composer"]').fill('触摸回退验证');
    const fallbackButton=await p3.locator('.composer-area [data-act="send"]').boundingBox();
    await p3.touchscreen.tap(fallbackButton.x+fallbackButton.width/2,fallbackButton.y+fallbackButton.height/2);
    await p3.waitForFunction(()=>[...document.querySelectorAll('[data-real-reply]')].at(-1)?.dataset.realState==='done'&&[...document.querySelectorAll('.hub-real-text')].at(-1)?.textContent.includes('触摸回退验证'));
    assert.equal(bench.fake.stats.messages,beforeFallback+1); assert.equal(await p3.evaluate(()=>document.activeElement===document.querySelector('[data-focus="composer"]')),true);
    results.push({check:'无 PointerEvent 时触摸回退发送一次',passed:true}); await touchOnly.close();

    const demoContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    await demoContext.addInitScript(()=>{try{localStorage.setItem('hub-web-mode-v1','demo');}catch{}});
    await demoContext.route('**/*',r=>r.request().url().startsWith(bench.url+'/')||/^(blob:|data:)/.test(r.request().url())?r.continue():r.abort());
    const pd=await demoContext.newPage();pd.on('pageerror',e=>errors.push(e.message)); await pd.goto(bench.url);await pd.waitForFunction(()=>window.HubReal);await pd.evaluate(()=>Hub.navigate({view:'chat',bot:'chief'}));
    const beforeDemo=bench.fake.stats.requests.length;await pd.locator('[data-focus="composer"]').fill('演示发送焦点');
    const db=await pd.locator('.composer-area [data-act="send"]').boundingBox();await pd.touchscreen.tap(db.x+db.width/2,db.y+db.height/2);
    await pd.waitForFunction(()=>Hub.currentMessages().some(m=>m.role==='user'&&Hub.messageText(m)==='演示发送焦点'));
    assert.equal(await pd.evaluate(()=>Hub.currentMessages().filter(m=>m.role==='user'&&Hub.messageText(m)==='演示发送焦点').length),1);
    assert.equal(await pd.evaluate(()=>window.surfaceTouchActive),false);
    assert.equal(await pd.evaluate(()=>document.activeElement===document.querySelector('[data-focus="composer"]')),true);
    assert.equal(bench.fake.stats.requests.length,beforeDemo);results.push({check:'演示发送键同样保焦点且无 BFF 请求',passed:true});await demoContext.close();

    // 新壳会话菜单进入真实服务器面板，轮询更新当前面板的通用容器。
    await bot('chief');
    await page.locator('[data-act="session-menu"]').click();
    await page.locator('.drawer [data-act="sessions"]').first().click();
    assert.equal(await page.locator('.drawer [data-hub-panel] .hub-real-session').count(), [...bench.fake.sessions.values()].filter(s=>s.bot==='chief').length);
    const listEntry=page.locator('.hub-real-session').first();
    const remoteId=await listEntry.getAttribute('data-real-open');
    const remote=bench.fake.sessions.get(remoteId), previousText=remote.lastText;
    remote.lastText='**面板动态更新** · `草稿`';
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(()=>document.querySelector('.hub-real-session small')?.textContent==='面板动态更新 · 草稿');
    await page.screenshot({path:path.join(shots,'new-session-panel.png')});
    await page.locator('[data-real-open="'+remoteId+'"]').click();
    await page.waitForFunction(()=>Hub.currentMessages().some(m=>m.parts?.[0]?.data?.text));
    remote.lastText=previousText;
    results.push({check:'新会话菜单、动态列表、纯文字预览与打开历史',passed:true});

    // 模拟与 hub-web 反代相同的服务不可用：502，英文原文不能泄漏。
    const downContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    await downContext.route('**/*',r=>r.request().url().startsWith(bench.url+'/')||/^(blob:|data:)/.test(r.request().url())?r.continue():r.abort());
    const down=await downContext.newPage();down.on('pageerror',e=>errors.push(e.message));
    await down.goto(bench.url);await down.waitForFunction(()=>window.HubReal?.state().sessions.length>0);
    await down.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    async function downSend(label, definitelyUnsent=true) {
      await down.locator('[data-focus="composer"]').fill(label);
      const b=await down.locator('.r22-input-row [data-act="send"]').boundingBox();
      await down.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);
      await down.waitForFunction(label=>Hub.currentMessages().some(m=>m.role==='user'&&Hub.messageText(m)===label),label);
      await down.waitForFunction(()=>[...document.querySelectorAll('[data-real-reply]')].at(-1)?.dataset.realState==='error');
      assert.equal(await down.locator('[data-focus="composer"]').inputValue(),'');
      const reply=down.locator('[data-real-reply]').last();
      assert((await reply.innerText()).includes(definitelyUnsent ? '这句没发出去' : '这句可能已经送达'));
      assert.equal(await reply.locator('[data-real-retry]').count(),1);
      assert(!/BFF|unavailable|Failed to fetch/.test(await down.locator('.chatview').innerText()));
      assert.equal(await down.locator('.hub-real-health').innerText(),'未连接');
      assert.equal(await down.evaluate(()=>Hub.petState().actors[Hub.state.bot].state),'confused');
      assert.equal(await down.locator('.r22-pet-status').innerText(),'出错');
      assert.equal(await down.evaluate(()=>document.activeElement===document.querySelector('[data-focus="composer"]')),true);
    }
    async function retryDown(label, userCount=1) {
      const before=bench.fake.stats.messages;bench.fake.available=true;
      await down.locator('[data-real-retry]').last().click();
      await down.waitForFunction(()=>document.querySelector('.hub-real-health')?.textContent==='已连接',null,{timeout:1500});
      await down.waitForFunction(()=>[...document.querySelectorAll('[data-real-reply]')].at(-1)?.dataset.realState==='done');
      assert.equal(bench.fake.stats.messages,before+1);
      assert.equal(await down.evaluate(label=>Hub.currentMessages().filter(m=>m.role==='user'&&Hub.messageText(m)===label).length,label),userCount,'明确未发出的气泡重试不重复；确认未知时保留手动重试记录');
    }
    // 未加载历史：先缓存清单，停服务后才进入聊天。
    bench.fake.available=false;await down.evaluate(()=>Hub.navigate({view:'chat',bot:'chief'}));
    await down.waitForFunction(()=>Hub.currentMessages().some(m=>m.parts?.[0]?.data?.loadError));
    await downSend('离线历史之后发送');
    await down.evaluate(()=>{document.querySelector('.r22-pet-status').textContent='没听懂';});
    await down.waitForFunction(()=>document.querySelector('.r22-pet-status')?.textContent==='出错');
    await down.screenshot({path:path.join(shots,'offline-history-send-error.png')});
    await retryDown('离线历史之后发送');
    await down.screenshot({path:path.join(shots,'offline-retry-done.png')});
    // 已加载历史，但 POST messages 失败。
    bench.fake.available=false;await downSend('离线已有会话发送',false);await retryDown('离线已有会话发送',2);
    // 新草稿 POST sessions 失败。
    await down.locator('[data-real-list]').click();await down.locator('[data-real-new]').click();
    bench.fake.available=false;await downSend('离线新会话发送');await retryDown('离线新会话发送');
    results.push({check:'历史失败、已有会话、新草稿三种断线发送均出气泡和中文重试，成功即更新连接',passed:true});
    await downContext.close();

    // 流式中服务整体断开，自动重订阅只使用 state.partial，不重发提示。
    await send('慢服务断开后恢复');await waitState('streaming');
    const beforeOutage=bench.fake.stats.messages;
    bench.fake.disconnect();
    await page.waitForFunction(()=>[...document.querySelectorAll('.hub-real-status')].at(-1)?.textContent.includes('正在重连'));
    await page.screenshot({path:path.join(shots,'stream-service-down.png')});
    bench.fake.available=true;
    await waitState('done');
    assert.equal(await page.locator('[data-real-reply]').last().locator('.hub-real-text').innerText(),'离线回显（chief）：慢服务断开后恢复');
    assert.equal(bench.fake.stats.messages,beforeOutage);
    results.push({check:'流中服务断开显示提示，恢复 partial 接续且不重发',passed:true});
    // 样例交互期间暂停统计轮询后，完整检查 BFF 请求数不增加。
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(400);
    const before = bench.fake.stats.requests.length;
    await page.evaluate(() => { Hub.navigate({ view: 'capabilities' }); }); await page.waitForTimeout(100);
    assert(await page.locator('.hub-real-sample').count() > 0);
    const phrase = page.locator('[data-capability-phrase]').first(); if (await phrase.count()) await phrase.click();
    await page.waitForTimeout(500);
    for(const view of ['kanban','ledger']) {
      await page.evaluate(view=>Hub.navigate({view}),view);
      assert.equal(await page.locator('#hub-view h1 .hub-real-sample').count(),0,view+' 页面是真数据，标题旁不挂样例');
      assert.equal(await page.locator('.floatinghead .hub-real-sample,.r22-home-dock .hub-real-sample').count(),0);
      await page.screenshot({path:path.join(shots,'sample-'+view+'.png')});
    }
    await page.evaluate(()=>Hub.openPanel('more'));
    await page.locator('.drawer [data-activity-open]').click();
    assert.equal(await page.locator('.drawer .dhead h2 .hub-real-sample').count(),1);
    await page.screenshot({path:path.join(shots,'sample-activity.png')});
    await page.evaluate(()=>{Hub.state.drawer=null;Hub.navigate({view:'capabilities'});});
    assert.equal(bench.fake.stats.requests.length, before, '管家/能力操作零 BFF 请求');
    await page.evaluate(() => { Hub.navigate({ view: 'capabilities' }); });
    const chiefCapability = page.locator('[data-capability-steward="chief"] [data-capability-phrase]').first();
    if (await chiefCapability.count()) { await chiefCapability.click(); await page.waitForTimeout(200); assert.equal(bench.fake.stats.requests.length, before, '六助理名下能力也零 BFF 请求'); }
    let assertion = false; try { await page.evaluate(() => HubReal.sendText('machine-steward', '不可真发')); } catch { assertion = true; } assert(assertion);
    results.push({ check: '样例角标与管家零 BFF 请求', passed: true });
    await page.screenshot({ path: path.join(shots, 'sample-steward.png') });

    assert.equal(errors.length, 0, errors.join('\n'));
    const output = { viewport: '390×844', realModelCalls: 0, pageErrors: errors, results, fakeStats: { creates: bench.fake.stats.creates, messages: bench.fake.stats.messages, streams: bench.fake.stats.streams, cancels: bench.fake.stats.cancels }, states: await page.evaluate(() => HubReal.state().turns) };
    await fs.writeFile(path.join(bench.root, 'f-e2e-results.json'), JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    if (browser) { const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: path.join(shots, 'failure.png') }); console.error(JSON.stringify(await page.evaluate(() => ({ state: window.HubReal?.state(), shell: { bot: window.Hub?.state.bot, conversation: window.Hub?.state.conversation }, messages:window.Hub?.currentMessages().map(m=>({id:m.id,ts:m.ts,text:Hub.messageText(m)})),dom:[...document.querySelectorAll('[data-message-id]')].map(n=>n.dataset.messageId),text: document.body.innerText.slice(-2500) })),null,2)); } }
    console.error(JSON.stringify({pageErrors:errors,fake:[...bench.fake.sessions.values()].map(s=>({id:s.id,bot:s.bot,history:s.history})),requests:bench.fake.stats.requests.slice(-25)},null,2));
    throw error;
  } finally { if (browser) await browser.close(); await bench.close(); }
}
if (require.main === module) run().catch(error => { console.error('失败：' + error.stack); process.exitCode = 1; });
module.exports = { startBench };
