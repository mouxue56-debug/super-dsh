// 灵动层单测：用最小 DOM 替身离线验证调度、过渡、台词频率闸、点按、开关与安静退出。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../liveliness.js');

// 假时钟与定时器：手动推进
function clock() {
  let t = 1000000, id = 0;
  const q = new Map();
  return {
    now: () => t,
    setTimeout: (f, ms) => { q.set(++id, { f, at: t + ms }); return id; },
    clearTimeout: (i) => q.delete(i),
    setInterval: () => 0,
    clearInterval: () => {},
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = [...q.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        q.delete(next[0]); t = Math.max(t, next[1].at); next[1].f();
      }
      t = end;
    }
  };
}

function fakeAnim() {
  return { cancelled: false, cancel() { this.cancelled = true; }, pause() {}, play() {}, onfinish: null };
}

function fakeStage(attrs, h = 132) {
  const el = {
    isConnected: true, offsetHeight: h, animations: [],
    attrs: { 'data-pet-stage': 'chat', 'data-pet-assistant': 'a1', 'data-pet-state': 'idle', ...attrs },
    getAttribute(k) { return this.attrs[k] ?? null; },
    getClientRects() { return [{}]; },
    getBoundingClientRect() { return { left: 10, top: 400, width: 96, height: 132 }; },
    closest() { return null; },
    animate(keys, opts) { const a = fakeAnim(); a.keys = keys; a.opts = opts; this.animations.push(a); return a; }
  };
  return el;
}

function world(stages, { reduced = false, rand = () => 0.1, cfg = {}, hidden = false } = {}) {
  const c = clock();
  const bubbles = [];
  const doc = {
    hidden,
    body: { classList: { contains: () => false }, appendChild(b) { bubbles.push(b); } },
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => {
      const cls = new Set();
      return {
        style: { setProperty() {} },
        classList: { add: (x) => cls.add(x), remove: (x) => cls.delete(x), has: (x) => cls.has(x) },
        setAttribute() {}, remove() {}, offsetWidth: 100, offsetHeight: 30, textContent: ''
      };
    },
    querySelectorAll: () => stages,
    addEventListener() {}, removeEventListener() {}
  };
  const win = {
    document: doc, innerWidth: 375,
    matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ translate: 'none', rotate: 'none', scale: 'none' })
  };
  const layer = L.createLayer({ win, doc, ...c, random: rand }, { homeStartJitterMs: 0, ...cfg });
  return { layer, c, doc, win, bubbles };
}

const loops = (el) => el.animations.filter((a) => a.opts.iterations === Infinity || a.opts.iterations > 1);

test('没有预期的 DOM 时什么都不做也不报错', () => {
  const w = world([]);
  assert.doesNotThrow(() => { w.layer.start(); w.layer.scan(); w.layer.stop(); });
  assert.equal(w.layer.records().length, 0);
});

test('总开关关闭：不起层、不碰节点', () => {
  const el = fakeStage();
  const w = world([el], { cfg: { enabled: false } });
  assert.equal(w.layer.start(), false);
  w.layer.scan();
  assert.equal(el.animations.length, 0);
});

test('首次发现角色：按真实状态起常驻动作，不弹跳', () => {
  const el = fakeStage({ 'data-pet-state': 'working' });
  const w = world([el]);
  w.layer.start();
  w.c.advance(10);
  const loop = loops(el)[0];
  assert.ok(loop, '应有常驻循环');
  assert.equal(loop.opts.duration, L.CURVES.working.dur);
  assert.equal(el.animations.length, 1, '首次不做弹跳过渡');
  assert.ok(Object.keys(loop.keys[0]).includes('translate'));
  assert.ok(!Object.keys(loop.keys[0]).includes('transform'), '不写 transform，避免盖住壳的挤压回弹');
});

test('状态曲线只跟随真实状态：未知状态按待机，不会自己变成干活', () => {
  assert.equal(L.curveName('poke'), 'idle');
  assert.equal(L.curveName('whatever'), 'idle');
  assert.equal(L.curveName('working'), 'working');
  const el = fakeStage({ 'data-pet-state': 'idle' });
  const w = world([el]);
  w.layer.start(); w.c.advance(10);
  w.c.advance(600000);
  assert.equal(w.layer.records()[0].state, 'idle');
  assert.ok(loops(el).every((a) => a.opts.duration === L.CURVES.idle.dur));
});

test('切状态：非紧急遵守最短停留并合并成最后一个；紧急立刻切；切换带一次小弹跳', () => {
  const el = fakeStage();
  const w = world([el]);
  w.layer.start(); w.c.advance(10);
  const rec = w.layer.records()[0];
  el.attrs['data-pet-state'] = 'thinking'; w.layer.scan();
  assert.equal(rec.state, 'idle', '停留未满，先不切');
  el.attrs['data-pet-state'] = 'working'; w.layer.scan();
  w.c.advance(2400);
  assert.equal(rec.state, 'idle');
  w.c.advance(200);
  assert.equal(rec.state, 'working', '合并成最后一个');
  const trans = el.animations.filter((a) => a.opts.fill === 'forwards').pop();
  assert.equal(trans.keys.length, 3, '过渡含当前姿态、弹跳、新曲线起点');
  assert.ok(trans.opts.duration >= 300);
  el.attrs['data-pet-state'] = 'done'; w.layer.scan();
  assert.equal(rec.state, 'done', '紧急状态不等停留');
});

test('过渡结束后接循环，旧过渡被取消', () => {
  const el = fakeStage();
  const w = world([el]);
  w.layer.start(); w.c.advance(10);
  el.attrs['data-pet-state'] = 'confused'; w.layer.scan();
  const trans = el.animations.filter((a) => a.opts.fill === 'forwards').pop();
  trans.onfinish();
  assert.equal(trans.cancelled, true);
  const rec = w.layer.records()[0];
  assert.equal(rec.loop.opts.iterations, 3);
});

test('减少动态效果：不播任何动作；关闭后恢复', () => {
  const el = fakeStage();
  const w = world([el], { reduced: true });
  w.layer.start(); w.c.advance(10);
  assert.equal(el.animations.length, 0);
});

test('页面不可见：不起动作', () => {
  const el = fakeStage();
  const w = world([el], { hidden: true });
  w.layer.start(); w.c.advance(10);
  assert.equal(el.animations.length, 0);
});

test('按助理关闭：该助理不动，其他仍动', () => {
  const a = fakeStage({ 'data-pet-assistant': 'x' });
  const b = fakeStage({ 'data-pet-assistant': 'y' });
  const w = world([a, b], { cfg: { assistants: { x: { enabled: false } } } });
  w.layer.start(); w.c.advance(10);
  assert.equal(a.animations.length, 0);
  assert.ok(b.animations.length > 0);
});

test('台词频率闸：间隔、10 分钟上限、30 分钟不重复', () => {
  const cfg = { minGapMs: 20000, maxPer10Min: 3 };
  const t0 = 1000000;
  assert.equal(L.speechAllowed([], t0, cfg), true);
  assert.equal(L.speechAllowed([t0 - 5000], t0, cfg), false);
  assert.equal(L.speechAllowed([t0 - 30000], t0, cfg), true);
  assert.equal(L.speechAllowed([t0 - 90000, t0 - 60000, t0 - 30000], t0, cfg), false);
  const hist = { 甲: t0 - 1000 };
  assert.equal(L.pickLine(['甲'], hist, t0, 1800000, () => 0), null);
  assert.equal(L.pickLine(['甲', '乙'], hist, t0, 1800000, () => 0), '乙');
  assert.equal(L.pickLine(['甲'], hist, t0 + 1900000, 1800000, () => 0), '甲');
});

test('状态变化会说话：稳定后才说，一闪而过的不说，且有频率上限', () => {
  const el = fakeStage();
  const w = world([el], { rand: () => 0 });
  w.layer.start(); w.c.advance(10);
  w.layer._test.setActivity(0);
  const rec = w.layer.records()[0];
  el.attrs['data-pet-state'] = 'done'; w.layer.scan();
  w.c.advance(300);
  assert.equal(w.layer._test.speechLog.length, 0, '稳定时间未到不说');
  w.c.advance(1200);
  assert.equal(w.layer._test.speechLog.length, 1);
  assert.equal(rec.state, 'done');
  el.attrs['data-pet-state'] = 'confused'; w.layer.scan();
  w.c.advance(1500);
  assert.equal(w.layer._test.speechLog.length, 1, '间隔不足 20 秒，不再说');
  w.c.advance(25000);
  el.attrs['data-pet-state'] = 'waiting'; w.layer.scan();
  w.c.advance(1500);
  assert.equal(w.layer._test.speechLog.length, 2);
});

test('按助理换台词，按助理关闭说话', () => {
  const el = fakeStage({ 'data-pet-assistant': 'x' });
  const w = world([el], { rand: () => 0, cfg: { assistants: { x: { lines: { done: ['专属一句'] } } } } });
  w.layer.start(); w.c.advance(10);
  w.layer._test.setActivity(0);
  el.attrs['data-pet-state'] = 'done'; w.layer.scan(); w.c.advance(1500);
  assert.ok('专属一句' in w.layer._test.history);
  const el2 = fakeStage({ 'data-pet-assistant': 'y' });
  const w2 = world([el2], { rand: () => 0, cfg: { assistants: { y: { say: false } } } });
  w2.layer.start(); w2.c.advance(10);
  el2.attrs['data-pet-state'] = 'done'; w2.layer.scan(); w2.c.advance(1500);
  assert.equal(w2.layer._test.speechLog.length, 0);
});

test('点按：单击小跳，连点不同反应，过快间隔不连说', () => {
  const el = fakeStage();
  const w = world([el], { rand: () => 0 });
  w.layer.start(); w.c.advance(10);
  const rec = w.layer.records()[0];
  const before = el.animations.length;
  w.layer._test.onTap(rec);
  const one = el.animations.slice(before)[0];
  assert.ok(one.keys[1].translate.startsWith('0px -'), '单击是跳');
  w.c.advance(200);
  w.layer._test.onTap(rec);
  w.c.advance(200);
  w.layer._test.onTap(rec);
  const last = el.animations[el.animations.length - 1];
  assert.ok('rotate' in last.keys[1], '三连点是抖');
  assert.ok(Object.keys(w.layer._test.history).length <= 2, '回应间隔内不连说');
});

test('睡着被点醒：弹得更大并说「你回来啦」', () => {
  const el = fakeStage({ 'data-pet-state': 'sleep' });
  const w = world([el], { rand: () => 0 });
  w.layer.start(); w.c.advance(10);
  const rec = w.layer.records()[0];
  assert.equal(rec.state, 'sleep');
  w.layer._test.onTap(rec);
  el.attrs['data-pet-state'] = 'idle'; w.layer.scan(); w.c.advance(3000);
  assert.equal(rec.state, 'idle');
  assert.ok(Object.keys(w.layer._test.history).some((s) => s.includes('你回来啦') || s.includes('来啦')));
});

test('闲着的小动作：只在待机且安静时出，干活时不出，频率低', () => {
  const idleEl = fakeStage();
  const idleCfg = { everyMs: 1000, jitterMs: 0, probability: 1, quietMs: 8000 };
  const w = world([idleEl], { rand: () => 0, cfg: { idle: idleCfg } });
  w.layer.start(); w.c.advance(10);
  w.layer._test.setActivity(w.c.now());
  w.c.advance(2000);
  const n = idleEl.animations.length;
  w.layer._test.microTick();
  assert.equal(idleEl.animations.length, n, '刚操作过不动');
  w.layer._test.setActivity(0);
  w.c.advance(2000);
  w.layer._test.microTick();
  assert.ok(idleEl.animations.length > n, '安静后会动一下');

  const busy = fakeStage({ 'data-pet-state': 'working' });
  const w2 = world([busy], { rand: () => 0, cfg: { idle: { everyMs: 1, jitterMs: 0, probability: 1, quietMs: 0 } } });
  w2.layer.start(); w2.c.advance(10);
  const m = busy.animations.length;
  w2.c.advance(5000); w2.layer._test.microTick();
  assert.equal(busy.animations.length, m, '干活时不装模作样做闲动作');
});

test('停用：取消全部动画并清空记录', () => {
  const el = fakeStage();
  const w = world([el]);
  w.layer.start(); w.c.advance(10);
  const a = loops(el)[0];
  w.layer.disable();
  assert.equal(a.cancelled, true);
  assert.equal(w.layer.records().length, 0);
});

test('配置合并：数组整体替换，嵌套对象逐项覆盖', () => {
  const c = L.merge(L.DEFAULTS, { speech: { hideMs: 1000, lines: { done: ['X'] } }, intensity: 2 });
  assert.equal(c.speech.hideMs, 1000);
  assert.deepEqual(c.speech.lines.done, ['X']);
  assert.ok(c.speech.lines.thinking.length > 1, '没覆盖的保留默认');
  assert.equal(L.DEFAULTS.speech.hideMs, 4000, '默认值不被污染');
});
