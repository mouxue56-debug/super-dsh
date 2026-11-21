/* 改动记录和今天页通知。退回在页内确认，记录随服务重启继续读取。 */
(function () {
  'use strict';
  var NS = window.R43SelfEdit = {};
  var connection = {};
  var labels = {
    draft: '正在改', editing: '正在改', checking: '正在检查', checked: '检查通过', finished: '本轮改动已结束',
    building: '正在打包', restarting: '正在重启', verifying: '正在确认是否正常',
    stable: '正常', healthy: '正常', applied: '正常', normal: '正常',
    rolled_back: '已自动退回', auto_restored: '已自动退回', restored: '已退回',
    awaiting_approval: '等你确认退回', restoring: '正在退回', rolling_back: '正在退回', failed: '需要查看', check_failed: '检查没过',
    restore_point: '改动前的还原点', recovery_failed: '自动恢复没完成，需要救援'
  };
  var running = ['checking', 'building', 'restarting', 'verifying', 'restoring', 'rolling_back'];
  function e(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }
  function clip(value, max) { return String(value == null ? '' : value).slice(0, max); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function real() { return document.documentElement.dataset.hubMode === 'real'; }
  function demoRows() {
    return [
      {id: 'demo-change-3', restorePointId: 'demo-point-3', bot: 'chief', summary: '今天页里的待办更好找',
        createdAt: '2026-11-19T10:30:00+09:00', status: 'stable', fileCount: 2,
        files: [{path: 'js/today-view.js'}, {path: 'css/today.css'}], canRestore: true},
      {id: 'demo-change-2', restorePointId: 'demo-point-2', bot: 'chief', summary: '调整手机上的按钮间距',
        createdAt: '2026-11-18T16:20:00+09:00', status: 'rolled_back', fileCount: 1,
        files: [{path: 'css/layout.css'}], reason: '重启后的检查没有通过，已退回改动前。', canRestore: true},
      {id: 'demo-change-1', restorePointId: 'demo-point-1', bot: 'chief', summary: '让文字更清楚',
        createdAt: '2026-11-17T09:10:00+09:00', status: 'stable', fileCount: 1,
        files: [{path: 'css/type.css'}], canRestore: true}
    ];
  }
  var demos = demoRows();
  function record(row, point) {
    return {
      id: clip(row.id, 160), restorePointId: clip(row.restorePointId || (point ? row.id : ''), 160),
      bot: clip(row.bot || row.actor, 80), summary: clip(row.summary, 400),
      createdAt: row.createdAt || row.at || row.time, status: point ? 'restore_point' : clip(row.status, 40),
      reason: clip(row.reason || row.error, 400), canRestore: row.canRestore !== false,
      files: list(row.files).slice(0, 200),
      fileCount: Number.isInteger(row.fileCount) ? row.fileCount : list(row.files).length
    };
  }
  function nameOf(row) {
    return clip(typeof connection.nameOf === 'function' ? connection.nameOf(row.bot) : '', 40) ||
      (row.bot === 'chief' ? '首席助理' : row.bot || '助理');
  }
  function dateText(value) {
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间暂时读不到' : date.toLocaleString('zh-CN', {hour12: false});
  }
  function button(action, title, disabled) {
    return '<button type="button" data-r43-action="' + action + '"' + (disabled ? ' disabled' : '') +
      '>' + title + '</button>';
  }
  function cardHtml(entry) {
    var row = entry.row, busy = entry.busy || running.indexOf(row.status) >= 0;
    var html = '<article class="r43-selfedit" data-r43-id="' + e(row.id) + '">' +
      (entry.today ? '<span class="r43-kind">助理改了自己</span>' : '') +
      '<h4>' + e(row.summary || '一项改进') + '</h4><p class="r43-meta">' + e(entry.name) + ' · ' +
      e(dateText(row.createdAt)) + '</p><p class="r43-status" role="status">' +
      e(labels[row.status] || '状态暂时读不到') + '</p>';
    if (row.reason) html += '<p class="r43-note">' + e(row.reason) + '</p>';
    html += '<details class="r43-files"><summary>改了哪些文件 · ' + row.fileCount + ' 个</summary><ul>';
    row.files.forEach(function (file) {
      html += '<li>' + e(clip(typeof file === 'string' ? file : file && file.path, 400)) + '</li>';
    });
    html += '</ul></details><div class="r43-actions">';
    if (row.restorePointId && row.canRestore) {
      html += button('restore', entry.approval ? '查看确认卡' : entry.today ? '退回' : '退回到这里', busy);
    }
    if (entry.request) html += button('refresh', '刷新状态', entry.busy);
    html += '</div>';
    if (entry.confirm) {
      html += '<div class="r43-confirm" role="group" aria-label="确认退回"><p>' +
        '会退回到这次改动前，并重启界面。重启时可能暂时断开，请稍等片刻。' +
        '当前版本会另存还原点，可以再退回。' +
        '</p><div class="r43-actions">' + button('confirm', '确认退回') + button('cancel', '先等等') + '</div></div>';
    }
    if (entry.error) html += '<p class="r43-error" role="alert">' + e(entry.error) + '</p>';
    return html + '</article>';
  }
  function paint(entry) {
    var open = entry.host.querySelector('.r43-files[open]');
    entry.host.innerHTML = cardHtml(entry);
    if (open) entry.host.querySelector('.r43-files').open = true;
  }
  function rowsOf(data) {
    var changes = list(data && data.changes).map(function (row) { return record(row); });
    var used = changes.map(function (row) { return row.restorePointId; });
    list(data && data.restorePoints).forEach(function (point) {
      if (used.indexOf(point.id) < 0) changes.push(record(point, true));
    });
    return changes.sort(function (a, b) { return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0); });
  }
  async function refresh(entry) {
    var response = await entry.request('/self-edit/log');
    if (response.status !== 200) throw new Error('暂时读不到最新状态，可以稍后刷新。');
    var row = rowsOf(response.data).find(function (change) { return change.id === entry.row.id; });
    if (!row) throw new Error('暂时找不到这次改动，请重新打开改动记录。');
    entry.row = row;
    paint(entry);
  }
  function poll(entry) {
    if (!entry.host.isConnected || entry.timer || entry.demo || !entry.request) return;
    if (running.indexOf(entry.row.status) < 0) return;
    if (Date.now() > entry.deadline) {
      entry.error = '服务还在重启或暂时连不上。稍后点「刷新状态」查看结果。';
      paint(entry);
      return;
    }
    entry.timer = setTimeout(async function () {
      entry.timer = null;
      if (!entry.host.isConnected) return;
      try { entry.error = ''; await refresh(entry); }
      catch (error) { entry.error = '界面正在重新连接…'; paint(entry); }
      poll(entry);
    }, 1000);
  }
  async function restore(entry) {
    if (entry.busy || running.indexOf(entry.row.status) >= 0) return;
    entry.busy = true; entry.confirm = false; entry.error = ''; paint(entry);
    try {
      if (entry.demo) {
        entry.row.status = 'restoring'; paint(entry);
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
        entry.row.status = 'restored';
        var original = demos.find(function (row) { return row.id === entry.row.id; });
        if (original) original.status = 'restored';
      } else {
        var result = await entry.request('/self-edit/restore/' + encodeURIComponent(entry.row.restorePointId),
          {method: 'POST', body: {}});
        if (result.status < 200 || result.status >= 300) {
          var detail = result.data && result.data.error;
          throw new Error(clip(detail && detail.message || detail, 240) || '退回没完成，请刷新状态后再试。');
        }
        var approval = result.data && (result.data.card || result.data.approval);
        if (!approval || typeof connection.openApproval !== 'function') {
          throw new Error('确认卡暂时打不开，请到今天页的「等你处理」里确认。');
        }
        entry.approval = approval; entry.row.status = 'awaiting_approval';
        await connection.openApproval(approval);
      }
    } catch (error) { entry.error = error.message; }
    finally { entry.busy = false; paint(entry); poll(entry); }
  }
  function mount(entry) {
    entry.deadline = Date.now() + 120000;
    paint(entry);
    entry.host.addEventListener('click', function (event) {
      var node = event.target.closest('[data-r43-action]');
      if (!node || node.disabled) return;
      var action = node.getAttribute('data-r43-action');
      if (action === 'restore') {
        if (!entry.demo) {
          if (entry.approval && typeof connection.openApproval === 'function') {
            void connection.openApproval(entry.approval);
          } else void restore(entry);
          return;
        }
        entry.confirm = true; paint(entry); entry.host.querySelector('[data-r43-action=confirm]').focus();
      } else if (action === 'cancel') { entry.confirm = false; paint(entry); }
      else if (action === 'confirm' && entry.confirm) { void restore(entry); }
      else if (action === 'refresh' && entry.request) {
        entry.error = ''; entry.deadline = Date.now() + 120000;
        refresh(entry).then(function () { poll(entry); }).catch(function (error) {
          entry.error = error.message; paint(entry);
        });
      }
    });
    poll(entry);
  }
  function entryFor(host, row, options) {
    return Object.assign({host: host, row: row, name: nameOf(row), demo: !real(),
      request: real() ? connection.request : null, confirm: false, error: '', busy: false, timer: null}, options);
  }
  function clearEntries(host) {
    list(host.__r43Entries).forEach(function (entry) { clearTimeout(entry.timer); });
    host.__r43Entries = [];
  }
  function renderSettings(host) {
    clearEntries(host);
    host.innerHTML = '<p class="r43-note" role="status">正在读取改动记录…</p>';
    function show(data) {
      if (!host.isConnected) return;
      host.innerHTML = '<h3 class="r43-heading">改动记录</h3><div class="r43-history"></div>';
      var rows = rowsOf(data), container = host.querySelector('.r43-history');
      if (!rows.length) {
        container.textContent = data.enabled === false ? '改自己还没开通，需要 主人 在配置里开。' : '还没有改动记录。';
      }
      rows.forEach(function (row) {
        var item = document.createElement('div'); container.append(item);
        var entry = entryFor(item, row); host.__r43Entries.push(entry); mount(entry);
      });
    }
    if (!real()) { show({changes: demos}); return; }
    if (!connection.request) { host.textContent = '连接还没准备好，请重新打开改动记录。'; return; }
    connection.request('/self-edit/log').then(function (result) {
      if (result.status !== 200) throw new Error('暂时读不到改动记录。');
      show(result.data || {});
    }).catch(function (error) {
      if (!host.isConnected) return;
      host.innerHTML = '<p class="r43-error" role="alert">' + e(error.message) +
        '</p><div class="r43-actions">' + button('retry', '重新读取') + '</div>';
      host.querySelector('button').onclick = function () { renderSettings(host); };
    });
  }
  function add(model, rows, names) {
    if (!model || !model.waiting) return model;
    list(rows).forEach(function (row) {
      if (!row || typeof row.id !== 'string') return;
      var change = record(row);
      model.waiting.available = true;
      model.waiting.items.push({kind: 'self-edit', tag: '助理改了自己', id: change.id, bot: change.bot,
        name: typeof names === 'function' ? names(change.bot) : nameOf(change),
        title: change.summary, selfEdit: change});
    });
    return model;
  }
  function install() {
    var LT = window.R30LT;
    if (LT && !LT.__r43SelfEdit) {
      LT.__r43SelfEdit = true;
      var normalize = LT.normalizeToday, mountToday = LT.mountToday, demoToday = LT.demoToday;
      LT.normalizeToday = function (raw, tickets, names) {
        var model = normalize.apply(this, arguments), source = raw && raw.selfEdit;
        return source && source.available !== false ? add(model, source.items, names) : model;
      };
      LT.demoToday = function () { return add(demoToday.apply(this, arguments), [demos[0]]); };
      LT.mountToday = function (host, model, opts) {
        if (host) clearEntries(host);
        var output = mountToday.apply(this, arguments);
        if (!host) return output;
        host.querySelectorAll('[data-r30l-open]').forEach(function (node) {
          var ref = list(host.__r30Refs)[Number(node.getAttribute('data-r30l-open'))], item = ref && ref.item;
          if (!item || !item.selfEdit) return;
          var entry = entryFor(node.closest('li'), item.selfEdit, {today: true, name: item.name,
            request: real() ? opts && opts.selfEditRequest || connection.request : null});
          host.__r43Entries.push(entry); mount(entry);
        });
        return output;
      };
    }
    if (window.Hub && !NS.settingsInstalled) {
      NS.settingsInstalled = true;
      Hub.registerSettingsPage('r43-selfedit', {title: '改动记录', icon: 'settings', group: '偏好',
        order: 61, render: renderSettings});
    }
  }
  NS.connect = function (options) { connection = options || {}; install(); };
  NS.install = install;
  NS.resetDemo = function () { demos = demoRows(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
