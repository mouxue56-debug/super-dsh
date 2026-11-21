/* 新建接力里有「另开一段会话」，时间线上有「独立会话」小标。jsdom，不连网。 */
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
  { id: 'chief', name: '首席', role: 'chief', enabled: true },
] };
w.r30Sheet = { r32: { on: true, steps: [] } };
const html = w.R32Relay.newHtml('<div class="r30-actions"></div>');
assert.match(html, /另开一段会话/u);
assert.doesNotMatch(html, /子 agent|分身|派个分身/u);

w.document.body.innerHTML = html;
w.document.querySelector('[data-r32-aside]').click();
const added = w.r30Sheet.r32.steps.at(-1);
assert.equal(added.aside, true);
assert.equal(added.person.id, 'research');
assert.match(w.R32Relay.newHtml('<div class="r30-actions"></div>'), /独立会话/u);

w.state.bot = 'nobody';
w.r30Sheet.r32.steps = [];
w.document.body.innerHTML = w.R32Relay.newHtml('<div class="r30-actions"></div>');
w.document.querySelector('[data-r32-aside]').click();
assert.equal(w.r30Sheet.r32.steps[0].person.id, 'chief');

const model = w.R32Relay.model({ phase: 'running', current: 0, steps: [
  { who: { name: 'research', type: 'assistant' }, task: '查', status: 'active', aside: true, gate: false },
  { who: { name: 'writer', type: 'assistant' }, task: '写', status: 'waiting', gate: false },
] }, { id: 'T-n4' });
const timeline = w.R32Relay.timelineHtml({ id: 'T-n4', relay: model });
assert.match(timeline, /独立会话/u);
assert.equal((timeline.match(/独立会话/g) || []).length, 1);
console.log('r45-n4-aside 通过');
