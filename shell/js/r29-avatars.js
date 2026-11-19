/* 同一张脸。对话页顶栏只调用，不在这里改顶栏。 */
(function () {
  'use strict';
  var lastRead = '';
  var bound = null;
  var painting = false;
  var queued = false;

  function pxOf(px) {
    var n = Number(px);
    if (!Number.isFinite(n)) n = 40;
    n = Math.round(n);
    if (n < 12) n = 12;
    if (n > 128) n = 128;
    return n;
  }

  function letterOf(name) {
    var chars = Array.from(String(name || ''));
    return chars[0] || '助';
  }

  function colorOf(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '';
  }

  function safeSrc(src) {
    try {
      if (typeof localAvatarSource !== 'function') return '';
      return localAvatarSource(src) || '';
    } catch (e) {
      return '';
    }
  }

  function botOf(id) {
    try {
      if (typeof botBy !== 'function') return null;
      var found = botBy(id);
      return found && found.id === id ? found : null;
    } catch (e) {
      return null;
    }
  }

  function catalogFace(id, bot) {
    var list = typeof AVATAR_CATALOG === 'undefined' ? [] : AVATAR_CATALOG;
    if (!Array.isArray(list)) return '';
    var avatar = bot && bot.avatar;
    var row = null;
    if (avatar && (avatar.kind === 'pack' || avatar.kind === 'spare') && avatar.id) {
      row = list.find(function (item) {
        return item && item.id === avatar.id && item.kind === avatar.kind && item.avatar;
      });
    }
    if (!row) {
      row = list.find(function (item) {
        return item && item.sourceAssistant === id && item.avatar;
      });
    }
    return row && row.avatar ? row.avatar : '';
  }

  function faceSrc(id, bot) {
    if (!bot) return '';
    var avatar = bot.avatar || {};
    var src = '';
    if (avatar.kind === 'upload') src = safeSrc(avatar.dataURL);
    if (!src) src = safeSrc(catalogFace(id, bot));
    if (!src) {
      var outfit = (bot.outfits || []).find(function (item) { return item.id === bot.outfitId; });
      src = safeSrc(outfit && outfit.avatarSrc);
    }
    if (!src && bot.faces) src = safeSrc(bot.faces.normal);
    if (!src) src = safeSrc(bot.avatarSrc);
    return src || '';
  }

  function shapeSvg(bot, shown, letter, name, size, quiet) {
    var avatar = bot.avatar || {};
    var shapes = typeof ASSISTANT_SHAPES === 'undefined' ? [] : ASSISTANT_SHAPES;
    var found = Array.isArray(shapes)
      ? shapes.find(function (item) { return item && item.id === avatar.shapeId; })
      : null;
    if (!found && Array.isArray(shapes)) found = shapes[0] || null;
    var path = found && found.path ? String(found.path) : 'M60 18a42 42 0 1 0 .1 0z';
    var fill = colorOf(bot.color) || colorOf(avatar.color) || '#6d7a86';
    var style = '--r29-size:' + size + 'px;--r29-ink:' + fill;
    var label = quiet ? ' aria-hidden="true"' : ' role="img" aria-label="' + esc(name) + '"';
    return '<svg class="r29-face r29-shape" data-r29-avatar="' + esc(shown) +
      '" data-bot-avatar="' + esc(shown) + '" data-avatar-kind="shape" data-r29-letter="' +
      esc(letter) + '" viewBox="0 0 120 120"' + label + ' style="' + style +
      '"><path d="' + esc(path) + '" fill="' + esc(fill) + '"></path></svg>';
  }

  function html(id, px, quiet) {
    var size = pxOf(px);
    var bot = botOf(id);
    var name = bot && bot.name ? String(bot.name) : '助理';
    var letter = letterOf(bot && bot.name ? bot.name : '');
    var color = colorOf(bot && (bot.color || (bot.avatar && bot.avatar.color)));
    var src = faceSrc(id, bot);
    var shown = bot && bot.id ? bot.id : (id || '');
    if (bot && bot.avatar && bot.avatar.kind === 'shape') {
      return shapeSvg(bot, shown, letter, name, size, quiet);
    }
    var style = '--r29-size:' + size + 'px' + (color ? ';--r29-ink:' + color : '');
    var open = '<span class="r29-face" data-r29-avatar="' + esc(shown) +
      '" data-bot-avatar="' + esc(shown) + '" data-r29-letter="' + esc(letter) + '"' +
      (quiet ? '' : ' role="img" aria-label="' + esc(name) + '"') +
      ' style="' + style + '">';
    var inner = src
      ? '<img class="r29-face-img" alt="" aria-hidden="true" draggable="false" src="' + esc(src) + '">'
      : '<span class="r29-initial" aria-hidden="true">' + esc(letter) + '</span>';
    return open + inner + '</span>';
  }

  function stackHtml(ids, px) {
    var list = Array.isArray(ids) ? ids.filter(function (id) { return id != null && id !== ''; }) : [];
    if (!list.length) return '';
    if (list.length === 1) return html(list[0], px);
    var shown = list.slice(0, 3);
    var size = pxOf(px);
    var face = Math.max(12, Math.round(size * (shown.length > 2 ? 0.58 : 0.62)));
    var names = shown.map(function (id) {
      var bot = botOf(id);
      return bot && bot.name ? String(bot.name) : '助理';
    });
    var body = shown.map(function (id) { return html(id, face, true); }).join('');
    return '<span class="r29-stack" data-r29-stack="' + esc(shown.join(',')) +
      '" data-r29-n="' + shown.length + '" style="--r29-size:' + size + 'px" role="img" aria-label="' +
      esc(names.join('、')) + '">' + body + '</span>';
  }

  function broken(event) {
    try {
      var img = event.target;
      if (!img || !img.classList || !img.classList.contains('r29-face-img')) return;
      var face = img.closest ? img.closest('.r29-face') : null;
      if (!face || face.querySelector('.r29-initial')) return;
      var span = document.createElement('span');
      span.className = 'r29-initial';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = face.getAttribute('data-r29-letter') || '助';
      img.replaceWith(span);
    } catch (e) {}
  }

  function onReading(snap) {
    var api = window.HubUnread;
    if (!api || typeof api.markRead !== 'function' || !snap) return;
    var id = snap.conversation || '';
    // 看着讨论组时，读完的是这个组，不是底下那段占位的单聊会话。
    try { if (window.state && state.r29GroupFocus) id = String(state.r29GroupFocus); } catch (e) {}
    if (!snap.atBottom) {
      if (lastRead === id) lastRead = '';
      return;
    }
    if (!id || lastRead === id) return;
    lastRead = id;
    try { api.markRead(id); } catch (e) {}
  }

  function paint() {
    if (painting) { queued = true; return; }
    painting = true;
    try {
      if (typeof render === 'function') render();
    } catch (e) {}
    painting = false;
    if (!queued) return;
    queued = false;
    try { if (typeof render === 'function') render(); } catch (e) {}
  }

  function ensureSub() {
    var api = window.HubUnread;
    if (!api || typeof api.subscribe !== 'function') { bound = null; return; }
    if (bound === api) return;
    bound = api;
    var armed = false;
    try {
      api.subscribe(function () { if (armed) paint(); });
      armed = true;
    } catch (e) {
      bound = null;
    }
  }

  function openGroup(event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-r29-group-open]') : null;
    if (!button || !window.Hub || typeof Hub.navigate !== 'function') return;
    var id = button.getAttribute('data-r29-group-open') || '';
    if (!id) return;
    try { Hub.navigate({view: 'chat', conversation: id}); } catch (e) {}
  }

  document.addEventListener('error', broken, true);
  document.addEventListener('click', openGroup);
  if (window.Hub && typeof Hub.on === 'function') {
    Hub.on('reading:change', onReading);
    Hub.on('render', ensureSub);
  }
  ensureSub();
  window.HubAvatars = {html: html, stackHtml: stackHtml};
})();
