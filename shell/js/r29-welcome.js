/* 第一次打开：六格上方一句轻引导，空对话输入框上方一句说话提示。
   不改内核和对话页，只观察页面、用事件委托挂上去。 */
(function () {
  'use strict';
  var KEY = 'hub-r29-welcome-home';
  var LINE = '想办什么事，点谁跟谁说。不知道找谁就找我';
  var MIC = '可以直接说话：点一下麦克风开始，再点一下发出';
  var memorySeen = false;
  var painting = false;
  var queued = false;
  var waveTries = 0;
  var waveTimer = 0;
  var waveWait = '';
  var waveSettled = false;
  var clipState = null;
  var waveValue = '';
  var waveVisual = 0;
  var greetAnswer = {};
  var greetWait = {};
  var greetClip = {};
  var booted = false;

  function readSeen() {
    if (memorySeen) return true;
    try {
      return window.localStorage.getItem(KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function remember() {
    memorySeen = true;
    try { window.localStorage.setItem(KEY, '1'); } catch (error) {}
    removeGuide();
  }

  function reducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (error) {
      return false;
    }
  }

  function cells() {
    try {
      return document.querySelectorAll('.sidebar .pinned .pin[data-id]');
    } catch (error) {
      return [];
    }
  }

  function botRecord(id) {
    var list, i, row;
    try {
      list = window.state && state.bots;
      if (list && list.length) {
        for (i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === id) return list[i];
        }
      }
    } catch (error) {}
    try {
      if (!window.HubReal || typeof HubReal.state !== 'function') return null;
      list = HubReal.state().roster || [];
      for (i = 0; i < list.length; i++) {
        row = list[i];
        if (row && row.id === id) return row;
      }
    } catch (error2) {}
    return null;
  }

  /* 名册里的主助理：角色标记，或字段上写着「主助理」。都没有就用第一格。 */
  function marked(bot) {
    var fields, i, value;
    if (!bot || typeof bot !== 'object') return false;
    if (bot.role === 'chief' || bot.role === '主助理') return true;
    fields = ['mark', 'tag', 'badge', 'rank', 'label', 'title'];
    for (i = 0; i < fields.length; i++) {
      value = bot[fields[i]];
      if (value === '主助理') return true;
    }
    if (Array.isArray(bot.tags) && bot.tags.indexOf('主助理') >= 0) return true;
    return false;
  }

  function chiefId() {
    var pins = cells();
    var i, id, first;
    first = '';
    for (i = 0; i < pins.length; i++) {
      id = pins[i].getAttribute('data-id') || '';
      if (!id) continue;
      if (!first) first = id;
      if (marked(botRecord(id))) return id;
    }
    return first;
  }

  function letterOf(id) {
    var bot = botRecord(id);
    var name = bot && bot.name ? String(bot.name) : '';
    var chars = Array.from(name);
    return chars[0] || '助';
  }

  function fillFace(slot, id) {
    var html, box, node, pin, face, letter;
    if (!slot) return;
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    html = '';
    try {
      if (window.HubAvatars && typeof HubAvatars.html === 'function') {
        html = HubAvatars.html(id, 28) || '';
      }
    } catch (error) {
      html = '';
    }
    if (html) {
      box = document.createElement('template');
      box.innerHTML = html;
      node = box.content.firstElementChild;
      if (node) {
        slot.appendChild(node);
        return;
      }
    }
    pin = null;
    try {
      var pins = cells();
      var i;
      for (i = 0; i < pins.length; i++) {
        if (pins[i].getAttribute('data-id') === id) { pin = pins[i]; break; }
      }
    } catch (error2) {
      pin = null;
    }
    face = pin && pin.querySelector('.home-role img, .home-role svg, .home-role .r29-face');
    if (face) {
      slot.appendChild(face.cloneNode(true));
      return;
    }
    letter = document.createElement('span');
    letter.className = 'r29-welcome-letter';
    letter.textContent = letterOf(id);
    slot.appendChild(letter);
  }

  function buildGuide() {
    var bar, go, face, text, close;
    bar = document.createElement('div');
    bar.className = 'r29-welcome';
    bar.setAttribute('data-r29-welcome', '');
    go = document.createElement('button');
    go.type = 'button';
    go.className = 'r29-welcome-go';
    go.setAttribute('data-r29-welcome-go', '');
    face = document.createElement('span');
    face.className = 'r29-welcome-face';
    face.setAttribute('data-r29-welcome-face', '');
    text = document.createElement('span');
    text.className = 'r29-welcome-text';
    text.textContent = LINE;
    go.appendChild(face);
    go.appendChild(text);
    close = document.createElement('button');
    close.type = 'button';
    close.className = 'r29-welcome-x';
    close.setAttribute('data-r29-welcome-close', '');
    close.setAttribute('aria-label', '关闭');
    close.textContent = '关闭';
    bar.appendChild(go);
    bar.appendChild(close);
    return bar;
  }

  function removeGuide() {
    var node = document.querySelector('[data-r29-welcome]');
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function markWave(value) {
    waveValue = value;
    waveSettled = true;
    var node = document.querySelector('[data-r29-welcome]');
    if (node) node.setAttribute('data-r29-wave', value);
  }

  function stopWave() {
    if (waveTimer) {
      clearTimeout(waveTimer);
      waveTimer = 0;
    }
  }

  function alreadyWaving(id) {
    var snap, actor;
    try {
      if (!window.chiefPet || typeof chiefPet.state !== 'function') return false;
      snap = chiefPet.state();
      actor = snap && snap.actors && snap.actors[id];
      return !!(actor && actor.once === 'greet');
    } catch (error) {
      return false;
    }
  }

  function narrowHome() {
    try { return window.innerWidth < 700; } catch (error) { return true; }
  }

  function publicPet(file) {
    var parts, i;
    if (typeof file !== 'string' || !/^[-\w./]+\.webp$/.test(file)) return '';
    parts = file.split('/');
    for (i = 0; i < parts.length; i++) {
      if (!parts[i] || parts[i] === '.' || parts[i] === '..') return '';
    }
    return '/pets/' + file;
  }

  function rosterEntry(data, id) {
    var assistants, bot, avatar, keys, i, row, picked, keyed, real;
    assistants = data && data.assistants;
    if (!assistants || typeof assistants !== 'object') return null;
    bot = botRecord(id);
    avatar = bot && bot.avatar;
    picked = null;
    if (avatar && avatar.kind === 'pack' && avatar.id) {
      keys = Object.keys(assistants);
      for (i = 0; i < keys.length; i++) {
        row = assistants[keys[i]];
        if (row && row.pack === avatar.id) { picked = row; break; }
      }
    }
    real = false;
    try { real = document.documentElement.dataset.hubMode === 'real'; }
    catch (error) { real = false; }
    keyed = !avatar || avatar.kind === 'pack' || avatar.avatarExplicit === false;
    if (real && avatar && avatar.kind !== 'upload') keyed = true;
    if (picked) return picked;
    return keyed ? (assistants[id] || null) : null;
  }

  function clipOf(entry) {
    var state, pool, src, ms, url;
    if (!entry || entry.enabled !== true) return null;
    state = entry.states && entry.states.greet;
    pool = entry.pools && entry.pools.greet;
    src = state && state.src;
    ms = state && state.durationMs;
    if (!src && pool && pool.length) {
      src = pool[0].src;
      ms = pool[0].durationMs;
    }
    if (!src && !(pool && pool.length) && !(state && state.src)) return null;
    url = publicPet(src);
    if (!Number.isFinite(ms) || ms < 400 || ms > 8000) ms = 1600;
    if (!url && !state && !(pool && pool.length)) return null;
    return {url: url, ms: ms, has: !!(state || (pool && pool.length))};
  }

  function loadGreet(id) {
    if (Object.prototype.hasOwnProperty.call(greetAnswer, id)) {
      return Promise.resolve(greetAnswer[id]);
    }
    if (greetWait[id]) return greetWait[id];
    greetWait[id] = new Promise(function (resolve) {
      var proto = '', settled = false, timer;
      function finish(ok) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        greetAnswer[id] = !!ok;
        resolve(greetAnswer[id]);
      }
      try { proto = location.protocol || ''; } catch (error) { proto = ''; }
      if (proto !== 'http:' && proto !== 'https:') { finish(false); return; }
      timer = setTimeout(function () { finish(false); }, 4000);
      try {
        fetch('/pets/pack.json', {credentials: 'same-origin', redirect: 'error'})
          .then(function (res) {
            if (!res || !res.ok) throw new Error('pack');
            return res.json();
          })
          .then(function (data) {
            var clip = clipOf(rosterEntry(data, id));
            if (clip && clip.has) greetClip[id] = clip;
            finish(!!(clip && clip.has));
          })
          .catch(function () { finish(false); });
      } catch (error2) { finish(false); }
    });
    return greetWait[id];
  }

  function homeStage(id) {
    var nodes, i;
    try { nodes = document.querySelectorAll('[data-pet-stage="home"]'); }
    catch (error) { return null; }
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-pet-assistant') === id) return nodes[i];
    }
    return null;
  }

  function topImg(stage) {
    var list = stage.querySelectorAll('img');
    return list.length ? list[list.length - 1] : null;
  }

  function showingGreet(id) {
    var clip = greetClip[id], stage, img, file, src, tail;
    stage = homeStage(id);
    if (!stage) return false;
    if (stage.getAttribute('data-pet-state') === 'greet') return true;
    img = topImg(stage);
    if (!img || !clip || !clip.url) return false;
    tail = clip.url.replace(/^\/pets\//, '');
    file = img.getAttribute('data-pet-file') || '';
    src = img.getAttribute('src') || '';
    return file.indexOf(tail) >= 0 || src.indexOf(tail) >= 0;
  }

  /* 窄屏首页现有引擎停在静帧。有 greet 图时，只把这一格换上去一次。 */
  function stopClipTimer() {
    if (clipState && clipState.timer) {
      clearInterval(clipState.timer);
      clipState.timer = 0;
    }
  }
  function clipTick() {
    var live, picture, id, clip, previous;
    if (!clipState) return;
    if (document.hidden) { stopClipTimer(); return; }
    id = clipState.id;
    clip = clipState.clip;
    previous = clipState.previous;
    clipState.left -= 120;
    live = homeStage(id);
    picture = live && topImg(live);
    if (!live || clipState.left <= 0 || reducedMotion()) {
      stopClipTimer();
      clipState = null;
      if (live) live.removeAttribute('data-r29-hold');
      if (picture && previous) picture.setAttribute('src', previous);
      return;
    }
    live.setAttribute('data-r29-hold', '1');
    if (picture && picture.getAttribute('src') !== clip.url) {
      picture.setAttribute('src', clip.url);
    }
  }
  function armClipTimer() {
    if (!clipState || clipState.timer || document.hidden) return;
    clipState.timer = setInterval(clipTick, 120);
  }
  function playClip(id) {
    var clip, stage, img, previous;
    if (waveVisual || reducedMotion() || !narrowHome()) return false;
    clip = greetClip[id];
    if (!clip || !clip.url) return false;
    if (showingGreet(id)) return true;
    stage = homeStage(id);
    img = stage && topImg(stage);
    if (!img) return false;
    waveVisual = 1;
    previous = img.getAttribute('src') || '';
    stopClipTimer();
    clipState = {id: id, clip: clip, previous: previous, left: clip.ms, timer: 0};
    stage.setAttribute('data-r29-hold', '1');
    img.setAttribute('src', clip.url);
    armClipTimer();
    return true;
  }

  function attemptWave(id) {
    var pet, ready;
    if (waveSettled || readSeen()) return;
    if (reducedMotion()) {
      stopWave();
      markWave('skip');
      return;
    }
    if (!id) return;
    if (!Object.prototype.hasOwnProperty.call(greetAnswer, id)) {
      loadGreet(id).then(function () {
        if (!waveSettled) attemptWave(chiefId() || id);
      });
      return;
    }
    if (!greetAnswer[id]) {
      stopWave();
      markWave('none');
      return;
    }
    pet = window.chiefPet;
    ready = false;
    if (pet && typeof pet.preview === 'function') {
      try {
        ready = typeof pet.active !== 'function' || !!pet.active(id);
      } catch (error) { ready = false; }
    }
    if (!ready) {
      if (playClip(id)) {
        stopWave();
        markWave('done');
        return;
      }
      retryWave(id);
      return;
    }
    if (!alreadyWaving(id)) {
      try { pet.preview('greet', {assistant: id}); } catch (error2) {}
    }
    if (narrowHome()) playClip(id);
    stopWave();
    markWave('done');
  }

  function retryWave(id) {
    if (waveTimer || waveSettled) return;
    if (waveTries > 40) {
      markWave('none');
      return;
    }
    waveTries += 1;
    waveWait = id;
    if (document.hidden) return;
    waveWait = '';
    waveTimer = setTimeout(function () {
      waveTimer = 0;
      attemptWave(chiefId() || id);
    }, 400);
  }
  function pauseWave() {
    if (!waveTimer) return;
    clearTimeout(waveTimer);
    waveTimer = 0;
    if (!waveWait) waveWait = chiefId() || '';
  }
  function resumeWave() {
    var id;
    if (document.hidden || waveTimer || waveSettled || !waveWait) return;
    id = waveWait;
    waveWait = '';
    waveTimer = setTimeout(function () {
      waveTimer = 0;
      attemptWave(chiefId() || id);
    }, 400);
  }

  function syncHome() {
    var pinned, id, guide, face;
    if (readSeen()) {
      removeGuide();
      return;
    }
    pinned = document.querySelector('.sidebar .pinned');
    if (!pinned || !pinned.parentNode) return;
    id = chiefId();
    if (!id) return;
    guide = document.querySelector('[data-r29-welcome]');
    if (!guide) guide = buildGuide();
    if (guide.getAttribute('data-r29-for') !== id) {
      guide.setAttribute('data-r29-for', id);
      face = guide.querySelector('[data-r29-welcome-face]');
      fillFace(face, id);
    }
    if (guide.nextElementSibling !== pinned || guide.parentNode !== pinned.parentNode) {
      pinned.parentNode.insertBefore(guide, pinned);
    }
    if (waveValue && guide.getAttribute('data-r29-wave') !== waveValue) {
      guide.setAttribute('data-r29-wave', waveValue);
    }
    if (!waveSettled) attemptWave(id);
  }

  function realWaiting() {
    var root, empty, label;
    try {
      root = document.documentElement;
      if (!root || !root.dataset || root.dataset.hubMode !== 'real') return false;
      if (!window.HubReal) return false;
      empty = document.querySelector('.hub-real-empty');
      if (!empty) return true;
      label = empty.textContent || '';
      return label.indexOf('正在加载') >= 0;
    } catch (error) {
      return false;
    }
  }

  function chatEmpty() {
    var list;
    try {
      if (!window.state || state.mode !== 'chat' || state.running) return false;
      if (window.Hub && typeof Hub.currentMessages === 'function') {
        list = Hub.currentMessages() || [];
        if (list.length) return false;
      }
      if (realWaiting()) return false;
      return !!document.querySelector('.composer-area .r22-input-row');
    } catch (error) {
      return false;
    }
  }

  function syncMic() {
    var row, hint, column;
    hint = document.querySelector('[data-r29-welcome-mic]');
    if (!chatEmpty()) {
      if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
      return;
    }
    row = document.querySelector('.composer-area .r22-input-row');
    if (!row || !row.parentNode) return;
    if (hint && hint.nextElementSibling === row) return;
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'r29-welcome-mic';
      hint.setAttribute('data-r29-welcome-mic', '');
      hint.textContent = MIC;
    }
    column = row.parentNode;
    if (hint.parentNode !== column || hint.nextElementSibling !== row) {
      column.insertBefore(hint, row);
    }
  }

  function sync() {
    if (painting) return;
    painting = true;
    try {
      syncHome();
      syncMic();
    } catch (error) {}
    painting = false;
  }

  function schedule() {
    if (queued) return;
    queued = true;
    var run = function () {
      queued = false;
      sync();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function openChief() {
    var id = chiefId();
    if (!id) return;
    try {
      if (window.Hub && typeof Hub.navigate === 'function') {
        Hub.navigate({view: 'chat', bot: id});
        return;
      }
    } catch (error) {}
    try {
      if (typeof selectBot === 'function') selectBot(id);
    } catch (error2) {}
  }

  function onClick(event) {
    var target, node;
    try {
      target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('[data-r29-welcome-close]')) {
        event.preventDefault();
        event.stopPropagation();
        remember();
        return;
      }
      if (target.closest('[data-r29-welcome-go]')) {
        event.preventDefault();
        event.stopPropagation();
        remember();
        openChief();
        return;
      }
      node = target.closest('[data-act="bot"]');
      if (node) remember();
    } catch (error) {}
  }

  function boot() {
    var app;
    if (booted) return;
    booted = true;
    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        document.documentElement.setAttribute('data-r29-page-hidden', '1');
        stopClipTimer();
        pauseWave();
        return;
      }
      document.documentElement.removeAttribute('data-r29-page-hidden');
      armClipTimer();
      resumeWave();
    });
    try {
      if (window.Hub && typeof Hub.on === 'function') {
        Hub.on('ready', schedule);
        Hub.on('navigate', schedule);
        Hub.on('message', schedule);
      }
    } catch (error) {}
    app = document.getElementById('app');
    if (app && typeof MutationObserver === 'function') {
      var observer = new MutationObserver(function () { schedule(); });
      observer.observe(app, {childList: true, subtree: true});
    }
    try {
      var media = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (media && media.addEventListener) media.addEventListener('change', schedule);
    } catch (error2) {}
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
