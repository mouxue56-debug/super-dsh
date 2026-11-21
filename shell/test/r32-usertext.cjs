/* 说人话词表只换系统自己的词，不换用户起的群名、卡名、会话标题、助理名字和职责。jsdom，不连网。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'stewards.js'), 'utf8');
const second = src.slice(src.indexOf('(function () {\n  var PAIRS'));
assert(second.length > 1000, '没找到说人话那一段');

function run(real) {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.r29Real = function () { return real; };
  const payload = {
    groups: [{ id: 'g1', name: 'r31验收群' }],
    tickets: [{ id: 'T-1', title: '验收报告', summary: '请重试一次验收', status: 'review' }],
    sessions: [{ id: 's1', title: '验收会话' }],
    bots: [{ id: 'b1', name: '验收员', duty: '负责验收和重试' }]
  };
  w.fetch = function () {
    return Promise.resolve({ ok: true, headers: { get: () => 'application/json' },
      clone() { return { text: () => Promise.resolve(JSON.stringify(payload)) }; } });
  };
  w.eval(second);
  return w;
}
(async () => {
  const w = run(true);
  await w.fetch('/bff/groups');
  await new Promise((r) => setTimeout(r, 20));
  const d = w.document;
  d.body.innerHTML = '<h1 id="g">r31验收群</h1><b id="c">验收报告</b><i id="s">验收会话</i>' +
    '<p id="d">负责验收和重试</p><u id="n">验收员</u><span id="st">等你验收</span>' +
    '<span id="m">请重试一次验收</span><button id="t" title="验收报告">x</button><span id="mix">状态：待验收 · 验收报告</span>' +
    '<span id="col">等验收</span><span id="back">交回，等验收</span>';
  w.r29PlainTalk();
  const t = (id) => d.getElementById(id).textContent;
  assert.equal(t('g'), 'r31验收群');
  assert.equal(t('c'), '验收报告');
  assert.equal(t('s'), '验收会话');
  assert.equal(t('d'), '负责验收和重试');
  assert.equal(t('n'), '验收员');
  assert.equal(t('m'), '请重试一次验收');
  assert.equal(d.getElementById('t').getAttribute('title'), '验收报告');
  assert.equal(t('st'), '等你看过确认', '状态标签仍说人话');
  assert.equal(t('mix'), '状态：等你看过 · 验收报告', '同一行里状态词换、用户内容不换');
  assert.equal(t('col'), '等验收', '看板第三列保持等验收');
  assert.equal(t('back'), '交回，等验收', '系统句子里的等验收不被拆开改写');
  // 演示模式不动
  const w2 = run(false);
  w2.document.body.innerHTML = '<span id="x">验收</span>';
  w2.r29PlainTalk();
  assert.equal(w2.document.getElementById('x').textContent, '验收');
  console.log('r32-usertext 通过');
})().catch((e) => { console.error(e); process.exit(1); });
