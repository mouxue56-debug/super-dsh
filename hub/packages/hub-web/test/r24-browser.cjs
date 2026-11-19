// 在 <host> 用工单指定的现有 playwright-core 与 Chromium，串行回归。
const playwright=require(process.env.PLAYWRIGHT_CORE || require('os').homedir()+'/node_modules/playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const base=process.env.HUB_R24_URL||'http://127.0.0.1:3592';
const shots=process.env.HUB_R24_SHOTS||path.resolve('shots');fs.mkdirSync(shots,{recursive:true});
const prefix=process.env.HUB_R24_PREFIX||'';
(async()=>{
 const engine=process.env.HUB_R24_BROWSER||'chromium';
 assert(['chromium','webkit'].includes(engine),'仅使用本机已有 Chromium 或 WebKit');
 const executablePath=engine==='webkit' ? process.env.WEBKIT : process.env.CHROMIUM||require('os').homedir()+'/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
 const browser=await playwright[engine].launch({...(executablePath?{executablePath}:{}),headless:true,timeout:15000});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
 const errors=[],checks=[],sent=[];page.on('pageerror',e=>{errors.push(e.message);console.error('页面脚本错误：'+e.stack);});
 const check=(label,condition)=>{assert(condition,label);checks.push(label);console.log('通过：'+label);};
 let loseReceipt=false;
 await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   // WebKit 也会把内嵌 data 图片交给路由；它们不发起网络访问。
   if(url.protocol==='data:'||(url.protocol==='blob:'&&url.origin===new URL(base).origin))return route.continue();
   if(url.hostname!=='127.0.0.1')return route.abort();
   if(url.pathname.endsWith('/messages') && request.method()==='POST') {
     sent.push(JSON.parse(request.postData()));
     if(loseReceipt){loseReceipt=false;await route.fetch();return route.fulfill({status:202,contentType:'application/json',body:'{}'});}
   }
   return route.continue();
 });
 const fixture=async data=>{const r=await page.evaluate(async b=>{const r=await fetch('/bff/__fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return r.status;},data);assert.equal(r,200);};
 const snap=async(name,card)=>{
   await page.waitForTimeout(250);
   if(card)await page.locator('[data-real-card="'+card+'"]').evaluate(el=>el.scrollIntoView({block:'center'}));
   await page.waitForTimeout(180);await page.screenshot({path:path.join(shots,prefix+name+'.png')});
 };
 const stats=()=>page.evaluate(()=>fetch('/bff/__stats').then(r=>r.json()));
 await page.addInitScript(()=>localStorage.setItem('hub-web-last-session-r23',JSON.stringify({chief:'chief-old'})));
 await page.goto(base+'/?key=r24-offline-web');
 await page.waitForFunction(()=>window.HubReal?.state().sessions.length===7);
 await page.waitForFunction(()=>document.querySelector('[data-today-open] [data-r22-activity-total]')?.textContent==='1');
 check('首页最近首项来自服务器按 updatedAt 排序',await page.locator('.hub-real-recents button').first().getAttribute('data-real-open')==='chief-latest');
 check('首页六助理有真实待批与在忙',await page.evaluate(()=>{const text=bot=>document.querySelector('[data-bot-tree="'+bot+'"] small')?.textContent||'';return typeof Hub.setDemoContent==='function'?Hub.state.bots.find(b=>b.id==='chief').pending===1&&text('chief').includes('待批 1')&&Hub.state.bots.find(b=>b.id==='pm').running===true&&text('pm').includes('在干活'):text('chief')==='等你点头 · 1 项'&&text('pm').includes('忙碌');}));
 check('真实首页最近仅六助理服务器会话且无管家样例行',await page.evaluate(()=>{const host=document.querySelector('.home-recent-list'),sessions=HubReal.state().sessions;return host.children.length===1&&host.firstElementChild.classList.contains('hub-real-recents')&&host.querySelectorAll('[data-real-open]').length===sessions.length&&[...host.querySelectorAll('[data-real-open]')].every(el=>sessions.some(s=>s.id===el.dataset.realOpen&&['chief','support','content','pm','art','research'].includes(s.bot)))&&!host.querySelector('[data-bot-tree],.hub-real-sample');}));
 check('真实待批活动只使用六助理角色',await page.evaluate(()=>Hub.state.activities.filter(a=>a.id.startsWith('hub-real-')).every(a=>['chief','support','content','pm','art','research'].includes(a.bot))));
 // C3：对真实 DOM 做几何检查，三行字挤进壳行框时必须失败。
 const recentLayout=()=>page.evaluate(()=>{
   const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   return [...document.querySelectorAll('.hub-real-recents [data-real-open]')].map(el=>{
     const name=el.querySelector('.line strong'),preview=el.querySelector('.preview'),time=el.querySelector('time'),avatar=el.querySelector(':scope > .creature');
     const css=getComputedStyle(preview);
     return {id:el.dataset.realOpen,row:box(el),name:box(name),preview:box(preview),time:box(time),avatar:box(avatar),nameText:name.textContent,
       lines:el.querySelector('.grow').children.length,roles:el.querySelectorAll('.role').length,meta:!!el.querySelector(':scope > .home-row-meta > time'),
       font:getComputedStyle(name).fontSize,lineHeight:getComputedStyle(name).lineHeight,nowrap:css.whiteSpace,ellipsis:css.textOverflow,clipped:preview.scrollWidth>preview.clientWidth};
   });
 });
 const layout=await recentLayout(),realTypography={font:layout[0].font,lineHeight:layout[0].lineHeight};
 check('iPhone 视口与 3 倍缩放生效',await page.evaluate(()=>innerWidth===390&&innerHeight===844&&devicePixelRatio===3));
 check('最近行只有助理名和预览两行，时间在壳 meta 内',layout.every(r=>r.lines===2&&r.roles===0&&r.meta&&['首席助理','客服助理','内容助理','项目经理','艺术总监','调研员'].includes(r.nameText)));
 check('最近行文字与头像均在行框内，行与行没有相叠',layout.every((r,i)=>[r.name,r.preview,r.time,r.avatar].every(b=>b.y>=r.row.y-0.5&&b.bottom<=r.row.bottom+0.5)&&r.name.bottom<=r.preview.y+0.5&&(!i||layout[i-1].row.bottom<=r.row.y+0.5)));
 check('时间与助理名同在第一行，预览使用单行省略',layout.every(r=>Math.abs(r.time.y-r.name.y)<1&&r.name.right<=r.time.x&&r.nowrap==='nowrap'&&r.ellipsis==='ellipsis'));
 check('客服真实未读为零，隐藏演示分助理计数',await page.evaluate(()=>Hub.state.bots.find(b=>b.id==='support').unread===0&&Hub.subBots('support').length===2&&getComputedStyle(document.querySelector('[data-bot-tree="support"] .home-child-count')).display==='none'));
 await snap('01-首页最近与待批数');
 const longTitle='会话标题不应挤占第三行'.repeat(20),longPreview='长预览与连续字母ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(15);
 await fixture({type:'session',id:'support-latest',title:longTitle,lastText:longPreview,unread:0});
 await page.waitForFunction(text=>HubReal.state().sessions.find(s=>s.id==='support-latest')?.lastText===text,longPreview);
 const longRow=(await recentLayout()).find(r=>r.id==='support-latest');
 check('长标题不另占行，长预览确实截断且不撑高',longRow.nameText==='客服助理'&&longRow.lines===2&&longRow.clipped&&longRow.row.height===layout.find(r=>r.id===longRow.id).row.height&&longRow.preview.bottom<=longRow.row.bottom);
 await snap('16-长标题与长预览');
 await fixture({type:'session',id:'support-latest',unread:2});
 await page.waitForFunction(()=>HubReal.state().sessions.find(s=>s.id==='support-latest')?.unread===2&&document.querySelector('[data-bot-tree="support"] .home-child-count .r22-unread-dot'));
 check('真实未读使用原角落红点与最近行右侧红点',await page.locator('[data-bot-tree="support"] .home-child-count').isVisible()&&await page.locator('[data-real-open="support-latest"] > .home-row-meta .bot-unread').count()===1&&await page.locator('[data-bot-tree="support"] .home-child-count').textContent()==='');
 await snap('17-真实未读红点');
 await fixture({type:'session',id:'support-latest',unread:0});
 await page.waitForFunction(()=>HubReal.state().sessions.find(s=>s.id==='support-latest')?.unread===0&&getComputedStyle(document.querySelector('[data-bot-tree="support"] .home-child-count')).display==='none');
 check('真实未读归零后角落隐藏，不恢复演示加号计数',await page.locator('[data-bot-tree="support"] .home-child-count').textContent()===''&&await page.locator('[data-real-open="support-latest"] > .home-row-meta .bot-unread').count()===0);
 await snap('18-未读归零');
 if(process.env.HUB_R24_LAYOUT_ONLY==='1') {
   check('布局验证期间页面无脚本错误',errors.length===0);
   fs.writeFileSync(path.join(shots,prefix+'layout-results.json'),JSON.stringify({engine,browserVersion:browser.version(),deviceScaleFactor:3,viewport:{width:390,height:844},layout,checks,errors},null,2));
   console.log('浏览器布局回归：'+checks.length+' 项通过');return;
 }
 await page.locator('[data-today-open]:visible').first().click();await page.waitForSelector('.r30l-b-wait [data-r30l-open]');
 await snap('02-今天等你处理');
 await page.locator('.r30l-b-wait [data-r30l-open]').first().click();await page.waitForSelector('[data-real-card="approval-1"]');
 check('旧本机记忆不覆盖服务器最新会话',await page.locator('.hub-real-title').textContent()==='共享交付物确认 · DeepSeek V4.1 Flash');
 check('审批卡按 createdAt 插在回复之后',await page.evaluate(()=>{const m=[...document.querySelectorAll('.thread-inner [data-message-id]')];return !!m.at(-1)?.querySelector('[data-real-card="approval-1"]');}));
 check('角色显示等你点头',await page.locator('[data-pet-status]').first().textContent()==='等你点头');
 check('真实短语恢复为三条',await page.locator('[data-real-phrase]').count()===3);
 await page.waitForSelector('.hub-real-text ol[start="5"]');
 check('有序列表跨段落仍为 3 和 5 起号',await page.locator('.hub-real-text ol[start="3"]').count()===1 && await page.locator('.hub-real-text ol[start="5"]').count()===1);
 await snap('03-审批待批','approval-1');
 await page.locator('[data-real-approval="approval-1"][data-real-answer="approve"]').click();
 await page.waitForSelector('[data-real-card="approval-1"][data-real-card-status="approved"]');
 check('已批卡没有审批按钮',await page.locator('[data-real-card="approval-1"] [data-real-answer]').count()===0);
 await snap('04-审批已批准','approval-1');
 const make=async(id,extra={})=>{await fixture({id,type:'approval',bot:'chief',sessionId:'chief-latest',status:'pending',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),...extra});await page.waitForSelector('[data-real-card="'+id+'"]');};
 await make('approval-2',{diff:'- 旧交付日期：周五\n+ 新交付日期：周六'});
 check('差异沿用壳 add/del 配色结构',await page.locator('[data-real-card="approval-2"] .diff .add').count()===1 && await page.locator('[data-real-card="approval-2"] .diff .del').count()===1);
 await page.locator('[data-real-approval="approval-2"][data-real-answer="reject"]').click();await page.waitForSelector('[data-real-card="approval-2"][data-real-card-status="rejected"]');await snap('05-审批已拒绝','approval-2');
 await make('approval-3');await page.locator('[data-real-approval="approval-3"][data-real-answer="edit"]').click();
 await page.locator('[data-real-revision="approval-3"]').fill('把交付日期改为周六，再给我看。');await snap('06-改一下输入','approval-3');
 await page.locator('[data-real-approval="approval-3"][data-real-answer="revise"]').click();await page.waitForSelector('[data-real-card="approval-3"][data-real-card-status="revised"]');
 check('改稿结果显示原意见',(await page.locator('[data-real-card="approval-3"] .result').textContent()).includes('把交付日期改为周六，再给我看。'));await snap('07-审批已让它改','approval-3');
 await make('approval-4');await fixture({id:'approval-4',status:'timeout'});await page.waitForSelector('[data-real-card="approval-4"][data-real-card-status="timeout"]');await snap('08-审批超时','approval-4');
 await make('approval-5');await fixture({id:'approval-5',status:'unavailable'});await page.waitForSelector('[data-real-card="approval-5"][data-real-card-status="unavailable"]');await snap('09-无登录设备','approval-5');
 await snap('10-派工进行中时间线','delegation-1');
 await fixture({id:'delegation-1',status:'done',summary:'已核对阶段成果，下一步是人工检查交付物。',steps:[{ts:new Date().toISOString(),label:'派出'},{ts:new Date().toISOString(),label:'开始'},{ts:new Date().toISOString(),label:'第3步：核对交付证据'},{ts:new Date().toISOString(),label:'完成'}]});
 await page.waitForSelector('[data-real-report="delegation-1"]');await snap('11-派工完成回报','delegation-1');
 await fixture({id:'delegation-1',status:'queued',queuePos:2,steps:[{ts:new Date().toISOString(),label:'派出：排队第2位'}]});await page.waitForFunction(()=>document.querySelector('[data-real-card="delegation-1"] .result')?.textContent==='排队第 2 位');await snap('14-派工排队','delegation-1');
 await fixture({id:'delegation-1',status:'failed',reason:'假服务演练：缺少交付证据',steps:[{ts:new Date().toISOString(),label:'派出'},{ts:new Date().toISOString(),label:'开始'},{ts:new Date().toISOString(),label:'失败：缺少交付证据'}]});await page.waitForFunction(()=>document.querySelector('[data-real-card="delegation-1"] .result')?.textContent.includes('失败：'));await snap('15-派工失败','delegation-1');
 await fixture({id:'delegation-1',status:'done',summary:'已核对阶段成果，下一步是人工检查交付物。'});
 await page.locator('[data-real-report="delegation-1"]').click();await page.waitForFunction(()=>window.Hub.state.bot==='pm'&&document.querySelector('.hub-real-title')?.textContent.includes('项目经理'));
 check('派工回报跳到目标助理会话',await page.locator('.hub-real-title').textContent()==='项目经理的派工回报 · DeepSeek V4.1 Flash');
 // 在看板上仍保持全局事件连接，并实时出现新的待批。
 await page.evaluate(()=>Hub.navigate({view:'kanban'}));await makeOffscreen();
 async function makeOffscreen(){await fixture({id:'approval-6',type:'approval',bot:'chief',sessionId:'chief-latest',status:'pending',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()});}
 await page.waitForFunction(()=>document.querySelector('[data-today-open] [data-r22-activity-total]')?.textContent==='1');
 check('跨页面卡事件立即更新底栏待批',await page.locator('[data-today-open]:visible').first().getAttribute('aria-label')==='今天 1 项等你处理');await snap('12-看板跨页待批');
 await page.locator('[data-today-open]:visible').first().click();await page.locator('.r30l-b-wait [data-r30l-open]').first().click();await page.waitForSelector('[data-real-card="approval-6"]');
 // 发送已抵达假 BFF，但浏览器丢失回执；手动重试必须复用同一个 idem。
 loseReceipt=true;await page.locator('[data-real-phrase]').first().click();await page.waitForSelector('[data-real-retry]');
 await page.locator('[data-real-retry]').last().click();await page.waitForFunction(()=>HubReal.state().jobs.length===0);
 const after=await stats();
 console.log('幂等回归观测：'+JSON.stringify({sentAttempts:sent.length,ids:sent.map(s=>s.idem),effectiveMessages:after.messages.length}));
 check('回执丢失后重试沿用同一 UUID',sent.length>=2 && sent.every(s=>s.idem===sent[0].idem) && /^[0-9a-f-]{36}$/.test(sent[0].idem));
 check('假 BFF 只收到一次有效消息',after.messages.length===1);
 check('任意页面只保持一条全局 SSE',after.maxGlobalConnections===1);
 // 新会话菜单入口保留；点回首页助理后仍选服务器最新。
 await page.locator('[data-act="session-menu"]').click();await page.locator('.drawer [data-act="new-session"]').first().click();await page.waitForFunction(()=>document.querySelector('.hub-real-title')?.textContent.startsWith('新会话'));
 check('菜单可以创建空白新会话',await page.locator('.hub-real-empty').count()===1);
 await page.evaluate(()=>{Hub.state.detail=false;window.render();});await page.locator('.pin[data-id="chief"]').click();await page.waitForFunction(()=>document.querySelector('.hub-real-title')?.textContent.startsWith('共享交付物确认'));
 // 管家页保持 r23 的标题，不再追加样例标，也不发 messages。
 const beforeSample=(await stats()).messages.length;
 await page.evaluate(()=>Hub.navigate({view:'chat',bot:'board-steward'}));
 await page.waitForFunction(()=>Hub.state.bot==='board-steward');
 check('管家聊天标题不再追加样例标',await page.locator('.shell-title-meta .hub-real-sample,.titlepill strong .hub-real-sample').count()===0);
 check('管家聊天没有审批或派工卡',await page.locator('[data-real-card]').count()===0);
 check('管家样例没有真发消息',(await stats()).messages.length===beforeSample);await snap('13-管家聊天恢复原样');
 const botIds=await page.evaluate(()=>Hub.state.bots.map(b=>b.id));
 // 演示模式仍由原壳渲染；重载后再回真实模式，不能残留样例最近行。
 await page.evaluate(()=>localStorage.setItem('hub-web-mode-v1','demo'));await page.reload();
 await page.waitForFunction(()=>HubReal.state().mode==='demo');
 await page.evaluate(()=>{Hub.state.detail=false;window.render();});
 check('演示首页保留原壳管家最近行',await page.locator('.home-recent-list [data-bot-tree="board-steward"]').count()===1&&await page.locator('.hub-real-recents').count()===0);
 check('适配层未新增任何管家角色',await page.evaluate(ids=>JSON.stringify(Hub.state.bots.map(b=>b.id))===JSON.stringify(ids),botIds));
 const demoTypography=await page.locator('.home-recent-list .conversation strong').first().evaluate(el=>({font:getComputedStyle(el).fontSize,lineHeight:getComputedStyle(el).lineHeight}));
 check('真实最近名字字号与行高沿用壳样例',JSON.stringify(realTypography)===JSON.stringify(demoTypography));
 console.log('演示角落探针：'+JSON.stringify(await page.locator('[data-bot-tree="support"] .home-child-count').evaluate(el=>({display:getComputedStyle(el).display,style:el.style.display,text:el.textContent,b:Hub.state.bots.filter(b=>b.id==='support').map(b=>({unread:b.unread,running:b.running,pending:b.pending})),mode:HubReal.state().mode,rect:el.getBoundingClientRect().toJSON()}))));
 check('演示角落按壳原样显示，未被真实模式隐藏',await page.locator('[data-bot-tree="support"] .home-child-count').isVisible()&&await page.evaluate(()=>{const b=Hub.state.bots.find(b=>b.id==='support'),el=document.querySelector('[data-bot-tree="support"] .home-child-count');return el.style.display===''&&el.textContent===(b.unread?'':'+'+Hub.subBots('support').length);}));
 await page.evaluate(()=>{Hub.state.bots.find(b=>b.id==='support').unread=0;window.render();});
 check('演示未读为零仍由壳生成原有加号计数',await page.locator('[data-bot-tree="support"] .home-child-count').isVisible()&&await page.locator('[data-bot-tree="support"] .home-child-count').textContent()==='+2');
 await snap('19-演示模式原样');
 await page.evaluate(()=>localStorage.setItem('hub-web-mode-v1','real'));await page.reload();
 await page.waitForFunction(()=>HubReal.state().sessions.length>=7);
 check('重回真实首页不残留管家最近行',await page.locator('.home-recent-list [data-bot-tree]').count()===0&&await page.locator('.hub-real-recents [data-real-open]').count()>=7);
 console.log('页面脚本错误记录：'+JSON.stringify(errors));
 check('页面无脚本错误',errors.length===0);
 fs.writeFileSync(path.join(shots,prefix+'browser-results.json'),JSON.stringify({engine,browserVersion:browser.version(),deviceScaleFactor:3,viewport:{width:390,height:844},layout,checks,errors,stats:{effectiveMessages:after.messages.length,sentAttempts:sent.length,maxGlobalConnections:after.maxGlobalConnections}},null,2));
 console.log('浏览器回归：'+checks.length+' 项通过');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
