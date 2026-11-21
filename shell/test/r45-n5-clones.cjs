/* 接力时间线上有「用了 N 个分身」。jsdom，不连网。 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'r32-relay.js'), 'utf8');
const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.eval('var r30Sheet = null; var state = null; function r30SheetRender(){} function r29DeskFace(){return "<i></i>";} function r30People(){return [];} function r29DeskCurrent(){return [];}');
w.eval(src);
w.state = { bot: 'research', bots: [
  { id: 'research', name: '调研员', role: 'bot', enabled: true },
  { id: 'writer', name: '写作', role: 'bot', enabled: true },
  { id: 'content', name: '内容', role: 'bot', enabled: true },
  { id: 'art', name: '视觉', role: 'bot', enabled: true },
  { id: 'pm', name: '项目', role: 'bot', enabled: true },
  { id: 'chief', name: '首席', role: 'chief', enabled: true },
] };
w.botBy = function (id) {
  return (w.state.bots || []).filter(function (b) { return b.id === id; })[0] || null;
};
w.r30Sheet = { r32: { on: true, steps: [] } };
const form = w.R32Relay.newHtml('<div class="r30-actions"></div>');
assert.doesNotMatch(form, /用了 \d+ 个分身|派了/u);

const model = w.R32Relay.model({ phase: 'running', current: 1, steps: [
  { who: { name: 'writer', type: 'assistant' }, task: '写方案', status: 'done', gate: false },
  { who: { name: 'content', type: 'assistant' }, task: '写代码', status: 'active', gate: false, clones: 3 },
  { who: { name: 'research', type: 'assistant' }, task: '检查', status: 'waiting', gate: false, clones: 0 },
] }, { id: 'T-n5' });
assert.equal(model.steps[1].clones, 3);
assert.equal(model.steps[0].clones, 0);
const timeline = w.R32Relay.timelineHtml({ id: 'T-n5', relay: model });
assert.match(timeline, /用了 3 个分身/u);
assert.equal((timeline.match(/用了 \d+ 个分身/g) || []).length, 1);

const rows = w.R32Relay.demoRows();
const dev = rows.filter(function (row) { return row.id === 'r32-demo-dev'; })[0];
const event = rows.filter(function (row) { return row.id === 'r32-demo-event'; })[0];
assert.ok(dev, '开发类演示接力要在');
const devTimeline = w.R32Relay.timelineHtml(dev);
assert.match(devTimeline, /用了 3 个分身/u);
assert.equal((devTimeline.match(/用了 3 个分身/g) || []).length, 1);
assert.doesNotMatch(w.R32Relay.timelineHtml(event), /分身/u);
console.log('r45-n5-clones 通过');
