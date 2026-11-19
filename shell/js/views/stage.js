/* R8 stage: original SVG outfits, no model engine, audio, timer service or live room. */
var stageActors={},stageEpoch=0,stageWaits=[];
function stageLater(ms, fn){
  var id=setTimeout(function(){
    stageWaits=stageWaits.filter(function(item){return item!==id;});
    if(document.hidden) return;
    fn();
  }, ms);
  stageWaits.push(id);
}
function stageStopWaits(){
  stageWaits.forEach(function(id){clearTimeout(id);});
  stageWaits=[];
}
document.addEventListener('visibilitychange', function(){
  if(!document.hidden) return;
  stageStopWaits();
  if(typeof state==='undefined'||typeof stageActor!=='function') return;
  var actor=stageActor(state.bot);
  if(actor&&actor.status==='speaking'){
    clearStageAudio(state.bot);
    if(state.mode==='stage'&&typeof render==='function') render();
  }
});
function stageActor(botId){
  if(!stageActors[botId])stageActors[botId]={botId:botId,renderer:demoText("views.stage.renderer.1"),modelAssetId:null,mouthMap:{volume:'placeholder',phoneme:'unavailable'},emotionMap:{开心:'smile',思考:'think',抱歉:'sorry',惊讶:'surprise',挥手:'wave'},conversationId:botId+'-013',audioEpoch:0,status:'unconfigured',mouth:'volume',emotion:'开心',subtitle:'',dirty:false,selectedOutfit:null,rhythm:'quiet',live:'off',liveNote:''};
  return stageActors[botId];
}
function clearStageAudio(botId){var actor=stageActor(botId);actor.audioEpoch=++stageEpoch;actor.status='stopped';actor.subtitle='';state.playing=null;}
function stagePetSlot(id){
  return '<div class="r29-pet-slot" data-r29-pet-slot="'+esc(id)+'"></div>';
}
function stageIsReal(){
  try { return typeof r29Real==='function' && r29Real(); }
  catch (err) { return false; }
}
function stageRealView(id){
  return '<section class="stageview r29-stage-real" data-scroll="stage" data-r29-stage-real="1">'
    +pageTitle('舞台','')
    +'<div class="stage-grid"><div class="stage-main">'+stagePetSlot(id)
    +'<div class="actions"><button type="button" class="ghostbtn" data-r29-change-look>'
    +'换形象</button></div></div></div></section>';
}
function stageView(){
  var b=botBy(state.bot);
  if(stageIsReal()) return stageRealView(b.id);
  var a=stageActor(b.id),current=Hub.currentOutfit(b.id),outfits=Hub.outfits(b.id);
  var selected=outfits.find(o=>o.id===a.selectedOutfit)||current||outfits[0],emotion=EMOTIONS.includes(state.emotion)?state.emotion:'开心';a.emotion=emotion;
  var subtitle=a.subtitle||(LINES[b.id]?.[emotion]||'本页演示：先整理草稿，再请你确认。');
  var actor=avatar(b.id).replace('<path d="M56 69q4 4 8 0"','<path class="stage-mouth" d="M56 69q4 4 8 0"');
  if(emotion==='惊讶')actor=actor.replace(/<path class="stage-mouth" d="M56 69q4 4 8 0"[^>]*\/>/,'<ellipse class="stage-mouth" cx="60" cy="70" rx="4" ry="6" fill="#423145"/>');
  if(emotion==='思考'||emotion==='抱歉')actor=actor.replace('M56 69q4 4 8 0',emotion==='思考'?'M56 70h8':'M56 72q4-4 8 0');
  return '<section class="stageview" data-scroll="stage">'+pageTitle('舞台','本页演示 · 原创占位')+
    '<nav class="stage-bots" aria-label="六助理形象">'+state.bots.filter(b=>b.enabled!==false).map(b=>b.id).map(id=>'<button data-stage-bot="'+id+'" aria-pressed="'+(id===b.id)+'" style="'+botStyle(id)+'">'+avatar(id)+'<span>'+esc(botBy(id).name)+'</span></button>').join('')+'</nav>'+
    '<div class="stage-grid"><div class="stage-main">'+stagePetSlot(b.id)+'<div class="sys" aria-label="形象系统">'+demoFixture("views.stage.sample.2").map(id=>'<button data-stage-renderer="'+id+'" aria-pressed="'+(id===a.renderer)+'" class="'+(id===a.renderer?'on':'')+'">'+(id===demoText("views.stage.sample.3")?demoText("views.stage.sample.4"):demoText("views.stage.sample.5"))+'</button>').join('')+'</div>'+
    '<div class="stage-outfits" aria-label="装扮">'+outfits.map(o=>'<button data-outfit="'+esc(o.id)+'" aria-pressed="'+(o.id===b.outfitId)+'" data-outfit-selected="'+(o.id===selected?.id)+'" class="ghostbtn">'+esc(o.name)+'</button>').join('')+'</div>'+
    '<p class="mini-note" data-outfit-status>正在穿：'+esc(current?.name||'默认占位')+' · '+esc(demoFixture("views.stage.sample.6")[current?.kind]||'SVG')+' · 许可：'+esc(current?.license||'未写许可')+(selected&&selected.id!==current?.id?' · 待换：'+esc(selected.name)+' · '+esc(selected.license||'未写许可'):'')+'</p>'+
    '<div class="actions"><button class="ghostbtn" data-outfit-wear '+(!selected?.license?.trim()?'disabled':'')+'>换上</button><button class="ghostbtn" data-outfit-star aria-pressed="'+!!selected?.starred+'">'+(selected?.starred?'已收藏':'收藏')+'</button>'+(a.dirty?'<button class="ghostbtn" data-outfit-save '+(!current?.license?.trim()?'disabled':'')+'>存回这套</button>':'')+'</div>'+
    '<div class="stage-frame"><span class="stage-status" data-stage-status="'+a.status+'">'+esc(b.name)+' · '+esc({unconfigured:'未配置',loading:'加载中',ready:'就绪',listening:'聆听中',thinking:'思考中',speaking:'播放测试中',stopped:'已停止',error:'异常'}[a.status])+' · 未加载引擎</span>'+
    '<div class="mascot-wrap stage-original" data-stage-actor="'+b.id+'" data-emotion="'+emotion+'" data-speaking="'+(a.status==='speaking')+'" style="--actor-x:'+state.actorX+'px;--actor-y:'+state.actorY+'px;--actor-zoom:'+state.zoom+'">'+actor+'</div><div class="stagecontrols"><button data-act="zoom-out" aria-label="缩小形象">−</button><button data-act="reset-actor" aria-label="形象复位">⌖</button><button data-act="zoom-in" aria-label="放大形象">+</button></div></div>'+
    '<div class="subtitle"><div class="who">'+esc(b.name)+' · '+emotion+'</div><p data-stage-subtitle>'+esc(subtitle)+demoText("views.stage.sample.7")+
    '<aside class="stageaside"><div><h3>表情</h3><div class="emotions">'+EMOTIONS.map(e=>'<button data-act="emotion" data-emo="'+e+'" aria-pressed="'+(e===emotion)+'" class="'+(e===emotion?'on':'')+'">'+e+'</button>').join('')+'</div><div class="actions"><button class="ghostbtn" data-stage-action="preview">预览表情</button><button class="ghostbtn" data-stage-action="play">播放测试（演示）</button><button class="ghostbtn" data-stage-action="reset">恢复默认</button></div></div>'+
    '<div><h3>口型</h3><div class="segmented"><button data-stage-mouth="phoneme" aria-pressed="'+(a.mouth==='phoneme')+'">音素</button><button data-stage-mouth="volume" aria-pressed="'+(a.mouth==='volume')+'">音量</button></div><p class="mini-note">'+(a.mouth==='phoneme'?'音素映射未接入，回落音量驱动占位。':'音量驱动占位，非音素级。')+'</p><h3>陪伴节律</h3><div class="segmented">'+[['quiet','不打扰'],['day','白天'],['live','直播']].map(([id,label])=>'<button data-rhythm="'+id+'" aria-pressed="'+(a.rhythm===id)+'" class="'+(a.rhythm===id?'on':'')+'">'+label+'</button>').join('')+'</div><p class="sticker">'+({quiet:'不主动开口',day:'到点看一眼',live:'只看合批状态'}[a.rhythm])+'</p><p class="mini-note">没有定时器，没有连直播。</p></div></aside></div>'+
    '<div class="livecard" data-live-state="'+a.live+'">'+ico('stage')+demoText("views.stage.sample.8")+({off:'未连接',batch:'弹幕在合批',called:'有人点名'}[a.live])+' · '+esc(a.liveNote||'直播源未连接，仅本页演示')+'</p></div><div class="actions"><button class="ghostbtn" data-live-action="peek">看一眼摘要</button><button class="ghostbtn" data-live-action="hold">先别插话</button></div></div></section>';
}
Hub.registerView('stage',{title:'舞台',icon:'stage',render:function(container){
  container.innerHTML=stageView();
  var slot=container.querySelector('[data-r29-pet-slot]');
  if(slot&&window.HubPetStage&&HubPetStage.mount)HubPetStage.mount(slot,state.bot);
}});
function stageEmotion(emotion){
  if(!EMOTIONS.includes(emotion))return;
  var id=state.bot,a=stageActor(id);state.emotion=emotion;a.dirty=true;render();
  if(emotion==='挥手'){var epoch=a.audioEpoch;stageLater(900,function(){
  if(document.hidden)return;
  if(state.bot===id&&state.emotion==='挥手'&&a.audioEpoch===epoch){state.emotion='开心';render();}
});}
}
document.addEventListener('click',e=>{
  var el=e.target.closest('[data-stage-bot],[data-stage-renderer],[data-stage-mouth],[data-stage-action],[data-outfit],[data-outfit-wear],[data-outfit-star],[data-outfit-save],[data-rhythm],[data-live-action]');if(!el)return;
  var d=el.dataset,a=stageActor(state.bot);
  if(d.stageBot){clearStageAudio(state.bot);state.emotion='开心';Hub.navigate({view:'stage',conversation:d.stageBot+'-013'});return;}
  if(d.stageRenderer){clearStageAudio(state.bot);a.renderer=d.stageRenderer;a.status='unconfigured';}
  if(d.stageMouth)a.mouth=d.stageMouth;
  if(d.outfit)a.selectedOutfit=d.outfit;
  if('outfitWear'in d){if(el.disabled)return;Hub.setOutfit(state.bot,a.selectedOutfit||Hub.currentOutfit(state.bot)?.id);return;}
  if('outfitStar'in d){var candidate=botBy(state.bot).outfits?.find(o=>o.id===(a.selectedOutfit||Hub.currentOutfit(state.bot)?.id));if(candidate)candidate.starred=!candidate.starred;}
  if('outfitSave'in d){var current=botBy(state.bot).outfits?.find(o=>o.id===botBy(state.bot).outfitId);if(current?.license?.trim()){current.emotion=a.emotion;a.dirty=false;Hub.toast('表情已存回当前装扮 · 本页演示');}}
  if(d.stageAction==='preview'){stageEmotion(EMOTIONS[(EMOTIONS.indexOf(state.emotion)+1)%EMOTIONS.length]);return;}
  if(d.stageAction==='play'){
    var id=state.bot;clearStageAudio(id);var epoch=a.audioEpoch;a.status='speaking';a.subtitle='本页演示：这是一句口型和字幕测试。';
    stageLater(1600,function(){
    if(document.hidden)return;
    if(state.bot===id&&a.audioEpoch===epoch){clearStageAudio(id);if(state.mode==='stage')render();}
  });
  }
  if(d.stageAction==='reset'){clearStageAudio(state.bot);a.status='unconfigured';a.renderer=demoText("views.stage.sample.9");a.mouth='volume';a.dirty=false;state.emotion='开心';state.actorX=0;state.actorY=0;state.zoom=1;}
  if(d.rhythm){a.rhythm=d.rhythm;if(d.rhythm==='day')Hub.postMessage(state.conversation,{from:state.bot,time:'刚刚',parts:[{type:'text',md:'本页演示：看了一眼，选择不说话。没有定时器，没有连直播。'}]},{quiet:true});if(d.rhythm==='live')a.liveNote='节律为直播 · 仍未连接';}
  if(d.liveAction==='peek'){a.live='batch';a.liveNote='演示弹幕 3 条，未发送';}
  if(d.liveAction==='hold'){a.live='off';a.liveNote='先别插话 · 未发送';}
  render();
});
document.addEventListener('click',function(ev){
  var btn=ev.target&&ev.target.closest&&ev.target.closest('[data-r29-change-look]');
  if(!btn) return;
  var api=window.AssistantProfiles;
  if(!api||typeof api.openLibrary!=='function'){
    if(window.Hub&&Hub.toast) Hub.toast('暂无');
    return;
  }
  api.openLibrary(state.bot);
});
Hub.on('navigate',()=>{Object.keys(stageActors).forEach(id=>{if(id!==state.bot)clearStageAudio(id);});});
Hub.on('outfit',e=>{clearStageAudio(e.bot);var a=stageActor(e.bot),outfit=Hub.currentOutfit(e.bot);a.selectedOutfit=outfit?.id;if(e.bot===state.bot){state.emotion=EMOTIONS.includes(outfit?.emotion)?outfit.emotion:'开心';a.dirty=false;render();}});
