const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const PAYLOAD = '<img src=x onerror="window.__hit=1">" onmouseover="window.__hit=1" ' +
  'javascript:alert(1)';

function loadJsdom() {
  if (process.env.JSDOM_MODULE) return require(process.env.JSDOM_MODULE);
  try { return require('jsdom'); }
  catch (error) { /* 继续往上找 */ }
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const hit = path.join(dir, 'node_modules', 'jsdom');
    if (fs.existsSync(hit)) return require(hit);
    dir = path.dirname(dir);
  }
  throw new Error('找不到 jsdom');
}

const {JSDOM} = loadJsdom();

function dom() {
  return new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:3781/'
  });
}

function load(w, file) {
  w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
}

function h(w, tag, attrs, children) {
  const el = w.document.createElement(tag);
  Object.entries(attrs || {}).forEach(function (pair) {
    el.setAttribute(pair[0], pair[1]);
  });
  const list = Array.isArray(children) ? children : [children];
  list.forEach(function (child) {
    if (child == null) return;
    el.append(child && child.nodeType ? child : w.document.createTextNode(String(child)));
  });
  return el;
}

function escFn() {
  return 'function esc(x){return String(x==null?"":x).replace(/&/g,"&amp;")' +
    '.replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")' +
    '.replace(/\\x27/g,"&#39;");}';
}

function boardDom() {
  const d = dom();
  const w = d.window;
  w.eval(
    'var state={boardScope:"all",boardView:"columns",boardPending:{},project:"p",' +
    'cards:[{id:"x",title:"ok",sub:"",bot:"b",project:"p",time:"刚刚"}],' +
    'bots:[{id:"b",name:"助理"}]};' +
    'var COLS=[{id:"todo",name:"待办"}];' +
    'function boardCol(){return "todo"} function boardOrder(){return 0} ' +
    'function botBy(){return state.bots[0]} function botStyle(){return ""} ' +
    'function projBy(){return {name:"项目"}} function r29Face(){return ""} ' +
    'function ico(){return ""} ' + escFn() +
    'var Hub={registerView(){},boardBadgesSlot(){return ""},featureOwner(){return null}};'
  );
  load(w, 'js/views/board.js');
  return d;
}

function renderBoard(w) {
  const box = w.document.createElement('div');
  box.innerHTML = w.boardView();
  return box;
}

function assertPlain(box, payload) {
  assert.equal(box.querySelector('img,script,a[href^="javascript:"]'), null);
  assert.equal(box.querySelector('[onmouseover],[onerror]'), null);
  assert.ok(box.textContent.includes(payload));
}

test('看板标题、状态句、助理名遇到危险输入仍是文本', function () {
  const spots = [
    function (w) { w.state.cards[0].title = PAYLOAD; },
    function (w) { w.state.cards[0].sub = PAYLOAD; },
    function (w) { w.state.bots[0].name = PAYLOAD; }
  ];
  spots.forEach(function (set) {
    const d = boardDom();
    const w = d.window;
    set(w);
    const box = renderBoard(w);
    assertPlain(box, PAYLOAD);
    const card = box.querySelector('.kcard');
    if (card) {
      card.dispatchEvent(new w.MouseEvent('mouseover', {bubbles: true}));
      assert.equal(w.__hit, undefined);
      assert.equal(card.getAttribute('onmouseover'), null);
    }
    d.window.close();
  });
});

function taskDom() {
  const d = dom();
  const w = d.window;
  w.eval(
    'var state={project:"p",taskId:"t1",scheduleOn:true,stageAccepted:{},jobPaused:false,' +
    'boardScope:"project",openTools:{"t1:0":true},cua:false};' +
    'var TASKS=[{id:"t1",title:"标签",pill:"进行中"}];' +
    'function taskBy(){return state._task} function pageTitle(a){return "<h1>"+a+"</h1>"} ' +
    'function ib(){return ""} function ico(){return ""} function demoText(){return ""} ' +
    'function projBy(){return {name:state._project||"项目"}} function botBy(){return {name:"助理"}} ' +
    'function r29Face(){return ""} function cardBy(){return state._card} ' +
    'function decBy(){return state._dec} function isClosed(){return false} ' +
    'function actionButtons(){return ""} function openCount(){return 0} ' +
    'function diffHTML(){return ""} function r29Real(){return false} ' + escFn() +
    'var Hub={registerView(){},taskSectionsSlot(){return ""}};'
  );
  load(w, 'js/views/tasks.js');
  return d;
}

function baseTask() {
  return {
    id: 't1', plan: [[0, '步骤']], who: '谁', bot: 'b', project: 'p', card: 'c',
    pill: '进行中', title: '标题', tokens: '0', gate: 'g',
    tools: [{kind: '读', name: '工具', meta: '元', body: '正文'}]
  };
}

test('任务页标题、状态、计划、项目名和工具信息按文本显示', function () {
  const cases = [
    function (w) { w.state._dec.title = PAYLOAD; },
    function (w) { w.state._dec.summary = PAYLOAD; },
    function (w) { w.state._task.plan[0][1] = PAYLOAD; },
    function (w) { w.state._project = PAYLOAD; },
    function (w) { w.TASKS[0].title = PAYLOAD; },
    function (w) { w.state._task.pill = PAYLOAD; },
    function (w) { w.state._task.title = PAYLOAD; },
    function (w) { w.state._card.title = PAYLOAD; },
    function (w) { w.state._card.sub = PAYLOAD; },
    function (w) { w.state._task.tools[0].kind = PAYLOAD; },
    function (w) { w.state._task.tools[0].meta = PAYLOAD; }
  ];
  cases.forEach(function (set) {
    const d = taskDom();
    const w = d.window;
    w.state._task = baseTask();
    w.state._dec = {title: '决定', summary: '摘要', level: 'L3'};
    w.state._card = {title: '卡', sub: '状态'};
    w.state._project = '项目';
    set(w);
    const box = w.document.createElement('div');
    box.innerHTML = w.taskView();
    assertPlain(box, PAYLOAD);
    d.window.close();
  });
});

function plainDom() {
  const d = dom();
  const w = d.window;
  w.Hub = {h: function () { return h(w, arguments[0], arguments[1], arguments[2]); }};
  load(w, 'modules/plain-talk.js');
  return d;
}

test('确认卡始终露出命令、对象、理由和风险，细节仍收起', function () {
  const d = plainDom();
  const w = d.window;
  const api = w.HubPlainTalk;
  const rm = api.renderCard({
    botName: '助理', tool: 'bash', command: 'rm -rf important', why: '查看文件列表',
    caps: {writeRoots: ['important'], network: false}
  });
  assert.equal(rm.querySelector('details').open, false);
  assert.match(rm.querySelector('h3').textContent, /rm -rf important/);
  assert.match(rm.querySelector('h3').textContent, /它说是为了：查看文件列表/);
  assert.match(rm.querySelector('h3').textContent, /这一步会删除/);
  assert.equal(rm.querySelector('[data-plain-line]').textContent.includes('rm -rf'), false);

  const long = '甲'.repeat(90);
  const clipped = api.renderCard({
    botName: '助理', tool: 'bash', command: long, why: '看看',
    caps: {network: false, writeRoots: ['box']}
  });
  assert.match(clipped.querySelector('h3').textContent, /已省略/);
  assert.equal(clipped.querySelector('h3').textContent.includes(long), false);
  assert.ok(clipped.textContent.includes(long));
  assert.equal(clipped.querySelector('details').open, false);

  const listed = api.renderCard({
    botName: '助理', tool: 'bash', command: 'ls', why: '查看文件列表',
    caps: {network: false}
  });
  assert.equal(listed.textContent.includes('这一步会'), false);

  const online = api.renderCard({
    botName: '助理', tool: 'bash', command: 'curl https://example.com/a',
    why: '查资料', caps: {network: true}
  });
  assert.match(online.querySelector('h3').textContent, /https:\/\/example.com\/a/);
  assert.match(online.querySelector('h3').textContent, /这一步会对外发送/);

  const write = api.renderCard({
    botName: '助理', tool: 'write', title: '摘要', path: 'shared/notes/digest.md', why: '留底'
  });
  assert.match(write.querySelector('.m-plain-talk-fact').textContent, /digest\.md/);
  assert.equal(write.querySelector('details').open, false);

  const gone = api.renderCard({
    botName: '助理', tool: 'delete', path: 'box/old.txt', why: '清掉'
  });
  assert.match(gone.querySelector('h3').textContent, /box\/old\.txt/);
  assert.match(gone.querySelector('h3').textContent, /这一步会删除/);

  const sent = api.renderCard({
    botName: '助理', kind: 'dispatch', toName: '收件人', task: '核对', confirm: true, why: '转交'
  });
  assert.match(sent.querySelector('.m-plain-talk-fact').textContent, /收件人/);

  const over = api.renderCard({
    botName: '助理', tool: 'bash', command: 'cp a b', caps: {network: false, writeRoots: ['a']}
  });
  assert.match(over.querySelector('h3').textContent, /这一步会覆盖/);
  const priv = api.renderCard({
    botName: '助理', tool: 'bash', command: 'sudo ls', caps: {network: false}
  });
  assert.match(priv.querySelector('h3').textContent, /这一步会提权/);

  const nasty = api.renderCard({
    botName: PAYLOAD, tool: 'bash', why: PAYLOAD, command: PAYLOAD,
    caps: {network: false, writeRoots: ['x']}
  });
  assert.equal(nasty.querySelector('img[onerror],script,a[href^="javascript:"]'), null);
  assert.ok(nasty.textContent.includes(PAYLOAD));
  d.window.close();
});

function permissionDom() {
  const d = dom();
  const w = d.window;
  w.Hub = {on: function () {}, toast: function () {}, state: {bots: []}};
  return d;
}

function buttons(w) {
  w.document.body.innerHTML =
    '<button data-r29-permission="ask"></button>' +
    '<button data-r29-permission="readonly"></button>' +
    '<button data-r29-open-permissions></button>';
}

test('权限只认最后一次，失败回到上次成功，服务器档位优先', async function () {
  const d = permissionDom();
  const w = d.window;
  const pending = [];
  w.HubSettings = {
    setPermission: function (mode) {
      return new Promise(function (resolve, reject) {
        pending.push({mode: mode, resolve: resolve, reject: reject});
      });
    }
  };
  load(w, 'js/r29-permissions.js');
  buttons(w);
  w.document.querySelector('[data-r29-permission="ask"]').click();
  w.document.querySelector('[data-r29-permission="readonly"]').click();
  pending[0].resolve({ok: true, mode: 'open'});
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.equal(w.R29Permission.mode, 'readonly');
  pending[1].resolve({ok: true});
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.equal(w.R29Permission.mode, 'readonly');
  d.window.close();

  const d2 = permissionDom();
  const w2 = d2.window;
  const pending2 = [];
  w2.HubSettings = {
    setPermission: function (mode) {
      return new Promise(function (resolve, reject) {
        pending2.push({mode: mode, resolve: resolve, reject: reject});
      });
    }
  };
  load(w2, 'js/r29-permissions.js');
  buttons(w2);
  w2.document.querySelector('[data-r29-permission="ask"]').click();
  w2.document.querySelector('[data-r29-permission="readonly"]').click();
  pending2[1].reject(Error('fail'));
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.equal(w2.R29Permission.mode, 'open');
  d2.window.close();

  const d3 = permissionDom();
  const w3 = d3.window;
  const pending3 = [];
  w3.HubSettings = {
    setPermission: function (mode) {
      return new Promise(function (resolve, reject) {
        pending3.push({mode: mode, resolve: resolve, reject: reject});
      });
    }
  };
  load(w3, 'js/r29-permissions.js');
  buttons(w3);
  w3.document.querySelector('[data-r29-permission="readonly"]').click();
  pending3[0].resolve({ok: true, permission: {mode: 'ask'}});
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.equal(w3.R29Permission.mode, 'ask');
  d3.window.close();

  const d4 = permissionDom();
  const w4 = d4.window;
  let late = null;
  const pending4 = [];
  w4.Hub.openPanel = function () {};
  w4.HubSettings = {
    get: function () { return new Promise(function (resolve) { late = resolve; }); },
    setPermission: function (mode) {
      return new Promise(function (resolve) { pending4.push({mode: mode, resolve: resolve}); });
    }
  };
  load(w4, 'js/r29-permissions.js');
  buttons(w4);
  w4.document.querySelector('[data-r29-open-permissions]').click();
  w4.document.querySelector('[data-r29-permission="readonly"]').click();
  late({permission: {mode: 'open'}});
  pending4[0].resolve({ok: true});
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.equal(w4.R29Permission.mode, 'readonly');
  d4.window.close();
});

test('页面不可见时舞台等待、眨眼和演示定时器停掉', async function () {
  const stage = dom();
  const sw = stage.window;
  sw.state = {bot: 'b', mode: 'stage'};
  sw.Hub = {registerView: function () {}, on: function () {}};
  sw.eval('function demoText(){return ""} function demoFixture(){return []}');
  load(sw, 'js/views/stage.js');
  sw.__ran = 0;
  sw.stageLater(40, function () { sw.__ran = 1; });
  Object.defineProperty(sw.document, 'hidden', {configurable: true, get: function () { return true; }});
  sw.document.dispatchEvent(new sw.Event('visibilitychange'));
  await new Promise(function (r) { setTimeout(r, 80); });
  assert.equal(sw.__ran, 0);
  stage.window.close();

  const live = dom();
  const lw = live.window;
  lw.__hide = false;
  Object.defineProperty(lw.document, 'hidden', {
    configurable: true,
    get: function () { return lw.__hide === true; }
  });
  let cleared = 0;
  const orig = lw.clearInterval.bind(lw);
  lw.clearInterval = function (id) { cleared += 1; return orig(id); };
  load(lw, 'js/r29-lively.js');
  if (lw.document.readyState === 'loading') {
    lw.document.dispatchEvent(new lw.Event('DOMContentLoaded'));
  }
  lw.__hide = true;
  lw.document.dispatchEvent(new lw.Event('visibilitychange'));
  assert.equal(lw.document.documentElement.getAttribute('data-r29-page-hidden'), '1');
  assert.ok(cleared >= 1);
  live.window.close();

  const pet = dom();
  const pw = pet.window;
  const handles = [];
  const origSet = pw.setTimeout.bind(pw);
  const origClear = pw.clearTimeout.bind(pw);
  const clearedIds = [];
  pw.setTimeout = function (fn, ms) {
    const id = origSet(fn, ms);
    handles.push(id);
    return id;
  };
  pw.clearTimeout = function (id) {
    clearedIds.push(id);
    return origClear(id);
  };
  let events = 0;
  pw.HubPetTables = {
    nightQuiet: function () { return false; },
    MOTION: {}, PACK: {}
  };
  pw.HubPetLines = {linesFor: function () { return []; }, setLines: function () {}};
  pw.HubPetFx = {mark: function () { return ''; }};
  pw.HubPetShake = {
    create: function () {
      return {start: function () {}, move: function () { return false; }, stop: function () {}};
    }
  };
  pw.HubPetMachine = {
    create: function () {
      return {
        snapshot: function () {
          return {external: false, pose: 'idle', motion: '', line: '', blinking: false,
            anger: 0, sessions: [], pack: 'idle', reduced: false, frameIndex: 0};
        },
        event: function () { events += 1; },
        setPageHidden: function () {},
        setReduced: function () {},
        arrive: function () {},
        poke: function () {},
        pat: function () {},
        shaken: function () {},
        setSessions: function () {}
      };
    }
  };
  load(pw, 'js/r29-pet/mount.js');
  const slot = pw.document.createElement('div');
  pw.document.body.append(slot);
  pw.HubPetStage.mount(slot, 'bot');
  assert.ok(handles.length >= 6);
  Object.defineProperty(pw.document, 'hidden', {configurable: true, get: function () { return true; }});
  pw.document.dispatchEvent(new pw.Event('visibilitychange'));
  handles.forEach(function (id) { assert.ok(clearedIds.indexOf(id) >= 0); });
  await new Promise(function (r) { setTimeout(r, 20); });
  assert.equal(events, 0);
  pet.window.close();
});
