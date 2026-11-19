/* Stage mount. Timers live on one clock so tests can jump ahead. */
(function (root) {
  var T = root.HubPetTables;
  var queue = [];
  var seq = 1;
  var offset = 0;
  var machine = null;
  var slot = null;
  var botId = '';
  var packs = null;
  var packTry = null;
  var demoToken = 0;
  var demoTimers = [];
  var arrived = {};
  var tracker = null;
  var tracking = false;
  var moved = false;
  var originX = 0;
  var originY = 0;
  var visBound = false;

  function virtualNow() { return Date.now() + offset; }
  function drop(id) {
    var i = queue.findIndex(function (item) { return item.id === id; });
    if (i < 0) return;
    clearTimeout(queue[i].handle);
    queue.splice(i, 1);
  }
  function runDue(end) {
    var guard = 0;
    while (guard < 10000) {
      guard += 1;
      var due = queue.filter(function (item) { return item.at <= end; });
      if (!due.length) break;
      due.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
      var item = due[0];
      drop(item.id);
      offset += item.at - virtualNow();
      item.fn();
    }
    offset += end - virtualNow();
  }
  function flush() {
    runDue(virtualNow());
    paint();
  }
  var clock = {
    now: virtualNow,
    setTimer: function (fn, ms) {
      var id = seq++;
      var at = virtualNow() + ms;
      var handle = setTimeout(function () { drop(id); fn(); flush(); }, ms);
      queue.push({ id: id, at: at, fn: fn, handle: handle });
      return id;
    },
    clearTimer: function (id) { drop(id); }
  };
  function advance(ms) {
    offset += ms;
    var end = virtualNow();
    queue.forEach(function (item) { clearTimeout(item.handle); });
    runDue(end);
    paint();
  }
  machine = root.HubPetMachine.create({
    clock: clock,
    random: Math.random,
    lines: function (id, pose) { return root.HubPetLines.linesFor(id, pose); }
  });

  function realMode() {
    return document.documentElement.dataset.hubMode === 'real';
  }
  function safeFile(file) {
    if (typeof file !== 'string' || file.indexOf('..') >= 0) return '';
    if (file.charAt(0) === '/' || file.indexOf('\\') >= 0) return '';
    if (!/^[\w./-]+$/.test(file)) return '';
    return file;
  }
  function indexPack(data, base) {
    var out = {};
    var assistants = data && data.assistants || {};
    Object.keys(assistants).forEach(function (id) {
      var row = assistants[id];
      if (!row || row.enabled !== true || !row.states) return;
      var states = {};
      Object.keys(row.states).forEach(function (name) {
        var src = safeFile(row.states[name] && row.states[name].src);
        var still = safeFile(row.states[name] && row.states[name].still) || src;
        if (src) states[name] = { src: base + src, still: base + still };
      });
      var pools = {};
      var rawPools = row.pools || {};
      Object.keys(rawPools).forEach(function (name) {
        if (!Array.isArray(rawPools[name])) return;
        pools[name] = rawPools[name].map(function (item) {
          var src = safeFile(item && item.src);
          var still = safeFile(item && item.still) || src;
          return src ? { src: base + src, still: base + still } : null;
        }).filter(Boolean);
      });
      if (states.idle) out[id] = { states: states, pools: pools };
    });
    return out;
  }
  function loadPack() {
    if (packTry || typeof fetch !== 'function') return;
    packTry = true;
    var urls = ['pets/pack.json', 'pets-build-r22/pets/pack.json'];
    function step(i) {
      if (i >= urls.length) return;
      fetch(urls[i], { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error('skip');
        return res.json();
      }).then(function (data) {
        var base = urls[i].replace(/pack\.json$/, '');
        packs = indexPack(data, base);
        paint();
      }).catch(function () { step(i + 1); });
    }
    step(0);
  }
  function frameOf(id, snap) {
    var row = packs && packs[id];
    if (!row) return null;
    var key = snap.pack;
    if (!row.states[key]) key = 'idle';
    var pool = row.pools[key];
    var list = pool && pool.length ? pool : [row.states[key]];
    var item = list[snap.frameIndex % list.length] || row.states.idle;
    if (!item) return null;
    return snap.reduced ? (item.still || item.src) : item.src;
  }
  function dumpling() {
    return '<svg class="r29-dumpling" viewBox="0 0 120 150" aria-hidden="true">' +
      '<ellipse cx="60" cy="78" rx="38" ry="34" class="r29-blob"/>' +
      '<ellipse cx="46" cy="72" rx="5" ry="6" class="r29-eye"/>' +
      '<ellipse cx="74" cy="72" rx="5" ry="6" class="r29-eye"/>' +
      '<path class="r29-mouth" d="M50 90 q10 8 20 0"/>' +
      '<ellipse cx="38" cy="84" rx="6" ry="3" class="r29-cheek"/>' +
      '<ellipse cx="82" cy="84" rx="6" ry="3" class="r29-cheek"/>' +
      '</svg>';
  }
  function cardsHTML(snap) {
    if (!snap.sessions || snap.sessions.length < 2) return '';
    return snap.sessions.map(function (s) {
      return '<span class="r29-card' + (s.ask ? ' is-ask' : '') + '"></span>';
    }).join('');
  }
  function paint() {
    if (!slot || !slot.isConnected || !botId) return;
    var snap = machine.snapshot(botId);
    var src = frameOf(botId, snap);
    var mark = root.HubPetFx.mark(snap.pose);
    var night = T.nightQuiet(new Date(virtualNow()));
    var face = src
      ? '<img class="r29-photo" alt="" draggable="false">'
      : dumpling();
    slot.innerHTML =
      '<div class="r29-stage" data-r29-stage data-r29-pose="' + snap.pose + '"' +
      ' data-r29-motion="' + snap.motion + '" data-r29-blink="' + (snap.blinking ? '1' : '0') + '"' +
      ' data-r29-reduced="' + (snap.reduced ? '1' : '0') + '"' +
      ' data-r29-sound="' + (night ? '0' : '1') + '" data-r29-expr="' + (mark || 'idle') + '">' +
      '<p class="r29-bubble' + (snap.line ? '' : ' is-hide') + '" data-r29-bubble></p>' +
      '<div class="r29-fx" data-r29-fx="' + (mark || '') + '"></div>' +
      '<div class="r29-cards' + (snap.wobble ? ' is-wobble' : '') + '">' + cardsHTML(snap) + '</div>' +
      '<button type="button" class="r29-actor" data-r29-actor aria-label="戳一下">' +
      '<span class="r29-shadow"></span>' +
      '<span class="r29-mover" data-r29-mover data-motion="' + snap.motion + '">' +
      face + '<span class="r29-lid"></span></span></button>' +
      '<div class="r29-meter' + (snap.anger >= 20 ? ' is-on' : '') + '"><i style="width:' +
      Math.round(snap.anger) + '%"></i></div>' +
      '<div class="r29-actions"><button type="button" data-r29-poke>戳一下</button>' +
      '<button type="button" data-r29-pat>摸一下</button></div></div>';
    var bubble = slot.querySelector('[data-r29-bubble]');
    if (bubble) bubble.textContent = snap.line || '';
    var photo = slot.querySelector('.r29-photo');
    if (photo && src) {
      photo.addEventListener('error', function () {
        photo.replaceWith(document.createRange().createContextualFragment(dumpling()));
      });
      photo.src = src;
    }
    slot.querySelectorAll('.r29-card').forEach(function (card, i) {
      var pose = snap.sessions[i] && snap.sessions[i].pose;
      card.textContent = pose === 'asking' ? '等你' : '在忙';
    });
  }
  function clearDemoTimers() {
    demoTimers.forEach(function (id) { clearTimeout(id); });
    demoTimers = [];
  }
  function cancelDemo() {
    demoToken += 1;
    clearDemoTimers();
  }
  function startDemo(id) {
    if (realMode()) return;
    cancelDemo();
    var token = demoToken;
    [[6000, 'send'], [9000, 'thinking'], [12000, 'working'],
      [16000, 'tool-done'], [20000, 'working'], [24000, 'done']].forEach(function (step) {
      var handle = setTimeout(function () {
        if (token !== demoToken || document.hidden) return;
        if (machine.snapshot(id).external) return;
        machine.event(id, step[1], 'demo');
        paint();
      }, step[0]);
      demoTimers.push(handle);
    });
  }
  function bindVis() {
    if (visBound) return;
    visBound = true;
    document.addEventListener('visibilitychange', function () {
      var hidden = document.hidden === true;
      if (hidden) document.documentElement.setAttribute('data-r29-page-hidden', '1');
      else document.documentElement.removeAttribute('data-r29-page-hidden');
      machine.setPageHidden(hidden);
      if (hidden) cancelDemo();
      paint();
    });
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mq) {
      machine.setReduced(!!mq.matches);
      if (mq.addEventListener) mq.addEventListener('change', function () {
        machine.setReduced(!!mq.matches);
        paint();
      });
    }
  }
  function onClick(ev) {
    var poke = ev.target.closest && ev.target.closest('[data-r29-poke]');
    var pat = ev.target.closest && ev.target.closest('[data-r29-pat]');
    if (!poke && !pat) return;
    cancelDemo();
    if (poke) machine.poke(botId);
    else machine.pat(botId);
    paint();
  }
  function onDown(ev) {
    if (!ev.target.closest || !ev.target.closest('[data-r29-actor]')) return;
    tracking = true;
    moved = false;
    originX = ev.clientX;
    originY = ev.clientY;
    tracker = root.HubPetShake.create(virtualNow);
    if (slot.setPointerCapture && ev.pointerId != null) {
      try { slot.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
  }
  function onMove(ev) {
    if (!tracking) return;
    var dx = ev.clientX - originX, dy = ev.clientY - originY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
      moved = true;
      tracker.start(ev.clientX);
    }
    if (moved && tracker.move(ev.clientX)) {
      cancelDemo();
      machine.shaken(botId);
      paint();
    }
  }
  function onUp(ev) {
    if (!tracking) return;
    tracking = false;
    if (tracker) tracker.stop();
    if (!moved && ev.target.closest && ev.target.closest('[data-r29-actor]')) {
      cancelDemo();
      machine.pat(botId);
      paint();
    }
  }
  function bind(node) {
    if (!node || (node.dataset && node.dataset.r29Bound === '1')) return;
    if (node.dataset) node.dataset.r29Bound = '1';
    node.addEventListener('click', onClick);
    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', function () { tracking = false; });
  }
  function mount(node, id) {
    if (!node || typeof id !== 'string' || !id) return;
    slot = node;
    botId = id;
    bindVis();
    bind(node);
    loadPack();
    if (!arrived[id] && !machine.snapshot(id).external) {
      arrived[id] = 1;
      machine.arrive(id, new Date(virtualNow()));
      startDemo(id);
    }
    paint();
  }
  function currentId() {
    return botId || (slot && slot.getAttribute('data-r29-pet-slot')) || '';
  }
  root.HubPetStage = {
    event: function (id, name) {
      cancelDemo();
      machine.event(id, name, 'user');
      if (id === botId) paint();
    },
    setLines: function (id, table) { root.HubPetLines.setLines(id, table); paint(); },
    sessions: function (id, list) {
      machine.setSessions(id, list);
      if (id === botId) paint();
    },
    mount: mount,
    advance: advance,
    snapshot: function (id) { return machine.snapshot(id || currentId()); },
    soundAllowed: function (date) { return !T.nightQuiet(date || new Date(virtualNow())); },
    poke: function (id) { cancelDemo(); machine.poke(id || currentId()); paint(); },
    pat: function (id) { cancelDemo(); machine.pat(id || currentId()); paint(); }
  };
})(window);
