import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { withThreadApp, skipReason, until } from './r43-thread-browser.mjs';

describe('第43轮长对话真浏览器性能', { concurrency: 1, skip: skipReason() }, () => {
  for (const size of [1000, 3000, 5000]) {
    test(size + ' 条，首屏、滚动一帧与分页后 DOM 上限', { timeout: 60000 }, async () => {
      await withThreadApp({ size }, async ({ page, mock }) => {
        await page.waitForSelector('[data-real-thread="aa"]');
        await page.evaluate(() => {
          window.r43BenchStart = performance.now();
          document.querySelector('[data-bot-tree="aa"] [data-act="bot"]').click();
        });
        await page.waitForFunction(last => document.querySelector('.thread')?.innerText.includes(last),
          '第' + size + '句');
        const firstPaintMs = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
          resolve(performance.now() - window.r43BenchStart);
        })));
        // 首屏已计时，滚动从手机进入动画结束后开始，避免把路由落底动画当成用户滚动。
        await page.waitForTimeout(350);
        const scroll = await page.evaluate(() => new Promise(resolve => {
          requestAnimationFrame(() => {
            const start = performance.now();
            const thread = document.querySelector('.thread');
            thread.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
            thread.scrollTop = Math.max(100, thread.scrollTop - 120);
            thread.dispatchEvent(new Event('scroll'));
            const workMs = performance.now() - start;
            requestAnimationFrame(() => resolve({ frameMs: performance.now() - start, workMs }));
          });
        }));
        for (let index = 0; index < 9; index += 1) {
          const before = mock.state.requests.filter(r =>
            r.path === '/threads/aa' && r.query.includes('before=')).length;
          const beforeMessages = await page.evaluate(() => Hub.currentMessages().length);
          await page.locator('.thread').evaluate(el => {
            el.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000, bubbles: true }));
            el.scrollTop = 0;
            el.dispatchEvent(new Event('scroll'));
          });
          try {
            await until(page, () => mock.state.requests.filter(r =>
              r.path === '/threads/aa' && r.query.includes('before=')).length > before);
          } catch (error) {
            const position = await page.locator('.thread').evaluate(el => ({
              scrollTop: el.scrollTop, first: el.querySelector('[data-message-id]')?.dataset.messageId,
              topNote: el.querySelector('[data-r43-earlier]')?.textContent,
            }));
            error.message += JSON.stringify({ size, index, before, beforeMessages, position });
            throw error;
          }
          await page.waitForFunction(count => Hub.currentMessages().length > count, beforeMessages);
          await page.evaluate(() => new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
        const count = await page.locator('.thread [data-message-id]').count();
        assert.ok(count <= 300, '连续翻页后气泡数应受限，实际 ' + count);
        await page.locator('.thread').evaluate(el => {
          el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1000, bubbles: true }));
          el.scrollTop = el.scrollHeight;
          el.dispatchEvent(new Event('scroll'));
        });
        await page.waitForFunction(last => document.querySelector('.thread')?.innerText.includes(last),
          '第' + size + '句');
        console.log('R43_FRONTEND_PERF ' + JSON.stringify({
          messages: size, viewport: '390x844', hasTouch: true,
          firstPaintMs: +firstPaintMs.toFixed(2), scrollFrameMs: +scroll.frameMs.toFixed(2),
          scrollWorkMs: +scroll.workMs.toFixed(2), domMessagesAfterNinePages: count,
        }));
      });
    });
  }
});
