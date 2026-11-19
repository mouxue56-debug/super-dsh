
(function () {
  'use strict';
  const H = window.Hub, h = H.h;
  const TODAY = '2026-11-14', CONVERSATION = 'memory-demo';
  const owner = () => H.featureOwner('memory');
  const ownerId = () => owner()?.id;
  const bots = H.state.bots.map(bot => [bot.id]);
  const featurePages = window.FEATURE_PAGES;
  const projects = demoFixture("memory.projects.1");
  const origins = demoFixture("memory.origins.2");
  // Keep file pointers in the demo model; every visible reference uses a page name.
  function knowledgePage(pointer) {
    const file = String(pointer || '').split('/').pop();
    const names = demoFixture("memory.names.3");
    return '知识库 · ' + (names[file] || file.replace(/\.md$/i,'') || '待核页名');
  }
  function pagePointer(value, original) {
    if (value === knowledgePage(original)) return original;
    // Existing path validation still applies; a renamed page keeps its directory.
    if (value.includes('/')) return value;
    const page = value.replace(/^知识库\s*·\s*/, '').replace(/\.md$/i, '').trim();
    return page ? original.replace(/[^/]+$/, page + '.md') : '';
  }
  const catalog = demoFixture("memory.catalog.4");
  const allow = demoFixture("memory.allow.5");
  let seq = 20;
  function seed(id, bot, scope, title, pointer, project, confirmation, date, expires, extra) {
    return Object.assign({id, bot, scope, title, pointer, project, confirmation, date, expires,
      source:bot + '-demo-013', author:demoText("memory.author.6"), verified:'未现场核验', origin:origins[project],
      revision:1, forgotten:false, pending:false, rule:false, category:'项目指针', receipt:null}, extra || {});
  }
  let memories = [
    seed('mem-1','chief','shared','动态事实回项目正本核对',demoText("memory.memories.7"),'common',demoText("memory.memories.8"),'2026-11-08',''),
    seed('mem-2',demoText("memory.memories.9"),'private',demoText("memory.memories.10"),demoText("memory.memories.11"),demoText("memory.memories.12"),demoText("memory.memories.13"),'2026-11-09',''),
    seed('mem-3','content','private',demoText("memory.memories.14"),demoText("memory.memories.15"),'ai',demoText("memory.memories.16"),'2026-11-08',''),
    seed('mem-4','pm','private','DSH 交接先核源码与唯一写者',demoText("memory.memories.17"),'dsh','未确认','2026-11-10','2026-11-30'),
    seed('mem-5','art','private','角色资产先回母版查版本',demoText("memory.memories.18"),'video','未确认','2026-11-10','2026-12-01'),
    seed('mem-6','research','private','研究结论保留资料观察日期',demoText("memory.memories.19"),'dsh',demoText("memory.memories.20"),'2026-11-09',''),
    seed('mem-7','chief','shared','既有设备记录使用正式设备名',demoText("memory.memories.21"),'common',demoText("memory.memories.22"),'2026-11-08',''),
    seed('mem-8','chief','shared','先读指针再核项目正本',demoText("memory.memories.23"),'common','未确认','2026-11-10',''),
    seed('mem-9','content','private','旧版交接入口待复核',demoText("memory.memories.24"),'ai','未确认','2026-10-01','2026-11-12'),
    seed('mem-10','chief','shared','所有助理预加载全部项目资料',demoText("memory.memories.25"),'dsh','未确认','2026-10-20','', {conflict:'loading'}),
    seed('mem-11','chief','shared','点到助理再加载允许的记忆包',demoText("memory.memories.26"),'dsh',demoText("memory.memories.27"),'2026-11-12','', {conflict:'loading'}),
    seed('mem-12',demoText("memory.memories.28"),'private','客服回复先匹配场景入口',demoText("memory.memories.29"),demoText("memory.memories.30"),'未确认',TODAY,'', {pending:true}),
    seed('mem-13','content','private','四平台回执按期关联',demoText("memory.memories.31"),'ai','未确认',TODAY,'', {pending:true}),
    seed('mem-14','chief','shared','知识贡献分清送达与整理',demoText("memory.memories.32"),'dsh','未确认',TODAY,'', {pending:true})
  ];
  const packages = {};
  bots.forEach(b => { packages[b[0]] = {private:null, shared:null, kb:null}; });
  // Slice metadata only: no file reads, model calls, or actual context injection.
  const mountSeeds = demoFixture("memory.mountSeeds.33");
  // 旧 source 仅保留资料原始标识，登记边界显式使用 featureId。
  const mountBots = bots.map(b => b[0]);
  Object.entries(mountSeeds).forEach(([source, rows]) => {
    const feature = featurePages.find(page => page.source === source);
    H.registerMemoryMounts(feature ? H.featureOwner(feature.id)?.id : source,rows.map(([id,title,pointer,tokens])=>({
      id:'memory-'+source+'-'+id,title,source:'本页演示 · '+knowledgePage(pointer),tokens,
      ...(feature ? {featureId:feature.id,originalSource:source} : {})
    })),feature ? {featureId:feature.id} : undefined);
  });
  let contextConversation = H.state.conversation || (ownerId() && ownerId()+'-013');
  const contextBefore = new Map();
  H.on('navigate',ctx=>{
    if(ctx.state.mode==='chat'&&!Object.hasOwn(memorySessions,ctx.conversation)&&H.contextSnapshot(ctx.conversation))contextConversation=ctx.conversation;
  });
  let events = [{date:TODAY, text:'助理切片与七页资料分别就绪；功能资料不自动进入助理上下文，均为演示估算。'}];
  let redlines = demoFixture("memory.sample.34");
  const observers = new Set();
  let lastUndo = null, actionSeq = 0, diffSeq = 0;
  const diffs = new Map();
  let latestDiffs = [];
  const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
  const name = id => H.state.bots.find(bot => bot.id === id)?.name || id;
  const sessionTitles = Object.assign({}, H.state.sessionNames);
  const memorySessions = {
    'memory-demo':'记忆中心 · 来源与撤销演示',
    'memory-steward-r6':'关于你的三件事 · 离线演示',
    'memory-steward-r7':'记忆改动对比 · 新增与修改',
    'memory-steward-r8':'按需记忆 · 体检、来源与上下文',
    'demo-import-r6':'示例指针导入'
  };
  // Format labels only; source keys remain intact for routing and snapshots.
  function conversationName(source, bot) {
    if (!source) return '本轮对话（演示）';
    if (memorySessions[source]) return memorySessions[source];
    const owner = H.state.bots.find(b => source === b.id || source === b.id+'-013' || source === b.id+'-demo-013');
    if (owner) return name(owner.id)+' · '+(sessionTitles[owner.id] || '演示会话');
    return /^[a-z\d]+(?:-[a-z\d]+)+$/i.test(source) ? (bot ? name(bot)+' · ' : '')+'演示会话' : source;
  }
  const entryName = id => '条目\u00a0'+id;
  const quantity = (value, unit) => value+'\u00a0'+unit;
  const active = () => memories.filter(m => !m.forgotten && !m.pending);
  const expired = m => !!m.expires && m.expires < TODAY;
  const visible = (m, bot) => (m.scope === 'private' ? m.bot === bot : (allow[bot] || ['common']).includes(m.project));
  const usable = (m, bot) => !m.forgotten && !m.pending && !expired(m) && !m.conflict && visible(m, bot);
  const get = id => memories.find(m => m.id === id);
  const tokenEstimate = rows => Math.ceil(rows.reduce((n,m) => n + (m.title + m.pointer).length, 0) / 1.5);
  const surfaces = {card:'pop-card',stat:'pop-card',eyebrow:'sticker bot',badge:'badge',tabs:'segmented',field:'field',toggle:'toggle-row'};
  const el = (tag, cls, children, attrs) => h(tag, Object.assign({class:'m-memory-' + cls + (surfaces[cls.split(' ')[0]] ? ' ' + surfaces[cls.split(' ')[0]] : '')}, attrs || {}), children);
  const botScope = (node, bot) => { node.setAttribute('style',H.botStyle(bot)); return node; };
  const ownerScope = node => ownerId() ? botScope(node,ownerId()) : node;
  const text = s => el('p','muted',s);
  const badge = (s, tone) => el('span','badge' + (tone ? ' m-memory-' + tone : '') + (tone==='warn' ? ' sticker' : ''),s);
  const row = children => el('div','row',children);
  const stack = children => el('div','stack',children);
  const button = (label, fn, level) => h('button',{type:'button',class:'m-memory-btn ' + (level===true ? 'btn-primary m-memory-primary' : level==='tertiary' ? 'btn-tertiary m-memory-tertiary' : 'btn-secondary m-memory-secondary'),onClick:fn},label);
  const actions = children => el('div','actions',children);
  const empty = s => el('div','empty',s);
  const field = (label, control) => el('label','field',[el('span','label',label),control]);
  function input(value, label, attrs) {
    return h('input',Object.assign({class:'m-memory-input pop-input',value:value || '', 'aria-label':label}, attrs || {}));
  }
  function select(options, value, label, change) {
    return h('select',{class:'m-memory-input pop-input',value, 'aria-label':label,onChange:e=>change(e.target.value)},
      options.map(o=>h('option',{value:o[0],selected:o[0]===value},o[1])));
  }
  function clear(node) { node.textContent = ''; }
  function watch(node, draw) {
    const refresh = () => { if (node.isConnected === false) { observers.delete(refresh); return; } draw(); };
    observers.add(refresh); draw();
  }
  function refresh() { observers.forEach(fn=>fn()); }
  function invalidate() { bots.forEach(b=>Object.keys(packages[b[0]]).forEach(k=>{ packages[b[0]][k] = null; })); }
  function checkpoint(withMounts) { return JSON.stringify({memories,redlines,packages,
    mounts:withMounts?Object.fromEntries(mountBots.map(id=>[id,H.memoryMounts(id)])):null}); }
  function memoryLines(m) {
    if (!m || m.forgotten) return [];
    return [m.title, '正本入口：' + knowledgePage(m.pointer), '状态：' + (m.pending ? '待确认' : '已保存') + ' · 【' + m.confirmation + '】'];
  }
  function rememberDiff(before, after, reason, source) {
    const m = after || before, id = 'memory-change-' + (++diffSeq);
    const data = {id, bot:m.bot, title:!before || before.forgotten ? '我记下了' : '我改了',
      before:memoryLines(before), after:memoryLines(after), reason,
      date:TODAY,
      source:source || H.state.conversation || CONVERSATION,
      memoryId:m.id, snapshotBefore:clone(before), snapshotAfter:clone(after), reverted:false, accepted:false};
    diffs.set(id,data); return data;
  }
  function record(label, mutate, keepPackages) {
    const snapshot = checkpoint(keepPackages), before = clone(memories);
    lastUndo = {id:++actionSeq,label,snapshot,diffIds:[]};
    if(!keepPackages)invalidate(); mutate();
    const ids = new Set([...before.map(m=>m.id),...memories.map(m=>m.id)]);
    latestDiffs = [];
    ids.forEach(id=>{
      const old = before.find(m=>m.id===id) || null, next = get(id) || null;
      if(JSON.stringify(old)!==JSON.stringify(next)) latestDiffs.push(rememberDiff(old,next,label));
    });
    lastUndo.diffIds = latestDiffs.map(d=>d.id);
    latestDiffs.forEach(data=>H.featureRecord('memory',{time:data.date,title:label,sourceConversation:data.source,
      parts:[{type:'memory-diff',data}]}));
    events.unshift({date:TODAY,text:label + ' · 仅本页'}); refresh(); H.toast(label + ' · 可撤销');
  }
  function undo() {
    if (!lastUndo) return H.toast('没有待撤销操作');
    const old = JSON.parse(lastUndo.snapshot), {label,diffIds} = lastUndo;
    memories = old.memories; redlines = old.redlines; lastUndo = null;
    Object.keys(packages).forEach(id=>{packages[id]=old.packages[id];});
    if(old.mounts)Object.entries(old.mounts).forEach(([id,slices])=>H.registerMemoryMounts(id,slices));
    (diffIds || []).forEach(id=>{const d=diffs.get(id);if(d){d.reverted=true;d.accepted=false;}});
    events.unshift({date:TODAY,text:'已撤销：' + label}); refresh(); H.toast('已撤销 · ' + label);
  }
  function toggleDiff(data) {
    if(data.memoryId){
      const expected=data.reverted?data.snapshotBefore:data.snapshotAfter;
      if(JSON.stringify(get(data.memoryId)||null)!==JSON.stringify(expected)){
        H.toast('这条记忆后来又有改动，请先撤销后续改动，再回来操作。');return;
      }
      const target=clone(data.reverted?data.snapshotAfter:data.snapshotBefore);
      const index=memories.findIndex(m=>m.id===data.memoryId);
      if(target){if(index<0)memories.push(target);else memories[index]=target;}
      else if(index>=0)memories.splice(index,1);
      invalidate();
      // A full-page checkpoint must not undo an earlier, individually reverted card.
      lastUndo=null;
    }
    data.reverted=!data.reverted;data.accepted=false;
    events.unshift({date:TODAY,text:(data.reverted?'已撤销':'已重新应用')+'：'+data.reason+' · 仅本页'});
    refresh(); H.toast(data.reverted?'已撤销 · 恢复为改前':'已重新应用 · 仅本页演示');
  }
  function diffCard(raw) {
    const data=diffs.get(raw.id) || Object.assign({},raw);
    if(raw.id&&!diffs.has(raw.id))diffs.set(raw.id,data);
    const root=ownerScope(el('article','diff pop-card',[],{'data-memory-diff':data.id||'preview'}));
    const lines=value=>Array.isArray(value)?value.map(String):value==null||value===''?[]:String(value).split('\n');
    function draw(){
      clear(root);
      const before=lines(data.before),after=lines(data.after);
      const state=data.reverted?'已撤销 · 恢复为改前':data.accepted?'已确认保留 · 仅本页':'可撤销 · 等你看一眼';
      root.append(el('header','diff-head pop-card-head',[
        el('span','eyebrow sticker bot','记忆'+(before.length?'修改':'新增')),
        heading(data.title==='我记下了'||data.title==='我改了'?data.title:before.length?'我改了':'我记下了'),
        el('p','diff-status',state,{role:'status','aria-live':'polite'})
      ]),H.levelSticker('L1',{action:'保留或撤销演示记忆改动',scope:'仅本页记忆',bot:ownerId()}),text('本页演示，未真实执行；只改变本页演示记忆，刷新复原。'),
        text('来源：'+conversationName(data.source,data.bot)+' · '+name(data.bot||ownerId())+' · 日期：'+(data.date||'未记录')),
        data.reason?text('缘由：'+data.reason):null,
        el('div',demoText("memory.sample.35"),[
          el('p','label','改前 → 改后'),
          ...before.map(line=>el('div',demoText("memory.sample.36"),[el('span','diff-sign','−',{'aria-label':'删除'}),el('span','diff-content',line)])),
          !before.length?text('改前：尚未记下这条'):null,
          ...after.map(line=>el('div',demoText("memory.sample.37"),[el('span','diff-sign','+',{'aria-label':'新增'}),el('span','diff-content',line)])),
          !after.length?text('改后：这条已忘记'):null
        ]),actions([
          h('button',{type:'button',class:'m-memory-btn ghostbtn','data-memory-diff-action':'toggle',onClick:()=>{
            toggleDiff(data);root.querySelector('[data-memory-diff-action="toggle"]')?.focus({preventScroll:true});
          }},data.reverted?'重新应用':'撤销'),
          h('button',{type:'button',class:'m-memory-btn btn-primary','data-memory-diff-action':'accept',disabled:!!data.reverted||!!data.accepted,onClick:()=>{
            data.accepted=true;refresh();H.toast('就这样 · 本页演示已保留');root.querySelector('[data-memory-diff-action="toggle"]')?.focus({preventScroll:true});
          }},data.accepted?'就这样 · 已保留':'就这样')
        ]));
    }
    watch(root,()=>H.reading ? H.reading.preserve(draw,{reason:'memory-diff'}) : draw());return root;
  }
  function dangerReason(title, pointer) {
    const value = title + '\n' + pointer;
    if (/sk-[\w-]{8,}|Bearer\s+\S+|api[_-]?key\s*[:=]|password\s*[:=]|口令\s*[:：=]|密钥\s*[:：=]|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value)) return '疑似凭据或联系方式';
    if (redlines.价格 && /[¥￥$]\s*\d|\d+\s*(日元|万元|元|円)|报价\s*[:：]/.test(value)) return '价格具体值';
    if (redlines[demoText("memory.sample.38")] && new RegExp(demoText("memory.sample.39"),"").test(value)) return demoText("memory.sample.40");
    if (redlines.客户隐私 && /手机号|电话号码|客户姓名|订单号|银行账号/.test(value)) return '客户隐私';
    if (!new RegExp(demoText("memory.sample.41"),"").test(pointer) || pointer.includes('..')) return '请填写允许范围内的知识库页名';
    return '';
  }
  function metadata(m) {
    return stack([
      row([badge('【' + m.confirmation + '】',m.confirmation==='未确认'?'warn':'good'), badge(m.rule?'规则候选':m.scope==='shared'?'共享记忆':'私有记忆'), badge(m.verified)]),
      text('提出者：' + m.author + ' · 原始日期 ' + m.date + ' · 到期 ' + (m.expires || '未设')),
      text('来源会话：' + conversationName(m.source,m.bot) + ' · 来自：' + m.origin),
      el('code','path',knowledgePage(m.pointer)),
      m.conflict ? badge('冲突隔离 · 不进入上下文','warn') : null,
      expired(m) ? badge('已过期 · 不进入上下文','warn') : null,
      m.receipt ? badge('模拟回执：' + ({queued:'待投递',pushed:'已送达',up_to_date:'已同步'}[m.receipt.status] || '状态待核')) : null
    ]);
  }
  const heading = title => el('h3','title',title);
  const remembered = bot => active().filter(m=>!bot || visible(m,bot));
  const waiting = bot => memories.filter(m=>m.pending&&!m.forgotten&&(!bot || m.bot===bot));
  const sections = [['overview','它记得我什么'],['inbox','等我确认的'],['edit','改 / 忘记']];
  function openMemory(section, bot, memoryId) {
    H.openPanel('memory',{section:section||'overview',bot:bot||'all',memoryId});
  }
  function ask(id, phrase) {
    const assistant=owner();
    if(!assistant)return H.toast('负责助理未指定或存在多位，请先核对名册');
    return H.fillDraft(assistant.id,phrase);
  }
  function memoryCard(m, editable) {
    return botScope(el('article','card',[
      heading(m.title),text(name(m.bot)+' · '+entryName(m.id)),metadata(m),
      actions([button(editable?'改 / 忘记这条':'查看 / 纠正',()=>openMemory('detail',m.bot,m.id))])
    ],{'data-memory-entry':m.id}),m.bot);
  }
  // Only these three sections are reachable from the compact panel. Maintenance lives in chat.
  function center(container, ctx) {
    const params=ctx?.params||{};
    const isAssistant=id=>H.state.bots.some(b=>b.id===id);
    let bot=params.bot==='all'?null:isAssistant(params.bot)?params.bot:null;
    const scoped=!!bot;
    let section=params.section==='detail'?'edit':sections.some(s=>s[0]===params.section)?params.section:'overview';
    let detailId=params.memoryId||null;
    const root=ownerScope(el('section','root',[],{'data-memory-scope':bot||'all'})),body=el('div','body');
    container.append(root);
    function draw() {
      clear(root);
      root.setAttribute('data-memory-scope',bot||'all');
      root.append(el('p','eyebrow','记忆'),heading('关于你的三件事'),
        text('离线假数据 · 只改当前页，刷新复原；没有读取或写入真实记忆。'),
        scoped?text('查看范围：'+name(bot)+' · 私有条目及获准共享线索'):field('查看范围',select([['all','全部助理（演示）'],...H.state.bots.map(b=>[b.id,b.name])],bot||'all','记忆范围',v=>{bot=v==='all'?null:v;detailId=null;draw();})),
        el('nav','tabs',sections.map(([id,title])=>{
          const tab=button(title,()=>{section=id;detailId=null;draw();},section===id);
          if(section===id)tab.classList.add('on');
          // The current section is a label, not a second no-op action.
          tab.disabled=section===id;tab.setAttribute('aria-current',section===id?'page':'false');
          return tab;
        }),{'aria-label':'记忆的三个入口'}),
        button('去找 '+(owner()?.name||'负责的助理')+'说',()=>ask('memory-recall',''),'tertiary'),body);
      clear(body);
      if(lastUndo)body.append(actions([text(lastUndo.label+' · 仅本页'),button('撤销最近操作',undo)]));
      if(section==='overview'){
        body.append(text('只列稳定线索与正本指针；过期或冲突条目不会用于上下文。'));
        const rows=remembered(bot);
        if(!rows.length)body.append(empty('此范围没有已保存的线索。'));
        rows.forEach(m=>body.append(memoryCard(m,false)));
      }
      if(section==='inbox'){
        const rows=waiting(bot);
        body.append(text(demoText("memory.sample.42")));
        if(!rows.length)body.append(empty('没有等你确认的记忆。'));
        rows.forEach(m=>body.append(el('article','card',[
          heading(m.title),text(name(m.bot)+' · '+entryName(m.id)),metadata(m),
          H.levelSticker('L1',{action:'确认或拒绝演示记忆候选',scope:'仅本页记忆',bot:ownerId()}),actions([
            button('确认保存（本页演示）',()=>{
              const live=get(m.id);if(!live||live.forgotten||!live.pending)return H.toast('这条候选已处理，请查看当前目录。');
              record('已确认保存（本页演示）',()=>{live.pending=false;live.confirmation=demoText("memory.sample.43");live.verified='未现场核验';});
            },true),button('先纠正',()=>{detailId=m.id;section='edit';draw();}),
            button('不记住',()=>{const live=get(m.id);if(live&&!live.forgotten)record('已拒绝候选（本页演示）',()=>{live.forgotten=true;});else H.toast('这条候选已不在目录，无需重复拒绝。');})
          ])
        ])));
        body.append(button('请负责助理提议一条示例线索',()=>ask('memory-pending','提议一条新的示例线索'),'tertiary'));
      }
      if(section==='edit'){
        const rows=memories.filter(m=>!m.forgotten&&(!bot||visible(m,bot)||m.pending&&m.bot===bot));
        const m=rows.find(m=>m.id===detailId);
        if(!m){
          if(detailId)body.append(empty('这条线索已忘记或不在当前范围。旧回复的溯源快照仍保留。'));
          body.append(text('选中一条再纠正或忘记，操作可以撤销。'));
          if(!rows.length)body.append(empty('没有可以修改的线索。'));
          rows.forEach(m=>body.append(memoryCard(m,true)));
        }else{
          body.append(heading(m.title),metadata(m),H.levelSticker('L1',{action:'纠正或忘记演示记忆',scope:'仅本页记忆',bot:ownerId()}));
          const title=input(m.title,'记忆摘要',demoFixture("memory.title.44")),pointer=input(knowledgePage(m.pointer),'知识库页名',demoFixture("memory.pointer.45")),feedback=el('p','feedback','',{role:'status'});
          body.append(field('把摘要改成',title),field('知识库页名',pointer),feedback,actions([
            button('保存纠正（本页演示）',()=>{
              const live=get(m.id),t=title.value.trim(),p=pagePointer(pointer.value.trim(),m.pointer),reason=dangerReason(t,p);
              if(!live||live.forgotten){feedback.textContent='条目已不可修改，请重新选择。';return;}
              if(!t||reason){feedback.textContent=reason||'请填写摘要';return;}
              record('已纠正；等你重新确认',()=>Object.assign(live,{title:t,pointer:p,pending:true,confirmation:'未确认',verified:'待复核',revision:live.revision+1,receipt:null}));
            },true),button('忘记这条（本页可撤销）',()=>{const live=get(m.id);if(live&&!live.forgotten)record('已忘记'+entryName(live.id),()=>{live.forgotten=true;});else H.toast('这条线索已经忘记，无需重复操作。');})
          ]));
        }
      }
    }
    watch(root,draw);
  }
  function diagnosis() {
    const rows=active(), groups=new Map();
    rows.forEach(m=>{const key=m.bot+'|'+m.scope+'|'+m.pointer;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);});
    return {duplicates:[...groups.values()].filter(g=>g.length>1),stale:rows.filter(expired),conflicts:rows.filter(m=>m.conflict)};
  }
  function traceCard(data) {
    const root=el('div','trace');
    const snapshots=Array.isArray(data.entries)?data.entries:[];
    root.append(h('details',{class:'m-memory-disclosure'},[
      el('summary','summary','这次回复用了哪些记忆 · '+quantity(snapshots.length,'条')+(data.demo?'（模拟凭证）':'')),
      text(data.demo?'固定演示凭证，和当前加载状态分别保存。':'没有接入真实召回日志。'),
      ...snapshots.map(s=>botScope(el('div','card',[el('strong','label',s.title),el('code','path',knowledgePage(s.pointer)),text('来源会话：'+conversationName(s.source,s.bot)+' · 原始日期：'+s.date+' · 【'+s.confirmation+'】 · 版本\u00a0'+s.revision),
        badge(get(s.id)&&get(s.id).forgotten?'现已忘记 · 旧回复凭证保留':'当时引用快照'),button('查看当前条目',()=>H.openPanel('memory',{section:'detail',memoryId:s.id,bot:s.bot}))]),s.bot)),
      !snapshots.length?text('未知：未提供召回记录、匹配理由或上下文注入凭证。'):text('匹配理由：知识贡献与正本入口；敏感正文未注入。')
    ]));
    return root;
  }
  function noteCard(data) {
    const root=el('article','card');
    function draw(){clear(root);const m=get(data.memoryId);if(m)botScope(root,m.bot);else ownerScope(root);root.append(row([H.icon('memory'),heading(m&&m.forgotten?'已撤销这条记忆':'记忆候选')]),
      text(m?m.title:'条目不存在'),badge(m&&m.pending?demoText("memory.sample.46"):'当前页演示'),text('本页演示，未真实执行；仅保存指针，尚未写入真实知识库。'),
      H.levelSticker('L1',{action:'撤销演示记忆候选',scope:'仅本页记忆',bot:ownerId()}),
      actions([button('查看 / 纠正',()=>H.openPanel('memory',{section:'detail',memoryId:data.memoryId,bot:m?m.bot:ownerId()})),
        m&&!m.forgotten?button('撤销这条记忆',()=>{const live=get(data.memoryId);if(live&&!live.forgotten)record('已撤销聊天记忆候选',()=>{live.forgotten=true;});else H.toast('这条记忆已撤销，旧回复仅保留演示快照。');}):null]));}
    watch(root,draw);return root;
  }
  function summary(title, summaryText, items, extra) {
    return [{type:'memory-summary',data:Object.assign({title,summary:'本页演示，未真实执行。'+summaryText,items:items||[]},extra||{})}];
  }
  function changed(title) {
    return summary(title,'已改好 · 仅当前页演示，未写入真实记忆，刷新复原。',[
      {label:'已保存',value:active().length},{label:'待确认',value:waiting().length}
    ],{undoId:lastUndo?.id,level:'L1'}).concat(latestDiffs.map(d=>({type:'memory-diff',data:d})));
  }
  function privacyReply(phrase) {
    if(phrase==='把四类隐私红线全部打开'){
      if(Object.values(redlines).every(Boolean))return summary('四类红线均已开启','本页输入筛查演示已启用，不代表真实防护已配置。',[{label:'类别',value:'4/4'},{label:'凭据',value:'固定拒绝'}]);
      record('已开启四类隐私红线',()=>Object.keys(redlines).forEach(k=>{redlines[k]=true;}));return changed('本页红线已开启');
    }
    const suspect=memories.filter(m=>!m.forgotten&&dangerReason(m.title,m.pointer));
    return summary(phrase,'只检查本页演示摘要和指针；不是生产隐私审计。',[{label:'疑似风险',value:suspect.length}],demoFixture("memory.sample.47"));
  }
  function sourceReply(phrase) {
    if(phrase==='看看最近的记忆修改')return summary('本页修改记录','原始日期与本页操作分别保存；刷新复原。',[],{lines:events.slice(0,6).map(e=>e.date+' · '+e.text)});
    if(phrase==='这次回复用了哪些记忆')return summary('真实召回来源未知','切片配置和真实召回凭证分别核对；没有模型调用或真实召回日志。').concat([{type:'memory-trace',data:{entries:[]}}]);
    return summary('送达、整理、确认分别核对','本页没有投递知识贡献，也没有外部写入。',[],demoFixture("memory.sample.48"));
  }
  function routingReply(phrase,conversation) {
    if(phrase===demoText("memory.sample.49")){
      const doc=catalog.find(d=>d.id==='wiki-news');
      return summary('知识入口 → '+name('content'),'离线关键词路由示例；没有读取文件或发送派单。',[{label:'负责人',value:name('content')}],{lines:[doc.title,knowledgePage(doc.path),'仅'+name('content')+'与获准助理可按白名单读取；当前资料未现场核验。']});
    }
    const sharedPhrase='只给'+(owner()?.name||'负责助理')+'加载共享规则包';
    if(phrase===sharedPhrase||phrase==='卸载全部助理的记忆包'){
      if(phrase===sharedPhrase&&!owner())return summary('尚未加载','负责助理未指定或存在多位，请先核对名册。');
      record(phrase===sharedPhrase?'已仅加载负责助理共享规则包':'已卸载助理记忆切片，功能页资料保留',()=>{
        invalidate();mountBots.forEach(id=>H.registerMemoryMounts(id,[]));
        if(phrase===sharedPhrase){
          const id=ownerId(),rows=active().filter(m=>m.scope==='shared'&&usable(m,id));
          packages[id]=packages[id]||{private:null,shared:null,kb:null};
          packages[id].shared={ids:rows.map(m=>m.id),tokens:tokenEstimate(rows)};
          H.registerMemoryMounts(id,rows.map(m=>({id:'memory-record-'+m.id,title:m.title,source:'本页演示 · '+knowledgePage(m.pointer),tokens:tokenEstimate([m])})));
        }
      },true);
      return changed('按需上下文已更新');
    }
    const target=conversation||contextConversation,snap=H.contextSnapshot(target);
    if(!snap)return summary('会话上下文暂不可用','请先打开要检查的助理会话，再询问记忆负责助理。');
    const before=snap.total,prior=contextBefore.get(target);
    if(phrase==='压缩本页示例上下文'&&!prior){
      contextBefore.set(target,{files:snap.segments.files,chat:snap.segments.chat,tools:snap.segments.tools});
      H.updateContext(target,{segments:{files:Math.ceil(snap.segments.files*.55),chat:Math.ceil(snap.segments.chat*.55),tools:Math.ceil(snap.segments.tools*.55)}});
    }else if(phrase==='恢复初始示例上下文'&&prior){
      // Restore only the three compressed segments; do not resurrect separately unmounted memory.
      H.updateContext(target,{segments:prior});contextBefore.delete(target);
    }
    const current=H.contextSnapshot(target),changedContext=current.total!==before;
    return summary(phrase,'目标：'+conversationName(target,snap.bot)+'；只整理演示计数，未压缩真实模型上下文。',[
      {label:'整理前',value:before},{label:'现在',value:current.total},{label:'记忆切片',value:H.memoryMounts(snap.bot).length}
    ],{level:'L1',conversation:target,tools:'routing',lines:[
      '系统段受保护；记忆卸载以壳的挂载列表为准，恢复只还原文件、对话和工具结果。',
      changedContext?'演示计数已更新；胶囊、小环和构成卡共用壳数据。':phrase==='压缩本页示例上下文'?'已经压缩过，不重复压缩。':phrase==='恢复初始示例上下文'?'没有待恢复的压缩。':'切换助理会释放当前上下文，切回仍可查看它的演示切片配置。'
    ]}).concat([{type:'governance-context-mix',data:{conversation:target,bot:snap.bot}}]);
  }
  function withTools(parts,group) { const first=parts.find(p=>p.type==='memory-summary');if(first)first.data.tools=group;return parts; }
  function postToolReply(parts) {
    const assistant=owner();
    if(!assistant)return H.toast('负责助理未指定或存在多位，请先核对名册');
    const current=H.contextSnapshot(H.state.conversation);
    const target=current?.bot===assistant.id?current.conversation:assistant.id+'-013';
    // Tools also appear in cross-bot cards: reveal their reply instead of posting offscreen.
    if(H.state.conversation!==target||H.state.mode!=='chat')H.navigate({view:'chat',conversation:target});
    H.postMessage(target,{from:assistant.id,time:'演示',parts});
  }
  const toolGroups = {
    health:[['忘记本页所有过期线索',()=>postToolReply(withTools(healthReply('忘记本页所有过期线索'),'health'))],['把四类隐私红线全部打开',()=>postToolReply(withTools(privacyReply('把四类隐私红线全部打开'),'health'))],['检查记忆是否含敏感正文',()=>postToolReply(withTools(privacyReply('检查记忆是否含敏感正文'),'health'))]],
    transfer:['看看最近的记忆修改','这次回复用了哪些记忆','知识贡献送达就算确认了吗'].map(phrase=>[phrase,()=>postToolReply(sourceReply(phrase))]),
    routing:[demoText("memory.routing.50"),'只给'+(owner()?.name||'负责助理')+'加载共享规则包','卸载全部助理的记忆包'].map(phrase=>[phrase,()=>postToolReply(routingReply(phrase))])
  };
  H.registerCard('memory-summary',{title:'记忆回执',quoteLabel:d=>d.title+' · '+d.summary,render:d=>{
    const root=el('article','card',[heading(d.title),text(d.summary),
      row((d.items||[]).slice(0,3).map(x=>badge(x.label+' · '+x.value))),
      ...(d.lines||[]).map(line=>text(line)),
      ...(d.entries||[]).map(m=>el('div','stack',[heading(m.title),text(name(m.bot)+' · '+entryName(m.id)),metadata(m)]))]);
    if(d.json)root.append(el('pre','path',d.json));
    if(d.level||d.undoId||d.tools)root.append(H.levelSticker(d.level||(d.tools==='health'||d.tools==='routing'?'L1':'L0'),{action:d.title,scope:'本页演示记忆与上下文',bot:ownerId()}));
    if(d.tools)root.append(actions((toolGroups[d.tools]||[]).map(([label,run])=>button(label,run))));
    if(d.section)root.append(button('打开'+(sections.find(x=>x[0]===d.section)?.[1]||'记忆面板'),()=>openMemory(d.section)));
    if(d.undoId){
      const control=button('撤销这次修改',()=>{if(lastUndo?.id===d.undoId)undo();else H.toast('这张回执已过期，不能撤销后续操作');});
      root.append(control);
      watch(control,()=>{control.disabled=lastUndo?.id!==d.undoId;control.textContent=control.disabled?'这次修改已撤销或被后续操作取代':'撤销这次修改';});
    }
    return ownerScope(root);
  }});
  function capability(id,title,icon,group,oneLine,status,phrases,reply) {
    if(!owner())return;
    H.registerCapability({id:'memory-'+id,title,icon,featureId:'memory',steward:ownerId(),group,oneLine,status,phrases,reply:phrase=>{
      const parts=reply(phrase),first=parts.find(p=>p.type==='memory-summary');
      if(first&&toolGroups[id])first.data.tools=id;
      return parts;
    }});
  }
  capability('recall','它记得我什么','memory','关于你','看看稳定线索、来源和当前可用范围。',
    ()=>[{label:'已保存',value:active().length},{label:'可召回',value:active().filter(m=>!expired(m)&&!m.conflict).length}],
    ['它记得我什么','只看共享记忆','看看各助理的私有记忆'],phrase=>{
      const rows=active().filter(m=>phrase==='只看共享记忆'?m.scope==='shared':phrase==='看看各助理的私有记忆'?m.scope==='private':true);
      return summary(phrase,'离线目录快照；浏览不会把线索加载进上下文。',[{label:'条目',value:rows.length}],{entries:rows.map(m=>Object.assign({},m)),section:'overview'});
    });
  capability('pending','等我确认的','pin','关于你','新线索先排队，确认和拒绝只作用于本页。',
    ()=>[{label:'等你确认',value:waiting().length,tone:'wait'}],
    ['看看等我确认的记忆','确认条目\u00a0mem-12 这条示例候选','提议一条新的示例线索'],phrase=>{
      if(phrase==='确认条目\u00a0mem-12 这条示例候选'){
        const m=get('mem-12');
        if(!m||m.forgotten||!m.pending)return summary('没有新增确认','条目\u00a0mem-12 已处理或已忘记，未修改其他条目。');
        record('已确认条目\u00a0mem-12（本页演示）',()=>{m.pending=false;m.confirmation=demoText("memory.sample.51");m.verified='未现场核验';});return changed('条目\u00a0mem-12 已保存');
      }
      if(phrase==='提议一条新的示例线索'){
        const title='新建议保留来源日期与正本入口',pointer=demoText("memory.pointer.52");
        if(memories.some(m=>!m.forgotten&&m.title===title))return summary('示例线索已在目录','没有重复新增；请在待确认里审阅。',[],{section:'inbox'});
        record('已提议一条线索，等待确认',()=>memories.push(seed('mem-'+(++seq),ownerId(),'private',title,pointer,'common','未确认',TODAY,'',{pending:true})));
        return changed('示例线索已排队');
      }
      return summary('等我确认的','以下均为本页演示候选，不会自行保存。',[{label:'候选',value:waiting().length}],{section:'inbox'})
        .concat(waiting().map(m=>({type:'memory-note',data:{memoryId:m.id}})));
    });
  capability('edit','改 / 忘记','retry','关于你','指出条目即可纠正或忘记，并保留一步撤销。',
    ()=>[{label:'可修改',value:memories.filter(m=>!m.forgotten).length},{label:'撤销',value:lastUndo?'可用':'无'}],
    ['把条目\u00a0mem-8 改成「共享规则先核正本」','忘记条目\u00a0mem-9 这条过期线索','撤销最近一次记忆修改'],phrase=>{
      if(phrase==='撤销最近一次记忆修改'){
        const label=lastUndo?.label;if(label)undo();
        return summary(label?'已撤销：'+label:'没有可撤销的修改','只影响当前页；旧回复的溯源快照保留。',[],{section:'edit'});
      }
      const m=get(phrase.startsWith('把')?'mem-8':'mem-9');
      if(!m||m.forgotten)return summary('条目已忘记','没有修改其他记忆；可以撤销最近操作。',[],{section:'edit'});
      if(phrase.startsWith('把')){
        if(m.title==='共享规则先核正本')return summary('摘要已是这句话','没有重复修改，仍需在待确认中审阅。',[],{section:'inbox'});
        record('已纠正条目\u00a0mem-8，等待重新确认',()=>Object.assign(m,{title:'共享规则先核正本',pending:true,confirmation:'未确认',verified:'待复核',revision:m.revision+1,receipt:null}));
      }else record('已忘记条目\u00a0mem-9',()=>{m.forgotten=true;});
      return changed('记忆已按你说的修改');
    });
  function healthReply(phrase) {
    if(['哪些内容不能记','把四类隐私红线全部打开','检查记忆是否含敏感正文'].includes(phrase))return privacyReply(phrase);
    const d=diagnosis();
    if(phrase==='忘记本页所有过期线索'){
      if(!d.stale.length)return summary('没有过期线索','未进行修改。');
      record('已忘记 '+quantity(d.stale.length,'条')+'过期线索',()=>d.stale.forEach(m=>{m.forgotten=true;}));
      return changed('过期线索已忘记');
    }
    return summary(phrase,'仅检查本页目录；冲突和过期条目已经排除在召回之外。',[
      {label:'重复组',value:d.duplicates.length},{label:'过期',value:d.stale.length},{label:'冲突',value:d.conflicts.length}
    ],{entries:(phrase==='对比冲突的两条原文'?d.conflicts:d.stale).map(m=>Object.assign({},m)),lines:phrase==='对比冲突的两条原文'?['请明确指出要改或忘记的条目；不会按日期自动裁决。']:d.duplicates.map(g=>'相同指针：'+g.map(m=>entryName(m.id)).join('、'))});
  }
  capability('health','体检与隐私','shield','维护','检查重复、过期、冲突与隐私，先隔离再由你决定。',
    ()=>{const d=diagnosis();return [{label:'重复组',value:d.duplicates.length},{label:'过期 / 冲突',value:d.stale.length+' / '+d.conflicts.length,tone:'wait'},{label:'隐私红线',value:Object.values(redlines).filter(Boolean).length+'/4'}];},
    ['检查记忆有没有重复或过期','对比冲突的两条原文','哪些内容不能记'],healthReply);
  capability('routing','按需记忆与上下文','link','维护','按白名单找正本指针，按需挂载并整理演示上下文。',
    ()=>[{label:'路由指针',value:catalog.length},{label:'已挂载切片',value:mountBots.reduce((n,id)=>n+H.memoryMounts(id).length,0)},{label:'目标会话',value:conversationName(contextConversation)}],
    ['看看上下文构成','压缩本页示例上下文','恢复初始示例上下文'],phrase=>routingReply(phrase));
  capability('transfer','来源与迁移','file','维护','核对来源和修改记录，导入指针先排队等待确认。',
    ()=>[{label:'本页记录',value:events.length},{label:'格式',value:'指针 v1'},{label:'真实迁移',value:'未接入',tone:'neutral'}],
    ['预览记忆指针导出','导入一条示例指针到待确认','真实迁移前要核对什么'],phrase=>{
      if(phrase==='预览记忆指针导出')return summary('演示指针导出预览','仅在消息中显示；没有写文件、下载或外传。',[{label:'指针',value:active().length}],{json:JSON.stringify({schema:'memory-pointers-v1',demo:true,entries:active().map(m=>({title:m.title,pointer:knowledgePage(m.pointer),bot:name(m.bot),project:projects[m.project]||'演示项目',expires:m.expires}))},null,2)});
      if(phrase==='导入一条示例指针到待确认'){
        if(memories.some(m=>!m.forgotten&&m.source==='demo-import-r6'))return summary('示例已导入','没有重复导入，仍可在待确认中处理。',[],{section:'inbox'});
        record('已导入一条示例指针（待确认）',()=>memories.push(seed('mem-'+(++seq),ownerId(),'private','导入线索只保留正本入口',demoText("memory.sample.53"),'dsh','未确认',TODAY,'',{pending:true,source:'demo-import-r6',author:'演示导入'})));
        return changed('示例指针已进入待确认');
      }
      return summary('真实迁移尚未接入','本轮不能迁移真实数据。',[],demoFixture("memory.sample.54"));
    });
  const memoryHistory=[];
  function registerMemoryConversation(spec) {
    const assistant=owner();
    if(!assistant)return;
    const messages=spec.messages.map(message=>({...message,from:message.from==='user'?'user':assistant.id}));
    H.registerConversation(assistant.id,{...spec,featureId:'memory',messages});
    memoryHistory.push({id:spec.id,title:spec.title,date:TODAY});
    const source=spec.id===CONVERSATION?'来源与撤销演示':'原记忆管家的记录';
    messages.forEach(message=>H.featureRecord('memory',{
      time:TODAY+' · '+spec.title+' · '+source,sourceConversation:spec.id,message
    }));
  }
  registerMemoryConversation({id:'memory-steward-r6',title:'关于你的三件事 · 离线演示',messages:[
    {from:'user',time:'演示',parts:[{type:'text',md:'我想知道你记得什么，哪些还等我确认，错了怎么改？'}]},
    {from:ownerId(),time:'演示',parts:[...summary('它记得我什么','只保留线索和正本指针；动态事实用到时核验。',[],{section:'overview'}),
      ...summary('等我确认的','新建议先排队，未经确认不进入召回。',[],{section:'inbox'}),
      ...summary('改 / 忘记','指出具体条目即可修改；仅本页生效，可撤销。',[],{section:'edit'})]}
  ]});
  const demoAdded=seed('mem-r7-added',ownerId(),'private','演示偏好：先给结论，再给依据',demoText("memory.demoAdded.55"),'common','未确认',TODAY,'',
    {source:'memory-steward-r7',author:'记忆管家（演示）'});
  const demoBefore=seed('mem-r7-edited',ownerId(),'private','演示交接：先列出所有背景',demoText("memory.demoBefore.56"),'dsh','未确认',TODAY,'',
    {source:'memory-steward-r7',author:'记忆管家（演示）'});
  const demoAfter=Object.assign({},demoBefore,{title:'演示交接：先说下一步与禁止项',revision:2});
  memories.push(demoAdded,demoAfter);
  const demoAdd=rememberDiff(null,demoAdded,'对话中新增的表达偏好','记忆改动对比 · 第一句话（演示）');
  const demoEdit=rememberDiff(demoBefore,demoAfter,'对话中纠正的交接偏好','记忆改动对比 · 第三句话（演示）');
  registerMemoryConversation({id:'memory-steward-r7',title:'记忆改动对比 · 新增与修改',messages:[
    {from:'user',time:'演示',parts:[{type:'text',md:'演示：帮我记住，回复先给结论，再给依据。'}]},
    {from:ownerId(),time:'演示',parts:[{type:'text',md:'我记下了。演示，未真实执行；下面可以撤销或保留。'},{type:'memory-diff',data:demoAdd}]},
    {from:'user',time:'演示',parts:[{type:'text',md:'演示：把交接偏好改成先说下一步与禁止项。'}]},
    {from:ownerId(),time:'演示',parts:[{type:'text',md:'我改了。演示，未真实执行；红行是改前，绿行是改后。'},{type:'memory-diff',data:demoEdit}]}
  ]});
  registerMemoryConversation({id:'memory-steward-r8',title:'按需记忆 · 体检、来源与上下文',messages:[
    {from:'user',time:'演示',parts:[{type:'text',md:'我想看挂了哪些记忆，再检查隐私、来源和上下文。'}]},
    {from:ownerId(),time:'演示',parts:[
      ...summary('助理记忆与功能资料各归其位','标题下的「已挂载记忆」只显示当前助理的切片；七页资料不自动加载进上下文。数字均为演示估算。',[],{lines:[
        ...mountBots.map(id=>name(id)+' · '+quantity(H.memoryMounts(id).length,'个切片')+' · '+quantity(H.memoryMounts(id).reduce((n,s)=>n+s.tokens,0),'token')),
        ...featurePages.map(page=>page.title+'资料 · '+quantity(H.featureMemory(page.id).length,'片')+' · '+quantity(H.featureMemory(page.id).reduce((n,s)=>n+s.tokens,0),'token'))
      ]}),
      ...withTools(healthReply('检查记忆有没有重复或过期'),'health'),
      ...withTools(sourceReply('看看最近的记忆修改'),'transfer'),
      ...routingReply('看看上下文构成',ownerId()+'-013')
    ]}
  ]});
  H.addStyle((demoText("memory.sample.57")));
  H.registerPanel('memory',{title:'关于你的记忆',icon:'memory',group:'记忆',render:center});
  H.registerView('memory-center',{title:'关于你的记忆',icon:'memory',hidden:true,render:center});
  H.registerBotTab('memory-profile',{title:'它对你的了解',render:(c,bot)=>{
    const id=bot.id;
    c.append(el('div','root',[text('离线演示 · '+(id?name(id)+'可见的线索':'全部助理的线索')+'；浏览不会自动加载上下文。'),
      text('记得 '+quantity(remembered(id).length,'条')+' · 等待确认 '+quantity(waiting(id).length,'条')),
      actions([button('它记得我什么',()=>openMemory('overview',id)),button('等我确认的',()=>openMemory('inbox',id)),button('改 / 忘记',()=>openMemory('edit',id))])]));
  }});
  
  H.registerSettingsPage('memory-privacy',{title:'记忆与隐私',icon:'shield',group:'隐私与权限',order:30,render:c=>{
    c.append(el('div','root',[text('隐私红线、迁移和记忆体检由记忆负责助理处理；全部是本页演示。'),
      button('问负责助理：哪些不能记',()=>ask('memory-health','哪些内容不能记')),button('打开三项记忆面板',()=>openMemory())]));
  }});
  H.registerStatusChip({id:'memory-status',order:30,render:(c,ctx)=>{
    const bot=ctx.bot.id,btn=button('',()=>openMemory('overview',bot));btn.className+=' m-memory-chip';c.append(btn);
    watch(btn,()=>{const n=remembered(bot).length;clear(btn);btn.append(H.icon('memory'),h('span',{},String(n)));btn.setAttribute('aria-label','记忆 '+quantity(n,'条')+' · 本页演示');});
  }});
  H.registerCard('memory-diff',{title:'记忆改动对比',render:diffCard,quoteLabel:d=>{const live=diffs.get(d.id)||d;return (live.reverted?'已撤销 · 恢复为改前':live.title||'记忆改动对比')+' · 演示，未真实执行';}});
  H.registerCard('memory-note',{title:'记忆卡',render:noteCard,quoteLabel:d=>'记忆候选：'+(get(d.memoryId)?get(d.memoryId).title:'已移除')});
  H.registerCard('memory-trace',{title:'记忆溯源',render:traceCard,quoteLabel:()=> '本轮记忆来源（模拟凭证）'});
  const traceSnapshot=[get('mem-1'),get('mem-7')].map(m=>Object.assign({},m));
  registerMemoryConversation({id:CONVERSATION,title:'记忆中心 · 来源与撤销演示',messages:[
    {id:'memory-demo-user',from:'user',time:'演示',parts:[{type:'text',md:'知识库的动态状态应该放在记忆里吗？'}]},
    {id:'memory-demo-answer',from:ownerId(),time:'演示',parts:[{type:'text',md:'记忆保存稳定线索和正本指针，动态状态用到时回正本核验。以下来源凭证为离线示例。'},
      {type:'memory-trace',data:{demo:true,entries:traceSnapshot}},{type:'memory-note',data:{memoryId:'mem-14'}}]}
  ]});
  H.registerMessageAction({id:'memory-sources',icon:'memory',label:'记忆溯源',when:m=>m.from!=='user'&&(m.parts||[]).some(p=>p.type==='memory-trace'&&p.data?.entries?.length),run:m=>{
    const part=(m.parts||[]).find(p=>p.type==='memory-trace');
    H.sheet({title:'这次回复的记忆来源',body:traceCard(part?part.data:{entries:[]})});
  }});
  H.registerMessageAction({id:'memory-propose',icon:'pin',label:'提议记住',when:m=>m.from!=='user',run:(m,ctx)=>{
    H.openPanel('memory',{bot:ctx.bot.id,section:'inbox'});H.toast('可请记忆负责助理提议一条示例线索；不会自动复制消息正文');
  }});
  H.registerComposerTool({id:'memory-tool',icon:'memory',label:'关于你的记忆',run:ctx=>openMemory('overview',ctx.bot.id)});
  H.registerSlashCommand({name:'memory',hint:'打开三项记忆面板',run:(_,ctx)=>openMemory('overview',ctx.bot.id)});

  H.registerFeatureSection('memory',{id:'memory-main',kind:'now',title:'条目与可用范围',render:container=>{
    const root=el('div','root',[],{'data-memory-overview':true});container.append(root);
    watch(root,()=>{
      clear(root);
      root.append(text('离线演示 · 原始样本日期 '+TODAY+'；汇总各助理的目录，不把私有记忆加载给负责助理。'),
        row([
          ['saved','已保存',active().length],
          ['recall','可召回',active().filter(m=>!expired(m)&&!m.conflict).length],
          ['pending','等你确认',waiting().length]
        ].map(([id,label,value])=>el('span','badge',[label+' · ',h('strong',{'data-memory-count':id},value)]))),
        text('可召回表示这份演示目录未过期、无冲突；实际回复有没有引用，仍以召回凭证为准。'));
      memories.filter(m=>!m.forgotten).forEach(m=>{
        const card=memoryCard(m,false);
        card.prepend(badge(m.pending?'等你确认':expired(m)?'已过期 · 不召回':m.conflict?'冲突隔离 · 不召回':'已保存 · 可召回',m.pending||expired(m)||m.conflict?'warn':'good'));
        root.append(card);
      });
    });
  }});
  H.registerFeatureSection('memory',{id:'memory-history',kind:'log',title:'改动、来源与原始日期',render:container=>{
    const root=el('div','root',[],{'data-memory-history':true});container.append(root);
    watch(root,()=>{
      clear(root);
      root.append(text('下方保留原问答和两条改动对比；此处与会话里的确认、撤销共用同一份演示状态。'),
        ...memoryHistory.map(item=>h('button',{type:'button',class:'setting-row','data-memory-history-open':item.id,
          onClick:()=>H.navigate({view:'chat',conversation:item.id})},item.date+' · '+item.title+' · 查看原会话')),
        ...events.map(event=>text(event.date+' · '+event.text)));
    });
  }});
  H.registerFeatureSection('memory',{id:'memory-phrases',kind:'phrases',title:'先填到会话里',render:(container,ctx)=>{
    container.append(text('选一句打开负责助理的会话，填入输入框，由你决定是否发送。'),
      ...['它记得我什么','看看等我确认的记忆','看看最近的记忆修改'].map(phrase=>h('button',{
        type:'button',class:'ghostbtn','data-memory-phrase':phrase,'data-feature-phrase':phrase,
        disabled:!ctx.ownerAssistant,onClick:()=>ask(null,phrase)
      },phrase)));
  }});
})();
