/* 念出来：默认开、没接上时明说、播放被拦就留下播放条。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function loadJsdom() {
  if (process.env.JSDOM_MODULE) return require(process.env.JSDOM_MODULE);
  const guess = path.join(process.env.HOME || '', 'node_modules', 'jsdom');
  return require(guess);
}

const { JSDOM } = loadJsdom();
const source = fs.readFileSync(path.join(__dirname, 'r45-speak.js'), 'utf8');

function boot() {
  const dom = new JSDOM(`<!doctype html><body>
    <div data-r29-settings-page></div>
    <article class="msg msg-bot" data-message-id="m1"><div class="bubble">今天天气不错。</div></article>
  </body>`, { url: 'http://127.0.0.1/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const ctx = dom.getInternalVMContext();
  vm.runInContext(`
    window.Audio = class { addEventListener() {} play() { return Promise.reject(new Error('blocked')); } };
    window.AudioContext = class {
      constructor() { this.state = 'running'; this.destination = {}; }
      createBuffer() { return {}; }
      createBufferSource() { return { connect() {}, start() {} }; }
    };
  `, ctx);
  vm.runInContext(source, ctx);
  vm.runInContext("document.dispatchEvent(new Event('DOMContentLoaded'))", ctx);
  return dom.window;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const window = boot();
  const speak = window.document.querySelector('[data-r45-speak]');
  const auto = window.document.querySelector('[data-r45-auto]');
  assert.equal(speak.textContent, '念出来');
  assert.equal(speak.getAttribute('aria-label'), '把这条回复念出来');
  assert.equal(auto.textContent, '开');
  assert.equal(auto.getAttribute('aria-pressed'), 'true');
  assert.equal(auto.closest('[data-r29-block]'), null);
  speak.click();
  await wait(30);
  const status = () => window.document.querySelector('[data-r45-play-status]').textContent;
  assert.equal(status(), '还没接上');
  assert.equal(window.document.querySelector('[data-r45-playbar]').hidden, false);
  window.HubSpeak = async () => ({
    ok: true,
    mime: 'audio/wav',
    segments: [Buffer.from('RIFF').toString('base64')],
  });
  speak.click();
  await wait(40);
  assert.equal(status(), '自动播放被拦住了，点一下播放');
  assert.equal(window.document.querySelector('[data-r45-play]').disabled, false);
  auto.click();
  assert.equal(window.localStorage.getItem('sds-speak-auto'), 'off');
  assert.equal(auto.textContent, '关');
  auto.click();
  assert.equal(window.localStorage.getItem('sds-speak-auto'), 'on');
  console.log('r45-speak ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
