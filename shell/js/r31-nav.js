/* 导航收拢。
 * 「设置」页：权限、外观、其他设置都从这里进（更多第一层不再各放一行）。
 * 没有别的逻辑；今天页怎么开在 core.js（data-today-open），更多里的路由在 r29-permissions.js。 */
(function () {
  'use strict';
  function install() {
    var H = window.Hub;
    if (!H || typeof H.registerPanel !== 'function') return;
    var NAMES = { open: '全开', ask: '改动前问我', readonly: '只读' };
    function row(attrs, title, hint) {
      var props = Object.assign({ type: 'button', class: 'setting-row r31-settings-row' }, attrs);
      return H.h('button', props, [H.h('span', { class: 'grow' }, [H.h('strong', {}, title),
        hint ? H.h('small', {}, hint) : null]), H.h('span', { 'aria-hidden': 'true' }, '›')]);
    }
    try {
      H.registerPanel('r31-settings', { title: '设置', render: function (host) {
        var mode = window.R29Permission && window.R29Permission.mode;
        var now = NAMES[mode] ? '现在：' + NAMES[mode] : '助理能自己做到哪一步';
        host.replaceChildren(
          row({ 'data-r29-open-permissions': '', 'data-r31-setting': 'permissions' }, '权限', now),
          row({ 'data-r29-more': 'appearance', 'data-r31-setting': 'appearance' }, '外观', '白天、晚上、皮肤'),
          row({ 'data-act': 'settings', 'data-r31-setting': 'more' }, '其他设置', '助理、连接、健康、偏好'));
        if (window.R29Settings && typeof R29Settings.mountMirror === 'function') R29Settings.mountMirror(host);
      } });
    } catch (error) { /* 已经登记过就算了 */ }
  }
  if (window.Hub) install();
  else document.addEventListener('DOMContentLoaded', install);
})();
