/* 捕获阶段改「更多 / 权限 / 新建」。离线双倍 DOM 不走捕获，旧点击断言仍走原函数。 */
(function () {
  if (!window.Hub) return;
  var MODES = ['open', 'ask', 'readonly'];
  var PROMPT = '帮我新建一个助理，负责：';
  var memory = { mode: 'open' };
  var pulledFor = null;
  var ticket = 0;
  var acked = memory.mode;
  var active = 0;
  var desired = memory.mode;
  var message = '';
  var corrected = false;
  window.R29Permission = memory;

  function realMode() {
    return document.documentElement.dataset.hubMode === 'real';
  }
  function paint() {
    if (typeof state !== 'undefined' && state.drawer === 'permission' && typeof render === 'function') render();
    var root = document.querySelector('.drawer');
    if (root) {
      var note = root.querySelector('[data-r29-save-status]');
      if (!note) { note = document.createElement('p'); note.setAttribute('data-r29-save-status', '');
        note.setAttribute('role', 'status'); root.prepend(note); }
      note.textContent = message;
    }
  }
  function serverMode(value) {
    if (!value || typeof value !== 'object') return '';
    if (MODES.indexOf(value.mode) >= 0) return value.mode;
    var permission = value.permission;
    if (typeof permission === 'string' && MODES.indexOf(permission) >= 0) return permission;
    if (permission && MODES.indexOf(permission.mode) >= 0) return permission.mode;
    return '';
  }
  function reconcile() {
    var hook = window.HubSettings;
    if (active) return;
    if (!hook || typeof hook.get !== 'function') {
      if (realMode()) { message = '现在无法核对'; paint(); }
      return;
    }
    var mine = ticket;
    Promise.resolve().then(function () { return hook.get(); }).then(function (value) {
      if (mine !== ticket || active) return;
      var actual = serverMode(value);
      if (!actual) { message = '没保存上'; paint(); return; }
      if (actual !== desired && message !== '没保存上' && !corrected) {
        // 回读和刚确认的写入对不上：补写一次，补写没结果前仍显示刚确认的档位。
        corrected = true; applyMode(desired, true); return;
      }
      memory.mode = acked = actual;
      if (actual !== desired) message = '没保存上';
      paint();
    }).catch(function () { if (mine === ticket) { message = '没保存上'; paint(); } });
  }
  function applyMode(next, correction) {
    if (MODES.indexOf(next) < 0) return;
    if (!correction) corrected = false;
    var hook = window.HubSettings;
    if (!hook || typeof hook.setPermission !== 'function') {
      if (realMode()) { message = '现在改不了'; paint(); Hub.toast(message); return; }
      memory.mode = acked = next; paint(); return;
    }
    var mine = ++ticket;
    desired = next;
    active++;
    message = '正在保存';
    paint();
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      active--;
      if (mine === ticket) { message = '没保存上'; memory.mode = acked; paint(); }
      reconcile();
    }, 8000);
    var result;
    try { result = hook.setPermission(next); }
    catch (error) { result = Promise.reject(error); }
    Promise.resolve(result).then(function (value) {
      if (value && value.ok === false) throw Error('rejected');
      if (settled) { reconcile(); return; }
      settled = true; clearTimeout(timer); active--;
      acked = serverMode(value) || next;
      if (active && mine !== ticket) { memory.mode = desired; paint(); }
      if (!active) {
        memory.mode = acked;
        if (mine === ticket || message !== '没保存上') message = '';
        paint(); reconcile();
      }
    }).catch(function () {
      if (settled) { reconcile(); return; }
      settled = true; clearTimeout(timer); active--;
      if (mine === ticket) { message = '没保存上'; memory.mode = acked; paint(); }
      if (!active) { memory.mode = acked; paint(); reconcile(); }
    });
  }
  function pull() {
    var hook = window.HubSettings;
    if (!hook || typeof hook.get !== 'function') return;
    var mine = ticket;
    if (active) return;
    var result;
    try { result = hook.get(); }
    catch (error) { return; }
    Promise.resolve(result).then(function (data) {
      if (mine !== ticket) return;
      var mode = data && data.permission && data.permission.mode;
      if (MODES.indexOf(mode) < 0 || mode === memory.mode) return;
      memory.mode = mode;
      acked = mode;
      paint();
    }).catch(function () {});
  }
  function showEmpty(title) {
    Hub.sheet({
      title: title || '暂无',
      body: function (node) { node.append(Hub.h('p', { role: 'status' }, '暂无')); }
    });
  }
  function chief() {
    var bots = (Hub.state && Hub.state.bots) || [];
    for (var i = 0; i < bots.length; i++) if (bots[i].role === 'chief') return bots[i];
    return null;
  }
  function sayToChief(text) {
    var bot = chief();
    if (!bot || typeof Hub.fillDraft !== 'function' || !Hub.fillDraft(bot.id, text)) {
      Hub.toast('现在没有首席，先不发送');
    }
  }
  function openTemplates() {
    var templates = (Hub.state && Hub.state.botTemplates) || [];
    Hub.sheet({
      title: '从模板',
      body: function (node) {
        if (!templates.length) {
          node.append(Hub.h('p', { role: 'status' }, '暂无'));
          return;
        }
        templates.forEach(function (item) {
          var button = Hub.h('button', {
            type: 'button', class: 'setting-row r29-more-row', 'data-r29-template': item.id || ''
          }, [Hub.h('strong', {}, item.name || ''), Hub.h('p', {}, item.duty || '')]);
          button.addEventListener('click', function () {
            var name = String(item.name || '');
            var duty = String(item.duty || '');
            sayToChief('帮我新建一个助理，用模板「' + name + '」，负责：' + duty);
          });
          node.append(button);
        });
      }
    });
  }
  function keepActivity() {
    if (!realMode()) return true;
    var items = [];
    try { items = Hub.activities() || []; } catch (error) { items = []; }
    return items.some(function (item) { return String(item.id || '').indexOf('hub-real-') === 0; });
  }
  function showTasks() {
    var tasks = [];
    try { tasks = Hub.fixedTasks() || []; } catch (error) { tasks = []; }
    Hub.sheet({
      title: '固定任务',
      body: function (node) {
        if (!tasks.length) { node.append(Hub.h('p', { role: 'status' }, '暂无')); return; }
        tasks.forEach(function (task) {
          var title = '';
          try { title = Hub.fixedTaskTitle(task); } catch (error) { title = ''; }
          node.append(Hub.h('p', {}, title || '暂无'));
        });
      }
    });
  }
  function stopDemo() {
    if (Hub.state) {
      Hub.state.running = false;
      (Hub.state.bots || []).forEach(function (bot) { bot.running = false; });
    }
    Hub.toast('已停下');
  }
  function openRealOr(panel, demo) {
    if (realMode()) {
      if (panel && Hub.hasPanel(panel)) Hub.openPanel(panel);
      else showEmpty();
      return;
    }
    demo();
  }
  function blockOldCreate(node) {
    if (node.hasAttribute('data-bot-template')) {
      var nameNode = node.querySelector('strong');
      var dutyNode = node.querySelector('p');
      var name = nameNode ? nameNode.textContent : '';
      var duty = dutyNode ? dutyNode.textContent : '';
      sayToChief('帮我新建一个助理，用模板「' + name + '」，负责：' + duty);
      return;
    }
    var field = document.querySelector('[data-new-bot-duty]');
    var value = field && field.value ? String(field.value).trim() : '';
    if (!value) {
      var hint = document.querySelector('[data-new-bot-validation]');
      if (hint) hint.textContent = '请先填写负责什么项目';
      return;
    }
    if (node.getAttribute('data-new-bot-choice') === 'templates') {
      openTemplates();
      return;
    }
    sayToChief(PROMPT + value);
  }
  function route(id) {
    if (id === 'permissions') { Hub.openPanel('permission'); pull(); return; }
    if (id === 'appearance') { Hub.openPanel('appearance'); return; }
    if (id === 'settings') { Hub.openPanel('r31-settings'); return; }
    if (id === 'activity') { showEmpty('活动'); return; }
    /* 账本只有一个页面，不再另开旧的抽屉。 */
    if (id === 'ledger') { Hub.navigate({ view: 'ledger' }); return; }
    var map = {
      today: ['hub-real-today', function () { Hub.navigate({ view: 'persona-today' }); }],
      board: ['hub-real-board', function () { Hub.openFeature('board'); }],
      roster: ['hub-real-bots', function () { Hub.openPanel('assistant-directory'); }],
      tasks: ['hub-real-routines', function () { showTasks(); }],
      ledger: ['hub-real-ledger', function () { Hub.openFeature('ledger'); }],
      stop: ['hub-real-panic', function () { stopDemo(); }]
    };
    var row = map[id];
    if (!row) return;
    openRealOr(row[0], row[1]);
  }
  function hideNoSource() {
    if (!realMode()) return;
    var root = document.querySelector('.more-drawer');
    if (!root) return;
    var banned = { '记忆': 1, '设备': 1, '连接': 1, '形态': 1 };
    root.querySelectorAll('button').forEach(function (button) {
      if (banned[(button.textContent || '').trim()]) {
        button.hidden = true;
        button.setAttribute('data-r29-no-source', '');
      }
    });
  }
  Hub.on('render', function () {
    hideNoSource();
    if (typeof state !== 'undefined' && state.drawer === 'permission') {
      if (pulledFor !== 'permission') { pulledFor = 'permission'; pull(); }
    } else pulledFor = null;
  });
  document.addEventListener('click', function (event) {
    if (event.eventPhase !== 1 || !event.target || !event.target.closest) return;
    var node = event.target.closest(
      '[data-r29-permission],[data-r29-open-permissions],[data-new-bot-open],' +
      '[data-r22-template-open],[data-new-bot-choice],[data-bot-template],[data-r29-more]'
    );
    if (!node) return;
    if (node.hasAttribute('data-r29-permission')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyMode(node.getAttribute('data-r29-permission'));
      return;
    }
    if (node.hasAttribute('data-r29-open-permissions')) {
      event.preventDefault();
      Hub.openPanel('permission');
      pull();
      return;
    }
    if (node.hasAttribute('data-new-bot-open')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      sayToChief(PROMPT);
      return;
    }
    if (node.hasAttribute('data-r22-template-open')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openTemplates();
      return;
    }
    if (node.hasAttribute('data-new-bot-choice') || node.hasAttribute('data-bot-template')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      blockOldCreate(node);
      return;
    }
    var id = node.getAttribute('data-r29-more');
    if (id === 'activity' && keepActivity()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    route(id);
  }, true);
})();
