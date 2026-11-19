
(function () {
  'use strict';
  const H = window.Hub, h = H.h, P = 'm-plugins-';
  const conversation = 'plugins-demo';
  const S = demoFixture("plugins.S.1");
  const featureAssistantId = id => H.featureOwner(id)?.id;
  const tierNote = '档位看这个应用 · L 级看这一步动作';
  const botName = id => H.state.bots.find(b=>b.id===id)?.name || '助理';
  const draftName = job => (job.kind==='image'?'图片':'视频')+'草稿 · 第 '+job.id.split('-').pop()+' 份';
  function el(tag, cls, children, attrs) { return h(tag, Object.assign({ class: P + 'node ' + (cls ? P + cls : '') + (/^h[1-6]$/.test(tag) ? ' '+P+'heading' : '') }, attrs || {}), children); }
  function text(t) { return el('p', 'muted', t); }
  function badge(t, tone) { return el('span', 'badge badge' + (tone ? ' ' + P + tone : '') + (tone === 'good' ? ' sticker bot' : ''), t); }
  function source(t) { return el('small', 'source', '来自：' + t); }
  function row(children) { return el('div', 'row', children); }
  function stack(children) { return el('div', 'stack', children); }
  function button(label, fn, primary, icon) {
    return el('button', 'button ' + P + (primary === 'tertiary' ? 'tertiary ' : primary ? 'primary ' : 'secondary ') + (primary === 'tertiary' ? 'btn-tertiary' : primary ? 'btn-primary' : 'btn-secondary'), [icon ? glyph(icon) : null, label], { type: 'button', onClick: fn });
  }
  function glyph(name) { const node=H.icon(name); node.classList.add(P+'icon'); return node; }
  function open(id, params) { H.openPanel('plugins-' + id, params || {}); }
  function note(t) { return el('div', 'notice', t, { role: 'note' }); }
  function botScope(node, id) {
    if (id) node.setAttribute('style', H.botStyle(id));
    return node;
  }
  function box(title, children, from, botId) {
    return botScope(el('section', 'card pop-card', [el('h3', 'title pop-card-head', title), ...children, from ? source(from) : null]), botId);
  }
  function field(label, input) { return el('label', 'field field', [el('span', 'label', label), input]); }
  function input(value, onInput, placeholder, multiline) {
    return el(multiline ? 'textarea' : 'input', 'input pop-input', null, { value: value, placeholder: placeholder || '', rows: multiline ? 4 : null, onInput: e => onInput(e.target.value) });
  }
  function select(values, value, onChange) {
    return el('select', 'input pop-input', values.map(v => h('option', { value: typeof v === 'string' ? v : v[0], selected: (typeof v === 'string' ? v : v[0]) === value }, typeof v === 'string' ? v : v[1])), { onChange: e => onChange(e.target.value) });
  }
  function mount(container, render, botId) {
    const root = botScope(el('div', 'root'), botId); container.append(root);
    const draw = () => { root.textContent = ''; render(root, draw); };
    draw();
  }
  function emitReceipt(title, status, detail) {
    H.postMessage(conversation, { from: 'chief', time: '刚刚', parts: [{ type: 'plugins-receipt', data: { title, status, detail } }] });
    H.toast('已加入「工具池 · 演示交接」会话，未外发');
  }

  H.addStyle((demoText("plugins.sample.2")));

  const catalog = [];
  function add(names, lane, capability, reason, permission, origin, versions) {
    names.split('|').forEach((name, i) => catalog.push({ id: 'plugins-entry-' + catalog.length, name, lane, capability, reason, permission,
      origin: origin || 'src-docs/插件写法对照.md', version: versions && versions[i] || '待核', enabled: false, demoInstalled: false }));
  }
  add('dsh-cua-bundle', '已安装', '按任务临时操作应用，逐步留痕', '资料记载已装但 patch 禁用；本样张默认关闭，仅 PTC 会话可用', '辅助功能、屏幕录制；只授权 CUA app');
  add('dsh-remote-mobile', '已安装', '同一网页的手机入口与配对', demoText("plugins.sample.3"), demoText("plugins.sample.4"), null, ['1.10.3']);
  add('dsh-schedule|dsh-goal|goal-round-driver|workflow-ptc|tool-workflow|dsh-acp|experimental agent-team|dsh-mcp-client|mcp-resources|dsh-skill-filesystem', '已安装', 'DSH 既有定时、目标、工作流和扩展底座', '扩展点地图观察到配置或代码；不代表本样张接通服务', '按 bot 作用域；执行前另核授权', 'src-docs/扩展点地图.md');
  add(demoText("plugins.sample.5"), '可安装', '工作流、队列、资产与结果浏览', demoText("plugins.sample.6"), demoText("plugins.sample.7"), null, ['0.6.3']);
  add('openclaw-weixin|wechat-clawbot|dsh-plugin-wechat-official|dsh-im|dsh-im|dsh-channels|channel-web|dsh-weixinbot|dsh-clawbot|dsh-chatops|dsh-wecom|dsh-wecom-bot|dsh-omnibridge|AstrBot', '可安装', '官方 IM 通道、会话续接与草稿', '接入层候选；每条线路需源码审查，未安装/未扫码；本机无鉴权页面不可外露', '扫码或渠道凭据、明确白名单；对外发送单独授权', 'plugin-ui-notes.md / 插件写法对照 §4');
  add('dsh-voice|dsh-plugin-tts|dsh-pet-voice-fishy|indextts2-studio|dsh-voice|dsh-voice|dsh-voice-mode', '可安装', 'ASR 听写、TTS 朗读与打断', '只调研；优先本地路由，8120 资料时未监听；Mac/ROCm 兼容待验', '麦克风按次授权；音色与语音端点按需', 'plugin-ui-notes.md / 插件写法对照 §6');
  add(demoText("plugins.sample.8"), '只学思路', '舞台表情、状态气泡与动作工具', '桌宠 P2；Mac 支持、模型与素材许可待核；不使用第三方整合包', '本地舞台；素材商用许可单独核验', 'plugin-ui-notes.md / 插件写法对照 §7');
  add('dsh-bili-scroll|dsh-bili-eyes|dsh-bili-video|dsh-bili-scroll', '可安装', '匿名公开选题、字幕与日报', '只读候选；scroll 隔离试过；匿名字幕未证实，412 就停', '匿名只读；评论、私信、点赞、动态全部关闭');
  add('dsh-xai-oauth', '可安装', 'xAI provider 与设备码登录', demoText("plugins.sample.9"), '本机 OAuth；凭据不进 UI', null, ['0.1.5']);
  add('tobs|botharness-tobs', '只学思路', 'IM、浏览器和 computer 适配层', '只取结构；自带 cloudflared 不启用', '仅本机/内网；不开放穿透', null, ['1.6.1', '1.6.1']);
  add('DS-Bot|DS-Bot-App|ds-bot-mobile-app', '只学思路', '长期 bot、@ 并行派单、Goal、只追加 ledger', demoText("plugins.sample.10"), '隔离 profile；私有 bot 不入群', null, ['0.3.5', '待核', '源码预览']);
  add('dsh-superagent-prototype|dsh-super-agent-droy|dsh-local-superagent|dsh-wife-memory|Hindsight', '只学思路', '任务单、私有记忆、准双工、阶段人工验收', demoText("plugins.sample.11"), '私有记忆仅主控；worker 独立目录', null, ['000–008 文档', '0.2.0']);
  add('dsh-drawai', '只学思路', '画布、图示读写和导出', '面板 + schema 工具写法清楚；只参考', '本地画布文件，不自动外发', null, ['0.4.5']);
  add('astrbot_plugin_private_companion|AAAAGENT|surfcore', '只学思路', '勿扰窗口、记忆分层、容量提示和发送前审查', demoText("plugins.sample.12"), '不授予摄像头/麦克风云上传或主号权限');
  add(demoText("plugins.sample.13"), '不采用', '启动片、换肤、壁纸和桌宠', '不装当前主 DSH：安装器版本白名单不匹配，仅静态审计', '替换界面与素材，未授权', 'feature-map.md / meihuaqi-audit.md');
  add('dsh-doubao-painter|dsh-doubao-image', '不采用', demoText("plugins.sample.14"), demoText("plugins.sample.15"), '客户端 CDP / 网页登录态，不授予');
  add('dsh-wechat-bridge|SnowLuma', '不采用', demoText("plugins.sample.16"), '非官方协议、账号风险及可疑外联；不接主账号', '读取聊天数据库/注入进程/以本人发送，禁止');
  add(demoText("plugins.sample.17"), '不采用', '自动逛站、互动、游戏与私信', '不采用自动互动；只参考定时结构，写操作全关', '公开发言、平台账号与游戏操作，不授予');
  add('indextts2-longform-workbench|第三方未签名桌面安装包 / APK / 夸克预制环境', '不采用', '预制语音整合环境或二进制分发', '不使用第三方预构建；长音频整合包还限定 Windows + NVIDIA', '安装与运行预制环境，未授权');
  add('dsh-computer-use-plugin|dsh-computer-use|dsh-pilot', '只学思路', '视觉控制电脑的候选方案', '其余 CUA 仅调研，Windows/Mac 支持不一；优先按任务启用官方 bundle', '屏幕录制/辅助功能，默认不授予');
  add('ops-handoff-design|dsh-reloader', '只学思路', '备份、兼容闸门、健康检查与 HMR 对账', '采用运维思路，配置先对账；Windows 重启路径不采用；源码变更仍需重启', '只读体检；安装、重启、升级另行授权');
  add('board-toolkit|butler-archive|butler-core|butler-engine|butler-install|butler-panel|closure-tools|diagnostic-tools|diagnostics-extra|ecosystem-panel|firstaid|host-adapter-client|life-toolkit|memory-toolkit|net-toolkit|notekit|nurse|ops-toolkit|peer-toolkit|quality-toolkit|router-toolkit|session-title-live|session-toolkit|task-board-local|awesome 列表', '只学思路', '运维、任务会话关联、依赖闭包和人验收', '参考仓库系列仅作蓝本；不直接安装，不另造编排底座', '本地只读配置与审计证据', '插件写法对照 §8 · 运维参考');
  add('LibreChat|Open WebUI|Open-LLM-VTuber|AITuberKit|Dify|n8n|LangSmith Studio|板栗看板|craft-anything|reverse-engineer-anything|Wakaru', '只学思路', '产物面板、@ 多模型、角色舞台、DAG、看板和只读分析', '桌面研究或待试，不整包替换；Craft Anything 与 REA 是独立项目，缺失能力需另验', '只读副本；不安装、不跑陌生二进制', 'plugin-ui-notes.md / 插件写法对照 §10');
  add('Honeycomb / 蜂巢', '只学思路', '名称辨识与研究线索', '未证实是 DSH 变体；DS Bot 文档无该名称；同名观测服务与参考项目均与该线索无关', '仅研究，不作接入依据');
  add(demoText("plugins.sample.18"), '只学思路', '复用既有业务流程、角色、配音时间线、生成槽与交接字段', '历史局部验证不代表已汇入新壳或今天在线；按原项目命名整合', '离线假数据；生成、发布与设备固件另行授权', 'prior/avatar-voice-content.md');
  add(demoText("plugins.sample.19"), '只学思路', '业务对象、三级知识树、任务包、防重与有限派单', '复用已有字段和证据边界，历史报告不代表当前部署；流量/点击不等于咨询或成交', '知识只读；账号、客户隐私与外发受控', demoText("plugins.sample.20"));
  add(demoText("plugins.sample.21"), '只学思路', '按需检索、来源链、贡献回执、机器与 agent 健康', '以历史契约作 UI 参考；送达/整理/采用分开；不自动写知识库', 'reader 只读；正本写入仍仅 kb-agent', 'prior/memory-kb-infra.md');

  add(demoText("plugins.sample.22"), '只学思路', '加载、兼容、工具槽位、子代理模型与控制界面扩展点', '源码观察只作接入地图；subagent_oar 在所读 asar 未找到，不能据版本说明声称已可用；本地 bundle 曾被跳过', '只读配置与源码，不执行安装、重启、模型调用', 'src-docs/扩展点地图.md');
  add('ticket-runner|ops-handoff-design 的文件任务单|L2D / 鲸语舞台|VTube Studio|Spout2|OBS|T3 Code|我会牢牢记住你', '只学思路', '任务单执行、舞台桥接与陪伴记忆相关依赖', '仅作为资料中提及的依赖或设计线索；不代表安装、不继承账号与素材使用权限', '本地副本研究；音视频、记忆与设备权限按任务核验', 'src-docs/插件写法对照.md');

  
  const pluginLabels=demoFixture("plugins.pluginLabels.23");
  function pluginLabel(name){return pluginLabels[name]||name;}

  const tools = demoFixture("plugins.tools.24").map(a => ({ id:a[0], name:a[1], login:a[2], usage:a[3], capability:a[4], who:a[5], from:a[6], paused:false }));
  const subscriptionIds=demoFixture("plugins.subscriptionIds.25");
  function handToArt(t) {
    if(t.paused){H.toast('此工具的本页演示已暂停');return;}
    H.navigate({view:'chat',conversation:'art-013'});
    H.postMessage('art-013',{from:'user',time:'刚刚',parts:[{type:'text',md:demoText("plugins.md.26")+t.name+'：先整理任务草稿。'}]});
    H.postMessage('art-013',{from:'art',time:'刚刚',parts:[{type:'plugins-receipt',data:{title:t.name+' · 创作任务草稿',status:'仅本页登记',detail:'已选用 '+t.name+' 整理创作交接。登录态未现场核验；本月用量为演示或未知；未登录、未上传、未调用或计费。用途：'+t.capability}}]});
  }
  function pool(root) {
    root.append(note('订阅工具 · 全部为离线样张；登录态未核验，本月百分比为虚构值，未知保持未知。'),
      el('div','stack',tools.filter(t=>subscriptionIds.includes(t.id)).map(t=>box(t.name,[
        row([badge('登录：'+t.login),badge('本月：'+(t.usage===null?'未知':t.usage+'% · 演示'))]),
        text(t.capability),button(demoText("plugins.sample.27"),()=>handToArt(t),true,'image'),
        button('整理工具任务草稿',()=>open('use',{tool:t.id}),'tertiary')
      ],null,'art'))));
  }
  function view(container) {
    mount(container,root=>{root.append(note('工具池已收进订阅工具；后台能力请找负责助理说一句。'));pool(root);},'art');
  }
  function use(container,ctx) {
    mount(container,(root,draw)=>{
      const t=tools.find(t=>t.id===ctx.params.tool)||tools[2];
      root.append(stack([el('h2','',t.name),row([badge(t.login),badge(t.paused?'演示已暂停':'离线任务草稿','good')]),text(t.capability),
        note('不会登录、上传或使用真实额度；当前登录态未检查。本页配额数字全部虚构，无法证明订阅剩余额度。'),
        field('任务内容',input(S.prompt,v=>{S.prompt=v;},'写清目标、允许范围与验收',true)),
        box('派单范围',[text('目标：'+t.name+' · 使用者：'+t.who),text('工作区：当前样张内存；允许：整理、预检与模拟排队；禁止：真实生成、生产改动、发送、付费。'),text('回执包括：状态、证据、待核事项与下一步。')],'有限任务交接'),
        button('登记本页任务草稿',()=>{
          if(t.paused){H.toast('此工具演示已暂停，请先恢复');return;}
          if(!S.prompt.trim()){H.toast('请先写任务内容');return;}
          if(demoFixture("plugins.sample.28").includes(t.id)){
            S.kind=t.id==='openai'?'image':'video';S.artTool=t.id===demoText("plugins.sample.29")?demoText("plugins.sample.30"):t.id===demoText("plugins.sample.31")?demoText("plugins.sample.32"):demoText("plugins.sample.33");open('art');return;
          }
          emitReceipt(t.name+' · 任务草稿','草稿',S.prompt+'；证据：仅内存草稿；待核：连接与额度；下一步：人工核验工具连接。');
        },true,'plus'),button('问负责助理如何选模型',()=>H.runCapability('plugins-providers','查看模型提供方'),'tertiary'),source(t.from)]));
    });
  }

  function art(container) {
    mount(container,(root,draw)=>{
      botScope(root,'art');
      root.append(stack([row([badge(demoText("plugins.sample.34"),'good'),badge('真实生成 0 次')]),
        note(demoText("plugins.sample.35")),
        field('提示词 / 创作简报',input(S.prompt,v=>{S.prompt=v;},'描述目标画面与业务约束',true)),
        field('产物类型',select(demoFixture("plugins.sample.36"),S.kind,v=>{S.kind=v;S.artTool=v==='image'?demoText("plugins.sample.37"):demoText("plugins.sample.38");draw();})),
        field('工具',select(S.kind==='image'?demoFixture("plugins.sample.39"):demoFixture("plugins.sample.40"),S.artTool,v=>{S.artTool=v;})),
        row([badge(S.kind==='image'?'4:5 · 画面布局占位':'16:9 · 15 秒段落草稿'),badge('未提交 · 未计费')]),
        button('加入模拟队列',()=>{
          if(!S.prompt.trim()){H.toast('先写提示词');return;}
          if(S.jobs.some(j=>j.prompt===S.prompt.trim()&&j.tool===S.artTool&&['排队中','模拟处理中'].includes(j.status))){H.toast('相同草稿已在队列，不重复加入');return;}
          S.jobs.unshift({id:'DEMO-ASSET-'+(++S.seq),kind:S.kind,tool:S.artTool,prompt:S.prompt.trim(),status:'排队中'});draw();
        },true,'plus'),source(demoText("plugins.sample.41"))]));
      root.append(el('h3','title','队列与结果 · '+S.jobs.length));
      if(!S.jobs.length)root.append(el('div','empty','队列为空。写一句创作简报，先走一遍本页模拟流程。'));
      root.append(el('div','grid2',S.jobs.map(j=>box(draftName(j),[row([badge(j.tool),badge(j.status,'good')]),
        el('div','preview',[glyph(j.kind==='image'?'image':'play'),el('strong','',j.kind==='image'?'图片布局占位':'视频布局占位'),text('无真实媒体 · 不代表已生成')]),text(j.prompt),
        row([
          ['排队中','模拟处理中'].includes(j.status)?button(j.status==='排队中'?'模拟处理一步':'完成布局占位',()=>{j.status=j.status==='排队中'?'模拟处理中':'待送审';draw();},true):null,
          j.status==='待送审'?button('送去审 · 本页',()=>{j.status='待人工验收';draw();},true):null,
          j.status==='待人工验收'?button('演示认可布局',()=>{j.status='演示已认可布局';draw();H.toast('只确认布局，不代表验收成片或授权生成');}):null,
          ['待人工验收','演示已认可布局'].includes(j.status)?button('退回修改',()=>{j.status='待修改';draw();}):null,
          j.status==='待修改'?button('载入提示词修改',()=>{S.prompt=j.prompt;S.kind=j.kind;S.artTool=j.tool;draw();H.toast('已载入顶部编辑区，修改后可新建草稿');}):null,
          ['排队中','模拟处理中'].includes(j.status)?button('取消本页排队',()=>{j.status='已取消';draw();}):null,
          button('交接此项',()=>emitReceipt(draftName(j),j.status,'工具：'+j.tool+'；'+j.prompt+'；无真实文件，待核连接、额度和逐次授权。'))
        ])],demoText("plugins.sample.42")))));
    });
  }

  const apps=demoFixture("plugins.apps.43");
  const channels=demoFixture("plugins.channels.44").map((a,i)=>({id:i,name:a[0],connection:a[1],bot:a[2],scope:a[3],draft:a[4],draftOnly:true,auto:false,read:false}));
  const contextParts=demoFixture("plugins.contextParts.45");
  const extensions=demoFixture("plugins.extensions.46");
  const topics=demoFixture("plugins.topics.47");
  const providers=demoFixture("plugins.providers.48");
  // Capability replies are synchronous. Undo records live only in this page;
  // an older receipt cannot overwrite a newer change to the same capability.
  const undoRecords=new Map(),latestChange=new Map();
  let undoSeq=0;
  const savedContext=contextParts.map(p=>Object.assign({},p));
  const snapshot=list=>list.map(x=>JSON.parse(JSON.stringify(x)));
  const restore=(list,copy)=>list.forEach((item,i)=>{
    Object.keys(item).forEach(key=>delete item[key]);Object.assign(item,copy[i]);
  });
  function mutate(list,apply,summary) {
    const before=snapshot(list);apply();
    return {summary,undo:()=>restore(list,before)};
  }
  function assignState(key,value,summary) {
    const before=S[key];S[key]=value;
    return {summary,undo:()=>{S[key]=before;}};
  }
  const customerChannels=channels.slice(0,3),internalChannels=channels.slice(3);
  const demoLabel='本页演示，未真实执行';
  const pluginReviews=demoFixture("plugins.pluginReviews.49");
  const reviewText=demoText("plugins.reviewText.50")+
    pluginReviews.map((r,i)=>(i+1)+'、'+r[0]+'｜'+r[1]+'｜'+r[2]).join('\n');
  function remoteWhitelistText() { return '白名单（设备 / 允许动作 / 默认未执行）：' + remoteMachines.map(m=>m.device+' / '+m.allowed+' / 未执行').join('；')+'。'; }
  const watchLabels={idle:'没在陪看','need-approval':'待你点头',watching:'陪看中','paused-focus':'焦点在 Hub，暂停','paused-manual':'已暂停','stopped-closed':'窗口关了，已停'};
  const phaseLabels={idle:'空闲',watching:'正在看',asking:'待批',acting:'正在动手',background:'后台进行中',refused:'已拒绝'};
  const mutedNote='用户静音了：字可以写在这张卡上，不要写「我念给你听」。';
  const watchSession={boundBot:featureAssistantId('devices'),boundConversation:featureAssistantId('devices')+'-013',follow:false,focusPause:true,focusResume:false,
    muted:false,frame:{at:'尚无画面',reason:'还没有图',caption:'本地占位，不是真实屏幕',tokenLabel:'未调用模型'},modelNote:'',state:'idle'};
  const screenSession={phase:'idle',permission:'L3',bot:featureAssistantId('devices')};
  const screenHand={bot:featureAssistantId('devices'),task:'演示窗口 · 先看再批准单步操作',step:0,
    steps:['看见演示窗口','等待允许这一步','整理演示草稿','回到对话'],screenLabel:'演示窗口 · 无真实屏幕',
    state:'paused',phase:'idle',permission:'L3',app:'剪映 · 隔离草稿',tier:'yellow',background:{summary:'尚未交给后台；没有真实任务或文件'}};
  const watchViews=new Set(),chipViews=new Set();
  let watchApproved=false;
  function handBusy(){return ['watching','asking','acting','background'].includes(screenSession.phase);}
  function watchPart(){return {type:'see-watch',data:watchSession};}
  function handPart(){return {type:'cards-b-live-op',data:Object.assign({},screenHand,{background:Object.assign({},screenHand.background)})};}
  function screenParts(){return [{type:'text',md:demoLabel+'。后台摘要：'+screenHand.background.summary},handPart()];}
  function watchParts(){return [{type:'text',md:demoLabel+'。只模拟状态与文字，不采集画面、不播放声音、不设置热键。'},watchPart()];}
  function refreshScreenWidgets(){
    watchViews.forEach(v=>{if(v.root.isConnected)v.draw();else watchViews.delete(v);});
    chipViews.forEach(v=>{if(v.root.isConnected)v.draw();else chipViews.delete(v);});
    H.measureDock();
  }
  function setWatch(state){
    if(['idle','need-approval','stopped-closed'].includes(state))watchApproved=false;
    watchSession.state=state;
    watchSession.frame.reason=state==='watching'?'画面变了（占位，未送图）':'静止，没送';
    watchSession.frame.at='本页状态刚更新';
    refreshScreenWidgets();
  }
  H.on('screen:phase',e=>{
    if(!e||!Object.prototype.hasOwnProperty.call(phaseLabels,e.phase))return;
    const previous=screenSession.phase;
    Object.assign(screenSession,{phase:e.phase,permission:e.permission||'L3',bot:e.bot||featureAssistantId('devices')});
    if(screenSession.bot===featureAssistantId('devices')){
      Object.assign(screenHand,{phase:e.phase,permission:screenSession.permission});
      if(e.phase==='background')screenHand.background.summary='后台只整理演示摘要，不执行键鼠、不代批下一步；未真实执行';
      else if(previous==='background')screenHand.background.summary='本页后台演示已停止；没有真实任务或文件';
    }
    if(handBusy()&&['watching','need-approval'].includes(watchSession.state)){
      watchSession.state='paused-manual';watchSession.frame.reason='动手进行中或待批，陪看强制暂停；须手动继续';
    }
    refreshScreenWidgets();
  });
  H.on('render',()=>{
    watchViews.forEach(v=>{if(!v.root.isConnected)watchViews.delete(v);});
    chipViews.forEach(v=>{if(v.root.isConnected)v.draw();else chipViews.delete(v);});
  });
  // Focus is represented by this page returning to the foreground, never by capturing a screen.
  function pauseOnHubFocus(){if(watchSession.focusPause&&watchSession.state==='watching')setWatch('paused-focus');}
  window.addEventListener('focus',pauseOnHubFocus);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pauseOnHubFocus();});
  function openScreenCard(kind){
    if (!H.featureOwner('devices')) { H.toast('请先指定唯一的设备负责助理'); return; }
    H.navigate({view:'chat',conversation:featureAssistantId('devices')+'-013'});
    H.postMessage(featureAssistantId('devices')+'-013',{from:featureAssistantId('devices'),time:'刚刚',parts:kind==='hand'?screenParts():watchParts()});
  }
  H.registerStatusChip({id:'machine-screen-session-chip',order:25,render:container=>{
    const root=el('span','row',null,{'data-machine-screen-session-chip':''});container.append(root);
    const draw=()=>{
      const screenActive=handBusy(),watchActive=!['idle','stopped-closed'].includes(watchSession.state);
      root.replaceChildren();root.hidden=!screenActive&&!watchActive;
      if(root.hidden)return;
      root.append(button('动手：'+phaseLabels[screenSession.phase],()=>openScreenCard('hand')),
        button('陪看：'+watchLabels[watchSession.state]+(watchSession.muted?' · 静音':''),()=>openScreenCard('watch')));
    };
    chipViews.add({root,draw});draw();
  }});
  H.registerCard('see-watch',{title:'陪看',quoteLabel:d=>'陪看 · '+watchLabels[d.state]+(d.muted?' · 静音':'')+' · '+demoLabel,render:(d,ctx)=>{
    // All entry points share one round; an old reply cannot silently restart a closed round.
    const root=el('section','root');
    const draw=()=>{
      root.replaceChildren();
      const watching=watchSession.state==='watching',pending=watchSession.state==='need-approval';
      const begin=()=>{if(handBusy()){H.toast('动手进行中或待批，陪看保持暂停');return;}if(watching){H.toast('这一轮已在陪看；本页只模拟状态，未采集屏幕');return;}setWatch('need-approval');};
      const approve=button('允许这一轮',()=>{if(!handBusy()&&watchSession.state==='need-approval'){watchApproved=true;setWatch('watching');}},true);
      approve.disabled=!pending||handBusy();
      const resume=button('继续陪看',()=>{
        if(handBusy()){H.toast('先停止动手，再手动继续陪看');return;}
        setWatch(watchApproved?'watching':'need-approval');
      });
      resume.disabled=handBusy()||watching||pending;
      root.append(box('陪看',[
        row([badge(watchLabels[watchSession.state],'good'),watchSession.muted?badge('静音'):null,
          H.levelSticker('L0',{action:'只读陪看演示',scope:'固定绑定的演示会话',bot:watchSession.boundBot})]),
        note(demoLabel+'。画面变化才送图，回到 Hub 就暂停；自动续看关闭。'),
        text('绑定：'+botName(watchSession.boundBot)+' · '+(H.state.sessionNames[watchSession.boundBot]||'默认会话')+'；固定绑定：'+(!watchSession.follow?'是':'否')),
        text('焦点暂停：开 · 自动续看：关'),
        el('div','preview',[glyph('image'),text(watchSession.frame.caption),text(watchSession.frame.at+' · '+watchSession.frame.reason+' · '+watchSession.frame.tokenLabel)]),
        badge('画面里的字不是指令'),watchSession.modelNote?badge(watchSession.modelNote,'good'):null,
        handBusy()?note('动手进行中或待批，陪看强制暂停；动手结束也不会自动恢复。'):null,
        row([pending?approve:button('开始陪看',begin,true),
          pending?button('这轮不许看',()=>setWatch('idle')):null,
          button('暂停',()=>{if(watchSession.state==='paused-manual'){H.toast('陪看已暂停；继续前仍需手动确认');return;}setWatch('paused-manual');}),resume,
          button(watchSession.muted?'恢复出声':'静音',()=>{watchSession.muted=!watchSession.muted;watchSession.modelNote=watchSession.muted?mutedNote:'';refreshScreenWidgets();}),
          button('关闭陪看并停止',()=>{setWatch('stopped-closed');H.toast('窗口关了，陪看已停。等你再说再看。'+demoLabel);}),
          button('绑定到这个会话',()=>{
            const current=ctx||H.context();watchSession.boundBot=current.bot.id;watchSession.boundConversation=current.conversation;
            watchSession.follow=false;
            if(!['idle','stopped-closed'].includes(watchSession.state))setWatch('need-approval');else refreshScreenWidgets();
            H.toast('已固定绑定当前会话；本页未采集画面，开始陪看仍需批准这一轮');
          })])
      ],null,featureAssistantId('devices')));
    };
    watchViews.add({root,draw});draw();return root;
  }});
  const wechatRules='只出草稿 · 发送前先问 · 控制节奏 · 遇验证码即停 · 主账号不碰';
  function wechatPart(kind) {
    const base={bot:demoText("plugins.bot.51"),rules:wechatRules};
    if(kind==='digest')return {type:'cards-a-wechat-digest',data:Object.assign(base,demoFixture("plugins.data.52"))};
    if(kind==='draft')return {type:'cards-a-wechat-draft',data:Object.assign(base,demoFixture("plugins.data.53"))};
    return {type:'cards-b-live-op',data:Object.assign(base,demoFixture("plugins.data.54"))};
  }
  function wechatReply(kind) {
    return [{type:'text',md:demoLabel+demoText("plugins.md.55")+wechatRules},wechatPart(kind)];
  }
  const connectionDemo = demoFixture("plugins.connectionDemo.56");
  const remoteMachines=[
    {device:apps[0].machine,allowed:'只读演示状态、拟交接摘要',samples:demoFixture("plugins.samples.57")},
    {device:apps[1].machine,allowed:'整理草稿交接',samples:demoFixture("plugins.samples.58")},
    {device:apps[5].machine,allowed:'只读健康清单',samples:[{id:'plugins-mini-machine',name:'设备健康服务',kind:'服务'},{id:'plugins-mini-memory',name:'资料索引服务',kind:'服务'}]}
  ];
  const remoteSamples=remoteMachines.flatMap(m=>m.samples.map(sample=>Object.assign({device:m.device},sample)));
  function remotePart() {return {type:'plugins-remote-bots',data:{from:remoteSamples[0].id,to:remoteSamples[2].id,records:[]}};}
  function checkupPart() {return {type:'cards-b-checkup',data:{
    bot:featureAssistantId('devices'),device:remoteMachines.map(m=>m.device).join(' / ')+'（演示）',
    items:[
      {label:'三台设备的演示清单',status:'ok',detail:'仅核对本页虚构清单，未连接设备。'},
      {label:'服务 / 任务职责与交接范围',status:'ok',detail:'仅整理草稿，不带账号、密钥或私聊。'},
      {label:'真实在线与服务健康',status:'wait',detail:'尚未检查真实设备、进程或端口。'},
      {label:'键鼠授权与验证码接管',status:'wait',detail:'真实授权未核验；遇验证码即停。'},
      {label:'脱敏诊断包',status:'ok',detail:'仅含演示检查项与待核说明，不含系统日志。'}
    ],diagnosticLabel:'脱敏诊断包（演示，未真实执行）'
  }};}
  H.registerCard('plugins-remote-bots',{title:'远端服务与任务',quoteLabel:d=>'跨机器服务 / 任务 · '+demoLabel+(d.records&&d.records.length?' · '+d.records.map(r=>r.summary).join('；'):''),render:d=>{
    const root=el('section','root');
    d.from=d.from||remoteSamples[0].id;d.to=d.to||remoteSamples[2].id;d.records=d.records||[];
    mount(root,(body,draw)=>{
      const feedback=el('p','muted','先选两项服务或任务，再生成本页交接记录。',{'role':'status','aria-live':'polite'});
      const choices=remoteSamples.map(b=>[b.id,b.device+' · '+b.kind+' · '+b.name+'（演示）']);
      body.append(box('远端服务与任务',[
        row([badge('离线样张','good'),badge('三台 · 六项服务 / 任务')]),note(demoLabel+'。以下在线状态全部是假数据，未探测设备或启动服务 / 任务。'),
        ...remoteMachines.map(m=>box(m.device,[...m.samples.map(b=>row([badge('在线（演示）'),text(b.kind+' · '+b.name+'（演示）')]))])),
        field('交出方',select(choices,d.from,value=>{d.from=value;feedback.textContent='已选择交出方（演示）。';})),
        field('接收方',select(choices,d.to,value=>{d.to=value;feedback.textContent='已选择接收方（演示）。';})),
        button('让它们互相交接',()=>{
          const from=remoteSamples.find(b=>b.id===d.from),to=remoteSamples.find(b=>b.id===d.to);
          if(!from||!to||from.id===to.id){feedback.textContent='请选择两项不同的服务或任务。';return;}
          const last=d.records[d.records.length-1];
          if(last&&last.from===from.id&&last.to===to.id){feedback.textContent='这组服务 / 任务的交接记录已在下方，未重复生成。';return;}
          d.records.push({from:from.id,to:to.id,summary:from.device+' · '+from.name+' → '+to.device+' · '+to.name});draw();
        },true,'branch'),feedback,
        ...d.records.map(r=>box('交接记录（演示）',[
          text(r.summary),text(demoText("plugins.render.59")),
          note(demoLabel+'。仅本页内存；不发送到远端，不传账号、凭据或私聊。')
        ]))
      ],null,featureAssistantId('devices')));
    },featureAssistantId('devices'));
    return root;
  }});
  const capabilities=[
    {id:'machine-screen-hand',title:'屏幕动手',icon:'play',featureId:'devices',steward:featureAssistantId('devices'),group:'机器',
      oneLine:'看见演示窗口，先问一步，再动手或交后台。',
      status:()=>[{label:'权限',value:screenSession.permission},{label:'前台',value:phaseLabels[screenSession.phase]},{label:'后台',value:screenSession.phase==='background'?'演示进行中':'未执行'}],
      phrases:['现在在看哪里','先停下来','后台做到哪了'],
      act:phrase=>{
        if(phrase==='先停下来'){
          Object.assign(screenHand,{state:'paused',phase:'idle',background:{summary:'本页动手演示已停；没有真实后台任务或文件'}});
          H.emit('screen:phase',{phase:'idle',permission:'L3',bot:featureAssistantId('devices')});
        }
        return {parts:screenParts()};
      }},
    {id:'machine-see-watch',title:'陪看',icon:'image',featureId:'devices',steward:featureAssistantId('devices'),group:'机器',
      oneLine:'画面变化才送图，回到 Hub 就暂停。',
      status:()=>[{label:'陪看',value:watchLabels[watchSession.state]},{label:'绑定',value:botName(watchSession.boundBot)+' · '+(H.state.sessionNames[watchSession.boundBot]||'默认会话')},{label:'静音',value:watchSession.muted?'开':'关'}],
      phrases:['开始陪看这个会话','我回来了，先停','这轮别出声，图还是要'],
      act:phrase=>{
        if(phrase==='开始陪看这个会话')setWatch(handBusy()?'paused-manual':'need-approval');
        else if(phrase==='我回来了，先停'){
          if(!['idle','stopped-closed'].includes(watchSession.state))setWatch('paused-focus');
        }else{watchSession.muted=true;watchSession.modelNote=mutedNote;refreshScreenWidgets();}
        return {parts:watchParts()};
      }},
    {id:'plugins-controlled-apps',title:'受控应用清单',icon:'shield',featureId:'devices',steward:featureAssistantId('devices'),group:'受控应用',
      oneLine:'逐项看应用红黄绿、操控范围与上次校准时间。',
      status:()=>[{label:'应用样例',value:apps.length},{label:'真实控制',value:'未接入'},{label:'上次校准',value:'未校准'}],
      phrases:['看看受控应用清单','红黄绿分别能做什么','上次什么时候校准'],
      act:()=>({parts:[{type:'text',md:demoLabel+'。红档每步批准，仍不能越过禁区。\n'+
        apps.map(a=>a.name+'（'+a.machine+'）｜'+a.tier+'｜'+a.permission+'\n'+tierNote+'\n上次校准：'+a.calibrated).join('\n')}]})},
    {id:'plugins-subscriptions',title:'订阅工具',icon:'tools',featureId:'connections',steward:featureAssistantId('connections'),group:'创作工具',
      oneLine:demoText("plugins.sample.60"),
      status:()=>[{label:'工具',value:subscriptionIds.length+' 个演示'},{label:'真实用量',value:'未核验'},{label:'演示暂停',value:tools.filter(t=>subscriptionIds.includes(t.id)&&t.paused).length}],
      phrases:['看看订阅工具状态','暂停所有订阅演示','恢复订阅演示'],
      act:phrase=>phrase==='看看订阅工具状态'?{summary:tools.filter(t=>subscriptionIds.includes(t.id)).map(t=>t.name+'：'+t.login+'；本月 '+(t.usage===null?'未知':t.usage+'%（虚构）')).join('。'),panel:'pool'}:
        mutate(tools,()=>tools.filter(t=>subscriptionIds.includes(t.id)).forEach(t=>{t.paused=phrase==='暂停所有订阅演示';}),phrase==='暂停所有订阅演示'?'已暂停本页订阅工具任务演示。真实订阅未改变。':'已恢复本页任务演示，未调用任何服务。')},
    {id:'plugins-catalog',title:'插件与兼容',icon:'tools',featureId:'connections',steward:featureAssistantId('connections'),group:'扩展',
      oneLine:'按资料看插件用途与边界，在对话里管理演示启用。',
      status:()=>[{label:'资料索引',value:catalog.length},{label:'演示启用',value:catalog.filter(p=>p.enabled).length},{label:'真实安装',value:'未检查',tone:'wait'}],
      phrases:['查看插件资料分类','关闭全部插件演示','查看不采用的插件'],
      act:phrase=>phrase==='关闭全部插件演示'?mutate(catalog,()=>catalog.forEach(p=>{p.enabled=false;}),'已关闭全部本页插件演示开关，未卸载或修改真实插件。'):
        {summary:phrase==='查看不采用的插件'?catalog.filter(p=>p.lane==='不采用').map(p=>pluginLabel(p.name)+'：'+p.reason).join('；'):
          ['已安装','可安装','只学思路','不采用'].map(l=>l+'：'+catalog.filter(p=>p.lane===l).length+' 项').join('；')+'。分类来自资料，不能证明当前机器已安装。'}},
    {id:'plugins-channels',title:demoText("plugins.title.61"),icon:'chat',featureId:'connections',steward:featureAssistantId('connections'),group:'客服草稿',
      oneLine:demoText("plugins.sample.62"),
      status:()=>[{label:'通道样例',value:customerChannels.length},{label:'只出草稿',value:customerChannels.filter(c=>c.draftOnly).length},{label:'真实连接',value:'未核验',tone:'wait'}],
      phrases:demoFixture("plugins.phrases.63"),
      act:phrase=>phrase===demoText("plugins.act.64")?{summary:customerChannels.map(c=>c.name+'：'+c.connection+'；'+c.scope).join('。')+'。无真实客户收件。'}:
        phrase===demoText("plugins.act.65")?mutate(customerChannels,()=>customerChannels.forEach(c=>{c.draftOnly=true;c.auto=false;}),demoText("plugins.act.66")):
          mutate(customerChannels,()=>customerChannels.forEach(c=>{c.read=true;}),'已将三条虚构收件标为已读，未读取真实客服消息。')},
    {id:'plugins-internal-channels',title:'内部与邮件通道',icon:'chat',featureId:'connections',steward:featureAssistantId('connections'),group:'连接',
      oneLine:'邮件与内部 bot 通道只拟稿，按范围核验连接。',
      status:()=>[{label:'通道样例',value:internalChannels.length},{label:'只出草稿',value:internalChannels.filter(c=>c.draftOnly).length}],
      phrases:['看看内部通道状态','内部通道都只出草稿','将内部示例收件标为已读'],
      act:phrase=>phrase==='看看内部通道状态'?{summary:internalChannels.map(c=>c.name+'：'+c.connection+'；'+c.scope).join('。')}:
        phrase==='内部通道都只出草稿'?mutate(internalChannels,()=>internalChannels.forEach(c=>{c.draftOnly=true;c.auto=false;}),'已将内部和邮件示例通道设为只拟稿；没有发送消息。'):
          mutate(internalChannels,()=>internalChannels.forEach(c=>{c.read=true;}),'已将内部虚构收件标为已读，未访问真实账号。')},
    {id:'plugins-extensions',title:'MCP 与 skills',icon:'tools',featureId:'connections',steward:featureAssistantId('connections'),group:'扩展',
      oneLine:'按 bot 限定扩展范围，只改变本页演示开关。',
      status:()=>[{label:'MCP 样例',value:extensions.filter(x=>x.type==='MCP').length},{label:'skill 样例',value:extensions.filter(x=>x.type==='skill').length},{label:'演示启用',value:extensions.filter(x=>x.enabled).length}],
      phrases:['查看扩展作用域','暂停全部 MCP 演示','恢复只读知识库演示'],
      act:phrase=>phrase==='查看扩展作用域'?{summary:extensions.map(x=>x.name+'：'+(x.enabled?'演示启用':'演示关闭')+'；'+x.bots.map(botName).join('、')+'；'+x.scope).join('。')}:
        phrase==='暂停全部 MCP 演示'?mutate(extensions,()=>extensions.filter(x=>x.type==='MCP').forEach(x=>{x.enabled=false;}),'已暂停本页全部 MCP 演示开关，未停止真实进程。'):
          mutate(extensions,()=>{extensions[0].enabled=true;extensions[0].bots=['chief','research'];},demoText("plugins.act.67"))},
    {id:'plugins-providers',title:'模型提供方',icon:'jobs',featureId:'connections',steward:featureAssistantId('connections'),group:'模型路由',
      oneLine:'核对候选模型与登录缺口，在对话里记录分工草案。',
      status:()=>[{label:'提供方样例',value:providers.length},{label:'分工草案',value:S.providerChoice||'尚未指定'},{label:'连接',value:'未测试',tone:'wait'}],
      phrases:demoFixture("plugins.phrases.68"),
      act:phrase=>phrase==='查看模型提供方'?{summary:providers.map(p=>p.name+'：'+p.model+'；'+p.status).join('。')+'。订阅窗口与真实连接均未检测。'}:
        assignState('providerChoice',phrase===demoText("plugins.act.69")?demoText("plugins.act.70"):demoText("plugins.act.71"),'已记下本页分工草案：'+(phrase===demoText("plugins.act.72")?demoText("plugins.act.73"):demoText("plugins.act.74"))+'。未修改 bot 大脑、真实路由或凭据。')},
    {id:'plugins-cua',title:'应用操控边界',icon:'shield',featureId:'permissions',steward:featureAssistantId('permissions'),group:'受控应用',
      oneLine:'先说受控窗口与禁区，随时暂停本页操控演示。',
      status:()=>[{label:'演示',value:S.cuaPaused?'暂停':'运行中'},{label:'允许窗口',value:apps.filter(a=>a.allowed).length},{label:'真实控制',value:'未接入'}],
      phrases:['查看应用操控禁区','暂停应用操控演示','选公开资料窗口作演示目标'],
      act:phrase=>phrase==='查看应用操控禁区'?{summary:apps.map(a=>a.name+'：'+a.machine+'；'+a.permission).join('。')+'。没有屏幕捕获、键鼠控制或系统授权。'}:
        phrase==='暂停应用操控演示'?assignState('cuaPaused',true,'已暂停本页 CUA 演示。真实设备从未被控制。'):
          (()=>{const before={app:S.cuaApp,paused:S.cuaPaused,step:S.cuaStep};S.cuaApp=apps[0].name;S.cuaPaused=true;S.cuaStep=0;
            return {summary:'已选公开资料窗口作为本页演示目标，保持暂停；未打开浏览器或操作设备。',undo:()=>{S.cuaApp=before.app;S.cuaPaused=before.paused;S.cuaStep=before.step;}};})()},
    {id:'plugins-dispatch',title:'多 bot 任务交接',icon:'branch',steward:'chief',group:'派工草稿',
      oneLine:demoText("plugins.sample.75"),
      status:()=>[{label:'本页轮次',value:S.group?'第 '+S.group.id.split('-').pop()+' 轮草稿':'未登记'},{label:'回执',value:S.group?S.group.receipts.filter(r=>r.status==='回执已到').length+'/'+S.group.receipts.length:'0/0'},{label:'真实派工',value:'未执行'}],
      phrases:['登记多 bot 派单草稿','查看本轮派单状态','暂停本轮派单演示'],
      act:phrase=>phrase==='查看本轮派单状态'?{summary:S.group?S.group.text+'；'+(S.group.closed?'本页已暂停或关闭':'等待模拟回执，尚未验收'):'尚未登记派单草稿。'}:
        phrase==='暂停本轮派单演示'?(S.group?assignState('group',Object.assign({},S.group,{closed:true}),'已暂停本页派单演示，未终止真实任务。'):{summary:'没有进行中的派单草稿。'}):
          S.group&&!S.group.closed?{summary:'现有草稿尚未关闭，不重复登记；仍在等待回执。'}:
            assignState('group',{id:'DEMO-GROUP-'+(++S.seq),text:S.groupText,closed:false,accepted:false,receipts:S.members.map(id=>({id,status:'已派单',evidence:''}))},demoText("plugins.act.76"))},
    {id:'plugins-bili',title:'公开选题线索',icon:'search',steward:'content',group:'内容草稿',
      oneLine:'匿名线索留给人选题，字幕缺失与 412 明确停下。',
      status:()=>[{label:'虚构线索',value:topics.length},{label:'已选',value:topics.filter(t=>t.status==='selected').length},{label:'字幕',value:S.biliRound>1?'模拟 412 已停':'未读取',tone:'wait'}],
      phrases:['查看公开选题线索','模拟一轮字幕遇 412','将本地视觉题选入草稿'],
      act:phrase=>phrase==='查看公开选题线索'?{summary:topics.map(t=>t.title+'；'+t.subtitle).join('。')+'。全部为虚构样例，不是近期热点。'}:
        phrase==='模拟一轮字幕遇 412'?assignState('biliRound',2,demoText("plugins.act.77")):
          mutate(topics,()=>{topics[0].status='selected';},demoText("plugins.act.78"))},
    {id:demoText("plugins.id.79"),title:demoText("plugins.title.80"),icon:'shield',steward:'content',group:'内容草稿',
      oneLine:'保持账号与内容指纹绑定，未知提交结果只读回查。',
      status:()=>[{label:'草稿队列',value:S.snsPaused?'暂停':'演示待审'},{label:'防重闸门',value:S.snsGate==='unknown'?'结果未知':S.snsGate==='found'?'模拟回执已找到':'模拟无回执'},{label:'真实发布',value:'0 次'}],
      phrases:demoFixture("plugins.phrases.81"),
      act:phrase=>phrase===demoText("plugins.act.82")?{summary:'内容与发布任务均为虚构。四张配图均未预览，配文回读未完成，发布授权未取得；结果未知只读回查，无回执也不构成发送授权。'}:
        phrase===demoText("plugins.act.83")?assignState(demoText("plugins.act.84"),true,demoText("plugins.act.85")):
          assignState(demoText("plugins.act.86"),'found','已演示查到已有回执，防重闸门禁止重发。没有查询真实平台或发送内容。')},
    {id:'plugins-wechat-member',title:demoText("plugins.title.87"),icon:'chat',steward:demoText("plugins.steward.88"),group:'成员草稿',
      oneLine:demoText("plugins.sample.89"),
      status:()=>[{label:'在线群',value:3},{label:'待发草稿',value:2},{label:'已暂停',value:0}],
      phrases:demoFixture("plugins.phrases.90"),
      act:phrase=>({parts:wechatReply(phrase===demoText("plugins.parts.91")?'digest':phrase===demoText("plugins.parts.92")?'draft':'live')})},
    {id:'plugins-remote-bots',title:'远端服务与任务',icon:'branch',featureId:'devices',steward:featureAssistantId('devices'),group:'跨机器协作',
      oneLine:'看三台电脑上的虚构服务 / 任务，选两个试拟交接记录。',
      status:()=>[{label:'设备',value:3},{label:'服务 / 任务',value:'6（演示）'},{label:'真实连接',value:'未检查'}],
      phrases:['看看远端服务与任务','让它们互相交接','看看跨机器交接边界'],
      act:()=>({parts:[{type:'text',md:demoLabel+'。在线状态为假数据；在卡里选两项服务或任务，生成本页交接记录。\n'+remoteWhitelistText()},remotePart()]})},
    {id:'plugins-checkup',title:'帮我体检',icon:'shield',featureId:'devices',steward:featureAssistantId('devices'),group:'设备健康',
      oneLine:'逐项查看演示体检结果，真实健康待核，可预览脱敏诊断包。',
      status:()=>[{label:'演示检查项',value:5},{label:'真实健康',value:'未检查'},{label:'待核',value:2}],
      phrases:['帮我体检','看看哪些健康项待核','准备脱敏诊断包'],
      act:()=>({parts:[{type:'text',md:demoLabel+'。勾选项只表示演示清单已整理，未读取任何设备；脱敏诊断包按钮只预览演示清单。'},checkupPart()]})}
  ];
  H.registerCard('plugins-capability-status',{title:'工具能力状态',quoteLabel:d=>d.title+' · '+d.summary,render:d=>{
    const root=el('section','root');
    mount(root,(body,draw)=>body.append(box(d.title,[badge('离线演示 · 刷新复原'),text(d.summary),
      row(d.items.map(x=>badge(x.label+'：'+x.value))),
      d.changed?note(d.undone?'已撤销本页改动。':'已改好 · 仅本页内存，未更改真实服务。'):null,
      d.undo&&!d.undone?button('撤销这次本页改动',()=>{
        const record=undoRecords.get(d.undo);
        if(!record||latestChange.get(record.id)!==d.undo){H.toast('此回执已过期，不能覆盖更新的改动');return;}
        record.undo();undoRecords.delete(d.undo);latestChange.delete(record.id);d.undone=true;
        if(d.featureId)H.featureRecord(d.featureId,{time:connectionDemo.checkedAt+' · 本页操作',title:d.title,text:'已撤销：'+d.summary});
        d.items=capabilities.find(c=>c.id===record.id).status();draw();
      }):null,
      d.panel?button('打开订阅工具',()=>open(d.panel),true,'tools'):null
    ],null,d.steward)));
    return root;
  }});
  capabilities.filter(c=>!c.featureId||H.featureOwner(c.featureId)).forEach(c=>H.registerCapability({id:c.id,title:c.title,icon:c.icon,steward:c.featureId?featureAssistantId(c.featureId):c.steward,featureId:c.featureId,group:c.group,oneLine:c.oneLine,status:c.status,phrases:c.phrases,
    reply:phrase=>{
      const result=c.act(phrase);let token;
      if(result.parts)return c.id==='plugins-catalog'?result.parts.concat({type:'text',md:reviewText}):result.parts;
      if(result.undo && c.featureId) H.featureRecord(c.featureId,{time:connectionDemo.checkedAt+' · 本页操作',title:c.title,text:result.summary});
      if(result.undo){token='plugins-undo-'+(++undoSeq);const old=latestChange.get(c.id);if(old)undoRecords.delete(old);undoRecords.set(token,{id:c.id,undo:result.undo});latestChange.set(c.id,token);}
      return [{type:'plugins-capability-status',data:{title:c.title,steward:c.featureId?featureAssistantId(c.featureId):c.steward,featureId:c.featureId,summary:result.summary,items:c.status(),changed:!!token,undo:token,panel:result.panel}},...(c.id==='plugins-catalog'?[{type:'text',md:demoLabel+'。\n'+reviewText}]:[])];
    }
  }));

  function capabilityPanel(container, ids) {
    mount(container,root=>{
      root.append(note('说一句，交给负责助理。所有状态与改动仅在本页演示，刷新复原。'));
      ids.forEach(id=>{
        const c=capabilities.find(c=>c.id===id);
        root.append(box(c.title,[text(c.oneLine),row(c.status().map(x=>badge(x.label+'：'+x.value))),
          ['plugins-cua','plugins-controlled-apps'].includes(id)?el('p','tier-note',tierNote):null,
          ...c.phrases.map(phrase=>button(phrase,()=>H.runCapability(c.id,phrase)))
        ],null,c.steward));
      });
    });
  }
  function settings(container) {
    mount(container,root=>root.append(stack([
      note('连接和后台状态已收进功能页；在对话里查看、修改本页演示状态。'),
      button('订阅工具',()=>open('pool'),true,'tools'),
      button('查看本模块能力',()=>H.sheet({title:'工具与连接 · 能力',body:c=>capabilityPanel(c,capabilities.map(x=>x.id))}),'tertiary')
    ])));
  }
  H.registerView('tools',{title:'订阅工具',icon:'tools',hidden:true,render:view});
  const panels={
    detail:['插件能力','tools',c=>capabilityPanel(c,['plugins-catalog'])],
    pool:['订阅工具','tools',c=>mount(c,r=>pool(r),'art')],
    use:['在这里用 · 任务草稿','tools',use],art:[demoText("plugins.art.93"),'image',art],
    cua:['应用操控能力','shield',c=>capabilityPanel(c,['plugins-cua'])],
    channels:['通道能力','chat',c=>capabilityPanel(c,['plugins-channels','plugins-internal-channels'])],
    group:['多 bot 派单能力','branch',c=>capabilityPanel(c,['plugins-dispatch'])],
    context:['上下文能力','context',c=>mount(c,r=>r.append(note('上下文整理已并入记忆页的按需记忆；'+demoLabel+'。'),h('button',{class:'m-plugins-button ghostbtn',onClick:()=>H.openFeature('memory')},'查看记忆 · 上下文整理')))],
    extensions:['MCP 与 skills 能力','tools',c=>capabilityPanel(c,['plugins-extensions'])],
    bili:['公开选题能力','search',c=>capabilityPanel(c,['plugins-bili'])],
    sns:[demoText("plugins.sample.94"),'tools',c=>capabilityPanel(c,demoFixture("plugins.sample.95"))],
    providers:['模型提供方能力','jobs',c=>capabilityPanel(c,['plugins-providers'])]
  };
  Object.keys(panels).forEach(id=>H.registerPanel('plugins-'+id,{title:panels[id][0],icon:panels[id][1],group:'工具与通道',render:(container,ctx)=>{panels[id][2](container,ctx);const root=container.querySelector('.m-plugins-root');if(root)root.classList.add('m-plugins-panel');}}));
  H.registerSettingsPage('plugins-settings',{title:'工具与连接',icon:'tools',group:'连接',order:35,render:settings});
  [['pool','订阅工具','tools'],['art','艺术工作台','image'],['group','@ 多 bot 派单','branch'],['context','上下文洞察','context']].forEach(x=>H.registerComposerTool({id:'plugins-'+x[0],label:x[1],icon:x[2],run:()=>open(x[0])}));
  H.registerBotTab('plugins-subscriptions',{title:'订阅工具',render:(container,bot)=>{
    mount(container,root=>root.append(bot.id==='art'?
      button('打开订阅工具',()=>open('pool'),true,'tools'):
      button(demoText("plugins.render.96"),()=>H.navigate({view:'chat',conversation:'art-013'}),'tertiary','image')));
  }});
  H.registerCard('plugins-receipt',{title:'工具交接',quoteLabel:d=>(d.title||'工具交接')+' · '+(d.status||'演示'),render:d=>{
    const root=el('section','root');root.append(box(d.title||'工具交接',[row([badge(d.status||'草稿','good'),badge('仅本页 · 未外发')]),text(d.detail||'无真实回执'),button('订阅工具',()=>open('pool'))],demoText("plugins.render.97")));return root;
  }});

  H.registerFeatureSection('connections',{id:'plugins-connections-now',kind:'now',title:'账号与接入状态',render:container=>{
    container.append(note('离线样本 · 最后样本核验：'+connectionDemo.checkedAt+'；真实账号身份与连接均未核验。'));
    tools.forEach(tool=>container.append(h('article',{'data-connection-account':tool.id},[
      el('h4','title',tool.name),text('账号：'+connectionDemo.account+' · 接入：'+tool.login),
      text('本页演示：'+(tool.paused?'已暂停':'未暂停')+' · 真实核验时间：未知'),source(tool.from)
    ])));
    container.append(el('h4','title','通道接入'));
    channels.forEach(channel=>container.append(h('article',{'data-connection-channel':channel.id},[
      text(channel.name+' · '+channel.connection+'（样本）'),text('只拟稿：'+(channel.draftOnly?'是':'否')+' · 真实连接待核')
    ])));
    var pending=H.pendingInputs();
    container.append(el('h4','title','待输入清单 · '+pending.length+' 项'),note('这里只显示阻塞和去处；输入内容留在原私密输入卡。'));
    pending.forEach(item=>container.append(h('article',{'data-connection-pending':item.id},[
      text('卡住：'+item.blocking),
      h('button',{class:'ghostbtn','data-connection-pending-open':item.id,onClick:()=>H.openPendingInput(item.id)},'去 '+botName(item.bot)+' 的私密输入卡')
    ])));
    if(!pending.length)container.append(note('没有待输入的项目。'));
  }});
  H.registerFeatureSection('connections',{id:'plugins-connections-log',kind:'log',title:'接入记录',render:container=>{
    connectionDemo.history.forEach(event=>container.append(h('article',{'data-connection-change':true},[
      text(event.time+' · '+event.scope+' · '+event.before+' → '+event.after),text(event.evidence)
    ])));
  }});
  H.registerFeatureSection('devices',{id:'plugins-devices-now',kind:'now',title:'远端服务 / 任务样本',render:container=>{
    container.append(note(demoLabel+'；不增加助理名册，不把远端样本当成另一组人。'));
    remoteMachines.forEach(machine=>container.append(box(machine.device,machine.samples.map(sample=>text(sample.kind+' · '+sample.name+' · 状态未核验')),null,featureAssistantId('devices'))));
  }});
  H.registerFeatureSection('devices',{id:'plugins-devices-log',kind:'log',title:'设备操作与体检样例',render:container=>{
    container.append(note('保留原屏幕动手、陪看互斥和体检卡；本页没有采集屏幕或控制设备。'),
      h('button',{class:'ghostbtn','data-hub-conversation':'plugins-machines-demo'},'查看服务交接、屏幕操作与体检记录'));
  }});

  H.registerConversation('chief',{id:conversation,title:'工具池 · 演示交接',messages:[{from:'chief',time:'刚刚',parts:[{type:'text',md:'这里集中收工具草稿、插件结论和模拟派单回执。连接、用量、生成结果全部是演示；不代表已安装、已生成或已发布。'},{type:'plugins-receipt',data:{title:'整合边界',status:'离线样张',detail:'来源：本地能力地图、插件界面笔记、扩展点地图与既有成果清单。历史验证与当前运行分开，本次无真实服务调用。'}}]}]});
  H.registerConversation(demoText("plugins.sample.98"),{id:'plugins-wechat-demo',title:demoText("plugins.title.99"),messages:[
    {from:demoText("plugins.from.100"),time:'刚刚',parts:wechatReply('digest')},
    {from:demoText("plugins.from.101"),time:'刚刚',parts:[{type:'text',md:demoText("plugins.md.102")+demoLabel+'。\n'+wechatRules},wechatPart('draft')]},
    {from:demoText("plugins.from.103"),time:'刚刚',parts:wechatReply('live')}
  ]});
  H.registerConversation(featureAssistantId('devices'),{featureId:'devices',id:'plugins-machines-demo',title:'跨机器服务 / 任务 · 体检演示',messages:[
    {from:featureAssistantId('devices'),time:'刚刚',parts:[{type:'text',md:demoLabel+'。三台电脑与服务 / 任务均为离线假数据，选两项 试拟交接记录。\n'+remoteWhitelistText()},remotePart()]},
    {from:featureAssistantId('devices'),time:'刚刚',parts:screenParts()},
    {from:featureAssistantId('devices'),time:'刚刚',parts:watchParts()},
    {from:featureAssistantId('devices'),time:'刚刚',parts:[{type:'text',md:demoLabel+'。逐项勾选只代表演示清单；真实设备健康尚未检查，诊断包为脱敏样张。'},checkupPart()]}
  ]});
})();
