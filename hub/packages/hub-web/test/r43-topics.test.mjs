import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goHome, openBot, skipReason, until, withThreadApp } from './r43-thread-browser.mjs';

const skip = skipReason();
const line = page => page.locator('.thread');
const label = (page, text) => page.locator('[data-r43-topic-label]').filter({ hasText: text });

async function say(page, text) {
  await page.locator('[data-focus="composer"]').fill(text);
  await page.locator('[data-act="send"]').click();
}

async function waitForText(page, text) {
  await page.waitForFunction(value => document.querySelector('.thread')?.innerText.includes(value), text);
}

async function waitForTopic(page, id, hiddenText) {
  await page.waitForFunction(({ id, hiddenText }) => {
    const selected = document.querySelector('[data-r43-topic="' + id + '"]');
    const text = document.querySelector('.thread')?.innerText;
    return selected?.getAttribute('aria-pressed') === 'true' && text && !text.includes(hiddenText);
  }, { id, hiddenText });
}

test('总线自动发往旧话题或开启新话题，流式回复跟随所选话题，最近显示话题名', { skip }, async () => {
  await withThreadApp({ size: 24, topics: true }, async ({ page, mock }) => {
    await openBot(page);
    await page.locator('[data-r43-topic="s-old"]').waitFor();
    await say(page, '接着谈星期三看展的安排');
    await label(page, '接着聊：早先的话题').waitFor();
    await until(page, () => mock.state.sent.length === 1);
    await waitForText(page, '收到这句新消息');
    assert.equal(mock.state.sent[0].session, 's-old');
    assert.equal(mock.state.sent[0].classificationText, '接着谈星期三看展的安排');
    await page.waitForFunction(() => window.HubReal.state().jobs.length === 0);
    await say(page, '我想另开事项，讨论周末行程');
    await label(page, '新话题：新办事项').waitFor();
    await until(page, () => mock.state.sent.length === 2);
    await page.waitForFunction(() => window.HubReal.state().jobs.length === 0);
    assert.equal(mock.state.sent[1].session, 's-made-1');
    assert.equal(mock.state.requests.filter(r => r.method === 'POST' && r.path === '/threads/aa/send').length, 2);
    assert.equal(mock.state.requests.filter(r => r.method === 'POST' && /\/sessions\/.*\/messages/.test(r.path))
      .length, 0);
    assert.ok(mock.state.requests.some(r => r.path === '/sessions/s-old/stream'));
    assert.ok(mock.state.requests.some(r => r.path === '/sessions/s-made-1/stream'));
    await goHome(page);
    await page.waitForFunction(() => document.querySelector('[data-real-thread="aa"] .preview')
      ?.textContent.includes('新办事项'));
  });
});

test('话题页按归属筛选，完成的问答可挪，系统话题单独折叠', { skip }, async () => {
  await withThreadApp({ size: 24, topics: true, colorScheme: 'dark' }, async ({ page, mock }) => {
    await openBot(page);
    await page.locator('[data-r43-topic="s-old"]').click();
    await waitForTopic(page, 's-old', '第24句');
    await waitForText(page, '星期三去看展览');
    assert.doesNotMatch(await line(page).innerText(), /第24句|周末安排/);
    assert.match(await line(page).innerText(), /更早的内容助理已不带着/);
    await page.locator('[data-r43-topic=""]').click();
    await waitForText(page, '第24句');
    await say(page, '请把这一轮归到另一件事');
    await page.waitForFunction(() => window.HubReal.state().jobs.length === 0);
    await label(page, '接着聊：早先的话题').click();
    await page.locator('[data-r43-reassign-target]').selectOption('s-current');
    await page.locator('[data-r43-reassign-submit]').click();
    await until(page, () => mock.state.requests.some(r => r.path === '/threads/aa/reassign' &&
      r.body.mode === 'turn' && r.body.topic === 's-current'));
    await page.locator('[data-r43-reassign-submit]').waitFor({ state: 'hidden' });
    await page.locator('[data-r43-topic="s-current"]').click();
    await waitForText(page, '请把这一轮归到另一件事');
    assert.match(await line(page).innerText(), /收到这句新消息/);
    await page.locator('[data-r43-topics-more]').click();
    const group = page.locator('[data-r43-system-topics]');
    assert.equal(await group.getAttribute('open'), null);
    await group.locator('summary').click();
    await group.locator('[data-r43-topic-pick="s-board"]').click();
    await waitForTopic(page, 's-board', '收到这句新消息');
    await page.locator('[data-r43-event="s-board"]').waitFor();
    assert.doesNotMatch(await line(page).innerText(), /收到这句新消息|事件卡里面的交回说明/);
  });
});

test('归类标记允许发出前纠正，回复与流只进入纠正后的话题', { skip }, async () => {
  await withThreadApp({ size: 24, topics: true, pendingTopic: true }, async ({ page, mock }) => {
    await openBot(page);
    await say(page, '这条消息还没有开始处理');
    await label(page, '接着聊：早先的话题').click();
    await until(page, () => mock.state.requests.some(r => r.path.endsWith('/hold')));
    await page.locator('[data-r43-reassign-target]').selectOption('s-current');
    await page.locator('[data-r43-reassign-submit]').click();
    await until(page, () => mock.state.requests.some(r => r.path.endsWith('/reassign') &&
      r.body.mode === 'message' && r.body.topic === 's-current'));
    await page.locator('[data-r43-reassign-submit]').waitFor({ state: 'hidden' });
    assert.equal(mock.state.sent.length, 0);
    mock.state.releaseTopic = true;
    await until(page, () => mock.state.sent.length === 1);
    await waitForText(page, '收到这句新消息');
    assert.equal(mock.state.sent[0].session, 's-current');
    assert.ok(mock.state.requests.some(r => r.path === '/sessions/s-current/stream'));
    assert.ok(!mock.state.requests.some(r => r.path === '/sessions/s-old/stream'));
  });
});

test('停止尚未发出的消息只撤销本次投递', { skip }, async () => {
  await withThreadApp({ size: 24, topics: true, pendingTopic: true }, async ({ page, mock }) => {
    await openBot(page);
    await say(page, '发出之前撤回这句话');
    await label(page, '接着聊：早先的话题').waitFor();
    await page.waitForTimeout(850); // 兼容触发的 click 保护窗口，沿用原停止键手势约定。
    await page.locator('.composer-area [data-act="stop"]').click();
    await until(page, () => mock.state.requests.some(r => /\/threads\/aa\/send\/.*\/cancel/.test(r.path)));
    await page.waitForFunction(() => window.HubReal.state().jobs.length === 0);
    assert.equal(mock.state.sent.length, 0);
    assert.equal(mock.state.stopped.length, 0);
  });
});

test('隔天继续的分隔与话题视图对齐，语音转写也经过话题发送入口', { skip }, async () => {
  await withThreadApp({ size: 24, topics: true, holdVoice: true }, async ({ page, mock }) => {
    mock.state.add('s-resume', 'aa', '书房布置', [
      { id: 'first', role: 'user', seq: 1, text: '书架靠窗', ts: Date.parse('2026-11-15T10:00:00Z') },
      { id: 'later', role: 'user', seq: 2, text: '接着挑一盏灯', ts: Date.parse('2026-11-17T10:00:00Z'),
        resumed: true },
    ]);
    await openBot(page);
    await page.locator('[data-r43-topic="s-resume"]').click();
    await waitForText(page, '接着挑一盏灯');
    assert.match(await line(page).innerText(), /书架靠窗[\s\S]*接着聊：书房布置[\s\S]*接着挑一盏灯/);
    await page.evaluate(() => {
      const audio = new Blob(['synthetic'], { type: 'audio/wav' });
      window.r43TopicVoice = HubVoiceSend(audio, {
        conversation: Hub.state.conversation, bot: 'aa', requestId: 'r43-topic-voice', durationMs: 400,
      });
    });
    await until(page, () => typeof mock.state.releaseVoice === 'function');
    await page.locator('[data-r43-topic=""]').click();
    mock.state.releaseVoice();
    await page.evaluate(() => window.r43TopicVoice);
    await until(page, () => mock.state.sent.length === 1);
    assert.equal(mock.state.sent[0].session, 's-resume');
    assert.equal(mock.state.sent[0].classificationText, '录音转写留在开口时的话题');
    assert.ok(mock.state.requests.some(r => r.path === '/threads/aa/send'));
  });
});
