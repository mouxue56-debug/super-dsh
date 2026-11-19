import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDeviceTrust } from '../server.mjs';

const require = createRequire(import.meta.url);
const { markdown } = require('../hub-real.js');
const { environment } = require('./dom-double.cjs');
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');

// 模拟只接受纯文本的卡片节点。
class Node {
  // 保存节点内容。
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag;
    this.attrs = attrs;
    this.dataset = {};
    this.children = [];
    this.append(...(Array.isArray(children) ? children : [children]));
  }

  // 添加纯文本或子节点。
  append(...children) {
    this.children.push(...children.filter(value => value != null));
  }

  // 返回节点的完整文字。
  get textContent() {
    return this.children.map(value => typeof value === 'object' ? value.textContent : String(value)).join('');
  }

  // 禁止写入 HTML。
  set innerHTML(value) {
    throw new Error('不允许写入 HTML');
  }

  // 收集后代节点。
  descendants() {
    return this.children.flatMap(value => value instanceof Node ? [value, ...value.descendants()] : []);
  }
}

// 构造隔离的确认卡渲染器。
function cardRenderer() {
  const { ctx } = environment();
  const cards = new Map();
  ctx.Hub.h = (tag, attrs, children) => new Node(tag, attrs, children);
  ctx.Hub.registerCard = (id, spec) => cards.set(id, spec);
  ctx.Hub.botStyle = () => '';
  vm.runInContext(source, ctx);
  return cards.get('hub-real-approval').render;
}

test('未配置身份目标时不查询身份，配置后比较身份', async () => {
  const calls = [];
  const peer = [100, 64, 1, 1].join('.');
  const lookup = async target => {
    calls.push(target);
    return { UserProfile: { ID: 'same' } };
  };
  const missing = createDeviceTrust({}, { whois: lookup });
  assert.equal(await missing(peer), null);
  assert.deepEqual(calls, []);
  const configured = createDeviceTrust({ HUB_WEB_WHOIS_TARGET: 'configured-target' }, { whois: lookup });
  assert.equal(await configured(peer), 'whois');
  assert.deepEqual(calls, [peer, 'configured-target']);
});

test('链接保留代码文字，伪装的网址不会指向其他目标', () => {
  const first = 'https:' + '//' + ['first', 'invalid'].join('.') + '/path';
  const second = 'https:' + '//' + ['second', 'invalid'].join('.') + '/path';
  const code = markdown('查看 [`名称`](' + first + ')');
  assert.match(code, /<a [^>]*><code>名称<\/code><\/a>/u);
  assert.ok(!code.includes('\u0000'));
  const forged = markdown('[`' + first + '`](' + second + ')');
  assert.ok(!forged.includes('href='));
  assert.ok(forged.includes(first));
  assert.match(markdown('[' + first + '](' + first + ')'), /<a /u);
});

test('确认文字与知识库预览保持多行纯文本并说明截断', () => {
  const render = cardRenderer();
  const card = {
    id: 'card',
    type: 'approval',
    confirm: true,
    status: 'approved',
    kind: 'kb-submit',
    text: '第一行 <内容>\n第二行',
    bodyPreview: '预览 <内容>\n第二行',
    bodyTruncated: true,
    bodyLength: 900
  };
  const root = render(card);
  const nodes = root.descendants();
  const message = nodes.find(node => node.attrs.class === 'hub-real-confirm-text');
  const preview = nodes.find(node => node.attrs.class === 'hub-real-plan');
  assert.equal(message.textContent, card.text);
  assert.match(message.attrs.style, /pre-wrap/u);
  assert.equal(preview.textContent, card.bodyPreview);
  assert.match(root.textContent, /共 900 字，这里只显示前 600 字/u);
  const uncut = render({ ...card, bodyTruncated: false });
  assert.doesNotMatch(uncut.textContent, /这里只显示/u);
});
