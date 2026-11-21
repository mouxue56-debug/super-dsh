import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { withThreadApp, skipReason, openBot, goHome, until, badge } from './r43-thread-browser.mjs';

const text = page => page.locator('.thread').innerText();
const threadRequests = mock => mock.state.requests.filter(r => r.path === '/threads/aa');

describe('第43轮，一位助理一条长对话', { concurrency: 1, skip: skipReason() }, () => {
  test('最近按助理聚合，群各一行，点头像打开最新消息', async () => {
    await withThreadApp({}, async ({ page, mock }) => {
      await page.waitForSelector('[data-real-thread="aa"]');
      assert.equal(await page.locator('[data-real-thread="aa"]').count(), 1);
      assert.equal(await page.locator('[data-real-group="g3"]').count(), 1);
      assert.equal(await page.locator('[data-real-open="s-board"]').count(), 0);
      await openBot(page);
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('第120句'));
      assert.doesNotMatch(await text(page), /隐藏原文|例行原文|会议原文/);
      const position = await page.locator('.thread').evaluate(el => ({
        bottom: el.scrollHeight - el.scrollTop - el.clientHeight, touch: navigator.maxTouchPoints,
      }));
      assert.ok(position.bottom < 100, JSON.stringify(position));
      assert.ok(position.touch > 0, '手机上下文有触摸能力');
      assert.equal(threadRequests(mock).filter(r => !r.query.includes('before=')).length, 1);
    });
  });

  test('第一条未读定位，所有段清零，临时失败重试且旧数字不写回', { timeout: 40000 }, async () => {
    await withThreadApp({ unread: true, failRead: 2 }, async ({ page, mock }) => {
      await page.waitForSelector('[data-real-thread="aa"] [data-r29-unread]');
      const initial = await badge(page, '[data-real-thread="aa"]');
      assert.equal(initial, await badge(page, '[data-bot-tree="aa"]'));
      assert.notEqual(initial, '');
      await openBot(page);
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('第12句'));
      await page.waitForSelector('[data-r43-latest]');
      await page.waitForSelector('.r43-highlight');
      assert.match(await page.locator('.r43-highlight').innerText(), /第12句/);
      assert.equal(await page.locator('.r31-more-unread').count(), 0);
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForTimeout(350);
      await page.locator('[data-r43-latest]').click();
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('第120句'));
      await goHome(page);
      assert.equal(await badge(page, '[data-bot-tree="aa"]'), '');
      assert.equal(await badge(page, '[data-real-thread="aa"]'), '');
      await until(page, () => mock.state.cursors['s-old'] === 60 &&
        mock.state.cursors['s-current'] === 120 && mock.state.cursors['s-board'] === 2, 16000);
      assert.equal(mock.state.reads.filter(r => r.status === 503).length, 2);
      assert.equal(await badge(page, '[data-real-thread="aa"]'), '');
    });
  });

  test('往上加载保持已有消息位置，同页无重复，再往前可读到最早', async () => {
    await withThreadApp({}, async ({ page, mock }) => {
      await openBot(page);
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('第120句'));
      await page.waitForTimeout(350);
      const anchor = await page.locator('.thread').evaluate(el => {
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000, bubbles: true }));
        el.scrollTop = 0;
        const row = el.querySelector('[data-message-id]');
        const result = { id: row.dataset.messageId, y: row.getBoundingClientRect().top };
        el.dispatchEvent(new Event('scroll'));
        return result;
      });
      await until(page, () => threadRequests(mock).some(r => r.query.includes('before=')));
      await page.waitForTimeout(500);
      const after = await page.locator('[data-message-id="' + anchor.id + '"]').boundingBox();
      assert.ok(after && Math.abs(after.y - anchor.y) < 8, JSON.stringify({ anchor, after }));
      for (let index = 0; index < 5; index += 1) {
        await page.locator('.thread').evaluate(el => {
          el.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000, bubbles: true }));
          el.scrollTop = 0;
          el.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(300);
      }
      assert.match(await text(page), /第1句/);
      assert.match(await text(page), /没有更早了/);
      const ids = await page.locator('.thread [data-message-id]').evaluateAll(rows =>
        rows.map(row => row.dataset.messageId));
      assert.equal(new Set(ids).size, ids.length, '加载前页不重复堆叠气泡');
    });
  });

  test('话题分隔轻量呈现，事件默认折叠、按需展开并能到看板卡', async () => {
    await withThreadApp({ size: 24, unread: true }, async ({ page, mock }) => {
      await openBot(page);
      await page.waitForSelector('[data-r43-event="s-board"]');
      assert.ok(await page.locator('[data-r43-segment]').count() >= 2);
      assert.doesNotMatch(await text(page), /新话题：新会话/);
      assert.match(await page.locator('[data-r43-event="s-board"]').innerText(), /周末安排/);
      assert.equal(await page.locator('[data-r43-event="s-board"] .r43-unopened').count(), 1);
      assert.doesNotMatch(await text(page), /事件卡里面的交回说明/);
      assert.equal(mock.state.requests.filter(r => r.path.includes('/segment/')).length, 0);
      await page.locator('[data-r43-event="s-board"] [data-r43-event-toggle]').click();
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('事件卡里面的交回说明'));
      assert.ok(mock.state.requests.some(r => r.path === '/threads/aa/segment/s-board'));
      assert.match(await text(page), /活动清单/);
      assert.equal(await page.locator('[data-r43-event="s-board"] .r43-unopened').count(), 0);
      await page.locator('[data-r43-event="s-board"] [data-r43-card]').click();
      await page.waitForSelector('.r30-sheet');
      assert.match(await page.locator('.r30-sheet').innerText(), /周末安排/);
      assert.ok(mock.state.requests.some(r => r.path.includes('/board/tickets')));
    });
  });

  test('多张连续系统事件折叠成组，用户标题安全转义', async () => {
    await withThreadApp({ size: 12 }, async ({ page, mock }) => {
      for (let index = 0; index < 3; index += 1) {
        mock.state.add('s-extra-' + index, 'aa', '安排：<img src=x onerror=window.badTitle=1>', [{
          id: '1', seq: 1, ts: Date.parse('2026-11-19T08:00:01.000Z') + index,
          role: 'assistant', text: '另外一件系统工作',
        }], { purpose: 'board' });
      }
      await openBot(page);
      await page.waitForSelector('[data-r43-event-group]');
      assert.match(await page.locator('[data-r43-event-group]').innerText(), /还有.*件系统安排的事/);
      await page.locator('[data-r43-event-group] summary').click();
      assert.equal(await page.evaluate(() => window.badTitle), undefined);
      assert.equal(await page.locator('.thread img[src="x"]').count(), 0);
    });
  });

  test('从旧消息位置发话仍发当前普通段，流式回复接在线末尾', async () => {
    await withThreadApp({ unread: true }, async ({ page, mock }) => {
      await openBot(page);
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('第12句'));
      await page.locator('[data-focus="composer"]').fill('接着现在的话题说');
      await page.locator('[data-act="send"]').click();
      await until(page, () => mock.state.sent.length === 1);
      assert.equal(mock.state.sent[0].session, 's-current');
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('收到这句新消息'));
      const content = await text(page);
      assert.ok(content.indexOf('接着现在的话题说') < content.lastIndexOf('收到这句新消息'));
      assert.equal(mock.state.created.length, 0);
    });
  });

  test('加号新开话题先显示分隔，首次发送才创建新段', async () => {
    await withThreadApp({ size: 24 }, async ({ page, mock }) => {
      await openBot(page);
      await page.locator('[data-r29-plus]').click();
      await page.locator('[data-r43-new-topic]').click();
      assert.equal(mock.state.created.length, 0);
      assert.match(await text(page), /新话题/);
      await page.locator('[data-focus="composer"]').fill('新的话题第一句');
      await page.locator('[data-act="send"]').click();
      await until(page, () => mock.state.sent.length === 1);
      assert.deepEqual(mock.state.created, ['s-made-1']);
      assert.equal(mock.state.sent[0].session, 's-made-1');
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('收到这句新消息'));
      assert.match(await text(page), /第24句/);
    });
  });

  test('长对话运行中可停止，下一句继续发送到当前段', async () => {
    await withThreadApp({ size: 24, holdStream: true }, async ({ page, mock }) => {
      await openBot(page);
      await page.locator('[data-focus="composer"]').fill('先整理一份安排');
      await page.locator('[data-act="send"]').click();
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('我正在整理这件事'));
      // 原有发送手势会屏蔽 800ms 内同位置的兼容 click，避免误触刚出现的停止键。
      await page.waitForTimeout(850);
      await page.locator('[data-act="stop"]').click();
      await until(page, () => mock.state.stopped.length === 1);
      assert.equal(mock.state.stopped[0], 's-current');
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('已停止'));
      mock.state.holdStream = false;
      await page.locator('[data-focus="composer"]').fill('换个方式再整理');
      await page.locator('[data-act="send"]').click();
      await until(page, () => mock.state.sent.length === 2);
      assert.equal(mock.state.sent[1].session, 's-current');
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('收到这句新消息'));
    });
  });

  test('没有普通段的助理首次发送才创建对话', async () => {
    await withThreadApp({}, async ({ page, mock }) => {
      await page.locator('[data-bot-tree="ac"] [data-act="bot"]').tap();
      await page.waitForSelector('.thread');
      await until(page, () => mock.state.requests.some(r => r.path === '/threads/ac/current'));
      assert.equal(mock.state.created.length, 0);
      await page.locator('[data-focus="composer"]').fill('第一次和你说话');
      await page.locator('[data-act="send"]').click();
      await until(page, () => mock.state.sent.length === 1);
      assert.equal(mock.state.sent[0].session, 's-made-1');
      assert.equal(mock.state.sessions.find(row => row.id === 's-made-1').bot, 'ac');
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('收到这句新消息'));
    });
  });

  test('长对话发送失败可重试同一句，沿用请求标记且用户气泡不重复', async () => {
    await withThreadApp({ size: 24, failSend: 1 }, async ({ page, mock }) => {
      await openBot(page);
      await page.locator('[data-focus="composer"]').fill('这句话只留一次');
      await page.locator('[data-act="send"]').click();
      await page.waitForSelector('[data-real-retry]');
      await page.locator('[data-real-retry]').click();
      await until(page, () => mock.state.sent.length === 2);
      assert.equal(mock.state.sent[0].idem, mock.state.sent[1].idem);
      assert.equal(mock.state.sent[1].session, 's-current');
      await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('收到这句新消息'));
      assert.equal((await text(page)).split('这句话只留一次').length - 1, 1);
    });
  });

  test('旧话题与事件内部的审批卡仍可处理，审批不切离长对话', async () => {
    await withThreadApp({ size: 24, approvals: true }, async ({ page, mock }) => {
      await openBot(page);
      const old = '[data-real-approval="approval-s-old"][data-real-answer="approve"]';
      await page.waitForSelector(old);
      await page.locator(old).click();
      await until(page, () => mock.state.answers.length === 1);
      assert.deepEqual(mock.state.answers[0], { id: 'approval-s-old', decision: 'approve' });
      await page.locator('[data-r43-event="s-board"] [data-r43-event-toggle]').click();
      const board = '[data-real-approval="approval-s-board"][data-real-answer="reject"]';
      await page.waitForSelector(board);
      await page.locator(board).click();
      await until(page, () => mock.state.answers.length === 2);
      assert.deepEqual(mock.state.answers[1], { id: 'approval-s-board', decision: 'reject' });
      assert.equal(await page.locator('[data-r43-event="s-board"]').count(), 1);
      assert.match(await text(page), /第24句/);
    });
  });

  test('录音在等转写时改了当前话题，转写仍送到原段', async () => {
    await withThreadApp({ size: 24, holdVoice: true }, async ({ page, mock }) => {
      await openBot(page);
      await page.locator('[data-r43-event]').waitFor();
      await page.evaluate(() => {
        const audio = new Blob(['synthetic'], { type: 'audio/wav' });
        window.r43VoiceReply = HubVoiceSend(audio, {
          conversation: Hub.state.conversation, bot: 'aa', requestId: 'r43-test-voice', durationMs: 400,
        });
      });
      await until(page, () => typeof mock.state.releaseVoice === 'function');
      await page.locator('[data-r29-plus]').click();
      await page.locator('[data-r43-new-topic]').click();
      assert.match(await text(page), /从这里起是新话题/);
      mock.state.releaseVoice();
      await page.evaluate(() => window.r43VoiceReply);
      await until(page, () => mock.state.sent.length === 1);
      assert.equal(mock.state.sent[0].session, 's-current');
      assert.equal(mock.state.sent[0].text, '录音转写留在开口时的话题');
      assert.equal(mock.state.created.length, 0);
    });
  });

  test('底部搜索命中旧段，点击按 around 定位并短暂高亮', async () => {
    await withThreadApp({}, async ({ page, mock }) => {
      await page.locator('#botsearch').fill('星期三');
      await page.waitForSelector('[data-real-thread-result]');
      assert.match(await page.locator('[data-real-thread-result]').first().innerText(), /星期三/);
      await page.locator('[data-real-thread-result]').first().click();
      await page.waitForSelector('.r43-highlight');
      assert.match(await page.locator('.r43-highlight').innerText(), /星期三/);
      assert.ok(threadRequests(mock).some(r => r.query.includes('around=')));
      await page.waitForFunction(() => {
        const el = document.querySelector('.r43-highlight');
        if (!el) return false;
        const a = el.getBoundingClientRect();
        const b = el.closest('.thread').getBoundingClientRect();
        return a.bottom > b.top && a.top < b.bottom;
      });
    });
  });

  test('搜索事件内部消息，自动展开所在事件并高亮', async () => {
    await withThreadApp({}, async ({ page, mock }) => {
      await page.locator('#botsearch').fill('交回说明');
      await page.waitForSelector('[data-real-thread-result]');
      await page.locator('[data-real-thread-result]').first().click();
      await page.waitForSelector('[data-r43-event-body] .r43-highlight');
      assert.match(await page.locator('.r43-highlight').innerText(), /交回说明/);
      assert.ok(mock.state.requests.some(r => r.path.endsWith('/segment/s-board') && r.query.includes('around=')));
    });
  });

  test('旧后端没有长对话接口仍能打开和发送', async () => {
    await withThreadApp({ legacy: true, size: 24 }, async ({ page, mock }) => {
      await page.waitForSelector('[data-real-open="s-current"]');
      await page.locator('[data-real-open="s-current"]').click();
      await page.waitForSelector('.thread [data-message-id]');
      assert.match(await text(page), /第24句/);
      await page.locator('[data-focus="composer"]').fill('老后端继续说');
      await page.locator('[data-act="send"]').click();
      await until(page, () => mock.state.sent.length === 1);
      assert.equal(mock.state.sent[0].session, 's-current');
    });
  });

  test('群聊仍独立接话、轮询与清未读', async () => {
    await withThreadApp({}, async ({ page, mock }) => {
      await page.locator('[data-real-group="g3"]').click();
      await page.waitForSelector('[data-r29-group-thread="g3"]');
      await page.locator('[data-focus="composer"]').fill('周末一起安排');
      await page.locator('[data-act="send"]').click();
      await page.waitForFunction(() => document.querySelector('[data-r29-group-thread]')?.innerText
        .includes('乙在群里接话'), null, { timeout: 12000 });
      assert.equal(mock.state.sent.length, 0, '群消息没有发送到个人段');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await until(page, () => mock.state.groupCursor === 3);
    });
  });

  test('1440 宽与 390 宽深浅色的输入区、事件卡均在视口内', async () => {
    const displays = [
      { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
      { viewport: { width: 390, height: 844 }, colorScheme: 'light' },
      { viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
    ];
    for (const { viewport, colorScheme } of displays) {
      const captureName = viewport.width + '-' + colorScheme;
      await withThreadApp({ viewport, colorScheme, captureName, size: 24 },
        async ({ page }) => {
          await openBot(page);
          assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), colorScheme);
          await page.waitForSelector('[data-r43-event]');
          await page.locator('[data-r43-event-toggle]').click();
          await page.waitForFunction(() => document.querySelector('.thread')?.innerText.includes('事件卡里面的交回说明'));
          await page.locator('[data-r43-event]').scrollIntoViewIfNeeded();
          const bounds = await page.locator('[data-focus="composer"]').boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 2);
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 2);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
        });
    }
  });
});
