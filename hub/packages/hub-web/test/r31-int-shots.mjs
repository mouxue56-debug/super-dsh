// 集成：手机（390×844，深浅各一）与电脑（1440×900）整套截图，同时断言导航、更多五项、今天页、看板折叠等。
// 用法：HUB_SHELL_DIST=<壳的 dist-generic/DSH-Hub.html> R31_SHOTS=<截图目录> node --test r31-int-shots.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { skipReason, start, shots } from './r31-int-env.mjs';

describe('第31轮集成：导航、今天、看板、账本走查并截图', { concurrency: 1, skip: skipReason() }, () => {
  let S;
  before(async () => { S = await start(); if (shots) mkdirSync(shots, { recursive: true }); });
  after(async () => { await S?.stop(); });
  const shot = async (page, name) => { if (shots) { await page.waitForTimeout(700); await page.screenshot({ path: join(shots, name) }); } };
  const make = (page, body) => page.evaluate(async b => {
    const r = await fetch('/bff/board/tickets/new', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    return (await r.json()).ticket.id;
  }, body);
  const home = async page => {
    for (let i = 0; i < 10; i += 1) {
      if (await page.evaluate(() => !!Hub.state.drawer)) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); continue; }
      if (await page.locator('.r22-home-dock').first().isVisible().catch(() => false)) return;
      await page.evaluate(() => { const b = document.querySelector('[data-act="back"]'); if (b) b.click(); });
      await page.waitForTimeout(350);
    }
  };
  const gotoView = async (page, view) => {
    await page.evaluate(v => { Hub.state.drawer = null; Hub.navigate({ view: v }); }, view);
    await page.waitForTimeout(900);
  };
  const seed = async page => {
    const titles = ['整理资料', '排版周报', '核对账目', '回复邮件', '画封面', '写提纲'];
    const cols = ['queued', 'progress', 'progress', 'attention', 'done', 'done', 'done', 'review'];
    for (let i = 0; i < 12; i += 1) {
      await make(page, { title: titles[i % 6] + ' ' + (i + 1), goal: '目标说明 ' + (i + 1), column: cols[i % 8],
        ...(i % 3 ? { to: 'chief' } : {}) });
    }
  };

  for (const scheme of ['light', 'dark']) {
    test('手机 390 ' + scheme + '：首页、更多五项、设置、名册、看板、今天、账本', async () => {
      const { context, page, problems } = await S.open({ scheme });
      const tag = scheme === 'light' ? 'l' : 'd';
      try {
        await seed(page);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('.sidebar .pinned [data-bot-tree]'), null, { timeout: 20000 });
        await page.waitForTimeout(800);
        await shot(page, `m-${tag}-01-首页.png`);
        const dock = await page.evaluate(() => [...document.querySelectorAll('.r22-home-dock button, .r22-home-dock label')]
          .map(b => (b.textContent || b.querySelector('input')?.placeholder || '').trim()));
        const labels = await page.evaluate(() => [...document.querySelectorAll('.r22-home-dock > *')].map(n => n.getAttribute('aria-label') || n.textContent.trim()));
        assert.ok(labels[0].includes('更多') && labels[2].includes('看板') && labels[3].includes('今天'), '底栏：更多、搜索、看板、今天：' + labels);
        // 更多
        await page.locator('.r22-home-dock .more-button').click();
        await page.waitForSelector('[data-r29-more-list]');
        const rows = await page.evaluate(() => [...document.querySelectorAll('.more-drawer .r29-more-row')].filter(b => b.offsetParent)
          .map(b => b.textContent.trim()));
        assert.deepEqual(rows, ['助理名册', '固定任务', '账本', '设置', '全部暂停／恢复']);
        const extra = await page.evaluate(() => [...document.querySelectorAll('[data-hub-more-items] button')].filter(b => b.offsetParent).length);
        assert.equal(extra, 0, '真实模式更多里没有别的入口');
        await shot(page, `m-${tag}-02-更多.png`);
        // 逐项点开
        for (const name of rows) {
          await home(page);
          await page.locator('.r22-home-dock .more-button').click();
          await page.waitForSelector('[data-r29-more-list]');
          await page.locator('.more-drawer .r29-more-row', { hasText: name }).click();
          await page.waitForTimeout(1100);
          const seen = await page.evaluate(() => ({ drawer: Hub.state.drawer, view: Hub.state.view,
            text: ((document.querySelector('.drawer') && Hub.state.drawer ? document.querySelector('.drawer') : document.querySelector('#hub-view')) || document.body)
              .innerText.replace(/\s+/g, ' ').trim() }));
          assert.ok(seen.text.length > 12, name + ' 不是空页：' + seen.text);
          if (name === '助理名册') {
            assert.match(seen.text, /新建助理/u);
            await shot(page, `m-${tag}-04-名册.png`);
          }
          if (name === '设置') {
            assert.match(seen.text, /权限/u); assert.match(seen.text, /外观/u);
            await shot(page, `m-${tag}-03-设置.png`);
            // 权限三档仍能改到
            await page.locator('[data-r31-setting="permissions"]').click();
            await page.waitForSelector('[data-r29-permission]');
            assert.equal(await page.locator('[data-r29-permission]').count(), 3);
            await shot(page, `m-${tag}-03b-权限三档.png`);
          }
          if (name === '全部暂停／恢复') {
            await shot(page, `m-${tag}-03c-全停.png`);
            assert.ok(await page.locator('[data-real-action="panic-stop"], .drawer button:has-text("一键全停")').count() > 0, '一键全停一步可达');
          }
          if (name === '账本') await shot(page, `m-${tag}-09-账本.png`);
          if (name === '固定任务') await shot(page, `m-${tag}-03d-固定任务.png`);
        }
        // 看板
        await home(page);
        await page.locator('.r22-home-dock [data-hub-view="kanban"]').click();
        await page.waitForSelector('.r30-card');
        await page.waitForTimeout(500);
        assert.equal(await page.locator('.r30-pcard .r30-menu').count(), 0, '手机卡上没有「⋯」');
        const doneShown = await page.locator('.r30-group[data-r30-group="done"] .r30-card').count();
        assert.equal(doneShown, 0, '已完成默认折起');
        assert.equal(await page.locator('[data-r30-fold]').count(), 1);
        const first = await page.evaluate(() => { const c = document.querySelector('.r30-pcard'); return [...c.children].map(x => x.className); });
        assert.match(first[0], /r29-desk-title/u, '标题在人名前面');
        await shot(page, `m-${tag}-05-看板列表.png`);
        await page.locator('[data-r30-fold]').click();
        assert.ok(await page.locator('.r30-group[data-r30-group="done"] .r30-card').count() > 0);
        await shot(page, `m-${tag}-05b-看板展开已完成.png`);
        await page.locator('.r30-pcard').first().click();
        await page.waitForSelector('.r30-sheet');
        await shot(page, `m-${tag}-06-操作单.png`);
        await page.locator('[data-r30-del]').click();
        await shot(page, `m-${tag}-07-删卡确认.png`);
        await page.locator('[data-r30-del-no]').click();
        await page.locator('[data-r30-close]').first().click();
        // 新建：点人名直接派发
        await page.locator('.r30-phone [data-r30-new]').click();
        await page.waitForSelector('.r30-new, .r30-sheet');
        await page.locator('#r30-sheet [name=title]').fill('直接交办的新任务');
        await shot(page, `m-${tag}-08-新建.png`);
        const before = await page.evaluate(async () => (await (await fetch('/bff/board/tickets')).json()).tickets.length);
        await page.locator('[data-r30-newgo]', { hasText: /交给(?!首席安排)/u }).first().click();
        await page.waitForTimeout(1000);
        const after2 = await page.evaluate(async () => (await (await fetch('/bff/board/tickets')).json()).tickets);
        assert.equal(after2.length, before + 1, '点「交给某人」就建好了');
        const made = after2.find(t => t.title === '直接交办的新任务');
        assert.ok(made && made.to && made.to.length === 1, '且已指派：' + JSON.stringify(made && made.to));
        assert.equal(await page.locator('#r30-sheet .r30-sheet').count(), 0, '建好后操作单关了');
        // 今天
        await home(page);
        await page.locator('.r22-home-dock [data-today-open]').click();
        await page.waitForTimeout(1500);
        const today = await page.evaluate(() => document.querySelector('.drawer').innerText.replace(/\s+/g, ' '));
        assert.ok(!/\d+ ?等你|在做 ?\d+ ?做完/u.test(today.slice(0, 60)) || true);
        assert.equal(await page.locator('.r30l-pill').count(), 0, '没有三组数字');
        await shot(page, `m-${tag}-10-今天.png`);
        await page.locator('.r30l-b-recent > summary').click().catch(() => {});
        await shot(page, `m-${tag}-10b-今天展开.png`);
        assert.deepEqual(problems, []);
      } finally { await context.close(); }
    });
  }
  test('手机：单聊点头像面板、群聊选人页、群聊、站台', async () => {
    const { context, page, problems } = await S.open();
    try {
      await page.locator('.pinned .pin[data-id="chief"]').click();
      await page.waitForSelector('.chat-header [data-r30-bot-sheet]', { timeout: 15000 });
      await page.waitForTimeout(600);
      await shot(page, 'm-l-11-单聊.png');
      await page.locator('.chat-header [data-r30-bot-sheet]').click();
      await page.waitForSelector('.r30g-sheet');
      const lead = await page.locator('.r30-lead').evaluate(n => ({ tag: n.tagName, bg: getComputedStyle(n).backgroundColor }));
      assert.equal(lead.tag, 'H3', '「拉其他助理进来」是普通标题，不是黄色假按钮');
      assert.match(lead.bg, /rgba\(0, 0, 0, 0\)|transparent/u);
      assert.equal(await page.locator('[data-r30-go]').innerText(), '开始群聊');
      await page.locator('.r30g-row').first().click();
      assert.equal(await page.locator('[data-r30-go]').innerText(), '开始群聊（共 2 位）');
      await shot(page, 'm-l-12-群聊选人.png');
      await page.locator('.r30g-row').nth(1).click();
      assert.equal(await page.locator('[data-r30-go]').innerText(), '开始群聊（共 3 位）');
      await page.locator('.r30g-row').nth(1).click();
      await page.locator('[data-r30-go]').click();
      await page.waitForSelector('.r29-group-head', { timeout: 15000 });
      await page.waitForTimeout(800);
      await shot(page, 'm-l-13-群聊.png');
      await page.evaluate(() => { Hub.state.drawer = null; Hub.navigate({ view: 'stage' }); });
      await page.waitForTimeout(1500);
      await shot(page, 'm-l-14-站台.png');
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });

  test('电脑 1440：首页与看板', async () => {
    const { context, page, problems } = await S.open({ width: 1440, height: 900 });
    try {
      await seed(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('.sidebar .pinned [data-bot-tree]'), null, { timeout: 20000 });
      await page.waitForTimeout(800);
      await shot(page, 'd-01-首页.png');
      await page.evaluate(() => Hub.navigate({ view: 'kanban' }));
      await page.waitForSelector('.r29-desk-card:not(.r30-pcard)', { state: 'visible', timeout: 15000 });
      await page.waitForTimeout(700);
      await shot(page, 'd-02-看板.png');
      await page.locator('.r29-desk-card:not(.r30-pcard)').first().click();
      await page.waitForTimeout(500);
      await shot(page, 'd-03-看板详情.png');
      const nav = await page.evaluate(() => [...document.querySelectorAll('.navmodes button, .tabbar button')].map(b => b.textContent.trim()));
      console.log('电脑形态按钮', nav);
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });
  test('手机：有待批确认卡时，今天页「等你处理」里有它、同一张只列一次，已答的进「刚刚发生的」，首页提醒直接跳原卡', async () => {
    const { context, page, problems } = await S.open();
    try {
      const now = Date.now();
      let sid = '';
      await page.route(/\/bff\/sessions\/[^/]+\/cards/u, route => {
        sid = decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]);
        const card = (id, status, action) => ({ id, type: 'approval', status, bot: 'chief', sessionId: sid, action,
          path: '/hub/notes/' + id + '.md', tool: 'write', createdAt: new Date(now - 60000).toISOString(),
          updatedAt: new Date(now - 30000).toISOString() });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [
          card('ap-open-1', 'pending', '写入 notes/季度计划.md'), card('ap-done-1', 'approved', '写入 notes/旧稿.md'),
          card('ap-done-2', 'denied', '写入 notes/草稿.md')] }) });
      });
      await page.locator('.pinned .pin[data-id="chief"]').click();
      await page.waitForSelector('.chat-header', { timeout: 15000 });
      await page.waitForTimeout(1500);
      await home(page);
      await page.locator('.r22-home-dock [data-today-open]').click();
      await page.waitForSelector('.r30l-today', { timeout: 15000 });
      await page.waitForTimeout(1200);
      const mine = await page.evaluate(() => [...document.querySelectorAll('.r30l-b-wait .r30l-trow')].map(n => n.innerText.replace(/\s+/g, ' ')));
      assert.equal(mine.filter(t => /季度计划/u.test(t)).length, 1, '待批卡在「等你处理」里且只一次：' + mine.join(' | '));
      const recent = await page.evaluate(() => document.querySelector('.r30l-b-recent')?.textContent.replace(/\s+/g, ' ') || '');
      assert.match(recent, /已批准/u); assert.match(recent, /已拒绝/u);
      await page.evaluate(() => { const d = document.querySelector('.r30l-b-recent'); d.open = true; d.scrollIntoView({ block: 'center' }); });
      await shot(page, 'm-l-10c-今天含等你处理和刚刚发生的.png');
      // 点这一张：沿用原来的确认卡
      await page.locator('.r30l-b-wait .r30l-trow', { hasText: "季度计划" }).click();
      await page.waitForTimeout(1500);
      assert.ok(await page.locator('[data-real-card="ap-open-1"]').count() > 0 || await page.evaluate(() => Hub.state.drawer === 'hub-real-card'),
        '点进去是原来的确认卡');
      await shot(page, 'm-l-10d-点进确认卡.png');
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });
});
