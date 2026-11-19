/* 接力：一件事按顺序经过几位助理，一棒交一棒。
 * 这一份脚本接在看板（js/views/board.js）和今天页（js/r30-ledger-today.js）后面，不改它们：
 *   - 看板卡片：带「接力路线」的卡上显示一排小头像连成线（打勾/高亮/灰着）；
 *   - 点开卡：一条竖着的接力时间线，每一棒有头像、名字、做什么、状态、用时，交接说明可展开；
 *     停在「等你」的卡在这里放行或退回；卡住的卡在这里回答；
 *   - 新建卡：可选「接力」，依次点选几位排成路线（最少两位），每棒一句要做什么，也有四条现成路线一键套用；
 *   - 今天页「等你处理」里出现「接力停在你这里」；
 *   - 演示模式：两条演示接力（运营类、开发类）自动往前走，每 3.6 秒一步，可重播；首页助理格子上写「在跑接力第 N 棒」。
 * 真实模式里数据来自后端卡上的 relay 字段；没有 relay 的卡完全不受影响。
 * 对外：window.R32Relay。 */
(function () {
  'use strict';
  if (window.R32Relay) return;
  var NS = window.R32Relay = {};

  /* ---------- 小工具 ---------- */
  function e(value) { return typeof esc === 'function' ? esc(value) : String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function clip(value, n) { return Array.from(String(value == null ? '' : value)).slice(0, n).join(''); }
  function real() { try { return document.documentElement.dataset.hubMode === 'real'; } catch (x) { return false; } }
  function wrap(name, make) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__r32) return;
    var next = make(orig);
    next.__r32 = true;
    window[name] = next;
  }
  function say(text) { try { if (typeof toast === 'function') toast(text); } catch (x) {} }
  function span(ms) {
    if (!isFinite(ms) || ms < 0) return '';
    var m = Math.round(ms / 60000);
    if (m < 1) return '不到 1 分钟';
    if (m < 60) return m + ' 分钟';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时' + (m % 60 ? ' ' + (m % 60) + ' 分' : '');
    return Math.floor(h / 24) + ' 天' + (h % 24 ? ' ' + (h % 24) + ' 小时' : '');
  }
  function iso(ts) { var t = Date.parse(ts); return isFinite(t) ? t : null; }

  /* ---------- 路线数据 → 界面要用的模型 ---------- */
  var WORD = {waiting: '还没轮到', active: '正在做', gate: '等你', stuck: '卡住了', done: '已交回', failed: '做不了'};
  function personOf(who) {
    if (!who) return null;
    var actor = typeof r29DeskActor === 'function' ? r29DeskActor(who.name, who.type === 'owner' ? 'owner' : who.type) : null;
    return actor && typeof r29DeskPerson === 'function' ? r29DeskPerson(actor) : {id: who.name, key: who.name, name: who.name, roster: false};
  }
  var lastCurrent = {};
  var passAt = {};
  /* relay：卡上的 relay 对象；ctx：{id, now, fromWill}。 */
  NS.model = function (relay, ctx) {
    ctx = ctx || {};
    var now = ctx.now || Date.now();
    var steps = (relay.steps || []).map(function (s, i) {
      var started = iso(s.startedAt), delivered = iso(s.deliveredAt);
      var spent = null;
      if (s.status === 'done' && started != null && delivered != null) spent = delivered - started;
      else if (['active', 'stuck'].indexOf(s.status) >= 0 && started != null) spent = now - started;
      return {n: i + 1, person: personOf(s.who), owner: !!s.who && s.who.type === 'owner', task: s.task || '', doneWhen: s.doneWhen || '',
        status: s.status, note: s.note || '', noteBy: s.noteBy || '', question: s.question || '', returned: s.returnedNote || '',
        gate: !!s.gate, spent: spent, stalled: !!s.stalledAt && ['active'].indexOf(s.status) >= 0, stalledMin: Number(s.stalledMin) > 0 ? Number(s.stalledMin) : 30};
    });
    var phase = relay.phase;
    var current = typeof relay.current === 'number' ? relay.current : 0;
    var done = steps.filter(function (s) { return s.status === 'done'; }).length;
    var key = ctx.id || '';
    if (key) {
      if (lastCurrent[key] != null && current > lastCurrent[key]) passAt[key] = {from: lastCurrent[key], ts: Date.now()};
      lastCurrent[key] = current;
    }
    var pass = key && passAt[key] && Date.now() - passAt[key].ts < 2600 ? passAt[key].from : -1;
    return {phase: phase, current: current, total: steps.length, steps: steps, done: done, pass: pass, fromWill: !!ctx.fromWill,
      id: key, initiator: ctx.initiator || null, halted: phase === 'halted'};
  };
  function nameOf(step) { return step.owner ? '你' : (step.person ? step.person.name : '谁'); }
  /* 一句话：现在到哪了。只用卡里的数字和名字，不复述任务文字。 */
  NS.line = function (m) {
    var s = m.steps[m.current];
    if (m.phase === 'done') return '接力走完了，已完成';
    if (m.phase === 'final') return m.fromWill ? '接力走完了，等你验收' : '接力走完了，等总验收';
    if (m.phase === 'gate') return s && s.owner ? '接力停在你这里 · 第 ' + s.n + ' 棒' : '接力停在你这里 · 第 ' + (s ? s.n : m.current + 1) + ' 棒做完了';
    if (m.phase === 'stuck') return '第 ' + (s ? s.n : m.current + 1) + ' 棒/共 ' + m.total + ' 棒卡住了 · ' + (s ? nameOf(s) : '');
    if (m.phase === 'failed') return '第 ' + (s ? s.n : m.current + 1) + ' 棒做不了';
    if (m.phase === 'halted') return '接力停在这里 · 第 ' + (s ? s.n : m.current + 1) + ' 棒的人已停用';
    if (s && s.stalled && m.phase === 'running') return '第 ' + s.n + ' 棒/共 ' + m.total + ' 棒 · ' + nameOf(s) + '没动静';
    return '第 ' + (s ? s.n : m.current + 1) + ' 棒/共 ' + m.total + ' 棒 · ' + (s ? nameOf(s) : '') + '在做';
  };
  /* 这一行在看板上落在哪一列（演示里用；真实模式里列由后端状态算）。 */
  NS.col = function (m) {
    if (m.phase === 'done') return 'done';
    if (m.phase === 'final') return 'review';
    if (m.phase === 'gate' || m.phase === 'stuck' || m.phase === 'failed' || m.phase === 'halted') return 'attention';
    return 'progress';
  };

  /* ---------- 卡片上的进度条：一排小头像连成线 ---------- */
  var CHECK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.4l2.3 2.3 4.5-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function nodeClass(m, s, i) {
    if (s.status === 'done') return 'is-done';
    if (m.phase === 'gate' && i === m.current) return 'is-gate';
    if (s.status === 'stuck' || (m.phase === 'stuck' && i === m.current)) return 'is-stuck';
    if (m.phase === 'halted' && i === m.current) return 'is-stuck';
    if (s.stalled && m.phase === 'running' && i === m.current) return 'is-stuck';
    if (s.status === 'failed') return 'is-stuck';
    if (s.status === 'gate') return 'is-gate';
    if (s.status === 'active' && m.phase === 'running') return 'is-now';
    return 'is-wait';
  }
  function faceHtml(step, px) {
    if (step.owner) return '<span class="r32-me" style="--r32-px:' + px + 'px" role="img" aria-label="你">你</span>';
    return step.person && typeof r29DeskFace === 'function' ? r29DeskFace(step.person, px) : '';
  }
  NS.stripHtml = function (m) {
    var px = m.total > 6 ? 20 : m.total > 5 ? 22 : 26;
    var html = '';
    m.steps.forEach(function (s, i) {
      var cls = nodeClass(m, s, i);
      if (i > 0) {
        var linkDone = m.steps[i - 1].status === 'done';
        html += '<li class="r32-link' + (linkDone ? ' is-done' : '') + (m.pass === i - 1 ? ' is-pass' : '') + '" aria-hidden="true"><i></i></li>';
      }
      html += '<li class="r32-node ' + cls + '" style="--r32-px:' + px + 'px" title="第 ' + s.n + ' 棒 · ' + e(nameOf(s)) + '（' + e(WORD[s.status] || '') + '）">' +
        '<span class="r32-face">' + faceHtml(s, px) + '</span>' +
        (cls === 'is-done' ? '<b class="r32-tick">' + CHECK + '</b>' : '') +
        (cls === 'is-gate' ? '<b class="r32-tick r32-ask-dot" aria-hidden="true">!</b>' : '') + '</li>';
    });
    var label = '接力进度：共 ' + m.total + ' 棒，' + NS.line(m);
    return '<div class="r32-strip' + (m.phase === 'done' ? ' is-finished' : '') + '"' + (m.total > 5 ? ' data-many' : '') + ' data-r32-strip role="img" aria-label="' + e(label) + '">' +
      '<ol class="r32-nodes">' + html + '</ol></div>';
  };

  /* ---------- 点开卡：竖着的接力时间线 ---------- */
  var openNotes = {};
  NS.timelineHtml = function (row) {
    var m = row.relay;
    var html = '';
    m.steps.forEach(function (s, i) {
      var cls = nodeClass(m, s, i);
      var chip = s.status === 'gate' || cls === 'is-gate' ? '等你' : m.phase === 'halted' && i === m.current ? '已停用' : s.stalled && i === m.current ? '没动静' : WORD[s.status] || '';
      var time = s.spent != null && s.spent >= 0 ? (s.status === 'done' ? '用时 ' : '已做 ') + span(s.spent) : '';
      var nk = row.id + ':' + s.n;
      var note = s.note ? '<details class="r32-note" data-r32-note="' + e(nk) + '"' + (openNotes[nk] ? ' open' : '') + '><summary>交接说明' +
        (s.noteBy ? ' · ' + e(s.noteBy === 'owner' ? '你' : (typeof botBy === 'function' && botBy(s.noteBy) ? botBy(s.noteBy).name : s.noteBy)) : '') +
        '</summary><p>' + e(s.note) + '</p></details>' : '';
      var extra = '';
      if (s.returned) extra += '<p class="r32-ret">被退回：' + e(s.returned) + '</p>';
      if (s.question && s.status !== 'stuck') extra += '<p class="r32-time">问过：' + e(s.question) + '</p>';
      html += '<li class="r32-step ' + cls + '"><span class="r32-rail" aria-hidden="true"><span class="r32-dot" style="--r32-px:30px"><span class="r32-face">' + faceHtml(s, 30) + '</span>' +
        (cls === 'is-done' ? '<b class="r32-tick">' + CHECK + '</b>' : '') + '</span></span>' +
        '<div class="r32-body"><div class="r32-head"><strong>第 ' + s.n + ' 棒 · ' + e(nameOf(s)) + '</strong><em class="r32-chip">' + e(chip) + '</em></div>' +
        '<p class="r32-task">' + e(s.task) + '</p>' + (s.doneWhen ? '<p class="r32-when">做到：' + e(s.doneWhen) + '</p>' : '') +
        (time ? '<p class="r32-time">' + e(time) + '</p>' : '') + extra + note + '</div></li>';
    });
    var tail = '';
    if (m.phase === 'final') tail = '<li class="r32-step r32-end"><span class="r32-rail" aria-hidden="true"><span class="r32-flag">★</span></span><div class="r32-body"><strong>' +
      (m.fromWill ? '走完了，等你验收' : '走完了，等发起人总验收') + '</strong></div></li>';
    if (m.phase === 'done') tail = '<li class="r32-step r32-end is-done"><span class="r32-rail" aria-hidden="true"><span class="r32-flag">✓</span></span><div class="r32-body"><strong>已完成</strong></div></li>';
    return '<section class="r32-tl-wrap" aria-label="接力时间线"><h3>接力路线 · 共 ' + m.total + ' 棒</h3><ol class="r32-tl">' + html + tail + '</ol></section>';
  };

  /* 同一张卡、同一个关口（阶段 + 当前棒）上，请求还没回之前不再发第二次。回执之后再画按钮。 */
  var gateFlight = {};
  var PICK_LOST = '刚才选的人已经不在了，请重新选一位';
  function gateToken(row) {
    var m = row && row.relay;
    if (!row || !m) return '';
    return String(row.id) + '\n' + String(m.phase || '') + ':' + String(m.current);
  }
  function gateBusy(row) { var token = gateToken(row); return !!(token && gateFlight[token]); }
  function markGateBusy(row) {
    var node = document.getElementById('r30-sheet');
    var box = node && node.querySelector('.r32-ask');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) { b.disabled = true; });
  }
  /* 重绘只记得输入框。换人下拉要单独收回来；人选已经不在名单里时，不许悄悄落回第一项。 */
  function restoreWho(picked) {
    if (!r30Sheet) return;
    var node = document.getElementById('r30-sheet');
    if (!node) return;
    var el = node.querySelector('select[name="r32who"]');
    if (!el) { r30Sheet.r32PickLost = ''; return; }
    function has(v) { return Array.prototype.some.call(el.options, function (o) { return o.value === v; }); }
    function clearLost() {
      r30Sheet.r32PickLost = '';
      if (r30Sheet.flash !== PICK_LOST) return;
      r30Sheet.flash = '';
      var flash = node.querySelector('.r30-flash');
      if (flash) flash.textContent = '';
    }
    if (picked && has(picked)) { el.value = picked; if (r30Sheet.r32PickLost) clearLost(); return; }
    if (!picked && r30Sheet.r32PickLost && has(r30Sheet.r32PickLost)) { el.value = r30Sheet.r32PickLost; clearLost(); return; }
    if (!picked && !r30Sheet.r32PickLost) return;
    if (picked && r30Sheet.r32PickLost !== picked) say(PICK_LOST);
    if (picked) r30Sheet.r32PickLost = picked;
    if (!has('')) {
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '请重新选择';
      el.insertBefore(blank, el.firstChild);
    }
    el.value = '';
    r30Sheet.flash = PICK_LOST;
    var flash = node.querySelector('.r30-flash');
    if (flash) flash.textContent = PICK_LOST;
  }

  /* ---------- 卡上主人的动作 ---------- */
  /* 给这一棒换人：下拉里是在用的助理和外部身份（外部的带「外部」字样），不含自己和「你」。 */
  function swapHtml(row, s, label) {
    var cur = s.person ? s.person.key : '';
    var list = (typeof r30People === 'function' ? r30People([row]) : []).filter(function (p) { return p && p.type !== 'owner' && p.key !== cur; });
    if (!list.length) return '<p class="r32-hint">没有别的人可以接了。</p>';
    return '<div class="r30-form" data-r30-form><label>换给谁<select name="r32who">' + list.map(function (p) {
      return '<option value="' + e(p.id) + '">' + e(p.type === 'external' ? '外部 · ' + String(p.id) : p.name) + '</option>';
    }).join('') + '</select></label></div>' +
      '<div class="r30-row"><button type="button" data-r32-act="reassign" data-r32-id="' + e(row.id) + '"' + ((row.locked || gateBusy(row)) ? ' disabled' : '') + '>' + e(label) + '</button></div>';
  }
  NS.ownerHtml = function (row) {
    var m = row.relay;
    var s = m.steps[m.current];
    var id = e(row.id);
    var locked = (row.locked || gateBusy(row)) ? ' disabled' : '';
    if (m.phase === 'halted' && s) {
      return '<section class="r32-ask is-stuck" role="group" aria-label="接力停在这里"><strong>接力停在这里</strong><p>第 ' + s.n + ' 棒的 ' + e(nameOf(s)) +
        ' 已停用，换个人接？</p>' + swapHtml(row, s, '换人，继续') + '</section>';
    }
    if (m.phase === 'running' && s && s.stalled) {
      return '<section class="r32-ask is-stuck" role="group" aria-label="这一棒没动静"><strong>这一棒 ' + s.stalledMin + ' 分钟没动静</strong><p>第 ' + s.n + ' 棒（' +
        e(nameOf(s)) + '）被叫醒后一直没有进度，也没有交回。不会自动重叫、也不会自动换人，你来定。</p>' +
        '<div class="r30-row"><button type="button" class="r30-primary" data-r32-act="rewake" data-r32-id="' + id + '"' + locked + '>再叫一次</button></div>' +
        swapHtml(row, s, '换人') + '</section>';
    }
    if (m.phase === 'gate' && s) {
      var mine = s.owner;
      var last = !mine && s.n === m.total && m.fromWill;
      return '<section class="r32-ask" role="group" aria-label="接力停在你这里"><strong>接力停在你这里</strong><p>' +
        (mine ? '第 ' + s.n + ' 棒要你来：' + e(s.task) : '第 ' + s.n + ' 棒（' + e(nameOf(s)) + '）做完了，等你看一眼再放行。') + '</p>' +
        '<div class="r30-form" data-r30-form><label>想说的话（可以不写；退回时会带给这一棒）<textarea name="r32note" rows="2" maxlength="300"></textarea></label></div>' +
        '<div class="r30-row"><button type="button" class="r30-primary" data-r32-act="release" data-r32-id="' + id + '"' + locked + '>' + (mine ? '我看过了，放行' : last ? '放行，标完成' : '放行，交给下一棒') + '</button>' +
        (mine ? '' : '<button type="button" data-r32-act="redo" data-r32-id="' + id + '"' + locked + '>退回重做</button>') + '</div></section>';
    }
    if (m.phase === 'stuck' && s) {
      return '<section class="r32-ask is-stuck" role="group" aria-label="这一棒卡住了"><strong>第 ' + s.n + ' 棒卡住了</strong><p>' + e(nameOf(s)) + ' 问：' +
        e(s.question || '（没写问题）') + '</p>' +
        '<div class="r30-form" data-r30-form><label>你的回答<textarea name="r32note" rows="2" maxlength="300"></textarea></label></div>' +
        '<div class="r30-row"><button type="button" class="r30-primary" data-r32-act="answer" data-r32-id="' + id + '"' + locked + '>回答，让它继续</button></div></section>';
    }
    if (m.phase === 'final' && m.fromWill) {
      return '<section class="r32-ask is-done" role="group" aria-label="接力走完了"><strong>接力走完了</strong><p>每一棒都交回了，等你验收。</p>' +
        '<div class="r30-row"><button type="button" class="r30-primary" data-r32-act="finish" data-r32-id="' + id + '"' + locked + '>验收，标完成</button></div></section>';
    }
    return '';
  };

  /* ---------- 动作：真实模式落后端，演示模式改本地 ---------- */
  NS.act = function (id, action, text, who) {
    var row = typeof r30Row === 'function' ? r30Row(id) : null;
    if (!row || !row.relay) return Promise.resolve(false);
    var token = gateToken(row);
    if (token && gateFlight[token]) return Promise.resolve(false);
    if (token) gateFlight[token] = true;
    function settle() { if (token) delete gateFlight[token]; }
    if (!real()) {
      var ok = false;
      try { ok = NS.demoAct(id, action, text); }
      finally { settle(); }
      if (typeof r29DeskPaint === 'function') r29DeskPaint();
      NS.patchHome();
      return Promise.resolve(ok);
    }
    markGateBusy(row);
    var keep = Object.assign({}, row);
    var payload = action === 'finish' ? {column: 'done'} : {action: action, text: clip(text, 300)};
    if (action === 'reassign') payload.who = who;
    var kind = action === 'finish' ? 'move' : 'relay';
    var sent = r30Send(kind, id, payload).then(function (ticket) { settle(); return ticket; }, function (err) { settle(); throw err; });
    return r30Done(sent, function () {
      var at = r29DeskRows.indexOf(row);
      if (at >= 0) r29DeskRows[at] = keep;
      say('没改成，卡还是原来的样子');
    });
  };

  /* ---------- 接上看板：包一层，不改原文件 ---------- */
  function install() {
    if (typeof r29DeskFromTicket !== 'function' || typeof r30CardHtml !== 'function') return false;
    wrap('r29DeskFromTicket', function (orig) {
      return function (ticket) {
        var row = orig(ticket);
        if (row && ticket && ticket.relay && typeof ticket.relay === 'object' && Array.isArray(ticket.relay.steps)) {
          var m = NS.model(ticket.relay, {id: ticket.id, fromWill: !!ticket.from && ticket.from.type === 'owner',
            initiator: ticket.from && ticket.from.name});
          row.relay = m;
          row.line = NS.line(m);
          m.steps.forEach(function (s) {
            if (s.person && !(row.people || []).some(function (p) { return p && p.key === s.person.key; })) (row.people = row.people || []).push(s.person);
          });
        }
        return row;
      };
    });
    wrap('r30CardHtml', function (orig) {
      return function (row, phone) {
        var html = orig(row, phone);
        if (!row || !row.relay) return html;
        var strip = NS.stripHtml(row.relay);
        html = html.replace('<article class="', '<article data-r32-card class="');
        var at = html.indexOf('<time class="r29-desk-time"');
        if (at < 0) at = html.lastIndexOf('</article>');
        return html.slice(0, at) + strip + html.slice(at);
      };
    });
    wrap('r30FaceButton', function (orig) {
      return function (row, px) {
        if (!row || !row.relay) return orig(row, px);
        var who = row.assignee;
        var face = who ? r29DeskFace(who, px || 32) : '';
        return '<span class="r30-face is-static" aria-hidden="true">' + face + '</span>';
      };
    });
    wrap('r30ActionsHtml', function (orig) {
      return function (row) {
        var html = orig(row);
        if (!row || !row.relay) return html;
        var at = html.indexOf('<h3>标题和说明</h3>');
        var tail = at >= 0 ? html.slice(at) : '</div>';
        return '<div class="r30-actions r32-actions">' + NS.ownerHtml(row) + NS.timelineHtml(row) + tail;
      };
    });
    wrap('r30DetailHtml', function (orig) { return function (row) { return row && row.relay ? '' : orig(row); }; });
    wrap('r29DeskDetail', function (orig) {
      return function (rows) {
        var row = (rows || []).filter(r29DeskMatch).find(function (item) { return item.id === r29DeskPick; });
        if (!row || !row.relay) return orig(rows);
        return '<div class="r29-desk-detail"><h2>' + e(row.title) + '</h2><p>' + e(row.line) + '</p></div>' + r30ActionsHtml(row);
      };
    });
    ['r30Move', 'r30Assign'].forEach(function (name) {
      wrap(name, function (orig) {
        return function (id) {
          var row = typeof r30Row === 'function' ? r30Row(id) : null;
          if (row && row.relay) {
            say(name === 'r30Move' ? '接力的卡跟着接力自己走，不能手动挪列' : '接力里换人要改路线，这里不能直接换');
            return Promise.resolve(false);
          }
          return orig.apply(this, arguments);
        };
      });
    });
    wrap('r29DeskDemoRows', function (orig) {
      return function () { return orig().concat(NS.demoRows()); };
    });
    /* 板头：演示模式放一个不起眼的「重播」。 */
    ['r29DeskBar', 'r30PhoneBoard'].forEach(function (name) {
      wrap(name, function (orig) {
        return function () {
          var html = orig.apply(this, arguments);
          if (real() || !NS.demoActive()) return html;
          return html.replace('<button type="button" class="r30-new" data-r30-new>',
            '<button type="button" class="r32-replay" data-r32-replay title="把演示接力从头再走一遍">↻ 重播</button><button type="button" class="r30-new" data-r30-new>');
        };
      });
    });
    wrap('r30NewHtml', function (orig) { return function () { return NS.newHtml(orig()); }; });
    wrap('r30SheetRender', function (orig) {
      return function () {
        var node = document.getElementById('r30-sheet');
        var prev = node && node.querySelector('select[name="r32who"]');
        var picked = prev ? prev.value : '';
        orig.apply(this, arguments);
        restoreWho(picked);
      };
    });
    return true;
  }

  /* ---------- 新建：接力 ---------- */
  var TEMPLATES = [
    {name: '活动筹备', title: '筹备一场活动', goal: '把一场活动从资料、方案、视觉到排期一路办起来。', steps: [
      {ids: ['research'], names: ['调研'], task: '查资料：往年同类活动怎么办、预算大概多少'},
      {ids: ['content'], names: ['整理', '内容'], task: '写活动方案：流程、分工、物料清单'},
      {ids: ['art'], names: ['设计', '艺术'], task: '出海报和现场视觉'},
      {ids: ['pm'], names: ['协调', '项目'], task: '排出时间表和分工，标好谁负责哪一块'}]},
    {name: '客户询问', title: '回复一位客户的询问', goal: '把客户的问题弄清楚、查准资料、拟好回复，由你看过再发。', steps: [
      {ids: ['pm'], names: ['协调', '客服'], task: '整理客户的问题和诉求，列清楚要回答什么'},
      {ids: ['research'], names: ['调研'], task: '查相关资料，给出准确的依据'},
      {ids: ['writer', 'content'], names: ['写作', '内容'], task: '拟一份回复：礼貌、清楚、不夸大'},
      {owner: true, task: '看一眼再发出去'}]},
    {name: '周报', title: '本周周报', goal: '各助理把本周做完的事汇总起来，合成一份周报，你看过再发。', steps: [
      {ids: ['research'], names: ['调研'], task: '汇总调研这边本周做完的事'},
      {ids: ['writer'], names: ['写作'], task: '汇总写作这边本周做完的事'},
      {chief: true, task: '把各家的汇总合并成一份周报'},
      {owner: true, task: '看一眼再发出去'}]},
    {name: '功能开发', title: '做一个新功能', goal: '写方案、写代码、检查、验收，按顺序一棒一棒来。', steps: [
      {ids: ['writer', 'content'], names: ['写作', '整理'], task: '写方案：要做什么、怎么做、做到什么算完'},
      {ids: ['content', 'pm'], names: ['整理', '协调'], task: '照方案写代码，做出能用的东西'},
      {ids: ['research'], names: ['调研'], task: '检查：对照方案逐条查，列出没做到的'},
      {owner: true, task: '验收：看过没问题就放行'}]}
  ];
  NS.templates = TEMPLATES;
  function ownerPerson() { return {id: 'owner', key: 'ext:owner:owner', name: '你', roster: false, type: 'owner'}; }
  function bots() { return (state && state.bots ? state.bots : []).filter(function (b) { return b && b.id && !b.steward && !b.parent && b.enabled !== false; }); }
  function resolveSlot(slot) {
    if (slot.owner) return ownerPerson();
    var list = bots();
    var hit = null;
    if (slot.chief) hit = list.filter(function (b) { return b.role === 'chief'; })[0];
    (slot.ids || []).forEach(function (id) { if (!hit) hit = list.filter(function (b) { return b.id === id; })[0]; });
    (slot.names || []).forEach(function (kw) { if (!hit) hit = list.filter(function (b) { return String(b.name || '').indexOf(kw) >= 0; })[0]; });
    return hit ? {id: hit.id, key: hit.id, name: hit.name || hit.id, roster: true, type: 'assistant'} : null;
  }
  function plainName(p) { return String(p && p.name || '').replace(/^外部 · /, ''); }
  function sheetState() {
    if (!r30Sheet) return null;
    if (!r30Sheet.r32) r30Sheet.r32 = {on: false, steps: [], flash: ''};
    return r30Sheet.r32;
  }
  function stepRowHtml(st, i, total) {
    var p = st.person;
    var face = p ? (p.type === 'owner' ? '<span class="r32-me" style="--r32-px:32px">你</span>' : r29DeskFace(p, 32)) : '<span class="r30-face-empty" aria-hidden="true">？</span>';
    return '<li class="r32-build-row"><span class="r32-n" aria-hidden="true">' + (i + 1) + '</span>' + face +
      '<div class="r32-build-main"><strong>' + e(p ? plainName(p) : '待选') + '</strong>' + (p && p.type === 'external' ? '<em class="r32-ext">外部</em>' : '') +
      '<textarea data-r32-task="' + i + '" rows="2" maxlength="120" placeholder="这一棒要做什么" aria-label="第 ' + (i + 1) + ' 棒要做什么">' + e(st.task) + '</textarea>' +
      (p && p.type !== 'owner' ? '<label class="r32-gate"><input type="checkbox" data-r32-gate="' + i + '"' + (st.gate ? ' checked' : '') + '><span>做完要我看一眼再往下</span></label>' : '') +
      '</div><button type="button" class="r32-del" data-r32-del="' + i + '" aria-label="去掉第 ' + (i + 1) + ' 棒">✕</button></li>';
  }
  NS.newHtml = function (html) {
    var st = sheetState();
    if (!st) return html;
    var at = html.indexOf('<div class="r30-actions">');
    if (at < 0) return html;
    var toggle = '<div class="r32-mode" role="group" aria-label="交办方式"><button type="button" data-r32-mode="single" aria-pressed="' + (!st.on) +
      '" class="' + (!st.on ? 'is-on' : '') + '">一个人做</button><button type="button" data-r32-mode="relay" aria-pressed="' + st.on +
      '" class="' + (st.on ? 'is-on' : '') + '">接力：几位按顺序</button></div>';
    var head = html.slice(0, at);
    if (!st.on) return head + toggle + html.slice(at);
    var tpl = '<div class="r32-tpls" role="group" aria-label="现成路线">' + TEMPLATES.map(function (t, i) {
      return '<button type="button" class="r32-tpl" data-r32-tpl="' + i + '"><b>' + e(t.name) + '</b><small>' +
        e(t.steps.map(function (s) { var p = resolveSlot(s); return p ? p.name.replace(/助理$/, '') : '？'; }).join(' → ')) + '</small></button>';
    }).join('') + '</div>';
    var people = (typeof r30People === 'function' ? r30People(r29DeskCurrent()) : []).concat([ownerPerson()]);
    var pick = '<div class="r30-people r32-pick" role="group" aria-label="点谁，谁接下一棒">' + people.map(function (p) {
      return '<button type="button" class="r30-who" data-r32-add="' + e(p.key) + '">' + (p.type === 'owner' ? '<span class="r32-me" style="--r32-px:32px">你</span>' : r29DeskFace(p, 32)) +
        '<span>' + (p.type === 'owner' ? '你来看一眼' : e(plainName(p))) + '</span>' + (p.type === 'external' ? '<em class="r32-ext">外部</em>' : '') + '</button>';
    }).join('') + '</div>';
    var ok = st.steps.length >= 2 && st.steps.every(function (s) { return s.person; });
    var route = st.steps.length ? '<ol class="r32-build">' + st.steps.map(function (s, i) { return stepRowHtml(s, i, st.steps.length); }).join('') + '</ol>' :
      '<p class="r32-hint">还没有人。点下面的一条现成路线，或一位一位点选（最少两位）。</p>';
    var body = '<div class="r30-actions r32-new"><h3>现成路线，点一下套用</h3>' + tpl + '<h3>路线：一棒交一棒</h3>' + route +
      '<h3>' + (st.steps.length ? '再加一棒，点谁谁接' : '一位一位点选，排成路线') + '</h3>' + pick +
      '<p class="r32-hint">每棒做完会自动交给下一棒；最后一棒做完，会叫首席做总验收。</p>' +
      '<div class="r30-row"><button type="button" class="r30-primary" data-r32-go' + (r30Sheet.busy ? ' disabled' : '') + (ok ? '' : ' aria-disabled="true"') +
      '>发起接力' + (st.steps.length ? '（' + st.steps.length + ' 棒）' : '') + '</button><button type="button" data-r30-close>取消</button></div></div>';
    return head + toggle + body;
  };
  function applyTemplate(i) {
    var st = sheetState();
    var t = TEMPLATES[i];
    if (!st || !t) return;
    st.steps = t.steps.map(function (s) { return {person: resolveSlot(s), task: s.task, gate: false}; });
    var form = document.querySelector('#r30-sheet [data-r30-form] [name=title]');
    if (form && !String(form.value).trim()) form.value = t.title;
    var goal = document.querySelector('#r30-sheet [data-r30-form] [name=goal]');
    if (goal && !String(goal.value).trim()) goal.value = t.goal;
    r30SheetRender();
  }
  /* 输入框还聚焦着时，操作单不会重画（防止打字被打断）；要给提示就先让它失焦。 */
  function deny(text) {
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (x) {}
    r30Flash(text);
    say(text);
  }
  function createRelay() {
    var st = sheetState();
    if (!st || r30Sheet.busy) return;
    var form = document.querySelector('#r30-sheet [data-r30-form]');
    var title = String(document.querySelector('#r30-sheet [name=title]').value || '').trim();
    var goal = String(document.querySelector('#r30-sheet [name=goal]').value || '').trim();
    if (!title) { deny('先写个标题'); return; }
    if (st.steps.length < 2) { deny('接力最少要两位'); return; }
    if (st.steps.some(function (s) { return !s.person; })) { deny('有一棒还没选人，点上面的人补上'); return; }
    if (st.steps[0].person.type === 'owner') { deny('第 1 棒要有人先动手，「你来看一眼」放后面'); return; }
    var steps = st.steps.map(function (s) {
      return {who: s.person.type === 'owner' ? 'owner' : s.person.id, task: clip(s.task, 120).trim() || '按卡上的说明做你这一棒', gate: !!s.gate};
    });
    var sheetNow = r30Sheet;
    sheetNow.busy = true;
    r30SheetRender();
    var done = function (ok) {
      sheetNow.busy = false;
      if (ok) { if (r30Sheet === sheetNow) r30CloseSheet(); say('接力发起了，第 1 棒已交给' + st.steps[0].person.name); }
      else if (r30Sheet === sheetNow) { r30SheetRender(); r30Flash('没建成，稿子还在，请再试一次'); }
    };
    if (!real()) {
      NS.demoCreate(title, goal || title, steps.map(function (s, i) { return {person: st.steps[i].person, task: s.task, gate: s.gate}; }));
      done(true);
      return;
    }
    r30Done(r30Send('create', '', {title: title, goal: goal || title, relay: {steps: steps}}), function () {}).then(done);
  }

  /* ---------- 点击 ---------- */
  function onClick(event) {
    var t = event.target && event.target.closest ? event.target : null;
    if (!t) return;
    var node = t.closest('[data-r32-mode],[data-r32-tpl],[data-r32-add],[data-r32-del],[data-r32-go],[data-r32-act],[data-r32-replay]');
    if (!node) return;
    var st;
    if (node.hasAttribute('data-r32-replay')) { NS.replay(); return; }
    if (node.hasAttribute('data-r32-act')) {
      var id = node.getAttribute('data-r32-id');
      var action = node.getAttribute('data-r32-act');
      var box = node.closest('.r32-ask');
      var field = box && box.querySelector('[name=r32note]');
      var text = field ? field.value : '';
      var pick = box && box.querySelector('[name=r32who]');
      var who = pick ? pick.value : '';
      if (action === 'answer' && !String(text).trim()) { say('先写一句回答'); return; }
      if (action === 'reassign' && !who) { say('先选一位来接'); return; }
      NS.act(id, action, text, who).then(function (ok) {
        if (!ok) return;
        var after = typeof r30Row === 'function' ? r30Row(id) : null;
        var finished = after && after.relay && after.relay.phase === 'done';
        say(action === 'release' ? (finished ? '已放行，接力完成' : '已放行，交给下一棒') : action === 'redo' ? '已退回，这一棒重做' :
          action === 'answer' ? '已回答，接力继续' : action === 'rewake' ? '已再叫一次' : action === 'reassign' ? '已换人，接力继续' : '已验收，标完成');
      });
      return;
    }
    st = sheetState();
    if (!st) return;
    if (node.hasAttribute('data-r32-mode')) { st.on = node.getAttribute('data-r32-mode') === 'relay'; r30SheetRender(); return; }
    if (node.hasAttribute('data-r32-tpl')) { applyTemplate(Number(node.getAttribute('data-r32-tpl'))); return; }
    if (node.hasAttribute('data-r32-add')) {
      var key = node.getAttribute('data-r32-add');
      var list = (typeof r30People === 'function' ? r30People(r29DeskCurrent()) : []).concat([ownerPerson()]);
      var person = list.filter(function (p) { return p.key === key; })[0];
      if (!person) return;
      if (st.steps.length >= 8) { deny('最多 8 棒'); return; }
      if (person.type === 'owner' && !st.steps.length) { deny('第 1 棒要有人先动手，先点一位助理'); return; }
      var empty = st.steps.filter(function (s) { return !s.person; })[0];
      if (empty) empty.person = person; else st.steps.push({person: person, task: '', gate: false});
      r30SheetRender();
      return;
    }
    if (node.hasAttribute('data-r32-del')) { st.steps.splice(Number(node.getAttribute('data-r32-del')), 1); r30SheetRender(); return; }
    if (node.hasAttribute('data-r32-go')) createRelay();
  }
  function onInput(event) {
    var t = event.target;
    if (!t || !t.getAttribute) return;
    var st = r30Sheet && r30Sheet.r32;
    if (!st) return;
    if (t.hasAttribute('data-r32-task')) { var s = st.steps[Number(t.getAttribute('data-r32-task'))]; if (s) s.task = t.value; }
    if (t.hasAttribute('data-r32-gate')) { var g = st.steps[Number(t.getAttribute('data-r32-gate'))]; if (g) g.gate = !!t.checked; }
  }
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  document.addEventListener('toggle', function (event) {
    var d = event.target;
    if (d && d.getAttribute && d.hasAttribute('data-r32-note')) openNotes[d.getAttribute('data-r32-note')] = !!d.open;
  }, true);

  /* ================= 演示：两条接力自己往前走 ================= */
  var TICK_MS = 3600;
  var DEMO_SEEDS = [
    {id: 'r32-demo-event', title: '活动筹备：周末手作市集', goal: '把周末手作市集办起来：查资料、写方案、出视觉、排期。', auto: true,
      steps: [
        {bot: 'research', task: '查资料：往年同类市集怎么办、摊位数和预算', note: '查了 5 个往年案例，摊位 30–40 个、预算 8000 左右最常见。资料放在「市集资料.md」。注意：两个案例的预算含场地费，对比时要扣掉。没做完：天气备选方案没查。'},
        {bot: 'content', task: '写活动方案：流程、分工、物料清单', note: '方案写好了：上午布置、中午开市、傍晚收摊。物料清单在方案第 3 页。注意：开市时间我按 11 点写的，要和场地确认。'},
        {bot: 'art', task: '出海报和现场视觉', note: '海报两版（暖色、清爽）放在「视觉」文件夹。文字都是方案里的原话。没做完：摊位牌模板只出了一个尺寸。'},
        {bot: 'pm', task: '排出时间表和分工，标好谁负责哪一块', note: '时间表排到活动当天 18:00，分工表里每个摊位组各有一位负责人。待确认：场地钥匙谁取。'}]},
    {id: 'r32-demo-dev', title: '功能开发：消息里加「稍后提醒」', goal: '给消息加一个「稍后提醒」：写方案、写代码、检查，最后你验收。', auto: true, stuckAt: 1,
      steps: [
        {bot: 'writer', task: '写方案：要做什么、怎么做、做到什么算完', note: '方案写好了：长按消息出「稍后提醒」，可选 10 分钟、1 小时、明天早上。做到：点了能收到提醒、取消能取消。方案在「提醒方案.md」。'},
        {bot: 'content', task: '照方案写代码，做出能用的东西', question: '「明天早上」是几点？方案里没写，我先按 9 点做可以吗？', answer: '按 9 点，设置里能改。', note: '做好了：三个时间都能选，提醒到点会弹出。代码放在 reminder 目录。注意：「明天早上」按 9 点算。没做完：设置里改时间的入口还没做。'},
        {bot: 'research', task: '检查：对照方案逐条查，列出没做到的', note: '逐条查过：长按、三个时间、取消都对。没做到：设置里改时间的入口（上一棒已说明）。另发现：关了通知权限时没有提示。'},
        {owner: true, task: '验收：看过没问题就放行'}]}
  ];
  var demo = null;
  function vtime(d) { return new Date(d.vnow).toISOString(); }
  function buildDemo(seed, t0) {
    var vnow = t0;
    var d = {id: seed.id, title: seed.title, goal: seed.goal, auto: !!seed.auto, stuckAt: seed.stuckAt == null ? -1 : seed.stuckAt, stuckDone: false,
      seed: seed, vnow: vnow, fromWill: !seed.auto, created: t0, phase: 'running', current: 0, finalAt: null, steps: []};
    d.steps = seed.steps.map(function (s) {
      return {who: s.owner ? {name: 'owner', type: 'owner'} : {name: s.bot, type: 'assistant'}, task: s.task, doneWhen: '', gate: false, status: 'waiting',
        startedAt: null, deliveredAt: null, note: null, noteBy: null, question: null, returnedNote: null, _note: s.note || '', _q: s.question || '', _a: s.answer || ''};
    });
    startStep(d, 0);
    return d;
  }
  function startStep(d, j) {
    d.current = j;
    if (j >= d.steps.length) { d.phase = 'final'; d.finalAt = vtime(d); return; }
    var s = d.steps[j];
    s.startedAt = vtime(d);
    if (s.who.type === 'owner') { s.status = 'gate'; d.phase = 'gate'; return; }
    s.status = 'active';
    d.phase = 'running';
  }
  function demoModel(d) {
    var relay = {phase: d.phase, current: d.current, steps: d.steps.map(function (s) {
      return {who: s.who, task: s.task, doneWhen: s.doneWhen, gate: s.gate, status: s.status, startedAt: s.startedAt, deliveredAt: s.deliveredAt,
        note: s.note, noteBy: s.noteBy, question: s.question, returnedNote: s.returnedNote};
    })};
    return NS.model(relay, {id: d.id, now: d.vnow + 6 * 60000, fromWill: d.fromWill, initiator: 'chief'});
  }
  /* 一步：返回有没有动。 */
  function advance(d) {
    var s = d.steps[d.current];
    d.vnow += (9 + (d.current * 7) % 23) * 60000;
    if (d.phase === 'running') {
      if (d.stuckAt === d.current && !d.stuckDone && s._q) {
        s.status = 'stuck'; s.question = s._q; d.phase = 'stuck'; return true;
      }
      s.status = 'done'; s.deliveredAt = vtime(d); s.note = s._note || '做好了，放在约定的位置。'; s.noteBy = s.who.name; s.question = null;
      if (s.gate) { d.phase = 'gate'; return true; }
      startStep(d, d.current + 1);
      return true;
    }
    if (d.phase === 'stuck') {
      if (!d.auto) return false;
      return demoAct(d, 'answer', s._a || '按你的想法来。');
    }
    if (d.phase === 'gate') {
      if (!d.auto) return false;
      return demoAct(d, 'release', '');
    }
    if (d.phase === 'final') {
      d.phase = 'done'; return true;
    }
    return false;
  }
  function demoAct(d, action, text) {
    var s = d.steps[d.current];
    if (action === 'answer' && d.phase === 'stuck') {
      d.stuckDone = true; s.status = 'active'; s.question = s.question; d.phase = 'running'; return true;
    }
    if (action === 'release' && d.phase === 'gate') {
      if (s.who.type === 'owner') { s.status = 'done'; s.deliveredAt = vtime(d); s.note = text || '看过了，放行'; s.noteBy = 'owner'; }
      startStep(d, d.current + 1);
      if (d.phase === 'final' && d.fromWill) d.phase = 'done';
      return true;
    }
    if (action === 'redo' && d.phase === 'gate' && s.who.type !== 'owner') {
      s.status = 'active'; s.deliveredAt = null; s.returnedNote = text || '再做一次'; d.phase = 'running'; return true;
    }
    if (action === 'finish' && d.phase === 'final') { d.phase = 'done'; return true; }
    return false;
  }
  NS.demoAct = function (id, action, text) {
    var d = (demo || []).filter(function (x) { return x.id === id; })[0];
    return d ? demoAct(d, action, text) : false;
  };
  function ensureDemo() {
    if (demo) return demo;
    var ready = typeof botBy === 'function' && state && state.bots && state.bots.length;
    if (!ready) return null;
    var t0 = Date.now() - 3 * 3600000;
    demo = DEMO_SEEDS.filter(function (seed) {
      return seed.steps.every(function (s) { return s.owner || botBy(s.bot); });
    }).map(function (seed, i) { return buildDemo(seed, t0 + i * 600000); });
    return demo;
  }
  NS.demoActive = function () { return !real() && !!ensureDemo() && demo.length > 0; };
  NS.demoCreate = function (title, goal, items) {
    ensureDemo();
    demo = demo || [];
    var seed = {id: 'r32-new-' + (demo.length + 1) + '-' + Date.now(), title: title, goal: goal, auto: false, steps: items.map(function (it) {
      return it.person.type === 'owner' ? {owner: true, task: it.task} : {bot: it.person.id, task: it.task, note: '做好了，结果放在约定的位置。'};
    })};
    var d = buildDemo(seed, Date.now() - 600000);
    d.created = Date.now() + 1;
    d.steps.forEach(function (s, i) { s.gate = !!(items[i] && items[i].gate); });
    d.auto = false;
    d.fresh = true;
    demo.unshift(d);
    if (typeof r29DeskPaint === 'function') r29DeskPaint();
    NS.patchHome();
  };
  NS.demoRows = function () {
    if (real() || !ensureDemo()) return [];
    var rows = [];
    demo.forEach(function (d) {
      var over = typeof r30Local === 'object' && r30Local[d.id] || {};
      if (over.gone) return;
      var m = demoModel(d);
      var s = m.steps[Math.min(m.current, m.steps.length - 1)];
      var people = [];
      m.steps.forEach(function (x) { if (x.person && !people.some(function (p) { return p.key === x.person.key; })) people.push(x.person); });
      var title = over.title || d.title;
      var iso = new Date(d.created).toISOString();
      rows.push({id: d.id, col: NS.col(m), title: clip(title, 40), rawTitle: title, line: NS.line(m), faces: [], people: people,
        time: '', iso: iso, stamp: d.fresh ? Date.now() : d.created, assignee: s && !s.owner ? s.person : null, goal: d.goal, locked: false,
        summary: '', verified: '', unmet: '', relay: m});
    });
    return rows;
  };
  NS.demoState = function () { return (demo || []).map(function (d) { return {id: d.id, phase: d.phase, current: d.current, done: d.steps.filter(function (s) { return s.status === 'done'; }).length}; }); };
  NS.tick = function () {
    if (!ensureDemo()) return false;
    var moved = false;
    demo.forEach(function (d) { if (advance(d)) moved = true; });
    if (moved) {
      if (typeof r29DeskPaint === 'function') r29DeskPaint();
      NS.patchHome();
    }
    return moved;
  };
  NS.replay = function () {
    DEMO_SEEDS.forEach(function (seed) { if (typeof r30Local === 'object' && r30Local[seed.id]) delete r30Local[seed.id]; });
    demo = null;
    lastCurrent = {};
    passAt = {};
    ensureDemo();
    if (typeof r29DeskPaint === 'function') r29DeskPaint();
    NS.patchHome();
    say('从头再走一遍');
  };
  var timer = null;
  function visibleBoard() { return typeof state !== 'undefined' && state.mode === 'kanban' && !document.hidden; }
  function startTimer() {
    if (timer) return;
    var ms = Number(window.__R32_TICK_MS) > 0 ? Number(window.__R32_TICK_MS) : TICK_MS;
    timer = setInterval(function () {
      if (real() || !visibleBoard()) return;
      NS.tick();
    }, ms);
  }

  /* 首页助理格子：演示里写「在跑接力第 N 棒」。真实模式由后端的状态句负责。 */
  NS.patchHome = function () {
    if (real() || !demo) return;
    try {
      var line = {};
      demo.forEach(function (d) {
        if (['running', 'stuck'].indexOf(d.phase) < 0) return;
        var s = d.steps[d.current];
        if (!s || s.who.type === 'owner') return;
        line[s.who.name] = d.phase === 'stuck' ? '接力卡在第' + (d.current + 1) + '棒' : '接力第' + (d.current + 1) + '棒/共' + d.steps.length + '棒';
      });
      var cells = document.querySelectorAll('[data-bot-tree]');
      Array.prototype.forEach.call(cells, function (cell) {
        var id = cell.getAttribute('data-bot-tree');
        var small = cell.querySelector('small[data-bot-status]');
        if (!small) return;
        var cls = String(small.className || '').replace(/\s*r32-home-line/g, '');
        if (line[id]) {
          if (small.__r32orig === undefined) small.__r32orig = small.textContent;
          small.textContent = line[id];
          small.className = (cls + ' r32-home-line').trim();
        } else if (small.__r32orig !== undefined) {
          small.textContent = small.__r32orig;
          small.__r32orig = undefined;
          small.className = cls;
        }
      });
    } catch (x) { /* 首页没画出来就算了，下次渲染再补 */ }
  };

  /* ---------- 今天页：接力停在你这里 ---------- */
  function relayWaiting(t) {
    var r = t && t.relay;
    if (!r || !Array.isArray(r.steps)) return null;
    if (r.phase === 'gate' || r.phase === 'halted' || (r.phase === 'stuck' && t.state === 'waiting-human')) return r;
    if (r.phase === 'final' && t.from && t.from.type === 'owner' && t.state !== 'completed') return r;
    return null;
  }
  function hookToday() {
    var LT = window.R30LT;
    if (!LT || LT.__r32) return;
    LT.__r32 = true;
    var origNormal = LT.normalizeToday;
    LT.normalizeToday = function (raw, tickets, nameOf2) {
      var model = origNormal.apply(this, arguments);
      if (!model || !Array.isArray(tickets)) return model;
      tickets.forEach(function (t) {
        var r = relayWaiting(t);
        if (!r || !t || typeof t.id !== 'string') return;
        var n = r.current + 1;
        var sub = r.phase === 'halted' ? clip((t.open_ask && t.open_ask.text) || '接力停在这里：接棒的人已停用，换个人接？', 100) :
          r.phase === 'stuck' ? '第 ' + n + ' 棒卡住了，等你回答' : r.phase === 'final' ? '每一棒都交回了，等你验收' : '第 ' + n + ' 棒做完了，等你看一眼';
        var hit = model.waiting.items.filter(function (i) { return i && i.kind === 'ticket' && i.id === t.id; })[0];
        var tag = r.phase === 'halted' ? '接力停在这里' : '接力停在你这里';
        if (hit) { hit.tag = tag; hit.sub = sub; hit.act = '去处理'; return; }
        model.waiting.available = true;
        model.waiting.items.push({kind: 'ticket', tag: tag, id: t.id, bot: '', name: '', title: clip(t.title, 80) || '（无标题）', sub: sub, act: '去处理'});
      });
      /* 超时催办：某一棒被叫醒后很久没动静（后端记了 stalledAt）；卡本身还在进行中，所以不在上面那条里。 */
      tickets.forEach(function (t) {
        var r = t && t.relay;
        if (!r || !Array.isArray(r.steps) || r.phase !== 'running' || typeof t.id !== 'string') return;
        var st = r.steps[r.current];
        if (!st || !st.stalledAt || st.status !== 'active') return;
        model.waiting.available = true;
        model.waiting.items.push({kind: 'ticket', tag: '这一棒没动静', id: t.id, bot: '', name: '', title: clip(t.title, 80) || '（无标题）',
          sub: '这一棒 ' + (Number(st.stalledMin) > 0 ? Number(st.stalledMin) : 30) + ' 分钟没动静', act: '去处理'});
      });
      /* 今天做完的：接力卡的摘要用一句人话，不用交接说明的长文截断。 */
      var byId = {};
      tickets.forEach(function (t) { if (t && t.relay && Array.isArray(t.relay.steps) && typeof t.id === 'string') byId[t.id] = t; });
      ((model.done && model.done.items) || []).forEach(function (it) {
        var t = byId[it.id];
        if (t) it.sub = '「' + (clip(t.title, 30) || '无标题') + '」接力 ' + t.relay.steps.length + ' 棒走完了';
      });
      return model;
    };
    var origDemo = LT.demoToday;
    LT.demoToday = function () {
      var model = origDemo.apply(this, arguments);
      if (!model || !ensureDemo()) return model;
      demo.forEach(function (d) {
        var waiting = d.phase === 'gate' || d.phase === 'stuck' || (d.phase === 'final' && d.fromWill);
        if (!waiting) return;
        var n = d.current + 1;
        model.waiting.items.unshift({kind: 'relay', tag: '接力停在你这里', id: d.id, bot: '', name: '', title: clip(d.title, 80),
          sub: d.phase === 'stuck' ? '第 ' + n + ' 棒卡住了，等你回答' : d.phase === 'final' ? '每一棒都交回了，等你验收' : '第 ' + n + ' 棒要你看一眼', act: '去处理'});
      });
      return model;
    };
    var origMount = LT.mountToday;
    LT.mountToday = function (host, model, opts) {
      var inner = opts && opts.onOpen;
      var wrapped = Object.assign({}, opts || {}, {onOpen: function (item, block) {
        if (item && item.kind === 'relay') {
          try {
            Hub.navigate({view: 'kanban'});
            setTimeout(function () { if (window.R30Board) window.R30Board.open(item.id); }, 200);
          } catch (x) {}
          return;
        }
        if (inner) inner(item, block);
      }});
      return origMount.call(this, host, model, wrapped);
    };
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var ok = install();
    hookToday();
    if (!ok) return;
    startTimer();
    if (window.Hub && typeof Hub.on === 'function') {
      Hub.on('render', function () {
        ensureDemo();
        NS.patchHome();
      });
    }
    var tries = 0;
    var wait = setInterval(function () {
      tries += 1;
      hookToday();
      if (ensureDemo() || tries > 40) {
        clearInterval(wait);
        NS.patchHome();
        if (typeof r29DeskPaint === 'function' && typeof state !== 'undefined' && state.mode === 'kanban') r29DeskPaint();
      }
    }, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
