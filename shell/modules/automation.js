
(function () {
  'use strict';
  var H = window.Hub;
  var h = H.h;
  var mount = null;
  var mountContext = null;
  // 本路只写三个独占模块，新增中性样本集中在数据对象；个人层拆分由壳收尾。
  var featureDemo = demoFixture("automation.featureDemo.1");
  var demoNow = new Date(featureDemo.clock);
  function featureAssistant(id) { return H.featureOwner(id); }
  function featureAssistantId(id) { return featureAssistant(id)?.id; }
  function demoClockLabel() { return dateKey(japanDay(demoNow)) + ' ' + pad(japanDay(demoNow).getUTCHours()) + ':' + pad(demoNow.getUTCMinutes()) + ' ' + featureDemo.timezone; }

  var dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var groups = {
    '今天': ['今天'],
    '调度': ['定时', '路由'],
    '任务单': ['任务单'],
    '派工台': ['派工台'],
    '运行与设备': ['后台', '多机', '模型', '协作'],
    '资料与通知': ['工作流', '通知', '文件', '搜索']
  };
  var col = { new: 'new', doing: 'working', stuck: 'blocked', fail: 'failed', done: 'done' };
  var statusLabels = { new: '待领取', working: '进行中', blocked: '已阻塞', failed: '失败', done: '已完成' };
  var state = demoFixture("automation.state.2");
  var schedules = demoFixture("automation.schedules.3");
  var runHistory = demoFixture("automation.runHistory.4");
  var rules = [
    { id: 'r1', name: demoText("automation.name.5"), match: new RegExp(demoText("automation.match.6"),""), terms: demoText("automation.terms.7"), bot: demoText("automation.bot.8"), level: 'L1 · 草稿', enabled: true, origin: demoText("automation.origin.9") },
    { id: 'r2', name: demoText("automation.name.10"), match: new RegExp(demoText("automation.match.11"),"i"), terms: demoText("automation.terms.12"), bot: 'content', level: 'L1 · 交接包', enabled: true, origin: demoText("automation.origin.13") },
    { id: 'r3', name: '视频与分镜规划', match: /视频|分镜|配音|镜头/, terms: '视频 / 分镜 / 配音 / 镜头', bot: 'art', level: 'L1 · 规划', enabled: true, origin: demoText("automation.origin.14") },
    { id: 'r4', name: 'DSH 开发与任务书', match: /DSH|模块|代码|看板/i, terms: 'DSH / 模块 / 代码 / 看板', bot: 'pm', level: 'L1 · 本地', enabled: true, origin: demoText("automation.origin.15") }
  ];
  var jobs = demoFixture("automation.jobs.16");
  var machines = demoFixture("automation.machines.17");
  var templates = demoFixture("automation.templates.18");
  // Bot templates are metadata, separate from the retained task/workflow templates above.
  // Reuse canonical bot colors: no module-owned palette or theme overrides.
  var botTemplates = demoFixture("automation.botTemplates.19");
  
  var dispatchTimeline = demoFixture("automation.sample.20");
  // Shared cards-b type: its owner registers the renderer, automation supplies the scene.
  function teacherStudentDemo() {
    return demoFixture("automation.sample.21");
  }
  var webhookDemo = { paused: false, draft: false };
  var webhookSources = ['本页任务完成事件 → 只汇总回执', '本页文件交付事件 → 只整理待阅摘要'];
  var storyboardLatest = null;
  var storyboardStates = { quoting: '报价中', 'need-approval': '等你点头', running: '正在做',
    ready: '占位已就绪', failed: '演示失败', 'spoiler-locked': '总览已锁' };
  var transcriptLabels = { embedded: '片内字幕', 'local-asr': '本机转写', file: '用户字幕文件', none: '未转写' };
  function storyboardTime(seconds) {
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }
  function storyboardDemo(index) {
    index = Math.max(1, Math.min(3, index || 1));
    var from = (index - 1) * 300;
    return { sourceLabel: '本机文件 · 演示片.mp4', demo: true,
      window: { index: index, total: 3, fromLabel: storyboardTime(from), toLabel: storyboardTime(from + 300), nextFromSec: from + 300 },
      cells: [12, 72, 150, 240].map(function (offset, i) {
        return { id: String(i + 1), at: storyboardTime(from + offset) + '–' + storyboardTime(from + offset + 20),
          line: ['开场环境的文字占位', '镜头移动的文字占位', '细节停留的文字占位', '段落收束的文字占位'][i] };
      }), selectedCellId: '', tokenEstimate: 222, transcript: { source: 'none' },
      errorLabel: '', state: 'quoting', mode: 'probe', overview: false, notice: '' };
  }
  function storyboardCell(data) {
    return (data.cells || []).find(function (cell) { return String(cell.id) === String(data.selectedCellId); });
  }
  function storyboardQuote(data) {
    var cell = storyboardCell(data) || (data.cells || [])[0];
    return data.sourceLabel + ' · ' + (cell ? '第 ' + cell.id + ' 格 · ' + cell.at +
      (data.selectedCellId ? '' : '（默认首格，尚未选格）') : '未选格 · ' + data.window.fromLabel + '–' + data.window.toLabel) + '（本页演示占位）';
  }
  function renderStoryboard(data) {
    data = data || storyboardDemo();
    var card = box('视频分镜', [], null, 'storyboard', 'content');
    var body = el('div', [], 'storyboard-body');
    card.append(body);
    function change(patch) { Object.assign(data, patch); storyboardLatest = data; paint(); }
    function control(action, label, run, disabled, primary) {
      return h('button', { type: 'button', class: 'm-automation-btn ' + (primary ? 'btn-primary' : 'ghostbtn'),
        'data-storyboard-action': action, disabled: !!disabled, onClick: function () { if (!disabled) run(); } }, label);
    }
    function paint() {
      var selected = storyboardCell(data), busy = data.state === 'running';
      var locked = data.state === 'spoiler-locked', failed = data.state === 'failed';
      var showCells = !locked && !failed && (data.state === 'ready' || data.mode === 'text');
      card.dataset.storyboardState = data.state;
      card.dataset.storyboardMode = data.mode;
      replaceContent(body, [
        badge('本页演示，未真实执行 · 刷新复原'),
        H.levelSticker('L3', { action: '按报价生成分镜占位', scope: '本机演示片的当前窗口', bot: 'content' }),
        h('p', { class: 'm-automation-muted', role: 'status', 'aria-live': 'polite' }, storyboardStates[data.state]),
        note('来源：' + data.sourceLabel),
        note((data.overview ? '全片总览 · 含后续画面：' : '这一段：') + data.window.fromLabel + '–' + data.window.toLabel +
          ' · 第 ' + data.window.index + '/' + data.window.total + ' 段'),
        note('预计 token：约 ' + data.tokenEstimate + '（仅此评估版本的演示估算，未复算、未记账）'),
        badge('台词 · ' + (transcriptLabels[(data.transcript || {}).source] || '来源未知')),
        note('未调用 ffmpeg；外链与云端转写关闭。图、对白与响／静／切声条均为占位。'),
        data.notice ? note(data.notice) : null,
        data.state === 'quoting' ? note('先核对当前窗口与估算，再批准这一轮。此时没有出图。') : null,
        data.state === 'need-approval' ? note('只为当前窗口等你点头；按「按这个出图」才推进本页占位。') : null,
        busy ? note('正在做分镜（演示占位）；点「查看演示结果」完成本轮，不启动后台任务。') : null,
        failed ? el('p', data.errorLabel || '这台机器还没有 ffmpeg（演示）。', 'error') : null,
        locked ? note('总览会摆出后面的画面；解锁后仍先报价，未批准不出图。') : null,
        showCells && data.mode !== 'text' ? el('div',
          (data.mode === 'zoom' && selected ? [selected] : data.cells).map(function (cell) {
            return h('div', { class: 'm-automation-frame', role: 'img', 'aria-label': '第 ' + cell.id + ' 格 · ' + cell.at + '，非真实抽帧' },
              ['第 ' + cell.id + ' 格 · ' + cell.at, note(data.mode === 'zoom' ? '放大占位，非真实抽帧' : '演示宫格，非真实抽帧')]);
          }), 'frames') : null,
        showCells && data.mode !== 'text' ? el('div', '响 ▰▰ · 静 ▱▱ · 切 ┃（声条占位）', 'sound-placeholder') : null,
        showCells ? el('div', (data.cells || []).map(function (cell) {
          return h('button', { type: 'button', class: 'm-automation-cell ghostbtn',
            'data-storyboard-cell': cell.id, 'aria-pressed': String(selected === cell),
            onClick: function () {
              if (selected === cell) H.toast('本页演示 · 第 ' + cell.id + ' 格已选中，引用会带时间码 ' + cell.at);
              change({ selectedCellId: cell.id, notice: '已选第 ' + cell.id + ' 格 · ' + cell.at + '；引用会带格号和时间码。' });
            }
          }, '第 ' + cell.id + ' 格 · ' + cell.at + ' · ' + cell.line);
        }), 'cell-list') : null,
        actions([
          data.state === 'quoting' ? control('quote', '核对报价', function () { change({ state: 'need-approval' }); }) : null,
          control('render', '按这个出图', function () { change({ state: 'running', notice: '' }); }, data.state !== 'need-approval', true),
          busy ? control('finish', '查看演示结果', function () { change({ state: 'ready', mode: data.mode === 'probe' ? 'window' : data.mode }); }) : null,
          control('next', '下一段', function () {
            change(storyboardDemo(data.window.index + 1));
          }, busy || locked || data.overview || data.window.index >= data.window.total),
          control('zoom', '放大此格', function () {
            change({ state: 'quoting', mode: 'zoom', notice: '放大第 ' + selected.id + ' 格 · ' + selected.at + '；先核对报价。' });
          }, busy || locked || failed || !selected),
          control('text', '只看文字', function () {
            if (data.state === 'ready' && data.mode === 'text') H.toast('本页演示 · 当前已是文字清单，没有字幕或转写结果。');
            change({ state: 'ready', mode: 'text', notice: '仅列演示文字占位；没有字幕或本机转写结果。' });
          }, busy || locked),
          !locked ? control('overview', '查看总览（会看到后面）', function () { change({ state: 'spoiler-locked' }); }, busy) : null,
          control('spoiler', '仍要看总览', function () {
            var overview = storyboardDemo();
            overview.overview = true; overview.window.toLabel = demoText("automation.sample.22"); overview.window.total = 1;
            overview.cells = [1, 2, 3].map(function (index) {
              var cell = storyboardDemo(index).cells[0];
              return { id: String(index), at: cell.at, line: '第 ' + index + ' 段的总览占位' };
            });
            change(overview);
          }, !locked),
          failed ? control('retry', '重新报价', function () { change(storyboardDemo(data.window.index)); }) : null,
          (data.mode === 'zoom' || data.overview || locked) ? control('back', '回到这段', function () { change(storyboardDemo(data.window.index)); }, busy) : null
        ])]);
    }
    paint(); return card;
  }
  function tokenText(value) { return value == null ? 'token 未知' : value + '\u00a0token'; }
  function workerState(worker) { return statusLabels[worker.status] || worker.status || '状态待核'; }
  function workerReceipt(worker) {
    return box(worker.name, [badge(workerState(worker), worker.status === 'failed' ? 'warn' : ''),
      note(worker.model + ' · ' + worker.elapsed + ' · ' + tokenText(worker.tokens)),
      el('pre', worker.receipt || '暂无回执，状态待核。', 'pre'), note('演示，未真实执行')]);
  }
  function compareDispatchRound(round) {
    var workers = round.workers || [];
    H.sheet({ title: '第 ' + round.round + ' 轮 · 对比两路的结果', body: function (c) {
      c.append(el('div', [badge('演示，未真实执行'),
        note('同一轮、同一验收目标；并排核对结论、证据与未知项。token 未知不按零计算，也不自动选胜者。'),
        el('div', workers.slice(0, 2).map(workerReceipt), 'comparison'),
        note(round.round === 1 ? '合并建议：保留交互问题与文案待办，交下一轮复核；两路都没有真实手机证据。' : '待拍板：一路仅完成模拟复核，另一路中断；不能据此判定任务验收通过。')
      ], demoText("automation.body.23")));
    } });
  }
  function renderDispatchTimeline(data) {
    data = data || dispatchTimeline;
    var rounds = data.rounds || [];
    return box('派工时间线', [badge('演示，未真实执行'),
      note('任务：' + taskName(data.taskId) + ' · 临时工人只属于任务执行流，不进入首页，也不创建独立记忆。'),
      el('ol', rounds.map(function (round) {
        return el('li', [el('h3', '第 ' + round.round + ' 轮'),
          stack((round.workers || []).map(function (worker) {
            return details(el('span', [el('strong', worker.name + ' · 点开看回执'),
              el('span', worker.model + ' · ' + workerState(worker) + ' · ' + worker.elapsed + ' · ' + tokenText(worker.tokens), 'worker-metrics')]), [badge(workerState(worker), worker.status === 'failed' ? 'warn' : ''),
              note('模型：' + worker.model), note('耗时：' + worker.elapsed + ' · ' + tokenText(worker.tokens)),
              el('pre', worker.receipt || '暂无回执，状态待核。', 'pre'), note('演示，未真实执行')], false);
          })),
          (round.workers || []).length >= 2 ? button('对比两路的结果', function () { compareDispatchRound(round); }, true) : note('等另一条回执后再对比。')
        ], 'round');
      }), demoText("automation.sample.24"))
    ], null, demoText("automation.sample.25"), 'pm');
  }
  function renderBotTemplateWall() {
    return box('我们自己的模板墙', [badge('演示，未真实执行'),
      note(demoText("automation.sample.26")),
      el('div', botTemplates.map(function (template) {
        return box(template.name, [note(template.duty), badge('主色 · ' + template.colorName),
          note('大脑：' + template.brain), note('工人：' + template.workers.join(' / ')),
          note('工具：' + template.tools.join(' / ')), note('演示，未真实执行；没有连接账号或服务。')
        ], null, 'template', template.accent);
      }), 'grid')
    ], null, 'template-wall', 'chief');
  }
  var files = demoFixture("automation.files.27");
  var duplex = demoFixture("automation.duplex.28");
  var notifications = demoFixture("automation.notifications.29");

  function botName(id) {
    var bot = (H.state.bots || []).find(function (b) { return b.id === id; });
    return bot ? bot.name : '对应助理';
  }
  function projectName(id) {
    return demoFixture("automation.sample.30")[id] || id;
  }
  function sessionName(id) { return (H.state.sessionNames || {})[id] || '今日会话'; }
  function sessionSource(id) { return botName(id) + ' · ' + sessionName(id); }
  function taskName(id) {
    var card = cards().find(function (c) { return c.task === id || c.id === id; });
    return card ? card.title : '关联任务待选择';
  }
  // Search excerpts can contain identifiers supplied by other modules.
  function readableExcerpt(text) {
    (H.state.bots || []).slice().sort(function (a, b) { return b.id.length - a.id.length; }).forEach(function (bot) {
      text = text.split(bot.id + '-013').join(sessionSource(bot.id))
        .split(bot.id + '-demo-013').join(sessionSource(bot.id));
    });
    return text;
  }
  function unitParts(text) {
    return text.split(/(\d[\d,.]*(?:\s*\/\s*\d[\d,.]*)?\s*(?:token|tok\/s|KB|MB|GB|ms|分钟|小时|秒|分|天|条|件|项|个|轮|格|段|类|台|%))/g).map(function (part, i) {
      return i % 2 ? h('span', { class: 'm-automation-unit' }, part) : part;
    });
  }
  function emptyTask(message) {
    return el('div', [note(message), button('回到任务列表', function () { H.navigate({ view: 'task' }); }, true)], 'stack');
  }
  function el(tag, content, className) {
    var shared = { brief: 'pop-card', 'list-card': 'pop-card', next: 'pop-card',
      day: 'pop-card', details: 'pop-card', rule: 'pop-card',
      source: 'sticker', badge: 'badge', field: 'field', panel: 'pop-card' };
    var kind = (className || '').split(' ')[0];
    return h(tag, className ? { class: 'm-automation-' + className + (shared[kind] ? ' ' + shared[kind] : '') } : {}, typeof content === 'string' ? unitParts(content) : content);
  }
  // Only tint this module's own nodes; mixed-bot lists keep independent accents.
  function botScope(node, botId) {
    if (botId) node.setAttribute('style', H.botStyle(botId));
    return node;
  }
  function note(text) { return el('p', text, 'muted'); }
  function replaceContent(node, children) {
    node.replaceChildren.apply(node, children.filter(function (child) { return child != null; }));
  }
  function source(name) {
    name = name.replace(new RegExp(demoText("automation.sample.31"),"g"), demoText("automation.sample.32")).replace(new RegExp(demoText("automation.sample.33"),"g"), '本地派工流程')
      .replace(new RegExp(demoText("automation.sample.34"),"g"), '内容工作台').replace(/prior\/ 历史资料索引/g, '历史资料索引');
    return el('small', '来自：' + name + ' · 历史资料，当前运行待核', 'source');
  }
  function button(label, fn, active, tier) {
    return h('button', {
      type: 'button', class: 'm-automation-btn btn-' + (active ? 'primary' : tier || 'secondary') + (active ? ' m-automation-primary' : ''), onClick: fn
    }, label);
  }
  function actions(nodes) { return el('div', nodes, 'actions'); }
  function stack(nodes) { return el('div', nodes, 'stack'); }
  function box(title, body, origin, extra, botId) {
    return botScope(h('section', { class: 'm-automation-box pop-card' + (extra ? ' m-automation-' + extra : '') }, [
      h('header', { class: 'm-automation-card-head pop-card-head' }, el('h2', title)),
      origin ? source(origin) : null, body
    ]), botId);
  }
  function row(title, description, controls, botId) {
    return botScope(el('div', [el('div', [el('strong', title), note(description)], 'grow'), actions(controls || [])], 'row'), botId);
  }
  function badge(text, kind) {
    return el('span', [el('i', '', 'dot'), text], 'badge' + (kind ? ' m-automation-' + kind : ''));
  }
  function field(label, control) {
    return h('label', { class: 'm-automation-field field' }, [el('span', label), control]);
  }
  function input(placeholder, value, onInput, type) {
    return h('input', { class: 'm-automation-input pop-input', type: type || 'text', placeholder: placeholder,
      value: value || '', onInput: onInput });
  }
  function switchRow(title, checked, change, description) {
    return el('div', [
      el('div', [el('strong', title), description ? note(description) : null], 'grow'),
      h('button', {
        type: 'button', class: demoText("automation.class.35") + (checked ? ' m-automation-on on' : ''),
        role: demoText("automation.role.36"), 'aria-label': title, 'aria-checked': String(checked),
        onClick: function (e) {
          checked = !checked;
          e.currentTarget.setAttribute('aria-checked', String(checked));
          e.currentTarget.classList.toggle('m-automation-on', checked);
          e.currentTarget.classList.toggle('on', checked);
          change(checked);
        }
      }, el('i', '', 'knob'))
    ], 'row toggle-row');
  }
  function segments(values, selected, change, label) {
    return h('nav', { class: 'm-automation-segments segmented', 'aria-label': label || '筛选' }, values.map(function (v) {
      var value = typeof v === 'string' ? v : v.value;
      var text = typeof v === 'string' ? v : v.label;
      return h('button', {
        type: 'button', class: 'm-automation-segment' + (value === selected ? ' m-automation-active on' : ''),
        'aria-pressed': String(value === selected), onClick: function () { change(value); }
      }, text);
    }));
  }
  function progress(label, value, text) {
    return el('div', [
      el('div', [el('span', label), el('strong', text || (value == null ? '未知' : value + '%'))], 'meter-label'),
      h('div', { class: 'm-automation-meter', role: 'progressbar', 'aria-label': label,
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': value == null ? null : String(value),
        'aria-valuetext': value == null ? '离线，读数未知' : (text || value + '%') },
      h('span', { style: { width: (value || 0) + '%' } }))
    ], 'meter-wrap');
  }
  function details(title, children, opened, id) {
    return h('details', {
      class: 'm-automation-details pop-card', open: !!opened,
      onToggle: id ? function (e) { state.treeOpen[id] = e.currentTarget.open; } : null
    }, [el('summary', title), stack(children)]);
  }
  function refresh(resetScroll) {
    if (mount && mount.isConnected) {
      var top = resetScroll ? 0 : mount.scrollTop;
      mount.replaceChildren();
      render(mount, mountContext);
      mount.scrollTop = top;
    }
  }
  function go(tab) {
    var routes = { '任务单': 'tickets', '后台': 'agents', '文件': 'briefs' };
    var id = routes[tab];
    if (id) H.runCapability('automation-' + id, capabilityBy(id).phrases[0]);
    else H.navigate({ view: 'capabilities' });
  }
  function inspect(kind, id) { H.openPanel('automation-inspector', { kind: kind, id: id }); }
  function cards() { return H.state.cards || []; }
  function status(card) { return col[card.col] || 'new'; }
  function cardBy(id) { return cards().find(function (card) { return card.id === id; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function japanDay(d) { return new Date(d.getTime() + featureDemo.offsetHours * 3600000); }
  function occurs(s, day) {
    var key = dateKey(day);
    if (key < s.start) return false;
    if (s.repeat === '仅一次') return key === s.start;
    if (s.repeat === '工作日') return day.getUTCDay() > 0 && day.getUTCDay() < 6;
    if (s.repeat === '每周') return s.days.indexOf(day.getUTCDay()) >= 0;
    return true;
  }
  function nextOccurrence(s, after) {
    if (s.paused) return null;
    after = after || demoNow;
    for (var i = 0; i < 370; i++) {
      var day = japanDay(after);
      day.setUTCDate(day.getUTCDate() + i);
      var candidate = new Date(dateKey(day) + 'T' + s.time + demoText("automation.candidate.37"));
      if (candidate > after && occurs(s, day)) return { date: dateKey(day), at: dateKey(day) + ' ' + s.time + ' ' + featureDemo.timezone, stamp: candidate.getTime() };
    }
    return null;
  }
  function nextRun(s) {
    var next = nextOccurrence(s);
    return s.paused ? '已暂停' : next ? next.at : '无后续运行（单次已过期）';
  }
  function simulateRun(s) {
    runHistory.unshift({
      id: 'demo-run-' + (runHistory.length + 1), schedule: s.id, time: demoClockLabel() + ' · 手动', status: '完成',
      summary: '模拟 ' + s.name + ' · 无真实投递',
      evidence: '状态：已完成（演示）\n证据：' + s.name + '的模拟回执\n目标：' + sessionSource(s.bot),
      unknowns: '真实执行与接收均未核验；未启动后台进程。'
    });
    refresh();
  }
  function chart(values, label) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'm-automation-chart');
    svg.setAttribute('viewBox', '0 0 280 68');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    var points = values.map(function (v, i) { return (12 + i * 42) + ',' + (58 - v * 0.48); }).join(' ');
    var line = document.createElementNS(ns, demoText("automation.sample.38"));
    line.setAttribute('points', points);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--bot-strong)');
    line.setAttribute('stroke-width', '3');
    svg.append(line);
    values.forEach(function (v, i) {
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', String(12 + i * 42));
      dot.setAttribute('cy', String(58 - v * 0.48));
      dot.setAttribute('r', '4');
      dot.setAttribute('fill', 'var(--bot)');
      dot.setAttribute('stroke', demoText("automation.sample.39"));
      dot.setAttribute('stroke-width', demoText("automation.sample.40"));
      svg.append(dot);
    });
    return svg;
  }

  function today() {
    var decisions = demoFixture("automation.decisions.41");
    var night = demoFixture("automation.night.42");
    return stack([
      el('div', [
        box('今天需要你', decisions.map(function (d) {
          return row(d[1], d[2] + '\n本页选择：' + (state.decisions[d[0]] || '尚未记录'), [
            button(state.decisions[d[0]] === '稍后' ? '恢复待看' : '稍后', function () {
              state.decisions[d[0]] = state.decisions[d[0]] === '稍后' ? '待看' : '稍后'; refresh();
            }), button('看关联任务', function () { go('任务单'); })
          ]);
        }), '项目总管「今天」'),
        box('昨夜 agent 干了什么', night.map(function (n) {
          return row(n[1], n[2] + '\n' + (state.nightSeen[n[0]] ? '已读 · 本页记录' : '未读'), [
            button(state.nightSeen[n[0]] ? '标为未读' : '标记已读', function () {
              state.nightSeen[n[0]] = !state.nightSeen[n[0]]; refresh();
            })
          ]);
        }), '项目总管「今天」')
      ], 'grid'),
      box('例行简报 · 晨会 / 晚会 / 空闲', stack([
        segments(['晨会', '晚会', '空闲'], state.brief, function (v) { state.brief = v; refresh(); }, '简报类型'),
        brief({ title: state.brief + '简报', mode: state.brief }),
        note('已提供例行简报卡；这里为卡片预览，不向真实会话追加消息。')
      ]), '主动今日简报'),
      box('今天的焦点与来源', [
        row('焦点 · DSH 可点样张', '模块演示 → 操作核验 → 人工体验；不代表已采纳。'),
        row('状态 · 3 条待决策 / 1 个封面阻塞', '状态来自本页虚构快照；不推断发布或成交。'),
        row('来源年龄 · 11/12 快照', '需要你、焦点、昨夜、状态、来源年龄五项同屏。', [button('查看交付物', function () { go('文件'); })])
      ], '项目总管「今天」')
    ]);
  }
  function brief(data) {
    data = data || {};
    var mode = data.mode || '晨会';
    var lines = mode === '空闲' ? demoFixture("automation.sample.43") : mode === '晚会' ? demoFixture("automation.sample.44") : demoFixture("automation.sample.45");
    var key = data.title || mode;
    var card = el('article', [], 'brief');
    function paint() {
      replaceContent(card, [el('strong', data.title || '今日简报'), badge('演示 · ' + (state.briefSeen[key] ? '已阅' : '待阅')),
        H.levelSticker('L1', { action: '标记简报已阅', scope: '本页简报阅读状态', bot: featureAssistantId('schedule') }),
        source('主动今日简报'), data.text ? note(data.text) : null,
        el('div', lines.map(function (text) { return row(text, '仅页面预览，不代表真实业务状态。'); })),
        actions([button(state.briefSeen[key] ? '恢复待阅' : '标记已阅', function () {
          state.briefSeen[key] = !state.briefSeen[key]; paint();
        }), button('问' + (featureAssistant('schedule')?.name || '负责助理') + '今天的焦点', function () {
          H.runCapability('automation-briefs', capabilityBy('briefs').phrases[0]);
        }), button('搜索交付物', function () { H.openPanel('automation-search'); })])]);
    }
    paint();
    return card;
  }

  function schedule() {
    return stack([
      box('定时任务 · ' + schedules.length + ' 项', stack([
        note('演示时钟固定为 ' + demoClockLabel() + '；日期按重复规则计算，刷新复原。'),
        actions([segments(['列表', '一周日历'], state.calendar ? '一周日历' : '列表', function (v) {
          state.calendar = v === '一周日历'; refresh();
        }, '定时视图'), button('新建定时任务', function () {
          state.scheduleSaved = '';
          state.scheduleForm = demoFixture("automation.sample.46");
          H.openPanel('automation-schedule');
        }, true)]),
        state.calendar ? weekGrid() : el('div', schedules.map(function (s) {
          return botScope(el('article', [
            row(s.name, s.repeat + ' · ' + s.time + ' → ' + sessionSource(s.bot),
              [badge(s.paused ? '已暂停' : '计划中', s.paused ? 'quiet' : '')]),
            el('div', [el('span', '下次运行'), el('strong', nextRun(s))], 'next'),
            source(s.origin), note(s.count),
            actions([
              button('运行历史', function () { inspect('schedule', s.id); }),
              button('立即跑一次', function () { simulateRun(s); }),
              button(s.paused ? '恢复计划' : '暂停计划', function () { s.paused = !s.paused; refresh(); })
            ])
          ], 'list-card'), s.bot);
        }))
      ]), '知识库定时整理 / LanceDB 记忆巡检'),
      box('运行历史 · 逐次展开结果', historyList(runHistory), demoText("automation.sample.47"))
    ]);
  }
  function weekGrid() {
    var monday = new Date(demoText("automation.monday.48"));
    return el('div', [
      row('11/09 — 11/15', '周一至周日 · JST · 暂停任务不进入日历点位。'),
      el('div', Array.from({ length: 7 }, function (_, i) {
        var d = new Date(monday); d.setUTCDate(d.getUTCDate() + i);
        var items = schedules.filter(function (s) { return !s.paused && occurs(s, d); });
        return el('div', [
          el('strong', dayNames[d.getUTCDay()]), el('span', '11/' + pad(d.getUTCDate())),
          items.length ? items.map(function (s) {
            return h('button', { type: 'button', class: 'm-automation-event btn-secondary', style: H.botStyle(s.bot), onClick: function () { inspect('schedule', s.id); } }, [
              el('i', '', 'dot'), el('span', s.time + ' ' + s.name)
            ]);
          }) : note('无计划')
        ], 'day' + (i === 4 ? ' m-automation-today' : ''));
      }), 'week')
    ]);
  }
  function historyList(list) {
    if (!list.length) return note('尚无运行记录；可点「立即跑一次」添加模拟回执。');
    return el('div', list.map(function (r) {
      var s = schedules.find(function (x) { return x.id === r.schedule; });
      return details(r.time + ' · ' + (s ? s.name : '演示任务') + ' · ' + r.status, [
        badge(r.status, r.status === '完成' ? '' : 'warn'), note(r.summary),
        el('pre', r.evidence, 'pre'), note('未知项：' + r.unknowns), note('模拟回执，无真实消息。')
      ], false);
    }));
  }
  function scheduleForm(container) {
    var f = state.scheduleForm;
    if (!f) { container.append(note('请从定时任务页新建任务。')); return; }
    var error = el('p', '', 'error');
    function paint() {
      container.replaceChildren(el('div', [
        note('只创建页面内计划，时区 Asia/Tokyo；不会安装系统定时任务。'),
        field('任务名称', input('例如：周末项目回顾', f.name, function (e) { f.name = e.target.value; })),
        field('开始日期', input('', f.start, function (e) { f.start = e.target.value; }, 'date')),
        field('执行时间', input('', f.time, function (e) { f.time = e.target.value; }, 'time')),
        el('h3', '重复规则'),
        segments(['每天', '工作日', '每周', '仅一次'], f.repeat, function (v) { f.repeat = v; paint(); }, '重复规则'),
        f.repeat === '每周' ? el('div', [note('至少选择一天'), el('div', [1, 2, 3, 4, 5, 6, 0].map(function (n) {
          return h('button', { type: 'button', class: 'm-automation-btn btn-secondary' + (f.days.indexOf(n) >= 0 ? ' m-automation-active' : ''),
            'aria-pressed': String(f.days.indexOf(n) >= 0), onClick: function () {
              f.days = f.days.indexOf(n) >= 0 ? f.days.filter(function (x) { return x !== n; }) : f.days.concat(n); paint();
            } }, dayNames[n]);
        }), 'actions')]) : note('按所选规则从开始日期计算下一次运行。'),
        el('h3', '投递助理与会话'),
        segments(demoFixture("automation.sample.49").map(function (id) { return { value: id, label: botName(id) }; }), f.bot, function (v) { f.bot = v; paint(); }, '投递助理'),
        note('会话：' + sessionSource(f.bot) + '；同一任务只保留一轮，结果未知先查历史。'),
        error,
        state.scheduleSaved ? badge(state.scheduleSaved) : null,
        actions([button('保存演示任务', function () {
          if (!f.name.trim() || !/^\d{2}:\d{2}$/.test(f.time) || !/^\d{4}-\d{2}-\d{2}$/.test(f.start) ||
              (f.repeat === '每周' && !f.days.length)) {
            error.textContent = '请填写名称、有效日期与时间；每周至少选择一天。'; return;
          }
          if (state.scheduleSaved) { error.textContent = '本表单已保存；新建另一项请返回任务列表。'; return; }
          schedules.push({ id: 's' + (schedules.length + 1), name: f.name.trim(), time: f.time,
            repeat: f.repeat, start: f.start, days: f.days.slice(), bot: f.bot, conversation: f.bot + '-013',
            paused: false, origin: '本页自定义计划', count: '尚无运行 · 演示草稿' });
          state.scheduleSaved = '已保存：' + f.name.trim(); refresh(); paint();
        }, true), button('返回定时列表', function () {
          H.runCapability('automation-schedules', capabilityBy('schedules').phrases[0]);
        })])
      ], 'panel'));
      botScope(container.firstElementChild, f.bot);
    }
    paint();
  }

  function route() {
    var q = input(demoText("automation.q.50"), state.routeQuery || demoText("automation.q.51"));
    var output = el('div', [], 'stack');
    function update() {
      var text = q.value.trim(); state.routeQuery = q.value;
      var matched = state.script && text ? rules.filter(function (r) { return r.enabled && r.match.test(text); }) : [];
      var first = matched[0];
      output.replaceChildren(
        el('p', !state.script ? demoText("automation.sample.52") : !text ? '输入一句话，实时显示命中规则。' :
          first ? '命中 ' + matched.length + ' 条；优先采用 ' + first.name + ' → ' + sessionSource(first.bot) : demoText("automation.sample.53"), 'route-result'),
        el('div', rules.map(function (r, i) {
          var hit = matched.indexOf(r) >= 0;
          return h('article', { class: 'm-automation-rule pop-card' + (hit ? ' m-automation-hit' : ''), style: H.botStyle(r.bot), 'data-rule': r.id }, [
            row((i + 1) + ' · ' + r.name, r.terms + '\n' + r.level + ' → ' + sessionSource(r.bot), [
              badge(first === r ? '采用' : hit ? '同时命中' : r.enabled ? '待命' : '停用', hit ? '' : 'quiet')
            ]), source(r.origin), switchRow('启用 ' + r.name, r.enabled, function (v) { r.enabled = v; update(); })
          ]);
        })),
        row('5 · 默认兜底', demoText("automation.sample.54"), [badge(!first ? '采用' : '兜底', !first ? '' : 'quiet')])
      );
    }
    q.addEventListener('input', update);
    update();
    return box('一句话如何分派 · 实时命中', stack([
      note('按从上到下的优先级选第一条；多条命中会同时标亮，仅做路由预览。'),
      switchRow('脚本先判', state.script, function (v) { state.script = v; update(); }, demoText("automation.sample.55")),
      field('命中测试', q), actions([
        button('试试四平台', function () { q.value = demoText("automation.sample.56"); update(); }),
        button('试试多重命中', function () { q.value = demoText("automation.sample.57"); update(); }),
        button('清空', function () { q.value = ''; update(); q.focus(); }, false, 'tertiary')
      ]), output
    ]), demoText("automation.sample.58"));
  }

  function checkButton(key, label, changed) {
    return h('button', { type: 'button', class: 'm-automation-check btn-secondary' + (state.checked[key] ? ' m-automation-active' : ''),
      role: 'checkbox', 'aria-checked': String(!!state.checked[key]), onClick: function (e) {
        state.checked[key] = !state.checked[key];
        e.currentTarget.setAttribute('aria-checked', String(state.checked[key]));
        e.currentTarget.classList.toggle('m-automation-active', state.checked[key]);
        e.currentTarget.replaceChildren(H.icon('check-circle',{fill:!!state.checked[key]}), ' ' + label);
        if (changed) changed();
      } }, [H.icon('check-circle',{fill:!!state.checked[key]}), ' ' + label]);
  }
  function tasks() {
    var values = [{ value: 'all', label: '全部 ' + cards().length }];
    Object.keys(statusLabels).forEach(function (key) {
      values.push({ value: key, label: statusLabels[key] + ' ' + cards().filter(function (c) { return status(c) === key; }).length });
    });
    var list = cards().filter(function (c) { return state.taskFilter === 'all' || state.taskFilter === status(c); });
    return stack([
      box('任务单 · 与看板同源', stack([
        note('状态与看板同源，改状态后看板同步；刷新复原，不写项目文件。'),
        segments(values, state.taskFilter, function (v) { state.taskFilter = v; refresh(); }, '任务状态'),
        list.length ? list.map(function (card) {
          return row(card.title, statusLabels[status(card)] + '\n' + projectName(card.project) + '／' + botName(card.bot) + ' · ' + card.sub,
            [button('任务书 / 回执 / 验收', function () { H.openPanel('automation-detail', { id: card.id }); })], card.bot);
        }) : note('当前状态没有任务；切回「全部」查看。')
      ]), demoText("automation.sample.59")),
      box('任务书模板 · 六项交接', templates.slice(0, 3).map(function (t) {
        return row(t.name, '目标 / 正本与机器 / 唯一写者 / 已验证成果 / 下一步 / 禁止项', [
          button('展开任务书', function () { inspect('template', t.name); })
        ], t.bot);
      }), demoText("automation.sample.60")),
      box('任务单轮询 · 任务队列', [
        switchRow('演示轮询', state.runner, function (v) { state.runner = v; refresh(); }, '只影响下面的模拟队列，没有真实进程。'),
        row('DSH 样张', state.runner ? demoText("automation.sample.61") : '暂停轮询 · 保留领取人'),
        row('四平台交接', '已阻塞 · 原因：发布授权缺失；不自动续办。'),
        row('客服对稿', '待领取 · 等待唯一领取人；结果须带证据、未知项与下一步。')
      ], demoText("automation.sample.62")),
      box('回执与验收 · 最近三项', [
        row('DSH 方向 B', '状态：进行中；证据：样张评审清单；未知项：真机体验。', [button('查看验收', function () { H.openPanel('automation-detail', { id: 'c7' }); })]),
        row(demoText("automation.sample.63"), '状态：已阻塞；证据：交接清单；下一步：核对批复。', [button('查看回执', function () { H.openPanel('automation-detail', { id: 'c8' }); })]),
        row(demoText("automation.sample.64"), '状态：进行中；证据：回复草稿；未知项：接待时间。', [button('查看清单', function () { H.openPanel('automation-detail', { id: 'c4' }); })])
      ], demoText("automation.sample.65"))
    ]);
  }
  function detailTask(container, id) {
    var card = cardBy(id);
    if (!card) { container.append(emptyTask('暂时找不到这项任务，请回到任务列表重新选择。')); return; }
    function paint() {
      var s = status(card);
      var receipt = state.ticketNotes[id] || '尚未验收；进程成功与任务正确分别判断。';
      container.replaceChildren(el('div', [
        box(card.title, [
          badge(statusLabels[s]), note(projectName(card.project) + '／' + botName(card.bot) + ' · 领取人：' + botName(card.bot)), note(card.detail || card.sub),
          button('到看板暂存移动，再点提交', function () { H.navigate({ view: 'kanban' }); })
        ], demoText("automation.sample.66")),
        box('任务书模板', [
          row('目标', card.title),
          row('正本与唯一写者', projectName(card.project) + '的演示工作目录 · ' + botName(card.bot)),
          row('读写范围与禁止项', '仅本地演示数据；不外发、不付费、不部署、不删数据。'),
          row('验收与下一步', '列出可复核证据、未知项与下一步；交人工体验。')
        ], demoText("automation.sample.67")),
        box('结构化回执', [
          el('pre', '状态：' + statusLabels[s] + '\n证据：' + card.title + '的演示回执\n未知项：真实执行、投递与验收未知\n下一步：人工复核\n进程结果：未启动命令行工具\n任务结果：演示待核', 'pre'),
          note('验收记录：' + receipt),
          note('任务单轮询：' + (state.runner ? '演示轮询中' : '暂停') + '；无真实任务执行。')
        ], demoText("automation.sample.68")),
        box('验收清单', stack([
          checkButton(id + ':scope', '目标与读写范围相符'),
          checkButton(id + ':evidence', '证据可复核，示例与真实结果分开'),
          checkButton(id + ':unknowns', '未知项与下一步已说明'),
          button('记录本页验收回执', function () {
            var complete = ['scope', 'evidence', 'unknowns'].every(function (k) { return state.checked[id + ':' + k]; });
            state.ticketNotes[id] = complete ? demoText("automation.sample.69") : '演示检查未齐；请补齐三项后记录。';
            H.toast('本页演示 · ' + card.title + '：' + state.ticketNotes[id]);
            refresh(); paint();
          }, true)
        ]), demoText("automation.sample.70"))
      ], 'panel'));
      botScope(container.firstElementChild, card.bot);
    }
    paint();
  }

  function makeDispatch() {
    state.dispatchSnapshot = state.dispatchText;
    var specs = demoFixture("automation.specs.71");
    state.dispatch = specs.filter(function (r) { return state.dispatchModels.indexOf(r[0]) >= 0; }).map(function (r) {
      return { model: r[0], time: r[1], tokens: r[2], conclusion: r[3], status: r[4] };
    });
  }
  makeDispatch();
  function dispatch() {
    var error = el('p', '', 'error');
    var text = h('textarea', { class: 'm-automation-input pop-input', rows: 7, 'aria-label': '派工任务书', value: state.dispatchText,
      onInput: function (e) { state.dispatchText = e.target.value; } });
    var modelNames = demoFixture("automation.modelNames.72");
    return stack([
      box('派工台 · 任务书 → 多路 → 回执 → 验收', stack([
        note('第 ' + state.dispatchRound + ' 轮模拟 · 每路独立任务包，不调用外部 CLI，不消耗模型额度。'),
        field('任务书', text),
        el('div', modelNames.map(function (name) {
          return switchRow(name, state.dispatchModels.indexOf(name) >= 0, function (v) {
            state.dispatchModels = v ? state.dispatchModels.concat(name) : state.dispatchModels.filter(function (m) { return m !== name; });
          }, name.indexOf(demoText("automation.sample.73")) >= 0 ? '文字整理与照手册执行；结论需核对。' : '独立演示路径，按同一验收标准比较。');
        })), error,
        button('生成一轮模拟回执', function () {
          if (!state.dispatchText.trim() || !state.dispatchModels.length) { error.textContent = '请填写任务书，并至少启用一路。'; return; }
          state.dispatchRound++; state.selectedRoute = ''; state.dispatchChecks = {}; makeDispatch(); refresh();
        }, true)
      ]), demoText("automation.sample.74")),
      box('并行多路对比', stack([
        note('当前候选：' + (state.selectedRoute || '尚未选择') + demoText("automation.sample.75")),
        el('div', h('table', { class: 'm-automation-table' }, [
          el('caption', '第 ' + state.dispatchRound + ' 轮 · 模型、耗时、token、结论与验收'),
          el('thead', el('tr', ['模型', '耗时', 'token', '结论', '验收', '候选'].map(function (x) { return el('th', x); }))),
          el('tbody', state.dispatch.map(function (r) {
            return h('tr', { class: state.selectedRoute === r.model ? 'm-automation-hit' : '' }, [
              el('td', [el('strong', r.model), badge(statusLabels[r.status] || r.status, r.status === 'blocked' ? 'warn' : '')]), el('td', r.time + ' 秒'), el('td', r.tokens.toLocaleString()),
              el('td', [note(r.conclusion), button('展开回执', function () { inspect('dispatch', r.model); })]),
              el('td', h('button', { type: 'button', class: 'm-automation-check btn-secondary', role: 'checkbox',
                'aria-checked': String(!!state.dispatchChecks[r.model]), onClick: function () {
                  state.dispatchChecks[r.model] = !state.dispatchChecks[r.model];
                  if (!state.dispatchChecks[r.model] && state.selectedRoute === r.model) state.selectedRoute = '';
                  refresh();
                } }, [H.icon('check-circle',{fill:!!state.dispatchChecks[r.model]}),state.dispatchChecks[r.model] ? ' 已检查' : ' 待检查'])),
              el('td', button(state.selectedRoute === r.model ? '已选候选' : '选这一路', function () {
                if (!state.dispatchChecks[r.model]) { H.toast('请先检查该路回执并勾选验收。'); return; }
                state.selectedRoute = r.model; refresh();
              }, state.selectedRoute === r.model))
            ]);
          }))
        ]), 'table-scroll'),
        note('耗时与 token 全是假读数；验收勾表示已检查，阻塞的那一路仍需补证据。表格可在内部横向滚动。')
      ]), demoText("automation.sample.76"))
    ]);
  }

  function jobNode(job, depth) {
    var opened = state.treeOpen[job.id] !== undefined ? state.treeOpen[job.id] : depth === 0 && job.id === 'j1';
    return details(job.name + ' · ' + job.status + ' · ' + job.model, [
      progress('进度', job.progress), note('模型：' + job.model + ' · 耗时：' + (job.elapsed || '父任务内计时') + ' · 演示子代理：' + job.name),
      actions([
        button(job.status === '运行中' ? '暂停演示' : job.status === '完成' ? '恢复到排队' : '继续演示', function () {
          job.status = job.status === '运行中' ? '暂停' : job.status === '完成' ? '排队' : '运行中';
          if (job.status === '排队') job.progress = 0;
          state.treeOpen[job.id] = true; refresh();
        }), button('推进一步', function () {
          job.progress = Math.min(100, job.progress + 25); job.status = job.progress === 100 ? '完成' : '运行中';
          state.treeOpen[job.id] = true; refresh();
        })
      ]),
      job.children.length ? el('div', job.children.map(function (child) { return jobNode(child, depth + 1); }), 'tree') : note('叶节点 · 无子代理')
    ], opened, job.id);
  }
  function background() {
    var filtered = jobs.filter(function (j) { return state.jobFilter === '全部' || j.status === state.jobFilter; });
    return box('后台任务与子代理树', stack([
      note('父子节点独立显示状态；推进父节点不自动宣称所有子代理已完成。'),
      segments(['全部', '运行中', '排队', '完成'], state.jobFilter, function (v) { state.jobFilter = v; refresh(); }, '后台状态'),
      actions([button('展开全部', function () {
        function open(j) { state.treeOpen[j.id] = true; j.children.forEach(open); } jobs.forEach(open); refresh();
      }), button('收起全部', function () {
        function close(j) { state.treeOpen[j.id] = false; j.children.forEach(close); } jobs.forEach(close); refresh();
      })]),
      filtered.length ? filtered.map(function (j) { return jobNode(j, 0); }) : note('该状态暂时没有任务；切回全部查看。')
    ]), demoText("automation.sample.77"));
  }
  function machinesView() {
    return stack([
      box('多机总览 · 五台机器', [
        row('在线 4 / 离线 1（演示）', demoText("automation.sample.78")),
        row('正本按项目区分', demoText("automation.sample.79")),
        row('连接边界', demoText("automation.sample.80"), [button('看后台任务', function () { go('后台'); })]),
        chart([24, 32, 28, 45, 36, 42, 34], demoText("automation.sample.81"))
      ], demoText("automation.sample.82")),
      el('div', machines.map(function (m) {
        return box(m.id, stack([
          badge(m.online ? '在线 · 演示' : '离线 · 未连接', m.online ? '' : 'quiet'),
          progress('CPU', m.cpu), progress('内存', m.memory), progress('显存 / 统一内存占用', m.gpu),
          note('角色：' + m.owner + '（演示标记）\n正本：' + m.path + '\n唯一写者：' + m.writer),
          el('h3', '服务与端口'),
          el('ul', m.services.map(function (s) { return el('li', s); }), 'services'),
          button('SSH 终端 · 演示', function () { inspect('terminal', m.id); })
        ]), demoText("automation.sample.83"));
      }), 'grid')
    ]);
  }
  function modelsView() {
    return stack([
      box('本地模型 · 常驻与备选', [
        note('当前页面选择：' + state.model + ' · 检查次数 ' + state.modelChecks + ' · 切换不影响真实服务或既有队列。'),
        el('div', [
          box(demoText("automation.sample.84"), [badge(state.model === demoText("automation.sample.85") ? '当前选择' : '待选'), row('吞吐', '18.6 tok/s · 演示读数'),
            row('显存', '22.4 / 32 GB · 演示'), row('适用', '摘要、格式整理、回执归并'),
            button(demoText("automation.sample.86"), function () { state.model = demoText("automation.sample.87"); refresh(); }, state.model === demoText("automation.sample.88"))]),
          box(demoText("automation.sample.89"), [badge(state.model === demoText("automation.sample.90") ? '当前选择' : '备用'), row('吞吐', '12.2 tok/s · 演示读数'),
            row('显存', '16.0 / 32 GB · 演示'), row('适用', '受限执行手，失败回退人工'),
            button(demoText("automation.sample.91"), function () { state.model = demoText("automation.sample.92"); refresh(); }, state.model === demoText("automation.sample.93"))])
        ], 'grid'),
        chart([16, 18, 17, 20, 18, 19, 18], demoText("automation.sample.94")),
        button('刷新演示检查', function () { state.modelChecks++; refresh(); })
      ], demoText("automation.sample.95")),
      box('本地执行队列', state.queue.map(function (q) {
        return row(q.title, q.model + ' · ' + q.status + ' · 预计输入 ' + q.tokens + ' token', [
          button(q.status === '完成' ? '恢复排队' : '模拟完成', function () {
            q.status = q.status === '完成' ? '排队' : '完成'; refresh();
          })
        ]);
      }), demoText("automation.sample.96"))
    ]);
  }
  function collaborationView() {
    var steps = demoFixture("automation.steps.97");
    return stack([
      box('云端导师 + 本地执行手', stack([
        progress('流程', Math.round(state.flowStep / steps.length * 100), state.flowStep + ' / ' + steps.length),
        steps.map(function (s, i) { return row((i + 1) + ' · ' + s[0], s[1], [badge(i < state.flowStep ? '已到达' : '待处理', i < state.flowStep ? '' : 'quiet')]); }),
        actions([button('推进演示流程', function () { state.flowStep = Math.min(steps.length, state.flowStep + 1); refresh(); }),
          button('重置流程', function () { state.flowStep = 1; refresh(); }, false, 'tertiary')])
      ]), demoText("automation.sample.98")),
      box('双工模式 · 低风险先答后通知', stack([
        switchRow('启用双工演示', state.duplexEnabled, function (v) { state.duplexEnabled = v; refresh(); }, '只展示本地整理记录；付款、发布和发送不进入自动执行。'),
        note(state.duplexEnabled ? '接收低风险记录 → 先答 → 执行后显示通知。' : '已暂停新记录演示；历史记录保留。'),
        duplex.map(function (d) { return row(d.time + ' · ' + d.title, d.answer + '\n后续：' + d.result + '\n通知：' + (d.seen ? '已读' : '未读'), [
          button(d.seen ? '标记未读' : '查看通知', function () { d.seen = !d.seen; refresh(); })
        ]); }),
        button('追加低风险演示', function () {
          if (!state.duplexEnabled) { H.toast('双工演示已暂停，请先启用。'); return; }
          duplex.unshift({ id: 'du' + (duplex.length + 1), time: demoText("automation.time.99"), title: '交付物文件名归类',
            answer: '先答：按项目整理示例清单。', result: '模拟整理完成，无磁盘写入', seen: false }); refresh();
        })
      ]), demoText("automation.sample.100"))
    ]);
  }

  function workflow() {
    var selected = templates.find(function (t) { return t.name === state.template; });
    var step = state.templateStep[selected.name] || 0;
    return stack([
      box('工作流模板库', stack([
        segments(templates.map(function (t) { return t.name; }), state.template, function (v) { state.template = v; refresh(); }, '工作流模板'),
        templates.map(function (t) { return row(t.name, t.steps.join(' → '), [
          button(t.name === state.template ? '正在查看' : '查看模板', function () { state.template = t.name; refresh(); })
        ], t.bot); })
      ]), demoText("automation.sample.101")),
      box(selected.name + ' · 阶段与交付', stack([
        progress('模板进度', step * 25, step + ' / 4'),
        selected.steps.map(function (s, i) { return row((i + 1) + ' · ' + s, i < step ? '本页已演示 · 等待真实证据' : '尚未演示', [badge(i < step ? '已走过' : '待办', i < step ? '' : 'quiet')]); }),
        note('交付物：' + selected.output), note(selected.limits),
        actions([button('推进一阶段', function () { state.templateStep[selected.name] = Math.min(4, step + 1); refresh(); }),
          button('重置模板', function () { state.templateStep[selected.name] = 0; refresh(); }, false, 'tertiary'),
          button(state.templateAdded[selected.name] ? '已生成本页草稿' : '生成任务书草稿', function () {
            state.templateAdded[selected.name] = true; refresh(); inspect('template', selected.name);
          })])
      ]), selected.origin, null, selected.bot)
    ]);
  }
  function dndHint() {
    if (!state.dnd) return '勿扰关闭 · 所有命中规则进入本页待阅箱。';
    return state.dndStart === state.dndEnd ? '开始与结束相同：全天勿扰。' :
      '勿扰 ' + state.dndStart + '–' + state.dndEnd + ' JST · 普通完成消息汇总，阻塞与待拍板保留待阅。';
  }
  function notificationView() {
    var hint = note(dndHint());
    return stack([
      box('通知中心 · 推送规则', [
        switchRow('阻塞通知', state.notifyRules.blocked !== false, function (v) { state.notifyRules.blocked = v; }, demoText("automation.sample.102")),
        switchRow('待拍板通知', state.notifyRules.decision !== false, function (v) { state.notifyRules.decision = v; }, '触发：待审核 / 待确认 → 对应 bot 会话；演示。'),
        switchRow('完成汇总', !!state.notifyRules.done, function (v) { state.notifyRules.done = v; }, '触发：完成 → 晚会简报；默认不逐条提醒。'),
        button('模拟规则命中', function () {
          var matched = [];
          if (state.notifyRules.blocked !== false) matched.push('阻塞');
          if (state.notifyRules.decision !== false) matched.push('待拍板');
          if (state.notifyRules.done) matched.push('完成');
          notifications.unshift({ id: 'n' + (notifications.length + 1), title: '推送规则测试', type: '测试', time: demoText("automation.time.103"), seen: false,
            detail: matched.length ? '命中：' + matched.join(' / ') + '。' + dndHint() : '所有规则已关闭；仅保留本页测试结果。' }); refresh();
        })
      ], demoText("automation.sample.104")),
      box('勿扰时段', [
        switchRow('启用勿扰', state.dnd, function (v) { state.dnd = v; hint.textContent = dndHint(); }),
        field('开始时间', input('', state.dndStart, function (e) { if (e.target.value) state.dndStart = e.target.value; hint.textContent = dndHint(); }, 'time')),
        field('结束时间', input('', state.dndEnd, function (e) { if (e.target.value) state.dndEnd = e.target.value; hint.textContent = dndHint(); }, 'time')),
        hint, note('所有推送均为页面内模拟；此设置不改变系统或 bot 的真实通知。')
      ], demoText("automation.sample.105")),
      box('通知待阅箱 · ' + notifications.filter(function (n) { return !n.seen; }).length + ' 条未读', [
        button('全部标记已读', function () { notifications.forEach(function (n) { n.seen = true; }); refresh(); }),
        notifications.map(function (n) { return row(n.time + ' · ' + n.title, n.type + ' · ' + (n.seen ? '已读' : '未读') + '\n' + n.detail, [
          button(n.seen ? '标为未读' : '标记已读', function () { n.seen = !n.seen; refresh(); })
        ]); })
      ], demoText("automation.sample.106"))
    ]);
  }
  function fileLibrary() {
    var key = state.fileMode === '项目' ? 'project' : 'bot';
    var filters = ['全部'];
    files.forEach(function (f) { if (filters.indexOf(f[key]) < 0) filters.push(f[key]); });
    var list = files.filter(function (f) { return state.fileFilter === '全部' || f[key] === state.fileFilter; });
    return box('文件与交付物库', stack([
      segments([{ value: '项目', label: '按项目' }, { value: 'bot', label: '按助理' }], state.fileMode, function (v) { state.fileMode = v; state.fileFilter = '全部'; refresh(); }, '交付物分组方式'),
      segments(filters.map(function (value) { return { value: value, label: key === 'bot' && value !== '全部' ? botName(value) : value }; }), state.fileFilter, function (v) { state.fileFilter = v; refresh(); }, '交付物筛选'),
      note(list.length + ' 个演示文件 · 仅预览内存文本，不读取真实磁盘或下载。'),
      list.map(function (f) {
        return botScope(el('article', [
          row([state.filePinned[f.id] ? H.icon('star',{fill:true}) : null,f.name], f.project + '／' + botName(f.bot) + ' · ' + f.size + '\n' + f.time + ' · ' + f.status + ' · ' + (state.fileSeen[f.id] ? '已预览' : '未读'), [
            button('预览', function () { state.fileSeen[f.id] = true; refresh(); inspect('file', f.id); }),
            button(state.filePinned[f.id] ? '取消收藏' : '收藏', function () { state.filePinned[f.id] = !state.filePinned[f.id]; refresh(); })
          ]), source(f.origin)
        ], 'list-card'), f.bot);
      })
    ]), demoText("automation.sample.107"));
  }
  function searchUI(container) {
    var q = input('搜索会话、任务、记忆、文件', state.query);
    var result = el('div', [], 'stack');
    function items() {
      var index = cards().map(function (card) {
        return { type: '任务', title: card.title, desc: statusLabels[status(card)] + ' · ' + projectName(card.project) + '／' + botName(card.bot) + ' · ' + card.sub,
          action: function () { H.openPanel('automation-detail', { id: card.id }); } };
      });
      (H.state.bots || []).forEach(function (bot) {
        var thread = (H.state.threads || {})[bot.id] || [];
        var snippets = thread.map(function (m) {
          return (m.parts || []).map(function (p) { return p.md || (p.data && (p.data.title || p.data.text)) || ''; }).join(' ');
        }).join(' ');
        index.push({ type: '会话', title: sessionSource(bot.id),
          desc: sessionSource(bot.id) + ' · ' + readableExcerpt(snippets).slice(0, 450), action: function () {
            H.navigate({ view: 'chat', bot: bot.id, conversation: bot.id + '-013' });
          } });
      });
      demoFixture("automation.sample.108").forEach(function (m) {
        index.push({ type: '记忆', title: m[0], desc: m[1] + ' · 11/12 资料快照；当前待核', action: function () { inspect('memory', m[0]); } });
      });
      files.forEach(function (f) {
        index.push({ type: '文件', title: f.name, desc: f.project + '／' + botName(f.bot) + ' · ' + f.text, action: function () {
          state.fileSeen[f.id] = true; refresh(); inspect('file', f.id);
        } });
      });
      return index;
    }
    function update() {
      state.query = q.value;
      var term = q.value.trim().toLowerCase();
      var found = items().filter(function (item) { return !term || (item.title + ' ' + item.desc + ' ' + item.type).toLowerCase().includes(term); });
      result.replaceChildren(note(term ? '命中 ' + found.length + ' 项 · 仅搜索当前壳公开数据与本模块演示索引。' : '最近内容 · 输入关键词后实时筛选；Cmd/Ctrl+K 随时打开。'));
      ['会话', '任务', '记忆', '文件'].forEach(function (type) {
        var list = found.filter(function (item) { return item.type === type; });
        result.append(box(type + ' · ' + list.length, list.length ? list.slice(0, term ? 30 : 3).map(function (item) {
          return row(item.title, item.desc.length > 110 ? item.desc.slice(0, 110) + '…' : item.desc, [button('打开', item.action)]);
        }) : note(demoText("automation.sample.109")), type === '记忆' ? '知识库与 agent 记忆分层' : null));
      });
    }
    q.addEventListener('input', update);
    container.append(el('div', [field('全局搜索', q), actions([
      button('搜 DSH', function () { q.value = 'DSH'; update(); H.toast('本页搜索 · 已显示 DSH 的会话、任务、记忆与文件结果。'); }),
      button(demoText("automation.sample.110"), function () { q.value = demoText("automation.sample.111"); update(); H.toast(demoText("automation.sample.112")); }),
      button('清空', function () { q.value = ''; update(); q.focus(); H.toast('本页搜索 · 关键词已清空，显示最近内容。'); }, false, 'tertiary')
    ]), result], 'panel'));
    update();
  }

  function inspector(container, params) {
    params = params || {};
    var body = [], title = '演示详情';
    if (params.kind === 'schedule') {
      var s = schedules.find(function (v) { return v.id === params.id; });
      if (s) {
        title = s.name;
        body = [source(s.origin), row('重复与下次运行', s.repeat + ' · ' + nextRun(s)),
          row('投递目标', sessionSource(s.bot)), row('处理边界', s.count + ' · 无真实运行'),
          actions([button(s.paused ? '恢复计划' : '暂停计划', function () {
            s.paused = !s.paused; refresh(); container.replaceChildren(); inspector(container, params);
          }), button('立即模拟一次', function () {
            simulateRun(s); container.replaceChildren(); inspector(container, params);
          })]), el('h3', '逐次运行结果'), historyList(runHistory.filter(function (r) { return r.schedule === s.id; }))];
      }
    } else if (params.kind === 'dispatch') {
      var r = state.dispatch.find(function (v) { return v.model === params.id; });
      if (r) {
        title = r.model + ' · 第 ' + state.dispatchRound + ' 轮回执';
        body = [source(demoText("automation.sample.113")), row('模型与用量', r.time + ' 秒 / ' + r.tokens + ' token · 虚构读数'),
          el('pre', '状态：' + (statusLabels[r.status] || r.status) + '\n证据：第 ' + state.dispatchRound + ' 轮演示回执\n未知项：未实际调用模型，移动端结果未核\n下一步：对照任务书人工检查\n进程结果：模拟\n任务结果：' + r.conclusion, 'pre'),
          el('h3', '本轮任务书'), el('pre', state.dispatchSnapshot, 'pre'),
          button(state.dispatchChecks[r.model] ? '撤销检查勾' : '勾选已检查', function () {
            state.dispatchChecks[r.model] = !state.dispatchChecks[r.model];
            if (!state.dispatchChecks[r.model] && state.selectedRoute === r.model) state.selectedRoute = '';
            refresh(); container.replaceChildren(); inspector(container, params);
          })];
      }
    } else if (params.kind === 'terminal') {
      var machine = machines.find(function (v) { return v.id === params.id; });
      if (machine) {
        title = machine.id + ' · 模拟终端';
        body = [source(demoText("automation.sample.114")), badge('未建立 SSH 连接', 'quiet'),
          row('演示目标', machine.id + ' · ' + machine.path), row('唯一写者', machine.writer),
          el('pre', '$ status --demo\n' + (state.terminal[machine.id] || '尚未读取模拟服务列表。'), 'pre'),
          button('读取模拟服务状态', function () {
            state.terminal[machine.id] = machine.services.join('\n') + '\n连接：未建立 · 上述输出为假数据';
            container.replaceChildren(); inspector(container, params);
            H.toast('本页演示 · 已读取' + machine.id + '的模拟服务列表，未连接设备。');
          }), note('不执行 shell，不读取 SSH 配置，不连接设备。')];
      }
    } else if (params.kind === 'template') {
      var t = templates.find(function (v) { return v.name === params.id; });
      if (t) {
        title = t.name + ' · 任务书草稿';
        body = [source(t.origin), badge(state.templateAdded[t.name] ? '本页草稿已生成' : '模板预览'),
          row('目标', t.steps.join(' → ')), row('正本 / 机器 / 唯一写者', botName(t.bot) + demoText("automation.sample.115") + botName(t.bot)),
          row('读写范围', '仅本地候选文本，外部渠道保持草稿'), row('验收与成果', t.output),
          row('禁止项', t.limits), button('保存为本页任务书草稿', function () {
            state.templateAdded[t.name] = true; refresh(); container.replaceChildren(); inspector(container, params);
            H.toast('本页演示 · 已保存「' + t.name + '」任务书草稿，刷新复原。');
          })];
      }
    } else if (params.kind === 'file') {
      var f = files.find(function (v) { return v.id === params.id; });
      if (f) {
        title = f.name;
        body = [source(f.origin), row('项目与助理', f.project + '／' + botName(f.bot)), row('版本与状态', '演示初稿 · ' + f.time + ' · ' + f.status),
          row('文件属性', f.size + ' · 演示文本，不对应真实磁盘文件'), el('pre', f.text, 'pre'),
          button(state.filePinned[f.id] ? '取消收藏' : '收藏交付物', function () {
            state.filePinned[f.id] = !state.filePinned[f.id]; refresh(); container.replaceChildren(); inspector(container, params);
          })];
      }
    } else if (params.kind === 'memory') {
      title = params.id;
      body = [source('prior/ 历史资料索引'), row('知识层', 'agent 记忆线索；需回知识库与项目正本核实。'),
        row('确认状态', demoText("automation.sample.116")), row('观察日期', '11/12 演示快照 · 未接入实时检索'),
        button('搜索来源文件示例', function () { H.openPanel('automation-search'); })];
    }
    container.append(botScope(el('div', [el('h2', title), body.length ? body : emptyTask('暂时没有可查看的对象，请回到任务列表选择一项任务。')], 'panel'),
      s ? s.bot : t ? t.bot : f ? f.bot : null));
  }
  // A reply is a snapshot. Undo only applies while it is the latest edit in its domain.
  var edits = {}, latestEdit = {}, editSequence = 0;
  function assignDemo(domain, object, key, value, message) {
    var before = object[key];
    if (before === value) return { confirmation: '当前已是这个设置 · 仅本页演示' };
    object[key] = value;
    var id = 'automation-edit-' + (++editSequence);
    edits[id] = { domain: domain, undo: function () { object[key] = before; }, undone: false };
    latestEdit[domain] = id;
    return { confirmation: message + ' · 仅本页演示', undoId: id };
  }
  function item(label, value, tone) { return { label: label, value: value, tone: tone }; }
  function allJobs() {
    var list = [];
    function visit(job) { list.push(job); job.children.forEach(visit); }
    jobs.forEach(visit); return list;
  }
  function capabilityBy(id) {
    return capabilities.find(function (spec) { return spec.key === id; });
  }
  var capabilities = [
    {
      key: 'schedules', title: '定时任务', icon: 'clock', featureId: 'schedule', steward: featureAssistantId('schedule'), group: '日常安排',
      oneLine: '看看何时提醒，也能一句话暂停或恢复晨会。',
      phrases: ['看看定时安排', '暂停晨会简报', '恢复晨会简报'],
      status: function () { return [item('演示计划', schedules.length), item('暂停', schedules.filter(function (s) { return s.paused; }).length), item('时区', 'JST')]; },
      act: function (p) {
        return p === 0 ? {} : assignDemo('morning', schedules[0], 'paused', p === 1, p === 1 ? '已暂停晨会计划' : '已恢复晨会计划');
      },
      lines: function () { return ['演示时钟：' + demoClockLabel() + '；未注册系统定时任务。'].concat(schedules.map(function (s) { return s.name + ' · ' + nextRun(s) + ' → ' + botName(s.bot); })); }
    },
    {
      key: 'routes', title: '路由规则', icon: 'branch', featureId: 'connections', steward: featureAssistantId('connections'), group: '分配工作',
      oneLine: '按关键词分给合适的助理，随时改回首席复核。',
      phrases: ['看看路由规则', '关闭脚本先判', '恢复脚本先判'],
      status: function () { return [item('演示规则', rules.filter(function (r) { return r.enabled; }).length), item('脚本先判', state.script ? '开启' : '关闭'), item('兜底', demoText("automation.status.117"))]; },
      act: function (p) { return p === 0 ? {} : assignDemo('routes', state, 'script', p === 2, p === 1 ? demoText("automation.act.118") : '已恢复关键词先判'); },
      lines: function () { return rules.map(function (r) { return r.terms + ' → ' + botName(r.bot) + ' · ' + (r.enabled ? '启用' : '停用'); }).concat('多条命中按上述顺序采用第一条；仅模拟路由，不转发消息。'); }
    },
    {
      key: 'tickets', title: '任务单', icon: 'task', steward: 'pm', group: '任务与验收',
      oneLine: '查看任务书和待验收项，暂停或恢复演示轮询。',
      phrases: ['列出待验收任务单', '暂停任务单轮询', '恢复任务单轮询'],
      status: function () { return [item('看板任务', cards().length), item('阻塞', cards().filter(function (c) { return status(c) === 'blocked'; }).length), item('演示轮询', state.runner ? '开启' : '暂停')]; },
      act: function (p) { return p === 0 ? {} : assignDemo('tickets', state, 'runner', p === 2, p === 1 ? '已暂停任务单轮询演示' : '已恢复任务单轮询演示'); },
      lines: function () { return ['状态读取正式看板列；拖动后仍须到看板点提交。', '验收记录保留在任务详情，不自动判定任务完成。']; },
      tickets: function () { return cards().filter(function (c) { return status(c) !== 'done'; }).map(function (c) { return c.id; }); }
    },
    {
      key: 'dispatch', title: '派工台', icon: 'jobs', steward: 'pm', group: '分配工作',
      oneLine: '比较工人回执，一句话改下一轮的派工候选。',
      phrases: demoFixture("automation.phrases.119"),
      status: function () { return [item('演示回执', state.dispatch.length), item('下一轮候选', state.dispatchModels.length), item('真实调用', '未执行', 'neutral')]; },
      act: function (p) {
        return p === 0 ? {} : assignDemo('dispatch', state, 'dispatchModels', p === 1 ? demoFixture("automation.act.120") : demoFixture("automation.act.121"), '已更新下一轮派工候选');
      },
      lines: function () { return ['下一轮：' + state.dispatchModels.join(' / '), '现有第 ' + state.dispatchRound + ' 轮回执均为虚构，不会因候选变化被重写。'].concat(state.dispatch.map(function (r) { return r.model + ' · ' + r.time + ' 秒 · ' + r.tokens + ' token · ' + r.conclusion; })); },
      receipts: true
    },
    {
      key: 'agents', title: '子代理', icon: 'jobs', steward: 'pm', group: '分配工作',
      oneLine: '查看父子任务状态，暂停或继续一项子代理演示。',
      phrases: ['看看子代理进度', '暂停交互核验子代理', '继续交互核验子代理'],
      status: function () { var list = allJobs(); return [item('演示节点', list.length), item('运行中', list.filter(function (j) { return j.status === '运行中'; }).length), item('暂停', list.filter(function (j) { return j.status === '暂停'; }).length)]; },
      act: function (p) { return p === 0 ? {} : assignDemo('agents', jobs[0].children[0], 'status', p === 1 ? '暂停' : '运行中', p === 1 ? '已暂停交互核验子代理演示' : '已继续交互核验子代理演示'); },
      lines: function () { return allJobs().map(function (j) { return j.name + ' · ' + j.model + ' · ' + j.status + ' · ' + j.progress + '%'; }); }
    },
    {
      key: 'notifications', title: '通知规则', icon: 'chat', featureId: 'connections', steward: featureAssistantId('connections'), group: '日常安排',
      oneLine: '保留阻塞与待拍板提醒，用一句话开关夜间勿扰。',
      phrases: ['看看通知规则', '晚上十点后勿扰', '关闭夜间勿扰'],
      status: function () { return [item('演示未读', notifications.filter(function (n) { return !n.seen; }).length), item('勿扰', state.dnd ? state.dndStart + '–' + state.dndEnd : '关闭'), item('完成汇总', state.notifyRules.done ? '开启' : '关闭')]; },
      act: function (p) { return p === 0 ? {} : assignDemo('notifications', state, 'dnd', p === 1, p === 1 ? demoText("automation.act.122") : '已关闭夜间勿扰'); },
      lines: function () { return [dndHint(), '阻塞提醒：' + (state.notifyRules.blocked !== false ? '开启' : '关闭') + '；待拍板提醒：' + (state.notifyRules.decision !== false ? '开启' : '关闭'), '未连接系统推送；以下仅为本页待阅记录。'].concat(notifications.map(function (n) { return (n.seen ? '已读 · ' : '未读 · ') + n.title; })); }
    },
    {
      key: 'workflows', title: '工作流模板', icon: 'file', steward: 'pm', group: '任务与验收',
      oneLine: '把已有流程变成任务书草稿，交付和发布分开确认。',
      phrases: ['看看工作流模板', '用客服模板起一份草稿', '用视频模板起一份草稿'],
      status: function () { return [item('演示模板', templates.length), item('本页草稿', Object.keys(state.templateAdded).filter(function (k) { return state.templateAdded[k]; }).length)]; },
      act: function (p) { return p === 0 ? {} : assignDemo('template-' + p, state.templateAdded, p === 1 ? '客服回复' : '视频出片', true, '已生成任务书草稿'); },
      lines: function () { return templates.map(function (t) { return t.name + ' · ' + t.steps.join(' → ') + '；' + t.limits; }); },
      templates: true
    },
    {
      key: 'machines', title: '多机管理', icon: 'jobs', featureId: 'devices', steward: featureAssistantId('devices'), group: '设备与模型',
      oneLine: '认清每台机器的职责和唯一写者，真实连接状态待核。',
      phrases: ['看看多机分工', '将' + machines[featureDemo.targetMachine].id + '标为本轮目标', '清除本轮机器目标'],
      status: function () { return [item('演示设备', machines.length), item('真实连接', '未建立', 'neutral'), item('本轮目标', state.machineTarget || '未选择')]; },
      act: function (p) { return p === 0 ? {} : assignDemo('machines', state, 'machineTarget', p === 1 ? machines[featureDemo.targetMachine].id : '', p === 1 ? '已标记本轮目标：' + machines[featureDemo.targetMachine].id : '已清除本轮目标'); },
      lines: function () { return machines.map(function (m) { return m.id + ' · ' + m.owner + ' · 唯一写者：' + m.writer + '；真实在线状态待核。'; }).concat(
        '跨机白名单（演示候选）：' + [machines[1].id + '／读取演示任务清单', machines[0].id + '／读取演示回执', machines[2].id + '／查看演示模型队列'].join('；') + '；白名单外不执行，默认未执行，未建立 SSH 连接。'); }
    },
    {
      key: 'webhooks', title: 'Webhook', icon: 'link', featureId: 'connections', steward: featureAssistantId('connections'), group: '设备与模型',
      oneLine: '只接白名单来源，先拟接入草稿，也能一句话全部暂停。',
      phrases: ['看看有哪些 Webhook', '拟一条新的接入', '先全部暂停'],
      status: function () { return [item('来源白名单', '2 条演示'), item('最后触发', '未触发', 'neutral'),
        item('暂停', webhookDemo.paused ? '已全部暂停' : '未暂停（演示）', webhookDemo.paused ? 'wait' : 'neutral')]; },
      act: function (p) {
        if (p === 1) return assignDemo('webhook-draft', webhookDemo, 'draft', true, '已拟接入草稿，尚未加入白名单');
        if (p === 2) return assignDemo('webhook-pause', webhookDemo, 'paused', true, '本页 Webhook 候选已全部暂停');
        return {};
      },
      lines: function () { return ['来源白名单（仅演示候选）：'].concat(webhookSources,
        webhookDemo.draft ? '新接入草稿：本页验收完成事件 → 待阅摘要；来源、允许动作待核，未启用、未加入白名单。' : '没有新增接入草稿。',
        '不提供接入地址或凭据；白名单外一律不处理，默认未执行，没有监听器、触发记录或真实服务。'); }
    },
    {
      key: 'models', title: '本地模型', icon: 'tools', featureId: 'devices', steward: featureAssistantId('devices'), group: '设备与模型',
      oneLine: '查看本地模型队列，修改本页候选而不切换真实服务。',
      phrases: demoFixture("automation.phrases.123"),
      status: function () { return [item('演示候选', state.model), item('演示排队', state.queue.filter(function (q) { return q.status === '排队'; }).length), item('真实服务', '未连接', 'neutral')]; },
      act: function (p) { return p === 0 ? {} : assignDemo('models', state, 'model', p === 1 ? demoText("automation.act.124") : demoText("automation.act.125"), '已更新本轮模型候选'); },
      lines: function () { return ['候选切换仅影响本页选择，不改变既有队列或真实服务。'].concat(state.queue.map(function (q) { return q.title + ' · ' + q.model + ' · ' + q.status + ' · ' + q.tokens + ' token（演示）'; })); }
    },
    {
      key: 'collaboration', title: '云端与本地协作', icon: 'link', steward: 'pm', group: '分配工作',
      oneLine: '云端拆解、本地执行、交回证据，低风险双工可随时暂停。',
      phrases: ['看看协作交接边界', '暂停低风险双工演示', '恢复低风险双工演示'],
      status: function () { return [item('演示阶段', state.flowStep + '/5'), item('双工演示', state.duplexEnabled ? '开启' : '暂停'), item('待阅', duplex.filter(function (d) { return !d.seen; }).length)]; },
      act: function (p) { return p === 0 ? {} : assignDemo('collaboration', state, 'duplexEnabled', p === 2, p === 1 ? '已暂停低风险双工演示' : '已恢复低风险双工演示'); },
      lines: function () { return ['拆解目标 → 受限本地执行 → 结构化回执 → 云端复核 → 人工验收。', '回执列明状态、证据、未知项与下一步；进程成功与任务正确分开。', '本页不会调用工人、模型或设备。'].concat(duplex.map(function (d) { return d.title + ' · ' + d.result; })); }
    },
    {
      key: 'storyboard', id: 'content-video-storyboard', title: '视频分镜', icon: 'image', steward: 'content', group: '内容',
      oneLine: '把视频收成可引用分镜，先报 token 估算再出图。',
      phrases: ['先报价，先别出图', '看下一段五分钟', '放大刚才那一格'],
      status: function () { var d = storyboardLatest || storyboardDemo(); return [item('分镜', storyboardStates[d.state]),
        item('预计 token', '约 ' + d.tokenEstimate + '（演示估算）'), item('台词', transcriptLabels[d.transcript.source] || '来源未知', 'neutral')]; },
      reply: function (phrase) {
        var p = this.phrases.indexOf(phrase), previous = storyboardLatest, data;
        if (p === 0) data = storyboardDemo();
        else if (p === 1) {
          var index = previous && !previous.overview ? previous.window.index : 1;
          data = storyboardDemo(Math.min(3, index + 1));
          if (index === 3) data.notice = '已经是最后一段；保留当前窗口，不虚构下一段。';
        } else if (previous && !previous.overview && storyboardCell(previous)) {
          data = JSON.parse(JSON.stringify(previous));
          data.state = 'quoting'; data.mode = 'zoom';
          data.notice = '沿用刚才选中的第 ' + data.selectedCellId + ' 格；放大前再次核对报价。';
        } else {
          data = storyboardDemo(); data.state = 'ready'; data.mode = 'text';
          data.notice = '还没有选格：先在文字清单选一格，再点「放大此格」，不会替你选中。';
        }
        storyboardLatest = data;
        return [{ type: 'text', md: '本页演示，未真实执行。只展示分镜与审批流程；没有读视频、转写、出图或记账。' },
          { type: 'content-storyboard', data: data }];
      }
    },
    {
      key: 'briefs', title: '例行简报', icon: 'chat', featureId: 'schedule', steward: featureAssistantId('schedule'), group: '日常安排',
      oneLine: '把进行中、待看和待办放进会话，随时搜索交付物。',
      phrases: ['整理今天的焦点', '给我晚会简报', '看看空闲时的待办'],
      status: function () { return [item('待拍板示例', 3), item('交付物示例', files.length), item('来源快照', '11/12', 'neutral')]; },
      reply: function (phrase) { var index = this.phrases.indexOf(phrase); return [{ type: 'automation-brief', data: { title: phrase, mode: ['晨会', '晚会', '空闲'][index] } }]; }
    }
  ];
  function capabilityReply(spec, phrase) {
    var change = spec.act(spec.phrases.indexOf(phrase));
    if (change.undoId && spec.featureId) H.featureRecord(spec.featureId, { time: demoClockLabel() + ' · 本页操作', title: spec.title, text: change.confirmation + '；无真实执行。' });
    var parts = [{ type: 'automation-capability-reply', data: {
      title: spec.title, steward: spec.featureId ? featureAssistantId(spec.featureId) : spec.steward, summary: phrase,
      items: spec.status(), lines: spec.lines(), confirmation: change.confirmation,
      undoId: change.undoId, featureId: spec.featureId, tickets: spec.tickets ? spec.tickets() : [],
      receipts: !!spec.receipts, templates: !!spec.templates
    } }];
    if (phrase === spec.phrases[0] && spec.key === 'dispatch') parts.push({ type: demoText("automation.type.126"), data: dispatchTimeline });
    if (phrase === spec.phrases[0] && spec.key === 'workflows') parts.push({ type: 'automation-bot-template-wall', data: {} });
    if (spec.key === 'collaboration') parts.push({ type: 'cards-b-teacher-student', data: teacherStudentDemo() });
    return parts;
  }
  function renderCapabilityReply(data) {
    var card = el('article', [], 'brief');
    function paint() {
      var edit = edits[data.undoId];
      var canUndo = edit && !edit.undone && latestEdit[edit.domain] === data.undoId;
      replaceContent(card, [el('strong', data.title), badge('本页演示，未真实执行 · 刷新复原'), note(data.summary),
        H.levelSticker(edit ? 'L1' : 'L0', { action: edit ? '修改本页演示候选' : '查看演示回执', scope: data.title, bot: data.steward }),
        actions((data.items || []).slice(0, 3).map(function (x) { return badge(x.label + ' · ' + x.value, x.tone === 'bad' ? 'warn' : ''); })),
        el('div', (data.lines || []).map(note)),
        data.confirmation ? note(data.confirmation + (edit && edit.undone ? ' · 已撤销' : '')) : null,
        edit ? actions([button(edit.undone ? '已撤销' : '撤销这次修改', function () {
          if (!canUndo) { H.toast(edit.undone ? '这次修改已撤销。' : '之后有新的修改，请在最新回执里撤销。'); return; }
          edit.undo(); edit.undone = true; latestEdit[edit.domain] = null;
          if (data.featureId) H.featureRecord(data.featureId, { time: demoClockLabel() + ' · 本页操作', title: data.title, text: '已撤销：' + data.summary + '；仅本页演示。' });
          refresh(); paint();
        })]) : null,
        actions((data.tickets || []).map(function (id) { var task = cardBy(id); return button(task ? task.title + ' · 任务书／验收' : '任务待选择', function () { H.openPanel('automation-detail', { id: id }); }); })),
        data.receipts ? actions(state.dispatch.map(function (r) { return button('查看 ' + r.model + ' 回执', function () { inspect('dispatch', r.model); }); })) : null,
        data.templates ? actions(templates.map(function (t) { return button(t.name + ' · 草稿详情', function () { inspect('template', t.name); }); })) : null,
        note('只修改本页假数据；没有真实派工、联网或持久化。')]);
    }
    paint(); return botScope(card, data.steward);
  }
  function render(container) {
    
    container.append(el('div', [H.pageTitle('交给助理安排', '对话优先'),
      note('定时、设备和连接状态已收进功能页；调整仍通过负责助理的对话。'),
      actions([button('打开能力目录', function () { H.navigate({ view: 'capabilities' }); }),
        button('全局搜索 ⌘ / Ctrl K', function () { H.openPanel('automation-search'); })])
    ], 'root'));
  }

  H.addStyle((demoText("automation.sample.127")));

  H.registerCard('content-storyboard', {
    title: '视频分镜', render: renderStoryboard, quoteLabel: storyboardQuote
  });
  H.registerCard(demoText("automation.sample.128"), {
    title: '派工时间线', render: renderDispatchTimeline,
    quoteLabel: function () { return '派工时间线：两轮临时工人回执与同轮对比（演示，未真实执行）'; }
  });
  H.registerCard('automation-bot-template-wall', {
    title: '我们自己的模板墙', render: renderBotTemplateWall,
    quoteLabel: function () { return demoText("automation.quoteLabel.129"); }
  });
  botTemplates.forEach(function (template) {
    var accentBot = H.state.bots.find(function (bot) { return bot.id === template.accent; });
    H.registerBotTemplate({ id: template.id, name: template.name, duty: template.duty,
      color: accentBot.color, icon: template.icon, brain: template.brain,
      workers: template.workers.slice(), tools: template.tools.slice() });
  });
  H.registerConversation('pm', {
    id: 'automation-dispatch-demo', title: '派工时间线与自有 bot 模板 · 演示', messages: [
      { from: 'user', time: '演示', parts: [{ type: 'text', md: '看看这件任务两轮派工的回执，再给我看看我们自己的 bot 模板。' }] },
      { from: 'pm', time: '演示', parts: [{ type: 'text', md: '演示，未真实执行。展开每一路看回执，按轮次对比；这些临时工人不会进入首页。' }, { type: demoText("automation.type.130"), data: dispatchTimeline }] },
      { from: 'pm', time: '演示', parts: [{ type: 'text', md: '这是我们自己的模板墙。六个模板都有职责、主色、大脑、工人和工具；创建入口在首页「+ → 从模板创建」。演示，未真实执行。' }, { type: 'automation-bot-template-wall', data: {} }] }
    ]
  });
  H.registerConversation('pm', {
    id: 'automation-teacher-student-demo', title: '老师—学生 · 一次派工', messages: [
      { from: 'user', time: '演示', parts: [{ type: 'text', md: '这次云端规划、本地执行各做了什么？失败怎么交回老师？' }] },
      { from: 'pm', time: '演示', parts: [
        { type: 'text', md: '本页演示，未真实执行。云端 1,800\u00a0token／32\u00a0秒，本地 800\u00a0token／15\u00a0秒；合计 2,600\u00a0token／47\u00a0秒。全云端对照估算 6,000\u00a0token／90\u00a0秒，少 3,400\u00a0token／43\u00a0秒。没有计价或实际节省凭证；失败交回记录见卡内。' },
        { type: 'cards-b-teacher-student', data: teacherStudentDemo() }
      ] }
    ]
  });
  var failedStoryboard = storyboardDemo();
  failedStoryboard.state = 'failed'; failedStoryboard.errorLabel = '没有片内字幕，本机转写也没开（演示失败，未读取文件）。';
  var lockedStoryboard = storyboardDemo(); lockedStoryboard.state = 'spoiler-locked';
  H.registerConversation('content', {
    id: 'automation-storyboard-demo', title: '视频分镜 · 先报价再放大', messages: [
      { from: 'user', time: '演示', parts: [{ type: 'text', md: '先看五分钟报价，再选一格放大；也看看失败和总览上锁时会怎样。' }] },
      { from: 'content', time: '演示', parts: [{ type: 'text', md: '本页演示，未真实执行。第一张走报价与选格；后两张分别演示失败与总览锁，不是同一轮的真实结果。' },
        { type: 'content-storyboard', data: storyboardDemo() }, { type: 'content-storyboard', data: failedStoryboard },
        { type: 'content-storyboard', data: lockedStoryboard }] }
    ]
  });
  H.registerTaskSection(demoText("automation.sample.131"), {
    title: '派工时间线', when: function (task) { return task.id === dispatchTimeline.taskId; },
    render: function (c) { c.append(renderDispatchTimeline(dispatchTimeline)); }
  });
  H.registerView('automation', { title: '自动化', icon: 'jobs', hidden: true, render: render });
  H.registerCard('automation-capability-reply', {
    title: '自动化能力回执', render: renderCapabilityReply,
    quoteLabel: function (d) { return d.title + '：' + (d.confirmation || d.summary) + '（本页演示）'; }
  });
  capabilities.forEach(function (spec) {
    if (spec.featureId && !featureAssistant(spec.featureId)) return;
    H.registerCapability({ id: spec.id || 'automation-' + spec.key, title: spec.title, icon: spec.icon,
      steward: spec.featureId ? featureAssistantId(spec.featureId) : spec.steward, featureId: spec.featureId, group: spec.group, oneLine: spec.oneLine,
      status: spec.status, phrases: spec.phrases,
      reply: function (phrase) { return spec.reply ? spec.reply(phrase) : capabilityReply(spec, phrase); }
    });
  });

  // 功能页只读同一份计划、回执和设备数据，不再另建在线状态副本。
  H.registerFeatureSection('schedule', { id: 'automation-schedule-now', kind: 'now', title: '今天与接下来', render: function (container) {
    var todayKey = dateKey(japanDay(demoNow));
    container.append(note('演示时钟：' + demoClockLabel() + '；“今天”指此演示日期，未注册系统任务。'));
    var todayItems = schedules.filter(function (s) { return occurs(s, japanDay(demoNow)); }).slice().sort(function (a, b) { return a.time.localeCompare(b.time); });
    var todayList = h('div', { 'data-schedule-today': todayKey });
    todayList.append(el('h4', '今天 · ' + todayKey));
    todayItems.forEach(function (s) {
      var passed = new Date(todayKey + 'T' + s.time + demoText("automation.passed.132")) <= demoNow;
      todayList.append(h('article', { 'data-schedule-today-item': s.id }, [
        row(s.time + ' · ' + s.name, s.paused ? '已暂停，不运行' : passed ? '时间已过，实际执行未核验' : '待到时 · 本页计划'),
        note('投递：' + botName(s.bot) + ' · ' + s.repeat)
      ]));
    });
    if (!todayItems.length) todayList.append(note('今天没有计划。'));
    var upcoming = schedules.map(function (s) { return { schedule: s, next: nextOccurrence(s, new Date(todayKey + demoText("automation.next.133"))) }; })
      .filter(function (x) { return x.next; }).sort(function (a, b) { return a.next.stamp - b.next.stamp; });
    var nextList = h('div', { 'data-schedule-upcoming': true }, el('h4', '接下来 · 今天之后'));
    upcoming.forEach(function (x) { nextList.append(row(x.next.at + ' · ' + x.schedule.name, '本页计划 · ' + botName(x.schedule.bot))); });
    if (!upcoming.length) nextList.append(note('暂无后续运行；计划已暂停或已结束。'));
    container.append(todayList, nextList, el('h4', '定时任务列表 · ' + schedules.length + ' 项'));
    schedules.forEach(function (s) { container.append(h('article', { 'data-schedule-task': s.id, 'data-schedule-status': s.paused ? 'paused' : 'active' }, [
      row(s.name, s.repeat + ' · ' + s.time + ' · ' + (s.paused ? '已暂停' : '启用中（演示）')),
      note('下次：' + nextRun(s)), source(s.origin), note(s.count)
    ])); });
    if (!schedules.length) container.append(note('暂无定时任务。'));
    else if (schedules.every(function (s) { return s.paused; })) container.append(note('全部计划已暂停，没有待运行项。'));
  }});
  H.registerFeatureSection('schedule', { id: 'automation-schedule-log', kind: 'log', title: '运行记录', render: function (container) {
    container.append(historyList(runHistory));
  }});
  H.registerFeatureSection('devices', { id: 'automation-devices-now', kind: 'now', title: '设备与常驻服务', render: function (container) {
    container.append(note('离线样本 · 最后样本检查：' + featureDemo.checkedAt + '；真实设备与服务最后检查时间未知。'));
    container.append(note('样本在线 ' + machines.filter(function (m) { return m.online; }).length + ' / ' + machines.length + ' 台；不探测设备。'));
    machines.forEach(function (m) { container.append(h('article', { 'data-device-sample': m.id }, [
      el('h4', m.id), badge(m.online ? '在线（演示）' : '离线（演示）'),
      note('最后样本检查：' + featureDemo.checkedAt + '；真实检查：未知'),
      note('职责：' + m.owner + ' · 唯一写者：' + m.writer),
      note('CPU：' + (m.cpu === null ? '未知' : m.cpu + '%') + ' · 内存：' + (m.memory === null ? '未知' : m.memory + '%') + ' · GPU：' + (m.gpu === null ? '未知' : m.gpu + '%')),
      el('ul', m.services.map(function (service) { return h('li', { 'data-device-service': true }, service + ' · 样本检查 ' + featureDemo.checkedAt + '；真实状态待核'); }))
    ])); });
  }});
  H.registerFeatureSection('devices', { id: 'automation-devices-log', kind: 'log', title: '状态变化记录', render: function (container) {
    featureDemo.deviceChanges.forEach(function (event) { container.append(h('article', { 'data-device-change': true }, [
      row(event.time + ' · ' + machines[event.machine].id, event.before + ' → ' + event.after), note(event.evidence)
    ])); });
  }});

  H.registerPanel('automation-detail', {
    title: '任务单与回执', icon: 'task', group: '自动化',
    render: function (c, ctx) { detailTask(c, (ctx.params || {}).id); }
  });
  H.registerPanel('automation-search', {
    title: '全局搜索', icon: 'search', group: '自动化', render: searchUI
  });
  H.registerPanel('automation-inspector', {
    title: '自动化详情', icon: 'file', group: '自动化',
    render: function (c, ctx) { inspector(c, ctx.params); }
  });
  H.registerPanel('automation-schedule', {
    title: '定时安排', icon: 'clock', group: '自动化', render: function (c) {
      var spec = capabilityBy('schedules');
      c.append(renderCapabilityReply({ title: spec.title, steward: spec.steward,
        summary: '计划仅为本页演示；通过负责助理对话调整。', items: spec.status(), lines: spec.lines() }),
      actions(spec.phrases.filter(function (_, i) { return i === 0 || i === (schedules[0].paused ? 2 : 1); }).map(function (phrase) {
        return button(phrase, function () { H.runCapability('automation-schedules', phrase); });
      })));
    }
  });
  H.registerSettingsPage('automation-settings', {
    title: '自动化偏好', icon: 'settings', group: '偏好', order: 30,
    render: function (c) {
      c.append(el('div', [
        note('通过对话查看或调整自动化；操作仅保留在本页，刷新复原。'),
        actions(['routes', 'collaboration', 'notifications'].map(function (id) {
          var spec = capabilityBy(id);
          return button('问' + botName(spec.steward) + ' · ' + spec.title, function () {
            H.runCapability('automation-' + id, spec.phrases[0]);
          });
        })),
        button('全局搜索', function () { H.openPanel('automation-search'); })
      ], 'panel'));
    }
  });
  H.registerTaskSection('automation-ticket', {
    title: '任务单与回执',
    render: function (c, task) {
      var card = cards().find(function (x) { return x.task === task.id || x.id === task.card; });
      c.append(source(demoText("automation.render.134")));
      if (!card) { c.append(note('未关联看板卡片；状态待核。')); return; }
      c.append(row('状态', statusLabels[status(card)] + ' · 与看板同源'), row('任务单轮询', state.runner ? '演示轮询中，无真实执行' : '暂停演示'),
        row('回执', state.ticketNotes[card.id] || '待人工查看与验收'),
        button('打开任务书与验收清单', function () { H.openPanel('automation-detail', { id: card.id }); }));
    }
  });
  H.registerBoardCardBadge(function (card) {
    return card.task ? badge('任务单 · ' + status(card), status(card) === 'blocked' || status(card) === 'failed' ? 'warn' : '') : null;
  });
  H.registerCard('automation-brief', {
    title: '例行简报', render: brief,
    quoteLabel: function (data) { return (data.title || '今日简报') + '：' + (data.text || '进行中 / 待看 / 待办'); }
  });
  // 壳在冒泡阶段也使用 Cmd+K；捕获并停止传播，避免同一次按键打开两个面板。
  document.addEventListener('keydown', function (e) {
    if (!e.isComposing && !e.altKey && (e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      e.stopImmediatePropagation();
      H.openPanel('automation-search');
      var search = document.querySelector('[data-hub-panel] .m-automation-input');
      if (search) search.focus();
    }
  }, true);
})();
