import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { withThreadApp, skipReason, openBot, goHome, until } from './r43-thread-browser.mjs';

const trashPosts = (mock, path) => mock.state.requests.filter(row => row.method === 'POST' && row.path === path);

async function swipeOpen(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  assert.ok(box, '没有可滑的首页行');
  const y = box.y + Math.min(box.height / 2, 24);
  const x = Math.max(box.x + 36, 28);
  const client = await page.context().newCDPSession(page);
  const move = async (dx) => client.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: x + dx, y, id: 1 }]
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await move(-70);
  await page.waitForTimeout(40);
  await move(-140);
  await page.waitForTimeout(160);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

describe('第43轮删除接入真壳', { concurrency: 1, skip: skipReason() }, () => {
  test('删一条、撤销、停下再删、首页清空和标已读', async () => {
    await withThreadApp({ size: 24 }, async ({ page, mock }) => {
      await openBot(page, 'aa');
      await page.waitForSelector('.thread article.msg[data-r43-kernel]');
      const picked = await page.evaluate(() => {
        const article = [...document.querySelectorAll('.thread article.msg')].at(-1);
        return {
          kernel: article?.dataset.r43Kernel || '',
          session: article?.dataset.session || '',
          domId: article?.dataset.messageId || '',
          text: (article?.innerText || '').replace(/\s+/g, ''),
        };
      });
      assert.ok(picked.kernel, '消息上要有内核编号');
      assert.notEqual(picked.kernel, picked.domId);
      const token = (picked.text.match(/第\d+句/) || [''])[0];
      assert.ok(token, '要能认出这句正文');
      await page.locator('.thread article.msg').last().click({ button: 'right' });
      await page.locator('[data-r43-menu] [role="menuitem"]', { hasText: '删除这一条' }).click();
      await until(page, () => trashPosts(mock, '/trash/messages').length === 1);
      const posted = trashPosts(mock, '/trash/messages')[0];
      assert.equal(posted.body.session, picked.session);
      assert.equal(posted.body.id, picked.kernel);
      await page.waitForFunction(value => !document.querySelector('.thread')?.innerText.includes(value), token);
      await page.locator('[data-r43-undo]').click();
      await until(page, () => mock.state.requests.some(row =>
        /\/trash\/tb_/.test(row.path) && row.path.endsWith('/restore')));
      await page.waitForFunction(value => document.querySelector('.thread')?.innerText.includes(value), token);
      const session = await page.locator('[data-r43-segment]').first().getAttribute('data-r43-segment');
      mock.state.runningSessions.add(session);
      await page.locator('[data-r43-segment="' + session + '"]').click({ button: 'right' });
      await page.locator('[data-r43-menu] [role="menuitem"]', { hasText: '删除这个话题' }).click();
      await page.locator('[data-r43-dialog] button', { hasText: '删除这个话题' }).click();
      await page.locator('[data-r43-dialog]', { hasText: '它还在做事，先停下？' }).waitFor();
      assert.equal(trashPosts(mock, '/trash/segments').at(-1).body.force, undefined);
      await page.locator('[data-r43-dialog] button', { hasText: '先停下再删' }).click();
      await until(page, () => mock.state.stopped.includes(session));
      assert.equal(trashPosts(mock, '/trash/segments').at(-1).body.force, true);
      await page.waitForFunction(id => !document.querySelector('[data-r43-segment="' + id + '"]'), session);
      await goHome(page);
      await page.locator('[data-r43-home-bot="aa"] .conversation').waitFor();
      await swipeOpen(page, '[data-r43-home-bot="aa"] .conversation');
      await page.locator('[data-r43-home-bot="aa"] [data-r43-home-action="read"]').click({ force: true });
      await until(page, () => mock.state.requests.some(row => row.path === '/unread/read'));
      const read = mock.state.requests.find(row => row.path === '/unread/read');
      assert.equal(typeof read.body.conversation, 'string');
      assert.ok(read.body.conversation);
      await swipeOpen(page, '[data-r43-home-bot="aa"] .conversation');
      await page.locator('[data-r43-home-bot="aa"] [data-r43-home-action="delete"]').click({ force: true });
      await page.locator('[data-r43-dialog]', { hasText: '会清掉和它的全部对话，助理本身还在' }).waitFor();
      await page.locator('[data-r43-dialog] button', { hasText: /^删除$/ }).click();
      await until(page, () => trashPosts(mock, '/trash/threads').some(row => row.body.bot === 'aa'));
      assert.equal(await page.locator('[data-bot-tree="aa"]').count(), 1);
    });
  });
});
