import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const {environment} = require('./dom-double.cjs');
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
class Node {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; this.attrs = attrs; this.dataset = {}; this.children = [];
    this.disabled = attrs.disabled === true;
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    this.append(...(Array.isArray(children) ? children : [children]));
  }
  append(...children) { this.children.push(...children.filter(value => value != null)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  closest(selector) { return selector === 'button' && this.tag === 'button' ? this : null; }
  get textContent() {
    return this.children.map(value => value instanceof Node ? value.textContent : String(value)).join('');
  }
  all() { return this.children.flatMap(value => value instanceof Node ? [value, ...value.all()] : []); }
}

test('两步确认沿用同一卡，第二步可点且请求带阶段和本次范围', async () => {
  const env = environment(), {ctx} = env;
  const panels = new Map(), host = new Node('div'), answers = [];
  let connection;
  let card = {id: 'sensitive', type: 'approval', status: 'pending', bot: 'chief', sessionId: '',
    tool: 'confirm', confirm: true, title: '修改权限', confirmationTotal: 2, confirmationStep: 1,
    targets: ['config/工具.json', '<img src=x>'], targetCount: 2, consequence: '会改变工具权限',
    rollback: '可以退回还原点', scopeGrantable: true};
  ctx.document.hidden = false;
  ctx.localStorage.getItem = key => key === 'hub-web-mode-v1' ? 'real' : null;
  ctx.R43SelfEdit = {connect(value) { connection = value; }};
  ctx.Hub.h = (tag, attrs, children) => new Node(tag, attrs, children);
  ctx.Hub.botStyle = () => '';
  ctx.Hub.registerPanel = (id, spec) => panels.set(id, spec);
  ctx.Hub.openPanel = id => { ctx.Hub.state.drawer = id; panels.get(id).render(host); };
  ctx.document.querySelector = selector => selector === '.drawer [data-hub-panel]' ? host : null;
  ctx.fetch = async (url, options) => {
    if (String(url).endsWith('/bots')) return {ok: true, status: 200, json: async () =>
      ({bots: [{id: 'chief', name: '首席助理', status: 'active', role: 'chief'}]})};
    if (String(url).endsWith('/approvals/sensitive/answer')) {
      const answer = JSON.parse(options.body); answers.push(answer);
      card = {...card, ...(answer.confirmationStep === 1 ? {confirmationStep: 2} : {status: 'approved'})};
      return {ok: true, status: 200, json: async () => ({ok: true, card})};
    }
    return {ok: false, status: 404, json: async () => ({})};
  };
  vm.runInContext(source, ctx);
  await new Promise(resolve => setImmediate(resolve));
  connection.openApproval(card);
  const click = async decision => {
    const button = host.all().find(node => node.dataset.realAnswer === decision);
    assert.ok(button, '存在确认按钮'); assert.equal(button.disabled, false, '按钮可点击');
    const event = {target: button, detail: 1, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}};
    for (const listener of env.listeners.get('click') || []) listener(event);
    await new Promise(resolve => setImmediate(resolve));
  };
  assert.ok(host.textContent.includes('继续核对对象'));
  await click('approve');
  assert.deepEqual(answers, [{decision: 'approve', confirmationStep: 1}]);
  assert.ok(host.textContent.includes('再次确认'));
  assert.ok(host.textContent.includes('涉及 2 个对象'));
  assert.ok(host.textContent.includes('config/工具.json'));
  assert.ok(host.textContent.includes('<img src=x>'));
  assert.equal(host.all().some(node => node.tag === 'img'), false);
  await click('approve-task');
  assert.deepEqual(answers[1], {decision: 'approve', scope: 'task', confirmationStep: 2});
  assert.ok(host.textContent.includes('已批准'));
  assert.equal(host.all().some(node => node.dataset.realAnswer === 'approve'), false);
});
