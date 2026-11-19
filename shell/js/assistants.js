/* R25 P：名册是唯一身份来源；本机图片和资料仅留在浏览器。 */
(function () {
  'use strict';
  const H = window.Hub, h = H.h, clone = value => JSON.parse(JSON.stringify(value));
  const storageKey = 'hub-r25-assistants-v1' + (DEMO_KIND === 'generic' ? '-generic' : ''), maxStorage = 2200000, maxFile = 700 * 1024;
  const fields = ['name','duty','homeLabel','description','quickReplies','avatar','avatarPath','avatarExplicit','enabled','color','colorInk','colorStrong','profileRevision'];
  const drafts = new Map(), pending = new Map();
  let sequence = 0, profileTarget = null, editField = null, undoTimer = null, suppressPinClick = 0;
  const all = () => H.state.bots.filter(b => !b.parent && !b.steward);
  const by = id => all().find(b => b.id === id);
  const chief = () => all().find(b => b.role === 'chief' && b.enabled !== false);
  const snapshot = b => Object.fromEntries(fields.filter(k => b[k] !== undefined).map(k => [k,clone(b[k])]));
  const catalog = () => typeof AVATAR_CATALOG === 'undefined' ? [] : AVATAR_CATALOG;
  const pack = a => catalog().find(p => p.id === a?.id && p.kind === a.kind);
  const canEdit = (actor,target) => !!by(actor) && (actor === target || by(actor).role === 'chief');
  const cut = (text,n=8) => Array.from(text).slice(0,n).join('');
  function defaultAvatar() { return {kind:'shape',shapeId:ASSISTANT_SHAPES[0].id,color:ASSISTANT_COLORS[0]}; }
  function normalize(b) {
    if (!b.avatar) b.avatar = defaultAvatar();
    if (b.enabled === undefined) b.enabled = true;
    if (b.avatarExplicit === undefined) b.avatarExplicit = false;
    if (!b.description) b.description = ASSISTANT_COPY.description;
    if (!b.quickReplies?.length) b.quickReplies = ASSISTANT_COPY.phrases.slice();
    if (!Number.isInteger(b.profileRevision)) b.profileRevision = 0;
  }
  function validate(p) {
    if (!p.name?.trim() || Array.from(p.name.trim()).length > 8) throw Error('名字请写 1–8 个字。');
    if (!p.duty?.trim() || p.duty.length > 80) throw Error('一句职责请写 1–80 个字。');
    if (!p.description?.trim() || p.description.length > 800) throw Error('请写清管哪些、不管哪些，最多 800 字。');
    if (!Array.isArray(p.quickReplies) || p.quickReplies.length !== 3 || p.quickReplies.some(s => typeof s !== 'string' || !s.trim() || s.length > 60)) throw Error('请填写三条开场短语，每条 1–60 字。');
    if (!/^#[\da-f]{6}$/i.test(p.color)) throw Error('名牌颜色无效。');
    const a = p.avatar;
    if (a?.kind === 'shape') {
      if (!ASSISTANT_SHAPES.some(s => s.id === a.shapeId) || !/^#[\da-f]{6}$/i.test(a.color)) throw Error('请选择库中的颜色和形状。');
    } else if (a?.kind === 'upload') {
      if (!/^data:image\/(?:png|gif|jpeg|webp|avif);base64,[A-Za-z\d+/=]+$/.test(a.dataURL || '') || a.dataURL.length > 1000000) throw Error('图片格式或大小不支持，请选择 700 KB 以内的图片。');
    } else if (!pack(a)) throw Error('这个角色包不可用，请重新选形象。');
  }
  function savedRows(overrides = new Map(), extra) {
    const rows = all().map(b => ({id:b.id,custom:!!b.custom,role:b.role,owns:b.owns||[],...snapshot(b),...(overrides.get(b.id)||{})}));
    if (extra) rows.push(extra);
    return rows;
  }
  function persist(rows) {
    const json = JSON.stringify({version:1,rows});
    if (json.length > maxStorage) throw Error('本机头像存储已满，请换一张更小的图片。');
    try { localStorage.setItem(storageKey,json); } catch (e) { throw Error('浏览器无法保存这些资料，请允许本地存储或换一张更小的图片；改动尚未生效。'); }
  }
  function syncIdentity(b) {
    SHORT[b.id] = b.homeLabel || b.duty;
    COLORS[b.id] = b.color;
    if (b.avatar.kind === 'shape') b.avatarPath = ASSISTANT_SHAPES.find(s => s.id === b.avatar.shapeId).path;
    PATHS[b.id] = b.avatarPath;
    H.emit('assistant-change',{bot:b.id,assistant:b});
  }
  function appearanceName(a) {
    if (a?.kind === 'shape') return ASSISTANT_SHAPES.find(s => s.id === a.shapeId)?.name || '圆润图形';
    if (a?.kind === 'upload') return a.animated ? '自己的动图' : '自己的图片';
    return pack(a)?.displayName || '当前形象';
  }
  function shapeHTML(a, id, slot) {
    const shape = ASSISTANT_SHAPES.find(s => s.id === a.shapeId) || ASSISTANT_SHAPES[0];
    return '<svg class="creature bot-avatar r25-shape-avatar'+(slot==='chat'?' role-silhouette':'')+'" data-bot-avatar="'+esc(id||'')+'" data-avatar-kind="shape" viewBox="0 0 120 120" aria-label="'+esc(shape.name)+'"><path d="'+shape.path+'" fill="'+esc(a.color)+demoText("assistants.sample.1");
  }
  function imageHTML(a,id,slot) {
    if (a?.kind === 'shape') return shapeHTML(a,id,slot);
    const src = a?.kind === 'upload' ? localAvatarSource(a.dataURL) : pack(a)?.avatar;
    return '<img class="creature bot-avatar r25-image-avatar" data-bot-avatar="'+esc(id||'')+'" data-avatar-kind="'+esc(a?.kind||'')+'" src="'+esc(src||'')+'" alt="'+esc(appearanceName(a))+'" draggable="false">';
  }
  function avatarSource(a) {return a?.kind==='upload'?localAvatarSource(a.dataURL):pack(a)?.avatar||'';}
  function avatarHTML(b,slot) {
    if (!b?.avatar || (!b.avatarExplicit && b.avatar.kind === 'pack')) return null;
    // 有动作的角色由壳的绑定表播放；未载入时显示对应包的头像。
    if (b.avatar.kind === 'pack' && chiefPet.active(b.id)) return null;
    return imageHTML(b.avatar,b.id,slot);
  }
  function staticStage(b,slot) {
    const html = avatarHTML(b,slot);
    return html === null ? null : '<span class="r25-static-stage" data-static-assistant="'+esc(b.id)+'" data-static-kind="'+esc(b.avatar.kind)+'">'+html+'</span>';
  }
  function colorFor(a) { return ['shape','upload'].includes(a.kind) ? a.color || ASSISTANT_COLORS[0] : pack(a)?.color || ASSISTANT_COLORS[0]; }
  function propose(id,patch,options={}) {
    const b = by(id);
    if (!b && !options.create) throw Error('找不到这位助理。');
    if(Object.keys(patch).some(k=>!['name','duty','description','quickReplies','avatar','enabled','color','colorStrong'].includes(k)))throw Error('这张卡只能调整名字、职责、短语、形象、颜色与启用状态。');
    if (options.actor && (options.create ? by(options.actor)?.role !== 'chief' : !canEdit(options.actor,id))) throw Error(demoText("assistants.sample.2"));
    const before = b ? snapshot(b) : null;
    const after = {...(before || {name:ASSISTANT_COPY.newName,duty:ASSISTANT_COPY.newDuty,description:ASSISTANT_COPY.description,quickReplies:ASSISTANT_COPY.phrases.slice(),avatar:defaultAvatar(),enabled:true,color:ASSISTANT_COLORS[0],colorInk:'#1c1b22',colorStrong:'#4c4256',profileRevision:0}),...clone(patch)};
    after.name = after.name.trim();
    if(patch.duty)after.homeLabel=patch.duty;
    if (patch.avatar) {
      after.avatarExplicit = true;
      after.color = colorFor(after.avatar);
      after.colorInk = '#1c1b22'; after.colorStrong = '#4c4256';
    }
    validate(after);
    const changes = [{id,before,after}];
    const other = ['pack','spare'].includes(after.avatar.kind) && all().find(x => x.id !== id && x.avatar?.kind === after.avatar.kind && x.avatar.id === after.avatar.id);
    if (other) {
      if (!before) throw Error('新建助理请先使用图形，建好后再互换角色。');
      const swapped = {...snapshot(other),avatar:clone(before.avatar),avatarExplicit:true,color:colorFor(before.avatar),colorInk:'#1c1b22',colorStrong:'#4c4256'};
      validate(swapped); changes.push({id:other.id,before:snapshot(other),after:swapped});
    }
    const d = {id:'assistant-change-'+(++sequence),target:id,create:!!options.create,actor:options.actor,original:options.original||'',conversation:options.conversation||null,status:'pending',changes};
    drafts.set(d.id,d); return d;
  }
  function preview(d) { H.sheet({title:d.create?'新助理 · 确认前预览':'助理资料 · 确认前预览',body:host=>host.append(letter(d))}); return d; }
  function undo(d) {
    if (d.status !== 'confirmed' || Date.now() > d.undoUntil) return false;
    if (d.changes.some(c => by(c.id)?.profileRevision !== c.appliedRevision)) { H.toast('后面已有新改动，这次撤销已失效。'); return false; }
    const overrides = new Map(d.changes.map(c => [c.id,c.before ? {...c.before,profileRevision:c.appliedRevision+1} : {...snapshot(by(c.id)),enabled:false,profileRevision:c.appliedRevision+1}]));
    try { persist(savedRows(overrides)); } catch(e) { H.toast(e.message); return false; }
    d.changes.forEach(c => {const oldName=by(c.id).name;Object.assign(by(c.id),overrides.get(c.id));H.updateAssistantIdentity(c.id,oldName);syncIdentity(by(c.id));});
    d.status = 'undone'; clearToast(); render(); return true;
  }
  function confirm(d) {
    if (d.status !== 'pending') return false;
    if (d.actor && (d.create ? by(d.actor)?.role !== 'chief' : !canEdit(d.actor,d.target))) { H.toast('当前角色无权确认这项调整。'); return false; }
    if (d.changes.some(c => c.before ? by(c.id)?.profileRevision !== c.before.profileRevision : !!by(c.id))) { d.status='stale'; render(); H.toast('资料已有新版本，请重新预览。'); return false; }
    const initial = all().filter(b => b.initialAssistant);
    const overrides = new Map(d.changes.map(c => [c.id,{...c.after,profileRevision:(c.before?.profileRevision||0)+1}]));
    if (initial.length && !initial.some(b => (overrides.get(b.id)||b).enabled !== false)) { H.toast('至少保留一个启用的初始助理。'); return false; }
    try {
      d.changes.forEach(c => validate(c.after));
      const extra = d.create ? {id:d.target,custom:true,role:'assistant',owns:[],...overrides.get(d.target)} : null;
      persist(savedRows(overrides,extra));
    } catch(e) { H.toast(e.message); return false; }
    d.changes.forEach(c => {
      let b = by(c.id);
      if (!b) b = H.createBot({id:c.id,name:c.after.name,duty:c.after.duty,color:c.after.color});
      const oldName=b.name;Object.assign(b,overrides.get(c.id));H.updateAssistantIdentity(b.id,oldName);c.appliedRevision=b.profileRevision;syncIdentity(b);
    });
    d.status='confirmed';d.undoUntil=Date.now()+4000;
    if (d.conversation) H.postMessage(d.conversation,{from:d.actor,time:'刚刚',parts:[{type:'text',md:d.create?'已建 · '+by(d.target).name:'已改 · '+by(d.target).name}]});
    if (H.state.drawer) H.state.drawer=null;
    render();
    H.toast(d.create?'助理已建 · ':'资料已改 · ');clearTimeout(toast.timer);clearTimeout(undoTimer);
    document.getElementById('toast').append(h('button',{type:'button','data-assistant-undo':d.id,onClick:()=>undo(d)},'撤销'));
    positionToast();undoTimer=toast.timer=setTimeout(clearToast,4000);
    return true;
  }
  function amend(d) {
    if (d.status !== 'pending') return;
    d.status='revising';
    if (d.conversation) H.fillDraft(d.actor,d.original);
    else {editField=d.create?'new':'all'; H.state.drawer=null; profileTarget=d.target; render();}
  }
  function letter(d) {
    const main = d.changes[0], node = h('section',{class:'mcard r22-letter r25-assistant-letter','data-assistant-change':d.id,'data-change-status':d.status});
    var who=d.actor||H.state.bot;
    var lead=r22Nameplate(who);
    if(window.HubAvatars&&typeof HubAvatars.html==='function'){
      lead='<span class="r29-confirm-face">'+HubAvatars.html(who,32)+'</span>'+lead;
    }
    node.append(H.fromHTML(lead),h('h3',{},d.create?'建一位助理':'这次资料调整'),h('p',{class:'mini-note'},d.status==='pending'?'确认前不生效 · 本机演示':({confirmed:'已改',undone:'已撤销',cancelled:'不改，原资料保留',revising:'已交回修改',stale:'资料已更新，请重新预览'}[d.status]||d.status)));
    const diff = h('div',{class:'r25-profile-diff'});
    const visibleFields=[['name','名字'],['avatar','形象'],['duty','职责'],['description','说明'],['quickReplies','开场短语'],['enabled','启用状态'],['color','名牌色']];
    let unchanged=false;
    for (const change of d.changes) {
      for (const [key,label] of visibleFields) {
        const value=p=>key==='color'?p[key].toLowerCase():key==='avatar'?(p.avatar.kind==='shape'?[p.avatar.kind,p.avatar.shapeId,p.avatar.color.toLowerCase()]:p.avatar.kind==='upload'?[p.avatar.kind,p.avatar.dataURL]:[p.avatar.kind,p.avatar.id]):p[key];
        if (change.before && JSON.stringify(value(change.before))===JSON.stringify(value(change.after))) {unchanged=true;continue;}
        const row=h('section',{class:'r25-profile-change','data-assistant-diff-field':key,'data-diff-assistant':change.id});
        row.append(h('h4',{},(d.changes.length>1?change.after.name+' · ':'')+label));
        for (const [side,title,p] of [['before','改动前',change.before],['after','改动后',change.after]]) {
          if (!p && key!=='name') continue;
          const line=h('div',{class:'r25-profile-diff-side','data-diff-side':side});
          line.append(h('small',{},title));
          if (!p) line.append(h('p',{},'还没有这位助理'));
          else if (key==='avatar') line.append(H.fromHTML(imageHTML(p.avatar,change.id,'preview')),h('p',{},appearanceName(p.avatar)));
          else if (key==='quickReplies') line.append(h('ul',{},p.quickReplies.map(s=>h('li',{},s))));
          else if (key==='color') line.append(h('span',{class:'r25-color-chip',style:{background:p.color}},p.color));
          else line.append(h('p',{},key==='enabled'?(p.enabled===false?'已停用':'启用'):p[key]));
          row.append(line);
        }
        diff.append(row);
      }
    }
    node.append(diff);
    if (unchanged) node.append(h('p',{class:'mini-note','data-assistant-unchanged':''},'其余不变'));
    if (d.changes.length>1) node.append(h('p',{'data-avatar-swap':''},'互换：'+main.before.name+' 与 '+d.changes[1].before.name+' 互换形象，双方一起确认、一起撤销。'));
    if (d.status==='pending') node.append(h('div',{class:'actions'},[
      h('button',{class:'primary','data-assistant-confirm':d.id,onClick:()=>confirm(d)},'确认'),
      h('button',{class:'ghostbtn','data-assistant-amend':d.id,onClick:()=>amend(d)},'改一下'),
      h('button',{class:'ghostbtn','data-assistant-cancel':d.id,onClick:()=>{d.status='cancelled';H.state.drawer=null;render();}},'不改')
    ]));
    if (d.status==='confirmed' && d.create) node.append(h('button',{class:'ghostbtn','data-assistant-open':d.target,onClick:()=>H.navigate({view:'chat',conversation:d.target+'-013'})},'和新助理说话'));
    return node;
  }
  function openProfile(id) { if (!by(id)) return;profileTarget=id;editField=null;H.navigate({view:'assistant-profile',bot:id}); }
  function inputField(label,key,value,textarea=false) {
    return h('label',{class:'field'},[label,h(textarea?'textarea':'input',{'data-profile-field':key,value:textarea?undefined:value,...(key==='name'?demoFixture("assistants.sample.3"):{})},textarea?value:null)]);
  }
  function editor(b,field) {
    const form=h('form',{'data-profile-editor':field});
    if (['name','all','new'].includes(field)) form.append(inputField('名字（最多 8 字）','name',b.name));
    if (['duty','all','new'].includes(field)) form.append(inputField('一句职责','duty',b.duty),inputField('管哪些、不管哪些','description',b.description,true));
    if (['phrases','all','new'].includes(field)) b.quickReplies.forEach((v,i)=>form.append(inputField('开场短语 '+(i+1),'phrase'+i,v)));
    form.append(h('button',{type:'submit',class:'primary','data-profile-preview':''},'预览改动'),h('button',{type:'button',class:'ghostbtn',onClick:()=>{editField=null;render();}},'取消编辑'));
    form.addEventListener('submit',e=>{
      e.preventDefault();const patch={};
      form.querySelectorAll('[data-profile-field]').forEach(el=>{const key=el.dataset.profileField;if(key.startsWith('phrase')){patch.quickReplies??=b.quickReplies.slice();patch.quickReplies[Number(key.slice(6))]=el.value.trim();}else patch[key]=el.value.trim();});
      try{preview(propose(b.id,patch,{create:field==='new'}));}catch(err){H.toast(err.message);}
    });return form;
  }
  function profileView(host) {
    const b=by(H.state.bot);if(!b)return;
    const root=h('section',{class:'r25-assistant-profile','data-assistant-profile-page':b.id});
    const section=(title,children)=>h('section',{class:'surface'},[h('h2',{},title),...children]);
    root.append(section('形象',[
      h('div',{class:'r25-profile-avatar'},H.fromHTML(imageHTML(b.avatar,b.id,'profile'))),h('p',{},appearanceName(b.avatar)),
      ...((b.avatar.kind==='spare'||b.avatar.kind==='upload'||b.avatar.kind==='shape')?[h('p',{class:'mini-note','data-avatar-no-motion':''},'这个形象没有动作')]:[]),
      h('button',{class:'ghostbtn','data-avatar-library':b.id,onClick:()=>openLibrary(b.id)},'换形象'),
      h('p',{class:'mini-note'},'名牌颜色 · 跟随形象主色，也可手选'),h('div',{class:'r25-color-options'},[
        ...ASSISTANT_COLORS.slice(0,6).map(color=>h('button',{class:'r25-color-option',style:{background:color},'aria-label':'名牌色 '+color,'aria-pressed':String(color.toLowerCase()===b.color.toLowerCase()),'data-profile-color':color,onClick:()=>preview(propose(b.id,{color,colorStrong:'#4c4256'}))})),
        ...(!ASSISTANT_COLORS.slice(0,6).some(color=>color.toLowerCase()===b.color.toLowerCase())?[h('span',{class:'r25-color-auto','data-profile-color-auto':b.color,role:'status'},[h('i',{style:{background:b.color},'aria-hidden':'true'}),'自动'])]:[])
      ])
    ]));
    const edit=(key,label)=>h('button',{class:'ghostbtn','data-profile-edit':key,onClick:()=>{editField=key;render();}},label);
    root.append(section('名字',[h('h2',{'data-profile-name':''},b.name),editField==='name'?editor(b,'name'):edit('name','改名字')]));
    root.append(section('负责什么',[h('p',{'data-profile-duty':''},b.duty),h('p',{},b.description),editField==='duty'?editor(b,'duty'):edit('duty','改职责')]));
    root.append(section('其他',[
      h('h3',{},'开场短语'),h('ol',{},b.quickReplies.map(s=>h('li',{},s))),editField==='phrases'?editor(b,'phrases'):edit('phrases','改开场短语'),
      h('h3',{},'固定任务'),...H.fixedTasks(b.id).map(t=>h('button',{class:'setting-row','data-profile-task':t.taskId,onClick:()=>H.navigate({view:'chat',conversation:t.conversation})},H.fixedTaskTitle(t))),
      ...(!H.fixedTasks(b.id).length?[h('p',{class:'muted'},'还没有固定任务')]:[]),
      h('button',{class:'ghostbtn','data-profile-status':b.id,onClick:()=>preview(propose(b.id,{enabled:b.enabled===false}))},b.enabled===false?'恢复助理':'停用助理'),
      h('p',{class:'mini-note'},'停用后资料和会话都保留；至少留一个启用的初始助理。')
    ]));
    if(editField==='all')root.append(editor(b,'all'));
    host.append(root);
  }
  function directory(host) {
    host.append(h('p',{class:'mini-note'},'首页最多九格，全部助理与停用的助理都在这里。'));
    host.append(h('button',{class:'ghostbtn','data-assistant-create-chat':'','data-new-bot-open':'',onClick:()=>{const c=chief();if(c)H.fillDraft(c.id,ASSISTANT_COPY.createPrompt);else H.toast(demoText("assistants.onClick.4"));}},'＋ 新建助理'));
    all().forEach(b=>host.append(h('button',{class:'setting-row r25-directory-row','data-assistant-profile':b.id,onClick:()=>openProfile(b.id)},[H.avatar(b.id),h('span',{class:'grow'},[h('strong',{},b.name),h('small',{},b.duty)]),h('small',{},b.enabled===false?'已停用':'启用')])));
  }
  function openLibrary(id) {
    const b=by(id);if(!b)return;
    H.sheet({title:'形象库',body:host=>{
      host.dataset.avatarLibrary=id;
      if(catalog().length)host.append(h('h3',{},'角色'));
      const grid=h('div',{class:'r25-avatar-pack-grid'});
      catalog().forEach(p=>{
        const owner=all().find(x=>x.avatar?.kind===p.kind&&x.avatar.id===p.id);
        grid.append(h('button',{class:'r25-avatar-choice','data-avatar-pack':p.id,'data-avatar-redistributable':String(p.redistributable),'aria-pressed':String(owner?.id===id),onClick:()=>preview(propose(id,{avatar:{kind:p.kind,id:p.id}}))},[
          H.fromHTML(imageHTML(p,'','library')),h('strong',{},p.displayName),h('small',{},owner?(owner.id===id?'当前形象':owner.name+' 在用 · 互换'):(p.motion?'可选':'可选 · 无动作'))
        ]));
      });if(catalog().length)host.append(grid);host.append(h('h3',{},'图形'));
      let selected=clone(b.avatar.kind==='shape'?b.avatar:defaultAvatar());
      const sample=h('div',{class:'r25-shape-preview'}),colors=h('div',{class:'r25-color-options'}),shapes=h('div',{class:'r25-shape-options'});
      function draw(){sample.replaceChildren(H.fromHTML(imageHTML(selected,'','preview')));colors.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.avatarColor===selected.color)));shapes.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.avatarShape===selected.shapeId)));}
      ASSISTANT_COLORS.forEach(color=>colors.append(h('button',{class:'r25-color-option','data-avatar-color':color,style:{background:color},'aria-label':'图形颜色 '+color,onClick:()=>{selected.color=color;draw();}})));
      ASSISTANT_SHAPES.forEach(s=>shapes.append(h('button',{'data-avatar-shape':s.id,'aria-label':s.name,onClick:()=>{selected.shapeId=s.id;draw();}},H.fromHTML(shapeHTML({...selected,shapeId:s.id},'','library')))));
      draw();host.append(sample,colors,shapes,h('button',{class:'ghostbtn','data-avatar-shape-preview':'',onClick:()=>preview(propose(id,{avatar:selected}))},'预览这个图形'),h('h3',{},'自己的图'));
      const file=h('input',{type:'file',accept:'image/*','data-avatar-upload':'','aria-label':'从相册或文件选图片或动图'});
      file.addEventListener('change',async()=>{const f=file.files?.[0];if(!f)return;try{const a=await readUpload(f);preview(propose(id,{avatar:a}));}catch(e){H.toast(e.message);}file.value='';});
      host.append(file,h('p',{class:'mini-note'},'可选图片或动图，单张最多 700 KB；只保存在本机浏览器，不上传。'),h('button',{class:'ghostbtn r25-draw-later','aria-disabled':'true',onClick:()=>H.toast('下一步接入')},demoText("assistants.body.5")));
    }});
  }
  async function readUpload(file) {
    if (!/^image\/(png|gif|jpeg|webp|avif)$/.test(file.type) || file.size>maxFile || file.size<=0) throw Error('请选择 700 KB 以内的 PNG、JPEG、GIF、WebP 或 AVIF。');
    const dataURL=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败，请重新选择。'));reader.readAsDataURL(file);});
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('图片无法打开，请换一个文件。'));img.src=dataURL;});
    if (!image.naturalWidth || !image.naturalHeight) throw Error('图片内容无效。');
    return {kind:'upload',dataURL,animated:file.type==='image/gif'||file.type==='image/webp',color:average(image)};
  }
  function average(image) {
    try {const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const c=canvas.getContext('2d');c.drawImage(image,0,0,16,16);const {data}=c.getImageData(0,0,16,16);let r=0,g=0,b=0,w=0;for(let i=0;i<data.length;i+=4){const a=data[i+3]/255;r+=data[i]*a;g+=data[i+1]*a;b+=data[i+2]*a;w+=a;}return w?'#'+[r,g,b].map(n=>Math.round(n/w).toString(16).padStart(2,'0')).join(''):ASSISTANT_COLORS[0];}catch(e){return ASSISTANT_COLORS[0];}
  }
  function askChief(actor,text,conversation) {
    const c=chief();H.postMessage(conversation,{from:actor,time:'刚刚',parts:[{type:'assistant-chief-required',data:{actor,chief:c?.id,original:text}}]});
  }
  function newDraft(actor,responsibility,excluded,original,conversation) {
    const duty=cut(responsibility.replace(/[。！？，,]/g,'').trim(),60)||ASSISTANT_COPY.newDuty;
    let stem=duty.replace(/^(?:负责|管理|管|专门)/,'').replace(/[的地]$/,'');
    let name=cut(stem,6)+'助理';if(all().some(b=>b.name===name))name=cut(stem,5)+(all().length+1)+'助理';
    let id;do{id='assistant-'+Date.now().toString(36)+'-'+(++sequence);}while(by(id));
    return propose(id,{name:cut(name),duty,description:'管：'+duty+'。不管：'+(excluded||ASSISTANT_COPY.excluded)+'。',quickReplies:['看看'+cut(duty,20)+'的进展','列出还缺的资料','哪些需要我确认'],avatar:defaultAvatar()},{create:true,actor,original,conversation});
  }
  function handleMessage(event) {
    if(event.quiet||event.message.from!=='user'||event.message.parts?.some(p=>p.type!=='text'))return;
    const text=event.message.parts.map(p=>p.md||'').join('\n').trim();
    const actor=H.conversationOwner(event.conversation);if(!by(actor))return;
    const reply=md=>H.postMessage(event.conversation,{from:actor,time:'刚刚',parts:[{type:'text',md}]});
    const emitDraft=d=>H.postMessage(event.conversation,{from:actor,time:'刚刚',parts:[{type:'assistant-change',data:d}]});
    const waiting=pending.get(event.conversation);
    const create=/((?:帮我|请|想|要|再)?(?:建|创建|新建|增加|要)一个|建一位|创建一位).*助理/.test(text);
    if(create){
      if(by(actor).role!=='chief')return askChief(actor,text,event.conversation);
      const match=text.match(/(?:管|负责)(.+?)(?:的助理|助理|[。；;]|$)/);
      pending.set(event.conversation,{original:text,responsibility:match?.[1]?.replace(/^[：:\s]+/,'').trim()||'',questions:1});
      return reply(match?.[1]?'它不管哪些事？说一句边界，我就给你确认卡。':'它主要管什么？');
    }
    if(waiting){
      if(!waiting.responsibility){waiting.responsibility=text;waiting.questions++;return reply('它不管哪些事？');}
      pending.delete(event.conversation);return emitDraft(newDraft(actor,waiting.responsibility,text,waiting.original,event.conversation));
    }
    const intent=/(名字.*(?:改成|改为|叫)|改名(?:为|成|叫)|换(?:个|一个|一张)?.*形象|也管|(?:职责|负责范围)(?:改成|改为))/.test(text);if(!intent)return;
    const named=all().filter(b=>text.includes(b.name)).sort((a,b)=>b.name.length-a.name.length)[0];
    const target=named||(/你|自己/.test(text)?by(actor):null);
    if(!target)return reply('请说清要调整哪位助理，名字按当前名册填写。');
    if(!canEdit(actor,target.id))return askChief(actor,text,event.conversation);
    try {
      let patch;
      const name=text.match(/(?:名字改成|名字改为|改名(?:为|成|叫)?|名字叫)[「“"']?([^。！？，,\n」”"']+)/);
      if(name) patch={name:name[1].trim()};
      else if(/换.*形象/.test(text)){
        const requested=catalog().find(p=>text.includes(p.displayName));
        const next=requested||catalog().find(p=>p.id!==target.avatar.id&&!all().some(b=>b.avatar?.id===p.id));
        patch={avatar:next?{kind:next.kind,id:next.id}:defaultAvatar()};
      }else{
        const addition=text.match(/也管\s*(.+?)(?:[。！]|$)/)?.[1]||text.match(/负责范围(?:改成|改为|是)?\s*(.+)/)?.[1];
        if(!addition)return reply('请说要改成什么名字、形象或职责。');
        patch={duty:cut(target.duty+'、'+addition,80),description:target.description+'\n也管：'+addition+'。'};
      }
      emitDraft(propose(target.id,patch,{actor,original:text,conversation:event.conversation}));
    }catch(e){reply(e.message);}
  }
  all().forEach(normalize);
  // 恢复仅接受可校验的展示字段；会话正文和审批内容不放入本机资料存储。
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(saved?.version===1&&Array.isArray(saved.rows)&&saved.rows.length<=100){
      const valid=saved.rows.filter(row=>{try{validate(row);return /^[a-z][\w-]*$/i.test(row.id);}catch(e){return false;}});
      const initial=all().filter(b=>b.initialAssistant);
      if(initial.some(b=>valid.find(r=>r.id===b.id)?.enabled!==false))valid.forEach(row=>{
        let b=by(row.id);if(!b&&row.custom)b=H.createBot({id:row.id,name:row.name,duty:row.duty,color:row.color});
        if(b){Object.assign(b,Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));normalize(b);syncIdentity(b);}
      });
    }
  }catch(e){/* 禁用存储或旧资料损坏时，保留默认名册。 */}
  H.registerCard('assistant-change',{title:'助理资料确认',render:letter,quoteLabel:d=>(d.create?'新建':'修改')+'助理：'+d.changes[0].after.name});
  H.registerCard('assistant-chief-required',{title:'请首席调整',render:d=>h('section',{class:'mcard r22-letter','data-assistant-chief-required':''},[
    h('p',{},'我可以调整自己；修改其他助理或新建助理，请找首席。'),h('button',{class:'ghostbtn','data-assistant-chief-jump':'',disabled:!d.chief,onClick:()=>H.fillDraft(d.chief,d.original)},'找'+(by(d.chief)?.name||'首席')+' · 带上原话')
  ])});
  H.registerView('assistant-profile',{title:'助理资料',icon:'profile',hidden:true,render:profileView});
  H.registerPanel('assistant-directory',{title:'助理',render:directory});
  H.registerMoreItem({id:'shell-assistants',label:'助理',onClick:()=>H.openPanel('assistant-directory')});
  H.on('message',handleMessage);
  H.on('bot-created',b=>{normalize(b);syncIdentity(b);chiefPet.rebind?.();});
  H.on('assistant-change',()=>chiefPet.rebind?.());
  document.addEventListener('click',e=>{
    const entry=e.target.closest('[data-assistant-profile]');if(entry){e.preventDefault();openProfile(entry.dataset.assistantProfile);}
    if(Date.now()<suppressPinClick&&e.target.closest('.pin')){e.preventDefault();e.stopImmediatePropagation?.();}
  },true);
  let hold=null;
  function cancelHold(){if(hold)clearTimeout(hold.timer);hold=null;}
  document.addEventListener('pointerdown',e=>{const pin=e.target.closest('.pin[data-id]');if(!pin||H.state.drawer||e.button>0)return;cancelHold();hold={x:e.clientX,y:e.clientY,timer:setTimeout(()=>{suppressPinClick=Date.now()+700;hold=null;openProfile(pin.dataset.id);},450)};});
  document.addEventListener('pointermove',e=>{if(hold&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>8)cancelHold();});
  ['pointerup','pointercancel'].forEach(type=>document.addEventListener(type,cancelHold));
  window.AssistantProfiles = {propose,preview,confirm,undo,openProfile,openLibrary,canEdit,catalog,appearanceName,avatarHTML,avatarSource,staticStage,readUpload,handleMessage,drafts,storageKey};
})();
