// 页面停在对话底部时，已读请求最多 3 次。用夹具驱动真实滚动监听，不另开端口。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { environment } = require('./dom-double.cjs');
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');

function ok(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => data,
    body: null,
  });
}

test('页面停在对话底部 100 秒，已读请求不超过 3 次', { timeout: 180000 }, async () => {
  const { ctx } = environment();
  const scrolls = [];
  ctx.document.addEventListener = (name, fn) => {
    if (name === 'scroll') scrolls.push(fn);
  };
  ctx.document.hidden = false;
  ctx.localStorage.getItem = () => null;
  ctx.innerWidth = 390;
  ctx.Hub.navigate = route => {
    if (route && typeof route === 'object') Object.assign(ctx.Hub.state, route);
  };
  let reads = 0;
  ctx.fetch = (path, options = {}) => {
    const url = String(path);
    const method = String(options.method || 'GET').toUpperCase();
    if (url.includes('/unread/read') && method === 'POST') {
      reads += 1;
      return ok({ ok: true });
    }
    if (url.includes('/unread/') && method === 'GET') {
      return ok({ ok: true, conversations: { 's-one': 4 }, bots: { aide: 4 }, groups: {} });
    }
    if (url.endsWith('/bots')) {
      return ok({ bots: [{ id: 'aide', name: '甲', status: 'active', role: 'bot', order: 1 }] });
    }
    if (url.endsWith('/sessions')) return ok({ sessions: [] });
    if (url.endsWith('/health')) return ok({ ok: true, dsh: { connected: true } });
    if (url.endsWith('/status')) return ok({ ok: true, bots: {}, pendingTotal: 0 });
    return ok({ ok: true });
  };
  vm.runInContext(source, ctx);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(scrolls.length >= 1, '滚动监听没挂上');
  const record = ctx.HubRealR28.record('aide', 's-one', '买菜');
  assert.equal(record.remote, 's-one');
  ctx.Hub.state.conversation = record.local;
  ctx.Hub.state.bot = 'aide';
  ctx.Hub.state.view = 'chat';
  ctx.Hub.state.detail = true;
  const thread = {
    classList: { contains: name => name === 'thread' },
    closest() { return thread; },
    scrollHeight: 2000,
    scrollTop: 2000,
    clientHeight: 800,
  };
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    for (const fn of scrolls) fn({ target: thread });
    assert.ok(reads <= 3, '已读请求超过 3 次，实际 ' + reads);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  for (const fn of scrolls) fn({ target: thread });
  assert.ok(reads >= 1, '底部停留没有发出已读请求');
  assert.ok(reads <= 3, '100 秒内已读请求 ' + reads + ' 次');
});
