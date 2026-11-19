/* R25：只在容器上做身体曲线；素材选择、点戳和全局指挥仍由角色引擎负责。 */
(function () {
  'use strict';
  var minimum = 2500, fade = 320, reduced = matchMedia('(prefers-reduced-motion: reduce)');
  var urgent = {poke:1,done:1,confused:1,greet:1,wake:1,thinking:1,working:1,research:1};
  var shown = new WeakMap(), actors = new Map(), holds = new Map(), pending = new Map();
  var timers = new Set(), entrances = new Set(), breaths = new Map(), layers = [], lastSettings, quiet = true, stopped = false;
  // 移动视口的 innerWidth 读取会刷新动画样式；只在真实 resize 时更新引擎的闭包缓存。
  var width = window.innerWidth, widthReaders = new Set();
  function watchWidth(reader) { widthReaders.add(reader); }
  function viewportWidth() { return width; }
  window.addEventListener('resize', function () {
    var next = window.innerWidth;
    if (next !== width) { width = next; widthReaders.forEach(function (reader) { reader(width); }); }
  });
  function later(fn, delay) {
    var timer = setTimeout(function () { timers.delete(timer); if (!stopped) fn(); }, delay);
    timers.add(timer); return timer;
  }
  function cancel(timer) { clearTimeout(timer); timers.delete(timer); }
  function setData(el, key, value) { value = String(value); if (el.dataset[key] !== value) el.dataset[key] = value; }
  function bodyLayer(el) {
    if (!el.classList.contains('r22-pet-figure')) return el;
    // SVG 回落保留原直接子选择器，呼吸由它的 HTML 外框承担。
    if (el.firstElementChild?.tagName.toLowerCase() === 'svg') return el;
    var body = Array.from(el.children).find(function (child) { return child.classList.contains('r25-pet-body'); });
    if (!body) {
      body = document.createElement('span'); body.className = 'r25-pet-body';
      Array.from(el.childNodes).forEach(function (child) { body.appendChild(child); }); el.appendChild(body);
    }
    return body;
  }
  // 只在挂载、可见性或设置变化时改状态；呼吸帧完全交给 CSS 合成动画。
  var observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) { setData(entry.target, 'r25MotionOffscreen', !entry.isIntersecting); });
  }) : null;
  function sync(options) {
    lastSettings = options; quiet = options.quiet;
    setData(document.documentElement, 'r25MotionQuiet', quiet);
    if (quiet) entrances.forEach(endEntrance);
    var night = options.night && document.documentElement.getAttribute('data-theme') === 'dark';
    setData(document.documentElement, 'r25MotionNight', night);
    layers = Array.from(document.querySelectorAll('.home-role,.r22-pet-figure')).map(bodyLayer);
    layers.forEach(function (el, i) {
      if (!breaths.has(el)) {
        el.classList.add('r25-motion-body');
        // 错相位只在首次挂载写定，夜间设置不会重复写入延迟。
        el.style.setProperty('--r25-phase', (-0.47 * (i + 1)).toFixed(2) + 's');
        el.style.setProperty('--r25-cycle', (3.2 + (i % 6) * 0.06).toFixed(2) + 's');
        breaths.set(el, true);
        setData(el, 'r25MotionOffscreen', !!observer);
        observer?.observe(el);
      }
      setData(el, 'r25MotionCovered', el.classList.contains('home-role') && options.covered);
    });
    breaths.forEach(function (_, el) { if (!el.isConnected) { observer?.unobserve(el); breaths.delete(el); } });
    holds.forEach(function (item, el) { if (!el.isConnected) { cancel(item.timer); holds.delete(el); } });
  }
  function hold(el, name, resume) {
    if (document.hidden || reduced.matches || urgent[name]) { var waiting = holds.get(el); if (waiting) cancel(waiting.timer); holds.delete(el); return false; }
    var previous = shown.get(el), wait = previous && previous.name !== name ? previous.at + minimum - Date.now() : 0;
    var item = holds.get(el);
    if (!(wait > 0)) { if (item) cancel(item.timer); holds.delete(el); return false; }
    if (!item) { item = {resume: resume}; holds.set(el, item); }
    item.resume = resume; item.name = name;
    if (!item.timer) item.timer = later(function () {
      item.timer = null;
      if (document.hidden) return;
      holds.delete(el); if (el.isConnected) item.resume();
    }, wait);
    return true;
  }
  function status(id, name, resume, actor) {
    if (document.hidden || reduced.matches || urgent[name]) { var waiting = pending.get(id); if (waiting) cancel(waiting.timer); pending.delete(id); return false; }
    var previous = actors.get(id), now = Date.now();
    var wait = previous ? Math.max(0, previous.at + minimum - now, actor.once ? previous.shotUntil - now : 0) : 0;
    // 一次性片段尚在加载时也保留最后一个状态，直到它真正开始并播完。
    if (actor.once) wait = Math.max(wait, actor.once.started ? 32 : 100);
    var item = pending.get(id); if (item) cancel(item.timer);
    pending.delete(id);
    if (!(wait > 0)) return false;
    item = {resume: resume, timer: null}; pending.set(id, item);
    item.timer = later(function () {
      item.timer = null; if (document.hidden) return;
      pending.delete(id); item.resume();
    }, wait);
    return true;
  }
  function committed(el, name, choice, moving) {
    var previous = shown.get(el), now = Date.now(), changed = !previous || previous.name !== name;
    if (changed) shown.set(el, {name: name, at: now});
    var id = el.dataset.petAssistant, current = actors.get(id);
    if (!current || current.name !== name) actors.set(id, {name: name, at: now, shotUntil: 0});
    current = actors.get(id);
    if (moving && !choice.state.loop) current.shotUntil = Math.max(current.shotUntil, now + choice.state.durationMs);
    // 先提交新图的透明起点；下一帧才淡入，旧图从不参与透明度动画。
    var image = el.lastElementChild;
    if (image && typeof getComputedStyle === 'function') getComputedStyle(image).opacity;
    // 入场也用独立内部 stage 的 CSS 动画，外层呼吸从不叠加 WAAPI。
    var body = el.closest('.r25-motion-body') && el;
    if (!previous || !changed || !moving || !body || quiet || reduced.matches || document.hidden) return;
    endEntrance(body);
    body.style.willChange = 'transform';
    body.classList.add('r25-entry-stage'); entrances.add(body);
    body.addEventListener('animationend', entranceEnded);
    body.addEventListener('animationcancel', entranceEnded);
  }
  function entranceEnded(event) {
    if (event.target === event.currentTarget && event.animationName === 'r25-entry') endEntrance(event.currentTarget);
  }
  function endEntrance(body) {
    if (!entrances.has(body)) return;
    entrances.delete(body); body.classList.remove('r25-entry-stage'); body.style.willChange = '';
    body.removeEventListener('animationend', entranceEnded); body.removeEventListener('animationcancel', entranceEnded);
  }

  function retire(image, old, removeOld, allowed) {
    var finished = false, timer;
    function finish() {
      if (finished) return;
      if (document.hidden || !allowed()) { timer = later(finish, 64); return; }
      if (image.isConnected && typeof getComputedStyle === 'function' && Number(getComputedStyle(image).opacity) < 1) {
        timer = later(finish, 32); return;
      }
      finished = true; cancel(timer); image.removeEventListener('transitionend', ended);
      // 只有新图已盖满时才释放旧图；新图失效时保留旧图供下一次覆盖。
      if (image.isConnected && old?.isConnected && old !== image) removeOld();
    }
    function ended(event) { if (event.target === image && event.propertyName === 'opacity') finish(); }
    image.addEventListener('transitionend', ended); timer = later(finish, fade + 40);
  }
  function visibility() {
    setData(document.documentElement, 'r25MotionHidden', !!document.hidden);
    if (!document.hidden) {
      Array.from(holds).forEach(function (entry) { var el = entry[0], item = entry[1]; cancel(item.timer); holds.delete(el); if (el.isConnected) item.resume(); });
      Array.from(pending).forEach(function (entry) { var id = entry[0], item = entry[1]; cancel(item.timer); pending.delete(id); item.resume(); });
    }
  }
  reduced.addEventListener('change', function () {
    if (reduced.matches) entrances.forEach(endEntrance);
    if (lastSettings) sync(lastSettings);
  });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', function (event) {
    if (event.persisted) return;
    observer?.disconnect(); breaths.clear(); widthReaders.clear();
    stopped = true; timers.forEach(clearTimeout); timers.clear(); pending.clear(); holds.clear();
    entrances.forEach(endEntrance);
  });
  visibility();
  window.HubPetMotion = {watchWidth: watchWidth, viewportWidth: viewportWidth, sync: sync, hold: hold, status: status, committed: committed, retire: retire};
})();
