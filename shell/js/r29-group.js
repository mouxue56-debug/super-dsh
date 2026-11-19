/* 讨论组对话页。顶栏、发言、交接事件、等你回答。助理文字只按纯文本。 */
(function () {
  'use strict';

  var EVENTS = {
    handoff: 'handoff',
    assign: 'handoff',
    delegate: 'handoff',
    dispatch: 'handoff',
    '交给': 'handoff',
    handback: 'handback',
    '交回': 'handback',
    accepted: 'accepted',
    accept: 'accepted',
    '验收通过': 'accepted',
    returned: 'returned',
    reject: 'returned',
    rejected: 'returned',
    '退回': 'returned',
    join: 'joined',
    leave: 'left'
  };

  function escText(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function realMode() {
    try {
      if (typeof r29Real === 'function') return !!r29Real();
    } catch (err) {}
    var root = document.documentElement;
    return !!(root && root.dataset && root.dataset.hubMode === 'real');
  }

  function blank() {
    return '暂无';
  }

  function onScreen() {
    if (!window.state || state.mode !== 'chat') return false;
    try {
      if (window.innerWidth < 700 && !state.detail) return false;
    } catch (err) {}
    return true;
  }

  function listGroups() {
    try {
      if (typeof r29Groups === 'function') return r29Groups() || [];
    } catch (err) {}
    return [];
  }

  function findGroup(id) {
    var list = listGroups();
    var i;
    for (i = 0; i < list.length; i++) {
      var group = list[i];
      if (!group) continue;
      if (group.id === id || group.conversation === id) return group;
    }
    return null;
  }

  function here() {
    if (!onScreen()) return null;
    var focus = state.r29GroupFocus ? String(state.r29GroupFocus) : '';
    var conv = state.conversation || '';
    var list = listGroups();
    var linked = null;
    var focused = null;
    var i;
    for (i = 0; i < list.length; i++) {
      var group = list[i];
      if (!group) continue;
      if (focus && (group.id === focus || group.conversation === focus)) focused = group;
      if (group.conversation === conv || group.id === conv) linked = group;
    }
    return focused || linked;
  }

  function idsOf(group) {
    var raw = group && Array.isArray(group.members) ? group.members : [];
    var out = [];
    var i;
    for (i = 0; i < raw.length; i++) {
      var item = raw[i];
      var id = typeof item === 'string' ? item : (item && (item.id || item.bot));
      if (id) out.push(String(id));
    }
    return out;
  }

  function statusRaw(group) {
    var api = window.HubGroups;
    if (!group || !group.id || !api || typeof api.status !== 'function') return null;
    try {
      return api.status(group.id);
    } catch (err) {
      return null;
    }
  }

  function statusLine(group) {
    var raw = statusRaw(group);
    var text = '';
    if (typeof raw === 'string') text = raw;
    else if (raw && typeof raw === 'object') {
      if (typeof raw.line === 'string') text = raw.line;
      else if (typeof raw.text === 'string') text = raw.text;
      else if (typeof raw.summary === 'string') text = raw.summary;
    }
    return String(text || '').trim();
  }

  function groupName(group) {
    var name = group && group.name ? String(group.name).trim() : '';
    if (name) return name;
    return realMode() ? blank() : '讨论组';
  }

  function personName(id) {
    try {
      if (id && typeof botBy === 'function') {
        var bot = botBy(id);
        if (bot && bot.name) return String(bot.name);
      }
    } catch (err) {}
    return '';
  }

  function asText(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && isFinite(value)) return String(value);
    return '';
  }

  function memberSource(group, id) {
    if (!group || !Array.isArray(group.members)) return null;
    var i;
    for (i = 0; i < group.members.length; i++) {
      var row = group.members[i];
      if (!row || typeof row !== 'object') continue;
      if (row.id === id || row.bot === id) return row;
    }
    return null;
  }

  function memberRows(group) {
    var raw = statusRaw(group);
    var extra = {};
    var listed = [];
    var from = raw && typeof raw === 'object' && Array.isArray(raw.members) ? raw.members : [];
    var i;
    for (i = 0; i < from.length; i++) {
      var item = from[i];
      if (!item) continue;
      var id = typeof item === 'string' ? item : (item.id || item.bot || '');
      if (!id) continue;
      id = String(id);
      extra[id] = typeof item === 'object' ? item : {};
      listed.push(id);
    }
    var base = idsOf(group);
    if (!base.length) base = listed;
    var seen = {};
    var rows = [];
    for (i = 0; i < base.length; i++) {
      var key = base[i];
      if (seen[key]) continue;
      seen[key] = true;
      var src = extra[key] || memberSource(group, key) || {};
      var duty = asText(src.duty || src.role || src.task);
      var now = asText(src.status || src.state || src.now);
      var name = asText(src.name || src.botName) || personName(key);
      rows.push({
        id: key,
        name: name || blank(),
        duty: duty || blank(),
        status: now || blank()
      });
    }
    return rows;
  }

  function faceHtml(id, px, user) {
    if (user) {
      return '<span class="r29-face r29-group-you" style="--r29-size:' + px +
        'px" aria-hidden="true">你</span>';
    }
    try {
      if (window.HubAvatars && typeof HubAvatars.html === 'function') {
        return HubAvatars.html(id, px) || '';
      }
    } catch (err) {}
    try {
      if (typeof r29Face === 'function') return r29Face(id, px) || '';
    } catch (err2) {}
    return '';
  }

  function stackFace(group, fallback) {
    var ids = idsOf(group);
    try {
      if (window.HubAvatars && typeof HubAvatars.stackHtml === 'function') {
        return HubAvatars.stackHtml(ids, 32) || fallback;
      }
    } catch (err) {}
    try {
      if (typeof r29Stack === 'function') return r29Stack(ids, 32) || fallback;
    } catch (err2) {}
    return fallback;
  }

  function fieldOf(message) {
    if (!message || typeof message !== 'object') return '';
    if (message.type != null && typeof message.type !== 'object') return message.type;
    if (message.kind != null && typeof message.kind !== 'object') return message.kind;
    if (message.event != null && typeof message.event !== 'object') return message.event;
    return '';
  }

  function eventKind(message) {
    var raw = fieldOf(message);
    if (raw === '' || raw == null) return '';
    var key = String(raw).trim();
    if (EVENTS[key]) return EVENTS[key];
    var lower = key.toLowerCase();
    return EVENTS[lower] || '';
  }

  function isAsk(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.answered === true) return false;
    if (message.needOwner === true) return true;
    if (message.waitingFor === 'owner' || message.waitingFor === 'user') return true;
    var key = String(fieldOf(message) || '').trim().toLowerCase();
    if (key === 'ask' || key === 'question') return true;
    if (key === 'need-owner' || key === 'waiting') return true;
    return false;
  }

  function plain(message) {
    if (!message) return '';
    if (typeof message.text === 'string') return message.text;
    if (typeof message.md === 'string' && !Array.isArray(message.parts)) return message.md;
    if (!Array.isArray(message.parts)) return '';
    return message.parts.map(function (part) {
      if (!part || (part.type && part.type !== 'text')) return '';
      return part.md || part.text || '';
    }).filter(Boolean).join('\n');
  }

  function speaker(message) {
    var from = '';
    if (message) from = message.from || message.bot || message.speaker || '';
    var role = message && message.role || '';
    var user = role === 'user' || from === 'user' || from === 'owner';
    if (user) {
      var you = message && message.name ? String(message.name) : '你';
      return {id: 'user', name: you, user: true};
    }
    var id = String(from || '');
    var named = message && (message.name || message.botName);
    var name = named ? String(named) : personName(id);
    return {id: id, name: name || blank(), user: false};
  }

  function eventText(message, kind) {
    var text = plain(message).trim();
    if (text) return text;
    if (kind === 'handoff') {
      var who = asText(message.toName || message.assigneeName);
      if (!who && message.to) who = personName(message.to);
      var done = asText(message.done || message.until || message.doneWhen);
      if (who && done) return '交给' + who + '，做到' + done + '算完';
      if (who) return '交给' + who;
      return '交给';
    }
    if (kind === 'handback') return '交回';
    if (kind === 'accepted') return '验收通过';
    if (kind === 'returned') return '退回';
    return '';
  }

  function msgId(message, index) {
    if (message && message.id != null && String(message.id)) return String(message.id);
    return 'r29g-' + index;
  }

  function cardHtml(message, index) {
    var parts = [];
    if (Array.isArray(message.parts)) {
      parts = message.parts.filter(function (part) {
        return part && part.type && part.type !== 'text';
      });
    } else if (message.card && message.card.type) {
      parts = [{type: message.card.type, data: message.card}];
    }
    if (!parts.length || !window.Hub || typeof Hub.messageHTML !== 'function') return '';
    var who = speaker(message);
    try {
      return Hub.messageHTML({
        id: msgId(message, index) + '-card',
        from: who.user ? state.bot : (who.id || state.bot),
        role: 'bot',
        parts: parts
      }, index);
    } catch (err) {
      return '';
    }
  }

  function speechHtml(message, index) {
    var who = speaker(message);
    var text = plain(message);
    var id = msgId(message, index);
    var bubble = text ? '<p class="r29-group-bubble">' + escText(text) + '</p>' : '';
    var card = cardHtml(message, index);
    var cardBox = card ? '<div class="r29-group-card">' + card + '</div>' : '';
    var cls = 'r29-group-msg' + (who.user ? ' is-user' : '');
    return '<article class="' + cls + '" data-message-id="' + escText(id) +
      '" data-message-from="' + escText(who.id) + '">' +
      '<span class="r29-group-face">' + faceHtml(who.id, 28, who.user) + '</span>' +
      '<div class="r29-group-body"><p class="r29-group-name">' + escText(who.name) +
      '</p>' + bubble + cardBox + '</div></article>';
  }

  function eventHtml(message, index, kind) {
    var id = msgId(message, index);
    return '<div class="r29-group-event" data-r29-kind="' + kind +
      '" data-message-id="' + escText(id) + '" role="note"><span>' +
      escText(eventText(message, kind)) + '</span></div>';
  }

  function feed(messages) {
    if (!messages || !messages.length) return '<p class="r29-group-empty">暂无</p>';
    return messages.map(function (message, index) {
      var kind = eventKind(message);
      if (kind) return eventHtml(message, index, kind);
      return speechHtml(message, index);
    }).join('');
  }

  function askTarget(messages) {
    var i;
    var hit = null;
    var count = 0;
    for (i = 0; i < messages.length; i++) {
      if (!isAsk(messages[i])) continue;
      count += 1;
      if (!hit) hit = {message: messages[i], index: i};
    }
    return {hit: hit, count: count};
  }

  function askHtml(messages) {
    var found = askTarget(messages || []);
    if (!found.hit) return '';
    var id = msgId(found.hit.message, found.hit.index);
    return '<button type="button" class="r29-group-ask" data-r29-group-jump="' +
      escText(id) + '" data-r29-ask-count="' + found.count + '">等你回答</button>';
  }

  function shouldReplace(group) {
    if (!group || !Array.isArray(group.messages)) return false;
    var focus = state.r29GroupFocus ? String(state.r29GroupFocus) : '';
    if (focus && (focus === group.id || focus === group.conversation)) return true;
    var conv = state.conversation || '';
    return group.conversation === conv || group.id === conv;
  }

  function memberTools(group, row, count) {
    var host = group && group.host ? String(group.host) : '';
    if (host && row.id === host) return '<span class="r30-host-tag">主持</span>';
    if (count <= 2) return '';
    var asked = state.r30RemoveAsk === (group.id || '') + ':' + row.id;
    return '<button type="button" class="r30-member-remove' + (asked ? ' is-ask' : '') +
      '" data-r30-remove="' + escText(row.id) + '" aria-label="' +
      escText('把' + row.name + '请出这个组') + '">' + (asked ? '确定请出去' : '请出去') + '</button>';
  }

  function membersHtml(group) {
    if (!state.r29GroupMembersOpen) return '';
    var rows = memberRows(group);
    var edit = !!(window.R30Group && window.R30Group.canEdit());
    var body = rows.map(function (row) {
      return '<div class="r29-group-member" data-r29-group-member="' + escText(row.id) + '">' +
        faceHtml(row.id, 28, false) +
        '<span class="r29-group-member-text">' +
        '<span class="r29-group-member-name">' + escText(row.name) + '</span>' +
        '<span class="r29-group-member-duty">这次 ' + escText(row.duty) + '</span>' +
        '<span class="r29-group-member-status">现在 ' + escText(row.status) + '</span>' +
        '</span>' + (edit ? memberTools(group, row, rows.length) : '') + '</div>';
    }).join('');
    if (!body) body = '<p class="r29-group-member-empty">暂无</p>';
    var more = edit
      ? '<button type="button" class="r30-add-more" data-r30-add>＋ 再拉人</button>'
      : '';
    return '<div class="r29-group-members" data-r29-group-members>' + body + more + '</div>';
  }

  function header(head) {
    var group = here();
    if (!group || typeof head !== 'string') return head;
    var avatarKey = '<span class="r29-avatar">';
    var nameKey = '<strong class="r22-nameplate">';
    var at = head.indexOf(avatarKey);
    var nameAt = head.indexOf(nameKey);
    if (at < 0 || nameAt < 0 || nameAt < at) return head;
    var between = head.slice(at + avatarKey.length, nameAt);
    if (between.slice(-7) !== '</span>') return head;
    var inner = between.slice(0, -7);
    var nameEnd = head.indexOf('</strong>', nameAt);
    if (nameEnd < 0) return head;
    var open = state.r29GroupMembersOpen ? 'true' : 'false';
    var button = '<button type="button" class="r29-avatar r29-group-toggle"' +
      ' data-r29-group-toggle aria-expanded="' + open + '" aria-label="' +
      escText('看' + groupName(group) + '的成员') + '">' +
      stackFace(group, inner) + '</button>';
    var line = statusLine(group);
    var status = line
      ? '<span class="r29-group-status" data-r29-group-status>' + escText(line) + '</span>'
      : '';
    var titles = '<span class="r29-group-titles"><strong class="r22-nameplate">' +
      escText(groupName(group)) + '</strong>' + status + '</span>';
    var next = head.slice(0, at) + button + titles + head.slice(nameEnd + 9);
    var idAttr = escText(group.id || '');
    next = next.replace(
      '<header class="floatinghead chat-header">',
      '<header class="floatinghead chat-header r29-group-head" data-r29-group-head="' +
        idAttr + '">'
    );
    return next.replace('</header>', membersHtml(group) + '</header>');
  }

  function thread(html) {
    var group = here();
    if (!group || !shouldReplace(group) || typeof html !== 'string') return html;
    var start = html.indexOf('<div class="thread">');
    var tail = html.indexOf('<div class="chat-tail"');
    if (tail < 0) tail = html.indexOf('<div class="composer-area"');
    if (start < 0 || tail < 0 || tail < start) return html;
    var messages = group.messages;
    var block = '<div class="thread" data-r29-group-thread="' + escText(group.id || '') +
      '"><div class="r29-group-feed">' + feed(messages) + '</div></div>';
    var out = html.slice(0, start) + block + html.slice(tail);
    out = out.replace('class="chatview"', 'class="chatview r29-group-page"');
    var ask = askHtml(messages);
    if (!ask) return out;
    var cut = out.indexOf('>');
    if (cut < 0) return out;
    return out.slice(0, cut + 1) + ask + out.slice(cut + 1);
  }

  function showGroup(group) {
    state.mode = 'chat';
    state.detail = true;
    state.drawer = null;
    state.r29GroupFocus = group.id || group.conversation || '';
    state.r29GroupMembersOpen = false;
    if (typeof render === 'function') render();
  }

  function jumpNode(id) {
    try {
      return document.querySelector('[data-message-id="' + CSS.escape(id) + '"]');
    } catch (err) {
      return null;
    }
  }

  function jumpTo(id) {
    function go() {
      var node = jumpNode(id);
      if (node && node.scrollIntoView) node.scrollIntoView({block: 'center'});
    }
    go();
    setTimeout(go, 60);
    setTimeout(go, 240);
  }

  function onClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var jump = target.closest('[data-r29-group-jump]');
    if (jump) {
      event.preventDefault();
      event.stopPropagation();
      jumpTo(jump.getAttribute('data-r29-group-jump') || '');
      return;
    }
    var toggle = target.closest('[data-r29-group-toggle]');
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      state.r29GroupMembersOpen = !state.r29GroupMembersOpen;
      if (typeof render === 'function') render();
      return;
    }
    var opener = target.closest('[data-r29-group-open]');
    if (opener) {
      var group = findGroup(opener.getAttribute('data-r29-group-open') || '');
      if (!group || !Array.isArray(group.messages)) return;
      event.preventDefault();
      event.stopPropagation();
      showGroup(group);
      return;
    }
    if (!state || !state.r29GroupFocus) return;
    var leave = target.closest('[data-act="back"],[data-act="bot"]');
    if (!leave) leave = target.closest('[data-hub-conversation],[data-fixed-task-open]');
    if (!leave) return;
    state.r29GroupFocus = '';
    state.r29GroupMembersOpen = false;
  }

  function scrubDemo() {
    var thread = document.querySelector('[data-r29-group-thread]');
    if (!thread) return;
    var extra = thread.querySelectorAll(
      '.m-persona-today, .m-interact-pinbar, [data-context-ledger], [data-demo-content]'
    );
    var i;
    for (i = 0; i < extra.length; i++) extra[i].remove();
  }

  document.addEventListener('click', onClick, true);
  setTimeout(function () {
    if (!window.Hub || typeof Hub.on !== 'function' || window.__r29GroupScrub) return;
    window.__r29GroupScrub = true;
    Hub.on('render', scrubDemo);
  }, 0);
  if (window.Hub && typeof Hub.on === 'function' && !window.__r29GroupNav) {
    window.__r29GroupNav = true;
    Hub.on('navigate', function () {
      if (!state || state.r29GroupHold) return;
      state.r29GroupFocus = '';
      state.r29GroupMembersOpen = false;
    });
  }

  window.r29GroupHere = function () {
    try { return here(); } catch (err) { return null; }
  };
  window.r29GroupShow = function (group) {
    try { showGroup(group); } catch (err) {}
  };
  window.r29GroupHeader = function (head) {
    try { return header(head); } catch (err) { return head; }
  };
  window.r29GroupThread = function (html) {
    try { return thread(html); } catch (err) { return html; }
  };
})();
