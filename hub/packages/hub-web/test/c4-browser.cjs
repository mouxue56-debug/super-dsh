// C4 专项：只访问3592假环境，使用本机已有浏览器，不下载。
const playwright=require(process.env.PLAYWRIGHT_CORE||require('os').homedir()+'/node_modules/playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const engine=process.env.HUB_R24_BROWSER||'chromium',base='http://127.0.0.1:3592';
const out=process.env.HUB_R24_SHOTS||path.resolve('shots'),prefix=process.env.HUB_R24_PREFIX||'c4-'+engine+'-';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const executablePath=engine==='webkit'?process.env.WEBKIT:require('os').homedir()+'/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
 const browser=await playwright[engine].launch({headless:true,executablePath,timeout:15000});
 const checks=[],errors=[],requests=[];let page;
 const check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('通过：'+name);};
 try {
  page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  page.on('pageerror',e=>{errors.push(e.message);console.error('页面脚本错误：'+e.stack);});
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.protocol==='data:'||(u.protocol==='blob:'&&u.origin===base))return route.continue();if(u.hostname!=='127.0.0.1')return route.abort();requests.push(u.pathname);return route.continue();});
  const fixture=async b=>assert.equal(await page.evaluate(async b=>(await fetch('/bff/__fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})).status,b),200);
  const open=async id=>{await page.reload();await page.waitForFunction(id=>HubReal.state().sessions.some(s=>s.id===id),id);await page.evaluate(()=>{Hub.state.view='chat';Hub.state.detail=false;window.render();});const ready=page.waitForResponse(r=>r.url().endsWith('/sessions/'+id+'/read')&&r.request().method()==='POST');await page.locator('[data-real-open="'+id+'"]').click();await ready;await page.waitForFunction(()=>document.querySelector('.hub-real-title')?.textContent.startsWith('C4'));};
  const rows=()=>page.locator('.thread-inner > [data-message-id]').evaluateAll(els=>els.flatMap(el=>el.hidden?[]:el.querySelector('[data-real-tool]')?[...el.querySelectorAll('[data-real-tool]')].map(t=>'工具:'+t.dataset.realTool):el.querySelector('[data-real-card]')?['卡:'+el.querySelector('[data-real-card]').dataset.realCard]:[(el.querySelector('.hub-real-text,.user-bubble')?.textContent||'').trim()]));
  const snap=async(name,selector)=>{if(selector)await page.locator(selector).evaluate(el=>{const details=el.closest('details');if(details)details.open=true;el.scrollIntoView({block:'center'});});await page.waitForTimeout(180);await page.screenshot({path:path.join(out,prefix+name+'.png')});};
  await page.goto(base+'/?key=r24-offline-web');await page.waitForFunction(()=>window.HubReal?.state().sessions.length>=7);
  const tool=(id,name,p,status,seq,extra={})=>({id,name,path:p,status,seq,...extra});
  const tools=[tool('c4-read','read','/Users/example/dsh-work/bots/chief/AGENTS.md','ok',2),tool('c4-own','write','/Users/example/dsh-work/bots/chief/notes/r24-l1.md','ok',3,{level:'L1'}),tool('c4-share','write','/Users/example/dsh-work/shared/交付物.md','pending',4,{level:'L3',approvalId:'c4-first'})];
  const messages=[{role:'user',text:'请整理草稿，写入前让我确认。',seq:1},...tools.map(t=>({role:'assistant',text:'',seq:t.seq,tools:[t]})),{role:'assistant',text:'这一步没有写入。',seq:6},{role:'user',text:'改好之后再给我看。',seq:7},{role:'assistant',text:'新稿已准备，等你点头。',seq:8},{role:'assistant',text:'我会保留草稿并等待。',seq:11},{role:'assistant',text:'  ',seq:12}];
  const card=(id,seq,status)=>({id,type:'approval',bot:'chief',sessionId:'chief-c4',seq,createdAt:new Date(Date.now()+(20-seq)*1000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),status,action:'写共享区',path:'/Users/example/dsh-work/shared/交付物.md',level:'L3',tool:'write',preview:'仅本地假数据，审批前不写入。',chars:18});
  const first=card('c4-first',5,'pending'),second=card('c4-second',9,'pending');
  const delegation={id:'c4-delegation',type:'delegation',bot:'pm',sessionId:'chief-c4',seq:10,createdAt:new Date().toISOString(),status:'done',task:'核对草稿',steps:[],summary:'已核对',toSession:'pm-work'};
  await fixture({type:'timeline',id:'chief-c4',messages,cards:[second,delegation,first]});await open('chief-c4');await page.waitForSelector('[data-real-tool="c4-share"]',{state:'attached'});
  const expected=['请整理草稿，写入前让我确认。','工具:c4-read','工具:c4-own','工具:c4-share','卡:c4-first','这一步没有写入。','改好之后再给我看。','新稿已准备，等你点头。','卡:c4-second','卡:c4-delegation','我会保留草稿并等待。'];
  check('缺 ts 的历史按统一 seq 穿插消息、工具、两张审批卡和派工卡',JSON.stringify(await rows())===JSON.stringify(expected));
  check('三条工具步骤合并为轻量工具条，不含气泡、名牌或可见操作栏',await page.locator('.hub-real-tool-message').count()===3&&await page.locator('.hub-real-tool-message .bubble,.hub-real-tool-message .r22-nameplate').count()===0&&await page.locator('.hub-real-tool-message .message-footer:visible').count()===0);
  check('无正文及纯空白 assistant 不画空气泡',await page.locator('.hub-real-reply').count()===3&&await page.locator('.hub-real-text').evaluateAll(els=>els.every(el=>el.textContent.trim())));
  check('工具摘要明确读文件、L1 已记录和等待审批',(await page.locator('[data-real-tool="c4-read"]').textContent()).includes('读了 AGENTS.md')&&(await page.locator('[data-real-tool="c4-own"]').textContent()).includes('notes/r24-l1.md · L1 已记录')&&(await page.locator('[data-real-tool="c4-share"]').textContent()).includes('等你点头'));
  await snap('01-三条工具与审批前消息','[data-real-tool="c4-own"]');
  await page.locator('[data-real-approval="c4-first"][data-real-answer="reject"]').click();await page.waitForSelector('[data-real-card="c4-first"][data-real-card-status="rejected"]');
  check('被拒状态同步到工具痕迹且未声称写入完成',(await page.locator('[data-real-tool="c4-share"]').textContent()).includes('被拒')&&!(await page.locator('[data-real-tool="c4-share"]').textContent()).includes('已完成'));
  check('拒绝卡与下一张卡之间保持助理回复、主人 追问、助理回复',JSON.stringify(await rows())===JSON.stringify(expected));
  await snap('02-拒绝卡与中间消息','[data-real-card="c4-first"]');await snap('03-追问与下一张审批卡','[data-real-card="c4-second"]');
  await page.locator('[data-real-approval="c4-second"][data-real-answer="approve"]').click();await page.waitForSelector('[data-real-card="c4-second"][data-real-card-status="approved"]');
  check('审批终态更新保持原时间轴位置',JSON.stringify(await rows())===JSON.stringify(expected));
  await open('chief-c4');await page.waitForSelector('[data-real-card="c4-first"][data-real-card-status="rejected"]');check('整页重载后位置和工具结果保持一致',JSON.stringify(await rows())===JSON.stringify(expected)&&(await page.locator('[data-real-tool="c4-share"]').textContent()).includes('被拒'));
  // 独立流式回合，三个无正文工具步骤、重复事件、多个 assistant 文本与一张审批卡。
  const liveId='chief-c4-live',liveTools=tools.map((t,i)=>({...t,id:'live-'+i,approvalId:i===2?'c4-live-card':undefined}));
  const liveCard={...card('c4-live-card',5,'pending'),sessionId:liveId};
  const final=[{role:'user',text:'执行本地假步骤',seq:1},...liveTools.map(t=>({role:'assistant',text:'',seq:t.seq,tools:[t]})),{role:'assistant',text:'工具步骤已结束，等待共享审批。',seq:6},{role:'assistant',text:'本轮没有写共享区。',seq:7}];
  const events=[...liveTools.flatMap(t=>[{type:'message',data:{role:'assistant',text:'',seq:t.seq,tools:[t]}},{type:'tool',data:t}]),{type:'barrier'},{type:'card',data:liveCard},{type:'message',data:{role:'assistant',id:'live-message-6',text:final[4].text,seq:6}},{type:'delta',data:{text:final[5].text}},{type:'message',data:{role:'assistant',id:'live-message-7',text:final[5].text,seq:7}}];
  await fixture({type:'timeline',id:liveId,messages:[],finalMessages:final,events});await open(liveId);
  await page.evaluate(()=>HubReal.sendText('chief','执行本地假步骤'));await page.waitForSelector('[data-real-tool="live-2"]',{state:'attached'});console.log('流式中间态：'+JSON.stringify(await rows()));check('流式工具进行中无正文占位气泡',await page.locator('.hub-real-reply').count()===0);check('流式本地追问保持在工具之前',(await rows())[0]==='执行本地假步骤');await snap('04a-工具中间态无空气泡','[data-real-tool="live-1"]');await fixture({type:'release',id:liveId});await page.waitForFunction(()=>HubReal.state().jobs.length===0);await page.waitForSelector('[data-real-tool="live-2"]',{state:'attached'});
  const liveExpected=['执行本地假步骤','工具:live-0','工具:live-1','工具:live-2','卡:c4-live-card',final[4].text,final[5].text];
  check('流式三个工具步骤及重复事件最终各留一行',await page.locator('[data-real-tool]').count()===3&&JSON.stringify(await rows())===JSON.stringify(liveExpected));
  check('流式多个 assistant 步骤保留两条正文且没有完成空气泡',await page.locator('.hub-real-reply').count()===2&&await page.locator('.hub-real-text').evaluateAll(els=>els.every(el=>el.textContent.trim())));
  await snap('04-流式工具与审批','[data-real-tool="live-1"]');await snap('05-流式审批与后续消息','[data-real-card="c4-live-card"]');
  await fixture({id:'c4-live-card',status:'approved'});await page.waitForFunction(()=>document.querySelector('[data-real-tool="live-2"]')?.textContent.includes('已批准'));
  check('批准仅显示已批准，不冒充执行成功',!(await page.locator('[data-real-tool="live-2"]').textContent()).includes('已完成'));
  const denied={...liveTools[2],status:'denied',approvalId:undefined,brief:'这件事我做不了：路径或工具不在本轮授权范围'};
  await fixture({type:'timeline',id:'chief-c4-denied',messages:[{role:'assistant',text:'',seq:4,tools:[denied]}]});await open('chief-c4-denied');await page.waitForSelector('[data-real-tool="live-2"]',{state:'attached'});
  check('L4 如实显示拒绝原因且不出现空回复',(await page.locator('[data-real-tool="live-2"]').textContent()).includes('被拒：这件事我做不了：路径或工具不在本轮授权范围')&&await page.locator('.hub-real-reply').count()===0);
  await snap('06-L4拒绝痕迹','[data-real-tool="live-2"]');
  check('专项回归页面无脚本错误',errors.length===0);
  console.log('C4 专项回归：'+checks.length+' 项通过');
 } finally {
  fs.writeFileSync(path.join(out,prefix+'timeline-results.json'),JSON.stringify({engine,browserVersion:browser.version(),checks,errors,requests},null,2));await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
