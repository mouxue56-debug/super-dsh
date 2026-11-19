// 只用纯内存假接口；不连接内核或真实名册。
const config=__CONFIG__,fs=await import('node:fs/promises'),path=await import('node:path'),assert=(await import('node:assert/strict')).default;
const url=new URL(config.url);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'3592');
const task=await taskSpace(config.space),page=task.page('p1'),checks=[],evidence={};
await fs.mkdir(config.shots,{recursive:true});
const check=(name,ok)=>{checks.push({name,ok:!!ok});console.log((ok?'通过：':'失败：')+name);};
const wait=fn=>page.waitForFunction(fn,undefined,{timeout:10000});
const settle=()=>page.cdp('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,300))))',awaitPromise:true});
const click=async css=>{await page.click('loc=css:'+css);await settle();};
const shot=async (name,selector)=>{if(selector)await page.evaluate(selector=>Hub.reading.locate(document.querySelector(selector),{block:'start',reason:'f4-shot'}),selector);await settle();await page.screenshot({path:path.join(config.shots,'f4-'+config.phase+'-'+name+'.png')});};
const fixture=async body=>{assert.equal((await page.fetch('/bff/__fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).status,200);};
await page.goto(config.url+'/?key=r24-offline-web');await wait(()=>window.HubReal?.state().rosterReady);
const roster=JSON.parse((await page.fetch('/bff/bots')).body).bots.slice(0,6),chief=roster.find(b=>b.role==='chief'),other=roster.at(-1);
const extra={...other,id:'bf3acfe44',name:'记账助理',preset:'hub-bot',status:'active',order:6,avatar:{kind:'shape',shape:'star',color:'blue'}};
await fixture({type:'roster',bots:[...roster,extra]});
const seed=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('hub-web-mode-v1','real');localStorage.setItem('hub-real-route-v1','null');localStorage.setItem('hub-r22-route',JSON.stringify({view:'home',bot:${JSON.stringify(chief.id)},conversation:${JSON.stringify(chief.id+'-013')},ts:Date.now()}));window.__f4Errors=[];addEventListener('error',e=>__f4Errors.push(e.message));addEventListener('unhandledrejection',e=>__f4Errors.push(String(e.reason)));`});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
await page.goto(config.url+'/?key=r24-offline-web');await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:seed.identifier});await wait(()=>window.HubReal?.state().rosterReady&&innerWidth<700);await settle();
const home=async()=>{await page.evaluate(()=>{Hub.state.drawer=null;Hub.navigate({view:'chat'});Hub.state.detail=false;window.render();});await settle();};
const more=async kind=>{await home();await click('.r22-home-dock [data-act=more]');await click('[data-hub-more-item="hub-real-'+kind+'"]');};
const listState=()=>page.evaluate(()=>{const content=document.querySelector('.r22-sheet-content');return {ids:[...document.querySelectorAll('[data-real-bot-row]')].map(n=>n.dataset.realBotRow),summary:document.querySelector('[data-real-roster-summary]')?.textContent,scrollHeight:content.scrollHeight,clientHeight:content.clientHeight};});
const targetVisible=selector=>page.evaluate(selector=>{const n=document.querySelector(selector);if(!n)return false;const r=n.getBoundingClientRect(),pane=n.closest('.thread,.r22-sheet-content'),p=pane?.getBoundingClientRect(),dock=document.querySelector('.composer-area')?.getBoundingClientRect(),bottom=Math.min(innerHeight,visualViewport?.height+visualViewport?.offsetTop||innerHeight,p?.bottom||innerHeight,pane?.classList.contains('thread')?dock?.top||innerHeight:innerHeight);return r.top>=Math.max(0,p?.top||0)&&r.bottom<=bottom&&[.15,.5,.85].every(y=>n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height*y)));},selector);
for(const kind of ['bots','profiles']){
 await more(kind);const state=await listState();evidence[kind]=state;check(kind+'：冷加载完整列出七个助理',state.ids.length===7&&state.ids.includes(extra.id));
 await page.evaluate(id=>document.querySelector('[data-real-bot-row="'+id+'"]').scrollIntoView({block:'end',behavior:'instant'}),extra.id);await settle();check(kind+'：第七项可滚到可点击区域',await targetVisible('[data-real-bot-row="'+extra.id+'"] button'));
 check(kind+'：第七项使用 shape 头像',await page.evaluate(id=>!!document.querySelector('[data-real-bot-row="'+id+'"] svg[aria-label="图形头像"]'),extra.id));await shot(kind+'-seventh');
}
await fixture({type:'roster',target:extra.id,patch:{status:'disabled'}});await wait(()=>HubReal.state().roster.at(-1).status==='disabled');await more('bots');check('停用助理保留并灰显，聊天不可用',await page.evaluate(id=>{const r=document.querySelector('[data-real-bot-row="'+id+'"]');return r.classList.contains('hub-real-disabled')&&r.querySelector('button').disabled;},extra.id));
await fixture({type:'roster',target:extra.id,patch:{status:'active'}});
await more('profiles');await click('[data-real-bot-row="'+extra.id+'"] button');check('换形象点击区至少44px',await page.evaluate(()=>document.querySelector('[data-real-profile-field=avatar] button').getBoundingClientRect().height>=44));await click('[data-real-profile-field=avatar] button');
evidence.avatar=await page.evaluate(()=>({edit:document.querySelector('[data-real-profile-edit=avatar]')?.getBoundingClientRect().toJSON(),tabs:[...document.querySelectorAll('[role=tab]')].map(n=>({text:n.textContent,rect:n.getBoundingClientRect().toJSON()}))}));
check('换形象后无需再次滚动，三页签立即可见',await targetVisible('[role=tab]:first-child')&&await targetVisible('[role=tab]:last-child'));await shot('avatar-open');
for(const label of ['图形','上传图片','角色']){await click('[role=tab]:text-is("'+label+'")');check('换形象：'+label+'页签可点',await page.evaluate(label=>[...document.querySelectorAll('[role=tab]')].some(n=>n.textContent===label&&n.getAttribute('aria-selected')==='true'),label));}
// 模拟名册事件丢失：界面停留六项，服务端实际仍为七项。
const hide=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`const Native=EventSource;window.EventSource=class extends Native{addEventListener(type,...args){if(type==='roster')return;return super.addEventListener(type,...args);}};`});
await fixture({type:'roster',bots:roster});await page.goto(config.url+'/?key=r24-offline-web');await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:hide.identifier});await wait(()=>window.HubReal?.state().rosterReady);await fixture({type:'roster',add:extra});await more('bots');await settle();
check('漏收名册事件后，打开助理列表重读到第七项',(await listState()).ids.includes(extra.id));
await page.goto(config.url+'/?key=r24-offline-web');await wait(()=>window.HubReal?.state().rosterReady);await page.evaluate(()=>{window.__f4Errors=[];addEventListener('error',e=>__f4Errors.push(e.message));addEventListener('unhandledrejection',e=>__f4Errors.push(String(e.reason)));});
// 分别使用独立会话，避免测试靠自动滚动才看见提交按钮。
const prefix='f4-'+config.phase+'-'+Date.now().toString(36),now=new Date().toISOString();
const openCard=async (suffix,tool,bot=chief.id,target=other.id)=>{
 const session=prefix+'-'+suffix,id=session+'-card',card={id,type:'approval',tool,bot,sessionId:session,status:'pending',createdAt:now,expiresAt:new Date(Date.now()+600000).toISOString(),why:'核对草稿后再改',target,before:{name:other.name},after:{name:'资料员'},command:'echo 本地假命令',cwd:'bots/'+bot};
 await fixture({type:'timeline',id:session,messages:[{role:'assistant',text:Array(22).fill('后续记录用于保持卡片位于时间轴中间。').join('\n\n'),ts:new Date(Date.now()+60000).toISOString()}],cards:[card]});await home();await page.waitForSelector('.home-recent-list [data-real-open="'+session+'"]');await click('.home-recent-list [data-real-open="'+session+'"]');await page.waitForFunction(id=>document.querySelector('[data-real-card="'+id+'"]'),id);return {id,card};
};
for(const [kind,tool] of [['command','bash'],['roster','bot_update']]){
 const {id}=await openCard(kind,tool);
 await page.evaluate(id=>{const n=document.querySelector('[data-real-card="'+id+'"] [data-real-answer=edit]');n.scrollIntoView({block:'end',behavior:'instant'});const p=n.closest('.thread'),r=n.getBoundingClientRect(),bottom=Math.min(p.getBoundingClientRect().bottom,document.querySelector('.composer-area').getBoundingClientRect().top);p.scrollTop+=r.bottom-bottom+10;},id);await settle();
 await click('[data-real-card="'+id+'"] [data-real-answer=edit]');
 const selector='[data-real-card="'+id+'"] [data-real-answer=revise]';check(kind+'：展开意见后提交按钮完整可点击',await targetVisible(selector));
 check(kind+'：提交按钮点击区至少44px',await page.evaluate(selector=>document.querySelector(selector).getBoundingClientRect().height>=44,selector));
 evidence[kind+'Revision']=await page.evaluate(id=>{const n=document.querySelector('[data-real-card="'+id+'"] [data-real-answer=revise]');return {button:n.getBoundingClientRect().toJSON(),thread:document.querySelector('.thread').getBoundingClientRect().toJSON(),composer:document.querySelector('.composer-area').getBoundingClientRect().toJSON()};},id);await shot(kind+'-revision');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:600,deviceScaleFactor:1,mobile:false});await settle();check(kind+'：可用高度缩短后提交仍完整可点',await targetVisible(selector));await shot(kind+'-revision-short');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await settle();
 await page.fill('[data-real-revision="'+id+'"]','保留这条完整修改意见');await click(selector);await page.waitForFunction(id=>document.querySelector('[data-real-card="'+id+'"]')?.dataset.realCardStatus==='revised',id);check(kind+'：意见原样送入假审批接口',JSON.parse((await page.fetch('/bff/__stats')).body).answers.some(a=>a.note==='保留这条完整修改意见'));
}
const {id:selfId,card:self}=await openCard('self','bot_update',other.id,other.id);
check('自己改名：标题使用原名和自己的资料',await page.evaluate(({id,name})=>document.querySelector('[data-real-card="'+id+'"] h3')?.textContent===name+'想改自己的资料',{id:selfId,name:other.name}));
await fixture({type:'roster',target:other.id,patch:{name:'资料员'}});await fixture({...self,status:'approved'});await settle();
check('批准且名册更新后，标题仍为卡片发起时的原名',await page.evaluate(({id,name})=>document.querySelector('[data-real-card="'+id+'"] h3')?.textContent===name+'想改自己的资料',{id:selfId,name:other.name}));await shot('self-approved','[data-real-card="'+selfId+'"] h3');
const {id:crossId}=await openCard('cross','bot_update');await fixture({type:'roster',target:chief.id,patch:{name:chief.name==='统筹员'?'总协调员':'统筹员'}});await fixture({type:'roster',target:other.id,patch:{name:other.name==='新资料员'?'后改资料员':'新资料员'}});await settle();
check('跨助理修改：发起者和目标均冻结原名',await page.evaluate(({id,who,target})=>document.querySelector('[data-real-card="'+id+'"] h3')?.textContent===who+'想改'+target+'的资料',{id:crossId,who:chief.name,target:other.name}));await shot('cross-names','[data-real-card="'+crossId+'"] h3');
check('全程实际宽度小于700',await page.evaluate(()=>innerWidth===390));check('没有页面异常',await page.evaluate(()=>__f4Errors.length===0));check('未发模型消息，未上传头像',JSON.parse((await page.fetch('/bff/__stats')).body).messages.length===0&&JSON.parse((await page.fetch('/bff/__stats')).body).uploads.length===0);
await fs.writeFile(path.join(config.shots,'f4-'+config.phase+'-results.json'),JSON.stringify({checks,evidence,passed:checks.filter(c=>c.ok).length,total:checks.length},null,2));console.log({passed:checks.filter(c=>c.ok).length,total:checks.length});console.log(await page.snapshot());if(!config.phase.startsWith('before'))assert(checks.every(c=>c.ok),'F4 回归必须全通过');
