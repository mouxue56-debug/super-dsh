/* 触发：发任务、拖看板就叫首席安排；卡片可以定时。
 * 这一份脚本接在看板（js/views/board.js）、今天页（js/r30-ledger-today.js）和开放认领（js/r35-claim.js）后面，不改它们的主体：
 *   - 新建卡：负责人那一排多一项「交给首席安排」（在「谁有空谁接」旁边）；下面多一块「什么时候做」（现在 / 选时间 / 每天 / 每周）；
 *   - 卡片：小钟和时间；「首席安排中」「首席建议·等你点头」；点开能看首席写的「首席安排：交给 X，现在做。因为……」；
 *     首席建议带三个操作：就这么办 / 换个人 / 先不做；没人负责的卡能点「交给首席安排」；拖没负责人的卡到「在做」，后端自己请首席；
 *   - 重复的卡是「定时模板」：不混在五列里，放进看板下面一个折叠的「定时任务」区，能暂停、取消；
 *   - 今天页：「等你处理」里的首席建议（带三个操作）、「没叫动 Codex」、「今天的固定任务」里列出今天到点的卡、「有 N 个定时没赶上」；
 *   - 演示模式：一张会被首席自动安排的卡、一张等你点头的卡、一张定时卡（假时钟加速，三格就到点）；板头「重播」一起重来。
 * 真实模式里数据来自后端卡上的 arrange / schedule 字段；没有它们的卡完全不受影响。
 * 对外：window.R38Trigger。 */
(function () {
  'use strict';
  if (window.R38Trigger) return;
  var NS = window.R38Trigger = {};

  /* ---------- 小工具 ---------- */
  function e(value) { return typeof esc === 'function' ? esc(value) : String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function clip(value, n) { return Array.from(String(value == null ? '' : value)).slice(0, n).join(''); }
  function real() { try { return document.documentElement.dataset.hubMode === 'real'; } catch (x) { return false; } }
  function say(text) { try { if (typeof toast === 'function') toast(text); } catch (x) {} }
  function wrap(name, make) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__r38) return false;
    var next = make(orig);
    next.__r38 = true;
    window[name] = next;
    return true;
  }
  var ARRANGE_PERSON = {id: 'arrange', key: 'arrange', name: '首席安排', roster: false, type: 'arrange', arrange: true};
  var DAYS = '一二三四五六日';
  var CLOCK_SVG = '<svg class="r38-clk" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.6V8l2.3 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var EXT_NAMES = {codex: 'Codex', grok: 'Grok'};
  function extShown(id) { return EXT_NAMES[id] || String(id || ''); }
  function shownName(id, type) {
    if (!id) return '';
    if (type === 'external' && EXT_NAMES[id]) return EXT_NAMES[id];
    if (typeof r29DeskShown === 'function' && typeof r29DeskActor === 'function') {
      var s = r29DeskShown(r29DeskActor(id, type || 'assistant'));
      if (s) return String(s).replace(/^外部 · /, '');
    }
    return String(id);
  }

  /* ---------- 时间说成人话 ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayWord(ms, nowMs) {
    var a = new Date(ms), b = new Date(nowMs);
    var da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    var db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    var diff = Math.round((da - db) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    return (a.getMonth() + 1) + ' 月 ' + a.getDate() + ' 日';
  }
  NS.onceText = function (iso, nowMs) {
    var ms = Date.parse(iso);
    if (!isFinite(ms)) return '';
    var d = new Date(ms);
    return dayWord(ms, nowMs == null ? Date.now() : nowMs) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  NS.repeatText = function (sc) {
    if (!sc) return '';
    if (sc.kind === 'daily') return '每天 ' + sc.time;
    if (sc.kind === 'weekly') return '每周' + (sc.days || []).map(function (d) { return DAYS[d - 1] || ''; }).join('、') + ' ' + sc.time;
    return '';
  };
  NS.whenText = function (sc, nowMs) { return sc ? (sc.kind === 'once' ? NS.onceText(sc.at, nowMs) : NS.repeatText(sc)) : ''; };

  /* ---------- 卡上的字段 → 界面要用的小模型 ---------- */
  NS.model = function (ticket, nowMs) {
    if (!ticket || typeof ticket !== 'object') return null;
    var a = ticket.arrange && typeof ticket.arrange === 'object' ? ticket.arrange : null;
    var sc = ticket.schedule && typeof ticket.schedule === 'object' ? ticket.schedule : null;
    if (!a && !sc) return null;
    var m = {arr: null, sc: null};
    if (a) {
      m.arr = {state: a.state, via: a.via, note: String(a.note || ''), stalled: a.stalled === true,
        needs: (Array.isArray(a.needs) ? a.needs : []).map(function (n) { return String(n && n.text || ''); }).filter(Boolean),
        hasPlan: !!a.plan, askText: ticket.open_ask && ticket.open_ask.text ? String(ticket.open_ask.text) : ''};
    }
    if (sc) {
      var who = sc.assignee && sc.assignee.name ? shownName(sc.assignee.name, sc.assignee.type) : '';
      m.sc = {kind: sc.kind, state: sc.state, template: sc.template === true, text: NS.whenText(sc, nowMs), who: who,
        whoId: sc.assignee && sc.assignee.name || '', whoType: sc.assignee && sc.assignee.type || '', missed: Array.isArray(sc.missed) ? sc.missed.length : 0,
        by: sc.by || '', firedAt: sc.firedAt || ''};
    }
    return m;
  };
  function chipsHtml(row) {
    var out = '';
    var a = row.arr, sc = row.sc;
    if (a && a.state === 'wanted') out += '<span class="r38-chip is-wait" data-r38-chip="wanted"><i class="r38-pulse" aria-hidden="true"></i>首席安排中</span>';
    else if (a && a.state === 'proposed') out += '<span class="r38-chip is-ask" data-r38-chip="proposed">首席建议 · 等你点头</span>';
    else if (a && a.state === 'applied') out += '<span class="r38-chip is-done" data-r38-chip="applied">首席安排的</span>';
    if (sc) {
      var tone = sc.state === 'missed' ? 'is-mute' : 'is-clock';
      var label = sc.template ? '定时模板 · ' + sc.text : sc.state === 'fired' ? '已到点 · ' + sc.text : sc.state === 'missed' ? '没赶上 · ' + sc.text
        : sc.state === 'paused' ? '已暂停 · ' + sc.text : sc.text;
      out += '<span class="r38-chip ' + tone + '" data-r38-chip="clock">' + CLOCK_SVG + e(label) + '</span>';
    }
    return out ? '<div class="r38-chips">' + out + '</div>' : '';
  }
  NS.chipsHtml = chipsHtml;

  /* ---------- 点开卡：说明块 ---------- */
  function swapOpen(id) { return NS.swapFor === id; }
  function peopleHtml(attr, id) {
    var list = typeof r30People === 'function' ? r30People(typeof r29DeskCurrent === 'function' ? r29DeskCurrent() : []) : [];
    var html = '<div class="r38-pick" role="group" aria-label="换给谁">';
    list.forEach(function (p) {
      html += '<button type="button" class="r30-who" ' + attr + '="' + e(id) + '" data-r38-who="' + e(p.key) + '">' +
        (typeof r29DeskFace === 'function' ? r29DeskFace(p, 32) : '') + '<span>' + e(p.name) + '</span></button>';
    });
    return html + '</div>';
  }
  NS.boxHtml = function (row) {
    if (!row) return '';
    var id = e(row.id);
    var html = '';
    var a = row.arr;
    if (a && a.state === 'wanted') {
      html += '<div class="r38-box is-wait" data-r38-box="wanted"><strong>首席安排中</strong><p>这张卡交给首席了：它会定谁来做、什么时候做、要不要你先点头。通常一两分钟，不用你再催。</p></div>';
    } else if (a && a.state === 'proposed') {
      html += '<div class="r38-box is-ask" data-r38-box="proposed"><strong>首席建议，等你点头</strong><p>' + e(a.note || a.askText || '首席没能安排这张卡，请你来定：交给谁、什么时候做。') + '</p>' +
        (a.needs.length ? '<ul class="r38-needs">' + a.needs.map(function (n) { return '<li>' + e(n) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="r30-row">' + (a.hasPlan ? '<button type="button" class="r30-primary" data-r38-ok="' + id + '">就这么办</button>' : '') +
        '<button type="button" data-r38-swap="' + id + '">换个人</button><button type="button" data-r38-skip="' + id + '">先不做</button></div>' +
        (swapOpen(row.id) ? peopleHtml('data-r38-swap-pick', row.id) : '') + '</div>';
    } else if (a && a.state === 'applied') {
      html += '<div class="r38-box is-done" data-r38-box="applied"><strong>首席安排</strong><p>' + e(a.note || '首席已经安排好了。') + '</p></div>';
    }
    var sc = row.sc;
    if (sc) {
      var body = sc.template ? '这是一张定时模板：每次到点，会生成一张当次的卡' + (sc.who ? '，交给' + sc.who : '，由首席安排人') + '；模板自己留在这里。'
        : sc.state === 'waiting' ? '到点会' + (sc.who ? '叫醒' + sc.who + '来做' : '请首席安排谁来做') + '；没到点之前，没有人会收到这张卡。'
        : sc.state === 'fired' ? '到点了，已经交出去。' : sc.state === 'missed' ? '到点时后端没在运行，超过 6 小时没补；你可以重新定个时间。' : '已暂停，不会到点。';
      html += '<div class="r38-box is-clock" data-r38-box="clock"><strong>' + e((sc.template ? '定时模板 · ' : '定时 · ') + sc.text) + '</strong><p>' + e(body) + '</p>' +
        (sc.missed ? '<p>有 ' + sc.missed + ' 个时刻没赶上。</p>' : '') + '<div class="r30-row">' +
        (sc.template ? (sc.state === 'paused' ? '<button type="button" data-r38-resume="' + id + '">恢复定时</button>' : '<button type="button" data-r38-pause="' + id + '">暂停定时</button>') : '') +
        (sc.state === 'waiting' || sc.state === 'paused' || sc.state === 'missed' ? '<button type="button" data-r38-unsched="' + id + '">取消定时</button>' : '') + '</div></div>';
    }
    return html;
  };
  /* 能不能「交给首席安排」：没负责人、在待领、不是接力、不是旧单、不在别的流程里。 */
  function canAsk(row) {
    return !!row && !row.locked && !row.relay && !row.open && row.col === 'queued' && !row.assignee && !row.template &&
      !(row.arr && (row.arr.state === 'wanted' || row.arr.state === 'proposed'));
  }
  function canSchedule(row) {
    return canAsk(row) && !row.sc;
  }
  function whenFormHtml(prefix, mode, days, withModes) {
    var modes = [['once', '选个时间'], ['daily', '每天'], ['weekly', '每周']];
    var html = '<div class="r38-form" data-r30-form>';
    if (withModes !== false) {
      html += '<div class="r38-modes" role="group" aria-label="什么时候做">';
      modes.forEach(function (m) {
        html += '<button type="button" class="' + (mode === m[0] ? 'is-on' : '') + '" data-r38-mode="' + m[0] + '" data-r38-prefix="' + prefix + '" aria-pressed="' + (mode === m[0]) + '">' + m[1] + '</button>';
      });
      html += '</div>';
    }
    if (mode === 'once') html += '<label>几点做<input type="datetime-local" name="' + prefix + 'at"></label>';
    else html += '<label>几点做<input type="time" name="' + prefix + 'time" value="09:00"></label>';
    if (mode === 'weekly') {
      html += '<div class="r38-days" role="group" aria-label="每周几">';
      for (var i = 1; i <= 7; i += 1) {
        html += '<button type="button" class="' + (days.indexOf(i) >= 0 ? 'is-on' : '') + '" data-r38-day="' + i + '" data-r38-prefix="' + prefix + '" aria-pressed="' + (days.indexOf(i) >= 0) + '">' + DAYS[i - 1] + '</button>';
      }
      html += '</div>';
    }
    return html + '<p class="r38-hint">' + (mode === 'once' ? '用你这台设备的时间。' : '按后端所在时区的时间。') + '</p></div>';
  }
  var sched = {open: '', mode: 'once', days: [1]};

  /* ---------- 解析表单 ---------- */
  function readWhen(scope, prefix, mode, days) {
    if (mode === 'once') {
      var field = scope.querySelector('[name=' + prefix + 'at]');
      var ms = field && field.value ? new Date(field.value).getTime() : NaN;
      if (!isFinite(ms)) return {error: '先选个时间'};
      if (ms <= Date.now() + 20000) return {error: '时间要在未来'};
      return {value: {kind: 'once', at: new Date(ms).toISOString()}};
    }
    var t = scope.querySelector('[name=' + prefix + 'time]');
    var time = t && t.value ? t.value : '';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return {error: '先选个时间'};
    if (mode === 'weekly') {
      if (!days.length) return {error: '每周要选至少一天'};
      return {value: {kind: 'weekly', time: time, days: days.slice().sort()}};
    }
    return {value: {kind: 'daily', time: time}};
  }

  /* ---------- 接上看板：包一层，不改原文件 ---------- */
  var newWhen = {mode: 'now', kindMode: 'once', days: [1]};
  function install() {
    if (typeof r29DeskFromTicket !== 'function' || typeof r30CardHtml !== 'function') return false;
    wrap('r29DeskFromTicket', function (orig) {
      return function (ticket) {
        var row = orig(ticket);
        var m = row && ticket ? NS.model(ticket) : null;
        if (!m) return row;
        row.arr = m.arr;
        row.sc = m.sc;
        if (m.sc && m.sc.template) row.template = true;
        if (m.arr && m.arr.state === 'wanted') { row.line = '交给首席安排，等它给结论'; if (!row.open) row.assignee = null; }
        else if (m.arr && m.arr.state === 'proposed') row.line = '首席建议了，等你点头';
        else if (m.arr && m.arr.state === 'applied' && !row.assignee && m.sc) row.line = '首席定了：' + m.sc.text + ' 做';
        if (m.sc && m.sc.state === 'waiting' && !m.sc.template && m.sc.whoId && ticket.state === 'queued') {
          if (typeof r29DeskPerson === 'function' && typeof r29DeskActor === 'function') {
            row.assignee = r29DeskPerson(r29DeskActor(m.sc.whoId, m.sc.whoType || 'assistant'));
          }
          row.line = m.sc.text + ' 到点，' + m.sc.who + '做';
        } else if (m.sc && m.sc.state === 'waiting' && !m.sc.template && ticket.state === 'queued' && !m.arr) {
          row.line = m.sc.text + ' 到点，交给首席安排';
        } else if (m.sc && m.sc.template) {
          row.line = '定时模板：' + m.sc.text + (m.sc.who ? '，交给' + m.sc.who : '');
        }
        return row;
      };
    });
    wrap('r30CardHtml', function (orig) {
      return function (row, phone) {
        var html = orig(row, phone);
        if (!row || (!row.arr && !row.sc)) return html;
        var chip = chipsHtml(row);
        var state = row.arr ? row.arr.state : '';
        html = html.replace(/<article /, '<article data-r38-card="' + e(state) + '" ');
        var at = html.indexOf('<time class="r29-desk-time"');
        if (at < 0) at = html.lastIndexOf('</article>');
        return html.slice(0, at) + chip + html.slice(at);
      };
    });
    /* 点开卡：最上面是首席安排和定时的说明块；没人负责的卡，「派给谁」第一项是「交给首席安排」，下面有「什么时候做」。 */
    wrap('r30ActionsHtml', function (orig) {
      return function (row) {
        var html = orig(row);
        if (!row) return html;
        var box = NS.boxHtml(row);
        if (real() && canAsk(row)) {
          var marker = '<div class="r30-people" role="group" aria-label="派给谁">';
          var ask = '<button type="button" class="r30-who r38-ask" data-r38-ask="' + e(row.id) + '">' +
            '<span class="r38-ico" aria-hidden="true">🧭</span><span>交给首席安排</span></button>';
          /* 放在「谁有空谁接」后面（它没有就放最前），原来的第一项不动。 */
          var open = html.indexOf('r35-whoopen');
          var close = open >= 0 ? html.indexOf('</button>', open) : -1;
          html = close >= 0 ? html.slice(0, close + 9) + ask + html.slice(close + 9) : html.replace(marker, marker + ask);
        }
        if (real() && canSchedule(row)) {
          var form = sched.open === row.id ? '<div class="r38-box is-clock" data-r38-sform>' + whenFormHtml('r38s', sched.mode, sched.days) +
            '<div class="r30-row"><button type="button" class="r30-primary" data-r38-sched-save="' + e(row.id) + '">定下来</button>' +
            '<button type="button" data-r38-sched-cancel>先不定</button></div><p class="r38-hint">到点时没有人在做的话，由首席安排谁来做。</p></div>'
            : '<button type="button" class="r30-edit" data-r38-sched-open="' + e(row.id) + '">定个时间做…</button>';
          html = html.replace('<h3>标题和说明</h3>', '<h3>什么时候做</h3>' + form + '<h3>标题和说明</h3>');
        }
        return box ? html.replace('<div class="r30-actions">', '<div class="r30-actions">' + box) : html;
      };
    });
    /* 新建：负责人那一排多「交给首席安排」，下面多「什么时候做」。 */
    wrap('r30NewHtml', function (orig) {
      return function () {
        var html = orig();
        var s = typeof r30Sheet !== 'undefined' && r30Sheet ? r30Sheet : null;
        var busy = s && s.busy ? ' disabled' : '';
        var button = '<button type="button" class="r30-who r30-give r38-give" data-r30-newgo="arrange" title="首席定谁来做、什么时候做、要不要你先点头"' + busy +
          '><span class="r38-ico" aria-hidden="true">🧭</span><span>交给首席安排</span></button>';
        var after = html.indexOf('data-r30-newgo="open"');
        if (after >= 0) {
          var end = html.indexOf('</button>', after);
          if (end >= 0) html = html.slice(0, end + 9) + button + html.slice(end + 9);
        } else {
          var marker = '<div class="r30-people" role="group" aria-label="交给谁">';
          html = html.replace(marker, marker + button);
        }
        var whenHtml = '<div class="r38-when" data-r38-when><h3>什么时候做</h3><div class="r38-modes" role="group" aria-label="什么时候做">' +
          [['now', '现在'], ['once', '选个时间'], ['daily', '每天'], ['weekly', '每周']].map(function (m) {
            return '<button type="button" class="' + (newWhen.mode === m[0] ? 'is-on' : '') + '" data-r38-newmode="' + m[0] + '" aria-pressed="' + (newWhen.mode === m[0]) + '">' + m[1] + '</button>';
          }).join('') + '</div>' + (newWhen.mode === 'now' ? '' : whenFormHtml('r38n', newWhen.mode, newWhen.days, false)) + '</div>';
        return html.replace('<div class="r30-actions"><h3>填好标题', whenHtml + '<div class="r30-actions"><h3>填好标题');
      };
    });
    wrap('r30PersonByKey', function (orig) {
      return function (key) { return key === 'arrange' ? ARRANGE_PERSON : orig.apply(this, arguments); };
    });
    /* 新建：在这里接管「交给首席安排」和带时间的卡，其余原样往下走。 */
    wrap('r30Create', function (orig) {
      return function (title, goal, person, col) {
        var asked = person && person.arrange;
        var timed = newWhen.mode !== 'now';
        if (!asked && !timed) return orig.apply(this, arguments);
        title = String(title || '').trim();
        goal = String(goal || '').trim();
        if (!title) { say('先写个标题'); return Promise.resolve(false); }
        if (person && person.open) { say('「谁有空谁接」不能和定时一起用，换个人，或选「交给首席安排」'); return Promise.resolve(false); }
        if (col && col !== 'queued') { say('这种卡只能先放在「待领」'); return Promise.resolve(false); }
        var when = null;
        if (timed) {
          var box = document.querySelector('#r30-sheet [data-r38-when]');
          var got = box ? readWhen(box, 'r38n', newWhen.mode, newWhen.days) : {error: '先选个时间'};
          if (got.error) { say(got.error); return Promise.resolve(false); }
          when = got.value;
        }
        if (!(typeof r29DeskReal === 'function' ? r29DeskReal() : real())) {
          NS.demoCreate(title, goal, asked ? 'arrange' : 'sched', when);
          return Promise.resolve(true);
        }
        var payload = {title: title};
        if (goal) payload.goal = goal;
        if (asked) payload.arrange = true;
        else if (person) payload.to = person.id;
        if (when) payload.schedule = when;
        return r30Done(r30Send('create', '', payload), function () { say('没建成，请再试一次'); });
      };
    });
    /* 拖没负责人的卡到「在做」：后端自己请首席；这里只说一句。 */
    wrap('r30Move', function (orig) {
      return function (id, col) {
        var row = typeof r30Row === 'function' ? r30Row(id) : null;
        var asks = real() && col === 'progress' && canAsk(row);
        var result = orig.apply(this, arguments);
        if (asks && result && typeof result.then === 'function') {
          result.then(function (ok) { if (ok) say('已交给首席安排：它会定谁来做、什么时候做'); });
        }
        return result;
      };
    });
    wrap('r30Say', function (orig) {
      return function (text) { return orig.call(this, text === '已交给首席安排' ? '已交给首席安排：它会定谁来做、什么时候做' : text); };
    });
    /* 定时模板不混在五列里；看板下面一个折叠的「定时任务」区。 */
    wrap('r29DeskRoot', function (orig) {
      return function (rows) {
        rows = rows || [];
        var normal = rows.filter(function (r) { return !r.template; });
        var html = orig(normal);
        var tpl = rows.filter(function (r) { return r.template && r38Match(r); });
        if (!tpl.length) return html;
        var at = html.lastIndexOf('</div>');
        return at < 0 ? html : html.slice(0, at) + templatesHtml(tpl) + html.slice(at);
      };
    });
    wrap('r30PhoneBoard', function (orig) {
      return function (rows) {
        rows = rows || [];
        var normal = rows.filter(function (r) { return !r.template; });
        var html = orig(normal);
        var tpl = rows.filter(function (r) { return r.template; });
        if (!tpl.length) return html;
        var at = html.lastIndexOf('</div></section>');
        return at < 0 ? html : html.slice(0, at) + templatesHtml(tpl) + html.slice(at);
      };
    });
    /* 关掉操作单：新建里选的时间、换人的小窗、定时的小表单都回到初始。 */
    wrap('r30CloseSheet', function (orig) {
      return function () { resetNew(); NS.swapFor = ''; sched.open = ''; return orig.apply(this, arguments); };
    });
    wrap('r29DeskDemoRows', function (orig) {
      return function () { return orig().concat(NS.demoRows()); };
    });
    return true;
  }
  function r38Match(row) { return typeof r29DeskMatch === 'function' ? r29DeskMatch(row) : true; }
  function templatesHtml(rows) {
    return '<details class="r38-tpl" data-r38-tpl' + (NS.tplOpen ? ' open' : '') + '><summary>' + CLOCK_SVG + '定时任务 · ' + rows.length + ' 个</summary><ul>' +
      rows.map(function (r) {
        var sc = r.sc || {};
        return '<li><button type="button" class="r38-tpl-row" data-r30-open="' + e(r.id) + '" aria-label="' + e('定时任务：' + r.title) + '"><span><b>' + e(r.title) + '</b>' +
          '<small>' + e((sc.text || '') + (sc.who ? ' · ' + sc.who : ' · 首席安排人')) + '</small></span>' +
          '<span class="r38-chip ' + (sc.state === 'paused' ? 'is-mute' : 'is-clock') + '">' + e(sc.state === 'paused' ? '已暂停' : sc.missed ? sc.missed + ' 个没赶上' : '运行中') + '</span></button></li>';
      }).join('') + '</ul></details>';
  }

  /* ---------- 点击 ---------- */
  function send(kind, id, payload, failText, okText) {
    if (typeof r30Send !== 'function') return Promise.resolve(false);
    var pending = false;
    var request = r30Send(kind, id, payload).then(function (ticket) {
      pending = ticket && ticket.awaitingConfirmation === true;
      return ticket;
    });
    return r30Done(request, function () { say(failText); }).then(function (ok) {
      if (ok && pending) say('请在今天页的「等你处理」里核对对象，再确认一次');
      else if (ok && okText) say(okText);
      return ok && pending ? {awaitingConfirmation: true} : ok;
    });
  }
  function onClick(event) {
    var t = event.target && event.target.closest ? event.target : null;
    if (!t) return;
    var node = t.closest('[data-r38-ask],[data-r38-ok],[data-r38-swap],[data-r38-skip],[data-r38-swap-pick],[data-r38-pause],[data-r38-resume],' +
      '[data-r38-unsched],[data-r38-sched-open],[data-r38-sched-save],[data-r38-sched-cancel],[data-r38-mode],[data-r38-day],[data-r38-newmode],' +
      '[data-r38-tok],[data-r38-tswap],[data-r38-tskip],[data-r38-tswap-pick],[data-r38-tpl]');
    if (!node) return;
    var id;
    if (node.hasAttribute('data-r38-tpl')) { return; }
    if (node.hasAttribute('data-r38-ask')) {
      event.preventDefault();
      if (!real()) return;
      id = node.getAttribute('data-r38-ask');
      node.disabled = true;
      send('arrange', id, {action: 'ask'}, '没交出去，卡还是原来的', '已交给首席安排：它会定谁来做、什么时候做').then(function (ok) {
        if (ok) { if (typeof r30CloseSheet === 'function') r30CloseSheet(); } else node.disabled = false;
      });
      return;
    }
    if (node.hasAttribute('data-r38-ok') || node.hasAttribute('data-r38-skip')) {
      event.preventDefault();
      var isOk = node.hasAttribute('data-r38-ok');
      id = node.getAttribute(isOk ? 'data-r38-ok' : 'data-r38-skip');
      if (!real()) { NS.demoDecide(id, isOk ? 'ok' : 'skip'); return; }
      node.disabled = true;
      send('arrange', id, {action: isOk ? 'ok' : 'skip'}, '没成，卡还是原来的', isOk ? '已照首席的意思办' : '先不做，卡回到待领').then(function (ok) {
        if (ok) { if (typeof r30CloseSheet === 'function') r30CloseSheet(); } else node.disabled = false;
      });
      return;
    }
    if (node.hasAttribute('data-r38-swap')) {
      event.preventDefault();
      id = node.getAttribute('data-r38-swap');
      NS.swapFor = NS.swapFor === id ? '' : id;
      if (typeof r30LoadPeople === 'function') r30LoadPeople();
      if (typeof r30SheetRender === 'function') r30SheetRender();
      return;
    }
    if (node.hasAttribute('data-r38-swap-pick')) {
      event.preventDefault();
      id = node.getAttribute('data-r38-swap-pick');
      var person = typeof r30PersonByKey === 'function' ? r30PersonByKey(node.getAttribute('data-r38-who')) : null;
      if (!person) return;
      if (!real()) { NS.demoDecide(id, 'swap', person); return; }
      send('arrange', id, {action: 'swap', who: person.id}, '没换成，卡还是原来的', '已换成' + person.name).then(function (ok) {
        if (ok) { NS.swapFor = ''; if (typeof r30CloseSheet === 'function') r30CloseSheet(); }
      });
      return;
    }
    if (node.hasAttribute('data-r38-pause') || node.hasAttribute('data-r38-resume')) {
      event.preventDefault();
      var pausing = node.hasAttribute('data-r38-pause');
      id = node.getAttribute(pausing ? 'data-r38-pause' : 'data-r38-resume');
      if (!real()) return;
      send('schedule', id, {action: pausing ? 'pause' : 'resume'}, '没改成', pausing ? '已暂停定时' : '已恢复定时').then(function (ok) {
        if (ok && typeof r30SheetRender === 'function') r30SheetRender();
      });
      return;
    }
    if (node.hasAttribute('data-r38-unsched')) {
      event.preventDefault();
      id = node.getAttribute('data-r38-unsched');
      if (!real()) return;
      send('schedule', id, {action: 'clear'}, '没取消成', '已取消定时').then(function (ok) {
        if (ok && typeof r30CloseSheet === 'function') r30CloseSheet();
      });
      return;
    }
    if (node.hasAttribute('data-r38-sched-open')) {
      event.preventDefault();
      sched.open = node.getAttribute('data-r38-sched-open');
      if (typeof r30SheetRender === 'function') r30SheetRender();
      return;
    }
    if (node.hasAttribute('data-r38-sched-cancel')) {
      event.preventDefault();
      sched.open = '';
      if (typeof r30SheetRender === 'function') r30SheetRender();
      return;
    }
    if (node.hasAttribute('data-r38-sched-save')) {
      event.preventDefault();
      id = node.getAttribute('data-r38-sched-save');
      var scope = node.closest('[data-r38-sform]');
      var got = readWhen(scope, 'r38s', sched.mode, sched.days);
      if (got.error) { say(got.error); return; }
      node.disabled = true;
      send('schedule', id, {action: 'set', schedule: got.value}, '没定成，卡还是原来的', '定好了，到点会叫人').then(function (ok) {
        if (ok) { sched.open = ''; if (typeof r30CloseSheet === 'function') r30CloseSheet(); } else node.disabled = false;
      });
      return;
    }
    if (node.hasAttribute('data-r38-mode')) {
      event.preventDefault();
      var mode = node.getAttribute('data-r38-mode');
      if (node.getAttribute('data-r38-prefix') === 'r38n') newWhen.mode = mode; else sched.mode = mode;
      if (typeof r30SheetRender === 'function') r30SheetRender();
      return;
    }
    if (node.hasAttribute('data-r38-newmode')) {
      event.preventDefault();
      var nm = node.getAttribute('data-r38-newmode');
      newWhen.mode = nm;
      if (typeof r30SheetRender === 'function') r30SheetRender();
      return;
    }
    if (node.hasAttribute('data-r38-day')) {
      event.preventDefault();
      var d = Number(node.getAttribute('data-r38-day'));
      var days = node.getAttribute('data-r38-prefix') === 'r38n' ? newWhen.days : sched.days;
      var at = days.indexOf(d);
      if (at >= 0) days.splice(at, 1); else days.push(d);
      if (typeof r30SheetRender === 'function') r30SheetRender();
      return;
    }
    /* ---- 今天页的三个操作 ---- */
    if (node.hasAttribute('data-r38-tok') || node.hasAttribute('data-r38-tskip')) {
      event.preventDefault();
      var tok = node.hasAttribute('data-r38-tok');
      id = node.getAttribute(tok ? 'data-r38-tok' : 'data-r38-tskip');
      node.disabled = true;
      if (!real()) { NS.demoDecide(id, tok ? 'ok' : 'skip'); NS.todayDone(node, tok ? '已照首席的意思办' : '先不做，卡回到待领'); return; }
      send('arrange', id, {action: tok ? 'ok' : 'skip'}, '没成，请再试一次', null).then(function (ok) {
        if (ok) NS.todayDone(node, ok.awaitingConfirmation ?
          '请在「等你处理」里核对对象，再确认一次' : tok ? '已照首席的意思办' : '先不做，卡回到待领');
        else node.disabled = false;
      });
      return;
    }
    if (node.hasAttribute('data-r38-tswap')) {
      event.preventDefault();
      var li = node.closest('li');
      var holder = li && li.querySelector('.r38-acts');
      if (!holder) return;
      var open = holder.querySelector('.r38-pick');
      if (open) { open.remove(); return; }
      if (typeof r30LoadPeople === 'function') r30LoadPeople();
      holder.insertAdjacentHTML('beforeend', peopleHtml('data-r38-tswap-pick', node.getAttribute('data-r38-tswap')));
      return;
    }
    if (node.hasAttribute('data-r38-tswap-pick')) {
      event.preventDefault();
      id = node.getAttribute('data-r38-tswap-pick');
      var who = typeof r30PersonByKey === 'function' ? r30PersonByKey(node.getAttribute('data-r38-who')) : null;
      if (!who) return;
      if (!real()) { NS.demoDecide(id, 'swap', who); NS.todayDone(node, '已换成' + who.name); return; }
      send('arrange', id, {action: 'swap', who: who.id}, '没换成，请再试一次', null).then(function (ok) {
        if (ok) NS.todayDone(node, ok.awaitingConfirmation ?
          '请在「等你处理」里核对对象，再确认一次' : '已换成' + who.name);
      });
    }
  }
  NS.todayDone = function (node, text) {
    var li = node.closest('li');
    if (li) { li.innerHTML = '<p class="r30l-sub" role="status" style="padding:10px 12px;margin:0">' + e(text) + '</p>'; }
    say(text);
  };
  /* 日期时间、「几点做」这些输入框在重画时保持原样：新建里的天数、模式靠 newWhen 记着。 */
  function resetNew() { newWhen.mode = 'now'; newWhen.days = [1]; }

  /* ---------- 今天页 ---------- */
  function hookToday() {
    var LT = window.R30LT;
    if (!LT || LT.__r38) return;
    LT.__r38 = true;
    var origNormal = LT.normalizeToday;
    LT.normalizeToday = function (raw, tickets, nameOf2) {
      var model = origNormal.apply(this, arguments);
      if (!model || !raw || typeof raw !== 'object') return model;
      var arr = raw.arrangements && raw.arrangements.available !== false ? raw.arrangements : null;
      var proposedIds = {};
      if (arr && Array.isArray(arr.items)) {
        var fresh = [];
        arr.items.slice(0, 20).forEach(function (p) {
          if (!p || typeof p.id !== 'string') return;
          proposedIds[p.id] = true;
          fresh.push({kind: 'ticket', tag: p.stalled ? '首席没能安排' : '首席建议', id: p.id, bot: '', name: '', title: clip(p.title, 80) || '（无标题）',
            sub: clip(p.text || '', 160), act: '看详情', prop: {id: p.id, hasPlan: !!p.who, needs: (Array.isArray(p.needs) ? p.needs : []).map(function (n) { return clip(n && n.text, 100); }).filter(Boolean)}});
        });
        if (fresh.length) {
          model.waiting.available = true;
          model.waiting.items = fresh.concat(model.waiting.items.filter(function (i) { return !(i && i.kind === 'ticket' && proposedIds[i.id]); }));
        }
      }
      var lf = raw.launchFailed && raw.launchFailed.available !== false ? raw.launchFailed : null;
      if (lf && Array.isArray(lf.items)) {
        lf.items.slice(0, 10).forEach(function (f) {
          if (!f || typeof f.id !== 'string') return;
          model.waiting.available = true;
          model.waiting.items.push({kind: 'ticket', tag: '没叫动 ' + extShown(f.name), id: f.id, bot: '', name: '', title: clip(f.title, 80) || '（无标题）',
            sub: clip(f.reason, 120) + '；这张卡还在等它来拿', act: '去看看'});
        });
      }
      var sch = raw.schedules && raw.schedules.available !== false ? raw.schedules : null;
      if (sch) {
        var rout = model.routines || {available: false, note: '', paused: false, items: []};
        var miss = sch.missed && Number(sch.missed.count) > 0 ? Number(sch.missed.count) : 0;
        if ((Array.isArray(sch.items) && sch.items.length) || miss) rout.available = true;
        (Array.isArray(sch.items) ? sch.items : []).slice(0, 30).forEach(function (it) {
          if (!it || typeof it.id !== 'string') return;
          var st = it.template ? (it.child ? (it.child.state === 'completed' ? '今天的做完了' : it.child.state === 'progress' ? '今天的在做' : '今天的已派出') : '还没到点')
            : it.state === 'fired' ? '已到点' : it.state === 'missed' ? '没赶上' : it.state === 'paused' ? '已暂停' : '等到点';
          var tone = it.state === 'missed' ? 'bad' : it.state === 'paused' ? 'mute' : it.template && it.child ? 'run' : it.state === 'fired' ? 'good' : 'wait';
          var at = it.template ? it.time : (it.text ? String(it.text).replace(/^.*?(\d\d:\d\d)$/, '$1') : '');
          rout.items.push({kind: 'ticket', id: it.id, bot: it.assignee || '', name: it.assignee ? shownName(it.assignee, it.assigneeType) : '首席安排',
            title: clip(it.title, 40) || '（未命名）', at: clip(at, 8), state: st, tone: tone});
        });
        if (miss) rout.note = '有 ' + miss + ' 个定时没赶上' + (rout.note ? '；' + rout.note : '');
        model.routines = rout;
      }
      return model;
    };
    var origMount = LT.mountToday;
    LT.mountToday = function (host, model, opts) {
      var inner = opts && opts.onOpen;
      var wrapped = Object.assign({}, opts || {}, {onOpen: function (item, block) {
        if (item && item.prop && !real()) {
          try {
            Hub.navigate({view: 'kanban'});
            setTimeout(function () { if (window.R30Board) window.R30Board.open(item.id); }, 200);
          } catch (x) {}
          return;
        }
        if (inner) inner(item, block);
      }});
      var out = origMount.call(this, host, model, wrapped);
      try { decorate(host); } catch (x) {}
      return out;
    };
    var origDemo = LT.demoToday;
    LT.demoToday = function () {
      var model = origDemo.apply(this, arguments);
      if (!model) return model;
      NS.demoList().forEach(function (d) {
        if (d.gone) return;
        if (d.kind === 'propose' && d.stage === 1 && !d.decided) {
          model.waiting.items.unshift({kind: 'ticket', tag: '首席建议', id: d.id, bot: '', name: '', title: clip(d.title, 80),
            sub: '首席建议：交给 ' + shownName(d.who) + '，现在做，因为这是对外发布的事', act: '看详情',
            prop: {id: d.id, hasPlan: true, needs: ['这是对外发送或公开发布，要先确认']}});
        }
      });
      return model;
    };
  }
  /* 今天页：给「首席建议」那几行补上三个操作。 */
  function decorate(host) {
    if (!host || !host.__r30Refs) return;
    var rows = host.querySelectorAll('[data-r30l-open]');
    Array.prototype.forEach.call(rows, function (btn) {
      var ref = host.__r30Refs[Number(btn.getAttribute('data-r30l-open'))];
      var item = ref && ref.item;
      if (!item || !item.prop) return;
      var li = btn.closest('li');
      if (!li || li.querySelector('.r38-acts')) return;
      btn.classList.add('r38-has-acts');
      var id = e(item.prop.id);
      li.insertAdjacentHTML('beforeend', '<div class="r38-acts">' +
        (item.prop.needs.length ? '<p class="r38-why">为什么要你点头：' + e(item.prop.needs.join('；')) + '</p>' : '') +
        (item.prop.hasPlan ? '<button type="button" class="r38-yes" data-r38-tok="' + id + '">就这么办</button>' : '') +
        '<button type="button" data-r38-tswap="' + id + '">换个人</button><button type="button" data-r38-tskip="' + id + '">先不做</button></div>');
    });
  }

  /* ---------- 演示：首席自动安排一张、等你点头一张、定时一张（假时钟加速） ---------- */
  var STAGE_COL = {arrange: ['queued', 'queued', 'progress', 'review'], propose: ['queued', 'attention', 'progress', 'review'], sched: ['queued', 'queued', 'progress', 'review']};
  var demo = null;
  var seq = 0;
  var FAKE_START = 9 * 60 + 0; // 演示的假时钟：早上 9 点整
  var fake = FAKE_START;
  function pickWorker(nth) {
    var bots = typeof state !== 'undefined' && state && state.bots ? state.bots : [];
    var prefer = ['research', 'content', 'writer', 'pm', 'art'];
    var ok = [];
    prefer.forEach(function (id) {
      bots.forEach(function (b) { if (b && b.id === id && !b.steward && !b.parent && b.enabled !== false) ok.push(id); });
    });
    bots.forEach(function (b) { if (b && b.id && !b.steward && !b.parent && b.enabled !== false && b.role !== 'chief' && ok.indexOf(b.id) < 0) ok.push(b.id); });
    return ok.length ? ok[(nth || 0) % ok.length] : '';
  }
  function makeDemo(kind, title, goal, fresh, whenAt) {
    seq += 1;
    return {id: 'r38-demo-' + seq, kind: kind, title: title, goal: goal, stage: 0, started: false, created: Date.now() - 20000, who: '', fresh: !!fresh,
      due: kind === 'sched' ? (whenAt == null ? fake + 3 : whenAt) : null, decided: '', fakeAt: fake};
  }
  function ensureDemo() {
    if (demo) return demo;
    var a = pickWorker(0);
    if (!a) return null;
    var d1 = makeDemo('arrange', '给读书会起个名字', '用一句话给读书会起个名字。', false);
    d1.who = a;
    var d2 = makeDemo('propose', '把名字发到公司对外的公众号上', '把定下来的名字发到公司对外的公众号上。', false);
    d2.who = pickWorker(1) || a;
    var d3 = makeDemo('sched', '每天早上整理读书会的新留言', '早上 9 点十分整理一遍读书会收到的新留言。', false, fake + 3);
    d3.who = pickWorker(2) || a;
    demo = [d1, d2, d3];
    return demo;
  }
  function clockText(min) { return pad(Math.floor(min / 60) % 24) + ':' + pad(min % 60); }
  NS.demoActive = function () { return !real() && !!ensureDemo() && demo.length > 0; };
  NS.demoList = function () {
    return real() || !ensureDemo() ? [] : demo.map(function (d) {
      var local = typeof r30Local === 'object' && r30Local[d.id] || {};
      return {id: d.id, kind: d.kind, title: d.title, stage: d.stage, who: d.who, decided: d.decided, gone: !!local.gone, done: local.col === 'done'};
    });
  };
  NS.demoState = function () { return (demo || []).map(function (d) { return {id: d.id, kind: d.kind, stage: d.stage, who: d.who, decided: d.decided}; }); };
  NS.demoClock = function () { return clockText(fake); };
  NS.demoCreate = function (title, goal, kind, when) {
    ensureDemo();
    demo = demo || [];
    var d = makeDemo(kind === 'arrange' ? 'arrange' : 'sched', title, goal, true, when && when.kind === 'once' ? fake + 3 : fake + 3);
    d.who = pickWorker(demo.length);
    d.created = Date.now();
    if (when && when.kind !== 'once') d.repeat = when;
    demo.unshift(d);
    resetNew();
    if (typeof r29DeskPaint === 'function') r29DeskPaint();
  };
  NS.demoDecide = function (id, action, person) {
    (demo || []).forEach(function (d) {
      if (d.id !== id || d.kind !== 'propose' || d.stage !== 1 || d.decided) return;
      d.decided = action;
      if (action === 'ok') d.stage = 2;
      else if (action === 'swap' && person) { d.who = person.id; d.stage = 2; }
      else { d.stage = 0; d.kind = 'plain'; }
    });
    NS.swapFor = '';
    if (typeof r30CloseSheet === 'function') r30CloseSheet();
    if (typeof r29DeskPaint === 'function') r29DeskPaint();
  };
  function demoRowOf(d) {
    var over = typeof r30Local === 'object' && r30Local[d.id] || {};
    if (over.gone) return null;
    var who = shownName(d.who);
    var arr = null;
    var sc = null;
    var line;
    if (d.kind === 'arrange' || d.kind === 'propose') {
      var why = d.kind === 'propose' ? '这是对外发布的事，要先让你点头' : '这类事归' + who + '管，交给它最稳';
      if (d.stage === 0) arr = {state: 'wanted', via: 'new', note: '', needs: [], hasPlan: false, stalled: false, askText: ''};
      else if (d.kind === 'propose' && d.stage === 1) arr = {state: 'proposed', via: 'new', note: '首席建议：交给 ' + who + '，现在做。因为' + why, needs: ['这是对外发送或公开发布，要先确认'], hasPlan: true, stalled: false, askText: ''};
      else arr = {state: 'applied', via: 'new', note: '首席安排：交给 ' + who + '，现在做。因为' + why, needs: [], hasPlan: true, stalled: false, askText: ''};
      line = d.stage === 0 ? '交给首席安排，等它给结论' : arr.state === 'proposed' ? '首席建议了，等你点头'
        : d.stage === 2 ? who + '已接手，正在做' : d.stage === 3 ? who + '交回，等你验收' : '首席安排给了' + who + '，等它接手';
    } else if (d.kind === 'sched') {
      var left = d.due - fake;
      sc = {kind: 'once', state: d.stage >= 1 ? 'fired' : 'waiting', template: false, text: '今天 ' + clockText(d.due), who: who, whoId: d.who, whoType: 'assistant', missed: 0, by: 'owner', firedAt: ''};
      line = d.stage === 0 ? (left > 0 ? '演示时钟 ' + clockText(fake) + '，还有 ' + left + ' 分钟到点，' + who + '做' : '到点了') :
        d.stage === 1 ? '到点了，叫醒' + who : d.stage === 2 ? who + '已接手，正在做' : who + '交回，等你验收';
    } else {
      line = '没人接，先放着';
    }
    var person = d.stage >= 1 || (d.kind === 'sched') ? (typeof r29DeskPerson === 'function' ? r29DeskPerson({id: d.who, type: 'assistant'}) : null) : null;
    var stages = STAGE_COL[d.kind === 'plain' ? 'arrange' : d.kind];
    var col = d.kind === 'plain' ? 'queued' : stages[d.stage];
    if (over.col && ['queued', 'progress', 'review', 'attention', 'done'].indexOf(over.col) >= 0) col = over.col;
    var title = over.title || d.title;
    return {id: d.id, col: col, title: clip(title, 40), rawTitle: title, line: line, faces: [], people: person ? [person] : [], time: '',
      iso: new Date(d.created).toISOString(), stamp: d.fresh ? Date.now() : d.created, assignee: d.kind === 'arrange' && d.stage === 0 ? null : person,
      goal: d.goal, locked: false, summary: d.stage === 3 ? '定了三个备选名，推荐第一个。' : '', verified: '', unmet: '', arr: arr, sc: sc};
  }
  NS.demoRows = function () {
    if (real() || !ensureDemo()) return [];
    return demo.map(demoRowOf).filter(Boolean);
  };
  NS.tick = function () {
    if (!ensureDemo()) return false;
    var moved = false;
    fake += 1;
    demo.forEach(function (d) {
      if (!d.started) { d.started = true; return; }
      if (d.kind === 'arrange' && d.stage < 3) { d.stage += 1; moved = true; }
      else if (d.kind === 'propose' && d.stage === 0) { d.stage = 1; moved = true; }
      else if (d.kind === 'propose' && d.stage >= 2 && d.stage < 3) { d.stage += 1; moved = true; }
      else if (d.kind === 'sched') {
        if (d.stage === 0 && fake >= d.due) { d.stage = 1; moved = true; }
        else if (d.stage >= 1 && d.stage < 3) { d.stage += 1; moved = true; }
        else if (d.stage === 0) moved = true; // 假时钟在走，卡上的倒计时要刷新
      }
    });
    if (moved && typeof r29DeskPaint === 'function') r29DeskPaint();
    return moved;
  };
  NS.replay = function (quiet) {
    (demo || []).forEach(function (d) { if (typeof r30Local === 'object' && r30Local[d.id]) delete r30Local[d.id]; });
    demo = null;
    fake = FAKE_START;
    NS.swapFor = '';
    ensureDemo();
    if (typeof r29DeskPaint === 'function') r29DeskPaint();
    if (!quiet) say('从头再走一遍');
  };
  var timer = null;
  function visibleBoard() { return typeof state !== 'undefined' && state.mode === 'kanban' && !document.hidden; }
  function startTimer() {
    if (timer) return;
    var ms = Number(window.__R38_TICK_MS) > 0 ? Number(window.__R38_TICK_MS) : 3600;
    timer = setInterval(function () {
      if (real() || !visibleBoard()) return;
      NS.tick();
    }, ms);
  }
  function onReplay(event) {
    var t = event.target && event.target.closest ? event.target : null;
    if (t && t.closest('[data-r32-replay], [data-r35-replay], [data-r38-replay]') && !real()) NS.replay(true);
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var ok = install();
    hookToday();
    if (!ok) return;
    document.addEventListener('click', onClick);
    document.addEventListener('click', onReplay);
    startTimer();
    var tries = 0;
    var wait = setInterval(function () {
      tries += 1;
      hookToday();
      if (ensureDemo() || tries > 40) {
        clearInterval(wait);
        if (typeof r29DeskPaint === 'function' && typeof state !== 'undefined' && state.mode === 'kanban') r29DeskPaint();
      }
    }, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
