/* · 单个助理的设置。钩子缺失时只读，不另写保存。 */
(function () {
  'use strict';
  var editing = null;
  var picking = false;
  var findQuery = '';
  var asked = false;
  var cache = null;
  var MODE = {open: '全开', ask: '改动前问', readonly: '只读'};

  function realMode() {
    return document.documentElement.dataset.hubMode === 'real';
  }

  function toast(text) {
    if (window.Hub && typeof Hub.toast === 'function') Hub.toast(text);
  }

  function redraw() {
    if (typeof render === 'function') render();
  }

  function botNow(id) {
    var bot = typeof botBy === 'function' ? botBy(id || state.bot) : null;
    return bot || null;
  }

  function pageBot(node) {
    var page = node && node.closest ? node.closest('[data-r29-settings-page]') : null;
    var id = page && page.getAttribute('data-r29-bot');
    return botNow(id || state.bot);
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function text(tag, className, value) {
    var node = el(tag, className);
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function hasHook() {
    return !!(window.HubSettings && typeof HubSettings.get === 'function');
  }

  function ensure() {
    if (!hasHook() || asked) return;
    asked = true;
    Promise.resolve().then(function () {
      return HubSettings.get();
    }).then(function (data) {
      cache = data && typeof data === 'object' ? data : {};
      redraw();
    }, function () {
      cache = {error: true};
      redraw();
    });
  }

  function normalizeModels(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (item) {
      if (typeof item === 'string') return {name: item, efforts: []};
      if (!item || typeof item !== 'object') return null;
      var name = item.name || item.label || item.id || '';
      if (!name) return null;
      var efforts = item.efforts || item.levels || item.effort || [];
      if (typeof efforts === 'string') efforts = [efforts];
      if (!Array.isArray(efforts)) efforts = [];
      return {name: String(name), efforts: efforts.map(String).filter(Boolean)};
    }).filter(Boolean);
  }

  function answerOf(bot) {
    var id = bot && bot.id;
    if (!hasHook()) {
      if (realMode()) return {text: '暂无', readOnly: true, models: []};
      var model = state.model || '暂无';
      var effort = state.strength || '暂无';
      return {text: model + ' · ' + effort, readOnly: true, models: []};
    }
    if (!cache) return {text: '读取中', readOnly: true, pending: true, models: []};
    if (cache.error) return {text: '暂无', readOnly: true, models: []};
    var row = cache.bots && id ? cache.bots[id] : null;
    var modelName = row && (row.model || row.name) || '';
    var effortName = row && (row.effort || row.strength) || '';
    var models = normalizeModels(cache.models);
    var canSave = typeof HubSettings.setBot === 'function' && models.length > 0;
    var text = (modelName || effortName)
      ? ((modelName || '暂无') + ' · ' + (effortName || '暂无'))
      : '暂无';
    return {
      text: text,
      readOnly: !canSave,
      models: models,
      model: modelName,
      effort: effortName
    };
  }

  function permissionWord() {
    if (hasHook()) {
      if (!cache) return '暂无';
      if (cache.error) return '读不到（按改动前问处理）';
      var mode = cache.permission && cache.permission.mode;
      return MODE[mode] || '暂无';
    }
    return realMode() ? '暂无' : '全开';
  }

  function cleanMounts(bot) {
    var list = [];
    try {
      if (window.Hub && typeof Hub.memoryMounts === 'function') {
        list = Hub.memoryMounts(bot.id) || [];
      }
    } catch (error) {
      list = [];
    }
    if (!Array.isArray(list)) return [];
    return list.filter(function (slice) {
      var blob = [slice && slice.title, slice && slice.source, slice && slice.scope,
        slice && slice.project].join(' ');
      return blob.indexOf('演示') < 0;
    });
  }

  function memoryLine(bot) {
    var rows = cleanMounts(bot);
    if (!rows.length) return '';
    var parts = [];
    rows.forEach(function (slice) {
      var bit = String((slice && (slice.scope || slice.title || slice.source)) || '').trim();
      if (bit && parts.indexOf(bit) < 0) parts.push(bit);
    });
    return parts.join('、') || (rows.length + ' 项');
  }

  function oldSessions(bot) {
    var list = Array.isArray(state.extraSessions) ? state.extraSessions : [];
    return list.map(function (item, index) {
      return {index: index, bot: item && item.bot, name: item && item.name};
    }).filter(function (item) {
      return item.bot === bot.id && item.name;
    });
  }

  function putAvatar(host, bot) {
    var html = '';
    if (window.HubAvatars && typeof HubAvatars.html === 'function') {
      try { html = HubAvatars.html(bot.id, 72) || ''; } catch (error) { html = ''; }
    }
    if (!html && typeof avatar === 'function') {
      try { html = avatar(bot.id) || ''; } catch (error) { html = ''; }
    }
    if (html) host.innerHTML = html;
    else host.append(text('span', 'r29-empty', realMode() ? '暂无' : ''));
  }

  function fieldForm(bot, kind) {
    var form = el('form', 'r29-form');
    form.setAttribute('data-r29-form', kind);
    var input = document.createElement(kind === 'duty' ? 'textarea' : 'input');
    input.value = kind === 'name' ? (bot.name || '') : (bot.duty || '');
    input.maxLength = kind === 'name' ? 8 : 80;
    input.setAttribute('aria-label', kind === 'name' ? '名字' : '一句职责');
    input.required = true;
    var save = el('button', 'primary');
    save.type = 'submit';
    save.textContent = '预览改动';
    var cancel = el('button', 'ghostbtn');
    cancel.type = 'button';
    cancel.setAttribute('data-r29-cancel', '');
    cancel.textContent = '取消';
    form.append(input, save, cancel);
    return form;
  }

  function identity(page, bot) {
    var section = el('section', 'r29-block r29-identity');
    section.setAttribute('data-r29-block', 'identity');
    var avatarBtn = el('button', 'r29-avatar');
    avatarBtn.type = 'button';
    avatarBtn.setAttribute('data-r29-edit', 'avatar');
    avatarBtn.setAttribute('aria-label', '换形象');
    putAvatar(avatarBtn, bot);
    var copy = el('div', 'r29-id');
    if (editing === 'name') copy.append(fieldForm(bot, 'name'));
    else {
      var nameBtn = el('button', 'r29-name');
      nameBtn.type = 'button';
      nameBtn.setAttribute('data-r29-edit', 'name');
      nameBtn.textContent = bot.name || (realMode() ? '暂无' : '助理');
      copy.append(nameBtn);
    }
    if (editing === 'duty') copy.append(fieldForm(bot, 'duty'));
    else {
      var dutyBtn = el('button', 'r29-duty');
      dutyBtn.type = 'button';
      dutyBtn.setAttribute('data-r29-edit', 'duty');
      dutyBtn.textContent = bot.duty || (realMode() ? '暂无' : '');
      copy.append(dutyBtn);
    }
    section.append(avatarBtn, copy);
    page.append(section);
  }

  function answer(page, bot, forceOpen) {
    var info = answerOf(bot);
    var section = el('section', 'r29-block');
    section.setAttribute('data-r29-block', 'answer');
    section.append(text('h3', '', '回答方式'));
    var open = !info.readOnly && (forceOpen || picking);
    if (info.readOnly) {
      var line = text('p', 'r29-line', info.text);
      line.setAttribute('data-r29-readonly', 'true');
      section.append(line);
    } else {
      var toggle = el('button', 'r29-line');
      toggle.type = 'button';
      toggle.setAttribute('data-r29-pick', 'answer');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = info.text;
      section.append(toggle);
    }
    if (open) {
      var choices = el('div', 'r29-choices');
      choices.setAttribute('data-r29-choices', '');
      info.models.forEach(function (model) {
        var button = el('button', 'setting-row');
        button.type = 'button';
        button.setAttribute('data-r29-model', model.name);
        button.setAttribute('aria-pressed', model.name === info.model ? 'true' : 'false');
        button.textContent = model.name;
        choices.append(button);
      });
      var efforts = [];
      info.models.forEach(function (model) {
        if (model.name === info.model) efforts = model.efforts;
      });
      if (!efforts.length && info.effort) efforts = [info.effort];
      if (efforts.length) {
        choices.append(text('p', 'r29-sub', '思考强度'));
        efforts.forEach(function (effort) {
          var button = el('button', 'setting-row');
          button.type = 'button';
          button.setAttribute('data-r29-effort', effort);
          button.setAttribute('aria-pressed', effort === info.effort ? 'true' : 'false');
          button.textContent = effort;
          choices.append(button);
        });
      }
      section.append(choices);
    }
    page.append(section);
  }

  function sessions(page, bot) {
    var section = el('section', 'r29-block');
    section.setAttribute('data-r29-block', 'sessions');
    section.append(text('h3', '', '这位助理的会话'));
    var actions = el('div', 'r29-actions');
    var newer = el('button', 'ghostbtn');
    newer.type = 'button';
    newer.setAttribute('data-act', 'new-session');
    newer.textContent = '新开一段';
    var rename = el('button', 'ghostbtn');
    rename.type = 'button';
    rename.setAttribute('data-act', 'rename-session');
    rename.setAttribute('data-id', bot.id);
    rename.textContent = '改名';
    actions.append(newer, rename);
    section.append(actions);
    var current = state.sessionNames && state.sessionNames[bot.id];
    section.append(text('p', 'r29-line', current ? ('当前：' + current) : '暂无'));
    section.append(text('p', 'r29-sub', '找旧的'));
    var search = document.createElement('input');
    search.setAttribute('data-r29-find', '');
    search.setAttribute('aria-label', '找旧的');
    search.placeholder = '找旧的';
    search.value = findQuery;
    section.append(search);
    var list = el('div', 'r29-old');
    list.setAttribute('data-r29-old', '');
    section.append(list);
    page.append(section);
    fillOld(list, bot);
  }

  function fillOld(list, bot) {
    if (!list) return;
    list.replaceChildren();
    var query = findQuery.trim();
    var rows = oldSessions(bot).filter(function (item) {
      return !query || String(item.name).indexOf(query) >= 0;
    });
    if (!rows.length) {
      list.append(text('p', 'r29-empty', query ? '没有相符的会话' : '还没有更早的会话'));
      return;
    }
    rows.forEach(function (item) {
      var button = el('button', 'setting-row');
      button.type = 'button';
      button.setAttribute('data-act', 'extra-session');
      button.setAttribute('data-index', String(item.index));
      button.textContent = String(item.name);
      list.append(button);
    });
  }

  function memory(page, bot) {
    var line = memoryLine(bot);
    if (!line) return;
    var section = el('section', 'r29-block');
    section.setAttribute('data-r29-block', 'memory');
    section.append(text('h3', '', '记忆范围'));
    section.append(text('p', 'r29-memory', line));
    page.append(section);
  }

  function permission(page) {
    var section = el('section', 'r29-block r29-permission');
    section.setAttribute('data-r29-block', 'permission');
    var row = el('div', 'r29-row');
    row.append(text('p', 'r29-grow', '权限：' + permissionWord() + '（全家共用）'));
    var link = el('button', 'textbutton');
    link.type = 'button';
    link.setAttribute('data-r29-open-permissions', '');
    link.textContent = '去更多里改';
    row.append(link);
    section.append(row);
    page.append(section);
  }

  // 全家共用的文件版状态，由真实设置钩子读取和重建。
  function mountMirror(host) {
    var section = el('section', 'r29-block');
    section.setAttribute('data-r41-mirror', '');
    var line = text('p', 'r29-line', '任务板文件版：读取中');
    line.setAttribute('role', 'status');
    var button = text('button', 'ghostbtn', '重建一次');
    button.type = 'button';
    button.setAttribute('data-r41-mirror-rebuild', '');
    button.disabled = true;
    section.append(line, button);
    host.append(section);
    var hook = window.HubSettings;
    var busy = false;

    function show(value) {
      var info = value && typeof value === 'object' ? value : {};
      var stamp = info.lastUpdated == null ? NaN : new Date(info.lastUpdated).getTime();
      var when = isFinite(stamp) ? new Date(stamp).toLocaleString('zh-CN', {hour12: false}) : '尚未更新';
      var location = typeof info.dir === 'string' && info.dir ? '在 ' + info.dir + '，' : '';
      var detail = {
        disabled: '已关闭', idle: '等待首次更新', ready: '',
        unavailable: '暂时无法写入', remote: '发现远端配置，已停写'
      };
      var known = Object.prototype.hasOwnProperty.call(detail, info.state);
      line.textContent = '任务板文件版：' + location + '最近更新于 ' + when +
        (known ? (detail[info.state] ? ' · ' + detail[info.state] : '') : ' · 暂时读不到');
      button.disabled = busy || info.enabled === false || info.state === 'remote' ||
        !hook || typeof hook.rebuildMirror !== 'function';
    }

    function load(rebuild) {
      if (busy) return;
      busy = true;
      button.disabled = true;
      button.textContent = rebuild ? '正在重建' : '重建一次';
      Promise.resolve().then(function () {
        return rebuild ? hook.rebuildMirror() : hook.getMirror();
      }).then(function (value) {
        busy = false;
        button.textContent = '重建一次';
        show(value);
      }, function () {
        busy = false;
        button.textContent = '重建一次';
        show(null);
      });
    }

    button.addEventListener('click', function () { load(true); });
    if (!hook || typeof hook.getMirror !== 'function') {
      line.textContent = '任务板文件版：暂无';
      return;
    }
    load(false);
  }

  function paint(host, botId, forceAnswer) {
    var bot = botNow(botId);
    host.replaceChildren();
    ensure();
    if (!bot) {
      host.append(text('p', 'r29-empty', '暂无'));
      return;
    }
    var page = el('div', 'r29-settings');
    page.setAttribute('data-r29-settings-page', '');
    page.setAttribute('data-r29-bot', bot.id);
    identity(page, bot);
    answer(page, bot, forceAnswer);
    sessions(page, bot);
    memory(page, bot);
    permission(page);
    host.append(page);
  }

  function sheetTitle(bot) {
    var name = bot && bot.name ? String(bot.name) : '助理';
    return (typeof esc === 'function' ? esc(name) : name) + '的设置';
  }

  function openSettings() {
    var bot = botNow(state.bot);
    editing = null;
    picking = false;
    findQuery = '';
    if (!bot) {
      toast('暂无');
      return;
    }
    Hub.sheet({
      title: sheetTitle(bot),
      body: function (host) { paint(host, bot.id, false); }
    });
  }

  function saveAnswer(bot, model, effort) {
    var fn = window.HubSettings && HubSettings.setBot;
    if (typeof fn !== 'function') return;
    Promise.resolve(fn(bot.id, {model: model, effort: effort})).then(function () {
      cache = cache && typeof cache === 'object' ? cache : {};
      cache.bots = cache.bots || {};
      cache.bots[bot.id] = Object.assign({}, cache.bots[bot.id], {model: model, effort: effort});
      picking = false;
      redraw();
    }, function () {
      toast('没有保存');
    });
  }

  function onEdit(button) {
    var bot = pageBot(button);
    var kind = button.getAttribute('data-r29-edit');
    if (!bot) return;
    if (kind === 'avatar') {
      var api = window.AssistantProfiles;
      if (!api || typeof api.openLibrary !== 'function') {
        toast('暂无');
        return;
      }
      api.openLibrary(bot.id);
      return;
    }
    if (kind === 'name' || kind === 'duty') {
      editing = kind;
      redraw();
    }
  }

  function onSubmit(form) {
    var bot = pageBot(form);
    var kind = form.getAttribute('data-r29-form');
    var input = form.querySelector('input,textarea');
    var value = input ? input.value.trim() : '';
    var api = window.AssistantProfiles;
    if (!bot || !api || typeof api.propose !== 'function' || typeof api.preview !== 'function') {
      toast('暂无');
      return;
    }
    try {
      var patch = {};
      patch[kind] = value;
      api.preview(api.propose(bot.id, patch));
    } catch (error) {
      toast(error && error.message ? error.message : '没有保存');
    }
  }

  function onModel(button) {
    var bot = pageBot(button);
    if (!bot) return;
    var info = answerOf(bot);
    var model = button.getAttribute('data-r29-model');
    var effort = info.effort;
    var match = info.models.filter(function (item) { return item.name === model; })[0];
    if (match && match.efforts.length && match.efforts.indexOf(effort) < 0) effort = match.efforts[0];
    saveAnswer(bot, model, effort || '');
  }

  function onEffort(button) {
    var bot = pageBot(button);
    if (!bot) return;
    var info = answerOf(bot);
    saveAnswer(bot, info.model || '', button.getAttribute('data-r29-effort') || '');
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var opener = target.closest('[data-r29-settings]');
    if (opener) return;
    var edit = target.closest('[data-r29-edit]');
    if (edit) {
      event.preventDefault();
      onEdit(edit);
      return;
    }
    if (target.closest('[data-r29-cancel]')) {
      event.preventDefault();
      editing = null;
      redraw();
      return;
    }
    var pick = target.closest('[data-r29-pick]');
    if (pick) {
      event.preventDefault();
      picking = !picking;
      redraw();
      return;
    }
    var model = target.closest('[data-r29-model]');
    if (model) {
      event.preventDefault();
      onModel(model);
      return;
    }
    var effort = target.closest('[data-r29-effort]');
    if (effort) {
      event.preventDefault();
      onEffort(effort);
      return;
    }
    var permissions = target.closest('[data-r29-open-permissions]');
    if (permissions) {
      var bot = pageBot(permissions);
      document.dispatchEvent(new CustomEvent('data-r29-open-permissions', {
        bubbles: true,
        detail: {bot: bot ? bot.id : ''}
      }));
    }
  }, true);

  document.addEventListener('r29-settings', function () {
    openSettings();
  });

  document.addEventListener('submit', function (event) {
    var form = event.target && event.target.closest && event.target.closest('[data-r29-form]');
    if (!form) return;
    event.preventDefault();
    onSubmit(form);
  }, true);

  document.addEventListener('input', function (event) {
    var input = event.target;
    if (!input || input.getAttribute && input.getAttribute('data-r29-find') == null) return;
    if (!input.hasAttribute || !input.hasAttribute('data-r29-find')) return;
    findQuery = input.value;
    var page = input.closest('[data-r29-settings-page]');
    var bot = pageBot(input);
    if (page && bot) fillOld(page.querySelector('[data-r29-old]'), bot);
  });

  window.R29Settings = {
    open: openSettings,
    mountMirror: mountMirror,
    profileHTML: function () {
      var host = document.createElement('div');
      paint(host, state.bot, false);
      return host.innerHTML;
    },
    modelHTML: function () {
      var host = document.createElement('div');
      paint(host, state.bot, true);
      var section = host.querySelector('[data-r29-block="answer"]');
      return section ? section.outerHTML : '<p class="muted">暂无</p>';
    }
  };
})();
