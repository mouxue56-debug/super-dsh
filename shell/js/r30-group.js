/* 拉群：点单聊顶栏的助理头像拉其他助理进来；讨论组里再拉人、请人出组；首页「最近」里直接拉个群聊。
   真实方式走 window.HubGroups 的 create、addMembers、removeMember（适配层提供）；
   没有这几个钩子（演示方式）就改本地假数据。所有来自助理的文字只按纯文本。 */
(function () {
  'use strict';

  var GROUP_MAX = 8;
  var sheet = null;
  var rootNode = null;

  function escText(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function realMode() {
    var root = document.documentElement;
    return !!(root && root.dataset && root.dataset.hubMode === 'real');
  }

  function hook(name) {
    var api = window.HubGroups;
    return api && typeof api[name] === 'function' ? api : null;
  }

  function canEdit() {
    if (hook('create') && hook('addMembers') && hook('removeMember')) return true;
    return !realMode();
  }

  function eligible() {
    var list = (window.state && state.bots) || [];
    return list.filter(function (bot) {
      return bot && bot.id && !bot.steward && !bot.parent && bot.enabled !== false;
    });
  }

  function botOf(id) {
    var list = eligible();
    var i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function nameOf(id) {
    var bot = botOf(id);
    return bot && bot.name ? String(bot.name) : '暂无';
  }

  function dutyOf(bot) {
    if (!bot) return '';
    var text = bot.duty || bot.homeLabel || '';
    if (!text && typeof SHORT !== 'undefined' && SHORT[bot.id]) text = SHORT[bot.id];
    return String(text || '').trim();
  }

  function clip(text, n) {
    return Array.from(String(text || '')).slice(0, n).join('');
  }

  function face(id, px) {
    try {
      if (window.HubAvatars && typeof HubAvatars.html === 'function') return HubAvatars.html(id, px) || '';
    } catch (err) {}
    try {
      if (typeof r29Face === 'function') return r29Face(id, px) || '';
    } catch (err2) {}
    return '';
  }

  function currentGroup() {
    try {
      return typeof window.r29GroupHere === 'function' ? window.r29GroupHere() : null;
    } catch (err) {
      return null;
    }
  }

  function topicOf(botId) {
    var names = (window.state && state.sessionNames) || {};
    var title = String(names[botId] || '').trim();
    if (!title || title === '当前会话') return '';
    return clip(title.replace(/\s+/g, ' '), 40);
  }

  function defaultName() {
    if (!sheet) return '';
    if (sheet.kind === 'bot') {
      var topic = topicOf(sheet.bot);
      if (topic) return topic;
    }
    var ids = (sheet.kind === 'bot' ? [sheet.bot] : []).concat(sheet.picked);
    var names = ids.map(nameOf);
    if (!names.length) return '';
    var text = names.length > 3 ? names.slice(0, 3).join('、') + '等' : names.join('、');
    return clip(text + '的群聊', 40);
  }

  function shownName() {
    return sheet.touched ? sheet.name : defaultName();
  }

  function needed() {
    return sheet && sheet.kind === 'new' ? 2 : 1;
  }

  function candidates() {
    var skip = {};
    if (sheet.kind === 'bot') skip[sheet.bot] = true;
    if (sheet.kind === 'add' && sheet.group) {
      (sheet.group.members || []).forEach(function (m) {
        skip[typeof m === 'string' ? m : (m && (m.id || m.bot))] = true;
      });
    }
    return eligible().filter(function (bot) { return !skip[bot.id]; });
  }

  function rowHtml(bot) {
    var on = sheet.picked.indexOf(bot.id) >= 0;
    var duty = dutyOf(bot);
    return '<li><button type="button" class="r30g-row' + (on ? ' is-on' : '') + '" data-r30-pick="' +
      escText(bot.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="r30-row-face">' + face(bot.id, 40) + '</span>' +
      '<span class="r30-row-text"><strong>' + escText(bot.name || '暂无') + '</strong>' +
      (duty ? '<small>' + escText(duty) + '</small>' : '') + '</span>' +
      '<span class="r30-check" aria-hidden="true">' + (on ? '✓' : '') + '</span></button></li>';
  }

  function topHtml() {
    if (sheet.kind === 'bot') {
      var bot = botOf(sheet.bot);
      var duty = dutyOf(bot);
      return '<div class="r30-bot"><span class="r30-bot-face">' + face(sheet.bot, 72) + '</span>' +
        '<div class="r30-bot-text"><strong>' + escText(bot ? bot.name : '暂无') + '</strong>' +
        (duty ? '<p>' + escText(duty) + '</p>' : '') + '</div></div>';
    }
    var title = sheet.kind === 'add' ? '再拉人进来' : '拉个群聊';
    var group = sheet.group;
    var sub = sheet.kind === 'add' && group && group.name ? escText(group.name) : '挑两位以上，一起商量';
    return '<div class="r30-bot r30-bot-plain"><div class="r30-bot-text"><strong>' + title +
      '</strong><p>' + sub + '</p></div></div>';
  }

  function lead() {
    if (sheet.kind === 'bot') return '拉其他助理进来';
    if (sheet.kind === 'add') return '选要拉进来的';
    return '选哪几位';
  }

  function goLabel() {
    var n = sheet.picked.length;
    if (sheet.busy) return '正在拉…';
    if (sheet.kind === 'add') return n ? '加入 ' + n + ' 位' : '加入';
    var total = n + (sheet.kind === 'bot' ? 1 : 0);
    return n ? '开始群聊（共 ' + total + ' 位）' : '开始群聊';
  }

  function paint() {
    if (!sheet) return;
    if (!rootNode) {
      rootNode = document.createElement('div');
      rootNode.className = 'r30-root';
      rootNode.setAttribute('data-r30-root', '');
      document.body.appendChild(rootNode);
    }
    var old = rootNode.querySelector('.r30g-list');
    var keep = old ? old.scrollTop : 0;
    var list = candidates();
    var rows = list.map(rowHtml).join('');
    if (!rows) rows = '<li class="r30g-empty">没有别的助理可拉了</li>';
    var ready = sheet.picked.length >= needed() && !sheet.busy;
    var nameBox = sheet.kind === 'add' ? '' :
      '<label class="r30-name"><span>群名</span><input type="text" maxlength="40" data-r30-name value="' +
      escText(shownName()) + '" aria-label="群名"></label>';
    var error = sheet.error ? '<p class="r30-error" role="alert">' + escText(sheet.error) + '</p>' : '';
    rootNode.innerHTML = '<div class="r30-backdrop" data-r30g-close></div>' +
      '<section class="r30g-sheet" role="dialog" aria-modal="true" tabindex="-1" aria-label="' +
      escText(sheet.kind === 'bot' ? nameOf(sheet.bot) : (sheet.kind === 'add' ? '再拉人' : '拉个群聊')) + '">' +
      '<div class="r30g-grab" aria-hidden="true"></div>' +
      '<button type="button" class="r30g-x" data-r30g-close aria-label="关闭">×</button>' +
      topHtml() +
      '<h3 class="r30-lead">' + escText(lead()) + '</h3>' +
      '<ul class="r30g-list">' + rows + '</ul>' + nameBox + error +
      '<button type="button" class="r30-go" data-r30-go' + (ready ? '' : ' disabled') + '>' +
      escText(goLabel()) + '</button></section>';
    var fresh = rootNode.querySelector('.r30g-list');
    if (fresh) fresh.scrollTop = keep;
  }

  function open(next) {
    sheet = next;
    sheet.picked = [];
    sheet.name = '';
    sheet.touched = false;
    sheet.busy = false;
    sheet.error = '';
    paint();
    var node = rootNode && rootNode.querySelector('.r30g-sheet');
    if (node && node.focus) node.focus({preventScroll: true});
  }

  function close() {
    sheet = null;
    if (rootNode) {
      if (rootNode.remove) rootNode.remove();
      rootNode = null;
    }
  }

  function toast(text) {
    try {
      if (window.Hub && typeof Hub.toast === 'function') Hub.toast(text);
    } catch (err) {}
  }

  function eventMessage(kind, text) {
    return {id: 'r30-e' + Date.now().toString(36) + Math.floor(Math.random() * 1000), type: kind, text: text};
  }

  function demoCreate(ids, name) {
    if (!window.state) return null;
    if (!Array.isArray(state.groups)) state.groups = [];
    var group = {
      id: 'g-r30-' + Date.now().toString(36),
      name: name, title: name, topic: name,
      host: ids[0], members: ids.slice(),
      updatedAt: Date.now(),
      messages: [eventMessage('join', '主人拉了' + ids.map(nameOf).join('、') + '一起开了这个组，' +
        nameOf(ids[0]) + '主持')]
    };
    state.groups.push(group);
    return group;
  }

  function submit() {
    if (!sheet || sheet.busy) return;
    var ids = (sheet.kind === 'bot' ? [sheet.bot] : []).concat(sheet.picked);
    if (sheet.kind === 'add') {
      if (!sheet.picked.length) return;
    } else if (ids.length < 2) {
      return;
    }
    var name = String(shownName() || '').trim();
    var kind = sheet.kind;
    var groupId = sheet.group && sheet.group.id;
    sheet.busy = true;
    sheet.error = '';
    paint();
    var api;
    if (kind === 'add') {
      api = hook('addMembers');
      if (api) {
        Promise.resolve(api.addMembers(groupId, sheet.picked.slice())).then(done, failed);
      } else {
        demoAdd(sheet.group, sheet.picked.slice());
        done({ok: true});
      }
      return;
    }
    api = hook('create');
    if (api) {
      Promise.resolve(api.create({name: name || defaultName(), members: ids, host: ids[0]})).then(done, failed);
      return;
    }
    var made = demoCreate(ids, name || defaultName());
    done({ok: !!made, group: made});
  }

  function done(result) {
    if (!sheet) return;
    if (!result || result.ok === false) {
      sheet.busy = false;
      sheet.error = result && result.error ? String(result.error) : '没拉成，请再试一次';
      paint();
      return;
    }
    var group = result.group;
    close();
    if (group && typeof window.r29GroupShow === 'function') window.r29GroupShow(group);
    else if (typeof render === 'function') render();
  }

  function failed() {
    if (!sheet) return;
    sheet.busy = false;
    sheet.error = '没拉成，请再试一次';
    paint();
  }

  function demoAdd(group, ids) {
    if (!group) return;
    var have = (group.members || []).map(function (m) { return typeof m === 'string' ? m : (m && (m.id || m.bot)); });
    var fresh = ids.filter(function (id) { return have.indexOf(id) < 0; });
    if (!fresh.length) return;
    group.members = (group.members || []).concat(fresh);
    group.messages = (group.messages || []).concat([
      eventMessage('join', '主人把' + fresh.map(nameOf).join('、') + '拉进来了')
    ]);
    group.updatedAt = Date.now();
  }

  function demoRemove(group, id) {
    if (!group) return;
    group.members = (group.members || []).filter(function (m) {
      return (typeof m === 'string' ? m : (m && (m.id || m.bot))) !== id;
    });
    group.messages = (group.messages || []).concat([
      eventMessage('leave', '主人把' + nameOf(id) + '请出了这个组')
    ]);
    group.updatedAt = Date.now();
  }

  function removeMember(group, id) {
    var api = hook('removeMember');
    var ask = state.r30RemoveAsk;
    var key = (group.id || '') + ':' + id;
    if (ask !== key) {
      state.r30RemoveAsk = key;
      if (typeof render === 'function') render();
      return;
    }
    state.r30RemoveAsk = '';
    if (!api) {
      demoRemove(group, id);
      if (typeof render === 'function') render();
      return;
    }
    Promise.resolve(api.removeMember(group.id, id)).then(function (result) {
      if (!result || result.ok === false) toast(result && result.error ? String(result.error) : '没请出去，请再试一次');
      if (typeof render === 'function') render();
    }, function () {
      toast('没请出去，请再试一次');
      if (typeof render === 'function') render();
    });
  }

  function toggle(id) {
    if (!sheet) return;
    var at = sheet.picked.indexOf(id);
    if (at >= 0) {
      sheet.picked.splice(at, 1);
    } else {
      var count = sheet.picked.length + (sheet.kind === 'bot' ? 1 : 0) +
        (sheet.kind === 'add' && sheet.group ? (sheet.group.members || []).length : 0);
      if (count >= GROUP_MAX) {
        sheet.error = '一个组最多 ' + GROUP_MAX + ' 位助理';
        paint();
        return;
      }
      sheet.picked.push(id);
    }
    sheet.error = '';
    paint();
  }

  function openBot(id) {
    if (!botOf(id)) return;
    if (!canEdit()) {
      toast('现在连不上，先不能拉群');
      return;
    }
    open({kind: 'bot', bot: id});
  }

  function onClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var tap = target.closest('[data-r30-bot-sheet]');
    if (tap) {
      event.preventDefault();
      event.stopPropagation();
      openBot(tap.getAttribute('data-r30-bot-sheet') || '');
      return;
    }
    var fresh = target.closest('[data-r30-new-group]');
    if (fresh) {
      event.preventDefault();
      event.stopPropagation();
      if (!canEdit()) {
        toast('现在连不上，先不能拉群');
        return;
      }
      open({kind: 'new'});
      return;
    }
    var more = target.closest('[data-r30-add]');
    if (more) {
      event.preventDefault();
      event.stopPropagation();
      var group = currentGroup();
      if (group) open({kind: 'add', group: group});
      return;
    }
    var gone = target.closest('[data-r30-remove]');
    if (gone) {
      event.preventDefault();
      event.stopPropagation();
      var host = currentGroup();
      if (host) removeMember(host, gone.getAttribute('data-r30-remove') || '');
      return;
    }
    if (!sheet || !rootNode || !rootNode.contains(target)) return;
    if (target.closest('[data-r30g-close]')) {
      event.preventDefault();
      close();
      return;
    }
    var pick = target.closest('[data-r30-pick]');
    if (pick) {
      event.preventDefault();
      toggle(pick.getAttribute('data-r30-pick') || '');
      return;
    }
    if (target.closest('[data-r30-go]')) {
      event.preventDefault();
      submit();
    }
  }

  function onInput(event) {
    var target = event.target;
    if (!sheet || !target || !target.matches || !target.matches('[data-r30-name]')) return;
    sheet.name = target.value;
    sheet.touched = true;
  }

  function onKey(event) {
    if (event.key === 'Escape' && sheet) {
      close();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target && event.target.matches &&
      event.target.matches('[data-r30-bot-sheet]')) {
      event.preventDefault();
      openBot(event.target.getAttribute('data-r30-bot-sheet') || '');
    }
  }

  // 首页「最近」旁边放一个「拉个群聊」。别的地方不再放入口。
  // 按钮不放进「最近」那个标签里（别的检查按标签原文核对），放在它所在的区块里，用样式摆到标签右边。
  function injectHome() {
    var recent = document.querySelector('.home-recent');
    if (!recent || !recent.querySelector('.section-label') || recent.querySelector('[data-r30-new-group]')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'r30-newgroup';
    button.setAttribute('data-r30-new-group', '');
    button.textContent = '＋ 拉个群聊';
    recent.insertBefore(button, recent.firstChild);
  }

  // 演示方式下在讨论组里说话：只改本地假数据。真实方式由适配层接管。
  // 发送由别的模块在 document 捕获阶段接走，所以这里也挂在 document 捕获阶段，抢在它前面。
  function demoGroupSend(event) {
    if (realMode() || hook('create')) return;
    var group = currentGroup();
    if (!group || !Array.isArray(group.messages)) return;
    var target = event.target;
    var isClick = event.type === 'click';
    if (isClick) {
      var button = target && target.closest ? target.closest('.composer-area .voicebtn') : null;
      if (!button || button.getAttribute('data-act') !== 'send') return;
    } else {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      if (!target || !target.dataset || target.dataset.focus !== 'composer') return;
    }
    var box = document.querySelector('[data-focus="composer"]');
    var text = String((box && box.value) || (window.state && state.input) || '').trim();
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!text) return;
    group.messages.push({id: 'r30-u' + Date.now().toString(36), role: 'user', from: 'user', text: text});
    group.updatedAt = Date.now();
    state.input = '';
    if (box) box.value = '';
    state.refocus = true;
    if (typeof render === 'function') render();
    setTimeout(function () {
      var thread = document.querySelector('[data-r29-group-thread]');
      if (thread) thread.scrollTop = thread.scrollHeight;
    }, 30);
  }

  function chatHeader(head, bot) {
    if (typeof head !== 'string' || !bot || !bot.id) return head;
    if (head.indexOf('r29-group-toggle') >= 0 || bot.steward || bot.parent) return head;
    if (!botOf(bot.id)) return head;
    var key = '<span class="r29-avatar">';
    var at = head.indexOf(key);
    if (at < 0) return head;
    var label = '看看' + (bot.name || '助理') + '，拉其他助理进来';
    var next = '<span class="r29-avatar r30-tap" role="button" tabindex="0" data-r30-bot-sheet="' +
      escText(bot.id) + '" aria-label="' + escText(label) + '">';
    return head.slice(0, at) + next + head.slice(at + key.length);
  }

  document.addEventListener('click', demoGroupSend, true);
  document.addEventListener('keydown', demoGroupSend, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKey, true);
  setTimeout(function () {
    if (window.Hub && typeof Hub.on === 'function') Hub.on('render', injectHome);
    injectHome();
    // 真实方式下「最近」里的行由适配层在重画之后另行补上，标签可能被重建；盯着补回来。
    if (typeof MutationObserver !== 'function') return;
    var app = document.getElementById('app');
    if (!app) return;
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        injectHome();
      }, 0);
    }).observe(app, {childList: true, subtree: true});
  }, 0);

  window.R30Group = {canEdit: canEdit, open: open, close: close};
  window.r30ChatHeader = function (head, bot) {
    try { return chatHeader(head, bot); } catch (err) { return head; }
  };
})();
