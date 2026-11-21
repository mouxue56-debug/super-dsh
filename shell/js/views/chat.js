function r43MessagesHTML(){
  var rows=Hub.currentMessages();
  return window.R43Thread?R43Thread.renderHTML(rows,msgHTML):rows.map(msgHTML).join('');
}
function msgHTML(m,i){return Hub.messageHTML(m,i);}
function chatToolHTML(){return Hub.currentTask()?'</div></div><div class="chat-tail" aria-label="消息区辅助位"></div>':'<details class="r22-tool-call"><summary>'+ico('file')+'<span>查了知识库</span><small>2 条引用</small>'+ico('chevron')+demoText("views.chat.sample.4");}
function chatView(){var r29GroupHtml='<section class="chatview" data-conversation="'+esc(state.conversation)+'"><div class="thread"><div class="thread-inner"><p class="time-stamp" data-demo-content="date">今天，11 月 13 日 <span>·</span> '+projBy(state.project).name+(state.bot===demoText("views.chat.sample.2")?demoText("views.chat.sample.3"):'')+'</p>'+r29EmptyTalk()+r43MessagesHTML()+(state.running?'<article class="surface" data-reply-wait><div class="row">'+(state.bot==='chief'?avatar('chief'):'')+'<span class="wave" style="color:var(--sage)"><i></i><i></i><i></i><i></i></span><span class="grow muted">正在输入 · '+state.model+'</span><button class="textbutton" data-act="stop">停止</button></div></article>':'')+chatToolHTML()+composer()+'</section>';return typeof r29GroupThread==='function'?r29GroupThread(r29GroupHtml):r29GroupHtml;}

var r29OpeningFallback='把现在最想办成的一件事说给我';
var r29OpeningDefaults={
  fallback:r29OpeningFallback,
  rows:[
    {when:'配色|版式|图形|画面|出图',text:'把想看到的画面说给我，我帮你收成一版'},
    {when:'调研|来源|竞品|公开资料',text:'把想弄清的问题说给我，我按能对上的来源整理'},
    {when:'草稿|来信|回复',text:'把要写的话交给我，我帮你理成一段'},
    {when:'验收|任务书|回执|交付|设备',text:'把要做到哪一步说给我，我帮你对一下'},
    {when:'待办|协调|转派|接话|梳理|先后|排期|流水|核对',text:'把手头几件事说给我，我帮你排先后'}
  ]
};
if(!window.HubOpeningLines) window.HubOpeningLines=r29OpeningDefaults;
function r29OpeningTable(){
  var given=window.HubOpeningLines;
  if(given&&Array.isArray(given.rows)) return given;
  return r29OpeningDefaults;
}
function r29OpeningPattern(when){
  if(when instanceof RegExp) return when;
  var source=String(when||'');
  if(!source) return null;
  try{return new RegExp(source);}catch(err){return null;}
}
function r29OpeningLine(duty){
  var table=r29OpeningTable();
  var text=String(duty||'');
  var rows=table.rows||[];
  var i;
  for(i=0;i<rows.length;i++){
    var row=rows[i];
    if(!row||typeof row.text!=='string'||!String(row.text).trim()) continue;
    var pattern=r29OpeningPattern(row.when);
    if(pattern&&pattern.test(text)) return String(row.text).trim();
  }
  var fallback=typeof table.fallback==='string'?table.fallback.trim():'';
  return fallback||r29OpeningFallback;
}
function r29OpeningStyle(){
  return 'display:block;width:100%;max-width:100%;box-sizing:border-box;margin:12px auto 0;'
    +'padding:12px;border:0;border-radius:16px;background:var(--well);color:var(--ink);'
    +'font:inherit;line-height:1.5;text-align:center;white-space:normal;overflow-wrap:anywhere;'
    +'min-height:44px;cursor:pointer';
}
function r29PlaceOpening(line){
  var text=String(line||'').trim();
  if(!text) return;
  state.input=text;
  var box=document.querySelector('[data-focus="composer"]');
  if(!box) return;
  box.value=text;
  try{box.dispatchEvent(new Event('input',{bubbles:true}));}catch(err){}
  try{box.focus({preventScroll:true});}catch(err2){}
  try{box.setSelectionRange(text.length,text.length);}catch(err3){}
  if(typeof r29SyncButton==='function') r29SyncButton();
}
function r29EmptyTalk(){
  try{
    if(state.running) return '';
    var msgs=Hub.currentMessages()||[];
    if(msgs.length) return '';
    var root=document.documentElement;
    if(root&&root.dataset&&root.dataset.hubMode==='real') return '';
    var bot=typeof botBy==='function'?botBy(state.bot):null;
    var line=r29OpeningLine(bot&&bot.duty);
    if(!line) return '';
    return '<p class="r29-opening"><button type="button" class="r29-opening-line" data-r29-opening="'
      +esc(line)+'" style="'+r29OpeningStyle()+'">'+esc(line)+'</button></p>';
  }catch(err){return '';}
}
document.addEventListener('click',function(e){
  var t=e&&e.target;
  if(!t||!t.closest) return;
  var button=t.closest('[data-r29-opening]');
  if(!button) return;
  if(e.preventDefault) e.preventDefault();
  r29PlaceOpening(button.getAttribute('data-r29-opening')||button.textContent||'');
},true);
function r29DropOpening(){
  try{
    var msgs=Hub.currentMessages()||[];
    if(!msgs.length&&!state.running) return;
    var nodes=document.querySelectorAll('.r29-opening');
    var i;
    for(i=0;i<nodes.length;i++) nodes[i].remove();
  }catch(err){}
}
if(window.Hub&&typeof Hub.on==='function') Hub.on('message',r29DropOpening);

function r29BotName(bot){
  var name=bot&&bot.name;
  return name?String(name):'暂无';
}
function r29HeaderFace(id){
  var groups=typeof r29Groups==='function'?r29Groups():[];
  var conv=state.conversation||'';
  var group=null;
  var i;
  for(i=0;i<groups.length;i++){
    var item=groups[i];
    if(!item) continue;
    if(item.conversation===conv||item.id===conv){group=item;break;}
  }
  if(group&&window.HubAvatars&&typeof HubAvatars.stackHtml==='function'){
    return HubAvatars.stackHtml(group.members||[],32);
  }
  if(window.HubAvatars&&typeof HubAvatars.html==='function') return HubAvatars.html(id,32);
  return avatar(id,'header');
}
function r29ChatHeader(b,title,memoryHTML){
  var id=b&&b.id?b.id:'';
  var back='<button class="iconbtn r22-round backbtn" data-act="back" aria-label="返回助理列表">'+r22Icon('back')+'</button>';
  var side=ib('side','collapse',state.collapsed?'展开侧栏':'收起侧栏','','sidebtn');
  var plate='<div class="titlepill r29-title" data-shell-title="'+esc(id)+'"';
  plate+=' data-parent-bot="'+esc((b&&b.parent)||id)+'" style="'+botStyle(id)+'">';
  plate+='<span class="r29-avatar">'+r29HeaderFace(id)+'</span>';
  var shown=title?String(title):r29BotName(b);
  plate+='<strong class="r22-nameplate">'+esc(shown)+'</strong></div>';
  var session=esc((state.sessionNames&&state.sessionNames[id])||'当前会话');
  var board='';
  if(state.boardReturn){
    board='<button class="shell-board-return" data-act="return-board">'+ico('arrow-left')+' 回看板</button>';
  }
  var meta='<div class="shell-title-meta"><span data-demo-content="title">'+session+' · </span>';
  meta+=(memoryHTML||'')+board;
  meta+='<span class="r29-offline" data-r29-offline hidden>未连接</span></div>';
  var gear='<button type="button" class="iconbtn r29-settings" data-r29-settings';
  gear+=' aria-label="设置">'+ico('settings')+'</button>';
  var ledger='<button class="ledger-shortcut" data-hub-view="ledger" aria-hidden="true"';
  ledger+=' tabindex="-1" aria-label="打开账本">'+ring(contextPct())+'</button>';
  var head='<header class="floatinghead chat-header">'+back+side;
  head+='<div class="shell-title-stack">'+plate+meta+'</div>'+gear+ledger+'</header>';
  var out=typeof r29GroupHeader==='function'?r29GroupHeader(head,b,title):head;
  return typeof r30ChatHeader==='function'?r30ChatHeader(out,b):out;
}
function r29ClearAttr(el,name){
  if(!el) return;
  if(typeof el.removeAttribute==='function') el.removeAttribute(name);
  if(el.attributes) delete el.attributes[name];
  if(el.dataset){
    var key=name.replace(/^data-/,'').replace(/-([a-z])/g,function(_,c){return c.toUpperCase();});
    delete el.dataset[key];
  }
}
function r29ComposerMode(){
  var text=(state.input||'').trim();
  var files=state.attachments&&state.attachments.length;
  if(state.running) return {act:'stop',label:'停止',icon:'stop',mic:false};
  if(text||files) return {act:'send',label:'发送',icon:'send',mic:false};
  return {act:'',label:'麦克风',icon:'mic',mic:true};
}
function r29SyncButton(){
  var btn=document.querySelector('.composer-area .voicebtn');
  if(!btn) return;
  var want=r29ComposerMode();
  document.querySelectorAll('.m-interact-dock button,.composer-area button').forEach(function(node){
    if(node!==btn&&(node.textContent||'').indexOf('插话')>=0) node.remove();
  });
  var act=(btn.getAttribute('data-act')||'');
  var mic=btn.getAttribute('data-r29-mic')!==null;
  var mode=btn.getAttribute('data-r29-mode')||'';
  var key=want.mic?'mic':want.act;
  if(act===(want.act||'')&&mic===want.mic&&mode===key&&btn.getAttribute('aria-label')===want.label) return;
  if(want.act) btn.setAttribute('data-act',want.act);
  else r29ClearAttr(btn,'data-act');
  if(want.mic) btn.setAttribute('data-r29-mic','');
  else r29ClearAttr(btn,'data-r29-mic');
  btn.setAttribute('data-r29-mode',key);
  btn.setAttribute('aria-label',want.label);
  btn.innerHTML=ico(want.icon);
}
function r29ActionButton(){
  var want=r29ComposerMode();
  var act=want.mic?'data-r29-mic':'data-act="'+want.act+'"';
  var mode=want.mic?'mic':want.act;
  var html='<button type="button" class="iconbtn voicebtn" '+act+' data-r29-mode="'+mode+'"';
  html+=' aria-label="'+want.label+'">'+ico(want.icon)+'</button>';
  return html;
}
function r29Previews(){
  if(!state.attachments||!state.attachments.length) return '';
  var html='<div class="r29-previews" data-r29-previews>';
  state.attachments.forEach(function(f,i){
    var src=(f.url&&/^(data:|blob:)/.test(String(f.url)))?String(f.url):'';
    var img=src?'<img src="'+esc(src)+'" alt="">':'';
    var label=f.r29UploadFail
      ?'<button type="button" class="r29-retry" data-r29-retry-upload data-index="'+i+'">没传上去，点这里重试</button>'
      :'<span class="r29-file-name">'+esc(f.name||'未命名')+'</span>';
    html+='<div class="r29-chip">'+img+label;
    html+='<button type="button" class="iconbtn" data-act="remove-attach" data-index="'+i+'"';
    html+=' aria-label="移除附件">'+ico('close')+'</button></div>';
  });
  return html+'</div>';
}
function r29FileInputs(){
  return '<input type="file" accept="image/*" multiple data-r29-file="image" hidden>'
    +'<input type="file" multiple data-r29-file="any" hidden>';
}
function r29PlusPanel(){
  if(!state.r29PlusOpen) return '';
  return '<div class="r29-plus-panel" data-r29-plus-panel role="group" aria-label="添加">'
    +'<button type="button" data-r29-pick="image">传图片</button>'
    +'<button type="button" data-r29-pick="file">传文件</button></div>';
}
function r29QueueBar(){
  if(!state.queue||!state.queue.length) return '';
  return '<div class="r29-queue" data-r29-queue><span>排队中 '+state.queue.length+' 条</span>'
    +'<button type="button" data-r29-cancel-queue>取消</button></div>';
}
function r30Placeholder(){
  var group=typeof r29GroupHere==='function'?r29GroupHere():null;
  return group?'在组里说一句':'向'+r29BotName(botBy(state.bot))+'发消息';
}
function composer(){
  var who=r29BotName(botBy(state.bot));
  var stopped='';
  if(state.stopped){
    stopped='<div class="queuebar"><span class="grow">本轮已暂停，消息与草稿保留</span>';
    stopped+='<button class="textbutton" data-act="continue">继续</button>';
    stopped+='<button class="textbutton" data-act="retry-message">重试</button></div>';
  }
  var menu='<button type="button" class="iconbtn r22-session-key" data-act="session-menu"';
  menu+=' aria-label="⊞ 会话菜单" aria-hidden="true" tabindex="-1">'+r22Icon('menu')+'</button>';
  var field='<div class="inputpill r22-field">'+menu;
  field+='<textarea data-focus="composer" rows="1" placeholder="'+esc(r30Placeholder())+'"';
  field+=' aria-label="消息输入框" autocomplete="off">'+esc(state.input)+'</textarea></div>';
  var row='<div class="r22-input-row">';
  row+='<button type="button" class="iconbtn r29-plus" data-r29-plus aria-label="添加">'+ico('plus')+'</button>';
  row+=field+r29ActionButton();
  var pct=contextPct();
  var tail=demoText("views.chat.sample.1")+'<span>'+pct+'% · '+state.context+'k/'+state.contextMax+'k';
  tail+=(pct>=80?' · 压缩':'')+'</span></button>';
  tail+='<span class="r22-collapsed-status" data-pet-status></span></div></div></div>';
  var html='<div class="composer-area">'+chiefPet.chatHTML()+'<div class="r22-composer-column">';
  html+='<div class="chat-quick-slot"></div>'+stopped+r29QueueBar();
  html+='<div class="r29-voice-slot" data-r29-voice-slot></div>'+r29Previews()+r29FileInputs()+r29PlusPanel();
  html+='<div class="atmenu" hidden></div>'+row+tail;
  return html;
}

var r29Queue=[];
function r29Slash(text){
  return text.startsWith('/context')||text.startsWith('/plan')||text.startsWith('/side');
}
async function r29UploadEntry(entry){
  if(!entry||typeof window.HubUpload!=='function') return false;
  var result=null;
  try{result=await window.HubUpload(entry.file,{conversation:state.conversation,bot:state.bot});}
  catch(err){result=null;}
  var ok=!!(result&&result.ok);
  entry.r29UploadFail=!ok;
  return ok;
}
async function r29SendWithUpload(text){
  var files=(state.attachments||[]).slice();
  var failed=[];
  var okCount=0;
  for(var i=0;i<files.length;i++){
    if(await r29UploadEntry(files[i])) okCount++;
    else failed.push(files[i]);
  }
  state.attachments=failed;
  var body=text;
  if(!body&&okCount) body='已附上 '+okCount+' 个文件';
  if(body){
    Hub.postMessage(state.conversation,{role:'user',time:'刚刚',text:body});
    if(typeof r25ClearComposer==='function') r25ClearComposer();
    else state.input='';
    runReply(body);
  }else if(typeof r25ClearComposer==='function') r25ClearComposer();
  render();
}
function r29QueueCurrent(text){
  var label=text||('附件 '+(state.attachments?state.attachments.length:0));
  r29Queue.push({text:text,files:(state.attachments||[]).slice()});
  state.queue.push(label);
  state.attachments=[];
  if(typeof r25ClearComposer==='function') r25ClearComposer();
  else state.input='';
  render();
}
async function r29DeliverUploads(item,bot){
  var files=(item.files||[]).slice();
  var failed=[];
  var okCount=0;
  for(var i=0;i<files.length;i++){
    if(await r29UploadEntry(files[i])) okCount++;
    else failed.push(files[i]);
  }
  if(failed.length) state.attachments=(state.attachments||[]).concat(failed);
  var body=item.text||'';
  if(!body&&okCount) body='已附上 '+okCount+' 个文件';
  if(body){
    Hub.postMessage(state.conversation,{role:'user',time:'刚刚',text:body});
    runReply(body,bot);
  }else render();
}
window.r29DeliverQueued=function(text,bot){
  var item=r29Queue.length?r29Queue.shift():{text:text,files:[]};
  if(typeof window.HubUpload==='function'&&item.files&&item.files.length){
    r29DeliverUploads(item,bot);
    return;
  }
  var body=item.text||text||'';
  if(!body&&item.files&&item.files.length) body='已附上 '+item.files.length+' 个文件';
  if(!body) return;
  Hub.postMessage(state.conversation,{role:'user',time:'刚刚',text:body});
  runReply(body,bot);
};
var r29CoreSend=send;
send=function(){
  if(typeof r25CanSend==='function'&&!r25CanSend()) return;
  var text=(state.input||'').trim();
  if(!text&&!(state.attachments&&state.attachments.length)) return;
  if(r29Slash(text)) return r29CoreSend();
  if(state.running) return r29QueueCurrent(text);
  if(typeof window.HubUpload==='function'&&state.attachments&&state.attachments.length) return r29SendWithUpload(text);
  return r29CoreSend();
};
var r29CoreRender=render;
render=function(){
  var shellBusy=!!(state&&state.running);
  var out=r29CoreRender.apply(this,arguments);
  if(shellBusy&&state&&!state.running) state.running=true;
  r29SyncButton();
  return out;
};
function r29SyncDraft(box){
  if(box&&typeof box.value==='string') state.input=box.value;
}
function r29TakeSend(){
  var text=(state.input||'').trim();
  var files=state.attachments&&state.attachments.length;
  if(!text&&!files) return false;
  if(r29Slash(text)) return false;
  return !!(state.running||files);
}
function r29Halt(e){
  if(e&&e.preventDefault) e.preventDefault();
  if(e&&e.stopImmediatePropagation) e.stopImmediatePropagation();
}
document.addEventListener('keydown',function(e){
  var box=e&&e.target;
  if(!box||!box.dataset||box.dataset.focus!=='composer') return;
  if(e.key!=='Enter'||e.shiftKey||e.isComposing||e.keyCode===229) return;
  r29SyncDraft(box);
  if(!r29TakeSend()) return;
  r29Halt(e);
  send();
},true);
document.addEventListener('click',function(e){
  var t=e&&e.target;
  if(!t||!t.closest) return;
  var btn=t.closest('.composer-area .voicebtn');
  if(!btn||(btn.getAttribute('data-act')||'')!=='send') return;
  r29SyncDraft(document.querySelector('[data-focus="composer"]'));
  if(!r29TakeSend()) return;
  r29Halt(e);
  send();
},true);

async function r29AddFiles(list){
  var files=Array.prototype.slice.call(list||[]);
  for(var i=0;i<files.length;i++){
    var f=files[i];
    if(state.attachments.length>=5){toast('每条消息最多 5 个附件');break;}
    if(f.size>10*1024*1024){toast('附件限制 10 MB，已跳过 '+f.name);continue;}
    var entry={name:f.name,url:null,text:null,fail:false,file:f,r29UploadFail:false};
    state.attachments.push(entry);
    if(typeof readLocalAttachment==='function') await readLocalAttachment(entry);
  }
  state.r29PlusOpen=false;
  state.mode='chat';
  state.detail=true;
  render();
}
async function r29Retry(index){
  var entry=state.attachments&&state.attachments[Number(index)];
  if(!entry) return;
  if(await r29UploadEntry(entry)) state.attachments.splice(Number(index),1);
  render();
}
function r29SyncLink(){
  var health=document.querySelector('.chat-header .hub-real-health');
  var off=document.querySelector('.chat-header [data-r29-offline]');
  if(!off) return;
  var text=health?(health.textContent||'').replace(/\s+/g,''):'';
  var down=text.indexOf('未连接')>=0||text.indexOf('断线')>=0;
  if(down) r29ClearAttr(off,'hidden');
  else if(!off.hasAttribute||off.hasAttribute('hidden')||off.hidden){
    off.hidden=true;
    if(off.setAttribute) off.setAttribute('hidden','');
  }
  if(health){
    health.hidden=true;
    if(health.setAttribute) health.setAttribute('hidden','');
  }
}
document.addEventListener('input',function(e){
  var el=e.target;
  if(!el||!el.dataset||el.dataset.focus!=='composer') return;
  state.input=el.value;
  r29SyncButton();
});
document.addEventListener('change',function(e){
  var input=e.target&&e.target.closest?e.target.closest('[data-r29-file]'):null;
  if(!input||!input.files) return;
  var picked=Array.prototype.slice.call(input.files);
  input.value='';
  state.r29PlusOpen=false;
  r29AddFiles(picked);
});
document.addEventListener('click',function(e){
  var t=e.target;
  if(!t||!t.closest) return;
  var settings=t.closest('[data-r29-settings]');
  if(settings){
    var ev;
    try{ev=new CustomEvent('r29-settings',{bubbles:true});}
    catch(err){ev={type:'r29-settings',bubbles:true};}
    document.dispatchEvent(ev);
  }
  if(t.closest('[data-r29-plus]')){
    state.r29PlusOpen=!state.r29PlusOpen;
    render();
    return;
  }
  var pick=t.closest('[data-r29-pick]');
  if(pick){
    var kind=pick.getAttribute('data-r29-pick')==='image'?'image':'any';
    var input=document.querySelector('[data-r29-file="'+kind+'"]');
    if(input) input.click();
    return;
  }
  var retry=t.closest('[data-r29-retry-upload]');
  if(retry){r29Retry(retry.getAttribute('data-index'));return;}
  if(t.closest('[data-r29-cancel-queue]')){
    state.queue=[];
    r29Queue=[];
    render();
    return;
  }
  if(state.r29PlusOpen&&!t.closest('[data-r29-plus-panel]')){
    state.r29PlusOpen=false;
    render();
  }
});
if(typeof MutationObserver==='function'){
  var r29LinkHost=document.documentElement||document.body;
  if(r29LinkHost&&r29LinkHost.nodeType!==undefined){
    try{
      new MutationObserver(function(){r29SyncLink();}).observe(r29LinkHost,{
        subtree:true,childList:true,characterData:true
      });
    }catch(err){}
    try{
      new MutationObserver(function(){r29SyncButton();}).observe(r29LinkHost,{
        subtree:true,childList:true,attributes:true,
        attributeFilter:['data-act','aria-label']
      });
    }catch(err2){}
  }
}
document.addEventListener('input',function(){
  Promise.resolve().then(r29SyncButton);
});
resizeInput=function(){
  var el=document.querySelector('[data-focus="composer"]');
  if(el) el.style.height='32px';
};

Hub.registerView('chat',{title:'聊天',icon:'chat',render:function(container){
  var old=container.querySelector('.chatview');
  var input=old?old.querySelector('[data-focus="composer"]'):null;
  var next=Hub.fromHTML(chatView());
  if(input&&old.dataset.conversation===state.conversation){
    r25PatchKeeping(old,next,input);
    input.setAttribute('placeholder',r30Placeholder());
    if(!r25Composition.active&&input.value!==state.input){
      input.value=state.input;
      input.setSelectionRange(input.value.length,input.value.length);
    }
  }else{
    container.replaceChildren(next);
    var fresh=next.querySelector('[data-focus="composer"]');
    if(fresh) fresh.setSelectionRange(fresh.value.length,fresh.value.length);
  }
  r29SyncButton();
  r29SyncLink();
}});
