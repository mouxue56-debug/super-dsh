
function boardCol(card){return state.boardPending[card.id]?.to||card.col;}
function boardOrder(card){return state.boardPending[card.id]?.order??card.order??state.cards.indexOf(card)*1024;}
function stageBoardMove(id,to,beforeId){
  var card=cardBy(id);if(!card||!colBy(to))return;
  var order;
  if(arguments.length>2){
    var list=state.cards.filter(c=>c.id!==id&&boardCol(c)===to).sort((a,b)=>boardOrder(a)-boardOrder(b));
    var at=beforeId?list.findIndex(c=>c.id===beforeId):list.length;if(at<0)at=list.length;
    var left=at?boardOrder(list[at-1]):null,right=at<list.length?boardOrder(list[at]):null;
    order=left===null?(right===null?0:right-1024):right===null?left+1024:(left+right)/2;
    var current=state.cards.filter(c=>boardCol(c)===to).sort((a,b)=>boardOrder(a)-boardOrder(b));
    if(to===boardCol(card)&&current.indexOf(card)===at)return;
  }
  if(to===card.col&&(order===undefined||order===(card.order??state.cards.indexOf(card)*1024)))delete state.boardPending[id];
  else state.boardPending[id]={from:card.col,to:to,...(order===undefined?{}:{order})};
  render();toast(Object.keys(state.boardPending).length?'移动尚未提交，点提交后才变更状态。':'已回到原列，没有待提交移动。','kanban');
}
function stewardBoardMessage(type,data){
  var bot=Hub.featureOwner('board');if(!bot)return false;
  Hub.featureRecord('board',{time:'刚刚',title:data.title,parts:[{type,data}]});
  if(type==='shell-board-change'){
    bot.unread++;PREV[bot.id]=data.title;
    Hub.postMessage(bot.id+'-013',{from:bot.id,time:'刚刚',parts:[{type,data}]});
  }else Hub.registerActivity({id:'board-move-'+(++boardNoticeSequence),kind:'inform',bot:bot.id,featureId:'board',title:data.title,detail:data.reason,conversation:bot.id+'-013'});
  toast(bot.name+'回复了','kanban');
  var el=document.getElementById('toast');el.classList.add('board-notification-toast');el.replaceChildren(Hub.h('button',{type:'button','data-board-notification':true,onClick:()=>{
    if(type==='shell-board-change')Hub.navigate({view:'chat',conversation:bot.id+'-013'});else Hub.openFeature('board');el.className='';el.replaceChildren();
  }},type==='shell-board-change'?bot.name+'回复了 · 查看 →':'看板记录已更新 · 查看 →'));positionToast();
}
var boardNoticeSequence=0;
function submitBoardMoves(){
  var moves=Object.entries(state.boardPending).map(([id,p])=>{var c=cardBy(id);return {id:id,title:c.title,from:p.from,to:p.to,bot:c.bot,order:p.order};});
  if(!moves.length)return;
  // Commit as one batch before sending any in-page receipts.
  moves.forEach(m=>{var c=cardBy(m.id);c.col=m.to;if(m.order!==undefined)c.order=m.order;c.time='刚刚';delete c.movedBy;});state.boardPending={};
  [...new Set(moves.map(m=>m.bot))].filter(id=>id!==Hub.featureOwner('board')?.id).forEach(id=>{
    var own=moves.filter(m=>m.bot===id);botBy(id).unread++;
    Hub.postMessage(id+'-013',{from:id,time:'刚刚',parts:[{type:'text',md:Hub.featureOwner('board').name+'已同步本页变更：'+own.map(m=>m.title+'（'+colBy(m.from).name+' → '+colBy(m.to).name+'）').join('；')+'。仅本地演示通知。'}]});
  });
  stewardBoardMessage('shell-board-change',{title:'看板变更已提交',moves:moves});
}
function simulateBoardMove(){
  // Never overwrite a pending human move. If every card is pending, ask for submission first.
  var card=state.cards.find(c=>!state.boardPending[c.id]);if(!card){toast('请先提交或撤销现有移动。','kanban');return;}
  var from=card.col,to=COLS[(COLS.findIndex(c=>c.id===from)+1)%COLS.length].id;
  var mover=state.bots.find(b=>b.id===card.bot);card.col=to;card.time='刚刚';card.movedBy=mover.name;card.movedByBot=mover.id;
  stewardBoardMessage('shell-board-notice',{title:mover.name+'移动了卡片',who:mover.name,reason:'演示：回执已整理，推进到下一阶段。',moves:[{id:card.id,title:card.title,from:from,to:to,bot:card.bot}]});
}
(function(){
  var H=Hub,h=H.h;
  ['shell-board-change','shell-board-notice'].forEach(type=>H.registerCard(type,{title:type==='shell-board-change'?'看板变更卡':'看板他人移动通知卡',quoteLabel:d=>d.title,render:function(d){
    return h('section',{class:'mcard board-receipt'},[
      h('p',{class:'eyebrow sticker bot'},type==='shell-board-change'?'提交回执 · 本页':'他人移动 · 本页通知'),h('h3',{},d.title),
      d.who?h('p',{},d.who+' · '+d.reason):null,
      h('ul',{},d.moves.map(m=>h('li',{},[h('strong',{},m.title),h('p',{},colBy(m.from).name+' → '+colBy(m.to).name),h('small',{class:'muted'},type==='shell-board-change'?'已通知 '+botBy(m.bot).name+'（本页会话）':'移动者 '+d.who)]))),
      h('p',{class:'mini-note'},'不连接外部服务，刷新后复原。')
    ]);
  }}));
  H.registerCard('shell-capability-status',{title:'能力状态卡',quoteLabel:d=>d.title,render:d=>h('section',{class:'mcard'},[
    h('p',{class:'eyebrow sticker bot'},'助理回复 · 离线演示'),h('h3',{},d.title),h('p',{},d.summary),
    h('div',{class:'capability-status'},(d.items||[]).slice(0,3).map(x=>h('span',{class:'badge'},x.label+' · '+x.value))),
    d.view?h('button',{class:'ghostbtn','data-hub-view':d.view},d.view==='ledger'?'打开账本':'打开看板'):null
  ])} );
  H.registerView('capabilities',{title:'能力',icon:'grid',render:H.capabilitiesView});
  // governance may replace this fallback once via registerView('ledger', ...).
  H.registerView('ledger',{title:'账本',icon:'usage',_shellPlaceholder:true,render:function(c){
    if(typeof r29Real==='function'&&r29Real()){
      c.innerHTML='<section class="content-scroll" data-r29-ledger-real="1">'+pageTitle('用量账本','')
        +'<p role="status">暂无</p></section>';
      return;
    }
    c.innerHTML='<section class="content-scroll">'+pageTitle('账本','额度，一眼就好')+'<p class="mini-note">离线示例 · 第一步入口；完整分摊图与逐单流水由第二步 governance 接入。</p><div class="surface">'+usageRows()+demoText("stewards.render.1")+H.featureOwner('ledger').id+'-013">问'+H.featureOwner('ledger').name+'</button></div></section>';
  }});
  // Minimal runnable registerCapability example. Business modules add their own cards in step two.
  H.registerCapability({id:'shell-board-progress',title:'看板进度',icon:'board',steward:'board-steward',group:'进度',oneLine:'拖完点提交，再由我同步变更。',
    status:()=>[{label:'待提交',value:Object.keys(state.boardPending).length,tone:'wait'},{label:'卡片',value:state.cards.length}],
    phrases:['看看未提交的移动','谁移动了看板','整理卡住的任务'],reply:phrase=>[{type:'shell-capability-status',data:{title:phrase,summary:phrase==='谁移动了看板'?(state.cards.some(c=>c.movedBy)?'本页模拟移动者：'+[...new Set(state.cards.filter(c=>c.movedBy).map(c=>c.movedBy))].join('、')+'。可到看板记录核对原因。':'本页尚无他人移动记录。'):phrase==='整理卡住的任务'?'先看看卡住的任务，再决定下一步。':'移动草稿还未改变正式状态。请到看板点提交。',items:[{label:'待提交',value:Object.keys(state.boardPending).length},{label:'卡住',value:state.cards.filter(c=>c.col==='stuck').length}],view:'kanban'}}]
  });
  [
    ['shell-board-flow','本周流量与卡住的卡','看看本周流量','哪几张卡卡住了','先整理一个解卡步骤','演示：本周流入 8 张、完成 5 张；卡住项来自本页样例。'],
    ['shell-board-audit','谁动过看板的记录','谁改过看板','看看最近一次移动','核对移动原因','演示：记录只包含本页的模拟移动与提交，未读取外部审计日志。'],
    ['shell-board-archive','自动归档规则','看看归档规则','完成多久再归档','先暂停自动归档','演示：拟定完成七天后再归档；尚未注册定时任务，也没有归档任何卡片。'],
    ['shell-board-wip','按项目的在办数上限','看看项目在办数','哪些项目快到上限','把上限草稿给我看','演示：每项目在办上限草稿为 3 张；尚未应用限制。']
  ].forEach(row=>H.registerCapability({id:row[0],title:row[1],icon:'board',steward:'board-steward',group:'看板',oneLine:row[5],
    status:()=>[{label:'状态',value:'离线演示'},{label:'卡住',value:state.cards.filter(c=>c.col==='stuck').length}],phrases:row.slice(2,5),reply:phrase=>[{type:'shell-capability-status',data:{title:phrase,summary:row[5],items:[{label:'范围',value:'仅本页'}],view:'kanban'}}]
  }));
  [
    ['shell-schedule-routine','定时与例行','schedule-steward','先把例行安排说清楚，再决定要不要启用。',['看看例行安排','今天哪些到时间了','暂停一条例行']],
    ['shell-connect-tools','通道与订阅工具','connect-steward','先核对工具与通道的连接边界。',['看看可用连接','哪些订阅待接入','核对插件权限']]
  ].forEach(row=>H.registerCapability({id:row[0],title:row[1],icon:row[2]==='schedule-steward'?'clock':'link',steward:row[2],group:'功能',oneLine:row[3],status:()=>[{label:'连接',value:'尚未接入',tone:'neutral'}],phrases:row[4],reply:phrase=>{
    if(row[0]==='shell-schedule-routine'&&phrase===row[4][1]){
      var plan=DECISION_SRC.find(d=>d.id==='d-publish');
      var items=plan.params.slice(0,3).map(item=>'- '+item+' · 待审批，未发送');
      return [{type:'text',md:'今天到点的事项（本页演示，按样张晚间排期）：\n'+items.join('\n')+'\n未连接服务或注册真实任务。'}];
    }
    return [{type:'text',md:'演示：'+phrase+'。当前只整理本页草稿，未连接服务或注册真实任务。'}];
  }}));
  function quickReplies(){
    var dock=document.querySelector('.composer-area');if(!dock)return;
    var existing=dock.querySelector('.hub-quick');
    var input=dock.querySelector('[data-focus="composer"]'),latest=H.currentMessages().at(-1);
    if(!latest||latest.from==='user'||input?.value.trim()||state.running){if(existing){existing.remove();H.measureDock();}return;}
    if(existing?.dataset.quickBot===state.bot)return;existing?.remove();
    var box=h('div',{class:'hub-quick','data-quick-bot':state.bot,'aria-label':'当前 bot 快捷回复'});
    H.quickReplies(botBy(state.bot)).forEach(phrase=>box.append(h('button',{type:'button',class:'ghostbtn','data-shell-quick':phrase,onClick:()=>{
      state.input=phrase;var el=document.querySelector('[data-focus="composer"]');if(el){el.value=phrase;el.dispatchEvent(new Event('input',{bubbles:true}));el.focus({preventScroll:true});el.setSelectionRange(el.value.length,el.value.length);}quickReplies();
    }},phrase)));
    dock.prepend(box);H.measureDock();
  }
  // Run after the unchanged interact module; this shell owns bot-specific suggestions.
  H.on('ready',()=>{H.on('render',quickReplies);H.on('message',quickReplies);H.on('interact:running',quickReplies);quickReplies();});
  document.addEventListener('input',e=>{if(e.target.dataset.focus==='composer')Promise.resolve().then(quickReplies);});
  document.addEventListener('click',e=>{var el=e.target.closest('[data-board-action]');if(!el)return;
    switch(el.dataset.boardAction){
      case 'submit':submitBoardMoves();break;
      case 'undo':state.boardPending={};render();toast('未提交的移动已撤销。','kanban');break;
      case 'simulate':simulateBoardMove();break;
      case 'ask':H.fillDraft(H.featureOwner('board').id,'');break;
    }
  });
})();
/* 真模式只改眼前看得见的字。演示模式原样，源文件留给各路自己的检查。 */
(function () {
  var PAIRS = [
    ['原创 SVG 占位', ''],
    ['原创 SVG', ''],
    ['SVG', ''],
    ['冲突隔离 · 不进入上下文', '说法有冲突，先不拿来用'],
    ['已过期 · 不进入上下文', '过期了，不再拿来用'],
    ['未提供召回记录、匹配理由或上下文注入凭证。',
      '没有记录说明它为什么想起这条。'],
    ['没有接入真实召回日志。', '没有真的记录它用过哪条。'],
    ['系统段受保护；记忆卸载以壳的挂载列表为准',
      '基础设定不能动；卸下记忆以这一页带上的为准'],
    ['仅 content 与获准助理可按白名单读取', '只有负责助理和你允许的助理能看'],
    ['计划模式 · 先对齐再执行', '先定好计划再动手'],
    ['私有 + 共享白名单', '只自己用，加上你允许共享的'],
    ['新建与分叉均保存在当前页内存', '新开的和另开的只留在这个页面，刷新就没了'],
    ['密钥、令牌、Cookie、口令', '密码和各种登录信息'],
    ['电脑操作 CUA', '代你操作电脑'],
    ['不调用外部 CLI', '不叫外部程序'],
    ['脱敏诊断包', '去掉隐私后的检查报告'],
    ['正本与唯一写者', '谁来改这份文件'],
    ['结构化回执', '一份说清结果的单子'],
    ['本轮临时授权', '这次先允许它动手'],
    ['默认生图通路', '默认出图方式'],
    ['上下文压缩', '记下的东西先收一收'],
    ['按需记忆与上下文', '要用时才带上的记忆'],
    ['挂载与来源', '已经带上的记忆和出处'],
    ['当前记忆切片', '现在带了哪几条'],
    ['工作区与项目', '常用文件夹与项目'],
    ['工作区与会话', '常用文件夹与会话'],
    ['工作区 / 项目分组', '按项目分组'],
    ['工作区文件', '文件夹里的文件'],
    ['分叉这段会话', '从这里另开一条'],
    ['知识库只读', '资料库只能看不能改'],
    ['大脑与可派工人', '用哪个模型，能叫谁帮忙'],
    ['没有真实进程', '没有真的在运行什么'],
    ['缓存命中率', '省下的重复读取'],
    ['可编辑参数', '可以改的内容'],
    ['参数快照', '当时的设置'],
    ['参数摘要', '要做的事'],
    ['会话日志', '这次对话的记录'],
    ['审计日志', '谁批过什么'],
    ['审批日志', '审批记录'],
    ['召回日志', '用过哪条的记录'],
    ['召回记录', '用过哪条的记录'],
    ['待重启原因', '需要重启吗'],
    ['后台与子任务', '正在后台做的事'],
    ['执行轨迹', '做过什么'],
    ['执行过程', '它做了哪些事'],
    ['本地命令', '在你电脑上执行操作'],
    ['临时授权', '这次允许'],
    ['待你拍板', '等你点头'],
    ['播放引擎', '播放功能'],
    ['未加载引擎', ''],
    ['权限级别', '能做什么'],
    ['操控档位', '操作权限'],
    ['推理强度', '思考深度'],
    ['复制 ID', '复制编号'],
    ['插件管理', '扩展功能'],
    ['可派工人', '能叫来帮忙的'],
    ['左路工人', '左边这位'],
    ['子智能体', '别的助理'],
    ['子代理树', '谁交给谁'],
    ['当前页内存', '这个页面里'],
    ['分叉会话', '从这里另开一条'],
    ['按需上下文', '现在记住的东西'],
    ['不进入上下文', '不再拿来用'],
    ['查看上下文', '看它记住了多少'],
    ['查看占用', '看它记住了多少'],
    ['定时与工作流', '定时安排'],
    ['本页流式回复', '这条回复'],
    ['语音听写', '用说的'],
    ['遮蔽输入', '输入时不显示'],
    ['一键回滚', '一键恢复'],
    ['SSH 终端', '远程命令行'],
    ['监听端口', '哪些服务开着'],
    ['缓存读取', '重复读取'],
    ['任务队列', '排着的任务'],
    ['契约测试', '检查旧功能还对不对'],
    ['唯一写者', '谁来改'],
    ['记忆切片', '记忆'],
    ['创建分叉', '另开一条'],
    ['官方 IM', '官方聊天软件'],
    ['本页内存', '这个页面里'],
    ['未写许可', ''],
    ['原创占位', ''],
    ['本页演示', ''],
    ['离线演示', ''],
    ['仅当前页演示', ''],
    ['当前页演示', ''],
    ['未真实执行', '没有真的做'],
    ['等待人工验收', '等你看过'],
    ['尚未验收', '还没看过'],
    ['子代理', '叫来帮忙的助理'],
    ['路由指针', '指到资料的线索'],
    ['冲突隔离', '说法有冲突'],
    ['兼容闸门', '旧功能检查'],
    ['白名单', '允许清单'],
    ['工作区', '常用的文件夹'],
    ['上下文', '它记住了多少'],
    ['子任务', '分出去的事'],
    ['页内存', '这个页面里'],
    ['登录态', '有没有登录'],
    ['执行者', '谁在做'],
    ['执行端', '你自己的电脑'],
    ['已验收', '你看过了'],
    ['待验收', '等你看过'],
    ['可重试', '可以再来一次'],
    ['工具箱', '能用的功能'],
    ['计划模式', '先定好计划'],
    ['挂载', '带上'],
    ['切片', '一段'],
    ['插件', '扩展'],
    ['音素', '口型'],
    ['回滚', '恢复'],
    ['参数', '设置'],
    ['双工', '可以连着来回'],
    ['日志', '记录'],
    ['通路', '方式'],
    ['进程', '程序'],
    ['端口', '入口'],
    ['写盘', '存成文件'],
    ['缓存', '存着的'],
    ['阈值', '界线'],
    ['降级', '换便宜的'],
    ['轮询', '定时查看'],
    ['队列', '排着的'],
    ['正本', '这份文件'],
    ['回执', '结果'],
    ['工作流', '一整条流程'],
    ['脱敏', '去掉隐私'],
    ['配额', '额度'],
    ['分叉', '另开一条'],
    ['分支', '另一条路'],
    ['流式', '边出边显示'],
    ['听写', '用说的'],
    ['引擎', ''],
    ['密钥', '密码'],
    ['令牌', '登录信息'],
    ['口令', '密码'],
    ['凭据', '登录信息'],
    ['目录', '文件夹'],
    ['大脑', '用的模型'],
    ['工人', '能帮忙的'],
    ['对齐', '说定'],
    ['档位', '松紧'],
    ['遮蔽', '不显示'],
    ['召回', '想起'],
    ['闸门', '检查关口'],
    ['脚本', '固定步骤'],
    ['插话', '不等它说完'],
    ['重试', '再来一次'],
    ['验收', '看过确认'],
    ['演示', ''],
    ['占位', ''],
    ['许可：', ''],
    ['许可:', ''],
    ['正在穿', '']
  ];
  PAIRS.sort(function (a, b) { return b[0].length - a[0].length; });
  var WORD = [
    [/token\/s/gi, '每秒用量'],
    [/\btokens\b/gi, '用量'],
    [/\btoken\b/gi, '用量'],
    [/\bLive2D\b/g, ''],
    [/\blive2d\b/g, ''],
    [/\bVRM\b/g, ''],
    [/\bvrm\b/g, ''],
    [/\bCUA\b/g, ''],
    [/\bCLI\b/g, ''],
    [/\bSSH\b/g, ''],
    [/\bShell\b/g, ''],
    [/\bshell\b/g, ''],
    [/\bHMR\b/g, ''],
    [/\basar\b/gi, '打包文件'],
    [/\bCSV\b/g, '表格'],
    [/\bMCP\b/g, '外部扩展'],
    [/\bskills\b/gi, '小功能'],
    [/\bskill\b/gi, '小功能'],
    [/\bskip\b/gi, '跳过'],
    [/\bCookie\b/gi, '登录信息'],
    [/\bcontent\b/gi, '正文'],
    [/\bID\b/g, '编号'],
    [/\bbot\b/gi, '助理'],
    [/\bexit code\b/gi, '结束状态'],
    [/\bsandbox\b/gi, '隔离试跑区'],
    [/\bcwd\b/g, '所在文件夹'],
    [/\bL0\b/g, '只看不动'],
    [/\bL1\b/g, '记一笔就行'],
    [/\bL2\b/g, '先做完再告诉你'],
    [/\bL3\b/g, '先问你'],
    [/\bL4\b/g, '不能做']
  ];

  function isReal() {
    try { return typeof r29Real === 'function' && r29Real(); }
    catch (err) { return false; }
  }
  function polish(text) {
    var next = String(text);
    var held = [];
    /* 看板第三列的系统说法是「等验收」。先整段遮住，免得较短的「验收」把它改成「等看过确认」。用户写的内容另有遮罩。 */
    next = next.replace(/等验收/g, function () {
      var mark = '\uE010' + held.length + '\uE011';
      held.push('等验收');
      return mark;
    });
    var i;
    for (i = 0; i < PAIRS.length; i++) {
      if (next.indexOf(PAIRS[i][0]) !== -1) next = next.split(PAIRS[i][0]).join(PAIRS[i][1]);
    }
    next = next.replace(/\/demo(?:\/[A-Za-z0-9._~-]*)*/g, '常用的文件夹');
    for (i = 0; i < WORD.length; i++) next = next.replace(WORD[i][0], WORD[i][1]);
    next = next.replace(/\b(\d+(?:\.\d+)?)k\b/g, function (_, num) {
      var value = Number(num);
      if (value >= 10) {
        var wan = Math.round((value / 10) * 10) / 10;
        return '约 ' + wan + ' 万';
      }
      return '约 ' + num + ' 千';
    });
    next = next.replace(/（\s*）/g, '').replace(/\(\s*\)/g, '');
    next = next.replace(/(?:\s*·\s*){2,}/g, ' · ');
    next = next.replace(/[ \t]{2,}/g, ' ');
    if (held.length) next = next.replace(/\uE010(\d+)\uE011/g, function (_, n) { return held[Number(n)] || '等验收'; });
    return next;
  }
  /* 词表只该改系统自己的状态词和固定文案，不改用户输入的内容（群名、卡片标题和说明、
     会话标题、助理名字和职责）。做法：从界面往后端发的、后端回来的 JSON 里，把这些「用户写的字段」
     里含词表词的字符串登记下来；说人话时先把登记过的整句遮住，改完再放回去，所以不论它渲染在哪一处都不会被换。
     登记只在内存里，不落盘，上限 400 条；只登记含词表词的串，数量很少。 */
  var USER_KEYS = /^(title|name|duty|sub|summary|description|desc|detail|role|preview|text|body|label|groupName|sessionTitle|displayName)$/;
  var USER_TEXT = [];
  var USER_SET = Object.create(null);
  var VOCAB_KEYS = PAIRS.map(function (pair) { return pair[0]; });
  function hasVocab(str) {
    for (var i = 0; i < VOCAB_KEYS.length; i++) if (str.indexOf(VOCAB_KEYS[i]) !== -1) return true;
    return false;
  }
  function rememberUserText(str) {
    if (typeof str !== 'string') return;
    var value = str.trim();
    if (value.length < 2 || value.length > 400 || USER_SET[value] || !hasVocab(value)) return;
    USER_SET[value] = true;
    USER_TEXT.push(value);
    if (USER_TEXT.length > 400) { delete USER_SET[USER_TEXT.shift()]; }
    USER_TEXT.sort(function (a, b) { return b.length - a.length; });
  }
  function harvest(value, depth) {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) { for (var i = 0; i < value.length && i < 500; i++) harvest(value[i], depth + 1); return; }
    if (typeof value !== 'object') return;
    Object.keys(value).forEach(function (key) {
      var item = value[key];
      if (typeof item === 'string') { if (USER_KEYS.test(key)) rememberUserText(item); }
      else harvest(item, depth + 1);
    });
  }
  function harvestJSON(raw) {
    if (typeof raw !== 'string' || raw.length > 3000000 || (raw.charAt(0) !== '{' && raw.charAt(0) !== '[')) return;
    try { harvest(JSON.parse(raw), 0); } catch (err) { /* 不是 JSON 就算了 */ }
  }
  function watchFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__r32UserText) return;
    var raw = window.fetch;
    var wrapped = function (input, init) {
      var url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (err) { url = ''; }
      var mine = /^\/(bff|hub)\//.test(url) || /^\/bff\b/.test(url);
      if (mine && init && typeof init.body === 'string') harvestJSON(init.body);
      var promise = raw.apply(this, arguments);
      if (mine && promise && typeof promise.then === 'function') {
        promise.then(function (res) {
          try {
            var type = res && res.headers && res.headers.get && res.headers.get('content-type') || '';
            if (res && res.ok && /json/i.test(type) && typeof res.clone === 'function') {
              res.clone().text().then(harvestJSON, function () {});
            }
          } catch (err) { /* 登记失败不影响页面 */ }
        }, function () {});
      }
      return promise;
    };
    wrapped.__r32UserText = true;
    try { window.fetch = wrapped; } catch (err) { /* 只读就跳过 */ }
  }
  watchFetch();
  window.r32UserText = { remember: rememberUserText, list: function () { return USER_TEXT.slice(); } };
  function mask(text, slots) {
    var next = text;
    for (var i = 0; i < USER_TEXT.length; i++) {
      if (next.indexOf(USER_TEXT[i]) === -1) continue;
      var mark = '\uE000' + slots.length + '\uE001';
      slots.push(USER_TEXT[i]);
      next = next.split(USER_TEXT[i]).join(mark);
    }
    return next;
  }
  function apply(text) {
    var next = String(text);
    var slots = [];
    if (USER_TEXT.length && isReal()) next = mask(next, slots);
    var round;
    for (round = 0; round < 4; round++) {
      var done = polish(next);
      if (done === next) break;
      next = done;
    }
    if (slots.length) next = next.replace(/\uE000(\d+)\uE001/g, function (_, n) { return slots[Number(n)] || ''; });
    return next;
  }
  function skipEl(el) {
    if (!el) return true;
    if (el.nodeType !== 1) el = el.parentElement;
    if (!el) return true;
    var cur = el;
    while (cur && cur.nodeType === 1) {
      var tag = cur.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return true;
      if (cur.getAttribute && cur.getAttribute('data-focus') === 'composer') return true;
      cur = cur.parentElement;
    }
    if (window.HubReal && el.closest) {
      var zone = '.thread,.home-recent-list,.pinned,.hub-real-empty,[data-r29-opening],[data-hub-real]';
      if (el.closest(zone)) return true;
    }
    return false;
  }
  /* 说人话的词表只改「看」的字。输入框、编辑框里是用户自己的原文，不碰，
     否则保存时会把库里的字悄悄改掉（例如「验收」被写成「看过确认」）。 */
  function inEditor(node) {
    var cur = node && node.nodeType !== 1 ? node.parentElement : node;
    while (cur && cur.nodeType === 1) {
      var tag = cur.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
      if (cur.isContentEditable === true || (cur.getAttribute && cur.getAttribute('contenteditable') === 'true')) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  function scrub() {
    if (!isReal() || !document.body || typeof document.createTreeWalker !== 'function') return;
    var show = (window.NodeFilter && NodeFilter.SHOW_TEXT) || 4;
    var walker = document.createTreeWalker(document.body, show);
    var nodes = [];
    var node = walker.nextNode();
    while (node) { nodes.push(node); node = walker.nextNode(); }
    nodes.forEach(function (item) {
      if (skipEl(item) || inEditor(item)) return;
      var next = apply(item.textContent || '');
      if (next !== item.textContent) item.textContent = next;
    });
    if (typeof document.querySelectorAll !== 'function') return;
    document.querySelectorAll('[aria-label],[title],[alt],[placeholder]').forEach(function (el) {
      if (skipEl(el)) return;
      ['aria-label', 'title', 'alt', 'placeholder'].forEach(function (name) {
        var raw = el.getAttribute(name);
        if (raw == null) return;
        var next = apply(raw);
        if (next !== raw) el.setAttribute(name, next);
      });
    });
  }
  window.r29PlainTalk = scrub;
  if (window.Hub && Hub.on) {
    Hub.on('render', scrub);
    Hub.on('ready', scrub);
  }
  if (document.body && typeof MutationObserver === 'function') {
    var queued = false;
    var watch = new MutationObserver(function () {
      if (queued || !isReal()) return;
      queued = true;
      setTimeout(function () { queued = false; scrub(); }, 40);
    });
    try {
      watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    } catch (err) { /* 没有可观察的文档时直接跳过 */ }
  }
})();

