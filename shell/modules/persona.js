/* persona：音色、装扮与安静节律；保留原有入口。
 * 全部改动只在当前页内存，刷新复原；不接服务、不创建真实 bot。
 * 旧面板 ID 保留为精简的对话入口，今日视图 hidden 且只提供返回聊天。
 */
(function () {
  'use strict';
  const H = window.Hub;
  const h = H.h;
  const chiefRole = () => H.state.bots.find(b=>b.role==='chief'&&b.enabled!==false);
  const glyph = (name,options) => {const node=H.icon(name,options);node.classList.add('m-persona-icon');return node;};
  const avatars = demoFixture("persona.avatars.1");
  const voices = demoFixture("persona.voices.2");
  const models = demoFixture("persona.models.3");
  const S = {
    profiles:{}, adoptedVoices:{}, outfitSelections:{}, faces:{}, rhythm:'quiet',
    system:demoText("persona.system.4"), face:'开心', avatar:demoText("persona.avatar.5"), lip:'音量', mouth:true,
    zoom:'中景', background:'奶油', playing:null, pip:false, pipCorner:'右下', pet:false,
    theme:'跟随系统', accent:'柠檬黄', font:'标准', density:'舒适', avatarStyle:'插画',
    language:'简体中文', customerLanguage:'日本語', explainLanguage:'简体中文',
    voice:voices[0].name, speed:1, asr:'本地 ASR', wake:demoText("persona.wake.6"), input:'按住说话',
    caption:'简洁', bullet:true, bulletCount:0, stageStatus:'聆听', notice:true,
    dnd:demoText("persona.dnd.7"), noticeLog:[], haptic:true, gesture:true,
    offline:false, installStep:0, shortcut:null, aboutExpanded:false, guide:0,
    guideDone:false, collapsed:false, briefRead:false, briefVoice:false,
    sessionQuery:'', sessionScope:'进行中', sessionGroup:'按项目', exportName:'',
    nextSession:5, created:[], activeProject:demoText("persona.activeProject.8"),
    tabs:{studio:'预览', appearance:'外观', voice:'声音', misc:'通知'},
    sessions:demoFixture("persona.sessions.9"),
    projects:demoFixture("persona.projects.10"),
    wizard:demoFixture("persona.wizard.11")
  };

  const assistantIds=demoFixture("persona.assistantIds.12");
  const emotionMap={开心:'smile',思考:'think',抱歉:'sorry',惊讶:'surprise',挥手:'wave'};
  let selectedAssistant='chief';
  let seenBot=H.state.bot;
  const faceEpoch={};
  const demo='本页演示，未真实执行';
  const botName=id=>H.state.bots.find(b=>b.id===id)?.name||'助理';
  const currentOutfit=id=>H.currentOutfit(id);
  const outfitKind=o=>(demoFixture("persona.outfitKind.13")[o?.kind]||'SVG 占位');
  const faceOf=id=>{const face=S.faces[id]||currentOutfit(id)?.emotion;return Object.hasOwn(emotionMap,face)?face:'开心';};
  H.on('navigate',ctx=>{if(assistantIds.includes(ctx.bot.id))selectedAssistant=ctx.bot.id;});
  H.on('render',()=>{
    if(H.state.bot===seenBot)return;
    seenBot=H.state.bot;
    if(assistantIds.includes(seenBot))selectedAssistant=seenBot;
  });
  H.on('voice:adopted',event=>{
    if(!H.state.bots.some(b=>b.id===event?.bot)||typeof event.voiceName!=='string'||!event.voiceName.trim())return;
    S.adoptedVoices[event.bot]=event.voiceName.trim();
    document.querySelectorAll('[data-persona-voice]').forEach(el=>{
      if(el.dataset.personaVoice===event.bot)el.textContent=S.adoptedVoices[event.bot];
    });
  });
  H.on('outfit',event=>{
    if(!event?.bot)return;
    S.outfitSelections[event.bot]=event.outfitId;
    const face=currentOutfit(event.bot)?.emotion;
    S.faces[event.bot]=Object.hasOwn(emotionMap,face)?face:'开心';
  });
  function changeFace(botId,face,draw) {
    if(!Object.hasOwn(emotionMap,face))return;
    S.faces[botId]=face;
    const epoch=faceEpoch[botId]=(faceEpoch[botId]||0)+1;
    draw();
    // 仅结束一次挥手预览；不是节律调度器，不产生消息。
    if(face==='挥手')setTimeout(()=>{
      if(faceEpoch[botId]!==epoch||S.faces[botId]!=='挥手')return;
      S.faces[botId]='开心';draw();
    },900);
  }
  function wearOutfit(botId,outfitId) {
    const face=S.faces[botId];
    delete S.faces[botId];faceEpoch[botId]=(faceEpoch[botId]||0)+1;
    const result=H.setOutfit(botId,outfitId);
    if(!result&&face)S.faces[botId]=face;
    return result;
  }
  function outfitAvatar(botId,face=faceOf(botId),speaking=false) {
    const avatar=H.avatar(botId);
    // 仅改本模块里的 SVG 嘴型；图片/GIF 保留原图，真实模型尚未加载。
    const mouth=Array.from(avatar.querySelectorAll('path')).find(p=>p.getAttribute('d')==='M56 69q4 4 8 0');
    if(mouth)mouth.setAttribute('d',speaking?'M60 65a5 6 0 1 0 .1 0':{
      开心:'M56 69q4 4 8 0',思考:'M56 70h8',抱歉:'M56 72q4-4 8 0',
      惊讶:'M60 66a4 5 0 1 0 .1 0',挥手:'M56 69q4 4 8 0'
    }[face]||'M56 69q4 4 8 0');
    return avatar;
  }

  // 可复用的分组列表、分段控件与开关，所有交互保留在模块 DOM 内。
  const note = text => h('p', {class:'m-persona-note'}, text);
  const source = text => h('small', {class:'m-persona-source sticker'}, '来自：'+text+' · 本页演示');
  const btn = (text, run, primary=false) => h('button', {
    type:'button', class:'m-persona-btn '+(primary==='tertiary'?'btn-tertiary':primary?'btn-primary m-persona-primary':'btn-secondary'), onClick:run
  }, text.replace(/(\d)\s+(?=[个条项分倍])/g,demoText("persona.btn.14")));
  function card(title,children,level='L1') {
    const head=h('h3',{class:'m-persona-card-head pop-card-head'},h('span',{class:'m-persona-card-title'},title));
    const root=h('section',{class:'m-persona-card pop-card'},[head,children]);
    const sticker=root.querySelector('[data-level-sticker]')||(root.querySelector('button')?
      H.levelSticker(level,{action:title,scope:'本页演示 · 刷新复原',bot:H.state.bot}):null);
    if(sticker)head.append(sticker);
    return root;
  }
  const row = (label, value, detail) => h('div', {class:'m-persona-row'}, [
    h('div', {class:'m-persona-grow'}, [h('strong',{},label), detail ? h('small',{},detail) : null]),
    h('span', {class:'m-persona-value badge'}, value)
  ]);
  const list = rows => h('div', {class:'m-persona-list'}, rows);
  function field(label, value, change, multiline=false) {
    return h('label', {class:'m-persona-field field'}, [h('span',{},label), h(multiline?'textarea':'input', {
      class:'pop-input', value, rows:multiline?3:undefined, onInput:event=>change(event.target.value)
    })]);
  }
  function segment(label, options, value, change) {
    return h('div', {class:'m-persona-control'}, [
      h('span', {class:'m-persona-label'}, label),
      h('div', {class:'m-persona-segments segmented', role:'group', 'aria-label':label}, options.map(option=>h('button', {
        type:'button', class:'m-persona-segment'+(option===value?' on':''), 'aria-pressed':String(option===value),
        onClick:()=>{change(option);if(option===value)H.toast(demo+' · '+label+'已选用「'+option+'」。');}
      }, option)))
    ]);
  }
  function toggle(label, value, change, detail) {
    return h('div', {class:'m-persona-row toggle-row'}, [
      h('div', {class:'m-persona-grow'}, [h('strong',{},label), detail?h('small',{},detail):null]),
      h('button', {type:'button', role:demoText("persona.role.15"), 'aria-checked':String(value), 'aria-label':label,
        class:demoText("persona.class.16")+(value?' on':''), onClick:()=>change(!value)}, h('i',{class:'m-persona-knob'}))
    ]);
  }
  function progress(label, value, max) {
    return h('div', {class:'m-persona-progress'}, [
      note(label+' · '+value+' / '+max),
      h('div', {class:'m-persona-track', role:'progressbar', 'aria-label':label,
        'aria-valuemin':0, 'aria-valuemax':max, 'aria-valuenow':value},
      h('i', {style:{width:(100*value/max)+'%'}}))
    ]);
  }
  function redraw(container, renderer) {
    container.replaceChildren();
    renderer(container);
  }
  function tabs(key, options, draw) {
    return segment('内容分区', options, S.tabs[key], value=>{S.tabs[key]=value;draw();});
  }
  function page(container, title, botId=H.state.bot) {
    const root = h('div', {class:'m-persona-root', style:H.botStyle(botId)}, [
      H.pageTitle(title,'本页演示')
    ]);
    container.append(root);
    if (S.pip || S.pet) root.append(floatingZone());
    return root;
  }
  function steps(labels, current) {
    return h('ol', {class:'m-persona-steps', 'aria-label':'步骤'}, labels.map((label,index)=>
      h('li', {class:'m-persona-step', 'aria-current':index===current?'step':null,
        dataset:{done:index<current}}, [h('span',{},index<current?glyph('check',{fill:true}):index+1),h('small',{},label)])));
  }
  function profile(bot) {
    const id = bot.id || 'chief';
    const ids = demoFixture("persona.ids.17");
    const index = Math.max(0,ids.indexOf(id));
    if(S.profiles[id]){const current=H.state.bots.find(b=>b.id===id)||bot;S.profiles[id].name=current.name;S.profiles[id].duty=current.duty;}
    return S.profiles[id] || (S.profiles[id] = {
      name:bot.name || '助理', duty:bot.duty || demoFixture("persona.duty.18")[index],
      summary:'先列来源与未知，再给下一步；外发与付费生成等待单独授权。',
      model:bot.brain || models[index%models.length], strength:index===3?'高':'中',
      tools:['知识库只读','工作区文件'], workspace:'/demo/'+demoFixture("persona.workspace.19")[index],
      skills:'项目整理、来源核对、交接', avatar:avatars[index].name, memory:3.8+index*.6,
      messages:28+index*7, tasks:6+index, tokens:18600+index*2400, minutes:42+index*9,
      saved:0, todayExpanded:false
    });
  }
  function metrics(p) {
    return h('div', {class:'m-persona-metrics'}, [
      ['消息',p.messages+'\u00a0条'],['任务',p.tasks+'\u00a0项'],['Token',(p.tokens/1000).toFixed(1)+'k'],['用时',p.minutes+'\u00a0分钟']
    ].map(x=>h('div',{},[h('strong',{},x[1]),h('small',{},x[0])])));
  }

  
  function character(name=S.avatar, face=S.face, options={}) {
    const a = avatars.find(item=>item.name===name) || avatars[0];
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 180 190');
    svg.setAttribute('role','img');
    svg.setAttribute('aria-label',name+' · '+face+(options.vrm?demoText("persona.sample.20"):''));
    const color = 'var(--'+a.color+')';
    let head = '<path d="M42 85 Q35 20 88 22 Q148 20 140 130 L40 130Z" fill="'+color+'"/>';
    if (a.kind==='cat') head='<path d="M38 86 L35 27 L69 49 Q90 38 111 49 L145 27 L141 95Z" fill="'+color+'"/>';
    if (a.kind==='fox') head='<path d="M31 95 L25 20 L73 52 L110 52 L155 20 L150 100 L90 148Z" fill="'+color+'"/>';
    if (a.kind==='robot') head='<rect x="30" y="41" width="120" height="100" rx="28" fill="'+color+'"/><path d="M90 41V22" stroke="'+color+'" stroke-width="7"/><circle cx="90" cy="17" r="8" fill="var(--bot)"/>';
    if (a.kind==='owl') head='<path d="M32 45 L65 55 Q90 36 116 55 L148 45 L142 125 Q90 159 38 125Z" fill="'+color+'"/>';
    if (a.kind==='sprite') head='<path d="M35 91 Q22 37 68 46 Q70 15 98 13 Q100 42 127 47 Q163 60 141 113 L41 128Z" fill="'+color+'"/>';
    const eyes = face==='开心' || face==='挥手'
      ? demoText("persona.eyes.21")
      : '<circle cx="70" cy="83" r="'+(face==='惊讶'?6:4)+'" fill="var(--ink)"/><circle cx="110" cy="83" r="'+(face==='惊讶'?6:4)+'" fill="var(--ink)"/>';
    const mouths = {开心:'M68 106 Q90 128 112 106', 思考:'M80 113 H101', 抱歉:'M73 118 Q90 103 107 118', 惊讶:'M90 106 a8 10 0 1 0 .1 0', 挥手:'M68 106 Q90 128 112 106'};
    const mouth = options.speaking
      ? '<ellipse cx="90" cy="111" rx="'+(S.lip==='音素'?8:15)+'" ry="'+(S.lip==='音素'?12:6)+'" fill="var(--blush-ink)"/>'
      : '<path d="'+mouths[face]+demoText("persona.mouth.22");
    svg.innerHTML = '<ellipse cx="90" cy="174" rx="60" ry="8" fill="var(--fill)"/>'+
      demoText("persona.sample.23")+color+'"/>'+head+'</g>'+
      demoText("persona.sample.24")+ 
      '<ellipse cx="90" cy="88" rx="48" ry="49" fill="var(--elev)"/>'+eyes+
      '<ellipse cx="57" cy="99" rx="10" ry="5" fill="var(--blush)"/><ellipse cx="123" cy="99" rx="10" ry="5" fill="var(--blush)"/>'+mouth+
      (face==='思考'?'<path d="M99 63l20-5" stroke="var(--ink)" stroke-width="3"/><circle cx="139" cy="28" r="10" fill="var(--bot-soft)"/>':'')+
      (face==='抱歉'?'<path d="M58 62l18 6M104 68l18-6" stroke="var(--ink)" stroke-width="3"/>':'')+
      (face==='挥手'?'<path d="M128 150 Q157 133 154 95" fill="none" stroke="'+color+demoText("persona.sample.25"):'')+
      (options.vrm?'<path d="M90 23V177M43 88H138M55 52L126 124M125 52L55 124M47 174L90 135L133 174" fill="none" stroke="var(--bot-strong)" stroke-width="1" stroke-dasharray="4 4"/>':'');
    return svg;
  }
  function avatarChoices(value, change) {
    return h('div', {class:'m-persona-avatar-grid'}, avatars.map(a=>h('button', {
      type:'button', class:'m-persona-avatar-choice btn-secondary', 'aria-pressed':String(a.name===value),
      onClick:()=>{change(a.name);if(a.name===value)H.toast(demo+' · 当前角色草图为「'+a.name+'」；装扮需另点换上。');}
    }, [character(a.name,'开心'),h('strong',{},a.name),h('small',{},a.system+' · '+a.license)])));
  }
  function outfitControls(botId,draw) {
    const outfits=H.outfits(botId),current=currentOutfit(botId);
    const selected=outfits.find(o=>o.id===S.outfitSelections[botId])||current||outfits[0];
    const root=h('div',{class:'m-persona-outfits','data-persona-outfits':botId});
    // 装扮按钮沿用契约选择器，但阻止舞台的 document 代理重复处理。
    const local=fn=>event=>{event.stopPropagation?.();fn();};
    root.append(h('div',{class:'m-persona-actions','aria-label':botName(botId)+'的装扮'},outfits.map(o=>
      h('button',{type:'button',class:'m-persona-btn ghostbtn','data-outfit':o.id,
        'aria-pressed':String(o.id===current?.id),'data-outfit-selected':String(o.id===selected?.id),
        onClick:local(()=>{S.outfitSelections[botId]=o.id;draw();if(o.id===selected?.id)H.toast(demo+' · 已选中「'+o.name+'」，点「换上」应用到本页形象。');})},[
        h('span',{class:'m-persona-outfit-thumb','aria-hidden':'true'},o.kind==='gif'?'GIF':'◇'),
        h('span',{},o.name+(o.starred?' · 已收藏':''))
      ]))),
      h('p',{class:'m-persona-note','data-outfit-status':'',role:'status'},
        '正在穿：'+(current?.name||'默认占位')+' · '+outfitKind(current)+' · 许可：'+(current?.license?.trim()||'未写许可')+
        (selected&&selected.id!==current?.id?'\n待换：'+selected.name+' · 许可：'+(selected.license?.trim()||'未写许可'):'')));
    const wear=h('button',{type:'button',class:'m-persona-btn btn-primary','data-outfit-wear':selected?.id||'',
      disabled:!selected?.license?.trim(),onClick:local(()=>{
        if(!selected?.license?.trim())return;
        if(!wearOutfit(botId,selected.id))return H.toast('未换上：请先补齐装扮许可。');
        H.toast(demo+'：已换上 '+selected.name+'，头像、舞台和画中画共用这一套。');
      })},'换上');
    const star=h('button',{type:'button',class:'m-persona-btn ghostbtn','data-outfit-star':selected?.id||'',
      disabled:!selected,'aria-pressed':String(!!selected?.starred),onClick:local(()=>{
        const entry=H.state.bots.find(b=>b.id===botId)?.outfits?.find(o=>o.id===selected?.id);
        if(!entry)return H.toast('当前装扮已不存在，请重新打开形象工坊。');
        entry.starred=!entry.starred;draw();H.toast(demo+'：收藏仅保存在本页。');
      })},selected?.starred?'已收藏':'收藏');
    root.append(h('div',{class:'m-persona-actions'},[wear,star]));
    if(current&&S.faces[botId]&&faceOf(botId)!==(current.emotion||'开心'))root.append(
      h('button',{type:'button',class:'m-persona-btn ghostbtn','data-outfit-save':current.id,
        disabled:!current.license?.trim(),onClick:local(()=>{
          const entry=H.state.bots.find(b=>b.id===botId)?.outfits?.find(o=>o.id===current.id);
          if(!entry?.license?.trim())return;
          entry.emotion=faceOf(botId);entry.emotionMap={...emotionMap};draw();H.toast(demo+'：表情已存回这套。');
        })},'存回这套'));
    if(!outfits.length)root.append(note('这个 bot 暂无装扮槽；未加载外部模型。'));
    root.append(H.levelSticker('L1',{action:'切换或收藏本页装扮',scope:botName(botId)+' · 刷新复原',bot:botId}),
      note(demo+demoText("persona.sample.26")));
    return root;
  }
  function profileView(container, bot) {
    const p = profile(bot);
    const draw = ()=>redraw(container,c=>profileView(c,bot));
    const root = page(container,'资料与人设',bot.id);
    root.append(card('助理资料卡',[
      h('div',{class:'m-persona-identity'},[h('div',{class:'m-persona-shared-avatar'},outfitAvatar(bot.id)),h('div',{},[h('h2',{},p.name),note(p.duty)])]),
      note(p.summary),
      list([row('大脑',bot.brain||p.model,'仅展示，不在这里配置模型'),
        row('可派工人',(Array.isArray(bot.workers)?bot.workers.join(' · '):bot.workers||demoText("persona.sample.27")),'展示候选，不表示已派工'),
        row('当前形象',currentOutfit(bot.id)?.name||p.avatar,'与头像、舞台、画中画共用装扮'),
        h('div',{class:'m-persona-row'},[h('strong',{},'声音'),
          h('span',{class:'m-persona-value badge','data-persona-voice':bot.id},S.adoptedVoices[bot.id]||'未采用训练音色')])]),
      note('声音仅为本页采用记录；播放引擎未接通。'),
      outfitControls(bot.id,draw),
      segment('表情 / 动作',Object.keys(emotionMap),faceOf(bot.id),v=>changeFace(bot.id,v,()=>{if(container.isConnected)draw();})),
      note(botName(bot.id)+' · '+faceOf(bot.id)+'\n表情由控件或表情指令切换，聊天正文不会换脸。'),
      btn('打开形象工坊',()=>{selectedAssistant=bot.id;H.openPanel('persona-studio');},true),
      btn('外观预览',()=>H.openPanel('persona-appearance-panel')),
      btn('新建只读 bot 草稿',()=>H.runCapability('persona-bot-drafts','新建只读项目助理草稿')),
      btn('复制此 bot 为草稿',()=>{S.copySource={...p,tools:p.tools.slice()};H.runCapability('persona-bot-drafts','复制当前 bot 为只读草稿');}),
      note('先在首席对话里审草案，确认后才创建本页 bot；未连接真实服务。')
    ]),card('今日工作量',[
      note(demoText("persona.sample.28")),metrics(p),
      btn(demoText("persona.sample.29"),()=>H.runCapability('persona-today','看看今日待看事项'))
    ]));
  }

  function previewStage(botId=selectedAssistant) {
    const outfit=currentOutfit(botId),face=faceOf(botId);
    const stage=h('div',{class:'m-persona-stage',dataset:{background:S.background,zoom:S.zoom}},[
      h('div',{class:'m-persona-stage-meta'},[
        h('span',{class:'m-persona-status sticker bot'},[glyph('sparkle'),S.stageStatus+' · 演示']),h('small',{},S.system+' / '+S.lip)
      ]),
      h('div',{class:'m-persona-actor','data-persona-emotion':face},outfitAvatar(botId,face,S.mouth&&S.stageStatus==='说话')),
      h('div',{class:'m-persona-subtitle',dataset:{style:S.caption}},[
        h('strong',{},botName(botId)+' · '+face),
        note((outfit?.name||'默认占位')+'\n'+(S.caption==='双语'?demoText("persona.stage.30"):'我把今天需要你看的事项整理好了。'))]),
      S.bullet&&S.bulletCount?h('div',{class:'m-persona-bullet',key:S.bulletCount},'演示通知 #'+S.bulletCount+demoText("persona.stage.31")):null
    ]);
    return stage;
  }
  function studio(container) {
    const draw=()=>redraw(container,studio);
    const root=page(container,'形象工坊',selectedAssistant);
    const id=selectedAssistant;
    root.append(source(demoText("persona.sample.32")),tabs('studio',['预览','形象库','许可与绑定'],draw));
    root.append(segment('正在预览的助理',assistantIds.map(botName),botName(id),value=>{
      selectedAssistant=assistantIds.find(b=>botName(b)===value)||id;draw();
    }));
    if(S.tabs.studio==='预览') root.append(card('角色、表情与动作',[
      segment('形象系统',demoFixture("persona.sample.33"),S.system,v=>{S.system=v;draw();}),outfitControls(id,draw),previewStage(id),
      note((currentOutfit(id)?.name||'默认占位')+' · '+faceOf(id)+' · '+S.zoom+' · '+S.background),
      segment('表情 / 动作',Object.keys(emotionMap),faceOf(id),v=>changeFace(id,v,()=>{if(container.isConnected)draw();})),
      segment('对话状态',['连接中','聆听','思考','说话'],S.stageStatus,v=>{S.stageStatus=v;draw();}),
      btn('打断回复',()=>{S.stageStatus='聆听';S.mouth=false;draw();H.toast(demo+' · 回复预览已打断，口型已闭合，当前为聆听状态。');}),
      segment('口型模式',['音素','音量'],S.lip,v=>{S.lip=v;S.mouth=true;S.stageStatus='说话';draw();}),
      btn(S.mouth?'闭合口型':'演示张嘴',()=>{S.mouth=!S.mouth;S.stageStatus='说话';draw();}),
      segment('镜头远近',['近景','中景','远景'],S.zoom,v=>{S.zoom=v;draw();}),
      segment('背景',['奶油','简洁','透明'],S.background,v=>{S.background=v;draw();}),
      note(demo+demoText("persona.sample.34")),
      toggle('画中画',S.pip,v=>{S.pip=v;draw();},'沿用四角吸附，读取当前 bot 的装扮。'),
      btn('进入舞台',()=>H.navigate({view:'stage',bot:id})),
      btn('选择其他角色',()=>{S.tabs.studio='形象库';draw();},true)
    ]));
    if(S.tabs.studio==='形象库') root.append(card('形象库 · 6\u00a0个角色',[
      note('点选下方角色只改草图。\n要更换助理装扮，请用本区装扮条，选好后点「换上」。'),avatarChoices(S.avatar,v=>{S.avatar=v;draw();}),
      row('当前选择',S.avatar),row('默认系统',avatars.find(a=>a.name===S.avatar).system),row('绑定范围','单个 bot，支持分别绑定'),
      character(S.avatar,'开心'),outfitControls(id,draw),
      btn('返回当前装扮预览',()=>{S.tabs.studio='预览';draw();},true)
    ]));
    if(S.tabs.studio==='许可与绑定') root.append(card('每位助理的形象绑定',[
      ...demoFixture("persona.sample.35").map((id,index)=>{
        const p=profile(H.state.bots.find(b=>b.id===id));
        return h('div',{class:'m-persona-binding',style:H.botStyle(id)},[row(botName(id),currentOutfit(id)?.name||p.avatar),
          btn('查看这位助理的装扮',()=>{selectedAssistant=id;S.tabs.studio='预览';draw();})]);
      }),
      note('选择形象：'+S.avatar+' · '+avatars.find(a=>a.name===S.avatar).license),
      list([row('SVG 占位','本页绘制','仅验证界面交互，无第三方模型文件'),row(demoText("persona.sample.36"),'未导入','需核对作者、商用与再分发许可'),row(demoText("persona.sample.37"),'未导入','需核对人格、商用与改造范围')]),
      source(demoText("persona.sample.38")),note('历史网页脸联调不代表当前设备在线或正式模型许可通过。')
    ]));
  }

  // 画中画用 Pointer Events 支持触屏拖动；只在模块内容区内吸附四角。
  function floatingZone() {
    const botId=selectedAssistant,outfit=currentOutfit(botId);
    const zone=h('div',{class:'m-persona-floating-zone','aria-label':'模块内画中画拖动区域'},[
      note((S.pet?'桌宠':'画中画')+' · 拖拽或用四角按钮移动')
    ]);
    const pip=h('div',{class:'m-persona-pip glass pop-shadow',dataset:{corner:S.pipCorner}},[
      h('button',{type:'button',class:'m-persona-drag-handle','aria-label':'拖动画中画，方向键吸附四角',
        onClick:()=>H.toast(demo+' · 画中画当前在'+S.pipCorner+'；拖拽、方向键或下方四角按钮可移动。'),
        onKeydown:event=>{
          if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
          event.preventDefault();
          let vertical=S.pipCorner.includes('上')?'上':'下';
          let horizontal=S.pipCorner.includes('左')?'左':'右';
          if(event.key==='ArrowUp')vertical='上';if(event.key==='ArrowDown')vertical='下';
          if(event.key==='ArrowLeft')horizontal='左';if(event.key==='ArrowRight')horizontal='右';
          snap(horizontal+vertical);
        }
      },[outfitAvatar(botId),h('small',{},(S.pet?'桌宠 · ':'画中画 · ')+botName(botId)+' · '+(outfit?.name||'默认占位'))])
    ]);
    let drag=null;
    const handle=pip.firstElementChild;
    function snap(corner) {
      S.pipCorner=corner;pip.dataset.corner=corner;
      pip.style.left='';pip.style.top='';pip.style.right='';pip.style.bottom='';
      status.textContent='位置：'+corner+' · 跟随形象预览区';
      H.toast(demo+' · 画中画已吸附到'+corner+'。');
    }
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==undefined && event.button!==0)return;
      const bounds=zone.getBoundingClientRect(), rect=pip.getBoundingClientRect();
      drag={id:event.pointerId,dx:event.clientX-rect.left,dy:event.clientY-rect.top,bounds};
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove',event=>{
      if(!drag || event.pointerId!==drag.id)return;
      const x=Math.max(8,Math.min(zone.clientWidth-pip.offsetWidth-8,event.clientX-drag.bounds.left-drag.dx));
      const y=Math.max(38,Math.min(zone.clientHeight-pip.offsetHeight-8,event.clientY-drag.bounds.top-drag.dy));
      pip.style.left=x+'px';pip.style.top=y+'px';pip.style.right='auto';pip.style.bottom='auto';
    });
    function finish(event) {
      if(!drag || event.pointerId!==drag.id)return;
      const bounds=zone.getBoundingClientRect(), rect=pip.getBoundingClientRect();
      drag=null;
      snap((rect.left+rect.width/2 < bounds.left+bounds.width/2?'左':'右')+(rect.top+rect.height/2 < bounds.top+bounds.height/2?'上':'下'));
      if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
    }
    handle.addEventListener('pointerup',finish);
    handle.addEventListener('pointercancel',finish);
    zone.append(pip);
    const status=h('p',{class:'m-persona-note',role:'status'},'位置：'+S.pipCorner+' · 跟随形象预览区');
    return h('section',{class:'m-persona-float-card pop-card'},[zone,
      h('div',{class:'m-persona-actions'},['左上','右上','左下','右下'].map(corner=>btn(corner,()=>snap(corner)))),status]);
  }
  function appearance(container) {
    const draw=()=>redraw(container,appearance);
    const root=page(container,'外观');
    {
      const colors=[['柠檬黄','lemon'],['番茄红','tomato'],['天蓝','sky'],['薄荷绿','mint']];
      const preview=h('div',{class:'m-persona-chat-preview',dataset:{theme:S.theme,font:S.font,density:S.density}},[
        h('div',{class:'m-persona-preview-avatar'},S.avatarStyle==='文字'?h('strong',{},'雪'):character(S.avatarStyle==='简洁'?'简洁助手':S.avatar,'开心')),
        h('p',{class:'m-persona-bubble',style:{borderInlineStart:'4px solid var(--'+colors.find(x=>x[0]===S.accent)[1]+')'}},demoText("persona.preview.39")),
        h('small',{},S.theme+' · '+S.accent+' · '+S.font+'字号 · '+S.density+'间距')
      ]);
      root.append(card('外观 · 即时预览',[
        segment('主题候选',['浅色','深色','跟随系统'],S.theme,v=>{S.theme=v;draw();}),
        h('div',{class:'m-persona-control'},[h('span',{class:'m-persona-label'},'强调色'),h('div',{class:'m-persona-swatches'},colors.map(x=>h('button',{
          type:'button',class:'m-persona-swatch btn-secondary','aria-pressed':String(S.accent===x[0]),onClick:()=>{const same=S.accent===x[0];S.accent=x[0];draw();if(same)H.toast(demo+' · 预览强调色已选用「'+x[0]+'」。');}
        },[h('i',{style:{background:'var(--'+x[1]+')'}}),x[0]])))]),
        segment('字号',['小','标准','大'],S.font,v=>{S.font=v;draw();}),
        segment('气泡密度',['紧凑','舒适','宽松'],S.density,v=>{S.density=v;draw();}),
        segment('头像风格',['插画','简洁','文字'],S.avatarStyle,v=>{S.avatarStyle=v;draw();}),
        preview,list([row('影响范围','本模块预览'),row('壳主题','沿用壳当前设置'),row('刷新后','恢复默认')]),
        btn('恢复预览默认',()=>{S.theme='跟随系统';S.accent='柠檬黄';S.font='标准';S.density='舒适';S.avatarStyle='插画';draw();H.toast(demo+' · 外观预览已恢复默认主题、强调色、字号、间距和头像风格。');})
      ]));
    }
    root.append(card('语言与声音',[
      note('用一句话修改本页偏好；真实界面翻译与语音服务尚未接入。'),
      capabilityButton('persona-languages',0),capabilityButton('persona-voice',0)
    ]));
  }

  // 草案只含展示元数据。主色取壳中当前 bot，不引入独立色板或私密占位值。
  function botDraft(options={}) {
    const base=H.state.bots.find(b=>b.id===(options.parent||chiefRole()?.id));
    return {name:options.name||'专项观察员',duty:options.duty||'整理指定主题的公开线索，保留来源与待确认事项',
      color:base.color,brain:demoText("persona.brain.40"),tools:['公开资料只读','本页记忆'],
      workers:demoFixture("persona.workers.41"),permission:'L0 · 只读',...options};
  }
  function flightDraft(text) {
    return botDraft(/机票|航班/.test(text)?demoFixture("persona.sample.42"):{});
  }
  function draftParts(draft) {
    return [{type:'text',md:'演示，未真实执行。先审阅职责、大脑、工具、工人与权限；确认只创建本页 bot，刷新复原。'},
      {type:'cards-a-bot-draft',data:draft}];
  }
  const chiefConversations=new Map([[chiefRole()?.id+'-013',chiefRole()?.id],['persona-bot-creation-demo',chiefRole()?.id]]);
  const draftRequests=new Set();
  H.on('navigate',ctx=>{chiefConversations.set(ctx.conversation,ctx.bot.id);});
  H.on('message',event=>{
    const m=event.message;
    const actor=H.state.bots.find(b=>b.id===chiefConversations.get(event.conversation));
    if(m.from!=='user'||actor?.role!=='chief')return;
    const text=(m.parts||[]).filter(p=>p.type==='text').map(p=>p.md||'').join('\n');
    if(!/要一个[^\n]*?\bbot\b/i.test(text))return;
    const key=event.conversation+':'+m.id;
    if(draftRequests.has(key))return;
    draftRequests.add(key); // postMessage 同步再次触发 message，先记请求再回复。
    const draft=flightDraft(text);S.created.push({...draft});
    H.postMessage(event.conversation,{from:actor.id,time:'刚刚',parts:draftParts(draft)});
  });
  H.registerConversation(chiefRole().id,{id:'persona-bot-creation-demo',title:'跟首席说一句 · 新 bot 草案演示',messages:[
    {from:'user',time:'演示',parts:[{type:'text',md:'我要一个专门盯机票的 bot'}]},
    {from:chiefRole().id,time:'演示',parts:draftParts(flightDraft('机票'))}
  ]});

  H.fixedTasks().forEach(task=>{
    const memo=FIXED_TASK_MEMORY[task.taskId];if(!memo)return;
    task.memoryConversation='persona-'+task.taskId+'-memory';
    H.registerConversation(task.ownerAssistantId,{id:task.memoryConversation,taskId:task.taskId,title:H.fixedTaskTitle(task)+' · 独立记忆',messages:[
      {from:'user',time:'原始演示',parts:[{type:'text',md:'这个固定任务负责什么？'}]},
      {from:task.ownerAssistantId,time:'原始演示',parts:[{type:'text',md:'任务说明与独立记忆：'+memo+'\n演示，未真实执行；刷新复原。'}]}
    ]});
  });
  function subBotTab(container,bot){
    const root=h('div',{class:'m-persona-root'});root.append(note('固定任务由当前助理负责，沿用它的头像；说明与独立记忆各自保留。'));
    H.fixedTasks(bot.id).forEach(task=>root.append(card(H.fixedTaskTitle(task),[
      H.avatar(task.ownerAssistantId),note(task.note),note(task.status==='paused'?'已暂停':'可协作'),
      btn('打开会话',()=>H.navigate({view:'chat',conversation:task.conversation})),
      task.memoryConversation?btn('任务独立记忆',()=>H.navigate({view:'chat',conversation:task.memoryConversation})):null,
      btn(task.status==='paused'?'恢复':'暂停',()=>{H.setFixedTaskStatus(task.taskId,task.status==='paused'?'active':'paused');redraw(container,c=>subBotTab(c,bot));})
    ],'L1')));
    root.append(btn('新建固定任务',()=>H.newFixedTaskSheet(bot.id),true));container.append(root);
  }
  const capabilities = [
    {id:'persona-bot-drafts',title:'新建与复制 bot',icon:'plus',steward:'chief',group:'助理',
      oneLine:'跟首席说要什么 bot，审阅草案后创建本页只读演示。',
      phrases:['新建只读项目助理草稿','复制当前 bot 为只读草稿','看看本页 bot 草稿'],
      status:()=>[{label:'草稿',value:S.created.length+'\u00a0个'},{label:'范围',value:'确认后仅本页'}],
      act:i=>{
        if(i===2)return '本页共有 '+S.created.length+'\u00a0个草稿：'+(S.created.map(p=>p.name).join('、')||'暂无')+'。';
        const p=i===1?(S.copySource||profile(demoFixture("persona.p.43"))):null;
        const draft=botDraft({name:p?p.name+' 副本':'项目助理草稿 '+(S.created.length+1),
          duty:p?p.duty:'整理证据、待确认事项与下一步',tools:p?p.tools.slice():['知识库只读']});
        S.created.push(draft);
        return '已拟好「'+draft.name+'」。演示，未真实执行；在下方草案卡确认后才创建本页 bot，刷新复原。';
      }},
    {id:'persona-voice',title:'声音与语音偏好',icon:'wave',steward:'machine-steward',group:'本地体验',
      oneLine:'通过对话选择音色、语速和文字输入偏好。',
      phrases:demoFixture("persona.phrases.44"),
      status:()=>[{label:'音色',value:S.voice},{label:'语速',value:S.speed.toFixed(1)+'×'},{label:'输入',value:S.input}],
      act:i=>{if(i===0)S.voice=voices[0].name;if(i===1)S.speed=.9;if(i===2){S.input='仅文字';S.asr='关闭';}
        return '已修改本页语音偏好。语音合成与识别尚未接入；未播放音频，也未请求麦克风。';}},
    {id:'persona-languages',title:'多语言偏好',icon:'chat',steward:'chief',group:'偏好',
      oneLine:'对客草稿与内部说明的语言分别调整。',
      phrases:['恢复对客日文、内部中文','把样张语言改成日语','把样张语言改成英语'],
      status:()=>[{label:'样张',value:S.language},{label:'对客',value:S.customerLanguage},{label:'说明',value:S.explainLanguage}],
      act:i=>{if(i===0){S.customerLanguage='日本語';S.explainLanguage='简体中文';}else S.language=i===1?'日本語':'English';
        return '已改本页语言候选；不会翻译整个壳，也没有发送任何对客内容。';}},
    {id:'persona-sessions',title:'会话整理',icon:'branch',steward:'chief',group:'工作整理',
      oneLine:'对话中置顶、归档和恢复虚构示例会话。',
      phrases:demoFixture("persona.phrases.45"),
      status:()=>[{label:'进行中',value:S.sessions.filter(s=>!s.archived).length+'\u00a0个'},{label:'归档',value:S.sessions.filter(s=>s.archived).length+'\u00a0个'}],
      act:i=>{if(i===0)S.sessions[0].pinned=true;else S.sessions[1].archived=i===1;
        return i===0?demoText("persona.act.46"):demoText("persona.act.47")+(i===1?'归档':'恢复')+'；未改变壳聊天历史。';}},
    {id:'persona-workspaces',title:'工作区与项目',icon:'folder',steward:'machine-steward',group:'工作整理',
      oneLine:'说出项目，切换当前工作区候选并核对范围。',
      phrases:demoFixture("persona.phrases.48"),
      status:()=>[{label:'预览',value:S.activeProject},{label:'候选',value:S.projects.length+'\u00a0个'}],
      act:i=>{S.activeProject=demoFixture("persona.act.49")[i];const p=S.projects.find(p=>p.name===S.activeProject);
        return '已切换本页候选到 '+p.name+'，示例工作区位于'+p.machine+'。规则：'+p.rule+'。未访问目录、未连接机器、未切换壳项目。';}},
    {id:'persona-notifications',title:'通知与勿扰',icon:'clock',steward:'schedule-steward',group:'偏好',
      oneLine:'用对话控制本页提醒与勿扰候选。',
      phrases:['关闭本页演示通知','开启本页演示通知','设为夜间十点到八点勿扰'],
      status:()=>[{label:'演示通知',value:S.notice?'开':'关'},{label:'勿扰',value:S.dnd}],
      act:i=>{if(i<2)S.notice=i===1;else S.dnd=demoText("persona.act.50");return '本页提醒偏好已改好；未调用系统通知权限，勿扰未绑定系统时钟。';}},
    {id:'persona-mobile',title:'手机使用引导',icon:'play',steward:'machine-steward',group:'本地体验',
      phrases:demoFixture("persona.phrases.51"),
      oneLine:'按手机类型给出简短步骤，手势提示也能一句关闭。',
      status:()=>[{label:'手势提示',value:S.gesture?'开':'关'},{label:'PWA',value:'未注册'}],
      act:i=>{if(i===2){S.gesture=false;return '本页手势提示已关闭；壳长按菜单和看板拖动保留。';}
        return i===0?'用 Safari 打开样张，分享 → 添加到主屏幕；未执行安装，本演示未注册 PWA。':'在浏览器菜单找安装 / 添加到主屏幕，以当前浏览器菜单为准；未执行安装。';}},
    {id:'persona-shortcuts',title:'快捷键说明',icon:'tools',steward:'machine-steward',group:'使用帮助',
      oneLine:'需要哪种操作，就问对应的快捷键。',
      phrases:['怎么搜索会话','怎么关闭面板','怎么用键盘移动焦点'],
      status:()=>[{label:'新增全局按键',value:'0\u00a0个'},{label:'范围',value:'沿用壳'}],
      act:i=>['用 ⌘ / Ctrl + K 打开壳会话搜索。','用 Esc 关闭面板。','Tab / Shift + Tab 移动焦点，Enter / Space 激活按钮；画中画聚焦后可用方向键吸附四角。'][i]},
    {id:'persona-about',title:'关于与离线边界',icon:'file',steward:'machine-steward',group:'使用帮助',
      oneLine:'版本、离线范围与未接入能力，在对话里查。',
      phrases:['查看形象与偏好版本','哪些能力还没接入','刷新后哪些会恢复'],
      status:()=>[{label:'模块',value:'形象与偏好 · 第八轮演示'},{label:'契约',value:'v3'},{label:'服务',value:'未接入'}],
      act:i=>['形象与偏好 · 第八轮演示。工作台契约第 3 版。模块标注日期为 2026-11-14，不代表实际打包回执。',
        '未接入真实 bot 创建、语音合成与识别、整壳翻译、系统通知、设备连接和 PWA 安装。',
        '刷新后本页的草稿、偏好与虚构会话操作全部恢复；没有持久化或外部写入。'][i]},
    {id:'persona-today',title:'今日摘要',icon:'sun',steward:'chief',group:'今天',
      oneLine:demoText("persona.sample.52"),
      phrases:['看看今日待看事项','把今日摘要标记已读','收起今日摘要'],
      status:()=>[{label:'待看样例',value:'2\u00a0项'},{label:'摘要',value:S.briefRead?'已读':'未读'}],
      act:i=>{if(i===0)S.collapsed=false;if(i===1)S.briefRead=true;if(i===2)S.collapsed=true;
        return i===0?demoText("persona.act.53"):i===1?'今日摘要已在本页标记已读；任务状态未变。':'今日卡已收起；可以随时在聊天顶部展开。';}},
    {id:'machine-voice-bench',title:'本机音色',icon:'wave',steward:'art',group:'本地体验',
      oneLine:demoText("persona.sample.54"),
      status:()=>[{label:'任务',value:'演示 · 未开训'},{label:'试听',value:S.adoptedVoices[selectedAssistant]?'已采用候选':'待成品验收'},
        {label:'授权',value:'本人录音 · 演示声明'}],
      phrases:['拟一份本人录音计划','看看训练进度','哪些音色还不能用'],
      reply:phrase=>{
        const blocked=phrase==='哪些音色还不能用',progress=phrase==='看看训练进度';
        return [{type:'text',md:demo+demoText("persona.md.55")+
          (blocked?'这份缺授权说明的候选不能开训或采用。':progress?'以下是训练进度样例，需逐步刷新；完成后仍须成品试听、验收及播放适配。':'先拟录音计划，再确认整理、质检和开训；原音试听不能替代成品验收。')},
          {type:'cards-b-voice-job',data:{botId:selectedAssistant,voiceName:'本人录音 · 演示音色',source:'本人录音',
            sourceLabel:'本人录音（演示声明）',licenseNote:blocked?'':'本人录音，仅用于本页流程演示；未收取真实录音',
            playEngine:'未接通',trainEngine:'未接入',jobId:'persona-voice-demo',receiptLabel:'演示回执 · 未写盘',
            artifactReady:false,qualityAccepted:false,playbackCompatible:false,state:blocked?'blocked':progress?'running':'draft'}}];
      }},
    {id:'avatar-stage',title:'形象与装扮',icon:'stage',steward:'connect-steward',group:'形象',
      oneLine:'管理每个 bot 的装扮、形象连接、表情和播放口型。',
      status:()=>{const o=currentOutfit(selectedAssistant);return [
        {label:'形象',value:botName(selectedAssistant)+' · '+(o?.name||'未配置')},
        {label:'连接',value:'未加载引擎'},
        {label:'资产授权',value:o?.license?.trim()||'未写许可',tone:o?.license?.trim()?'neutral':'wait'}];},
      phrases:['查看形象状态','换成下一套装扮','测试口型'],
      reply:phrase=>{
        const bot=selectedAssistant;
        let summary='在下方进入舞台，查看当前装扮、字幕与五词表情。';
        if(phrase==='换成下一套装扮'){
          const outfits=H.outfits(bot),current=currentOutfit(bot),index=outfits.findIndex(o=>o.id===current?.id);
          const next=outfits[(index+1)%outfits.length];
          if(outfits.length<2)summary='这个 bot 暂无下一套装扮，请在舞台核对当前占位。';
          else if(!next.license?.trim())summary='下一套「'+next.name+'」未写许可，未换上；请先核对资产授权。';
          else summary=wearOutfit(bot,next.id)?'已换上「'+next.name+'」，头像、舞台、画中画共用同一套。':'未换上，请在舞台核对装扮。';
        }
        if(phrase==='测试口型')summary='进入舞台点「播放测试（演示）」；音量驱动占位，非音素级，未播放真实音频。';
        return [{type:'persona-capability-status',data:{title:'形象与装扮',summary:demo+'。'+summary,
          items:capabilities.find(c=>c.id==='avatar-stage').status(),capability:'avatar-stage',stageBot:bot,
          level:phrase==='换成下一套装扮'?'L1':'L0'}}];
      }},
    {id:'persona-rhythm',title:'陪伴节律',icon:'clock',steward:'chief',group:'人设',
      oneLine:'到点可以醒，默认不主动开口',
      status:()=>[{label:'节律',value:S.rhythm==='day'?'白天可看':'不打扰',tone:S.rhythm==='day'?'wait':'neutral'},
        {label:'安静',value:'—'},{label:'上次',value:'未开口',tone:'neutral'}],
      phrases:['现在安静吗','先别打扰','允许到点看一眼'],
      act:i=>{
        if(i===1)S.rhythm='quiet';if(i===2)S.rhythm='day';
        return demo+'。'+(i===2?'白天可看：看了一眼，选择不说话。':S.rhythm==='quiet'?'不打扰，不主动开口。':'白天可看，上次未开口。')+
          '没有定时器，没有连直播；安静时长未知，不自动插话，不发送对外消息。';
      }}
  ];
  function capabilityButton(id,index=0) {
    const spec=capabilities.find(x=>x.id===id);
    return btn(spec.phrases[index],()=>H.runCapability(id,spec.phrases[index]));
  }
  function capabilityEntry(container,title,ids) {
    const root=page(container,title);
    root.append(note('通过对话修改；这里只保留入口，所有状态仅本页演示。'));
    ids.forEach(id=>{const spec=capabilities.find(x=>x.id===id);
      root.append(card(spec.title,[note(spec.oneLine),...spec.phrases.map((_,i)=>capabilityButton(id,i))]));
    });
  }
  function todayCard() {
    const root=card('今日卡',[
      note(demoText("persona.root.56")),
      btn(S.collapsed?'展开摘要':'收起摘要',()=>{S.collapsed=!S.collapsed;mountToday();},'tertiary'),
      S.collapsed?note('2\u00a0项待看 · 1\u00a0项焦点'):list([
        row('待看',demoText("persona.root.57"),'未外发'),row('待看',demoText("persona.root.58"),'逐平台核对'),
        row('焦点','DSH 模块整合','单文件样张'),row('工作区候选',S.activeProject),row('本页 bot 草稿',S.created.length+'\u00a0个')]),
      note(S.briefRead?'摘要已在本页阅读，未改任务状态。':'摘要尚未标记已读。'),
      capabilityButton('persona-today',1),capabilityButton('persona-bot-drafts',2)
    ]);
    root.classList.add('m-persona-today');
    return root;
  }
  function mountToday() {
    document.querySelector('.m-persona-today')?.remove();
    if(H.state.view==='chat'&&!H.currentTask()&&H.state.bots.find(b=>b.id===H.state.bot)?.role==='chief') {
      const thread=document.querySelector('.thread-inner');
      if(thread)thread.prepend(todayCard());
    }
  }
  function home(container) {
    const root=page(container,'今日摘要已移到聊天');
    root.append(note(demoText("persona.sample.59")),
      btn(demoText("persona.sample.60"),()=>H.navigate({view:'chat',bot:chiefRole()?.id}),true));
  }
  const revisions={};
  H.registerCard('persona-capability-status',{
    title:'能力状态卡',quoteLabel:d=>d.title+'：'+d.summary,
    render:d=>{
      const root=card(d.title,[H.levelSticker(d.level||(d.changed?'L1':'L0'),{action:d.title,scope:'本页演示 · 刷新复原',bot:d.stageBot||H.state.bot}),
        note(d.summary),list(d.items.map(x=>row(x.label,x.value))),note(demo),
        h('p',{class:'m-persona-feedback',role:'status'},d.undone?'已撤销 · 上方为当时的回执快照':d.changed?'已改好 · 仅本页有效，刷新复原':'已查看 · 仅本页演示')]);
      if(d.undo&&!d.undone)root.append(btn(d.capability==='persona-bot-drafts'?'撤销草案记录（保留 bot）':'撤销这次本页修改',()=>{
        if(d.undone){H.toast('这次修改已撤销。');return;}
        if(revisions[d.capability]!==d.revision){H.toast('已有较新操作，请在对话里调整当前状态。');return;}
        const clashes=d.keys.some(key=>JSON.stringify(S[key])!==JSON.stringify(d.after[key]));
        if(clashes){H.toast('相关偏好已有后续修改，请在对话里调整。');return;}
        d.keys.forEach(key=>{S[key]=JSON.parse(JSON.stringify(d.before[key]));});
        d.undone=true;revisions[d.capability]++;mountToday();
        H.toast('已撤销这次本页修改；聊天回执保留。');
        root.querySelector('.m-persona-feedback').textContent='已撤销 · 上方数值为当时的回执快照';
        root.append(note('已撤销 · 上方数值为当时的回执快照。'));
      }));
      if(d.stageBot)root.append(btn('进入舞台',()=>H.navigate({view:'stage',bot:d.stageBot}),true));
      return root;
    }
  });
  capabilities.forEach(spec=>H.registerCapability({...spec,reply:spec.reply||(phrase=>{
    const before=JSON.parse(JSON.stringify(S));
    const summary=spec.act(spec.phrases.indexOf(phrase));
    const keys=Object.keys(S).filter(key=>JSON.stringify(S[key])!==JSON.stringify(before[key]));
    const revision=revisions[spec.id]=(revisions[spec.id]||0)+1;
    const parts=[{type:'persona-capability-status',data:{title:spec.title,summary,items:spec.status(),
      capability:spec.id,revision,changed:keys.length>0,undo:keys.length>0,keys,
      before:Object.fromEntries(keys.map(key=>[key,before[key]])),
      after:Object.fromEntries(keys.map(key=>[key,JSON.parse(JSON.stringify(S[key]))]))}}];
    if(spec.id==='persona-bot-drafts'&&spec.phrases.indexOf(phrase)<2)parts.push({type:'cards-a-bot-draft',data:{...S.created.at(-1)}});
    return parts;
  })}));
  H.on('render',mountToday);
  H.on('ready',mountToday);

  H.addStyle((demoText("persona.sample.61")));

  H.registerBotTab('persona-subbots',{title:'固定任务',render:subBotTab});
  H.registerBotTab('persona-profile',{title:'资料与人设',render:profileView});
  H.registerPanel('persona-studio',{title:'形象工坊',icon:'image',group:'助理与工作区',render:studio});
  H.registerPanel('persona-appearance-panel',{title:'外观',icon:'sun',group:'偏好',render:appearance});
  [
    ['persona-wizard','新建 / 复制 bot','plus',['persona-bot-drafts']],
    ['persona-sessions','会话管理','branch',['persona-sessions']],
    ['persona-projects','工作区与项目','folder',['persona-workspaces']],
    ['persona-guide','使用引导','play',['persona-mobile','persona-shortcuts']]
  ].forEach(([id,title,icon,ids])=>H.registerPanel(id,{title,icon,group:'对话入口',render:c=>capabilityEntry(c,title,ids)}));
  [
    ['persona-appearance','外观','sun',appearance],
    ['persona-voice','声音与语言','wave',c=>capabilityEntry(c,'声音与语言',['persona-voice','persona-languages'])],
    ['persona-other','通知与使用帮助','settings',c=>capabilityEntry(c,'通知与使用帮助',['persona-notifications','persona-mobile','persona-shortcuts','persona-about'])]
  ].forEach((item,index)=>H.registerSettingsPage(item[0],{title:item[1],icon:item[2],group:'偏好',order:30+index,render:item[3]}));
  H.registerView('persona-today',{title:'今日摘要',icon:'sun',hidden:true,render:home});
  H.registerComposerTool({id:'persona-tool',icon:'image',label:'形象工坊',run:()=>H.openPanel('persona-studio')});
})();
