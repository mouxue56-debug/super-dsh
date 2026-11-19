function r29Assigner(card) {
  var keys = ['assignedBy', 'fromBot', 'from', 'movedByBot'];
  var i, id;
  for (i = 0; i < keys.length; i++) {
    id = card && card[keys[i]];
    if (typeof id === 'string' && id && typeof botBy === 'function' && botBy(id)) return id;
  }
  return '';
}
function r29AssignHTML(card) {
  var worker = card && card.bot;
  var workerBot = worker && typeof botBy === 'function' ? botBy(worker) : null;
  var from = r29Assigner(card);
  var fromBot = from ? botBy(from) : null;
  var workerName = workerBot && workerBot.name ? workerBot.name : '未注明';
  var doing = (workerBot ? r29Face(worker, 28) : '') + '<span>' + esc(workerName) + '</span>';
  if (fromBot && from !== worker) {
    return '<div class="r29-assign">' + r29Face(from, 28) + '<span>' + esc(fromBot.name) +
      '</span><span aria-hidden="true">→</span>' + doing + '</div>';
  }
  return '<div class="r29-assign">' + doing + '</div>';
}
function boardView(){
  var rows = r29DeskCurrent();
  var legacy = r29DeskReal() ? '' : '<div class="r30-legacy" hidden>' + r29BoardLegacy() + '</div>';
  return r30PhoneBoard(rows) + r29DeskRoot(rows) + legacy;
}
function r29BoardLegacy(){let cards=state.cards.filter(c=>state.boardScope==='all'||c.bot===(state.boardAssistant||state.bot));return  '<section class="boardview r22-boardview"><div class="boardbar r22-board-heading"><div class="grow"><h1>事情的进度</h1><p>'+cards.length+' 张卡 · 拖完，再点提交</p></div></div>' +boardPendingHTML()+(state.boardView==='particles'?particleHTML(cards):'<div class="board" data-scroll="board">'+COLS.map(col=>'<section class="kcol" data-col="'+col.id+'"><header><i class="col-dot"></i><h2>'+col.name+'</h2><em>'+cards.filter(c=>boardCol(c)===col.id).length+'</em></header><div class="kcol-body" data-scroll="board-col-'+col.id+'">'+cards.filter(c=>boardCol(c)===col.id).sort((a,b)=>boardOrder(a)-boardOrder(b)).map(c=>'<article class="kcard '+(c.project===state.project?'mine ':'')+(state.boardPending[c.id]?'pending':'')+'" style="'+botStyle(c.bot)+'" data-id="'+c.id+'" tabindex="0" role="button" aria-label="'+esc(c.title)+'，'+col.name+'，点击查看并改列">'+(state.boardPending[c.id]?'<span class="badge wait">未提交</span>':'')+(c.movedBy?'<span class="badge">'+esc(botBy(c.movedByBot)?.name||c.movedBy)+' 移动</span>':'')+'<div class="kcard-top"><span class="grip" aria-label="拖动握把">⠿</span><h3 title="'+esc(c.title)+'">'+esc(c.title)+'</h3></div><p class="sub">'+esc(c.sub)+'</p><div class="kmeta">'+Hub.boardBadgesSlot(c)+r29AssignHTML(c)+'<span class="tag">'+projBy(c.project).name+'</span><span class="flag">'+(c.decision&&decBy(c.decision)?.status==='superseded'?'已替代':c.decision&&isClosed(decBy(c.decision))?'已处理':c.flag)+'</span><time>'+esc(botBy(c.bot).name)+' · '+c.time+'</time></div></article>').join('')+'</div></section>').join('')+'</div>')+'<details class="r25-board-info"><summary>现状 · 记录 · 常用话</summary><div data-board-feature-sections></div></details>'+r22BoardDock()+'</section>'}
const nodePositions={};
function particleHTML(cards){cards.forEach((c,i)=>{if(!nodePositions[c.id])nodePositions[c.id]={x:90+(i%5)*140,y:90+Math.floor(i/5)*160}});return '<div class="particle-wrap" data-scroll="particles"><svg class="particle-map" viewBox="0 0 740 540" aria-label="可拖动的任务关系图">'+cards.slice(1).map((c,i)=>demoText("views.board.sample.1")+cards[i].id+'" data-to="'+c.id+'" x1="'+nodePositions[cards[i].id].x+'" y1="'+nodePositions[cards[i].id].y+'" x2="'+nodePositions[c.id].x+'" y2="'+nodePositions[c.id].y+'"/>').join('')+cards.map(c=>'<g class="node" style="'+botStyle(c.bot)+'" data-id="'+c.id+'" transform="translate('+nodePositions[c.id].x+' '+nodePositions[c.id].y+')"><circle r="29"/><foreignObject x="-14" y="-22" width="28" height="28">'+r29Face(c.bot,28)+'</foreignObject><text text-anchor="middle" y="5">'+esc(botBy(c.bot).name.slice(0,2))+'</text><text text-anchor="middle" y="51">'+esc(c.title.slice(0,11))+'</text><text text-anchor="middle" y="70" style="font-size:11px;fill:var(--ink-2)">'+colBy(boardCol(c)).name+'</text></g>').join('')+'</svg><p class="particle-legend">拖动节点整理关系 · 点击节点查看任务 · 连线为示意依赖</p></div>'}
Hub.registerView('kanban', {title:'看板', icon:'board', render:function(container){container.innerHTML=boardView();var sections=container.querySelector('[data-board-feature-sections]');if(sections)Hub.renderFeatureSections(sections,'board');}});


function boardPendingHTML(){var n=Object.keys(state.boardPending).length;return n?'<div class="board-pending r22-board-pending" role="status"><strong>你移动了 '+n+' 张，还没提交</strong><button class="textbutton" data-board-action="undo">撤销</button></div>':'';}
function r22BoardDock(){var n=Object.keys(state.boardPending).length,owner=Hub.featureOwner('board');return '<nav class="r22-board-dock" aria-label="看板工具栏"><details class="r22-board-popup"><summary>范围 ▾</summary><div class="r22-board-popover" aria-label="看板范围"><button data-act="scope" data-scope="all" aria-pressed="'+(state.boardScope==='all')+'">全部</button><strong>按助理</strong>'+state.bots.map(b=>'<button data-act="scope" data-scope="assistant" data-assistant="'+esc(b.id)+'" aria-pressed="'+(state.boardScope==='assistant'&&state.boardAssistant===b.id)+'">'+r29Face(b.id,28)+esc(b.name)+'</button>').join('')+'</div></details><details class="r22-board-popup"><summary>视图</summary><div class="r22-board-popover" aria-label="看板视图与操作"><button data-act="board-view">'+(state.boardView==='columns'?'关系粒子':'五列看板')+'</button><button data-act="trajectory">'+ico('branch')+' 分支 · 执行轨迹与待决定</button><button data-board-action="simulate">模拟：别的 AI 移动了卡片</button><button data-board-action="undo" '+(n?'':'disabled')+'>撤销未提交移动</button><button data-act="more">全部功能</button></div></details><button data-board-action="ask" '+(owner?'':'disabled')+'>'+(owner?r29Face(owner.id,28):'')+'问'+esc(owner?.name||'负责助理')+'</button><button class="primary r22-board-submit" data-board-action="submit" '+(n&&owner?'':'disabled')+'>提交 '+n+'</button></nav>';}

var r29DeskFilter = '';
var r29DeskOpen = true;
var r29DeskPick = '';
var r29DeskRows = null;
var r29DeskToken = 0;
var r29DeskBound = null;
var r29DeskFlight = false;
var r29DeskLastPull = null;
var r29DeskFailed = false;
var r29DeskOmitted = 0;
var R29_DESK_COLS = [
  {id: 'queued', name: '待领'},
  {id: 'progress', name: '在做'},
  {id: 'review', name: '等验收'},
  {id: 'attention', name: '等你'},
  {id: 'done', name: '完成'}
];

function r29DeskReal() {
  try { return document.documentElement.dataset.hubMode === 'real'; }
  catch (e) { return false; }
}
function r29DeskClip(value, length) {
  return Array.from(String(value || '')).slice(0, length).join('');
}
function r29DeskLetter(person) {
  if (person && String(person.key || '').indexOf('ext:owner:') === 0 && person.id === 'owner') return '你';
  var source = person && person.roster ? person.name : (person && person.id);
  var chars = Array.from(String(source || '').trim());
  return chars[0] || '外';
}
function r29DeskLetterHtml(person, px) {
  var size = px || 28;
  return '<span class="r29-desk-letter" role="img" aria-label="' + esc(person.name) +
    '" style="--r29-desk-size:' + size + 'px">' + esc(r29DeskLetter(person)) + '</span>';
}
function r29DeskFace(person, px) {
  if (!person) return '';
  if (person.roster && typeof r29Face === 'function') {
    try {
      var html = r29Face(person.id, px || 28);
      if (html) return html;
    } catch (e) {}
  }
  return r29DeskLetterHtml(person, px || 28);
}
function r29DeskFacesHtml(list, px) {
  var seen = {};
  var html = '';
  (list || []).forEach(function (person) {
    if (!person || !person.key || seen[person.key]) return;
    seen[person.key] = true;
    html += r29DeskFace(person, px);
  });
  return html;
}
function r29DeskActor(value, typeHint) {
  var id = '';
  var type = typeof typeHint === 'string' ? typeHint : '';
  if (typeof value === 'string') id = value.trim();
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.name === 'string') id = value.name.trim();
    if (typeof value.type === 'string' && value.type) type = value.type;
  }
  return id ? {id: id, type: type} : null;
}
function r29DeskShown(actor) {
  if (!actor) return '';
  if (actor.type === 'external') return '外部 · ' + r29DeskClip(actor.id, 24);
  if (actor.type === 'owner') return actor.id === 'owner' ? '你' : r29DeskClip(actor.id, 24);
  var bot = typeof botBy === 'function' ? botBy(actor.id) : null;
  var name = bot && bot.name ? bot.name : actor.id;
  return r29DeskClip(name, 24);
}
function r29DeskPerson(actor) {
  if (!actor || !actor.id) return null;
  var roster = actor.type !== 'external' && actor.type !== 'owner' &&
    typeof botBy === 'function' && !!botBy(actor.id);
  var key = roster ? actor.id : 'ext:' + (actor.type || 'x') + ':' + actor.id;
  return {id: actor.id, key: key, name: r29DeskShown(actor), roster: roster};
}
function r29DeskRoster(id) {
  if (!id || typeof botBy !== 'function') return null;
  var bot = botBy(id);
  if (!bot) return null;
  return {id: id, key: id, name: bot.name || id, roster: true};
}
function r29DeskWhen(value) {
  if (value == null || value === '') return {text: '', iso: ''};
  var raw = String(value);
  var parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return {text: raw, iso: ''};
  }
  var date = new Date(parsed);
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  return {
    text: pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
      pad(date.getHours()) + ':' + pad(date.getMinutes()),
    iso: raw
  };
}
function r29DeskNames(ticket) {
  var to = Array.isArray(ticket.to) ? ticket.to.filter(function (item) {
    return typeof item === 'string' && item.trim();
  }) : [];
  var claimType = typeof ticket.claimedByType === 'string' ? ticket.claimedByType : '';
  return {
    from: r29DeskActor(ticket.from),
    claim: r29DeskActor(ticket.claimedBy, claimType),
    candidates: to
  };
}
function r29DeskStage(ticket, names) {
  var review = typeof ticket.review === 'string' ? ticket.review : '';
  var state = typeof ticket.state === 'string' ? ticket.state : '';
  if (review === 'accepted') return 'accepted';
  if (state === 'failed') return 'failed';
  if (review === 'submitted') return 'submitted';
  if (review === 'sent_back') return 'returned';
  if (state === 'completed') return 'completed';
  if (!names.claim) return names.candidates.length === 1 ? 'ask' : 'open';
  if (state === 'waiting-human') return 'waiting';
  if (state === 'blocked') return 'blocked';
  if (state === 'waiting-timeout') return 'timeout';
  if (state === 'uncertain') return 'uncertain';
  return 'claimed';
}
function r29DeskWorker(stage, names) {
  if (stage === 'ask') return r29DeskActor(names.candidates[0], '');
  var busy = ['claimed', 'failed', 'blocked', 'waiting', 'timeout', 'uncertain', 'submitted', 'returned'];
  return busy.indexOf(stage) >= 0 ? names.claim : null;
}
function r29DeskLine(stage, jia, yi) {
  var j = jia || '';
  var y = yi || '';
  if (stage === 'ask') {
    if (j && y) return j + '请' + y + '帮忙';
    if (y) return '请' + y + '帮忙';
    return j ? j + '发出，还没人领' : '还没人领';
  }
  if (stage === 'claimed') return y ? y + '已接手' : '已接手';
  if (stage === 'submitted') {
    if (y && j) return y + '交回，等' + j + '看';
    if (y) return y + '交回，等验收';
    if (j) return '交回了，等' + j + '看';
    return '交回了，等验收';
  }
  if (stage === 'accepted') return j ? j + '已验收' : '已验收';
  if (stage === 'returned') {
    if (j && y) return j + '退回，等' + y + '再做';
    if (y) return '已退回，等' + y + '再做';
    if (j) return j + '退回了';
    return '已退回';
  }
  if (stage === 'failed') return y ? y + '这张没做成' : '这张没做成';
  if (stage === 'blocked') return y ? y + '卡住了' : '卡住了';
  if (stage === 'waiting') {
    if (y && j) return y + '在等' + j + '回话';
    if (y) return y + '在等人回话';
    return '等人回话';
  }
  if (stage === 'timeout') return y ? y + '这张过了时限' : '过了时限还在等';
  if (stage === 'uncertain') return y ? y + '拿不准' : '拿不准';
  if (stage === 'completed') return '已标完成';
  return j ? j + '发出，还没人领' : '还没人领';
}
function r29DeskFaceRows(stage, from, worker) {
  var rows = [];
  function push(actor) {
    var person = r29DeskPerson(actor);
    if (!person) return;
    rows.push(person);
  }
  var both = stage === 'ask' || stage === 'submitted' || stage === 'returned' || stage === 'waiting';
  var onlyFrom = stage === 'accepted' || stage === 'open';
  var onlyWorker = ['claimed', 'failed', 'blocked', 'timeout', 'uncertain'].indexOf(stage) >= 0;
  if (both || onlyFrom) push(from);
  var same = from && worker && worker.id === from.id && worker.type === from.type;
  if ((both || onlyWorker) && worker && !same) push(worker);
  return rows;
}
function r29DeskReport(ticket) {
  function one(value) {
    return value && typeof value === 'object' && typeof value.summary === 'string' &&
      value.summary.trim() ? value : null;
  }
  var report = one(Array.isArray(ticket.report) ? ticket.report[ticket.report.length - 1] : ticket.report);
  var picked = report || one(Array.isArray(ticket.reports) ? ticket.reports[ticket.reports.length - 1] : null);
  return picked ? {text: picked.summary.trim(), own: picked.selfReported === true} : null;
}
function r29DeskSummary(ticket) {
  var report = r29DeskReport(ticket);
  if (report) return r29DeskClip(report.text, 300) + (report.own ? '（交回时自己写的）' : '');
  if (typeof ticket.goal === 'string' && ticket.goal.trim()) return r29DeskClip(ticket.goal.trim(), 300);
  var progress = Array.isArray(ticket.progress) ? ticket.progress : [];
  var i;
  for (i = progress.length - 1; i >= 0; i -= 1) {
    var text = progress[i] && typeof progress[i].text === 'string' ? progress[i].text.trim() : '';
    if (text) return r29DeskClip(text, 300);
  }
  return '没有';
}
function r29DeskByType(ticket, by) {
  if (ticket.claimedBy === by && ticket.claimedByType === 'external') return 'external';
  if (ticket.from && ticket.from.name === by && ticket.from.type === 'external') return 'external';
  if (ticket.claimedBy === by && ticket.claimedByType === 'owner') return 'owner';
  if (ticket.from && ticket.from.name === by && ticket.from.type === 'owner') return 'owner';
  return '';
}
function r29DeskVerified(ticket) {
  var rows = Array.isArray(ticket.verification) ? ticket.verification.filter(function (item) {
    return item && typeof item === 'object';
  }) : [];
  if (!rows.length) return '还没有核验记录';
  var verdicts = {pass: '通过', fail: '没过', partial: '部分通过'};
  return rows.slice(-5).map(function (item) {
    var by = typeof item.by === 'string' ? item.by.trim() : '';
    var who = by ? r29DeskShown(r29DeskActor(by, r29DeskByType(ticket, by))) : '';
    var verdict = verdicts[item.verdict] || '结果不明';
    var note = typeof item.note === 'string' && item.note.trim() ? r29DeskClip(item.note.trim(), 80) : '';
    return [who, verdict, note].filter(Boolean).join(' · ');
  }).join('；');
}
function r29DeskChecks(ticket) {
  return (Array.isArray(ticket.acceptance) ? ticket.acceptance : []).map(function (item) {
    if (!item || typeof item !== 'object') return '';
    var check = typeof item.check === 'string' ? item.check.trim() : '';
    var expect = typeof item.expect === 'string' ? item.expect.trim() : '';
    if (!check && !expect) return '';
    var head = r29DeskClip(check || '一项条件', 40);
    return expect ? head + '（应是 ' + r29DeskClip(expect, 40) + '）' : head;
  }).filter(Boolean);
}
function r29DeskUnmet(ticket, stage, names) {
  var parts = [];
  var ask = ticket.open_ask && typeof ticket.open_ask.text === 'string' ? ticket.open_ask.text.trim() : '';
  if (ask) parts.push('还在问：' + r29DeskClip(ask, 80));
  if (stage === 'returned') parts.push('退回之后还没再交');
  if (stage === 'submitted') parts.push('还等发起的人看过');
  if (stage === 'ask') parts.push('点了名，还没接手');
  if (stage === 'open' && names.candidates.length) {
    var listed = names.candidates.map(function (id) {
      return r29DeskShown(r29DeskActor(id, ''));
    }).filter(Boolean);
    if (listed.length) parts.push('候选还没接手：' + listed.join('、'));
  }
  var checks = r29DeskChecks(ticket);
  if (checks.length) parts.push('这些条件没有逐条核验记录：' + checks.join('、'));
  var rows = Array.isArray(ticket.verification) ? ticket.verification.filter(function (item) {
    return item && typeof item === 'object';
  }) : [];
  var last = rows[rows.length - 1];
  if (last && (last.verdict === 'fail' || last.verdict === 'partial')) {
    var note = typeof last.note === 'string' && last.note.trim() ? '：' + r29DeskClip(last.note.trim(), 80) : '';
    parts.push('最近一次没全部过' + note);
  }
  if (!parts.length) return stage === 'accepted' || rows.length ? '没有另列没验的' : '整单还没核验';
  return r29DeskClip(parts.join('。'), 360);
}
function r29DeskColOf(ticket) {
  var state = ticket && ticket.state;
  var review = ticket && ticket.review;
  if (state === 'completed') return 'done';
  if (state === 'failed') return 'attention';
  if (['blocked', 'waiting-human', 'waiting-timeout', 'uncertain'].indexOf(state) >= 0) return 'attention';
  if (review === 'submitted') return 'review';
  if (state === 'progress') return 'progress';
  return 'queued';
}
function r29DeskAdd(list, seen, person) {
  if (!person || !person.key || seen[person.key]) return;
  seen[person.key] = true;
  list.push(person);
}
function r29DeskFromTicket(ticket) {
  if (!ticket || typeof ticket.id !== 'string' || !ticket.id) return null;
  var names = r29DeskNames(ticket);
  var stage = r29DeskStage(ticket, names);
  var worker = r29DeskWorker(stage, names);
  var people = [];
  var seen = {};
  r29DeskAdd(people, seen, r29DeskPerson(names.from));
  r29DeskAdd(people, seen, r29DeskPerson(names.claim));
  names.candidates.forEach(function (id) {
    r29DeskAdd(people, seen, r29DeskPerson(r29DeskActor(id, '')));
  });
  var when = r29DeskWhen(ticket.updatedAt || ticket.createdAt || '');
  var stamp = Date.parse(ticket.updatedAt || ticket.createdAt || '');
  return {
    id: ticket.id,
    col: r29DeskColOf(ticket),
    title: r29DeskClip(ticket.title || '（无标题）', 40),
    rawTitle: typeof ticket.title === 'string' ? ticket.title : '',
    line: r29DeskLine(stage, r29DeskShown(names.from), r29DeskShown(worker)),
    faces: r29DeskFaceRows(stage, names.from, worker),
    people: people,
    time: when.text,
    iso: when.iso,
    stamp: Number.isFinite(stamp) ? stamp : 0,
    assignee: r29DeskPerson(names.claim || (names.candidates.length ? r29DeskActor(names.candidates[0], '') : null)),
    goal: typeof ticket.goal === 'string' ? ticket.goal : '',
    locked: ticket.legacy === true,
    summary: r29DeskSummary(ticket),
    verified: r29DeskVerified(ticket),
    unmet: r29DeskUnmet(ticket, stage, names)
  };
}
function r29DeskDemoCol(card) {
  var col = typeof boardCol === 'function' ? boardCol(card) : card.col;
  if (col === 'review') return 'review';
  if (col === 'new') return 'queued';
  if (col === 'doing') return 'progress';
  if (col === 'done') return 'done';
  return 'attention';
}
function r29DeskDemoLine(card, col) {
  var worker = r29DeskRoster(card.bot);
  var from = r29DeskRoster(r29Assigner(card));
  var y = worker ? worker.name : '';
  var j = from ? from.name : '';
  if (col === 'queued') {
    if (j && y && from.id !== card.bot) return j + '请' + y + '帮忙';
    if (y) return '请' + y + '帮忙';
    return '还没人领';
  }
  if (col === 'progress') return y ? y + '已接手' : '已接手';
  if (col === 'review') return y ? y + '交回了，等你验收' : '等你验收';
  if (col === 'attention' && card.col !== 'fail' && card.col !== 'stuck') return y ? y + '在等你看' : '等你看';
  if (col === 'done') {
    var closed = card.decision && typeof isClosed === 'function' && typeof decBy === 'function' &&
      isClosed(decBy(card.decision));
    if (closed) return j ? j + '已验收' : '已验收';
    return '已标完成';
  }
  if (card.col === 'fail') return y ? y + '这张没做成' : '这张没做成';
  if (card.col === 'stuck') return y ? y + '卡住了' : '卡住了';
  return y ? y + '在等你看' : '等人看';
}
function r29DeskDemoFaces(card, col) {
  var from = r29DeskRoster(typeof r29Assigner === 'function' ? r29Assigner(card) : '');
  var worker = r29DeskRoster(card.bot);
  var faces = [];
  if (col === 'queued') {
    if (from) faces.push(from);
    if (worker && (!from || worker.id !== from.id)) faces.push(worker);
  } else if (col === 'done') {
    var closed = card.decision && typeof isClosed === 'function' && typeof decBy === 'function' &&
      isClosed(decBy(card.decision));
    if (closed && from) faces.push(from);
  } else if (worker) faces.push(worker);
  return faces;
}
function r29DeskFromDemo(card) {
  if (!card || !card.id) return null;
  var over = r30Local[card.id] || {};
  var col = over.col || r29DeskDemoCol(card);
  var shown = Object.assign({}, card);
  if (Object.prototype.hasOwnProperty.call(over, 'bot')) shown.bot = over.bot;
  if (over.title) shown.title = over.title;
  if (over.detail) shown.detail = over.detail;
  var people = [];
  var seen = {};
  r29DeskAdd(people, seen, r29DeskRoster(typeof r29Assigner === 'function' ? r29Assigner(card) : ''));
  r29DeskAdd(people, seen, r29DeskRoster(shown.bot));
  var when = r29DeskWhen(card.updatedAt || card.time || '');
  var order = 0;
  try { order = typeof boardOrder === 'function' ? boardOrder(card) : 0; }
  catch (e) { order = 0; }
  var closed = card.decision && typeof isClosed === 'function' && typeof decBy === 'function' &&
    isClosed(decBy(card.decision));
  return {
    id: String(card.id),
    col: col,
    title: r29DeskClip(shown.title || '（无标题）', 40),
    rawTitle: String(shown.title || ''),
    line: r29DeskDemoLine(shown, col),
    faces: r29DeskDemoFaces(shown, col),
    people: people,
    time: when.text,
    iso: when.iso,
    stamp: over.fresh ? Date.now() : -order,
    assignee: r29DeskRoster(shown.bot),
    goal: String(shown.detail || shown.sub || ''),
    locked: false,
    summary: r29DeskClip(shown.detail || shown.sub || '没有', 300),
    verified: '还没有核验记录',
    unmet: closed ? '没有另列没验的' : '整单还没核验'
  };
}
function r29DeskDemoRows() {
  var cards = (state && state.cards ? state.cards : []).concat(r30Added);
  if (state && state.boardScope !== 'all') {
    var id = state.boardAssistant || state.bot;
    cards = cards.filter(function (card) { return card && card.bot === id; });
  }
  return cards.filter(function (card) { return !(card && r30Local[card.id] && r30Local[card.id].gone); })
    .map(r29DeskFromDemo).filter(Boolean);
}
function r29DeskCurrent() {
  if (r29DeskReal()) return r29DeskRows || [];
  return r29DeskDemoRows();
}
function r29DeskMatch(row) {
  if (!r29DeskFilter) return true;
  return (row.people || []).some(function (person) { return person && person.key === r29DeskFilter; });
}
function r29DeskBarPeople(rows) {
  var list = [];
  var seen = {};
  (state && state.bots ? state.bots : []).forEach(function (bot) {
    if (!bot || !bot.id || bot.steward || bot.parent || bot.enabled === false) return;
    r29DeskAdd(list, seen, {id: bot.id, key: bot.id, name: bot.name || bot.id, roster: true});
  });
  (rows || []).forEach(function (row) {
    (row.people || []).forEach(function (person) {
      if (person && !person.roster) r29DeskAdd(list, seen, person);
    });
  });
  return list;
}
function r29DeskFilterButton(person, on) {
  var label = person ? person.name : '全部';
  var key = person ? person.key : 'all';
  var face = person ? r29DeskFace(person, 32) : '';
  return '<button type="button" class="r29-desk-filter' + (on ? ' is-on' : '') +
    '" data-r29-desk-filter="' + esc(key) + '" aria-pressed="' + (on ? 'true' : 'false') +
    '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + face +
    '<span class="r29-desk-filter-name">' + esc(label) + '</span></button>';
}
function r29DeskBar(rows) {
  var people = r29DeskBarPeople(rows);
  var html = r29DeskFilterButton(null, !r29DeskFilter);
  people.forEach(function (person) {
    html += r29DeskFilterButton(person, r29DeskFilter === person.key);
  });
  return '<div class="r29-desk-bar" role="toolbar" aria-label="按人筛选">' + html +
    '<button type="button" class="r30-new" data-r30-new>＋ 新建</button></div>';
}
function r29DeskTimeHtml(row) {
  if (!row.time) return '';
  var attr = row.iso ? ' datetime="' + esc(row.iso) + '"' : '';
  return '<time class="r29-desk-time"' + attr + '>' + esc(row.time) + '</time>';
}
function r30FaceButton(row, px) {
  var who = row.assignee;
  var label = who ? '换负责人，现在是' + who.name : '指定负责人';
  var inner = who ? r29DeskFace(who, px || 32) : '<span class="r30-face-empty" aria-hidden="true">＋</span>';
  return '<button type="button" class="r30-face" data-r30-assign="' + esc(row.id) + '" title="' + esc(label) +
    '" aria-label="' + esc(label) + '">' + inner + '</button>';
}
function r30MenuButton(row) {
  return '<button type="button" class="r30-menu" data-r30-menu="' + esc(row.id) +
    '" title="更多操作" aria-label="更多操作：' + esc(row.title) + '">⋯</button>';
}
function r30CardHtml(row, phone) {
  var on = r29DeskPick === row.id && !phone;
  var open = phone ? ' data-r30-open="' + esc(row.id) + '"' : ' data-r29-desk-id="' + esc(row.id) + '"';
  var title = '<strong class="r29-desk-title">' + esc(row.title) + '</strong>';
  var top = '<div class="r30-card-top">' + r30FaceButton(row, 32) +
    '<span class="r29-desk-line">' + esc(row.line) + '</span>' + (phone ? '' : r30MenuButton(row)) + '</div>';
  /* 手机卡身就是操作单入口，不再放「⋯」；标题在人名前面。 */
  return '<article class="r29-desk-card r30-card' + (phone ? ' r30-pcard' : '') + (on ? ' is-on' : '') +
    '" tabindex="0" role="button"' + open + ' data-r30-card="' + esc(row.id) + '" aria-label="' +
    esc(row.title + '，' + row.line) + '">' + (phone ? title + top : top + title) +
    r29DeskTimeHtml(row) + '</article>';
}
function r29DeskCardHtml(row) { return r30CardHtml(row, false); }
function r29DeskColumns(rows) {
  var html = '';
  R29_DESK_COLS.forEach(function (col) {
    var list = rows.filter(function (row) {
      return row.col === col.id && r29DeskMatch(row);
    }).sort(function (a, b) { return (b.stamp || 0) - (a.stamp || 0); });
    html += '<section class="r29-desk-col" data-r29-desk-col="' + col.id + '"><header><h2>' +
      esc(col.name) + '</h2><em>' + list.length + '</em></header><div class="r29-desk-col-body">' +
      (col.id === 'done' ? r30ClearHtml() : '') + list.map(r29DeskCardHtml).join('') + '</div></section>';
  });
  return '<div class="r29-desk-cols">' + html + '</div>';
}
function r29DeskDetail(rows) {
  var row = (rows || []).filter(r29DeskMatch).find(function (item) { return item.id === r29DeskPick; });
  if (!row) {
    return '<div class="r29-desk-detail"><p>点一张单，看摘要、怎么验的、没验的，也能直接改。</p></div>';
  }
  return '<div class="r29-desk-detail"><h2>' + esc(row.title) + '</h2><p>' + esc(row.line) +
    '</p><h3>摘要</h3><p>' + esc(row.summary) + '</p><h3>怎么验的</h3><p>' + esc(row.verified) +
    '</p><h3>没验的</h3><p>' + esc(row.unmet) + '</p></div>' + r30ActionsHtml(row);
}
function r29DeskBody(rows) {
  var shut = r29DeskOpen ? '' : ' is-shut';
  var label = r29DeskOpen ? '收起' : '展开';
  return '<div class="r29-desk-body">' + r29DeskColumns(rows) +
    '<aside class="r29-desk-side' + shut + '" aria-label="这一单">' +
    '<button type="button" class="r29-desk-toggle" data-r29-desk-toggle aria-expanded="' +
    (r29DeskOpen ? 'true' : 'false') + '">' + label + '</button>' + r29DeskDetail(rows) +
    '</aside></div>';
}
function r29DeskRoot(rows) {
  rows = rows || [];
  var bar = r29DeskBar(rows);
  var status = (r29DeskFailed ? '刚才没刷新成功' : '') +
    (r29DeskOmitted ? ' 还有 ' + r29DeskOmitted + ' 条没显示' : '');
  if (status) bar += '<p role="status">' + esc(status) + '</p>';
  if (!rows.length) {
    return '<div class="r29-desk" data-r29-desk="1">' + bar +
      '<p class="r29-desk-empty" role="status">暂无</p></div>';
  }
  return '<div class="r29-desk" data-r29-desk="1">' + bar + r29DeskBody(rows) + '</div>';
}
var r30DoneOpen = false;
function r30PhoneTabs(rows) {
  var all = rows.filter(r29DeskMatch);
  var html = '<button type="button" class="r30-tab' + (r30Tab === 'all' ? ' is-on' : '') +
    '" data-r30-tab="all" aria-pressed="' + (r30Tab === 'all') + '">全部<em>' + all.length + '</em></button>';
  R29_DESK_COLS.forEach(function (col) {
    var n = all.filter(function (row) { return row.col === col.id; }).length;
    html += '<button type="button" class="r30-tab' + (r30Tab === col.id ? ' is-on' : '') +
      '" data-r30-tab="' + col.id + '" aria-pressed="' + (r30Tab === col.id) + '">' + esc(col.name) +
      '<em>' + n + '</em></button>';
  });
  return '<div class="r30-tabs" role="toolbar" aria-label="按状态看">' + html + '</div>';
}
function r30PhoneList(rows) {
  var shown = rows.filter(r29DeskMatch).sort(function (a, b) { return (b.stamp || 0) - (a.stamp || 0); });
  if (!shown.length) return '<p class="r30-empty" role="status">' + (rows.length ? '这里没有卡' : '暂无') + '</p>';
  var html = '';
  R29_DESK_COLS.forEach(function (col) {
    if (r30Tab !== 'all' && r30Tab !== col.id) return;
    var list = shown.filter(function (row) { return row.col === col.id; });
    if (!list.length) return;
    var fold = col.id === 'done' && r30Tab === 'all';
    html += '<section class="r30-group" data-r30-group="' + col.id + '">';
    if (fold) {
      html += '<button type="button" class="r30-fold" data-r30-fold aria-expanded="' + (r30DoneOpen ? 'true' : 'false') +
        '">' + (r30DoneOpen ? '收起已完成的' : '已完成 ' + list.length + ' 件，点开看') + '<em>' + list.length + '</em></button>';
      if (!r30DoneOpen) { html += '</section>'; return; }
    } else if (r30Tab === 'all') html += '<h2>' + esc(col.name) + '<em>' + list.length + '</em></h2>';
    if (col.id === 'done') html += r30ClearHtml();
    html += list.map(function (row) { return r30CardHtml(row, true); }).join('') + '</section>';
  });
  return html || '<p class="r30-empty" role="status">这一列还没有卡</p>';
}
function r30PhoneBoard(rows) {
  rows = rows || [];
  var sub = rows.length ? String(rows.length) + ' 张' : '暂无';
  var status = (r29DeskFailed ? '刚才没刷新成功' : '') +
    (r29DeskOmitted ? ' 还有 ' + r29DeskOmitted + ' 条没显示' : '');
  return '<section class="boardview r22-boardview r30-phone" data-r30-board>' +
    '<div class="boardbar r22-board-heading">' +
    '<div class="grow"><h1>事情的进度</h1><p>' + esc(sub) + '</p></div>' +
    '<button type="button" class="r30-new" data-r30-new>＋ 新建</button></div>' +
    r30PhoneTabs(rows) +
    (status ? '<p class="r30-status" role="status">' + esc(status) + '</p>' : '') +
    '<div class="r30-list" data-scroll="r30-list">' + r30PhoneList(rows) + '</div></section>';
}
function r29DeskSwap(node, html) {
  if (!node || !node.parentNode) return;
  var holder = document.createElement('div');
  holder.innerHTML = html;
  var next = holder.firstElementChild;
  if (next && typeof node.replaceWith === 'function') node.replaceWith(next);
}
function r29DeskPaint() {
  try {
    if (typeof state === 'undefined' || state.mode !== 'kanban') return;
    if (r30Drag && r30Drag.active) return;
    var typing = document.activeElement && document.activeElement.closest &&
      document.activeElement.closest('.r29-desk [data-r30-form]');
    var rows = r29DeskCurrent();
    var host = document.querySelector('.r29-desk');
    if (host && !typing) r29DeskSwap(host, r29DeskRoot(rows));
    var phone = document.querySelector('.r30-phone');
    if (phone) {
      var list = phone.querySelector('.r30-list');
      var top = list ? list.scrollTop : 0;
      var strip = phone.querySelector('.r30-tabs');
      var left = strip ? strip.scrollLeft : 0;
      r29DeskSwap(phone, r30PhoneBoard(rows));
      var fresh = document.querySelector('.r30-phone .r30-list');
      if (fresh) fresh.scrollTop = top;
      var tabs = document.querySelector('.r30-phone .r30-tabs');
      if (tabs) tabs.scrollLeft = left;
    }
    r30SheetRender();
  } catch (e) {}
}
function r29DeskNormalize(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.tickets)) return data.tickets;
  if (data && data.data && Array.isArray(data.data.tickets)) return data.data.tickets;
  return null;
}
function r29DeskFetchRows() {
  if (typeof fetch !== 'function') return Promise.reject(Error('unavailable'));
  return fetch('/bff/board/tickets', {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {accept: 'application/json'}
  }).then(function (res) {
    if (!res || !res.ok) throw Error('request failed');
    return res.json().then(function (data) {
      var rows = r29DeskNormalize(data);
      if (!rows) throw Error('invalid response');
      return rows.map(r29DeskFromTicket).filter(Boolean);
    });
  });
}
function r29DeskFromHook() {
  var hook = window.HubBoard;
  if (!hook) return null;
  if (typeof hook.tickets === 'function') {
    return Promise.resolve().then(function () { return hook.tickets(); });
  }
  if (typeof hook.list === 'function') {
    return Promise.resolve().then(function () { return hook.list(); });
  }
  if (Array.isArray(hook.tickets)) return Promise.resolve(hook.tickets);
  return null;
}
function r29DeskAsk() {
  var hooked = r29DeskFromHook();
  if (!hooked) return r29DeskFetchRows();
  return hooked.then(function (data) {
    var rows = r29DeskNormalize(data);
    if (rows) return rows.map(r29DeskFromTicket).filter(Boolean);
    return r29DeskFetchRows();
  }).catch(function () { return r29DeskFetchRows(); });
}
function r29DeskPull() {
  if (!r29DeskReal() || document.hidden || r29DeskFlight) return;
  var now = Date.now();
  if (r29DeskLastPull !== null && now - r29DeskLastPull < 30000) return;
  r29DeskLastPull = now;
  r29DeskFlight = true;
  r29DeskAsk().then(function (rows) {
    if (r30Pending > 0) return;
    rows.sort(function (a, b) { return (b.stamp || 0) - (a.stamp || 0); });
    r29DeskOmitted = Math.max(0, rows.length - 300);
    r29DeskRows = rows.slice(0, 300);
    r29DeskFailed = false;
  }).catch(function () {
    r29DeskFailed = true;
  }).then(function () {
    r29DeskFlight = false;
    r29DeskPaint();
  });
}
function r29DeskBind() {
  var hook = window.HubBoard;
  if (!hook || typeof hook.subscribe !== 'function' || r29DeskBound === hook) return;
  r29DeskBound = hook;
  try { hook.subscribe(function () { r29DeskPull(); }); }
  catch (e) { r29DeskBound = null; }
}
function r29DeskTick() {
  try {
    if (document.hidden) return;
    if (typeof state === 'undefined' || state.mode !== 'kanban') return;
    r29DeskBind();
    if (r29DeskReal()) r29DeskPull();
    else r29DeskPaint();
  } catch (e) {}
}
function r29DeskHash() {
  var hash = '';
  try { hash = String(window.location && window.location.hash || ''); }
  catch (e) { return; }
  hash = hash.replace(/^#/, '').split(/[?&]/)[0];
  if (hash !== 'board' && hash !== 'kanban') return;
  if (!window.Hub || typeof Hub.navigate !== 'function') return;
  if (typeof state !== 'undefined' && state.mode === 'kanban') return;
  try { Hub.navigate({view: 'board'}); }
  catch (e) {}
}
function r29DeskOnClick(event) {
  var node = event && event.target && event.target.closest ? event.target.closest(
    '[data-r29-desk-filter],[data-r29-desk-toggle],[data-r29-desk-id]'
  ) : null;
  if (!node || !node.closest('.r29-desk, .r30-phone')) return;
  if (event.target.closest('[data-r30-assign],[data-r30-menu],[data-r30-form]')) return;
  if (r30Dragged()) { event.preventDefault(); return; }
  if (node.hasAttribute('data-r29-desk-filter')) {
    var key = node.getAttribute('data-r29-desk-filter') || 'all';
    r29DeskFilter = key === 'all' ? '' : key;
    r29DeskPaint();
    return;
  }
  if (node.hasAttribute('data-r29-desk-toggle')) {
    r29DeskOpen = !r29DeskOpen;
    r29DeskPaint();
    return;
  }
  r29DeskPick = node.getAttribute('data-r29-desk-id') || '';
  r29DeskOpen = true;
  r29DeskPaint();
}
if (!window.__r29DeskTimer) {
  function r29DeskVisibility() {
    if (window.__r29DeskTimer) clearInterval(window.__r29DeskTimer);
    window.__r29DeskTimer = null;
    if (!document.hidden) {
      window.__r29DeskTimer = setInterval(r29DeskTick, 30000);
      r29DeskTick();
    }
  }
  if (!document.hidden) window.__r29DeskTimer = setInterval(r29DeskTick, 30000);
  document.addEventListener('visibilitychange', r29DeskVisibility);
  document.addEventListener('click', r29DeskOnClick);
  window.addEventListener('hashchange', r29DeskHash);
  if (window.Hub && typeof Hub.on === 'function') {
    Hub.on('navigate', function () {
      if (typeof state === 'undefined' || state.mode !== 'kanban') return;
      r29DeskBind();
      if (r29DeskReal()) r29DeskPull();
    });
    Hub.on('render', function () {
      if (typeof state === 'undefined' || state.mode !== 'kanban' || !r29DeskReal()) return;
      if (r29DeskRows === null) r29DeskPull();
    });
  }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () {
      setTimeout(r29DeskHash, 0);
    });
    else setTimeout(r29DeskHash, 0);
  } catch (e) {}
}

/* ===== 看板上直接改（挪列、换负责人、改标题说明、新建、电脑上拖） ===== */
var r30Local = {};
var r30Added = [];
var r30Tab = 'all';
var r30Sheet = null;
var r30Editing = '';
var r30Ext = [];
var r30ExtAsked = false;
var r30Pending = 0;
var r30Drag = null;
var r30DragSwallow = false;
var r30Seq = 0;
var r30ConfirmDel = '';
var R30_COL_TO_DEMO = {queued: 'new', progress: 'doing', review: 'doing', attention: 'stuck', done: 'done'};

function r30Row(id) {
  var rows = r29DeskCurrent();
  for (var i = 0; i < rows.length; i += 1) if (rows[i].id === id) return rows[i];
  return null;
}
function r30ColName(id) {
  var found = R29_DESK_COLS.filter(function (col) { return col.id === id; })[0];
  return found ? found.name : '';
}
function r30Say(text) {
  try { if (typeof toast === 'function') toast(text); } catch (e) {}
}
function r30People(rows) {
  var list = [];
  var seen = {};
  (state && state.bots ? state.bots : []).forEach(function (bot) {
    if (!bot || !bot.id || bot.steward || bot.parent || bot.enabled === false) return;
    r29DeskAdd(list, seen, {id: bot.id, key: bot.id, name: bot.name || bot.id, roster: true, type: 'assistant'});
  });
  r30Ext.forEach(function (item) {
    r29DeskAdd(list, seen, {id: item.id, key: 'ext:external:' + item.id, name: '外部 · ' + r29DeskClip(item.id, 24),
      roster: false, type: 'external'});
  });
  (rows || []).forEach(function (row) {
    var who = row.assignee;
    if (who && !who.roster) {
      r29DeskAdd(list, seen, {id: who.id, key: who.key, name: who.name, roster: false,
        type: who.key.indexOf('ext:owner:') === 0 ? 'owner' : 'external'});
    }
  });
  return list;
}
function r30LoadPeople() {
  if (r30ExtAsked || !r29DeskReal()) return;
  r30ExtAsked = true;
  var ask = window.HubBoard && typeof window.HubBoard.people === 'function' ?
    Promise.resolve().then(function () { return window.HubBoard.people(); }) :
    fetch('/bff/board/people', {credentials: 'same-origin', cache: 'no-store'}).then(function (res) {
      if (!res.ok) throw Error('no');
      return res.json();
    });
  ask.then(function (data) {
    var list = Array.isArray(data) ? data : data && Array.isArray(data.people) ? data.people : [];
    r30Ext = list.filter(function (item) {
      return item && item.type === 'external' && typeof item.id === 'string' && item.id;
    }).map(function (item) { return {id: item.id}; });
    r30SheetRender();
  }).catch(function () { r30ExtAsked = false; });
}

/* 真正落到后端；没有适配层钩子时直接问同源后端。 */
function r30Send(kind, id, payload) {
  var hook = window.HubBoard;
  if (hook && typeof hook[kind] === 'function') {
    return Promise.resolve().then(function () { return hook[kind](id, payload); }).then(function (data) {
      if (data && data.ticket) return data.ticket;
      if (data && data.id) return data;
      throw Error('bad');
    });
  }
  var path = kind === 'create' ? '/bff/board/tickets/new' :
    '/bff/board/tickets/' + encodeURIComponent(id) + '/' + (kind === 'remove' ? 'delete' : kind);
  return fetch(path, {method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload || {})}).then(function (res) {
    if (!res.ok) throw Error('failed ' + res.status);
    return res.json();
  }).then(function (data) {
    if (data && data.ticket) return data.ticket;
    throw Error('bad');
  });
}
function r30Done(promise, onFail) {
  r30Pending += 1;
  return promise.then(function (ticket) {
    r30Pending -= 1;
    var row = r29DeskFromTicket(ticket);
    if (row && r29DeskRows) {
      var at = -1;
      r29DeskRows.forEach(function (item, i) { if (item.id === row.id) at = i; });
      if (at >= 0) r29DeskRows[at] = row; else r29DeskRows.unshift(row);
    }
    r29DeskPaint();
    return true;
  }, function () {
    r30Pending -= 1;
    onFail();
    r29DeskPaint();
    return false;
  });
}
function r30Clone(row) { return Object.assign({}, row); }

function r30Move(id, col) {
  var row = r30Row(id);
  if (!row || row.col === col) return Promise.resolve(false);
  if (row.locked) { r30Say('这是旧单，只能看，不能挪'); return Promise.resolve(false); }
  if (!r29DeskReal()) {
    r30Local[id] = Object.assign(r30Local[id] || {}, {col: col});
    r30Added.forEach(function (card) { if (card.id === id) card.col = R30_COL_TO_DEMO[col]; });
    r29DeskPaint();
    return Promise.resolve(true);
  }
  var keep = r30Clone(row);
  row.col = col;
  r29DeskPaint();
  return r30Done(r30Send('move', id, {column: col}), function () {
    var at = r29DeskRows.indexOf(row);
    if (at >= 0) r29DeskRows[at] = keep;
    r30Say('没改成，已放回原处');
  });
}
function r30Assign(id, person) {
  var row = r30Row(id);
  if (!row) return Promise.resolve(false);
  if (row.locked) { r30Say('这是旧单，只能看，不能换人'); return Promise.resolve(false); }
  if (row.col === 'done') { r30Say('这张已经完成，先把它挪回去再换人'); return Promise.resolve(false); }
  if (!r29DeskReal()) {
    r30Local[id] = Object.assign(r30Local[id] || {}, {bot: person ? person.id : null});
    r30Added.forEach(function (card) { if (card.id === id) card.bot = person ? person.id : null; });
    r29DeskPaint();
    return Promise.resolve(true);
  }
  var keep = r30Clone(row);
  row.assignee = person ? {id: person.id, key: person.key, name: person.name, roster: person.roster} : null;
  r29DeskPaint();
  var type = !person ? undefined : person.roster ? 'assistant' : (person.type || 'external');
  return r30Done(r30Send('assign', id, {assignee: person ? person.id : null, assigneeType: type}), function () {
    var at = r29DeskRows.indexOf(row);
    if (at >= 0) r29DeskRows[at] = keep;
    r30Say('没改成，负责人还是原来的');
  });
}
function r30Same(a, b) {
  return String(a || '').replace(/\r\n/g, '\n').trim() === String(b || '').replace(/\r\n/g, '\n').trim();
}
function r30Edit(id, title, goal) {
  var row = r30Row(id);
  if (!row) return Promise.resolve(false);
  title = String(title || '').trim();
  goal = String(goal || '').trim();
  if (!title) { r30Say('标题不能空着'); return Promise.resolve(false); }
  if (row.locked) { r30Say('这是旧单，只能看，不能改'); return Promise.resolve(false); }
  /* 只提交用户真的改过的字；没动的标题和说明原样留在库里，不跟着界面上的说法走。 */
  var titleChanged = !r30Same(title, row.rawTitle !== undefined ? row.rawTitle : row.title);
  var goalChanged = !r30Same(goal, row.goal);
  if (!titleChanged && !goalChanged) return Promise.resolve(true);
  if (!r29DeskReal()) {
    var local = {};
    if (titleChanged) local.title = title;
    if (goalChanged && goal) local.detail = goal;
    r30Local[id] = Object.assign(r30Local[id] || {}, local);
    r30Added.forEach(function (card) {
      if (card.id !== id) return;
      if (titleChanged) card.title = title;
      if (goalChanged) card.detail = goal;
    });
    r29DeskPaint();
    return Promise.resolve(true);
  }
  var keep = r30Clone(row);
  var payload = {};
  if (titleChanged) { payload.title = title; row.title = r29DeskClip(title, 40); row.rawTitle = title; }
  if (goalChanged && goal) { payload.goal = goal; row.goal = goal; }
  if (!payload.title && !payload.goal) return Promise.resolve(true);
  r29DeskPaint();
  return r30Done(r30Send('edit', id, payload), function () {
    var at = r29DeskRows.indexOf(row);
    if (at >= 0) r29DeskRows[at] = keep;
    r30Say('没改成，标题和说明还是原来的');
  });
}
/* 删掉：后端是软删除（搬进归档，数据里能找回）；这里卡片立刻从看板上拿掉，失败再放回。 */
function r30RemoveRows(ids) {
  var asked = ids.filter(function (id) { var r = r30Row(id); return r && !r.locked; });
  if (!asked.length) return Promise.resolve(0);
  if (!r29DeskReal()) {
    asked.forEach(function (id) {
      r30Local[id] = Object.assign(r30Local[id] || {}, {gone: true});
      r30Added = r30Added.filter(function (card) { return card.id !== id; });
    });
    r29DeskPaint();
    return Promise.resolve(asked.length);
  }
  var kept = {};
  asked.forEach(function (id) { kept[id] = r30Row(id); });
  r29DeskRows = r29DeskRows.filter(function (item) { return asked.indexOf(item.id) < 0; });
  r29DeskPaint();
  r30Pending += 1;
  var failed = [];
  var chain = Promise.resolve();
  asked.forEach(function (id) {
    chain = chain.then(function () { return r30Send('remove', id, {}); })
      .catch(function () { failed.push(id); });
  });
  return chain.then(function () {
    r30Pending -= 1;
    failed.forEach(function (id) { if (kept[id]) r29DeskRows.push(kept[id]); });
    r29DeskRows.sort(function (a, b) { return (b.stamp || 0) - (a.stamp || 0); });
    r29DeskPaint();
    if (failed.length) r30Say(failed.length === asked.length ? '没删成，卡片还在' : failed.length + ' 张没删成，还在看板上');
    return asked.length - failed.length;
  });
}
function r30DoneIds() {
  return r29DeskCurrent().filter(function (row) { return row.col === 'done' && !row.locked && r29DeskMatch(row); })
    .map(function (row) { return row.id; });
}
function r30ClearHtml() {
  var n = r30DoneIds().length;
  if (!n) return '';
  if (r30ConfirmDel === 'done') {
    return '<div class="r30-confirm" role="alertdialog" aria-label="确认清掉已完成的"><p>把这 ' + n +
      ' 张已完成的从看板上拿掉？数据里还留着，需要时可以找回。</p><div class="r30-row">' +
      '<button type="button" class="r30-danger" data-r30-clear-yes>确认清掉</button>' +
      '<button type="button" data-r30-del-no>先不清</button></div></div>';
  }
  return '<button type="button" class="r30-clear" data-r30-clear>清掉已完成的（' + n + '）</button>';
}
function r30Create(title, goal, person, col) {
  title = String(title || '').trim();
  goal = String(goal || '').trim();
  if (!title) { r30Say('先写个标题'); return Promise.resolve(false); }
  if (!r29DeskReal()) {
    r30Seq += 1;
    var card = {id: 'r30-new-' + r30Seq, title: title, sub: goal || '新建的卡', detail: goal,
      bot: person ? person.id : null, col: R30_COL_TO_DEMO[col] || 'new', project: '', flag: '', time: '刚刚'};
    r30Local[card.id] = {col: col, fresh: true};
    r30Added.unshift(card);
    r29DeskPaint();
    return Promise.resolve(true);
  }
  var payload = {title: title, column: col};
  if (goal) payload.goal = goal;
  if (person) payload.to = person.id;
  return r30Done(r30Send('create', '', payload), function () { r30Say('没建成，请再试一次'); });
}

/* 一张卡的快捷操作：换状态、派给谁、改标题和说明。操作单和电脑右侧栏共用。 */
function r30ActionsHtml(row) {
  var id = esc(row.id);
  var off = row.locked ? ' disabled' : '';
  var html = row.locked ? '<p class="r30-note">这是旧格式的单，只能看，不能改。</p>' : '';
  html += '<h3>换状态</h3><div class="r30-cols" role="group" aria-label="换状态">';
  R29_DESK_COLS.forEach(function (col) {
    html += '<button type="button" class="r30-col' + (row.col === col.id ? ' is-on' : '') + '" data-r30-col="' +
      col.id + '" data-r30-id="' + id + '" aria-pressed="' + (row.col === col.id) + '"' + off + '>' +
      esc(col.name) + '</button>';
  });
  html += '</div><h3>派给谁</h3><div class="r30-people" role="group" aria-label="派给谁">';
  var current = row.assignee ? row.assignee.key : '';
  html += '<button type="button" class="r30-who' + (current ? '' : ' is-on') + '" data-r30-who="" data-r30-id="' + id +
    '" aria-pressed="' + (!current) + '"' + off + '><span class="r30-face-empty" aria-hidden="true">－</span>' +
    '<span>先不指定</span></button>';
  r30People([row]).forEach(function (person) {
    var on = person.key === current;
    html += '<button type="button" class="r30-who' + (on ? ' is-on' : '') + '" data-r30-who="' + esc(person.key) +
      '" data-r30-id="' + id + '" aria-pressed="' + on + '"' + off + '>' + r29DeskFace(person, 32) +
      '<span>' + esc(person.name) + '</span></button>';
  });
  html += '</div><h3>标题和说明</h3>';
  if (r30Editing === row.id && !row.locked) {
    html += '<div class="r30-form" data-r30-form><label>标题<input type="text" name="title" maxlength="120" value="' +
      esc(row.rawTitle !== undefined ? row.rawTitle : row.title) + '"></label><label>说明<textarea name="goal" rows="4" maxlength="4000">' +
      esc(row.goal || '') + '</textarea></label><div class="r30-row"><button type="button" class="r30-primary" ' +
      'data-r30-save="' + id + '">保存</button><button type="button" data-r30-cancel>先不改</button></div></div>';
  } else {
    html += '<button type="button" class="r30-edit" data-r30-edit="' + id + '"' + off + '>改标题和说明</button>';
  }
  if (r30ConfirmDel === row.id && !row.locked) {
    html += '<div class="r30-confirm" role="alertdialog" aria-label="确认删掉这张"><p>删掉「' +
      esc(r29DeskClip(row.title, 20)) + '」？它会从看板上拿掉，数据里还留着，需要时可以找回。</p>' +
      '<div class="r30-row"><button type="button" class="r30-danger" data-r30-del-yes="' + id +
      '">确认删掉</button><button type="button" data-r30-del-no>先不删</button></div></div>';
  } else {
    html += '<button type="button" class="r30-del" data-r30-del="' + id + '"' + off + '>删掉这张</button>';
  }
  return '<div class="r30-actions">' + html + '</div>';
}

/* 操作单：手机从底部升起，电脑居中。 */
function r30SheetNode() {
  var node = document.getElementById('r30-sheet');
  if (!node) {
    node = document.createElement('div');
    node.id = 'r30-sheet';
    document.body.appendChild(node);
  }
  return node;
}
function r30DetailHtml(row) {
  return '<details class="r30-detail"' + (r30Sheet && r30Sheet.detail ? ' open' : '') +
    '><summary>看详情</summary><h3>摘要</h3><p>' + esc(row.summary) + '</p><h3>怎么验的</h3><p>' +
    esc(row.verified) + '</p><h3>没验的</h3><p>' + esc(row.unmet) + '</p></details>';
}
function r30SheetBody() {
  var sheet = r30Sheet;
  if (sheet.kind === 'new') return r30NewHtml();
  var row = r30Row(sheet.id);
  if (!row) return '<header><h2 id="r30-sheet-title">这张卡不见了</h2><button type="button" class="r30-x" ' +
    'data-r30-close aria-label="关闭">✕</button></header><p>可能已经被别处改掉，关掉再看看。</p>';
  var head = '<header><h2 id="r30-sheet-title">' + esc(sheet.kind === 'assign' ? '派给谁' : row.title) +
    '</h2><button type="button" class="r30-x" data-r30-close aria-label="关闭">✕</button></header>';
  if (sheet.kind === 'assign') {
    var assignOnly = r30ActionsHtml(row);
    var a = assignOnly.indexOf('<h3>派给谁</h3>');
    var b = assignOnly.indexOf('<h3>标题和说明</h3>');
    return head + '<p class="r30-line">' + esc(row.title) + '</p><div class="r30-actions">' +
      assignOnly.slice(a + '<h3>派给谁</h3>'.length, b) + '</div>';
  }
  return head + '<p class="r30-line">' + esc(row.line) + '</p>' + r30ActionsHtml(row) + r30DetailHtml(row);
}
function r30NewHtml() {
  var s = r30Sheet;
  var html = '<header><h2 id="r30-sheet-title">新建一张卡</h2><button type="button" class="r30-x" data-r30-close ' +
    'aria-label="关闭">✕</button></header><div class="r30-form" data-r30-form><label>标题<input type="text" ' +
    'name="title" maxlength="120" placeholder="要做什么事"></label><label>说明（可以不写）<textarea name="goal" ' +
    'rows="3" maxlength="4000"></textarea></label></div><div class="r30-actions">' +
    '<h3>填好标题，点谁就立刻交给谁</h3><div class="r30-people" role="group" aria-label="交给谁">';
  r30People(r29DeskCurrent()).forEach(function (person) {
    html += '<button type="button" class="r30-who r30-give" data-r30-newgo="' + esc(person.key) + '"' +
      (s.busy ? ' disabled' : '') + '>' + r29DeskFace(person, 32) + '<span>交给' + esc(person.name) + '</span></button>';
  });
  html += '<button type="button" class="r30-who r30-give" data-r30-newgo=""' + (s.busy ? ' disabled' : '') +
    '><span class="r30-face-empty" aria-hidden="true">－</span><span>暂不指派</span></button></div>' +
    '<details class="r30-opt"' + (s.optOpen ? ' open' : '') + '><summary>初始放在「' + esc(r30ColName(s.col)) + '」，要换点这里</summary>' +
    '<div class="r30-cols" role="group" aria-label="初始状态">';
  R29_DESK_COLS.forEach(function (col) {
    html += '<button type="button" class="r30-col' + (s.col === col.id ? ' is-on' : '') + '" data-r30-newcol="' +
      col.id + '" aria-pressed="' + (s.col === col.id) + '">' + esc(col.name) + '</button>';
  });
  return html + '</div></details><div class="r30-row"><button type="button" data-r30-close>取消</button></div></div>';
}
function r30SheetRender() {
  var node = document.getElementById('r30-sheet');
  if (!r30Sheet) { if (node) node.innerHTML = ''; return; }
  node = r30SheetNode();
  var live = document.activeElement;
  var typing = live && node.contains(live) && /^(INPUT|TEXTAREA)$/.test(live.tagName);
  if (typing && node.querySelector('.r30-sheet')) return;
  var keep = {};
  var inputs = node.querySelectorAll('[data-r30-form] input, [data-r30-form] textarea');
  Array.prototype.forEach.call(inputs, function (el) { keep[el.name] = el.value; });
  var focus = document.activeElement && node.contains(document.activeElement) ?
    document.activeElement.getAttribute('data-r30-col') || document.activeElement.getAttribute('data-r30-who') : null;
  var scroll = node.querySelector('.r30-sheet') ? node.querySelector('.r30-sheet').scrollTop : 0;
  node.innerHTML = '<div class="r30-back" data-r30-back><section class="r30-sheet r30-' + r30Sheet.kind +
    '" role="dialog" aria-modal="true" aria-labelledby="r30-sheet-title" tabindex="-1"><div class="r30-grab" ' +
    'aria-hidden="true"></div>' + r30SheetBody() + '<p class="r30-flash" role="status" aria-live="polite">' +
    esc(r30Sheet.flash || '') + '</p></section></div>';
  Array.prototype.forEach.call(node.querySelectorAll('[data-r30-form] input, [data-r30-form] textarea'),
    function (el) { if (Object.prototype.hasOwnProperty.call(keep, el.name)) el.value = keep[el.name]; });
  var box = node.querySelector('.r30-sheet');
  if (box) box.scrollTop = scroll;
  if (focus !== null && box) {
    var again = box.querySelector('[data-r30-col="' + focus + '"],[data-r30-who="' + focus + '"]');
    if (again) again.focus();
  }
}
function r30OpenSheet(kind, id, extra) {
  r30Sheet = Object.assign({kind: kind, id: id || '', col: 'queued', who: '', flash: '',
    opener: document.activeElement}, extra || {});
  r30Editing = '';
  r30ConfirmDel = '';
  r30LoadPeople();
  r30SheetRender();
  var box = document.querySelector('#r30-sheet .r30-sheet');
  var first = box && (box.querySelector('input[name="title"]') || box.querySelector('.r30-col.is-on') ||
    box.querySelector('.r30-who.is-on') || box.querySelector('button'));
  if (first) first.focus();
}
function r30CloseSheet() {
  var opener = r30Sheet && r30Sheet.opener;
  r30Sheet = null;
  r30Editing = '';
  r30ConfirmDel = '';
  r30SheetRender();
  try { if (opener && opener.isConnected && opener.focus) opener.focus(); } catch (e) {}
}
function r30PersonByKey(key) {
  if (!key) return null;
  var list = r30People(r29DeskCurrent());
  for (var i = 0; i < list.length; i += 1) if (list[i].key === key) return list[i];
  return null;
}
function r30Flash(text) {
  if (r30Sheet) { r30Sheet.flash = text; r30SheetRender(); }
}

function r30Dragged() {
  return r30DragSwallow;
}
function r30OnClick(event) {
  var t = event.target && event.target.closest ? event.target : null;
  if (!t) return;
  var node = t.closest('[data-r30-assign],[data-r30-menu],[data-r30-open],[data-r30-new],[data-r30-tab],[data-r30-fold],[data-r30-newgo],' +
    '[data-r30-close],[data-r30-back],[data-r30-col],[data-r30-who],[data-r30-edit],[data-r30-save],' +
    '[data-r30-cancel],[data-r30-newcol],[data-r30-create],[data-r30-del],[data-r30-del-yes],' +
    '[data-r30-del-no],[data-r30-clear],[data-r30-clear-yes]');
  if (!node) return;
  if (node.hasAttribute('data-r30-back')) {
    if (t === node) r30CloseSheet();
    return;
  }
  if (r30Dragged()) { event.preventDefault(); return; }
  if (node.hasAttribute('data-r30-close')) { r30CloseSheet(); return; }
  if (node.hasAttribute('data-r30-assign')) {
    event.preventDefault();
    r30OpenSheet('assign', node.getAttribute('data-r30-assign'));
    return;
  }
  if (node.hasAttribute('data-r30-menu')) {
    event.preventDefault();
    r30OpenSheet('full', node.getAttribute('data-r30-menu'));
    return;
  }
  if (node.hasAttribute('data-r30-open')) { r30OpenSheet('full', node.getAttribute('data-r30-open')); return; }
  if (node.hasAttribute('data-r30-new')) { r30OpenSheet('new', ''); return; }
  if (node.hasAttribute('data-r30-fold')) { r30DoneOpen = !r30DoneOpen; r29DeskPaint(); return; }
  if (node.hasAttribute('data-r30-tab')) {
    r30Tab = node.getAttribute('data-r30-tab') || 'all';
    r29DeskPaint();
    return;
  }
  if (node.hasAttribute('data-r30-newcol')) {
    r30Sheet.col = node.getAttribute('data-r30-newcol');
    r30Sheet.optOpen = true;
    r30SheetRender();
    return;
  }
  if (node.hasAttribute('data-r30-newgo')) {
    if (r30Sheet.busy) return;
    var nform = node.closest('#r30-sheet').querySelector('[data-r30-form]');
    var nwho = r30PersonByKey(node.getAttribute('data-r30-newgo'));
    var ncol = r30Sheet.col;
    var ntitle = nform.querySelector('[name=title]').value;
    if (!String(ntitle).trim()) { r30Flash('先写个标题'); r30Say('先写个标题'); return; }
    r30Sheet.busy = true;
    r30SheetRender();
    var sheetNow = r30Sheet;
    r30Create(ntitle, nform.querySelector('[name=goal]').value, nwho, ncol).then(function (ok) {
      sheetNow.busy = false;
      if (ok) { if (r30Sheet === sheetNow) r30CloseSheet(); r30Say(nwho ? '已交给' + nwho.name : '已加上，先没指派'); }
      else if (r30Sheet === sheetNow) { r30SheetRender(); r30Flash('没建成，稿子还在，请再试一次'); }
    });
    return;
  }
  if (node.hasAttribute('data-r30-col')) {
    var id = node.getAttribute('data-r30-id');
    var to = node.getAttribute('data-r30-col');
    r30Move(id, to).then(function (ok) { if (ok) r30Flash('已放到「' + r30ColName(to) + '」'); });
    return;
  }
  if (node.hasAttribute('data-r30-who')) {
    var rid = node.getAttribute('data-r30-id');
    var person = r30PersonByKey(node.getAttribute('data-r30-who'));
    var kind = r30Sheet && r30Sheet.kind;
    r30Assign(rid, person).then(function (ok) {
      if (!ok) return;
      if (kind === 'assign') { r30CloseSheet(); r30Say(person ? '已派给' + person.name : '已改成先不指定'); }
      else r30Flash(person ? '已派给' + person.name : '已改成先不指定');
    });
    return;
  }
  if (node.hasAttribute('data-r30-del')) {
    r30ConfirmDel = node.getAttribute('data-r30-del');
    r30SheetRender();
    r29DeskPaint();
    return;
  }
  if (node.hasAttribute('data-r30-clear')) { r30ConfirmDel = 'done'; r29DeskPaint(); return; }
  if (node.hasAttribute('data-r30-del-no')) { r30ConfirmDel = ''; r30SheetRender(); r29DeskPaint(); return; }
  if (node.hasAttribute('data-r30-del-yes')) {
    var delId = node.getAttribute('data-r30-del-yes');
    r30ConfirmDel = '';
    r30RemoveRows([delId]).then(function (n) {
      if (!n) { r30SheetRender(); return; }
      r30CloseSheet();
      if (r29DeskPick === delId) r29DeskPick = '';
      r29DeskPaint();
      r30Say('已删掉，数据里还留着');
    });
    return;
  }
  if (node.hasAttribute('data-r30-clear-yes')) {
    var ids = r30DoneIds();
    r30ConfirmDel = '';
    r30RemoveRows(ids).then(function (n) { if (n) r30Say('已清掉 ' + n + ' 张已完成的'); });
    return;
  }
  if (node.hasAttribute('data-r30-edit')) {
    r30Editing = node.getAttribute('data-r30-edit');
    r29DeskPaint();
    var field = document.querySelector('[data-r30-form] input[name="title"]');
    if (field) field.focus();
    return;
  }
  if (node.hasAttribute('data-r30-cancel')) { r30Editing = ''; r29DeskPaint(); return; }
  if (node.hasAttribute('data-r30-save')) {
    var sid = node.getAttribute('data-r30-save');
    var box = node.closest('[data-r30-form]');
    r30Edit(sid, box.querySelector('[name=title]').value, box.querySelector('[name=goal]').value)
      .then(function (ok) {
        if (!ok) return;
        r30Editing = '';
        r29DeskPaint();
        r30Flash('已保存');
      });
  }
}
function r30OnKey(event) {
  if (event.key === 'Escape' && r30Sheet) { event.preventDefault(); r30CloseSheet(); return; }
  if (event.key === 'Tab' && r30Sheet) {
    var box = document.querySelector('#r30-sheet .r30-sheet');
    if (!box) return;
    var items = Array.prototype.filter.call(box.querySelectorAll('button,input,textarea,summary,[tabindex="0"]'),
      function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    return;
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target && event.target.matches &&
    event.target.matches('[data-r29-desk-id],[data-r30-open]')) {
    event.preventDefault();
    event.target.click();
  }
}

/* 电脑上拖：按住卡片拖到另一列，放手就改状态。触屏不拖，用操作单。 */
function r30DragEnd(commit, x, y) {
  var drag = r30Drag;
  r30Drag = null;
  document.removeEventListener('pointermove', r30DragMove, true);
  document.removeEventListener('pointerup', r30DragUp, true);
  document.removeEventListener('pointercancel', r30DragCancel, true);
  document.removeEventListener('keydown', r30DragKey, true);
  if (!drag) return;
  if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
  document.body.classList.remove('r30-dragging');
  Array.prototype.forEach.call(document.querySelectorAll('.r29-desk-col.is-over,.r30-card.is-dragging'),
    function (el) { el.classList.remove('is-over'); el.classList.remove('is-dragging'); });
  if (!drag.active) return;
  r30DragSwallow = true;
  setTimeout(function () { r30DragSwallow = false; }, 80);
  if (!commit) return;
  var spot = document.elementFromPoint(x, y);
  var col = spot && spot.closest ? spot.closest('[data-r29-desk-col]') : null;
  if (col) r30Move(drag.id, col.getAttribute('data-r29-desk-col'));
}
function r30DragMove(event) {
  var drag = r30Drag;
  if (!drag || event.pointerId !== drag.pointer) return;
  var dx = event.clientX - drag.x;
  var dy = event.clientY - drag.y;
  if (!drag.active) {
    if (dx * dx + dy * dy < 36) return;
    drag.active = true;
    var box = drag.card.getBoundingClientRect();
    var ghost = drag.card.cloneNode(true);
    ghost.removeAttribute('data-r29-desk-id');
    ghost.removeAttribute('data-r30-card');
    ghost.classList.add('r30-ghost');
    ghost.style.width = box.width + 'px';
    drag.offX = drag.x - box.left;
    drag.offY = drag.y - box.top;
    document.body.appendChild(ghost);
    drag.ghost = ghost;
    drag.card.classList.add('is-dragging');
    document.body.classList.add('r30-dragging');
  }
  event.preventDefault();
  drag.ghost.style.transform = 'translate(' + (event.clientX - drag.offX) + 'px,' +
    (event.clientY - drag.offY) + 'px)';
  var spot = document.elementFromPoint(event.clientX, event.clientY);
  var over = spot && spot.closest ? spot.closest('[data-r29-desk-col]') : null;
  Array.prototype.forEach.call(document.querySelectorAll('.r29-desk-col.is-over'), function (el) {
    if (el !== over) el.classList.remove('is-over');
  });
  if (over) over.classList.add('is-over');
}
function r30DragUp(event) {
  if (r30Drag && event.pointerId === r30Drag.pointer) r30DragEnd(true, event.clientX, event.clientY);
}
function r30DragCancel(event) {
  if (r30Drag && event.pointerId === r30Drag.pointer) r30DragEnd(false, 0, 0);
}
function r30DragKey(event) {
  if (event.key === 'Escape' && r30Drag) { event.stopPropagation(); r30DragEnd(false, 0, 0); }
}
function r30OnDown(event) {
  if (event.pointerType === 'touch' || event.button !== 0 || r30Drag) return;
  var card = event.target && event.target.closest ? event.target.closest('.r29-desk .r30-card') : null;
  if (!card || event.target.closest('[data-r30-assign],[data-r30-menu],[data-r30-form]')) return;
  r30Drag = {id: card.getAttribute('data-r30-card'), card: card, pointer: event.pointerId,
    x: event.clientX, y: event.clientY, active: false, ghost: null};
  document.addEventListener('pointermove', r30DragMove, true);
  document.addEventListener('pointerup', r30DragUp, true);
  document.addEventListener('pointercancel', r30DragCancel, true);
  document.addEventListener('keydown', r30DragKey, true);
}
if (!window.__r30Bound) {
  window.__r30Bound = true;
  document.addEventListener('click', r30OnClick);
  document.addEventListener('keydown', r30OnKey);
  document.addEventListener('pointerdown', r30OnDown);
  document.addEventListener('dragstart', function (event) {
    if (event.target && event.target.closest && event.target.closest('.r30-card')) event.preventDefault();
  });
}
/* 今天页点一件工单，直接打开看板上这张卡的操作单。卡还没读进来就等一等，最多等 3 秒。 */
window.R30Board = {
  open: function (id, tries) {
    if (r30Row(id)) { r30OpenSheet('full', id, {detail: true}); return true; }
    if ((tries || 0) < 12) setTimeout(function () { window.R30Board.open(id, (tries || 0) + 1); }, 250);
    return false;
  }
};
