
(function () {
  'use strict';
  const H = window.Hub, P = 'm-cards-a-';
  function speak(value) {
    var fn = window.HubPlainTalk && window.HubPlainTalk.humanize;
    if (!fn || value == null || value === false) return value;
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map(speak);
    return value;
  }
  function spokenAttrs(attrs) {
    var copy = Object.assign({}, attrs || {});
    var fn = window.HubPlainTalk && window.HubPlainTalk.humanize;
    if (fn) ['aria-label', 'title', 'placeholder'].forEach(function (key) {
      if (typeof copy[key] === 'string') copy[key] = fn(copy[key]);
    });
    return copy;
  }
  // 元素也带本模块类；样式不使用通用类或标签选择器。真实方式下界面句子换成人话。
  const h = (tag, attrs, children) => {
    var copy = spokenAttrs(attrs);
    copy.class = ((attrs && attrs.class) ? attrs.class + ' ' : '') + P + 'node ' + P + 'el-' + tag;
    return H.h(tag, copy, speak(children));
  };
  const icon = (name,options) => {const el=H.icon(name,options);el.classList.add(P+'icon');return el;};
  const money = n => 'JP¥ ' + Number(n).toLocaleString('ja-JP');
  const note = t => h('p', {class:P+'note'}, t);
  const strong = t => h('strong', {}, t);
  const chip = (t, tone) => h('span', {class:'badge '+P+'chip'+(tone?' '+P+tone:'')}, t);
  const row = (...nodes) => h('div', {class:P+'row'}, nodes);
  const stack = (...nodes) => h('div', {class:P+'stack'}, nodes);
  const actions = (...nodes) => h('div', {class:P+'actions'}, nodes);
  const button = (text, fn, primary, key) => h('button', {
    type:'button', class:P+'button '+(primary==='tertiary'?'btn-tertiary':primary?'btn-primary '+P+'primary':'btn-secondary'),
    dataset:{focus:key||text}, 'aria-label':key==='prev-product'?'上一张商品':null, onClick:fn
  }, text);
  const detail = (summary, body) => h('details', {class:P+'details'}, [h('summary', {}, summary), body]);
  const field = (label, input) => h('label', {class:'field '+P+'field'}, [h('span', {}, label), input]);
  const input = (value, change, attrs) => h('input', Object.assign({class:'pop-input '+P+'input', value:value,
    onInput:e=>change(e.target.value)}, attrs||{}));
  const select = (values, value, change, label) => h('select', {class:'pop-input '+P+'input', value:value,
    'aria-label':label, onChange:e=>change(e.target.value)}, values.map(v=>h('option', {value:v,selected:v===value}, v)));
  function svg(tag, attrs, children) {
    const el=document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs||{}).forEach(([k,v])=>el.setAttribute(k,String(v)));
    (children||[]).forEach(c=>el.append(c));
    return el;
  }
  function illustration(kind, label) {
    const lines = kind==='tower' ? [
      svg('path',{d:'M58 108V46M122 108V31M42 46h51M96 31h46M37 108h110M51 77h81',class:P+demoText("cards-a.class.1")}),
      svg('path',{d:'M92 76V56l9-9 8 9v20Z',class:P+'art-solid'})
    ] : kind==='bowl' ? [
      svg('ellipse',{cx:90,cy:73,rx:54,ry:27,class:P+'art-solid'}),
      svg('ellipse',{cx:90,cy:67,rx:44,ry:18,class:P+demoText("cards-a.class.2")}),
      svg('path',{d:'M68 63l9-7m2 17 9-12m7 10 11-10',class:P+demoText("cards-a.class.3")})
    ] : [
      svg('rect',{x:41,y:34,width:98,height:73,rx:12,class:P+'art-solid'}),
      ...[51,61,71,81,91,101,111,121].map(x=>svg('path',{d:'M'+x+' 43v54',class:P+demoText("cards-a.class.4")}))
    ];
    return svg('svg', {viewBox:'0 0 180 140',role:'img','aria-label':label,class:P+'illustration'}, lines);
  }
  function mapArt(mode) {
    const s=svg('svg',{viewBox:'0 0 360 180',role:'img','aria-label':demoText("cards-a.sample.5"),class:P+'map'}, [
      svg('rect',demoFixture("cards-a.s.6")),
      ...[28,85,146].map(y=>svg('path',{d:'M0 '+y+'H360',stroke:demoText("cards-a.stroke.7"),'stroke-width':2})),
      ...[48,148,245,323].map(x=>svg('path',{d:'M'+x+' 0V180',stroke:demoText("cards-a.stroke.8"),'stroke-width':2})),
      svg('path',demoFixture("cards-a.s.9")),
      svg('path',{d:mode==='步行'?'M48 146H148V85H245V28':'M48 146V85H245V28',fill:'none',stroke:'var(--bot-strong)','stroke-width':5,[demoText("cards-a.sample.10")]:'round','stroke-dasharray':mode==='步行'?'6 7':'0'}),
      svg('circle',demoFixture("cards-a.s.11")),svg('circle',demoFixture("cards-a.s.12")),
      svg('text',demoFixture("cards-a.s.13"),[document.createTextNode('出发点')]),
      svg('text',demoFixture("cards-a.s.14"),[document.createTextNode(demoText("cards-a.s.15"))])
    ]);
    return s;
  }
  function shell(title, iconName, source, body, category) {
    return [h('header',{class:'pop-card-head '+P+'header'},[
      row(h('span',{class:P+'symbol','aria-hidden':'true'},icon(iconName)),
        h('div',{class:P+'grow'},[h('p',{class:'sticker '+P+'eyebrow'},category),h('h3',{class:P+'title'},title)]),h('span',{class:'sticker bot'},'演示'))
    ]),body,source?h('p',{class:P+'source'},'来自：'+source+' · 流程复用 · 样本虚构'):null];
  }
  const samples = {};
  const actionLevels={product:'L1',flight:'L1',hotel:'L1',restaurant:'L1',schedule:'L1',order:'L1',logistics:'L1',
    email:'L3',message:'L3',contact:'L1',choice:'L1',form:'L1',vote:'L1',rating:'L1',reminder:'L1',
    'usage-alert':'L1','capability-status':'L1','dispatch-receipt':'L0',
    'secret-input':'L1','wechat-draft':'L3',takeover:'L3','bot-draft':'L1',followup:'L1','customer-draft':'L3'};
  const levelFor=(name,d)=>name==='duplex'?(d.state==='held'?'L3':'L2'):actionLevels[name];
  const levelMark=(name,d,title)=>{
    if (window.HubPlainTalk && window.HubPlainTalk.realMode && window.HubPlainTalk.realMode()) return null;
    return H.levelSticker(levelFor(name,d),{
      action:title+'（本页演示）',scope:d.channel||d.conversation||'仅本页演示；不执行真实操作',bot:d.bot||H.state.bot
    });
  };
  const links=demoFixture("cards-a.links.16");
  function register(name, title, icon, source, defaults, initial, build) {
    const states=new WeakMap();
    samples[name]=defaults;
    H.registerCard('cards-a-'+name, {title:title,
      render:function(raw) {
        raw=raw&&typeof raw==='object'?raw:defaults;
        const d=Object.assign({}, defaults, raw);
        if(!states.has(raw)) states.set(raw, initial(d));
        const s=states.get(raw), root=h('section',{class:'pop-card '+P+'card', 'aria-label':title,dataset:{card:'cards-a-'+name}});
        function paint() {
          const repaint=()=>{
            const active=document.activeElement, contained=root.contains(active), key=contained&&active.dataset&&active.dataset.focus;
            const body=build(d,s,paint);
            root.replaceChildren(...shell(d.title||title,icon,source,levelFor(name,d)?stack(levelMark(name,d,title),body):body,['usage-alert','capability-status','dispatch-receipt'].includes(name)?'助理回复':'生活与商务').filter(Boolean));
            if(links[name]) root.append(h('div',{class:P+'conversation-link'},button(links[name].label,()=>H.navigate({view:'chat',conversation:links[name].target}),'tertiary')));
            if(key) Array.from(root.querySelectorAll('[data-focus]')).find(el=>el.dataset.focus===key)?.focus({preventScroll:true});
          };
          if(H.reading) return H.reading.preserve(repaint,{reason:'cards-a-paint'});
          return repaint();
        }
        paint(); return root;
      },
      quoteLabel:function(d) {return title+' · '+((d&&d.title)||defaults.title||title)+'（演示）';}
    });
  }

  // 主题色由壳继承；固定 Pop 色只做点缀，正文使用 ink / bot-strong。
  H.addStyle((demoText("cards-a.sample.17")));

  const products=demoFixture("cards-a.products.18");
  register('product',demoText("cards-a.sample.19"),'image','N.E.K.O 结构化回复卡', {title:demoText("cards-a.title.20"),items:products},()=>({index:0,saved:[]}), (d,s,paint)=>{
    const items=d.items.length?d.items:products;
    s.index=Math.min(s.index,items.length-1);
    const count=h('span',{class:P+'note','aria-live':'polite'},(s.index+1)+' / '+items.length);
    const track=h('div',{class:P+'product-track',tabIndex:0,'aria-label':'商品横滑列表；可用左右方向键'},items.map((p,i)=>h('article',{class:'pop-card '+P+'product'},[
      h('div',{class:P+'product-art'},[illustration(p.kind,p.name+' · 示意插图'),chip(p.badge)]),
      h('div',{class:P+'product-copy'},[h('h4',{},p.name),h('p',{class:P+'price'},money(p.price)),note(p.desc),note('来源店铺：'+p.shop),
        button(s.saved.includes(i)?'已收藏 · 点击取消':'收藏候选',()=>{s.saved=s.saved.includes(i)?s.saved.filter(n=>n!==i):s.saved.concat(i);paint();},false,'save-'+i)])
    ])));
    let restore=true;
    // 商品横向轨道：非聊天，豁免。
    function go(i) {s.index=(i+items.length)%items.length;const item=track.children[s.index];track.scrollTo({left:item.offsetLeft-track.children[0].offsetLeft,behavior:'auto'});count.textContent=(s.index+1)+' / '+items.length;}
    track.addEventListener('scroll',()=>{if(restore)return;const x=track.scrollLeft, start=track.children[0].offsetLeft;let closest=0;Array.from(track.children).forEach((el,i)=>{if(Math.abs(el.offsetLeft-start-x)<Math.abs(track.children[closest].offsetLeft-start-x))closest=i;});s.index=closest;count.textContent=(s.index+1)+' / '+items.length;},{passive:true});
    track.addEventListener('keydown',e=>{if(e.target!==track)return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();go(s.index+(e.key==='ArrowRight'?1:-1));}});
    requestAnimationFrame(()=>{if(track.isConnected){go(s.index);restore=false;}});
    return stack(note('参考价与店铺均为虚构样本，不是实时库存或报价。'),track,h('div',{class:P+'nav'},[button(icon('arrow-left'),()=>go(s.index-1),false,'prev-product'),count,button(['下一张 ',icon('chevron')],()=>go(s.index+1),false,'next-product')]),note('已收藏 '+s.saved.length+' 项 · 插图仅示意，不代表真实商品'));
  });

  const flights=demoFixture("cards-a.flights.21");
  register('flight','航班比较','send','', {title:demoText("cards-a.title.22"),date:'11 月 20 日 · 单程',items:flights},()=>({more:false,sort:'综合推荐',selected:''}), (d,s,paint)=>{
    const sorted=d.items.slice().sort((a,b)=>s.sort==='参考价优先'?a.price-b.price:s.sort==='最早出发'?a.start.localeCompare(b.start):0);
    return stack(row(chip(d.date),chip('当地时间 JST')),select(['综合推荐','参考价优先','最早出发'],s.sort,v=>{s.sort=v;paint();},'航班排序'),
      h('div',{},sorted.slice(0,s.more?sorted.length:2).map(f=>h('div',{class:'pop-card '+P+'listrow'},[
        row(chip(f.tag,'good'),note(demoText("cards-a.sample.23")+f.tag+'班次')),h('div',{class:P+'flight-times'},[
          h('div',{},[h('div',{class:P+'flight-time'},f.start),note(demoText("cards-a.sample.24"))]),h('div',{class:P+'flight-route'},[f.duration,h('div',{},'──── →'), '直飞']),
          h('div',{class:P+'right'},[h('div',{class:P+'flight-time'},f.end),note(demoText("cards-a.sample.25"))])]),
        row(h('span',{class:P+'price'},money(f.price)),button(s.selected===f.id?'已选为候选':'比较这班',()=>{if(s.selected===f.id){H.toast('这班航班已在比较候选中 · 尚未订票');return;}s.selected=f.id;paint();},s.selected===f.id,'flight-'+f.id)),note(f.desc)
      ]))),button(s.more?'收起更多航班':'更多航班（'+Math.max(0,d.items.length-2)+'）',()=>{s.more=!s.more;paint();},'tertiary'),
      s.selected?h('div',{class:'pop-card '+P+'status',role:'status'},'比较候选：'+(d.items.find(f=>f.id===s.selected)?.tag||'所选')+'班次 · 尚未订票'):null,
      note('航班、时刻及参考价均为虚构；不查询余票，不代订。'));
  });

  function venue(kind) {
    const hotel=kind==='hotel';
    register(kind,hotel?demoText("cards-a.sample.26"):demoText("cards-a.sample.27"),hotel?'folder':'sun','',
      hotel?demoFixture("cards-a.sample.28"):
      demoFixture("cards-a.sample.29"),
      ()=>({saved:false,date:hotel?'11 月 20–21 日 · 1 晚':demoText("cards-a.date.30")}), (d,s,paint)=>stack(
        h('div',{class:'pop-card '+P+'hero'},[row(chip(hotel?'住宿候选':'午餐候选','good'),chip([icon('star',{fill:true}),' '+d.score+' · 模拟评分'])),h('p',{class:P+'large'},hotel?'留一晚，慢一点':demoText("cards-a.sample.31")),note(d.area)]),
        note(d.desc),row(h('span',{class:P+'price'},money(d.price)),note(hotel?'每晚参考价 · 税费待核':'人均参考价')),note(s.date),
        actions(button(s.saved?'已加入候选 · 撤回':'加入候选',()=>{s.saved=!s.saved;paint();},true),button('查看细节',()=>H.sheet({title:d.title,body:stack(note('虚构场所，仅展示信息结构。'),note(hotel?'取消政策、入住人数、税费和付款方式均待核。':demoText("cards-a.body.32")),note('不执行预订，不向商户发送消息。'))}))),
        note('地点与参考价均为演示，不构成预订或价格承诺。')));
  }
  venue('hotel'); venue('restaurant');

  register('schedule','日程','clock',demoText("cards-a.sample.33"),
    demoFixture("cards-a.sample.34"),()=>({added:false}), (d,s,paint)=>stack(
      h('div',{class:P+'date'},[h('div',{class:P+'datebox'},['11 月',strong('14'),'周六']),h('div',{},[strong(d.time),note(d.date+' · Asia/Tokyo'),note(d.place)])]),
      note('对象：'+d.person),detail('准备事项 · 3 项',stack(note(demoText("cards-a.sample.35")),note(demoText("cards-a.sample.36")))),
      button(s.added?'已加入演示日历 · 点击撤回':'加入日历（本页演示）',()=>{s.added=!s.added;paint();H.toast(s.added?'已加入本页演示日历；未同步外部账号':'已撤回演示日程');},true),
      note('未接外部日历；不代表预约已确认。')));

  register('place','地点与路线','pin',demoText("cards-a.sample.37"),
    demoFixture("cards-a.sample.38"),()=>({mode:'步行'}), (d,s,paint)=>stack(
      mapArt(s.mode),note(d.address),h('div',{class:'segmented '+P+'modes',role:'group','aria-label':'路线方式'},['步行','公共交通'].map(mode=>h('button',{type:'button',class:P+'button'+(s.mode===mode?' on':''),'aria-pressed':String(s.mode===mode),onClick:()=>{if(s.mode===mode){H.toast('当前已显示'+mode+'示意路线 · 不是真实导航');return;}s.mode=mode;paint();}},mode))),
      row(strong(s.mode==='步行'?'18 分钟 · 1.3 km':'12 分钟 · 1 次换乘'),chip('示意估算')),
      detail('路线步骤',stack(note(s.mode==='步行'?demoText("cards-a.sample.39"):'出发点 → 示例站 A → 示例站 B → 步行到达'),note('图中道路与路线是示意，无法用于实际导航。'))),
      button('查看到达说明',()=>H.sheet({title:demoText("cards-a.title.40"),body:stack(note('真实到达地址和接待安排需由店方确认。'),note('提前 5 分钟到达；不携带外来宠物（样本文案，待店方审定）。'))}))));

  register('weather','天气','sun','', demoFixture("cards-a.sample.41"),()=>({unit:'°C',day:'明日'}), (d,s,paint)=>{
    const temp=n=>s.unit==='°C'?n:Math.round(n*9/5+32);
    const base=s.day==='明日'?18:17;
    return stack(row(chip(d.date),h('div',{class:'toggle-row '+P+'unit'},[h('span',{},'华氏 °F'),h('button',{type:'button',class:P+demoText("cards-a.class.42")+(s.unit==='°F'?' on':''),role:demoText("cards-a.role.43"),'aria-label':'使用华氏温度','aria-checked':String(s.unit==='°F'),dataset:{focus:'weather-unit'},onClick:()=>{s.unit=s.unit==='°C'?'°F':'°C';paint();}},h('i',{}))])),
      h('div',{class:'pop-card '+P+'hero'},[note('多云间晴'),h('div',{class:P+'large'},temp(base)+s.unit),note('最高 '+temp(base+2)+'° / 最低 '+temp(base-6)+'° · 降水概率 20%')]),
      h('div',{class:P+'hourly'},demoFixture("cards-a.sample.44").map((time,i)=>h('div',{class:'pop-card '+P+'hour'},[time,icon('sun'),strong(temp([base-3,base,base+1,base-2][i])+'°'),i===3?'20%':'10%']))),
      note(demoText("cards-a.sample.45")));
  });

  const shipmentSteps=demoFixture("cards-a.shipmentSteps.46");
  function timeline(steps,current) {return h('ol',{class:P+demoText("cards-a.class.47")},steps.map((p,i)=>h('li',{class:P+'step'+(i<=current?' '+P+'step-done':'')},[strong(p.title+(i===current?' · 当前':'')),h('time',{},p.time),note(p.body)])));}
  register('order','订单','file','',
    demoFixture("cards-a.sample.48"),()=>({received:false}), (d,s,paint)=>stack(
      row(chip(s.received?'已核对收货':'运输中','good'),note(demoText("cards-a.sample.49"))),
      row(h('div',{class:P+'thumb'},illustration('board',demoText("cards-a.sample.50"))),h('div',{class:P+'grow'},[strong(demoText("cards-a.sample.51")),note(demoText("cards-a.sample.52")),h('p',{class:P+'price'},money(d.amount))])),
      detail('订单明细',stack(note('商品 2 件 · 运费与税费以真实订单为准'),note(demoText("cards-a.sample.53")),note('虚构订单，不代表付款或已向店铺下单。'))),
      actions(button('物流进度',()=>H.sheet({title:'物流进度 · 演示',body:stack(timeline(shipmentSteps,s.received?4:2),note('模拟节点，无承运商连接。'))})),button(s.received?'撤回收货核对':'模拟核对收货',()=>{s.received=!s.received;paint();},true)),
      note('只改变本页核对标记，不联系店铺或承运商。')));
  register('logistics','物流进度','jobs','',
    demoFixture("cards-a.sample.54"),()=>({current:2}), (d,s,paint)=>stack(
      row(chip(s.current===4?'模拟已送达':'运输中','good'),note(demoText("cards-a.sample.55"))),timeline(shipmentSteps.map((p,i)=>s.current>=i&&i>2?Object.assign({},p,{time:i===3?demoText("cards-a.time.56"):demoText("cards-a.time.57")}):p),s.current),
      actions(button('刷新演示',()=>H.toast('演示节点无变化 · 不查询承运商')),button(s.current===4?'重置进度':'模拟下一节点',()=>{s.current=s.current===4?2:s.current+1;paint();},true)),
      note('物流编号、时间和状态全部虚构。')));

  function customerDraftState(d) {
    const checks=Array.isArray(d.checks)?d.checks:[];
    const required=['日期','时间','人数'];
    return {body:d.jaBody||'',zhNote:d.zhNote||'请独立核对日期、时间与人数；此草稿未发送。',
      checks:[...required.map(label=>checks.find(c=>c.label===label)||{label,value:'未提供',state:'待核'}),
        ...checks.filter(c=>!required.includes(c.label))].map(c=>({label:c.label,value:c.value||'未提供',state:c.state||'待核'})),
      approved:false,editing:false,edited:false,error:''};
  }
  function bilingualDraft(d,s,paint) {
    const stateText=()=>s.approved?'未发送 · 本页已批准':s.edited?'未发送 · 改稿后需重新批准':'未发送 · 待批';
    const current=status(stateText());
    const invalidate=()=>{s.approved=false;s.edited=true;current.textContent=stateText();};
    const checks=metadata(s.checks.map(c=>[c.label,c.value+' · '+c.state]));
    const editor=s.editing?stack(
      field('日文正文',h('textarea',{class:'pop-input '+P+'input',lang:'ja',rows:5,maxLength:1600,value:s.body,
        'aria-label':'日文正文',onInput:e=>{s.body=e.target.value;invalidate();}})),
      ...s.checks.map(c=>field(c.label+' · 单独核对',input(c.value,v=>{c.value=v;c.state='待重新核对';invalidate();},{'aria-label':c.label+'核对值',maxLength:120}))),
      button('保存改稿',()=>{if(!s.body.trim()){s.error='请先补齐日文正文。';H.toast(s.error);paint();return;}s.editing=false;s.error='';paint();},true)
    ):h('p',{class:P+'body',lang:'ja'},s.body);
    return stack(metadata([['助理',botName(d.bot||demoText("cards-a.sample.58"))],['通道',d.channel||d.conversation||'对客草稿（演示）']]),current,
      strong('日文正文'),editor,strong('中文说明'),note(s.zhNote),strong('关键信息 · 独立核对'),checks,
      s.error?h('p',{class:P+'error',role:'alert'},s.error):null,
      actions(button(s.approved?'撤回批准':'批准草稿（演示）',()=>{
        if(s.editing){H.toast('请先保存改稿，再重新批准。');return;}
        if(!s.body.trim()){s.error='请先补齐日文正文。';H.toast(s.error);paint();return;}
        s.approved=!s.approved;s.error='';paint();
      },true),button(s.editing?'正在改稿':'改稿',()=>{
        if(s.editing){H.toast('正在修改日文草稿 · 完成后请点「保存改稿」');return;}s.approved=false;s.edited=true;s.editing=true;paint();
      })),note(s.edited?'改稿后原批准失效；请重新核对日期、时间、人数，再批准。':'核对行独立于翻译；批准只记录本页决定，仍未发送。'),demoNote());
  }

  function draft(kind) {
    const email=kind==='email';
    register(kind,email?'邮件草稿':'消息草稿',email?'file':'chat',email?demoText("cards-a.sample.59"):demoText("cards-a.sample.60"),
      email?demoFixture("cards-a.sample.61"):
      demoFixture("cards-a.sample.62"),
      d=>Object.assign(customerDraftState(d),{to:d.to,subject:d.subject,body:d.jaBody||d.body,status:'待审批',edit:false,error:''}), (d,s,paint)=>{
        if(d.jaBody)return stack(metadata([['发件人',d.from],['接收方',s.to],['主题',s.subject]]),bilingualDraft(d,s,paint));
        const status=h('div',{class:'pop-card '+P+'status',role:'status'},s.status+(s.status==='已批准'?' · 未发送（演示）':s.status==='不发送'?' · 已保留草稿':' · 未发送'));
        if(s.edit){
          const save=()=>{if(!s.to.trim()||!s.subject.trim()||!s.body.trim()){s.error='请补齐演示对象标签、主题和正文。';H.toast(s.error);paint();return;}s.edit=false;s.status='待审批';s.error='';paint();H.toast('已保存修改，需重新批准');};
          return stack(status,field(email?'收件人标签（勿填真实地址）':'接收对象',input(s.to,v=>{s.to=v;},{dataset:{focus:'recipient'}})),
            field('主题',input(s.subject,v=>{s.subject=v;})),field('完整正文',h('textarea',{class:'pop-input '+P+'input',value:s.body,onInput:e=>{s.body=e.target.value;}})),
            s.error?h('p',{class:P+'error',role:'alert'},s.error):null,
            actions(button('保存修改',save,true),button('取消修改',()=>{Object.assign(s,s.snapshot,{edit:false,error:''});paint();})));
        }
        const approve=()=>{s.status='已批准';paint();H.toast('批准已记录在本页；未实际发送');};
        return stack(row(chip(email?'邮件':demoText("cards-a.sample.63")),chip('仅草稿','warm')),h('dl',{class:P+'fields'},[
          h('dt',{},'发件人'),h('dd',{},d.from),h('dt',{},email?'收件人':'接收方'),h('dd',{},s.to),h('dt',{},'主题'),h('dd',{},s.subject)]),
          detail('展开完整正文',h('p',{class:P+'body'},s.body)),status,
          actions(button(s.status==='已批准'?'撤回批准':'批准发送',()=>{if(s.status==='已批准'){s.status='待审批';paint();}else approve();},true),
            button('改一改',()=>{s.snapshot={to:s.to,subject:s.subject,body:s.body,status:s.status};s.edit=true;s.status='待审批';paint();}),
            button(s.status==='不发送'?'恢复待审':'不发',()=>{s.status=s.status==='不发送'?'待审批':'不发送';paint();})),
          note(demoText("cards-a.sample.64")));
      });
  }
  draft('email');draft('message');

  register('contact','联系人','chat',demoText("cards-a.sample.65"),
    demoFixture("cards-a.sample.66"),()=>({saved:false,more:false}), (d,s,paint)=>stack(
      row(h('span',{class:P+'avatar','aria-hidden':'true'},'A'),h('div',{class:P+'grow'},[strong(demoText("cards-a.sample.67")),note('对象：'+d.title)]),chip(d.stage,'good')),
      h('dl',{class:P+'fields'},[h('dt',{},'邮箱'),h('dd',{},d.email),h('dt',{},'语言'),h('dd',{},d.language),h('dt',{},'负责人'),h('dd',{},d.owner)]),
      detail('关联事项与跟进记录',stack(note(demoText("cards-a.sample.68")),note('下一步：核实 11/14 的接待时段'),note('咨询、预约、到店与成交分别记录；本对象未进入预约阶段。'))),
      h('div',{class:P+'actions '+P+'contact-actions'},[button(s.saved?'已保存 · 撤回':'保存联系人',()=>{s.saved=!s.saved;paint();},true),button('准备回复',()=>H.sheet({title:'联系人 · 回复草稿',body:stack(note('收件人：'+d.email),note(demoText("cards-a.neutralDraft.0")),note('仅展示草稿，不发送。'))}))])));

  const questions=[
    {title:'先看哪一种展示？',options:['商品候选','航班比较','消息草稿','日程与地点']},
    {title:'这次希望怎么呈现？',options:['一屏摘要','对比与细节','逐项确认','稍后再决定']}
  ];
  register('choice','分步选择','task','N.E.K.O 结构化回复卡', {title:'选一个最适合你的展示',questions:questions},()=>({step:0,answers:[],done:false}), (d,s,paint)=>{
    if(s.done)return row(h('span',{class:P+'grow'},[icon('check',{fill:true}),' '+s.answers.map((a,i)=>d.questions[i].options[a]).join(' · ')]),button('重新选择',()=>{s.done=false;s.step=0;paint();}));
    const q=d.questions[s.step];
    const next=button(s.step===d.questions.length-1?'完成':'下一步',()=>{if(s.answers[s.step]==null)return;if(s.step===d.questions.length-1)s.done=true;else s.step++;paint();},true,'choice-next');
    next.disabled=s.answers[s.step]==null;
    const back=button('返回',()=>{s.step=Math.max(0,s.step-1);paint();},false,'choice-back');back.disabled=s.step===0;
    return stack(row(chip((s.step+1)+' / '+d.questions.length),strong(q.title)),
      ...q.options.map((t,i)=>h('button',{type:'button',class:'btn-secondary '+P+'button '+P+'choice','aria-pressed':String(s.answers[s.step]===i),dataset:{focus:'option-'+i},onClick:()=>{if(s.answers[s.step]===i){H.toast('已选择「'+t+'」 · 点'+(s.step===d.questions.length-1?'「完成」':'「下一步」')+'继续');return;}s.answers[s.step]=i;paint();}},[h('span',{class:P+'letter'},String.fromCharCode(65+i)),t])),
      h('div',{class:P+'nav'},[h('div',{class:P+'dots','aria-label':'步骤 '+(s.step+1)+' / '+d.questions.length},d.questions.map((q,i)=>h('span',{class:P+'dot'+(i===s.step?' '+P+'dot-on':'')}))),actions(back,next)]));
  });

  register('form','表单','file',demoText("cards-a.sample.69"),
    {title:'登记一次内部准备任务'},()=>(demoFixture("cards-a.sample.70")), (d,s,paint)=>{
      if(s.submitted)return stack(h('div',{class:'pop-card '+P+'status',role:'status'},'已登记到本页 · 内部准备任务'),strong(s.name),note(s.owner+' · '+s.date+' · Asia/Tokyo'),note(s.memo||'无补充说明'),button('修改登记',()=>{s.submitted=false;paint();}),note('未创建真实任务，未向负责人派单。'));
      const form=h('form',{class:P+'stack',onSubmit:e=>{e.preventDefault();if(!s.name.trim()||!s.date||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s.date)){s.error='请填写任务名称和有效日期。';H.toast(s.error);paint();return;}s.submitted=true;s.error='';paint();}},[
        field('任务名称 *',input(s.name,v=>{s.name=v;},demoFixture("cards-a.form.71"))),
        h('div',{class:P+'grid'},[field('负责人',select(demoFixture("cards-a.form.72"),s.owner,v=>{s.owner=v;},'任务负责人')),field('截止日期 *',input(s.date,v=>{s.date=v;},{type:'date',required:true}))]),
        field('补充说明',input(s.memo,v=>{s.memo=v;},demoFixture("cards-a.form.73"))),s.error?h('p',{class:P+'error',role:'alert'},s.error):null,
        h('button',{type:'submit',class:'btn-primary '+P+'button '+P+'primary'},'提交登记（本页演示）'),note('只保存本页内存，不会创建外部任务或日历事件。')]);return form;
    });

  register('vote','投票','board',demoText("cards-a.sample.74"),
    demoFixture("cards-a.sample.75"),()=>({selected:null,voted:false}), (d,s,paint)=>{
      const counts=d.counts.map((n,i)=>n+(s.voted&&s.selected===i?1:0)),total=counts.reduce((a,b)=>a+b,0);
      return stack(note('模拟 9 票；只用于选题讨论，不触发制作或发布。'),...d.options.map((t,i)=>{
        const percent=total?Math.round(counts[i]/total*100):0;
        return stack(h('button',{type:'button',class:'btn-secondary '+P+'button '+P+'choice','aria-pressed':String(s.selected===i),onClick:()=>{if(s.voted){H.toast('先撤回投票即可更改');return;}if(s.selected===i){H.toast('已选择「'+t+'」 · 点「投这一项」提交');return;}s.selected=i;paint();}},[h('span',{class:P+'grow'},t),s.voted?chip(percent+'% · '+counts[i]+' 票'):null]),s.voted?h('div',{class:P+'progress','aria-hidden':'true'},h('span',{style:{width:percent+'%'}})):null);
      }),actions(button(s.voted?'撤回投票':'投这一项',()=>{if(s.voted){s.voted=false;paint();return;}if(s.selected===null){H.toast('请先选择一项');return;}s.voted=true;paint();},true)),
      s.voted?h('div',{class:'pop-card '+P+'status',role:'status'},'已计入本页 · 共 '+total+' 票'):note('选择一项后提交 · 每页仅一票'));
    });

  register('rating','评分','check','', {title:'这组卡片用起来怎么样？'},()=>({score:0,sent:false,comment:''}), (d,s,paint)=>{
    if(s.sent)return stack(h('div',{class:'pop-card '+P+'status',role:'status'},'已记录 '+s.score+' / 5 · '+(s.comment||'未附补充意见')),button('修改评分',()=>{s.sent=false;paint();}),note('反馈只在当前页保留。'));
    const submit=button('提交评分',()=>{if(!s.score)return;s.sent=true;paint();},true);submit.disabled=!s.score;
    return stack(h('div',{class:P+'actions','aria-label':'选择 1 至 5 分'},[1,2,3,4,5].map(n=>h('button',{type:'button',class:'btn-secondary '+P+'button '+P+'star','aria-label':n+' 分','aria-pressed':String(n===s.score),dataset:{focus:'star-'+n},onClick:()=>{if(s.score===n){H.toast('已选 '+n+' 分 · 点「提交评分」记录本页反馈');return;}s.score=n;paint();}},icon('star',{fill:n<=s.score})))),
      note(s.score?['','有些难用','还有改进空间','基本顺手','很好用','很顺手'][s.score]+' · '+s.score+' / 5':'点亮星星，选一个分数'),field('补充意见（选填）',input(s.comment,v=>{s.comment=v;},demoFixture("cards-a.sample.76"))),submit);
  });

  register('reminder','稍后提醒','clock',demoText("cards-a.sample.77"),
    demoFixture("cards-a.sample.78"),()=>(demoFixture("cards-a.sample.79")), (d,s,paint)=>{
      const label=s.when==='自选时间'?s.custom.replace('T',' ')+' JST':s.when;
      if(s.set)return stack(h('div',{class:'pop-card '+P+'status',role:'status'},'已记录演示提醒 · '+label),note(d.text),actions(button('改时间',()=>{s.set=false;paint();}),button('取消提醒',()=>{s.set=false;paint();H.toast('已取消本页演示提醒');})),note('没有系统通知或后台计时；刷新即复原。'));
      const chosen=select(demoFixture("cards-a.chosen.80"),s.when,v=>{s.when=v;paint();},'稍后提醒时间');
      return stack(note(d.text),chosen,s.when==='自选时间'?field('提醒时间 · Asia/Tokyo',input(s.custom,v=>{s.custom=v;},{type:'datetime-local',required:true})):null,
        s.error?h('p',{class:P+'error',role:'alert'},s.error):null,
        button('稍后提醒我（演示）',()=>{if(s.when==='自选时间'&&!s.custom){s.error='请选择提醒时间。';H.toast(s.error);paint();return;}s.error='';s.set=true;paint();},true),
        note('只演示时间选择与状态；不会申请通知权限。'));
  });

  // 只改变卡片演示偏好，不接账单、模型路由或真实派工。
  // 与治理模块共用一个离线快照；不用现金余额推算订阅额度。
  const preferences=H.state.ledgerDemo||(H.state.ledgerDemo=demoFixture("cards-a.preferences.81"));
  const ledgerOwner=()=>H.featureOwner('ledger');
  function recordPreference(result,detail) {
    H.featureRecord('ledger',{time:new Date().toLocaleString('zh-CN'),title:'用量提醒偏好 · '+result,text:detail+'；仅当前页演示，未改真实额度或路由。'});
  }
  const revisions={threshold:0,detailed:0}, changes=new Map();
  let changeSerial=0;
  const usageItems=()=>[{label:'5 小时',value:preferences.usageProbe+'%'},{label:'7 天',value:preferences.sevenDay+'%'},{label:'演示提醒线',value:preferences.threshold+'%'}];
  const receipt=demoFixture("cards-a.receipt.82");
  function preferenceReply(key,value,title,items) {
    const before=preferences[key], changed=before!==value;
    let changeId=null;
    if(changed){
      changeId='cards-a-change-'+(++changeSerial);
      preferences[key]=value;revisions[key]++;
      changes.set(changeId,{key,before,revision:revisions[key],after:value,undone:false});
      recordPreference('已调整',title+'：'+before+' → '+value);
    }
    return {type:'cards-a-capability-status',data:{title,items:items(),changeId,
      summary:changed?'已改好 · 仅本页演示偏好':'已经是这个设置 · 本次没有变更'}};
  }
  register('capability-status','能力状态卡','check','',
    {title:'能力状态 · 本页演示',items:[],summary:'只读状态，没有变更'},()=>({}), (d,s,paint)=>{
      const change=changes.get(d.changeId);
      const current=change&&!change.undone&&revisions[change.key]===change.revision&&preferences[change.key]===change.after;
      const confirmation=change?(change.undone?'已撤销 · 已恢复原偏好':current?d.summary:'此回执已被后续修改取代'):d.summary;
      const undo=button(change&&change.undone?'已撤销':'撤销本次修改',()=>{
        if(!change||change.undone)return;
        if(revisions[change.key]!==change.revision||preferences[change.key]!==change.after){paint();H.toast('已有后续修改，请在能力卡中选择当前偏好');return;}
        preferences[change.key]=change.before;recordPreference('已撤销','提醒线恢复为 '+change.before+'%');revisions[change.key]++;change.undone=true;
        paint();H.toast('已撤销本页演示偏好');
      });
      undo.disabled=!current;
      return stack(row(...d.items.slice(0,3).map(x=>chip(x.label+' · '+x.value))),
        h('div',{class:'pop-card '+P+'status',role:'status','aria-live':'polite'},confirmation),undo,
        note('上方是操作时的状态快照；当前值见能力目录。刷新复原，不修改真实配置。'));
    });
  register('usage-alert','用量提醒卡','usage','',
    demoFixture("cards-a.sample.83"),()=>({}), d=>stack(
      row(chip('5 小时 · '+preferences.usageProbe+'%'),chip('7 天 · '+preferences.sevenDay+'%'),chip('演示提醒线 · '+preferences.threshold+'%','warm')),
      strong(Math.max(preferences.usageProbe,preferences.sevenDay)>=100?'订阅额度耗尽，暂停新增工作（演示）':Math.max(preferences.usageProbe,preferences.sevenDay)>=preferences.threshold?'演示用量已到提醒线':'演示用量尚未到提醒线'),
      note('到提醒线先问你是否换便宜模型；订阅额度耗尽应暂停。这里没有接入真实账单或执行换模。'),
      actions(button('演示提醒线改为 70%',()=>H.runCapability('cards-a-usage-reminder','把演示提醒线改为 70%')),
        button('打开 token 账本',()=>H.navigate({view:'ledger'}),'tertiary')),
      note('演示基准：'+preferences.snapshotAt+'；与账本共用快照，真实订阅额度未连接。')));
  register('dispatch-receipt','派工回执卡','jobs','',
    Object.assign({detailed:false},receipt),()=>({}), d=>stack(
      row(chip('虚构回执'),chip('没有实际派工','warm')),
      h('dl',{class:P+'fields'},[
        h('dt',{},'工人'),h('dd',{},d.worker),h('dt',{},'模型'),h('dd',{},d.model),
        h('dt',{},'耗时'),h('dd',{},d.elapsed),h('dt',{},'token'),h('dd',{},Number(d.tokens).toLocaleString('en-US')+'（模拟）')]),
      h('div',{class:'pop-card '+P+'status'},d.summary),
      d.detailed?note('输入 '+d.input+' + 输出 '+d.output+' = '+d.tokens+' token；均为虚构样本。'):note('用一句话展开 token 明细。'),
      button(d.detailed?'用对话收起明细':'用对话展开明细',()=>H.postMessage(H.state.conversation,{from:H.state.bot,time:'刚刚',parts:[{type:'cards-a-dispatch-receipt',data:Object.assign({},d,{detailed:!d.detailed})}]})),
      note('未调用 CLI、模型或设备；这些数字不代表真实任务成功或消耗。')));

  const usageOwner=ledgerOwner();
  if(usageOwner)H.registerCapability({
    id:'cards-a-usage-reminder',title:'用量提醒',icon:'usage',steward:ledgerOwner().id,featureId:'ledger',group:'提醒与回执',
    oneLine:'看用量样本，说一句调整本页演示提醒线，随时撤销。',status:usageItems,
    phrases:['查看演示用量提醒','把演示提醒线改为 70%','把演示提醒线恢复为 80%'],
    reply:phrase=>{
      const parts=[{type:'text',md:'本页演示，未真实执行。只展示用量样本与本页提醒偏好。'}];
      if(phrase!=='查看演示用量提醒')parts.push(preferenceReply('threshold',phrase==='把演示提醒线改为 70%'?70:80,'用量提醒偏好',usageItems));
      parts.push({type:'cards-a-usage-alert',data:{title:'用量提醒 · 演示快照',threshold:preferences.threshold}});
      return parts;
    }
  });


  // R7：业务状态独立于消息 data。密码只存在输入控件，连末四位也不读取。
  // 壳重绘时更新 paint 引用，进度不会画回已离开的旧 DOM。
  function registerR7(name,title,iconName,initial,build,quote) {
    const states=new WeakMap(), fallback={};
    H.registerCard('cards-a-'+name,{title,
      render(raw,ctx) {
        const d=raw&&typeof raw==='object'?raw:fallback;
        if(!states.has(d))states.set(d,initial(d));
        const s=states.get(d),root=h('section',{class:'pop-card '+P+'card','aria-label':title,dataset:{card:'cards-a-'+name}});
        function paint(){
          const repaint=()=>{
            const body=build(d,s,()=>s.paint(),ctx);
            root.replaceChildren(...shell(title,iconName,'',levelFor(name,d)?stack(levelMark(name,d,title),body):body,'对话办理').filter(Boolean));
          };
          if(H.reading) return H.reading.preserve(repaint,{reason:'cards-a-paint'});
          return repaint();
        }
        s.paint=paint;paint();return root;
      },
      quoteLabel:quote||(()=>title+'（演示，未真实执行）')
    });
  }
  const demoNote=()=>note('本页演示，未真实执行 · 仅当前页内存，刷新复原。');
  const wechatRules=()=>note('只出草稿 · 发送前先问 · 控制节奏 · 遇验证码即停 · 主账号不碰');
  const status=t=>h('div',{class:P+'status',role:'status','aria-live':'polite'},t);
  const metadata=items=>h('dl',{class:P+'fields'},items.flatMap(([key,value])=>[h('dt',{},key),h('dd',{},value)]));
  const botName=id=>H.state.bots.find(b=>b.id===id)?.name||'指定助理（演示）';
  const secretSteps=['隐藏接收','向服务商免费验证','备份旧值并原子写入','自检'];
  registerR7('secret-input','私密输入','shield',()=>({step:-1,done:false,later:false,terminal:false,error:''}), (d,s,paint)=>{
    if(s.done)return stack(status('已安全放置 · 末四位 ••••'),h('time',{dateTime:s.completed},s.time),
      status('已清空剪贴板'),demoNote(),note('上述放置、验证与清空均为流程演示；没有读取或修改系统剪贴板、文件或服务。'));
    const purpose=d.forWhat||d.what||'服务密钥（演示）';
    const commandArg="'"+purpose.replace(/'/g,"'\\''")+"'";
    const facts=metadata([['要什么',d.what||'服务密钥（演示）'],['给谁用',botName(d.bot||'chief')+' · '+purpose],
      ['放到哪',d.destination||'该助理的私密配置位（演示）'],['验证', '放之前先向'+(d.provider||'演示服务商')+'免费验证；失败立即停下'],
      ['卡住的事',d.blocking||'连接预演，等待你输入']]);
    facts.classList.add(P+'secret-fields');
    if(s.step>=0)return stack(facts,h('ol',{class:P+demoText("cards-a.class.84"),'aria-label':'安全放置进度','aria-live':'polite'},secretSteps.map((t,i)=>
      h('li',{class:P+'step'+(i<s.step?' '+P+'step-done':''),'aria-current':i===s.step?'step':null},[i<s.step?icon('check',{fill:true}):null,(i<s.step?' ':i===s.step?'正在演示：':'待演示：')+t]))),demoNote());
    // 不监听 input、不持有密码字符串、不写回 d/s；只检查非空并立即清空 DOM 值。
    const password=h('input',{type:'password',class:'pop-input '+P+'input',autocomplete:'off',spellcheck:false,
      autocapitalize:'none','aria-label':'私密输入（演示，请只粘贴占位文字）',placeholder:'只粘贴演示占位文字',
      onCopy:e=>e.preventDefault(),onCut:e=>e.preventDefault()});
    // 终端说明只替换自身的说明区；同一个 input 连同其值留在原处，不读取到状态。
    const terminalInfo=h('div',{class:P+'stack','aria-live':'polite'});
    const updateTerminal=()=>terminalInfo.replaceChildren(...(s.terminal?[
      strong('一键命令说明 · 演示'),h('code',{class:P+'body'},'dsh-set-key '+commandArg),
      note('用途：'+purpose+'。这是演示命令名，未安装、不要直接执行。真实入口由执行端提供；你只做两件事：粘贴、回车。'),
      note('隐藏输入 → 先免费验证（失败即停）→ 备份旧值 → 原子写入并设为 0600 → 自检（失败提示回滚）→ 清空仍含该值的剪贴板。')]:[]));
    updateTerminal();
    const clear=()=>{password.value='';};
    const submit=()=>{
      if(!password.value){s.error='请先在遮蔽框粘贴演示占位文字。';H.toast(s.error);paint();return;}
      clear();s.error='';s.step=0;paint();
      function advance(){
        if(s.step<secretSteps.length-1){s.step++;paint();setTimeout(advance,650);return;}
        const now=new Date();s.done=true;s.completed=now.toISOString();s.time=now.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})+' JST';
        // resolve 会让壳重绘，先保存完成状态；无论是否在当前会话都只移除相应待输入。
        if(d.pendingId&&H.resolvePendingInput)H.resolvePendingInput(d.pendingId);
        paint();
      }
      setTimeout(advance,650);
    };
    return stack(facts,demoNote(),note('内容不进聊天记录、引用或复制；本演示请勿放真实凭据。'),field('遮蔽输入',password),
      s.error?h('p',{class:P+'error',role:'alert'},s.error):null,s.later?status('保持待输入 · 这件事留到以后'):null,
      h('div',{class:P+'secret-actions'},[button('粘贴并放置',submit,true),button('以后再说',()=>{clear();s.later=true;s.error='';paint();H.toast('已保留为待输入 · 本页演示，未放置任何内容');}),
        button('我去终端做',()=>{s.terminal=!s.terminal;updateTerminal();})]),terminalInfo);
  },()=> '私密输入 · 已遮蔽（演示，未真实执行）');

  registerR7('wechat-digest',demoText("cards-a.sample.85"),'chat',()=>({}),d=>stack(
    metadata([['谁',d.sender||'访客（演示）'],['在哪',d.conversation||demoText("cards-a.sample.86")],['说了什么',d.summary||demoText("cards-a.sample.87")],
      ['建议怎么回',d.suggestedReply||'先确认对方方便的时间，再整理回复草稿。']]),
    chip('来信样本 · 未回复'),wechatRules(),demoNote()));

  registerR7('customer-draft','对客补发草稿','chat',customerDraftState,bilingualDraft);

  registerR7('duplex','双工回复','chat',d=>({decision:d.state==='held'?'held':'auto-replied',reply:d.reply||'',editing:false,edited:false,error:''}),
    (d,s,paint)=>{
      const held=d.state==='held';
      const labels={'auto-replied':'已自动回复 · L2 双工',held:s.edited?'停下等批 · 改稿后需重新批准':'停下等批 · L3 强制审批',
        approved:'本页已批准 · 未发送',rejected:'已拒绝 · 未发送'};
      const approve=button('批准（演示）',()=>{
        if(s.editing){H.toast('请先保存改稿，再批准。');return;}
        if(!s.reply.trim()){s.error='请先补齐回复草稿。';H.toast(s.error);paint();return;}
        s.decision='approved';s.error='';paint();
      },true);
      approve.disabled=s.decision!=='held'||s.editing;
      const reject=button('拒绝',()=>{s.decision='rejected';s.editing=false;paint();});reject.disabled=s.decision==='rejected';
      return stack(metadata([['客户',d.customer||demoText("cards-a.sample.88")],['判定',held?'改预约或议价需强制审批':demoText("cards-a.sample.89")]]),
        status(labels[s.decision]),strong('客户原文'),h('p',{class:P+'body',lang:'ja'},d.original||'営業時間を教えてください。'),
        strong(held?'日文回复草稿':'已自动回复的日文'),
        s.editing?stack(field('修改回复草稿',h('textarea',{class:'pop-input '+P+'input',lang:'ja',value:s.reply,'aria-label':'修改双工回复',
          onInput:e=>{s.reply=e.target.value;s.edited=true;}})),button('保存改稿',()=>{
            if(!s.reply.trim()){s.error='请先补齐回复草稿。';H.toast(s.error);paint();return;}
            s.editing=false;s.decision='held';s.edited=true;s.error='';paint();
          },true)):h('p',{class:P+'body',lang:'ja'},s.reply),
        note(d.notice||(held?'没有向客户发送；等待你批准、改稿或拒绝。':demoText("cards-a.sample.90"))),
        s.error?h('p',{class:P+'error',role:'alert'},s.error):null,
        held?actions(approve,button('改稿',()=>{if(s.editing){H.toast('正在修改双工回复 · 完成后请点「保存改稿」');return;}s.decision='held';s.editing=true;s.edited=true;paint();}),reject):null,
        held&&s.edited?note('改稿后原批准失效，需要重新批准；任何按钮都不真实发送。'):null,demoNote());
    });

  registerR7('followup','后台追问 · 可选时段','clock',d=>({chosen:d.chosen||'',error:''}),(d,s,paint,ctx)=>{
    const options=Array.isArray(d.options)?d.options.slice(0,3):[];
    return stack(strong(d.question||demoText("cards-a.sample.91")),
      note('选一个只追加补发草稿；未发送，仍待批准。候选不代表预约已成立。'),
      ...options.map(option=>{
        const choice=button([s.chosen===option.id?icon('check',{fill:true}):null,(s.chosen===option.id?'已起草 · ':'')+option.label],()=>{
          if(s.chosen)return;
          const base=d.draftData||{},bot=d.bot||demoText("cards-a.bot.92");
          const checks=Array.isArray(option.checks)?option.checks:base.checks;
          const draft=Object.assign({},base,{bot,channel:base.channel||demoText("cards-a.channel.93"),level:'L3',
            jaBody:base.jaBody||(demoText("cards-a.neutralDraft.1")+option.label+'です。ご都合はいかがでしょうか。\n日時は担当者の確認後に確定いたします。'),
            zhNote:base.zhNote||'补发候选时段，未发送、待批准；需店方核实，尚未确认预约。',checks});
          s.chosen=option.id;s.error='';
          try{H.postMessage(ctx?.conversation||H.state.conversation,{from:bot,time:'本页演示',parts:[
            {type:'text',md:'本页演示，未真实执行。你选的时段已整理成补发草稿：未发送，待批。'},
            {type:'cards-a-customer-draft',data:draft}]});}
          catch(e){s.chosen='';s.error='未能追加草稿，请回到本会话后重试。';}
          paint();
        },false,(s.chosen===option.id?'\u2713 已起草 · ':'')+option.label);
        choice.classList.add(P+'choice');
        choice.disabled=!!s.chosen;choice.setAttribute('aria-pressed',String(s.chosen===option.id));return choice;
      }),s.chosen?status('已追加一张补发草稿 · 未发送，待批'):null,
      s.error?h('p',{class:P+'error',role:'alert'},s.error):null,demoNote());
  });

  registerR7('wechat-draft',demoText("cards-a.sample.94"),'chat',d=>Object.assign(customerDraftState(d),{draft:d.draft||demoText("cards-a.draft.95")}),(d,s,paint,ctx)=>{
    if(d.jaBody)return stack(bilingualDraft(Object.assign(demoFixture("cards-a.sample.96"),d),s,paint),wechatRules());
    const draft=h('textarea',{class:'pop-input '+P+'input',rows:4,maxLength:1200,'aria-label':demoText("cards-a.sample.97"),value:s.draft,
      onInput:e=>{s.draft=e.target.value;}});
    return stack(metadata([['目标',d.conversation||'访客私聊（演示）'],demoFixture("cards-a.sample.98")]),
      s.approved?stack(status('由它用真实键鼠发送 · 演示'),h('p',{class:P+'body'},s.draft),note(demoText("cards-a.sample.99")),
        actions(button('查看操作直播（演示）',()=>{
          const conversation=ctx?.conversation||H.state.conversation;
          H.postMessage(conversation,{from:d.bot||ctx?.bot?.id||H.state.bot,time:'演示',parts:[
            {type:'text',md:'演示，未真实执行。已批准的是本页草稿，下面仅预演真实键鼠操作流程。'},
            {type:'cards-b-live-op',data:{bot:d.bot||ctx?.bot?.id||demoText("cards-a.bot.100"),task:demoText("cards-a.task.101"),step:'发送前核对',state:'paused',screenLabel:demoText("cards-a.screenLabel.102")}}]});
        }),button('改一改（重新审批）',()=>{s.approved=false;paint();}))):stack(chip('未发送 · 待你批准','warm'),field('完整草稿 · 可修改',draft),
        button('批准发送（演示）',()=>{if(!s.draft.trim()){H.toast('请先写好草稿');return;}s.approved=true;paint();},true)),
      // 操作直播由 cards-b 注册；只有批准后主动点击才追加契约规定的卡。
      wechatRules(),demoNote());
  });

  registerR7('takeover','请求接管','shield',d=>({state:['waiting','human','returned','cancelled'].includes(d.state)?d.state:'waiting'}),(d,s,paint)=>{
    const labels={waiting:'已暂停 · 等你接管',human:'你正在接管 · 它保持暂停',returned:'已交还给它 · 等待安全复核',cancelled:'已取消这件事'};
    const change=next=>{if(s.state==='cancelled')return;s.state=next;paint();};
    const take=button('我来接管',()=>change('human'),s.state==='waiting'),back=button('交还给它',()=>change('returned')),cancel=button('取消这件事',()=>change('cancelled'));
    take.disabled=s.state==='human'||s.state==='cancelled';back.disabled=s.state!=='human';cancel.disabled=s.state==='cancelled';
    const tierAliases={red:'红',yellow:'黄',green:'绿'},tier=tierAliases[d.tier]||(['红','黄','绿'].includes(d.tier)?d.tier:'红');
    const tierMeaning={绿:'绿档 · 只看，不操作应用。',黄:'黄档 · 每次操作先问你。',红:'红档 · 每一步都须批准。'};
    return stack(metadata([['应用',d.app||demoText("cards-a.sample.103")],['操控档位',tierMeaning[tier]],['谁卡住了',botName(d.bot||demoText("cards-a.sample.104"))],['卡在哪步',d.step||demoText("cards-a.sample.105")],['原因',d.reason||'出现验证码，已停止操作']]),
      h('p',{class:P+'tier-note'},'档位看这个应用 · L 级看这一步动作'),
      h('div',{class:P+'screen',role:'img','aria-label':d.screenLabel||demoText("cards-a.sample.106")},[
        icon('shield'),strong(d.screenLabel||demoText("cards-a.sample.107")),note('没有截取或连接真实屏幕')]),
      status(labels[s.state]),actions(take,back,cancel),note('只批准当前一步，不会自动批准后续步骤。交还后仍需复核验证码或异常；不会绕过验证或自动继续发送。'),wechatRules(),demoNote());
  });

  const palette=[{token:'sky',label:'晴空'},{token:'mint',label:'薄荷'},{token:'pink',label:'樱粉'},{token:'lemon',label:'柠檬'}];
  const permissions=demoFixture("cards-a.permissions.108");
  function resolvedColor(token){
    // createBot 接收 hex；从契约的主题变量取色，不复制固定颜色值。
    if(typeof getComputedStyle!=='function')return undefined;
    const color=getComputedStyle(document.documentElement).getPropertyValue('--'+token).trim();
    return /^#[\da-f]{6}$/i.test(color)?color:undefined;
  }
  registerR7('bot-draft','新 bot 草案','plus',d=>({name:d.name||'机票观察员（演示）',token:'sky',changedColor:false,editing:false,
    permission:permissions.find(p=>p.startsWith(String(d.permission||'L0').slice(0,2)))||permissions[0],created:null,error:''}),(d,s,paint)=>{
    if(s.created)return stack(status('已创建 · '+s.created.name),note('已经加入本页'+(d.parent?'主 bot 的分 bot 树':'「我的 bot」')+'，刷新复原。'),
      button('去聊天',()=>H.navigate({view:'chat',conversation:s.created.id+'-013'}),true),demoNote());
    const brain=d.brain||demoText("cards-a.brain.109"),tools=Array.isArray(d.tools)?d.tools:['公开信息只读检索（演示）'],workers=Array.isArray(d.workers)?d.workers:demoFixture("cards-a.workers.110");
    const inherited=!s.changedColor&&(d.color||d.parent),paletteSelected=!inherited;
    const previewColor=paletteSelected?'var(--'+s.token+')':(/^#[\da-f]{6}$/i.test(d.color||'')?d.color:H.state.bots.find(b=>b.id===d.parent)?.color||'var(--bot)');
    const colorLabel=paletteSelected?palette.find(c=>c.token===s.token).label:d.color?'沿用草案主色':'沿用主 bot 的同色系';
    const colors=h('div',{class:P+'actions','aria-label':'选择主色'},palette.map(c=>h('button',{type:'button',class:'ghostbtn '+P+'button '+P+'swatch',
      style:{background:'var(--'+c.token+')',color:'var(--bot-ink)'},'aria-label':c.label+'主色','aria-pressed':String(paletteSelected&&s.token===c.token),
      onClick:()=>{if(paletteSelected&&s.token===c.token){H.toast('已使用'+c.label+'主色 · 仅为新 bot 草案预览');return;}s.token=c.token;s.changedColor=true;paint();}},[paletteSelected&&s.token===c.token?icon('check',{fill:true}):null,c.label])));
    return stack(row(h('span',{class:P+'avatar',role:'img','aria-label':'新 bot 头像预览',style:{background:previewColor}},'✦'),strong(s.name)),
      metadata([['名字',s.name],['职责',d.duty||'比较公开机票信息，整理候选，不购票'],['归属',d.parent?botName(d.parent)+' › 常驻分 bot':'独立 bot · 我的 bot'],
        ['大脑',brain],['工具',tools.join('、')||'无'],['工人',workers.join('、')||'无']]),
      s.editing?stack(field('修改名字',input(s.name,v=>{s.name=v;},demoFixture("cards-a.sample.111"))),field('头像与主色',colors)):note('头像：星形小助理 · 主色：'+colorLabel),
      field('权限起点',select(permissions,s.permission,v=>{s.permission=v;},'权限起点 L0 至 L4')),
      note('默认 L0 · 只读自动。权限起点只作本页元数据；创建角色属于 L1 本地写并通知，不执行真实外发。'),
      s.error?h('p',{class:P+'error',role:'alert'},s.error):null,
      actions(button('确认创建',()=>{
        if(H.state.bots.find(b=>b.id===H.state.bot)?.role!=='chief'){H.toast('请交给具备总管角色的助理确认创建。');return;}
        if(!s.name.trim()){s.error='请给这个 bot 起个名字。';H.toast(s.error);paint();return;}
        if(!H.createBot){s.error='壳尚未提供创建接口；没有创建。';H.toast(s.error);paint();return;}
        const color=s.changedColor?resolvedColor(s.token):(/^#[\da-f]{6}$/i.test(d.color||'')?d.color:d.parent?undefined:resolvedColor(s.token));
        try{s.created=H.createBot({name:s.name.trim(),duty:d.duty||'比较公开机票信息，整理候选，不购票',
          parent:d.parent||null,brain,tools:tools.slice(),workers:workers.slice(),permission:s.permission,...(color?{color}:{})});s.error='';}
        catch(e){s.error='创建未完成，请核对主 bot 或名字后重试。';}
        paint();
      },true),button('改一改',()=>{s.editing=!s.editing;s.error='';paint();})),demoNote());
  });

  H.addStyle((demoText("cards-a.sample.112")));

  H.registerConversation('chief',demoFixture("cards-a.sample.113"));
  H.registerConversation(demoText("cards-a.sample.114"),demoFixture("cards-a.sample.115"));

  const demoChecks=(date,time,people)=>[{label:'日期',value:date,state:'候选 · 待核'},
    {label:'时间',value:time+' JST',state:'候选 · 待核'},{label:'人数',value:people,state:'待客户确认'}];
  const bilingualSample={bot:demoText("cards-a.bot.116"),channel:demoText("cards-a.channel.117"),level:'L3',
    jaBody:demoText("cards-a.jaBody.118"),
    zhNote:'仅核对客户意向，不代表预约已成立；日期、时间与人数请分别核对。',checks:demoChecks('2026-11-16',demoText("cards-a.checks.119"),'2 人（意向）')};
  H.registerConversation(demoText("cards-a.sample.120"),{id:'cards-a-duplex-demo',title:'营业时间 · 双工演示',messages:[
    {from:'user',time:'本页演示',parts:[{type:'text',md:'客户问：「営業時間を教えてください。」请演示低风险先答、后台问我，再补发草稿。'}]},
    {from:demoText("cards-a.from.121"),time:'本页演示',parts:[demoFixture("cards-a.parts.122"),
      demoFixture("cards-a.parts.123"),
      {type:'cards-a-followup',data:{bot:demoText("cards-a.bot.124"),question:demoText("cards-a.question.125"),options:[
        {id:'morning',label:demoText("cards-a.label.126"),checks:demoChecks('2026-11-16',demoText("cards-a.checks.127"),'待确认')},
        {id:'afternoon',label:demoText("cards-a.label.128"),checks:demoChecks('2026-11-16',demoText("cards-a.checks.129"),'待确认')},
        {id:'next-day',label:demoText("cards-a.label.130"),checks:demoChecks('2026-11-17',demoText("cards-a.checks.131"),'待确认')}
      ],draftData:demoFixture("cards-a.draftData.132")}}]},
    {from:'user',time:'本页演示',parts:[{type:'text',md:'另一位客户要改预约日期，还想谈价格。这条怎么处理？'}]},
    demoFixture("cards-a.messages.133"),
    {from:demoText("cards-a.from.134"),time:'本页演示',parts:[demoFixture("cards-a.parts.135"),
      {type:'cards-a-wechat-draft',data:Object.assign({},bilingualSample,demoFixture("cards-a.data.136"))},
      {type:'cards-a-email',data:Object.assign({},bilingualSample,{channel:'邮件 · 演示'})},
      {type:'cards-a-message',data:bilingualSample}]}
  ]});

  function part(name) {return {type:'cards-a-'+name,data:samples[name]};}
  function message(id,bot,text,names) {return {id:'cards-a-'+id,from:bot,time:'演示 · 11/13',parts:[{type:'text',md:text},...names.map(part)]};}
  // 两段会话按真实事务分组，次要字段折叠；末尾双向导航由卡片渲染器提供。
  const chiefMessages=[
    demoFixture("cards-a.chiefMessages.137"),
    message('chief-plan','chief','**展示方式一览 · 今天的准备**\n日程、地点和天气放在一起。以下都是虚构样本，来源标签只表示复用过的流程。',['schedule','place','weather']),
    message('chief-customer','chief','**接待前，先把回复确认好**\n客户仍处于咨询阶段。展开正文可看完整内容；修改后需要重新批准。',['contact','email','message']),
    message('chief-delivery','chief','**用品补给**\n订单与物流分别展示；节点只用于演示。',['order','logistics']),
    message('chief-input','chief','**把决定留在卡片里**\n先选择展示偏好，再登记一件内部任务。',['choice','form']),
    message('chief-feedback','chief','**今天还有两件小事**\n投票选择下一期内容方向，也可以留下评分、稍后再提醒。所有结果仅保留在本页。',['vote','rating','reminder'])
  ];
  const researchMessages=[
    demoFixture("cards-a.researchMessages.138"),
    message('research-products','research',demoText("cards-a.researchMessages.139"),['product']),
    message('research-flight','research','**再看一次短途出差**\n推荐标签、飞行时间和价格放在同一行比较，更多航班收起。不会订票。',['flight']),
    message('research-stay','research','**最后补上吃住候选**\n细节收在面板；加入候选不等于预订。',['hotel','restaurant'])
  ];
  H.registerConversation('research',{id:'cards-a-research',title:'展示方式一览 · 生活与商务比较',messages:researchMessages});
  H.registerConversation('chief',{id:'cards-a-chief',title:'展示方式一览 · 今天的生活与商务',messages:chiefMessages});
})();
