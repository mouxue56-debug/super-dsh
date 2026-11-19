// 最近列表与标已读：进程内假请求，不占端口。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { r29CreateHooks } = require('../hub-real.js');
const { environment } = require('./dom-double.cjs');
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(label, fn) {
  for (let i = 0; i < 80; i++) {
    if (fn()) return;
    await sleep(15);
  }
  throw new Error('超时：' + label);
}

function ok(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function bag() {
  return {
    ok: true,
    conversations: { s1: 2, s2: 3, 'b1-013': 7 },
    bots: { b1: 5 },
    groups: { g1: 4 }
  };
}

function hooksOf(store, owner) {
  const posts = [];
  let gets = 0;
  const hooks = r29CreateHooks({
    request(path, options = {}) {
      const method = String(options.method || 'GET').toUpperCase();
      if (path === '/unread/read' && method === 'POST') {
        return new Promise((resolve, reject) => {
          posts.push({ body: options.body, resolve, reject });
        });
      }
      if (path === '/unread/' && method === 'GET') {
        gets += 1;
        if (store.getFailAfter && gets > store.getFailAfter) throw new TypeError('get-down');
        return Promise.resolve(ok(JSON.parse(JSON.stringify(store.data))));
      }
      throw new Error('意外请求 ' + method + ' ' + path);
    },
    upTo: () => 4,
    owner: owner || (id => (id === 's1' || id === 's2' ? 'b1' : ''))
  });
  return { hooks, posts, gets: () => gets };
}

test('危险键不发标已读请求', async () => {
  let n = 0;
  const hooks = r29CreateHooks({
    request() {
      n += 1;
      return Promise.resolve(ok({ ok: true, conversations: {}, bots: {}, groups: {} }));
    }
  });
  hooks.HubUnread.markRead('__proto__');
  hooks.HubUnread.markRead('constructor');
  hooks.HubUnread.markRead('prototype');
  await hooks.idle();
  assert.equal(n, 0);
});

test('两段会话各清各的，不把助理和旧键整包清掉', async () => {
  const store = { data: bag(), getFailAfter: 0 };
  const { hooks, posts } = hooksOf(store);
  await hooks.refresh();
  hooks.HubUnread.markRead('s1');
  hooks.HubUnread.markRead('s2');
  await waitFor('第一段请求', () => posts.length === 1);
  let counts = hooks.HubUnread.counts();
  // 改：本地数字当场同步清掉，不等前一段的请求回来，所以第二段也已经是 0。
  assert.equal(counts.conversations.s1, 0);
  assert.equal(counts.conversations.s2, 0);
  assert.equal(counts.conversations['b1-013'], 7);
  assert.equal(counts.bots.b1, 0);
  assert.equal(counts.groups.g1, 4);
  assert.deepEqual(JSON.parse(posts[0].body), { conversation: 's1', upTo: 4 });
  store.data.conversations.s1 = 0;
  store.data.bots.b1 = 3;
  posts[0].resolve(ok({ ok: true }));
  await waitFor('第二段请求', () => posts.length === 2);
  counts = hooks.HubUnread.counts();
  assert.equal(counts.conversations.s1, 0);
  assert.equal(counts.conversations.s2, 0);
  assert.equal(counts.conversations['b1-013'], 7);
  assert.equal(counts.bots.b1, 0);
  assert.equal(counts.groups.g1, 4);
  assert.equal(JSON.parse(posts[1].body).conversation, 's2');
  store.data.conversations.s2 = 0;
  store.data.bots.b1 = 0;
  posts[1].resolve(ok({ ok: true }));
  await hooks.idle();
  counts = hooks.HubUnread.counts();
  assert.equal(counts.conversations['b1-013'], 7);
  assert.equal(counts.groups.g1, 4);
  assert.equal(counts.bots.b1, 0);
});

// 改：断网、5xx 这类「传输没成」不再把数字放回去（那会让主人看到数字弹回来），
// 数字保持已清，隔一会儿自己重试。后端明确拒绝（4xx）才放回，见下一条。
test('标已读断网时数字保持已清，不放回、不再跟一次刷新，隔一会儿自己重试', async () => {
  const store = { data: bag(), getFailAfter: 0 };
  const { hooks, posts, gets } = hooksOf(store);
  await hooks.refresh();
  hooks.HubUnread.markRead('s1');
  await waitFor('断网请求', () => posts.length === 1);
  assert.equal(hooks.HubUnread.counts().conversations.s1, 0);
  posts[0].reject(new TypeError('offline'));
  await hooks.idle();
  const counts = hooks.HubUnread.counts();
  assert.equal(counts.conversations.s1, 0);
  assert.equal(counts.conversations.s2, 3);
  assert.equal(counts.conversations['b1-013'], 7);
  assert.equal(counts.bots.b1, 3);
  assert.equal(counts.groups.g1, 4);
  assert.equal(gets(), 1);
  for (let i = 0; i < 200 && posts.length < 2; i++) await sleep(15);
  assert.equal(posts.length, 2, '1.5 秒后自己重试');
  assert.deepEqual(JSON.parse(posts[1].body), JSON.parse(posts[0].body));
});

test('标已读被后端拒绝（4xx）时先放回，刷新失败也停在原来的数字', async () => {
  const store = { data: bag(), getFailAfter: 1 };
  const { hooks, posts, gets } = hooksOf(store);
  await hooks.refresh();
  hooks.HubUnread.markRead('g1');
  await waitFor('讨论组请求', () => posts.length === 1);
  assert.equal(hooks.HubUnread.counts().groups.g1, 0);
  assert.equal(hooks.HubUnread.counts().conversations.s1, 2);
  assert.equal(hooks.HubUnread.counts().bots.b1, 5);
  posts[0].resolve(ok({ ok: false }, 400));
  await hooks.idle();
  const counts = hooks.HubUnread.counts();
  assert.equal(counts.groups.g1, 4);
  assert.equal(counts.conversations.s1, 2);
  assert.equal(counts.bots.b1, 5);
  assert.equal(gets(), 2);
  assert.equal(JSON.parse(posts[0].body).conversation, 'g1');
});

test('读过一次 404 之后不再标已读', async () => {
  let n = 0;
  const hooks = r29CreateHooks({
    request() {
      n += 1;
      return Promise.resolve({ status: 404, ok: false, json: async () => ({}) });
    }
  });
  await hooks.refresh();
  const before = n;
  hooks.HubUnread.markRead('s1');
  await hooks.idle();
  assert.equal(n, before);
  assert.deepEqual(hooks.HubUnread.counts(), { conversations: {}, bots: {}, groups: {} });
});

class Node {
  constructor(tag, attrs = {}, children) {
    this.tag = tag;
    this.attrs = { ...(attrs || {}) };
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.isConnected = true;
    for (const [key, value] of Object.entries(this.attrs)) {
      if (value == null || value === false || !key.startsWith('data-')) continue;
      const name = key.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[name] = String(value);
    }
    if (children !== undefined) this.append(children);
  }

  append(...items) {
    for (const item of items) {
      if (item == null || item === false) continue;
      if (Array.isArray(item)) this.append(...item);
      else this.children.push(item);
    }
  }

  replaceChildren(...items) {
    this.children = [];
    this.append(...items);
  }

  get firstElementChild() {
    return this.children.find(item => item instanceof Node) || null;
  }

  get textContent() {
    return this.children.map(item => item instanceof Node ? item.textContent : String(item)).join('');
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = node => {
      for (const child of node.children) {
        if (!(child instanceof Node)) continue;
        found.push(child);
        visit(child);
      }
    };
    visit(this);
    if (selector.startsWith('.')) {
      const name = selector.slice(1);
      return found.filter(node => String(node.attrs.class || '').split(/\s+/).includes(name));
    }
    return found.filter(node => node.tag === selector);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function walk(node, out = []) {
  for (const child of node.children || []) {
    if (!(child instanceof Node)) continue;
    out.push(child);
    walk(child, out);
  }
  return out;
}

function badgeText(row) {
  return walk(row)
    .filter(node => String(node.attrs.class || '').split(/\s+/).includes('r29-unread'))
    .map(node => node.textContent);
}

function boot(page) {
  const { ctx } = environment();
  const errors = [];
  const onError = error => errors.push(error);
  process.on('unhandledRejection', onError);
  ctx.document.hidden = page.hidden === true;
  ctx.localStorage.getItem = () => (page.mode === 'demo' ? 'demo' : null);
  const host = new Node('div', { class: 'home-recent-list' });
  if (page.mode === 'demo') host.append(new Node('p', {}, '演示还在'));
  ctx.document.querySelector = selector => (selector === '.home-recent-list' ? host : null);
  const htmlSeen = [];
  const H = ctx.Hub;
  H.h = (tag, attrs, children) => new Node(tag, attrs, children);
  H.botStyle = () => '';
  H.fromHTML = html => {
    htmlSeen.push(String(html));
    const found = /class="([^"]+)"/.exec(String(html));
    const node = new Node('span', { class: found ? found[1] : 'from-html' });
    node.raw = String(html);
    return node;
  };
  if (page.avatars) ctx.HubAvatars = page.avatars;
  ctx.crypto = { randomUUID: () => '00000000-0000-4000-8000-000000000001' };
  ctx.innerWidth = 900;
  ctx.fetch = (path, options) => page.respond(String(path), options || {});
  vm.runInContext(source, ctx);
  return {
    ctx, host, htmlSeen, errors,
    stop() { process.off('unhandledRejection', onError); }
  };
}

function liveStore() {
  return {
    conversations: { 's-one': 2, 's-two': 120, 'aide-013': 7 },
    bots: { aide: 122 },
    groups: { 'g-one': 4 }
  };
}

function pageData(store, empty) {
  const sessions = empty ? [] : [
    {
      id: 's-one', bot: 'aide', title: '买菜', unread: 9,
      updatedAt: '2026-04-02T02:00:00.000Z',
      lastText: '<img src=x onerror=alert(1)>'
    },
    {
      id: 's-two', bot: 'aide', title: '甲 · <b>话题</b>', unread: 9,
      updatedAt: '2026-04-01T03:30:00.000Z', lastText: ''
    }
  ];
  const groups = empty ? [] : [{
    id: 'g-one', name: '周末安排', status: 'active', host: 'aide', unread: 8,
    members: ['aide', 'beta', 'cote', 'delt'], lastText: '到了',
    updatedAt: '2026-04-03T04:00:00.000Z'
  }];
  return { sessions, groups, store };
}

function respondWith(data, posts) {
  return async (path, options) => {
    const method = String(options.method || 'GET').toUpperCase();
    if (path === '/bff/bots') {
      return ok({
        bots: [
          { id: 'aide', name: '甲', status: 'active', role: 'bot', order: 1 },
          { id: 'beta', name: '乙', status: 'active', role: 'bot', order: 2 }
        ]
      });
    }
    if (path === '/bff/sessions') return ok({ sessions: data.sessions });
    if (path === '/bff/groups') return ok({ groups: data.groups });
    if (path === '/bff/unread/' && method === 'GET') {
      return ok({ ok: true, ...JSON.parse(JSON.stringify(data.store)) });
    }
    if (path === '/bff/unread/read' && method === 'POST') {
      return new Promise((resolve, reject) => posts.push({ body: options.body, resolve, reject }));
    }
    if (path === '/bff/health') return ok({ ok: true, dsh: { connected: true } });
    if (path === '/bff/status') return ok({ ok: true, bots: {}, pendingTotal: 0 });
    return ok({ ok: true });
  };
}

function rowBy(host, id) {
  const real = host.querySelector('.hub-real-recents');
  return walk(real).find(node => node.dataset.realOpen === id);
}

function groupRow(host) {
  return host.querySelector('.r29-group-row');
}

test('真实最近：名字和话题、各段数字、叠头像，旧红点不另算一套', async () => {
  const posts = [];
  const data = pageData(liveStore(), false);
  const seen = { html: [], stack: [] };
  const page = boot({
    respond: respondWith(data, posts),
    avatars: {
      html(id, px) {
        seen.html.push([id, px]);
        return '<span class="hook-face" data-who="' + id + '"></span>';
      },
      stackHtml(ids, px) {
        seen.stack.push([ids.slice(), px]);
        return '<span class="hook-stack"></span>';
      }
    }
  });
  try {
    await waitFor('最近三行', () => {
      if (page.errors.length) throw page.errors[0];
      return rowBy(page.host, 's-one') && rowBy(page.host, 's-two') && groupRow(page.host);
    });
    const one = rowBy(page.host, 's-one');
    const two = rowBy(page.host, 's-two');
    const group = groupRow(page.host);
    assert.equal(one.querySelector('strong').textContent, '甲 · 买菜');
    assert.equal(two.querySelector('strong').textContent, '甲 · <b>话题</b>');
    assert.equal(typeof two.querySelector('strong').children[0], 'string');
    assert.equal(one.querySelector('.preview').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(typeof one.querySelector('.preview').children[0], 'string');
    assert.equal(two.querySelector('.preview').textContent, '尚无回复');
    assert.equal(group.querySelector('strong').textContent, '讨论组 · 周末安排');
    assert.equal(group.querySelector('.preview').textContent, '到了');
    assert.deepEqual(badgeText(one), ['+2']);
    assert.deepEqual(badgeText(two), ['99+']);
    assert.deepEqual(badgeText(group), ['+4']);
    assert.equal(one.textContent.includes('120'), false);
    assert.equal(two.textContent.includes('120'), false);
    assert.equal(two.textContent.includes('+120'), false);
    const dots = walk(page.host).filter(node => node.tag === 'i' &&
      String(node.attrs.class || '').split(/\s+/).includes('bot-unread'));
    assert.equal(dots.length, 0);
    assert.equal(page.htmlSeen.some(html => html.includes('onerror')), false);
    assert.equal(page.htmlSeen.some(html => html.includes('<b>话题</b>')), false);
    assert.ok(seen.html.some(item => item[0] === 'aide' && item[1] === 40));
    assert.equal(seen.stack.length >= 1, true);
    assert.deepEqual(seen.stack[0][0], ['aide', 'beta', 'cote', 'delt']);
    assert.equal(seen.stack[0][1], 40);
    assert.ok(group.querySelector('.hook-stack'));
    const counts = page.ctx.HubUnread.counts();
    assert.equal(counts.conversations['s-one'], 2);
    assert.equal(counts.conversations['aide-013'], 7);
    page.ctx.HubUnread.markRead('s-one');
    await waitFor('乐观清零', () => posts.length === 1 &&
      page.ctx.HubUnread.counts().conversations['s-one'] === 0);
    assert.deepEqual(badgeText(rowBy(page.host, 's-one')), []);
    assert.deepEqual(badgeText(rowBy(page.host, 's-two')), ['99+']);
    assert.deepEqual(badgeText(groupRow(page.host)), ['+4']);
    assert.equal(page.ctx.HubUnread.counts().bots.aide, 120);
    assert.equal(page.ctx.HubUnread.counts().conversations['aide-013'], 7);
    assert.equal(page.ctx.HubUnread.counts().groups['g-one'], 4);
    assert.deepEqual(JSON.parse(posts[0].body), { conversation: 's-one' });
    posts[0].reject(new TypeError('offline'));
    // 改：断网不放回，数字保持已清，隔 1.5 秒自己重试
    await sleep(200);
    assert.equal(page.ctx.HubUnread.counts().conversations['s-one'], 0);
    assert.deepEqual(badgeText(rowBy(page.host, 's-one')), []);
    assert.deepEqual(badgeText(rowBy(page.host, 's-two')), ['99+']);
    assert.deepEqual(badgeText(groupRow(page.host)), ['+4']);
    for (let i = 0; i < 200 && posts.length < 2; i++) await sleep(15);
    assert.equal(posts.length, 2);
    data.store.conversations['s-one'] = 0;
    data.store.bots.aide = 120;
    posts[1].resolve(ok({ ok: true }));
    await waitFor('刷新后仍是这一段', () => {
      const now = page.ctx.HubUnread.counts();
      return now.conversations['s-one'] === 0 && now.bots.aide === 120 &&
        badgeText(rowBy(page.host, 's-two')).join() === '99+';
    });
    assert.deepEqual(badgeText(rowBy(page.host, 's-one')), []);
    assert.deepEqual(badgeText(groupRow(page.host)), ['+4']);
    assert.equal(page.ctx.HubUnread.counts().conversations['s-two'], 120);
    assert.equal(page.ctx.HubUnread.counts().conversations['aide-013'], 7);
    if (page.errors.length) throw page.errors[0];
  } finally {
    page.stop();
  }
});

test('没有形象钩子时讨论组自己叠最多三张', async () => {
  const data = pageData(liveStore(), false);
  const page = boot({ respond: respondWith(data, []) });
  try {
    await waitFor('叠头像', () => {
      if (page.errors.length) throw page.errors[0];
      return groupRow(page.host)?.querySelector('.r29-stack');
    });
    const stack = groupRow(page.host).querySelector('.r29-stack');
    assert.equal(stack.dataset.r29Stack, 'aide,beta,cote');
    assert.equal(stack.querySelectorAll('.r29-face').length, 3);
    assert.equal(groupRow(page.host).querySelector('.hook-stack'), null);
  } finally {
    page.stop();
  }
});

test('名册好了但没有任何会话和讨论组时显示暂无', async () => {
  const data = pageData({ conversations: {}, bots: {}, groups: {} }, true);
  const page = boot({ respond: respondWith(data, []) });
  try {
    await waitFor('暂无', () => {
      if (page.errors.length) throw page.errors[0];
      const real = page.host.querySelector('.hub-real-recents');
      return real && real.textContent.includes('暂无');
    });
    const real = page.host.querySelector('.hub-real-recents');
    assert.equal(real.querySelector('button'), null);
    assert.equal(real.querySelector('p').textContent, '暂无');
  } finally {
    page.stop();
  }
});

test('演示模式不改首页最近列表', async () => {
  const page = boot({
    mode: 'demo',
    hidden: true,
    respond: async () => ok({ ok: true })
  });
  try {
    await sleep(30);
    if (page.errors.length) throw page.errors[0];
    assert.equal(page.host.querySelector('.hub-real-recents'), null);
    assert.equal(page.host.textContent, '演示还在');
    assert.equal(page.ctx.HubUnread, undefined);
  } finally {
    page.stop();
  }
});
