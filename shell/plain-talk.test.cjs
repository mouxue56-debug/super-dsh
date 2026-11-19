/* 确认卡与项目页的单元测试。不连网，不读密钥。 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function makeDocument() {
  function attrsOf(el) { return el.attrs; }
  class Text {
    constructor(value) { this.textContent = String(value); this.parentNode = null; }
  }
  class Element {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.attrs = {};
      this.className = '';
      this.childNodes = [];
      this.parentNode = null;
      this._open = false;
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
      if (key === 'class') this.className = String(value);
    }
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null; }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get dataset() {
      const el = this;
      return new Proxy({}, {
        get: function (_target, key) {
          if (typeof key !== 'string') return undefined;
          const attr = 'data-' + key.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
          const value = el.getAttribute(attr);
          return value == null ? undefined : value;
        },
        set: function (_target, key, value) {
          const attr = 'data-' + key.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
          el.setAttribute(attr, value);
          return true;
        }
      });
    }
    get open() { return this.tagName === 'DETAILS' ? this._open : undefined; }
    set open(value) { this._open = !!value; }
    get textContent() { return this.childNodes.map(function (node) { return node.textContent; }).join(''); }
    set textContent(value) { this.childNodes = [new Text(value)]; this.childNodes[0].parentNode = this; }
    get innerHTML() { return this.childNodes.map(serialize).join(''); }
    set innerHTML(html) {
      this.childNodes = [];
      const source = String(html);
      const tags = source.matchAll(/<([a-zA-Z0-9]+)([^>]*)>/g);
      let found = false;
      for (const tag of tags) {
        found = true;
        const child = new Element(tag[1]);
        const names = tag[2].matchAll(/([:\w-]+)(?:="([^"]*)")?/g);
        for (const attr of names) {
          if (attr[1] === 'class') child.className = attr[2] || '';
          child.setAttribute(attr[1], attr[2] || '');
        }
        this.append(child);
      }
      if (!found) this.textContent = source.replace(/<[^>]+>/g, '');
    }
    append() {
      for (const item of arguments) {
        if (item == null || item === false) continue;
        if (Array.isArray(item)) { this.append.apply(this, item); continue; }
        const node = typeof item === 'string' ? new Text(item) : item;
        node.parentNode = this;
        this.childNodes.push(node);
      }
    }
    replaceWith(node) {
      const parent = this.parentNode;
      if (!parent) return;
      const index = parent.childNodes.indexOf(this);
      node.parentNode = parent;
      parent.childNodes.splice(index, 1, node);
      this.parentNode = null;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) { return queryAll(this, selector); }
  }
  function serialize(node) {
    if (!node.tagName) return esc(node.textContent);
    const name = node.tagName.toLowerCase();
    return '<' + name + '>' + node.childNodes.map(serialize).join('') + '</' + name + '>';
  }
  function matches(el, selector) {
    if (selector.startsWith('.')) return el.className.split(/\s+/).indexOf(selector.slice(1)) !== -1;
    if (selector.startsWith('[')) {
      const found = selector.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
      if (!found) return false;
      const value = el.getAttribute(found[1]);
      return found[2] == null ? value != null : value === found[2];
    }
    return el.tagName === selector.toUpperCase();
  }
  function walk(node, visit) {
    (node.childNodes || []).forEach(function (child) {
      if (!child.tagName) return;
      visit(child);
      walk(child, visit);
    });
  }
  function queryAll(root, selector) {
    const parts = selector.trim().split(/\s+/);
    let current = [root];
    parts.forEach(function (part) {
      const next = [];
      current.forEach(function (node) {
        walk(node, function (el) { if (matches(el, part)) next.push(el); });
      });
      current = next;
    });
    return current;
  }
  const head = new Element('head');
  const document = {
    documentElement: { dataset: { hubMode: '' } },
    head: head,
    createElement: function (tag) { return new Element(tag); },
    createTextNode: function (value) { return new Text(value); },
    getElementById: function (id) {
      let found = null;
      walk(head, function (el) { if (el.id === id) found = el; });
      return found;
    }
  };
  return { document: document, Element: Element, Text: Text, attrsOf: attrsOf };
}

function boot() {
  const dom = makeDocument();
  const cards = new Map();
  const panels = new Map();
  const context = {
    console: console, Date: Date, Array: Array, String: String, RegExp: RegExp,
    Object: Object, Number: Number, Error: Error, Math: Math, JSON: JSON
  };
  context.window = context;
  context.document = dom.document;
  context.window.document = dom.document;
  context.window.__hit = 0;
  context.window.Hub = {
    h: function (tag, attrs, children) {
      const el = dom.document.createElement(tag);
      Object.entries(attrs || {}).forEach(function (entry) {
        const key = entry[0];
        const value = entry[1];
        if (value == null || value === false) return;
        if (key === 'class' || key === 'className') el.className = value;
        else el.setAttribute(key, value === true ? '' : String(value));
      });
      const append = function (child) {
        if (child == null || child === false) return;
        if (Array.isArray(child)) { child.forEach(append); return; }
        el.append(child);
      };
      append(children);
      return el;
    },
    addStyle: function (css) {
      const names = [...String(css).matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(function (item) { return item[1]; });
      if (!names.length || names.some(function (name) { return name.indexOf('m-plain-talk-') !== 0; })) {
        throw new Error('样式类名不合格：' + names.join(','));
      }
    },
    registerCard: function (id, spec) { cards.set(id, spec); return spec; },
    registerPanel: function (id, spec) { panels.set(id, spec); return spec; }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'modules/plain-talk.js'), 'utf8'), context, {
    filename: 'plain-talk.js'
  });
  return { api: context.window.HubPlainTalk, hub: context.window.Hub, document: dom.document,
    cards: cards, panels: panels, window: context.window };
}

function buttons(root) {
  const bar = root.querySelector('.m-plain-talk-actions');
  return bar ? [...bar.querySelectorAll('button')].map(function (button) { return button.textContent; }) : [];
}

function sectionItems(root, name) {
  const section = root.querySelector('[data-plain-section="' + name + '"]');
  assert.ok(section, '缺少分段：' + name);
  return [...section.querySelectorAll('li')].map(function (item) { return item.textContent; });
}

function main() {
  const env = boot();
  const api = env.api;
  const expected = {
    'write-shared': '调研员想把摘要存到共享文件夹',
    'read-file': '资料员想查看摘要',
    'run-list': '首席助理想运行一条命令来查看文件列表',
    'go-online': '调研员想联网查一份公开资料',
    'hand-off': '首席助理想把核对摘要交给调研员',
    'let-go': '首席助理想让以后这类事不用再问你',
    'work-split': '首席助理想按分工表做整理摘要'
  };
  api.sampleCards().forEach(function (card) {
    const view = api.renderCard(card);
    const line = view.querySelector('[data-plain-line]');
    const details = view.querySelector('details');
    assert.ok(line, card.id + ' 没有第一行');
    assert.strictEqual(details.open, false, card.id + ' 细节应该默认收起');
    assert.strictEqual(details.getAttribute('open'), null, card.id + ' 不应该带 open');
    assert.strictEqual(view.querySelector('script'), null, card.id + ' 出现了脚本节点');
    assert.strictEqual(view.querySelector('img'), null, card.id + ' 出现了图片节点');
    assert.strictEqual(view.querySelector('b'), null, card.id + ' 尖括号被当成标签');
    assert.strictEqual(env.window.__hit, 0, card.id + ' 恶意字段被执行');
    assert.ok(!/<script/i.test(view.innerHTML), card.id + ' 原文被插进页面代码');
    if (expected[card.id]) {
      assert.strictEqual(line.textContent, expected[card.id], card.id + ' 第一行不对');
      assert.ok(line.textContent.indexOf(card.command || '___none___') === -1 || !card.command,
        card.id + ' 第一行不该出现命令原文');
    }
    const bar = buttons(view);
    if (card.id === 'need-yes') {
      assert.ok(line.textContent.indexOf('<img') === 0, '恶意名字应按文字显示');
      assert.ok(line.textContent.endsWith('想做一件需要你点头的事'), '拼不出类型时用兜底句');
      assert.ok(view.textContent.indexOf('<script>alert(1)</script>') !== -1, '命令原文应留在细节里');
      assert.ok(view.textContent.indexOf('<b>不要执行</b>') !== -1, '原因应按文字显示');
      assert.deepStrictEqual(bar, ['同意', '拒绝']);
      assert.ok(details.textContent.indexOf('改一下') !== -1, '改一下应在细节里');
    }
    if (card.id === 'run-list') assert.deepStrictEqual(bar, ['同意', '拒绝', '以后这类不用问']);
    if (card.id === 'read-file') assert.deepStrictEqual(bar, ['同意', '拒绝']);
    if (card.id === 'hand-off') {
      assert.deepStrictEqual(bar, ['同意', '拒绝']);
      assert.strictEqual(view.textContent.indexOf('改一下'), -1, '这类卡原来没有改一下');
    }
  });

  env.window.HubAvatars = { html: function () { return '<span class="ava"></span>'; } };
  const faced = api.renderCard(api.sampleCards()[0]);
  assert.ok(faced.querySelector('.ava'), '有头像接口时要带头像');
  assert.strictEqual(faced.querySelector('[data-plain-line]').textContent, expected['write-shared']);
  assert.strictEqual(faced.querySelector('script'), null);

  const pages = api.samplePages();
  const normal = api.renderProject(pages[0].text);
  assert.strictEqual(normal.getAttribute('data-plain-page'), 'sections');
  assert.deepStrictEqual(sectionItems(normal, '目标'), ['把摘要收成一页', '两人交叉看一遍']);
  assert.deepStrictEqual(sectionItems(normal, '已定的'), ['不补原文', '只写事实']);
  assert.deepStrictEqual(sectionItems(normal, '等你处理'), ['共享区还是空的', '等你点头再写']);
  const original = normal.querySelector('[data-plain-original]');
  assert.strictEqual(original.open, false, '原文默认收起');
  assert.ok(original.textContent.indexOf('[#2]') !== -1, '原文要保留出处');

  const missing = api.renderProject(pages[1].text);
  assert.deepStrictEqual(sectionItems(missing, '目标'), ['先把摘要收成一页']);
  assert.deepStrictEqual(sectionItems(missing, '已定的'), ['暂无']);
  assert.deepStrictEqual(sectionItems(missing, '等你处理'), ['暂无']);

  const messy = api.renderProject(pages[2].text);
  assert.strictEqual(messy.getAttribute('data-plain-page'), 'raw');
  assert.ok(messy.textContent.indexOf('<script>alert(1)</script>') !== -1);
  assert.strictEqual(messy.querySelector('script'), null, '乱格式里的尖括号不能执行');
  assert.ok(!/<script/i.test(messy.innerHTML));
  assert.strictEqual(messy.querySelector('[data-plain-section]'), null);

  const sharp = api.renderProject('## 目标\n- <b>加粗</b>\n## 已定的决定\n- 一条');
  assert.deepStrictEqual(sectionItems(sharp, '目标'), ['<b>加粗</b>']);
  assert.strictEqual(sharp.querySelector('b'), null);

  assert.strictEqual(api.humanize('L3 token sandbox cwd exit code'), 'L3 token sandbox cwd exit code');
  env.document.documentElement.dataset.hubMode = 'real';
  assert.strictEqual(api.humanize('L0 L1 L2 L3 L4 token tokens token/s sandbox cwd exit code exitCode L 级'),
    '只看不动 记一笔就行 先做完再告诉你 先问你 不能做 用量 用量 每秒用量 隔离试跑区 所在文件夹 结束状态 结束状态 这一档');
  env.document.documentElement.dataset.hubMode = '';

  const thrown = { render: function () { throw new Error('旧卡'); } };
  env.hub.registerCard('hub-real-approval', thrown);
  const wrapped = env.cards.get('hub-real-approval');
  const drawn = wrapped.render(api.sampleCards()[0]);
  assert.strictEqual(drawn.querySelector('[data-plain-line]').textContent, expected['write-shared']);
  env.hub.registerCard('other-card', { render: function () { return '原样'; } });
  assert.strictEqual(env.cards.get('other-card').render(), '原样');

  const host = env.document.createElement('div');
  const slot = env.document.createElement('div');
  slot.className = 'hub-real-text';
  slot.textContent = '正在读取项目页…';
  host.append(slot);
  env.hub.registerPanel('hub-real-group-page', {
    render: function (node) {
      node.querySelector('.hub-real-text').textContent = pages[0].text;
      return Promise.resolve();
    }
  });
  return env.panels.get('hub-real-group-page').render(host).then(function () {
    assert.strictEqual(host.querySelector('[data-plain-page]').getAttribute('data-plain-page'), 'sections');
    assert.strictEqual(host.querySelector('.hub-real-text'), null);
    const loading = env.document.createElement('div');
    const waiting = env.document.createElement('div');
    waiting.className = 'hub-real-text';
    waiting.textContent = '正在读取项目页…';
    loading.append(waiting);
    return env.panels.get('hub-real-group-page').render({
      querySelector: function () { return waiting; },
      append: function () {}
    }).then(function () {
      waiting.textContent = '正在读取项目页…';
      const keep = env.document.createElement('div');
      const text = env.document.createElement('div');
      text.className = 'hub-real-text';
      text.textContent = '项目页暂时读不到（暂无）';
      keep.append(text);
      env.hub.registerPanel('hub-real-group-page', {
        render: function () { return Promise.resolve(); }
      });
      return env.panels.get('hub-real-group-page').render(keep);
    }).then(function () {
      const kept = host; // placeholder to keep the chain readable
      assert.ok(kept);
    });
  });
}

main().then(function () {
  // 重新走一遍「读不到」不改写，避免上面占位断言漏掉。
  const env = boot();
  const keep = env.document.createElement('div');
  const text = env.document.createElement('div');
  text.className = 'hub-real-text';
  text.textContent = '项目页暂时读不到（暂无）';
  keep.append(text);
  env.hub.registerPanel('hub-real-group-page', { render: function () { return Promise.resolve(); } });
  return env.panels.get('hub-real-group-page').render(keep).then(function () {
    assert.strictEqual(text.textContent, '项目页暂时读不到（暂无）');
    assert.strictEqual(keep.querySelector('[data-plain-page]'), null);
    console.log('plain-talk.test.cjs 通过');
  });
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
