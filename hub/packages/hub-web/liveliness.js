/*
 * 灵动层 liveliness.js（r27，自写，零依赖，不含任何第三方素材）
 *
 * 作用：给界面壳里的角色加一层「身体动作 + 气泡台词 + 点按反应」，不改壳、不动角色图。
 * 做法：只读壳已有的 [data-pet-stage] 节点及其 data-pet-state 属性（壳的真实状态），
 *       用 Web Animations API 在 stage 外层写 translate / rotate / scale（独立于 transform，
 *       不与壳的挤压回弹、手势位移互相覆盖）。壳里的 animation:none 对这条路径无效，
 *       且只作用于本层写的动作。
 * 铁律：动作只跟随壳报的真实状态，不凭空造「忙」；找不到预期结构就什么都不做。
 * 配置：见 DEFAULTS；浏览器里可在加载前设 window.HubLivelinessConfig 覆盖。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root && root.document) {
    try {
      var pre = root.HubLivelinessConfig || {};
      if (pre.autostart !== false) root.HubLiveliness = api.boot(root, pre);
    } catch (e) { /* 失败就安静退出 */ }
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ---------- 配置（全部参数集中在这里） ----------
  var DEFAULTS = {
    enabled: true,            // 总开关；false 时不挂任何监听、不写任何节点
    storageKey: 'dsh-liveliness', // localStorage 里值为 'off' 时同样整体关闭
    respectReducedMotion: true,   // 系统「减少动态效果」开启时不播任何动作
    intensity: 1,             // 全局动作幅度倍数
    homeBoost: 1.6,           // 首页小头像的幅度补偿（头像矮，幅度要大一些才看得见）
    chatMotion: true,         // 聊天页大角色的常驻动作
    homeMotion: true,         // 首页头像的常驻动作
    homeStartJitterMs: 1500,  // 首页多个头像错开启动，避免齐步走
    dwellMs: 2500,            // 动作曲线最短停留；非紧急状态在停留内被合并成最后一个
    urgent: ['done', 'confused', 'waiting'], // 这些状态不等停留，立刻切
    settleMs: 420,            // 切换时的过渡时长（从当前姿态过渡到新曲线，带一次小弹跳）
    bounce: true,             // 换状态时的小弹跳
    assistants: {},           // 按助理覆盖：{ <id>: { enabled:false, intensity:1, say:false, lines:{ 状态:[句子] } } }
    speech: {
      enabled: true,
      hideMs: 4000,           // 气泡自动收起
      minGapMs: 20000,        // 自发台词的最小间隔
      maxPer10Min: 8,         // 自发台词 10 分钟上限
      noRepeatMs: 30 * 60000, // 同一句 30 分钟内不重复
      afterStateMs: 1200,     // 状态稳定这么久才说话（一闪而过的状态不说）
      quietMs: 2500,          // 非紧急台词：最近有输入/滚动则不说
      chance: { thinking: 0.35, working: 0.35, research: 0.35, done: 0.8, confused: 0.9, waiting: 0.9, wake: 1 },
      lines: {
        thinking: ['让我想想……', '嗯，在想', '稍等，我琢磨一下'],
        working: ['开工了', '手上在忙', '在处理，稍等'],
        research: ['我去查一下', '在翻资料'],
        done: ['好了！', '做好啦', '搞定，你看看'],
        confused: ['没太听明白……', '这句我没懂，再说一次？', '有点卡住了'],
        waiting: ['等你点头', '这一步等你确认', '需要你看一眼'],
        wake: ['唔……你回来啦', '来啦来啦'],
        idle: ['在呢', '随时叫我', '没事，我歇会儿']
      }
    },
    tap: {
      enabled: true,
      comboMs: 900,           // 连点判定窗口
      maxMoveGap: 10,         // 点按期间位移超过它就不算点（让位给横滑/长按）
      maxTapMs: 380,          // 超过它算长按，让位给扇形
      replyGapMs: 1500,       // 点按台词最小间隔
      replyChance: 0.45,      // 单击说话的概率
      lines: {
        one: ['嗯？', '在～', '怎么啦'],
        two: ['诶？', '再戳就……'],
        three: ['别戳啦！', '哎呀！'],
        many: ['好痒……', '你是不是在考验我']
      }
    },
    idle: {
      enabled: true,
      everyMs: 60000,         // 闲着的小动作：平均间隔下限
      jitterMs: 40000,
      probability: 0.5,
      quietMs: 8000,          // 最近 8 秒有操作就不动
      lineChance: 0.3
    }
  };

  // ---------- 小工具 ----------
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  // 深合并：用户配置覆盖默认，数组整体替换
  function merge(base, over) {
    var out = {};
    Object.keys(base).forEach(function (k) {
      out[k] = isObj(base[k]) ? merge(base[k], {}) : (Array.isArray(base[k]) ? base[k].slice() : base[k]);
    });
    if (!isObj(over)) return out;
    Object.keys(over).forEach(function (k) {
      if (isObj(over[k]) && isObj(out[k])) out[k] = merge(out[k], over[k]);
      else if (isObj(over[k])) out[k] = merge({}, over[k]);
      else out[k] = Array.isArray(over[k]) ? over[k].slice() : over[k];
    });
    return out;
  }

  function px(v) { return (Math.round(v * 100) / 100) + 'px'; }

  // 一帧：位移和幅度用「占角色高度的百分比」写，运行时换算成 px
  function F(dx, dy, rot, sx, sy) {
    return { dx: dx || 0, dy: dy || 0, rot: rot || 0, sx: sx == null ? 1 : sx, sy: sy == null ? 1 : sy };
  }

  // 状态 → 身体曲线。只按壳报的状态走；未知状态按待机处理。
  var CURVES = {
    idle: { dur: 3200, frames: [F(0, 0), F(0, -2.5), F(0, 0)] },
    thinking: { dur: 3000, frames: [F(0, 0, -2.5), F(0, -0.8, 2.5), F(0, 0, -2.5)] },
    research: { dur: 2400, frames: [F(0, 0, -1.5), F(0, -1.2, 1.5), F(0, 0, -1.5)] },
    working: { dur: 450, frames: [F(0, 0), F(0, -1.8), F(0, 0)] },
    waiting: { dur: 4200, frames: [F(0, 0), F(0, -0.6, 0, 1.012, 1.02), F(0, 0)] },
    done: { dur: 700, iter: 3, tail: 'idle',
      frames: [F(0, 0, 0, 1.02, 0.98), F(0, -9, 0, 0.98, 1.02), F(0, 0, 0, 1.02, 0.98)] },
    confused: { dur: 1100, iter: 3, tail: 'idle', frames: [F(0, 0, -3.5), F(0, 0, 3.5), F(0, 0, -3.5)] },
    drowsy: { dur: 4000, frames: [F(0, 0.6, 1.2), F(0, 1.4, 2.2), F(0, 0.6, 1.2)] },
    sleep: { dur: 4500, frames: [F(0, 0.8), F(0, 0.8, 0, 1.012, 1.02), F(0, 0.8)] }
  };

  // 状态 → 曲线名（壳的 greet/poke/idleB/wake/drag 等自带动图，本层按待机处理）
  function curveName(state) { return CURVES[state] ? state : 'idle'; }

  // 挑一句台词：去掉窗口内说过的，随机取一句；都说过则返回 null
  function pickLine(lines, history, now, noRepeatMs, rand) {
    if (!Array.isArray(lines) || !lines.length) return null;
    var ok = lines.filter(function (s) { return !(history[s] && now - history[s] < noRepeatMs); });
    if (!ok.length) return null;
    return ok[Math.floor(rand() * ok.length) % ok.length];
  }

  // 自发台词频率闸：间隔 + 10 分钟上限
  function speechAllowed(log, now, cfg) {
    var recent = log.filter(function (t) { return now - t < 600000; });
    if (recent.length >= cfg.maxPer10Min) return false;
    return !recent.length || now - recent[recent.length - 1] >= cfg.minGapMs;
  }

  var STYLE = [
    '.lv-bubble{position:fixed;left:0;top:0;z-index:40;max-width:min(220px,calc(100vw - 24px));padding:6px 10px;',
    'border-radius:12px;font:500 13px/1.35 system-ui,-apple-system,sans-serif;color:var(--ink,#222);',
    'background:var(--elev,#fff);border:1px solid rgba(128,128,128,.3);box-shadow:0 2px 10px rgba(0,0,0,.12);',
    'pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .3s,transform .3s;',
    'visibility:hidden}',
    '.lv-bubble.on{opacity:1;transform:none;visibility:visible}',
    '.lv-bubble:after{content:"";position:absolute;left:var(--lv-tail,24px);bottom:-5px;width:8px;height:8px;',
    'background:inherit;border:inherit;border-top:0;border-left:0;transform:rotate(45deg)}',
    '@media(prefers-reduced-motion:reduce){.lv-bubble{transition:none;transform:none}}'
  ].join('');

  // ---------- 主体 ----------
  function createLayer(env, userCfg) {
    var win = env.win, doc = env.doc;
    var cfg = merge(DEFAULTS, userCfg);
    var now = env.now || function () { return Date.now(); };
    var rand = env.random || Math.random;
    var st = env.setTimeout || function (f, ms) { return win.setTimeout(f, ms); };
    var ct = env.clearTimeout || function (t) { win.clearTimeout(t); };
    var recs = [], timers = {}, history = {}, speechLog = [];
    var started = false, mo = null, bodyMo = null, mq = null, ticker = null, onScan = null;
    var lastActivity = 0, nextMicro = 0, bubble = null, bubbleTimer = null, lastTapSay = 0;
    var taps = [], press = null, lastTapAt = 0, listeners = [];

    function asst(id) { return (cfg.assistants && cfg.assistants[id]) || {}; }
    function isReduced() {
      if (!cfg.respectReducedMotion || !win.matchMedia) return false;
      try { return !!win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    }
    function hidden() { return !!doc.hidden; }
    function keyboardOn() { return !!(doc.body && doc.body.classList && doc.body.classList.contains('keyboard')); }

    // 这个角色现在能不能动
    function canMove(rec) {
      if (!cfg.enabled || isReduced() || hidden() || !rec.el.isConnected) return false;
      if (asst(rec.id).enabled === false) return false;
      if (rec.slot === 'home' ? !cfg.homeMotion : !cfg.chatMotion) return false;
      if (rec.slot !== 'home' && keyboardOn()) return false;
      return !(rec.el.getClientRects && rec.el.getClientRects().length === 0);
    }

    function height(rec) { return rec.el.offsetHeight || 100; }
    function amp(rec) {
      var k = cfg.intensity * (asst(rec.id).intensity == null ? 1 : asst(rec.id).intensity);
      return k * (rec.slot === 'home' ? cfg.homeBoost : 1);
    }

    // 帧 → 关键帧（独立 transform 属性；transform-origin 只在动画期间设到脚底）
    function toKeyframe(rec, f, k) {
      var h = height(rec) / 100;
      return {
        translate: px(f.dx * k * h) + ' ' + px(f.dy * k * h),
        rotate: (f.rot * k) + 'deg',
        scale: (1 + (f.sx - 1) * k) + ' ' + (1 + (f.sy - 1) * k),
        transformOrigin: '50% 100%'
      };
    }

    function snapshot(rec) {
      var cs;
      try { cs = win.getComputedStyle(rec.el); } catch (e) { cs = {}; }
      return { translate: cs.translate || 'none', rotate: cs.rotate || 'none', scale: cs.scale || 'none',
        transformOrigin: '50% 100%' };
    }

    function cancelAnim(a) { try { if (a) a.cancel(); } catch (e) { /* 忽略 */ } }
    function stopRec(rec) {
      if (rec.timer) { ct(rec.timer); rec.timer = null; }
      if (rec.startTimer) { ct(rec.startTimer); rec.startTimer = null; }
      cancelAnim(rec.trans); cancelAnim(rec.loop);
      rec.trans = rec.loop = null;
      (rec.reacts || []).forEach(cancelAnim);
      rec.reacts = [];
      rec.state = null;
    }

    // 起循环动作；withBounce 时先做一次「当前姿态 → 弹一下 → 曲线起点」的过渡
    function playLoop(rec, name, withBounce, bounceSize, direct) {
      var c = CURVES[name], k = amp(rec), keys = c.frames.map(function (f) { return toKeyframe(rec, f, k); });
      var cur = snapshot(rec);
      cancelAnim(rec.trans); cancelAnim(rec.loop);
      function startLoop() {
        var a = rec.el.animate(keys, { duration: c.dur, iterations: c.iter || Infinity, easing: 'ease-in-out' });
        cancelAnim(rec.trans); rec.trans = null; rec.loop = a;
        if (c.tail) {
          a.onfinish = function () {
            if (rec.loop === a && rec.state === name) { rec.loop = null; playLoop(rec, c.tail, false); }
          };
        }
      }
      if (direct || !cfg.settleMs || !rec.el.animate) { startLoop(); return; }
      var pop = toKeyframe(rec, F(0, -4 * (bounceSize || 1), 0, 0.98, 1.03), k);
      var frames = withBounce && cfg.bounce ? [cur, pop, keys[0]] : [cur, keys[0]];
      if (frames.length === 3) frames[1].offset = 0.4;
      var t = rec.el.animate(frames, { duration: cfg.settleMs, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'forwards' });
      rec.trans = t;
      t.onfinish = function () { if (rec.trans === t) startLoop(); };
    }

    function apply(rec) {
      rec.timer = null;
      var target = rec.target;
      if (!canMove(rec) || target === rec.state) return;
      var prev = rec.state, name = curveName(target);
      rec.state = target; rec.appliedAt = now();
      var waking = (prev === 'sleep' || prev === 'drowsy') && target !== 'sleep' && target !== 'drowsy';
      var changed = prev !== null && curveName(prev) !== name;
      // 同一条曲线内换状态（如待机 ↔ 壳自带的小动作）不重起动作，避免打断常驻节奏
      if (prev === null || changed || waking || !(rec.loop || rec.trans)) {
        playLoop(rec, name, changed || waking, waking ? 1.6 : 1);
      }
      if (prev !== null) afterChange(rec, target, waking);
    }

    // 状态请求：非紧急状态遵守最短停留，且合并为最后一个
    function request(rec, target) {
      if (rec.target === target && (rec.state === target || rec.timer)) return;
      rec.target = target;
      if (rec.timer) { ct(rec.timer); rec.timer = null; }
      if (rec.state === target) return;
      if (rec.state === null) { startFirst(rec); return; }
      var urgent = cfg.urgent.indexOf(target) >= 0;
      var wait = urgent ? 0 : Math.max(0, rec.appliedAt + cfg.dwellMs - now());
      if (wait > 0) rec.timer = st(function () { apply(rec); }, wait);
      else apply(rec);
    }

    function startFirst(rec) {
      if (rec.startTimer) return;
      var delay = rec.slot === 'home' ? Math.floor(rand() * cfg.homeStartJitterMs) : 0;
      rec.startTimer = st(function () {
        rec.startTimer = null;
        if (!canMove(rec)) return;
        rec.state = rec.target; rec.appliedAt = now();
        playLoop(rec, curveName(rec.target), false, 1, true);
      }, delay);
    }

    // ---------- 台词 ----------
    function ensureBubble() {
      if (bubble || !doc.body) return bubble;
      var s = doc.getElementById && doc.getElementById('lv-style');
      if (!s) {
        s = doc.createElement('style'); s.id = 'lv-style'; s.textContent = STYLE; (doc.head || doc.body).appendChild(s);
      }
      bubble = doc.createElement('div');
      bubble.className = 'lv-bubble'; bubble.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(bubble);
      return bubble;
    }

    function place(rec) {
      var fig = (rec.el.closest && rec.el.closest('.r22-pet-figure')) || rec.el;
      var r = fig.getBoundingClientRect(), b = bubble, vw = win.innerWidth || 375;
      var bw = b.offsetWidth || 120, bh = b.offsetHeight || 30;
      var left = Math.max(8, Math.min(vw - bw - 8, r.left + r.width / 2 - 24));
      b.style.left = left + 'px';
      b.style.top = Math.max(8, r.top + 12 - bh) + 'px'; // 图框顶部到角色头顶有空白，向下收 12px
      b.style.setProperty('--lv-tail', Math.max(10, Math.min(bw - 22, r.left + r.width / 2 - left - 4)) + 'px');
    }

    function chatRec() {
      return recs.filter(function (r) {
        return r.slot !== 'home' && r.el.isConnected && !(r.el.getClientRects && r.el.getClientRects().length === 0);
      })[0] || null;
    }

    // 出一句台词（已通过频率闸）；没有可见的聊天角色就不出
    function show(text, rec) {
      if (!text || !rec || !ensureBubble()) return false;
      bubble.textContent = text;
      place(rec);
      bubble.classList.add('on');
      if (bubbleTimer) ct(bubbleTimer);
      bubbleTimer = st(function () { bubble.classList.remove('on'); bubbleTimer = null; }, cfg.speech.hideMs);
      return true;
    }

    function linesFor(id, key) {
      var o = asst(id).lines;
      return (o && o[key]) || cfg.speech.lines[key];
    }

    function sayState(rec, key, urgent) {
      var sp = cfg.speech;
      if (!sp.enabled || asst(rec.id).say === false || rec.slot === 'home' || hidden()) return;
      var t = now();
      if (!urgent && t - lastActivity < sp.quietMs) return;
      if (!speechAllowed(speechLog, t, sp)) return;
      if (rand() >= (sp.chance[key] == null ? 0 : sp.chance[key])) return;
      var line = pickLine(linesFor(rec.id, key), history, t, sp.noRepeatMs, rand);
      if (line && show(line, rec)) { history[line] = t; speechLog.push(t); }
    }

    // 状态变化之后：稳定一会儿再说，一闪而过的状态不说
    function afterChange(rec, target, waking) {
      var key = waking ? 'wake' : target;
      if (!cfg.speech.chance[key]) return;
      var wasTap = now() - lastTapAt < 2000;
      if (waking && !wasTap) return;
      var token = rec.appliedAt;
      st(function () {
        if (rec.appliedAt !== token || rec.state !== target) return;
        sayState(rec, key, cfg.urgent.indexOf(target) >= 0 || waking);
      }, waking ? 200 : cfg.speech.afterStateMs);
    }

    // ---------- 点按反应（只读事件，不拦截、不 preventDefault） ----------
    function react(rec, keys, opts) {
      if (!rec || !rec.el.animate || !canMove(rec)) return null;
      var a = rec.el.animate(keys, opts);
      rec.reacts.push(a);
      a.onfinish = a.oncancel = function () { rec.reacts = rec.reacts.filter(function (x) { return x !== a; }); };
      return a;
    }

    function hop(rec, size) {
      var h = height(rec) / 100 * size * amp(rec);
      var keys = [{ translate: '0px 0px' }, { translate: '0px ' + px(-h), offset: 0.35 }, { translate: '0px 0px' }];
      return react(rec, keys, { duration: 420, easing: 'cubic-bezier(.3,1.6,.5,1)' });
    }
    function shake(rec) {
      var keys = ['0deg', '-5deg', '5deg', '-3deg', '0deg'].map(function (d) { return { rotate: d }; });
      return react(rec, keys, { duration: 520, easing: 'ease-in-out' });
    }
    function stretch(rec) {
      return react(rec, [{ scale: '1 1' }, { scale: '.97 1.06', offset: 0.45 }, { scale: '1 1' }],
        { duration: 1100, easing: 'ease-in-out' });
    }
    function look(rec) {
      return react(rec, [{ rotate: '0deg' }, { rotate: '-4deg' }, { rotate: '4deg' }, { rotate: '0deg' }],
        { duration: 1600, easing: 'ease-in-out' });
    }

    function tapRec(el) {
      var stage = el && el.querySelector && el.querySelector('[data-pet-stage]');
      return recs.filter(function (r) { return r.el === stage; })[0] || null;
    }

    // 一次点按：1 下小跳，2 下大一点，3 下抖，更多就嘟囔；连点与单击回应不同
    function onTap(rec) {
      var t = now();
      taps = taps.filter(function (x) { return t - x < cfg.tap.comboMs; });
      taps.push(t); lastTapAt = t;
      var n = taps.length, key = n >= 4 ? 'many' : n === 3 ? 'three' : n === 2 ? 'two' : 'one';
      if (n === 1) hop(rec, 3.5); else if (n === 2) hop(rec, 6); else shake(rec);
      if (t - lastTapSay < cfg.tap.replyGapMs || asst(rec.id).say === false || !cfg.speech.enabled) return;
      if (n === 1 && rand() >= cfg.tap.replyChance) return;
      var sleeping = rec.state === 'sleep' || rec.state === 'drowsy';
      var pool = sleeping && n === 1 ? cfg.speech.lines.wake : linesFor(rec.id, 'tap_' + key) || cfg.tap.lines[key];
      var line = pickLine(pool, history, t, 4000, rand);
      if (line && show(line, rec)) { lastTapSay = t; history[line] = t; }
    }

    function figureOf(e) { return e.target && e.target.closest ? e.target.closest('.r22-pet-figure') : null; }

    function releasePress(rec) {
      if (!press) return;
      var p = press; press = null;
      cancelAnim(p.anim);
      if (rec) {
        react(rec, [{ scale: '1.04 .94' }, { scale: '1 1' }], { duration: 380, easing: 'cubic-bezier(.3,1.6,.5,1)' });
      }
    }

    function onDown(e) {
      if (!cfg.enabled || !cfg.tap.enabled || e.isPrimary === false) return;
      lastActivity = now();
      var fig = figureOf(e);
      if (!fig) return;
      var rec = tapRec(fig);
      if (!rec) return;
      var a = rec.el.animate && canMove(rec) ? rec.el.animate([{ scale: '1 1' }, { scale: '1.04 .94' }],
        { duration: 140, easing: 'ease-out', fill: 'forwards' }) : null;
      press = { x: e.clientX, y: e.clientY, t: now(), rec: rec, anim: a };
    }
    function onMove(e) {
      lastActivity = now();
      if (!press) return;
      if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > cfg.tap.maxMoveGap) releasePress(press.rec);
    }
    function onUp(e) {
      if (!press) return;
      var p = press, dt = now() - p.t;
      var moved = Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > cfg.tap.maxMoveGap;
      releasePress(p.rec);
      if (!moved && dt < cfg.tap.maxTapMs && e.type === 'pointerup') onTap(p.rec);
    }
    function onCancel() { if (press) releasePress(press.rec); }
    function onActivity() { lastActivity = now(); }

    // ---------- 扫描、定时 ----------
    function scan() {
      if (!cfg.enabled) return;
      var list = doc.querySelectorAll('[data-pet-stage]');
      var live = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i], rec = null;
        for (var j = 0; j < recs.length; j++) if (recs[j].el === el) { rec = recs[j]; break; }
        if (!rec) {
          rec = { el: el, id: el.getAttribute('data-pet-assistant') || '',
            slot: el.getAttribute('data-pet-stage') || 'chat', state: null, target: null, appliedAt: 0,
            timer: null, startTimer: null, trans: null, loop: null, reacts: [] };
          recs.push(rec);
        }
        live.push(rec);
        var s = el.getAttribute('data-pet-state') || 'idle';
        if (!canMove(rec)) { if (rec.state !== null || rec.trans || rec.loop) stopRec(rec); rec.target = s; continue; }
        request(rec, s);
      }
      recs = recs.filter(function (r) { if (live.indexOf(r) < 0) { stopRec(r); return false; } return true; });
    }

    function schedule() {
      if (timers.scan) return;
      timers.scan = st(function () { timers.scan = null; scan(); }, 30);
    }

    function pauseAll(paused) {
      recs.forEach(function (r) {
        [r.trans, r.loop].forEach(function (a) {
          try { if (a) { if (paused) a.pause(); else a.play(); } } catch (e) { /* 忽略 */ }
        });
      });
    }

    // 闲着的小动作：只在待机、安静时偶尔动一下；睡着/干活时不动
    function microTick() {
      var t = now(), c = cfg.idle;
      if (!c.enabled || t < nextMicro) return;
      nextMicro = t + c.everyMs + rand() * c.jitterMs;
      if (hidden() || isReduced() || t - lastActivity < c.quietMs || rand() >= c.probability) return;
      var cands = recs.filter(function (r) { return r.state === 'idle' && canMove(r); });
      if (!cands.length) return;
      var rec = cands[Math.floor(rand() * cands.length) % cands.length];
      var pick = rand();
      if (pick < 0.4) stretch(rec); else if (pick < 0.75) look(rec); else hop(rec, 2.5);
      if (rec.slot !== 'home' && rand() < c.lineChance) sayState(rec, 'idle', false);
    }

    function tick() {
      if (!cfg.enabled) return;
      scan(); microTick();
    }

    function on(target, type, fn) {
      target.addEventListener(type, fn, { capture: true, passive: true });
      listeners.push([target, type, fn]);
    }

    function start() {
      if (started || !cfg.enabled || !doc.body) return false;
      started = true;
      nextMicro = now() + cfg.idle.everyMs + rand() * cfg.idle.jitterMs;
      if (win.MutationObserver) {
        mo = new win.MutationObserver(schedule);
        mo.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-pet-state'] });
        bodyMo = new win.MutationObserver(schedule);
        bodyMo.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
      }
      if (win.matchMedia) {
        try {
          mq = win.matchMedia('(prefers-reduced-motion: reduce)'); mq.addEventListener('change', schedule);
        } catch (e) { mq = null; }
      }
      onScan = function () { if (hidden()) pauseAll(true); else { pauseAll(false); schedule(); } };
      doc.addEventListener('visibilitychange', onScan);
      on(doc, 'pointerdown', onDown); on(doc, 'pointermove', onMove);
      on(doc, 'pointerup', onUp); on(doc, 'pointercancel', onCancel);
      ['keydown', 'input', 'scroll', 'touchstart'].forEach(function (t) { on(doc, t, onActivity); });
      ticker = (env.setInterval || function (f, ms) { return win.setInterval(f, ms); })(tick, 2000);
      scan();
      return true;
    }

    function stop() {
      started = false;
      if (mo) mo.disconnect(); if (bodyMo) bodyMo.disconnect(); mo = bodyMo = null;
      if (mq) { try { mq.removeEventListener('change', schedule); } catch (e) { /* 忽略 */ } mq = null; }
      if (onScan) doc.removeEventListener('visibilitychange', onScan);
      listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], { capture: true }); });
      listeners = [];
      if (ticker != null) { (env.clearInterval || function (t) { win.clearInterval(t); })(ticker); ticker = null; }
      if (timers.scan) { ct(timers.scan); timers.scan = null; }
      if (bubbleTimer) { ct(bubbleTimer); bubbleTimer = null; }
      recs.forEach(stopRec); recs = [];
      if (bubble && bubble.remove) bubble.remove();
      bubble = null; press = null;
    }

    return {
      config: cfg,
      start: start,
      stop: stop,
      // 整体开关：关掉后页面回到没有灵动层的样子
      enable: function () { cfg.enabled = true; return start(); },
      disable: function () { cfg.enabled = false; stop(); },
      // 手动说一句（仍走频率闸以外的显示，仅供调试/外部调用）
      say: function (text) { return show(String(text || ''), chatRec()); },
      scan: scan,
      records: function () { return recs; },
      _test: { onTap: onTap, request: request, apply: apply, microTick: microTick,
        setActivity: function (t) { lastActivity = t; },
        history: history, speechLog: speechLog, curveName: curveName }
    };
  }

  // 浏览器入口：读开关、起层；返回对象方便控制台排查
  function boot(win, userCfg) {
    var cfg = userCfg || {};
    var key = (cfg.storageKey || DEFAULTS.storageKey);
    try {
      if (win.localStorage && win.localStorage.getItem(key) === 'off') cfg = merge(cfg, { enabled: false });
    } catch (e) { /* 忽略 */ }
    var layer = createLayer({ win: win, doc: win.document }, cfg);
    if (!layer.config.enabled) return layer;
    var go = function () { try { layer.start(); } catch (e) { /* 失败就安静退出 */ } };
    if (win.document.body) go(); else win.document.addEventListener('DOMContentLoaded', go);
    return layer;
  }

  return { DEFAULTS: DEFAULTS, CURVES: CURVES, merge: merge, pickLine: pickLine, speechAllowed: speechAllowed,
    curveName: curveName, createLayer: createLayer, boot: boot };
});
