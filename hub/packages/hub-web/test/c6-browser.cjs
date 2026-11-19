// C6：在两版真实壳上核对钩子调用、演示切换和状态，所有数据仅来自3592假服务。
const playwright=require(process.env.PLAYWRIGHT_CORE||require('os').homedir()+'/node_modules/playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const engine=process.env.HUB_R24_BROWSER||'chromium',base='http://127.0.0.1:3592',prefix=process.env.HUB_R24_PREFIX||'c6-'+engine+'-';
const out=process.env.HUB_R24_SHOTS||path.resolve('shots');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await playwright[engine].launch({headless:true,executablePath:engine==='webkit'?process.env.WEBKIT:require('os').homedir()+'/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
 const checks=[],errors=[],blocked=[];let modern;
 const check=(label,ok)=>{assert(ok,label);checks.push(label);console.log('通过：'+label);};
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.protocol==='data:'||(u.protocol==='blob:'&&u.origin===base))return route.continue();
   if(u.origin!==base){blocked.push(u.origin);return route.abort();}
   if(u.pathname==='/hub-real.js'){
    const response=await route.fetch();
    const probe=`window.__c6Hooks=[];for(const name of ['registerMoreItem','setDemoContent','setBotStatus']){if(typeof Hub[name]!=='function')continue;const original=Hub[name];Hub[name]=function(...args){__c6Hooks.push({name,args:args.map(a=>typeof a==='object'?{...a,...('onClick' in a?{onClick:typeof a.onClick}:{})}:a)});return original.apply(this,args);};}\n`;
    return route.fulfill({response,body:probe+await response.text()});
   }return route.continue();
  });
  const snap=async name=>{await page.waitForTimeout(300);await page.screenshot({path:path.join(out,prefix+name+'.png'),animations:'disabled'});};
  const fixture=async b=>assert.equal(await page.evaluate(async b=>(await fetch('/bff/__fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})).status,b),200);
  await page.goto(base+'/?key=r24-offline-web');await page.waitForFunction(()=>HubReal?.state().sessions.length===7);
  modern=await page.evaluate(()=>typeof Hub.setDemoContent==='function');
  check('壳能力与本轮指定版本相符',modern===(process.env.HUB_R24_SHELL==='shell-r23'));
  await page.waitForFunction(()=>{const chief=Hub.state.bots.find(b=>b.id==='chief');return typeof Hub.setDemoContent==='function'?chief.pending===1:document.querySelector('[data-bot-tree="chief"] small')?.textContent==='等你点头 · 1 项';});
  console.log('状态探针：'+JSON.stringify(await page.evaluate(()=>({bots:Hub.state.bots.filter(b=>['chief','pm'].includes(b.id)).map(b=>({id:b.id,running:b.running,pending:b.pending,unread:b.unread})),chief:document.querySelector('[data-bot-tree="chief"] small')?.textContent,pm:document.querySelector('[data-bot-tree="pm"] small')?.textContent,hooks:__c6Hooks.filter(h=>h.name==='setBotStatus')}))));
  check('真实忙碌、待批和未读由正确来源显示',await page.evaluate(modern=>{
   const chief=Hub.state.bots.find(b=>b.id==='chief'),pm=Hub.state.bots.find(b=>b.id==='pm');
   const status=bot=>document.querySelector('[data-bot-tree="'+bot+'"] small')?.textContent||'';
   return modern?chief.pending===1&&pm.running===true&&pm.unread===1&&__c6Hooks.some(h=>h.name==='setBotStatus'&&h.args[0]==='chief'&&h.args[1].pending===1):status('chief')==='等你点头 · 1 项'&&status('pm').includes('忙碌');
  },modern));await snap('01-真实首页状态');
  await page.locator('.r22-home-dock [data-act="more"]').click();
  const entry=modern?'[data-hub-more-item="hub-real-mode"]':'[data-real-mode-entry]';
  check('更多里恰好一个连接模式入口',await page.locator(entry).count()===1&&await page.locator(entry).isVisible());
  if(modern)check('新壳通过注册入口且没有回退菜单节点',await page.locator('[data-real-mode-entry]').count()===0&&await page.evaluate(()=>__c6Hooks.some(h=>h.name==='registerMoreItem'&&h.args[0].id==='hub-real-mode'&&h.args[0].onClick==='function')));
  await page.locator(entry).evaluate(el=>el.scrollIntoView({block:'center'}));await snap('02-更多连接模式');await page.locator(entry).click();await page.locator('[data-hub-mode="demo"]').click();await page.waitForFunction(()=>HubReal.state().mode==='demo');
  await page.evaluate(()=>Hub.navigate({view:'chat',bot:'chief'}));
  check('切演示后演示装饰恢复且无真实网络消息',await page.locator('.m-persona-today').isVisible()&&await page.evaluate(async()=>{const s=await fetch('/bff/__stats').then(r=>r.json());return s.messages.length===0;}));
  if(modern)check('演示开关对六助理均恢复true',await page.evaluate(()=>['chief','support','content','pm','art','research'].every(bot=>__c6Hooks.some(h=>h.name==='setDemoContent'&&h.args[0]===bot&&h.args[1]===true))&&document.querySelector('.chatview').dataset.demo==='on'));
  await snap('03-演示内容恢复');
  // 从真实可点击更多行回到连接设置，再切真实，覆盖同页双向切换。
  await page.evaluate(()=>{Hub.state.detail=false;window.render();});await page.locator('.r22-home-dock [data-act="more"]').click();await page.locator(entry).click();await page.locator('[data-hub-mode="real"]').click();await page.waitForFunction(()=>HubReal.state().mode==='real');
  await page.waitForFunction(()=>document.querySelector('.hub-real-title')?.textContent.startsWith('共享交付物确认'));await page.waitForSelector('[data-real-phrase]:visible');await page.locator('[data-real-phrase]').first().click();await page.waitForFunction(()=>HubReal.state().jobs.length===0&&[...document.querySelectorAll('.hub-real-text')].some(el=>el.textContent.includes('假模型离线回复')));
  check('真实模式演示摘要和伪引用不可见，真实短语可见',!(await page.locator('.m-persona-today').isVisible())&&await page.locator('[data-real-phrase]:visible').count()===3&&await page.locator('.r22-tool-call:not(.hub-real-tool-trace):visible').count()===0);
  if(modern)check('新壳六助理均用false关闭演示，不残留旧版隐藏清单',await page.evaluate(()=>document.querySelector('.chatview').dataset.demo==='off'&&['chief','support','content','pm','art','research'].every(bot=>__c6Hooks.some(h=>h.name==='setDemoContent'&&h.args[0]===bot&&h.args[1]===false))&&![...document.querySelectorAll('style')].some(s=>s.textContent.includes(':is(.m-persona-today,.r22-tool-call:not(.hub-real-tool-trace)'))));
  await snap('04-真实内容与短语');
  await fixture({type:'session',id:'support-latest',unread:2});await page.waitForFunction(()=>Hub.state.bots.find(b=>b.id==='support').unread===2);
  check('事件更新未读后真实最近仍在且角落为红点',await page.locator('.hub-real-recents [data-real-open]').count()===await page.evaluate(()=>HubReal.state().sessions.length)&&await page.locator('[data-bot-tree="support"] .r22-unread-dot').count()===1);
  await fixture({type:'session',id:'support-latest',unread:0});await page.waitForFunction(()=>Hub.state.bots.find(b=>b.id==='support').unread===0);
  check('未读归零不恢复演示分助理计数',await page.locator('[data-bot-tree="support"] .home-child-count').evaluate(el=>getComputedStyle(el).display==='none'&&el.textContent===''));
  check('旧壳对象探测最多一次，新壳只传合法三字段',await page.evaluate(modern=>{const calls=__c6Hooks.filter(h=>h.name==='setBotStatus');return modern?calls.length>0&&calls.every(h=>typeof h.args[1].running==='boolean'&&['unread','pending'].every(k=>Number.isInteger(h.args[1][k])&&h.args[1][k]>=0)):calls.length===1;},modern));
  check('页面无脚本错误',errors.length===0);check('无外网请求',blocked.length===0);
  console.log('C6 钩子专项：'+checks.length+'项通过');
 }finally{fs.writeFileSync(path.join(out,prefix+'results.json'),JSON.stringify({engine,modern,checks,errors,blocked,browserVersion:browser.version()},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
