var LEVELS=demoFixture("core.LEVELS.1");
var EMOTIONS=['开心','思考','抱歉','惊讶','挥手'];
/* V2 shell logic and public Hub API. Classic script; optional local pet media. */
var state = {
  project: demoText("core.project.2"),
  bot: BOT_SRC.find(b=>b.role==='chief').id,
  mode: 'kanban',
  emotion: '开心',
  system: demoText("core.system.3"),
  boardScope: 'all',
  taskId: 'task-kanban',
  drawer: null,
  cardId: null,
  boardPending: {},
  previewId: 'receipt',
  botPickOpen: false,
  input: '',
  toast: '',
  refocus: null,
  openTools: { 'task-kanban:2': true },
  fixedTasks: FIXED_TASK_SRC.map(t=>({...t})),
  bots: BOT_SRC.map(function (b) { return Object.assign({}, b); }),
  decisions: DECISION_SRC.map(function (d) { return Object.assign({}, d); }),
  cards: CARD_SRC.map(function (c) { return Object.assign({}, c); }),
  threads: Object.fromEntries(Object.entries(THREAD_SRC).map(function (pair) {
    return [pair[0], pair[1].map(function (m) { return Object.assign({}, m); })];
  }))
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function botBy(id) { return state.bots.find(function (b) { return b.id === id; }); }
function homeEntry(id){return state.fixedTasks.find(t=>t.taskId===id)||botBy(id);}
function featureKey(id){return FEATURE_ALIASES[id]||LEGACY_FEATURE_IDS[id]||id;}
function assistantId(id){
  var task=state.fixedTasks.find(t=>t.taskId===id);if(task)return task.ownerAssistantId;
  var key=LEGACY_FEATURE_IDS[id];if(key){var list=state.bots.filter(b=>b.owns?.includes(key));return list.length===1?list[0].id:null;}
  return id;
}
function legacyConversation(id){
  if(typeof id!=='string')return id;
  var source=Object.keys(LEGACY_FEATURE_IDS).find(old=>id===old+'-013');
  return source?assistantId(source)+'-013':id;
}
// 临时文案兼容：模块完成迁移后按回执移走本段。
function featureWording(text){
  text=String(text).split('七位管家').join('七个功能页');STEWARD_SRC.forEach(row=>{
    var key=LEGACY_FEATURE_IDS[row[0]],person=botBy(assistantId(row[0])),page=FEATURE_PAGES.find(p=>p.id===key);
    text=text.split('问'+row[1]).join('问'+(person?.name||'负责助理')).split(row[1]).join(page.title);
  });SUB_BOT_SRC.forEach(row=>{var task=state.fixedTasks.find(t=>t.taskId===row[0]);if(task)text=text.split(row[2]).join((botBy(task.ownerAssistantId)?.name||'负责助理')+' · '+task.taskName);});return text.split('管家').join('负责助理').split('常驻分 bot').join('固定任务').split('分 bot').join('固定任务');
}
function projBy(id) { return PROJECTS.find(function (p) { return p.id === id; }); }
function decBy(id) { return state.decisions.find(function (d) { return d.id === id; }); }
function cardBy(id) { return state.cards.find(function (c) { return c.id === id; }); }
function taskBy(id) { return TASKS.find(function (t) { return t.id === id; }); }
function colBy(id) { return COLS.find(function (c) { return c.id === id; }); }
function openCount() {
  return state.decisions.filter(function (d) { return d.status === 'pending' || d.status === 'edit'; }).length;
}
function isClosed(d) { return d && (d.status === 'approved' || d.status === 'rejected' || d.status === 'superseded'); }

function faceParts(emotion) {
  var look = emotion === '思考' ? -3 : 0;
  if (emotion === '抱歉') {
    return demoText("core.sample.4") +
      demoText("core.sample.5") +
      demoText("core.sample.6") +
      demoText("core.sample.7") +
      demoText("core.sample.8") +
      '<ellipse cx="0" cy="16" rx="2.2" ry="1.4" fill="#e0b09a"/>';
  }
  var mouth = emotion === '思考'
    ? demoText("core.mouth.9")
    : demoText("core.mouth.10");
  var brows = emotion === '思考'
    ? demoText("core.brows.11") +
      demoText("core.brows.12")
    : demoText("core.brows.13") +
      demoText("core.brows.14");
  var blush = emotion === '开心'
    ? '<ellipse cx="-42" cy="16" rx="8" ry="4" fill="#e7b0a0" opacity="0.35"/><ellipse cx="42" cy="16" rx="8" ry="4" fill="#e7b0a0" opacity="0.35"/>'
    : '';
  return brows +
    '<ellipse cx="' + (-22 + look) + '" cy="2" rx="6.2" ry="7.2" fill="#3a3128"/>' +
    '<ellipse cx="' + (22 + look) + '" cy="2" rx="6.2" ry="7.2" fill="#3a3128"/>' +
    '<ellipse cx="' + (-20 + look) + '" cy="0" rx="1.7" ry="1.7" fill="#fffaf3"/>' +
    '<ellipse cx="' + (24 + look) + '" cy="0" rx="1.7" ry="1.7" fill="#fffaf3"/>' +
    '<g class="blink">' +
      demoText("core.sample.15") +
      demoText("core.sample.16") +
      demoText("core.sample.17") +
      demoText("core.sample.18") +
    '</g>' + mouth + '<ellipse cx="0" cy="16" rx="2.2" ry="1.4" fill="#e0b09a"/>' + blush;
}
function ears() {
  return '<path d="M-48 -16 Q-44 -88 -16 -30 Q-36 -18 -48 -16Z" fill="#7a5340"/>' +
    '<path d="M-42 -26 Q-38 -70 -24 -34 Q-36 -26 -42 -26Z" fill="#efc8b4"/>' +
    '<path d="M16 -30 Q44 -90 50 -16 Q34 -18 16 -30Z" fill="#7a5340"/>' +
    '<path d="M24 -34 Q38 -72 42 -24 Q32 -28 24 -34Z" fill="#efc8b4"/>';
}
function hairSoft() {
  return '<path d="M-60 -6 C-56 -66 56 -66 60 -6 C42 -40 18 -50 0 -50 C-22 -50 -44 -36 -60 -6Z" fill="#6b4530"/>' +
    '<path d="M-58 0 C-72 36 -60 74 -38 80 C-50 40 -46 18 -50 0Z" fill="#6b4530"/>' +
    '<path d="M58 0 C72 36 60 74 38 80 C50 40 46 18 50 0Z" fill="#6b4530"/>' +
    '<path d="M-42 -18 C-18 -2 18 -2 42 -18 C22 -36 -22 -36 -42 -18Z" fill="#5c3b28"/>';
}
function hairGeo() {
  return '<polygon points="-54,-8 -28,-72 28,-72 54,-8 22,-36 -22,-36" fill="#6b4530"/>' +
    '<polygon points="-16,-48 0,-84 20,-46 0,-32" fill="#8d6844"/>' +
    '<path d="M-54 4 C-66 40 -54 78 -36 82 C-48 42 -44 16 -46 4Z" fill="#5c3b28"/>' +
    '<path d="M54 4 C66 40 54 78 36 82 C48 42 44 16 46 4Z" fill="#5c3b28"/>';
}
function headGroup(emotion, geo) {
  return '<ellipse cx="0" cy="0" rx="62" ry="70" fill="#f0d0b8"/>' +
    (geo ? hairGeo() : hairSoft()) + ears() + faceParts(emotion);
}
function characterSVG(system, emotion) {
  var label = system === demoText("core.label.19") ? demoText("core.label.20") : demoText("core.label.21");
  if (system === demoText("core.sample.22")) {
    return '<svg class="mascot" viewBox="0 0 300 520" width="300" height="520" role="img" aria-label="' + label + '">' +
      '<ellipse cx="150" cy="250" rx="120" ry="150" fill="#e7ecf2" opacity="0.55"/>' +
      '<ellipse cx="150" cy="448" rx="86" ry="16" fill="#e4d5c2"/>' +
      '<ellipse cx="150" cy="440" rx="86" ry="16" fill="#c4a27a"/>' +
      '<g>' +
        demoText("core.sample.23") +
        '<circle cx="74" cy="274" r="9" fill="#f0d0b8"/>' +
        demoText("core.sample.24") +
        '<circle cx="226" cy="274" r="9" fill="#f0d0b8"/>' +
        '<rect x="116" y="176" width="68" height="118" rx="18" fill="#8a6240"/>' +
        '<path d="M140 176 H160 V294 H140Z" fill="#f4efe4"/>' +
        '<circle cx="150" cy="214" r="3" fill="#5c4030"/>' +
        '<circle cx="150" cy="236" r="3" fill="#5c4030"/>' +
        '<rect x="122" y="286" width="24" height="130" rx="10" fill="#5c4030"/>' +
        '<rect x="154" y="286" width="24" height="130" rx="10" fill="#5c4030"/>' +
        '<ellipse cx="134" cy="420" rx="18" ry="8" fill="#342c25"/>' +
        '<ellipse cx="166" cy="420" rx="18" ry="8" fill="#342c25"/>' +
        '<rect x="136" y="158" width="28" height="26" rx="8" fill="#f0d0b8"/>' +
        '<g transform="translate(150 108) scale(0.78)">' + headGroup(emotion, true) + '</g>' +
      '</g></svg>';
  }
  return '<svg class="mascot" viewBox="0 0 300 520" width="300" height="520" role="img" aria-label="' + label + '">' +
    '<ellipse cx="150" cy="240" rx="128" ry="160" fill="#dce8d6"/>' +
    '<ellipse cx="206" cy="150" rx="64" ry="42" fill="#f6e3d4" opacity="0.75"/>' +
    '<rect x="26" y="456" width="248" height="42" rx="12" fill="#c4a27a"/>' +
    '<rect x="26" y="456" width="248" height="12" rx="8" fill="#e4c9a6"/>' +
    '<rect x="248" y="428" width="16" height="26" rx="4" fill="#fffaf4"/>' +
    demoText("core.sample.25") +
    '<g>' +
      demoText("core.sample.26") +
      '<circle cx="96" cy="442" r="11" fill="#f0d0b8"/>' +
      demoText("core.sample.27") +
      '<circle cx="232" cy="444" r="11" fill="#f0d0b8"/>' +
      '<path d="M98 270 C92 360 100 456 126 468 L174 468 C202 456 212 360 204 270 C194 236 110 236 98 270Z" fill="#f7f3ea"/>' +
      '<path d="M114 278 C112 360 120 448 134 462 L166 462 C182 448 190 360 188 278 C178 254 124 254 114 278Z" fill="#6f8d67"/>' +
      '<circle cx="150" cy="332" r="3.2" fill="#8a6240"/>' +
      '<circle cx="150" cy="358" r="3.2" fill="#8a6240"/>' +
      '<rect x="138" y="236" width="24" height="34" rx="8" fill="#f0d0b8"/>' +
      '<g transform="translate(72 404)">' +
        '<rect width="38" height="48" rx="3" fill="#5f7d55"/>' +
        '<rect x="4" y="4" width="30" height="40" fill="#fffaf4"/>' +
        '<path d="M9 14 H28 M9 20 H28 M9 26 H22" stroke="#c6b298" stroke-width="1.4"/>' +
      '</g>' +
      '<g transform="translate(150 198)">' + headGroup(emotion, false) + '</g>' +
    '</g></svg>';
}
function resultText(d) {
  if (d.status === 'superseded') return '已被新稿替代 · 不能再批准';
  if (d.status === 'edit') return '你要改一改。意见在输入框里，这张还开着。';
  if (d.status === 'approved' && d.kind === '草稿') return '已批准发送。样张没有真正发出。';
  if (d.status === 'approved' && d.kind === '转派') return demoText("core.sample.28");
  if (d.status === 'approved') return '已批准。样张没有真正执行。';
  if (d.status === 'rejected' && d.kind === '草稿') return '已选择不发。';
  if (d.status === 'rejected' && d.kind === '转派') return demoText("core.sample.29");
  if (d.status === 'rejected') return '已拒绝，不会执行。';
  return '';
}
function actionButtons(d) {
  if (isClosed(d) && d.status !== 'superseded') return '<p class="result">' + esc(resultText(d)) + '</p>';
  var note = d.status === 'edit' || d.status === 'superseded' ? '<p class="result">' + esc(resultText(d)) + '</p>' : '';
  var buttons;
  if (d.kind === '草稿') {
    buttons = '<button type="button" class="primary" data-act="decide" data-id="' + d.id + '" data-op="approve">批准发送</button>' +
      '<button type="button" class="ghostbtn" data-act="decide" data-id="' + d.id + '" data-op="reject">不发</button>' +
      '<button type="button" class="textbutton" data-act="decide" data-id="' + d.id + '" data-op="edit">改一下</button>';
  } else if (d.kind === '转派') {
    buttons = '<button type="button" class="primary" data-act="decide" data-id="' + d.id + '" data-op="approve">确认转派</button>' +
      '<button type="button" class="ghostbtn" data-act="decide" data-id="' + d.id + '" data-op="reject">先收回</button>';
  } else {
    buttons = '<button type="button" class="primary" data-act="decide" data-id="' + d.id + '" data-op="approve">批准</button>' +
      '<button type="button" class="ghostbtn" data-act="decide" data-id="' + d.id + '" data-op="reject">拒绝</button>';
  }
  if(d.kind!=='草稿')buttons+='<button type="button" class="textbutton" data-act="decide" data-id="'+d.id+'" data-op="edit">改一下</button>';
  if (d.status === 'superseded') {
    buttons = buttons.replaceAll('type="button"', 'type="button" disabled');
    if (d.supersededNote) note += '<p class="muted">' + esc(d.supersededNote) + '</p>';
  }
  return note + '<div class="actions">' + buttons + '</div>';
}
function builtinCardHTML(card) {
  if (!card) return '';
  if (card.type === 'file') {
    var f = FILES[card.file];
    var kind=/\.(png|jpe?g|webp|svg)$/i.test(f.name)?'image':/\.(mp4|mov|webm)$/i.test(f.name)?'video':'document';
    return '<section class="mcard r22-file" data-file-kind="'+kind+'"><div class="r22-app" style="--a:#5C82D2;background-color:#5C82D2;color:#FFFFFF">'+r22Icon(kind==='document'?'file':kind==='image'?'image':'play')+'</div><div class="r22-file-text"><h3>'+esc(f.name)+'</h3><p class="muted">交付物 · '+esc(botBy(f.ownerBot)?.name||'助理')+' · '+esc(f.size)+demoText("core.sample.30")+esc(card.file)+'">预览</button></section>';
  }
  var d = decBy(card.id);
  if (!d) return '';
  if (card.type === 'handoff') {
    return '<section class="mcard r22-letter">'+r29ConfirmLead(d.bot,'转派')+'<h3>' + esc(d.title) + '</h3>' +
      '<p class="route">' + esc((botBy(d.from)||{}).name||'助理') + ' → ' + esc((botBy(d.to)||{}).name||'助理') + '</p>' +
      '<p>' + esc(d.summary) + '</p>' + actionButtons(d) + '</section>';
  }
  if (card.type === 'draft') {
    return '<section class="mcard r22-letter">'+r29ConfirmLead(d.bot,'审批')+'<h3>' + esc(d.title) + '</h3>' +
      '<p class="label">对客日文</p><div class="jp" lang="ja">' + esc(d.jp) + '</div>' +
      demoText("core.sample.31") + esc(d.zh) + '</div>' +
      (d.checks?.length?'<p class="label">关键信息 · 独立核对</p><table class="shell-draft-checks"><tbody>'+d.checks.map(c=>'<tr><th scope="row">'+esc(c.label)+'</th><td>'+esc(c.value)+'</td></tr>').join('')+'</tbody></table>':'')+
      actionButtons(d) + '</section>';
  }
  var items = (d.params || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
  return '<section class="mcard r22-letter">'+r29ConfirmLead(d.bot,'审批')+'<h3>' + esc(d.title) + '</h3>' +
    '<dl class="params"><dt>级别</dt><dd>' + esc(d.level) + ' · 发送、发布、改配置要先批</dd>' +
    '<dt>动作</dt><dd>' + esc(d.action) + '</dd>' +
    '<dt>参数摘要</dt><dd><ul>' + items + '</ul></dd></dl>' +
    actionButtons(d) + '</section>';
}
function diffHTML() {
  return '<pre class="diff">' + DIFF.map(function (l) {
    var cls = l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx';
    return '<span class="' + cls + '">' + esc(l.t + ' ' + l.s) + '</span>';
  }).join('') + '</pre>';
}
Object.assign(state,demoFixture("core.sample.32"));
state.bots.filter(b=>b.steward||b.parent).forEach(b=>{state.sessionNames[b.id]=b.name+' · 今日';});
// Shared avatar slot: local/data images override the Gelato SVG without changing layout.
function localAvatarSource(src){
  if(typeof src!=='string')return '';
  if(/^data:image\/(?:png|gif|jpe?g|webp|avif|svg\+xml)[;,]/i.test(src)||/^blob:/.test(src))return src;
  return src&&!/[\\:\x00-\x20]/.test(src)&&!src.startsWith('//')?src:'';
}
/* R21 P1：Blob 缓存、独立播放 URL、单层覆盖淡入和全局闲置指挥。 */

function createChiefPet(){
    /* R25-MOTION-HOOK */
    var innerWidth={valueOf:()=>window.HubPetMotion?.viewportWidth()??window.innerWidth};
    window.HubPetMotion?.watchWidth(()=>sync());
    /* R25-MOTION-HOOK */
  var r22StageAlphaBounds=demoFixture("core.r22StageAlphaBounds.33");
  // 第四期：闲置首帧 alpha≥24 最大连通域，离线量表；运行时不读取像素。
  var r22StageBodies=demoFixture("core.r22StageBodies.34");
  var r22StageActionScale=demoFixture("core.r22StageActionScale.35");
  var ids=state.bots.filter(b=>!b.parent&&!b.steward).map(b=>b.id);
  var names=['idle','idleB','greet','poke','thinking','working','research','done','confused','waiting','drowsy','sleep','wake','drag'];
  var packs={},actors={},cache=new Map(),staticURLs=new Map(),urls=new Map(),owners=new Map(),pending=new Map(),loaded=new Set(),queue=[],busy=false,current=null;
  var sourcePacks={};
  function rebind(){
    var next={};ids=state.bots.filter(b=>!b.parent&&!b.steward).map(b=>b.id);
    ids.forEach(id=>{var b=botBy(id),real=document.documentElement.dataset.hubMode==='real';
      var picked=b.avatar&&b.avatar.kind==='pack'?Object.values(sourcePacks).find(p=>p.packId===b.avatar.id):null;
      var keyed=!b.avatar||b.avatar.kind==='pack'||b.avatar.avatarExplicit===false||(real&&b.avatar.kind!=='upload');
      var p=picked||(keyed?sourcePacks[id]:null);
      if(!actors[id])actors[id]={id,base:'idle',once:null,preview:null,shown:'idle',timer:null,idleAt:Date.now()+randomChat(),token:0,choice:null,choices:{},previous:{},lastLarge:-Infinity,stagger:0,staggerTimer:null};
      if(p){next[id]=p;r22StageBodies[id]=p.body;}
      if(packs[id]!==p){var a=actors[id];clearTimeout(a.timer);a.token++;a.choice=null;a.choices={};a.previous={};a.once=null;a.preview=null;a.base='idle';
        if(p&&(active||registryReady))Promise.all([asset(p.states.idle.still,false),asset(p.avatar,false)]).then(()=>{if(packs[id]===p&&!disposed){mount();sync();}});
      }
    });packs=next;
    if(registryReady&&!loadFailed){var wasActive=active;active=Object.keys(packs).length>0;if(!initialising&&active&&!wasActive)checkIdle();}
  }
  var fallbackTimer=null,loadFailed=false,registryReady=false;
  var initialising=true,active=false,started=false,disposed=false,homeGreeted=false,lastChat='',idleOwner=null;
  var reduced=matchMedia('(prefers-reduced-motion: reduce)'),observer=null,observed=new WeakSet(),removals=null;
  var nightQuiet=true;try{nightQuiet=localStorage.getItem('hub-r22-night-quiet')!=='false';}catch(e){}
  var collapsed=false,sound=false,lastActivity=Date.now(),idleTimer=null,switchTimer=null,scrollUntil=0,quietUntil=0,inputUntil=0;
  var limits=demoFixture("core.limits.36");
  var directorAt=Date.now()+randomIdle(),lastHome=null,homeHistory=[],events=[];
  try{collapsed=localStorage.getItem('hub-pet-collapsed')==='true';}catch(e){}
  ids.forEach(id=>actors[id]={id,base:'idle',once:null,preview:null,shown:'idle',timer:null,idleAt:Date.now()+randomChat(),token:0,choice:null,choices:{},previous:{},lastLarge:-Infinity,stagger:0,staggerTimer:null});
  function nightFactor(){return nightQuiet&&document.documentElement.getAttribute('data-theme')==='dark'?2:1;}
  function randomIdle(){return (limits.idleMin+Math.random()*(limits.idleMax-limits.idleMin))*nightFactor();}
  function randomChat(){return (limits.chatMin+Math.random()*(limits.chatMax-limits.chatMin))*nightFactor();}
  function path(file){
    if(typeof file!=='string'||!new RegExp(demoText("core.sample.37"),"").test(file)||file.startsWith('/')||file.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid pet path');
    return demoText("core.sample.38")+file;
  }
  function validate(data){
    if(!['dsh-hub-pet-pack/1','dsh-hub-pet-pack/2'].includes(data?.schema))throw Error('Invalid pet schema');
    var result={};Object.entries(data.assistants||{}).forEach(([id,p])=>{if(p?.enabled!==true||!p.states?.idle)return;
      var f=p.frame,h=p.characterHeight||f?.h;
      if(!f||![f.w,f.h,h].every(n=>Number.isFinite(n)&&n>0)||h>f.h)throw Error('Invalid pet dimensions');
      function entry(s){
        if(!s||typeof s.loop!=='boolean'||!Number.isFinite(s.durationMs)||s.durationMs<=0||s.durationMs>60000)throw Error('Invalid pet duration');
        var item={src:path(s.src),still:s.still?path(s.still):null,loop:s.loop,durationMs:s.durationMs,action:String(s.action||s.name||'')};
        owners.set(item.src,id);if(item.still)owners.set(item.still,id);return item;
      }
      var states={},pools={};names.concat('talking').forEach(n=>{
        if(p.states[n])states[n]=entry(p.states[n]);
        if(p.pools?.[n]!==undefined){
          if(!Array.isArray(p.pools[n])||p.pools[n].length>64)throw Error('Invalid pet pool');
          pools[n]=p.pools[n].map(entry);
        }
        if(!states[n]&&pools[n]?.length)states[n]=pools[n][0];
      });
      if(!states.idle?.still)throw Error('Missing idle still');
      var avatar=path(p.avatar96||p.avatar);owners.set(avatar,id);
      var tiers={};
      ['360','216'].forEach(size=>{var tier=p.tiers?.[size];
        if(tier?.frame&&[tier.frame.w,tier.frame.h,tier.characterHeight,tier.footY,tier.centerX].every(Number.isFinite)&&tier.frame.w>0&&tier.frame.h>0&&tier.characterHeight>0&&tier.characterHeight<=tier.frame.h){
          var files={};Object.entries(tier.files||{}).forEach(([from,to])=>{var original=path(from),mapped=path(to);files[original]=mapped;owners.set(mapped,id);});
          tiers[size]={frame:tier.frame,characterHeight:tier.characterHeight,footY:tier.footY,centerX:tier.centerX,files};
        }
      });
      result[id]={packId:p.pack,body:r22StageBodies[id]||[0,0,f.w,f.h],avatar,tiers,frame:{w:f.w,h:f.h},characterHeight:h,
        footY:Number.isFinite(p.footY)?p.footY:f.h,centerX:Number.isFinite(p.centerX)?p.centerX:f.w/2,states,pools};
    });return result;
  }
  function resolve(id,name){
    var p=packs[id];if(!p)return null;var key=name==='talking'?'working':name;
    if(['wake','drag'].includes(key)&&!p.states[key])return null;
    if(key==='idleB'&&p.pools.idle?.length>1)return {key,state:p.pools.idle[1]};
    if(!p.states[key])key=({working:p.states.talking?'talking':'idle',research:'working',drowsy:'idle',idleB:null,poke:'greet'})[key]??(key==='idleB'?null:'idle');
    if(key===null)return null;
    if(!p.states[key]&&key==='working')key=p.states.talking?'talking':'idle';
    if(!p.states[key])key='idle';return {key,state:p.states[key]};
  }
  function choose(id,name){
    var a=actors[id],r=resolve(id,name);if(!r)return null;
    if(a.choices[name]?.token===a.token)return a.choices[name];
    var pool=name==='idleB'&&packs[id].pools.idle?.length>1?packs[id].pools.idle.slice(1):packs[id].pools[r.key];
    if(name==='idle')pool=[packs[id].pools.idle?.[0]||r.state];
    if(!pool?.length)pool=[r.state];
    var choices=pool.filter(s=>s.src!==a.previous[name]);if(!choices.length)choices=pool;
    var s=choices[Math.floor(Math.random()*choices.length)];a.previous[name]=s.src;
    return a.choice=a.choices[name]={name,key:r.key,state:s,token:a.token,identity:name+':'+a.token+':'+s.src};
  }
  function covered(){return innerWidth<700&&(state.detail||state.mode!=='chat'||!!state.drawer);}
  function visible(el){
    if(document.hidden||!el?.isConnected)return false;
    if(el.dataset.petStage==='home'&&covered())return false;
    if(el.dataset.petStage==='chat'&&!inChat(el.dataset.petAssistant))return false;
    return observer?el.dataset.petVisible==='true':true;
  }
  function homeVisible(id){return !covered()&&visible(document.querySelector('[data-pet-stage="home"][data-pet-assistant="'+id+'"]'));}
  function inChat(id){return state.mode==='chat'&&state.bot===id&&(innerWidth>=700||state.detail);}
  function animationAllowed(id,slot){return !disposed&&!document.hidden&&!reduced.matches&&(slot==='home'?!covered():inChat(id));}
  function schedule(fn){if(window.requestIdleCallback)window.requestIdleCallback(fn,demoFixture("core.sample.39"));else setTimeout(fn,32);}
  function release(url){if(!url||!urls.has(url))return;URL.revokeObjectURL(url);var file=urls.get(url).file;urls.delete(url);if(staticURLs.get(file)===url)staticURLs.delete(file);}
  function removeImage(image){if(!image)return;image.remove();if(image._petURL)release(image._petURL);}
  function collectURLs(){
    var sources=new Set([...document.querySelectorAll('img')].map(i=>i.src||i.getAttribute('src')));
    urls.forEach((v,url)=>{if(v.image){if(v.attached&&!v.image.isConnected)release(url);}else if(!cache.has(v.file)&&!sources.has(url))release(url);});
  }
  function remember(file,blob){
    cache.delete(file);cache.set(file,blob);var id=owners.get(file);
    var files=[...cache.keys()].filter(f=>owners.get(f)===id);
    while(files.length>8)cache.delete(files.shift());collectURLs();return blob;
  }
  function cached(file){var blob=cache.get(file);if(blob){cache.delete(file);cache.set(file,blob);}return blob;}
  function staticURL(file){
    if(!file)return '';var url=staticURLs.get(file);if(url)return url;var blob=cached(file);if(!blob)return '';
    url=URL.createObjectURL(blob);staticURLs.set(file,url);urls.set(url,{file,image:null});return url;
  }
  function petURL(file){
    var logical=file;
    if(!(demoText("core.sample.38")||/^(?:pets\/|blob:|data:|https?:)/.test(String(file)))){
      logical='pets/'+String(file).replace(/^\//,'');
    }
    if(/^(?:blob:|data:|https?:)/.test(String(logical)))return logical;
    var proto='';
    try{proto=(window.location&&window.location.protocol)||'';}catch(err){proto='';}
    if((proto==='http:'||proto==='https:')&&String(logical).indexOf('pets/')===0)return '/'+logical;
    return logical;
  }
  function petFetch(file){
    var first=petURL(file),opts={credentials:'same-origin',redirect:'error'};
    function second(response){
      if(response&&response.ok)return response;
      if(first===file)return response;
      return window.fetch.call(window,file,opts);
    }
    return window.fetch.call(window,first,opts).then(second,function(){return second(null);});
  }
  function pump(){
    if(busy||disposed||!queue.length||document.hidden)return;
    var task=queue.shift();if(task.animation&&(reduced.matches||!task.guard())){pending.delete(task.file);task.resolve(null);pump();return;}
    busy=true;current=task;
    (async()=>{
      try{
        var response=await petFetch(task.file);if(!response||!response.ok)throw Error('Pet file unavailable');
        var blob=await response.blob();if(disposed){task.resolve(null);return;}
        loaded.add(task.file);task.resolve(remember(task.file,blob));
      }catch(e){task.resolve(null);}
      finally{pending.delete(task.file);busy=false;current=null;if(queue.length)schedule(pump);}
    })();
  }
  function asset(file,animation,guard){
    if(!file||disposed)return Promise.resolve(null);
    if(animation&&(reduced.matches||document.hidden||!guard()))return Promise.resolve(null);
    var blob=cached(file);if(blob)return Promise.resolve(blob);
    if(pending.has(file))return pending.get(file);
    var promise=new Promise(resolve=>queue.push({file,animation:!!animation,guard:guard||(()=>true),resolve}));
    pending.set(file,promise);schedule(pump);return promise;
  }
  function still(id,name){var r=resolve(id,name);return r&&(r.state.still||packs[id].states.idle.still);}
  function desired(id,slot){
    var a=actors[id];if(a.preview)return a.preview;
    var elapsed=Date.now()-lastActivity;
    var maySleep=nightQuiet||document.documentElement.getAttribute('data-theme')!=='dark';
    if(maySleep&&elapsed>=limits.sleep)return 'sleep';
    if(maySleep&&elapsed>=limits.drowsy)return 'drowsy';
    if(a.once)return a.once.name;
    if(a.base!=='idle')return a.base;
    if(slot!=='home'&&inChat(id)){if(waiting())return 'waiting';return cardLoop()||'idle';}
    return 'idle';
  }
  /* 保留既有的业务状态识别。 */
  function cardLoop(){
    if(document.querySelector('.thread [data-screen-phase="acting"],.thread [data-voice-state="running"]'))return 'working';
    var steps=[...document.querySelectorAll('.thread [role="progressbar"][aria-label="演示阶段"]')];
    var current=steps.find(el=>+el.getAttribute('aria-valuenow')>0&&+el.getAttribute('aria-valuenow')<100);
    if(!current)return null;
    var label=current.closest('.hub-mount')?.querySelector('[aria-current="step"]')?.textContent||'';
    return /检索|搜索|知识库|记忆|引用/.test(label)?'research':'working';
  }
  function waiting(){
    if(state.mode!=='chat')return false;
    if(document.querySelector('.thread [data-screen-phase="asking"],.thread [data-voice-state="needs-approval"]'))return true;
    if([...document.querySelectorAll('.thread .hub-mount [role="status"]')].some(el=>/^未发送.*(?:待批|需重新批准)|^停下等批|^待批准$/.test(el.textContent.trim())))return true;
    var ms=Hub.currentMessages();
    return ms.some(m=>(m.parts||[]).some(p=>{
      var d=state.decisions.find(d=>d.id===p.data?.id);
      return d&&['pending','edit'].includes(d.status)&&['approve','draft','handoff'].includes(p.type);
    }))||!!Hub.pendingInputs?.().some(p=>p.conversation===state.conversation&&!['resolved','done'].includes(p.status));
  }

  function once(id,name,forced){
    var a=actors[id];if(!a||!resolve(id,name))return false;
    clearTimeout(a.timer);if(idleOwner===id)idleOwner=null;
    a.preview=null;a.token++;a.choice=null;a.once={name,started:false,token:a.token};if(forced)a.choices[name]={name,key:name,state:forced,token:a.token,identity:name+':'+a.token+':'+forced.src};sync();return true;
  }
  function finishOnce(id,name,token){
    var a=actors[id];if(a.once?.name!==name||(token!==undefined&&a.once.token!==token))return;
    a.once=null;a.preview=null;a.timer=null;a.token++;a.choice=null;if(idleOwner===id)idleOwner=null;
    if(name!=='idleB')a.idleAt=Date.now()+randomChat();
    if(name==='greet'&&a.afterGreet){a.afterGreet=false;once(id,'confused');return;}
    sync();
  }
  function markShown(id,name,choice){
    var a=actors[id];a.shown=name;
    if(a.once?.name===name&&!a.once.started){a.once.started=true;
      var token=a.once.token;a.timer=setTimeout(()=>finishOnce(id,name,token),choice.state.durationMs);
      if(name==='idleB'){
        var now=Date.now();events.push({id,at:now,slot:inChat(id)?'chat':'home',file:choice.state.src});if(events.length>64)events.shift();
        if(inChat(id))a.idleAt=now+randomChat();
        else{a.lastLarge=now;lastHome=id;homeHistory.push(id);if(homeHistory.length>64)homeHistory.shift();directorAt=now+randomIdle();}
      }
    }
  }
  function tierFor(id,slot,file){var p=packs[id],tier=slot==='chat'?'360':slot==='home'?'216':null;return tier&&p?.tiers?.[tier]?.files[file]?p.tiers[tier]:p;}
  function tierFile(id,slot,file){var tier=slot==='chat'?'360':slot==='home'?'216':null;return (tier&&packs[id]?.tiers?.[tier]?.files[file])||file;}
  function frameStyle(id,height,slot,file){
    var p=tierFor(id,slot,file),scale=height/p.characterHeight;
    // alpha 联集来自旁挂动画全部帧；完整画布绘制，头顶最多探出输入面板约32px。
    if(slot==='chat'){
      var key=(file||'').replace('/x360/','/').replace(demoText("core.key.40"),demoText("core.key.41")),body=r22StageBodies[id];
      var unit=p.characterHeight/360,center=(body[0]+body[2])/2;
      scale=Math.min(108/(body[3]-body[1]),92/(body[2]-body[0]))/unit*(r22StageActionScale[key]||1);
      return 'position:absolute;width:'+p.frame.w*scale+'px;height:'+p.frame.h*scale+'px;left:'+(48-center*unit*scale)+'px;top:'+(132-body[3]*unit*scale)+demoText("core.sample.42");
    }
    return 'width:'+p.frame.w*scale+'px;height:'+p.frame.h*scale+'px;left:calc(50% - '+p.centerX*scale+'px);top:calc(100% - '+p.footY*scale+'px)';
  }
  function stage(slot,id){
    id=id||state.bots.find(b=>b.role==='chief')?.id;var p=packs[id];if(!p)return window.AssistantProfiles?.staticStage(botBy(id),slot)||fallbackAvatar(botBy(id),slot);
    var name=desired(id,slot),original=still(id,name),file=tierFile(id,slot,original),geometry=tierFor(id,slot,original),url=staticURL(file)||staticURL(p.states.idle.still);
    return '<span class="chief-pet-stage'+(slot==='home'?' creature bot-avatar':'')+'" data-pet-stage="'+slot+'" data-pet-assistant="'+id+'" data-bot-avatar="'+id+'" data-pet-state="idle" style="--pet-height-ratio:'+geometry.frame.h/geometry.characterHeight+';--pet-aspect:'+geometry.frame.w+'/'+geometry.frame.h+'"><img src="'+esc(url||file)+'" data-pet-file="'+esc(file)+'" width="'+geometry.frame.w+'" height="'+geometry.frame.h+'" style="'+frameStyle(id,slot==='home'?76:132,slot,original)+'" alt="'+esc(botBy(id).name)+'角色" draggable="false"></span>';
  }

  function twoFrames(){return new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok)));}
  function blocked(){return Date.now()<scrollUntil;}
  function deferSwitch(){clearTimeout(switchTimer);switchTimer=setTimeout(()=>{switchTimer=null;if(blocked())deferSwitch();else sync();},Math.max(16,scrollUntil-Date.now()+1));}
  async function ready(image,url){
    await new Promise((ok,no)=>{image.onload=ok;image.onerror=no;image.src=url;if(image.complete&&image.naturalWidth)ok();});
    // WebKit 动图 decode 可能拒绝或悬挂；load 后两帧是同一张待显示图片的兜底。
    var fallback=document.hidden?new Promise(ok=>setTimeout(ok,34)):twoFrames();
    if(image.decode)await Promise.race([image.decode().catch(()=>fallback),fallback]);else await fallback;
  }
  async function crossfade(el,blob,file,name,choice,moving){
    if(!el?.isConnected||!blob)return;
    var identity=((moving?choice.identity:'still:'+(choice.original||file))+':'+file),old=el.querySelector('img');
    if(el._petIdentity===identity){el.dataset.petState=name;return;}
    var generation=(el._petGeneration||0)+1;el._petGeneration=generation;
    var image=document.createElement('img'),url=URL.createObjectURL(blob);image._petURL=url;urls.set(url,{file,image,attached:false});
    var geometry=tierFor(el.dataset.petAssistant,el.dataset.petStage,choice.original||file);image.width=geometry.frame.w;image.height=geometry.frame.h;
    image.alt=botBy(el.dataset.petAssistant).name+'角色';image.draggable=false;
    image.setAttribute('style',frameStyle(el.dataset.petAssistant,el.dataset.petStage==='home'?76:132,el.dataset.petStage,choice.original||file));image.setAttribute('data-pet-file',file);
    try{await ready(image,url);}catch(e){release(url);return;}
    function stale(){return disposed||!el.isConnected||generation!==el._petGeneration||choice.token!==actors[el.dataset.petAssistant].token;}
    if(stale()){release(url);return;}
    if(blocked()){
      release(url);el._petRequest=null;deferSwitch();return;
    }
    if(moving&&!animationAllowed(el.dataset.petAssistant,el.dataset.petStage)){release(url);el._petRequest=null;return;}
    // 旧图始终保持 1；一次性动作回基础呼吸直接替换，不交叉降浓度。
    var hard=!moving||reduced.matches||document.hidden||(el._petOneShot&&name==='idle');
    el.querySelectorAll('img').forEach(i=>{if(i!==old)removeImage(i);});
    if(old)old.style.opacity='1';image.style.opacity=hard?'1':'0';el.append(image);urls.get(url).attached=true;
    el._petIdentity=identity;el._petOneShot=moving&&!choice.state.loop;el.dataset.petState=name;
    /* R25-MOTION-HOOK */
    window.HubPetMotion?.committed(el,name,choice,moving);
    /* R25-MOTION-HOOK */
    if(hard){if(old)removeImage(old);if(moving)markShown(el.dataset.petAssistant,name,choice);return;}
    requestAnimationFrame(function show(){
      if(blocked()){setTimeout(show,Math.max(16,scrollUntil-Date.now()+1));return;}
      if(stale()||!image.isConnected){removeImage(image);el._petIdentity=null;el._petRequest=null;return;}
      image.style.opacity='1';markShown(el.dataset.petAssistant,name,choice);
    /* R25-MOTION-HOOK */
    if(window.HubPetMotion){window.HubPetMotion.retire(image,old,()=>removeImage(old),()=>!blocked());return;}
    /* R25-MOTION-HOOK */
      setTimeout(function retire(){if(blocked()){setTimeout(retire,Math.max(16,scrollUntil-Date.now()+1));return;}if(old?.isConnected&&old!==image)removeImage(old);},110);
    });
  }
  function paint(el){
    if(blocked()){deferSwitch();return;}
    var id=el.dataset.petAssistant,slot=el.dataset.petStage;if(!packs[id])return;
    var slotPaused=initialising||disposed||document.hidden||(slot==='home'?covered():!inChat(id));
    var expression=!slotPaused&&reduced.matches,paused=slotPaused||reduced.matches;
    var name=expression?desired(id,slot):(paused?'idle':desired(id,slot));
    /* R25-MOTION-HOOK */
    if(window.HubPetMotion?.hold(el,name,sync))return;
    /* R25-MOTION-HOOK */
    // 离屏只保留原来的图片；可见性只用于选角、首次加载，绝不据此换静帧。
    if(!slotPaused&&slot==='home'&&!visible(el))return;
    var choice=expression?{state:resolve(id,name).state,token:actors[id].token,identity:'expr:'+name}:(paused?{state:resolve(id,'idle').state,token:actors[id].token,identity:'paused'}:choose(id,name));if(!choice)return;
    var moving=!paused,file=moving?choice.state.src:(still(id,name)||packs[id].states.idle.still);
    if(moving&&name==='idle'&&slot==='home'&&Date.now()<actors[id].stagger){
      var a=actors[id];if(!a.staggerTimer)a.staggerTimer=setTimeout(()=>{a.staggerTimer=null;sync();},Math.max(1,a.stagger-Date.now()));return;
    }
    var original=file;file=tierFile(id,slot,original);choice=Object.assign({},choice,{original:original});
    var key=(moving?choice.identity:'still:'+original)+':'+file;
    if(el._petIdentity===key||el._petRequest===key)return;el._petRequest=key;
    asset(file,moving,()=>animationAllowed(id,slot)&&choose(id,desired(id,slot))?.identity===choice.identity).then(blob=>{
      if(!blob||!el.isConnected||el._petRequest!==key){if(el._petRequest===key)el._petRequest=null;return;}
      return crossfade(el,blob,file,name,choice,moving);
    }).finally(()=>{if(el._petRequest===key)el._petRequest=null;});
  }
  function paintToggle(){
    if(blocked()){deferSwitch();return;}
    document.querySelectorAll('[data-pet-toggle-avatar]').forEach(el=>{
      var id=el.dataset.petToggleAvatar;if(!inChat(id))return;var name=initialising?'idle':desired(id,'chat'),choice=choose(id,name),file=still(id,name);
      asset(file,false).then(blob=>{if(!blob||!el.isConnected||name!==desired(id,'chat')||blocked())return;el.src=staticURL(file);el.dataset.petState=name;markShown(id,name,choice);});
    });
  }
  function sync(){
    /* R25-MOTION-HOOK */
    window.HubPetMotion?.sync({night:nightQuiet,quiet:quiet(),covered:covered()});
    /* R25-MOTION-HOOK */
    if(!active||disposed)return;
    var route=state.mode==='chat'&&(innerWidth>=700||state.detail)?state.bot+':'+state.conversation:'';
    if(route!==lastChat){lastChat=route;if(route){ids.forEach(id=>{if(id!==state.bot&&actors[id].once?.name==='idleB')finishOnce(id,'idleB');});}if(route&&packs[state.bot]){
      var last=Hub.currentMessages().findLast(m=>m.from!=='user');
      actors[state.bot].afterGreet=!!last?.parts?.some(p=>/error|fail/.test(p.type)&&(!p.data?.state||/失败|error|failed/i.test(p.data.state)));
      once(state.bot,'greet');
    }}
    document.querySelectorAll('[data-pet-stage]').forEach(el=>{
      if(observer&&!observed.has(el)){observed.add(el);observer.observe(el);}paint(el);
    });
    document.querySelectorAll('[data-pet-status]').forEach(el=>{var label=statusText();if(el.textContent!==label)el.textContent=label;});
    paintToggle();pump();collectURLs();
  }
  function statusText(){if(waiting())return '等你点头';var id=state.bot;if(!actors[id])return '随时接话';var name=desired(id,'chat');return ({waiting:'等你点头',research:'在查',thinking:'在想',working:'在写',sleep:'睡着了',drowsy:'困了',done:'做好了',confused:'没听懂'})[name]||'随时接话';}
  function chatHTML(){
    var id=state.bot;if(!ids.includes(id))return '';
    if(collapsed)return '<div class="chief-pet-lane is-collapsed"><button class="chief-pet-toggle" type="button" data-pet-toggle aria-label="展开'+esc(botBy(id).name)+'角色" aria-expanded="false">'+(packs[id]?toggleAvatar(id):(window.AssistantProfiles?.avatarHTML(botBy(id),'pet-toggle')||fallbackAvatar(botBy(id))))+'</button></div>';
    return '<div class="chief-pet-lane r22-pet-platform" data-pet-platform="'+id+'" style="'+botStyle(id)+'"><span class="r22-pet-floor"></span><span class="r22-pet-figure" role="button" tabindex="0" aria-label="戳一下'+esc(botBy(id).name)+'；长按选择，下滑收起">'+stage('chat',id)+'</span><span class="r22-pet-status" data-pet-status>'+statusText()+'</span></div>';
  }
  function toggleAvatar(id){
    var name=desired(id,'chat'),url=staticURL(still(id,name))||staticURL(packs[id].states.idle.still);
    return '<img class="creature bot-avatar chief-pet-avatar" data-bot-avatar="'+id+'" data-pet-toggle-avatar="'+id+'" data-pet-state="'+name+'" src="'+esc(url)+'" width="32" height="32" alt="" draggable="false">';
  }
  function mount(){
    // Upgrade avatar nodes in place. Pack arrival must not detach active controls.
    function replace(el,html){var t=document.createElement('template');t.innerHTML=html;var next=t.content.firstElementChild;if(!next)return;
      if(el.tagName==='IMG'&&next.tagName==='IMG'&&el.getAttribute('src')===next.getAttribute('src'))return;
      var p=packs[el.dataset.petAssistant],image=el.querySelector('img');
      if(p?.packId&&el.dataset.petStage==='home'&&image?.dataset.petFile?.startsWith(demoText("core.sample.43")+p.packId+'/')){image.alt=botBy(el.dataset.petAssistant).name+'角色';return;}
      var style=el.getAttribute('style');if(style)next.setAttribute('style',style);el.replaceWith(next);}
    document.querySelectorAll('[data-sub-assistant]').forEach(el=>replace(el,avatar(el.dataset.subAssistant)));
    document.querySelectorAll('[data-bot-avatar]').forEach(el=>{
      var id=el.dataset.botAvatar;if(!packs[id]||el.closest('[data-sub-assistant],.chief-pet-lane,[data-avatar-library],[data-assistant-change],.r25-assistant-profile'))return;
      replace(el,avatar(id,el.closest('.home-role')?'home':el.closest('.titlepill')?'header':undefined));
    });
    var composer=state.mode==='chat'&&packs[state.bot]&&document.querySelector('.composer-area');
    if(composer&&!document.querySelector('.chief-pet-lane')){var t=document.createElement('template');t.innerHTML=chatHTML();composer.prepend(t.content.firstElementChild);}
    var lane=document.querySelector('.r22-pet-platform');if(lane&&!lane.querySelector('[data-pet-stage]')&&packs[state.bot]){
      var t=document.createElement('template');t.innerHTML=chatHTML();var next=t.content.firstElementChild;
      if(next){lane.className=next.className;if(next.getAttribute('style'))lane.setAttribute('style',next.getAttribute('style'));
        if(next.getAttribute('data-pet-platform'))lane.setAttribute('data-pet-platform',next.getAttribute('data-pet-platform'));
        lane.replaceChildren();while(next.firstChild)lane.appendChild(next.firstChild);}
    }
    Hub.measureDock();
  }

  function prefetch(id,names){/* 新动作按需串行加载，不预测下载。 */}
  function status(id,name){
    /* R25-MOTION-HOOK */
    if(actors[id]&&window.HubPetMotion?.status(id,name,()=>status(id,name),actors[id]))return;
    /* R25-MOTION-HOOK */
    var a=actors[id];if(!a||(['wake','drag'].includes(name)&&!resolve(id,name)))return;a.afterGreet=false;
    if(['done','confused','wake'].includes(name)){a.base='idle';once(id,name);return;}
    if(a.base!==name||a.once||a.preview){clearTimeout(a.timer);a.once=null;a.preview=null;a.base=name;a.token++;a.choice=null;if(idleOwner===id)idleOwner=null;}
    sync();
  }
  function quiet(){
    var el=document.activeElement;
    return document.hidden||reduced.matches||blocked()||Date.now()<quietUntil||Date.now()<inputUntil||state.running||
      !!el?.matches?.('input,textarea,[contenteditable="true"]')||
      !!document.querySelector('.thread .m-interact-live,.thread [data-stream-state="streaming"],.thread [data-interact-streaming="true"]');
  }
  function conduct(now){
    if(quiet()||Date.now()-lastActivity>=limits.drowsy)return;
    var chat=ids.find(id=>packs[id]&&inChat(id));
    // 小屏聊天与首页只由一个指挥分支发动作；桌面聊天也不叠加首页动作。
    if(chat){
      var a=actors[chat];if(now<a.idleAt||a.base!=='idle'||a.once||a.preview||waiting()||cardLoop()||idleOwner)return;
      if(resolve(chat,'idleB')){idleOwner=chat;once(chat,'idleB');idleOwner=chat;a.idleAt=now+randomChat();}return;
    }
    if(now<directorAt||idleOwner||ids.some(id=>actors[id].once))return;
    var candidates=ids.filter(id=>packs[id]&&id!==lastHome&&now-actors[id].lastLarge>=30000&&homeVisible(id)&&actors[id].base==='idle'&&!actors[id].preview&&resolve(id,'idleB'));
    if(!candidates.length)return;
    var id=candidates[Math.floor(Math.random()*candidates.length)];idleOwner=id;once(id,'idleB');idleOwner=id;
  }
  function checkIdle(){
    if(!active||disposed)return;clearTimeout(idleTimer);var now=Date.now();conduct(now);sync();
    idleTimer=setTimeout(checkIdle,100);
  }
  function scrollActivity(){var now=Date.now();scrollUntil=now+250;quietUntil=now+1500;deferSwitch();}
  function wake(){
    var was=Date.now()-lastActivity>=limits.sleep;lastActivity=Date.now();
    if(was&&active){var id=ids.find(id=>inChat(id))||(homeVisible('chief')?'chief':null);if(id&&resolve(id,'wake'))once(id,'wake');sync();}
    if(!idleTimer)checkIdle();
  }
  function setCollapsed(value){
    collapsed=!!value;try{localStorage.setItem('hub-pet-collapsed',String(collapsed));}catch(e){}
    var lane=document.querySelector('.chief-pet-lane');if(lane){var t=document.createElement('template');t.innerHTML=chatHTML();lane.replaceWith(t.content.firstElementChild);Hub.measureDock();sync();collectURLs();}
  }
  function poke(angry){
    var id=state.bot;if(!active||!actors[id])return false;
    var forced=angry?packs[id]?.pools.poke?.find(s=>s.action.includes('生气')):null;
    return once(id,angry&&!forced?'confused':'poke',forced);
  }
  function controls(e){
    var el=e.target.closest('[data-pet-toggle],[data-pet-sound]');if(!el)return;
    if('petToggle'in el.dataset)setCollapsed(!collapsed);else{sound=!sound;el.setAttribute('aria-checked',String(sound));}
  }
  async function load(){
    try{
      var packURL=demoText("core.response.44")||'pets/pack.json';
      var response=await petFetch(packURL);if(!response||!response.ok)throw Error('角色包不可用');
      sourcePacks=validate(await response.json());rebind();var expectedPacks=Object.keys(packs).length;
      for(var id of ids){if(!packs[id])continue;
        if(!await asset(packs[id].states.idle.still,false)){delete packs[id];continue;}
        await asset(packs[id].avatar,false);
      }
      if(disposed)return;active=Object.keys(packs).length>0;if(!active&&(expectedPacks>0||!Object.keys(sourcePacks).length))throw Error('角色包无可用角色');
      registryReady=true;
      clearTimeout(fallbackTimer);document.body.classList.remove('r22-pets-pending');
      if(typeof IntersectionObserver==='function')observer=new IntersectionObserver(entries=>{entries.forEach(e=>e.target.dataset.petVisible=String(e.isIntersecting));sync();});
      if(typeof MutationObserver==='function'){removals=new MutationObserver(collectURLs);removals.observe(document.getElementById('app'),{childList:true,subtree:true});}
      mount();sync();await twoFrames();initialising=false;
      ids.forEach(id=>actors[id].stagger=Date.now()+Math.random()*600);directorAt=Date.now()+randomIdle();sync();
      setTimeout(()=>{if(!homeGreeted&&homeVisible('chief')&&!quiet()){homeGreeted=true;once('chief','greet');}},650);
      checkIdle();
    }catch(e){loadFailed=true;clearTimeout(fallbackTimer);document.body.classList.remove('r22-pets-pending');/* 失败才显示团子。 */}
  }
  function start(){
    if(started)return;if(!['http:','https:'].includes(window.location?.protocol)||typeof window.fetch!=='function')return;started=true;
    ['pointerdown','touchstart','touchmove','keydown','wheel','scroll'].forEach(type=>document.addEventListener(type,wake,{passive:true,capture:true}));
    ['scroll','scrollend','touchmove','wheel'].forEach(type=>document.addEventListener(type,scrollActivity,{passive:true,capture:true}));
    document.addEventListener('input',()=>{document.body.classList.toggle('r22-input-active',!!document.querySelector('[data-focus="composer"]')?.value);inputUntil=Date.now()+1500;},{passive:true,capture:true});
    document.addEventListener('visibilitychange',()=>{sync();if(!document.hidden){pump();checkIdle();}});
    reduced.addEventListener('change',()=>sync());
    Hub.on('message',e=>{if(e.conversation!==state.conversation||e.quiet)return;
      if(e.message.from==='user')status(state.bot,'thinking');
      else if((e.message.parts||[]).some(p=>/error|fail/.test(p.type)))status(state.bot,'confused');
      else if(e.message.status!=='thinking'&&e.message.status!=='tool')status(state.bot,'done');
    });
    Hub.on('message-status',e=>{if(e.conversation!==state.conversation||e.message.from==='user')return;
      var m=e.message;if(m.status==='thinking')status(state.bot,'thinking');
      else if(m.status==='tool')status(state.bot,/检索|搜索|知识库|记忆|research|search/i.test(m.statusTool||'')?'research':'working');
      else if(state.running)status(state.bot,'working');
      else if(actors[state.bot]&&['thinking','working','research'].includes(actors[state.bot].base))status(state.bot,'done');
    });
    window.addEventListener('pagehide',e=>{if(e.persisted)return;disposed=true;clearTimeout(idleTimer);clearTimeout(switchTimer);ids.forEach(id=>{clearTimeout(actors[id].timer);clearTimeout(actors[id].staggerTimer);});observer?.disconnect();removals?.disconnect();[...urls.keys()].forEach(release);cache.clear();});
    document.body.classList.add('r22-pets-pending');fallbackTimer=setTimeout(()=>{document.body.classList.remove('r22-pets-pending');},4000);load();
  }
  return {start,sync,rebind,active:id=>id?!!packs[id]&&active:active,
    nightEnabled:()=>nightQuiet,setNight:value=>{nightQuiet=!!value;try{localStorage.setItem('hub-r22-night-quiet',String(nightQuiet));}catch(e){}directorAt=Date.now()+randomIdle();ids.forEach(id=>actors[id].idleAt=Date.now()+randomChat());sync();},
    avatar:id=>staticURL(packs[id||'chief']?.avatar),stage,chatHTML,
    setCollapsed,poke,toggleSound:el=>{sound=!sound;el?.setAttribute('aria-checked',String(sound));},isCollapsed:()=>collapsed,soundEnabled:()=>sound,toggleAvatar,replying:()=>status(state.bot,'working'),faceChanged:()=>{},duration:(name,fallback)=>resolve('chief',name)?.state.durationMs||fallback,
    turn:status,
    info:()=>({active,state:active?actors.chief.shown:null,src:active?actors.chief.choice?.state.src:null,loaded:[...loaded],assistants:ids.filter(id=>packs[id]),queue:queue.map(t=>t.file),downloading:current?.file||null,reducedMotion:reduced.matches,thresholds:{...limits},cacheByAssistant:Object.fromEntries(ids.map(id=>[id,[...cache.keys()].filter(f=>owners.get(f)===id).length])),liveURLs:urls.size}),
    state:()=>({slots:[...document.querySelectorAll('[data-pet-stage],[data-pet-toggle-avatar]')].map(el=>({assistant:el.dataset.petAssistant||el.dataset.petToggleAvatar,slot:el.dataset.petStage||'toggle',state:el.dataset.petState,desired:desired(el.dataset.petAssistant||el.dataset.petToggleAvatar,el.dataset.petStage||'chat'),visible:visible(el),images:el.querySelectorAll('img').length})),actors:Object.fromEntries(ids.map(id=>[id,{state:desired(id,inChat(id)?'chat':'home'),base:actors[id].base,once:actors[id].once?.name||null,src:actors[id].choice?.state.src||null}])),idleOwner,director:{nightQuiet,nightFactor:nightFactor(),nextAt:directorAt,quietUntil,scrollUntil,inputUntil,lastHome,events:[...events]}}),
    debug:options=>{if(options?.reset){limits=demoFixture("core.debug.45");}else for(var key of Object.keys(limits))if(Number.isFinite(options?.[key])&&options[key]>0)limits[key]=options[key];lastActivity=Date.now();directorAt=Date.now()+randomIdle();ids.forEach(id=>actors[id].idleAt=Date.now()+randomChat());checkIdle();return {...limits};},
    preview:(name,options)=>{var id=options?.assistant||state.bot||'chief';if(name==='talking')name='working';if(!active||!packs[id]||!names.includes(name)||!resolve(id,name))return false;
      if(['idleB','greet','poke','done','confused','wake','drag'].includes(name))return once(id,name);
      var a=actors[id];clearTimeout(a.timer);if(idleOwner===id)idleOwner=null;a.once=null;a.preview=name;a.token++;a.choice=null;sync();return true;}
  };
}
var chiefPet=createChiefPet();
document.addEventListener('click',e=>{var el=e.target.closest('[data-pet-toggle],[data-pet-sound]');if(!el)return;if('petToggle'in el.dataset)chiefPet.setCollapsed(!chiefPet.isCollapsed());else chiefPet.toggleSound(el);});


function r22App(id){
  var shapes={
    'board-steward':['#D9822C','<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M9.5 4v16M15 4v16M6 8h1M12 8h1M12 12h1M18 8h1"/>'],
    'ledger-steward':['#3A9EC2','<circle cx="12" cy="12" r="8.5"/><path d="m9 8 3 4 3-4M12 12v5M9.5 13h5"/>'],
    'memory-steward':['#5E9630','<path d="M6 3.5h12V21l-6-4-6 4z"/>'],
    'safety-steward':['#DB6E9F','<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6zM9 12l2.2 2.2 4.3-4.2"/>'],
    'machine-steward':['#5C82D2','<rect x="3" y="4" width="18" height="12" rx="2.5"/><path d="M9 20h6M12 16v4"/>'],
    'schedule-steward':['#C98F1E','<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>'],
    'connect-steward':['#2E9B7E','<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>']
  },item=shapes[FEATURE_PAGES.find(p=>p.id===featureKey(id))?.source||id];
  if(!item)return '';
  return '<span class="creature bot-avatar r22-app" data-bot-avatar="'+esc(id)+'" data-r22-app="'+esc(id)+'" style="--a:'+item[0]+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+item[1]+'</svg></span>';
}
function fallbackAvatar(b,slot){
  if(b.steward)return r22App(b.id);
  var main=demoFixture("core.main.46");
  var stewards={
    'board-steward':'M23 12H99Q108 12 108 22V86Q108 96 98 96H32Q22 96 22 86V22ZM12 32H82Q92 32 92 42V98Q92 108 82 108H22Q12 108 12 98Z',
    'ledger-steward':'M60 10A50 50 0 1 1 60 110 50 50 0 1 1 60 10ZM60 22A38 38 0 1 1 60 98 38 38 0 1 1 60 22Z',
    'memory-steward':'M28 12H92Q100 12 100 22V108L60 87 20 108V22Q20 12 28 12Z',
    'safety-steward':'M60 10 104 27V61Q103 89 60 112 17 89 16 61V27Z',
    'machine-steward':'M22 14H98Q110 14 110 26V80Q110 92 98 92H22Q10 92 10 80V26Q10 14 22 14ZM47 92V105H73V92M32 108H88',
    'schedule-steward':'M24 22H96Q106 22 106 32V99Q106 109 96 109H24Q14 109 14 99V32Q14 22 24 22ZM35 10V33M85 10V33M14 43H106',
    'connect-steward':'M53 26H31Q10 26 10 48V66Q10 86 31 86H53V71H32Q25 71 25 62V50Q25 41 33 41H53ZM67 34H89Q110 34 110 56V74Q110 94 89 94H67V79H88Q95 79 95 70V58Q95 49 87 49H67ZM41 53H79V68H41Z'
  };
  
  var bodyBounds=demoFixture("core.bodyBounds.47");
  var viewBox=!b.steward&&bodyBounds[b.id]?bodyBounds[b.id].join(' '):'0 0 120 120';
  var d=(b.steward?stewards[b.id]:main[b.id])||b.avatarPath;
  var outfit=(b.outfits||[]).find(o=>o.id===b.outfitId),color=outfit?.color||b.color;
  return '<svg class="creature bot-avatar role-silhouette" data-bot-avatar="'+esc(b.id)+'" data-avatar-outfit="'+esc(outfit?.id||'default')+'" data-silhouette="'+esc(b.id)+'" viewBox="'+viewBox+'" aria-hidden="true"><g stroke="#423145" stroke-width="'+(b.steward?'6':'3')+demoText("core.sample.48")+d+'" fill="'+esc(color)+'" fill-rule="nonzero"/><path d="M31 37q1-9 12-11" fill="none" stroke="#fff" stroke-opacity=".35"/><g fill="#423145" stroke="none"><circle cx="48" cy="57" r="3"/><circle cx="72" cy="57" r="3"/></g><path d="M55 69h10" fill="none"/></g></svg>';
}

var avatarSequence=0;
var chiefFace={face:'normal',conversation:null,epoch:0,timer:null};
function chiefFaceName(){
  if(state.bot!=='chief')return 'normal';
  if(state.running)return 'thinking';
  if(['抱歉','惊讶'].includes(state.emotion))return 'confused';
  if(chiefFace.conversation===state.conversation&&chiefFace.face!=='normal')return chiefFace.face;
  return 'normal';
}
// Only replace avatar nodes: expiry never replaces the composer or moves its caret.
function refreshChiefAvatars(){
  document.querySelectorAll('[data-chief-face]').forEach(el=>{
    if(chiefPet.active('chief')&&(el.dataset.petStage||el.classList.contains('chief-pet-avatar'))){el.dataset.chiefFace=chiefFaceName();return;}
    var holder=document.createElement('template');holder.innerHTML=avatar('chief',el.dataset.chiefSlot);
    var next=holder.content.firstElementChild,style=el.getAttribute('style');
    if(style)next.setAttribute('style',style);
    el.replaceWith(next);
  });
  chiefPet.sync();
}
function setChiefFace(face,duration,conversation){
  duration=chiefPet.duration(face,duration);
  clearTimeout(chiefFace.timer);var epoch=++chiefFace.epoch;
  chiefFace.face=face;chiefFace.conversation=conversation;
  chiefPet.faceChanged();
  if(!duration)return;
  chiefFace.timer=setTimeout(()=>{
    if(chiefFace.epoch!==epoch)return;
    chiefFace.face='normal';
    if(state.bot==='chief'&&state.conversation===conversation&&state.emotion===(face==='confused'?'抱歉':'开心'))state.emotion='开心';
    refreshChiefAvatars();
  },duration);
}
function animateChiefDone(conversation){
  if(state.bot!=='chief'||state.conversation!==conversation||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  document.querySelectorAll('[data-chief-face="done"]').forEach(el=>{
    el.classList.add('chief-face-done');
    var clear=()=>el.classList.remove('chief-face-done');
    el.addEventListener('animationend',clear,{once:true});el.addEventListener('animationcancel',clear,{once:true});setTimeout(clear,200);
  });
}
function avatar(id,slot){
  let b=botBy(assistantId(id))||state.bots[0],outfit=(b.outfits||[]).find(o=>o.id===b.outfitId);
  var real=document.documentElement.dataset.hubMode==='real'&&chiefPet.active(b.id)&&(slot==='home'||slot==='chat');
  var custom=real?null:window.AssistantProfiles?.avatarHTML(b,slot);if(custom!==undefined&&custom!==null)return custom;
  if(chiefPet.active(b.id)){
    if(slot==='home')return chiefPet.stage('home',b.id);
    if(slot==='pet-toggle')return chiefPet.toggleAvatar(b.id);
    return '<img class="creature bot-avatar chief-pet-avatar" data-bot-avatar="'+esc(b.id)+'" src="'+esc(chiefPet.avatar(b.id)||window.AssistantProfiles?.avatarSource(b.avatar)||'')+'" width="96" height="96" alt="" decoding="async" draggable="false">';
  }
  if(slot==='home')return fallbackAvatar(b,slot);
  let slotAttr=b.id==='chief'&&['home','header'].includes(slot)?' data-chief-slot="'+slot+'"':'';
  let homeFallback=b.id==='chief'&&slot==='home';
  if(homeFallback)slotAttr+=' data-chief-face="'+chiefFaceName()+'"';
  let faceCards=!homeFallback&&b.id==='chief'&&b.faces&&b.avatarSrc===b.faces.normal;
  let daily=!b.outfitId||['default','daily'].includes(b.outfitId);
  let src=homeFallback?'':localAvatarSource(outfit?.avatarSrc||(faceCards&&!daily?'':b.avatarSrc));
  if(faceCards&&daily&&!outfit?.avatarSrc){
    let face=chiefFaceName(),still=localAvatarSource(b.faces[face])||src;
    let attrs=' data-bot-avatar="chief" data-avatar-outfit="'+esc(outfit?.id||'default')+'" data-chief-face="'+face+'"'+slotAttr;
    let imageAttrs=' width="120" height="120" alt="" decoding="async" draggable="false"';
    if(face==='thinking')return '<picture class="creature bot-avatar"'+attrs+'><source media="(prefers-reduced-motion: reduce)" srcset="'+esc(still)+'"><img class="creature bot-avatar" src="'+esc(localAvatarSource(b.faces.thinkingAnim)||still)+'"'+imageAttrs+'></picture>';
    return '<img class="creature bot-avatar"'+attrs+' src="'+esc(still)+'"'+imageAttrs+'>';
  }
  if(src)return '<img class="creature bot-avatar"'+slotAttr+' data-bot-avatar="'+esc(b.id)+'" data-avatar-outfit="'+esc(outfit?.id||'default')+'" src="'+esc(src)+'" width="120" height="120" alt="" decoding="async" draggable="false">';
  if(b.avatarGlyph)return '<svg class="creature bot-avatar" data-bot-avatar="'+esc(b.id)+'" data-avatar-glyph="'+esc(b.avatarGlyph)+'" viewBox="0 0 120 120" aria-hidden="true"><rect x="6" y="6" width="108" height="108" rx="36" fill="'+esc(b.color)+demoText("core.sample.49")+esc(b.colorInk)+'">'+esc(b.avatarGlyph)+'</text></svg>';
  return fallbackAvatar(b,slot);
}
function botStyle(id){
  let b=botBy(assistantId(id))||botBy(state.bot);
  return '--bot:'+b.color+';--bot-ink:'+b.colorInk+';--bot-strong:light-dark('+b.colorStrong+', '+b.color+');--bot-soft:color-mix(in srgb, var(--bot) 18%, var(--elev));--sage:var(--bot-strong);--sage-soft:var(--bot-soft)';
}
function contentBot(){return state.mode==='task'?taskBy(state.taskId).bot:state.bot;}

// Phosphor Icons · MIT · Copyright (c) 2023 Phosphor Icons.
const ICONS={
  "jump":{"regular":"M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z","fill":"M200,64V168a8,8,0,0,1-13.66,5.66L140,127.31,69.66,197.66a8,8,0,0,1-11.32-11.32L128.69,116,82.34,69.66A8,8,0,0,1,88,56H192A8,8,0,0,1,200,64Z"},
  "key":{"regular":"M216.57,39.43A80,80,0,0,0,83.91,120.78L28.69,176A15.86,15.86,0,0,0,24,187.31V216a16,16,0,0,0,16,16H72a8,8,0,0,0,8-8V208H96a8,8,0,0,0,8-8V184h16a8,8,0,0,0,5.66-2.34l9.56-9.57A79.73,79.73,0,0,0,160,176h.1A80,80,0,0,0,216.57,39.43ZM224,98.1c-1.09,34.09-29.75,61.86-63.89,61.9H160a63.7,63.7,0,0,1-23.65-4.51,8,8,0,0,0-8.84,1.68L116.69,168H96a8,8,0,0,0-8,8v16H72a8,8,0,0,0-8,8v16H40V187.31l58.83-58.82a8,8,0,0,0,1.68-8.84A63.72,63.72,0,0,1,96,95.92c0-34.14,27.81-62.8,61.9-63.89A64,64,0,0,1,224,98.1ZM192,76a12,12,0,1,1-12-12A12,12,0,0,1,192,76Z","fill":"M216.57,39.43A80,80,0,0,0,83.91,120.78L28.69,176A15.86,15.86,0,0,0,24,187.31V216a16,16,0,0,0,16,16H72a8,8,0,0,0,8-8V208H96a8,8,0,0,0,8-8V184h16a8,8,0,0,0,5.66-2.34l9.56-9.57A79.73,79.73,0,0,0,160,176h.1A80,80,0,0,0,216.57,39.43ZM180,92a16,16,0,1,1,16-16A16,16,0,0,1,180,92Z"},
  "bell":{"regular":"M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216ZM48,184c7.7-13.24,16-43.92,16-80a64,64,0,1,1,128,0c0,36.05,8.28,66.73,16,80Z","fill":"M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216Z"},
  "grid":{"regular":"M104,40H56A16,16,0,0,0,40,56v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,104,40Zm0,64H56V56h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,64H152V56h48v48Zm-96,32H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm0,64H56V152h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,200,136Zm0,64H152V152h48v48Z","fill":"M120,56v48a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40h48A16,16,0,0,1,120,56Zm80-16H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm-96,96H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm96,0H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,200,136Z"},
  "plus":{"regular":"M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z","fill":"M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM184,136H136v48a8,8,0,0,1-16,0V136H72a8,8,0,0,1,0-16h48V72a8,8,0,0,1,16,0v48h48a8,8,0,0,1,0,16Z"},
  "back":{"regular":"M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z","fill":"M168,48V208a8,8,0,0,1-13.66,5.66l-80-80a8,8,0,0,1,0-11.32l80-80A8,8,0,0,1,168,48Z"},
  "more":{"regular":"M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Z","fill":"M224,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V96A16,16,0,0,0,224,80ZM60,140a12,12,0,1,1,12-12A12,12,0,0,1,60,140Zm68,0a12,12,0,1,1,12-12A12,12,0,0,1,128,140Zm68,0a12,12,0,1,1,12-12A12,12,0,0,1,196,140Z"},
  "search":{"regular":"M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z","fill":"M168,112a56,56,0,1,1-56-56A56,56,0,0,1,168,112Zm61.66,117.66a8,8,0,0,1-11.32,0l-50.06-50.07a88,88,0,1,1,11.32-11.31l50.06,50.06A8,8,0,0,1,229.66,229.66ZM112,184a72,72,0,1,0-72-72A72.08,72.08,0,0,0,112,184Z"},
  "chat":{"regular":"M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z","fill":"M232,128A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Z"},
  "task":{"regular":"M224,128a8,8,0,0,1-8,8H128a8,8,0,0,1,0-16h88A8,8,0,0,1,224,128ZM128,72h88a8,8,0,0,0,0-16H128a8,8,0,0,0,0,16Zm88,112H128a8,8,0,0,0,0,16h88a8,8,0,0,0,0-16ZM82.34,42.34,56,68.69,45.66,58.34A8,8,0,0,0,34.34,69.66l16,16a8,8,0,0,0,11.32,0l32-32A8,8,0,0,0,82.34,42.34Zm0,64L56,132.69,45.66,122.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32,0l32-32a8,8,0,0,0-11.32-11.32Zm0,64L56,196.69,45.66,186.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32,0l32-32a8,8,0,0,0-11.32-11.32Z","fill":"M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM117.66,149.66l-32,32a8,8,0,0,1-11.32,0l-16-16a8,8,0,0,1,11.32-11.32L80,164.69l26.34-26.35a8,8,0,0,1,11.32,11.32Zm0-64-32,32a8,8,0,0,1-11.32,0l-16-16A8,8,0,0,1,69.66,90.34L80,100.69l26.34-26.35a8,8,0,0,1,11.32,11.32ZM192,168H144a8,8,0,0,1,0-16h48a8,8,0,0,1,0,16Zm0-64H144a8,8,0,0,1,0-16h48a8,8,0,0,1,0,16Z"},
  "board":{"regular":"M216,48H40a8,8,0,0,0-8,8V208a16,16,0,0,0,16,16H88a16,16,0,0,0,16-16V160h48v16a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V56A8,8,0,0,0,216,48ZM88,208H48V128H88Zm0-96H48V64H88Zm64,32H104V64h48Zm56,32H168V128h40Zm0-64H168V64h40Z","fill":"M160,56v96a8,8,0,0,1-8,8H112a8,8,0,0,1-8-8V56a8,8,0,0,1,8-8h40A8,8,0,0,1,160,56Zm64-8H184a8,8,0,0,0-8,8v52a4,4,0,0,0,4,4h48a4,4,0,0,0,4-4V56A8,8,0,0,0,224,48Zm4,80H180a4,4,0,0,0-4,4v44a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16V132A4,4,0,0,0,228,128ZM80,48H40a8,8,0,0,0-8,8v52a4,4,0,0,0,4,4H84a4,4,0,0,0,4-4V56A8,8,0,0,0,80,48Zm4,80H36a4,4,0,0,0-4,4v76a16,16,0,0,0,16,16H72a16,16,0,0,0,16-16V132A4,4,0,0,0,84,128Z"},
  "stage":{"regular":"M217,34.8a15.94,15.94,0,0,0-14.82-1.71C188.15,38.55,159.82,47.71,128,47.71S67.84,38.55,53.79,33.09A16,16,0,0,0,32,48v55.77c0,35.84,9.65,69.65,27.18,95.18,18.16,26.46,42.6,41,68.82,41s50.66-14.57,68.82-41C214.35,173.44,224,139.63,224,103.79V48A16,16,0,0,0,217,34.8Zm-9,69c0,32.64-8.66,63.23-24.37,86.13C168.54,211.9,148.79,224,128,224s-40.54-12.1-55.63-34.08C56.66,167,48,136.43,48,103.79V48c15.11,5.87,45.58,15.71,80,15.71S192.9,53.87,208,48v55.81Zm-18,18.87A8,8,0,1,1,178,133.33c-2.68-3-8.85-5.33-14-5.33s-11.36,2.34-14,5.33A8,8,0,1,1,138,122.66c5.71-6.38,16.14-10.66,26-10.66S184.25,116.28,190,122.66ZM92,128c-5.19,0-11.36,2.34-14,5.33A8,8,0,1,1,66,122.66C71.75,116.28,82.18,112,92,112s20.25,4.28,26,10.66A8,8,0,1,1,106,133.33C103.36,130.34,97.19,128,92,128Zm76.45,45.19a52.9,52.9,0,0,1-80.9,0A8,8,0,1,1,99.72,162.8a36.89,36.89,0,0,0,56.56,0,8,8,0,0,1,12.17,10.39Z","fill":"M217,34.8a15.94,15.94,0,0,0-14.82-1.71C188.15,38.55,159.82,47.71,128,47.71S67.84,38.55,53.79,33.09A16,16,0,0,0,32,48v55.77c0,35.84,9.65,69.65,27.18,95.18,18.16,26.46,42.6,41,68.82,41s50.66-14.57,68.82-41C214.35,173.44,224,139.63,224,103.79V48A16,16,0,0,0,217,34.8ZM78,133.33A8,8,0,1,1,66,122.66C71.75,116.28,82.18,112,92,112s20.25,4.28,26,10.66A8,8,0,1,1,106,133.33c-2.68-3-8.85-5.33-14-5.33S80.64,130.34,78,133.33Zm90.49,47.86a52.9,52.9,0,0,1-80.9,0A8,8,0,1,1,99.72,170.8a36.89,36.89,0,0,0,56.56,0,8,8,0,0,1,12.17,10.39ZM189.34,134a8,8,0,0,1-11.3-.63c-2.68-3-8.85-5.33-14-5.33s-11.36,2.34-14,5.33A8,8,0,1,1,138,122.66c5.71-6.38,16.14-10.66,26-10.66s20.25,4.28,26,10.66A8,8,0,0,1,189.34,134Z"},
  "side":{"regular":"M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM40,152H56a8,8,0,0,0,0-16H40V120H56a8,8,0,0,0,0-16H40V88H56a8,8,0,0,0,0-16H40V56H80V200H40Zm176,48H96V56H216V200Z","fill":"M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM64,152H48a8,8,0,0,1,0-16H64a8,8,0,0,1,0,16Zm0-32H48a8,8,0,0,1,0-16H64a8,8,0,0,1,0,16Zm0-32H48a8,8,0,0,1,0-16H64a8,8,0,0,1,0,16ZM216,200H88V56H216V200Z"},
  "mic":{"regular":"M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z","fill":"M80,128V64a48,48,0,0,1,96,0v64a48,48,0,0,1-96,0Zm128,0a8,8,0,0,0-16,0,64,64,0,0,1-128,0,8,8,0,0,0-16,0,80.11,80.11,0,0,0,72,79.6V240a8,8,0,0,0,16,0V207.6A80.11,80.11,0,0,0,208,128Z"},
  "wave":{"regular":"M56,96v64a8,8,0,0,1-16,0V96a8,8,0,0,1,16,0ZM88,24a8,8,0,0,0-8,8V224a8,8,0,0,0,16,0V32A8,8,0,0,0,88,24Zm40,32a8,8,0,0,0-8,8V192a8,8,0,0,0,16,0V64A8,8,0,0,0,128,56Zm40,32a8,8,0,0,0-8,8v64a8,8,0,0,0,16,0V96A8,8,0,0,0,168,88Zm40-16a8,8,0,0,0-8,8v96a8,8,0,0,0,16,0V80A8,8,0,0,0,208,72Z","fill":"M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM72,152a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm32,32a8,8,0,0,1-16,0V72a8,8,0,0,1,16,0Zm32-16a8,8,0,0,1-16,0V88a8,8,0,0,1,16,0Zm32-16a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm32,8a8,8,0,0,1-16,0V96a8,8,0,0,1,16,0Z"},
  "send":{"regular":"M205.66,117.66a8,8,0,0,1-11.32,0L136,59.31V216a8,8,0,0,1-16,0V59.31L61.66,117.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,205.66,117.66Z","fill":"M207.39,115.06A8,8,0,0,1,200,120H136v96a8,8,0,0,1-16,0V120H56a8,8,0,0,1-5.66-13.66l72-72a8,8,0,0,1,11.32,0l72,72A8,8,0,0,1,207.39,115.06Z"},
  "stop":{"regular":"M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,160H56V56H200V200Z","fill":"M216,56V200a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40H200A16,16,0,0,1,216,56Z"},
  "close":{"regular":"M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z","fill":"M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM181.66,170.34a8,8,0,0,1-11.32,11.32L128,139.31,85.66,181.66a8,8,0,0,1-11.32-11.32L116.69,128,74.34,85.66A8,8,0,0,1,85.66,74.34L128,116.69l42.34-42.35a8,8,0,0,1,11.32,11.32L139.31,128Z"},
  "chevron":{"regular":"M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z","fill":"M181.66,133.66l-80,80A8,8,0,0,1,88,208V48a8,8,0,0,1,13.66-5.66l80,80A8,8,0,0,1,181.66,133.66Z"},
  "down":{"regular":"M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z","fill":"M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,48,88H208a8,8,0,0,1,5.66,13.66Z"},
  "sun":{"regular":"M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z","fill":"M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm8,24a64,64,0,1,0,64,64A64.07,64.07,0,0,0,128,64ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"},
  "settings":{"regular":"M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm109.94-52.79a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A112.1,112.1,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.62a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21Zm-15,34.91-28.57,16.25a8,8,0,0,0-3,3c-.58,1-1.19,2.06-1.81,3.06a7.94,7.94,0,0,0-1.22,4.21l-.15,32.25a95.89,95.89,0,0,1-25.37,14.3L134,199.13a8,8,0,0,0-3.91-1h-.19c-1.21,0-2.43,0-3.64,0a8.08,8.08,0,0,0-4.1,1l-28.84,16.1A96,96,0,0,1,67.88,201l-.11-32.2a8,8,0,0,0-1.22-4.22c-.62-1-1.23-2-1.8-3.06a8.09,8.09,0,0,0-3-3.06l-28.6-16.29a90.49,90.49,0,0,1,0-28.26L61.67,97.63a8,8,0,0,0,3-3c.58-1,1.19-2.06,1.81-3.06a7.94,7.94,0,0,0,1.22-4.21l.15-32.25a95.89,95.89,0,0,1,25.37-14.3L122,56.87a8,8,0,0,0,4.1,1c1.21,0,2.43,0,3.64,0a8.08,8.08,0,0,0,4.1-1l28.84-16.1A96,96,0,0,1,188.12,55l.11,32.2a8,8,0,0,0,1.22,4.22c.62,1,1.23,2,1.8,3.06a8.09,8.09,0,0,0,3,3.06l28.6,16.29A90.49,90.49,0,0,1,222.9,142.12Z","fill":"M237.94,107.21a8,8,0,0,0-3.89-5.4l-29.83-17-.12-33.62a8,8,0,0,0-2.83-6.08,111.91,111.91,0,0,0-36.72-20.67,8,8,0,0,0-6.46.59L128,41.85,97.88,25a8,8,0,0,0-6.47-.6A111.92,111.92,0,0,0,54.73,45.15a8,8,0,0,0-2.83,6.07l-.15,33.65-29.83,17a8,8,0,0,0-3.89,5.4,106.47,106.47,0,0,0,0,41.56,8,8,0,0,0,3.89,5.4l29.83,17,.12,33.63a8,8,0,0,0,2.83,6.08,111.91,111.91,0,0,0,36.72,20.67,8,8,0,0,0,6.46-.59L128,214.15,158.12,231a7.91,7.91,0,0,0,3.9,1,8.09,8.09,0,0,0,2.57-.42,112.1,112.1,0,0,0,36.68-20.73,8,8,0,0,0,2.83-6.07l.15-33.65,29.83-17a8,8,0,0,0,3.89-5.4A106.47,106.47,0,0,0,237.94,107.21ZM128,168a40,40,0,1,1,40-40A40,40,0,0,1,128,168Z"},
  "usage":{"regular":"M224,200h-8V40a8,8,0,0,0-8-8H152a8,8,0,0,0-8,8V80H96a8,8,0,0,0-8,8v40H48a8,8,0,0,0-8,8v64H32a8,8,0,0,0,0,16H224a8,8,0,0,0,0-16ZM160,48h40V200H160ZM104,96h40V200H104ZM56,144H88v56H56Z","fill":"M232,208a8,8,0,0,1-8,8H32a8,8,0,0,1,0-16h8V136a8,8,0,0,1,8-8H72a8,8,0,0,1,8,8v64H96V88a8,8,0,0,1,8-8h32a8,8,0,0,1,8,8V200h16V40a8,8,0,0,1,8-8h40a8,8,0,0,1,8,8V200h8A8,8,0,0,1,232,208Z"},
  "context":{"regular":"M230.91,172A8,8,0,0,1,228,182.91l-96,56a8,8,0,0,1-8.06,0l-96-56A8,8,0,0,1,36,169.09l92,53.65,92-53.65A8,8,0,0,1,230.91,172ZM220,121.09l-92,53.65L36,121.09A8,8,0,0,0,28,134.91l96,56a8,8,0,0,0,8.06,0l96-56A8,8,0,1,0,220,121.09ZM24,80a8,8,0,0,1,4-6.91l96-56a8,8,0,0,1,8.06,0l96,56a8,8,0,0,1,0,13.82l-96,56a8,8,0,0,1-8.06,0l-96-56A8,8,0,0,1,24,80Zm23.88,0L128,126.74,208.12,80,128,33.26Z","fill":"M220,169.09l-92,53.65L36,169.09A8,8,0,0,0,28,182.91l96,56a8,8,0,0,0,8.06,0l96-56A8,8,0,1,0,220,169.09Z M220,121.09l-92,53.65L36,121.09A8,8,0,0,0,28,134.91l96,56a8,8,0,0,0,8.06,0l96-56A8,8,0,1,0,220,121.09Z M28,86.91l96,56a8,8,0,0,0,8.06,0l96-56a8,8,0,0,0,0-13.82l-96-56a8,8,0,0,0-8.06,0l-96,56a8,8,0,0,0,0,13.82Z"},
  "tools":{"regular":"M226.76,69a8,8,0,0,0-12.84-2.88l-40.3,37.19-17.23-3.7-3.7-17.23,37.19-40.3A8,8,0,0,0,187,29.24,72,72,0,0,0,88,96,72.34,72.34,0,0,0,94,124.94L33.79,177c-.15.12-.29.26-.43.39a32,32,0,0,0,45.26,45.26c.13-.13.27-.28.39-.42L131.06,162A72,72,0,0,0,232,96,71.56,71.56,0,0,0,226.76,69ZM160,152a56.14,56.14,0,0,1-27.07-7,8,8,0,0,0-9.92,1.77L67.11,211.51a16,16,0,0,1-22.62-22.62L109.18,133a8,8,0,0,0,1.77-9.93,56,56,0,0,1,58.36-82.31l-31.2,33.81a8,8,0,0,0-1.94,7.1L141.83,108a8,8,0,0,0,6.14,6.14l26.35,5.66a8,8,0,0,0,7.1-1.94l33.81-31.2A56.06,56.06,0,0,1,160,152Z","fill":"M232,96a72,72,0,0,1-100.94,66L79,222.22c-.12.14-.26.29-.39.42a32,32,0,0,1-45.26-45.26c.14-.13.28-.27.43-.39L94,124.94a72.07,72.07,0,0,1,83.54-98.78,8,8,0,0,1,3.93,13.19L144,80l5.66,26.35L176,112l40.65-37.52a8,8,0,0,1,13.19,3.93A72.6,72.6,0,0,1,232,96Z"},
  "file":{"regular":"M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,136Zm0,32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,168Z","fill":"M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,176H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm0-32H96a8,8,0,0,1,0-16h64a8,8,0,0,1,0,16Zm-8-56V44l44,44Z"},
  "clock":{"regular":"M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm64-88a8,8,0,0,1-8,8H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48A8,8,0,0,1,192,128Z","fill":"M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm56,112H128a8,8,0,0,1-8-8V72a8,8,0,0,1,16,0v48h48a8,8,0,0,1,0,16Z"},
  "memory":{"regular":"M248,124a56.11,56.11,0,0,0-32-50.61V72a48,48,0,0,0-88-26.49A48,48,0,0,0,40,72v1.39a56,56,0,0,0,0,101.2V176a48,48,0,0,0,88,26.49A48,48,0,0,0,216,176v-1.41A56.09,56.09,0,0,0,248,124ZM88,208a32,32,0,0,1-31.81-28.56A55.87,55.87,0,0,0,64,180h8a8,8,0,0,0,0-16H64A40,40,0,0,1,50.67,86.27,8,8,0,0,0,56,78.73V72a32,32,0,0,1,64,0v68.26A47.8,47.8,0,0,0,88,128a8,8,0,0,0,0,16,32,32,0,0,1,0,64Zm104-44h-8a8,8,0,0,0,0,16h8a55.87,55.87,0,0,0,7.81-.56A32,32,0,1,1,168,144a8,8,0,0,0,0-16,47.8,47.8,0,0,0-32,12.26V72a32,32,0,0,1,64,0v6.73a8,8,0,0,0,5.33,7.54A40,40,0,0,1,192,164Zm16-52a8,8,0,0,1-8,8h-4a36,36,0,0,1-36-36V80a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4A8,8,0,0,1,208,112ZM60,120H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,84V80a8,8,0,0,1,16,0v4A36,36,0,0,1,60,120Z","fill":"M212,76V72a44,44,0,0,0-74.86-31.31,3.93,3.93,0,0,0-1.14,2.8v88.72a4,4,0,0,0,6.2,3.33A47.67,47.67,0,0,1,167.68,128a8.18,8.18,0,0,1,8.31,7.58,8,8,0,0,1-8,8.42,32,32,0,0,0-32,32v33.88a4,4,0,0,0,1.49,3.12,47.92,47.92,0,0,0,74.21-17.16,4,4,0,0,0-4.49-5.56A68.06,68.06,0,0,1,192,192h-7.73a8.18,8.18,0,0,1-8.25-7.47,8,8,0,0,1,8-8.53h8a51.6,51.6,0,0,0,24-5.88v0A52,52,0,0,0,212,76Zm-12,36h-4a36,36,0,0,1-36-36V72a8,8,0,0,1,16,0v4a20,20,0,0,0,20,20h4a8,8,0,0,1,0,16ZM88,28A44.05,44.05,0,0,0,44,72v4a52,52,0,0,0-4,94.12h0A51.6,51.6,0,0,0,64,176h7.73A8.18,8.18,0,0,1,80,183.47,8,8,0,0,1,72,192H64a67.48,67.48,0,0,1-15.21-1.73,4,4,0,0,0-4.5,5.55A47.93,47.93,0,0,0,118.51,213a4,4,0,0,0,1.49-3.12V176a32,32,0,0,0-32-32,8,8,0,0,1-8-8.42A8.18,8.18,0,0,1,88.32,128a47.67,47.67,0,0,1,25.48,7.54,4,4,0,0,0,6.2-3.33V43.49a4,4,0,0,0-1.14-2.81A43.85,43.85,0,0,0,88,28Zm8,48a36,36,0,0,1-36,36H56a8,8,0,0,1,0-16h4A20,20,0,0,0,80,76V72a8,8,0,0,1,16,0Z"},
  "shield":{"regular":"M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM82.34,141.66a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32l-56,56a8,8,0,0,1-11.32,0Z","fill":"M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm-34.32,69.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"},
  "play":{"regular":"M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z","fill":"M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z"},
  "copy":{"regular":"M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z","fill":"M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32Zm-8,128H176V88a8,8,0,0,0-8-8H96V48H208Z"},
  "retry":{"regular":"M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16H211.4L184.81,71.64l-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,0,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60L224,85.8V56a8,8,0,1,1,16,0Z","fill":"M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1-5.66-13.66l17-17-10.55-9.65-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,1,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60l10.93,10L226.34,50.3A8,8,0,0,1,240,56Z"},
  "branch":{"regular":"M232,64a32,32,0,1,0-40,31v17a8,8,0,0,1-8,8H96a23.84,23.84,0,0,0-8,1.38V95a32,32,0,1,0-16,0v66a32,32,0,1,0,16,0V144a8,8,0,0,1,8-8h88a24,24,0,0,0,24-24V95A32.06,32.06,0,0,0,232,64ZM64,64A16,16,0,1,1,80,80,16,16,0,0,1,64,64ZM96,192a16,16,0,1,1-16-16A16,16,0,0,1,96,192ZM200,80a16,16,0,1,1,16-16A16,16,0,0,1,200,80Z","fill":"M232,64a32,32,0,1,0-40,31v17a8,8,0,0,1-8,8H96a23.84,23.84,0,0,0-8,1.38V95a32,32,0,1,0-16,0v66a32,32,0,1,0,16,0V144a8,8,0,0,1,8-8h88a24,24,0,0,0,24-24V95A32.06,32.06,0,0,0,232,64ZM64,64A16,16,0,1,1,80,80,16,16,0,0,1,64,64ZM96,192a16,16,0,1,1-16-16A16,16,0,0,1,96,192Z"},
  "quote":{"regular":"M100,56H40A16,16,0,0,0,24,72v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,100,56Zm0,80H40V72h60ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Zm0,80H156V72h60Z","fill":"M116,72v88a48.05,48.05,0,0,1-48,48,8,8,0,0,1,0-16,32,32,0,0,0,32-32v-8H40a16,16,0,0,1-16-16V72A16,16,0,0,1,40,56h60A16,16,0,0,1,116,72ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Z"},
  "folder":{"regular":"M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40ZM216,200H40V88H216Z","fill":"M216,72H131.31L104,44.69A15.88,15.88,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.41,15.41,0,0,0,39.39,216h177.5A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40Z"},
  "jobs":{"regular":"M128,128a8,8,0,0,1-3,6.25l-40,32a8,8,0,1,1-10-12.5L107.19,128,75,102.25a8,8,0,1,1,10-12.5l40,32A8,8,0,0,1,128,128Zm48,24H136a8,8,0,0,0,0,16h40a8,8,0,0,0,0-16Zm56-96V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56ZM216,200V56H40V200H216Z","fill":"M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm-91,94.25-40,32a8,8,0,1,1-10-12.5L107.19,128,75,102.25a8,8,0,1,1,10-12.5l40,32a8,8,0,0,1,0,12.5ZM176,168H136a8,8,0,0,1,0-16h40a8,8,0,0,1,0,16Z"},
  "link":{"regular":"M240,88.23a54.43,54.43,0,0,1-16,37L189.25,160a54.27,54.27,0,0,1-38.63,16h-.05A54.63,54.63,0,0,1,96,119.84a8,8,0,0,1,16,.45A38.62,38.62,0,0,0,150.58,160h0a38.39,38.39,0,0,0,27.31-11.31l34.75-34.75a38.63,38.63,0,0,0-54.63-54.63l-11,11A8,8,0,0,1,135.7,59l11-11A54.65,54.65,0,0,1,224,48,54.86,54.86,0,0,1,240,88.23ZM109,185.66l-11,11A38.41,38.41,0,0,1,70.6,208h0a38.63,38.63,0,0,1-27.29-65.94L78,107.31A38.63,38.63,0,0,1,144,135.71a8,8,0,0,0,16,.45A54.86,54.86,0,0,0,144,96a54.65,54.65,0,0,0-77.27,0L32,130.75A54.62,54.62,0,0,0,70.56,224h0a54.28,54.28,0,0,0,38.64-16l11-11A8,8,0,0,0,109,185.66Z","fill":"M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM115.7,192.49a43.31,43.31,0,0,1-55-66.43l25.37-25.37a43.35,43.35,0,0,1,61.25,0,42.9,42.9,0,0,1,9.95,15.43,8,8,0,1,1-15,5.6A27.33,27.33,0,0,0,97.37,112L72,137.37a27.32,27.32,0,0,0,34.68,41.91,8,8,0,1,1,9,13.21Zm79.61-62.55-25.37,25.37A43,43,0,0,1,139.32,168h0a43.35,43.35,0,0,1-40.53-28.12,8,8,0,1,1,15-5.6A27.35,27.35,0,0,0,139.28,152h0a27.14,27.14,0,0,0,19.32-8L184,118.63a27.32,27.32,0,0,0-34.68-41.91,8,8,0,1,1-9-13.21,43.32,43.32,0,0,1,55,66.43Z"},
  "pin":{"regular":"M235.32,81.37,174.63,20.69a16,16,0,0,0-22.63,0L98.37,74.49c-10.66-3.34-35-7.37-60.4,13.14a16,16,0,0,0-1.29,23.78L85,159.71,42.34,202.34a8,8,0,0,0,11.32,11.32L96.29,171l48.29,48.29A16,16,0,0,0,155.9,224c.38,0,.75,0,1.13,0a15.93,15.93,0,0,0,11.64-6.33c19.64-26.1,17.75-47.32,13.19-60L235.33,104A16,16,0,0,0,235.32,81.37ZM224,92.69h0l-57.27,57.46a8,8,0,0,0-1.49,9.22c9.46,18.93-1.8,38.59-9.34,48.62L48,100.08c12.08-9.74,23.64-12.31,32.48-12.31A40.13,40.13,0,0,1,96.81,91a8,8,0,0,0,9.25-1.51L163.32,32,224,92.68Z","fill":"M235.33,104l-53.47,53.65c4.56,12.67,6.45,33.89-13.19,60A15.93,15.93,0,0,1,157,224c-.38,0-.75,0-1.13,0a16,16,0,0,1-11.32-4.69L96.29,171,53.66,213.66a8,8,0,0,1-11.32-11.32L85,159.71l-48.3-48.3A16,16,0,0,1,38,87.63c25.42-20.51,49.75-16.48,60.4-13.14L152,20.7a16,16,0,0,1,22.63,0l60.69,60.68A16,16,0,0,1,235.33,104Z"},
  "check":{"regular":"M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z","fill":"M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM205.66,85.66l-96,96a8,8,0,0,1-11.32,0l-40-40a8,8,0,0,1,11.32-11.32L104,164.69l90.34-90.35a8,8,0,0,1,11.32,11.32Z"},
  "headphones":{"regular":"M201.89,54.66A103.43,103.43,0,0,0,128.79,24H128A104,104,0,0,0,24,128v56a24,24,0,0,0,24,24H64a24,24,0,0,0,24-24V144a24,24,0,0,0-24-24H40.36A88,88,0,0,1,128,40h.67a87.71,87.71,0,0,1,87,80H192a24,24,0,0,0-24,24v40a24,24,0,0,0,24,24h16a24,24,0,0,0,24-24V128A103.41,103.41,0,0,0,201.89,54.66ZM64,136a8,8,0,0,1,8,8v40a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V136Zm152,48a8,8,0,0,1-8,8H192a8,8,0,0,1-8-8V144a8,8,0,0,1,8-8h24Z","fill":"M232,128v56a24,24,0,0,1-24,24H192a24,24,0,0,1-24-24V144a24,24,0,0,1,24-24h23.65a87.71,87.71,0,0,0-87-80H128a88,88,0,0,0-87.64,80H64a24,24,0,0,1,24,24v40a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V128A104.11,104.11,0,0,1,201.89,54.66,103.41,103.41,0,0,1,232,128Z"},
  "image":{"regular":"M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z","fill":"M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM156,88a12,12,0,1,1-12,12A12,12,0,0,1,156,88Zm60,112H40V160.69l46.34-46.35a8,8,0,0,1,11.32,0h0L165,181.66a8,8,0,0,0,11.32-11.32l-17.66-17.65L173,138.34a8,8,0,0,1,11.31,0L216,170.07V200Z"},
  "star":{"regular":"M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.38,16.38,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,5.47-48.7,42a8,8,0,0,0-2.56,7.91l14.88,62.8a.37.37,0,0,1-.17.48c-.18.14-.23.11-.38,0l-54.72-33.65a8,8,0,0,0-8.38,0L69.09,215.94c-.15.09-.19.12-.38,0a.37.37,0,0,1-.17-.48l14.88-62.8a8,8,0,0,0-2.56-7.91l-48.7-42c-.12-.1-.23-.19-.13-.5s.18-.27.33-.29l63.92-5.16A8,8,0,0,0,103,91.86l24.62-59.61c.08-.17.11-.25.35-.25s.27.08.35.25L153,91.86a8,8,0,0,0,6.75,4.92l63.92,5.16c.15,0,.24,0,.33.29S224,102.63,223.84,102.73Z","fill":"M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z"},
  "sparkle":{"regular":"M197.58,129.06,146,110l-19-51.62a15.92,15.92,0,0,0-29.88,0L78,110l-51.62,19a15.92,15.92,0,0,0,0,29.88L78,178l19,51.62a15.92,15.92,0,0,0,29.88,0L146,178l51.62-19a15.92,15.92,0,0,0,0-29.88ZM137,164.22a8,8,0,0,0-4.74,4.74L112,223.85,91.78,169A8,8,0,0,0,87,164.22L32.15,144,87,123.78A8,8,0,0,0,91.78,119L112,64.15,132.22,119a8,8,0,0,0,4.74,4.74L191.85,144ZM144,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H184V64a8,8,0,0,1-16,0V48H152A8,8,0,0,1,144,40ZM248,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,248,88Z","fill":"M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19,51.62a15.92,15.92,0,0,1-29.88,0L78,178l-51.62-19a15.92,15.92,0,0,1,0-29.88L78,110l19-51.62a15.92,15.92,0,0,1,29.88,0L146,110l51.62,19A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z"},
  "check-circle":{"regular":"M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z","fill":"M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"},
  "warning":{"regular":"M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z","fill":"M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z"},
  "arrow-left":{"regular":"M224,128a8,8,0,0,1-8,8H59.31l58.35,58.34a8,8,0,0,1-11.32,11.32l-72-72a8,8,0,0,1,0-11.32l72-72a8,8,0,0,1,11.32,11.32L59.31,120H216A8,8,0,0,1,224,128Z","fill":"M224,128a8,8,0,0,1-8,8H120v64a8,8,0,0,1-13.66,5.66l-72-72a8,8,0,0,1,0-11.32l72-72A8,8,0,0,1,120,56v64h96A8,8,0,0,1,224,128Z"},
  "caret-up":{"regular":"M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z","fill":"M215.39,163.06A8,8,0,0,1,208,168H48a8,8,0,0,1-5.66-13.66l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,215.39,163.06Z"},
  "funnel":{"regular":"M230.6,49.53A15.81,15.81,0,0,0,216,40H40A16,16,0,0,0,28.19,66.76l.08.09L96,139.17V216a16,16,0,0,0,24.87,13.32l32-21.34A16,16,0,0,0,160,194.66V139.17l67.74-72.32.08-.09A15.8,15.8,0,0,0,230.6,49.53ZM40,56h0Zm106.18,74.58A8,8,0,0,0,144,136v58.66L112,216V136a8,8,0,0,0-2.16-5.47L40,56H216Z","fill":"M227.81,66.76l-.08.09L160,139.17v55.49A16,16,0,0,1,152.87,208l-32,21.34A16,16,0,0,1,96,216V139.17L28.27,66.85l-.08-.09A16,16,0,0,1,40,40H216a16,16,0,0,1,11.84,26.76Z"}
};
function ico(name,options){
  var glyph=Object.prototype.hasOwnProperty.call(ICONS,name)?ICONS[name]:ICONS.file;
  return '<svg class="icon'+(options&&options.fill?' icon-fill':'')+'" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor"><path class="icon-regular" d="'+glyph.regular+'"/><path class="icon-filled" d="'+glyph.fill+'"/></svg>';
}
function r22Icon(name){
  var paths={back:'<path d="m15 5-7 7 7 7"/>',menu:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>',mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',send:'<path d="m5 12 14-7-5 14-2-7zM12 12l7-7"/>',wave:'<path d="M5 10v4M8.5 7v10M12 4v16M15.5 7v10M19 10v4"/>',file:'<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4"/>'};
  return paths[name]?demoText("core.sample.50")+paths[name]+'</svg>':ico(name);
}
function r22Nameplate(id,suffix){return '<span class="r22-nameplate" data-nameplate-bot="'+esc(id)+'" style="'+botStyle(id)+'">'+esc(botBy(id)?.name||'助理')+(suffix?' · '+esc(suffix):'')+'</span>';}
function ib(name,act,label,extra='',cls=''){return '<button type="button" class="iconbtn '+cls+'" data-act="'+act+'" aria-label="'+label+'" title="'+label+'" '+extra+'>'+ico(name)+'</button>'}
function ring(p){return '<svg class="ring" viewBox="0 0 40 40" aria-hidden="true" style="--pct:'+p+';--ring-color:'+(p>=80?'var(--danger)':'var(--sage)')+'"><circle cx="20" cy="20" r="16" pathLength="100"/><circle class="value" cx="20" cy="20" r="16" pathLength="100"/></svg>'}
function contextPct(){var c=Hub.contextSnapshot(state.conversation);return c?Math.round(c.total/c.max*100):0}
function nav(mobile=false){return '<nav class="'+(mobile?'tabbar glass':'navmodes')+'" aria-label="工作形态">'+[['chat','聊天'],['task','任务'],['kanban','看板'],['stage','舞台']].filter(([id])=>!(id==='task'&&document.documentElement.dataset.hubMode==='real')).map(([id,n])=>'<button data-act="mode" data-mode="'+id+'" class="'+(state.mode===id?'on':'')+'" aria-pressed="'+(state.mode===id)+'">'+(mobile?ico(id==='kanban'?'board':id,{fill:state.mode===id}):'')+n+'</button>').join('')+(!mobile&&Hub.hasExtraViews()?'<button class="hub-view-more" data-act="more">更多 '+ico('more')+'</button>':'')+'</nav>'}
function projectSelect(){return '<div class="projectpicker">'+ico('folder')+'<select data-change="project" aria-label="当前项目">'+PROJECTS.map(p=>'<option value="'+p.id+'" '+(p.id===state.project?'selected':'')+'>'+p.name+'</option>').join('')+'</select></div>'}
// 最近列表以消息发生时间为准；没有时间的历史不补成“刚刚”。
function r25MessageStamp(message){
  var value=message?.ts??message?.recentAt,stamp=typeof value==='number'?value:typeof value==='string'&&value.trim()?Date.parse(value):0;
  if(Number.isFinite(stamp)&&stamp>0)return stamp;
  var match=String(message?.time||'').match(/^(今天\s*|昨天\s*)?(\d{1,2}):(\d{2})$/);
  if(!match||Number(match[2])>23||Number(match[3])>59)return 0;
  var date=new Date();date.setHours(Number(match[2]),Number(match[3]),0,0);if(match[1]?.trim()==='昨天')date.setDate(date.getDate()-1);return date.getTime();
}
function r25RecentStamp(entry){
  var messages=entry.taskId?Hub.taskMessages(entry.taskId):Hub.assistantMessages(entry.id),latest=messages.reduce((time,message)=>Math.max(time,r25MessageStamp(message)),0);
  return latest||(Number.isFinite(entry.updatedAt)&&entry.updatedAt>0?entry.updatedAt:0);
}
function r25RecentLabel(stamp){
  if(!stamp)return '—';var date=new Date(stamp),today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1);
  var prefix=date.toDateString()===today.toDateString()?'':date.toDateString()===yesterday.toDateString()?'昨天 ':date.getMonth()+1+'/'+date.getDate()+' ';
  return prefix+String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0');
}
function r29Face(id, px) {
  if (window.HubAvatars && typeof HubAvatars.html === 'function') return HubAvatars.html(id, px);
  return avatar(id);
}
function r29ConfirmLead(id, suffix) {
  var lead = r22Nameplate(id, suffix);
  var api = window.HubAvatars;
  if (!api || typeof api.html !== 'function') return lead;
  return '<span class="r29-confirm-face">' + api.html(id, 32) + '</span>' + lead;
}
function r29Stack(ids, px) {
  if (window.HubAvatars && typeof HubAvatars.stackHtml === 'function') return HubAvatars.stackHtml(ids, px);
  return (Array.isArray(ids) ? ids : []).map(function (id) { return r29Face(id, px); }).join('');
}
function r29Real() {
  return document.documentElement.dataset.hubMode === 'real';
}
function r29HookCounts() {
  var api = window.HubUnread;
  if (!api || typeof api.counts !== 'function') return null;
  try {
    var raw = api.counts() || {};
    return {conversations: raw.conversations || {}, bots: raw.bots || {}, groups: raw.groups || {}};
  } catch (e) { return null; }
}
function r29UnreadText(n) {
  n = Number(n) || 0;
  if (n <= 0) return '';
  return n > 99 ? '99+' : '+' + n;
}
function r29UnreadHtml(n, extra) {
  var text = r29UnreadText(n);
  if (!text) return '';
  var cls = 'bot-unread r29-unread' + (extra ? ' ' + extra : '');
  return '<b class="' + cls + '" data-r29-unread="' + esc(text) + '" aria-label="' +
    esc('未读 ' + text) + '">' + esc(text) + '</b>';
}
function r29BotUnread(bot) {
  var counts = r29HookCounts();
  if (counts) return Number(counts.bots && counts.bots[bot.id]) || 0;
  if (r29Real()) return 0;
  return Number(bot && bot.unread) || 0;
}
function r29ConvId(entry) {
  if (!entry) return '';
  if (Array.isArray(entry.members)) return entry.conversation || entry.id || '';
  if (entry.taskId) return entry.conversation || (entry.taskId + '-013');
  var id = entry.id || '';
  return /-013$/.test(id) ? id : id + '-013';
}
function r29Count(bag, key) {
  if (!bag || !key || !Object.prototype.hasOwnProperty.call(bag, key)) return null;
  return Number(bag[key]) || 0;
}
function r29RowUnread(entry) {
  var counts = r29HookCounts();
  if (counts) {
    if (Array.isArray(entry.members)) {
      var group = r29Count(counts.groups, entry.id);
      if (group == null) group = r29Count(counts.groups, entry.conversation);
      return group || 0;
    }
    return r29Count(counts.conversations, r29ConvId(entry)) || 0;
  }
  if (r29Real()) return 0;
  return Number(entry && entry.unread) || 0;
}
function r29Chars(text, n) {
  return Array.from(String(text || '')).slice(0, n).join('');
}
function r29Plain(message) {
  if (!message) return '';
  if (typeof message.text === 'string' && message.text) return message.text;
  try {
    if (window.Hub && typeof Hub.messageText === 'function') {
      var via = Hub.messageText(message);
      if (via) return via;
    }
  } catch (e) {}
  return (message.parts || []).map(function (part) { return part.md || part.text || ''; }).join('\n');
}
function r29Messages(entry) {
  try {
    if (entry.taskId && window.Hub && Hub.taskMessages) return Hub.taskMessages(entry.taskId) || [];
    if (!Array.isArray(entry.members) && window.Hub && Hub.assistantMessages) {
      return Hub.assistantMessages(entry.id) || [];
    }
  } catch (e) {}
  var bag = entry.messages || (state.threads && state.threads[entry.id]) || [];
  return Array.isArray(bag) ? bag : [];
}
function r29FirstBit(entry) {
  var messages = r29Messages(entry);
  var text = messages.length ? r29Plain(messages[0]) : '';
  var sentence = String(text).split(/[。！？\n]/)[0] || '';
  return r29Chars(sentence.trim(), 12);
}
function r29Topic(entry) {
  if (entry.taskId || entry.parent) return entry.taskName || entry.duty || '';
  var titled = entry.title || (state.sessionNames && state.sessionNames[entry.id]) || '';
  if (titled) return titled;
  return r29FirstBit(entry);
}
function r29Title(entry) {
  var topic = r29Topic(entry);
  if (entry.parent) {
    var parent = botBy(entry.parent);
    var parentName = parent && parent.name ? parent.name : '';
    return topic ? parentName + ' · ' + topic : parentName;
  }
  var name = entry.name || '';
  if (!topic || topic === name || topic.indexOf(name + ' · ') === 0) return topic || name;
  return name + ' · ' + topic;
}
function r29Preview(entry) {
  var messages = r29Messages(entry);
  var last = messages.length ? r29Plain(messages[messages.length - 1]) : '';
  last = String(last).replace(/\s+/g, ' ').trim();
  if (!last) {
    var prev = typeof PREV === 'undefined' ? '' : (PREV[entry.id] || '');
    last = entry.note || entry.duty || prev || '';
  }
  if (window.R43Thread) last = R43Thread.topicPreview(entry.id, last);
  return entry.status === 'paused' ? '已暂停 · ' + last : last;
}
function r29Groups() {
  var rows = [], seen = {};
  function take(list) {
    (Array.isArray(list) ? list : []).forEach(function (group) {
      if (!group || !group.id || seen[group.id]) return;
      if (!Array.isArray(group.members) || !group.members.length) return;
      seen[group.id] = true;
      rows.push(group);
    });
  }
  try {
    if (window.HubGroups && typeof HubGroups.list === 'function') take(HubGroups.list());
  } catch (e) {}
  take(state.groups);
  return rows;
}
function r29GroupTopic(group) {
  var topic = group.title || group.topic || '';
  if (topic && topic !== group.name) return topic;
  var messages = Array.isArray(group.messages) ? group.messages : [];
  var text = messages.length ? r29Plain(messages[0]) : '';
  var sentence = String(text).split(/[。！？\n]/)[0] || '';
  return r29Chars(sentence.trim(), 12);
}
function r29GroupTitle(group) {
  var name = group.name || '讨论组';
  var topic = r29GroupTopic(group);
  return topic ? name + ' · ' + topic : name;
}
function r29GroupPreview(group) {
  var messages = Array.isArray(group.messages) ? group.messages : [];
  var last = messages.length ? r29Plain(messages[messages.length - 1]) : '';
  return String(last).replace(/\s+/g, ' ').trim();
}
function r29GroupRow(group) {
  if (!group || (Array.isArray(state.archives) && state.archives.includes(group.id))) return '';
  var time = r25RecentLabel(r25RecentStamp(group));
  var open = group.conversation || group.id || '';
  return '<div class="shell-bot-tree r29-group-tree" data-r29-group="' + esc(group.id) + '">' +
    '<div class="shell-bot-tree-head r22-swipe-row"><button type="button" class="r29-group-row" data-r29-group-open="' +
    esc(open) + '">' + r29Stack(group.members, 40) +
    '<div class="grow"><div class="line"><strong>' + esc(r29GroupTitle(group)) + '</strong></div>' +
    '<div class="preview">' + esc(r29GroupPreview(group)) + '</div></div>' +
    '<span class="home-row-meta"><time>' + esc(time) + '</time>' + r29UnreadHtml(r29RowUnread(group)) +
    '</span></button></div></div>';
}
function sidebar(){
  const assistants=state.bots.filter(b=>!b.steward&&!b.parent&&b.enabled!==false).map(b=>b.id);
  let matches=b=>!state.search||[b.name,b.parent?botBy(b.parent)?.name:'',b.taskName,b.duty,PREV[b.id],...(state.threads[b.id]||[]).map(m=>m.text||Hub.messageText(m))].join(' ').toLowerCase().includes(state.search.toLowerCase());
  let visible=b=>matches(b)||Hub.fixedTasks(b.id).some(t=>matches({name:Hub.fixedTaskTitle(t),duty:t.note}));
  function row(b){
    if(b&&Array.isArray(b.members))return r29GroupRow(b);
    if(state.archives.includes(b.taskId||b.id))return '';var task=b.taskId?b:null;
    if(b.taskId)b={...b,id:b.taskId,parent:b.ownerAssistantId,name:Hub.fixedTaskTitle(b),duty:b.note,unread:b.unread||0};
    var time=r25RecentLabel(r25RecentStamp(task||b));
    return '<div class="shell-bot-tree '+(b.parent?'shell-sub-bot':'')+'" data-bot-tree="'+esc(b.id)+'"><div class="shell-bot-tree-head r22-swipe-row" data-r22-row="'+esc(b.id)+'"><div class="r22-row-actions"><button data-r22-row-action="pin" data-id="'+esc(b.id)+'">'+ico('pin',{fill:state.r22Pinned.includes(b.id)})+'<span>'+(state.r22Pinned.includes(b.id)?'取消置顶':'置顶')+'</span></button><button data-r22-row-action="read" data-id="'+esc(b.id)+'">'+ico('check')+'<span>已读</span></button><button data-r22-row-action="archive" data-id="'+esc(b.id)+'">'+ico('archive')+'<span>归档</span></button></div><button class="conversation '+((b.taskId?Hub.currentTask()?.taskId===b.taskId:state.bot===b.id&&!Hub.currentTask())?'on':'')+'" '+(b.taskId?'':'data-act="bot" ')+(b.taskId?'data-fixed-task-open="'+esc(b.taskId)+'" ':'')+'data-id="'+esc(b.id)+'" aria-current="'+(b.taskId?Hub.currentTask()?.taskId===b.taskId:state.bot===b.id&&!Hub.currentTask())+'" style="'+botStyle(b.parent||b.id)+'">'+r29Face(b.parent||b.id,40)+demoText("core.sample.51")+esc(r29Title(b))+'</strong></div><div class="preview">'+esc(r29Preview(b))+'</div></div><span class="home-row-meta"><time>'+esc(time)+'</time>'+r29UnreadHtml(r29RowUnread(b))+'</span></button></div></div>';
  }
  var grid=assistants.map(botBy).filter(b=>b&&visible(b)).slice(0,9);
  var recent=[...state.bots,...state.fixedTasks,...r29Groups()].filter(b=>b.taskId?matches({name:Hub.fixedTaskTitle(b),duty:b.note}):visible(b)).sort((a,b)=>Number(state.r22Pinned.includes(b.taskId||b.id))-Number(state.r22Pinned.includes(a.taskId||a.id))||r25RecentStamp(b)-r25RecentStamp(a)||Number(!!b.justCreated)-Number(!!a.justCreated)).map(row).join('');
  var busy=assistants.map(botBy).filter(b=>b&&(b.running===true||b.status==='busy')).length;
  var waitingCount=assistants.reduce((n,id)=>n+(Number.isInteger(botBy(id).pending)?botBy(id).pending:state.decisions.filter(d=>d.bot===id&&['pending','edit'].includes(d.status)).length),0);
  var homeStatus=(busy?'<span class="r22-home-busy" role="status">● '+busy+' 在干活</span>':'')+(busy&&waitingCount?' · ':'')+(waitingCount?waitingCount+' 件等你点头':'');
  if(!homeStatus)homeStatus=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric'})+' 周'+['日','一','二','三','四','五','六'][new Date().getDay()];
  var total=state.pendingInputs.length+Hub.activityUnread();
  return '<aside class="sidebar" aria-label="助理与会话"><div class="full home-top r22-home-info"><button class="r22-home-status" data-today-open data-home-status aria-label="查看等你处理的事">'+homeStatus+'</button></div>'+(state.fullMode?'<div class="full full-navigation">'+nav()+'</div>':'')+'<div class="full bot-scroll" data-scroll="bots"><div class="pinned">'+grid.map(b=>'<div class="shell-pinned-tree" data-bot-tree="'+b.id+'"><button class="pin '+(state.bot===b.id?'on':'')+'" data-act="bot" data-id="'+b.id+'" aria-current="'+(state.bot===b.id)+'" style="'+botStyle(b.id)+'"><svg class="r22-role-shape" viewBox="0 0 120 120" aria-hidden="true"><path d="'+esc(b.avatarPath)+'"/></svg><span class="home-role">'+avatar(b.id,'home')+'</span><strong class="r22-nameplate">'+esc(b.name)+'</strong><small data-bot-status>'+((b.running===true||b.status==='busy'||b.pending)?(b.running===true||b.status==='busy'?'<span class="r22-bot-running">● 在干活</span>':'')+((b.running===true||b.status==='busy')&&b.pending?' · ':'')+(b.pending?'<span class="r22-bot-pending">待批 '+b.pending+'</span>':''):(b.status==='paused'?'已暂停 · ':'')+esc(b.homeLabel||SHORT[b.id]||b.duty))+'</small>'+(b.role==='chief'?'<span class="pin-star" aria-label="常用">'+ico('star',{fill:true})+'</span>':'')+r29UnreadHtml(r29BotUnread(b),'home-assistant-unread')+'</button></div>').join('')+'</div><div class="home-recent"><div class="section-label"><span>最近</span></div><div class="home-recent-list" aria-label="最近会话'+(state.bots.some(b=>b.custom)?'，含我的 bot':'')+'">'+recent+'</div></div>'+(!state.bots.some(visible)?'<p class="empty">没有找到这段会话，试试另一关键词。</p>':'')+'</div><nav class="full side-bottom r22-home-dock" aria-label="首页工具栏"><button class="r22-home-tool more-button" data-act="more" aria-label="更多功能" aria-haspopup="dialog">'+ico('grid')+'<span>更多</span></button><label class="searchdock">'+ico('search')+'<input id="botsearch" type="search" value="'+esc(state.search)+'" placeholder="搜索" aria-label="全文搜索助理与会话"></label><button class="r22-home-tool" data-hub-view="kanban" aria-label="看板">'+ico('board')+'<span>看板</span></button><button class="r22-home-tool shell-activity-entry shell-today-entry" data-today-open aria-label="今天 '+total+' 项等你处理">'+ico('sun',{fill:total>0})+'<span>今天</span>'+(total?'<b class="r22-badge" data-r22-activity-total>'+total+'</b>':'')+'</button></nav><div class="compact-bots">'+ib('side','collapse','展开侧栏')+'<button data-activity-open aria-label="活动中心">'+ico('bell')+total+'</button>'+state.bots.filter(b=>!b.steward&&!b.parent).map(b=>'<button data-act="bot" data-id="'+esc(b.id)+'" aria-label="'+esc(b.name)+'">'+avatar(b.id)+'</button>').join('')+ib('grid','more','更多功能')+'</div></aside>';
}
function pageTitle(title,eyebrow){return '<div class="page-title"><p class="eyebrow sticker bot">'+esc(eyebrow||'你的助理们')+'</p><h1>'+esc(title)+'</h1></div>';}
function r25FeatureOwnerHTML(feature){
  var owner=Hub.featureOwner(feature),text='负责：'+(owner?.name||'待指定');
  return owner?'<button class="r25-feature-owner" data-feature-owner="'+esc(owner.id)+'" data-hub-conversation="'+esc(owner.id)+'-013">'+esc(text)+'</button>':'<span class="r25-feature-owner" data-feature-owner="">'+esc(text)+'</span>';
}
function floatingHeader(){
  let feature=state.mode==='feature'?state.featureId:{ledger:'ledger',kanban:'board'}[state.mode],owner=feature?Hub.featureOwner(feature)?.id:null,directory=state.mode==='capabilities',b=botBy(owner||contentBot());
  let title=directory?'能力目录':feature?FEATURE_PAGES.find(p=>p.id===feature).title:Hub.currentTask()?Hub.fixedTaskTitle(Hub.currentTask()):b.name,titleTag=directory?'div':'button';
  let mounts=Hub.memoryMounts(b.id),memoryHTML=state.mode==='chat'?'<button class="shell-memory-mount glass" data-memory-mount="'+esc(b.id)+'" aria-label="查看已挂载记忆">'+(mounts.length?mounts.length+' 个记忆切片 · '+(mounts.reduce((n,s)=>n+s.tokens,0)/1000).toFixed(1)+'k':'未挂载记忆')+'</button>':'';
  if(state.mode==='assistant-profile')return '<header class="floatinghead chat-header r25-feature-header r25-assistant-header"><button class="iconbtn r22-round backbtn" data-act="back" aria-label="返回上一页">'+r22Icon('back')+'</button><div class="page-title r25-feature-title" data-shell-title="assistant-profile"><h1>助理资料</h1></div><button class="r25-feature-owner r25-profile-owner" data-hub-conversation="'+esc(b.id)+'-013" aria-label="和'+esc(b.name)+'说话">'+avatar(b.id)+'<span>'+esc(b.name)+'</span></button></header>';
  if(state.mode==='kanban')return '<header class="floatinghead chat-header r22-board-header r25-feature-header"><button class="iconbtn r22-round backbtn" data-act="back" aria-label="返回助理列表">'+r22Icon('back')+'</button><button class="r22-board-title" data-shell-title="board" data-feature-open="board" aria-label="看板">'+r22App('board')+'<span>看板</span></button>'+r25FeatureOwnerHTML('board')+'<button class="ledger-shortcut" data-hub-view="ledger" aria-label="打开账本">'+ring(contextPct())+'</button></header>';
  if(feature)return '<header class="floatinghead chat-header r25-feature-header"><button class="iconbtn r22-round backbtn" data-act="back" aria-label="返回助理列表">'+r22Icon('back')+'</button><div class="page-title r25-feature-title" data-shell-title="'+esc(feature)+'"><h1>'+esc(title)+'</h1></div>'+r25FeatureOwnerHTML(feature)+'</header>';
  if(state.mode==='chat')return r29ChatHeader(b,title,memoryHTML);
  let action=directory?'':owner?' data-hub-conversation="'+owner+'-013"':' data-act="profile" data-bot-profile="'+b.id+'"';
  return '<header class="floatinghead">'+ib('back','back','返回助理列表','','glass backbtn')+ib('side','collapse',state.collapsed?'展开侧栏':'收起侧栏','','glass sidebtn')+'<div class="shell-title-stack"><'+titleTag+' class="titlepill glass" data-shell-title="'+(directory?'capabilities':b.id)+'"'+action+' aria-label="'+esc(directory?title:owner?'进入 '+b.name+' 会话':'查看 '+title+' 资料')+'" style="'+botStyle(b.id)+'">'+(directory?ico('grid'):feature?r22App(feature):avatar(b.id))+'<div class="grow"><strong>'+esc(title)+'</strong><small>'+(state.mode==='chat'?'<i class="dot"></i><span class="title-model">'+esc(b.brain||state.model)+'</span><span class="longsession"> · '+esc(state.sessionNames[b.id])+'</span>':directory?'说一句，交给负责助理':'进入'+esc(b.name)+'会话')+'</small></div></'+titleTag+'>'+'<div class="shell-title-meta">'+memoryHTML+(state.boardReturn?'<button class="shell-board-return glass" data-act="return-board">'+ico('arrow-left')+' 回看板</button>':'')+'</div></div><button class="iconbtn glass ledger-shortcut" data-hub-view="ledger" aria-label="打开账本">'+ring(contextPct())+'</button><div class="hub-header-status"></div>'+ib('more','more','更多操作','','glass')+'</header>';
}
function usageRows(compact=false){let rows=USAGE_ROWS.map(r=>r.slice());if(!compact)rows.splice(2,0,demoFixture("core.sample.52"));return rows.map(r=>'<div class="usage-row"><div class="row between"><strong>'+r[0]+'</strong><span>'+r[1]+' '+(!compact?' · '+r[2]:'')+'</span></div><div class="bar '+r[5]+'" style="--width:'+r[4]+'%"><i></i></div><small>'+(!compact?'':r[2]+' · ')+r[3]+'</small></div>').join('')}
function trajectory(){return demoText("core.sample.53")}
function rightPanel(){return '<aside class="rightpanel" aria-label="形象与状态"><div class="right-scroll"><div class="right-title"><h3>一起把事情做好</h3>'+ib(state.actor?'stage':'plus','toggle-actor',state.actor?'隐藏形象':'显示形象')+'</div><button class="decision-shortcut" data-activity-open>'+ico('bell',{fill:Hub.activityUnread()>0})+'<div><strong>活动中心</strong><small>准备好了，等你定</small></div><span class="count">'+Hub.activityUnread()+'</span></button>'+(state.actor?'<div class="portrait-card"><div class="portrait-top"><i class="dot"></i> '+(state.running?'思考中':'随时接话')+demoText("core.sample.54")+characterSVG(state.system,state.emotion)+'</div><div class="portrait-caption">'+esc(LINES[state.bot][state.emotion])+'</div></div>':'')+(state.mode==='kanban'||state.mode==='task'?'<div><div class="right-title"><h3>执行轨迹</h3><button class="textbutton" data-act="jobs">后台任务</button></div>'+trajectory()+'</div>':'<div class="source-card"><div class="right-title"><h3>本轮参考</h3><span class="pill neutral">检索完成</span></div><button class="source" data-act="sources">'+ico('file')+demoText("core.sample.55")+ico('memory')+'<span><strong>记得你的工作方式</strong><small>私有记忆 12 条 · 共享规则 8 条</small></span></button></div>')+'</div><div class="usage-compact"><div class="row between"><h3>用量，一眼就好</h3><button class="textbutton" data-act="usage">明细 '+ico('jump')+'</button></div>'+usageRows(true)+'<div class="rail-links"><button data-act="tools">工具箱</button><button data-act="jobs">后台 2</button><button data-act="settings">设置</button></div></div></aside>'}
function toggle(label,key){return '<div class="toggle-row"><span>'+label+demoText("core.sample.56")+(state[key]?'on':'')+demoText("core.sample.57")+!!state[key]+'" data-act="toggle" data-key="'+key+'" aria-label="'+label+'"><i></i></button></div>'}
function shell(){return '<div class="shell '+(state.fullMode?'full-mode ':'simple-mode ')+(state.collapsed?'collapsed ':'')+(state.detail?'mobile-detail ':'')+(state.mode!=='chat'?'non-chat':'')+'" style="'+botStyle(state.bot)+'">'+sidebar()+'<main class="mainpane '+(state.mode!=='chat'?'nonchat':'')+' '+(state.animate?'mode-enter':'')+'" style="'+botStyle(contentBot())+'">'+floatingHeader()+'<div id="hub-view"></div></main>'+(state.fullMode?rightPanel()+nav(true):'')+Hub.floatingCallHTML()+drawerHTML()+'</div>'}
function menuItem(icon,title,sub,act){return '<button data-act="'+act+'">'+ico(icon)+'<span><strong>'+title+'</strong><small>'+sub+'</small></span></button>'}
function r29MoreRow(id,label,extra){return '<button type="button" class="setting-row r29-more-row" data-r29-more="'+id+'"'+(extra||'')+'><span class="grow">'+label+'</span></button>';}
function morePanel(){
  /* 更多第一层只留五项；今天在底栏、看板在底栏、权限和外观在设置里、新建助理在名册里。 */
  var first='<div class="r29-more" data-r29-more-list>'
    +r29MoreRow('roster','助理名册')
    +r29MoreRow('tasks','固定任务')
    +r29MoreRow('ledger','账本')
    +r29MoreRow('settings','设置')
    +r29MoreRow('stop','全部暂停／恢复')
    +'</div><div class="hub-menu-status" hidden></div><div data-hub-more-items></div>';
  var legacy='<div class="r29-legacy" hidden><div class="r22-create-row" aria-label="新建"><button data-new-bot-open>新建助理</button><button data-act="new-session">新会话</button><button data-r22-template-open>从模板</button></div><div class="r22-more-list"><button class="setting-row" data-tour-start>'+ico('play')+'<span class="grow">三分钟看完</span>'+ico('chevron')+'</button><button class="setting-row" data-pending-input-open>'+ico('key')+'<span class="grow">待输入</span><b>'+state.pendingInputs.length+'</b></button><button class="setting-row" data-activity-open>'+ico('bell',{fill:Hub.activityUnread()>0})+'<span class="grow">活动中心</span><b>'+Hub.activityUnread()+'</b></button></div>'+Hub.groupedMenuHTML()+'</div>';
  return first+legacy;
}
function appearancePanel(){return (state.fullMode?'<button class="setting-row" data-act="collapse">'+(state.collapsed?'展开侧栏':'收起侧栏')+'</button>':'')+demoText("core.sample.58")+(state.fullMode?'on':'')+demoText("core.sample.59")+state.fullMode+'" aria-label="完整模式"><i></i></button></div><div class="setting-row"><span class="grow">外观</span><select data-change="theme" aria-label="外观">'+['system','light','dark'].map((t,i)=>'<option value="'+t+'" '+(state.theme===t?'selected':'')+'>'+['跟随系统','白天 · 奶油黄','晚上 · 深紫'][i]+'</option>').join('')+'</select></div><div class="setting-row"><span class="grow">皮肤</span>'+skinSelect()+'</div><details class="more-operations" hidden><summary>会话、文件与更多操作</summary><div class="menu-grid">'+menuItem('memory','助理资料','角色与能力','profile')+menuItem('branch','会话管理','分叉 · 归档 · 全文搜索','sessions')+menuItem('folder','工作区文件','预览与交付物','files')+menuItem('settings','设置','通用与服务','settings')+'</div></details>';}

function usagePanel(){let sets={bot:demoFixture("core.bot.60"),task:TASKS.map(t=>[t.title,botBy(t.bot).name,t.id==='task-cover'?'未知':t.tokens.match(/[\d,]+/)[0]]),model:demoFixture("core.model.61")};return '<p class="muted">演示额度 · 美元为套餐窗口，人民币为费用估算。</p><div class="quota-detail">'+usageRows()+demoText("core.sample.62")+[['bot','按助理'],['task','按任务'],['model','按模型']].map(([k,n])=>'<button data-act="usage-by" data-key="'+k+'" class="'+(state.usageBy===k?'on':'')+'">'+n+'</button>').join('')+'</div><div class="row between" style="margin-top:18px"><h3 style="font-size:13px">11 月 · 最近 7 天</h3><span class="muted">11/'+state.usageDay+'</span></div><div class="heatmap">'+[7,8,9,10,11,12,13].map(d=>'<button data-act="usage-day" data-day="'+d+'" class="'+(state.usageDay===d?'on':'')+'" style="opacity:'+(d===state.usageDay?1:.45+(d%3)*.2)+'" aria-label="筛选11月'+d+'日">'+d+'</button>').join('')+'</div><p class="muted">'+(state.usageDay===13?'11 月 13 日 · 6 条会话':'11 月 '+state.usageDay+' 日 · 1 条演示会话')+'</p><table class="token-table"><thead><tr><th>归属</th><th>模型 / 执行者</th><th>token</th></tr></thead><tbody>'+(state.usageDay===13?sets[state.usageBy]:demoFixture("core.sample.63")).map(r=>'<tr><td><button class="textbutton" data-act="usage-session" style="white-space:normal;text-align:left">'+r[0]+'</button></td><td>'+r[1]+'</td><td>'+r[2]+'</td></tr>').join('')+'</tbody></table><p class="mini-note">7 天 / 30 天均为滚动窗口。未知数字不计入合计；上方会话占用与输入栏使用同一数据。</p>'}
function contextPanel(){var c=Hub.contextSnapshot(state.conversation);return '<p class="mini-note">当前会话窗口 · 本页估算，非累计账单</p><div class="context-big">'+ring(contextPct())+'<strong>'+c.total+' / '+c.max+'</strong></div>'+Object.entries(c.segments).map(([key,n])=>'<div class="setting-row"><span class="grow">'+({system:'系统',memory:'记忆',files:'文件',chat:'对话',tools:'工具结果'})[key]+'</span><strong>'+n+'</strong></div>').join('')+'<button class="ghostbtn" data-context-mix>在聊天里看构成</button>';}

function modelPanel(){
  try{
    if(window.R29Settings&&typeof R29Settings.modelHTML==='function'){
      return R29Settings.modelHTML();
    }
  }catch(error){}
  return '<p class="muted">'+esc(state.model||'')+' · '+esc(state.strength||'')+'</p>';
}
function r29Mode(){var box=window.R29Permission,mode=box&&box.mode;return mode==='ask'||mode==='readonly'||mode==='open'?mode:'open';}
function permissionPanel(){
  var mode=r29Mode();
  var openText='助理直接干活。花钱、对外发送或公开发布、删除、上线或动线上服务，仍然先问你。'+
    '特别危险的事会列清对象和数量，再请你确认一次。';
  var rows=[['open','全开',openText],['ask','改动前问我',''],['readonly','只读','']];
  return (window.R29SettingsUnreadable?'<p role="status">权限读不到，界面按改动前问处理</p>':'')
    +'<div class="r29-permissions" data-r29-permissions role="radiogroup" aria-label="权限">'+rows.map(function(row){
    var on=mode===row[0];
    return '<button type="button" class="r29-permission-choice'+(on?' on':'')+'" role="radio" data-r29-permission="'+row[0]+'" aria-checked="'+(on?'true':'false')+'"><strong>'+row[1]+'</strong>'+(row[2]?'<small>'+row[2]+'</small>':'')+'</button>';
  }).join('')+'</div>';
}
function sourcesPanel(){return demoText("core.sample.68")+ico('jump')+demoText("core.sample.69")}
function profilePanel(){
  var b=botBy(state.bot);
  if(state.botTab)return Hub.botTabsHTML();
  var body='';
  try{
    if(window.R29Settings&&typeof R29Settings.profileHTML==='function'){
      body=R29Settings.profileHTML();
    }
  }catch(error){body='';}
  if(!body&&b){
    body='<p>'+esc(b.name)+'</p><p class="muted">'+esc(b.duty||'')+'</p>';
  }
  return Hub.botTabsHTML()+body;
}
function settingsPanel(){let group=Hub.settingsGroup(state.settingsTab);return '<div class="segmented" aria-label="设置分类">'+[['bot','助理'],['services','连接'],['health','健康'],['general','偏好'],['privacy','隐私与权限']].map(([k,n])=>'<button data-act="settings-tab" data-key="'+k+'" class="'+(group===k?'on':'')+'">'+n+'</button>').join('')+'</div>'+(Hub.hasSettingsPage(state.settingsTab)?'<button class="textbutton" data-act="settings-tab" data-key="'+group+'">返回'+({bot:'助理',services:'连接',health:'健康',general:'偏好',privacy:'隐私与权限'}[group]||'扩展')+'设置</button><div data-hub-settings></div>':({bot:settingsBot,services:settingsServices,health:settingsHealth,general:settingsGeneral,privacy:()=>''}[group]||(()=>''))()+Hub.settingsNavigationHTML(group))}
function settingsBot(){let b=botBy(state.bot),cfg=state.nextBot[b.id]||{model:state.model,strength:state.strength,workspace:'/demo/'+state.project,level:'L1',memory:'私有 + 共享白名单'};return '<div class="setting-row">'+avatar(b.id)+'<span class="grow"><strong>'+esc(b.name)+'</strong><small>单独保存，不影响其他助理</small></span><select data-change="settings-bot" aria-label="选择要配置的助理">'+state.bots.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===b.id?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></div><label class="field">默认模型<select data-config="model">'+Object.keys(MODEL_INFO).map(m=>'<option '+(cfg.model===m?'selected':'')+'>'+m+'</option>').join('')+'</select></label><label class="field">推理强度<select data-config="strength">'+MODEL_INFO[cfg.model].level.map(m=>'<option '+(cfg.strength===m?'selected':'')+'>'+m+'</option>').join('')+'</select></label><label class="field">工作区<input data-config="workspace" value="'+esc(cfg.workspace)+'"></label><label class="field">权限级别<select data-config="level">'+Object.keys(LEVELS).map(x=>'<option value="'+x+'" '+(cfg.level===x?'selected':'')+'>'+x+' · '+LEVELS[x].label+'</option>').join('')+'</select></label><p class="mini-note">'+Object.entries(LEVELS).map(([level,def])=>level+' · '+def.label+'：'+def.explain).join('<br>')+'</p><label class="field">记忆范围<select data-config="memory">'+['私有 + 共享白名单','仅私有','仅共享白名单'].map(x=>'<option '+(cfg.memory===x?'selected':'')+'>'+x+'</option>').join('')+'</select></label><div class="surface"><h3>可用工具</h3><div class="toggle-list">'+['知识库只读','工作区文件','本地命令','网页检索'].map((x,i)=>'<label class="toggle-row"><span>'+x+'</span><input type="checkbox" '+(i<2?'checked':'')+' aria-label="'+x+'"></label>').join('')+demoText("core.sample.73")}
function settingsServices(){return '<p class="mini-note">以下为文档状态，未现场连接。配对操作仅演示界面，不触发登录或网络请求。</p><p class="setting-head">订阅与模型服务</p>'+demoFixture("core.sample.74").map(([n,s])=>'<div class="setting-row">'+ico('link')+'<span class="grow"><strong>'+n+'</strong><small>'+s+'</small></span><span class="pill neutral">'+(s.includes('待核')?'未知':'未连接')+'</span></div>').join('')+demoText("core.sample.75")+(state.paired?'查看演示配对':'设备配对')+'</button><button class="ghostbtn" data-act="devices">设备列表</button></div></div>'}
function settingsHealth(){return demoText("core.sample.76")+ico('jump')+'</button></div><div class="surface"><h3>插件管理</h3>'+demoFixture("core.sample.77").map(([n,s])=>'<div class="setting-row"><span class="grow">'+n+'</span><small>'+s+'</small></div>').join('')+'<p class="mini-note">待重启原因：无；本页不提供一键安装或自动重启。</p></div>'}
function settingsGeneral(){return '<p class="setting-head">外观</p><div class="theme-previews"><button class="light" data-act="preview-light">Aa<br>奶油黄 · 白天</button><button class="dark" data-act="preview-dark">Aa<br>深紫 · 晚上</button></div><label class="field">主题<select data-change="theme">'+[['system','跟随系统'],['light','浅色'],['dark','深色']].map(([k,n])=>'<option value="'+k+'" '+(state.theme===k?'selected':'')+'>'+n+'</option>').join('')+'</select></label><label class="field">皮肤'+skinSelect()+'</label><p class="mini-note">主题立即应用，保留当前会话；背景预览与日常工作分开。</p><div class="setting-row"><span class="grow">语言</span><select><option>简体中文</option><option>日本語</option></select></div><div class="setting-row"><span class="grow">字体</span><select><option>系统默认</option><option>较大正文</option></select></div><div class="setting-row"><span class="grow">消息视图</span><select><option>宽气泡</option><option>紧凑过程卡</option></select></div><div class="setting-row"><span class="grow">统计详略</span><select><option>精简 · 点开明细</option><option>详细</option></select></div><div class="setting-row"><span class="grow">繁忙时发送</span><select data-change="send-mode"><option value="queue" '+(state.sendMode==='queue'?'selected':'')+'>排队到本轮结束</option><option value="interrupt" '+(state.sendMode==='interrupt'?'selected':'')+'>插话，打断本轮</option></select></div><div class="surface"><h3>快捷键与运行</h3><p class="muted">⌘ K / Ctrl K：搜索会话<br>Enter：发送 · Shift Enter：换行<br>Esc：关闭面板<br>Shell：本地终端（演示）<br>网页搜索：未连接<br>会话日志：仅保存在当前页状态</p></div>'}
function toolsPanel(){return '<p class="muted">工具按需打开，结果回到原会话。</p><div class="menu-grid">'+menuItem('image','OpenAI 图像','默认生图通路 · 未连接','openai-image')+menuItem('image',demoText("core.sample.78"),'候选工具 · 未安装','comfy')+menuItem('board','画布','关系草图 · 本地编辑','canvas')+menuItem('jobs','电脑操作 CUA','已装禁用 · 本轮授权','cua-panel')+menuItem('search',demoText("core.sample.79"),'今日结果 · 分轮次','bili')+menuItem('headphones','声音','输入设备 · 音色 · 试听','sound')+demoText("core.sample.80")+ico('jump')+'</button></div>'}
function comfyPanel(){return '<span class="pill neutral">候选 · 未安装 · 仅界面演示</span><label class="field">工作流<select data-change="workflow">'+demoFixture("core.sample.81").map(n=>'<option '+(state.workflow===n?'selected':'')+'>'+n+'</option>').join('')+demoText("core.sample.82")+['v1 · 对照','v2 · 对照','v3 · 待选择'].map(n=>'<option '+(state.lora===n?'selected':'')+'>'+n+'</option>').join('')+'</select></label><div class="surface"><h3>队列 #01 · 预览中</h3><p class="muted">'+state.workflow+demoText("core.sample.83")}
function schedulePanel(){return demoText("core.sample.84")+(state.scheduleOn?'启用':'暂停')+demoText("core.sample.85")+toggle('按时跟进','scheduleOn')+'<div class="actions"><button class="ghostbtn" data-act="edit-schedule">编辑规则</button><button class="ghostbtn" data-act="schedule-history">投递历史</button></div></div><div class="surface"><h3>本轮工作流</h3><div class="trajectory"><div>收集回执 → 核对格式<small>已完成 · 2 份证据</small></div><div>人工审批<small>等待 · 30 分钟未批准则本轮暂停</small></div><div>交付与归档<small>待执行；无产出不自动重开一轮</small></div></div></div><button class="primary" style="margin-top:18px" data-act="new-schedule">新建定时任务</button>'}
function jobsPanel(){return '<p class="muted">本页演示任务状态；未启动子智能体或命令。</p><div class="surface"><h3>会话目标 · 本地样张验收</h3><p class="muted">'+(state.jobPaused?'已暂停':'进行中')+' · 4 / 5 项完成</p><div class="actions"><button class="primary" data-act="goal-toggle">'+(state.jobPaused?'继续目标':'暂停目标')+'</button><button class="ghostbtn" data-act="goal-edit">修改目标</button></div></div>'+demoFixture("core.sample.86").map(([a,n,s])=>'<div class="setting-row">'+ico('jobs')+'<div class="grow"><strong>'+a+' · '+n+'</strong><small>'+s+'</small></div></div>').join('')+demoText("core.sample.87")+ico('jump')+'</button></div>'}
function sessionsPanel(){let q=state.panelSearch.toLowerCase();return Hub.conversationsHTML()+'<label class="searchfield">'+ico('search')+'<input data-search="sessions" placeholder="搜索标题与正文" value="'+esc(state.panelSearch)+'"></label><div class="row between"><span class="muted">工作区 / 项目分组</span><button class="textbutton" data-act="new-session">'+ico('plus')+' 新会话</button></div>'+PROJECTS.map((p,pi)=>{let bs=state.bots.filter((b,i)=>([0,0,1,3,2,3][i]===pi)&&(!q||(state.sessionNames[b.id]+' '+state.threads[b.id].map(m=>m.text||'').join(' ')).toLowerCase().includes(q)));return bs.length?'<p class="setting-head">'+p.name+'</p>'+bs.map(b=>'<div class="new-entry"><button class="row" data-act="session-open" data-id="'+b.id+demoText("core.sample.88")+avatar(b.id).replace('class="creature bot-avatar"','class="creature bot-avatar" style="width:35px;height:35px"')+'<span class="grow"><strong>'+esc(state.sessionNames[b.id])+'</strong><small class="muted" style="display:block">'+esc(b.name)+' · '+(state.archives.includes(b.id)?'已归档':'# '+b.id+'-013')+'</small></span>'+ico('chevron')+'</button><div class="session-actions"><button data-act="rename-session" data-id="'+b.id+'">重命名</button><button data-act="pin-session" data-id="'+b.id+'">置顶</button><button data-act="branch-session" data-id="'+b.id+'">分叉</button><button data-act="copy-id" data-id="'+b.id+'">复制 ID</button><button data-act="archive-session" data-id="'+b.id+'">'+(state.archives.includes(b.id)?'恢复':'归档')+'</button></div></div>').join(''):''}).join('')+'<p class="mini-note">归档保留消息，随时恢复。新建与分叉均保存在当前页内存。</p>'}
function filesPanel(){return '<div class="row"><span class="pill neutral">/demo/'+state.project+'</span><span class="grow"></span><button class="textbutton" data-act="terminal">终端</button></div><label class="searchfield">'+ico('search')+'<input data-search="files" value="'+esc(state.panelSearch)+'" placeholder="查找工作区文件"></label><div class="surface filetree">'+demoFixture("core.sample.89").filter(x=>!state.panelSearch||x[1].includes(state.panelSearch)).map(([k,n])=>'<button data-act="file-preview" data-file="'+k+'">'+ico('file').replace('class="icon"',demoText("core.sample.90"))+' '+n+'</button>').join('')+'</div><p class="mini-note">支持代码、Markdown、图片、PDF 与 Office 预览的位置均已保留。此页不读取真实目录；示例预览由内联数据绘制。</p>'}
function attachmentPanel(){return '<div class="menu-grid">'+menuItem('settings','模型与推理',esc(state.model),'model')+menuItem('shield','权限与计划',state.permission,'permission')+menuItem('usage','额度与用量','5h · 周用量 · 费用','usage')+'</div>'+Hub.composerToolsHTML()+'<div class="menu-grid">'+menuItem('file','本地文件与图片','选择后在本页预览，不上传','pick-file')+menuItem('quote','引用一段会话','保留出处，不打断主任务','reference')+menuItem('memory','@ 助理派单','可同时点名多位','mention-picker')+menuItem('tools','工具箱','画布 · 出图 · 语音','tools')+'</div><div class="surface"><h3>发送时机</h3><div class="segmented"><button data-act="send-queue" class="'+(state.sendMode==='queue'?'on':'')+'">本轮结束后排队</button><button data-act="send-interrupt" class="'+(state.sendMode==='interrupt'?'on':'')+'">插话，打断本轮</button></div><button class="textbutton" data-act="simulate-run">演示运行中的排队与停止 '+ico('jump')+'</button></div><div class="surface"><h3>快捷输入</h3><p class="muted">/context 查看占用 · /plan 对齐计划<br>/side 一句侧边问话 · @助理 派单<br>@文件 或 #会话名 可插入引用</p></div>'}
function sessionMenuPanel(){
  return '<button class="setting-row r25-profile-open" data-assistant-profile="'+esc(state.bot)+'">'+ico('profile')+'<span class="grow">助理资料</span>'+ico('chevron')+'</button>'+Hub.fixedTaskMenuHTML(state.bot)+'<section class="r22-menu-section"><h3>本会话</h3><div class="menu-grid">'+menuItem('plus','新会话','保留当前会话','new-session')+'<button data-act="rename-session" data-id="'+esc(state.bot)+'">'+ico('file')+'<span><strong>重命名</strong><small>'+esc(state.sessionNames[state.bot])+'</small></span></button>'+menuItem('settings','模型强度',esc(state.model)+' · '+esc(state.strength),'model')+menuItem('shield','权限',esc(state.permission),'permission')+menuItem('folder','文件','工作区与交付物','files')+'<button data-memory-entries="'+esc(state.bot)+'">'+ico('memory')+'<span><strong>记忆</strong><small>该助理的条目与待确认</small></span></button><button data-memory-mount="'+esc(state.bot)+'">'+ico('memory')+'<span><strong>挂载与来源</strong><small>当前记忆切片</small></span></button>'+menuItem('profile','助理资料','身份、能力与衣柜','profile')+menuItem('chat','工作区与会话','切换、分叉、归档','sessions')+'</div><details class="r22-menu-advanced"><summary>更多会话设置与原有入口</summary>'+morePanel()+'</details></section><section class="r22-menu-section"><h3>添加</h3>'+attachmentPanel()+'</section><section class="r22-menu-section r22-menu-pet"><h3>角色</h3><button class="setting-row" data-pet-toggle>'+ico('down')+'<span class="grow">'+(chiefPet.isCollapsed()?'展开角色站台':'收起角色站台')+demoText("core.sample.91")+chiefPet.soundEnabled()+'">'+ico('headphones')+'<span class="grow">声音（本轮未接入）</span></button><label class="setting-row"><span class="grow">连点三次的小脾气<small>可关闭的角色反应</small></span><input type="checkbox" data-r22-triple '+(r22PetGestures.tripleEnabled()?'checked':'')+' aria-label="连点三次的小脾气"></label><label class="setting-row"><span class="grow">夜间安静表演<small>闲置间隔加倍，5 分钟无操作入睡</small></span><input type="checkbox" data-r22-night '+(chiefPet.nightEnabled()?'checked':'')+' aria-label="夜间安静表演"></label><div class="r22-menu-assistants" aria-label="切换助理">'+state.bots.map(b=>b.id).map(id=>'<button data-r22-assistant="'+id+'" style="'+botStyle(id)+'">'+avatar(id)+'<span>'+esc(botBy(id).name)+'</span></button>').join('')+'</div></section><button class="r22-all-functions setting-row" data-act="more"><span class="grow">全部功能</span>'+ico('chevron')+'</button>';
}
function sessionMenuHTML(){return '<div class="backdrop r22-sheet-backdrop" data-act="close"></div><aside class="drawer r22-sheet r22-session-sheet" style="'+botStyle(state.bot)+'" role="dialog" aria-modal="true" aria-label="会话菜单" tabindex="-1"><div class="r22-sheet-chrome"><span class="r22-sheet-handle" aria-hidden="true"></span><span class="r22-sheet-gesture-feedback" aria-hidden="true">'+ico('down')+'<span class="r22-sheet-gesture-label"></span></span><div class="dhead">'+(panelHistory.length?ib('back','panel-back','返回上一层'):'')+'<h2>会话菜单</h2>'+ib('close','close','关闭会话菜单','','soft')+'</div></div><div class="r22-sheet-content">'+sessionMenuPanel()+'</div></aside>';}
function drawerHTML(){if(!state.drawer)return '';if(state.drawer==='session-menu')return sessionMenuHTML();let title='',body='';if(Hub.hasPanel(state.drawer)&&state.drawer!=='permission'){title=Hub.panelTitle(state.drawer);body='<div data-hub-panel></div>';}else switch(state.drawer){case 'more':title='更多';body=morePanel();break;case 'usage':title='额度与用量';body=usagePanel();break;case 'context':title='上下文';body=contextPanel();break;case 'model':title='模型与推理';body=modelPanel();break;case 'permission':title='权限';body=permissionPanel();break;case 'profile':title='助理资料';body=profilePanel();break;case 'sources':title='引用与检索';body=sourcesPanel();break;case 'settings':title='工作台设置';body=settingsPanel();break;case 'tools':title='工具箱';body=toolsPanel();break;case 'comfy':title=demoText("core.sample.92");body=comfyPanel();break;case 'schedule':title='定时与工作流';body=schedulePanel();break;case 'jobs':title='后台与子任务';body=jobsPanel();break;case 'sessions':title='工作区与会话';body=sessionsPanel();break;case 'files':title='文件与交付物';body=filesPanel();break;case 'attachments':title='添加到这段对话';body=attachmentPanel();break;case 'decisions':title='待你拍板';body='<p class="muted">'+openCount()+' 件还开着 · 11 月 13 日 · 批准仅更新本页</p>'+state.decisions.map(d=>'<article class="ditem"><p class="eyebrow">'+d.kind+' · '+(d.level||'转派')+'</p><h3>'+d.title+'</h3><p class="muted">'+botBy(d.bot).name+' · '+projBy(d.project).name+'</p><p>'+d.summary+'</p>'+(d.kind==='草稿'?'<details style="margin-top:12px"><summary>展开完整日文与中文说明</summary><p class="label">JA · 对客草稿</p><div class="jp" lang="ja">'+esc(d.jp)+demoText("core.sample.93")+esc(d.zh)+'</div></details>':'')+actionButtons(d)+'</article>').join('');break;case 'card':{let c=cardBy(state.cardId);title=c.title;body='<p class="muted">'+esc(botBy(c.bot).name)+' · '+esc(projBy(c.project).name)+' · '+esc(c.time)+demoText("core.sample.94")+esc(c.detail)+'</p></div><p class="setting-head">移动草稿 · 换列后返回看板提交</p><div class="actions">'+COLS.map(col=>'<button data-act="move" data-col="'+col.id+'" class="'+(boardCol(c)===col.id?'primary':'ghostbtn')+'" '+(boardCol(c)===col.id?'disabled':'')+'>'+col.name+'</button>').join('')+'</div><div class="surface"><h3>负责人 · '+esc(botBy(c.bot).name)+demoText("core.sample.95")+esc(c.sub)+'<br>等待：'+(c.decision?(decBy(c.decision)?.status==='superseded'?'已被新稿替代':isClosed(decBy(c.decision))?'已处理':'人工审批'):'按计划推进')+'</p><button class="ghostbtn" data-act="card-owner" data-card-owner="'+esc(c.id)+'">去负责人会话</button></div>'+(c.task?'<button class="primary" style="margin-top:18px" data-act="open-task" data-id="'+c.task+'">打开任务与阶段验收</button>':'')+(c.decision?'<div class="surface"><h3>'+decBy(c.decision).title+'</h3>'+actionButtons(decBy(c.decision))+'</div>':'');break}case 'preview':title='交付物预览';body='<p class="muted">'+FILES.receipt.name+' · 18 KB</p><div class="preview-paper"><div class="prebody">'+esc(FILES.receipt.body)+'</div></div><div class="actions"><button class="ghostbtn" data-act="copy-delivery">复制内容</button><button class="ghostbtn" data-act="files">工作区文件</button></div>';break;case 'mention':title='叫一位助理';body=demoText("core.sample.96")+state.bots.map(b=>demoText("core.sample.97")+esc(b.name)+'">'+avatar(b.id)+'<span class="grow"><strong>@'+esc(b.name)+'</strong><small>'+esc(SHORT[b.id])+'</small></span>'+ico('plus')+'</button>').join('');break;case 'custom':title=state.customTitle;body=state.customBody;break;default:title='工作台';body='<p class="muted">准备就绪。</p>'}var r22=true;
return '<div class="backdrop '+(r22?'r22-sheet-backdrop':'')+'" data-act="close"></div><aside class="drawer glass '+(r22?'r22-sheet r22-session-sheet r22-page2-sheet ':'')+(Hub.hasPanel(state.drawer)?'hub-panel':state.drawer==='more'?'more-drawer':'')+'" style="'+botStyle(state.drawer==='card'?cardBy(state.cardId).bot:contentBot())+'" role="dialog" aria-modal="true" aria-label="'+esc(title)+'" tabindex="-1">'+(r22?'<div class="r22-sheet-chrome"><span class="r22-sheet-handle" aria-hidden="true"></span><span class="r22-sheet-gesture-feedback" aria-hidden="true">'+ico('down')+'<span class="r22-sheet-gesture-label"></span></span>':'')+'<div class="dhead">'+(panelHistory.length?ib('back','panel-back','返回上一层'):'')+'<h2>'+title+'</h2>'+ib('close','close','关闭面板','','soft')+'</div>'+(r22?'</div><div class="r22-sheet-content">':'')+Hub.panelViewLink(state.drawer)+body+(r22?'</div>':'')+'</aside>'}

var panelReturn=null,panelTrigger=null,panelBackdropUntil=0,panelHistory=[];
function rememberPanel(){if(state.drawer){if(panelHistory.length>=2)panelHistory.pop();panelHistory.push({drawer:state.drawer,customTitle:state.customTitle,customBody:state.customBody,customSheetBody:state.customSheetBody,panelParams:state.panelParams,panelSearch:state.panelSearch,scroll:document.querySelector('.r22-sheet-content')?.scrollTop||0});}}
function backPanel(){if(shellNavigation.back())return;var previous=panelHistory.pop();if(!previous)return;Object.assign(state,previous);render();var drawer=document.querySelector('.drawer');if(drawer){drawer.scrollTop=previous.scroll;drawer.focus({preventScroll:true});}}
function panelIdentity(el){let region=el?.closest('.floatinghead,.side-bottom,.home-top,.navmodes,[data-message-id],.capability-card,.drawer');return el?JSON.stringify([el.tagName,el.id,{...el.dataset},el.getAttribute('aria-label'),el.textContent,region?.className,region?.dataset.messageId,region?.dataset.capability]):'';}
document.addEventListener('click',e=>{let trigger=e.target.closest('button,a,input,select,textarea,[tabindex]');panelTrigger=trigger;Promise.resolve().then(()=>{if(panelTrigger===trigger)panelTrigger=null;});},true);
function openPanel(name,opener,remember=true){
  if(!state.drawer)panelHistory=[];else if(remember&&state.drawer!==name)rememberPanel();
  if(!state.drawer){let el=opener||panelTrigger||document.activeElement;panelReturn={node:el,key:panelIdentity(el)};}
  panelTrigger=null;if(name==='card'&&state.drawer!=='card')panelBackdropUntil=Date.now()+350;else if(name!=='card')panelBackdropUntil=0;
  state.panelSearch='';state.drawer=name;render();let el=document.querySelector('.drawer');if(el)el.focus({preventScroll:true})}
function customPanel(title,body,sheet){if(!state.drawer)panelHistory=[];else rememberPanel();state.customTitle=title;state.customBody=body;state.customSheetBody=sheet;if(arguments.length>2)state.panelParams={};openPanel('custom',null,false)}
var viewScrollMemory=new Map();
function goToCardOwner(id){
  var card=cardBy(id);if(!card)return false;
  var origin={cardId:id,project:state.project,boardScope:state.boardScope,boardAssistant:state.boardAssistant,boardView:state.boardView,conversation:card.bot+'-013',scroll:[]};
  document.querySelectorAll('[data-scroll]').forEach(el=>{if(el.dataset.scroll==='board'||el.dataset.scroll.startsWith('board-col-'))origin.scroll.push([el.dataset.scroll,el.scrollTop,el.scrollLeft]);});
  Hub.navigate({view:'chat',conversation:origin.conversation});state.boardReturn=origin;render();return true;
}
function returnToBoard(){
  var origin=state.boardReturn;if(!origin||state.mode!=='chat'||state.conversation!==origin.conversation)return false;
  state.boardReturn=null;state.boardScope=origin.boardScope;state.boardAssistant=origin.boardAssistant;state.boardView=origin.boardView;
  origin.scroll.forEach(([key,top,left])=>viewScrollMemory.set(key,[top,left]));
  Hub.navigate({view:'kanban',project:origin.project});state.cardId=origin.cardId;openPanel('card');return true;
}
/* R22 第三期：连续性只存本地纯数据，弹层/回调永不持久化。 */
var r22Continuity=(function(){
  function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))||fallback;}catch(e){return fallback;}}
  function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(e){}}
  var anchors=read('hub-r22-reading',{});
  state.r22Pinned=read('hub-r22-pinned',[]).filter(id=>!!homeEntry(id));
  var scroll=read('hub-r22-scroll',{});Object.entries(scroll).forEach(([key,value])=>{if(Array.isArray(value)&&value.every(Number.isFinite))viewScrollMemory.set(key,value);});
  function saveScroll(){document.querySelectorAll('[data-scroll]').forEach(el=>{var k=el.dataset.scroll;if(k==='bots'||k==='board'||k.startsWith('board-col-'))viewScrollMemory.set(k,[el.scrollTop,el.scrollLeft]);});var values={};viewScrollMemory.forEach((v,k)=>{if(k==='bots'||k==='board'||k.startsWith('board-col-'))values[k]=v;});write('hub-r22-scroll',values);}
  function saveRoute(){var home=state.mode==='chat'&&!state.detail;write('hub-r22-route',{view:home?'home':state.mode,bot:state.bot,conversation:state.conversation,project:state.project,ts:Date.now()});saveScroll();}
  function boot(){
    var saved=read('hub-r22-route',null);if(!saved||!Number.isFinite(saved.ts)||Date.now()-saved.ts>1800000||Date.now()<saved.ts||saved.view==='home')return;
    if(typeof saved.view!=='string'||!botBy(saved.bot)||typeof saved.conversation!=='string')return;
    var old={mode:state.mode,detail:state.detail,bot:state.bot,conversation:state.conversation,project:state.project};
    try{Hub.navigate({view:saved.view,bot:saved.bot,conversation:saved.conversation,project:saved.project},{deferRender:true,reading:'preserve'});}
    catch(e){Object.assign(state,old);state.drawer=null;return;}
    var target={mode:state.mode,detail:true,bot:state.bot,conversation:state.conversation,project:state.project};
    state.mode='chat';state.detail=false;state.drawer=null;panelHistory=[];shellNavigation.sync();Object.assign(state,target);
  }
  window.addEventListener('pagehide',()=>{shellReading.save();saveRoute();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){shellReading.save();saveRoute();}});
  document.addEventListener('scroll',e=>{if(e.target?.matches?.('[data-scroll]'))saveScroll();},{capture:true,passive:true});
  return {boot,saveRoute,read,write,reading:id=>anchors[id],saveReading:(id,mode,anchor)=>{if(!id||!anchor)return;anchors[id]={mode,anchor:{messageId:anchor.messageId,path:anchor.path,offset:anchor.offset}};write('hub-r22-reading',anchors);}};
})();
function r22SheetCanDrag(target){
  if(target.closest('.r22-sheet-chrome'))return true;
  for(var node=target;node&&node!==document;node=node.parentNode){if((node.scrollTop||0)>0)return false;if(node.classList?.contains('drawer'))break;}
  return true;
}
function r22TogglePin(id){if(!homeEntry(id))return;state.r22Pinned=state.r22Pinned.includes(id)?state.r22Pinned.filter(x=>x!==id):[id,...state.r22Pinned];r22Continuity.write('hub-r22-pinned',state.r22Pinned);render();toast(state.r22Pinned.includes(id)?'已置顶':'已取消置顶');}
function r22Archive(id){
  if(!homeEntry(id)||state.archives.includes(id))return;
  state.archives.push(id);render();toast('已归档 · ');clearTimeout(toast.timer);
  var el=document.getElementById('toast'),undo=Hub.h('button',{type:'button','data-r22-archive-undo':id,onClick:()=>{state.archives=state.archives.filter(x=>x!==id);clearToast();render();}},'撤销');
  el.append(undo);positionToast();toast.timer=setTimeout(clearToast,4000);
}
var r22ListGesture=null,r22MessageGesture=null,r22OpenRow=null,r22RowIgnore=0;
function r22RowPaint(row,distance,threshold){
  var button=row.querySelector('.conversation');if(button)button.style.transform='translate3d('+(-distance)+'px,0,0)';
  var fold=row.querySelector('.shell-bot-fold');if(fold)fold.style.transform='translate3d('+(-distance)+'px,0,0)';
  row.dataset.r22Threshold=String(!!threshold);row.dataset.r22Open=String(distance>0);if(row.dataset.r22Dragging!=='true'&&matchMedia('(prefers-reduced-motion: reduce)').matches)button?.animate?.([{opacity:.65},{opacity:1}],demoFixture("core.sample.98"));
}
function r22CloseRow(){if(r22OpenRow){r22OpenRow.classList.add('r22-row-rebound');r22RowPaint(r22OpenRow,0,false);r22OpenRow=null;}}
function r22GestureAllowed(target,y,x){return !state.drawer&&(x>=20||env.standalone)&&x<=innerWidth-20&&y<innerHeight-20&&y>=0&&!swipeSelection()&&!target.closest('input,textarea,select,[contenteditable="true"]');}
function r22MessageScrolls(target){
  for(var n=target;n&&!n.matches?.('[data-message-id]');n=n.parentNode){if(n.scrollWidth>n.clientWidth+1&&n.scrollLeft+n.clientWidth<n.scrollWidth-1&&typeof getComputedStyle==='function'&&/auto|scroll/.test(getComputedStyle(n).overflowX))return true;}
  return false;
}
document.addEventListener('touchstart',e=>{
  if(r22ListGesture||r22MessageGesture)r22FinishLocal(true);r22ListGesture=null;r22MessageGesture=null;
  if(e.touches?.length!==1)return;var t=e.touches[0];if(!r22GestureAllowed(e.target,t.clientY,t.clientX))return;
  var row=e.target.closest('.r22-swipe-row');if(r22OpenRow&&(!row||row!==r22OpenRow))r22CloseRow();
  if(row&&!e.target.closest('[data-r22-row-action]')){var open=row===r22OpenRow;r22CloseRow();row.classList.remove('r22-row-rebound');row.classList.remove('r22-row-complete');r22ListGesture={row,x:t.clientX,y:t.clientY,base:open?192:0,dx:0,locked:false,samples:[{x:t.clientX,t:Date.now()}]};return;}
  if(window.R43Delete?.wantsMessageSwipe?.(e.target))return;
  var article=e.target.closest('[data-message-id]');
  if(article&&!e.target.closest('button,a,input,textarea,summary,.r22-native-selection')&&!r22MessageScrolls(e.target))r22MessageGesture={article,x:t.clientX,y:t.clientY,dx:0,locked:false};
},{passive:true});
document.addEventListener('touchmove',e=>{
  var g=r22ListGesture||r22MessageGesture;if(!g)return;
  if(e.touches?.length!==1){r22FinishLocal(true);return;}
  var t=e.touches[0],dx=t.clientX-g.x,dy=t.clientY-g.y;
  if(!g.locked){if(Math.max(Math.abs(dx),Math.abs(dy))<=10)return;if(dx>=0||Math.abs(dx)<=Math.abs(dy)*1.5){r22FinishLocal(true);return;}g.locked=true;pageSwipe=null;g.article?.classList.remove('r22-message-holding');}
  if(e.cancelable)e.preventDefault();g.dx=dx;
  if(g.row){g.row.dataset.r22Dragging='true';var distance=Math.max(0,g.base-dx),shown=distance<=192?distance:192+(distance-192)*.35;g.distance=distance;var now=Date.now();g.samples.push({x:t.clientX,t:now});g.samples=g.samples.filter(s=>s.t>=now-100);r22RowPaint(g.row,shown,distance>=g.row.getBoundingClientRect().width*.6);}
  else{var bubble=g.article.querySelector('.bubble')||g.article;g.bubble=bubble;bubble.style.transition='none';g.distance=Math.min(72,Math.max(0,-dx));bubble.style.transform='translate3d('+(-g.distance)+'px,0,0)';g.article.dataset.r22Quote=String(g.distance>=56);if(!g.icon){g.icon=Hub.h('span',{class:'r22-quote-indicator','aria-hidden':'true'},Hub.icon('quote'));g.article.append(g.icon);}g.icon.style.opacity=String(Math.min(1,g.distance/56));}
},{passive:false});
function r22FinishLocal(cancel){
  var row=r22ListGesture,msg=r22MessageGesture;r22ListGesture=null;r22MessageGesture=null;
  if(row){row.row.dataset.r22Dragging='false';row.row.classList.add('r22-row-rebound');if(row.locked&&!cancel){r22RowIgnore=Date.now()+500;var samples=row.samples,first=samples[0],last=samples.at(-1),speed=first&&last&&last.t>first.t?(first.x-last.x)/(last.t-first.t):0;
      if(row.distance>=row.row.getBoundingClientRect().width*.6||(speed>=.8&&Date.now()-last.t<=100)){r22Archive(row.row.dataset.r22Row);return;}
      if(row.distance>=64){row.row.classList.remove('r22-row-rebound');row.row.classList.add('r22-row-complete');r22RowPaint(row.row,192,false);r22OpenRow=row.row;return;}}
    r22RowPaint(row.row,0,false);
  }
  if(msg){msg.article.classList.remove('r22-message-holding');if(msg.bubble){var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;msg.bubble.style.transition=reduced?'none':'transform 180ms cubic-bezier(.3,1.3,.5,1)';msg.bubble.style.transform='';if(reduced)msg.bubble.animate?.([{opacity:.65},{opacity:1}],demoFixture("core.sample.99"));setTimeout(()=>{if(msg.bubble)msg.bubble.style.transition='';},180);}msg.icon?.remove();msg.article.dataset.r22Quote='false';
    if(msg.locked){if(!cancel&&msg.distance>=56){Hub.quoteMessage(msg.article.dataset.messageId);}r22RowIgnore=Date.now()+500;}
  }
}
document.addEventListener('touchend',()=>r22FinishLocal(false),{passive:true});
document.addEventListener('touchcancel',()=>r22FinishLocal(true),{passive:true});
document.addEventListener('scroll',()=>{if(r22ListGesture?.locked)return;r22CloseRow();},{capture:true,passive:true});
document.addEventListener('click',e=>{
  if(e.target.closest('[data-r43-home-action],[data-r43-swipe-delete],[data-r43-menu]'))return;
  var action=e.target.closest('[data-r22-row-action]');
  if(action){e.preventDefault();e.stopImmediatePropagation?.();var id=action.dataset.id;r22CloseRow();if(action.dataset.r22RowAction==='archive')r22Archive(id);else if(action.dataset.r22RowAction==='pin')r22TogglePin(id);else{homeEntry(id).unread=0;try{if(window.HubUnread&&HubUnread.markBotRead)HubUnread.markBotRead(id);}catch(e){}render();toast('已标为已读');}return;}
  if(Date.now()<r22RowIgnore&&e.target.closest('.r22-swipe-row,[data-message-id]')){e.preventDefault();e.stopImmediatePropagation?.();return;}
  if(r22OpenRow){var open=r22OpenRow;r22CloseRow();if(open.contains(e.target)){e.preventDefault();e.stopImmediatePropagation?.();}}
},true);
var r22NudgeTimer=null,r22NudgeScheduled=false;
function r22Discover(){
  if(r22NudgeScheduled||innerWidth>=700||!swipeHome()||state.drawer||r22Continuity.read('hub-r22-row-nudged',false)||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  r22NudgeScheduled=true;r22NudgeTimer=setTimeout(()=>{
    var row=document.querySelector('.home-recent-list .r22-swipe-row');
    if(!row||!swipeHome()||state.drawer||r22ListGesture||r22OpenRow){r22NudgeScheduled=false;return;}
    r22Continuity.write('hub-r22-row-nudged',true);row.dataset.r22Nudging='true';
    var button=row.querySelector('.conversation'),pin=row.querySelector('[data-r22-row-action="pin"]');pin?.classList.add('r22-nudge-pin');
    button?.animate?.([{transform:'translateX(0)'},{transform:'translateX(-28px)',offset:.5},{transform:'translateX(0)'}],demoFixture("core.sample.100"));
    setTimeout(()=>{row.dataset.r22Nudging='false';pin?.classList.remove('r22-nudge-pin');},600);
  },1200);
}
document.addEventListener('change',e=>{if(e.target.matches('[data-r22-night]'))chiefPet.setNight(e.target.checked);});

// R14: the only owner of thread position; no legacy pin or timer protocol.
var shellTourActive=false,shellRendering=false;
var shellReading=createReadingManager();
var shellRunning=state.running;
Object.defineProperty(state,'running',{enumerable:true,configurable:true,get:()=>shellRunning,set:value=>{
  var finished=shellRunning&&!value;shellRunning=value;
  if(finished)shellReading.finishTurn();
}});
function frameLayout(fn){var queued=false;return function(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;fn();});};}
function createReadingManager(){
  var records=new Map(),thread=null,conversation=null,epoch=0,queued=false,depth=0,serial=0;
  var ro=null,mo=null,cleanup=[],expected=null,dirty=false,animation=null,lastSnapshot='',finishing=null,tabbing=false,tourInset=null;
  function record(id=conversation||state.conversation){
    if(!records.has(id)){var saved=r22Continuity.reading(id);records.set(id,{conversation:id,mode:saved?.mode==='hold'?'hold':'follow',anchor:saved?.anchor||null,temporary:null,unreadIds:new Set(),seen:new Set(),initialized:false});}
    return records.get(id);
  }
  function maxTop(){return Math.max(0,(thread?.scrollHeight||0)-(thread?.clientHeight||0));}
  function distance(){return Math.max(0,maxTop()-(thread?.scrollTop||0));}
  function viewportTop(){return thread.getBoundingClientRect().top+(thread.clientTop||0);}
  function elements(){return thread?[...thread.querySelectorAll('[data-message-id]')]:[];}
  function capture(preferred){
    if(!thread||!(thread.clientHeight>0))return record().anchor;
    var top=viewportTop(),bottom=top+thread.clientHeight,list=elements();
    var el=resolve(preferred)||list.find(el=>{var r=el.getBoundingClientRect();return r.top>=top-2&&r.bottom<=bottom+2;})||list.find(el=>el.getBoundingClientRect().bottom>top)||list.at(-1);
    if(!el)return null;
    var ref=reference(el);
    return {messageId:ref.messageId,path:ref.path,offset:el.getBoundingClientRect().top-top,
      neighbors:list.map(n=>({messageId:n.dataset.messageId,offset:n.getBoundingClientRect().top-top}))};
  }
  function save(){if(thread){var r=record(),anchor=capture(r.anchor?.path?.length?r.anchor:null);if(r.mode==='hold')r.anchor=anchor;r22Continuity.saveReading(conversation,r.mode,anchor);}}
  function snapshot(id){
    var r=record(id),active=r.conversation===conversation&&!!thread,d=active?distance():r.distanceToBottom||0;
    return Object.freeze({conversation:r.conversation,mode:r.mode,atBottom:d<=80,distanceToBottom:d,
      unread:r.unreadIds.size,firstUnreadId:r.unreadIds.values().next().value||null,showBottom:d>80||(r.mode==='hold'&&d>2)});
  }
  function publish(){
    var s=snapshot(),key=JSON.stringify(s);record().distanceToBottom=s.distanceToBottom;
    if(key!==lastSnapshot){lastSnapshot=key;Hub?.emit('reading:change',s);}
  }
  // All thread writes, including animated frames, pass this private boundary.
  function writeThreadTop(top){
    if(!thread)return;var node=thread,version=epoch;
    node.scrollTop=Math.max(0,Math.min(maxTop(),top));
    expected={node:node,epoch:version,top:node.scrollTop};
  }
  function request(){
    if(!thread||queued||depth||shellRendering)return;
    queued=true;var version=epoch;
    requestAnimationFrame(()=>{if(version!==epoch)return;queued=false;if(finishing)finishing.ready=true;settle();});
  }
  function invalidate(){dirty=true;animation=null;request();}
  function resolve(ref){
    if(!thread||!ref)return null;
    if(ref.node?.isConnected&&thread.contains?.(ref.node))return ref.node;
    // DOM double has no contains; closest also establishes ownership in real DOM.
    if(ref.node?.isConnected&&ref.node.closest('.thread')===thread)return ref.node;
    var el=elements().find(el=>el.dataset.messageId===ref.messageId);
    if(ref.path&&el){for(var index of ref.path){el=el.children[index];if(!el)break;}}return el;
  }
  function reference(target){
    if(target?.getBoundingClientRect){var article=target.closest('[data-message-id]'),path=[],node=target;while(article&&node!==article){path.unshift([...node.parentNode.children].indexOf(node));node=node.parentNode;}return {node:target,conversation:conversation,messageId:article?.dataset.messageId,path:path};}
    return target||{};
  }
  function messageChanges(){
    var r=record(),list=elements();
    list.forEach(el=>{var id=el.dataset.messageId;if(r.initialized&&!r.seen.has(id)&&r.mode!=='follow')r.unreadIds.add(id);r.seen.add(id);});
    r.initialized=true;
  }
  function anchorTarget(anchor){
    if(!anchor)return thread.scrollTop;
    var list=elements(),found=resolve(anchor),offset=anchor.offset;
    if(!found){
      var neighbors=anchor.neighbors||[],index=neighbors.findIndex(n=>n.messageId===anchor.messageId);
      for(var step=1;step<=neighbors.length&&!found;step++)for(var n of [neighbors[index+step],neighbors[index-step]]){
        if(!n)continue;var el=list.find(el=>el.dataset.messageId===n.messageId);if(el){found=el;offset=n.offset;break;}
      }
    }
    // No surviving message: keep the browser-clamped current position, never jump to bottom.
    return found?thread.scrollTop+found.getBoundingClientRect().top-viewportTop()-offset:thread.scrollTop;
  }
  function contentBox(el){
    var node=el,top=0;
    while(node&&node!==thread&&Number.isFinite(node.offsetTop)){top+=node.offsetTop;node=node.offsetParent;if(node&&node!==thread)top+=node.clientTop||0;}
    var rect=el.getBoundingClientRect();
    return {top:node===thread?top:rect.top-viewportTop()+thread.scrollTop,height:Number.isFinite(el.offsetHeight)?el.offsetHeight:rect.height};
  }
  function settle(){
    if(!thread||shellRendering||depth)return;
    var node=thread,r=record(),target=node.scrollTop,temporary=r.temporary;
    messageChanges();
    if(r.mode==='follow')target=maxTop();
    if(r.mode==='hold')target=anchorTarget(r.anchor);
    if(r.mode==='sent'){
      var article=resolve(temporary?.ref),bubble=article?.querySelector('.user-bubble')||article;
      if(bubble){var b=contentBox(bubble);target=Math.min(maxTop(),Math.max(0,b.top-12,b.top+b.height-node.clientHeight+12));}
      else target=maxTop();
    }
    if(r.mode==='locate'&&temporary){
      var el=resolve(temporary.ref);
      if(el){
        var rect=el.getBoundingClientRect(),top=viewportTop(),offset=typeof temporary.options.offset==='function'?temporary.options.offset():temporary.options.offset||0;
        var block=temporary.options.block||'center',desired=top+offset;
        if(block==='center')desired=top+(node.clientHeight-rect.height)/2+offset;
        if(block==='nearest'){
          if(rect.top>=top+offset&&rect.bottom<=top+node.clientHeight)desired=rect.top;
          else desired=rect.top<top+offset?top+offset:top+node.clientHeight-rect.height;
        }
        target=node.scrollTop+rect.top-desired;
        if(target<0&&temporary.options.reason==='tour-step'&&block==='start'){
          if(!tourInset||tourInset.node!==node)tourInset={node:node,paddingTop:node.style.paddingTop||''};
          var padding=window.getComputedStyle?parseFloat(getComputedStyle(node).paddingTop)||18:18;
          node.style.paddingTop=(padding-target)+'px';target=0;
        }
      }
    }
    target=Math.max(0,Math.min(maxTop(),target));
    if(animation){
      var progress=Math.min(1,(Date.now()-animation.start)/180);
      target=animation.from+(target-animation.from)*(1-Math.pow(1-progress,3));
      if(progress>=1)animation=null;
    }
    if(Math.abs(node.scrollTop-target)>0.5)writeThreadTop(target);
    else expected={node:node,epoch:epoch,top:node.scrollTop};
    dirty=false;
    if(r.mode==='follow')r.unreadIds.clear();
    publish();
    if(animation)request();
    // A turn completion is tied to its token; a newer send/locate cannot be released by it.
    if(finishing?.ready&&r.mode==='sent'&&finishing.token===r.temporary?.token){var token=finishing.token;finishing=null;release({token:token,reason:'turn-end-fallback'});}
  }
  function resetInset(){if(tourInset){tourInset.node.style.paddingTop=tourInset.paddingTop;tourInset=null;}}
  function cancelTemporary(){resetInset();record().temporary=null;animation=null;finishing=null;}
  function release(options={}){
    var r=record();if(options.token&&r.temporary?.token!==options.token)return;
    if(!r.temporary)return;
    // Releasing sent never requests another bottom write. Keep the actual bubble,
    // including across dock recovery and final-render/quiet transactions.
    var wasSent=r.mode==='sent',article=wasSent?resolve(r.temporary?.ref):null;
    var anchor=capture(article?reference(article.querySelector('.user-bubble')||article):null);
    cancelTemporary();r.mode=distance()<=2?'follow':'hold';r.anchor=anchor;
    if(r.mode==='follow')r.unreadIds.clear();publish();
  }
  function userIntent(forceHold=false){
    if(!thread)return;cancelTemporary();if(forceHold)expected=null;var r=record();r.mode=forceHold?'hold':distance()<=2?'follow':'hold';r.anchor=capture();
    // Wheel/touch arrives before the scroll. Do not schedule a follow write here.
    dirty=false;publish();
  }
  function onScroll(){
    if(!thread)return;
    var delta=expected?.node===thread&&expected.epoch===epoch?Math.abs(thread.scrollTop-expected.top):Infinity;
    if(delta<=0.5||delta<=4&&record().mode!=='hold')return;
    if(dirty)return; // Browser layout clamping is resolved by the active intent, not a new user intent.
    userIntent();save();if(record().mode==='follow')request();
  }
  function detach(nextConversation){
    save();if(tourInset)resetInset();if(thread&&nextConversation!==conversation&&['sent','locate'].includes(record().mode))release({reason:'leave'});
    epoch++;queued=false;ro?.disconnect();mo?.disconnect();cleanup.forEach(fn=>fn());cleanup=[];
    thread=null;conversation=null;expected=null;animation=null;
  }
  function attach(node,id){
    if(!node)return;thread=node;conversation=id;record(id);var version=epoch;lastSnapshot='';dirty=true;
    function schedule(){if(version===epoch&&thread===node)invalidate();}
    function listen(name,fn,opts){node.addEventListener(name,fn,opts);cleanup.push(()=>node.removeEventListener(name,fn,opts));}
    listen('scroll',onScroll,{passive:true});
    function ownsInput(e){return !e.target||e.target===node||e.target.closest?.('.thread')===node&&!e.target.closest('.m-interact-transcript,textarea,input,select,[contenteditable="true"]');}
    ['wheel','touchstart'].forEach(name=>listen(name,e=>{if(ownsInput(e))userIntent(true);},{passive:true}));
    listen('pointerdown',e=>{if(e.target===node)userIntent(true);},{passive:true});
    listen('keydown',e=>{if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown',' '].includes(e.key)&&ownsInput(e))userIntent(true);});
    listen('focusin',e=>{
      if(!tabbing)return;tabbing=false;userIntent();var rect=e.target.getBoundingClientRect(),top=viewportTop();
      if(rect.top<top||rect.bottom>top+node.clientHeight)locate(e.target,{block:'nearest',reason:'keyboard-focus'});
      else{record().mode='hold';record().anchor=capture();publish();}
    });
    listen('load',schedule,true);listen('error',schedule,true);
    if(window.ResizeObserver){ro=new ResizeObserver(schedule);ro.observe(node);var inner=node.querySelector('.thread-inner');if(inner)ro.observe(inner);}
    if(window.MutationObserver){mo=new MutationObserver(schedule);mo.observe(node,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open','src']});}
    document.fonts?.ready.then(schedule);
    // Layout coordinates relative to thread avoid the mobile slide transform's halfway viewport position.
    settle();request();
  }
  function preserve(fn){
    if(!depth)save();depth++;
    try{return fn();}finally{depth--;if(!depth){animation=null;settle();request();}}
  }
  function begin(mode,ref,options={}){
    cancelTemporary();var r=record(),token='reading-'+(++serial);
    r.mode=mode;r.temporary={ref:reference(ref),options:options,token:token};
    if(options.behavior==='smooth'&&!matchMedia('(prefers-reduced-motion: reduce)').matches)animation={from:thread?.scrollTop||0,start:Date.now()};
    settle();request();return token;
  }
  function locate(target,options={}){
    var ref=reference(target);if(ref.conversation&&(ref.conversation!==state.conversation||state.mode!=='chat'||!render.chatRoute))Hub.navigate({view:'chat',conversation:ref.conversation});
    return begin('locate',ref,options);
  }
  function toBottom(options={}){
    cancelTemporary();var r=record();r.mode='follow';r.anchor=null;r.unreadIds.clear();
    if(options.behavior==='smooth'&&!matchMedia('(prefers-reduced-motion: reduce)').matches)animation={from:thread?.scrollTop||0,start:Date.now()};
    settle();request();
  }
  function sent(target,options={}){
    // Initial send reaches the bottom, subsequent reply growth uses the sent element.
    toBottom({reason:'send'});var token=begin('sent',target,options);record().unreadIds.clear();publish();return token;
  }
  function enter(id,options={}){
    var r=record(id);if(options.mode==='bottom'){r.mode='follow';r.anchor=null;r.temporary=null;r.unreadIds.clear();}
    if(thread&&id===conversation){settle();request();}
  }
  function finishTurn(){
    if(record().mode!=='sent')return;finishing={token:record().temporary?.token,ready:false};request();
  }
  document.addEventListener('keydown',e=>{tabbing=e.key==='Tab';},true);
  window.addEventListener('resize',invalidate);window.visualViewport?.addEventListener('resize',invalidate);
  return {preserve:preserve,locate:locate,release:release,toBottom:toBottom,state:snapshot,sent:sent,enter:enter,
    save:save,detach:detach,attach:attach,invalidate:invalidate,userIntent:userIntent,finishTurn:finishTurn,resetInset:resetInset};
}

// P0-3：浏览器历史为返回的唯一所有者；预览中的菜单不制造历史。
var shellNavigation=(function(){
  var replaceNext=false;var history=window.history,started=false,restoring=false,preview=false,pending=false,depth=0,key='',entries=[],lastChat=null;
  var returnSteps=0,requestedBack=false,forceHomeOnPop=false,manualReturn=false,revisiting=false;
  var fields=['mode','detail','bot','conversation','project','drawer','cardId','taskId','boardView','boardScope','settingsTab','botTab','panelSearch','panelParams','customTitle','customBody','customSheetBody'];
  function enabled(){history=window.history;return innerWidth<700&&typeof history?.pushState==='function';}
  function snapshot(){var result={};fields.forEach(k=>{result[k]=state[k];});result.panels=panelHistory.slice();return result;}
  function historyState(s){var plain={};fields.forEach(k=>{var v=s[k];if(v===null||['string','number','boolean','undefined'].includes(typeof v))plain[k]=v;});return {hubR21:true,depth,snapshot:plain};}
  function identity(s){return [s.mode,s.detail,s.bot,s.conversation,s.project,s.drawer,'',s.drawer==='custom'?s.customTitle:''].join('|');}
  function sync(){
    if(restoring||preview)return;
    var s=snapshot(),next=identity(s);if(s.mode==='chat'&&s.detail&&!s.drawer)lastChat={view:'chat',bot:s.bot,conversation:s.conversation,project:s.project};
    if(next!==key&&!pending&&!manualReturn)returnSteps=0;manualReturn=false;
    if(!enabled()){key=next;return;}
    if(!started){started=true;entries=[s];key=next;history.replaceState(historyState(s),'');return;}
    if(next===key){entries[depth]=s;history.replaceState(historyState(s),'');return;}
    var found=entries.slice(0,depth).findIndex(old=>identity(old)===next);
    if(found>=0){pending=true;revisiting=true;history.go(found-depth);setTimeout(()=>pending=false,700);return;}
    var current=entries[depth],sameL1=!s.drawer&&!current?.drawer&&s.detail&&current?.detail&&s.mode==='chat'&&current.mode==='chat';
    var childLimit=s.drawer&&current?.drawer&&(s.panels?.length||0)>=2;
    if(replaceNext||sameL1||childLimit||depth>=3){replaceNext=false;entries[depth]=s;key=next;history.replaceState(historyState(s),'');return;}
    depth++;entries=entries.slice(0,depth);entries[depth]=s;key=next;
    history.pushState(historyState(s),'');
  }

  function back(allPanels){
    if(state.mode==='chat'&&!state.detail&&!state.drawer){returnSteps=0;return false;}
    if(++returnSteps>=2){forceHomeOnPop=pending;homeFallback();return true;}
    if(!enabled()||!started||depth<=0){manualReturn=true;return false;}if(pending)return true;
    var target=depth-1;if(allPanels&&state.drawer)while(target>0&&entries[target]?.drawer)target--;
    pending=true;requestedBack=true;history.go(target-depth);setTimeout(()=>{pending=false;},700);return true;
  }
  function visibleChat(s){return s.mode==='chat'&&s.detail&&!s.drawer;}
  function homeFallback(){
    pending=false;revisiting=false;requestedBack=false;restoring=true;scrollRenderUntil=0;state.mode='chat';state.detail=false;state.drawer=null;state.boardReturn=null;panelHistory=[];panelReturn=null;panelTrigger=null;
    try{var under=swipeHomeReturn;swipeHomeReturn=null;if(!finishHomeSwipe(under))renderHomeChat();}finally{restoring=false;}
    depth=0;entries=[snapshot()];key=identity(entries[0]);returnSteps=0;history?.replaceState?.(historyState(entries[0]),'');
  }
  window.addEventListener('popstate',e=>{
    if(forceHomeOnPop){forceHomeOnPop=false;requestedBack=false;homeFallback();return;}
    if(!requestedBack&&!revisiting&&e.state?.hubR21&&e.state.depth<depth&&++returnSteps>=2){homeFallback();return;}
    requestedBack=false;
    var from=snapshot();if(!e.state?.hubR21||!e.state.snapshot){if(visibleChat(from))homeFallback();return;}
    pending=false;var supplied=e.state.snapshot,stored=entries[e.state.depth],s=stored&&identity(stored)===identity(supplied)?stored:supplied;
    // 注入层可能重复打开会话或直接写 history；恢复前再判一次会话身份。
    var duplicate=!revisiting&&visibleChat(from)&&visibleChat(s)&&from.conversation===s.conversation;revisiting=false;
    if(duplicate){s={...s,mode:'chat',detail:false,drawer:null,panels:[]};panelReturn=null;panelTrigger=null;}
    depth=duplicate?0:e.state.depth;if(duplicate)entries=[];key=identity(s);restoring=true;scrollRenderUntil=0;
    try{
      Hub.navigate({view:s.mode,bot:s.bot,conversation:s.conversation,project:s.project},{reading:'preserve',deferRender:true});
      fields.forEach(k=>{state[k]=s[k];});panelHistory=(s.panels||[]).slice();if(duplicate)state.boardReturn=null;entries[depth]=s;if(duplicate)history.replaceState(historyState(s),'');var under=swipeHomeReturn;swipeHomeReturn=null;if(!(under&&s.mode==='chat'&&!s.detail&&!s.drawer&&finishHomeSwipe(under)))render();
    }finally{restoring=false;}
  });
  return {sync,back,replace:fn=>{replaceNext=true;try{fn();}finally{replaceNext=false;}},lastChat:()=>lastChat,preview:value=>{preview=value;},pending:()=>pending};
})();
/* R22 ④：角色起手只由站台处理，不与页面返回争抢。 */
var r22PetGestures=(function(){
  var ids=state.bots.filter(b=>b.enabled!==false).map(b=>b.id),gesture=null,ignoreUntil=0,taps=[],triple=true,fan=null,shade=null,selected=null,pendingBot=null;
  try{triple=localStorage.getItem('hub-r22-pet-triple')!=='false';}catch(e){}
  function reduced(){return matchMedia('(prefers-reduced-motion: reduce)').matches;}
  function switchTo(id){
    ids=state.bots.filter(b=>b.enabled!==false).map(b=>b.id);
    if(!ids.includes(id)||state.bot===id)return;
    taps=[];
    if(state.drawer&&innerWidth<700){pendingBot=id;closePanel();return;}
    shellNavigation.replace(()=>Hub.navigate({view:'chat',bot:id}));
  }
  window.addEventListener('popstate',()=>{if(pendingBot&&!state.drawer){var id=pendingBot;pendingBot=null;switchTo(id);}});
  function poke(){
    var now=Date.now();taps=taps.filter(t=>now-t<2000);taps.push(now);var angry=triple&&taps.length>=3;if(angry)taps=[];
    var span=document.querySelector('.r22-pet-platform .chief-pet-stage,.r22-pet-figure>.role-silhouette');
    if(span&&!reduced()){
      // 压扁与回弹只作用于包住 img 的 span，不动 img 的基线。
      span.getAnimations?.().filter(a=>a.id==='r22-poke').forEach(a=>a.cancel());
      if(span.animate){var base=typeof getComputedStyle==='function'?getComputedStyle(span).transform:'';if(base==='none')base='';var a=span.animate([{transform:base+' scale(1.06,.92)',offset:0},{transform:base+' scale(.97,1.04)',offset:80/280},{transform:base+' scale(1)',offset:1}],demoFixture("core.a.101"));a.id='r22-poke';}
    }
    chiefPet.poke(angry);
  }
  function hideFan(){fan?.remove();shade?.remove();fan=null;shade=null;selected=null;r22SyncThemeColor();}
  function showFan(){
    ids=state.bots.filter(b=>b.enabled!==false).map(b=>b.id);
    if(!gesture)return;gesture.held=true;selected=null;
    var r=gesture.figure.getBoundingClientRect(),cx=Math.max(150,Math.min(innerWidth-150,r.left+r.width/2)),cy=Math.max(140,r.top-12);
    shade=document.createElement('div');shade.className='r22-fan-shade';shade.setAttribute('aria-hidden','true');shade.addEventListener('click',hideFan);document.getElementById('app').append(shade);
    fan=document.createElement('div');fan.className='r22-pet-fan';fan.setAttribute('role','menu');fan.setAttribute('aria-label','选择助理');fan.style.left=cx+'px';fan.style.top=cy+'px';
    ids.forEach((id,i)=>{var row=i<3?0:1,col=i%3,px=(col-1)*96,py=(row? -12:-98)-(col===1?18:0);var button=document.createElement('button');button.dataset.r22FanBot=id;button.setAttribute('role','menuitem');button.setAttribute('aria-label',botBy(id).name);button.setAttribute('style',botStyle(id)+';left:'+px+'px;top:'+py+'px');button.innerHTML=avatar(id)+'<span>'+esc(botBy(id).name)+'</span>';fan.append(button);});
    document.getElementById('app').append(fan);r22SyncThemeColor();
  }
  function start(target,x,y,kind){
    var figure=target.closest('.r22-pet-figure');if(!figure||state.drawer||y>=innerHeight-20||x>innerWidth-20||(x<20&&!env.standalone)||swipeSelection())return;
    cancel();gesture={figure,x,y,dx:0,dy:0,kind,held:false,axis:null};gesture.timer=setTimeout(showFan,400);
  }
  function move(x,y,e){
    var g=gesture;if(!g)return;g.dx=x-g.x;g.dy=y-g.y;
    if(g.held){if(e.cancelable)e.preventDefault();var hit=document.elementFromPoint?.(x,y)?.closest('[data-r22-fan-bot]');selected=hit?.dataset.r22FanBot||null;fan?.querySelectorAll('button').forEach(el=>el.setAttribute('aria-current',String(el===hit)));return;}
    if(Math.max(Math.abs(g.dx),Math.abs(g.dy))>8){clearTimeout(g.timer);g.axis=Math.abs(g.dx)>Math.abs(g.dy)*1.73?'cancel':g.dy>Math.abs(g.dx)*1.73?'down':'cancel';}
    if(g.axis&&e.cancelable)e.preventDefault();
    if(g.axis==='x'){var xmove=Math.abs(g.dx)<=56?g.dx:Math.sign(g.dx)*(56+(Math.abs(g.dx)-56)*.35);g.figure.style.transform='translate3d('+xmove+'px,0,0)';g.figure.dataset.r22Threshold=String(Math.abs(g.dx)>=28);}
    if(g.axis==='down')g.figure.style.transform='translate3d(0,'+Math.min(32,g.dy*.35)+'px,0)';
  }
  function cancel(){if(!gesture){hideFan();return;}clearTimeout(gesture.timer);var f=gesture.figure;if(f){f.style.transform='';f.style.transition='';delete f.dataset.r22Threshold;}gesture=null;hideFan();}
  function end(abort){
    var g=gesture;if(!g)return;clearTimeout(g.timer);var bot=g.held?selected:null,moveX=!g.held&&g.axis==='x'&&Math.abs(g.dx)>=28&&Math.abs(g.dy)<Math.abs(g.dx)*Math.tan(Math.PI/6),down=!g.held&&g.axis==='down'&&g.dy>=28,tap=!g.held&&!g.axis;
    ignoreUntil=Date.now()+450;
    if(!reduced()&&g.figure.isConnected){g.figure.style.transition='transform 180ms cubic-bezier(.3,1.3,.5,1)';g.figure.style.transform='';}
    gesture=null;hideFan();
    if(abort)return;if(bot)switchTo(bot);else if(moveX)switchTo(ids[(ids.indexOf(state.bot)+(g.dx<0?1:ids.length-1))%ids.length]);else if(down)chiefPet.setCollapsed(true);else if(tap)poke();
  }
  document.addEventListener('touchstart',e=>{if(e.touches?.length!==1){cancel();return;}var t=e.touches[0];start(e.target,t.clientX,t.clientY,'touch');if(gesture&&e.cancelable)e.preventDefault();},{passive:false});
  ['contextmenu','selectstart'].forEach(type=>document.addEventListener(type,e=>{if(e.target?.closest?.('.r22-pet-platform,.r22-pet-fan')){e.preventDefault();e.stopImmediatePropagation?.();}},true));
  document.addEventListener('touchmove',e=>{if(e.touches?.length!==1){cancel();return;}if(gesture?.kind==='touch')move(e.touches[0].clientX,e.touches[0].clientY,e);},{passive:false});
  document.addEventListener('touchend',()=>{if(gesture?.kind==='touch')end(false);},{passive:true});
  document.addEventListener('touchcancel',()=>{if(gesture?.kind==='touch')end(true);},{passive:true});
  document.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'&&e.button===0)start(e.target,e.clientX,e.clientY,'pointer');});
  document.addEventListener('pointermove',e=>{if(gesture?.kind==='pointer')move(e.clientX,e.clientY,e);});
  document.addEventListener('pointerup',()=>{if(gesture?.kind==='pointer')end(false);});
  document.addEventListener('pointercancel',()=>{if(gesture?.kind==='pointer')end(true);});
  document.addEventListener('click',e=>{
    var hit=e.target.closest('[data-r22-assistant],[data-r22-fan-bot]');if(hit){switchTo(hit.dataset.r22Assistant||hit.dataset.r22FanBot);hideFan();return;}
    if(e.target.closest('.r22-pet-figure')){if(Date.now()>=ignoreUntil)poke();e.preventDefault();e.stopImmediatePropagation?.();}
  },true);
  document.addEventListener('keydown',e=>{if(!e.target.closest('.r22-pet-figure'))return;if(['Enter',' '].includes(e.key)){e.preventDefault();poke();}if(e.key==='ArrowDown'){e.preventDefault();chiefPet.setCollapsed(true);}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();switchTo(ids[(ids.indexOf(state.bot)+(e.key==='ArrowRight'?1:ids.length-1))%ids.length]);}if(e.key==='Escape')cancel();});
  document.addEventListener('change',e=>{if(!e.target.matches('[data-r22-triple]'))return;triple=!!e.target.checked;taps=[];try{localStorage.setItem('hub-r22-pet-triple',String(triple));}catch(error){}});
  return {tripleEnabled:()=>triple,switchTo,poke,cancel};
})();
var r22DisplayMedia=matchMedia('(display-mode: standalone)');
var env={standalone:false};
function r22UpdateEnv(){env.standalone=!!(r22DisplayMedia.matches||navigator.standalone===true);}
r22UpdateEnv();r22DisplayMedia.addEventListener?.('change',r22UpdateEnv);
/* 列区水平轴由同一手势边界代理；左端向右让给页面返回。 */
var r22BoardPan=null;
document.addEventListener('touchstart',e=>{var board=e.target.closest('.board');r22BoardPan=e.touches?.length===1&&board&&!state.drawer&&!e.target.closest('.kcard,.node')?{board,x:e.touches[0].clientX,y:e.touches[0].clientY,left:board.scrollLeft,axis:null}:null;},{passive:true});
document.addEventListener('touchmove',e=>{var g=r22BoardPan;if(!g||e.touches?.length!==1)return;var dx=e.touches[0].clientX-g.x,dy=e.touches[0].clientY-g.y;if(!g.axis){if(Math.max(Math.abs(dx),Math.abs(dy))<=12)return;g.axis=Math.abs(dx)>Math.abs(dy)*1.15?'x':'y';}if(g.axis!=='x'||(dx>0&&g.left<=1))return;if(e.cancelable)e.preventDefault();g.board.scrollLeft=Math.max(0,g.left-dx);},{passive:false});
['touchend','touchcancel'].forEach(type=>document.addEventListener(type,()=>r22BoardPan=null,{passive:true}));

var pageSwipe=null,swipeHomeReturn=null;
function finishHomeSwipe(g){
  if(!g?.home?.isConnected||!g.shell?.isConnected)return false;
  g.shell.classList.remove('mobile-detail');g.shell.classList.remove('non-chat');g.home=null;clearSwipe(g,true);
  render.chatRoute=null;shellReading.detach(null);
  document.querySelectorAll('.pin[data-id]').forEach(el=>{el.classList.toggle('on',el.dataset.id===state.bot);el.setAttribute('aria-current',String(el.dataset.id===state.bot));});
  chiefPet.sync();shellNavigation.sync();r22Continuity.saveRoute();if(matchMedia('(prefers-reduced-motion: reduce)').matches)document.querySelector('.sidebar')?.animate?.([{opacity:.65},{opacity:1}],demoFixture("core.sample.102"));return true;
}
function swipeSelection(){return !!window.getSelection?.().toString();}
function swipeHome(){return state.mode==='chat'&&!state.detail;}
function swipeBlocked(target,dx){
  if(target.closest('input,textarea,select,[contenteditable="true"],.kcard,.node,.stage-frame .mascot-wrap')||drag?.active||swipeSelection())return true;
  if(typeof getComputedStyle!=='function')return false;
  for(var el=target;el&&el!==document.body;el=el.parentElement){
    var style=getComputedStyle(el);
    if(/auto|scroll/.test(style.overflowX)&&el.scrollWidth>el.clientWidth+1&&(dx<0||el.scrollLeft>1))return true;
  }
  return false;
}
function clearSwipe(g,commit){
  if(!g)return;var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(commit&&g.home){g.el.style.transform='translate3d('+innerWidth+'px,0,0)';return;}
  var clear=()=>{if(g.el){g.el.style.transform='';g.el.style.transition='';g.el.style.willChange='';delete g.el.dataset.r22DismissReady;delete g.el.dataset.r22DragDirection;}if(g.backdrop)g.backdrop.style.opacity='';if(g.shell)g.shell.classList.remove('r21-back-home');};
  if(!commit&&!reduced&&g.el){g.el.style.transition='transform 180ms cubic-bezier(.3,1.3,.5,1)';g.el.style.transform=g.action==='menu'?'translate3d(-100%,0,0)':'translate3d(0,0,0)';setTimeout(clear,180);}else{clear();if(reduced&&!commit)g.el?.animate?.([{opacity:.65},{opacity:1}],demoFixture("core.sample.103"));}
}
function abandonSwipe(){var g=pageSwipe;pageSwipe=null;if(!g)return;clearSwipe(g,false);if(g.action==='menu'){state.drawer=null;render();shellNavigation.preview(false);}}
document.addEventListener('touchstart',e=>{
  if(innerWidth>=700||e.touches?.length!==1||shellNavigation.pending()||swipeSelection()||Math.abs((window.visualViewport?.scale||1)-1)>.001){abandonSwipe();return;}
  if(pageSwipe)abandonSwipe();if(e.target.closest('.r22-pet-platform'))return;var t=e.touches[0];if((t.clientX<20&&!env.standalone)||t.clientX>innerWidth-20||t.clientY>=innerHeight-20||t.clientY<0){abandonSwipe();return;}
  pageSwipe={x:t.clientX,y:t.clientY,lastX:t.clientX,lastY:t.clientY,start:Date.now(),lastTime:Date.now(),target:e.target,sheetScroll:r22SheetCanDrag(e.target)?0:1,action:null,dx:0,dy:0};
},{passive:true});
document.addEventListener('touchmove',e=>{
  var g=pageSwipe;if(!g)return;if(e.touches?.length!==1||swipeSelection()||drag?.active){abandonSwipe();return;}
  var t=e.touches[0],dx=t.clientX-g.x,dy=t.clientY-g.y,now=Date.now();g.dx=dx;g.dy=dy;
  if(!g.action){
    if(Math.max(Math.abs(dx),Math.abs(dy))<=12)return;
    if(swipeBlocked(g.target,dx)||r22ListGesture?.locked||r22MessageGesture?.locked){pageSwipe=null;return;}
    if(state.drawer&&dy>12&&dy>Math.abs(dx)*1.15){if(g.sheetScroll>0||!r22SheetCanDrag(g.target)){pageSwipe=null;return;}g.action='dismiss-down';g.el=document.querySelector('.drawer');}
    else if(document.querySelector('.r22-session-sheet')&&dy<-12&&Math.abs(dy)>Math.abs(dx)*1.15&&r22SheetCanDrag(g.target)){g.action='sheet-up';g.el=document.querySelector('.drawer');}
    else if(Math.abs(dx)>Math.abs(dy)*1.15){
      if(state.drawer&&(dx<0||document.querySelector('.r22-session-sheet')&&dx>0)){g.action=dx>0?'dismiss-right':'dismiss';g.el=document.querySelector('.drawer');}
      else if(swipeHome()&&dx>0){g.action='menu';shellNavigation.preview(true);panelHistory=[];panelReturn={node:g.target,key:panelIdentity(g.target)};state.drawer='more';var holder=document.createElement('div');holder.innerHTML=drawerHTML();[...holder.children].forEach(el=>document.querySelector('.shell').append(el));g.el=document.querySelector('.drawer');g.backdrop=document.querySelector('.backdrop');}
      else if(swipeHome()&&dx<0&&!g.target.closest('.home-recent-list')&&shellNavigation.lastChat()){g.action='last-chat';g.el=document.querySelector('.sidebar');}
      else if(!state.drawer&&!swipeHome()&&dx>0){g.action='back';g.el=document.querySelector('.mainpane');if(state.mode==='chat'&&state.detail){g.home=document.querySelector('.sidebar');g.shell=document.querySelector('.shell');if(g.home&&g.shell)g.shell.classList.add('r21-back-home');}}
      else{pageSwipe=null;return;}
    }else{pageSwipe=null;return;}
    if(g.el){g.el.style.animation='none';g.el.style.transition='none';g.el.style.willChange='transform';}
  }
  if(e.cancelable)e.preventDefault();
  if(g.el){
    var x=0,y=0;if(g.action==='menu')x=Math.min(0,-g.el.getBoundingClientRect().width+Math.max(0,dx));
    else if(g.action==='dismiss-down')y=Math.max(0,dy);else if(g.action==='sheet-up')y=Math.max(-80,dy*.35);else x=g.action==='last-chat'||g.action==='dismiss'?Math.min(0,dx):Math.max(0,dx);
    g.el.style.transform='translate3d('+x+'px,'+y+'px,0)';var amount=g.action==='dismiss-down'?Math.max(0,dy):g.action==='sheet-up'?Math.max(0,-dy):Math.abs(dx),threshold=g.action==='dismiss-down'?g.el.getBoundingClientRect().height*.3:g.action==='sheet-up'?80:innerWidth*.35;g.el.dataset.r22DismissReady=String(amount>=threshold);if(g.el.classList.contains('drawer')){g.el.dataset.r22DragDirection=g.action==='dismiss-down'?'down':g.action==='sheet-up'?'up':'';var label=g.el.querySelector('.r22-sheet-gesture-label');if(label)label.textContent=g.action==='sheet-up'?(amount>=80?'松手全屏':'继续上拉'):(amount>=threshold?'松手关闭':'继续下拉');}if(g.backdrop)g.backdrop.style.opacity=String(Math.min(1,Math.max(0,dx/innerWidth)));
  }
  g.velocity=(t.clientX-g.lastX)/Math.max(1,now-g.lastTime);g.verticalVelocity=(t.clientY-g.lastY)/Math.max(1,now-g.lastTime);g.lastX=t.clientX;g.lastY=t.clientY;g.lastTime=now;
},{passive:false});
document.addEventListener('touchend',()=>{
  var g=pageSwipe;pageSwipe=null;if(!g?.action)return;
  if(g.action==='sheet-up'){if(g.dy<=-80)g.el.dataset.r22Full='true';clearSwipe(g,true);return;}
  var distance=g.action==='dismiss-down'?Math.max(0,g.dy):g.action==='last-chat'||g.action==='dismiss'?Math.max(0,-g.dx):Math.max(0,g.dx);
  var velocity=g.action==='dismiss-down'?g.verticalVelocity:(g.action==='last-chat'||g.action==='dismiss'?-g.velocity:g.velocity);
  var commit=distance>=(g.action==='dismiss-down'&&document.querySelector('.r22-session-sheet')?g.el.getBoundingClientRect().height*.3:innerWidth*.35)||((g.action==='dismiss-down'?distance>0:distance>=32)&&velocity>=(document.querySelector('.r22-session-sheet')?.5:.45)&&Date.now()-g.lastTime<100);
  suppressClick=true;setTimeout(()=>{suppressClick=false;},400);clearSwipe(g,commit);
  if(g.action==='menu'){
    if(commit){shellNavigation.preview(false);render();}
    else{state.drawer=null;render();shellNavigation.preview(false);}return;
  }
  if(!commit)return;
  if(g.action==='last-chat'){Hub.navigate(shellNavigation.lastChat());return;}
  if(['dismiss','dismiss-right','dismiss-down'].includes(g.action)){closePanel();return;}
  if(g.home)swipeHomeReturn=g;
  if(!shellNavigation.back()){swipeHomeReturn=null;state.detail=false;state.mode='chat';state.drawer=null;if(!finishHomeSwipe(g))renderHomeChat();}
},{passive:true});
document.addEventListener('touchcancel',abandonSwipe,{passive:true});

// 惯性滚动期间同一路由的整壳重绘推迟到停止；主动导航仍立即响应。
var scrollRenderUntil=0,scrollRenderPending=false,scrollRenderTimer=null,scrollRenderKey='',surfaceTouchActive=false,sheetPointerActive=false,sheetPointerEpoch=0;
var scrollRenderStats={deferred:0,rendered:0};
function currentRenderKey(){return [state.mode,state.detail,state.bot,state.conversation,state.drawer,state.boardView].join('|');}
function deferScrollRender(){
  if((surfaceTouchActive||sheetPointerActive||Date.now()<scrollRenderUntil)&&scrollRenderKey===currentRenderKey()){
    scrollRenderPending=true;scrollRenderStats.deferred++;return true;
  }
  scrollRenderPending=false;scrollRenderStats.rendered++;scrollRenderKey=currentRenderKey();return false;
}
function settleScrollRender(){
  clearTimeout(scrollRenderTimer);
  if(surfaceTouchActive||sheetPointerActive||Date.now()<scrollRenderUntil){scrollRenderTimer=setTimeout(settleScrollRender,180);return;}
  if(scrollRenderPending)render();
}
// 抽屉按键从按下到 click 结束保持同一节点，避免滚动收尾重绘吞掉点击。
document.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'&&e.button===0&&e.target.closest('.drawer')){sheetPointerEpoch++;sheetPointerActive=true;}},{capture:true});
function endSheetPointer(){var epoch=sheetPointerEpoch;setTimeout(()=>{if(epoch!==sheetPointerEpoch)return;sheetPointerActive=false;settleScrollRender();},80);}
document.addEventListener('pointerup',endSheetPointer,{capture:true});
document.addEventListener('pointercancel',endSheetPointer,{capture:true});
window.addEventListener('blur',endSheetPointer);
document.addEventListener('touchstart',e=>{if(e.isTrusted===true)surfaceTouchActive=true;},{passive:true,capture:true});
function endSurfaceTouch(e){if(e.isTrusted!==true)return;surfaceTouchActive=!!e.touches?.length;if(!surfaceTouchActive){scrollRenderUntil=Math.max(scrollRenderUntil,Date.now()+40);setTimeout(settleScrollRender,45);}}
document.addEventListener('touchend',endSurfaceTouch,{passive:true,capture:true});document.addEventListener('touchcancel',endSurfaceTouch,{passive:true,capture:true});
document.addEventListener('scroll',e=>{
  if(e.isTrusted!==true||e.target===document)return;
  scrollRenderUntil=Date.now()+180;clearTimeout(scrollRenderTimer);scrollRenderTimer=setTimeout(settleScrollRender,190);
},{passive:true,capture:true});
document.addEventListener('scrollend',()=>{scrollRenderUntil=0;settleScrollRender();},{passive:true,capture:true});
document.addEventListener('click',()=>{scrollRenderUntil=0;sheetPointerActive=false;sheetPointerEpoch++;setTimeout(settleScrollRender,0);},{capture:true});
function r25PatchKeeping(host,next,keep){
  if(host===keep)return;
  var branch=[...host.children].find(n=>n===keep||n.contains(keep));
  if(!branch)throw Error('输入节点不在保留路径内');
  var cls=branch.className?.split(/\s+/)[0];
  var replacement=[...next.children].find(n=>branch.id?n.id===branch.id:cls?n.classList.contains(cls):n.tagName===branch.tagName);
  if(!replacement)throw Error('输入节点的父结构不一致');
  if(branch!==keep)r25PatchKeeping(branch,replacement,keep);
  if(host.className!==next.className)host.className=next.className;
  var style=next.getAttribute('style');if(style!==null)host.setAttribute('style',style);
  [...host.childNodes].filter(n=>n!==branch).forEach(n=>n.remove());
  var after=false;[...next.childNodes].forEach(n=>{if(n===replacement){after=true;return;}if(after)host.append(n);else branch.before(n);});
}
function render(){if(pageSwipe?.action){scrollRenderPending=true;return;}if(deferScrollRender())return;Hub.currentMessages();var chatRoute=state.mode==='chat'&&(innerWidth>=700||state.detail)?state.conversation:null;shellReading.detach(chatRoute);shellRendering=true;render.chatRoute=chatRoute;if(state.boardReturn&&(state.mode!=='chat'||!chatRoute||state.conversation!==state.boardReturn.conversation))state.boardReturn=null;if(toast.scope&&toast.scope!==state.mode)clearToast();Hub.currentMessages();if(toast.conversation&&(state.mode!=='chat'||toast.conversation!==state.conversation))clearToast();var snapshot=Hub.contextSnapshot(state.conversation);if(snapshot){state.context=+(snapshot.total/1000).toFixed(1);state.contextMax=snapshot.max/1000;}let active=document.activeElement;let focusKey=active&&(active.id||(active.dataset.search?'search:'+active.dataset.search:active.dataset.focus?'focus:'+active.dataset.focus:'')),start=active&&active.selectionStart,end=active&&active.selectionEnd,activeValue=active?.value;let old=[...document.querySelectorAll('[data-scroll]')].filter(el=>!el.classList.contains('thread')).map(el=>[el.dataset.scroll,el.scrollTop,el.scrollLeft]);old.forEach(([k,t,l])=>{if(k==='bots'||k==='board'||k.startsWith('board-col-')||k.startsWith('page-')||k==='capabilities')viewScrollMemory.set(k,[t,l]);});let ds=document.querySelector('.r22-sheet-content')?.scrollTop||0;let sheetIdentity=state.drawer+':'+(state.customTitle||'');let full=document.querySelector('.r22-sheet[data-r22-full="true"]')&&render.sheetIdentity===sheetIdentity;var app=document.getElementById('app'),oldView=document.getElementById('hub-view'),oldChat=oldView?.querySelector('.chatview'),keep=chatRoute&&oldChat?.dataset.conversation===chatRoute&&oldView;var nextShell=shell();if(keep)r25PatchKeeping(app.firstElementChild,Hub.fromHTML(nextShell),keep);else app.innerHTML=nextShell;Hub.mount();document.querySelectorAll('[data-scroll]').forEach(el=>{if(el.classList.contains('thread'))return;let k=el.dataset.scroll,saved=old.find(row=>row[0]===k)?.slice(1)||viewScrollMemory.get(k);if(saved){el.scrollTop=saved[0];el.scrollLeft=saved[1];}});let drawer=document.querySelector('.drawer');if(drawer){let content=drawer.querySelector('.r22-sheet-content');if(content)content.scrollTop=render.sheetIdentity===sheetIdentity?ds:0;if(full)drawer.dataset.r22Full='true';}render.sheetIdentity=sheetIdentity;let focus=focusKey&&(focusKey.startsWith('search:')?document.querySelector('[data-search="'+focusKey.slice(7)+'"]'):focusKey.startsWith('focus:')?document.querySelector('[data-focus="'+focusKey.slice(6)+'"]'):document.getElementById(focusKey));var draftRefocus=state.refocus;if(state.refocus){focus=document.querySelector('[data-focus="composer"]');state.refocus=false}if(focus){if(document.activeElement!==focus)focus.focus({preventScroll:true});var draftEnd=focus.dataset.focus==='composer'&&(draftRefocus||focus.value!==activeValue||!keep);if(focus.setSelectionRange&&(draftEnd||typeof start==='number')&&focus.type!=='search')try{focus.setSelectionRange(...(draftEnd?[focus.value.length,focus.value.length]:[start,end]))}catch(e){}}state.animate=false;paintAtMenu();resizeInput();chiefPet.sync();Hub.emit('render',Hub.context());shellRendering=false;Hub.measureDock();if(chatRoute)shellReading.attach(document.querySelector('.thread'),chatRoute);document.title='SDS · '+(state.mode==='chat'?botBy(state.bot).name:Hub.viewTitle(state.mode));shellNavigation.sync();r22Continuity.saveRoute();r22Discover();}
function syncQuickFadeListener(quick){
  if(!quick.dataset.shellQuickFade){quick.dataset.shellQuickFade='true';quick.addEventListener('scroll',()=>syncQuickFade(quick),{passive:true});}
}
function syncQuickFade(quick){
  if(!quick)return;var flag=quick.scrollWidth-quick.clientWidth-quick.scrollLeft>1?'true':'false';
  if(quick.dataset.overflowEnd!==flag)quick.dataset.overflowEnd=flag;syncQuickFadeListener(quick);
}
function clearToast(){clearTimeout(toast.timer);toast.scope=null;toast.conversation=null;let el=document.getElementById('toast');el.className='';el.replaceChildren();document.querySelector('.shell-drawer-toast')?.remove()}
// Visible rectangles are clipped to scroll containers, so offscreen message controls do not block notices.
function shellVisibleRect(el){
  if(!el||el.hidden)return null;var r=el.getBoundingClientRect();
  if(!r.width||!r.height)return null;
  var out={left:r.left,right:r.right,top:r.top,bottom:r.bottom};
  for(var node=el;node&&node!==document;node=node.parentNode){
    if(node.hidden)return null;
    if(window.getComputedStyle&&node instanceof HTMLElement){var css=getComputedStyle(node);if(css.display==='none'||css.visibility==='hidden'||css.opacity==='0')return null;
      if(node!==el){var clip=node.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(css.overflowX)){out.left=Math.max(out.left,clip.left);out.right=Math.min(out.right,clip.right);}if(/auto|scroll|hidden|clip/.test(css.overflowY)){out.top=Math.max(out.top,clip.top);out.bottom=Math.min(out.bottom,clip.bottom);}}
    }
  }
  out.top=Math.max(0,out.top);out.bottom=Math.min(innerHeight,out.bottom);out.left=Math.max(0,out.left);out.right=Math.min(innerWidth,out.right);
  return out.right>out.left&&out.bottom>out.top?out:null;
}
function positionToast(){
  if(!document.getElementById('toast')?.classList.contains('toast'))return;
  var pane=document.querySelector('.mainpane'),el=document.getElementById('toast');if(!pane||!el)return;
  if(positionToast.pane!==pane&&window.ResizeObserver){positionToast.observer?.disconnect();positionToast.pane=pane;positionToast.observer=new ResizeObserver(frameLayout(positionToast));positionToast.observer.observe(pane);}
  var home=innerWidth<700&&!state.detail,surface=home?document.querySelector('.sidebar'):pane,r=surface.getBoundingClientRect();
  var chat=state.mode==='chat'&&!home,column=chat?document.querySelector('.thread-inner'):null,col=column?.getBoundingClientRect()||r;
  el.style.setProperty('--toast-center',(col.left+col.width/2)+'px');el.style.setProperty('--toast-width',Math.max(0,Math.min(col.width,r.width)-32)+'px');
  if(!el.classList.contains('toast'))return;
  var dock=chat?document.querySelector('.composer-area'):null,limit=Math.min(innerHeight,r.bottom)-12;
  if(dock)limit=Math.min(limit,dock.getBoundingClientRect().top-12);
  if(!chat)document.querySelectorAll('.side-bottom,.tabbar').forEach(bar=>{var br=shellVisibleRect(bar);if(br&&br.top>innerHeight/2)limit=Math.min(limit,br.top-8);});
  var box=el.getBoundingClientRect(),height=box.height,half=box.width/2,center=col.left+col.width/2,top=limit-height;
  // 归档撤销固定在首页底栏上8px，不再被列表中的按钮逐步顶到屏幕中间。
  if(home&&el.querySelector('[data-r22-archive-undo]')){el.style.setProperty('--toast-position-bottom',Math.max(12,innerHeight-limit)+'px');return;}
  var floor=Math.min(top,r.top+r.height/2),obstacles=[];
  document.querySelectorAll('button,a,[data-act],.m-interact-bottom,.shell-floating-call,[data-background-hint]').forEach(node=>{if(node===el||el.contains(node)||node.classList.contains('backdrop'))return;var visible=shellVisibleRect(node);if(visible)obstacles.push(visible);});
  for(var pass=0;pass<=obstacles.length;pass++){
    var hits=obstacles.filter(o=>center+half>o.left&&center-half<o.right&&top+height>o.top-8&&top<o.bottom+8);
    if(!hits.length)break;var next=Math.max(floor,Math.min(...hits.map(o=>o.top-height-8)));if(next>=top)break;top=next;
  }
  el.style.setProperty('--toast-position-bottom',Math.max(12,innerHeight-top-height)+'px');
}
window.addEventListener('resize',positionToast);
document.addEventListener('scroll',()=>{if(document.getElementById('toast')?.classList.contains('toast'))positionToast();},true);
function toast(text,scope){clearToast();toast.scope=scope||null;toast.conversation=state.mode==='chat'?state.conversation:null;let el=document.getElementById('toast');el.className='toast';el.textContent=text;positionToast();let head=document.querySelector('.drawer .dhead');if(head){let note=Hub.h('p',{class:'shell-drawer-toast',role:'status'},text);head.before(note);note.scrollIntoView({block:'nearest',behavior:'instant'})}toast.timer=setTimeout(clearToast,2600)}
// Only single-column home/chat entry and return use a page transition.
function renderHomeChat(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){render();document.querySelector('.mainpane')?.animate?.([{opacity:.65},{opacity:1}],demoFixture("core.sample.104"));return;}
  if(innerWidth>=700||typeof document.startViewTransition!=='function'||matchMedia('(prefers-reduced-motion: reduce)').matches){render();return;}
  state.animate=false;document.startViewTransition(()=>render());
}
// Schedule after synchronous send/running renders; classes never live on message history.
function animateMessage(conversation,message,kind){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  requestAnimationFrame(()=>{
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||render.chatRoute!==conversation)return;
    var article=[...document.querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===message.id);
    var bubble=article?.querySelector(kind==='sent'?'.user-bubble':'.hub-part');
    if(!bubble)return;
    var cls=kind==='sent'?'message-sent':'message-done';
    bubble.classList.add(cls);
    var clear=()=>bubble.classList.remove(cls);
    bubble.addEventListener('animationend',clear,{once:true});
    bubble.addEventListener('animationcancel',clear,{once:true});
    setTimeout(clear,200);
  });
}
function selectBot(id){state.boardReturn=null;state.mode='chat';state.bot=id;state.detail=true;state.animate=true;state.playing=null;state.emotion='开心';state.bots.find(b=>b.id===id).unread=0;state.drawer=null;state.search='';renderHomeChat()}
function insertMention(name){state.input=state.input.replace(/@([^\s@]*)$/,'')+(state.input&&!state.input.endsWith(' ')?' ':'')+'@'+name+' ';state.mode='chat';state.detail=true;state.drawer=null;state.refocus=true;render()}
function paintAtMenu(){let el=document.querySelector('.atmenu');if(!el)return;let match=state.input.match(/@([^\s@]*)$/);let slash=state.input.match(/^\/(\w*)$/);el.hidden=!match&&!slash;if(match)el.innerHTML=state.bots.filter(b=>b.name.includes(match[1])).map(b=>'<button data-act="mention" data-name="'+esc(b.name)+'">'+avatar(b.id)+'<span>'+esc(b.name)+'<br><em>'+esc(SHORT[b.id])+'</em></span></button>').join('');else if(slash)el.innerHTML=['context','plan','side'].filter(x=>x.startsWith(slash[1])).map(x=>'<button data-act="command" data-name="'+x+'">/'+x+' <em>'+{context:'查看上下文',plan:'切换计划模式',side:'侧边问话'}[x]+'</em></button>').join('')}
function resizeInput(){let el=document.querySelector('[data-focus="composer"]');if(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px'}}
let runTimer;
function runReply(text,bot=state.bot){
  var conversation=state.conversation;
  if(bot==='chief')setChiefFace('normal',0,conversation);
  state.running=true;state.stopped=false;state.emotion='思考';chiefPet.turn(bot,'thinking');render();clearTimeout(runTimer);
  runTimer=setTimeout(()=>{
    state.running=false;
    var confused=bot==='chief'&&(text.includes('？？')||text.includes('没听懂'));
    state.emotion=confused?'抱歉':'开心';chiefPet.turn(bot,confused?'confused':'done');
    if(bot==='chief')setChiefFace(confused?'confused':'done',confused?2400:1600,conversation);
    let mentions=state.bots.filter(b=>text.includes('@'+b.name));
    let reply=confused?'这句我没完全听懂，能换个说法吗？':mentions.length?'已按点名分给 '+mentions.map(b=>b.name).join('、')+demoText("core.reply.105"):'收到。我把「'+text.slice(0,48)+'」留在这段对话里。涉及外发的内容会先整理成草稿，等你拍板。';
    let replyMessage={role:'bot',time:'刚刚',text:reply};state.threads[bot].push(replyMessage);render();
    if(state.bot===bot)animateMessage(state.conversation,replyMessage,'done');
    if(bot==='chief'&&!confused)animateChiefDone(conversation);
    if(state.queue.length){let next=state.queue.shift();if(window.r29DeliverQueued)window.r29DeliverQueued(next,bot);else{Hub.postMessage(state.conversation,{role:'user',time:'刚刚',text:next});runReply(next,bot)}}
  },1900);
}
function send(){if(!r25CanSend())return;let text=state.input.trim();if(!text&&!state.attachments.length)return;if(text.startsWith('/context')){state.input='';openPanel('context');return}if(text.startsWith('/plan')){state.input='';state.plan=!state.plan;openPanel('permission');return}if(text.startsWith('/side')){state.input='';customPanel('侧边一句','<p class="muted">主任务继续，这里只接一段旁问。</p><label class="field">你的问题<textarea id="side-question">'+esc(text.replace('/side','').trim())+'</textarea></label><button class="primary" style="margin-top:16px" data-act="side-answer">发送侧边问话</button>');return}if(state.running&&state.sendMode==='queue'){state.queue.push(text);state.input='';render();toast('已排队，可编辑或移除');return}if(state.running){clearTimeout(runTimer);state.running=false;toast('已插话，本轮停止后接新消息')}Hub.postMessage(state.conversation,{role:'user',time:'刚刚',text:text||(state.attachments.length+' 个本地附件，未上传')});r25ClearComposer();state.attachments=[];runReply(text)}
async function copyText(text){
  text=String(text??'');
  function fallback(){
    var active=document.activeElement,start=active?.selectionStart,end=active?.selectionEnd,field=document.createElement('textarea');
    field.value=text;field.setAttribute('readonly','');field.setAttribute('aria-hidden','true');field.style.cssText='position:fixed;left:-9999px;top:0;font-size:16px;opacity:0';document.body.append(field);
    var ok=false;try{field.focus({preventScroll:true});field.select?.();field.setSelectionRange(0,text.length);ok=!!document.execCommand?.('copy');}catch(e){}finally{field.remove();if(active?.isConnected){active.focus({preventScroll:true});if(typeof start==='number')try{active.setSelectionRange(start,end);}catch(e){}}}
    toast(ok?'已复制':'请长按选中复制');return ok;
  }
  try{if(window.isSecureContext&&navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);toast('已复制');return true;}}catch(e){}
  return fallback();
}
const SKINS=[['pop','Pop 杂志 · 默认'],['island','岛屿 · 薄荷奶油'],['ball','精灵球 · 红白'],['wild','旷野 · 青绿羊皮纸'],['pipe','水管工 · 天蓝砖红'],['ink','墨汁 · 荧光绿紫'],['puff','粉球 · 草莓粉']];
function skinSelect(){return '<select data-change="skin" aria-label="皮肤">'+SKINS.map(([k,n])=>'<option value="'+k+'" '+(state.skin===k?'selected':'')+'>'+n+'</option>').join('')+'</select>'}
function r22SyncThemeColor(){
  var dark=document.documentElement.dataset.theme==='dark',covered=!!state.drawer||!!document.querySelector('.r22-fan-shade');
  var color=covered?(dark?'#1C3231':'#A5B4A3'):(dark?'#173A3E':'#D5EEDD');
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta=>{if(meta.content!==color)meta.content=color;});return color;
}
function applyTheme(){let actual=state.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):state.theme;document.documentElement.dataset.theme=actual;if(!SKINS.some(s=>s[0]===state.skin))state.skin='pop';if(state.skin==='pop')delete document.documentElement.dataset.skin;else document.documentElement.dataset.skin=state.skin;let themeColor=(typeof getComputedStyle==='function'&&getComputedStyle(document.documentElement).getPropertyValue('--ground').trim())||(actual==='dark'?'#173A3E':'#D5EEDD');document.querySelectorAll('meta[name="theme-color"]').forEach(meta=>{meta.content=themeColor;});r22SyncThemeColor();try{localStorage.setItem('hub-demo-theme',state.theme);localStorage.setItem('hub-demo-skin',state.skin)}catch(e){}}
function panelInfo(act){switch(act){case 'trajectory':customPanel('执行轨迹与待决定',trajectory()+demoText("core.sample.106")+openCount()+' 件</strong>'+ico('chevron')+'</button><button class="textbutton" data-act="jobs">后台任务与本轮结果 '+ico('jump')+'</button>');break;case 'bili':customPanel(demoText("core.sample.107"),'<span class="pill">只读 · 匿名路线</span><div class="segmented"><button class="on">今日结果</button><button data-act="bili-settings">设置</button></div><div class="surface"><h3>第 1 轮 · 推荐</h3><p class="muted">AI 助手怎样记住昨天<br>来源：公开热门 · 示例选题卡<br>状态：公开信息可读；字幕接口 412 后停止。</p></div><div class="surface"><h3>第 1 轮 · 不推荐</h3><p class="muted">重复型号盘点，缺少可核对演示。</p></div><button class="ghostbtn" style="margin-top:17px" data-act="bili-run">现在跑一轮 · 演示</button>');break;case 'sound':customPanel('语音与朗读','<label class="field">输入设备<select><option>系统默认麦克风 · 未请求权限</option></select></label><label class="field">声音<select><option>温柔 · 中文 / 日本語</option><option>清晰 · 叙述</option></select></label><div class="actions"><button class="primary" data-act="voice">听写界面</button><button class="ghostbtn" data-act="tts" data-index="0">试听 / 停止</button></div><p class="mini-note">仅模拟波形和播放状态，不录音、不合成音频。</p>');break;case 'pair':customPanel('渠道与设备配对',demoText("core.sample.108"));break;case 'devices':customPanel('设备与授权',demoText("core.sample.109"));break;case 'backup':customPanel('备份与恢复步骤','<div class="surface"><h3>demo-v1-B</h3><ol class="plan"><li><span class="box">1</span>保留当前版本与未提交内容。</li><li><span class="box">2</span>在隔离目录恢复备份。</li><li><span class="box">3</span>核对版本、差异与启动状态。</li><li><span class="box">4</span>人工验收后再决定替换。</li></ol><p class="muted">以上为恢复流程预览，不执行覆盖。</p></div>');break;case 'live':customPanel('直播与大屏导播',demoText("core.sample.110")+toggle('显示辅助字幕','subtitles')+toggle('显示导播内心戏','thoughts')+'</div>');break;case 'openai-image':customPanel('OpenAI 图像','<span class="pill neutral">未连接 · 无生成调用</span><label class="field">图片任务<textarea placeholder="描述要生成的画面"></textarea></label><label class="field">画幅<select><option>方形 · 1:1</option><option>竖版 · 2:3</option><option>横版 · 3:2</option></select></label><p class="mini-note">生成入口保留；本离线样张不会提交付费任务。</p><button class="ghostbtn" style="margin-top:16px" data-act="image-draft">保留任务草稿</button>');break;case 'comfy-result':customPanel('出图结果 · 示例卡','<div class="surface"><p class="eyebrow">本地工作流 · 预览结果位置</p>'+avatar('art').replace('class="creature bot-avatar"','class="creature bot-avatar" style="width:150px;height:150px;margin:auto"')+demoText("core.sample.111")+state.lora+demoText("core.sample.112"));break;case 'canvas':customPanel('工作画布','<label class="field">图示标题<input id="canvas-title" value="先草稿，再审批"></label><svg class="canvas" viewBox="0 0 380 220" aria-label="可编辑标题的工作流画布"><path d="M105 110h60m90 0h35" stroke="var(--sage)" stroke-width="2"/><rect x="15" y="80" width="90" height="60" rx="15" fill="var(--sage-soft)"/><rect x="165" y="80" width="90" height="60" rx="15" fill="var(--blush)"/><rect x="290" y="80" width="75" height="60" rx="15" fill="var(--sage-soft)"/><g font-size="13" fill="var(--ink)" text-anchor="middle"><text x="60" y="115">草稿</text><text x="210" y="115">人工批准</text><text x="328" y="115">交付</text><text id="canvas-label" x="190" y="40">先草稿，再审批</text></g></svg><div class="actions"><button class="primary" data-act="canvas-copy">导出 · 复制 SVG</button><button class="ghostbtn" data-act="canvas-reference">引用到聊天</button></div>');break;case 'cua-panel':customPanel('电脑操作 CUA','<span class="pill neutral">官方 bundle 已装但禁用 · 文档记录</span>'+cuaSVG()+'<p class="muted">只授权当前一轮，保留逐步截图与结果。此处的授权开关仅改变样张状态。</p><div class="actions"><button class="primary" data-act="cua">'+(state.cua?'撤销授权':'本轮临时授权')+'</button><button class="ghostbtn" data-act="task-mode">操作步骤与证据</button></div>');break;case 'terminal':customPanel('终端 · 只读演示',demoText("core.sample.113")+ico('jump')+'</button>');break;case 'reference':customPanel('引用一段会话',demoText("core.sample.114"));break;default:return false}return true}
state.extraSessions=[];
const baseSessionsHTML=sessionsPanel;
sessionsPanel=function(){return baseSessionsHTML()+(state.extraSessions.length?'<p class="setting-head">新建与分叉会话</p>'+state.extraSessions.map((s,i)=>demoText("core.sample.115")+i+'">'+ico('branch')+'<span class="grow"><strong>'+esc(s.name)+'</strong><small>'+botBy(s.bot).name+' · '+s.messages.length+' 条消息</small></span>'+ico('chevron')+'</button>').join(''):'')};
function newSessionForm(branch=false,bot=state.bot,index=null){state.sessionTarget=bot;state.branchIndex=index;state.isBranch=branch;customPanel(branch?'分叉这段会话':'新建会话','<label class="field">会话名称<input id="new-session-name" value="'+esc((branch?state.sessionNames[bot]+' · 分叉':'新的协作'))+'" maxlength="48"></label><p class="mini-note">'+(branch?'保留所选位置之前的消息。':'原会话保留为历史快照。')+'仅在当前页创建。</p><button class="primary" style="margin-top:18px" data-act="create-session">'+(branch?'创建分叉':'创建会话')+'</button>')}
function openMode(mode){state.boardReturn=null;state.mode=mode;state.animate=true;state.drawer=null;render()}
function closePanel(){
  var sheet=document.querySelector('.r22-session-sheet');if(sheet&&typeof getComputedStyle==='function'&&!sheet.dataset.r22Leaving){sheet.dataset.r22Leaving='true';setTimeout(closePanel,matchMedia('(prefers-reduced-motion: reduce)').matches?120:240);return;}

  if(shellNavigation.back())return;
  let target=panelReturn;panelReturn=null;panelTrigger=null;panelHistory=[];state.drawer=null;render();
  let controls=[...document.querySelectorAll('button,a,input,select,textarea,[tabindex]')];
  let opener=controls.includes(target?.node)?target.node:controls.find(el=>panelIdentity(el)===target?.key);
  let focus=opener||document.querySelector('.mainpane');if(focus){if(!opener)focus.setAttribute('tabindex','-1');focus.focus({preventScroll:true});}
}
let suppressClick=false;
document.addEventListener('click',e=>{if(suppressClick){suppressClick=false;e.preventDefault?.();e.stopImmediatePropagation?.();return}let el=e.target.closest('[data-act]');if(!el){let card=e.target.closest('.kcard');if(card){state.cardId=card.dataset.id;openPanel('card',card)}let node=e.target.closest('.node');if(node){state.cardId=node.dataset.id;openPanel('card')}return}let a=el.dataset.act,d=el.dataset;let direct=['more','usage','context','model','permission','profile','sources','settings','tools','comfy','schedule','jobs','sessions','files','attachments','decisions'];if(direct.includes(a)){if(a==='profile'&&d.botProfile)state.bot=d.botProfile;openPanel(a,el);return}if(panelInfo(a))return;
switch(a){case 'session-menu':openPanel('session-menu');return;case 'full-mode':state.fullMode=!state.fullMode;state.collapsed=false;render();return;case 'mode':openMode(d.mode);return;case 'bot':selectBot(d.id);return;case 'back':if(shellNavigation.back())return;state.boardReturn=null;state.detail=false;state.mode='chat';state.drawer=null;renderHomeChat();return;case 'collapse':state.collapsed=!state.collapsed;render();return;case 'close':if(el.classList.contains('backdrop')&&Date.now()<panelBackdropUntil)return;closePanel();return;case 'panel-back':backPanel();return;case 'card-owner':goToCardOwner(d.cardOwner);return;case 'return-board':Hub.returnToBoard();return;case 'task':state.taskId=d.id;render();return;case 'task-mode':openMode('task');return;case 'open-task':state.taskId=d.id;openMode('task');return;case 'open-card':state.cardId=d.id;state.mode='kanban';openPanel('card');return;case 'scope':state.boardScope=d.scope;state.boardAssistant=d.assistant||null;render();return;case 'question-scope':state.boardScope=d.scope;render();toast('已记录验收范围');return;case 'board-view':state.boardView=state.boardView==='columns'?'particles':'columns';render();return;case 'move':stageBoardMove(state.cardId,d.col);return;case 'decide':{let decision=decBy(d.id);if(!decision||isClosed(decision))return;if(d.op==='edit'){state.bot=decision.bot;state.mode='chat';state.detail=true;state.drawer=null;state.input=decision.kind==='草稿'?'日文第二段再短一点，其余别动，不加价格。':'我想改这一处：';decision.status='edit';state.refocus=true;render();toast('修改意见已放入输入框');return}decision.status=d.op==='approve'?'approved':'rejected';render();toast(d.op==='approve'?'已记录批准，仅更新样张状态':'已记录，不执行');return}case 'preview':state.previewId=d.file;openPanel('preview');return;case 'copy-delivery':copyText(FILES.receipt.body);return;case 'mention-picker':openPanel('mention');return;case 'mention':insertMention(d.name);return;case 'send':send();return;case 'continue':runReply('继续上一轮任务。');return;case 'stop':clearTimeout(runTimer);state.running=false;state.stopped=true;state.emotion='开心';render();toast('本轮已停止，草稿保留');return;case 'simulate-run':state.drawer=null;state.detail=true;state.mode='chat';state.running=true;state.emotion='思考';render();toast('运行演示已开始：按 Enter 排队，圆按钮停止');return;case 'send-queue':state.sendMode='queue';render();return;case 'send-interrupt':state.sendMode='interrupt';render();return;case 'edit-queue':state.input=state.queue.shift()||'';state.refocus=true;render();return;case 'clear-queue':state.queue=[];render();return;case 'voice':state.voice=!state.voice;state.drawer=null;state.detail=true;state.mode='chat';state.playing=null;render();return;case 'finish-voice':state.voice=false;state.input='帮我把今天需要拍板的事整理一下。';state.refocus=true;render();toast('示例转写已放入输入框，尚未发送');return;case 'tts':state.playing=state.playing!==null?null:Number(d.index||0);if(state.playing!==null){clearTimeout(state.ttsTimer);state.ttsTimer=setTimeout(()=>{state.playing=null;render()},4500)}render();toast(state.playing!==null?'播放状态演示 · 未调用语音服务':'已停止朗读');return;case 'copy-message':{let m=state.threads[state.bot][Number(d.index)];copyText(m?.text||'草稿与审批卡 · 请展开内容复制');return}case 'retry-message':runReply('重新整理这条回复。');return;case 'branch-message':newSessionForm(true,state.bot,Number(d.index));return;case 'quote-message':{let m=state.threads[state.bot][Number(d.index)];state.input='引用 #'+state.bot+'-013：“'+(m?.text||'这张审批卡').slice(0,80)+'”\n';state.refocus=true;render();return}case 'round-stats':customPanel('本轮统计','<div class="surface"><h3>'+state.model+' · '+state.strength+demoText("core.sample.116"));return;case 'select-model':state.model=d.name;state.contextMax=MODEL_INFO[d.name].context;state.context=Math.min(state.context,Math.round(state.contextMax*.91));state.strength=MODEL_INFO[d.name].level.includes(state.strength)?state.strength:MODEL_INFO[d.name].level[0];render();return;case 'strength':state.strength=d.name;render();return;case 'select-permission':state.permission=d.name;render();return;case 'toggle':state[d.key]=!state[d.key];render();return;case 'toggle-actor':state.actor=!state.actor;render();return;case 'compress':state.context=48;state.compressed=true;render();toast('压缩演示完成，占用更新为 '+contextPct()+'%');return;case 'fill-context':state.context=Math.round(state.contextMax*.91);render();return;case 'usage-by':state.usageBy=d.key;render();return;case 'usage-day':state.usageDay=Number(d.day);render();return;case 'usage-session':state.bot='chief';state.mode='chat';state.detail=true;state.drawer=null;render();return;case 'settings-tab':state.settingsTab=d.key;render();return;case 'settings-services':state.settingsTab='services';openPanel('settings');return;case 'settings-bot':state.settingsTab='bot';openPanel('settings');return;case 'preview-light':state.theme='light';applyTheme();render();return;case 'preview-dark':state.theme='dark';applyTheme();render();return;case 'save-bot':toast('已保存；只影响这位助理的下一条新会话');return;case 'accept-stage':state.stageAccepted[state.taskId]=true;render();toast('本阶段已人工确认');return;case 'ask-stage':state.input='关于「'+taskBy(state.taskId).title+'」，这一处需要修改：';state.bot=taskBy(state.taskId).bot;state.mode='chat';state.detail=true;state.refocus=true;render();return;case 'tool':state.openTools[d.key]=!state.openTools[d.key];render();return;case 'goal-toggle':state.jobPaused=!state.jobPaused;render();toast(state.jobPaused?'目标已暂停':'目标已继续');return;case 'goal-edit':customPanel('修改会话目标','<label class="field">目标<textarea id="goal-text">完成三端样张，保留功能并核对交互。</textarea></label><button class="primary" style="margin-top:17px" data-act="save-goal">保存目标</button>');return;case 'save-goal':state.goal=document.getElementById('goal-text').value;openPanel('jobs');toast('目标已更新');return;case 'cua':state.cua=!state.cua;render();toast(state.cua?'本轮授权状态已更新 · 仅演示':'已撤销演示授权');return;case 'system':state.system=d.sys;render();return;case 'emotion':if(typeof stageEmotion==='function')stageEmotion(d.emo);return;case 'zoom-in':state.zoom=Math.min(1.5,state.zoom+.1);render();return;case 'zoom-out':state.zoom=Math.max(.6,state.zoom-.1);render();return;case 'reset-actor':state.actorX=0;state.actorY=0;state.zoom=1;render();return;case 'pick-file':state.drawer=null;render();document.getElementById('fileinput').click();return;case 'preview-attach':{let f=state.attachments[Number(d.index)];customPanel('附件预览','<p class="muted">'+esc(f.name)+' · 本地，未上传</p><div class="surface">'+(f.url?'<img alt="本地附件" src="'+f.url+demoText("core.sample.117"):f.text?'<div class="prebody">'+esc(f.text.slice(0,16000))+'</div>':'<p class="muted">文件已选择，正文预览待接入。可在文件面板查看 PDF / Office 的示例位置。</p>')+'</div>');return}case 'retry-attach':readLocalAttachment(state.attachments[Number(d.index)]).then(()=>{render();toast('已重试本地读取')});return;case 'remove-attach':state.attachments.splice(Number(d.index),1);render();return;case 'insert-reference':state.input=demoText("core.sample.118");state.drawer=null;state.mode='chat';state.detail=true;state.refocus=true;render();return;case 'side-answer':{let q=document.getElementById('side-question').value;customPanel('侧边一句 · 回答','<div class="surface"><h3>'+esc(q||'今天要先看什么？')+'</h3><p class="muted">先看待你拍板里的日文草稿与发布卡，主任务保持原状。</p></div><button class="ghostbtn" style="margin-top:16px" data-act="close">回到主任务</button>');return}case 'command':if(d.name==='context'){state.input='';openPanel('context')}else if(d.name==='plan'){state.input='';state.plan=!state.plan;openPanel('permission')}else{state.input='/side ';state.refocus=true;render()}return;case 'new-session':newSessionForm();return;case 'branch-session':newSessionForm(true,d.id);return;case 'create-session':{let bot=state.sessionTarget,name=document.getElementById('new-session-name').value.trim()||'新的协作';let old=state.threads[bot];state.extraSessions.push({name:state.sessionNames[bot]+' · 历史',bot,messages:old.slice()});let msgs=state.isBranch?old.slice(0,state.branchIndex===null?old.length:state.branchIndex+1):[];state.threads[bot]=msgs;state.sessionNames[bot]=name;state.bot=bot;state.detail=true;state.mode='chat';state.drawer=null;if(state.nextBot[bot]){state.model=state.nextBot[bot].model;state.strength=state.nextBot[bot].strength;state.contextMax=MODEL_INFO[state.model].context}render();toast(state.isBranch?'分叉已创建，原会话保留':'新会话已创建，原会话保留');return}case 'extra-session':{let s=state.extraSessions[Number(d.index)];let old={name:state.sessionNames[s.bot],bot:s.bot,messages:state.threads[s.bot].slice()};state.threads[s.bot]=s.messages.slice();state.sessionNames[s.bot]=s.name;state.extraSessions[Number(d.index)]=old;selectBot(s.bot);return}case 'session-open':selectBot(d.id);return;case 'rename-session':state.sessionTarget=d.id;customPanel('重命名会话','<label class="field">标题<input id="session-rename" value="'+esc(state.sessionNames[d.id])+'"></label><button class="primary" style="margin-top:16px" data-act="save-rename">保存标题</button>');return;case 'save-rename':state.sessionNames[state.sessionTarget]=document.getElementById('session-rename').value.trim()||state.sessionNames[state.sessionTarget];openPanel('sessions');return;case 'archive-session':if(state.archives.includes(d.id)){state.archives=state.archives.filter(x=>x!==d.id);render();toast('会话已恢复');}else r22Archive(d.id);return;case 'pin-session':r22TogglePin(d.id);return;case 'copy-id':copyText('#'+d.id+'-013');return;case 'file-preview':if(d.file==='receipt'){openPanel('preview');return}customPanel({code:'代码预览',pdf:'PDF 预览',office:'Office 预览',image:'图片预览'}[d.file],d.file==='code'?'<div class="surface">'+diffHTML()+'</div>':d.file==='image'?'<div class="surface">'+characterSVG(state.system,state.emotion)+'</div>':d.file==='pdf'?demoText("core.sample.119"):demoText("core.sample.120"));return;case 'edit-schedule':customPanel('编辑定时规则',demoText("core.sample.121"));return;case 'new-schedule':customPanel('新建定时任务',demoText("core.sample.122"));return;case 'save-schedule':state.scheduleTime=document.getElementById('schedule-time')?.value||demoText("core.sample.123");state.newSchedule=document.getElementById('schedule-name')?.value;openPanel('schedule');toast('定时规则已留在样张，不注册真实任务');return;case 'schedule-history':customPanel('投递历史',demoText("core.sample.124")+ico('jump')+'</button></div>');return;case 'demo-pair':state.paired=!state.paired;customPanel('配对演示','<div class="surface"><span class="pill">'+(state.paired?'模拟设备已配对':'已取消模拟配对')+'</span><p class="muted" style="margin-top:14px">设备标识：demo-••13<br>真实连接：未建立<br>凭据：未读取，未写入</p></div>');return;case 'bili-settings':customPanel(demoText("core.sample.125"),'<div class="surface"><h3>匿名公开信息</h3><p class="muted">不登录、不点赞、不评论。<br>读取异常就停止，不绕过验证。<br>只在本轮产出后等待下一次人工触发。</p></div>');return;case 'bili-run':toast('本轮已有结果，不重复启动');return;case 'demo-stop':toast('已停止队列预览，未调用出图服务');return;case 'canvas-copy':copyText(document.querySelector('.canvas').outerHTML);return;case 'canvas-reference':state.input='引用画布：「'+document.getElementById('canvas-title').value+'」\n';state.drawer=null;state.mode='chat';state.detail=true;state.refocus=true;render();return;case 'image-draft':toast('任务草稿留在工具面板，未提交生成');return;
}});
const oldSchedulePanel=schedulePanel;schedulePanel=function(){return oldSchedulePanel().replaceAll(demoText("core.sample.126"),state.scheduleTime||demoText("core.sample.127"))+(state.newSchedule?'<div class="surface"><h3>'+esc(state.newSchedule)+'</h3><p class="muted">下次 今天 '+esc(state.scheduleTime)+' · 本地规则演示</p></div>':'')};
document.addEventListener('input',e=>{let el=e.target;if(el.dataset.focus==='composer'){document.body.classList.toggle('r22-input-active',!!el.value);state.input=el.value;paintAtMenu();resizeInput();let send=document.querySelector('.voicebtn');if(send&&!state.running){send.dataset.act=state.input.trim()?'send':'voice';send.setAttribute('aria-label',state.input.trim()?'发送消息':'开始语音对话');send.innerHTML=ico(state.input.trim()?'send':'wave')}}if(el.id==='botsearch'){state.search=el.value;render()}if(el.dataset.search){state.panelSearch=el.value;render()}if(el.id==='canvas-title'){let label=document.getElementById('canvas-label');if(label)label.textContent=el.value}if(el.dataset.config){let b=state.bot;if(!state.nextBot[b])state.nextBot[b]={model:state.model,strength:state.strength,workspace:'/demo/'+state.project,level:'L1',memory:'私有 + 共享白名单'};state.nextBot[b][el.dataset.config]=el.value}});
document.addEventListener('change',e=>{let el=e.target;if(el.dataset.config){if(!state.nextBot[state.bot])state.nextBot[state.bot]={model:state.model,strength:state.strength,workspace:'/demo/'+state.project,level:'L1',memory:'私有 + 共享白名单'};state.nextBot[state.bot][el.dataset.config]=el.value;if(el.dataset.config==='model'){state.nextBot[state.bot].strength=MODEL_INFO[el.value].level[0];render()}return}switch(el.dataset.change){case 'project':state.project=el.value;render();break;case 'theme':state.theme=el.value;applyTheme();render();break;case 'skin':state.skin=el.value;applyTheme();render();break;case 'stage-bot':case 'settings-bot':state.bot=el.value;render();break;case 'workflow':state.workflow=el.value;render();break;case 'lora':state.lora=el.value;render();break;case 'action':state.action=el.value;state.emotion=el.value==='思考中'?'思考':'开心';render();break;case 'send-mode':state.sendMode=el.value;break}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.drawer){closePanel();return}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openPanel('sessions');document.querySelector('[data-search="sessions"]')?.focus({preventScroll:true});return}if(e.key==='Enter'&&e.target.dataset.focus==='composer'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();return}if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('kcard')){e.preventDefault();state.cardId=e.target.dataset.id;openPanel('card')}if(e.key==='Tab'&&state.drawer){let list=[...document.querySelectorAll('.drawer button:not(:disabled),.drawer input,.drawer select,.drawer textarea,.drawer summary')].filter(x=>x.getClientRects().length);let first=list[0],last=list[list.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement.classList.contains('drawer'))){e.preventDefault();last?.focus({preventScroll:true});last?.scrollIntoView(demoFixture("core.sample.128"))}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus({preventScroll:true});first?.scrollIntoView(demoFixture("core.sample.129"))}}});
async function addLocalFiles(files){for(let f of [...files]){if(state.attachments.length>=5){toast('每条消息最多 5 个附件');break}if(f.size>10*1024*1024){toast('附件限制 10 MB，已跳过 '+f.name);continue}if(!f.size&&!f.type){toast('网页样张不接受整个文件夹');continue}let entry={name:f.name,url:null,text:null,fail:false,file:f};state.attachments.push(entry);await readLocalAttachment(entry)}state.mode='chat';state.detail=true;render();toast('附件仅在当前页预览，未上传')}
async function readLocalAttachment(entry){entry.fail=false;if(entry.file.type.startsWith('image/')||/\.(txt|md)$/i.test(entry.name)){await new Promise(resolve=>{let r=new FileReader();r.onload=()=>{if(entry.file.type.startsWith('image/'))entry.url=r.result;else entry.text=r.result;resolve()};r.onerror=()=>{entry.fail=true;resolve()};if(entry.file.type.startsWith('image/'))r.readAsDataURL(entry.file);else r.readAsText(entry.file)})}}
document.getElementById('fileinput').addEventListener('change',async e=>{await addLocalFiles(e.target.files);e.target.value='' });
document.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();document.body.classList.add('file-drag')}});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('file-drag')});
document.addEventListener('drop',async e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();document.body.classList.remove('file-drag');state.drawer=null;await addLocalFiles(e.dataTransfer.files)});
// R21：触摸由 touch 事件完整持有，鼠标继续用 pointer；短滑仍交给原生滚动。
let drag=null;
var dragTouches=new Set();
function cancelDrag(){
  if(!drag)return;var d=drag;drag=null;clearTimeout(d.timer);clearInterval(d.edgeTimer);d.ghost?.remove();d.el.classList.remove('dragging');
  if(d.el.hasPointerCapture?.(d.pid))d.el.releasePointerCapture(d.pid);
  if(d.board){d.board.style.scrollSnapType=d.snapType;d.board.style.scrollBehavior=d.scrollBehavior;}
  document.querySelectorAll('.kcol.over').forEach(x=>x.classList.remove('over'));
}
// 只认布局视口坐标；事件目标和几何不一致时，以按点所在的实际卡片为准。
function dragCardAt(target,x,y){
  var original=target?.closest('.kcard'),board=target?.closest('.board');if(!board)return original;
  function contains(el){if(!el)return false;var r=el.getBoundingClientRect();return x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom;}
  var hit=document.elementFromPoint?.(x,y)?.closest('.kcard');
  if(hit&&board.contains(hit)&&contains(hit))return hit;
  if(original&&contains(original))return original;
  return [...board.querySelectorAll('.kcard')].find(contains)||null;
}
function armDrag(d){
  if(drag!==d||!d.el.isConnected||dragTouches.size>1)return;
  if(d.touch&&d.kind==='card'&&dragCardAt(d.el,d.cx,d.cy)!==d.el){cancelDrag();return;}
  d.active=true;d.el.classList.add('dragging');
  if(!d.touch)try{d.el.setPointerCapture(d.pid);}catch(e){}
  if(d.kind==='card'){d.board=document.querySelector('.board');if(d.board){d.snapType=d.board.style.scrollSnapType;d.scrollBehavior=d.board.style.scrollBehavior;d.board.style.scrollSnapType='none';d.board.style.scrollBehavior='auto';}}
  if(d.kind==='card')d.edgeTimer=setInterval(()=>{
    if(document.hidden||drag!==d||!d.moved)return;var board=document.querySelector('.board');if(!board)return;
    var box=board.getBoundingClientRect(),speed=d.lastX>box.right-44?12:d.lastX<box.left+44?-12:0;
    if(speed){board.scrollLeft+=speed;boardDropTarget(d,d.lastX,d.lastY);}
    var col=document.querySelector('.kcol.over .kcol-body');if(col){var r=col.getBoundingClientRect();if(d.lastY>r.bottom-36)col.scrollTop+=8;else if(d.lastY<r.top+36)col.scrollTop-=8;}
  },16);
}
function beginDrag(target,x,y,touch,pid){
  if(state.drawer)return null;
  let node=target.closest('.node'),actor=target.closest('.stage-frame .mascot-wrap'),card=touch?dragCardAt(target,x,y):target.closest('.kcard'),d;
  if(node){let svg=node.ownerSVGElement,pt=svg.createSVGPoint();pt.x=x;pt.y=y;let p=pt.matrixTransform(svg.getScreenCTM().inverse());
    d={kind:'node',el:node,id:node.dataset.id,x:p.x,y:p.y,start:{...nodePositions[node.dataset.id]}};}
  else if(actor)d={kind:'actor',el:actor,x,y,sx:state.actorX,sy:state.actorY};
  else if(card)d={kind:'card',el:card,id:card.dataset.id,x,y};else return null;
  cancelDrag();drag=Object.assign(d,{pid,touch,cx:x,cy:y,lastX:x,lastY:y,moved:false,active:false});
  if(touch)d.timer=setTimeout(()=>armDrag(d),280);else armDrag(d);return d;
}
function boardDropTarget(d,x,y){
  document.querySelectorAll('.kcol.over').forEach(el=>el.classList.remove('over'));
  var col=document.elementFromPoint(x,y)?.closest('.kcol');d.col=col?.dataset.col||null;d.beforeId=null;
  if(col){col.classList.add('over');var next=[...col.querySelectorAll('.kcard')].find(el=>el.dataset.id!==d.id&&y<el.getBoundingClientRect().top+el.getBoundingClientRect().height/2);d.beforeId=next?.dataset.id||null;}
}
function moveDrag(d,x,y,e){
  d.lastX=x;d.lastY=y;
  if(!d.active){if(Math.hypot(x-d.cx,y-d.cy)>8)cancelDrag();return;}
  if(e?.cancelable)e.preventDefault();
  let dx=x-d.x,dy=y-d.y;
  if(d.kind==='node'){
    let svg=d.el.ownerSVGElement,pt=svg.createSVGPoint();pt.x=x;pt.y=y;let p=pt.matrixTransform(svg.getScreenCTM().inverse());dx=p.x-d.x;dy=p.y-d.y;
    if(Math.abs(dx)+Math.abs(dy)>5)d.moved=true;
    nodePositions[d.id]={x:Math.max(40,Math.min(700,d.start.x+dx)),y:Math.max(40,Math.min(465,d.start.y+dy))};
    let pos=nodePositions[d.id];d.el.setAttribute('transform','translate('+pos.x+' '+pos.y+')');
    document.querySelectorAll(demoText("core.sample.130")).forEach(l=>{if(l.dataset.from===d.id){l.setAttribute('x1',pos.x);l.setAttribute('y1',pos.y);}if(l.dataset.to===d.id){l.setAttribute('x2',pos.x);l.setAttribute('y2',pos.y);}});return;
  }
  if(Math.abs(dx)+Math.abs(dy)>7)d.moved=true;
  if(d.kind==='actor'){state.actorX=Math.max(-100,Math.min(100,d.sx+dx));state.actorY=Math.max(-80,Math.min(80,d.sy+dy));d.el.style.setProperty('--actor-x',state.actorX+'px');d.el.style.setProperty('--actor-y',state.actorY+'px');return;}
  if(!d.moved)return;
  if(!d.ghost){d.ghost=document.createElement('div');d.ghost.className='ghost';d.ghost.textContent=cardBy(d.id).title;document.body.appendChild(d.ghost);}
  d.ghost.style.transform='translate3d('+(x+12)+'px,'+(y+10)+'px,0)';boardDropTarget(d,x,y);
}
function finishDrag(cancelled){
  var d=drag;if(!d)return;cancelDrag();if(cancelled)return;
  if(d.moved){suppressClick=true;setTimeout(()=>{suppressClick=false;},400);}
  if(d.kind==='card'&&d.moved&&d.col)stageBoardMove(d.id,d.col,d.beforeId);
  else if(d.kind==='node'&&!d.moved){state.cardId=d.id;openPanel('card');suppressClick=true;}
}
// WebKit 聚焦输入时，按钮首次触摸不得被默认 blur/收键盘吞掉；不代发 click。
function r22KeepComposerFocus(e){
  if(e.isPrimary===false||e.button>0)return;
  var button=e.target.closest('button,[role="button"]'),input=document.querySelector('[data-focus="composer"]');
  if(button&&button.closest('.composer-area')&&document.activeElement===input&&e.cancelable)e.preventDefault();
}
// 4b：触摸松手即进入原 click 发送通路；兼容注入层的捕获接管。
// 延到下一任务，让原生 touchend 先清理壳手势，再允许发送重绘按钮。
var r22SendTouch=null,r22SendClick=null,r22DispatchingSend=false;
var r25Composition={input:null,active:false,start:0,end:0};
function r25ComposerHint(){var dock=document.querySelector('.r22-input-row');if(!dock)return;var note=dock.querySelector('[data-composer-hint]');if(!note){note=Hub.h('small',{'data-composer-hint':true,role:'status'},'先选字再发');dock.append(note);}clearTimeout(r25ComposerHint.timer);r25ComposerHint.timer=setTimeout(()=>note.remove(),2000);}
function r25CanSend(){var input=document.querySelector('[data-focus="composer"]');if(input&&r25Composition.input===input&&r25Composition.active){r25ComposerHint();return false;}return true;}
function r25ClearComposer(){var input=document.querySelector('[data-focus="composer"]');if(!r25CanSend())return false;state.input='';if(input){input.value='';input.setSelectionRange(0,0);if(document.activeElement!==input)input.focus({preventScroll:true});}return true;}
function r25GuardSend(e){if(e.isComposing||e.keyCode===229||!r25CanSend()){e.preventDefault();e.stopImmediatePropagation();return false;}return true;}
for(var type of ['compositionstart','compositionupdate','compositionend'])document.addEventListener(type,e=>{if(e.target.dataset?.focus!=='composer')return;r25Composition.input=e.target;r25Composition.active=e.type!=='compositionend';r25Composition.start=e.target.selectionStart;r25Composition.end=e.target.selectionEnd;if(!r25Composition.active)document.querySelector('[data-composer-hint]')?.remove();},true);
document.addEventListener('input',e=>{if(e.target.dataset?.focus==='composer'&&e.isComposing){r25Composition.input=e.target;r25Composition.active=true;r25Composition.end=e.target.selectionEnd;}},true);
window.addEventListener('pointerup',e=>{if(r22SendButton(e.target)&&!r25CanSend())r25GuardSend(e);},true);
window.addEventListener('touchend',e=>{if(r22SendButton(e.target)&&!r25CanSend())r25GuardSend(e);},{capture:true,passive:false});
window.addEventListener('click',e=>{if(e.target.closest?.('.composer-area [data-act="send"]'))r25GuardSend(e);},true);
window.addEventListener('keydown',e=>{if(e.target.dataset?.focus==='composer'&&e.key==='Enter'&&!e.shiftKey&&(e.isComposing||e.keyCode===229||r25Composition.active))r25GuardSend(e);},true);
function r22SendButton(target){
  var button=target?.closest?.('.composer-area .voicebtn'),input=document.querySelector('[data-focus="composer"]');
  return button&&input&&button.dataset.act!=='stop'&&(button.dataset.act==='send'||input.value.trim())?button:null;
}
function r22SendTouchStart(e){
  r22SendClick=null;r22SendTouch=null;
  if(e.isPrimary===false||e.button>0||e.touches&&e.touches.length!==1)return;
  var button=r22SendButton(e.target),point=e.touches?e.touches[0]:e;if(!button)return;
  r22SendTouch={button:button,rect:button.getBoundingClientRect(),id:e.touches?point.identifier:e.pointerId,x:point.clientX,y:point.clientY};
}
function r22SendTouchMove(e){
  var t=r22SendTouch;if(!t)return;
  var point=e.touches?[...e.touches].find(p=>p.identifier===t.id):e;
  if(!point||Math.hypot(point.clientX-t.x,point.clientY-t.y)>12)r22SendTouch=null;
}
function r22SendTouchEnd(e){
  var t=r22SendTouch;r22SendTouch=null;if(!t)return;
  var point=e.changedTouches?[...e.changedTouches].find(p=>p.identifier===t.id):e;
  if(!point||!e.changedTouches&&point.pointerId!==t.id)return;
  // 收键盘会移动按钮；以手指按下时的命中区域为准。
  var rect=t.rect;
  if(point.clientX<rect.left||point.clientX>rect.right||point.clientY<rect.top||point.clientY>rect.bottom)return;
  if(e.cancelable)e.preventDefault();
  var guard={button:t.button,x:point.clientX,y:point.clientY,until:Date.now()+900};r22SendClick=guard;
  setTimeout(()=>{
    if(!t.button.isConnected||!r22SendButton(t.button))return;
    // 组字结束后才进入原发送通路；不从候选栏猜测文字。
    var input=document.querySelector('[data-focus="composer"]');state.input=input.value;
    t.button.dataset.act='send';r22DispatchingSend=true;
    try{t.button.click();}finally{r22DispatchingSend=false;}
  },0);
}
window.addEventListener('click',e=>{
  var g=r22SendClick;if(r22DispatchingSend||!g||Date.now()>g.until||e.detail===0)return;
  // 重绘后原发送位置可能已经变成停止键，兼容 click 也不能误停。
  if(e.target.closest?.('.composer-area .voicebtn')||g.button.contains(e.target)||Math.hypot(e.clientX-g.x,e.clientY-g.y)<16){
    e.preventDefault();e.stopImmediatePropagation();
  }
},true);
if(window.PointerEvent){
  document.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')r22SendTouchStart(e);else r22SendClick=null;},true);
  document.addEventListener('pointermove',r22SendTouchMove,{passive:true});
  document.addEventListener('pointerup',r22SendTouchEnd,{passive:false});
  document.addEventListener('pointercancel',()=>{r22SendTouch=null;});
}else{
  document.addEventListener('touchstart',r22SendTouchStart,{capture:true,passive:true});
  document.addEventListener('touchmove',r22SendTouchMove,{passive:true});
  document.addEventListener('touchend',r22SendTouchEnd,{passive:false});
  document.addEventListener('touchcancel',()=>{r22SendTouch=null;});
}
document.addEventListener('pointerdown',r22KeepComposerFocus,true);
if(!window.PointerEvent)document.addEventListener('touchstart',r22KeepComposerFocus,{capture:true,passive:false});
document.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.button>0)return;beginDrag(e.target,e.clientX,e.clientY,false,e.pointerId);});
document.addEventListener('pointermove',e=>{if(drag&&!drag.touch&&drag.pid===e.pointerId)moveDrag(drag,e.clientX,e.clientY,e);});
function endDrag(e){if(drag&&!drag.touch&&drag.pid===e.pointerId)finishDrag(e.type==='pointercancel');}
document.addEventListener('pointerup',endDrag);document.addEventListener('pointercancel',endDrag);
document.addEventListener('touchstart',e=>{
  if(e.touches?.length!==1){cancelDrag();return;}var t=e.touches[0];beginDrag(e.target,t.clientX,t.clientY,true,t.identifier);
},{passive:true});
document.addEventListener('touchmove',e=>{
  if(e.touches?.length!==1){cancelDrag();return;}var t=e.touches[0];if(drag?.touch)moveDrag(drag,t.clientX,t.clientY,e);
},{passive:false});
document.addEventListener('touchend',e=>{if(drag?.touch)finishDrag(false);},{passive:true});
document.addEventListener('touchcancel',()=>{if(drag?.touch)finishDrag(true);},{passive:true});
document.addEventListener('contextmenu',e=>{if(e.target.closest('.kcol,.kcard,.node,.stage-frame .mascot-wrap'))e.preventDefault();});
// 首页按压保留 0.97 反馈，但延迟 90ms；开始滚动即撤回，不在 scroll 监听中改布局类。
var homeTouchPress=null;
function clearHomeTouchPress(){if(!homeTouchPress)return;clearTimeout(homeTouchPress.timer);delete homeTouchPress.el.dataset.r21Pressed;homeTouchPress=null;}
document.addEventListener('touchstart',e=>{
  clearHomeTouchPress();if(e.touches?.length!==1)return;var el=e.target.closest('.pin,.conversation');if(!el)return;
  var t=e.touches[0],press={el,x:t.clientX,y:t.clientY};homeTouchPress=press;
  press.timer=setTimeout(()=>{if(homeTouchPress===press&&el.isConnected)el.dataset.r21Pressed='true';},90);
},{passive:true});
document.addEventListener('touchmove',e=>{var p=homeTouchPress;if(!p)return;if(e.touches?.length!==1||Math.hypot(e.touches[0].clientX-p.x,e.touches[0].clientY-p.y)>6)clearHomeTouchPress();},{passive:true});
document.addEventListener('touchend',clearHomeTouchPress,{passive:true});document.addEventListener('touchcancel',clearHomeTouchPress,{passive:true});
// iOS 不依赖 overscroll-behavior 拦根回弹：只在内层已无可滚范围时挡住单指拖动。
var rootScrollTouch=null;
document.addEventListener('touchstart',e=>{rootScrollTouch=e.touches?.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;},{passive:true});
document.addEventListener('touchmove',e=>{
  if(!rootScrollTouch||e.touches?.length!==1||Math.abs((window.visualViewport?.scale||1)-1)>.001){rootScrollTouch=null;return;}
  var t=e.touches[0],dx=t.clientX-rootScrollTouch.x,dy=t.clientY-rootScrollTouch.y;
  rootScrollTouch={x:t.clientX,y:t.clientY};
  if(Math.abs(dy)<1||Math.abs(dx)>Math.abs(dy)||window.getSelection?.().toString())return;
  if(typeof getComputedStyle!=='function')return;
  for(var el=e.target;el&&el!==document.body;el=el.parentElement){
    var style=getComputedStyle(el);
    if(/auto|scroll/.test(style.overflowY)&&el.scrollHeight>el.clientHeight+1&&
       ((dy<0&&el.scrollTop+el.clientHeight<el.scrollHeight-1)||(dy>0&&el.scrollTop>0)))return;
  }
  if(e.cancelable)e.preventDefault();
},{passive:false});
document.addEventListener('touchend',()=>{rootScrollTouch=null;},{passive:true});
document.addEventListener('touchcancel',()=>{rootScrollTouch=null;},{passive:true});
const initialViewportHeight=innerHeight;
function resetRootScroll(){
  // 仅归零 #app 与祖先／根滚动器，绝不触碰线程、抽屉等内层阅读位置。
  for(var rootNode=document.getElementById('app');rootNode&&rootNode!==document;rootNode=rootNode.parentNode){
    if(rootNode.scrollTop)rootNode.scrollTop=0;
    if(rootNode.scrollLeft)rootNode.scrollLeft=0;
  }
}
function syncViewport(){
  let root=document.documentElement,app=document.getElementById('app'),vv=window.visualViewport;
  // R20 C-03: pinch zoom is never a keyboard signal or a reason to resize the app.
  if(!vv||Math.abs((vv.scale||1)-1)>1e-6)return;
  resetRootScroll();
  let typing=['TEXTAREA','INPUT'].includes(document.activeElement?.tagName);
  let keyboard=typing&&vv.height*(vv.scale||1)<initialViewportHeight-140,changed=false;
  if(keyboard){
    let height=vv.height+'px',top=vv.offsetTop+'px';
    if(root.style.getPropertyValue('--app-h')!==height){root.style.setProperty('--app-h',height);changed=true;}
    if(app.style.top!==top){app.style.top=top;changed=true;}
  }else{
    if(root.style.getPropertyValue('--app-h')){root.style.removeProperty('--app-h');changed=true;}
    if(app.style.top){app.style.top='';changed=true;}
  }
  if(document.body.classList.contains('keyboard')!==keyboard){document.body.classList.toggle('keyboard',keyboard);changed=true;}
  if(changed)shellReading.invalidate();
}
window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);window.addEventListener('resize',syncViewport);document.addEventListener('focusin',()=>{syncViewport();requestAnimationFrame(syncViewport);});document.addEventListener('focusout',()=>{syncViewport();setTimeout(syncViewport,80);});matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.theme==='system'){applyTheme();render()}});


/* Stable extension boundary. Only this section owns extension registries. */
var Hub = window.Hub = (function () {
  'use strict';
  var registries = Object.fromEntries(['cards','actions','panels','settings','views','botTabs','tools','commands','chips','sections','capabilities','botTemplates'].map(k=>[k,new Map()]));
  var badges=[], events=new Map(), conversations=new Map(), activeByBot={}, warned=new Set();
  var owner='core', ready=false, sequence=0, slots=new Map(), dockObserver=null, dockObserved=[];
  var mainViews=['chat','task','kanban','stage'];
  function warn(id, error){if(warned.has(id))return;warned.add(id);console.warn('[Hub] '+id+'：'+(error?.message||error||'模块不可用'));}
  function safe(id, fn, fallback){try {var value=fn();if(value&&typeof value.then==='function')value.catch(e=>warn(id,e));return value;}catch(e){warn(id,e);return typeof fallback==='function'?fallback():fallback;}}
  function validId(id){if(typeof id!=='string'||!/^[_a-zA-Z][\w-]*$/.test(id))throw Error('Invalid registry id: '+id);return id;}
  function register(kind,id,spec){validId(id);if(registries[kind].has(id)&&!(kind==='views'&&id==='ledger'&&registries.views.get(id)._shellPlaceholder))throw Error('Duplicate '+kind+': '+id);if(!spec||typeof spec!=='object')throw Error('Expected definition for '+id);registries[kind].set(id,Object.assign({},spec,{_owner:owner}));}
  function invoke(spec,fn,args,fallback){return safe(spec._owner||'core',()=>spec[fn].apply(null,args),fallback);}
  function h(tag,attrs,children){var el=document.createElement(tag);Object.entries(attrs||{}).forEach(([k,v])=>{if(v==null||v===false)return;if(k==='class'||k==='className')el.className=v;else if(k==='style'&&typeof v==='object')Object.assign(el.style,v);else if(/^on[A-Z]/.test(k)&&typeof v==='function')el.addEventListener(k.slice(2).toLowerCase(),v);else if(k==='dataset')Object.assign(el.dataset,v);else if(k in el&&!k.startsWith('aria-')&&k!=='role')el[k]=v;else el.setAttribute(k,v===true?'':v);});function append(c){if(c==null||c===false)return;if(Array.isArray(c))c.forEach(append);else el.append(c instanceof Node?c:document.createTextNode(featureWording(c)));}append(children);return el;}
  function fromHTML(html){var t=document.createElement('template');t.innerHTML=featureWording(html.trim());return t.content.firstElementChild||h('span',{},'');}
  function context(extra){return Object.assign({state:state,bot:botBy(state.bot),project:projBy(state.project),conversation:state.conversation,subBots:subBots(state.bot),navigate:navigate,postMessage:postMessage,openPanel:apiOpenPanel,toast:toast},extra||{});}
  function on(event,fn){if(!events.has(event))events.set(event,new Set());var entry={fn:fn,owner:owner};events.get(event).add(entry);return ()=>events.get(event)?.delete(entry);}
  function emit(event,value){events.get(event)?.forEach(e=>safe(e.owner,()=>e.fn(value)));}
  var featureData=new Map(FEATURE_PAGES.map(p=>[p.id,{records:FEATURE_SEEDS[p.id].history.map(x=>({...x})),memory:[]}])),featureSections=new Map();
  function migrateRefs(value,key){
    if(typeof value==='string'){
      if(['bot','botId','sourceBot','from','to','steward','boundBot','ownerAssistantId'].includes(key))return assistantId(value)||value;
      if(['conversation','boundConversation','sourceConversation'].includes(key))return legacyConversation(value);
      return value;
    }
    if(Array.isArray(value))return value.map(v=>migrateRefs(v,key));
    if(value&&typeof value==='object'){var out={};Object.entries(value).forEach(([k,v])=>{out[k]=migrateRefs(v,k);});return out;}return value;
  }
  var normalizedRefs=new WeakMap();
  function normalize(m,index,bot){var prior=normalizedRefs.get(m);if(!prior||prior.parts!==m.parts||prior.from!==m.from)Object.assign(m,migrateRefs(m));bot=assistantId(bot);if(!m.id)m.id=bot+'-msg-'+(index==null?++sequence:index);if(!m.from)m.from=m.role==='user'?'user':bot;if(!m.role)m.role=m.from==='user'?'user':'bot';if(!m.parts)m.parts=m.card?[{type:m.card.type,data:m.card}]:[{type:'text',md:m.text||''}];normalizedRefs.set(m,{parts:m.parts,from:m.from});return m;}
  state.bots.forEach(b=>{var id=b.id+'-013';activeByBot[b.id]=id;state.threads[b.id]=state.threads[b.id].map((m,i)=>normalize(m,i,b.id));conversations.set(id,{id:id,bot:b.id,title:state.sessionNames[b.id],messages:state.threads[b.id]});});
  state.fixedTasks.forEach(task=>{
    var messages=[normalize({...task.seedMessage,from:task.ownerAssistantId},0,task.ownerAssistantId)];
    conversations.set(task.conversation,{id:task.conversation,bot:task.ownerAssistantId,taskId:task.taskId,title:fixedTaskTitle(task),messages,extra:false});
  });
  state.conversation=activeByBot[state.bot];
  Object.defineProperty(state,'view',{get:()=>state.mode,set:v=>{state.mode=v},enumerable:true});
  function currentMessages(){state.conversation=activeByBot[state.bot];var c=conversations.get(state.conversation);if(c){c.messages=state.threads[state.bot];c.title=c.taskId?fixedTaskTitle(state.fixedTasks.find(t=>t.taskId===c.taskId)):state.sessionNames[state.bot];}return state.threads[state.bot].map((m,i)=>normalize(m,i,state.bot));}
  function conversationFeature(explicit,legacy){var id=featureKey(explicit||LEGACY_FEATURE_IDS[legacy]);if(id&&!featureData.has(id))throw Error('Unknown feature: '+id);return id;}
  function registerConversation(botId,spec){var legacy=botId,task=state.fixedTasks.find(t=>t.taskId===legacy);botId=assistantId(botId);if(!botBy(botId))throw Error('Unknown bot: '+botId);validId(spec.id);if(conversations.has(spec.id))throw Error('Duplicate conversation: '+spec.id);if(!Array.isArray(spec.messages))throw Error('messages must be an array');var messages=spec.messages.map((m,i)=>normalize(Object.assign({},m),i,botId));conversations.set(spec.id,{id:spec.id,title:spec.title,bot:botId,messages:messages,taskId:task?.taskId||spec.taskId,featureId:conversationFeature(spec.featureId,legacy),_owner:owner,extra:true});}
  function navigate(route,opts){route={...(route||{})};if(route.bot&&state.fixedTasks.some(t=>t.taskId===route.bot))route.conversation=route.conversation||state.fixedTasks.find(t=>t.taskId===route.bot).conversation;if(route.bot)route.bot=assistantId(route.bot);if(route.conversation)route.conversation=legacyConversation(route.conversation);opts=opts||{};shellReading.save();var previousChat=render.chatRoute;var view={tasks:'task',board:'kanban'}[route.view]||route.view;if(view&&!registries.views.has(view))throw Error('Unknown view: '+view);if(route.project&&!projBy(route.project))throw Error('Unknown project: '+route.project);var c=route.conversation&&conversations.get(route.conversation);if(route.conversation&&!c)throw Error('Unknown conversation: '+route.conversation);var bot=route.bot||(c&&c.bot)||state.bot;if(!botBy(bot))throw Error('Unknown bot: '+bot);if(c&&c.bot!==bot)throw Error('Conversation belongs to a different bot');state.boardReturn=null;panelHistory=[];currentMessages();if(c){state.threads[bot]=c.messages;state.sessionNames[bot]=c.title;activeByBot[bot]=c.id;if(c.taskId){var task=state.fixedTasks.find(t=>t.taskId===c.taskId);if(task)task.unread=0;}}state.bot=bot;state.conversation=activeByBot[bot];if(view)state.mode=view;if(route.project)state.project=route.project;state.detail=true;state.drawer=null;if(state.mode==='chat'){botBy(bot).unread=0;if(previousChat===state.conversation&&opts.reading!=='preserve'&&route.reading!=='preserve')shellReading.enter(state.conversation,{mode:'bottom'});}if(!opts.deferRender)render();emit('navigate',context());}
  function postMessage(id,msg,options){
    var legacyId=id;id=legacyConversation(id);var c=conversations.get(id);if(!c)throw Error('Unknown conversation: '+id);
    if(activeByBot[c.bot]===id)c.messages=state.threads[c.bot];
    var incoming=Object.assign({},msg);if(!r25MessageStamp(incoming)&&(!incoming.time||incoming.time==='刚刚'))incoming.recentAt=Date.now();
    var m=normalize(incoming,null,c.bot);
    var feature=Object.keys(LEGACY_FEATURE_IDS).find(old=>legacyId===old+'-013');if(feature)featureRecord(LEGACY_FEATURE_IDS[feature],{message:m,time:m.time});
    if(m.parts.some(p=>p.type==='governance-quota-choice')){return registerActivity({id:m.id,kind:'inform',bot:c.bot,featureId:'ledger',title:FEATURE_SEEDS.ledger.summary,detail:messageText(m),conversation:c.id});}if(c.messages.some(x=>x.id===m.id))throw Error('Duplicate message: '+m.id);var task=state.fixedTasks.find(t=>t.taskId===c.taskId);if(task){task.updatedAt=Date.now();task.justCreated=false;}else botBy(c.bot).updatedAt=Date.now();
    var quiet=options?.quiet===true;
    var active=id===state.conversation&&state.mode==='chat';
    c.messages.push(m);
    if(quiet){
      quietPosting=true;
      try{
        if(active&&ready){var list=document.querySelector('.thread-inner');if(list){shellReading.preserve(()=>{list.append(fromHTML(messageHTML(m,c.messages.length-1)));mountSlots();},{reason:'quiet-message'});}}
        if(!active)botBy(c.bot).unread=(botBy(c.bot).unread||0)+1;
        if(lastBackgroundReport&&lastBackgroundReport.conversation!==id)backgroundCounts.delete(lastBackgroundReport.conversation);
        backgroundCounts.set(id,(backgroundCounts.get(id)||0)+1);
        var report={conversation:id,messageId:m.id,collapsed:false};lastBackgroundReport=report;
        setTimeout(()=>{if(lastBackgroundReport===report){report.collapsed=true;mountBackgroundHint();}},6000);
        emit('message',{conversation:id,message:m,quiet:true});mountBackgroundHint();
      }finally{quietPosting=false;}
    }else{
      if(ready){
        var list=active&&document.querySelector('.thread-inner');
        if(list){shellReading.preserve(()=>{list.append(fromHTML(messageHTML(m,c.messages.length-1)));mountSlots();compactChatRows();},{reason:'message'});}
        else render();
      }
      // Module mount/state hooks finish before establishing the new send constraint,
      // just as they do during the full render path.
      emit('message',{conversation:id,message:m,quiet:false});
      if(active&&m.from==='user'){
        shellReading.sent({conversation:id,messageId:m.id},{turnId:m.id});
        if(c.messages.at(-1)!==m&&!state.running)shellReading.finishTurn();
      }else if(active&&!state.running&&shellReading.state().mode==='sent')shellReading.finishTurn();
      if(active&&(m.from==='user'||!['thinking','tool'].includes(m.status)))animateMessage(id,m,m.from==='user'?'sent':'done');
    }
    return m;
  }
  // R8 shared shell state. Token counts are estimates, scoped to each conversation.
  var memoryByBot=new Map(),contextByConversation=new Map(),backgroundCounts=new Map(),quietPosting=false,lastBackgroundReport=null;
  var lastMountedBot=null,releasedMemory=null,releaseEpoch=0;
  function memoryMounts(botId){var feature=LEGACY_FEATURE_IDS[botId];return (feature?featureData.get(feature).memory:(memoryByBot.get(botId)||[])).map(s=>({...s}));}
  function registerMemoryMounts(botId,slices,options){
    var feature=conversationFeature(options?.featureId,botId);if(!feature&&!botBy(botId))return false;if(!Array.isArray(slices))throw Error('Memory slices must be an array');
    var ids=new Set();var normalized=slices.map((slice,i)=>{
      var tokens=Number(slice.tokens??slice.token??slice.tokenEstimate??0);if(!Number.isFinite(tokens)||tokens<0)throw Error('Invalid memory tokens');
      var id=String(slice.id||'slice-'+i);if(ids.has(id))throw Error('Duplicate memory slice: '+id);ids.add(id);
      return {...slice,id:id,title:String(slice.title||slice.name||'演示切片'),source:String(slice.source||'本页演示'),tokens:Math.round(tokens)};
    });
    if(feature){featureData.get(feature).memory=normalized;return normalized.map(slice=>({...slice}));}
    memoryByBot.set(botId,normalized);syncMemoryContext(botId);refresh();return memoryMounts(botId);
  }
  function unmountMemory(botId,sliceId){var feature=LEGACY_FEATURE_IDS[botId],slices=feature?featureData.get(feature).memory:(memoryByBot.get(botId)||[]),i=slices.findIndex(s=>s.id===sliceId);if(i<0)return false;slices.splice(i,1);syncMemoryContext(botId);refresh();emit('memory:unmounted',{bot:botId,sliceId:sliceId});return true;}
  function memoryTokens(botId){return memoryMounts(botId).reduce((sum,s)=>sum+s.tokens,0);}
  function syncMemoryContext(botId){contextByConversation.forEach((snap,id)=>{if(conversations.get(id)?.bot===botId){snap.segments.memory=memoryTokens(botId);recountContext(snap);}});}
  var segmentLabels={system:'系统',memory:'记忆',files:'文件',chat:'对话',tools:'工具结果'};
  function recountContext(snap){
    snap.total=Object.values(snap.segments).reduce((sum,n)=>sum+n,0);
    snap.top3=Object.entries(snap.segments).map(([segment,tokens])=>({segment,label:segmentLabels[segment],tokens})).sort((a,b)=>b.tokens-a.tokens).slice(0,3);
    return snap;
  }
  function contextSnapshot(conversationId){
    var id=legacyConversation(conversationId)||state.conversation,c=conversations.get(id);if(!c)return null;
    if(!contextByConversation.has(id)){var mem=memoryTokens(c.bot);contextByConversation.set(id,recountContext({conversation:id,bot:c.bot,segments:{system:12000,memory:mem,files:9000,chat:41000,tools:Math.max(0,24000-mem)},max:256000,total:0,top3:[],costliestTurn:{conversation:id,turn:3,tokens:12600,cost:null,label:'演示第 3 轮 · 费用未知'},estimated:true}));}
    var snap=contextByConversation.get(id);return {...snap,segments:{...snap.segments},top3:snap.top3.map(s=>({...s})),costliestTurn:{...snap.costliestTurn}};
  }
  function updateContext(conversationId,patch){
    var prev=contextSnapshot(conversationId);if(!prev)return false;patch=patch||{};
    if(patch.segments)Object.keys(segmentLabels).forEach(key=>{if(key in patch.segments){var n=Number(patch.segments[key]);if(!Number.isFinite(n)||n<0)throw Error('Invalid context tokens');prev.segments[key]=Math.round(n);}});
    if(patch.max!==undefined){if(!Number.isFinite(patch.max)||patch.max<=0)throw Error('Invalid context window');prev.max=patch.max;}
    if(patch.costliestTurn)prev.costliestTurn={...prev.costliestTurn,...patch.costliestTurn};
    contextByConversation.set(conversationId,recountContext(prev));refresh();emit('context:updated',contextSnapshot(conversationId));return contextSnapshot(conversationId);
  }

  function memorySheet(botId){Hub.sheet({title:'已挂载记忆 · 本页演示',body:container=>{
    var slices=memoryMounts(botId);container.append(h('p',{class:'mini-note'},'按 bot 挂载；临时卸下只影响本页，刷新复原。'));
    if(!slices.length)container.append(h('p',{},'未挂载记忆'));
    slices.forEach(slice=>container.append(h('div',{class:'setting-row'},[h('div',{class:'grow'},[h('strong',{},slice.title),h('small',{},slice.source+' · '+slice.tokens+' token')]),h('button',{class:'ghostbtn','data-memory-unmount':slice.id,onClick:()=>{unmountMemory(botId,slice.id);}},'临时卸下')])));
  }});}
  function updateMemoryPill(){
    var pill=document.querySelector('[data-memory-mount]');if(!pill)return;
    var slices=memoryMounts(pill.dataset.memoryMount),label=slices.length?slices.length+' 个记忆切片 · '+(slices.reduce((n,s)=>n+s.tokens,0)/1000).toFixed(1)+'k':'未挂载记忆';
    // Keep the mounted context as an accessible description while announcing release.
    pill.setAttribute('aria-describedby','shell-memory-summary');
    pill.replaceChildren(h('span',{id:'shell-memory-summary',class:releasedMemory?'shell-memory-summary':''},label));
    if(releasedMemory)pill.append(h('span',{'data-memory-released':'',role:'status'},'已释放 '+releasedMemory.count+' 个切片'));
  }
  function mountMemoryRelease(){
    if(lastMountedBot&&lastMountedBot!==state.bot){
      var n=memoryMounts(lastMountedBot).length;releasedMemory=null;
      if(n){releasedMemory={count:n,epoch:++releaseEpoch};var epoch=releaseEpoch;setTimeout(()=>{if(releasedMemory?.epoch===epoch){releasedMemory=null;updateMemoryPill();}},1500);}
    }
    lastMountedBot=state.bot;updateMemoryPill();
  }
  function viewBackgroundReport(report){
    if(!report||lastBackgroundReport!==report)return;
    var id=report.conversation;backgroundCounts.delete(id);lastBackgroundReport=null;
    if(state.conversation!==id||state.mode!=='chat')navigate({view:'chat',conversation:id});
    var thread=document.querySelector('.thread'),message=[...document.querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===report.messageId);
    if(thread){if(currentMessages().at(-1)?.id===report.messageId)shellReading.toBottom({reason:'background-hint'});else shellReading.locate(message,{block:'center',reason:'background-hint'});}
    mountBackgroundHint();
  }
  function mountBackgroundHint(){
    var previous=document.querySelector('[data-background-hint]');previous?.remove();
    var ring=document.querySelector('.chat-header .ledger-shortcut');
    document.querySelectorAll('[data-background-dot]').forEach(el=>el.remove());
    if(ring)ring.setAttribute('aria-label','打开账本');
    if(state.mode!=='chat'||innerWidth<700&&!state.detail||!document.querySelector('#hub-view .chatview')){if(previous)measureDock();return;}
    var report=lastBackgroundReport,host=document.querySelector('#hub-view .chatview');
    if(!report||!host){if(previous)measureDock();return;}
    var id=report.conversation,count=backgroundCounts.get(id)||1,c=conversations.get(id);
    if(ring)ring.setAttribute('aria-label','查看 '+count+' 条后台回报');
    if(report.collapsed){
      if(ring)ring.append(h('span',{class:'r22-background-dot','data-background-dot':id,'aria-hidden':'true'}));
    }else{
      var hint=h('button',{type:'button',class:'shell-background-hint glass','data-background-hint':id,'data-background-message':report.messageId,'aria-live':'polite',onClick:()=>viewBackgroundReport(report)},[h('span',{class:'grow'},'有 '+count+' 条后台回报 · '+(botBy(c?.bot)?.name||'助理')),h('span',{},'查看')]);
      // 此条独占右滑手势，不能触发页面返回；忽略后保留顶栏查看入口。
      var start=null;
      hint.addEventListener('touchstart',e=>{e.stopPropagation();start=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;},{passive:true});
      hint.addEventListener('touchmove',e=>{e.stopPropagation();if(!start||e.touches.length!==1){start=null;return;}var dx=e.touches[0].clientX-start.x,dy=e.touches[0].clientY-start.y;if(dx>8&&dx>Math.abs(dy)*1.15){if(e.cancelable)e.preventDefault();hint.style.transform='translateX('+dx+'px)';}},{passive:false});
      hint.addEventListener('touchend',e=>{e.stopPropagation();var point=e.changedTouches[0],swiped=start&&point&&point.clientX-start.x>=48&&point.clientX-start.x>Math.abs(point.clientY-start.y)*1.15;start=null;hint.style.transform='';if(swiped){if(e.cancelable)e.preventDefault();report.collapsed=true;mountBackgroundHint();}},{passive:false});
      hint.addEventListener('touchcancel',()=>{start=null;hint.style.transform='';},{passive:true});
      host.append(hint);
    }
    measureDock();
  }
  // 保留无回报时进账本的原语义；有回报时环和点共用精确定位入口。
  document.addEventListener('click',e=>{if(state.mode==='chat'&&lastBackgroundReport&&e.target.closest?.('.chat-header .ledger-shortcut')){e.preventDefault();e.stopImmediatePropagation();viewBackgroundReport(lastBackgroundReport);}},true);
  window.addEventListener('resize',mountBackgroundHint);
  // R9 tour: opt-in, entirely shell-owned. Runtime conversations remain authoritative.
  var tourIndex=-1,tourTarget=null,tourReturnFocus=null,tourRouting=false,tourAnchor=null,tourReadingToken=null;
  var tourSteps=[
    {title:'聊天与卡片',text:'先在首席会话里说一句。回复里的卡片把草稿、审批和交付放在一起。'},
    {title:'私密输入',text:'需要私密内容时，在专用输入卡里填写。聊天正文只保留脱敏说明。'},
    {title:'看板拖动并提交',text:'拖动卡片只是在预览新位置。拖完后点「提交」才生效，也可以撤销。'},
    {title:'账本',text:'在这里看会话、任务与模型的 token 用量。费用未知会明确标出，数字都是演示数据。'},
    {title:'功能页与助理',text:'按功能找能力，每张卡都有状态和三句常用话。点常用话，就回到负责助理的会话。'},
    {title:'新建 bot',text:'从首页底栏「更多」第一行「新建助理」开始。可以先和首席聊职责，也可以选模板；只在本页演示。'}
  ];
  function resetTourThreadInset(){shellReading.preserve(()=>shellReading.resetInset(),{reason:'tour-inset-reset'});}
  function clearTourTarget(){document.querySelectorAll('.shell-tour-target').forEach(el=>el.classList.remove('shell-tour-target'));}
  function stopTour(){
    tourIndex=-1;shellTourActive=false;tourTarget=null;if(tourReadingToken)shellReading.release({token:tourReadingToken,reason:'tour-end'});tourReadingToken=null;resetTourThreadInset();clearTourTarget();document.querySelector('[data-hub-tour]')?.remove();
    if(tourReturnFocus?.isConnected)tourReturnFocus.focus({preventScroll:true});tourReturnFocus=null;
  }
  function tourCard(messageId,type){
    var article=[...document.querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===messageId);
    if(!article)return null;
    return [...article.querySelectorAll('[data-tour-card]')].find(el=>el.dataset.tourCard===type)||article.querySelector('.mcard')||article;
  }
  function routeTourStep(){
    tourRouting=true;tourAnchor=null;if(tourReadingToken)shellReading.release({token:tourReadingToken,reason:'tour-step'});tourReadingToken=null;resetTourThreadInset();clearTourTarget();
    try{
      if(tourIndex===0){navigate({view:'chat',conversation:'chief-013'});var msg=currentMessages().find(m=>m.parts.some(p=>p.type!=='text'));tourAnchor=msg?{messageId:msg.id,type:msg.parts.find(p=>p.type!=='text').type}:null;tourTarget=msg?tourCard(tourAnchor.messageId,tourAnchor.type):document.querySelector('.thread-inner');}
      if(tourIndex===1){
        currentMessages();var found;
        for(var c of conversations.values()){var m=c.messages.find(m=>m.parts.some(p=>p.type==='cards-a-secret-input'));if(m){found={conversation:c.id,messageId:m.id};break;}}
        if(found){navigate({view:'chat',conversation:found.conversation});tourAnchor={messageId:found.messageId,type:'cards-a-secret-input'};tourTarget=tourCard(found.messageId,'cards-a-secret-input');}
        else{state.detail=false;state.collapsed=false;state.search='';state.mode='chat';state.drawer=null;render();activityTab='pending';activitySheet();tourTarget=document.querySelector('[data-activity-tab="pending"]');}
      }
      if(tourIndex===2){state.boardView='columns';navigate({view:'kanban'});tourTarget=document.querySelector('[data-board-action="submit"]')||document.querySelector('.kcard');}
      if(tourIndex===3){navigate({view:'ledger'});tourTarget=document.querySelector('#hub-view .page-title')||document.getElementById('hub-view');}
      if(tourIndex===4){navigate({view:'capabilities'});tourTarget=document.querySelector('[data-capability]')||document.querySelector('.capability-group');}
      if(tourIndex===5){state.detail=false;state.collapsed=false;state.search='';state.mode='chat';state.drawer=null;render();openPanel('more');tourTarget=document.querySelector('.r22-create-row [data-new-bot-open]');}
      tourTarget?.classList.add('shell-tour-target');if(!tourTarget?.closest('.thread'))tourTarget?.scrollIntoView(demoFixture("core.Hub.131"));
    }finally{tourRouting=false;}
    paintTour();
    if(tourTarget?.closest('.thread')){
      shellReading.preserve(()=>{
        var target=tourTarget;// 监工 r14 合并小修：卡片外框顶（含档位贴纸行）对齐气泡下沿 +12，标题自然在其下；超高卡底部可滚动查看
        var offset=()=>{var box=document.querySelector('[data-hub-tour]'),thread=document.querySelector('.thread');return box&&thread?Math.max(12,box.getBoundingClientRect().bottom+12-thread.getBoundingClientRect().top):12;};
        tourReadingToken=shellReading.locate(target,{block:'start',offset:offset,reason:'tour-step'});
      },{reason:'tour-locate-inset'});
    }
  }
  function startTour(){
    if(tourIndex<0)tourReturnFocus=document.activeElement;
    shellTourActive=true;tourIndex=0;document.activeElement?.blur?.();routeTourStep();
  }
  function moveTour(delta){if(tourIndex+delta>=tourSteps.length){stopTour();return;}tourIndex=Math.max(0,tourIndex+delta);routeTourStep();}
  function paintTour(){
    document.querySelector('[data-hub-tour]')?.remove();if(tourIndex<0)return;
    var step=tourSteps[tourIndex],box=h('section',{class:'shell-tour-bubble','data-hub-tour':String(tourIndex+1),role:'dialog','aria-modal':'false','aria-labelledby':'shell-tour-title'},[
      h('div',{class:'shell-tour-head'},[h('span',{'aria-live':'polite'},'第 '+(tourIndex+1)+'/6 步'),h('button',{type:'button',class:'shell-tour-close','aria-label':'关闭导览',onClick:stopTour},fromHTML(ico('close')))]),
      h('h2',{id:'shell-tour-title'},step.title),h('p',{},step.text),
      h('div',{class:'shell-tour-actions'},[h('button',{type:'button',class:'ghostbtn','data-tour-prev':'',disabled:tourIndex===0,onClick:()=>moveTour(-1)},'上一步'),h('button',{type:'button',class:'primary','data-tour-next':'',onClick:()=>moveTour(1)},tourIndex===5?'完成':'下一步')])
    ]);
    document.body.append(box);positionTour();box.querySelector('[data-tour-next]')?.focus({preventScroll:true});
  }
  function positionTour(){
    var box=document.querySelector('[data-hub-tour]');if(!box||!tourTarget?.isConnected)return;
    var vv=window.visualViewport,vx=vv?.offsetLeft||0,vy=vv?.offsetTop||0,vw=vv?.width||innerWidth,vh=vv?.height||innerHeight;
    // Restrict the entire bubble to the visible area above the dock / mobile navigation.
    var dock=document.querySelector('.composer-area'),bottom=vy+vh-12;
    var dockRect=dock?.getBoundingClientRect();
    if(dockRect&&dockRect.height>0&&dockRect.width>0)bottom=Math.min(bottom,dockRect.top-12);
    else if(innerWidth<700)bottom-=96;
    if(innerWidth<700)document.querySelectorAll('.tabbar,.side-bottom').forEach(el=>{var bar=el.getBoundingClientRect();if(bar.height>0&&bar.top>vy+vh/2)bottom=Math.min(bottom,bar.top-12);});
    var top=vy+12;
    if(innerWidth<700){var head=document.querySelector('.floatinghead')?.getBoundingClientRect();if(head)top=Math.max(top,head.bottom+12);bottom=Math.max(top+1,bottom);}
    var maxHeight=Math.max(1,bottom-top);box.style.maxHeight=maxHeight+'px';
    var r=tourTarget.getBoundingClientRect(),b=box.getBoundingClientRect();
    var x=Math.max(vx+12,Math.min(r.left+r.width/2-b.width/2,vx+vw-b.width-12));
    var y=r.bottom+16;if(y+b.height>bottom)y=r.top-b.height-16;
    y=innerWidth<700||(tourAnchor&&tourTarget.closest('.thread'))?top:Math.max(top,Math.min(y,bottom-b.height));box.style.left=x+'px';box.style.top=y+'px';
    if(innerWidth<700&&!tourTarget.closest('.thread')){
      // A top-fixed mobile bubble must not cover a non-chat title that cannot
      // scroll farther down (ledger/home/board). Keep it in the measured safe area.
      var title=tourTarget.querySelector('.pop-card-head')||tourTarget.querySelector('h3,h2')||tourTarget;
      var heading=title.getBoundingClientRect();
      if(y<heading.bottom+12&&y+b.height>heading.top-12){
        var below=Math.max(top,heading.bottom+12),above=heading.top-b.height-12;
        if(below+b.height<=bottom)y=below;
        else if(above>=top)y=above;
        else{
          var belowSpace=bottom-below,aboveSpace=heading.top-12-top;
          if(belowSpace>=aboveSpace){y=below;box.style.maxHeight=Math.max(1,belowSpace)+'px';}
          else{y=top;box.style.maxHeight=Math.max(1,aboveSpace)+'px';}
        }
        box.style.top=y+'px';
      }
    }
    // Only connect separated edges through their shared visible projection.
    // Keep the whole stroke / endpoint outside the target; overlap means highlight only.
    box.querySelector('.shell-tour-pointer')?.remove();b=box.getBoundingClientRect();
    var gap=12,l=Math.max(b.left+gap,r.left+gap,vx+gap),right=Math.min(b.right-gap,r.right-gap,vx+vw-gap);
    var t=Math.max(b.top+gap,r.top+gap,top),bt=Math.min(b.bottom-gap,r.bottom-gap,bottom);
    var startX,startY,endX,endY;
    if(l<=right&&b.bottom+gap<r.top&&r.top-gap<=bottom){startX=endX=(l+right)/2;startY=b.bottom;endY=r.top-gap;}
    else if(l<=right&&r.bottom+gap<b.top&&r.bottom+gap>=top){startX=endX=(l+right)/2;startY=b.top;endY=r.bottom+gap;}
    else if(t<=bt&&b.right+gap<r.left&&r.left-gap<=vx+vw-gap){startY=endY=(t+bt)/2;startX=b.right;endX=r.left-gap;}
    else if(t<=bt&&r.right+gap<b.left&&r.right+gap>=vx+gap){startY=endY=(t+bt)/2;startX=b.left;endX=r.right+gap;}
    else return;
    var tip=h('span',{class:'shell-tour-pointer','aria-hidden':'true'});box.append(tip);
    var dx=endX-startX,dy=endY-startY;tip.style.left=startX+'px';tip.style.top=startY+'px';tip.style.width=Math.hypot(dx,dy)+'px';tip.style.transform='rotate('+Math.atan2(dy,dx)+'rad)';
  }
  document.addEventListener('click',e=>{if(e.target.closest('[data-tour-start]'))startTour();});
  document.addEventListener('keydown',e=>{if(tourIndex<0)return;if(e.key==='Escape'){e.preventDefault();stopTour();return;}if(e.key==='Tab'){var buttons=[...document.querySelectorAll('[data-hub-tour] button')].filter(b=>!b.disabled);var first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus({preventScroll:true});}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus({preventScroll:true});}}});
  window.addEventListener('resize',positionTour);document.addEventListener('scroll',positionTour,true);
  window.visualViewport?.addEventListener('resize',positionTour);window.visualViewport?.addEventListener('scroll',positionTour);
  on('render',()=>{if(tourIndex>=0&&!tourRouting){
    // Stream updates replace shell DOM; reacquire the exact target without navigation.
    if(tourAnchor)tourTarget=tourCard(tourAnchor.messageId,tourAnchor.type);
    else tourTarget=document.querySelector([
        '.thread-inner','[data-activity-tab="pending"]',
        '[data-board-action="submit"],.kcard','#hub-view .page-title',
        '[data-capability]','.r22-create-row [data-new-bot-open]'
    ][tourIndex]);
    if(!tourTarget?.isConnected){stopTour();return;}tourTarget.classList.add('shell-tour-target');positionTour();
  }});
  function levelSticker(level,options){
    level=String(level);if(!LEVELS[level])throw Error('Unknown level: '+level);options=options||{};
    return h('button',{type:'button',class:'shell-level-sticker','data-level-sticker':level,'aria-label':level+' · '+LEVELS[level].label,onClick:()=>Hub.sheet({title:level+' · '+LEVELS[level].label,body:container=>{
      container.append(h('p',{},LEVELS[level].explain));
      if(level!=='L4')container.append(h('button',{class:'ghostbtn','data-level-delegate':level,onClick:()=>{
        var bot=assistantId(options.bot||state.bot),action=options.action||'这类动作',scope=options.scope||'同类动作';
        navigate({view:'chat',conversation:featureOwner('permissions').id+'-013'});
        postMessage(state.conversation,{from:'user',time:'刚刚',parts:[{type:'text',md:'以后这类不用问我：'+action+'（'+scope+'）。请先拟放权提议。'}]});
        postMessage(state.conversation,{from:featureOwner('permissions').id,time:'刚刚',parts:[registries.cards.has('governance-delegation')?{type:'governance-delegation',data:{action,level,scope,bot,state:'proposed'}}:{type:'text',md:'放权提议已留给负责助理：'+action+' · '+level+' · '+scope+'。本页尚未接入放权卡，未改变权限。'}]});
      }},'以后这类不用问我'));
    }})},level);
  }
  function showContextMix(){var id=state.conversation,bot=state.bot;
    postMessage(id,{from:bot,time:'刚刚',parts:[registries.cards.has('governance-context-mix')?{type:'governance-context-mix',data:{conversation:id,bot}}:{type:'text',md:'上下文构成卡尚未接入；当前为本页估算。可去账本查看 token。'}]});
    if(!registries.cards.has('governance-context-mix')){var host=document.querySelector('.thread-inner');host?.append(h('button',{class:'ghostbtn','data-context-ledger':'',onClick:()=>navigate({view:'ledger'})},'去账本'));}
  }
  function outfits(botId){return (botBy(botId)?.outfits||[]).map(o=>({...o,emotionMap:{...(o.emotionMap||{})}}));}
  function currentOutfit(botId){var b=botBy(botId);return outfits(botId).find(o=>o.id===b?.outfitId)||null;}
  function setOutfit(botId,outfitId){var b=botBy(botId),outfit=b?.outfits?.find(o=>o.id===outfitId);if(!outfit||!outfit.license?.trim())return false;b.outfitId=outfit.id;refresh();emit('outfit',{bot:botId,outfitId:outfit.id});return currentOutfit(botId);}
  document.addEventListener('click',e=>{var el=e.target.closest('[data-memory-entries],[data-memory-mount],[data-context-mix],[data-bot-expand]');if(!el)return;
    if('memoryEntries'in el.dataset)apiOpenPanel('memory',{bot:el.dataset.memoryEntries});
    if('memoryMount'in el.dataset)memorySheet(el.dataset.memoryMount);
    if('contextMix'in el.dataset)showContextMix();
    if(el.dataset.botExpand){state.botTreeCollapsed[el.dataset.botExpand]=!state.botTreeCollapsed[el.dataset.botExpand];refresh();}
  });
  // R9: scrolling and stream renders must not dismiss a fresh background report.
  BOT_SRC.filter(b=>!b.steward&&!b.parent).forEach(b=>{
    memoryByBot.set(b.id,[{id:'rules',title:b.name+' · 演示规则',source:'本页演示 · 共享白名单',tokens:1200},demoFixture("core.Hub.132")]);
  });

  
  state.pendingInputs=[];state.activities=[];state.botTemplates=[];state.botTreeCollapsed=demoFixture("core.Hub.133");
  state.callState={bot:null,minimized:false,startedAt:null};
  var activityTab='pending', activitySelected=new Set();
  function refresh(){if(ready)render();}
  function subBots(id){return fixedTasks(id).map(t=>({...t,id:t.taskId,parent:t.ownerAssistantId,name:fixedTaskTitle(t),duty:t.note}));}
  function registerPendingInput(spec){
    var old=spec.bot,task=state.fixedTasks.find(t=>t.taskId===old);spec={...migrateRefs(spec),featureId:LEGACY_FEATURE_IDS[old]||spec.featureId,taskId:task?.taskId||spec.taskId};
    validId(spec.id);if(!botBy(spec.bot)||!spec.what||!spec.blocking||!Number.isFinite(new Date(spec.since).getTime()))throw Error('Incomplete pending input');
    if(state.pendingInputs.some(p=>p.id===spec.id))throw Error('Duplicate pending input: '+spec.id);
    var item=Object.assign({},spec,{since:new Date(spec.since).getTime(),cardData:Object.assign({},spec.cardData)});state.pendingInputs.push(item);refresh();return item;
  }
  function resolvePendingInput(id){var i=state.pendingInputs.findIndex(p=>p.id===id);if(i<0)return false;state.pendingInputs.splice(i,1);refresh();emit('pending-input',{id:id,resolved:true});return true;}
  function pendingInputs(){return state.pendingInputs.slice();}
  function openPendingInput(id){
    var p=state.pendingInputs.find(p=>p.id===id);if(!p)return false;
    var target=p.taskId?state.fixedTasks.find(t=>t.taskId===p.taskId)?.conversation:p.bot+'-013';navigate({view:'chat',conversation:target});
    if(!registries.cards.has('cards-a-secret-input')){toast('私密输入卡尚未接入；这项仍保留在待输入清单。');return false;}
    var c=conversations.get(target),message=c.messages.find(m=>m.parts?.some(part=>part.type==='cards-a-secret-input'&&part.data?.pendingId===id));
    if(!message)message=postMessage(c.id,{from:p.bot,time:'刚刚',parts:[{type:'cards-a-secret-input',data:Object.assign({},p.cardData,{pendingId:p.id,bot:p.bot,what:p.what,forWhat:p.forWhat,blocking:p.blocking})}]});
    var el=[...document.querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===message.id);if(el)shellReading.locate(el,{block:'center',reason:'pending-input'});return message;
  }
  function waiting(since){var mins=Math.max(0,Math.floor((Date.now()-since)/60000));return mins>=1440?Math.floor(mins/1440)+' 天':mins>=60?Math.floor(mins/60)+' 小时':mins+' 分钟';}
  function fillPending(c){
    c.append(h('p',{class:'mini-note'},'全为演示项目；请在私密输入卡内操作，不要把私密内容发到聊天。'));
    state.pendingInputs.forEach(p=>c.append(h('button',{class:'setting-row shell-pending-row','data-pending-input':p.id,onClick:()=>openPendingInput(p.id)},[
      fromHTML('<span class="r29-activity-face">'+r29Face(p.bot,28)+'</span>'),
      h('span',{class:'grow'},[h('strong',{},botBy(p.bot).name+' · '+p.what),h('small',{},'演示 · 已等 '+waiting(p.since)+' · '+(p.forWhat||'私密输入')),h('small',{},'卡住：'+p.blocking)]),fromHTML(ico('chevron'))
    ])));
    if(!state.pendingInputs.length)c.append(h('p',{},'没有待输入的项目。'));
  }
  function pendingSheet(){activityTab='pending';activitySheet();}
  var activityUndoTimer=null;
  function activityUndo(kind,ids){
    var before=state.activities.filter(a=>kind==='read'||ids.includes(a.id)).map(a=>({id:a.id,read:a.read,cleared:a.cleared}));
    if(kind==='read')markActivitiesRead();else clearActivities(ids);
    clearTimeout(activityUndoTimer);toast(kind==='read'?'全部已读':'已清理所选');clearTimeout(toast.timer);
    var host=document.getElementById('toast');host.replaceChildren(h('span',{},kind==='read'?'全部已读 · ':'已清理所选 · '),h('button',{'data-activity-undo':kind,onClick:()=>{
      clearTimeout(activityUndoTimer);before.forEach(prev=>{var a=state.activities.find(x=>x.id===prev.id);if(a){a.read=prev.read;a.cleared=prev.cleared;}});refresh();host.className='';host.replaceChildren();
    }},'撤销'));
    activityUndoTimer=setTimeout(()=>{host.className='';host.replaceChildren();},4000);
  }
  function registerBotTemplate(spec){validId(spec.id);if(!spec.name||!spec.duty)throw Error('Incomplete bot template');if(spec.color&&!/^#[0-9a-f]{6}$/i.test(spec.color))throw Error('Template color must be a six-digit hex');register('botTemplates',spec.id,spec);state.botTemplates.push(Object.assign({},spec));refresh();return spec;}
  function createBot(spec){
    spec=spec||{};if(spec.parent){var task=createFixedTask(spec.parent,{taskId:spec.id,taskName:spec.taskName||Array.from(spec.name||'').slice(0,8).join(''),note:spec.duty});return {...task,id:task.taskId,name:fixedTaskTitle(task),duty:task.note,parent:task.ownerAssistantId};}var generated;do{generated='my-bot-'+(++sequence);}while(botBy(generated));var id=validId(spec.id||generated);if(botBy(id))throw Error('Duplicate bot: '+id);
    if(!String(spec.name||'').trim()||!String(spec.duty||'').trim())throw Error('Bot needs name and duty');if(spec.parent&&!botBy(spec.parent))throw Error('Unknown parent bot');
    if(typeof spec.color!=='undefined'&&!/^#[0-9a-f]{6}$/i.test(spec.color))throw Error('Bot color must be a six-digit hex');
    var parent=botBy(spec.parent),base=parent||state.bots.find(b=>b.role==='chief');
    var derivedColor=parent?'#'+parent.color.slice(1).match(/../g).map(c=>Math.round(parseInt(c,16)*.78+255*.22).toString(16).padStart(2,'0')).join(''):base.color;
    var b=Object.assign({},base,{id:id,parent:spec.parent||null,role:spec.parent?'task':'assistant',owns:[],taskName:spec.taskName||spec.name,updatedAt:Date.now(),name:String(spec.name),duty:String(spec.duty),color:spec.color||derivedColor,avatarSrc:'',avatarGlyph:spec.avatarGlyph||'✦',avatar:spec.avatar||{kind:'shape',shapeId:ASSISTANT_SHAPES[0].id,color:spec.color||derivedColor},avatarExplicit:true,enabled:true,profileRevision:0,description:spec.description||ASSISTANT_COPY.description,status:'active',unread:0,steward:false,custom:true,initialAssistant:false,homeLabel:String(spec.duty),outfitId:'default',outfits:[],brain:spec.brain||demoText("core.brain.134"),workers:spec.workers||[],tools:spec.tools||[],permission:spec.permission||'L0 · 只读',quickReplies:(spec.quickReplies||ASSISTANT_COPY.phrases).slice()});
    state.bots.push(b);SHORT[id]=b.duty;PREV[id]='演示：'+b.duty+'，未连接服务。';COLORS[id]=b.color;PATHS[id]=b.avatarPath;LINES[id]={'开心':PREV[id],'思考':'我先整理草稿。','抱歉':'当前仅离线演示。'};
    state.sessionNames[id]=b.name+' · 今日';state.threads[id]=[];activeByBot[id]=id+'-013';
    conversations.set(id+'-013',{id:id+'-013',bot:id,title:state.sessionNames[id],assistantTitle:true,messages:state.threads[id]});
    state.threads[id].push(normalize({from:id,time:'刚刚',parts:[{type:'text',md:PREV[id]}]},null,id));refresh();emit('bot-created',b);return b;
  }
  function updateAssistantIdentity(id,oldName){
    var b=botBy(id);if(!b)return;
    conversations.forEach(c=>{if(c.bot===id&&c.assistantTitle&&c.title===oldName+' · 今日'){c.title=b.name+' · 今日';if(activeByBot[id]===c.id)state.sessionNames[id]=c.title;}});
    (memoryByBot.get(id)||[]).forEach(m=>{if(m.title===oldName+' · 演示规则')m.title=b.name+' · 演示规则';});
  }
  function setBotStatus(id,status){
    var task=state.fixedTasks.find(t=>t.taskId===id);if(task&&typeof status==='string')return setFixedTaskStatus(id,status);id=assistantId(id);var b=botBy(id);if(!b)return false;
    if(status&&typeof status==='object'){
      for(var key of ['unread','pending'])if(key in status&&(!Number.isInteger(status[key])||status[key]<0))throw Error('Bot counts must be non-negative integers');
      if('running'in status&&typeof status.running!=='boolean')throw Error('Bot running must be boolean');
      if('running'in status){b.running=status.running;b.status=status.running?'busy':(b.status==='paused'?'paused':'active');}
      for(var key of ['unread','pending'])if(key in status)b[key]=status[key];
    }else{if(!['paused','active'].includes(status))throw Error('Unsupported bot status');b.status=status;b.running=false;}
    if(status&&typeof status==='object'){var old=document.querySelector('.sidebar');if(old){var search=old.querySelector('#botsearch'),searchFocused=!!search&&document.activeElement===search,start=search?.selectionStart,end=search?.selectionEnd,scroll=old.querySelector('.bot-scroll')?.scrollTop||0,next=fromHTML(sidebar());old.replaceWith(next);var list=next.querySelector('.bot-scroll');if(list)list.scrollTop=scroll;if(searchFocused){var field=next.querySelector('#botsearch');field?.focus({preventScroll:true});if(typeof start==='number'&&field?.setSelectionRange)try{field.setSelectionRange(start,end);}catch(e){}}chiefPet.sync();}}else refresh();emit('bot-status',{bot:id,running:b.running===true||b.status==='busy',unread:b.unread||0,pending:b.pending||0});return b;
  }
  var moreItems=new Map(),demoContent=new Map();
  /* 这些入口「更多」第一层已有同样的一行，适配层再登记的不重复显示。 */
  var R31_MORE_COVERED=new Set(['hub-real-permissions','hub-real-today','hub-real-panic','hub-real-routines','hub-real-board','hub-real-ledger','hub-real-bots','hub-real-profiles','shell-assistants']);
  function mountMoreItems(){
    var host=document.querySelector('.more-drawer .r22-sheet-content');if(!host)return;
    var list=host.querySelector('[data-hub-more-items]');if(!list){list=h('div',{'data-hub-more-items':true});host.append(list);}
    list.replaceChildren();if(document.documentElement.dataset.hubMode==='real')return;moreItems.forEach(item=>{if(R31_MORE_COVERED.has(item.id))return;list.append(h('button',{class:'setting-row r22-list-row','data-hub-more-item':item.id,type:'button',onClick:()=>item.onClick(context())},item.label))});
  }
  function registerMoreItem(spec){
    if(!spec||typeof spec.id!=='string'||!spec.id.trim()||typeof spec.label!=='string'||!spec.label.trim()||typeof spec.onClick!=='function')throw Error('More item requires id, label and onClick');
    var item={id:spec.id,label:spec.label,onClick:spec.onClick};moreItems.set(item.id,item);mountMoreItems();return item;
  }
  var demoObserver=null;
  function applyDemoContent(){var view=document.querySelector('.chatview');demoObserver?.disconnect();if(view){view.dataset.demo=demoContent.get(state.bot)===false?'off':'on';if(typeof window.MutationObserver==='function'){var bot=state.bot;demoObserver=new MutationObserver(()=>{if(['on','off'].includes(view.dataset.demo))demoContent.set(bot,view.dataset.demo!=='off');});demoObserver.observe(view,{attributes:true,attributeFilter:['data-demo']});}}}
  function setDemoContent(bot,enabled){if(!botBy(bot))return false;if(typeof enabled!=='boolean')throw Error('Demo content must be boolean');demoContent.set(bot,enabled);if(state.bot===bot){applyDemoContent();measureDock();}return enabled;}
  on('render',()=>{applyDemoContent();mountMoreItems();r22SyncThemeColor();});
  function removeBot(id){
    var b=botBy(id);if(!b)return false;
    // Existing project fixtures keep referenced assistants; sub-bots and custom bots are removable.
    if(!b.custom&&!b.parent){toast('演示主 bot 仍被项目引用，请先处理关联事项。');return false;}
    if(subBots(id).length){toast('请先处理它的分 bot。');return false;}
    if(state.bot===id)navigate({view:'chat',conversation:(b.parent||'chief')+'-013'});
    if(state.callState.bot===id)hideFloatingCall();
    state.bots=state.bots.filter(x=>x.id!==id);state.pendingInputs=state.pendingInputs.filter(x=>x.bot!==id);state.activities=state.activities.filter(x=>x.bot!==id);
    memoryByBot.delete(id);conversations.forEach((c,key)=>{if(c.bot===id){conversations.delete(key);contextByConversation.delete(key);backgroundCounts.delete(key);}});delete activeByBot[id];delete state.threads[id];delete state.sessionNames[id];delete SHORT[id];delete PREV[id];delete COLORS[id];delete PATHS[id];delete LINES[id];
    registries.capabilities.forEach((c,key)=>{if(c.steward===id)registries.capabilities.delete(key);});refresh();return true;
  }
  function dutyField(c,initial){var field=h('input',{class:'pop-input','data-new-bot-duty':true,required:true,value:initial||'','aria-label':'负责什么项目',placeholder:'一句话说清它负责的项目'}),hint=h('small',{'data-new-bot-validation':true,role:'status'});c.append(h('label',{class:'field'},['负责什么项目（必填）',field]),hint);return ()=>{var value=field.value.trim();hint.textContent=value?'':'请先填写负责什么项目';return value;};}
  function templateSheet(initial){Hub.sheet({title:'从模板创建',body:c=>{
    var duty=dutyField(c,initial);
    if(!registries.botTemplates.size)c.append(h('p',{},'模板尚未接入。可以先说清职责，再创建助理。'));
    registries.botTemplates.forEach((t,id)=>c.append(h('button',{class:'pop-card shell-template',style:botStyle(state.bots.find(b=>b.role==='chief').id),'data-bot-template':id,onClick:()=>{
      var value=duty();if(!value)return;var b=createBot({name:t.name,duty:value,color:t.color,brain:t.brain,workers:t.workers,tools:t.tools});navigate({view:'chat',conversation:b.id+'-013'});toast('已从模板创建 · 仅本页演示');
    }},[fromHTML(ico(t.icon||'plus')),h('strong',{},t.name),h('p',{},t.duty),h('small',{},'创建 · 默认只读 · 本页演示')])));
  }});}
  function newBotSheet(){Hub.sheet({title:'新建助理',body:c=>{var duty=dutyField(c);var chief=state.bots.find(b=>b.role==='chief');c.append(
    h('button',{class:'setting-row','data-new-bot-choice':'chief',onClick:()=>{var value=duty();if(!value)return;var text='帮我建一个助理，负责：'+value;state.input=text;state.refocus=true;navigate({view:'chat',conversation:chief.id+'-013'});var input=document.querySelector('[data-focus="composer"]');if(input){state.input=text;input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));input.setSelectionRange(text.length,text.length);input.focus({preventScroll:true});}}},[fromHTML(ico('chat')),h('span',{class:'grow'},[h('strong',{},'跟'+chief.name+'说'),h('small',{},'先说想让它做什么')])]),
    h('button',{class:'setting-row','data-new-bot-choice':'templates',onClick:()=>{var value=duty();if(value)templateSheet(value);}},[fromHTML(ico('grid')),h('span',{class:'grow'},[h('strong',{},'从模板创建'),h('small',{},'选一张模板贴纸')])])
  );}});}
  function registerActivity(spec){var old=spec.bot;spec={...migrateRefs(spec),featureId:spec.featureId||LEGACY_FEATURE_IDS[old]};validId(spec.id);if(!['decide','inform'].includes(spec.kind)||!botBy(spec.bot)||!spec.title)throw Error('Incomplete activity');if(state.activities.some(a=>a.id===spec.id))throw Error('Duplicate activity: '+spec.id);var source=spec.conversation||spec.bot+'-013';if(!conversations.has(source)||conversations.get(source).bot!==spec.bot)throw Error('Unknown activity source conversation');var a=Object.assign({detail:'',time:'刚刚',read:false,handled:false,cleared:false,_owner:owner,conversation:source},spec);state.activities.push(a);refresh();return a;}
  function supersedeDecision(id,options){
    var d=decBy(id),by=options&&options.by;
    if(!d||typeof by!=='string'||!by.trim())return false;
    if(d.status==='superseded')return d.supersededBy===by?d:false;
    if(isClosed(d))return false;
    d.status='superseded';d.supersededBy=by;d.supersededNote=String(options.note||'');
    state.cards.filter(c=>c.decision===id).forEach(c=>{c.flag='已替代';c.sub=resultText(d);c.detail=resultText(d)+(d.supersededNote?'。'+d.supersededNote:'');});
    state.activities.filter(a=>a.decision===id).forEach(a=>{a.handled=true;a.read=true;a.detail=resultText(d)+(d.supersededNote?'。'+d.supersededNote:'');});
    refresh();return d;
  }
  function activityKind(a){var d=a.decision&&decBy(a.decision);return a.handled||d&&isClosed(d)?'handled':a.kind;}
  function activities(kind){return state.activities.filter(a=>!a.cleared&&(!kind||activityKind(a)===kind));}
  function markActivitiesRead(){state.activities.forEach(a=>{a.read=true;});refresh();}
  function completeActivity(id){var a=state.activities.find(a=>a.id===id);if(!a)return false;a.handled=true;a.read=true;refresh();return true;}
  function clearActivities(ids){var count=0;state.activities.forEach(a=>{if(ids.includes(a.id)&&!a.cleared){a.cleared=true;count++;}});activitySelected.clear();refresh();return count;}
  function restoreActivities(ids){var count=0;state.activities.forEach(a=>{if(a.cleared&&(!ids||ids.includes(a.id))){a.cleared=false;count++;}});refresh();return count;}
  function activityUnread(){return activities().filter(a=>!a.read&&activityKind(a)!=='handled').length;}
  function replyActivity(a){Hub.sheet({title:'回一句话',body:c=>{var input=h('textarea',{class:'pop-input','data-activity-reply':a.id,rows:3,'aria-label':'回复 '+a.title});c.append(h('p',{},a.title),input,h('button',{class:'primary','data-activity-reply-send':a.id,onClick:()=>{var text=input.value.trim();if(!text)return;postMessage(a.conversation,{from:'user',time:'刚刚',parts:[{type:'text',md:'回复「'+a.title+'」：'+text}]});completeActivity(a.id);navigate({view:'chat',conversation:a.conversation});}},'回复到来源会话'));}});}
  function transferActivity(a){Hub.sheet({title:'转给某个 bot',body:c=>state.bots.filter(b=>b.status!=='paused').forEach(b=>c.append(h('button',{class:'setting-row','data-activity-target':b.id,onClick:()=>{
    postMessage(b.id+'-013',{from:'user',time:'刚刚',parts:[{type:'text',md:'转派自 '+botBy(a.bot).name+'：「'+a.title+'」\n'+a.detail+'\n仅本页演示，请整理下一步。'}]});a.transferredTo=b.id;completeActivity(a.id);navigate({view:'chat',conversation:b.id+'-013'});
  }},[fromHTML(avatar(b.id)),h('span',{},b.name)]))) });}
  function openToday(){var real=document.documentElement.dataset.hubMode==='real';if(real&&!registries.panels.has('hub-real-today')){Hub.sheet({title:'今天',body:c=>c.append(h('p',{role:'status'},'暂无'))});return;}var id=real?'hub-real-today':'r30l-today';if(registries.panels.has(id))apiOpenPanel(id);else activitySheet();}
  function activitySheet(){Hub.sheet({title:'活动中心',body:c=>{
    c.closest('.drawer')?.classList.add('shell-activity-drawer');
    var kinds=[['pending','待输入'],['decide','要你定的'],['inform','只是告知'],['handled','已处理']],tabs=h('div',{class:'segmented shell-activity-tabs','aria-label':'活动分类'});
    kinds.forEach(([id,label])=>tabs.append(h('button',{class:activityTab===id?'on':'','data-activity-tab':id,'aria-pressed':activityTab===id,onClick:()=>{activityTab=id;refresh();}},label+' '+(id==='pending'?state.pendingInputs.length:activities(id).length))));
    c.append(tabs,h('p',{class:'mini-note'},'离线演示；处理、回复与转派只留在本页。'));
    var batch=h('button',{class:'ghostbtn','data-activity-action':'clear',onClick:()=>activityUndo('clear',[...activitySelected])},'清理所选（'+activitySelected.size+'）');
    var footer=h('div',{class:'actions r22-activity-footer'},[h('button',{class:'ghostbtn','data-activity-action':'read-all',onClick:()=>activityUndo('read')},'全部已读'),batch]);c.append(footer);
    var columns=h('div',{class:'shell-activity-columns'});c.append(columns);
    kinds.forEach(([kind,label])=>{
      var col=h('section',{class:'shell-activity-column '+(activityTab===kind?'on':''),'data-activity-column':kind},h('h3',{},label+' '+(kind==='pending'?state.pendingInputs.length:activities(kind).length)));columns.append(col);
      if(kind==='pending'){fillPending(col);return;}
      var list=activities(kind);
      list.forEach(a=>{
        var check=h('input',{type:'checkbox',checked:activitySelected.has(a.id),'aria-label':'选择 '+a.title,'data-activity-select':a.id,onChange:e=>{if(e.target.checked)activitySelected.add(a.id);else activitySelected.delete(a.id);batch.textContent='清理所选（'+activitySelected.size+'）';}});
        var row=h('article',{class:'surface shell-activity','data-activity-id':a.id},[
          h('div',{class:'shell-activity-head'},h('label',{class:'row'},[check,h('strong',{},a.title)])),
          h('div',{class:'shell-activity-meta'},[fromHTML('<span class="r29-activity-face">'+r29Face(a.bot,28)+'</span>'),h('p',{class:'muted'},botBy(a.bot).name+' · '+a.time),h('div',{class:'shell-activity-state'},[!a.read?h('span',{class:'badge'},'未读'):null,activityKind(a)!=='handled'?h('button',{class:'textbutton','data-activity-complete':a.id,onClick:()=>completeActivity(a.id)},'标为已处理'):null])]),
          h('p',{},a.detail)]);row.setAttribute('style',botStyle(a.bot));
        var actions=h('div',{class:'actions'},[
          h('button',{class:'ghostbtn','data-activity-transfer':a.id,onClick:()=>transferActivity(a)},'转给 bot'),h('button',{class:'ghostbtn','data-activity-reply-open':a.id,onClick:()=>replyActivity(a)},'回一句话'),h('button',{class:'primary','data-activity-source':a.id,onClick:()=>a.kind==='inform'&&a.featureId?openFeature(a.featureId):navigate({view:'chat',conversation:a.conversation})},a.kind==='inform'&&a.featureId?'查看功能记录':'到来源会话')
        ]);
        if(a.decision)actions.append(h('button',{class:'ghostbtn',onClick:()=>openPanel('decisions')},'查看原审批'));
        (a.actions||[]).forEach(action=>{if(typeof action.run==='function')actions.append(h('button',{class:'ghostbtn',onClick:()=>safe(a._owner||'core',()=>action.run(a,context()))},action.label||'处理'));});
        row.append(actions);col.append(row);
      });
      if(!list.length)col.append(h('p',{},'这一栏没有活动。'));
    });
    var drawer=c.closest('.drawer');if(drawer)drawer.append(footer);
    var cleared=state.activities.filter(a=>a.cleared);if(cleared.length)c.append(h('button',{class:'ghostbtn','data-activity-action':'restore',onClick:()=>restoreActivities()},'恢复已清理的 '+cleared.length+' 条'));
  }});}
  function showFloatingCall(botId){if(!botBy(botId))throw Error('Unknown call bot');var call=state.callState;if(call.bot!==botId||!call.startedAt)call.startedAt=Date.now();call.bot=botId;call.minimized=true;refresh();emit('call',{...call});return call;}
  function hideFloatingCall(){Object.assign(state.callState,{bot:null,minimized:false,startedAt:null});refresh();emit('call',{...state.callState});}
  function callElapsed(){var seconds=Math.max(0,Math.floor((Date.now()-state.callState.startedAt)/1000));return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');}
  function floatingCallHTML(){var call=state.callState;return call.bot&&call.minimized?'<button class="shell-floating-call glass" data-floating-call="'+esc(call.bot)+'" aria-label="展开与 '+esc(botBy(call.bot).name)+' 的演示通话" style="'+botStyle(call.bot)+'">'+avatar(call.bot)+'<span data-call-timer>'+callElapsed()+'</span></button>':'';}
  function setMessageStatus(conversationId,messageId,status,tool){
    if(!['sent','delivered','read','thinking','tool'].includes(status))throw Error('Unsupported message status');var c=conversations.get(conversationId);if(!c)return false;if(activeByBot[c.bot]===c.id)c.messages=state.threads[c.bot];var m=c.messages.find(m=>m.id===messageId);if(!m)return false;var completing=m.from!=='user'&&['thinking','tool'].includes(m.status)&&!['thinking','tool'].includes(status);m.status=status;if(status==='tool')m.statusTool=String(tool||'工具');else delete m.statusTool;if(completing&&status==='delivered'&&c.bot==='chief'&&state.conversation===conversationId&&state.running&&m.parts?.some(p=>p.type==='interact-stream'))chiefPet.replying();
    if(ready&&state.conversation===conversationId&&state.mode==='chat'){
      var article=[...document.querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===messageId);
      if(article)shellReading.preserve(()=>{
        var pill=article.querySelector('.r22-reply-status');if(!pill&&m.role!=='user'&&article.querySelector('.bubble')){pill=h('span',{class:'r22-reply-status'});article.querySelector('.bubble').append(pill);}if(pill)pill.textContent=messageStatusText(m)||'';
        var footer=article.querySelector('.message-footer');if(footer){footer.replaceChildren();renderActions(footer,m,c.messages.indexOf(m));}
      },{reason:'message-status'});
    }
    if(completing)animateMessage(conversationId,m,'done');emit('message-status',{conversation:conversationId,message:m});return m;
  }
  // Modules report turn state through Hub; only avatar nodes are replaced here.
  function updateChiefFace(conversation,face){
    var turnBot=conversations.get(conversation)?.bot;
    if(turnBot&&state.conversation===conversation)chiefPet.turn(turnBot,face==='normal'?'idle':face);
    if(turnBot!=='chief'||state.bot!=='chief'||state.conversation!==conversation)return;
    if(!['normal','thinking','done','confused'].includes(face))return;
    state.emotion=face==='thinking'?'思考':face==='confused'?'抱歉':'开心';
    setChiefFace(face,face==='confused'?2400:face==='done'?1600:0,conversation);
    refreshChiefAvatars();
    if(face==='done')animateChiefDone(conversation);
  }
  function messageStatusText(m){return m.from==='user'?({sent:'已发送',delivered:'已送达',read:'bot 已读'}[m.status]||''):m.status==='thinking'?'正在想…':m.status==='tool'?'正在用工具：'+(m.statusTool||'工具'):'';}
  document.addEventListener('click',e=>{
    var el=e.target.closest('[data-today-open],[data-pending-input-open],[data-activity-open],[data-new-bot-open],[data-r22-template-open],[data-bot-fold],[data-floating-call]');if(!el)return;
    if('todayOpen'in el.dataset){openToday();return;}if('pendingInputOpen'in el.dataset){activityTab='pending';activitySheet();}if('activityOpen'in el.dataset){activityTab='pending';activitySheet();}if('r22TemplateOpen'in el.dataset)templateSheet();if('newBotOpen'in el.dataset)newBotSheet();
    if(el.dataset.botFold){var id=el.dataset.botFold;state.botTreeCollapsed[id]=!state.botTreeCollapsed[id];refresh();}
    if(el.dataset.floatingCall){var id=state.callState.bot;state.callState.minimized=false;navigate({view:'chat',conversation:id+'-013'});emit('call:expand',context({callState:state.callState}));}
  });

  function slot(kind,data){var id=String(++sequence);slots.set(id,{kind:kind,data:data});return '<div class="hub-mount'+(kind==='card'?' hub-part':'')+'" data-hub-slot="'+id+'"></div>';}
  function unknown(type){return h('section',{class:'mcard'},[h('p',{class:'eyebrow'},'未知卡片'),h('p',{},String(type))]);}
  function cardElement(type,data,msg){var s=registries.cards.get(type);if(!s)return unknown(type);var el=invoke(s,'render',[data,context({message:msg})],()=>unknown(type))||unknown(type);if(type==='interact-stream'){el.classList.add('bubble');el.prepend(fromHTML(r22Nameplate(botBy(msg?.from)?msg.from:state.bot)));}return el;}
  function messageText(m){return (m.parts||[]).map(p=>{if(p.type==='text')return p.md||'';var s=registries.cards.get(p.type);return s&&s.quoteLabel?invoke(s,'quoteLabel',[p.data],s.title):s?.title||'未知卡片';}).join('\n');}
  function markdown(text){return esc(text).replace(/\*\*([^*]+)\*\*/g,demoText("core.Hub.135")).replace(/\n/g,'<br>');}
  function messageLabel(m){
    var d=m.card&&decBy(m.card.id);
    return messageStatusText(m)||(m.card?(d&&isClosed(d)?(d.status==='superseded'?'已替代':d.status==='approved'?'已批准':'已拒绝'):m.card.type==='draft'?'仅草稿':m.card.type==='file'?'交付物':'待审批'):'已回复');
  }
  function r43DeleteAttrs(m){
    var bits='';
    if(m&&m.session)bits+=' data-session="'+esc(m.session)+'"';
    var kernel=m&&(m.messageId||'');
    if(kernel)bits+=' data-r43-kernel="'+esc(kernel)+'"';
    if(m&&m.seq!=null)bits+=' data-message-seq="'+esc(m.seq)+'"';
    return bits;
  }
  function messageHTML(m,i){
    if(m.kind==='segment'&&window.R43Thread)return R43Thread.rowHTML(m);
    normalize(m,i,state.bot);if(m.role==='user')return '<article class="msg msg-user" data-message-id="'+esc(m.id)+'"'+r43DeleteAttrs(m)+' data-message-from="user">'+(window.R43Thread?R43Thread.labelHTML(m):'')+'<div class="user-bubble">'+m.parts.map(p=>p.type==='text'?'<p>'+markdown(p.md||'')+'</p>':slot('card',{type:p.type,data:p.data,message:m})).join('')+'</div>'+slot('actions',{message:m,index:i})+'</article>';
    var d=m.card&&decBy(m.card.id), label=messageLabel(m);
    var content=m.parts.map(p=>{if(p.type!=='text')return slot('card',{type:p.type,data:p.data,message:m});var text=markdown(p.md||'');if(m.id==='chief-msg-1')text=demoText("core.content.136");else text='<p>'+text+'</p>';return '<div class="bubble hub-part">'+r22Nameplate(botBy(m.from)?m.from:state.bot)+(messageStatusText(m)?'<span class="r22-reply-status">'+esc(messageStatusText(m))+'</span>':'')+text+'</div>';}).join('');
    return '<article class="msg msg-bot" data-message-id="'+esc(m.id)+'"'+r43DeleteAttrs(m)+' data-message-from="'+esc(m.from)+'">'+content+slot('actions',{message:m,index:i})+'</article>';}
  function messageActions(m){
    var aliases={'copy':'copy','interact-copy':'copy','tts':'read','interact-read':'read','retry':'retry','interact-retry':'retry','branch':'fork','interact-fork':'fork','quote':'quote','interact-quote':'quote'}, list=new Map();
    registries.actions.forEach((a,id)=>{if(id==='interact-more'||a.when&&!invoke(a,'when',[m],false))return;var key=aliases[id]||a.label;if(!list.has(key)||id.startsWith('interact-'))list.set(key,{id:id,key:key,spec:a});});return [...list.values()];
  }
  function renderActions(host,m,i){host.className='message-footer';var actions=messageActions(m);
    actions.filter(a=>['copy','quote'].includes(a.key)||a.id==='memory-sources').forEach(({id,spec:a})=>host.append(h('button',{type:'button',class:id==='memory-sources'?'hub-memory-tag':'iconbtn',title:a.label,'aria-label':a.label,onClick:()=>invoke(a,'run',[m,context({index:i})])},[fromHTML(ico(a.icon)),id==='memory-sources'?a.label:null])));
    if(m.role==='user')host.append(h('span',{class:'message-meta',...(!m.ts?{'data-demo-content':'receipt-meta'}:{})},(m.time||'刚刚')+' · 已读'));host.append(h('button',{type:'button',class:'iconbtn',title:'更多消息操作','aria-label':'更多消息操作',onClick:()=>messageMenu(host,m,i)},fromHTML(ico('more'))),fromHTML('<button class="token textbutton" data-act="round-stats" data-index="'+i+'">'+esc(m.time)+(messageStatusText(m)?' · '+esc(messageStatusText(m)):'')+' · 1.2k token '+ico('jump')+'</button>'));
  }
  function mountSlots(){document.querySelectorAll('[data-hub-slot]').forEach(host=>{var s=slots.get(host.dataset.hubSlot);if(!s)return;delete host.dataset.hubSlot;var d=s.data;if(s.kind==='card'){host.dataset.tourCard=d.type;var decision=d.data&&decBy(d.data.id);host.setAttribute('style',botStyle(decision?decision.bot:state.bot));host.append(cardElement(d.type,d.data,d.message));}if(s.kind==='actions')renderActions(host,d.message,d.index);if(s.kind==='badges'){host.className='hub-badges';badges.forEach(b=>{var el=safe(b.owner,()=>b.fn(d,context()));if(el instanceof Node)host.append(el);});}if(s.kind==='sections')registries.sections.forEach(def=>{if(def.when&&!invoke(def,'when',[d],false))return;var section=h('section',{class:'surface'},def.title?h('h3',{},def.title):null);invoke(def,'render',[section,d,context()]);host.append(section);});});slots.clear();}
  function mount(){state.conversation=activeByBot[state.bot];var host=document.getElementById('hub-view'), view=registries.views.get(state.mode);if(view)invoke(view,'render',[host,context()],()=>{host.append(unknown(state.mode));});else host.append(unknown(state.mode));if(state.mode!=='chat')host.dataset.scroll='page-'+state.mode;if(!mainViews.includes(state.mode))host.classList.add('hub-extension-view');
    var panel=document.querySelector('[data-hub-panel]');if(panel){var def=registries.panels.get(state.drawer);invoke(def,'render',[panel,context({params:state.panelParams||{}})]);}
    var settings=document.querySelector('[data-hub-settings]');if(settings){var def=registries.settings.get(state.settingsTab);invoke(def,'render',[settings]);}
    var sheet=document.querySelector('[data-hub-sheet]');if(sheet){if(typeof state.customSheetBody==='function')safe('sheet',()=>state.customSheetBody(sheet,context()));else if(state.customSheetBody instanceof Node)sheet.append(state.customSheetBody);else sheet.textContent=state.customSheetBody||'';}
    var tab=document.querySelector('[data-hub-bot-tab]');if(tab){var def=registries.botTabs.get(state.botTab);if(def)invoke(def,'render',[tab,botBy(state.bot),context({subBots:subBots(state.bot)})]);}
    mountSlots();mountMemoryRelease();mountBackgroundHint();var dock=document.querySelector('.composer-area');
    var targets=dock?[dock.querySelector(demoText("core.targets.137"))]:[document.querySelector('.hub-header-status'),document.querySelector('.hub-menu-status')];
    targets.filter(Boolean).forEach(target=>{var chips=h('div',{class:'hub-status'});[...registries.chips.values()].sort((a,b)=>(a.order||0)-(b.order||0)).forEach(def=>{var el=h('span',{});invoke(def,'render',[el,context()]);chips.append(el);});target.append(chips);});measureDock();}
  function r22PrimaryAction(thread){
    var buttons=[...thread.querySelectorAll('.primary')].filter(el=>!el.disabled),approvals=buttons.filter(el=>el.dataset.op==='approve');
    // 监工意见2：全线程最新一张未处理审批是唯一黄色主动作。
    var primary=approvals.at(-1)||buttons.at(-1);buttons.forEach(el=>el.dataset.r22Primary=String(el===primary));
  }
  function compactChatRows(){
    var dock=document.querySelector('.composer-area'),thread=document.querySelector('.thread');if(!dock||!thread)return;
    var quick=dock.querySelector('.hub-quick'),slot=dock.querySelector('.chat-quick-slot'),tail=document.querySelector('.chat-tail');
    if(quick&&!quick.dataset.shellVerticalProxy){
      quick.dataset.shellVerticalProxy='true';var gesture=null;
      quick.addEventListener('touchstart',e=>{gesture=e.touches.length===1?{id:e.touches[0].identifier,x:e.touches[0].clientX,y:e.touches[0].clientY,last:e.touches[0].clientY,axis:null}:null;},{passive:true});
      quick.addEventListener('touchmove',e=>{
        if(!gesture||e.touches.length!==1){gesture=null;return;}
        var t=e.touches[0];if(t.identifier!==gesture.id){gesture=null;return;}
        var dx=t.clientX-gesture.x,dy=t.clientY-gesture.y;
        if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8)gesture.axis=Math.abs(dy)>Math.abs(dx)?'y':'x';
        if(gesture.axis==='y'){shellReading.userIntent(true);thread.scrollBy({top:gesture.last-t.clientY,behavior:'instant'});}
        gesture.last=t.clientY;
      },{passive:true});
      ['touchend','touchcancel'].forEach(name=>quick.addEventListener(name,()=>{gesture=null;},{passive:true}));
    }
    if(quick&&slot&&quick.parentNode!==slot)slot.append(quick);
    var pet=document.querySelector('.chief-pet-lane');
    if(pet){var home=pet.classList.contains('is-collapsed')?dock.querySelector(demoText("core.home.138")):dock;if(home&&pet.parentNode!==home)home.prepend(pet);dock.classList.toggle('r22-pet-collapsed',pet.classList.contains('is-collapsed'));}
    var jump=document.querySelector('.m-interact-bottom');
    if(jump&&tail){if(jump.parentNode!==tail)tail.append(jump);jump.hidden=thread.scrollHeight-thread.clientHeight-thread.scrollTop<=thread.clientHeight;}
    if(tail&&tail.classList.contains('has-jump')!==(!!jump&&!jump.hidden))tail.classList.toggle('has-jump',!!jump&&!jump.hidden);
    var hasRole=!!pet&&!pet.classList.contains('is-collapsed');if(dock.classList.contains('has-role')!==hasRole)dock.classList.toggle('has-role',hasRole);
    var bubbles=[...thread.querySelectorAll('.msg-bot .bubble,.msg-bot .m-interact-stream')];
    bubbles.forEach((el,i)=>el.classList.toggle('r22-latest',i===bubbles.length-1));
    document.body.classList.toggle('r22-input-active',!!state.input.trim());
    r22PrimaryAction(thread);
    var messages=[...thread.querySelectorAll('[data-message-id]')];
    messages.forEach((el,i)=>{var same=!!i&&el.dataset.messageFrom===messages[i-1].dataset.messageFrom;if(el.classList.contains('same-speaker')!==same)el.classList.toggle('same-speaker',same);});
  }
  function setMeasured(style,key,value){
    var previous=style.getPropertyValue?style.getPropertyValue(key):style[key];
    if(previous===value)return false;style.setProperty(key,value);return true;
  }
  function measureDock(){
    // A full render calls this after all module hooks; intermediate mounts share that pass.
    if(shellRendering)return;
    compactChatRows();
    var dock=document.querySelector('.composer-area'),thread=document.querySelector('.thread'),root=document.documentElement;
    var head=document.querySelector('.floatinghead'),main=document.querySelector('.mainpane'),jumps=document.querySelector('.capability-jumps'),hint=document.querySelector('[data-background-hint]');
    var targets=[dock,head,jumps,hint].filter(Boolean);
    if(targets.length!==dockObserved.length||targets.some((el,i)=>el!==dockObserved[i])){
      dockObserver?.disconnect();dockObserved=targets;
      if(window.ResizeObserver){dockObserver=new ResizeObserver(frameLayout(measureDock));targets.forEach(el=>dockObserver.observe(el));}
    }
    // Read all geometry before writing any measured CSS variable.
    var pane=main?.getBoundingClientRect(),header=head?.getBoundingClientRect(),stripHeight=Math.ceil(jumps?.getBoundingClientRect().height||0),values={};
    if(pane)values['--shell-thread-top']=Math.max(0,Math.ceil((header?.bottom??pane.top+120)-pane.top+12))+'px';
    values['--shell-capability-strip-height']=stripHeight+'px';
    if(dock&&thread&&pane){
      var rect=dock.getBoundingClientRect(),height=Math.ceil(rect.height),dockTop=rect.top??innerHeight-height;
      var clearance=Math.max(height,Math.ceil(pane.bottom-dockTop)),input=dock.querySelector('.inputpill')?.getBoundingClientRect()||rect;
      var quick=dock.querySelector('.hub-quick'),quickRect=quick&&shellVisibleRect(quick),overflow=quick&&quick.scrollWidth-quick.clientWidth-quick.scrollLeft>1;
      var call=document.querySelector('.shell-floating-call'),petRect=dock.querySelector('.chief-pet-lane')?.getBoundingClientRect();
      var laneTop=Math.min(input.top,quickRect?.top??input.top),jumpBottom=Math.ceil(pane.bottom-laneTop+8),inputRight=Math.max(0,Math.ceil(pane.right-input.right));
      var hintBottom=height,hintHeight=hint?Math.ceil(hint.getBoundingClientRect().height):0;
      values['--r22-composer-height']=height+'px';
      values['--shell-jump-bottom']=jumpBottom+'px';values['--shell-jump-right']=call?'148px':'20px';
      values['--shell-input-right']=inputRight+'px';values['--call-right']=Math.max(16,Math.ceil(innerWidth-input.right)+56)+'px';
      values['--call-bottom']=(Math.max(height,Math.ceil(innerHeight-dockTop))+36)+'px';
      values['--toast-bottom']=Math.max(100,Math.ceil(innerHeight-dockTop)+12)+'px';
      values['--shell-thread-clearance']=Math.max(clearance,jumpBottom+52,hint?hintBottom+hintHeight+8:0)+'px';
      var changed=setMeasured(thread.style,'--dock-height',height+'px');
      if(quick){var flag=overflow?'true':'false';if(quick.dataset.overflowEnd!==flag)quick.dataset.overflowEnd=flag;syncQuickFadeListener(quick);}
    }else values['--call-bottom']='calc(96px + env(safe-area-inset-bottom))';
    Object.entries(values).forEach(([key,value])=>{if(setMeasured(root.style,key,value))changed=true;});
    if(changed)shellReading.invalidate();positionToast();
  }
  function button(icon,title,fn,cls){return h('button',{type:'button',class:cls||'setting-row',onClick:fn},[fromHTML(ico(icon)),h('span',{class:'grow'},title)]);}
  function apiOpenPanel(id,params){if(!registries.panels.has(id)&&!builtinPanels.includes(id))throw Error('Unknown panel: '+id);if(state.drawer&&state.drawer!==id)rememberPanel();state.panelParams=params||{};openPanel(id,null,false);emit('panel',{id:id,params:state.panelParams});}
  var builtinPanels=['session-menu','more','usage','context','model','permission','profile','sources','settings','tools','comfy','schedule','jobs','sessions','files','attachments','decisions'];
  function settingsGroup(id){var page=registries.settings.get(id);if(!page)return id;return {'连接':'services','偏好':'general','隐私与权限':'privacy'}[page.group]||'bot';}
  function settingsNavigationHTML(group){var pages=[...registries.settings.entries()].filter(([id])=>settingsGroup(id)===(group||settingsGroup(state.settingsTab))).sort((a,b)=>(a[1].order||0)-(b[1].order||0));return pages.length?'<div class="hub-setting-groups"><p class="setting-head">'+({services:'连接',general:'偏好',privacy:'隐私与权限',bot:'助理'}[group]||'扩展')+'</p>'+pages.map(([id,s])=>'<button class="setting-row" data-hub-setting="'+id+'">'+ico(s.icon)+'<span class="grow"><strong>'+esc(s.title)+'</strong></span>'+ico('chevron')+'</button>').join('')+'</div>':'';}
  function botTabsHTML(){if(!registries.botTabs.size)return '';return '<div class="hub-tabs"><button data-hub-bot-tab-button="" class="'+(!state.botTab?'on':'')+'">资料</button>'+[...registries.botTabs].map(([id,s])=>'<button data-hub-bot-tab-button="'+id+'" class="'+(state.botTab===id?'on':'')+'">'+esc(s.title)+'</button>').join('')+'</div>'+(state.botTab?'<div data-hub-bot-tab></div>':'');}
  function conversationsHTML(botId){var list=[...conversations.values()].filter(c=>c.extra&&(!state.panelSearch||!botBy(c.bot)?.steward)&&(!botId||c.bot===botId)&&(!state.panelSearch||(c.title+' '+c.messages.map(messageText).join(' ')).includes(state.panelSearch)));return list.length?'<div class="hub-conversations"><p class="setting-head">模块演示会话</p>'+list.map(c=>'<button class="setting-row" data-hub-conversation="'+esc(c.id)+'">'+avatar(c.bot)+'<span class="grow"><strong>'+esc(c.title)+'</strong><small>'+esc(botBy(c.bot).name)+'</small></span></button>').join('')+'</div>':'';}
  var panelViews={usage:'control',permission:'control',decisions:'control',schedule:'automation',jobs:'automation',files:'automation',tools:'tools',memory:'memory-center'};
  function panelViewLink(id){var view=panelViews[id];return registries.views.has(view)&&!registries.views.get(view).hidden?'<button class="setting-row hub-full-page" data-hub-view="'+view+'"><span class="grow">在完整页打开 '+ico('chevron')+'</span>'+esc(registries.views.get(view).title)+'</button>':'';}
  function openFeature(id){id=featureKey(id);var page=FEATURE_PAGES.find(p=>p.id===id);if(!page)return false;state.featureId=id;navigate({view:id==='board'?page.view:'feature'});return true;}
  function featureOwner(id){var list=state.bots.filter(b=>b.owns?.includes(featureKey(id)));return list.length===1?list[0]:null;}
  function fillDraft(botId,text){
    var id=assistantId(botId);if(!botBy(id))return false;
    navigate({view:'chat',conversation:id+'-013'});state.input=String(text||'');
    var input=document.querySelector('[data-focus="composer"]');if(input){input.value=state.input;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);}return true;
  }
  function featureConversation(id,phrase){var bot=featureOwner(id);if(!bot){toast('负责助理未指定或存在多位，请先核对名册');return false;}return fillDraft(bot.id,phrase||'');}
  function registerFeatureSection(id,spec){
    id=featureKey(id);if(!featureData.has(id))throw Error('Unknown feature: '+id);
    if(!spec||!['now','log','phrases'].includes(spec.kind)||typeof spec.render!=='function')throw Error('Feature section needs kind and render');validId(spec.id);
    var key=id+':'+spec.id,previous=featureSections.get(key);if(previous&&previous._owner!==owner)throw Error('Feature section belongs to another module');
    featureSections.set(key,{...spec,featureId:id,_owner:owner});refresh();return spec;
  }
  function featureRecord(id,record){var data=featureData.get(featureKey(id));if(!data)throw Error('Unknown feature: '+id);var entry=migrateRefs({...record});data.records.push(entry);return entry;}
  function featureRecords(id){return (featureData.get(featureKey(id))?.records||[]).slice();}
  function renderFeatureSections(container,id){
    id=featureKey(id);var page=FEATURE_PAGES.find(p=>p.id===id),bot=featureOwner(id),data=featureData.get(id),seed=FEATURE_SEEDS[id];
    var section=h('section',{class:'r25-feature-sections','data-feature-page':id});
    var specs=[...registries.capabilities.values()].filter(c=>c.featureId===id),ctx=context({featureId:id,ownerAssistant:bot,feature:page,records:featureRecords(id),memory:data.memory});
    [['now','current','现状'],['log','records','记录'],['phrases','phrases','常用话']].forEach(([kind,key,title])=>{
      var block=h('section',{class:'surface','data-feature-section':key},h('h2',{},title));
      var contributions=[...featureSections.values()].filter(s=>s.featureId===id&&s.kind===kind);
      if(contributions.length){contributions.forEach(spec=>{var target=h('div',{'data-feature-contribution':spec.id},spec.title?h('h3',{},spec.title):null);invoke(spec,'render',[target,ctx]);block.append(target);});}
      if(kind==='now'){
        block.append(h('p',{},seed.summary));specs.forEach(spec=>block.append(h('article',{class:'capability-card','data-feature-capability':spec.id},[
          h('h3',{},spec.title),h('p',{},spec.oneLine),h('div',{class:'capability-status'},(invoke(spec,'status',[],[])||[]).slice(0,3).map(v=>h('span',{class:'badge'},String(v.label)+' · '+String(v.value))))
        ])));
        data.memory.forEach(slice=>block.append(h('p',{'data-feature-memory':slice.id},slice.title+' · '+slice.source+' · '+slice.tokens+' token（资料，不自动挂载）')));
        if(id!=='board')block.append(h('button',{class:'ghostbtn','data-feature-detail':id,onClick:()=>page.panel?apiOpenPanel(page.panel):navigate({view:page.view})},'查看原有详情'));
      }else if(kind==='log'){
        data.records.forEach(r=>{var item=h('article',{class:'r25-feature-record'},[h('small',{},r.time||'原始演示记录'),r.question?h('p',{},'问：'+r.question):null]);
          if(r.message){r.message.parts.forEach(part=>item.append(part.type==='text'?h('p',{},part.md):fromHTML(slot('card',{...part,message:r.message}))));}else item.append(h('p',{},r.text||r.title||''));
          if(r.parts)r.parts.forEach(part=>item.append(fromHTML(slot('card',part))));block.append(item);
        });
        [...conversations.values()].filter(c=>c.featureId===id).forEach(c=>block.append(h('button',{class:'setting-row','data-hub-conversation':c.id},c.title+' · '+(bot?.name||'负责助理'))));
        state.activities.filter(a=>a.featureId===id&&!a.cleared).forEach(a=>block.append(h('p',{},(bot?.name||'负责助理')+' · '+a.title+' · '+a.detail)));
      }else if(!contributions.length){
        seed.phrases.forEach(phrase=>block.append(h('button',{class:'ghostbtn','data-feature-phrase':phrase,disabled:!bot,onClick:()=>featureConversation(id,phrase)},phrase)));
      }
      section.append(block);
    });
    section.append(h('button',{class:id==='board'?'ghostbtn':'primary','data-feature-chat':id,disabled:!bot,onClick:()=>featureConversation(id)},'去找 '+(bot?.name||'负责的助理')+'说'));container.append(section);
  }
  function featureView(container){var id=state.featureId||FEATURE_PAGES[0].id,page=FEATURE_PAGES.find(p=>p.id===id),root=h('section',{class:'content-scroll r25-feature','aria-label':page.title});renderFeatureSections(root,id);container.replaceChildren(root);}
  function fixedTasks(id){return state.fixedTasks.filter(t=>!id||t.ownerAssistantId===id);}
  function fixedTaskTitle(task){return (botBy(task.ownerAssistantId)?.name||'负责助理')+' · '+task.taskName;}
  function currentTask(){var taskId=conversations.get(state.conversation)?.taskId;return state.fixedTasks.find(t=>t.taskId===taskId)||null;}
  function assistantMessages(id){return conversations.get(id+'-013')?.messages||[];}
  function taskMessages(taskId){var t=state.fixedTasks.find(t=>t.taskId===taskId);return t?conversations.get(t.conversation)?.messages||[]:[];}
  function createFixedTask(ownerAssistantId,spec){
    if(!botBy(ownerAssistantId))throw Error('Unknown assistant');spec=spec||{};var taskName=String(spec.taskName||'').trim();
    if(!taskName||Array.from(taskName).length>8)throw Error('任务短名必填且不超过八字');
    var taskId=validId(spec.taskId||'fixed-task-'+(++sequence));if(state.fixedTasks.some(t=>t.taskId===taskId))throw Error('Duplicate fixed task');
    var task={taskId,ownerAssistantId,taskName,note:String(spec.note||'').trim(),conversation:taskId+'-013',status:'active',updatedAt:Date.now(),justCreated:true};
    registerConversation(ownerAssistantId,{id:task.conversation,title:fixedTaskTitle(task),messages:[{from:ownerAssistantId,ts:task.updatedAt,time:r25RecentLabel(task.updatedAt),parts:[{type:'text',md:'任务说明：'+(task.note||task.taskName)+'。仅本页演示，未执行或外发。'}]}]});
    conversations.get(task.conversation).taskId=taskId;state.fixedTasks.push(task);refresh();return task;
  }
  function setFixedTaskStatus(taskId,status){if(!['active','paused'].includes(status))throw Error('Unsupported task status');var task=state.fixedTasks.find(t=>t.taskId===taskId);if(!task)return false;task.status=status;refresh();return task;}
  function newFixedTaskSheet(id){if(!botBy(id))return false;Hub.sheet({title:'新建固定任务',body:c=>{
    var name=h('input',{'data-fixed-task-name':true,required:true,'aria-label':'任务短名',placeholder:'最多八字'}),note=h('textarea',{'data-fixed-task-note':true,'aria-label':'一句说明'}),error=h('p',{'data-fixed-task-error':true,role:'status'});
    c.append(h('label',{class:'field'},['任务短名（必填，≤8 字）',name]),h('label',{class:'field'},['一句说明',note]),error,h('button',{class:'primary','data-fixed-task-save':true,onClick:()=>{
      try{var task=createFixedTask(id,{taskName:name.value,note:note.value});navigate({view:'chat',conversation:task.conversation});}catch(e){error.textContent=e.message;}
    }},'创建固定任务'));
  }});return true;}
  function fixedTaskMenuHTML(id){var task=currentTask();return '<section class="r22-menu-section r25-fixed-tasks"><h3>固定任务</h3>'+fixedTasks(id).map(t=>'<button class="setting-row" data-fixed-task-open="'+esc(t.taskId)+'">'+avatar(t.ownerAssistantId)+'<span class="grow"><strong>'+esc(fixedTaskTitle(t))+'</strong><small>'+esc(t.note)+(t.status==='paused'?' · 已暂停':'')+'</small></span></button>').join('')+(task?.memoryConversation?'<button class="setting-row" data-fixed-task-memory="'+esc(task.taskId)+'" data-hub-conversation="'+esc(task.memoryConversation)+'">'+ico('memory')+'任务独立记忆</button>':'')+'<button class="setting-row" data-fixed-task-new="'+esc(id)+'">'+ico('plus')+'新建固定任务</button></section>';}
  document.addEventListener('click',e=>{var el=e.target.closest('[data-fixed-task-open],[data-fixed-task-new]');if(!el)return;if(el.dataset.fixedTaskOpen){var task=state.fixedTasks.find(t=>t.taskId===el.dataset.fixedTaskOpen);if(task)navigate({view:'chat',conversation:task.conversation});}else newFixedTaskSheet(el.dataset.fixedTaskNew);});
  register('views','feature',{title:'功能页',icon:'grid',render:featureView});
  register('panels','appearance',{title:'外观',icon:'grid',render:c=>{c.innerHTML=appearancePanel();}});
  function groupedMenuHTML(){return '<div class="hub-launcher" aria-label="功能页与形态">'+FEATURE_PAGES.map(page=>'<button class="launcher-tile" data-feature-open="'+page.id+'">'+r22App(page.source)+'<strong>'+esc(page.title)+'</strong></button>').join('')+'<button class="launcher-tile" data-hub-panel-open="appearance"><span class="r22-app" style="--a:var(--a-machine)">'+ico('grid')+'</span><strong>形态</strong></button></div>';}
  document.addEventListener('click',e=>{var el=e.target.closest('[data-feature-open],[data-hub-panel-open]');if(!el)return;if(el.dataset.featureOpen)openFeature(el.dataset.featureOpen);else openPanel(el.dataset.hubPanelOpen);});
  function registerCapability(spec){
    if(!spec||!botBy(assistantId(spec.steward)))throw Error('Unknown capability steward');
    if(!Array.isArray(spec.phrases)||spec.phrases.length!==3||spec.phrases.some(p=>typeof p!=='string'||!p.trim())||new Set(spec.phrases).size!==3)throw Error('Capability needs three distinct phrases');
    if(typeof spec.status!=='function'||typeof spec.reply!=='function'||!spec.title||!spec.oneLine)throw Error('Incomplete capability');
    register('capabilities',spec.id,Object.assign({},spec,{featureId:featureKey(spec.featureId||LEGACY_FEATURE_IDS[spec.steward]),steward:assistantId(spec.steward),phrases:spec.phrases.slice()}));
  }
  function capabilityElement(spec){
    var values=invoke(spec,'status',[],[]);if(!Array.isArray(values))values=[];
    return h('article',{class:'pop-card capability-card',style:botStyle(spec.steward),'data-capability':spec.id},[
      h('header',{class:'pop-card-head'},[fromHTML(ico(spec.icon)),h('div',{},[h('p',{class:'eyebrow capability-eyebrow'},spec.group||'日常'),h('h3',{},spec.title)])]),
      h('p',{},spec.oneLine),h('div',{class:'capability-status'},values.slice(0,3).map(v=>h('span',{class:'badge '+(['wait','bad','neutral'].includes(v.tone)?v.tone:'' )},[String(v.label)+' · ',h('strong',{},String(v.value))]))),
      h('div',{class:'capability-phrases'},spec.phrases.map(phrase=>h('button',{type:'button',class:'ghostbtn','data-capability-phrase':phrase,onClick:()=>runCapability(spec.id,phrase)},phrase)))
    ]);
  }
  function runCapability(id,phrase){
    var spec=registries.capabilities.get(id);if(!spec||!spec.phrases.includes(phrase))return false;
    var assistant=spec.featureId?featureOwner(spec.featureId):botBy(spec.steward);
    if(!assistant){toast('负责助理未指定或存在多位，请先核对名册');return false;}
    // 功能能力每次按 owns 取负责人，普通能力沿用登记的助理。
    navigate({view:'chat',conversation:assistant.id+'-013'});
    postMessage(state.conversation,{from:'user',time:'刚刚',parts:[{type:'text',md:phrase}]});
    var parts=invoke(spec,'reply',[phrase],[{type:'text',md:'这项能力暂时不可用，请稍后再试。'}]);
    postMessage(state.conversation,{from:assistant.id,time:'刚刚',parts:Array.isArray(parts)&&parts.length?parts:[{type:'text',md:'这项能力没有返回消息。'}]});
    return true;
  }
  function capabilitiesView(container){
    container.dataset.scroll='capabilities';
    container.innerHTML='<section class="content-scroll capability-directory">'+pageTitle('能力','说一句，交给负责助理')+'<nav class="capability-jumps" aria-label="按 bot 跳转"></nav><p class="mini-note">本页为离线演示，所有操作只留在当前页。</p><div data-capability-groups></div></section>';
    var host=container.querySelector('[data-capability-groups]'),jumps=container.querySelector('.capability-jumps');
    var order=state.bots.map(b=>b.id);
    var bots=[...state.bots].sort((a,b)=>{var ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?order.length:ai)-(bi<0?order.length:bi);});
    bots.forEach(bot=>{var list=[...registries.capabilities.values()].filter(c=>c.steward===bot.id);if(!list.length)return;
      var target='capability-group-'+bot.id;
      var group=h('section',{id:target,class:'capability-group',style:botStyle(bot.id),'data-capability-steward':bot.id},[
        h('h2',{},[fromHTML(avatar(bot.id)),bot.name,h('span',{class:'badge'},list.length+' 张')]),
        h('div',{class:'capability-wall'},list.map(capabilityElement))
      ]);
      jumps.append(h('button',{type:'button',class:'ghostbtn',style:botStyle(bot.id),'data-capability-jump':bot.id,'aria-controls':target,onClick:()=>{
        var scroller=container,rect=scroller.getBoundingClientRect(),head=document.querySelector('.floatinghead');
        measureDock();
        var margin=window.getComputedStyle?parseFloat(getComputedStyle(group).scrollMarginTop):0;
        var clearance=margin>0?margin:(head?Math.max(16,head.getBoundingClientRect().bottom-rect.top+16):16);
        var top=group.getBoundingClientRect().top-rect.top+scroller.scrollTop-clearance;
        scroller.scrollTo({top:Math.max(0,top),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      }},[fromHTML(avatar(bot.id)),h('span',{},bot.name),h('span',{class:'badge'},list.length+' 张')]));
      host.append(group);
    });
  }
  function botCapabilitiesHTML(botId){return '<section class="bot-capabilities"><h3>负责的能力</h3>'+[...registries.capabilities.values()].filter(c=>c.steward===botId).map(c=>'<button class="setting-row" data-hub-capability="'+esc(c.id)+'">'+ico(c.icon)+'<span class="grow"><strong>'+esc(c.title)+'</strong><small>'+esc(c.oneLine)+'</small></span>'+ico('chevron')+'</button>').join('')+'</section>';}
  function extraViewsHTML(){return groupedMenuHTML();}
  function composerToolsHTML(){return registries.tools.size?'<div class="menu-grid">'+[...registries.tools].map(([id,t])=>'<button data-hub-tool="'+id+'">'+ico(t.icon)+'<strong>'+esc(t.label)+'</strong></button>').join('')+'</div>':'';}
  function runCommand(name,args){var c=registries.commands.get(name);if(!c)return false;state.input='';invoke(c,'run',[args,context()]);if(ready)render();return true;}
  document.addEventListener('click',function(e){var el=e.target.closest('[data-hub-view],[data-hub-setting],[data-hub-bot-tab-button],[data-hub-tool],[data-hub-command],[data-hub-conversation],[data-hub-capability]');if(!el)return;var d=el.dataset;if(d.hubCapability){var spec=registries.capabilities.get(d.hubCapability);if(spec)Hub.sheet({title:spec.title,body:capabilityElement(spec)});}if(d.hubView)navigate({view:d.hubView});if(d.hubSetting){state.settingsTab=d.hubSetting;openPanel('settings');}if('hubBotTabButton'in d){state.botTab=d.hubBotTabButton;openPanel('profile');}if(d.hubTool){var t=registries.tools.get(d.hubTool);invoke(t,'run',[context()]);}if(d.hubCommand){state.input='/'+d.hubCommand+' ';state.refocus=true;render();}if(d.hubConversation)navigate({view:'chat',conversation:d.hubConversation});});
  // Keep core commands available through the same extension registry.
  var oldPaintAtMenu=paintAtMenu;paintAtMenu=function(){oldPaintAtMenu();var el=document.querySelector('.atmenu'),m=state.input.match(/^\/([\w-]*)$/);if(!el||!m)return;el.innerHTML=[...registries.commands].filter(([n])=>n.startsWith(m[1])).map(([n,c])=>'<button data-hub-command="'+n+'">/'+n+' <em>'+esc(c.hint)+'</em></button>').join('');el.hidden=!el.children.length;};
  var originalSend=send;send=function(){var m=state.input.trim().match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/);if(m&&runCommand(m[1],m[2]||''))return;originalSend();};
  // Preserve routing through existing click handlers and new-session workflows.
  var originalSelectBot=selectBot;selectBot=function(id){var task=state.fixedTasks.find(t=>t.taskId===id);if(task){navigate({view:'chat',conversation:task.conversation});return;}id=assistantId(id);if(conversations.get(activeByBot[id])?.taskId){navigate({view:'chat',conversation:id+'-013'});return;}shellReading.save();if(render.chatRoute===activeByBot[id])shellReading.enter(activeByBot[id],{mode:'bottom'});state.conversation=activeByBot[id];originalSelectBot(id);emit('navigate',context());};
  function quoteMessageById(id){
    var index=currentMessages().findIndex(m=>m.id===id);
    var msg=currentMessages()[index]||window.R43Thread?.findMessage(id);
    var action=msg&&messageActions(msg).find(a=>a.key==='quote');
    if(action)return invoke(action.spec,'run',[msg,context({index})]);
  }
  function messageMenu(target,suppliedMessage,suppliedIndex){
    var article=target.closest('[data-message-id]');if(!article)return;
    if(window.R43Delete?.claimTarget?.(article))return;
    var index=suppliedMessage?suppliedIndex:currentMessages().findIndex(m=>m.id===article.dataset.messageId);
    var msg=suppliedMessage||currentMessages()[index]||window.R43Thread?.findMessage(article.dataset.messageId);
    if(!msg)return;var body=h('div',{class:'stack'});messageActions(msg).forEach(({spec:a})=>body.append(button(a.icon,a.label,()=>{closePanel();invoke(a,'run',[msg,context({index:index})]);},'ghostbtn')));body.append(button('file','选择文字',()=>{closePanel();setTimeout(()=>{var live=[...document.querySelectorAll('[data-message-id]')].find(el=>el.dataset.messageId===msg.id),target=live?.querySelector('.bubble')||live;if(!target)return;target.classList.add('r22-native-selection');var selection=window.getSelection?.();if(selection&&document.createRange){var range=document.createRange();range.selectNodeContents(target);selection.removeAllRanges();selection.addRange(range);}},260);},'ghostbtn'));if(body.children.length)Hub.sheet({title:'消息操作',body:body});}
  document.addEventListener('click',e=>{var article=e.target.closest('[data-message-id]');if(article&&!e.target.closest('button,input,textarea,a,summary'))article.classList.toggle('hub-actions-revealed');});
  var hold=null;
  function cancelHold(){if(hold){clearTimeout(hold.timer);hold.article?.classList.remove('r22-message-holding');hold=null;}}
  document.addEventListener('pointerdown',e=>{
    if(e.isPrimary===false){cancelHold();return;}
    var article=e.target.closest('[data-message-id]');
    if(e.pointerType!=='touch'||!article||state.drawer||e.clientY>=innerHeight-20||e.target.closest('button,input,textarea,a,summary,select,.r22-native-selection'))return;
    if(window.R43Delete?.claimTarget?.(article))return;
    cancelHold();article.classList.add('r22-message-holding');
    hold={article,x:e.clientX,y:e.clientY,timer:setTimeout(()=>{article.classList.remove('r22-message-holding');article.classList.add('m-interact-revealed');hold=null;messageMenu(article);suppressClick=true;setTimeout(()=>suppressClick=false,500);},450)};
  });
  document.addEventListener('pointermove',e=>{if(hold&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>8)cancelHold();});
  document.addEventListener('pointerup',cancelHold);document.addEventListener('pointercancel',cancelHold);
  document.addEventListener('contextmenu',e=>{if(window.R43Delete?.claimTarget?.(e.target))return;if(e.target.closest('.r22-native-selection,button,a,input,textarea,summary'))return;if(e.target.closest('[data-message-id]')){cancelHold();e.preventDefault();messageMenu(e.target);}});
  async function loadModules(){var seen=new Set();for(var name of window.HUB_MODULES||[]){if(seen.has(name))continue;seen.add(name);if(!/^[_a-zA-Z][\w-]*$/.test(name)){warn(String(name),'非法模块名');continue;}await new Promise(resolve=>{var script=document.createElement('script'),failed=false;script.defer=true;script.async=false;script.src='modules/'+name+'.js';owner=name;function error(e){if(e.filename===script.src){failed=true;e.preventDefault();warn(name,e.error||e.message);}}window.addEventListener('error',error);function finish(){window.removeEventListener('error',error);owner='core';resolve();}script.onerror=function(e){e.preventDefault();warn(name,'模块文件未加载');finish();};script.onload=function(){if(failed)script.dataset.failed='true';finish();};document.head.append(script);});}}
  function installModule(name,fn){owner=name;safe(name,fn);owner='core';}
  var callTimer=0;
  function armCall(){
    if(document.hidden){
      if(callTimer){clearInterval(callTimer);callTimer=0;}
      return;
    }
    if(callTimer) return;
    callTimer=setInterval(function(){
      if(document.hidden){clearInterval(callTimer);callTimer=0;return;}
      var timer=document.querySelector('[data-call-timer]');
      if(timer) timer.textContent=callElapsed();
    },1000);
  }
  document.addEventListener('visibilitychange',armCall);
  function start(){if(ready)return;ready=true;armCall();try{state.theme=localStorage.getItem('hub-demo-theme')||'system';state.skin=localStorage.getItem('hub-demo-skin')||'island';}catch(e){}applyTheme();r22Continuity.boot();render();syncViewport();emit('ready',context());on('reading:change',compactChatRows);chiefPet.start();}
  PENDING_INPUT_SRC.forEach(registerPendingInput);
  state.decisions.forEach(d=>registerActivity({id:'activity-'+d.id,kind:'decide',bot:d.bot,title:d.title,detail:'演示：'+d.summary,time:'今天',decision:d.id}));
  registerActivity({id:'demo-activity-notice',kind:'inform',bot:'board-steward',title:'演示：本周看板回顾已整理',detail:'卡住的项目先等你确认下一步。',time:'刚刚'});
  registerActivity({id:'demo-activity-done',kind:'inform',bot:'schedule-steward',title:'演示：例行安排已查看',detail:'仅本页记录，未注册真实定时任务。',time:'昨天',handled:true,read:true});
  return {conversationOwner:id=>conversations.get(id)?.bot,updateAssistantIdentity,registerFeatureSection,renderFeatureSections,featureRecords,featureRecord,featureMemory:id=>featureData.get(featureKey(id))?.memory||[],fillDraft,fixedTasks,fixedTaskTitle,currentTask,taskMessages,assistantMessages,createFixedTask,setFixedTaskStatus,newFixedTaskSheet,fixedTaskMenuHTML,
    copyText:copyText,canSend:r25CanSend,clearComposer:r25ClearComposer,openFeature:openFeature,featureOwner:featureOwner,returnToBoard:returnToBoard,startTour:startTour,stopTour:stopTour,levelSticker:levelSticker,registerMemoryMounts:registerMemoryMounts,memoryMounts:memoryMounts,unmountMemory:unmountMemory,contextSnapshot:contextSnapshot,updateContext:updateContext,outfits:outfits,setOutfit:setOutfit,currentOutfit:currentOutfit,state:state,supersedeDecision:supersedeDecision,registerPendingInput:registerPendingInput,resolvePendingInput:resolvePendingInput,pendingInputs:pendingInputs,openPendingInput:openPendingInput,registerBotTemplate:registerBotTemplate,createBot:createBot,subBots:subBots,setBotStatus:setBotStatus,registerMoreItem:registerMoreItem,setDemoContent:setDemoContent,removeBot:removeBot,registerActivity:registerActivity,activities:activities,markActivitiesRead:markActivitiesRead,completeActivity:completeActivity,clearActivities:clearActivities,restoreActivities:restoreActivities,activityUnread:activityUnread,callState:state.callState,showFloatingCall:showFloatingCall,hideFloatingCall:hideFloatingCall,floatingCallHTML:floatingCallHTML,setMessageStatus:setMessageStatus,pageTitle:(title,eyebrow)=>fromHTML(pageTitle(title,eyebrow)),registerCapability:registerCapability,runCapability:runCapability,capabilitiesView:capabilitiesView,botCapabilitiesHTML:botCapabilitiesHTML,quickReplies:bot=>bot.quickReplies||[],avatar:id=>fromHTML(avatar(id)),botStyle:botStyle,h:h,icon:(name,options)=>fromHTML(ico(name,options)),toast:toast,sheet:spec=>{customPanel(spec.title,'<div data-hub-sheet></div>',spec.body);},
    petInfo:()=>chiefPet.info(),petPreview:(name,options)=>chiefPet.preview(name,options),petState:()=>chiefPet.state(),petDebug:options=>chiefPet.debug(options),petTurn:(id,name)=>chiefPet.turn(id,name),
    updateChiefFace:updateChiefFace,
    reading:Object.freeze(Object.fromEntries(['preserve','locate','release','toBottom','state','sent','enter'].map(k=>[k,shellReading[k]]))),navigate:navigate,on:on,emit:emit,postMessage:postMessage,addStyle:css=>{if(owner==='core')throw Error('addStyle must run during module registration');if(/@import|url\s*\(/i.test(css))throw Error('External styles are forbidden');var names=[...css.matchAll(/\.([_a-zA-Z][\w-]*)/g)].map(m=>m[1]);if(!names.length||names.some(n=>!n.startsWith('m-'+owner+'-')))throw Error('Style classes must start with m-'+owner+'-');document.head.append(h('style',{},css));},
    registerCard:(id,s)=>register('cards',id,s),registerMessageAction:s=>register('actions',s.id,s),registerConversation:registerConversation,registerPanel:(id,s)=>register('panels',id,s),openPanel:apiOpenPanel,registerSettingsPage:(id,s)=>register('settings',id,s),registerView:(id,s)=>register('views',id,Object.assign({hidden:['memory-center','tools','automation','control','persona-today'].includes(id)},s)),registerBotTab:(id,s)=>register('botTabs',id,s),registerComposerTool:s=>register('tools',s.id,s),registerSlashCommand:s=>register('commands',s.name,s),registerStatusChip:s=>register('chips',s.id,s),registerBoardCardBadge:fn=>badges.push({fn:fn,owner:owner}),registerTaskSection:(id,s)=>register('sections',id,s),
    currentMessages:currentMessages,context:context,messageHTML:messageHTML,messageText:messageText,messageMenu:messageMenu,quoteMessage:quoteMessageById,cardSlot:c=>slot('card',{type:c.type,data:c}),taskSectionsSlot:t=>slot('sections',t),boardBadgesSlot:c=>slot('badges',c),mount:mount,measureDock:measureDock,fromHTML:fromHTML,
    hasExtraViews:()=>[...registries.views.keys()].some(id=>!mainViews.includes(id)),viewTitle:id=>registries.views.get(id)?.title||'工作台',hasPanel:id=>registries.panels.has(id),panelTitle:id=>registries.panels.get(id)?.title||'工作台',hasSettingsPage:id=>registries.settings.has(id),settingsNavigationHTML:settingsNavigationHTML,settingsGroup:settingsGroup,groupedMenuHTML:groupedMenuHTML,panelViewLink:panelViewLink,botTabsHTML:botTabsHTML,conversationsHTML:conversationsHTML,extraViewsHTML:extraViewsHTML,composerToolsHTML:composerToolsHTML,loadModules:loadModules,installModule:installModule,start:start,warn:warn};
})();
function cardBlock(card){return card?Hub.cardSlot(card):'';}
['handoff','draft','approve','file'].forEach(function(type){Hub.registerCard(type,{title:{handoff:'转派',draft:'草稿',approve:'审批',file:'交付物'}[type],render:function(data){var el=Hub.fromHTML(builtinCardHTML(Object.assign({},data,{type:type})));var d=decBy(data.id);if(d&&['draft','approve','handoff'].includes(type))(el.querySelector('h3')||el).prepend(Hub.levelSticker(d.level||'L1',{action:d.action||d.title,scope:'同类动作',bot:d.bot}));return el;},quoteLabel:function(data){return type==='file'?FILES[data.file]?.name||'交付物':decBy(data.id)?.title||'卡片';}});});
[['copy','copy','复制消息','copy-message'],['tts','play','朗读回复','tts'],['retry','retry','重新生成','retry-message'],['branch','branch','从此处分叉','branch-message'],['quote','quote','引用此消息','quote-message']].forEach(function(a){Hub.registerMessageAction({id:a[0],icon:a[1],label:a[2],when:m=>m.role!=='user',run:function(m,ctx){if(a[0]==='copy'){copyText(Hub.messageText(m));return;}if(a[0]==='quote'){state.input='引用 #'+state.conversation+'：「'+Hub.messageText(m).slice(0,80)+'」\n';state.refocus=true;render();return;}var el=document.createElement('button');el.dataset.act=a[3];el.dataset.index=ctx.index;el.hidden=true;document.body.append(el);el.click();el.remove();}});});
Hub.registerSlashCommand({name:'context',hint:'查看上下文',run:()=>openPanel('context')});
Hub.registerSlashCommand({name:'plan',hint:'切换计划模式',run:()=>{state.plan=!state.plan;openPanel('permission');}});
Hub.registerSlashCommand({name:'side',hint:'侧边问话',run:args=>{state.input='';customPanel('侧边一句','<p class="muted">主任务继续，这里只接一段旁问。</p><label class="field">你的问题<textarea id="side-question">'+esc(args)+'</textarea></label><button class="primary" style="margin-top:16px" data-act="side-answer">发送侧边问话</button>');}});
