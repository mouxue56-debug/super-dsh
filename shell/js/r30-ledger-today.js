/* · 账本页与今天页的结构化画法。
 * 只负责把整理好的数据画成卡片、柱状图、横条和行卡；所有文字一律转义。
 * 两种数据来源：演示（读界面壳自带的假数据）和真实（适配层把后端返回的原样交给 normalize*）。
 * 对外：window.R30LT = { normalizeLedger, normalizeToday, mountLedger, mountToday, demoLedger, demoToday }。 */
(function () {
  'use strict';
  var NS = window.R30LT = {};
  var SVG = {
    wait: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 19a2 2 0 0 0 4 0"/>',
    doing: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 ' +
      '15.6l-2.8 2.8"/>',
    done: '<path d="M20 6L9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    go: '<path d="M9 6l6 6-6 6"/>'
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function icon(name, size) {
    var px = size || 18;
    return '<svg class="r30l-ico" viewBox="0 0 24 24" width="' + px + '" height="' + px +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + SVG[name] + '</svg>';
  }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function line(v, max) {
    var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return Array.from(s).length > max ? Array.from(s).slice(0, max).join('') + '…' : s;
  }
  function hubState() { return window.Hub && Hub.state ? Hub.state : (typeof state !== 'undefined' ? state : null); }

  /* ---------- 头像与名字 ---------- */
  function botInfo(id) {
    var st = hubState(), bots = st && Array.isArray(st.bots) ? st.bots : [];
    for (var i = 0; i < bots.length; i++) if (bots[i] && bots[i].id === id) return bots[i];
    return null;
  }
  function botColor(id) {
    var b = botInfo(id);
    return b && /^#[0-9a-fA-F]{3,8}$/.test(String(b.color || '')) ? b.color : '';
  }
  function avatar(id, px, name) {
    var api = window.HubAvatars;
    if (id && api && typeof api.html === 'function' && botInfo(id)) {
      try {
        var html = api.html(id, px);
        if (typeof html === 'string' && html.trim()) return '<span class="r30l-face" style="--s:' + px + 'px">' + html +
          '</span>';
      } catch (error) { /* 退回首字圆点 */ }
    }
    var first = Array.from(String(name || id || '助'))[0] || '助';
    var color = botColor(id);
    return '<span class="r30l-dot" style="--s:' + px + 'px' + (color ? ';--c:' + color : '') + '" aria-hidden="true">' +
      esc(first) + '</span>';
  }

  /* ---------- 数字格式 ---------- */
  function fmtTokens(n) {
    if (n == null) return '用量未知';
    if (n < 10000) return '用量 ' + n.toLocaleString('zh-CN');
    if (n < 100000000) return '用量 ' + (Math.round(n / 1000) / 10) + ' 万';
    return '用量 ' + (Math.round(n / 10000000) / 10) + ' 亿';
  }
  function fmtTokensShort(n) {
    if (n == null) return '未知';
    if (n < 10000) return String(n);
    if (n < 100000000) return (Math.round(n / 1000) / 10) + '万';
    return (Math.round(n / 10000000) / 10) + '亿';
  }
  var SYMBOL = { CNY: '¥', USD: '$', JPY: 'JP¥', EUR: '€' };
  function money(cur, n) {
    if (typeof n !== 'number' || !isFinite(n)) return '金额未知';
    var s = SYMBOL[cur] || (cur + ' ');
    if (n > 0 && n < 0.01) return s + '<0.01';
    return s + (n >= 100 ? Math.round(n).toLocaleString('zh-CN') : n.toFixed(2));
  }
  function costText(cost, calls) {
    if (!cost) return '费用未知';
    var parts = Object.keys(cost.byCur).map(function (cur) { return money(cur, cost.byCur[cur]); });
    if (parts.length) return parts.join(' + ');
    if (cost.pending > 0) return '仅记录用量';
    if (cost.plan > 0) return '套餐内';
    if (cost.local > 0) return '本地模型，不计费';
    return calls === 0 ? '¥0.00' : '费用未知';
  }
  var TOKEN_LABELS = { input: '输入', cacheRead: '缓存命中', cacheWrite: '缓存写', output: '输出' };
  function tokenParts(b) {
    if (!b || !b.tokenParts) return '';
    return Object.keys(TOKEN_LABELS).map(function (key) {
      return TOKEN_LABELS[key] + ' ' + (b.tokenParts[key] == null ? '未上报' :
        b.tokenParts[key].toLocaleString('zh-CN'));
    }).join(' · ');
  }
  function primaryCurrency(buckets) {
    var sums = {};
    buckets.forEach(function (b) {
      if (b && b.cost) Object.keys(b.cost.byCur).forEach(function (c) { sums[c] = (sums[c] || 0) + b.cost.byCur[c]; });
    });
    var keys = Object.keys(sums).sort(function (a, b) { return sums[b] - sums[a]; });
    return keys[0] || '';
  }
  function amountOf(bucket, cur) { return bucket && bucket.cost && cur ? bucket.cost.byCur[cur] || 0 : 0; }
  function addBuckets(items) {
    var out = { calls: 0, tokens: 0, tokensKnown: false, cost: { byCur: {}, pending: 0, plan: 0, local: 0 } };
    var parts = {};
    items.forEach(function (b) {
      if (!b) return;
      Object.keys(b.tokenParts || {}).forEach(function (k) {
        parts[k] = (parts[k] || 0) + b.tokenParts[k];
      });
      out.calls += b.calls || 0;
      if (b.tokens != null) { out.tokens += b.tokens; out.tokensKnown = true; }
      Object.keys(b.cost.byCur).forEach(function (c) { out.cost.byCur[c] = (out.cost.byCur[c] || 0) +
        b.cost.byCur[c]; });
      ['pending', 'plan', 'local'].forEach(function (k) { out.cost[k] += b.cost[k] || 0; });
    });
    return { calls: out.calls, tokens: out.tokensKnown || out.calls === 0 ? out.tokens : null,
      tokenParts: Object.keys(parts).length ? parts : null, cost: out.cost };
  }
  /* 后端的一个汇总桶 → 界面用的桶。拿不到就返回 null，不编数字。 */
  function bucket(b) {
    if (!isObj(b)) return null;
    var calls = isInt(b.calls) ? b.calls : null;
    if (calls === null) return null;
    var keys = Object.keys(TOKEN_LABELS), sum = 0, any = false, parts = {};
    var un = isObj(b.unreportedFields) ? b.unreportedFields : {};
    keys.forEach(function (k) {
      if (calls > 0 && (+un[k] || 0) >= calls) return;
      if (isObj(b.tokens) && typeof b.tokens[k] === 'number' &&
        isFinite(b.tokens[k]) && b.tokens[k] >= 0) {
        sum += b.tokens[k]; parts[k] = b.tokens[k]; any = true;
      }
    });
    var unknown = calls > 0 && !any;
    var c = isObj(b.cost) ? b.cost : {}, byCur = {};
    Object.keys(isObj(c.byCurrency) ? c.byCurrency : {}).forEach(function (cur) {
      var v = c.byCurrency[cur] || {}, n = (+v.ok || 0) + (+v.expired || 0);
      if (isFinite(n) && n >= 0 && isObj(v)) byCur[cur] = n;
    });
    return { calls: calls, tokens: calls === 0 ? 0 : unknown ? null : sum, tokenParts: any ? parts : null,
      cost: { byCur: byCur, pending: +c.pendingCalls || 0, plan: +c.planCalls || 0, local: +c.localCalls || 0 } };
  }

  /* ---------- 账本数据整理（真实） ---------- */
  function dateKeys(endKey, n) {
    var end = Date.parse(endKey + 'T00:00:00Z'), out = [];
    if (!isFinite(end)) return out;
    for (var i = n - 1; i >= 0; i--) out.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
    return out;
  }
  NS.normalizeLedger = function (raw, nameOf) {
    var all = raw && raw.all, today = raw && raw.today, name = typeof nameOf === 'function' ? nameOf :
      function (x) { return x; };
    if (!isObj(all) || !bucket(all.total)) return null;
    var seven = isObj(all.last7Days) ? all.last7Days : {};
    var sevenDays = list(seven.days);
    var endKey = sevenDays.length ? String(sevenDays[sevenDays.length - 1].date || '') : '';
    var byDay = isObj(all.byDay) ? all.byDay : {};
    var days = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(endKey)) {
      dateKeys(endKey, 14).forEach(function (key) {
        var fromSeven = sevenDays.filter(function (d) { return d && d.date === key; })[0];
        var b = bucket(fromSeven) || bucket(byDay[key]) || (Object.keys(byDay).length ? bucket({ calls: 0 }) : null);
        days.push({ date: key, b: b });
      });
    }
    var monthKey = endKey.slice(0, 7), monthBuckets = [];
    Object.keys(byDay).forEach(function (key) { if (key.slice(0,
      7) === monthKey) monthBuckets.push(bucket(byDay[key])); });
    var week = bucket(seven.total);
    var periods = {
      today: bucket(isObj(today) ? today.total : null),
      week: week,
      month: bucket(isObj(all.thisMonth) ? all.thisMonth.total : null) ||
        (monthBuckets.length ? addBuckets(monthBuckets) : null)
    };
    var bots = Object.keys(isObj(all.byBot) ? all.byBot : {}).map(function (id) {
      var none = id === '(无助理)';
      return { id: none ? '' : id, name: none ? '未归助理' : name(id), b: bucket(all.byBot[id]) };
    }).filter(function (r) { return r.b; });
    var rows = [];
    if (Array.isArray(all.recent)) {
      all.recent.slice(0, 60).forEach(function (r) {
        if (!isObj(r)) return;
        var rowBucket = bucket(isObj(r.bucket) ? r.bucket : r);
        if (!rowBucket) return;
        rows.push({ bot: typeof r.bot === 'string' ? r.bot : '', botName: r.bot ? name(r.bot) : '未归助理',
          title: line(r.title || r.ticket || r.model || '一次对话', 60),
          time: typeof r.ts === 'string' || typeof r.ts === 'number' ? stampText(r.ts) : '',
          b: rowBucket });
      });
    } else {
      Object.keys(isObj(all.byTicket) ? all.byTicket : {}).forEach(function (id) {
        var b = bucket(all.byTicket[id]);
        if (!b) return;
        rows.push({ bot: '', botName: '', title: id === '(无工单)' ? '没挂任务单的对话' : '任务单 ' + line(id, 30), time: '', b: b });
      });
    }
    var plugins = normalizePlugins(isObj(raw.plugins) ? raw.plugins : isObj(all.plugins) ? all.plugins : null);
    return { source: 'real', note: '费用按本体价目和每次调用时间折算。', periods: periods, days: days,
      bots: bots, rows: rows, rowsByBot: Array.isArray(all.recent), budgets: null, today: null,
      hasRecords: all.total.calls > 0,
      plugins: plugins,
      native: isObj(raw.native) ? raw.native : isObj(all.native) ? all.native : null };
  };
  /* ---------- 插件账（cost-meter / quota-watch） ---------- */
  function pluginBucket(period) {
    if (!isObj(period)) return null;
    var calls = isInt(period.calls) ? period.calls : null;
    if (calls === null) return null;
    var usd = typeof period.usd === 'number' && isFinite(period.usd) && period.usd >= 0 ? period.usd : null;
    return { calls: calls, tokens: null, tokenParts: null, plugin: true,
      cost: { byCur: usd === null ? {} : { USD: usd }, pending: 0, plan: 0, local: 0 } };
  }
  function normalizePlugins(p) {
    if (!isObj(p) || p.ok !== true) return null;
    var summary = {};
    ['today', 'week', 'month'].forEach(function (key) {
      var b = pluginBucket(isObj(p.summary) ? p.summary[key] : null);
      if (b) summary[key] = b;
    });
    var quota = [];
    list(p.quota).forEach(function (q) {
      if (!isObj(q) || typeof q.provider !== 'string') return;
      var wins = [];
      list(q.windows).forEach(function (w) {
        if (!isObj(w) || typeof w.limit !== 'number' || !isFinite(w.limit)) return;
        if (typeof w.used !== 'number' || !isFinite(w.used)) return;
        wins.push({ label: line(w.label || w.key, 20), limit: w.limit, used: w.used,
          remaining: typeof w.remaining === 'number' && isFinite(w.remaining) ? w.remaining : Math.max(0,
            w.limit - w.used) });
      });
      if (!wins.length) return;
      quota.push({ provider: line(q.provider, 40), label: line(q.label || q.provider, 40),
        currency: typeof q.currency === 'string' && /^[A-Z]{3}$/.test(q.currency) ? q.currency : 'USD',
        windows: wins });
    });
    var balance = null, b = p.balance;
    if (isObj(b) && typeof b.total === 'number' && isFinite(b.total)) {
      balance = { currency: typeof b.currency === 'string' && b.currency ? b.currency : 'CNY', total: b.total };
    }
    var phases = {};
    if (isObj(p.providers)) Object.keys(p.providers).forEach(function (id) {
      var ph = p.providers[id];
      if (!isObj(ph) || (ph.phase !== 'peak' && ph.phase !== 'off')) return;
      phases[id] = { phase: ph.phase, next: typeof ph.next === 'number' && isFinite(ph.next) ? ph.next : null };
    });
    var sources = list(p.sources).filter(function (s) {
      return s === 'cost-meter' || s === 'quota-watch';
    });
    if (!sources.length) sources = [p.source === 'quota-watch' ? 'quota-watch' : 'cost-meter'];
    if (!Object.keys(summary).length && !quota.length && !balance) return null;
    return { summary: summary, quota: quota, balance: balance, phases: phases, sources: sources };
  }
  function pluginSourceName(p) {
    if (p.sources.indexOf('cost-meter') >= 0 && p.sources.indexOf('quota-watch') >= 0) {
      return 'cost-meter 与 quota-watch';
    }
    return p.sources[0] || '插件';
  }
  function stampText(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var now = new Date(), same = d.toDateString() === now.toDateString();
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return same ? '今天 ' + hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }

  /* ---------- 账本数据整理（演示） ---------- */
  function hashOf(text) {
    var h = 7;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100003;
    return h;
  }
  NS.demoLedger = function () {
    var st = hubState(), bots = st && Array.isArray(st.bots) ? st.bots.slice(0, 6) : [];
    if (!bots.length) return null;
    function mk(calls, tokens, yuan) {
      return { calls: calls, tokens: tokens, cost: { byCur: { CNY: Math.round(yuan * 100) / 100 }, pending: 0, plan: 0,
        local: 0 } };
    }
    var shape = [3, 5, 4, 8, 6, 9, 7, 4, 6, 10, 8, 5, 11, 7];
    var end = new Date(), days = [];
    for (var i = 13; i >= 0; i--) {
      var d = new Date(end.getTime() - i * 86400000), key = d.getFullYear() + '-' + ('0' + (d.getMonth() +
        1)).slice(-2) +
        '-' + ('0' + d.getDate()).slice(-2), n = shape[13 - i];
      days.push({ date: key, b: mk(n * 4, n * 21000, n * 0.62) });
    }
    var botRows = bots.map(function (b, idx) {
      var n = [9, 7, 5, 4, 3, 2][idx] || 2;
      return { id: b.id, name: b.name, b: mk(n * 6, n * 33000, n * 1.1) };
    });
    var cards = st && Array.isArray(st.cards) ? st.cards : [];
    var rows = cards.slice(0, 14).map(function (c, idx) {
      var h = hashOf(String(c.id)), calls = 1 + (h % 4);
      return { bot: c.bot, botName: (botInfo(c.bot) || {}).name || '', title: line(c.title, 40),
        time: String(c.time || ''), b: mk(calls, 6000 + (h % 90) * 1000, 0.05 + (h % 40) / 100 + idx * 0.01) };
    });
    var last7 = addBuckets(days.slice(7).map(function (x) { return x.b; }));
    var month = addBuckets(days.map(function (x) { return x.b; }));
    return { source: 'demo', note: '示例数据，用来看页面长什么样；不是真实账单。', periods: { today: days[13].b, week: last7, month: month },
      days: days, bots: botRows, rows: rows, rowsByBot: true,
      budgets: { week: { limit: 60, cur: 'CNY' }, month: { limit: 120, cur: 'CNY' } } };
  };

  /* ---------- 账本页面 ---------- */
  var ledgerUi = { metric: '', range: 7, filter: '', more: false };
  function ledgerHTML(m) {
    if (!m) {
      return '<div class="r30l r30l-ledger" data-r30l-ledger="empty"><div class="r30l-in">' +
        emptyLedger('账本暂时读不到', '暂时无法读取后端账本，请稍后重试。') + '</div></div>';
    }
    var pluginBuckets = m.plugins ? ['today', 'week', 'month'].map(function (key) {
      return m.plugins.summary[key];
    }).filter(Boolean) : [];
    var cur = primaryCurrency([m.periods.month, m.periods.week,
      m.periods.today].concat(m.days.map(function (d) { return d.b; })));
    var hasCost = !!cur;
    var metric = ledgerUi.metric === 'tokens' || (!hasCost && ledgerUi.metric !== 'cost') ? 'tokens' :
      (ledgerUi.metric || 'cost');
    if (!hasCost) metric = 'tokens';
    var total = m.periods.month || m.periods.week || m.periods.today;
    var pluginHasData = pluginBuckets.some(function (b) { return b.calls > 0; });
    var nothing = m.source === 'real' ? !m.hasRecords && !pluginHasData :
      !total || (total.calls === 0 && m.days.every(function (d) { return !d.b || d.b.calls === 0; }));
    var out = '<div class="r30l r30l-ledger" data-r30l-ledger="' + esc(m.source) + '"><div class="r30l-in">';
    if (m.plugins) out += quotaCard(m.plugins);
    out += statCards(m, cur);
    if (m.source === 'real') out += '<p class="r30l-sub r30l-costnote r30l-source">' +
      esc(ledgerSourceNote(m)) + '</p>';
    if (!hasCost && total && total.cost.local > 0) out +=
      '<p class="r30l-sub r30l-costnote">本地模型，不计费</p>';
    if (nothing) {
      out += emptyLedger(m.source === 'real' ? '还没有记录' : '还没有用量记录',
        '助理开始干活后，这里会出现今天、本周、本月的花费，每天的柱状图，以及谁用得最多。');
    }
    else if (pluginHasData && !m.hasRecords) {
      out += '<p class="r30l-sub r30l-costnote">插件的花费和额度已显示在上方；Hub 事件账里还没有逐次明细。</p>';
    }
    else {
      out += '<section class="r30l-card r30l-chart" aria-label="按天用量">' +
        '<header class="r30l-head"><h3>每天用了多少</h3><div class="r30l-seg" role="group" aria-label="图表设置">' +
        seg('metric', 'cost', '花费', metric, hasCost) + seg('metric', 'tokens', '用量', metric, true) +
        '<span class="r30l-sep"></span>' + seg('range', '7', '7 天', String(ledgerUi.range), true) +
        seg('range', '14', '14 天', String(ledgerUi.range), m.days.length > 7) + '</div></header>' +
        barChart(m, metric, cur) + '</section>';
      out += '<section class="r30l-card r30l-who" aria-label="谁用得多"><header class="r30l-head"><h3>谁用得多</h3>' +
        '<span class="r30l-sub">' + (metric === 'cost' ? '按花费' : '按用量') + '，累计</span></header>' + whoBars(m, metric,
          cur) + '</section>';
      out += detailList(m);
    }
    if (m.source === 'real' && m.native && !m.plugins) out += nativeLedger(m.native);
    out += '<p class="r30l-foot">' + esc(m.note || '') + (cur && Object.keys((m.periods.month || m.periods.week ||
      {cost: {byCur: {}}}).cost.byCur).length > 1
      ? ' 图里只按 ' + esc(SYMBOL[cur] || cur) + ' 画。' : '') + '</p></div>';
    return out;
  }
  function ledgerSourceNote(m) {
    if (m.plugins) {
      var hasSummary = Object.keys(m.plugins.summary).length > 0;
      if (hasSummary) {
        return '花费和次数来自 ' + pluginSourceName(m.plugins) +
          (m.plugins.quota.length ? '，额度也来自插件' : '') + '；逐次明细仍按 Hub 事件账。';
      }
      return '额度来自 ' + pluginSourceName(m.plugins) + '；花费和次数仍按 Hub 事件账。';
    }
    return '按价目估算。价目与 DeepSeek Harness 同一张表（¥1/0.02/4 每百万，峰时 ×2）';
  }
  function quotaCard(p) {
    var out = '<section class="r30l-card r30l-quota" aria-label="额度">' +
      '<header class="r30l-head"><h3>额度</h3><span class="r30l-sub">来自 ' +
      esc(pluginSourceName(p)) + '</span></header>';
    if (!p.quota.length) out += '<p class="r30l-none">插件这次没有给出额度数字。</p>';
    p.quota.forEach(function (q) {
      out += '<div class="r30l-qgroup"><b>' + esc(q.label) + '</b>';
      q.windows.forEach(function (w) {
        var pct = w.limit > 0 ? Math.min(100, Math.max(0, Math.round(w.used / w.limit * 100))) : 0;
        out += '<div class="r30l-qrow"><span class="r30l-qk">' + esc(w.label) + '</span>' +
          '<span class="r30l-qv">已用 ' + esc(money(q.currency, w.used)) + ' · 剩余 ' +
          esc(money(q.currency, w.remaining)) + ' / ' + esc(money(q.currency, w.limit)) + '</span>' +
          '<span class="r30l-track"><i style="width:' + pct + '%"></i></span></div>';
      });
      var phase = p.phases[q.provider];
      if (phase) {
        out += '<p class="r30l-sub">' + esc((phase.phase === 'peak' ? '峰时' : '谷时') +
          (phase.next ? ' · 下次峰谷切换 ' + stampText(phase.next) : '')) + '</p>';
      }
      out += '</div>';
    });
    if (p.balance) out += '<p class="r30l-sub">' + esc('DeepSeek 余额 ' +
      money(p.balance.currency, p.balance.total)) + '</p>';
    return out + '</section>';
  }
  function nativeLedger(native) {
    var out = '<section class="r30l-card r30l-native" aria-label="与本体核对">' +
      '<header class="r30l-head"><h3>与本体核对</h3></header>';
    if (native.ok === false) out += '<p class="r30l-sub">' +
      esc('读不到 DeepSeek Harness 的账本：' + (native.reason || '原因未知')) + '</p>';
    var quota = native.quotaWatch;
    if (isObj(quota)) {
      out += '<p>' + esc('本体样本 ' + quota.calls + ' 次 · ' + money('USD', quota.totalUsd)) + '</p>';
      out += '<details><summary>按天和渠道查看</summary><ul class="r30l-native-rows">' +
        list(quota.days).map(function (day) {
          return '<li>' + esc(day.day + ' · ' + day.provider + ' · ' + day.calls + ' 次 · ' +
            money('USD', day.usd)) + '</li>';
        }).join('') + '</ul></details>';
    }
    var meter = native.costMeter;
    if (isObj(meter)) {
      var usage = isObj(meter.usage) ? meter.usage : {}, limits = isObj(meter.limits) ? meter.limits : {};
      var providers = isObj(meter.providers) ? meter.providers : {};
      var periods = [['h5', '近 5 小时', 'h5'], ['d7', '近 7 天', 'week'], ['d30', '近 30 天', 'month']];
      out += '<ul class="r30l-native-rows">' + Object.keys(usage).map(function (provider) {
        var values = isObj(usage[provider]) ? usage[provider] : {};
        var cap = isObj(limits[provider]) ? limits[provider] : {};
        var phase = providers[provider] && providers[provider].phase;
        var title = provider + (phase === 'peak' ? ' · 峰时' : phase === 'off' ? ' · 谷时' : '');
        var rows = periods.filter(function (period) { return typeof values[period[0]] === 'number'; });
        return '<li><b>' + esc(title) + '</b><p class="r30l-sub">' + esc(rows.map(function (period) {
          return period[1] + ' ' + money('USD', values[period[0]]) +
            (typeof cap[period[2]] === 'number' ? ' / 额度 ' + money('USD', cap[period[2]]) : '');
        }).join(' · ')) + '</p></li>';
      }).join('') + '</ul>';
      var balance = meter.balance;
      if (isObj(balance) && typeof balance.total === 'number' && isFinite(balance.total)) {
        out += '<p class="r30l-sub">' + esc('DeepSeek 余额 ' + money(balance.currency || 'CNY', balance.total)) + '</p>';
      } else if (isObj(balance) && balance.error) {
        out += '<p class="r30l-sub">' + esc('余额读取失败：' + balance.error) + '</p>';
      }
    }
    return out + '</section>';
  }
  function seg(kind, value, label, current, enabled) {
    return '<button type="button" class="r30l-segbtn' + (current === value ? ' on' : '') + '" data-r30l-act="' + kind +
      ':' + value +
      '" aria-pressed="' + (current === value ? 'true' : 'false') + '"' + (enabled ? '' : ' disabled') + '>' +
        esc(label) + '</button>';
  }
  function statCards(m, cur) {
    var defs = [['today', '今天', 'var(--sky,#2f9bff)'], ['week', '近 7 天', 'var(--mint,#2fcf9f)'], ['month', '本月',
      'var(--violet,#b39af4)']];
    return '<div class="r30l-stats">' + defs.map(function (def) {
      var plugin = m.plugins && m.plugins.summary[def[0]];
      var b = plugin || m.periods[def[0]], budget = m.budgets && m.budgets[def[0]];
      var cardCur = plugin ? primaryCurrency([b]) : cur;
      var tokenText = b && b.plugin ? '插件不记 token' : '用量 ' + esc(fmtTokensShort(b && b.tokens));
      var html = '<article class="r30l-card r30l-stat" style="--a:' + def[2] + '"><p class="r30l-k">' + esc(def[1]) +
        '</p>';
      if (!b) {
        return html + '<p class="r30l-big r30l-none">暂无</p><p class="r30l-sub">暂时没有数据</p></article>';
      }
      /* 有金额展示金额，只有用量时保留调用次数。 */
      if (cardCur) {
        html += '<p class="r30l-big">' + esc(money(cardCur, amountOf(b, cardCur))) + '</p><p class="r30l-sub">' + b.calls +
          ' 次 · ' + tokenText + '</p>';
      } else {
        html += '<p class="r30l-big">' + b.calls + ' 次</p><p class="r30l-sub">' + tokenText + '</p>';
      }
      if (m.source === 'real' && !plugin && tokenParts(b)) html +=
        '<p class="r30l-sub r30l-tokenparts">' + esc(tokenParts(b)) + '</p>';
      /* 预算只跟 Hub 事件账的人民币口径走，插件美元数据不混进预算条。 */
      if (!plugin && budget && !cur) {
        html += '<p class="r30l-sub">预算 ' + esc(money(budget.cur, budget.limit)) + ' · 仅记录用量</p>';
      }
      if (!plugin && budget && cur === budget.cur) {
        var pct = Math.min(100, Math.round(amountOf(b, cur) / budget.limit * 100)), level = pct >= 90 ? 'hot' :
          pct >= 70 ? 'warm' : 'ok';
        html += '<div class="r30l-meter ' + level +
          '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct +
          '" aria-label="预算已用 ' + pct + '%"><i style="width:' + pct + '%"></i></div><p class="r30l-sub r30l-' + level +
            '">预算 ' +
          esc(money(cur, budget.limit)) + ' · 已用 ' + pct + '%' + (level === 'hot' ? ' · 快到上限' : level === 'warm' ?
            ' · 留意' : '') + '</p>';
      }
      return html + '</article>';
    }).join('') + '</div>';
  }
  function dayLabel(key) {
    var p = key.split('-');
    return Number(p[1]) + '/' + Number(p[2]);
  }
  function barChart(m, metric, cur) {
    var n = ledgerUi.range === 14 && m.days.length > 7 ? 14 : 7, days = m.days.slice(-n);
    var vals = days.map(function (d) {
      if (!d.b) return null;
      return metric === 'cost' ? amountOf(d.b, cur) : d.b.tokens;
    });
    var max = vals.reduce(function (a, v) { return v != null && v > a ? v : a; }, 0);
    var show = function (v) { return v == null ? '未知' : metric === 'cost' ? money(cur, v) : fmtTokensShort(v); };
    var summary = days.map(function (d, i) { return dayLabel(d.date) + ' ' + show(vals[i]); }).join('，');
    var out = '<div class="r30l-bars n' + n + '" role="img" aria-label="' + esc('最近 ' + n + ' 天：' + summary) + '">';
    days.forEach(function (d, i) {
      var v = vals[i], pct = v == null ? 0 : max > 0 ? Math.max(v > 0 ? 3 : 0, Math.round(v / max * 100)) : 0;
      var last = i === days.length - 1, peak = max > 0 && v === max && days.length - 1 - i > 1;
      out += '<div class="r30l-col' + (last ? ' today' : '') + (v == null ? ' unknown' : '') + '" title="' +
        esc(dayLabel(d.date) + ' · ' + show(v)) + '">' +
        '<span class="r30l-barv">' + (last || peak ? esc(show(v)) : '') + '</span>' +
        '<span class="r30l-barwrap"><i class="r30l-bar" style="height:' + pct + '%"></i></span>' +
        '<span class="r30l-barl">' + (last ? '今天' : (n === 14 && (days.length - 1 - i) % 2 === 1 ? '' :
          esc(dayLabel(d.date)))) +
        '</span></div>';
    });
    return out + '</div><p class="r30l-sub r30l-axis">' + (max > 0 ? '最高一天 ' + esc(show(max)) : '这段时间没有用量') + '</p>';
  }
  /* 用量模式保留非计费调用的说明。 */
  function whoCost(r) {
    var text = costText(r.b.cost, r.b.calls);
    return text === '仅记录用量' || text === '费用未知' ? fmtTokens(r.b.tokens) : text;
  }
  function whoBars(m, metric, cur) {
    var rows = m.bots.map(function (r) {
      return { id: r.id, name: r.name, v: metric === 'cost' ? amountOf(r.b, cur) : r.b.tokens, b: r.b };
    }).sort(function (a, b) { return (b.v || -1) - (a.v || -1); });
    if (!rows.length) return '<p class="r30l-none">暂时没有按助理的数据</p>';
    var max = rows.reduce(function (a, r) { return r.v != null && r.v > a ? r.v : a; }, 0);
    return '<ol class="r30l-hbars">' + rows.map(function (r) {
      var pct = r.v == null || !max ? 0 : Math.max(r.v > 0 ? 4 : 0, Math.round(r.v / max * 100)),
        color = botColor(r.id);
      return '<li class="r30l-hrow">' + avatar(r.id, 30, r.name) + '<div class="r30l-hmain">' +
        '<div class="r30l-hline"><b>' +
        esc(r.name) +
        '</b><span>' + esc(metric === 'cost' ? whoCost(r) : fmtTokens(r.v)) + '</span></div>' +
        '<span class="r30l-track"><i style="width:' + pct + '%' + (color ? ';--c:' + color : '') + '"></i></span>' +
        '<small>' + r.b.calls + ' 次 · ' + esc(fmtTokens(r.b.tokens)) + '</small></div></li>';
    }).join('') + '</ol>';
  }
  function detailList(m) {
    var names = [], seen = {};
    m.rows.forEach(function (r) { if (r.bot && !seen[r.bot]) { seen[r.bot] = 1; names.push([r.bot, r.botName ||
      r.bot]); } });
    var filterOn = m.rowsByBot && names.length > 1;
    var shown = m.rows.filter(function (r) { return !filterOn || !ledgerUi.filter || r.bot === ledgerUi.filter; });
    var cap = ledgerUi.more ? 40 : 6, slice = shown.slice(0, cap);
    var out = '<section class="r30l-card r30l-detail" aria-label="明细"><header class="r30l-head"><h3>' +
      (m.rowsByBot ? '明细' : '按任务单的明细') + '</h3><span class="r30l-sub">' + shown.length + ' 条</span></header>';
    if (filterOn) {
      out += '<div class="r30l-chips" role="group" aria-label="按助理筛选"><button type="button" class="r30l-chip' +
        (!ledgerUi.filter ? ' on' : '') +
        '" data-r30l-act="filter:" aria-pressed="' + (!ledgerUi.filter) + '">全部</button>' + names.map(function (p) {
        return '<button type="button" class="r30l-chip' + (ledgerUi.filter === p[0] ? ' on' : '') +
          '" data-r30l-act="filter:' + esc(p[0]) +
          '" aria-pressed="' + (ledgerUi.filter === p[0]) + '">' + avatar(p[0], 18, p[1]) + '<span>' + esc(p[1]) +
            '</span></button>';
      }).join('') + '</div>';
    } else if (!m.rowsByBot) {
      out += '<p class="r30l-sub r30l-pad">暂时没有逐次明细和助理归属，这里先按任务单汇总。</p>';
    }
    if (!slice.length) out += '<p class="r30l-none r30l-pad">没有符合的记录</p>';
    out += '<ul class="r30l-rows">' + slice.map(function (r) {
      var cur2 = primaryCurrency([r.b]);
      return '<li class="r30l-row">' + (r.bot || m.rowsByBot ? avatar(r.bot, 34, r.botName) :
        '<span class="r30l-dot" style="--s:34px" aria-hidden="true">工</span>') +
        '<div class="r30l-rmain"><b>' + esc(r.title) + '</b><small>' + esc([r.botName, r.time, r.b.calls +
          ' 次'].filter(Boolean).join(' · ')) + '</small>' +
        (m.source === 'real' && tokenParts(r.b) ? '<small>' + esc(tokenParts(r.b)) + '</small>' : '') +
        '</div><div class="r30l-rside"><b>' + esc(cur2 ? money(cur2, amountOf(r.b, cur2)) :
          r.b.cost.local > 0 ? '本地模型，不计费' :
          '用量 ' + fmtTokensShort(r.b.tokens)) +
        '</b><small>' + (cur2 ? '用量 ' + esc(fmtTokensShort(r.b.tokens)) : '') + '</small></div></li>';
    }).join('') + '</ul>';
    if (shown.length > slice.length) out += '<button type="button" class="r30l-more" data-r30l-act="more:1">再看 ' +
      (Math.min(40, shown.length) - slice.length) + ' 条</button>';
    return out + '</section>';
  }
  function emptyLedger(title, text) {
    var ghost = [30, 55, 40, 70, 50, 85, 60].map(function (h) { return '<i style="height:' + h + '%"></i>'; }).join('');
    return '<section class="r30l-card r30l-empty"><div class="r30l-ghost" aria-hidden="true">' + ghost + '</div><b>' +
      esc(title) +
      '</b><p>' + esc(text) + '</p><small>上面的柱子只是示意，不是真实数据</small></section>';
  }

  /* ---------- 今天：数据整理 ---------- */
  function localDate(ts, offset) {
    var t = Date.parse(ts);
    return isFinite(t) ? new Date(t + (offset || 0) * 60000).toISOString().slice(0, 10) : '';
  }
  var ROUTINE_KIND = { reported: 'good', started: 'run', pending: 'wait', off: 'mute', blocked: 'bad',
    incomplete: 'bad', timeout: 'bad',
    failed: 'bad', interrupted: 'bad', missed: 'bad' };
  var ROUTINE_TEXT = { pending: '还没到点', off: '今天不跑', started: '正在跑', reported: '已回报', blocked: '卡住了', incomplete: '没做完',
    timeout: '超时了', failed: '没跑成', interrupted: '被打断', 'skipped-quiet': '安静时段没跑', 'skipped-busy': '上一份还在跑',
    'skipped-paused': '暂停中没跑', 'skipped-duplicate': '今天已跑过', missed: '错过了' };
  NS.normalizeToday = function (raw, tickets, nameOf) {
    if (!isObj(raw)) return null;
    var name = typeof nameOf === 'function' ? nameOf : function (x) { return x; };
    var who = function (id) { return id === 'owner' || id === 'owner' ? '你' : line(name(id), 30) || '助理'; };
    var sec = function (src) { return isObj(src) && src.available !== false ? src : null; };
    var off = Number.isFinite(raw.utcOffsetMinutes) ? raw.utcOffsetMinutes : 0;
    var approvals = sec(raw.approvals), waiting = sec(raw.waiting), routines = sec(raw.routines);
    var wait = { available: !!(approvals || waiting), partial: !(approvals && waiting), note: '', items: [] };
    if (approvals) {
      if (approvals.cardsSource === 'unavailable') wait.note = '暂时看不到要你确认的请求';
      list(approvals.cards).slice(0, 30).forEach(function (c) {
        wait.items.push({ kind: 'card', tag: '确认卡', id: line(c && c.id, 80), bot: c && c.assistant, name: who(c &&
          c.assistant),
          title: line(c && c.title, 80) || '（无标题）', sub: line(c && c.ask, 100), act: '去确认' });
      });
      list(approvals.kbDrafts).slice(0, 30).forEach(function (d) {
        wait.items.push({ kind: 'kb', tag: '等你确认存入知识库', id: line(d && d.id, 80), bot: '', name: '', title: line(d &&
          d.summary, 80) || '知识库草稿',
          sub: line(d && d.project, 40), act: '去看看' });
      });
    } else if (waiting) wait.note = '确认卡暂时读不到';
    if (waiting) {
      var mapRow = function (tag, act, item) {
        var mine = !!item && (item.assistant === 'owner' || item.assistant === 'owner');
        var why = line(item && item.reason, 100);
        if (/^[a-z][a-z_-]*$/i.test(why)) why = '';
        return { kind: 'ticket', tag: tag, id: line(item && item.id, 80), bot: mine ? '' : item && item.assistant,
          name: mine ? '你交代的' : who(item && item.assistant),
          title: line(item && item.title, 80) || '（无标题）', sub: why, act: act };
      };
      list(waiting.waitingAnswer).slice(0, 20).forEach(function (i) { wait.items.push(mapRow('等你回答', '去回答', i)); });
      list(waiting.awaitingReview).slice(0, 20).forEach(function (i) { wait.items.push(mapRow('等你验收', '去验收', i)); });
      list(waiting.blocked).slice(0, 20).forEach(function (i) { wait.items.push(mapRow('卡住了', '去看看', i)); });
    } else if (approvals) wait.note = (wait.note ? wait.note + '；' : '') + '问题和卡住的暂时读不到';
    var doing = { available: Array.isArray(tickets), note: '', items: [] }, done = { available: Array.isArray(tickets),
      note: '', items: [] };
    list(tickets).forEach(function (t) {
      if (!isObj(t) || typeof t.id !== 'string') return;
      var owner = t.claimedBy || (Array.isArray(t.to) && t.to[0]) || '';
      var prog = list(t.progress), last = prog.length ? prog[prog.length - 1] : null;
      var mine = owner === 'owner' || owner === 'owner';
      var item = { kind: 'ticket', id: t.id, bot: mine ? '' : owner, name: owner ? who(owner) : '',
        title: line(t.title, 80) ||
        '（无标题）',
        sub: line(last && last.text, 100), steps: prog.length };
      if (t.state === 'progress' && t.review !== 'submitted') doing.items.push(item);
      if (t.state === 'completed') {
        var acc = list(t.history).slice().reverse().filter(function (h) { return h && h.action === 'accepted'; })[0];
        if (localDate((acc && acc.ts) || t.updatedAt, off) === String(raw.date || '')) {
          item.sub = line((isObj(t.report) && t.report.summary) || item.sub, 100);
          done.items.push(item);
        }
      }
    });
    var yd = sec(raw.yesterdayDone);
    if (yd && isInt(yd.total)) done.note = '昨天做完 ' + yd.total + ' 件';
    var rout = { available: !!routines, note: '', paused: !!(routines && routines.paused === true), items: [] };
    if (routines) {
      if (rout.paused) rout.note = '固定任务现在是暂停的';
      list(routines.items).slice(0, 30).forEach(function (r) {
        var st = r && r.paused === true ? 'paused' : r && r.running === true ? 'started' : String(r && r.todayState ||
          '');
        rout.items.push({ kind: 'bot', id: line(r && r.id, 40), bot: r && r.assistant, name: who(r && r.assistant),
          title: line(r && r.name, 40) || '（未命名）', at: line(r && r.at, 8),
          state: st === 'paused' ? '已暂停' : Object.prototype.hasOwnProperty.call(ROUTINE_TEXT, st) ? ROUTINE_TEXT[st] :
            '状态未知',
          tone: st === 'paused' ? 'mute' : ROUTINE_KIND[st] || 'wait' });
      });
    }
    return { source: 'real', date: line(raw.date, 12), waiting: wait, doing: doing, done: done, routines: rout,
      mirrorNotice: typeof raw.mirrorNotice === 'string' ? line(raw.mirrorNotice, 200) : '' };
  };
  NS.demoToday = function () {
    var st = hubState();
    if (!st) return null;
    var wait = { available: true, note: '', items: [] };
    list(st.decisions).filter(function (d) { return d && (d.status === 'pending' ||
      d.status === 'edit'); }).forEach(function (d) {
      wait.items.push({ kind: 'conv', tag: d.kind || '确认', id: d.id, bot: d.bot, name: (botInfo(d.bot) || {}).name ||
        '', title: line(d.title, 80),
        sub: line(d.summary, 100), act: '去处理' });
    });
    list(st.pendingInputs).slice(0, 3).forEach(function (p) {
      wait.items.push({ kind: 'input', tag: '要你填', id: p.id, bot: p.bot, name: (botInfo(p.bot) || {}).name || '',
        title: line(p.what, 80),
        sub: line(p.blocking, 100), act: '去填写' });
    });
    function fromCard(c, extra) {
      return Object.assign({ kind: 'card', id: c.id, project: c.project, bot: c.bot, name: (botInfo(c.bot) ||
        {}).name || '', title: line(c.title, 80),
        sub: line(c.sub, 100), time: String(c.time || '') }, extra || {});
    }
    var cards = list(st.cards);
    var doing = { available: true, note: '',
      items: cards.filter(function (c) { return c.col === 'doing'; }).map(function (c, i) {
      return fromCard(c, { steps: 1 + (i % 3) });
    }) };
    var doneAll = cards.filter(function (c) { return c.col === 'done'; });
    var todayDone = doneAll.filter(function (c) { return /^今天/.test(String(c.time || '')); });
    var done = { available: true, note: '', items: (todayDone.length ? todayDone :
      doneAll).map(function (c) { return fromCard(c); }) };
    var rout = { available: true, note: '', paused: false, items: list(st.fixedTasks).map(function (t) {
      var time = String(t.seedMessage && t.seedMessage.time || '').replace(/^今天\s*/, '');
      var paused = t.status === 'paused';
      return { kind: 'conv', id: t.conversation, conversation: t.conversation, bot: t.ownerAssistantId,
        name: (botInfo(t.ownerAssistantId) || {}).name || '', title: line(t.taskName, 40),
          at: /^\d{1,2}:\d{2}$/.test(time) ? time : '',
        state: paused ? '已暂停' : '已排上', tone: paused ? 'mute' : 'wait' };
    }) };
    var d = new Date(), date = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' +
      d.getDate()).slice(-2);
    var recent = list(st.activities).filter(function (a) {
      return a && !a.cleared && (a.handled || a.kind === 'inform');
    })
      .slice(0, 8).map(function (a) {
        return { bot: a.bot, name: (botInfo(a.bot) || {}).name || '', title: line(a.title, 60), sub: line(a.detail, 80),
          state: a.handled ? '已处理' : '告知', when: String(a.time || '') };
      });
    return { source: 'demo', date: date, waiting: wait, doing: doing, done: done, routines: rout, recent: recent };
  };

  /* ---------- 今天：页面 ---------- */
  function summaryLine(m) {
    var a = m.waiting.items.length, b = m.doing.items.length, c = m.done.items.length;
    var parts = [];
    parts.push(!m.waiting.available ? '等你处理的暂时读不到' : a ? a + ' 件等你处理'
      : m.waiting.partial ? '读到的里没有等你处理的（有一部分读不到）' : '没有等你处理的事');
    parts.push(m.doing.available ? (b ? b + ' 件在做' : '没有在做的') : '在做的暂时读不到');
    parts.push(m.done.available ? (c ? c + ' 件做完了' : '还没有做完的') : '做完的暂时读不到');
    return parts.join('，');
  }
  function dateText(key) {
    var p = String(key || '').split('-');
    if (p.length !== 3) return '今天';
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return Number(p[1]) + ' 月 ' + Number(p[2]) + ' 日 周' + '日一二三四五六'[d.getDay()];
  }
  var TODAY_BLOCKS = [
    { key: 'waiting', title: '等你处理', ico: 'wait', cls: 'wait', empty: '现在没有要你处理的，可以放心。', none: '暂时没有数据' },
    /* 挂着没人接的（谁有空谁接）。没有这块数据（旧后端、演示外）就不画。 */
    { key: 'open', title: '挂着没人接的', ico: 'wait', cls: 'open', empty: '没有挂着没人接的。', none: '暂时没有数据', optional: true },
    { key: 'doing', title: '正在做', ico: 'doing', cls: 'doing', empty: '现在没有助理在干活。', none: '暂时没有数据' },
    { key: 'done', title: '今天做完的', ico: 'done', cls: 'done', empty: '今天还没有做完的。', none: '暂时没有数据' },
    { key: 'routines', title: '今天的固定任务', ico: 'clock', cls: 'rout', empty: '没有设固定任务。', none: '暂时没有数据' }
  ];
  function todayRow(block, item, ref) {
    var open = ' data-r30l-open="' + ref + '"';
    var left = item.bot !== undefined && (item.bot || item.name) ? avatar(item.bot, 38, item.name) :
      '<span class="r30l-dot" style="--s:38px" aria-hidden="true">' +
      esc(Array.from(item.tag || item.title || '事')[0]) +
      '</span>';
    if (block.key === 'routines') {
      return '<li><button type="button" class="r30l-trow r30l-r-' + esc(item.tone) + '"' + open +
        '><span class="r30l-time">' + esc(item.at || '—') + '</span>' +
        '<span class="r30l-tmain"><b>' + esc(item.title) + '</b><small>' + esc(item.name || '') + '</small></span>' +
        '<span class="r30l-state">' + esc(item.state) + '</span></button></li>';
    }
    var sub = item.sub ? '<small>' + esc(item.sub) + '</small>' : '';
    var meta = block.key === 'waiting' || block.key === 'open' ? '<span class="r30l-go">' +
      esc(item.act || '去处理') + icon('go', 14) + '</span>'
      : block.key === 'done' ? '<span class="r30l-tick">' + icon('done', 16) + '</span>' : '';
    var prog = '';
    if (block.key === 'doing') {
      prog = '<span class="r30l-prog" aria-hidden="true"><i></i></span>' +
        (item.steps ? '<small class="r30l-steps">已记 ' +
        item.steps + ' 步进展</small>' : '');
    }
    var head = (item.tag ? '<em class="r30l-tag">' + esc(item.tag) + '</em>' : '') + (item.name ?
      '<span class="r30l-who">' + esc(item.name) + '</span>' : '');
    return '<li><button type="button" class="r30l-trow"' + open + '>' + left + '<span class="r30l-tmain">' +
      (head ? '<span class="r30l-tline">' + head + '</span>' : '') + '<b>' + esc(item.title) + '</b>' + sub + prog +
        '</span>' + meta + '</button></li>';
  }
  /* 原「活动」里的进展并到这里：已处理的和只是告知的，默认收起，点开看。 */
  function recentHTML(items) {
    items = list(items).slice(0, 20);
    if (!items.length) return '';
    return '<details class="r30l-card r30l-block r30l-b-recent" data-r30l-recent><summary class="r30l-bhead">' +
      '<span class="r30l-chipico">' + icon('clock', 18) + '</span><h3>刚刚发生的</h3><span class="r30l-count">' +
      items.length + '</span></summary><ul class="r30l-list">' + items.map(function (item) {
      var left = item.bot ? avatar(item.bot, 38, item.name) :
        '<span class="r30l-dot" style="--s:38px" aria-hidden="true">' +
        esc(Array.from(item.title || '事')[0]) + '</span>';
      return '<li><div class="r30l-trow r30l-recent-row">' + left + '<span class="r30l-tmain">' +
        (item.name || item.state ? '<span class="r30l-tline">' +
          (item.name ? '<span class="r30l-who">' + esc(item.name) +
          '</span>' : '') + (item.state ? '<em class="r30l-tag">' + esc(item.state) + '</em>' : '') + '</span>' : '') +
        '<b>' + esc(item.title) + '</b>' + (item.sub ? '<small>' + esc(item.sub) + '</small>' : '') + '</span>' +
        (item.when ? '<time class="r30l-when">' + esc(item.when) + '</time>' : '') + '</div></li>';
    }).join('') + '</ul></details>';
  }
  function todayHTML(m) {
    if (!m) {
      return '<div class="r30l r30l-today" data-r30l-today="empty"><div class="r30l-in"><section class="r30l-card ' +
        'r30l-hello"><b>今天的情况暂时读不到</b>' +
        '<p>稍后再点开看看。读到之后，这里会按「等你处理、正在做、做完的、固定任务」分成四块。</p></section></div></div>';
    }
    /* 删掉重复的三组数字和一句话总结；日期一行，下面直接就是「等你处理」。 */
    var out = '<div class="r30l r30l-today" data-r30l-today="' + esc(m.source) +
      '"><div class="r30l-in"><p class="r30l-k r30l-datehead">' + esc(dateText(m.date)) +
      '</p>' + (m.mirrorNotice ? '<p class="r30l-sub" role="status" data-r41-mirror-notice>' +
        esc(m.mirrorNotice) + '</p>' : '') + '<div class="r30l-blocks">';
    var refs = [];
    TODAY_BLOCKS.forEach(function (block) {
      var data = m[block.key];
      if (!data || (block.optional && !(data.available && data.items.length))) return;
      var n = data.available ? data.items.length : null;
      out += '<section class="r30l-card r30l-block r30l-b-' + block.cls + '" aria-label="' + esc(block.title) +
        '"><header class="r30l-bhead"><span class="r30l-chipico">' +
        icon(block.ico, 18) + '</span><h3>' + esc(block.title) + '</h3><span class="r30l-count">' + (n === null ? '—' :
          n) + '</span></header>';
      if (data.note) out += '<p class="r30l-sub r30l-bnote">' + esc(data.note) + '</p>';
      if (!data.available) out += '<p class="r30l-none">' + esc(block.none) + '</p>';
      else if (!data.items.length) {
        out += '<p class="r30l-none">' + esc(data.partial ? '读到的这部分里没有，但还有读不到的，先别当作没事。' : block.empty) + '</p>';
      }
      else {
        out += '<ul class="r30l-list">' + data.items.map(function (item) {
          refs.push({ block: block.key, item: item });
          return todayRow(block, item, refs.length - 1);
        }).join('') + '</ul>';
      }
      out += '</section>';
    });
    out += recentHTML(m.recent) + '</div></div></div>';
    return { html: out, refs: refs };
  }

  /* ---------- 挂载 ---------- */
  NS.mountLedger = function (host, model) {
    if (!host) return;
    function paint() {
      host.innerHTML = ledgerHTML(model);
    }
    if (!host.__r30Ledger) {
      host.__r30Ledger = true;
      host.addEventListener('click', function (event) {
        var btn = event.target.closest && event.target.closest('[data-r30l-act]');
        if (!btn || btn.disabled || !host.contains(btn)) return;
        var act = btn.getAttribute('data-r30l-act'), at = act.indexOf(':'), kind = act.slice(0, at),
          value = act.slice(at + 1);
        if (kind === 'metric') ledgerUi.metric = value;
        else if (kind === 'range') ledgerUi.range = value === '14' ? 14 : 7;
        else if (kind === 'filter') { ledgerUi.filter = value; ledgerUi.more = false; }
        else if (kind === 'more') ledgerUi.more = true;
        host.innerHTML = ledgerHTML(host.__r30Model);
      });
    }
    host.__r30Model = model;
    paint();
  };
  NS.mountToday = function (host, model, opts) {
    if (!host) return;
    var built = todayHTML(model);
    host.__r30Open = opts && typeof opts.onOpen === 'function' ? opts.onOpen : null;
    if (typeof built === 'string') host.innerHTML = built;
    else { host.innerHTML = built.html; host.__r30Refs = built.refs; }
    if (!host.__r30Today) {
      host.__r30Today = true;
      host.addEventListener('click', function (event) {
        var btn = event.target.closest && event.target.closest('[data-r30l-open]');
        if (!btn || !host.contains(btn)) return;
        var ref = (host.__r30Refs || [])[Number(btn.getAttribute('data-r30l-open'))];
        if (ref && host.__r30Open) host.__r30Open(ref.item, ref.block);
      });
    }
  };

  /* ---------- 演示模式接线 ---------- */
  function realMode() { return document.documentElement.dataset.hubMode === 'real'; }
  function demoOpen(item) {
    var H = window.Hub, st = hubState();
    try {
      if (item.kind === 'input' && typeof H.openPendingInput === 'function') { H.openPendingInput(item.id); return; }
      if (item.kind === 'card' && st) {
        H.navigate(item.project ? { view: 'kanban', project: item.project } : { view: 'kanban' });
        st.cardId = item.id;
        if (typeof openPanel === 'function') openPanel('card');
        return;
      }
      var conv = item.conversation || (item.bot ? item.bot + '-013' : '');
      if (conv) H.navigate({ view: 'chat', conversation: conv });
    } catch (error) { /* 打不开就留在原页，不报错 */ }
  }
  function install() {
    var H = window.Hub;
    if (!H || typeof H.registerPanel !== 'function' || typeof H.on !== 'function') return;
    try {
      H.registerPanel('r30l-today', { title: '今天', render: function (host) { NS.mountToday(host, NS.demoToday(),
        { onOpen: demoOpen }); } });
    } catch (error) { /* 已注册过就算了 */ }
    window.addEventListener('click', function (event) {
      if (realMode() || !event.target || !event.target.closest) return;
      var row = event.target.closest('[data-r29-more="today"]');
      if (!row) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      H.openPanel('r30l-today');
    }, true);
    H.on('render', function () {
      if (realMode()) return;
      var st = hubState();
      if (!st || st.mode !== 'ledger') return;
      var title = document.querySelector('.mainpane .hub-extension-view .page-title');
      var host = title && title.nextElementSibling;
      if (!host || host.querySelector('[data-r30l-ledger]')) return;
      host.replaceChildren();
      var root = document.createElement('div');
      host.appendChild(root);
      NS.mountLedger(root, NS.demoLedger());
    });
  }
  if (window.Hub) install();
  else document.addEventListener('DOMContentLoaded', install);
})();
