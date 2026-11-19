import http from 'node:http';
import { mkdir, open, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { HubRuntime } from './lib/runtime.mjs';
import { Roster } from './lib/roster.mjs';
import { uploadBody,saveAvatar,avatarMime } from './lib/avatars.mjs';
import { BffHeartbeat } from './lib/heartbeat.mjs';
import { createBoard } from './lib/board.mjs';
import { createLedger } from './lib/ledger.mjs';
import { readHubYaml, configuredPath, utcOffsetMinutes as offsetFor,
  loadPriceBook, loadExtensions } from './lib/ext/index.mjs';
import { rosterView } from './lib/delegation.mjs';
import { Delegations } from './lib/delegation.mjs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DshClient, sessionId } from './lib/dsh-client.mjs';
import { readSecret } from './lib/secrets.mjs';
import { BffError, publicError } from './lib/errors.mjs';
import { delegationFailure } from './lib/delegation.mjs';
import { STEP_LIMIT, stoppedReason } from './lib/delegation-text.mjs';
import { SessionStore, CallLog } from './lib/store.mjs';
import { addChatOnlySession } from './lib/chat-only-list.mjs';
import { createDiscardList } from './lib/discarded-sessions.mjs';
import { depsStopped } from './lib/panic-marker.mjs';
import { createOwnerSourceResolver } from './lib/owner-source.mjs';
import { createBoardInbox } from './lib/board-inbox.mjs';
import { createClaimWake } from './lib/claim-wake.mjs';
import { createTriggers } from './lib/triggers.mjs';
import { createExtLaunch } from './lib/ext-launch.mjs';
import { createHandoffWake } from './lib/handoff-wake.mjs';
import { createRelayWake } from './lib/relay-wake.mjs';
import { createFullTextStore, isDigest } from './lib/fulltext.mjs';
const DEFAULT_KEY_FILE = fileURLToPath(new URL('./run/bff.key', import.meta.url));
export async function loadBffKey(path) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  let handle;
  try { handle = await open(path,'wx',0o600); await handle.writeFile(randomBytes(32).toString('hex')+'\n'); }
  catch (error) { if (error.code !== 'EEXIST') throw new BffError('CONFIGURATION','Cannot create BFF key file',503); }
  finally { await handle?.close(); }
  return readSecret(path);
}
function json(response,status,value) {
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  response.end(JSON.stringify(value));
}
async function body(request) {
  const parts = []; let size = 0;
  for await (const part of request) {
    size += Buffer.byteLength(part); if (size > 512000) throw new BffError('INVALID_INPUT','Request body too large',413);
    parts.push(Buffer.from(part));
  }
  let value; try { value = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { throw new BffError('INVALID_INPUT','Invalid JSON',400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BffError('INVALID_INPUT','JSON object required',400);
  return value;
}
function validateFields(value,allowed) { if (Object.keys(value).some(key => !allowed.includes(key))) throw new BffError('INVALID_INPUT','Unexpected request field',400); }
function authenticated(value,key) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a,b);
}
const DEFAULT_STORE = fileURLToPath(new URL('./run/store.json', import.meta.url));
const DEFAULT_CALL_LOG = fileURLToPath(new URL('./run/calls.log', import.meta.url));
const cut = (text, size) => Array.from(text).slice(0,size).join('');
const invalid = message => new BffError('INVALID_INPUT',message,400);
export function createHandler({client,key,hubHome = process.env.HUB_HOME ?? join(homedir(),'dsh-work'),storeFile = process.env.HUB_BFF_STORE ?? DEFAULT_STORE,
  callLogFile = process.env.HUB_BFF_CALL_LOG ?? DEFAULT_CALL_LOG,
  botsDir = process.env.HUB_BOTS_DIR ?? join(hubHome,'bots'),
  requireBot = Boolean(process.env.HUB_BFF_STORE), store = new SessionStore(storeFile),
  callLog = new CallLog(callLogFile), logger = console,
  configDir = process.env.HUB_CONFIG_DIR ?? join(hubHome,'config'),
  ticketsDir = process.env.HUB_TICKETS_DIR ?? join(hubHome,'tickets'),
  now = Date.now, interactions = true, reconnectOptions = {}, hubConfig, boardDir, ledgerDir, dataDir,
  utcOffsetMinutes, priceBook, board, ledger, extDir} = {}) {
  if (hubConfig===undefined) {
    try {
      hubConfig = readHubYaml(configDir);
    } catch {
      logger.error('HUB_CONFIG_INVALID');
      hubConfig = {};
    }
  }
  const pathConfig = value => configuredPath(value,{home:homedir(),hubHome});
  boardDir ??= process.env.HUB_BOARD_DIR ?? pathConfig(hubConfig.board_dir) ?? join(hubHome,'board');
  ledgerDir ??= process.env.HUB_LEDGER_DIR ?? pathConfig(hubConfig.ledger_dir) ?? join(hubHome,'ledger');
  dataDir ??= process.env.HUB_DATA_DIR ?? pathConfig(hubConfig.data_dir) ?? join(hubHome,'hub-data');
  utcOffsetMinutes ??= offsetFor(hubConfig.timezone,now());
  priceBook ??= loadPriceBook(pathConfig(hubConfig.prices) ?? join(configDir,'prices.json'),logger);
  const integerConfig = (value,fallback) => {
    if (value===undefined) return fallback;
    if (Number.isSafeInteger(value) && value>=0) return value;
    logger.error('HUB_CONFIG_INVALID');
    return fallback;
  };
  ledger ??= createLedger({dir:ledgerDir,utcOffsetMinutes,now});
  let handoffWake;
  let relayWake;
  let claimWake;
  let triggers;
  let extLaunch;
  // 开放认领。首席叫醒；首席把卡派给某位助理后，走原有的「派给内部助理」叫醒那位助理。
  const claimEvent = ev => {
    claimWake?.onEvent(ev);
    // 首席安排的叫醒、定时与派出后的叫醒；派给外部身份时拉起它的接单器。
    triggers?.onEvent(ev);
    extLaunch?.onEvent(ev);
    if (ev?.type==='open_assigned' && typeof ev.id==='string' && typeof ev.assignedTo==='string') void handoffWake?.assigned(ev.id,ev.assignedTo);
  };
  board ??= createBoard({root:boardDir,legacyDir:ticketsDir,now,
    onEvent:ev => { runtime.boardEvent(ev); handoffWake?.onEvent(ev); relayWake?.onEvent(ev); claimEvent(ev); },
    maxHop:integerConfig(hubConfig.max_hop,4),maxActivePerWorker:integerConfig(hubConfig.max_active_per_worker,0),
    // 外部身份交回的卡由主人点完成（hub.yaml board.external_accept: assistant 才恢复助理可直接验收）。
    ownerAcceptExternal:hubConfig.board?.external_accept!=='assistant',
    // 没负责人的卡拖到「在做」请首席安排（board.arrange.on_drag: false 或 enabled: false 恢复旧行为）。
    arrangeOnDrag:hubConfig.board?.arrange?.enabled!==false && hubConfig.board?.arrange?.on_drag!==false,
    utcOffsetMinutes:() => offsetFor(hubConfig.timezone,now()),
    // 外部令牌不许用名册里助理的编号或名字（防冒充）；名册按需现读。
    reservedNames:() => ['owner',...roster.list().flatMap(b => [b.id,b.name])]});
  extDir ??= fileURLToPath(new URL('./lib/ext/',import.meta.url));
  const trusted = new WeakSet();
  const active = new Set(), followers = new Map(), pending = new Set();
  let disposed = false;
  const roster=new Roster({hubHome,configDir,botsDir,now,onChange:value=>{runtime.emit('roster',value);return runtime.publishStatus();}});
  const bots=()=>roster.presets();
  const requireSession = id => {
    const row = store.get(id);
    if (!row) throw new BffError('NOT_FOUND','Hub session not found',404);
    return row;
  };
  function ticketFor(id) {
    return store.cards.find(c => c.type==='delegation' && c.toSession===id)?.id ?? null;
  }

  function recordRaw(id,event) {
    try {
      const ctx = {sessionId:id,bot:store.get(id)?.bot ?? null,ticket:ticketFor(id)};
      ledger.recordEvent(event,ctx)?.catch(() => logger.error('HUB_LEDGER_FAILURE'));
    } catch { logger.error('HUB_LEDGER_FAILURE'); }
  }

  async function requireBotDir(preset) {
    let exists = false;
    try { exists = (await lstat(preset.cwd)).isDirectory(); } catch {}
    if (!exists) throw new BffError('BOTS_DIR_MISSING','Bot directory unavailable',503);
  }
  const chatOnlyFile = join(hubHome,'config','chat-only-sessions.json');
  const discarded = createDiscardList({file:join(dataDir,'discarded-sessions.json'),logger});

  async function createHubSession(bot,{title='',preset:override,cwd,hidden,purpose,groupId}={}) {
    roster.enabled(bot);
    const preset = bots().find(item => item.bot===bot);
    if (override!==undefined && (typeof override!=='string' || !/^[a-z][a-z0-9-]{1,40}$/u.test(override))) {
      throw invalid('预设无效');
    }
    if (cwd!==undefined && cwd!==preset.cwd) throw invalid('工作目录无效');
    await requireBotDir(preset);
    const result = await client.createSession({cwd:preset.cwd,agentPreset:override??preset.preset,
      ...(title ? {title} : {})});
    // 晨晚会要「学到的一条」的会话只聊天：写进只聊天名单，插件对它任何工具都拒；写不进去就不用这个会话。
    if (purpose==='meeting') {
      try { await addChatOnlySession(chatOnlyFile,sessionId(result.id)); }
      catch {
        logger.error('HUB_CHAT_ONLY_LIST_FAILURE');
        throw new BffError('CHAT_ONLY_LIST_FAILED','只聊天名单写不进去，会议会话不开',500);
      }
    }
    const unlisted = hidden===true || (typeof groupId==='string' && groupId.length>0);
    const row = await store.add({id:sessionId(result.id),bot,title,lastText:'',lastRole:null,
      updatedAt:Date.now(),unread:0,running:false,...(unlisted ? {hidden:true} : {}),
      ...(typeof purpose==='string' ? {purpose} : {}),...(typeof groupId==='string' ? {groupId} : {})});
    await runtime.publishStatus();
    return row;
  }

  async function sendFromExtension(id,text,opts={}) {
    requireSession(id);
    let settle;
    const reply = new Promise(resolve => {
      settle = resolve;
    });
    const tools = new Map();
    const receipt = await sendMessage(id,text,opts.note??'ext',true,{
      onTool:tool => {
        if (tool?.id) tools.set(tool.id,{id:tool.id,name:tool.name ?? null,status:tool.status ?? null});
      },
      onComplete:async result => {
        const value = {...result,toolEvents:[...tools.values()]};
        settle(value);
        await opts.onComplete?.(value);
        if (!value.failed && opts.notify!==false) await notifyReply(id,value);
      }
    });
    return {...receipt,reply};
  }

  // 会话回话结束时通知导出 onSessionReply 的扩展（讨论组等）；出错只记日志。
  async function notifyReply(id,value) {
    for (const name of handler.extensions.names ?? []) {
      try {
        const mod = handler.extensions.module(name);
        let fn = typeof mod?.onSessionReply==='function' ? mod.onSessionReply : undefined;
        if (!fn && typeof mod?.runtimeFor==='function') {
          const own = mod.runtimeFor(deps);
          if (typeof own?.onSessionReply==='function') fn = own.onSessionReply.bind(own);
        }
        if (fn) await fn(id,value);
      } catch { logger.error('HUB_EXT_REPLY_FAILURE '+name); }
    }
  }

  async function openBackground(id, hooks = {}) {
    // 上一轮写入完成状态时，订阅可能仍在 finally 收尾；先等它退出。
    const previous = followers.get(id);
    if (previous) await previous.task;
    let release;
    const admission = new Promise(resolve => { release = resolve; });
    const follow = {release,closed:false,accepted:false}; followers.set(id,follow);
    try {
      follow.stream = await client.follow(id,{cards:()=>runtime.cards(id),onRawEvent:event=>recordRaw(id,event)});
      const first = await follow.stream.next();
      if (first.done || first.value.type !== 'snapshot') throw new BffError('INCOMPATIBLE','Missing DSH follow snapshot');
      if (disposed || follow.closed) throw new BffError('DISCONNECTED','BFF is stopping',503);
    } catch (error) { follow.stream?.dispose(); followers.delete(id); throw error; }
    follow.task = (async () => {
      let finished = false, lastAssistant = '', steps=0;
      const complete = async (failed,reason,stopped=false) => {
        finished = true;
        follow.stream.dispose();
        reason=hooks.failureReason?.(reason) ?? reason;
        await store.update(id,row => ({running:false,unread:row.unread+1,updatedAt:Date.now(),
          ...(failed ? {lastRole:'error',lastText:stopped ? '已停止' : hooks.onComplete ? cut(reason || '派活未能完成',120) : '出错了'} : {})}));
        await runtime.publishStatus();
        await hooks.onComplete?.({failed,reason,text:lastAssistant});
      };
      try {
        if (!await admission || follow.closed) return;
        for await (const event of follow.stream) {
          if (follow.closed) break;
          if (event.type === 'step') {
            steps++;
            if (await hooks.onStep?.(event) === false) { await complete(true,STEP_LIMIT); break; }
          } else if (event.type === 'tool') {
            await hooks.onTool?.(event);
          } else if (event.type === 'message' && event.role === 'assistant') {
            if(!event.text.trim())continue;
            lastAssistant = event.text;
            await store.update(id,{lastText:cut(event.text,120),lastRole:'assistant',updatedAt:Date.now()});
          } else if (event.type === 'error' || event.type === 'done') {
            await complete(event.type === 'error' || Boolean(event.reason),delegationFailure(event.reason,steps,event.summary),stoppedReason(event.reason)); break;
          }
        }
        if (!finished && !follow.closed) await complete(true);
      } catch {
        if (!finished && !follow.closed) {
          try { await complete(true); } catch { logger.error('HUB_BFF_STORE_FAILURE: 后台结束状态落盘失败'); }
        } else if (!follow.closed) logger.error('HUB_BFF_STORE_FAILURE: 后台会话状态落盘失败');
      } finally {
        follow.stream.dispose();
        if (followers.get(id) === follow) followers.delete(id);
      }
    })();
    return follow;
  }
  const queued = new Map();
  async function sendMessage(id,text,note,queue = false,hooks = {}) {
    if (queue) {
      const previous = queued.get(id) ?? Promise.resolve();
      const job = previous.catch(()=>{}).then(async()=>{
        const follow=followers.get(id); if(follow?.task)await follow.task;
        return sendMessage(id,text,note,false,hooks);
      });
      queued.set(id,job); job.finally(()=>{if(queued.get(id)===job)queued.delete(id);}).catch(()=>{}); return job;
    }
    if(disposed)throw new BffError('DISCONNECTED','BFF is stopping',503);
    if(discarded.has(id))throw new BffError('SESSION_DISCARDED','这个会话已放弃，不能再用',410);
    roster.enabled(requireSession(id).bot);
        // r23 不接纳同一会话的第二条并发输入，避免排队回合失去独立跟随。
        const current = requireSession(id);
        if (pending.has(id) || current.running) throw new BffError('CONFLICT','Session is already running',409);
        pending.add(id); let follow;
        try {
          await callLog.prepare();
          if (!current.title) {
            const sentence = text.trim().split(/[。！？!?\n]/u).map(value => value.trim()).find(Boolean) ?? text.trim();
            const title = cut(sentence,24);
            await client.renameSession(id,title); await store.update(id,{title});
          }
          follow = await openBackground(id,hooks);
          await store.update(id,{running:true,lastText:cut(text,120),lastRole:'user',updatedAt:now()});
          await runtime.publishStatus();
          hooks.onDispatch?.();
          const receipt = await client.prompt(id,text,hooks.requestId);
          if (receipt?.accepted !== true) throw new BffError('INCOMPATIBLE','Missing DSH admission receipt');
          follow.accepted = true;
          try { await callLog.append(current.bot,id,Array.from(text).length,note); }
          finally { follow.release(true); }
          return receipt;
        } catch (error) {
          if (follow && !follow.accepted) {
            follow.closed = true; follow.release(false); follow.stream.dispose(); await follow.task;
            await store.update(id,{running:false,lastRole:'error',lastText:'出错了',updatedAt:Date.now()});
          }
          throw error;
        } finally { pending.delete(id); }

  }
  const runtime = new HubRuntime({store,client,configDir,hubHome,now,roster,ledger,send:sendMessage,logger});
  const heartbeat = new BffHeartbeat({client,runtime,configDir,now,interactions,logger});
  let connectionReady=false, everReady=false;
  const offConnection = client.onStateChange?.(() => {
    heartbeat.changed();
    const ready=Boolean(client.connected && (!interactions || client.eventsReady));
    if(ready!==connectionReady) {
      connectionReady=ready;
      if (ready && everReady && !disposed) {
        for (const id of followers.keys()) {
          try {
            const fetchSince = async since => (await client.records(id)).map(r=>r.event)
              .filter(e => since==null || e.seq>since);
            const ctx = {bot:store.get(id)?.bot ?? null,ticket:ticketFor(id)};
            ledger.catchUp({sessionId:id,fetchSince,ctx})?.catch(() => logger.error('HUB_LEDGER_CATCHUP_FAILURE'));
          } catch { logger.error('HUB_LEDGER_CATCHUP_FAILURE'); }
        }
      }
      if (ready) everReady=true;
      void runtime.publishStatus().catch(()=>logger.error('HUB_BFF_STATUS_FAILURE'));
      if(ready && !disposed)void delegations.tick().catch(()=>logger.error('HUB_DELEGATION_SCAN_FAILURE'));
    }
  });
  const delegations = new Delegations({runtime,ticketsDir,bots,roster,send:sendMessage,client,store,ledger,now,logger,
    isStopped:() => depsStopped({dataDir,hubConfig,hubHome},{whenUnknown:false})});
  if(interactions) client.setInteractionHandler?.((frame,signal)=>runtime.receive(frame,signal),()=>{void runtime.lost().catch(()=>logger.error('HUB_APPROVAL_CLOSE_FAILURE'));});
  const kernel = {modelCatalog:() => client.modelCatalog(),createSession:args => client.createSession(args)};
  // 内核没有删会话的入口；只聊天名单写失败时把会话记进放弃名单，从此不再送话、不进清单，
  // 并尽力取消在跑的回合、改标题提醒。名单内存里当场生效。
  kernel.discardSession = async id => {
    const sid = sessionId(id);
    discarded.add(sid);
    try { await client.cancel(sid); } catch { /* 没在跑也会报错，忽略 */ }
    try { await client.renameSession(sid,'已放弃（只聊天名单写失败）'); }
    catch { logger.error('HUB_DISCARD_RENAME_FAILURE'); }
  };
  if (typeof client.selectModel==='function') kernel.selectModel = args => client.selectModel(args);
  // 网页层会把登录会话收成 16 位十六进制设备头，并盖掉浏览器自报的名字。
  // 只认这种头，再加已经通过共享密钥的请求；对不上就不许改档。
  function ownerDeviceHeader(request) {
    const value = request.headers?.['x-hub-device'];
    return typeof value === 'string' && /^[a-f0-9]{16}$/u.test(value);
  }
  const deps = {configDir,dataDir,hubHome,hubConfig,roster:rosterView(roster),board,ledger,
    sessions:{create:createHubSession,send:sendFromExtension,cancel:id => client.cancel(requireSession(id).id),
      // 扩展直接经内核建的会话（/models/sessions）登记进会话清单，主人看得见。
      adopt:async (id,bot,title='') => {
        const sid=sessionId(id);roster.enabled(bot);
        if(discarded.has(sid))throw new BffError('SESSION_DISCARDED','这个会话已放弃，不能再用',410);
        const row=store.get(sid) ?? await store.add({id:sid,bot,title:typeof title==='string'?title.slice(0,200):'',
          lastText:'',lastRole:null,updatedAt:Date.now(),unread:0,running:false});
        await runtime.publishStatus();return row;
      },
      list:({all=false}={}) => store.list().filter(row => all || row.hidden!==true),
      // 未读只读这段投影，不把消息再存一份。
      history:id => client.history(requireSession(id).id,{cards:() => runtime.cards(id)})},
    cards:{ask:card => runtime.ask(card),
      pending:() => runtime.cards().filter(c => c.confirm===true && c.status==='pending'),
      // 已经答过的确认卡和审批卡，只给「今天」页的「刚刚发生的」读，不含待答的。
      recent:() => runtime.cards().filter(c => (c.type==='approval' || c.confirm===true) && c.status!=='pending')},
    notify:event => runtime.notify(event),now,priceBook,
    utcOffsetMinutes,logger,isTrusted:request => trusted.has(request),kernel,botsDir,
    isOwnerDevice:request => trusted.has(request) && ownerDeviceHeader(request),
    botCwd:bot => bots().find(item => item.bot===bot)?.cwd,
    resolveOwnerSource:createOwnerSourceResolver({root:dataDir}),
    fullText:createFullTextStore(join(dataDir,'fulltext'))};
  const inbox = createBoardInbox({boardDir,stateFile:join(dataDir,'board-inbox.json'),board,roster,
    sessions:deps.sessions,logger,onEvent:ev => { runtime.boardEvent(ev); relayWake?.onEvent(ev); claimEvent(ev); },
    isStopped:() => depsStopped(deps,{whenUnknown:false})});
  handoffWake = createHandoffWake({board,roster,sessions:deps.sessions,stateFile:join(dataDir,'handoff-wake.json'),
    now,utcOffsetMinutes,logger,isStopped:() => depsStopped(deps,{whenUnknown:false})});
  deps.handoffWake=handoffWake;
  // 接力的自动交棒与叫醒。
  relayWake = createRelayWake({board,roster,sessions:deps.sessions,stateFile:join(dataDir,'relay-wake.json'),
    now,utcOffsetMinutes,logger,isStopped:() => depsStopped(deps,{whenUnknown:false}),
    // 超时催办分钟数，配置 relay_stall_minutes（默认 30，0 为关）。
    stallMs:integerConfig(hubConfig.relay_stall_minutes,30)*60000});
  deps.relayWake=relayWake;
  claimWake = createClaimWake({board,roster,sessions:deps.sessions,stateFile:join(dataDir,'claim-wake.json'),
    now,utcOffsetMinutes,logger,isStopped:() => depsStopped(deps,{whenUnknown:false})});
  deps.claimWake=claimWake;
  // 首席安排 + 卡片定时 + 外部接单器拉起。
  triggers = createTriggers({board,roster,sessions:deps.sessions,handoffWake,stateFile:join(dataDir,'triggers.json'),
    now,utcOffsetMinutes:() => offsetFor(hubConfig.timezone,now()),logger,config:() => hubConfig.board ?? {},
    isStopped:() => depsStopped(deps,{whenUnknown:false})});
  extLaunch = createExtLaunch({board,hubConfig:() => hubConfig,stateFile:join(dataDir,'ext-launch.json'),
    now,utcOffsetMinutes:() => offsetFor(hubConfig.timezone,now()),logger,
    isStopped:() => depsStopped(deps,{whenUnknown:false})});
  deps.triggers=triggers;
  deps.extLaunch=extLaunch;
  const idemFlights = new Map();
  async function submit(id,text,idem) {
    if(!idem)return {receipt:await sendMessage(id,text),duplicate:false};
    const key=id+'\0'+idem;
    if(idemFlights.has(key))return {receipt:await idemFlights.get(key),duplicate:true};
    const saved=store.idempotency.find(r=>r.sessionId===id&&r.idem===idem&&now()-r.ts<600000);
    if(saved)return {receipt:{accepted:true,requestId:saved.requestId},duplicate:true};
    const job=(async()=>{
      const requestId=randomUUID();
      store.idempotency=store.idempotency.filter(r=>now()-r.ts<600000);
      // 在上游写入前保留号码，回执丢失也不能换一个 requestId 重发。
      store.idempotency.push({sessionId:id,idem,requestId,ts:now()});await store.persist();
      let dispatched=false;
      try { return await sendMessage(id,text,undefined,false,{requestId,onDispatch:()=>{dispatched=true;}}); }
      catch(error) { if(!dispatched) { store.idempotency=store.idempotency.filter(r=>!(r.sessionId===id&&r.idem===idem));await store.persist(); } throw error; }
    })();
    idemFlights.set(key,job);
    try{return {receipt:await job,duplicate:false};}finally{idemFlights.delete(key);}
  }
  function sse(response) {
    response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'});response.flushHeaders?.();
    const send=(type,data)=>{if(!response.destroyed&&!response.writableEnded) {if(response.writableLength>1024*1024)response.destroy();else response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);}};
    const heartbeat=setInterval(()=>{if(!response.destroyed&&!response.writableEnded)response.write(': keepalive\n\n');},15000);heartbeat.unref();
    return {send,close:()=>clearInterval(heartbeat)};
  }
  const handler = async (request,response) => {
    const authorized = authenticated(request.headers['x-hub-bff-key'],key);
    if (authorized) trusted.add(request);
    let publicPath;
    try { publicPath = new URL(request.url,'http://127.0.0.1').pathname; } catch {}
    if (!disposed && (publicPath==='/board' || publicPath?.startsWith('/board/'))) {
      try { await handler.ready; } catch {}
      if (await handler.extensions.handle(request,response,'public')) return;
    }
    if (!authorized) {
      json(response,401,{error:{code:'UNAUTHORIZED',message:'BFF key required'}});
      return;
    }
    try {
      if (disposed) throw new BffError('DISCONNECTED','BFF is stopping',503);
      await handler.ready;
      const device=runtime.device(request.headers['x-hub-device']);
      if (device) heartbeat.changed();
      const {pathname,searchParams} = new URL(request.url,'http://127.0.0.1');
      if (await handler.extensions.handle(request,response,'private')) return;
      if (request.method === 'GET' && pathname === '/bff/health') {
        let model;
        try { await client.connect(); const catalog = await client.modelCatalog(); if (catalog?.default?.provider && catalog?.default?.model) model = catalog.default.provider+'/'+catalog.default.model; } catch {}
        return json(response,200,{ok:client.connected,dsh:{connected:client.connected},...(model ? {model} : {}),api:'r23',...heartbeat.state()});
      }
      if (request.method === 'GET' && pathname === '/bff/presets') return json(response,200,{bots:roster.presets()});
      if(request.method==='GET' && pathname==='/bff/bots')return json(response,200,roster.public());
      const avatar=/^\/bff\/avatars\/([a-z][a-z0-9-]{1,23}\.(?:png|jpg|webp|gif))$/.exec(pathname);
      if(avatar && ['GET','HEAD'].includes(request.method)) {
        const bytes=await roster.avatar(avatar[1]);response.writeHead(200,{'content-type':avatarMime(avatar[1]),'content-length':bytes.length,'cache-control':'private, max-age=0, must-revalidate','x-content-type-options':'nosniff'});response.end(request.method==='HEAD'?undefined:bytes);return;
      }
      const botRoute=/^\/bff\/bots\/([a-z][a-z0-9-]{1,23})(\/avatar)?$/.exec(pathname);
      if(botRoute && (request.method==='PATCH'&&!botRoute[2] || request.method==='POST'&&botRoute[2])) {
        if(!device)throw invalid('需要已登录设备标识');
        const bot=botRoute[2]?await saveAvatar(roster,botRoute[1],await uploadBody(request),device):await roster.patch(botRoute[1],await body(request),device);
        return json(response,200,{ok:true,bot});
      }
      if (request.method === 'GET' && pathname === '/bff/status') {
        return json(response,200,await runtime.publishStatus());
      }
      if(request.method==='GET' && pathname==='/bff/events') {
        const stream=sse(response); const off=runtime.subscribe((type,data)=>stream.send(type,data));
        stream.send('status',runtime.status());stream.send('roster',roster.public());
        await new Promise(resolve=>{
          const close=()=>{off();stream.close();active.delete(close);response.end();resolve();};active.add(close);response.once('close',close);
        });return;
      }
      if (request.method==='GET' && pathname==='/bff/cards') {
        return json(response,200,{cards:runtime.cards().filter(c => c.confirm===true && c.status==='pending')});
      }
      const confirm = /^\/bff\/cards\/([^/]+)\/answer$/.exec(pathname);
      if (confirm && request.method==='POST') {
        const input = await body(request);
        validateFields(input,['choice']);
        if (!device) throw invalid('需要已登录设备标识');
        let id;
        try {
          id = decodeURIComponent(confirm[1]);
        } catch {
          throw invalid('确认卡编号无效');
        }
        return json(response,200,{ok:true,card:await runtime.answerConfirm(id,input.choice,device)});
      }
      const fullTextRoute=/^\/bff\/fulltext\/([^/]+)$/.exec(pathname);
      if(fullTextRoute && request.method==='GET') {
        if(!isDigest(fullTextRoute[1]))throw invalid('校验和无效');
        const text=deps.fullText.get(fullTextRoute[1]);
        if(text===null)throw new BffError('NOT_FOUND','全文不存在或已被改动',404);
        return json(response,200,{digest:fullTextRoute[1],text});
      }
      if(request.method==='GET' && pathname==='/bff/approvals')return json(response,200,{approvals:runtime.cards().filter(c=>c.type==='approval'&&c.status==='pending')});
      const approval=/^\/bff\/approvals\/([^/]+)\/answer$/.exec(pathname);
      if(approval && request.method==='POST') {
        const input=await body(request);validateFields(input,['decision','note','remember']);
        if((input.remember!==undefined && typeof input.remember!=='boolean') || (input.remember===true && input.decision!=='approve') || !['approve','reject','revise'].includes(input.decision) || (input.note!==undefined&&(typeof input.note!=='string'||Array.from(input.note).length>500)))throw invalid('Invalid approval answer');
        let approvalId;try{approvalId=decodeURIComponent(approval[1]);}catch{throw invalid('Invalid approval id');}
        return json(response,200,{ok:true,card:await runtime.answer(approvalId,input.decision,input.note,device,input.remember)});
      }
      if(request.method==='GET' && pathname==='/bff/grants')return json(response,200,{grants:await runtime.grants.list()});
      const revoke=/^\/bff\/grants\/([^/]+)\/revoke$/.exec(pathname);
      if(revoke && request.method==='POST') {
        validateFields(await body(request),[]);
        if(!device)throw invalid('需要已登录设备标识');
        let id;try{id=decodeURIComponent(revoke[1]);}catch{throw invalid('放行规则编号无效');}
        return json(response,200,{ok:true,grant:await runtime.grants.revoke(id,device)});
      }
      const continuation=/^\/bff\/delegations\/([^/]+)\/continue$/.exec(pathname);
      if(continuation && request.method==='POST') {
        validateFields(await body(request),[]);
        let ticketId;try{ticketId=decodeURIComponent(continuation[1]);}catch{throw invalid('工单编号无效');}
        return json(response,200,await delegations.continue(ticketId,device));
      }
      if (pathname === '/bff/sessions') {
        if (request.method === 'GET') {
          const bot = searchParams.has('bot') ? searchParams.get('bot') : undefined;
          if (bot !== undefined && !roster.get(bot)) throw invalid('Invalid bot');
          return json(response,200,{sessions:store.list(bot).filter(row => row.hidden!==true)});
        }
        if (request.method === 'POST') {
          const input = await body(request);
          validateFields(input,['bot','title','model']);
          const legacy = input.bot === undefined && !requireBot;
          if (!legacy && !roster.get(input.bot)) throw invalid('Valid bot required');
          if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 200)) {
            throw invalid('Invalid session title');
          }
          if (input.model!==undefined && (typeof input.model!=='string' || !input.model.length
            || Array.from(input.model).length>200)) throw invalid('Invalid model');
          const bot = legacy ? roster.list().find(b=>b.role==='chief').id : input.bot;
          const title = input.title?.trim() ?? '';
          const fn = !legacy && handler.extensions.module?.('models')?.createSessionWithModel;
          if (typeof fn==='function') {
            roster.enabled(bot);
            const preset = bots().find(item => item.bot===bot);
            await requireBotDir(preset);
            let result;
            try { result = await fn(deps,{bot,model:input.model,title:title||undefined,cwd:preset.cwd}); }
            catch (error) {
              if (error?.code && error?.message && typeof error.status==='number') {
                throw new BffError(error.code,error.message,error.status);
              }
              throw error;
            }
            const id = sessionId(result.sessionId);
            // 只聊天会话先进名单再进会话列表；名单写不进去就不交给主人用（插件那边少一道拒绝）。
            if (result.chatOnly===true) {
              try { await addChatOnlySession(chatOnlyFile,id); }
              catch {
                logger.error('HUB_CHAT_ONLY_LIST_FAILURE');
                await kernel.discardSession(id);
                throw new BffError('CHAT_ONLY_LIST_FAILED','只聊天名单写不进去，这个会话没有交给你用',500);
              }
            }
            const row = store.get(id) ?? await store.add({id,bot,title,lastText:'',lastRole:null,
              updatedAt:Date.now(),unread:0,running:false});
            await runtime.publishStatus();
            return json(response,201,{...row,model:result.model});
          }
          if (!legacy && input.model!==undefined) throw invalid('选模型未启用');
          return json(response,201,await createHubSession(bot,{title}));
        }
      }
      const match = /^\/bff\/sessions\/([^/]+)\/(history|messages|stream|cancel|read|cards)$/.exec(pathname);
      if (!match) throw new BffError('NOT_FOUND','Route not found',404);
      let id; try { id = sessionId(decodeURIComponent(match[1])); } catch { throw invalid('Invalid session id'); }
      const row = requireSession(id);
      if(request.method==='GET'&&match[2]==='cards')return json(response,200,{cards:runtime.cards(id)});
      if (request.method === 'GET' && match[2] === 'history') return json(response,200,await client.history(id,{cards:runtime.cards(id)}));
      if (request.method === 'POST' && match[2] === 'read') {
        validateFields(await body(request),[]); await store.update(id,{unread:0}); await runtime.publishStatus();
        return json(response,200,{ok:true});
      }
      if (request.method === 'POST' && match[2] === 'messages') {
        roster.enabled(row.bot);
        const input = await body(request); validateFields(input,['text','idem']);
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 100000) throw invalid('Text must contain 1–100000 characters');
        const idem=input.idem ?? request.headers['idempotency-key'];
        if(idem!==undefined&&(typeof idem!=='string'||!idem||Array.from(idem).length>64))throw invalid('Invalid idempotency key');
        const {receipt,duplicate}=await submit(id,input.text,idem);
        return json(response,duplicate?200:202,{...receipt,...(duplicate?{duplicate:true}:{})});
      }
      if (request.method === 'POST' && match[2] === 'cancel') { validateFields(await body(request),[]); return json(response,200,await client.cancel(id)); }
      if (request.method === 'GET' && match[2] === 'stream') {
        const stream = await client.follow(id,{cards:()=>runtime.cards(id),onRawEvent:event=>recordRaw(id,event)});
        response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','connection':'keep-alive','x-accel-buffering':'no'});
        response.flushHeaders?.();
        const close = () => stream.dispose(); active.add(close); response.once('close',close);
        const send = (type,data) => {
          if (response.destroyed || response.writableEnded) return;
          if (response.writableLength > 1024 * 1024) { stream.dispose(); response.destroy(); return; }
          response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const offCards=runtime.subscribe((type,card)=>{if(type==='card'&&card.sessionId===id)send('card',card);});
        const heartbeat = setInterval(() => { if (!response.destroyed && !response.writableEnded) response.write(': keepalive\n\n'); },15000); heartbeat.unref();
        try {
          for await (const event of stream) {
            if (response.destroyed || response.writableEnded) break;
            if (event.type === 'snapshot') {
              // 重连快照也要更新 partial：断线期间的 token 不一定已有持久 message。
              send('state',{running:requireSession(id).running,partial:event.partial ?? ''});
              continue;
            }
            if (event.type === 'delta') send('delta',{text:event.text});
            else if (event.type === 'message' || event.type === 'tool') {const {type,...data}=event;send(type,data);}
            else if (event.type === 'done') send('done',{});
            else if (event.type === 'error') send('error',{message:'DSH turn failed'});
          }
        } catch (error) { send('error',{message:publicError(error).message}); }
        finally { offCards(); clearInterval(heartbeat); active.delete(close); response.off('close',close); stream.dispose(); response.end(); }
        return;
      }
      throw new BffError('METHOD_NOT_ALLOWED','Method not allowed',405);
    } catch (error) {
      const safe = publicError(error);
      if (!response.headersSent) json(response,safe.status,{error:{code:safe.code,message:safe.message}});
      else response.end();
    }
  };
  handler.extensions = {names:[],handle:async () => false,matches:() => false,module:() => undefined,
    start:async () => {},stop:async () => {}};
  handler.ready = Promise.all([store.ready,roster.load()]).then(async () => {
    await runtime.grants.readDays();
    await runtime.publishStatus();
    await heartbeat.start();
    if (hubConfig.models!==undefined) {
      try {
        await lstat(join(configDir,'models.json'));
        logger.log('HUB_MODELS_CONFIG: hub.yaml 与 models.json 都有，以 hub.yaml 为准');
      } catch (error) { if (error.code!=='ENOENT') logger.error('HUB_MODELS_CONFIG_UNREADABLE'); }
    }
    handler.extensions = await loadExtensions({dir:extDir,deps,logger});
    if (!disposed) inbox.start();
    if (!disposed) handoffWake.start();
    if (!disposed) { relayWake.start(); void relayWake.resume(); }
    if (!disposed) { claimWake.start(); void claimWake.resume(); }
    if (!disposed) { triggers.start(); void triggers.resume(); extLaunch.start(); void extLaunch.resume(); }
  });
  handler.ready.catch(()=>{});
  handler.board=board;
  handler.inbox=inbox;
  handler.handoffWake=handoffWake;
  handler.relayWake=relayWake;
  handler.claimWake=claimWake;
  handler.triggers=triggers;
  handler.extLaunch=extLaunch;
  handler.ledger=ledger;
  handler.deps=deps;
  handler.roster=roster;handler.runtime=runtime;handler.delegations=delegations;handler.heartbeat=heartbeat;
  handler.start = async () => {
    await handler.ready;
    if(client.startReconnect)await client.startReconnect(reconnectOptions);
    else try{await client.connect();}catch{logger.error('HUB_DSH_UNAVAILABLE');}
    await delegations.start();
    await handler.extensions.start();
  };
  handler.dispose = async () => {
    disposed = true;
    await inbox.stop();
    await handoffWake.stop();
    await relayWake.stop();
    await claimWake.stop();
    await triggers.stop();
    await extLaunch.stop();
    try {
      await handler.extensions.stop();
    } catch {
      logger.error('HUB_EXTENSION_STOP_FAILURE');
    }
    // 先标记为主动关闭，等待重连的旧 follower 不再把退出误记为一次失败未读。
    for(const follow of followers.values()){follow.closed=true;follow.release(false);}
    client.stopReconnect?.();
    // 先落盘停止应答，再收尾会话；SIGINT/SIGTERM 也走这条关闭路径。
    try { await heartbeat.stop(); } catch { logger.error('HUB_BFF_HEARTBEAT_FAILURE'); }
    offConnection?.();
    await delegations.dispose(); await runtime.dispose();
    for (const close of active) close(); active.clear();
    const closing = [...followers.entries()];
    for (const [,follow] of closing) { follow.closed = true; follow.release(false); follow.stream?.dispose(); }
    await Promise.all(closing.map(([,follow]) => follow.task));
    await store.ready;
    for (const row of store.list()) if (row.running) await store.update(row.id,{running:false});
    await runtime.publishStatus(); await store.flush(); await callLog.flush();
  };
  return handler;
}
export async function startServer({host = process.env.HOST ?? process.env.BFF_HOST ?? '127.0.0.1', port = Number(process.env.PORT ?? process.env.BFF_PORT ?? 3291), keyFile = process.env.BFF_KEY_FILE ?? DEFAULT_KEY_FILE, client = new DshClient(), serverFactory = http.createServer, ...handlerOptions} = {}) {
  if (host !== '127.0.0.1') throw new BffError('CONFIGURATION','BFF must bind 127.0.0.1',503);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new BffError('CONFIGURATION','Invalid BFF port',503);
  const key = await loadBffKey(keyFile); const handler = createHandler({client,key,...handlerOptions});
  await handler.ready;
  const server = serverFactory((req,res) => { void handler(req,res); });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  try {
    await new Promise((resolve,reject) => { server.once('error',reject); server.listen(port,host,resolve); });
    await handler.start();
  } catch(error) {
    await handler.dispose(); client.dispose(); server.closeAllConnections?.(); await new Promise(resolve=>server.close(resolve)); throw error;
  }
  return {server,async close() { await handler.dispose(); client.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }};
}
export function installShutdown(app) {
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); };
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,stop);
  return () => { for (const signal of ['SIGINT','SIGTERM']) process.off(signal,stop); };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = await startServer(); console.log('hub-bff listening on '+app.server.address().address+':'+app.server.address().port);
    installShutdown(app);
  } catch (error) { const safe = publicError(error); console.error(safe.code+': '+safe.message); process.exitCode = 1; }
}
