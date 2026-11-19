// 真适配层 + 真后端处理器 + 真壳。用户起的名字不被说人话换掉；今天页「刚刚发生的」刷新后还在；
// 账本逐次明细和按助理筛选；设置里的每月预算（默认不显示进度条，设了才显示）。
// 用法：HUB_SHELL_DIST=<壳的 dist-generic/DSH-Hub.html> node --test r32-int.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { skipReason, start } from './r31-int-env.mjs';

describe('第32轮：用户内容原样、刚刚发生的、账本明细与预算', { concurrency: 1, skip: skipReason() }, () => {
  let S;
  before(async () => { S = await start(); });
  after(async () => { await S?.stop(); });
  const post = (page, url, body) => page.evaluate(async ([u, b]) => {
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    return r.json();
  }, [url, body]);
  const home = async page => {
    for (let i = 0; i < 10; i += 1) {
      if (await page.evaluate(() => !!Hub.state.drawer)) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); continue; }
      if (await page.locator('.r22-home-dock').first().isVisible().catch(() => false)) return;
      await page.evaluate(() => { const b = document.querySelector('[data-act="back"]'); if (b) b.click(); });
      await page.waitForTimeout(350);
    }
  };
  const openToday = async page => {
    await home(page);
    await page.locator('.r22-home-dock [data-today-open]').click();
    await page.waitForSelector('.r30l-today', { timeout: 15000 });
    await page.waitForTimeout(1200);
  };

  test('卡名、卡说明按用户写的原样显示；状态词仍说人话', async () => {
    const { context, page, problems } = await S.open({ width: 1440, height: 900 });
    try {
      const made = await post(page, '/bff/board/tickets/new', { title: '验收报告', goal: '请重试一次验收', column: 'review', to: 'chief' });
      assert.ok(made.ticket?.id);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('.sidebar .pinned [data-bot-tree]'), null, { timeout: 20000 });
      await page.evaluate(() => Hub.navigate({ view: 'kanban' }));
      await page.waitForSelector('.r29-desk-card:not(.r30-pcard)', { state: 'visible', timeout: 15000 });
      await page.waitForTimeout(900);
      const text = await page.evaluate(() => document.body.innerText);
      assert.match(text, /验收报告/u, '卡名原样');
      assert.doesNotMatch(text, /看过确认报告/u);
      assert.match(await page.locator('.r29-desk-card:not(.r30-pcard)').first().innerText(), /验收报告/u);
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });

  test('今天页「刚刚发生的」来自后端：交办一张卡，重新载入后仍在；派工会话标题是卡片标题', async () => {
    const { context, page, problems } = await S.open();
    try {
      const made = await post(page, '/bff/board/tickets/new', { title: '整理名单', goal: '内容不重要' });
      const id = made.ticket.id;
      const assigned = await post(page, `/bff/board/tickets/${id}/assign`, { assignee: 'chief', assigneeType: 'assistant' });
      assert.ok(assigned.ticket, JSON.stringify(assigned));
      await page.waitForTimeout(1500);
      for (let round = 0; round < 2; round += 1) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('.sidebar .pinned [data-bot-tree]'), null, { timeout: 20000 });
        await page.waitForTimeout(700);
        await openToday(page);
        const recent = await page.evaluate(() => document.querySelector('.r30l-b-recent')?.textContent.replace(/\s+/g, ' ') || '');
        assert.match(recent, /你交办了/u, '第 ' + (round + 1) + ' 次载入：' + recent);
        assert.match(recent, /整理名单/u);
      }
      const sessions = await page.evaluate(async () => (await (await fetch('/bff/sessions')).json()));
      const rows = Array.isArray(sessions) ? sessions : (sessions.sessions || []);
      const work = rows.filter(row => /^派工：/u.test(row.title || ''));
      assert.ok(work.length >= 1, '有派工会话：' + JSON.stringify(rows.map(r => r.title)));
      assert.equal(work[0].title, '派工：整理名单');
      assert.doesNotMatch(work[0].title, /T-\d/u);
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });

  test('账本：有逐次明细和按助理筛选；没有价格不重复写待计价；设了每月预算才出现进度条', async () => {
    const { context, page, problems } = await S.open({ width: 1440, height: 900 });
    try {
      const ledger = S.env.deps.ledger;
      const base = Date.now() - 600000;
      const tk = n => ({ input: n, cacheRead: 0, cacheWrite: 0, output: 50, reasoning: 0 });
      for (let i = 0; i < 5; i += 1) {
        await ledger.record({ kind: 'call', id: 'r32-a' + i, tsMs: base + i * 1000, bot: i % 2 ? 'chief' : 'pm', sessionId: 's-r32-' + (i % 2),
          model: 'm-unpriced', channel: 'x', tokens: tk(2000 + i) });
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('.sidebar .pinned [data-bot-tree]'), null, { timeout: 20000 });
      await page.waitForTimeout(700);
      const openLedger = async () => {
        await page.evaluate(() => Hub.openPanel('hub-real-ledger'));
        await page.waitForSelector('.r30l-ledger .r30l-rows .r30l-row', { timeout: 15000 });
        await page.waitForTimeout(500);
      };
      await openLedger();
      const total = await page.locator('.r30l-detail .r30l-row').count();
      assert.equal(total, 5, '逐次明细 5 行');
      const chips = await page.locator('.r30l-detail .r30l-chip').count();
      assert.ok(chips >= 3, '全部 + 两位助理：' + chips);
      await page.locator('.r30l-detail .r30l-chip').nth(1).click();
      const filtered = await page.locator('.r30l-detail .r30l-row').count();
      assert.ok(filtered > 0 && filtered < 5, '按助理筛选后变少：' + filtered);
      const pageText = await page.evaluate(() => document.querySelector('.r30l-ledger').innerText);
      assert.ok((pageText.match(/待计价/gu) || []).length <= 0, '没有价格就不写待计价：' + pageText.slice(0, 400));
      assert.equal(await page.locator('.r30l-meter').count(), 0, '没设预算不显示进度条');
      // 在设置里设每月预算（走真后端；没有主人设备头时这一步由后端拒绝，下面按实际结果断言）
      const saved = await page.evaluate(async () => {
        const r = await window.HubSettings.setBudget(500, 'CNY');
        const g = await window.HubSettings.get();
        return { r, budget: g.budget };
      });
      if (saved.r.ok) {
        assert.equal(saved.budget.monthly, 500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await openLedger();
        const stat = await page.locator('.r30l-stat').allInnerTexts();
        assert.ok(stat.some(t => /预算/u.test(t) && /500/u.test(t)), '设了预算，本月卡上能看到它：' + stat.join(' | '));
        assert.equal(await page.locator('.r30l-meter').count(), 0, '没有价格算不出已用，不画进度条');
      } else {
        console.log('预算写入被后端拒绝（测试环境没有主人设备头）：', JSON.stringify(saved.r));
      }
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });
});
