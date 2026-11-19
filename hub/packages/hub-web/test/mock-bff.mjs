// r24 只用于回环离线回归；不导入内核、不读凭据、不调模型。
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import { pathToFileURL } from 'node:url';
const ids = ['chief','support','content','pm','art','research'];
const names = ['首席助理','客服助理','内容助理','项目经理','艺术总监','调研员'];
export async function startMockBff({ port = 0 } = {}) {
  const initialColors=['yellow','green','blue','orange','pink','purple'];
  let roster=ids.map((id,i)=>({id,name:names[i],role:i===0?'chief':'bot',preset:'hub-'+id,status:'active',avatar:{kind:'role',role:id},nameColor:initialColors[i],duty:names[i]+'的本地职责',notDuty:'职责以外的事',phrases:['整理今天的待办','核对待确认事项','列出下一步'],order:i}));
  let roles=ids;try{roles=Object.keys(JSON.parse(await readFile(new URL('../shell-r23/pets/pack.json',import.meta.url),'utf8')).assistants);}catch{}
  const avatars=new Map(),avatarKinds={roles,shapes:['circle','square','star'],colors:initialColors};
  const rosterBody=()=>({bots:roster,limits:{maxActive:12,nameMax:8},avatarKinds});
  const hubHome=process.env.HUB_HOME || join(homedir(),'dsh-work'),grants=[];
  const streams = new Set(), sessions = [], cards = new Map(), histories = new Map(), idems = new Map(), scenarios = new Map(), finalHistories = new Map();
  const stats = { headers: [], messages: [], answers: [], globalConnections: 0, maxGlobalConnections: 0, continuations: [], patches: [], uploads: [] };
  const barriers = new Map(), continuationConflicts = new Set();
  const base = Date.now(), ts = minutes => new Date(base + minutes * 60000).toISOString();
  const createSession = (id, bot, time, text) => {
    const s = { id, bot, title: text, lastText: text, updatedAt: ts(time), unread: bot === 'pm' ? 1 : 0, running: false };
    sessions.push(s); histories.set(id, [{role:'user', text:'请整理一份本地草稿', ts:ts(time-2)}, {role:'assistant', text:'3. 核对目标\n4. 整理草稿\n\n说明：保留原编号。\n\n5. 等你确认', ts:ts(time-1)}]); return s;
  };
  createSession('chief-old','chief',-30,'较早的首席会话');
  createSession('chief-latest','chief',-1,'共享交付物确认');
  createSession('pm-work','pm',-2,'项目经理的派工回报');
  ids.slice(1).filter(x=>x!=='pm').forEach((bot,i)=>createSession(bot+'-latest',bot,-5-i,names[ids.indexOf(bot)]+'的最近会话'));
  cards.set('approval-1', { id:'approval-1',type:'approval',bot:'chief',sessionId:'chief-latest',callId:'call-1',tool:'write',level:'L3',action:'写共享区',path:join(hubHome,'shared/交付物.md'),chars:138,why:'把确认后的交付内容留给协作助理查阅。',preview:'这是一份待确认的共享交付物。\n审批后才会写入。',status:'pending',createdAt:ts(-0.5),expiresAt:ts(9.5) });
  cards.set('delegation-1', { id:'delegation-1',type:'delegation',bot:'pm',sessionId:'chief-latest',task:'核对项目进度并回报下一步',status:'running',queuePos:0,toSession:'pm-work',steps:[{ts:ts(-3),label:'派出'},{ts:ts(-2),label:'开始'},{ts:ts(-1),label:'第3步：核对交付证据'}],createdAt:ts(-3),updatedAt:ts(-1) });
  function status() {
    const bots = Object.fromEntries(roster.map(b=>b.id).map(bot=>[bot,{running:bot==='pm' && cards.get('delegation-1')?.status==='running',unread:sessions.filter(s=>s.bot===bot).reduce((n,s)=>n+s.unread,0),pending:[...cards.values()].filter(c=>c.type==='approval'&&c.bot===bot&&c.status==='pending').length,delegated:{running:bot==='pm'&&cards.get('delegation-1')?.status==='running',queued:0}}]));
    return {hubHome,commandGrantDays:30,bots,pendingTotal:Object.values(bots).reduce((n,b)=>n+b.pending,0)};
  }
  const frame = (res,type,data) => res.write('event: '+type+'\ndata: '+JSON.stringify(data)+'\n\n');
  const emit = (type,data) => { for(const res of streams) frame(res,type,data); };
  const json = (res,code,data) => {res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  const server = http.createServer(async(req,res)=>{
    try {
      const path = new URL(req.url,'http://127.0.0.1').pathname;
      stats.headers.push({path,device:req.headers['x-hub-device'],idem:req.headers['idempotency-key']});
      if(req.method==='GET' && path==='/bff/health') return json(res,200,{ok:true,dsh:{connected:true}});
      if(req.method==='GET' && path==='/bff/presets') return json(res,200,{bots:roster.map(b=>({...b,bot:b.id}))});
      if(req.method==='GET' && path==='/bff/bots')return json(res,200,rosterBody());
      const avatarGet=/^\/bff\/avatars\/([a-z0-9-]+\.(png|jpg|webp|gif))$/.exec(path);
      if(req.method==='GET' && avatarGet){const image=avatars.get(avatarGet[1]);if(!image)return json(res,404,{});res.writeHead(200,{'content-type':image.type});return res.end(image.bytes);}
      const profile=/^\/bff\/bots\/([a-z][a-z0-9-]+)(\/avatar)?$/.exec(path);
      if(profile && ['PATCH','POST'].includes(req.method)) {
        if(!req.headers['x-hub-device'])return json(res,400,{error:'缺少登录设备'});
        const b=roster.find(b=>b.id===profile[1]);if(!b)return json(res,404,{});
        const chunks=[];let length=0;for await(const c of req){length+=c.length;if(length>2*1024*1024)return json(res,413,{});chunks.push(c);}
        const bytes=Buffer.concat(chunks);
        if(profile[2]) {
          const type=req.headers['content-type'],ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'})[type];
          const valid=ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='jpg'?bytes[0]===255&&bytes[1]===216:ext==='webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':ext==='gif'?/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)):false;
          if(!valid)return json(res,400,{error:'图片类型无效'});
          const file=b.id+'.'+ext;avatars.set(file,{type,bytes});b.avatar={kind:'upload',file,v:Date.now()};stats.uploads.push({bot:b.id,type,size:bytes.length});
        } else {
          const patch=JSON.parse(bytes.toString() || '{}');
          if(Object.keys(patch).some(k=>!['name','avatar','nameColor','duty','notDuty','phrases','status'].includes(k)))return json(res,400,{});
          if(patch.name && (Array.from(patch.name).length>8 || roster.some(x=>x.id!==b.id && x.name===patch.name)))return json(res,400,{});
          Object.assign(b,patch);stats.patches.push({bot:b.id,patch});
        }
        emit('roster',rosterBody());return json(res,200,{ok:true,bot:b});
      }
      if(req.method==='GET' && path==='/bff/status') return json(res,200,status());
      if(req.method==='GET' && path==='/bff/approvals') return json(res,200,{approvals:[...cards.values()].filter(c=>c.type==='approval'&&c.status==='pending')});
      if(req.method==='GET' && path==='/bff/events') {
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});res.flushHeaders();streams.add(res);
        stats.globalConnections++;stats.maxGlobalConnections=Math.max(stats.maxGlobalConnections,stats.globalConnections);
        frame(res,'roster',rosterBody());frame(res,'status',status());
        const heart=setInterval(()=>res.write(': 心跳\n\n'),15000);
        res.on('close',()=>{clearInterval(heart);streams.delete(res);stats.globalConnections--;});return;
      }
      if(req.method==='GET' && path==='/bff/sessions') return json(res,200,{sessions});
      const match = /^\/bff\/sessions\/([^/]+)\/(history|cards|read|messages|stream|cancel)$/.exec(path);
      if(match) {
        const [,id,action]=match,s=sessions.find(s=>s.id===id);if(!s)return json(res,404,{});
        if(action==='history')return json(res,200,{messages:histories.get(id)||[]});
        if(action==='cards')return json(res,200,{cards:[...cards.values()].filter(c=>c.sessionId===id)});
        if(action==='read'){s.unread=0;return json(res,200,{ok:true});}
        if(action==='cancel'){s.lastText='已停止';s.lastRole='error';s.running=false;return json(res,200,{ok:true});}
        if(action==='stream') {
          res.writeHead(200,{'content-type':'text/event-stream'});frame(res,'state',{running:true,partial:''});
          if(scenarios.has(id)) {
            for(const event of scenarios.get(id)) {
              if(event.type==='barrier') {await new Promise(ok=>barriers.set(id,ok));barriers.delete(id);continue;}
              if(event.type==='card') {cards.set(event.data.id,event.data);emit('card',event.data);}
              if(['done','error'].includes(event.type)&&['aborted','cancelled','canceled','interrupted','stopped'].includes(event.data?.reason)){s.lastText='已停止';s.lastRole='error';s.running=false;}
              frame(res,event.type,event.data);await new Promise(ok=>setTimeout(ok,80));
            }
          } else frame(res,'delta',{text:'已收到开场短语，假模型离线回复。'});
          frame(res,'done',{});return res.end();
        }
        if(action==='messages') {
          if(roster.find(b=>b.id===s.bot)?.status!=='active')return json(res,403,{error:'助理已停用'});
          let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw),key=id+':'+b.idem;
          if(idems.has(key))return json(res,200,{accepted:true,requestId:idems.get(key),duplicate:true});
          const requestId='req-'+(stats.messages.length+1);idems.set(key,requestId);stats.messages.push({id,...b});
          if(!scenarios.has(id))histories.get(id).push({role:'user',text:b.text,ts:Date.now()},{role:'assistant',text:'已收到开场短语，假模型离线回复。',ts:Date.now()});
          else if(finalHistories.has(id))histories.set(id,finalHistories.get(id));
          return json(res,202,{accepted:true,requestId});
        }
      }
      if(req.method==='POST' && path==='/bff/sessions') {let raw='';for await(const c of req)raw+=c;const {bot}=JSON.parse(raw);if(roster.find(b=>b.id===bot)?.status!=='active')return json(res,403,{});const s=createSession('new-'+sessions.length,bot,0,'新会话');histories.set(s.id,[]);return json(res,201,s);}
      const approval=/^\/bff\/approvals\/([^/]+)\/answer$/.exec(path);
      if(req.method==='POST' && approval) {
        let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),c=cards.get(approval[1]);
        if(!c)return json(res,404,{});if(c.status!=='pending')return json(res,409,{error:{code:'already-answered'}});
        if(!req.headers['x-hub-device'])return json(res,403,{});
        if(b.remember===true){if(b.decision!=='approve' || c.grantable!==true)return json(res,400,{});grants.push({id:'fake-rule-'+grants.length,bot:c.bot,program:c.grantKey.program,dir:c.grantKey.dir,until:new Date(Date.now()+(30*24+9)*60*60*1000).toISOString().slice(0,10),status:'active'});}
        if(b.decision==='approve' && ['bot_create','bot_update','bot_set_status'].includes(c.tool)) {
          if(c.applyError){Object.assign(c,{status:'failed',reason:'apply-failed',failureReason:c.applyError});emit('card',c);return json(res,503,{ok:false,card:c});}
          if(c.tool==='bot_create')roster.push({id:c.createdId || 'b1234abcd',role:'bot',preset:'hub-bot',status:'active',order:roster.length,...c.after});
          else {const target=roster.find(b=>b.id===c.target);if(!target)return json(res,404,{});Object.assign(target,c.after);}
          emit('roster',rosterBody());
        }
        Object.assign(c,{status:{approve:'approved',reject:'rejected',revise:'revised'}[b.decision],note:b.note||'',resolvedAt:new Date().toISOString()});stats.answers.push(b);
        emit('card',c);emit('status',status());return json(res,200,{ok:true,card:c});
      }
      if(req.method==='GET' && path==='/bff/grants')return json(res,200,{grants});
      const revoke=/^\/bff\/grants\/([^/]+)\/revoke$/.exec(path);
      if(req.method==='POST' && revoke){if(!req.headers['x-hub-device'])return json(res,400,{});const g=grants.find(g=>g.id===decodeURIComponent(revoke[1]));if(!g)return json(res,404,{});g.status='revoked';stats.revoked=(stats.revoked||0)+1;return json(res,200,{ok:true,grant:g});}
      const continuation=/^\/bff\/delegations\/([^/]+)\/continue$/.exec(path);
      if(req.method==='POST' && continuation) {
        if(!req.headers['x-hub-device'])return json(res,400,{error:{code:'INVALID_INPUT'}});
        const c=cards.get(decodeURIComponent(continuation[1]));
        if(!c)return json(res,404,{error:{code:'NOT_FOUND'}});
        if(c.continuedBy||continuationConflicts.has(c.id))return json(res,409,{error:{code:'already-continued'}});
        const limited=c.reason==='超过 8 步自动停'||/^做了 8 步还没做完，按规矩先停了：已完成 \d+ 件，(?:剩 \d+ 件|剩下的没做)$/.test(c.reason||'');
        if(c.status!=='failed'||!limited)return json(res,409,{error:{code:'CONFLICT'}});
        const nextId='T-20261117-220000-'+String(stats.continuations.length+1).padStart(4,'0'),time=new Date().toISOString();
        const next={id:nextId,type:'delegation',sessionId:c.sessionId,bot:c.bot,task:'接着做上一张工单 '+c.id+' 剩下的部分，已完成的不要重做。原任务：'+c.task,
          status:'queued',queuePos:1,toSession:'',steps:[{ts:time,label:'派出'}],summary:'',reason:'',createdAt:time,updatedAt:time};
        c.continuedBy=nextId;cards.set(nextId,next);stats.continuations.push({id:c.id,continuedBy:nextId,device:req.headers['x-hub-device']});
        emit('card',c);emit('card',next);emit('status',status());return json(res,200,{ok:true,card:c,continuedBy:nextId,continuation:next});
      }
      // 假服务专属测试控制，正式 BFF 不提供这些路由。
      if(req.method==='POST' && path==='/bff/__fixture') {
        let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);
        if(b.type==='grants'){grants.splice(0,grants.length,...(b.grants || []));return json(res,200,{ok:true});}
        if(b.type==='roster'){if(Array.isArray(b.bots))roster=b.bots;if(b.patch){const target=roster.find(x=>x.id===b.target);if(target)Object.assign(target,b.patch);}if(b.add)roster.push(b.add);emit('roster',rosterBody());return json(res,200,rosterBody());}
        if(b.type==='continue-conflict'){continuationConflicts.add(b.id);return json(res,200,{ok:true});}
        if(b.type==='release') {barriers.get(b.id)?.();return json(res,200,{ok:true});}
        if(b.type==='timeline') {
          let s=sessions.find(s=>s.id===b.id);if(!s)s=createSession(b.id,'chief',1,b.title||'C4 工具与审批时间轴');
          histories.set(b.id,b.messages||[]);scenarios.delete(b.id);
          if(Array.isArray(b.events))scenarios.set(b.id,b.events);
          if(Array.isArray(b.finalMessages))finalHistories.set(b.id,b.finalMessages);
          for(const c of b.cards||[]){cards.set(c.id,c);emit('card',c);}
          emit('status',status());return json(res,200,{ok:true});
        }
        if(b.type==='session') {
          const s=sessions.find(s=>s.id===b.id);if(!s)return json(res,404,{});
          for(const key of ['title','lastText','lastRole','running','unread'])if(Object.hasOwn(b,key))s[key]=b[key];
          emit('status',status());return json(res,200,{ok:true});
        }
        let c=cards.get(b.id||'approval-1');
        if(!c) {c={...cards.get('approval-1'),status:'pending',resolvedAt:undefined,note:'',...b};cards.set(c.id,c);}
        Object.assign(c,b);emit('card',c);emit('status',status());return json(res,200,{ok:true});
      }
      if(req.method==='GET' && path==='/bff/__stats')return json(res,200,stats);
      return json(res,404,{});
    }catch {json(res,500,{error:'假服务请求无效'});}
  });
  await new Promise(ok=>server.listen(port,'127.0.0.1',ok));
  return {server,url:'http://127.0.0.1:'+server.address().port,stats,
    seedCard(card) { cards.set(card.id, card); emit('card', card); emit('status', status()); },
    async close() {
      for (const ok of barriers.values()) ok();
      for (const s of streams) s.end();
      await new Promise(ok => { server.close(ok); server.closeAllConnections(); });
    }};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const app=await startMockBff({port:Number(process.env.MOCK_BFF_PORT||3591)});console.log('假 BFF 已监听回环端口');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
}
