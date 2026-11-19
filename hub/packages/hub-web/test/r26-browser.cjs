// 工单 C：仅连接指定的 3591/3592 假环境；使用已安装的浏览器，不连接内核。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const base=process.env.HUB_R26_URL,shots=process.env.HUB_R26_SHOTS;
assert(base && shots && process.env.PLAYWRIGHT_CORE && process.env.CHROMIUM,'请配置假环境、截图目录与已有浏览器路径');
const allowed=new URL(base);assert.equal(allowed.hostname,'127.0.0.1');assert.equal(allowed.port,'3592');
const playwright=require(process.env.PLAYWRIGHT_CORE);
(async()=>{
 fs.mkdirSync(shots,{recursive:true});
 const browser=await playwright.chromium.launch({executablePath:process.env.CHROMIUM,headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1100,height:1050},deviceScaleFactor:1});
 const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=new URL(r.request().url());return u.protocol==='data:' || u.protocol==='blob:' || u.hostname==='127.0.0.1'&&['3591','3592'].includes(u.port)?r.continue():r.abort();});
 const check=(label,value)=>{assert(value,label);checks.push(label);console.log('通过：'+label);};
 const fixture=b=>page.evaluate(async b=>{const r=await fetch('/bff/__fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!r.ok)throw Error('假数据失败');},b);
 await page.goto(base+'/?key=r24-offline-web');await page.waitForFunction(()=>window.HubReal?.state().sessions.length===7);
 const home=await page.evaluate(()=>fetch('/bff/status').then(r=>r.json()).then(s=>s.hubHome));
 const command="printf '%s' 'hello command approval'",now=Date.now();
 const card={id:'r26-command',type:'approval',bot:'chief',sessionId:'chief-latest',callId:'r26-call',tool:'bash',path:home+'/bots/chief',cwd:home+'/bots/chief',command,why:'核对本地草稿输出',chars:command.length,preview:command,timeoutMs:120000,caps:{network:true,writeRoots:[home+'/shared/drafts'],longRunning:true},grantable:true,grantKey:{program:'printf',dir:home+'/bots/chief'},status:'pending',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};
 await fixture({type:'timeline',id:'chief-latest',messages:[],cards:[card]});
 await page.reload();await page.waitForFunction(()=>window.HubReal?.state().sessions.length===7);await page.evaluate(()=>{Hub.state.view='chat';Hub.state.detail=false;Hub.state.drawer=null;window.render();});await page.locator('[data-real-open="chief-latest"]').first().click();await page.waitForSelector('[data-real-card="r26-command"]');
 const root=page.locator('[data-real-card="r26-command"]');await root.scrollIntoViewIfNeeded();
 check('命令全文与所有按钮可见',await root.locator('[data-real-command]').innerText()===command && await root.locator('button').allTextContents().then(v=>['批准','拒绝','改一下','以后这类不用问'].every(x=>v.includes(x))));
 check('目录短写、原因、需要的权限与时限',await root.innerText().then(t=>t.includes('bots/chief')&&!t.includes(home)&&['核对本地草稿输出','联网','shared/drafts','会跑很久','最长跑 2 分钟'].every(x=>t.includes(x))));
 check('命令卡不用内部术语',!/(?:L1|L3|caps|grant)/.test(await root.innerText()));
 await page.screenshot({path:path.join(shots,'c-command-card.png')});
 let dialogText='';page.once('dialog',async d=>{dialogText=d.message();await d.dismiss();});
 await root.locator('[data-real-answer="remember"]').click();
 check('取消二次确认不写规则',await page.evaluate(()=>fetch('/bff/grants').then(r=>r.json()).then(v=>v.grants.length===0)));
 check('确认说明助理、程序、目录和东京到期日',dialogText.includes('首席助理')&&dialogText.includes('bots/chief')&&dialogText.includes('printf')&&dialogText.includes('到 ')&&dialogText.includes(' 日为止。确定？'));
 page.once('dialog',d=>d.accept());await root.locator('[data-real-answer="remember"]').click();await page.waitForFunction(()=>document.querySelector('[data-real-card="r26-command"]')?.dataset.realCardStatus==='approved');
 check('批准请求带 remember:true',await page.evaluate(()=>fetch('/bff/__stats').then(r=>r.json()).then(s=>s.answers.some(a=>a.remember===true&&a.decision==='approve'))));
 // 从壳公开「更多」接口注册的真实入口进入。
 await page.evaluate(()=>{Hub.state.view='chat';Hub.state.detail=false;window.render();});await page.locator('[data-act="more"]:visible').first().click();await page.getByRole('button',{name:'权限',exact:true}).click();
 await page.waitForSelector('[data-real-permission]');
 check('权限页显示程序、目录、到期日、有效状态及撤销',await page.locator('[data-real-permission]').innerText().then(t=>['首席助理','printf','bots/chief','到 ','有效','撤销'].every(x=>t.includes(x))));
 await page.screenshot({path:path.join(shots,'c-permissions.png')});
 page.once('dialog',d=>d.dismiss());await page.locator('[data-real-revoke]').click();check('取消撤销保留规则',await page.locator('[data-real-revoke]').count()===1);
 page.once('dialog',d=>d.accept());await page.locator('[data-real-revoke]').click();await page.waitForFunction(()=>document.querySelector('[data-real-permission]')?.textContent.includes('已撤销'));
 check('撤销后隐藏撤销按钮',await page.locator('[data-real-revoke]').count()===0);
 await page.screenshot({path:path.join(shots,'c-permissions-revoked.png')});
 const output='😀'.repeat(1500);
 await fixture({type:'timeline',id:'chief-latest',messages:[{role:'assistant',text:'',tools:[{id:'cmd-ok',name:'bash',command,status:'ok',output,outputTruncated:true,outputPath:'bots/chief/outputs/cmd-example.txt'}]},{role:'assistant',text:'间隔正文'},{role:'assistant',text:'',tools:[{id:'cmd-deny',name:'bash',command:'denied example',status:'denied',brief:'这件事我做不了：路径不在可读范围'}]}]});
 await page.reload();await page.waitForFunction(()=>window.HubReal?.state().sessions.length===7);await page.evaluate(()=>{Hub.state.view='chat';Hub.state.detail=false;Hub.state.drawer=null;window.render();});await page.locator('[data-real-open="chief-latest"]').first().click();await page.waitForSelector('[data-real-tool-group="cmd-ok"]');
 check('命令痕迹使用虚线工具条和人话',await page.locator('[data-real-tool-group="cmd-ok"] summary').innerText().then(t=>t.includes('跑了命令：')));
 await page.locator('[data-real-tool-group="cmd-ok"] summary').click();
 const out=await page.locator('[data-real-tool-output]').innerText();check('展开完整命令，输出最多4KB并指出全文路径',await page.locator('[data-real-tool-command]').first().innerText()===command&&Buffer.byteLength(out)<=4096&&await page.locator('[data-real-tool-group="cmd-ok"]').innerText().then(t=>t.includes('全文在 bots/chief/outputs/cmd-example.txt')));
 check('拒绝痕迹明确没跑',await page.locator('[data-real-tool-group="cmd-deny"]').innerText().then(t=>t.includes('这条命令没跑：')));
 await page.locator('[data-real-tool-group="cmd-ok"]').screenshot({path:path.join(shots,'c-command-traces.png')});
 // 长命令不得裁字；手机上横向滚动只发生在命令块。
 const longCommand='printf '+ 'x'.repeat(1500);await fixture({...card,id:'r26-long',command:longCommand,preview:longCommand.slice(0,200),grantable:false,grantKey:undefined,caps:{network:false,writeRoots:[],longRunning:false},timeoutMs:60000});
 await page.setViewportSize({width:390,height:844});await page.waitForSelector('[data-real-card="r26-long"]');
 const longRoot=page.locator('[data-real-card="r26-long"]');await longRoot.scrollIntoViewIfNeeded();
 check('长命令完整保留且块内可横向滚动',await longRoot.locator('[data-real-command]').evaluate((el,expected)=>el.textContent===expected&&el.scrollWidth>el.clientWidth&&getComputedStyle(el).overflowX==='auto',longCommand));
 check('不可放行的卡无以后不用问，不需要的权限行不显示',await longRoot.locator('[data-real-answer="remember"]').count()===0&&!/需要的权限|最长跑多久/.test(await longRoot.innerText()));
 check('手机页面没有横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.screenshot({path:path.join(shots,'c-command-mobile.png')});
 check('浏览器无脚本异常',errors.length===0);
 fs.writeFileSync(path.join(shots,'c-browser-results.json'),JSON.stringify({checks,errors,browser:browser.version()},null,2));console.log('r26 浏览器回归 '+checks.length+' 项通过');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
