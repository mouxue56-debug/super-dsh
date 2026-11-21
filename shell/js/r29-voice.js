/*
 * 点一下录音，再点一下发送。
 * 待机 → 请求权限 → 在录 → 发送中 → 已发。
 * 取消丢掉；来电、锁屏、切后台、到点都停住，录音留着等发送或丢弃。
 * 麦克风按钮和状态条不在时什么都不做。输入框里的字不带走、不清掉。
 */
(function () {
  'use strict';
  // 暂定：最长 5 分钟，到点自动停，等主人点发送。
  var MAX_MS = 5 * 60 * 1000;
  var MIME_ORDER = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  var phase = 'idle';
  var session = null;
  var notice = '';
  var token = 0;
  var stopIntent = '';
  var cardReady = false;

  function motionReduced() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (err) { return false; }
  }

  function isReal() {
    var root = document.documentElement;
    if (!root) return false;
    if (root.dataset && root.dataset.hubMode === 'real') return true;
    return !!(root.getAttribute && root.getAttribute('data-hub-mode') === 'real');
  }

  function micButton() { return document.querySelector('[data-r29-mic]'); }
  function voiceSlot() { return document.querySelector('[data-r29-voice-slot]'); }
  function controlsReady() { return !!(micButton() && voiceSlot()); }

  function formatMs(ms) {
    var total = Math.floor(Math.max(0, ms) / 1000);
    var min = Math.floor(total / 60);
    var sec = total % 60;
    return (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function halt(event) {
    if (!event) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    } else if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  function setDisabled(el, on) {
    if (!el) return;
    el.disabled = !!on;
    if (on) el.setAttribute('disabled', '');
    else el.removeAttribute?.('disabled');
    if (on) el.setAttribute('aria-disabled', 'true');
    else el.removeAttribute?.('aria-disabled');
  }

  function placeOf() {
    var conversation = '';
    var bot = '';
    try {
      var hub = window.Hub;
      if (hub && typeof hub.context === 'function') {
        var ctx = hub.context() || {};
        if (typeof ctx.conversation === 'string') conversation = ctx.conversation;
        if (ctx.bot && typeof ctx.bot.id === 'string') bot = ctx.bot.id;
        else if (ctx.state && typeof ctx.state.bot === 'string') bot = ctx.state.bot;
      }
    } catch (err) { /* 没有壳也能在测试页里跑 */ }
    return { conversation: conversation, bot: bot };
  }

  function preserveDraft(fn) {
    var node = document.querySelector('[data-focus="composer"]');
    var value = node ? node.value : null;
    var had = false;
    var draft = '';
    if (typeof state !== 'undefined' && state && typeof state.input === 'string') {
      had = true;
      draft = state.input;
    }
    fn();
    if (node && value !== null && node.value !== value) node.value = value;
    if (had && state.input !== draft) state.input = draft;
  }

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
    for (var i = 0; i < MIME_ORDER.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(MIME_ORDER[i])) return MIME_ORDER[i];
      } catch (err) { /* 换下一种 */ }
    }
    return '';
  }

  function stopTracks(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    stream.getTracks().forEach(function (track) {
      try { track.stop(); } catch (err) { /* 已经停了 */ }
    });
  }

  function disarm() {
    if (!session) return;
    if (session.clock) clearInterval(session.clock);
    if (session.cap) clearTimeout(session.cap);
    session.clock = 0;
    session.cap = 0;
  }

  function tick() {
    if (phase !== 'recording' || !session) return;
    var elapsed = Date.now() - session.started;
    if (elapsed >= MAX_MS) { requestStop('limit'); return; }
    var clock = document.querySelector('[data-r29-voice-clock]');
    if (!clock) { paint(); return; }
    clock.textContent = formatMs(elapsed);
  }

  function armTimers() {
    disarm();
    session.clock = setInterval(tick, 1000);
    session.cap = setTimeout(function () { requestStop('limit'); }, MAX_MS);
  }

  function failOpen(text) {
    phase = 'idle';
    stopIntent = '';
    notice = text;
    session = null;
    paint();
    try {
      if (window.Hub && typeof window.Hub.toast === 'function') window.Hub.toast(text);
    } catch (err) { /* 提示条没有也不拦 */ }
  }

  function beginRecording(stream, place, requestId) {
    var mime = pickMime();
    var recorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
    } catch (err) {
      stopTracks(stream);
      failOpen('这会儿录不了。');
      return;
    }
    session = {
      id: requestId || requestIdNow(),
      stream: stream,
      recorder: recorder,
      mime: (recorder && recorder.mimeType) || mime,
      chunks: [],
      started: Date.now(),
      conversation: place.conversation,
      bot: place.bot,
      blob: null,
      caption: '',
      kind: '',
      durationMs: 0,
      posted: false,
      inflight: false,
      flight: 0,
      holdReason: '',
      clock: 0,
      cap: 0,
      sealed: false
    };
    recorder.addEventListener('dataavailable', function (ev) {
      if (session && ev && ev.data && ev.data.size) session.chunks.push(ev.data);
    });
    recorder.addEventListener('stop', function () { onRecorderStop(); });
    recorder.addEventListener('error', function () {
      if (phase === 'recording') requestStop('interrupt');
    });
    var tracks = typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks() : [];
    tracks.forEach(function (track) {
      track.addEventListener('ended', function () {
        if (phase === 'recording') requestStop('interrupt');
      });
    });
    try { recorder.start(1000); }
    catch (err) {
      try { recorder.start(); }
      catch (err2) {
        stopTracks(stream);
        session = null;
        failOpen('这会儿录不了。');
        return;
      }
    }
    phase = 'recording';
    notice = '';
    armTimers();
    paint();
  }

  function requestIdNow() {
    return 'r29-voice-' + Date.now().toString(36) + '-' + token;
  }

  function arm() {
    if (!controlsReady() || phase !== 'idle') return;
    phase = 'arming';
    notice = '';
    token += 1;
    var seq = token;
    // 会话号和请求号在开口申请麦克风时就定死，之后切走也不改口。
    var place = placeOf();
    var requestId = requestIdNow();
    paint();
    var devices = navigator.mediaDevices;
    if (!devices || typeof devices.getUserMedia !== 'function') {
      failOpen('麦克风没打开，这次没录上。');
      return;
    }
    devices.getUserMedia({ audio: true }).then(function (stream) {
      if (seq !== token || phase !== 'arming') { stopTracks(stream); return; }
      beginRecording(stream, place, requestId);
    }, function () {
      if (seq !== token || phase !== 'arming') return;
      failOpen('麦克风没打开，这次没录上。');
    });
  }

  function blobFrom(data) {
    var type = 'application/octet-stream';
    if (data.mime) type = String(data.mime).split(';')[0] || type;
    try { return new Blob(data.chunks || [], { type: type }); }
    catch (err) { return new Blob(data.chunks || []); }
  }

  function onRecorderStop() {
    if (!session || session.sealed) return;
    session.sealed = true;
    disarm();
    session.blob = blobFrom(session);
    session.durationMs = Math.min(MAX_MS, Math.max(0, Date.now() - session.started));
    stopTracks(session.stream);
    session.stream = null;
    var intent = stopIntent;
    stopIntent = '';
    if (intent === 'cancel') {
      session = null;
      phase = 'idle';
      notice = '';
      paint();
      return;
    }
    if (intent === 'send') { beginSend(); return; }
    session.holdReason = intent === 'limit' ? 'limit' : 'interrupt';
    phase = 'held';
    paint();
  }

  function requestStop(intent) {
    if (!session || session.sealed) return;
    if (phase === 'stopping') {
      if (intent === 'cancel') stopIntent = 'cancel';
      return;
    }
    if (phase !== 'recording' || stopIntent) return;
    stopIntent = intent;
    phase = 'stopping';
    paint();
    var rec = session.recorder;
    if (rec && rec.state === 'recording') {
      try { rec.stop(); return; } catch (err) { /* 下面收口 */ }
    }
    onRecorderStop();
  }

  function renderBubble(data) {
    var root = document.createElement('div');
    root.className = 'r29-voice-bubble';
    root.setAttribute('data-r29-voice-id', data.id || '');
    var bar = document.createElement('div');
    bar.className = 'r29-voice-bar';
    var name = document.createElement('span');
    name.className = 'r29-voice-label';
    name.textContent = '语音';
    var time = document.createElement('span');
    time.className = 'r29-voice-duration';
    time.textContent = formatMs(data.durationMs || 0);
    bar.append(name, time);
    root.append(bar);
    var caption = document.createElement('p');
    caption.className = 'r29-voice-caption';
    caption.textContent = data.caption || '';
    root.append(caption);
    if (data.kind === 'retry') {
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'r29-voice-action';
      retry.setAttribute('data-r29-voice-retry', data.id || '');
      retry.textContent = '重试';
      retry.setAttribute('aria-label', '重试发送这条录音');
      root.append(retry);
    }
    return root;
  }

  function ensureCard() {
    if (cardReady || !window.Hub || typeof window.Hub.registerCard !== 'function') return;
    try {
      window.Hub.registerCard('r29-voice', {
        title: '语音',
        quoteLabel: function () { return '语音'; },
        render: function (data) { return renderBubble(data || {}); }
      });
    } catch (err) { /* 重复注册就用已有的 */ }
    cardReady = true;
  }

  function findBubble(id) {
    var nodes = document.querySelectorAll('[data-r29-voice-id]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-r29-voice-id') === id) return nodes[i];
    }
    return null;
  }

  function samePlace(data) {
    if (!data || !data.conversation) return true;
    return placeOf().conversation === data.conversation;
  }

  function paintBubble() {
    if (!session) return;
    var next = renderBubble(session);
    var prev = findBubble(session.id);
    if (prev && prev.replaceWith) prev.replaceWith(next);
    else if (samePlace(session)) {
      var host = document.querySelector('.thread-inner') || document.body;
      if (host) host.append(next);
    }
  }

  function publish(data) {
    ensureCard();
    var hub = window.Hub;
    if (hub && typeof hub.postMessage === 'function' && data.conversation) {
      try {
        preserveDraft(function () {
          hub.postMessage(data.conversation, {
            id: data.id,
            from: 'user',
            role: 'user',
            time: '刚刚',
            parts: [{ type: 'r29-voice', data: data }]
          });
        });
        if (findBubble(data.id)) return;
      } catch (err) { /* 会话还没接上就只画在页面上 */ }
    }
    // 人已经切到另一段时，不把这条画进眼前这段。
    if (!samePlace(data)) return;
    var host = document.querySelector('.thread-inner') || document.body;
    if (host && !findBubble(data.id)) host.append(renderBubble(data));
  }

  function finishSent() {
    session = null;
    phase = 'idle';
    notice = '';
    paint();
  }

  function limitError(result) {
    return !!(result && (result.error === 'audio-too-large' || result.error === 'audio-too-long'));
  }

  function applyResult(data, result) {
    if (limitError(result)) {
      data.kind = 'limit';
      data.asr = false;
      data.caption = typeof result.message === 'string' && result.message
        ? result.message : '这段录音超过了限制，录音已保存';
      phase = 'sent';
      paintBubble();
      finishSent();
      return;
    }
    if (result && result.error === 'asr-unavailable') {
      data.kind = 'asr';
      data.asr = false;
      data.caption = '录音已保存，转文字还没接上';
      phase = 'sent';
      paintBubble();
      finishSent();
      return;
    }
    if (result && result.ok) {
      data.kind = 'text';
      data.asr = result.asr === true;
      data.caption = typeof result.text === 'string' ? result.text : '';
      phase = 'sent';
      paintBubble();
      finishSent();
      return;
    }
    if (result && result.asr === true) {
      data.kind = 'retry';
      data.asr = true;
      data.caption = '转文字暂时不可用，录音已保存';
      phase = 'failed';
      paintBubble();
      paint();
      return;
    }
    data.kind = 'retry';
    data.asr = false;
    data.caption = '没发出去，录音还在。';
    phase = 'failed';
    paintBubble();
    paint();
  }

  function deliver() {
    if (!session || session.inflight) return;
    var data = session;
    data.inflight = true;
    data.flight += 1;
    var flight = data.flight;
    var send = window.HubVoiceSend;
    if (typeof send !== 'function') {
      data.inflight = false;
      if (isReal()) {
        data.kind = 'empty';
        data.caption = '暂无';
      } else {
        data.kind = 'demo';
        data.caption = '演示';
      }
      phase = 'sent';
      paintBubble();
      finishSent();
      return;
    }
    Promise.resolve().then(function () {
      return send(data.blob, {
        conversation: data.conversation,
        bot: data.bot,
        durationMs: data.durationMs,
        requestId: data.id
      });
    }).then(function (result) {
      if (session !== data || data.flight !== flight) return;
      data.inflight = false;
      applyResult(data, result);
    }, function () {
      if (session !== data || data.flight !== flight) return;
      data.inflight = false;
      applyResult(data, null);
    });
  }

  function beginSend() {
    if (!session || !session.blob || session.posted || phase === 'sending') return;
    try {
      document.dispatchEvent(new CustomEvent('r45-voice-sent', {
        detail: { conversation: session.conversation || '', bot: session.bot || '' }
      }));
    } catch (err) { /* 没有事件也不拦发送 */ }
    phase = 'sending';
    session.kind = 'sending';
    session.caption = '正在发送';
    session.posted = true;
    publish(session);
    paint();
    deliver();
  }

  function sendHeld() {
    if (phase !== 'held' || !session || !session.blob || session.posted) return;
    beginSend();
  }

  function discardHeld() {
    if (phase !== 'held') return;
    if (session) stopTracks(session.stream);
    session = null;
    phase = 'idle';
    notice = '';
    paint();
  }

  function onRetry() {
    if (phase !== 'failed' || !session || session.inflight || !session.blob) return;
    phase = 'sending';
    session.kind = 'sending';
    session.caption = '正在发送';
    paintBubble();
    paint();
    deliver();
  }

  function action(tag, label, aria) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'r29-voice-action';
    btn.setAttribute(tag, '');
    btn.textContent = label;
    btn.setAttribute('aria-label', aria);
    return btn;
  }

  function micLabel() {
    if (phase === 'arming') return '正在打开麦克风';
    if (phase === 'recording' || phase === 'held' || phase === 'stopping') return '发送录音';
    if (phase === 'sending') return '正在发送录音';
    if (phase === 'failed') return '录音还没发出去';
    return '开始录音';
  }

  function paint() {
    var button = micButton();
    var box = voiceSlot();
    if (!button || !box) return;
    var reduced = motionReduced();
    if (reduced) box.setAttribute('data-r29-reduced', '1');
    else box.removeAttribute?.('data-r29-reduced');
    button.setAttribute('aria-label', micLabel());
    button.setAttribute('data-r29-phase', phase);
    if (button.classList) {
      button.classList.toggle('is-send',
        phase === 'recording' || phase === 'held' || phase === 'stopping');
    }
    setDisabled(button, phase === 'arming' || phase === 'sending' ||
      phase === 'stopping' || phase === 'failed');
    box.setAttribute('aria-live', 'off');
    if (typeof box.replaceChildren === 'function') box.replaceChildren();
    else box.textContent = '';
    if (phase === 'recording' || phase === 'stopping') {
      var dot = document.createElement('span');
      dot.className = 'r29-voice-dot' + (reduced ? ' is-still' : ' is-live');
      dot.setAttribute('aria-hidden', 'true');
      var clock = document.createElement('span');
      clock.className = 'r29-voice-clock';
      clock.setAttribute('data-r29-voice-clock', '');
      var elapsed = session ? Date.now() - session.started : 0;
      clock.textContent = formatMs(elapsed);
      var live = document.createElement('span');
      live.className = 'r29-voice-live';
      live.setAttribute('aria-live', 'polite');
      live.textContent = '正在录音，再点一次就发送';
      box.append(dot, clock, live, action('data-r29-voice-cancel', '取消', '取消录音'));
      return;
    }
    if (phase === 'held' && session) {
      var note = document.createElement('span');
      note.className = 'r29-voice-live';
      note.setAttribute('aria-live', 'polite');
      note.textContent = session.holdReason === 'limit'
        ? '到时间了，点发送' : '录音停了，还留着';
      box.append(note,
        action('data-r29-voice-send', '发送', '发送这段录音'),
        action('data-r29-voice-discard', '丢弃', '丢弃这段录音'));
      return;
    }
    if (phase === 'sending') {
      var busy = document.createElement('span');
      busy.className = 'r29-voice-live';
      busy.setAttribute('aria-live', 'polite');
      busy.textContent = '正在发送';
      box.append(busy);
      return;
    }
    if (phase === 'failed') {
      var fail = document.createElement('span');
      fail.className = 'r29-voice-live';
      fail.setAttribute('aria-live', 'polite');
      var failText = session && session.asr
        ? '转文字暂时不可用，录音已保存' : '没发出去，录音还在。';
      fail.textContent = failText;
      box.append(fail);
      return;
    }
    if (notice) {
      var tip = document.createElement('span');
      tip.className = 'r29-voice-live';
      tip.setAttribute('aria-live', 'polite');
      tip.textContent = notice;
      box.append(tip);
    }
  }

  function onHide() {
    if (document.visibilityState === 'hidden') requestStop('interrupt');
  }

  function onClick(event) {
    var node = event && event.target;
    if (node && node.nodeType === 3) node = node.parentNode;
    if (!node || typeof node.closest !== 'function') return;
    if (node.closest('[data-r29-voice-retry]')) {
      halt(event);
      onRetry();
      return;
    }
    if (node.closest('[data-r29-voice-cancel]')) {
      halt(event);
      requestStop('cancel');
      return;
    }
    if (node.closest('[data-r29-voice-discard]')) {
      halt(event);
      discardHeld();
      return;
    }
    if (node.closest('[data-r29-voice-send]')) {
      halt(event);
      sendHeld();
      return;
    }
    var mic = node.closest('[data-r29-mic]');
    if (!mic) return;
    halt(event);
    if (!voiceSlot()) return;
    if (mic.disabled || mic.getAttribute('disabled') !== null) return;
    if (phase === 'sending' || phase === 'stopping' || phase === 'arming' ||
        phase === 'failed') return;
    if (phase === 'recording') { requestStop('send'); return; }
    if (phase === 'held') { sendHeld(); return; }
    if (phase === 'idle') arm();
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', onHide);
  document.addEventListener('freeze', function () { requestStop('interrupt'); });
  window.addEventListener('pagehide', function () { requestStop('interrupt'); });
  try {
    if (window.Hub && typeof window.Hub.on === 'function') {
      window.Hub.on('render', paint);
      window.Hub.on('ready', paint);
    }
  } catch (err) { /* 壳还没起来 */ }
  ensureCard();
  paint();
  try {
    var motion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion && typeof motion.addEventListener === 'function') {
      motion.addEventListener('change', paint);
    }
  } catch (err2) { /* 没有媒体查询 */ }
})();
