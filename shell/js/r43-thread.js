/* 一位助理一条长对话。消息仍由 Hub 的原有气泡和卡片渲染器绘制。 */
(function () {
  'use strict';
  var options = new Map();
  var windows = new Map();
  var events = new Map();
  var opened = new Set();
  var loading = new Set();
  var groups = new Set();
  var heights = new Map();
  var highlights = new Map();
  var boundThreads = new WeakSet();
  var MAX_ROWS = 160;
  var MAX_CHILDREN = 100;
  var serial = 0;
  var scheduled = false;
  var newTopicText = '从这里起是新话题。这段聊天从头开始，已保存的记忆仍可读取，助理也可能收到开工摘要。';

  function real() { return document.documentElement.dataset.hubMode === 'real'; }
  function config() { return options.get(state.bot) || {}; }
  function enabled() {
    if (Hub.currentTask() || (typeof r29GroupHere === 'function' && r29GroupHere())) return false;
    return !real() || config().recent === true && config().conversation === state.conversation;
  }
  function key(row) { return row.id || 'segment-' + row.session; }
  function eventKey(session) { return state.bot + '/' + session; }
  function estimate(row) { return heights.get(key(row)) || (row.kind === 'segment' ? 60 : 130); }
  function totalHeight(rows) { return rows.reduce(function (sum, row) { return sum + estimate(row); }, 0); }
  function refresh() { if (typeof render === 'function') render(); }
  function dateText(value) {
    var date = new Date(value || Date.now());
    return Number.isFinite(+date) ? date.toLocaleString('zh-CN', {month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit'}) : '';
  }
  function eventText(row) {
    var title = String(row.title || '');
    var match = title.match(/^(派工|验收|接力|分派|安排|定时)[：:](.*)$/);
    var text = match ? match[2].trim() : title;
    var aside = row.aside || /独立会话|另开一段会话/.test(title);
    var action = '系统安排的一件事' + (text ? ' · ' + text : '');
    if (aside) {
      text = text.replace(/[·\s]*独立会话/g, '').replace(/另开一段会话/g, '').trim();
      action = '另开一段会话' + (text ? '「' + text + '」' : '');
    } else if (match) {
      if (match[1] === '派工') action = '你把「' + text + '」交给了它';
      if (match[1] === '验收') action = '请它看看「' + text + '」';
      if (match[1] === '接力') action = '接力「' + text + '」';
      if (match[1] === '分派' || match[1] === '安排') action = '首席安排了「' + text + '」';
      if (match[1] === '定时') action = '定时「' + text + '」到点了';
    }
    if (/分身/.test(title) || row.clones > 0) {
      var note = row.clones > 0 ? '用了 ' + row.clones + ' 个分身' : text.replace(/^分身记录[：:]?\s*/, '').trim();
      var record = '分身记录' + (note ? '「' + note + '」' : '');
      action = aside ? action + ' · ' + record : record;
    }
    if (row.via === 'file' || row.via === 'cli') action += ' · ' + (row.via === 'file' ? '来自文件' : '来自命令');
    return action + ' · ' + (row.state === 'running' ? '正在做' : '已交回');
  }
  function childHTML(row) {
    var entry = events.get(eventKey(row.session));
    if (!entry) return '<p class="r43-note" role="status">正在打开…</p>';
    if (entry.error) return '<button data-r43-event-retry="' + esc(row.session) + '">没打开，点这里重试</button>';
    var rows = entry.items.slice(-MAX_CHILDREN);
    var out = entry.nextBefore ? '<button data-r43-event-earlier="' + esc(row.session) + '">看更早的</button>' : '';
    out += rows.map(function (message, index) { return Hub.messageHTML(message, index); }).join('');
    if (entry.newer?.length) out += '<button data-r43-event-newer="' + esc(row.session) + '">看后面的</button>';
    return out;
  }
  function rowHTML(row) {
    if (row.gap) return '';
    var id = key(row);
    if (row.purpose !== 'board') {
      var merged = !real() && topicList().find(function (item) { return item.id === topicId(row); });
      var title = String(merged?.title || row.topicTitle || row.title || '');
      var text = row.pending || title === '新话题' ? newTopicText : !title || title === '新会话' ? dateText(row.startedAt) :
        (row.resumed ? '接着聊：' : '') + title;
      return '<div class="r43-segment" data-r43-segment="' + esc(row.session) + '" data-message-id="' + esc(id) +
        '"><span>' + esc(text) + (row.contextText ? '<small class="r43-context">' +
        esc(row.contextText) + '</small>' : '') + '</span></div>';
    }
    var token = eventKey(row.session);
    var isOpen = opened.has(token);
    var unread = row.unread && !isOpen && !events.get(token)?.seen;
    var out = '<article class="r43-event" data-r43-event="' + esc(row.session) + '" data-message-id="' + esc(id) + '">';
    out += '<button class="r43-event-toggle" data-r43-event-toggle="' + esc(row.session) +
      '" aria-expanded="' + isOpen + '"><span>' + esc(eventText(row)) + '</span>';
    out += unread ? '<i class="r43-unopened" aria-label="这段你没展开看过"></i>' : '';
    out += '<span aria-hidden="true">' + (isOpen ? '⌃' : '⌄') + '</span></button>';
    if (isOpen) {
      out += '<div class="r43-event-body" data-r43-event-body="' + esc(row.session) + '">' + childHTML(row) + '</div>';
      if (row.ticketId || row.ticket) out += '<button class="r43-card-link" data-r43-card="' +
        esc(row.ticketId || row.ticket) + '">看这张卡</button>';
    }
    return out + '</article>';
  }
  function windowFor(rows) {
    var win = windows.get(state.bot);
    if (!win) { win = {start: Math.max(0, rows.length - MAX_ROWS), tail: true}; windows.set(state.bot, win); }
    if (win.tail) win.start = Math.max(0, rows.length - MAX_ROWS);
    else if (win.first) {
      var index = rows.findIndex(function (row) { return key(row) === win.first; });
      if (index >= 0) win.start = index;
    }
    win.start = Math.max(0, Math.min(win.start, Math.max(0, rows.length - MAX_ROWS)));
    win.end = Math.min(rows.length, win.start + MAX_ROWS);
    win.first = rows[win.start] && key(rows[win.start]);
    return win;
  }
  function renderHTML(rows, renderer) {
    if (!enabled()) return rows.map(renderer).join('');
    rows = visibleRows(rows);
    var win = windowFor(rows);
    var opts = config();
    var out = '<div class="r43-top-note" data-r43-earlier role="status">' +
      (opts.loading ? '正在找更早的聊天…' : opts.hasEarlier ? '往上看更早的聊天' : '没有更早了') + '</div>';
    out += '<div data-r43-spacer="top" style="height:' + totalHeight(rows.slice(0, win.start)) + 'px"></div>';
    var selected = rows.slice(win.start, win.end);
    for (var i = 0; i < selected.length; i++) {
      var row = selected[i];
      if (row.kind === 'segment' && row.purpose === 'board') {
        var run = [row];
        while (selected[i + 1]?.kind === 'segment' && selected[i + 1]?.purpose === 'board') run.push(selected[++i]);
        if (run.length > 1) {
          var groupKey = eventKey(run[0].session);
          var expanded = run.some(function (item) { return groups.has(eventKey(item.session)); });
          out += '<details class="r43-event-group" data-r43-event-group="' + esc(groupKey) + '"' +
            (expanded ? ' open' : '') + '><summary>还有 ' + run.length + ' 件系统安排的事</summary>';
          out += run.map(rowHTML).join('') + '</details>';
        } else out += rowHTML(row);
      } else out += renderer(row, win.start + i);
    }
    out += '<div data-r43-spacer="bottom" style="height:' + totalHeight(rows.slice(win.end)) + 'px"></div>';
    if (opts.awayFromLatest || opts.hasLater || win.end < rows.length) {
      out += '<button class="r43-latest" data-r43-latest>回到最新</button>';
    }
    return out;
  }
  function findMessage(id) {
    var found = null;
    events.forEach(function (entry, token) {
      if (!token.startsWith(state.bot + '/')) return;
      found = found || entry.items?.find(function (message) { return message.id === id || message.serverId === id; });
    });
    return found;
  }
  function resetWindow(bot) { windows.delete(bot || state.bot); }
  function setOptions(bot, value) {
    options.set(bot, Object.assign({}, options.get(bot) || {}, value));
  }
  function measure() {
    var list = document.querySelector('.thread-inner');
    if (!list) return;
    list.querySelectorAll(':scope > [data-message-id]').forEach(function (node) {
      heights.set(node.dataset.messageId, node.getBoundingClientRect().height + 12);
    });
  }
  async function load(direction) {
    var opts = config();
    var callback = direction === 'earlier' ? opts.loadEarlier : opts.loadLater;
    var allowed = direction === 'earlier' ? opts.hasEarlier : opts.hasLater;
    var token = state.bot + '/' + direction;
    if (!allowed || !callback || opts.loading || loading.has(token)) return;
    loading.add(token);
    try { await callback(); }
    catch (_) { Hub.toast('暂时没读到，稍后再试'); }
    finally { loading.delete(token); }
  }
  function onScroll() {
    if (scheduled || !enabled()) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      var thread = document.querySelector('.thread');
      if (!thread) return;
      var rows = visibleRows(Hub.currentMessages());
      var win = windowFor(rows);
      var top = thread.getBoundingClientRect().top;
      var selector = '.thread-inner > [data-message-id], .thread-inner > [data-r43-event-group]';
      var first = thread.querySelector(selector);
      var last = Array.from(thread.querySelectorAll(selector)).at(-1);
      var before = win.start > 0 && first && first.getBoundingClientRect().top > top - 300;
      var after = win.end < rows.length && last &&
        last.getBoundingClientRect().bottom < top + thread.clientHeight + 300;
      if (before || after) {
        measure();
        var next = win.start + (before ? -80 : 80);
        var gap = before ? first.getBoundingClientRect().top - top :
          top + thread.clientHeight - last.getBoundingClientRect().bottom;
        if (gap > thread.clientHeight) {
          var offset = 0;
          var target = Math.max(0, thread.scrollTop - thread.clientHeight);
          next = 0;
          while (next < rows.length && offset + estimate(rows[next]) < target) offset += estimate(rows[next++]);
        }
        win.start = Math.max(0, Math.min(rows.length - MAX_ROWS, next));
        win.tail = win.start + MAX_ROWS >= rows.length;
        win.first = rows[win.start] && key(rows[win.start]);
        Hub.reading.preserve(refresh);
        var current = document.querySelector('.thread');
        if (current && win.start === 0 && current.scrollTop < 80) load('earlier');
        if (current && win.end >= rows.length &&
          current.scrollHeight - current.scrollTop - current.clientHeight < 80) load('later');
      } else if (thread.scrollTop < 80 && win.start === 0) load('earlier');
      else if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80 && win.end >= rows.length) {
        load('later');
      }
    });
  }
  function mounted() {
    paintDemoSearch();
    if (!enabled()) return;
    mountTopics();
    var thread = document.querySelector('.thread');
    if (thread && !boundThreads.has(thread)) {
      boundThreads.add(thread);
      thread.addEventListener('scroll', onScroll, {passive: true});
    }
    var panel = document.querySelector('[data-r29-plus-panel]');
    if (panel && config().canNewTopic !== false && !panel.querySelector('[data-r43-new-topic]')) {
      panel.append(Hub.h('button', {type: 'button', 'data-r43-new-topic': ''}, '新开话题'));
    }
    applyHighlight();
    measure();
  }
  function applyHighlight() {
    var target = highlights.get(state.bot);
    document.querySelectorAll('[data-message-id]').forEach(function (node) {
      node.classList.toggle('r43-highlight', !!target && target.until > Date.now() &&
        node.dataset.messageId === target.id);
    });
  }
  async function openEvent(session, request) {
    var token = eventKey(session);
    // One expanded event keeps the total number of rendered child messages bounded.
    opened.clear();
    opened.add(token);
    var entry = events.get(token);
    var opts = config();
    if (entry && !request && !entry.error) { entry.seen = true; refresh(); return; }
    var bot = state.bot;
    var row = (state.threads[bot] || []).find(function (item) { return item.session === session; });
    if (!request) events.delete(token);
    refresh();
    try {
      var result = opts.loadSegment ? await opts.loadSegment(session, request || {limit: MAX_CHILDREN}) :
        {items: row?.items || [], nextBefore: null};
      var newer = request?.before && entry && !entry.error ? [entry].concat(entry.newer || []) : [];
      events.set(token, {items: result.items || result.messages || [], nextBefore: result.nextBefore,
        newer: newer, seen: true});
    } catch (_) { events.set(token, {error: true}); }
    if (state.bot === bot) Hub.reading.preserve(refresh);
  }
  async function locate(id, session) {
    if (!real() && config().selectedTopic) setOptions(state.bot, {selectedTopic: null});
    var rows = Hub.currentMessages();
    var index = rows.findIndex(function (row) { return row.serverId === id || row.id === id; });
    if (index < 0 && session) {
      index = rows.findIndex(function (row) { return row.session === session && row.kind === 'segment'; });
      if (index >= 0) {
        groups.add(eventKey(rows[index].session));
        await openEvent(session, {around: id, limit: MAX_CHILDREN});
      }
    }
    if (index < 0) return false;
    if (rows[index].kind === 'segment' && rows[index].purpose === 'board') {
      var groupStart = index;
      while (groupStart > 0 && rows[groupStart - 1].kind === 'segment' &&
        rows[groupStart - 1].purpose === 'board') groupStart--;
      groups.add(eventKey(rows[groupStart].session));
      groups.add(eventKey(rows[index].session));
    }
    windows.set(state.bot, {start: Math.max(0, index - 40), tail: false});
    refresh();
    var targetId = rows[index].id;
    if (session) {
      var child = events.get(eventKey(session))?.items.find(function (row) {
        return row.serverId === id || row.id === id;
      });
      if (child) targetId = child.id;
      document.querySelectorAll('[data-r43-event-group]').forEach(function (node) {
        if (node.querySelector('[data-r43-event="' + CSS.escape(session) + '"]')) node.open = true;
      });
    }
    var node = Array.from(document.querySelectorAll('[data-message-id]')).find(function (el) {
      return el.dataset.messageId === targetId;
    });
    if (!node) return false;
    highlights.set(state.bot, {id: targetId, until: Date.now() + 4500});
    applyHighlight();
    Hub.reading.locate(node, {block: 'center', reason: 'thread-search'});
    setTimeout(applyHighlight, 4500);
    return true;
  }
  async function latest() {
    var opts = config();
    var bot = state.bot;
    if (opts.loadLatest && await opts.loadLatest() === false) return;
    if (state.bot !== bot || state.mode !== 'chat') return;
    resetWindow();
    refresh();
    Hub.reading.toBottom({reason: 'thread-latest'});
  }
  function newTopic() {
    if (config().canNewTopic === false) return;
    state.r29PlusOpen = false;
    var opts = config();
    if (opts.newTopic) return opts.newTopic();
    var rows = state.threads[state.bot];
    setOptions(state.bot, {selectedTopic: null});
    if (!rows.at(-1)?.pending) rows.push({id: 'r43-new-' + (++serial), kind: 'segment',
      session: 'r43-new-' + serial, pending: true, title: '新话题', startedAt: new Date().toISOString()});
    resetWindow();
    refresh();
    Hub.reading.toBottom({reason: 'new-topic'});
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-r43-new-topic],[data-r43-latest],[data-r43-event-toggle],' +
      '[data-r43-event-retry],[data-r43-event-earlier],[data-r43-event-newer],[data-r43-card]');
    if (!button) return;
    var data = button.dataset;
    if ('r43NewTopic' in data) newTopic();
    if ('r43Latest' in data) latest().catch(function () { Hub.toast('暂时没读到最新消息'); });
    if (data.r43EventToggle) {
      var token = eventKey(data.r43EventToggle);
      if (opened.has(token)) { opened.delete(token); Hub.reading.preserve(refresh); }
      else openEvent(data.r43EventToggle);
    }
    if (data.r43EventRetry) openEvent(data.r43EventRetry);
    if (data.r43EventEarlier) openEvent(data.r43EventEarlier,
      {before: events.get(eventKey(data.r43EventEarlier))?.nextBefore, limit: MAX_CHILDREN});
    if (data.r43EventNewer) {
      var pageKey = eventKey(data.r43EventNewer);
      var newer = events.get(pageKey)?.newer || [];
      if (newer.length) {
        events.set(pageKey, Object.assign({}, newer[0], {newer: newer.slice(1)}));
        Hub.reading.preserve(refresh);
      }
    }
    if (data.r43Card) {
      if (config().openCard) config().openCard(data.r43Card);
      else { state.cardId = data.r43Card; state.mode = 'kanban'; openPanel('card'); }
    }
  });
  document.addEventListener('toggle', function (event) {
    var node = event.target;
    if (!node.matches?.('[data-r43-event-group]')) return;
    if (node.open) groups.add(node.dataset.r43EventGroup);
    else {
      groups.delete(node.dataset.r43EventGroup);
      node.querySelectorAll('[data-r43-event]').forEach(function (item) {
        groups.delete(eventKey(item.dataset.r43Event));
      });
    }
  }, true);
  function paintDemoSearch() {
    if (real()) return;
    document.querySelector('[data-r43-search-results]')?.remove();
    var query = String(state.search || '').trim().toLowerCase();
    var host = document.querySelector('.home-recent');
    if (!query || !host) return;
    var box = Hub.h('div', {'data-r43-search-results': '', class: 'r43-search-results'});
    var count = 0;
    state.bots.forEach(function (bot) {
      (state.threads[bot.id] || []).forEach(function (row) {
        var candidates = row.kind === 'segment' ? (row.purpose === 'board' ? row.items || [] : []) : [row];
        candidates.forEach(function (message) {
          var text = message.text || Hub.messageText(message);
          if (count >= 30 || !text.toLowerCase().includes(query)) return;
          count++;
          box.append(Hub.h('button', {type: 'button', 'data-r43-search-hit': message.id,
            'data-r43-search-bot': bot.id, 'data-r43-search-session': row.purpose === 'board' ? row.session : ''},
          [Hub.h('strong', {}, bot.name), Hub.h('span', {}, text.slice(0, 100))]));
        });
      });
    });
    if (count) host.before(box);
  }
  document.addEventListener('click', function (event) {
    var hit = event.target.closest('[data-r43-search-hit]');
    if (!hit || real()) return;
    var bot = hit.dataset.r43SearchBot;
    var id = hit.dataset.r43SearchHit;
    var session = hit.dataset.r43SearchSession;
    state.search = '';
    Hub.navigate({view: 'chat', bot: bot});
    locate(id, session);
  });
  function topicList(bot) {
    return (options.get(bot || state.bot)?.topics || []).slice().sort(function (a, b) {
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
  }
  function topicId(row, bot) {
    var id = row.topic || row.topicId || row.session;
    var topics = topicList(bot);
    var seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      var topic = topics.find(function (item) { return item.id === id; });
      if (!topic?.mergedInto) break;
      id = topic.mergedInto;
    }
    return id;
  }
  function visibleRows(rows) {
    if (real() || !config().selectedTopic) return rows;
    return rows.filter(function (row) { return topicId(row) === config().selectedTopic; });
  }
  function topicPreview(bot, text) {
    if (real()) return text;
    var rows = state.threads[bot] || [];
    var last = rows.at(-1);
    var topic = topicList(bot).find(function (item) { return item.id === topicId(last || {}, bot); });
    return topic ? topic.title + ' · ' + text : text;
  }
  async function selectTopic(id) {
    if (config().onSelectTopic) await config().onSelectTopic(id || null);
    else setOptions(state.bot, {selectedTopic: id || null});
    resetWindow();
    refresh();
    Hub.reading.toBottom({reason: 'topic-select'});
  }
  function mountTopics() {
    var old = document.querySelector('[data-r43-topic-bar]');
    if (!Array.isArray(config().topics)) { old?.remove(); return; }
    var host = document.querySelector('.chatview');
    if (!host) return;
    var bar = Hub.h('nav', {class: 'r43-topic-bar', 'data-r43-topic-bar': '', 'aria-label': '按话题看'});
    function chip(id, title) {
      return Hub.h('button', {type: 'button', 'data-r43-topic': id,
        'aria-pressed': String((config().selectedTopic || '') === id)}, title);
    }
    bar.append(chip('', '全部'));
    var topics = topicList();
    var recent = topics.filter(function (item) { return !item.system && !item.mergedInto; }).slice(0, 6);
    var selected = topics.find(function (item) { return item.id === config().selectedTopic; });
    if (selected && !recent.some(function (item) { return item.id === selected.id; })) recent.push(selected);
    recent.forEach(function (item) { bar.append(chip(item.id, item.title)); });
    bar.append(Hub.h('button', {type: 'button', 'data-r43-topics-more': ''}, '更多话题'));
    if (old) old.replaceWith(bar);
    else host.prepend(bar);
  }
  function labelHTML(message) {
    if (!enabled() || !message.topicLabel) return '';
    var label = message.topicLabel;
    var text = typeof label === 'string' ? label : label.text;
    if (!real() && topicId(message) !== message.session) {
      var assigned = topicList().find(function (item) { return item.id === topicId(message); });
      if (assigned) text = '接着聊：' + assigned.title;
    }
    if (!text) text = (label.kind === 'new' ? '新话题：' : '接着聊：') + (message.topicTitle || '这件事');
    return '<button type="button" class="r43-topic-label" data-r43-topic-label="' + esc(message.id) +
      '" aria-label="更改话题归属">' + esc(text) + '</button>';
  }
  function topicPanel() {
    var searchText = '';
    Hub.sheet({title: '全部话题', body: function (host) {
      var search = Hub.h('input', {type: 'search', placeholder: '搜索话题', 'aria-label': '搜索话题',
        'data-r43-topic-search': '', 'data-focus': 'r43-topic-search', value: searchText,
        class: 'r43-topic-search'});
      var list = Hub.h('div', {class: 'r43-topic-list'});
      function draw() {
        list.replaceChildren();
        var query = search.value.trim().toLowerCase();
        var topics = topicList().filter(function (item) {
          return (item.title + ' ' + (item.summary || '')).toLowerCase().includes(query);
        });
        var system = Hub.h('details', {class: 'r43-system-topics', 'data-r43-system-topics': ''},
          Hub.h('summary', {}, '它替你办的事'));
        topics.forEach(function (item) {
          var row = Hub.h('section', {class: 'r43-topic-item', 'data-r43-topic-item': item.id});
          row.append(Hub.h('button', {type: 'button', 'data-r43-topic-pick': item.id,
            class: 'r43-topic-title'}, item.title));
          if (item.summary) row.append(Hub.h('p', {class: 'r43-topic-summary'}, item.summary));
          if (item.contextText) row.append(Hub.h('p', {class: 'r43-topic-summary'}, item.contextText));
          var actions = Hub.h('div', {class: 'r43-topic-actions'});
          actions.append(Hub.h('button', {type: 'button', 'data-r43-rename': item.id}, '改名'));
          if (item.mergedInto) {
            var target = topics.find(function (candidate) { return candidate.id === item.mergedInto; });
            row.append(Hub.h('p', {class: 'r43-topic-summary'}, '已归到「' + (target?.title || '另一话题') + '」'));
            actions.append(Hub.h('button', {type: 'button', 'data-r43-unmerge': item.id}, '撤销合并'));
          } else if (!item.system) {
            actions.append(Hub.h('button', {type: 'button', 'data-r43-merge': item.id}, '合并到…'));
          }
          actions.append(Hub.h('button', {type: 'button', 'data-r43-topic-delete': item.id,
            disabled: !config().deleteTopic, title: config().deleteTopic ? '删除这个话题' : '删除功能待接入'},
          '删除这个话题'));
          row.append(actions);
          (item.system ? system : list).append(row);
        });
        if (topics.some(function (item) { return item.system; })) list.append(system);
        if (!topics.length) list.append(Hub.h('p', {class: 'r43-note'}, '没有找到这个话题'));
      }
      search.addEventListener('input', function () { searchText = search.value; draw(); });
      host.append(search, list);
      draw();
    }});
  }
  async function closeTopicPanel() {
    if (!state.drawer) return;
    await new Promise(function (resolve, reject) {
      var timer;
      function complete() {
        clearTimeout(timer);
        window.removeEventListener('popstate', complete);
        if (state.drawer) reject(Error('面板还在关闭，请再试一次'));
        else resolve();
      }
      window.addEventListener('popstate', complete);
      if (!shellNavigation.back(true)) {
        window.removeEventListener('popstate', complete);
        state.drawer = null;
        panelHistory = [];
        refresh();
        resolve();
      } else timer = setTimeout(complete, 1200);
    });
  }
  async function changeTopic(action, args, fallback) {
    var callback = config()[action];
    if (callback) await callback.apply(null, args);
    else if (!real() && fallback) fallback();
    else throw Error('这项操作暂时不可用');
    resetWindow();
    refresh();
  }
  function renamePanel(id) {
    var topic = topicList().find(function (item) { return item.id === id; });
    if (!topic) return;
    var draft = topic.title;
    Hub.sheet({title: '修改话题名', body: function (host) {
      var input = Hub.h('input', {type: 'text', value: draft, maxlength: 80,
        'aria-label': '话题名', 'data-r43-topic-name': '', 'data-focus': 'r43-topic-name',
        class: 'r43-topic-search'});
      input.addEventListener('input', function () { draft = input.value; });
      var error = Hub.h('p', {role: 'status', class: 'r43-note'});
      var save = Hub.h('button', {type: 'button', class: 'primary', 'data-r43-rename-save': ''}, '保存');
      save.addEventListener('click', async function () {
        var title = input.value.trim();
        if (!title) { error.textContent = '请写一个话题名'; return; }
        save.disabled = true;
        try {
          await changeTopic('renameTopic', [id, title], function () {
            topic.title = title;
            state.threads[state.bot].forEach(function (row) {
              if (topicId(row) === id) {
                row.topicTitle = title;
                if (row.kind === 'segment') row.title = title;
                if (row.topicLabel) row.topicLabel = '接着聊：' + title;
              }
            });
          });
          topicPanel();
        } catch (failure) { error.textContent = failure.message || '没改好，请重试'; save.disabled = false; }
      });
      host.append(input, save, error);
    }});
  }
  function targetSelect(exclude) {
    var select = Hub.h('select', {'aria-label': '目标话题', 'data-r43-reassign-target': '',
      'data-focus': 'r43-topic-target',
      class: 'r43-topic-search'});
    topicList().filter(function (topic) {
      return topic.id !== exclude && !topic.system && !topic.mergedInto;
    }).forEach(function (topic) { select.append(Hub.h('option', {value: topic.id}, topic.title)); });
    return select;
  }
  function mergePanel(id) {
    var selected = '';
    Hub.sheet({title: '合并话题', body: function (host) {
      var select = targetSelect(id);
      if (selected) select.value = selected;
      select.addEventListener('change', function () { selected = select.value; });
      var note = Hub.h('p', {class: 'r43-topic-summary'}, '消息会归到选中的话题，原来的聊天内容保留，之后可以撤销。');
      var error = Hub.h('p', {role: 'status', class: 'r43-note'});
      var save = Hub.h('button', {type: 'button', class: 'primary', 'data-r43-merge-save': ''}, '合并');
      save.disabled = !select.options.length;
      save.addEventListener('click', async function () {
        save.disabled = true;
        try {
          await changeTopic('mergeTopics', [id, select.value], function () {
            topicList().find(function (item) { return item.id === id; }).mergedInto = select.value;
          });
          topicPanel();
        } catch (failure) { error.textContent = failure.message || '没合并好，请重试'; save.disabled = false; }
      });
      host.append(note, select, save, error);
    }});
  }
  function reassignPanel(id) {
    var rows = state.threads[state.bot] || [];
    var message = rows.find(function (row) { return row.id === id; });
    if (!message) return;
    if (config().beginReassign) Promise.resolve(config().beginReassign(message)).catch(function () {});
    var waiting = message.replyState === 'pending';
    var running = message.replyState === 'running';
    var selected = '';
    var newTitle = '';
    Hub.sheet({title: waiting ? '更改这条消息的话题' : '把这轮问答挪到话题', body: function (host) {
      var select = targetSelect(topicId(message));
      select.append(Hub.h('option', {value: '__new__'}, '其实是新话题'));
      if (selected) select.value = selected;
      var title = Hub.h('input', {type: 'text', placeholder: '新话题的名字', maxlength: 80, value: newTitle,
        'aria-label': '新话题的名字', 'data-r43-reassign-name': '', 'data-focus': 'r43-reassign-name',
        class: 'r43-topic-search'});
      title.addEventListener('input', function () { newTitle = title.value; });
      title.hidden = select.value !== '__new__';
      select.addEventListener('change', function () {
        selected = select.value;
        title.hidden = select.value !== '__new__';
      });
      var note = Hub.h('p', {class: 'r43-topic-summary'}, running ? '助理正在回复，等它答完后可以挪动这轮问答。' :
        waiting ? '只更改这条消息和还没开始的回复。' : '时间线上的问答一起归到选中的话题，原聊天记录保留。');
      var error = Hub.h('p', {role: 'status', class: 'r43-note'});
      var save = Hub.h('button', {type: 'button', class: 'primary', 'data-r43-reassign-submit': '',
        disabled: running}, waiting ? '更改归属' : '挪动这轮问答');
      save.addEventListener('click', async function () {
        var payload = {messageId: message.serverId || message.id, session: message.session,
          target: select.value === '__new__' ? null : select.value, newTopic: select.value === '__new__',
          title: title.value.trim(), round: !waiting,
          requestId: message.classification?.requestId || message.requestId};
        if (payload.newTopic && !payload.title) { error.textContent = '请写一个新话题名'; return; }
        save.disabled = true;
        try {
          await changeTopic('reassignMessage', [payload], function () {
            var target = payload.target;
            if (payload.newTopic) {
              target = 'demo-topic-' + (++serial);
              config().topics.push({id: target, title: payload.title, updatedAt: new Date().toISOString()});
            }
            var index = rows.indexOf(message);
            var end = payload.round ? index + 1 : index;
            while (payload.round && end < rows.length && rows[end].role !== 'user' &&
              rows[end].kind !== 'segment') end++;
            rows.slice(index, Math.max(index + 1, end)).forEach(function (row) { row.topic = target; });
            var targetTopic = topicList().find(function (item) { return item.id === target; });
            message.topicLabel = '接着聊：' + targetTopic.title;
          });
          await closeTopicPanel();
        } catch (failure) { error.textContent = failure.message || '没改好，请重试'; save.disabled = false; }
      });
      host.append(note, select, title, save, error);
    }});
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-r43-topic],[data-r43-topics-more],[data-r43-topic-pick],' +
      '[data-r43-rename],[data-r43-merge],[data-r43-unmerge],[data-r43-topic-label],[data-r43-topic-delete]');
    if (!button) return;
    var data = button.dataset;
    async function act() {
      if ('r43Topic' in data) await selectTopic(data.r43Topic);
      if ('r43TopicsMore' in data) topicPanel();
      if (data.r43TopicPick) { await closeTopicPanel(); await selectTopic(data.r43TopicPick); }
      if (data.r43Rename) renamePanel(data.r43Rename);
      if (data.r43Merge) mergePanel(data.r43Merge);
      if (data.r43Unmerge) {
        await changeTopic('undoMerge', [data.r43Unmerge], function () {
          delete topicList().find(function (topic) { return topic.id === data.r43Unmerge; }).mergedInto;
        });
        topicPanel();
      }
      if (data.r43TopicLabel) reassignPanel(data.r43TopicLabel);
      if (data.r43TopicDelete && config().deleteTopic) await config().deleteTopic(data.r43TopicDelete);
    }
    act().catch(function (error) { Hub.toast(error.message || '暂时没改好，请重试'); });
  });
  function seedDemo() {
    if (real()) return;
    var byBot = new Map();
    var topicsByBot = new Map();
    (window.R43_DEMO_SEGMENTS || []).forEach(function (segment, occurrence) {
      if (!byBot.has(segment.bot)) { byBot.set(segment.bot, []); topicsByBot.set(segment.bot, new Map()); }
      var rows = byBot.get(segment.bot);
      if (segment.gap) {
        rows.push({kind: 'segment', id: 'r43-gap-' + occurrence, gap: true, purpose: 'gap'});
        return;
      }
      var topics = topicsByBot.get(segment.bot);
      var first = topics.get(segment.session)?.first || segment.items?.[0]?.text || '';
      var contextText = segment.purpose === 'board' ? '' : '助理在这个话题里记得：从「' + first + '」起（演示）';
      topics.set(segment.session, {id: segment.session, title: segment.title, first: first,
        updatedAt: segment.startedAt, system: segment.purpose === 'board', contextText: contextText,
        summary: segment.items?.at(-1)?.text || ''});
      rows.push(Object.assign({kind: 'segment', id: 'r43-' + segment.session + '-' + occurrence,
        contextText: contextText}, segment));
      if (segment.purpose !== 'board') (segment.items || []).forEach(function (message, index) {
        rows.push(Object.assign({session: segment.session, time: '上次', topicTitle: segment.title,
          ts: new Date(+new Date(segment.startedAt) + (index + 1) * 1000).toISOString(), replyState: 'done',
          topicLabel: message.role === 'user' ? (segment.resumed ? '接着聊：' : '新话题：') + segment.title : null},
        message));
      });
    });
    byBot.forEach(function (rows, bot) {
      var previous = state.threads[bot];
      if (!previous || previous.some(function (row) { return row.kind === 'segment'; })) return;
      var id = 'demo-current-' + bot;
      var title = '今天的安排';
      previous.forEach(function (row) { row.session = id; row.topicTitle = title; });
      topicsByBot.get(bot).set(id, {id: id, title: title, updatedAt: '2026-11-13T08:00:00Z',
        summary: '整理今天要办的事情，等你确认下一步。'});
      previous.unshift.apply(previous, rows.concat([{kind: 'segment', id: 'r43-current-' + bot,
        session: id, title: title, startedAt: '2026-11-13T08:00:00Z'}]));
      setOptions(bot, {topics: Array.from(topicsByBot.get(bot).values()), selectedTopic: null});
    });
  }
  function classifyDemo(report) {
    if (real() || !Array.isArray(config().topics) || report.conversation !== state.conversation) return false;
    var message = report.message;
    if (!message || message.session) return false;
    var rows = state.threads[state.bot];
    var index = rows.findIndex(function (row) { return row.id === message.id; });
    var previous = rows[index - 1];
    if (message.role !== 'user') {
      message.session = previous?.session;
      message.topic = previous?.topic;
      return false;
    }
    var text = message.text || Hub.messageText(message);
    var topic = topicList().find(function (item) { return item.id === topicId(previous || {}); });
    var pending = previous?.pending;
    var matched = topicList().find(function (item) {
      return !item.system && !item.mergedInto && text.includes(item.title);
    });
    if (matched && !pending) topic = matched;
    if (pending || !topic) {
      var id = pending ? previous.session : 'demo-topic-' + (++serial);
      topic = {id: id, title: text.slice(0, 16) || '新话题', summary: text.slice(0, 80), updatedAt: Date.now()};
      config().topics.push(topic);
      if (pending) Object.assign(previous, {title: topic.title, pending: false});
    }
    if (!pending && previous && topicId(previous) !== topic.id) {
      rows.splice(index, 0, {kind: 'segment', id: 'r43-resume-' + (++serial), session: topic.id,
        title: topic.title, resumed: true, startedAt: new Date().toISOString()});
    }
    Object.assign(message, {session: topic.id, topicTitle: topic.title, replyState: 'done',
      topicLabel: (pending ? '新话题：' : '接着聊：') + topic.title});
    topic.updatedAt = Date.now();
    setOptions(state.bot, {selectedTopic: null});
    return true;
  }
  function forgetMessage(id) {
    events.forEach(function (entry) {
      if (!Array.isArray(entry.items)) return;
      entry.items = entry.items.filter(function (item) {
        return item.id !== id && item.serverId !== id && item.messageId !== id;
      });
    });
  }
  window.R43Thread = {renderHTML: renderHTML, rowHTML: rowHTML, setOptions: setOptions, locate: locate,
    findMessage: findMessage, resetWindow: resetWindow, newTopic: newTopic, openEvent: openEvent,
    forgetMessage: forgetMessage, latest: latest, eventText: eventText,
    newTopicText: newTopicText, labelHTML: labelHTML, topicPreview: topicPreview,
    topics: topicList, selectTopic: selectTopic, maxMessages: MAX_ROWS + MAX_CHILDREN};
  seedDemo();
  Hub.on('render', mounted);
  Hub.on('ready', mounted);
  Hub.on('message', function (report) {
    if (!enabled() || report.quiet || report.conversation !== state.conversation) return;
    if (classifyDemo(report)) { resetWindow(); refresh(); }
    var sent = report.message?.from === 'user' || report.message?.role === 'user';
    var win = windows.get(state.bot);
    var moved = sent && win && !win.tail;
    if (!moved && Hub.currentMessages().length <= MAX_ROWS) return;
    if (sent) resetWindow();
    Hub.reading.preserve(refresh);
  });
})();
