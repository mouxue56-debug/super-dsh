/* 形象统一。适配层在名册、资料页、选形象处直接画 img.hub-real-avatar
   （avatar-96 的方形全身半身图）。这里只给它们打上 r30-aface 标记并带上名牌色，
   样式在 css/r30-avatar.css 里改成和别处一样的圆形头像。不发请求、不改数据。 */
(function () {
  'use strict';
  var queued = false;
  function inkOf(id) {
    try {
      var bot = typeof botBy === 'function' && id ? botBy(id) : null;
      var color = bot && (bot.color || (bot.avatar && bot.avatar.color));
      return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '';
    } catch (error) { return ''; }
  }
  function tag() {
    queued = false;
    var list = document.querySelectorAll('img.hub-real-avatar[data-real-avatar]:not(.r30-aface)');
    Array.prototype.forEach.call(list, function (img) {
      if (img.closest('[data-pet-stage],.r22-pet-platform,.home-role')) return;
      var src = img.getAttribute('src') || '';
      if (src.indexOf('/pets/') < 0 && src.indexOf('/bff/avatars/') < 0) return;
      img.classList.add('r30-aface');
      var ink = inkOf(img.getAttribute('data-real-avatar') || '');
      if (ink) img.style.setProperty('--r30-ink', ink);
    });
  }
  function soon() {
    if (queued) return;
    queued = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tag);
    else setTimeout(tag, 16);
  }
  function start() {
    tag();
    if (typeof MutationObserver === 'function' && document.body) {
      new MutationObserver(soon).observe(document.body, {childList: true, subtree: true});
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
