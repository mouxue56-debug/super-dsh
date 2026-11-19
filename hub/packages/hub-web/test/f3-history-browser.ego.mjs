// 仅回环假环境；读取实际 shellNavigation 闭包，不修改壳或其历史策略。
const config=__CONFIG__;
const fs=await import('node:fs/promises'),path=await import('node:path'),assert=(await import('node:assert/strict')).default;
const target=new URL(config.url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'3592');
const task=await taskSpace(config.space),page=task.page(config.page),steps=[],checks=[];
await fs.mkdir(config.shots,{recursive:true});
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
// 测试身份和会话从假接口读取，新增脚本不固化助理 id、名字或用户目录。
await page.goto(config.url+'/?key=r24-offline-web');
await page.waitForFunction(()=>window.HubReal?.state().sessions.length>0 && innerWidth<700);
const initial=await page.evaluate(()=>({data:HubReal.state(),project:Hub.state.project}));
const chief=initial.data.roster.find(b=>b.role==='chief');assert(chief,'假环境必须有首席');
const chiefSessions=initial.data.sessions.filter(s=>s.bot===chief.id);assert(chiefSessions.length>=2,'假环境需要两个首席会话');
const sourceCards=JSON.parse((await page.fetch('/bff/sessions/'+encodeURIComponent(chiefSessions[0].id)+'/cards')).body).cards;
const approval=sourceCards.find(c=>c.type==='approval'&&c.status==='pending'),delegation=sourceCards.find(c=>c.type==='delegation'&&c.toSession);assert(approval&&delegation,'假环境需要待批卡与派工卡');
const sample={chief:chief.id,other:delegation.bot,latest:chiefSessions[0].id,old:chiefSessions.at(-1).id,otherSession:delegation.toSession,approval:approval.id,delegation:delegation.id,project:initial.project};
const pause=()=>new Promise(r=>setTimeout(r,250));
const wait=fn=>page.waitForFunction(fn,undefined,{timeout:10000});
const check=(name,ok)=>{checks.push({name,ok});console.log((ok?'通过：':'失败：')+name);};
async function reset(view='home') {
  const script=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('hub-web-mode-v1','real');localStorage.setItem('hub-real-route-v1','null');localStorage.setItem('hub-r22-route',JSON.stringify({view:${JSON.stringify(view)},bot:${JSON.stringify(sample.chief)},conversation:${JSON.stringify(sample.chief+'-013')},project:${JSON.stringify(sample.project)},ts:Date.now()}));window.__f3Events=[];window.__f3Errors=[];for(const k of ['pushState','replaceState']){const f=history[k];history[k]=function(s,...a){window.__f3Events.push({method:k,state:structuredClone(s)});return f.call(this,s,...a);};}addEventListener('popstate',e=>window.__f3Events.push({method:'popstate',state:structuredClone(e.state)}));addEventListener('error',e=>window.__f3Errors.push(e.message));addEventListener('unhandledrejection',e=>window.__f3Errors.push(String(e.reason)));`});
  await page.goto(config.url+'/?key=r24-offline-web');
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier});
  await wait(()=>window.HubReal?.state().sessions.length>0 && innerWidth<700);await pause();
}
async function capture(label) {
  const f=await page.cdp('Runtime.evaluate',{expression:'shellNavigation.sync'});
  const props=await page.cdp('Runtime.getProperties',{objectId:f.result.objectId,ownProperties:false});
  const scopes=props.internalProperties.find(p=>p.name==='[[Scopes]]').value;
  const ss=await page.cdp('Runtime.getProperties',{objectId:scopes.objectId,ownProperties:true});
  let shell;
  for(const s of ss.result.filter(p=>/^\d+$/.test(p.name))){
    const ps=await page.cdp('Runtime.getProperties',{objectId:s.value.objectId,ownProperties:true});
    const entries=ps.result.find(p=>p.name==='entries');if(!entries)continue;
    const data=await page.cdp('Runtime.callFunctionOn',{objectId:entries.value.objectId,functionDeclaration:'function(){return this.map(s=>({mode:s.mode,detail:s.detail,bot:s.bot,conversation:s.conversation,drawer:s.drawer}));}',returnByValue:true});
    shell={entries:data.result.value,depth:ps.result.find(p=>p.name==='depth').value.value,pending:ps.result.find(p=>p.name==='pending').value.value};break;
  }
  assert(shell,'必须读到实际壳 entries');
  const state=await page.evaluate(()=>({length:history.length,depth:history.state?.depth,history:history.state?.snapshot,route:{view:Hub.state.view,detail:Hub.state.detail,bot:Hub.state.bot,conversation:Hub.state.conversation,drawer:Hub.state.drawer},events:window.__f3Events.splice(0),errors:window.__f3Errors.slice(),width:innerWidth}));
  const result={label,...state,shell};steps.push(result);console.log(JSON.stringify(result));return result;
}
async function shot(name){await pause();await page.screenshot({path:path.join(config.shots,'f3-'+config.phase+'-'+name+'.png')});}
async function click(selector){await page.waitForSelector('loc=css:'+selector);await page.click('loc=css:'+selector);await pause();}
async function back(){if(await page.evaluate(()=>!!document.querySelector('.chat-header [data-act=back]')?.getClientRects().length))await click('.chat-header [data-act=back]');else {await page.evaluate(()=>{document.querySelector('.chat-header [data-act=back]')?.click();});await pause();}}
const home=s=>s.route.view==='chat'&&!s.route.detail&&!s.route.drawer&&s.depth===0;
const chat=s=>s.route.detail&&!s.route.drawer&&s.route.conversation.startsWith('hub-real-');
// 每条路径独立冷载；history.length 含浏览器前进项，断言以 depth/entries 为准。
await reset();const gridHome=await capture('格子：首页');await click('.pinned [data-id='+sample.chief+']');const grid=await capture('格子：会话');
check('格子点击只增加一个会话历史项',chat(grid)&&grid.depth===1&&grid.shell.entries.length===2);
await shot('grid-chat');await back();const gridBack=await capture('格子：返回');check('格子会话一次返回首页且不被异步重开',home(gridBack));await shot('grid-back');
await reset();await capture('最近：首页');await click('.home-recent-list [data-real-open='+sample.otherSession+']');const recent=await capture('最近：会话');check('最近直接进入目标会话且只有一项',chat(recent)&&recent.route.bot===sample.other&&recent.depth===1);
await back();check('最近会话一次返回首页',home(await capture('最近：返回')));await shot('recent-back');
await reset();await capture('活动：首页');await click('.r22-home-dock [data-activity-open]');const activity=await capture('活动：待批列表');await click('[data-real-pending='+sample.approval+']');const activityChat=await capture('活动：会话');
check('活动卡一次动作只增加一个会话项',chat(activityChat)&&activityChat.depth===activity.depth+1);
await back();const activityBack=await capture('活动：返回');check('活动卡返回原待批列表并保留首页底层',!activityBack.route.detail&&activityBack.route.drawer==='hub-real-activity'&&activityBack.depth===activity.depth);await shot('activity-back');
// 关闭原活动层后应回首页，不产生另一助理会话。
await page.keyboard.press('Escape');await pause();check('活动列表关闭后回首页',home(await capture('活动：关闭列表')));
await reset();await click('.home-recent-list [data-real-open='+sample.latest+']');await capture('菜单：原会话');await click('[data-act=session-menu]');await capture('菜单：会话菜单');await click('.drawer [data-act=sessions] >> nth=0');const menu=await capture('菜单：服务器会话列表');await click('.drawer [data-real-open='+sample.old+']');const switched=await capture('菜单：切换会话');
check('会话菜单切换只增加一个目标会话项',chat(switched)&&switched.depth===Math.min(3,menu.depth+1));await back();const menuBack=await capture('菜单：返回');check('切会话返回原会话列表而非别的会话',menuBack.route.drawer==='hub-real-sessions'&&menuBack.route.conversation===menu.route.conversation);await shot('session-menu-back');
await reset();await click('.home-recent-list [data-real-open='+sample.latest+']');await page.waitForSelector('loc=css:[data-real-report='+sample.delegation+']');await capture('派工：首席会话');await click('[data-real-report='+sample.delegation+']');const report=await capture('派工：回报会话');check('派工查看保留来源会话供返回',report.route.bot===sample.other&&report.depth===2);
await shot('delegation-report');await back();const reportBack=await capture('派工：第一次返回');check('派工第一次返回首席来源会话',chat(reportBack)&&reportBack.route.bot===sample.chief&&reportBack.depth===1);await back();check('派工第二次返回首页',home(await capture('派工：第二次返回')));await shot('delegation-back');
await reset('chat');const cold=await capture('冷启动：恢复会话');check('冷启动恢复到真实会话且只一项',chat(cold)&&cold.depth===1);await back();check('冷启动恢复后一次返回首页',home(await capture('冷启动：返回')));await shot('cold-back');
// 真实关闭/重载产生的路由含旧 local id；必须恢复同一服务器会话，不能只种一个演示 id。
await reset();await click('.home-recent-list [data-real-open='+sample.old+']');const savedChat=await capture('真实冷启动：旧会话');
const savedTitle=await page.evaluate(()=>Hub.state.sessionNames[Hub.state.bot]);
const watch=await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.__f3Events=[];window.__f3Errors=[];for(const k of ['pushState','replaceState']){const f=history[k];history[k]=function(s,...a){window.__f3Events.push({method:k,state:structuredClone(s)});return f.call(this,s,...a);};}addEventListener('popstate',e=>window.__f3Events.push({method:'popstate',state:structuredClone(e.state)}));addEventListener('error',e=>window.__f3Errors.push(e.message));addEventListener('unhandledrejection',e=>window.__f3Errors.push(String(e.reason)));`});
await page.goto(config.url+'/?key=r24-offline-web');await page.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:watch.identifier});await wait(()=>window.HubReal?.state().sessions.length>0);await pause();
const coldReal=await capture('真实冷启动：恢复');await shot('real-cold-restored');
check('真实重载恢复同一服务器旧会话并重建本地id',chat(coldReal)&&coldReal.depth===1&&coldReal.route.conversation!==savedChat.route.conversation&&await page.evaluate(()=>Hub.state.sessionNames[Hub.state.bot])===savedTitle);
await back();check('真实重载恢复一次返回首页',home(await capture('真实冷启动：返回')));await shot('real-cold-back');
async function holdList(){await page.evaluate(()=>{const original=window.fetch;window.__f3Held=[];window.__f3Requests=0;window.fetch=async function(...args){const response=await original.apply(this,args);if(new URL(typeof args[0]==='string'?args[0]:args[0].url,location).pathname==='/bff/sessions'){window.__f3Requests++;await new Promise(resolve=>window.__f3Held.push(resolve));}return response;};window.__f3Release=()=>{window.fetch=original;window.__f3Held.splice(0).forEach(resolve=>resolve());};});}
if(config.phase!=='before'){
// 旧会话列表的慢刷新不得覆盖更新的用户动作。
await reset();await holdList();await click('.pinned [data-id='+sample.chief+']');await click('.pinned [data-id='+sample.other+']');await wait(()=>window.__f3Requests>=2);await page.evaluate(()=>window.__f3Release());await pause();
const rapid=await capture('竞态：连续点两个格子');check('慢请求只打开最后点击的助理且只有一项',chat(rapid)&&rapid.route.bot===sample.other&&rapid.depth===1&&rapid.shell.entries.length===2);await back();check('连续点击后一次返回首页',home(await capture('竞态：连续点击返回')));
await reset();await holdList();await click('.pinned [data-id='+sample.other+']');await click('.r22-home-dock [data-activity-open]');await page.evaluate(()=>window.__f3Release());await pause();const cancelled=await capture('竞态：点格子后离开');check('离开点击来源后慢请求不抢走活动列表',cancelled.route.drawer==='hub-real-activity'&&!cancelled.route.detail&&cancelled.depth===1);
await reset();await click('.home-recent-list [data-real-open='+sample.latest+']');await holdList();await click('.chat-header [data-real-list]');await click('.drawer [data-real-open='+sample.old+']');await page.evaluate(()=>window.__f3Release());await pause();const menuRace=await capture('竞态：会话列表慢刷新');check('会话列表慢刷新不重新打开已关闭面板',chat(menuRace)&&menuRace.route.drawer===null&&menuRace.depth===3);
}
check('所有路径实际在窄屏运行',steps.every(s=>s.width<700));check('没有页面异常',steps.every(s=>s.errors.length===0));
const stats=JSON.parse((await page.fetch('/bff/__stats')).body);check('全部导航均未发送模型消息或审批',stats.messages.length===0&&stats.answers.length===0);
await fs.writeFile(path.join(config.shots,'f3-'+config.phase+'-history.json'),JSON.stringify({phase:config.phase,checks,steps},null,2));
console.log({passed:checks.filter(c=>c.ok).length,total:checks.length});console.log(await page.snapshot());
if(config.phase!=='before')assert(checks.every(c=>c.ok),'历史路径回归必须全通过');
