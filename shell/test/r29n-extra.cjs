const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function page() {
  return new JSDOM('<html data-hub-mode="real"><body><div class="drawer"></div></body></html>', {
    url: 'http://localhost/', runScripts: 'dangerously'
  });
}
test('五分钟只轮询十次并停止隐藏页面', async t => {
  const d = page(), w = d.window;
  t.after(() => w.close());
  let now = 0, calls = 0, interval;
  Object.defineProperty(w.document, 'hidden', {value: false, configurable: true});
  w.Date.now = () => now;
  w.setInterval = fn => { interval = fn; return 1; };
  w.clearInterval = () => {};
  w.eval('var state={mode:"kanban",bots:[]}; var Hub={registerView(){},on(){}}; function esc(x){return x}');
  w.fetch = async () => { calls++; return {ok: true, json: async () => ({tickets: []})}; };
  w.eval(read('js/views/board.js'));
  w.r29DeskPull();
  await flush();
  for (let i = 1; i <= 10; i++) {
    now = i * 30000;
    interval();
    w.r29DeskPull();
    await flush();
  }
  assert.equal(calls, 11);
  Object.defineProperty(w.document, 'hidden', {value: true, configurable: true});
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  now += 30000;
  interval();
  assert.equal(calls, 11);
});
test('倒序完成后回读并补写最后点选', async t => {
  const d = page(), w = d.window, pending = [];
  t.after(() => w.close());
  let server = 'open', reads = 0;
  w.eval('var state={drawer:""}; var Hub={on(){},toast(){}}');
  w.HubSettings = {
    get() { reads++; return Promise.resolve({permission: {mode: server}}); },
    setPermission(mode) {
      return new Promise(resolve => pending.push(() => { server = mode; resolve({ok: true}); }));
    }
  };
  w.eval(read('js/r29-permissions.js'));
  for (const mode of ['ask', 'readonly']) {
    const b = w.document.createElement('button');
    b.dataset.r29Permission = mode;
    w.document.body.append(b);
    b.click();
  }
  pending[1](); await flush();
  pending[0](); await flush(); await flush();
  assert.equal(pending.length, 3);
  pending[2](); await flush(); await flush();
  assert.equal(server, 'readonly');
  assert.equal(w.R29Permission.mode, 'readonly');
  assert.ok(reads >= 2);
});
test('八秒超时后回读真实档位并提示', async t => {
  const d = page(), w = d.window;
  t.after(() => w.close());
  let timeout;
  w.eval('var state={drawer:"permission"}; var Hub={on(){},toast(){}}');
  w.setTimeout = fn => { timeout = fn; return 1; };
  w.clearTimeout = () => {};
  w.HubSettings = {
    get: async () => ({permission: {mode: 'ask'}}),
    setPermission: () => new Promise(() => {})
  };
  w.eval(read('js/r29-permissions.js'));
  const b = w.document.createElement('button');
  b.dataset.r29Permission = 'readonly';
  w.document.body.append(b);
  b.click();
  assert.match(w.document.body.textContent, /正在保存/);
  timeout(); await flush(); await flush();
  assert.equal(w.R29Permission.mode, 'ask');
  assert.match(w.document.body.textContent, /没保存上/);
});
