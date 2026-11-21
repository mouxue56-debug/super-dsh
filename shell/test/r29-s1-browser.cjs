/* 对话页五项的手机视口检查。浏览器与端口只走环境变量或本机已有安装。 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const pageFile=path.join(root,'dist-generic','DSH-Hub.html');
const shots=path.resolve(__dirname,'..','..','shots');
const port=3631;

function firstExisting(list){
  for(const item of list){
    if(item&&fs.existsSync(item)) return item;
  }
  return '';
}
const playwrightPath=process.env.PLAYWRIGHT_CORE||firstExisting([
  path.join(os.homedir(),'node_modules/playwright-core'),
  path.join(os.homedir(),'node_modules/playwright-core'),
]);
const chromiumPath=process.env.CHROMIUM||firstExisting([
  path.join(os.homedir(),'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64',
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  path.join(os.homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1243',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]);
assert(fs.existsSync(pageFile),'先运行 python3 build.py --demo generic');
assert(playwrightPath&&chromiumPath,'缺少已安装的浏览器或 playwright-core');
const playwright=require(playwrightPath);
const png=Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

function serve(dir){
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1:'+port);
    let rel=decodeURIComponent(url.pathname);
    if(rel==='/') rel='/DSH-Hub.html';
    const file=path.resolve(dir,'.'+rel);
    if(!file.startsWith(dir)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(err,buf)=>{
      if(err){res.writeHead(404);res.end('missing');return;}
      const types={
        '.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css',
        '.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp',
        '.gif':'image/gif','.svg':'image/svg+xml','.json':'application/json',
      };
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
      res.end(buf);
    });
  });
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>resolve(server));
  });
}

(async()=>{
  fs.mkdirSync(shots,{recursive:true});
  const server=await serve(path.join(root,'dist-generic'));
  const browser=await playwright.chromium.launch({executablePath:chromiumPath,headless:true});
  const errors=[];
  const checks=[];
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
    page.on('pageerror',err=>errors.push(String(err)));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      const local=url.protocol==='data:'||url.protocol==='blob:';
      const here=url.hostname==='127.0.0.1'&&url.port===String(port);
      return local||here?route.continue():route.abort();
    });
    const check=(label,value)=>{
      assert.ok(value,label);
      checks.push(label);
      console.log('通过：'+label);
    };
    const shown=async selector=>{
      const loc=page.locator(selector);
      if(await loc.count()===0) return false;
      return loc.first().evaluate(el=>{
        const style=getComputedStyle(el);
        const box=el.getBoundingClientRect();
        if(el.hidden||el.hasAttribute('hidden')) return false;
        if(style.display==='none'||style.visibility==='hidden') return false;
        if(Number(style.opacity)===0) return false;
        return box.width>0&&box.height>0;
      });
    };
    await page.goto('http://127.0.0.1:'+port+'/DSH-Hub.html');
    await page.waitForFunction(()=>window.Hub&&window.state&&state.bots&&state.bots.length);
    await page.evaluate(()=>{
      const bot=state.bots[0];
      state.detail=true;
      state.drawer=null;
      Hub.navigate({view:'chat',bot:bot.id});
      state.detail=true;
      render();
    });
    await page.waitForSelector('.chatview [data-r29-plus]');
    await page.screenshot({path:path.join(shots,'01-chat.png')});

    check('顶栏有返回',await shown('.chat-header .backbtn'));
    check('顶栏有头像',await shown('.chat-header .r29-avatar'));
    check('顶栏有名字',await shown('.chat-header .r22-nameplate'));
    check('顶栏有设置',await shown('.chat-header [data-r29-settings]'));
    check('用量圆环不可见',!(await shown('.chat-header .ledger-shortcut')));
    check('记忆挂载数不可见',!(await shown('.chat-header [data-memory-mount]')));
    const headerText=await page.locator('.chat-header').innerText();
    check('默认不显示已连接',!headerText.includes('已连接'));
    check('默认不显示回看板',!(await shown('.shell-board-return')));
    await page.evaluate(()=>{
      state.boardReturn={conversation:state.conversation};
      render();
    });
    check('从看板进来才显示回看板',await shown('.shell-board-return'));
    await page.evaluate(()=>{state.boardReturn=null;render();});
    check('离开看板来源后回看板消失',!(await shown('.shell-board-return')));
    await page.evaluate(()=>{
      window.__r29settings=0;
      document.addEventListener('r29-settings',()=>{window.__r29settings++;});
      const meta=document.querySelector('.chat-header .shell-title-meta');
      const node=document.createElement('span');
      node.className='hub-real-health';
      node.textContent='已连接';
      meta.appendChild(node);
    });
    await page.waitForTimeout(30);
    const connected=await page.locator('.chat-header').innerText();
    check('适配器写已连接时仍不显示',!connected.includes('已连接'));
    await page.evaluate(()=>{
      document.querySelector('.chat-header .hub-real-health').textContent='未连接';
    });
    await page.waitForFunction(()=>{
      const el=document.querySelector('[data-r29-offline]');
      return el&&!el.hidden&&!el.hasAttribute('hidden');
    });
    check('断线才提示未连接',await shown('[data-r29-offline]'));
    await page.locator('.chat-header [data-r29-settings]').click();
    await page.waitForSelector('[data-r29-settings-page]');
    const settingsHit=await page.evaluate(()=>{
      const title=document.querySelector('.drawer h2');
      return {
        n:window.__r29settings,
        page:!!document.querySelector('[data-r29-settings-page]'),
        title:title?title.textContent:''
      };
    });
    check('设置发出事件并打开设置页',settingsHit.n>=1&&settingsHit.page&&/的设置$/.test(settingsHit.title));
    await page.locator('.drawer [data-act="close"]').click();
    await page.waitForFunction(()=>!state.drawer);

    check('有加号',await shown('[data-r29-plus]'));
    check('有输入框',await shown('[data-focus="composer"]'));
    check('空输入是麦克风',await shown('.composer-area [data-r29-mic]'));
    check('只有一个动作按钮',await page.locator('.r22-input-row .voicebtn').count()===1);
    check('没有第二个语音键',await page.locator('.composer-area .micbtn').count()===0);
    const micAct=await page.locator('.composer-area .voicebtn').getAttribute('data-act');
    check('麦克风不占用语音动作',micAct!=='voice');
    const slot=await page.locator('[data-r29-voice-slot]').evaluate(el=>{
      return el.childElementCount===0&&!el.textContent.trim();
    });
    check('语音槽存在且为空',slot);
    check('快捷话条不可见',!(await shown('.hub-quick'))&&!(await shown('.chat-quick-slot')));
    check('上下文占用不可见',!(await shown('[data-context-mix]')));
    check('大形象站台还在',await page.locator('.r22-pet-platform').count()===1);
    await page.locator('[data-focus="composer"]').fill('你好');
    await page.waitForFunction(()=>document.querySelector('.composer-area .voicebtn')?.dataset.act==='send');
    check('有字变成发送',await shown('.composer-area [data-act="send"]'));
    await page.locator('[data-focus="composer"]').fill('');
    await page.waitForFunction(()=>document.querySelector('.composer-area [data-r29-mic]'));
    check('删光字回到麦克风',await shown('.composer-area [data-r29-mic]'));
    const beforeBot=await page.evaluate(()=>state.bot);
    const box=await page.locator('.r22-pet-figure').boundingBox();
    if(box){
      const x=Math.max(24,box.x+box.width/2);
      const y=Math.min(box.y+box.height/2,800);
      await page.mouse.move(x,y);
      await page.mouse.down();
      await page.mouse.move(Math.max(24,x-90),y,{steps:6});
      await page.mouse.up();
    }
    const afterBot=await page.evaluate(()=>state.bot);
    check('左右滑不再换助理',beforeBot===afterBot);

    await page.locator('[data-r29-plus]').click();
    await page.waitForSelector('[data-r29-plus-panel]');
    await page.screenshot({path:path.join(shots,'02-plus.png')});
    const picks=await page.locator('[data-r29-plus-panel] button').allTextContents();
    check('加号可传图片、传文件和新开话题',picks.join('|')==='传图片|传文件|新开话题');
    const accept=await page.locator('[data-r29-file="image"]').getAttribute('accept');
    check('图片选择器只收图片',accept==='image/*');
    const fileAccept=await page.locator('[data-r29-file="any"]').getAttribute('accept');
    check('文件选择器不限制类型',!fileAccept);
    await page.locator('[data-r29-file="image"]').setInputFiles({
      name:'note.png',mimeType:'image/png',buffer:png,
    });
    await page.waitForSelector('[data-r29-previews]');
    check('选完出现可移除预览',await shown('[data-r29-previews] [data-act="remove-attach"]'));
    check('有附件时变发送',await shown('.composer-area [data-act="send"]'));
    await page.screenshot({path:path.join(shots,'03-preview.png')});
    await page.evaluate(()=>{
      window.__uploads=0;
      window.HubUpload=async function(){window.__uploads++;return {ok:false};};
    });
    await page.locator('[data-focus="composer"]').fill('文字先走');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-r29-retry-upload]');
    const failed=await page.locator('[data-r29-retry-upload]').innerText();
    check('失败项显示重试',failed==='没传上去，点这里重试');
    const posted=await page.locator('.thread').innerText();
    check('上传失败不挡住文字',posted.includes('文字先走'));
    await page.locator('[data-r29-retry-upload]').click();
    await page.waitForFunction(()=>window.__uploads>=2);
    check('点重试会再上传',await page.evaluate(()=>window.__uploads>=2));
    await page.evaluate(()=>{
      delete window.HubUpload;
      clearTimeout(runTimer);
      state.running=false;
      render();
    });
    await page.locator('[data-act="remove-attach"]').click();
    await page.locator('[data-r29-plus]').click();
    await page.locator('[data-r29-file="any"]').setInputFiles({
      name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('hi'),
    });
    await page.locator('[data-focus="composer"]').fill('演示回退');
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.thread')?.innerText.includes('演示回退'));
    const fallback=await page.locator('.chatview').innerText();
    check('没有上传钩子时仍能发出',fallback.includes('演示回退')&&!fallback.includes('没传上去，点这里重试'));

    const menuShown=await shown('.composer-area [data-act="session-menu"]');
    check('会话菜单按钮不可见',!menuShown);
    await page.locator('[data-r29-plus]').click();
    const menuText=await page.locator('.chatview').innerText();
    check('加号面板不是会话菜单',!menuText.includes('会话菜单'));
    const drawer=await page.evaluate(()=>state.drawer);
    check('对话页点击没有打开会话菜单',drawer!=='session-menu');
    await page.keyboard.press('Escape');

    await page.evaluate(()=>{
      clearTimeout(runTimer);
      state.running=true;
      state.queue=[];
      state.input='';
      state.attachments=[];
      render();
    });
    check('生成中按钮是停止',await shown('.composer-area [data-act="stop"]'));
    await page.locator('[data-focus="composer"]').fill('下一条');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-r29-queue]');
    const queueText=await page.locator('[data-r29-queue]').innerText();
    check('忙时显示排队中 1 条',queueText.includes('排队中 1 条'));
    await page.screenshot({path:path.join(shots,'04-queue.png')});
    const choice=await page.locator('.chatview').innerText();
    check('不再让人选排队还是插话',!choice.includes('插话'));
    await page.locator('[data-r29-cancel-queue]').click();
    check('排队可以取消',await page.locator('[data-r29-queue]').count()===0);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
    check('手机宽度没有横向溢出',overflow);
    check('页面没有脚本异常',errors.length===0);
    fs.writeFileSync(path.join(shots,'r29-s1-results.json'),JSON.stringify({
      checks,errors,browser:browser.version(),viewport:[390,844],
    },null,2));
    console.log('对话页浏览器检查 '+checks.length+' 项通过');
  }finally{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(err=>{console.error(err);process.exitCode=1;});
