/* 开放认领：任务板上没人指派的任务，助理自己接走。
 * 这一份脚本接在看板（js/views/board.js）和今天页（js/r30-ledger-today.js）后面，不改它们的主体：
 *   - 新建卡：负责人那一排第一项是「谁有空谁接」；选了它，卡仍在「待领」，带一个「等人接」的小标；
 *   - 卡片：等人接时显示「等人接」；被接走后显示「首席派给了 X」（点开能看首席写的理由）或「X 接走了」；
 *     首席拿不准转来问你的，显示「首席在问你」，点开可以直接回答，回答后卡回到「谁有空谁接」；
 *   - 点开一张没人接的卡：能一键改成「谁有空谁接」（派给谁那一排第一项）；
 *   - 今天页：「挂着没人接的」一块（超过设定分钟数还没人接才列，默认 15 分钟）；
 *     首席停用时，开放的卡不会自动派出，「等你处理」里会明说，等你自己挑；
 *   - 演示模式：一张会自动被接走的演示卡（等人接 → 首席派给调研 → 在做 → 等验收），可重播。
 * 真实模式里数据来自后端卡上的 openClaim 字段；没有它的卡完全不受影响。
 * 对外：window.R35Claim。 */
(function () {
  'use strict';
  if (window.R35Claim) return;
  var NS = window.R35Claim = {};

  /* ---------- 小工具 ---------- */
  function e(value) { return typeof esc === 'function' ? esc(value) : String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function clip(value, n) { return Array.from(String(value == null ? '' : value)).slice(0, n).join(''); }
  function real() { try { return document.documentElement.dataset.hubMode === 'real'; } catch (x) { return false; } }
  function say(text) { try { if (typeof toast === 'function') toast(text); } catch (x) {} }
  function wrap(name, make) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__r35) return false;
    var next = make(orig);
    next.__r35 = true;
    window[name] = next;
    return true;
  }
  var DEFAULT_MINUTES = 15;
  var OPEN_PERSON = {id: 'open', key: 'open', name: '谁有空谁接', roster: false, type: 'open', open: true};

  function shownName(id, type) {
    if (!id) return '';
    if (typeof r29DeskShown === 'function' && typeof r29DeskActor === 'function') {
      var s = r29DeskShown(r29DeskActor(id, type || 'assistant'));
      if (s) return String(s).replace(/^外部 · /, '');
    }
    return String(id);
  }

  /* ---------- 卡上的开放认领 → 界面要用的小模型 ---------- */
  NS.model = function (oc, ticket) {
    if (!oc || typeof oc !== 'object') return null;
    var state = oc.state;
    var m = {state: state, via: oc.via || '', reason: String(oc.reason || ''), answer: String(oc.answer || ''), by: oc.takenBy || '',
      byName: '', ask: ticket && ticket.open_ask && ticket.open_ask.text ? String(ticket.open_ask.text) : '', since: oc.reopenedAt || oc.openedAt || ''};
    if (state === 'taken') {
      var shown = oc.takenType === 'owner' ? '你' : shownName(oc.takenBy, oc.takenType || 'assistant');
      m.byName = shown || String(oc.takenShown || oc.takenBy || '');
    }
    m.label = NS.label(m);
    return m;
  };
  NS.label = function (m) {
    if (!m) return '';
    if (m.state === 'open') return '等人接';
    if (m.state === 'asked') return '首席在问你';
    if (m.state === 'taken') {
      if (m.via === 'chief') return '首席派给了' + m.byName;
      if (m.via === 'external') return m.byName + ' 接走了';
    }
    return '';
  };
  function chipHtml(m) {
    if (!m || !m.label) return '';
    var cls = m.state === 'open' ? 'is-open' : m.state === 'asked' ? 'is-asked' : 'is-taken';
    return '<span class="r35-chip ' + cls + '" data-r35-chip="' + e(m.state) + '">' +
      (m.state === 'open' ? '<i class="r35-pulse" aria-hidden="true"></i>' : '') + e(m.label) + '</span>';
  }
  NS.chipHtml = chipHtml;

  /* ---------- 接上看板：包一层，不改原文件 ---------- */
  function install() {
    if (typeof r29DeskFromTicket !== 'function' || typeof r30CardHtml !== 'function') return false;
    wrap('r29DeskFromTicket', function (orig) {
      return function (ticket) {
        var row = orig(ticket);
        var m = row && ticket ? NS.model(ticket.openClaim, ticket) : null;
        if (m) {
          row.open = m;
          if (m.state === 'open') { row.line = '没人接，等首席挑人'; row.assignee = null; }
          else if (m.state === 'asked') row.line = '首席拿不准，在问你';
        }
        return row;
      };
    });
    wrap('r30CardHtml', function (orig) {
      return function (row, phone) {
        var html = orig(row, phone);
        if (!row || !row.open || !row.open.label) return html;
        var chip = '<div class="r35-chips">' + chipHtml(row.open) + '</div>';
        html = html.replace('<article class="', '<article data-r35-card="' + e(row.open.state) + '" class="');
        var at = html.indexOf('<time class="r29-desk-time"');
        if (at < 0) at = html.lastIndexOf('</article>');
        return html.slice(0, at) + chip + html.slice(at);
      };
    });
    /* 点开卡：最上面一块说明这张卡的来历；没人接的普通卡，「派给谁」第一项是「谁有空谁接」。 */
    wrap('r30ActionsHtml', function (orig) {
      return function (row) {
        var html = orig(row);
        if (!row) return html;
        var box = NS.boxHtml(row);
        if (canOpen(row)) {
          var marker = '<div class="r30-people" role="group" aria-label="派给谁">';
          html = html.replace(marker, marker + '<button type="button" class="r30-who r35-whoopen" data-r35-open="' + e(row.id) + '">' +
            '<span class="r35-ico" aria-hidden="true">✋</span><span>谁有空谁接</span></button>');
        }
        return box ? html.replace('<div class="r30-actions">', '<div class="r30-actions">' + box) : html;
      };
    });
    /* 新建：负责人那一排第一项。 */
    wrap('r30NewHtml', function (orig) {
      return function () {
        var html = orig();
        var marker = '<div class="r30-people" role="group" aria-label="交给谁">';
        var s = typeof r30Sheet !== 'undefined' && r30Sheet ? r30Sheet : null;
        return html.replace(marker, marker + '<button type="button" class="r30-who r30-give r35-give" data-r30-newgo="open"' +
          (s && s.busy ? ' disabled' : '') + '><span class="r35-ico" aria-hidden="true">✋</span><span>谁有空谁接</span></button>');
      };
    });
    wrap('r30PersonByKey', function (orig) {
      return function (key) { return key === 'open' ? OPEN_PERSON : orig.apply(this, arguments); };
    });
    wrap('r30Say', function (orig) {
      return function (text) { return orig.call(this, text === '已交给谁有空谁接' ? '已挂出去：谁有空谁接' : text); };
    });
    wrap('r30Create', function (orig) {
      return function (title, goal, person, col) {
        if (!person || !person.open) return orig.apply(this, arguments);
        title = String(title || '').trim();
        goal = String(goal || '').trim();
        if (!title) { say('先写个标题'); return Promise.resolve(false); }
        if (!(typeof r29DeskReal === 'function' ? r29DeskReal() : real())) { NS.demoCreate(title, goal); return Promise.resolve(true); }
        var payload = {title: title, open: true};
        if (goal) payload.goal = goal;
        return r30Done(r30Send('create', '', payload), function () { say('没建成，请再试一次'); });
      };
    });
    wrap('r29DeskDemoRows', function (orig) {
      return function () { return orig().concat(NS.demoRows()); };
    });
    return true;
  }
  /* 没人接、没负责人、不是接力、不是旧单：才能改成「谁有空谁接」。 */
  function canOpen(row) {
    return !!row && real() && !row.locked && !row.relay && !row.open && row.col === 'queued' && !row.assignee;
  }
  NS.boxHtml = function (row) {
    var m = row && row.open;
    if (!m) return '';
    var id = e(row.id);
    if (m.state === 'open') {
      return '<div class="r35-box is-open"><strong>等人接</strong><p>这张卡挂着「谁有空谁接」：先叫醒首席助理挑一位最合适的，' +
        '外部成员也可以直接领走，先到先得。你也可以直接在下面点一位派给他。</p></div>';
    }
    if (m.state === 'asked') {
      return '<div class="r35-box is-asked"><strong>首席在问你</strong><p>' + e(m.ask || '首席拿不准派给谁，想先听你一句。') + '</p>' +
        '<div class="r30-form" data-r30-form><label>你的回答<textarea name="r35answer" rows="2" maxlength="1000" placeholder="一两句话就行"></textarea></label></div>' +
        '<div class="r30-row"><button type="button" class="r30-primary" data-r35-answer="' + id + '">回答，让首席接着派</button></div></div>';
    }
    if (m.state === 'taken' && m.via === 'chief') {
      return '<div class="r35-box is-taken"><strong>首席派给了' + e(m.byName) + '</strong>' +
        (m.reason ? '<p>为什么给它：' + e(m.reason) + '</p>' : '') + '</div>';
    }
    if (m.state === 'taken' && m.via === 'external') {
      return '<div class="r35-box is-taken"><strong>' + e(m.byName) + ' 接走了</strong><p>它自己从任务板上领走的，先到先得。</p></div>';
    }
    return '';
  };

  /* ---------- 点击 ---------- */
  function onClick(event) {
    var t = event.target && event.target.closest ? event.target : null;
    if (!t) return;
    var openBtn = t.closest('[data-r35-open]');
    if (openBtn && real()) {
      event.preventDefault();
      var id = openBtn.getAttribute('data-r35-open');
      if (typeof r30Send !== 'function') return;
      openBtn.disabled = true;
      r30Done(r30Send('assign', id, {open: true}), function () { say('没改成，卡还是原来的'); }).then(function (ok) {
        if (ok) {
          if (typeof r30CloseSheet === 'function') r30CloseSheet();
          say('已挂出去：谁有空谁接');
        } else openBtn.disabled = false;
      });
      return;
    }
    var ans = t.closest('[data-r35-answer]');
    if (ans && real()) {
      event.preventDefault();
      var aid = ans.getAttribute('data-r35-answer');
      var box = ans.closest('.r35-box');
      var field = box && box.querySelector('[name=r35answer]');
      var text = field ? String(field.value || '').trim() : '';
      if (!text) { say('先写一句回答'); if (field) field.focus(); return; }
      ans.disabled = true;
      r30Done(r30Send('answer', aid, {text: text}), function () { say('没发出去，请再试一次'); }).then(function (ok) {
        if (ok) {
          if (typeof r30CloseSheet === 'function') r30CloseSheet();
          say('已回答，首席会接着派');
        } else ans.disabled = false;
      });
      return;
    }
    /* 演示里板头只有一个「重播」（接力那个），点它时认领演示卡也一起从头再来。 */
    if (t.closest('[data-r32-replay], [data-r35-replay]') && !real()) NS.replay(true);
  }

  /* ---------- 今天页 ---------- */
  function waitedMin(since) {
    var t = Date.parse(since);
    return isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 60000)) : 0;
  }
  function openWaiting(t) {
    return !!t && t.openClaim && t.openClaim.state === 'open' && t.state === 'queued' && !t.claimedBy;
  }
  function hookToday() {
    var LT = window.R30LT;
    if (!LT || LT.__r35) return;
    LT.__r35 = true;
    var origNormal = LT.normalizeToday;
    LT.normalizeToday = function (raw, tickets, nameOf2) {
      var model = origNormal.apply(this, arguments);
      if (!model || !Array.isArray(tickets)) return model;
      var oc = raw && raw.openClaims && raw.openClaims.available !== false ? raw.openClaims : null;
      var minutes = oc && Number(oc.minutes) > 0 ? Number(oc.minutes) : DEFAULT_MINUTES;
      var chiefDown = !!oc && oc.chiefUsable === false;
      var chiefName = clip(oc && oc.chiefName || '首席助理', 12);
      var byId = {};
      tickets.forEach(function (t) { if (t && typeof t.id === 'string') byId[t.id] = t; });
      /* 首席转来问你的：标成「首席在问你」。 */
      model.waiting.items.forEach(function (item) {
        var t = item && item.kind === 'ticket' ? byId[item.id] : null;
        if (t && t.openClaim && t.openClaim.state === 'asked') { item.tag = '首席在问你'; item.act = '去回答'; }
      });
      var rows = [];
      var downIds = {};
      tickets.forEach(function (t) {
        if (!openWaiting(t) || typeof t.id !== 'string') return;
        var since = t.openClaim.reopenedAt || t.openClaim.openedAt;
        var n = waitedMin(since);
        if (chiefDown) {
          downIds[t.id] = true;
          model.waiting.available = true;
          model.waiting.items.push({kind: 'ticket', tag: '没人派活', id: t.id, bot: '', name: '', title: clip(t.title, 80) || '（无标题）',
            sub: chiefName + '已停用，这张「谁有空谁接」的卡不会自动派出，你来挑一位', act: '去处理'});
        } else if (n >= minutes) {
          rows.push({kind: 'ticket', tag: '等人接', id: t.id, bot: '', name: '', title: clip(t.title, 80) || '（无标题）',
            sub: '已经挂了 ' + n + ' 分钟，还没人接', act: '去看看', waited: n});
        }
      });
      /* 接单的外部身份已失效（令牌被吊销或配置里删了它）：名下进行中的卡进「等你处理」。 */
      var lost = raw && raw.externalLost && raw.externalLost.available !== false && Array.isArray(raw.externalLost.items) ? raw.externalLost.items : [];
      lost.forEach(function (x) {
        if (!x || typeof x.id !== 'string') return;
        model.waiting.available = true;
        var why = '接单的外部身份「' + clip(x.name, 20) + '」已失效，换人？';
        /* 同一工单已经在「等你处理」里（例如已经卡住）时并成一项：两个原因都留着，只留一个入口。 */
        var hits = model.waiting.items.filter(function (i) { return i && i.id === x.id; });
        if (hits.length) {
          var hit = hits.filter(function (i) { return String(i.tag || '').indexOf('卡住了') >= 0; })[0] || hits[0];
          if (hit.sub && hit.sub.indexOf(why) < 0) hit.sub = hit.sub + '；' + why;
          else if (!hit.sub) hit.sub = why;
          if (!hit.tag) hit.tag = '接单人失效';
          else if (hit.tag.indexOf('接单人失效') < 0) hit.tag = hit.tag + ' · 接单人失效';
          if (String(hit.tag).indexOf('卡住了') >= 0) hit.act = '去换人';
          return;
        }
        model.waiting.items.push({kind: 'ticket', tag: '接单人失效', id: x.id, bot: '', name: '', title: clip(x.title, 80) || '（无标题）',
          sub: why, act: '去换人'});
      });
      rows.sort(function (a, b) { return b.waited - a.waited; });
      model.open = {available: true, note: '', minutes: minutes, items: rows};
      return model;
    };
    var origDemo = LT.demoToday;
    LT.demoToday = function () {
      var model = origDemo.apply(this, arguments);
      if (!model) return model;
      var d = NS.demoList();
      d.forEach(function (x) {
        if (x.gone) return;
        var title = clip(x.title, 80);
        if (x.stage === 3 && !x.done) {
          model.waiting.items.unshift({kind: 'r35', tag: '等你验收', id: x.id, bot: x.who, name: shownName(x.who), title: title,
            sub: '「' + clip(x.title, 20) + '」做完了，等你一键验收', act: '去验收'});
        }
      });
      return model;
    };
    var origMount = LT.mountToday;
    LT.mountToday = function (host, model, opts) {
      var inner = opts && opts.onOpen;
      var wrapped = Object.assign({}, opts || {}, {onOpen: function (item, block) {
        if (item && item.kind === 'r35') {
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

  /* ---------- 演示：一张会自动被接走的卡 ---------- */
  var STAGE_COL = ['queued', 'queued', 'progress', 'review'];
  var demo = null;
  var seq = 0;
  function pickWorker() {
    var bots = typeof state !== 'undefined' && state && state.bots ? state.bots : [];
    var prefer = ['research', 'content', 'writer', 'pm', 'art'];
    for (var i = 0; i < prefer.length; i += 1) {
      for (var j = 0; j < bots.length; j += 1) if (bots[j] && bots[j].id === prefer[i] && !bots[j].steward && !bots[j].parent && bots[j].enabled !== false) return bots[j].id;
    }
    for (var k = 0; k < bots.length; k += 1) if (bots[k] && bots[k].id && !bots[k].steward && !bots[k].parent && bots[k].enabled !== false && bots[k].role !== 'chief') return bots[k].id;
    return '';
  }
  function makeDemo(title, goal, fresh) {
    seq += 1;
    return {id: 'r35-demo-' + seq, title: title, goal: goal, stage: 0, started: false, created: Date.now() - 20000, who: '', fresh: !!fresh};
  }
  function ensureDemo() {
    if (demo) return demo;
    var who = pickWorker();
    if (!who) return null;
    demo = [makeDemo('整理本周读书会的安排', '把读书会这周要定的事理一遍，列出最先要定的一件。', false)];
    demo[0].who = who;
    return demo;
  }
  NS.demoActive = function () { return !real() && !!ensureDemo() && demo.length > 0; };
  NS.demoList = function () { return real() || !ensureDemo() ? [] : demo.map(function (d) { return {id: d.id, title: d.title, stage: d.stage, who: d.who, gone: !!(typeof r30Local === 'object' && r30Local[d.id] && r30Local[d.id].gone), done: !!(typeof r30Local === 'object' && r30Local[d.id] && r30Local[d.id].col === 'done')}; }); };
  NS.demoState = function () { return (demo || []).map(function (d) { return {id: d.id, stage: d.stage, who: d.who}; }); };
  NS.demoCreate = function (title, goal) {
    ensureDemo();
    demo = demo || [];
    var d = makeDemo(title, goal, true);
    d.who = pickWorker();
    d.created = Date.now();
    demo.unshift(d);
    if (typeof r29DeskPaint === 'function') r29DeskPaint();
  };
  function demoRowOf(d) {
    var over = typeof r30Local === 'object' && r30Local[d.id] || {};
    if (over.gone) return null;
    var oc = {state: d.stage === 0 ? 'open' : 'taken', via: d.stage === 0 ? '' : 'chief', takenBy: d.who, takenType: 'assistant',
      reason: d.stage === 0 ? '' : '这类事归' + shownName(d.who) + '管，交给它最稳', openedAt: new Date(d.created).toISOString()};
    var m = NS.model(oc, null);
    var person = d.stage >= 1 && typeof r29DeskPerson === 'function' ? r29DeskPerson({id: d.who, type: 'assistant'}) : null;
    var col = over.col ? (['queued', 'progress', 'review', 'attention', 'done'].indexOf(over.col) >= 0 ? over.col : STAGE_COL[d.stage]) : STAGE_COL[d.stage];
    var line = d.stage === 0 ? '没人接，等首席挑人' : d.stage === 1 ? '首席派给了' + shownName(d.who) + '，等它接手'
      : d.stage === 2 ? shownName(d.who) + '已接手，正在做' : shownName(d.who) + '交回，等你验收';
    var title = over.title || d.title;
    return {id: d.id, col: col, title: clip(title, 40), rawTitle: title, line: line, faces: [], people: person ? [person] : [], time: '',
      iso: new Date(d.created).toISOString(), stamp: d.fresh ? Date.now() : d.created, assignee: person, goal: d.goal, locked: false,
      summary: d.stage === 3 ? '最先要定的是：这次读什么书。' : '', verified: '', unmet: '', open: m};
  }
  NS.demoRows = function () {
    if (real() || !ensureDemo()) return [];
    return demo.map(demoRowOf).filter(Boolean);
  };
  NS.tick = function () {
    if (!ensureDemo()) return false;
    var moved = false;
    demo.forEach(function (d) {
      if (!d.started) { d.started = true; return; }
      if (d.stage < 3) { d.stage += 1; moved = true; }
    });
    if (moved && typeof r29DeskPaint === 'function') r29DeskPaint();
    return moved;
  };
  NS.replay = function (quiet) {
    (demo || []).forEach(function (d) { if (typeof r30Local === 'object' && r30Local[d.id]) delete r30Local[d.id]; });
    demo = null;
    ensureDemo();
    if (typeof r29DeskPaint === 'function') r29DeskPaint();
    if (!quiet) say('从头再走一遍');
  };
  var timer = null;
  function visibleBoard() { return typeof state !== 'undefined' && state.mode === 'kanban' && !document.hidden; }
  function startTimer() {
    if (timer) return;
    var ms = Number(window.__R35_TICK_MS) > 0 ? Number(window.__R35_TICK_MS) : 3600;
    timer = setInterval(function () {
      if (real() || !visibleBoard()) return;
      NS.tick();
    }, ms);
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var ok = install();
    hookToday();
    if (!ok) return;
    document.addEventListener('click', onClick);
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
