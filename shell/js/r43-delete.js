/* 长对话的软删除：菜单、左滑、确认、撤销，以及设置里的最近删除。 */
(function () {
  'use strict';
  var DAY = 86400000;
  var serial = 3;
  var menu = null;
  var dialog = null;
  var shade = null;
  var opener = null;
  var hold = null;
  var swipe = null;
  var swallowClick = false;
  var demoItems = [
    seed('tb_0000000000000001', 'message', '演示 · 一条旧消息', 1),
    seed('tb_0000000000000002', 'segment', '演示 · 一个旧话题', 2),
    seed('tb_0000000000000003', 'thread', '演示 · 和一位助理的对话', 5)
  ];

  function seed(id, kind, label, daysAgo) {
    return { id: id, kind: kind, label: label, deletedAt: Date.now() - daysAgo * DAY, restored: false };
  }
  function realMode() { return document.documentElement.dataset.hubMode === 'real'; }
  function threadOn() {
    return !!document.querySelector('.thread [data-r43-segment], .thread [data-r43-event], .thread .r43-top-note');
  }
  function batchId() {
    serial += 1;
    return 'tb_' + ('0000000000000000' + serial.toString(16)).slice(-16);
  }
  function daysLeft(deletedAt) {
    var left = deletedAt + 30 * DAY - Date.now();
    return left <= 0 ? 0 : Math.ceil(left / DAY);
  }
  function whenText(value) {
    var date = new Date(value);
    return Number.isFinite(+date) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit' }) : '';
  }
  function countText(item) {
    if (item.kind === 'thread') return (item.sessions?.length || 1) + ' 段';
    if (item.kind === 'segment') return '1 段';
    return '1 条';
  }
  function messageOf(article) {
    var id = article?.dataset.messageId;
    var found = (Hub.currentMessages?.() || []).find(function (item) { return item.id === id; });
    return found || window.R43Thread?.findMessage?.(id) || null;
  }
  function kernelOf(article, message) {
    if (article?.dataset.r43Kernel) return article.dataset.r43Kernel;
    if (message?.messageId) return message.messageId;
    if (realMode()) return '';
    return message?.id || article?.dataset.messageId || '';
  }
  function sessionOf(article, message) {
    return article?.dataset.session || message?.session ||
      article?.closest?.('[data-r43-event]')?.dataset.r43Event || '';
  }
  function menuKind(target) {
    if (!target || !target.closest) return null;
    if (target.closest('[data-r43-menu],[data-r43-dialog],[data-r43-hover],[data-r43-swipe-delete]')) return null;
    if (target.closest('input,textarea,select,[contenteditable="true"]')) return null;
    var home = target.closest('.r43-assistant-row');
    if (home && home.closest('.home-recent-list')) {
      return { type: 'home', id: home.dataset.r43HomeBot || home.dataset.r22Row, node: home };
    }
    var message = target.closest('article.msg');
    if (message && threadOn()) return { type: 'message', node: message };
    var segment = target.closest('[data-r43-segment]');
    if (segment) return { type: 'segment', session: segment.dataset.r43Segment, node: segment };
    var card = target.closest('[data-r43-event]');
    if (card) return { type: 'event', session: card.dataset.r43Event, node: card };
    var chip = target.closest('[data-r43-topic]');
    if (chip && chip.dataset.r43Topic) return { type: 'segment', session: chip.dataset.r43Topic, node: chip };
    return null;
  }
  function claimTarget(target) {
    var kind = menuKind(target);
    return !!kind && kind.type !== 'home';
  }
  function wantsMessageSwipe(target) {
    if (!threadOn() || !target?.closest) return false;
    if (target.closest('button,a,input,textarea,summary,.r22-native-selection,[data-r43-hover]')) return false;
    var message = target.closest('article.msg');
    return !!message && !message.closest('[data-r43-menu]');
  }
  function closeMenu() {
    menu?.remove();
    menu = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  function closeDialog() {
    dialog?.remove();
    shade?.remove();
    dialog = null;
    shade = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  function trapKeys(box, items) {
    box.addEventListener('keydown', function (event) {
      var list = items();
      var index = list.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); box === menu ? closeMenu() : closeDialog(); }
      if (event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        var step = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
        list[(index + step + list.length) % list.length]?.focus();
      }
    });
  }
  function placeMenu(anchor) {
    var rect = anchor.getBoundingClientRect();
    var width = menu.offsetWidth;
    var height = menu.offsetHeight;
    var left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    var top = rect.bottom + 6 + height > innerHeight - 8 ? Math.max(8, rect.top - height - 6) : rect.bottom + 6;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
  function itemButton(label, danger, run) {
    var button = Hub.h('button', { type: 'button', role: 'menuitem', 'data-r43-danger': danger ? '' : null,
      'aria-label': label }, label);
    if (!danger) button.removeAttribute('data-r43-danger');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      Promise.resolve(run()).catch(function (error) { Hub.toast(error.message || '没删成，请重试'); });
    });
    return button;
  }
  function openMenu(target, anchor) {
    var kind = menuKind(target);
    if (!kind) return;
    closeMenu();
    opener = anchor || kind.node || target;
    menu = Hub.h('div', { class: 'r43-menu', 'data-r43-menu': '', role: 'menu', 'aria-label': '删除操作' });
    if (kind.type === 'message') {
      menu.append(itemButton('复制', false, function () { return copyMessage(kind.node); }));
      menu.append(itemButton('删除这一条', true, function () { return deleteMessage(kind.node); }));
    } else if (kind.type === 'home') {
      menu.append(itemButton('删除', true, function () { return deleteHome(kind.id); }));
      menu.append(itemButton('标已读', false, function () { markHomeRead(kind.id); }));
    } else if (kind.type === 'event') {
      menu.append(itemButton('删除这一段', true, function () { return deleteSegment(kind.session, true); }));
    } else {
      menu.append(itemButton('删除这个话题', true, function () { return deleteTopic(kind.session); }));
    }
    document.body.append(menu);
    placeMenu(opener);
    trapKeys(menu, function () { return [...menu.querySelectorAll('button')]; });
    menu.querySelector('button')?.focus();
  }
  function ask(title, body, confirmLabel, danger) {
    closeDialog();
    shade = Hub.h('div', { class: 'r43-shade', 'data-r43-shade': '' });
    dialog = Hub.h('div', { class: 'r43-dialog', 'data-r43-dialog': '', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'r43-dialog-title' });
    var heading = Hub.h('h2', { id: 'r43-dialog-title' }, title);
    var text = Hub.h('p', {}, body);
    var yes = Hub.h('button', { type: 'button', 'data-r43-danger': danger ? '' : null }, confirmLabel);
    if (!danger) yes.removeAttribute('data-r43-danger');
    var no = Hub.h('button', { type: 'button' }, '不删了');
    var actions = Hub.h('div', { class: 'r43-actions' }, [yes, no]);
    dialog.append(heading, text, actions);
    document.body.append(shade, dialog);
    trapKeys(dialog, function () { return [...dialog.querySelectorAll('button')]; });
    yes.focus();
    return new Promise(function (resolve) {
      yes.addEventListener('click', function () { closeDialog(); resolve(true); });
      no.addEventListener('click', function () { closeDialog(); resolve(false); });
      shade.addEventListener('click', function () { closeDialog(); resolve(false); });
    });
  }
  function showUndo(run) {
    toast('已删除 · ');
    clearTimeout(toast.timer);
    var host = document.getElementById('toast');
    var button = Hub.h('button', { type: 'button', 'data-r43-undo': '', 'aria-label': '撤销删除' }, '撤销');
    button.addEventListener('click', function () {
      clearToast();
      Promise.resolve(run()).catch(function (error) { Hub.toast(error.message || '没能撤销'); });
    });
    host.append(button);
    positionToast();
    toast.timer = setTimeout(clearToast, 6000);
  }
  function repaint() {
    if (Hub.reading?.preserve) Hub.reading.preserve(function () { render(); });
    else render();
  }
  async function postJSON(path, body) {
    var response = await fetch('/bff' + path, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    var data = null;
    try { data = await response.json(); } catch (error) { data = null; }
    if (response.status === 409 && data?.error?.code === 'RUNNING') {
      return { running: true, message: data.error?.message || '它还在做事，先停下？' };
    }
    if (!response.ok) throw new Error(data?.error?.message || '没删成，请重试');
    return data || { ok: true };
  }
  function rememberDemo(kind, label, snapshot) {
    var item = { id: batchId(), kind: kind, label: label, deletedAt: Date.now(), restored: false, snapshot: snapshot };
    demoItems.unshift(item);
    return item;
  }
  function runningSession(session) {
    return (state.threads?.[state.bot] || []).some(function (row) {
      return row.session === session && (row.state === 'running' || row.running === true);
    }) || (state.running === true && session && session === state.conversation);
  }
  function memberSessions(session) {
    return (window.R43Thread?.topics?.(state.bot) || [])
      .filter(function (topic) { return topic.mergedInto === session; })
      .map(function (topic) { return topic.id; });
  }
  function topicNote(session) {
    var names = (window.R43Thread?.topics?.(state.bot) || [])
      .filter(function (topic) { return topic.mergedInto === session; })
      .map(function (topic) { return topic.title; });
    var text = '这个话题里的消息会进最近删除，30 天内能找回';
    return names.length ? text + '。一并包括已经并进来的：' + names.join('、') : text;
  }
  async function stopFirst(session, forceAsked) {
    if (forceAsked) return true;
    var running = realMode() ? false : runningSession(session) || (!session && homeRunning());
    if (!running) return true;
    return ask('它还在做事，先停下？', '先停下再删。停下来之后，这段会进最近删除。', '先停下再删', true);
  }
  function homeRunning() {
    return (state.threads?.[state.bot] || []).some(function (row) { return row.state === 'running' || row.running === true; });
  }
  async function copyMessage(article) {
    var message = messageOf(article);
    var text = message ? Hub.messageText(message) : article.innerText;
    if (Hub.copyText) await Hub.copyText(text);
    else toast('请长按选中复制');
  }
  function demoDropMessage(id) {
    var saved = [];
    Object.keys(state.threads || {}).forEach(function (bot) {
      (state.threads[bot] || []).forEach(function (row) {
        if (Array.isArray(row.items)) {
          row.items = row.items.filter(function (item) {
            var hit = item.id === id;
            if (hit) saved.push({ bot: bot, item: item, session: row.session });
            return !hit;
          });
        }
      });
      var rows = state.threads[bot];
      state.threads[bot] = rows.filter(function (row) {
        var hit = row.id === id;
        if (hit) saved.push({ bot: bot, row: row });
        return !hit;
      });
    });
    window.R43Thread?.forgetMessage?.(id);
    return saved;
  }
  function restoreDemo(item) {
    (item.snapshot || []).forEach(function (part) {
      var rows = state.threads[part.bot] || (state.threads[part.bot] = []);
      if (part.row) rows.push(part.row);
      if (part.item) {
        var host = rows.find(function (row) { return row.session === part.session && Array.isArray(row.items); });
        host?.items.push(part.item);
      }
      if (part.rows) state.threads[part.bot] = part.rows;
      if (part.topics && window.R43Thread) R43Thread.setOptions(part.bot, { topics: part.topics, selectedTopic: null });
    });
    item.restored = true;
    repaint();
  }
  async function deleteMessage(article) {
    closeSwipe();
    var message = messageOf(article);
    var session = sessionOf(article, message);
    var id = kernelOf(article, message);
    var scroll = document.querySelector('.thread')?.scrollTop || 0;
    if (realMode()) {
      if (!session || !id) throw new Error('这条暂时不能删');
      var data = await postJSON('/trash/messages', { session: session, id: id });
      window.HubRealDelete?.drop?.({ kind: 'message', bot: state.bot, session: session, messageId: id });
      showUndo(function () { return restoreIds([data.item?.id].filter(Boolean).concat(data.related || []), state.bot); });
      return;
    }
    var snapshot = demoDropMessage(message?.id || article.dataset.messageId);
    var item = rememberDemo('message', '演示 · 1 条消息', snapshot);
    repaint();
    var thread = document.querySelector('.thread');
    if (thread) thread.scrollTop = scroll;
    showUndo(function () { restoreDemo(item); });
  }
  async function deleteSegment(session, confirmed) {
    if (!session) return;
    if (!confirmed) {
      var ok = await ask('删除这个话题', topicNote(session), '删除这个话题', true);
      if (!ok) return;
    }
    var stopped = await stopFirst(session, false);
    if (!stopped) return;
    if (realMode()) return realSegment(session, false);
    return demoSegment(session);
  }
  async function deleteTopic(session) { return deleteSegment(session, false); }
  async function realSegment(session, force) {
    var body = { session: session };
    if (force) body.force = true;
    var data = await postJSON('/trash/segments', body);
    if (data.running) {
      var again = await ask(data.message, '先停下再删。停下来之后，这段会进最近删除。', '先停下再删', true);
      if (!again) return;
      return realSegment(session, true);
    }
    window.HubRealDelete?.drop?.({ kind: 'segment', bot: state.bot, session: session,
      sessions: [session].concat(memberSessions(session)) });
    await window.HubRealDelete?.reload?.(state.bot);
    var ids = [data.item?.id].filter(Boolean).concat(data.related || []);
    showUndo(function () { return restoreIds(ids, state.bot); });
  }
  function demoSegment(session) {
    var members = memberSessions(session).concat(session);
    var snapshot = [];
    Object.keys(state.threads || {}).forEach(function (bot) {
      if (window.R43Thread) snapshot.push({ bot: bot, topics: (R43Thread.topics(bot) || []).slice() });
    });
    members.forEach(function (id) { snapshot = snapshot.concat(demoDropSession(id)); });
    var item = rememberDemo('segment', '演示 · 1 个话题', snapshot);
    repaint();
    showUndo(function () { restoreDemo(item); });
  }
  function demoDropSession(session) {
    var saved = [];
    Object.keys(state.threads || {}).forEach(function (bot) {
      var rows = state.threads[bot] || [];
      var kept = [];
      rows.forEach(function (row) {
        if (row.session === session || row.topic === session) saved.push({ bot: bot, row: row });
        else kept.push(row);
      });
      state.threads[bot] = kept;
      if (window.R43Thread) {
        var next = (R43Thread.topics(bot) || []).filter(function (topic) { return topic.id !== session; });
        R43Thread.setOptions(bot, { topics: next, selectedTopic: null });
      }
    });
    return saved;
  }
  async function deleteHome(bot) {
    var ok = await ask('删除和它的对话', '会清掉和它的全部对话，助理本身还在', '删除', true);
    if (!ok) return;
    var stopped = await stopFirst('', false);
    if (!stopped) return;
    if (realMode()) return realThread(bot, false);
    var snapshot = [{ bot: bot, rows: (state.threads[bot] || []).slice(),
      topics: (window.R43Thread?.topics?.(bot) || []).slice() }];
    state.threads[bot] = [];
    window.R43Thread?.setOptions?.(bot, { topics: [], selectedTopic: null });
    window.R43Thread?.resetWindow?.(bot);
    var item = rememberDemo('thread', '演示 · 和一位助理的全部对话', snapshot);
    repaint();
    showUndo(function () { restoreDemo(item); });
  }
  async function realThread(bot, force) {
    var body = { bot: bot };
    if (force) body.force = true;
    var data = await postJSON('/trash/threads', body);
    if (data.running) {
      var again = await ask(data.message, '先停下再删。停下来之后，这些对话会进最近删除。', '先停下再删', true);
      if (!again) return;
      return realThread(bot, true);
    }
    window.HubRealDelete?.drop?.({ kind: 'thread', bot: bot });
    await window.HubRealDelete?.reload?.(bot);
    showUndo(function () { return restoreIds([data.item?.id].filter(Boolean).concat(data.related || []), bot); });
  }
  async function restoreIds(ids, bot) {
    for (var i = 0; i < ids.length; i++) {
      if (ids[i]) await postJSON('/trash/' + encodeURIComponent(ids[i]) + '/restore', {});
    }
    await window.HubRealDelete?.reload?.(bot || state.bot);
  }
  function markHomeRead(bot) {
    if (realMode() && window.HubRealDelete?.markRead) {
      HubRealDelete.markRead(bot);
      toast('已标为已读');
      return;
    }
    var entry = typeof homeEntry === 'function' ? homeEntry(bot) : null;
    if (entry) entry.unread = 0;
    try { if (window.HubUnread && HubUnread.markBotRead) HubUnread.markBotRead(bot); } catch (error) { /* 演示未读清不掉也不挡 */ }
    render();
    toast('已标为已读');
  }
  function closeSwipe() {
    document.querySelectorAll('.r43-swipe-open').forEach(function (node) {
      node.classList.remove('r43-swipe-open');
      node.querySelector('[data-r43-swipe-delete]')?.remove();
    });
  }
  function reveal(article) {
    closeSwipe();
    var button = Hub.h('button', { type: 'button', class: 'r43-swipe-delete', 'data-r43-swipe-delete': '',
      'aria-label': '删除这一条' }, '删除');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      deleteMessage(article).catch(function (error) { Hub.toast(error.message || '没删成，请重试'); });
    });
    article.append(button);
    article.classList.add('r43-swipe-open');
    placeSwipe(article, button);
  }
  function placeSwipe(article, button) {
    var bubble = article.querySelector('.bubble, .user-bubble');
    if (!bubble) return;
    var top = bubble.offsetTop + (bubble.offsetHeight - button.offsetHeight) / 2;
    var label = article.querySelector('.r43-topic-label');
    if (label) top = Math.max(top, label.offsetTop + label.offsetHeight);
    var footer = article.querySelector('.message-footer');
    if (footer) top = Math.min(top, Math.max(0, footer.offsetTop - button.offsetHeight));
    button.style.top = Math.round(Math.max(0, top)) + 'px';
  }
  function onTouchStart(event) {
    if (!wantsMessageSwipe(event.target) || event.touches?.length !== 1) return;
    var point = event.touches[0];
    if (point.clientX < 24) { swipe = null; return; }
    swipe = { article: event.target.closest('article.msg'), x: point.clientX, y: point.clientY, dx: 0, locked: false };
  }
  function onTouchMove(event) {
    if (!swipe || event.touches?.length !== 1) return;
    var point = event.touches[0];
    var dx = point.clientX - swipe.x;
    var dy = point.clientY - swipe.y;
    if (!swipe.locked) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      if (dx >= 0 || Math.abs(dx) < Math.abs(dy)) { swipe = null; return; }
      swipe.locked = true;
    }
    if (event.cancelable) event.preventDefault();
    swipe.dx = dx;
  }
  function onTouchEnd() {
    var current = swipe;
    swipe = null;
    if (!current?.locked) return;
    if (current.dx <= -56) reveal(current.article);
  }
  function dressHome() {
    document.querySelectorAll('.home-recent-list .r22-swipe-row').forEach(function (row) {
      if (row.querySelector('[data-r29-group-open],[data-fixed-task-open]')) return;
      if (row.querySelector('[data-r43-home-action]')) { row.classList.add('r43-assistant-row'); return; }
      var actions = row.querySelector('.r22-row-actions');
      var id = row.dataset.r22Row;
      if (!actions || !id) return;
      var name = row.querySelector('strong')?.textContent || '这位助理';
      actions.replaceChildren(
        Hub.h('button', { type: 'button', 'data-r43-home-action': 'read', 'data-id': id,
          'aria-label': '把和' + name + '的对话标为已读' }, '标已读'),
        Hub.h('button', { type: 'button', 'data-r43-home-action': 'delete', 'data-id': id,
          'aria-label': '删除和' + name + '的全部对话' }, '删除')
      );
      row.classList.add('r43-assistant-row');
      if (!row.dataset.r43HomeBot) row.dataset.r43HomeBot = id;
    });
    document.querySelectorAll('[data-r43-segment],[data-r43-event]').forEach(function (node) {
      if (node.getAttribute('tabindex') == null) node.setAttribute('tabindex', '0');
    });
    if (window.R43Thread && state.bot) R43Thread.setOptions(state.bot, { deleteTopic: deleteTopic });
  }
  function renderTrash(host, items, error) {
    host.replaceChildren();
    var page = Hub.h('div', { class: 'r43-trash-page', 'data-r43-trash': '' });
    if (error) page.append(Hub.h('p', { role: 'status' }, error));
    else if (!items.length) page.append(Hub.h('p', { role: 'status' }, '最近 30 天没有删除过东西'));
    items.forEach(function (item) {
      var row = Hub.h('article', { class: 'r43-trash-row', 'data-r43-trash-item': item.id });
      var copy = Hub.h('div', { class: 'grow' }, [
        Hub.h('strong', {}, item.label || '已删除的一批'),
        Hub.h('small', {}, whenText(item.deletedAt) + ' · 还剩 ' + (item.daysLeft || daysLeft(item.deletedAt)) + ' 天 · ' +
          countText(item))
      ]);
      var button = Hub.h('button', { type: 'button', 'aria-label': '恢复这批删除' }, '恢复');
      button.addEventListener('click', function () {
        button.disabled = true;
        restoreOne(item).then(function () { return openTrash(host); }).catch(function (failure) {
          button.disabled = false;
          Hub.toast(failure.message || '没能恢复');
        });
      });
      row.append(copy, button);
      page.append(row);
    });
    page.append(Hub.h('p', { class: 'r43-trash-foot' }, '超过 30 天的不再显示在这里，但内容没有被物理删除'));
    host.append(page);
  }
  async function restoreOne(item) {
    if (!realMode()) { restoreDemo(item); return; }
    await postJSON('/trash/' + encodeURIComponent(item.id) + '/restore', {});
    await window.HubRealDelete?.reload?.(item.bot || state.bot);
  }
  async function openTrash(host) {
    host.replaceChildren(Hub.h('p', { role: 'status' }, '正在读取…'));
    try {
      var items = demoItems.filter(function (item) { return !item.restored && daysLeft(item.deletedAt) > 0; });
      if (realMode()) {
        var response = await fetch('/bff/trash', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('暂时读不到最近删除');
        items = (await response.json()).items || [];
      }
      renderTrash(host, items);
    } catch (error) { renderTrash(host, [], '暂时读不到最近删除'); }
  }
  document.addEventListener('contextmenu', function (event) {
    if (!claimTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(event.target);
  }, true);
  document.addEventListener('pointerdown', function (event) {
    if (hold) { clearTimeout(hold.timer); hold = null; }
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    var kind = menuKind(event.target);
    if (!kind || event.target.closest('[data-r43-home-action]')) return;
    var point = { x: event.clientX, y: event.clientY, target: event.target };
    hold = { point: point, timer: setTimeout(function () {
      hold = null;
      swallowClick = true;
      openMenu(point.target);
    }, 500) };
  });
  document.addEventListener('pointermove', function (event) {
    if (hold && Math.hypot(event.clientX - hold.point.x, event.clientY - hold.point.y) > 8) {
      clearTimeout(hold.timer);
      hold = null;
    }
  });
  document.addEventListener('pointerup', function () { if (hold) { clearTimeout(hold.timer); hold = null; } });
  document.addEventListener('pointercancel', function () { if (hold) { clearTimeout(hold.timer); hold = null; } });
  document.addEventListener('click', function (event) {
    var action = event.target.closest?.('[data-r43-home-action]');
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      var id = action.dataset.id;
      var run = action.dataset.r43HomeAction === 'delete' ? deleteHome(id) : Promise.resolve(markHomeRead(id));
      run.catch(function (error) { Hub.toast(error.message || '没做成，请重试'); });
      return;
    }
    if (swallowClick) {
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (menu && !event.target.closest('[data-r43-menu]')) closeMenu();
    if (!event.target.closest('.r43-swipe-open')) closeSwipe();
  }, true);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if (dialog) { event.preventDefault(); closeDialog(); return; }
      if (menu) { event.preventDefault(); closeMenu(); return; }
      closeSwipe();
    }
    if (event.key === 'Enter' && !menu && !dialog && event.target?.matches?.('[data-r43-segment],[data-r43-event]')) {
      event.preventDefault();
      openMenu(event.target);
    }
  });
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('touchcancel', function () { swipe = null; }, { passive: true });
  document.addEventListener('pointerover', function (event) {
    if (event.pointerType === 'touch') return;
    var article = event.target.closest?.('article.msg');
    if (!article || !threadOn() || article.querySelector('[data-r43-hover]')) return;
    var button = Hub.h('button', { type: 'button', class: 'r43-hover', 'data-r43-hover': '',
      'aria-label': '打开这条消息的操作' }, '⋯');
    button.addEventListener('click', function (click) {
      click.preventDefault();
      click.stopPropagation();
      openMenu(article, button);
    });
    article.append(button);
  });
  Hub.registerSettingsPage('r43-trash', { title: '最近删除', icon: 'archive', group: '偏好', order: 70,
    render: function (host) { void openTrash(host); } });
  Hub.on('render', dressHome);
  Hub.on('ready', dressHome);
  window.R43Delete = { claimTarget: claimTarget, wantsMessageSwipe: wantsMessageSwipe, deleteTopic: deleteTopic,
    openFrom: openMenu };
})();
