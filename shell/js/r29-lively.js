/* 真实页把静态头像换成舞台，并给待机一个很轻的眨眼。不发请求。
   首页和对话站台若停在静帧，改成同目录动图；点一下换同目录点戳图。 */
(function () {
  'use strict';
  function engine() { return window.chiefPet; }
  function reduced() {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (error) { return false; }
  }
  function typing() {
    var el = document.activeElement;
    return !!(el && el.matches && el.matches('input,textarea,[contenteditable="true"]'));
  }
  function markup(slot, id) {
    var pet = engine();
    if (!pet || typeof pet.active !== 'function' || !pet.active(id)) return '';
    var html = slot === 'chat' ? pet.chatHTML() : pet.stage('home', id);
    return html && html.indexOf('data-pet-stage') >= 0 ? html : '';
  }
  function fromHTML(html) {
    var box = document.createElement('template');
    box.innerHTML = html;
    return box.content.firstElementChild;
  }
  function keepHost(host, html) {
    var next = fromHTML(html);
    if (!next) return false;
    host.className = next.className;
    if (next.getAttribute('style')) host.setAttribute('style', next.getAttribute('style'));
    var mark = next.getAttribute('data-pet-platform');
    if (mark) host.setAttribute('data-pet-platform', mark);
    host.replaceChildren();
    while (next.firstChild) host.appendChild(next.firstChild);
    return true;
  }
  function place(img, html) {
    var next = fromHTML(html);
    if (!next || !img.parentNode) return false;
    img.replaceWith(next);
    return true;
  }
  function upload(img) {
    var src = img.getAttribute('src') || '';
    return src.indexOf('/bff/') >= 0;
  }
  function lift() {
    var pet = engine();
    if (!pet || typeof document.querySelectorAll !== 'function') return false;
    var realMode = document.documentElement.dataset.hubMode === 'real';
    if (realMode && typeof pet.rebind === 'function' && !pet.active()) pet.rebind();
    var changed = false;
    var homes = document.querySelectorAll('.home-role img.hub-real-avatar[data-real-avatar]');
    Array.prototype.forEach.call(homes, function (img) {
      var parent = img.parentNode;
      if (!parent || !parent.classList || !parent.classList.contains('home-role')) return;
      if (upload(img)) return;
      var id = img.getAttribute('data-real-avatar') || '';
      if (place(img, markup('home', id))) changed = true;
    });
    var lanes = document.querySelectorAll('.r22-pet-platform');
    Array.prototype.forEach.call(lanes, function (host) {
      if (host.querySelector('[data-pet-stage]')) return;
      var img = host.querySelector('img.hub-real-avatar[data-real-avatar]');
      if (!img || upload(img)) return;
      var id = img.getAttribute('data-real-avatar') || '';
      if (!window.state || state.bot !== id) return;
      if (keepHost(host, markup('chat', id))) changed = true;
    });
    if (changed && typeof pet.sync === 'function') pet.sync();
    return changed;
  }
  function absUrl(file) {
    var logical = String(file || '');
    if (!logical || /^(?:blob:|data:|https?:|\/)/.test(logical)) return logical;
    var proto = '';
    try { proto = (window.location && window.location.protocol) || ''; }
    catch (error) { proto = ''; }
    if ((proto === 'http:' || proto === 'https:') && logical.indexOf('pets/') === 0) {
      return '/' + logical;
    }
    return logical;
  }
  function liveFile(file) {
    var text = String(file || '');
    if (text.indexOf('-still.webp') < 0) return '';
    return text.replace('-still.webp', '.webp');
  }
  function sibling(file, name) {
    var text = String(file || '');
    var cut = text.lastIndexOf('/');
    if (cut < 0) return '';
    return text.slice(0, cut + 1) + name;
  }
  function topImage(stage) {
    var list = stage.querySelectorAll('img');
    return list.length ? list[list.length - 1] : null;
  }
  function onMiss(img, url, previous) {
    function fail() {
      img.removeEventListener('error', fail);
      if (img.getAttribute('src') === url && previous) img.setAttribute('src', previous);
    }
    img.addEventListener('error', fail);
  }
  function promote() {
    if (document.hidden || reduced()) return;
    var stages = document.querySelectorAll('[data-pet-stage="home"],[data-pet-stage="chat"]');
    Array.prototype.forEach.call(stages, function (stage) {
      if (stage.getAttribute('data-r29-hold') === '1') return;
      var img = topImage(stage);
      if (!img) return;
      var next = liveFile(img.getAttribute('data-pet-file') || '');
      if (!next) return;
      var url = absUrl(next);
      if (!url || img.getAttribute('src') === url) return;
      onMiss(img, url, img.getAttribute('src') || '');
      img.setAttribute('src', url);
    });
  }
  function reactHome(img) {
    var stage = img.closest && img.closest('[data-pet-stage]');
    if (!stage || reduced() || document.hidden) return;
    var file = img.getAttribute('data-pet-file') || '';
    var base = liveFile(file) || file;
    var poke = sibling(base, 'poke.webp');
    if (!poke) return;
    var url = absUrl(poke);
    var previous = img.getAttribute('src') || '';
    stage.setAttribute('data-r29-hold', '1');
    stage.classList.remove('r29-react');
    reactStage = stage;
    function pop() { if (stage.isConnected) stage.classList.add('r29-react'); }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(pop);
    else pop();
    onMiss(img, url, previous);
    img.setAttribute('src', url);
    if (reactTimer) clearTimeout(reactTimer);
    reactTimer = setTimeout(function () {
      reactTimer = 0;
      reactStage = null;
      if (!stage.isConnected) return;
      stage.removeAttribute('data-r29-hold');
      stage.classList.remove('r29-react');
      if (document.hidden) return;
      promote();
    }, 800);
  }
  function rosterText(id) {
    var hook = window.HubRosterStatus;
    if (typeof hook !== 'function') return '';
    try {
      var value = hook(id);
      if (typeof value !== 'string') return '';
      return value.replace(/\s+/g, ' ').trim();
    } catch (error) { return ''; }
  }
  function paintDoing() {
    var pins = document.querySelectorAll('.pin[data-id]');
    Array.prototype.forEach.call(pins, function (pin) {
      var plate = pin.querySelector('.r22-nameplate');
      if (!plate || !plate.parentNode) return;
      var slot = pin.querySelector('[data-r29-doing]');
      if (!slot) {
        slot = document.createElement('span');
        slot.className = 'r29-doing';
        slot.setAttribute('data-r29-doing', '');
        slot.hidden = true;
        plate.parentNode.appendChild(slot);
      }
      var text = rosterText(pin.getAttribute('data-id') || '');
      if (!text) {
        if (slot.textContent) slot.textContent = '';
        if (!slot.hidden) slot.hidden = true;
        return;
      }
      if (slot.hidden) slot.hidden = false;
      if (slot.textContent !== text) slot.textContent = text;
    });
  }
  function placeDoor() {
    var top = document.querySelector('.home-top');
    if (!top || top.querySelector('[data-r29-go-stage]')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'r29-go-stage';
    button.setAttribute('data-r29-go-stage', '');
    button.textContent = '去站台看看';
    top.appendChild(button);
  }
  function dress() {
    lift();
    placeDoor();
    paintDoing();
    promote();
  }
  function blinkOnce() {
    if (document.hidden || reduced() || typing()) return;
    var nodes = document.querySelectorAll(
      '[data-pet-stage][data-pet-state="idle"],[data-pet-stage][data-pet-state="idleB"]'
    );
    Array.prototype.forEach.call(nodes, function (el) { el.classList.remove('r29-blink'); });
    if (typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(nodes, function (el) {
        if (el.isConnected) el.classList.add('r29-blink');
      });
    });
  }
  var blinkTimer = 0;
  var dressTimer = 0;
  var dressLeft = 0;
  var reactTimer = 0;
  var reactStage = null;
  function armBlink() {
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = 0;
    if (document.hidden) return;
    var wait = 3000 + Math.floor(Math.random() * 3500);
    blinkTimer = setTimeout(function () {
      blinkTimer = 0;
      if (document.hidden) return;
      blinkOnce();
      armBlink();
    }, wait);
  }
  function startDress() {
    if (dressTimer || document.hidden || dressLeft <= 0) return;
    dressTimer = setInterval(function () {
      if (document.hidden) {
        clearInterval(dressTimer);
        dressTimer = 0;
        return;
      }
      dress();
      dressLeft -= 1;
      if (dressLeft <= 0) {
        clearInterval(dressTimer);
        dressTimer = 0;
      }
    }, 300);
  }
  function clearReact() {
    if (reactTimer) clearTimeout(reactTimer);
    reactTimer = 0;
    if (reactStage && reactStage.isConnected) {
      reactStage.removeAttribute('data-r29-hold');
      reactStage.classList.remove('r29-react');
    }
    reactStage = null;
  }
  function onHide() {
    if (document.hidden) {
      document.documentElement.setAttribute('data-r29-page-hidden', '1');
      if (blinkTimer) clearTimeout(blinkTimer);
      blinkTimer = 0;
      clearReact();
      if (dressTimer) clearInterval(dressTimer);
      dressTimer = 0;
      return;
    }
    document.documentElement.removeAttribute('data-r29-page-hidden');
    armBlink();
    if (dressLeft > 0) startDress();
    promote();
  }
  function watch() {
    if (typeof MutationObserver === 'function' && document.body) {
      var observer = new MutationObserver(function () { dress(); });
      observer.observe(document.body, {childList: true, subtree: true});
    }
    dress();
    dressLeft = 24;
    startDress();
    armBlink();
    document.addEventListener('visibilitychange', onHide);
    document.addEventListener('pointerdown', function (ev) {
      var pin = ev.target && ev.target.closest && ev.target.closest('.pin');
      if (!pin) return;
      var img = pin.querySelector('[data-pet-stage="home"] img');
      if (img) reactHome(img);
    });
    document.addEventListener('click', function (ev) {
      var button = ev.target && ev.target.closest && ev.target.closest('[data-r29-go-stage]');
      if (!button || !window.Hub || typeof Hub.navigate !== 'function') return;
      Hub.navigate({view: 'stage'});
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
