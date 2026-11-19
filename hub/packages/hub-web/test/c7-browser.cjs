// C7：仅连接3592假环境，复用已装引擎；保留所有脚本错误，拒绝全部外网请求。
const playwright=require(process.env.PLAYWRIGHT_CORE||require('os').homedir()+'/node_modules/playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const engine=process.env.HUB_R24_BROWSER||'chromium',base='http://127.0.0.1:3592',prefix=process.env.HUB_R24_PREFIX||'c7-'+engine+'-';
const out=process.env.HUB_R24_SHOTS||path.resolve('shots');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await playwright[engine].launch({headless:true,executablePath:engine==='webkit'?process.env.WEBKIT:require('os').homedir()+'/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
 const checks=[],errors=[],blocked=[],posts=[];let sendFault=null;
 const check=(label,ok)=>{assert(ok,label);checks.push(label);console.log('通过：'+label);};
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.protocol==='data:'||(url.protocol==='blob:'&&url.origin===base))return route.continue();
   if(url.origin!==base){blocked.push(url.origin);return route.abort();}
   if(request.method()==='POST'&&url.pathname.endsWith('/messages')){
    posts.push({path:url.pathname,...JSON.parse(request.postData())});
    if(sendFault){const fault=sendFault;sendFault=null;
     if(fault==='network')return route.abort('failed');
     if(fault==='unknown'){await route.fetch();return route.fulfill({status:202,contentType:'application/json',body:'{}'});}
     return route.fulfill({status:Number(fault),contentType:'application/json',body:'{"error":{"code":"offline"}}'});
    }
   }
   return route.continue();
  });
  const fixture=async b=>assert.equal(await page.evaluate(async b=>(await fetch('/bff/__fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})).status,b),200);
  const snap=async(name,locator)=>{if(locator)await locator.evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(300);await page.screenshot({path:path.join(out,prefix+name+'.png'),animations:'disabled'});};
  const home=()=>page.evaluate(()=>{Hub.state.view='chat';Hub.state.detail=false;window.render();});
  const open=async id=>{await page.waitForFunction(id=>HubReal.state().sessions.some(s=>s.id===id),id);await home();const ready=page.waitForResponse(r=>r.url().endsWith('/sessions/'+id+'/read')&&r.request().method()==='POST');await page.locator('[data-real-open="'+id+'"]').click();await ready;};
  const send=async text=>{await page.locator('[data-focus="composer"]').fill(text);await page.locator('[data-focus="composer"]').press('Enter');};
  const ts=new Date().toISOString(),step=label=>({ts,label}),limited='做了 8 步还没做完，按规矩先停了：已完成 3 件，剩 2 件';
  await page.goto(base+'/?key=r24-offline-web');await page.waitForFunction(()=>HubReal?.state().sessions.length===7);
  const work=['读了 notes/x.md','写了 drafts/x.md','列了 drafts/','在写回复','建了一张工单','被拒：主人 没批准','第7步：tool_use','第8步：end_turn'];
  const card={id:'T-20261117-220001-ab12',type:'delegation',bot:'pm',sessionId:'chief-c7',task:'核对五份草稿并回报',status:'running',toSession:'pm-work',steps:['派出','开始',...work].map(step),createdAt:ts,updatedAt:ts};
  const four={...card,id:'c7-four',task:'四步工作无需折叠',status:'done',steps:['派出','开始',...work.slice(0,4),'完成'].map(step),summary:'## **摘要**\n- [文档](https://example.invalid/a_(b))\n> `已完成`'};
  const normalFailure={...card,id:'c7-normal-failure',status:'failed',reason:'派活已取消',steps:[step('派出')]};
  await fixture({type:'timeline',id:'chief-c7',title:'C7 派工与续做验收',messages:[{role:'user',text:'请核对派工收尾。',ts}],cards:[card,four,normalFailure]});await open('chief-c7');
  const main=page.locator('[data-real-card="'+card.id+'"]'),details=main.locator('[data-real-delegate-steps]');
  check('八个工作步骤默认收起，派出和开始留在外面',await details.count()===1&&(await details.getAttribute('open'))===null&&await details.locator('li:visible').count()===0&&await main.locator(':scope > .hub-real-timeline > li').count()===3);
  check('折叠入口显示实际八步',/共 8 步\s*›/.test(await details.locator('summary').textContent()));await snap('01-时间线收起',main);
  await details.locator('summary').click();check('展开显示全部人话并兜底旧英文枚举',await details.locator('li:visible').count()===8&&(await main.textContent()).includes('读了 notes/x.md')&&!/tool_use|end_turn|running|failed/.test(await main.textContent()));await snap('02-时间线展开',main);
  check('四步不折叠，完成在外层且摘要没有Markdown',await page.locator('[data-real-card="c7-four"] details').count()===0&&(await page.locator('[data-real-card="c7-four"] .hub-real-delegate-summary').textContent())==='摘要 文档 已完成');
  check('普通取消失败卡没有续做入口',await page.locator('[data-real-card="c7-normal-failure"] [data-real-continue]').count()===0);
  await fixture({id:card.id,status:'failed',reason:limited,failureKind:'step-limit'});
  const continueButton=main.locator('[data-real-continue]');await continueButton.waitFor();
  check('步数上限失败显示BFF完整原因且可续做',(await main.locator('.result').textContent())==='失败：'+limited&&(await continueButton.textContent())==='让它接着做剩下的');
  check('卡片更新后展开状态保留',await details.getAttribute('open')!==null);await snap('03-失败卡接着做',main);
  await continueButton.evaluate(button=>{button.click();button.click();});
  await page.waitForFunction(id=>document.querySelector('[data-real-continue="'+id+'"]')?.textContent==='已让它接着做',card.id);
  const stats=await page.evaluate(()=>fetch('/bff/__stats').then(r=>r.json())),next=stats.continuations[0].continuedBy;
  check('双击只派出一次且设备标识由代理注入',stats.continuations.length===1&&/^[a-f0-9]{16}$/.test(stats.continuations[0].device));
  check('原按钮已续做且禁用，SSE和响应不重复新卡',await continueButton.isDisabled()&&await page.locator('[data-real-card="'+next+'"]').count()===1);await snap('04-已让它接着做',main);await snap('05-新派工卡',page.locator('[data-real-card="'+next+'"]'));
  const conflict={...card,id:'T-20261117-220002-cd34',status:'failed',reason:limited,failureKind:'step-limit',steps:[step('派出')]};
  await fixture(conflict);await fixture({type:'continue-conflict',id:conflict.id});const conflictCard=page.locator('[data-real-card="'+conflict.id+'"]');await conflictCard.locator('[data-real-continue]').click();
  await page.waitForFunction(id=>document.querySelector('[data-real-continue="'+id+'"]')?.textContent==='已经续过一次了',conflict.id);
  check('409明确显示已经续过一次且不能再点击',await conflictCard.locator('[data-real-continue]').isDisabled());await snap('06-已经续过一次',conflictCard);
  // 停止终态同时覆盖流事件、重开历史、首页最近；一般错误不冒充停止。
  await fixture({type:'timeline',id:'chief-c7-stop',title:'C7 已停止回合',messages:[],events:[{type:'delta',data:{text:'我先核对这一部分。'}},{type:'done',data:{reason:'cancelled'}}]});await open('chief-c7-stop');await send('停止夹具');
  await page.waitForFunction(()=>HubReal.state().jobs.length===0&&[...document.querySelectorAll('.hub-real-status')].some(el=>el.textContent==='已停止'));
  check('远端取消回合显示已停止而非出错',await page.locator('.hub-real-status').filter({hasText:'已停止'}).count()===1&&!(await page.locator('.thread-inner').textContent()).includes('出错了'));await snap('07-会话已停止',page.locator('.hub-real-status').filter({hasText:'已停止'}));
  await page.waitForFunction(()=>HubReal.state().sessions.some(s=>s.id==='chief-c7-stop'&&s.lastText==='已停止'));await home();const stoppedRow=page.locator('.hub-real-recents [data-real-open="chief-c7-stop"]');
  check('首页最近显示已停止',(await stoppedRow.locator('.preview').textContent())==='已停止');await snap('08-首页已停止',stoppedRow);await open('chief-c7-stop');
  check('重开服务器历史仍恢复已停止',await page.locator('.hub-real-status').filter({hasText:'已停止'}).count()===1);await snap('09-重开仍已停止',page.locator('.hub-real-status').filter({hasText:'已停止'}));
  // 用户主动停止也走真实按钮与假cancel接口。
  await fixture({type:'timeline',id:'chief-c7-user-stop',title:'C7 主动停止',messages:[],events:[{type:'delta',data:{text:'这是一段正在等待的回复。'}},{type:'barrier',data:{}}]});await open('chief-c7-user-stop');await send('请开始等待');await page.waitForFunction(()=>document.querySelector('.hub-real-text')?.textContent.includes('等待的回复'));
  await page.locator('.composer-area [data-act="stop"]').click();await page.waitForFunction(()=>HubReal.state().jobs.length===0&&[...document.querySelectorAll('.hub-real-status')].some(el=>el.textContent==='已停止'));
  check('主动停止按钮同样显示已停止',await page.locator('.hub-real-status').filter({hasText:'已停止'}).count()===1);await fixture({type:'release',id:'chief-c7-user-stop'});await snap('10-主动停止',page.locator('.hub-real-status').filter({hasText:'已停止'}));
  for(const fault of ['502','503','network','unknown']){
   const id='chief-c7-send-'+fault;await fixture({type:'timeline',id,title:'C7 发送故障 '+fault,messages:[]});await open(id);sendFault=fault;await send('测试发送 '+fault);
   await page.waitForSelector('[data-real-retry]');const status=await page.locator('.hub-real-status').last().textContent();
   check(fault==='unknown'?'已发出但回执缺失提示先重新加载核对':fault+'提示没连上且提供重试',fault==='unknown'?status.includes('没收到发送确认')&&status.includes('先重新加载'):status.includes('没连上服务，这句没发出去')&&!status.includes('可能已经送达'));
   await snap('11-断线-'+fault,page.locator('.hub-real-status').last());
   if(fault==='network'){
    const before=posts.at(-1);await page.locator('[data-real-retry]').click();await page.waitForFunction(()=>HubReal.state().jobs.length===0&&document.querySelector('.hub-real-text')?.textContent.includes('假模型离线回复'));
    check('网络失败重试沿用原idem',posts.at(-1).idem===before.idem);await snap('12-断线重试成功',page.locator('.hub-real-text'));
   }
  }
  check('页面没有脚本错误',errors.length===0);check('浏览器没有访问外网',blocked.length===0);
  console.log('C7 '+engine+'：'+checks.length+'项通过');
 }finally{fs.writeFileSync(path.join(out,prefix+'results.json'),JSON.stringify({engine,browserVersion:browser.version(),checks,errors,blocked,posts,viewport:{width:390,height:844,scale:3}},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
