/* 回复旁边的「念出来」。自动念默认开。
 * 播放尽量挂在主人的点击上。回复是后来才到的，播不成就留下播放条。 */
(function () {
  'use strict';
  var KEY = 'sds-speak-auto';
  var armed = null;
  var seen = new Set();
  var autoDone = new Set();
  var queued = null;
  var audioCtx = null;
  var painting = false;

  function autoOn() {
    try { return window.localStorage.getItem(KEY) !== 'off'; }
    catch (err) { return true; }
  }

  function setAuto(on) {
    try { window.localStorage.setItem(KEY, on ? 'on' : 'off'); }
    catch (err) { /* 存不住就只在这一页生效 */ }
    paintSwitch();
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function textOf(article) {
    var id = article.getAttribute('data-message-id') || '';
    try {
      if (window.Hub && typeof Hub.messageText === 'function' && typeof Hub.currentMessages === 'function') {
        var found = Hub.currentMessages().filter(function (item) { return item && item.id === id; })[0];
        if (found) return String(Hub.messageText(found) || '');
      }
    } catch (err) { /* 用气泡里的字 */ }
    var bubble = article.querySelector('.bubble');
    return bubble ? String(bubble.textContent || '') : '';
  }

  function paintButtons() {
    var nodes = document.querySelectorAll('.msg-bot');
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].querySelector('[data-r45-speak]')) continue;
      var button = el('button', 'r45-speak');
      button.type = 'button';
      button.setAttribute('data-r45-speak', '');
      button.textContent = '念出来';
      button.setAttribute('aria-label', '把这条回复念出来');
      nodes[i].append(button);
    }
  }

  function paintSwitch() {
    var page = document.querySelector('[data-r29-settings-page]');
    if (!page) return;
    var button = page.querySelector('[data-r45-auto]');
    if (!button) {
      var section = el('section', 'r29-block');
      var row = el('div', 'r29-row');
      var label = el('p', 'r29-grow');
      label.textContent = '语音发来的话，回复自动念';
      button = el('button', 'r45-auto');
      button.type = 'button';
      button.setAttribute('data-r45-auto', '');
      row.append(label, button);
      section.append(row);
      page.append(section);
    }
    var on = autoOn();
    var label = on ? '开' : '关';
    var pressed = on ? 'true' : 'false';
    if (button.textContent !== label) button.textContent = label;
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    if (button.getAttribute('aria-label') !== '语音发来的话，回复自动念') {
      button.setAttribute('aria-label', '语音发来的话，回复自动念');
    }
  }

  function ensureBar() {
    var bar = document.querySelector('[data-r45-playbar]');
    if (bar) return bar;
    bar = el('div', 'r45-playbar');
    bar.setAttribute('data-r45-playbar', '');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '播放');
    bar.hidden = true;
    var play = el('button', 'r45-play');
    play.type = 'button';
    play.setAttribute('data-r45-play', '');
    play.textContent = '播放';
    var status = el('span', 'r45-play-status');
    status.setAttribute('data-r45-play-status', '');
    bar.append(play, status);
    document.body.append(bar);
    return bar;
  }

  function showBar(status, canPlay) {
    var bar = ensureBar();
    bar.hidden = false;
    var play = bar.querySelector('[data-r45-play]');
    var line = bar.querySelector('[data-r45-play-status]');
    if (line) line.textContent = status;
    if (play) {
      play.disabled = !canPlay;
      play.textContent = '播放';
    }
  }

  function prime() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') audioCtx.resume();
      var buf = audioCtx.createBuffer(1, 1, 22050);
      var src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(audioCtx.destination);
      src.start(0);
      return true;
    } catch (err) { return false; }
  }

  function ask(text, id) {
    var fn = window.HubSpeak;
    if (typeof fn !== 'function') {
      return Promise.resolve({ ok: false, error: 'tts-unavailable', message: '还没接上' });
    }
    return Promise.resolve().then(function () { return fn(text, id); }).then(function (data) {
      return data && typeof data === 'object' ? data : { ok: false, error: 'failed', message: '这会儿念不出来' };
    }, function () {
      return { ok: false, error: 'failed', message: '这会儿念不出来' };
    });
  }

  function clipUrl(b64, mime) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i) & 255;
    return URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/wav' }));
  }

  function playOne(url) {
    return new Promise(function (resolve, reject) {
      var audio = new Audio(url);
      var done = false;
      var finish = function (err) {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        if (err) reject(err);
        else resolve();
      };
      audio.addEventListener('ended', function () { finish(); });
      audio.addEventListener('error', function () { finish(new Error('play')); });
      var pending;
      try { pending = audio.play(); }
      catch (err) { finish(err); return; }
      if (pending && typeof pending.then === 'function') pending.then(function () {}, finish);
    });
  }

  function playNow(data) {
    var list = data && Array.isArray(data.segments) ? data.segments : [];
    if (!list.length) return Promise.reject(new Error('empty'));
    var chain = Promise.resolve();
    list.forEach(function (part) {
      chain = chain.then(function () { return playOne(clipUrl(part, data.mime)); });
    });
    return chain;
  }

  function afterAudio(data) {
    if (!data || data.ok !== true) {
      queued = null;
      showBar((data && data.message) || '还没接上', false);
      return;
    }
    queued = data;
    showBar(data.note || '正在念', true);
    playNow(data).then(function () {
      showBar('念完了', true);
    }, function () {
      showBar('自动播放被拦住了，点一下播放', true);
    });
  }

  function speakArticle(article) {
    var text = textOf(article).trim();
    if (!text) {
      showBar('这段没有可念的字', false);
      return;
    }
    showBar('正在准备', false);
    ask(text, article.getAttribute('data-message-id') || '').then(afterAudio);
  }

  function sameChat(conversation) {
    if (!conversation) return true;
    try { return !window.state || state.conversation === conversation; }
    catch (err) { return true; }
  }

  function paintAll() {
    if (painting) return;
    painting = true;
    try {
      paintButtons();
      paintSwitch();
      var nodes = document.querySelectorAll('.msg-bot[data-message-id]');
      var fresh = [];
      for (var i = 0; i < nodes.length; i += 1) {
        var id = nodes[i].getAttribute('data-message-id');
        if (!seen.has(id)) {
          seen.add(id);
          fresh.push(nodes[i]);
        }
      }
      if (!armed || !autoOn() || !fresh.length || !sameChat(armed.conversation)) return;
      if (Date.now() - armed.at > 3 * 60 * 1000) { armed = null; return; }
      var last = fresh[fresh.length - 1];
      var idLast = last.getAttribute('data-message-id');
      if (autoDone.has(idLast)) return;
      autoDone.add(idLast);
      armed = null;
      speakArticle(last);
    } finally {
      painting = false;
    }
  }

  document.addEventListener('r45-voice-sent', function (event) {
    var detail = event && event.detail || {};
    armed = { conversation: detail.conversation || '', at: Date.now() };
    prime();
  });

  document.addEventListener('click', function (event) {
    var node = event.target && event.target.closest ? event.target : null;
    if (!node || !node.closest) return;
    var speak = node.closest('[data-r45-speak]');
    if (speak) {
      event.preventDefault();
      prime();
      var article = speak.closest('.msg-bot');
      if (article) speakArticle(article);
      return;
    }
    var toggle = node.closest('[data-r45-auto]');
    if (toggle) {
      event.preventDefault();
      setAuto(!autoOn());
      return;
    }
    if (node.closest('[data-r45-play]')) {
      event.preventDefault();
      if (!queued) return;
      prime();
      showBar('正在念', true);
      playNow(queued).then(function () { showBar('念完了', true); }, function () {
        showBar('点一下播放', true);
      });
    }
  }, true);

  function boot() {
    paintAll();
    try {
      if (window.Hub && typeof Hub.on === 'function') Hub.on('render', paintAll);
    } catch (err) { /* 壳还没起来 */ }
    if (typeof MutationObserver === 'function') {
      var watch = new MutationObserver(function () { paintAll(); });
      watch.observe(document.documentElement || document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
