import { randomUUID } from 'node:crypto';
import { open, mkdir, rename, constants, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CommandGrants } from './command-grants.mjs';
import { homedir } from 'node:os';
import { BOT_ID, ROSTER_TOOLS, validRosterCard } from './roster.mjs';
import { BffError } from './errors.mjs';
export const cut = (text,n) => Array.from(text ?? '').slice(0,n).join('');
const fail = () => new BffError('STORAGE_FAILURE','Hub storage unavailable',503);
export async function atomicFile(path,text) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  let file;
  try {
    file = await open(path+'.tmp',constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
    await file.chmod(0o600); await file.writeFile(text); await file.sync(); await file.close(); file = undefined;
    await rename(path+'.tmp',path);
  } catch { throw fail(); } finally { await file?.close(); }
}
const plain = (v,max,empty=false) => typeof v==='string' && (empty || v.length>0) && Array.from(v).length<=max && !/[\u0000-\u001f\u007f]/u.test(v);
export const absolutePath = v => plain(v,4096) && v.startsWith('/');
const shape = (v,keys) => v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
const categories = new Set(['pay','publish','destroy','admin']);
function confirmation(input) {
  const total = input.confirmationTotal;
  if (total === undefined) return {};
  if (![1,2].includes(total) || !plain(input.consequence,500) || !plain(input.rollback,500)) return null;
  const targets = input.targets ?? [];
  const targetCount = input.targetCount ?? targets.length;
  if (!Array.isArray(targets) || targets.length > 100 || !targets.every(v => plain(v,500))
    || !Number.isSafeInteger(targetCount) || targetCount !== targets.length || (total === 2 && !targetCount)) return null;
  return {confirmationTotal:total,confirmationStep:1,targets,targetCount,
    consequence:input.consequence,rollback:input.rollback,
    ...(categories.has(input.category) ? {category:input.category} : {})};
}
export function parseApproval(reason) {
  if (typeof reason !== 'string' || !reason.startsWith('HUBAPPROVAL1 ') || /[\r\n]/u.test(reason)) return null;
  try {
    const v = JSON.parse(reason.slice(13));
    if (!v || v.v !== 1 || !BOT_ID.test(v.bot ?? "") || v.level !== 'L3' || typeof v.path !== 'string' || !v.path.startsWith('/') || /[\r\n\t]/u.test(v.path)
      || typeof v.tool !== 'string' || !v.tool || /[\r\n\t]/u.test(v.tool) || typeof v.action !== 'string' || !v.action
      || !Number.isSafeInteger(v.chars) || v.chars < 0 || typeof v.preview !== 'string'
      || (v.sessionId !== undefined && (typeof v.sessionId !== 'string' || !v.sessionId))
      || (v.diff !== undefined && typeof v.diff !== 'string')) return null;
    if (v.tool==='bash' && (!absolutePath(v.cwd) || !plain(v.command,2000) || !plain(v.why,200,true)
      || !plain(v.preview,200,true) || !plain(v.action,100) || !absolutePath(v.path)
      || (v.sessionId!==undefined && !plain(v.sessionId,200))
      || !Number.isSafeInteger(v.timeoutMs) || v.timeoutMs<=0 || v.timeoutMs>600000
      || !shape(v.caps,['network','writeRoots','longRunning']) || typeof v.caps.network!=='boolean' || typeof v.caps.longRunning!=='boolean'
      || !Array.isArray(v.caps.writeRoots) || v.caps.writeRoots.length>64 || !v.caps.writeRoots.every(absolutePath)
      || typeof v.grantable!=='boolean'
      || (v.grantable ? !shape(v.grantKey,['program','dir']) || !plain(v.grantKey.program,128) || !absolutePath(v.grantKey.dir) : v.grantKey!==undefined))) return null;
    if(ROSTER_TOOLS.includes(v.tool) && !validRosterCard(v))return null;
    if (!confirmation(v)) return null;
    return {...v,preview:cut(v.preview,200),...(v.diff === undefined ? {} : {diff:cut(v.diff,600)})};
  } catch { return null; }
}
export class HubRuntime {
  constructor({store,client,configDir,hubHome=process.env.HUB_HOME ?? join(homedir(),'dsh-work'),
    now=Date.now,send,roster,ledger,logger=console}) {
    Object.assign(this,{store,client,configDir,hubHome,now,send,roster,ledger,logger});
    this.grants=new CommandGrants({configDir,now,atomicFile,roster}); this.answering=new Set();
    this.devices = new Map(); this.ownerTurns = new Map(); this.waiters = new Map(); this.listeners = new Set(); this.statusWrites = Promise.resolve(); this.logWrites = Promise.resolve();
    this.timer = setInterval(() => { void this.expire().catch(() => logger.error('HUB_APPROVAL_EXPIRY_FAILURE')); },1000); this.timer.unref();
  }
  device(value) {
    if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value)) { this.devices.set(value,this.now()); return value; }
    return null;
  }
  present() { return [...this.devices.values()].some(ts => this.now()-ts <= 15*60*1000); }
  cards(id) { return this.store.cards.filter(c => id === undefined || c.sessionId === id).sort((a,b) => a.createdAt.localeCompare(b.createdAt)); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(type,value) { for (const listener of this.listeners) { try { listener(type,structuredClone(value)); } catch {} } }
  status() {
    const bots = Object.fromEntries(this.roster.ids().map(bot => [bot,{running:false,runningSessionId:null,unread:0,pending:0,delegated:{running:false,queued:0}}]));
    for (const row of this.store.list()) {
      const v=bots[row.bot];
      if(!v)continue;
      // 软删除的段不进状态里的未读，也不当作当前正在跑的那段。
      if (this.isChatHidden?.(row.id) === true) continue;
      if(row.hidden!==true)v.unread+=row.unread;
      if (row.running) { v.running=true; v.runningSessionId ??= row.id; }
    }
    for (const card of this.store.cards) {
      if (!bots[card.bot]) continue;
      if (card.type==='approval' && card.status==='pending') bots[card.bot].pending++;
      if (card.type==='delegation') { if (card.status==='running') bots[card.bot].delegated.running=true; if (card.status==='queued') bots[card.bot].delegated.queued++; }
    }
    return {hubHome:this.hubHome,commandGrantDays:this.grants.days,bots,pendingTotal:Object.values(bots).reduce((n,v)=>n+v.pending,0),ts:this.now()};
  }
  async publishStatus() {
    const status = this.status();
    const write=this.statusWrites.then(() => atomicFile(join(this.configDir,'bot-status.json'),JSON.stringify({bots:Object.fromEntries(Object.entries(status.bots).map(([id,v])=>[id,{running:v.running,pending:v.pending,delegated:v.delegated}])),ts:status.ts})+'\n'));
    this.statusWrites=write.catch(()=>{}); await write; this.emit('status',status); return status;
  }
  async cardChanged(card) { await this.store.persist(); this.emit('card',card); await this.publishStatus(); }
  audit(card,device) {
    const outcome = card.status==='approved' && card.remembered ? 'approved+remember' : card.status;
    try {
      const row = {kind:'approval',key:'approval:'+card.sessionId+':'+card.id,tsMs:this.now(),bot:card.bot,
        sessionId:card.sessionId||null,approvalId:card.id,tool:card.tool||null,level:card.level??null,
        action:card.action??null,target:card.path||null,outcome,device:device??null,
        askedTsMs:Date.parse(card.createdAt)||null};
      this.ledger?.record(row)?.catch(() => this.logger.error('HUB_LEDGER_FAILURE'));
    } catch { this.logger.error('HUB_LEDGER_FAILURE'); }
    const safe = value => String(value ?? '-').replace(/[\r\n\t]/gu,' ');
    const line=[new Date(this.now()).toISOString(),card.bot,card.tool,card.path,card.status==='approved' && card.remembered ? 'approved+remember' : card.status,device ?? '-'].map(safe).join('\t')+'\n';
    const write=this.logWrites.then(async()=>{
      await mkdir(this.configDir,{recursive:true,mode:0o700}); let f;
      try { f=await open(join(this.configDir,'approvals.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);
        if (!(await f.stat()).isFile()) throw fail(); await f.chmod(0o600); await f.writeFile(line); await f.sync();
      } finally { await f?.close(); }
    }); this.logWrites=write.catch(()=>{}); return write;
  }
  boardEvent(ev) {
    this.emit('board',ev);
    if (ev.attention || ev.notify || ev.inboxFor) this.notify({source:'board',...ev});
  }

  notify(event) {
    if (!event || Object.getPrototypeOf(event)!==Object.prototype) return;
    this.emit('notice',{...event,ts:this.now()});
  }

  // 通用确认卡：对界面呈现为一张审批卡（confirm:true），答复后解析为 {id,status,choice,decision,device,by}。
  async ask(input) {
    return (await this.openConfirmation(input)).result;
  }

  async openConfirmation(input) {
    const invalid = () => new BffError('INVALID_INPUT','确认卡格式无效',400);
    const validText = (v,max,empty=false) => plain(v,max,empty) && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(v);
    const clip = (v,max) => typeof v==='string' ? cut(v.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu,' '),max) : '';
    // 预览可以多行（分工表的每张单一行）：只留换行，别的控制字符一律换成空格；界面按纯文本显示。
    const clipLines = (v,max) => typeof v==='string'
      ? cut(v.replace(/\r\n?/gu,'\n').replace(/[^\S\n]*\n[^\S\n]*/gu,'\n')
        .replace(/(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/gu,' '),max) : '';
    if (!input || typeof input!=='object') throw invalid();
    const staged = confirmation(input);
    if (!staged) throw invalid();
    const raw = input.choices ?? input.actions;
    const choices = raw===undefined ? [{id:'yes',label:'好'},{id:'no',label:'先不'}] : raw;
    const bot = input.bot ?? this.roster.list().find(b => b.role==='chief')?.id;
    const what = clip(input.what,200), where = clip(input.where,200), why = clip(input.why,200);
    const text = input.text ?? [['做什么',what],['在哪做',where],['为什么',why]]
      .filter(([,v]) => v).map(([k,v]) => k+'：'+v).join('\n');
    const okText = v => typeof v==='string' && v.length>0 && Array.from(v).length<=1000;
    if (!this.roster.get(bot) || !validText(input.title,40) || !okText(text)
      || !Array.isArray(choices) || choices.length<1 || choices.length>4
      || choices.some(c => !c || typeof c.id!=='string' || !/^[a-z][a-z0-9-]{0,31}$/u.test(c.id)
        || !validText(c.label,16)) || new Set(choices.map(c => c.id)).size!==choices.length
      || (input.sessionId!==undefined && !validText(input.sessionId,200,true))
      || (input.kind!==undefined && !validText(input.kind,32,true))
      || (input.ttlMs!==undefined && (!Number.isSafeInteger(input.ttlMs) || input.ttlMs<0
        || input.ttlMs>604800000))) throw invalid();
    const created = this.now();
    const list = choices.map(c => ({id:c.id,label:c.label}));
    const card = {id:'confirm-'+randomUUID(),type:'approval',confirm:true,tool:'confirm',level:'L3',
      bot,sessionId:input.sessionId??'',callId:'',action:input.title,path:'',chars:0,preview:'',
      title:input.title,text,what,where,why,bodyPreview:clipLines(input.bodyPreview,600),
      project:clip(input.project,100),summary:clip(input.summary,200),choices:list,actions:list,
      kind:input.kind??'', ...staged,
      ...(input.bodyTruncated===true ? {bodyTruncated:true} : {}),
      // 卡上放不下时带全文校验和，界面用它取「看全文」（GET /bff/fulltext/<校验和>）。
      ...(typeof input.fullText==='string' && /^[a-f0-9]{64}$/u.test(input.fullText) ? {fullText:input.fullText} : {}),
      ...(Number.isSafeInteger(input.bodyLength) && input.bodyLength>=0 ? {bodyLength:input.bodyLength} : {}),
      status:'pending',choice:null,note:'',createdAt:new Date(created).toISOString(),
      expiresAt:new Date(created+(input.ttlMs??86400000)).toISOString()};
    let settle;
    const result = new Promise(resolve => {
      settle = resolve;
    });
    this.waiters.set(card.id,{resolve:settle,confirm:true});
    this.store.cards.push(card);
    try {
      await this.cardChanged(card);
    } catch (error) {
      this.waiters.delete(card.id);
      card.status='unavailable';
      throw error;
    }
    return {card:structuredClone(card),result};
  }

  async resolveConfirm(card,status,choice,device) {
    card.status = status;
    card.choice = choice;
    if (device) card.device = device;
    card.resolvedAt = new Date(this.now()).toISOString();
    const waiter = this.waiters.get(card.id);
    this.waiters.delete(card.id);
    try {
      const row = {kind:'approval',key:'approval:'+card.sessionId+':'+card.id,tsMs:this.now(),bot:card.bot,
        sessionId:card.sessionId||null,approvalId:card.id,tool:'confirm',level:null,action:card.title,
        target:card.kind||null,outcome:choice ?? status,device:device??null,askedTsMs:Date.parse(card.createdAt)||null};
      this.ledger?.record(row)?.catch(() => this.logger.error('HUB_LEDGER_FAILURE'));
    } catch { this.logger.error('HUB_LEDGER_FAILURE'); }
    try {
      await this.cardChanged(card);
    } finally {
      const by = device ?? null;
      waiter?.resolve({id:card.id,status,choice,decision:choice,device:by,by});
    }
    return structuredClone(card);
  }

  // 界面用审批卡的 decision/remember 答确认卡时，换成卡上的选项 id。
  confirmChoice(card,decision,remember) {
    const has = id => card.choices.some(c => c.id===id);
    if (decision==='approve' && remember) return has('approve-always') ? 'approve-always' : null;
    if (decision==='approve') return has('approve') ? 'approve' : has('yes') ? 'yes' : null;
    if (decision==='reject') return has('reject') ? 'reject' : has('no') ? 'no' : null;
    return null;
  }

  async stage(card,accept,options) {
    if (card.confirmationTotal !== 2 || !accept) return false;
    if (options.step !== card.confirmationStep) {
      throw new BffError('INVALID_INPUT','请先查看这一步的确认卡',400);
    }
    if (card.confirmationStep === 2) return false;
    card.confirmationStep=2;
    try { await this.cardChanged(card); }
    catch (error) { card.confirmationStep=1; throw error; }
    return true;
  }

  async answerConfirm(id,choice,device,options={}) {
    const card = this.store.cards.find(c => c.confirm===true && c.id===id);
    if (!card) throw new BffError('NOT_FOUND','确认卡不存在',404);
    if (!device) throw new BffError('INVALID_INPUT','需要已登录设备标识',400);
    if (card.confirmationTotal && !options.owner) throw new BffError('FORBIDDEN','请从主人设备确认',403);
    if (card.status!=='pending' || this.answering.has(id)) {
      throw new BffError('already-answered','已经答过了',409);
    }
    this.answering.add(id);
    try {
      if (this.now()>=Date.parse(card.expiresAt)) {
        await this.resolveConfirm(card,'timeout',null,null);
        throw new BffError('already-answered','确认卡已超时',409);
      }
      if (!card.choices.some(c => c.id===choice)) throw new BffError('INVALID_INPUT','选项无效',400);
      if (await this.stage(card,choice==='yes'||choice==='approve'||choice==='approve-always',options)) {
        return structuredClone(card);
      }
      return await this.resolveConfirm(card,'answered',choice,device);
    } finally { this.answering.delete(id); }
  }

  async receive(frame,signal) {
    await this.store.ready;
    const meta=parseApproval(frame.request?.reason), row=this.store.get(frame.agentId);
    const aligned=meta && row && row.bot===meta.bot && this.roster.get(meta.bot) && (!meta.sessionId || meta.sessionId===row.id) && frame.request.toolName===meta.tool;
    let context={};
    if (row) { try { context=await this.client.approvalContext(row.id,frame.request); } catch {} }
    const id=context.id, createdAt=new Date(context.ts ?? this.now()).toISOString();
    const staged = meta ? confirmation(meta) : {};
    const turn = this.ownerTurns.get(row?.id);
    // 没有审计身份时不伪造内核审批 ID；保留 unavailable 诊断卡，永不开放批准。
    const card={id:id ?? 'unavailable:'+frame.eventId,type:'approval',bot:meta?.bot ?? row?.bot ?? 'chief',sessionId:row?.id ?? '',callId:frame.request?.callId ?? '',
      tool:meta?.tool ?? frame.request?.toolName ?? '',level:'L3',action:meta?.action ?? '无法核验审批',path:meta?.path ?? '',chars:meta?.chars ?? 0,preview:meta?.preview ?? '',
      ...(meta && ROSTER_TOOLS.includes(meta.tool)?{target:meta.target,before:meta.before,after:meta.after}:{}),
      ...(meta?.tool==='bash'?{command:meta.command,cwd:meta.cwd,timeoutMs:meta.timeoutMs,caps:meta.caps,grantable:meta.grantable,...(meta.grantable?{grantKey:meta.grantKey}:{})}:{}),...(meta?.diff===undefined?{}:{diff:meta.diff}),...(context.seq===undefined?{}:{seq:context.seq}),why:meta && (meta.tool==='bash'||ROSTER_TOOLS.includes(meta.tool)) ? meta.why : context.why ?? '',
      ...staged,
      ...(turn && staged?.category && staged.confirmationTotal===1 ? {scopeGrantable:true} : {}),
      status:'pending',note:'',createdAt,expiresAt:new Date(Date.parse(createdAt)+600000).toISOString()};
    if (this.store.cards.some(c=>c.id===card.id)) return 'rejected';
    this.store.cards.push(card);
    let resolve;
    const result=new Promise(r=>{resolve=r;});
    this.waiters.set(card.id,{resolve,signal,turn});
    const offline=this.client.interactionHandler && (!this.client.connected || !this.client.eventsReady || !this.client.answering);
    const unavailable = !aligned || !id || signal?.aborted || offline;
    if (unavailable) {
      const reason=!aligned?'bad-request':offline || signal?.aborted?'dsh-disconnected':'bad-request';
      await this.resolve(card,'unavailable',null,reason==='bad-request'?'审批信息无法核验，这一步没做':'审批连接已结束，这一步没做',reason);
      return result;
    }
    const abort=()=>{ void this.resolve(card,'unavailable',null,'审批连接已结束，这一步没做','dsh-disconnected').catch(()=>{}); };
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    try {
      if (card.scopeGrantable && this.grants.taskAllowed(turn,card.category)) await this.resolve(card,'approved',null);
      else await this.cardChanged(card);
      return await result;
    }
    catch (error) { if(card.status==='pending') { try { await this.resolve(card,'unavailable',null,'审批记录无法保存，这一步没做'); } catch {} } throw error; }
    finally { signal?.removeEventListener('abort',abort); }
  }
  async resolve(card,status,device,note='',reason,task) {
    if (card.status!=='pending') throw new BffError('already-answered','已经答过了',409);
    // 先同步抢占状态，跨 await 的并发点击只会有一个获胜。
    card.status=status; card.note=note; if(reason)card.reason=reason; card.resolvedAt=new Date(this.now()).toISOString();
    const waiter=this.waiters.get(card.id); this.waiters.delete(card.id);
    let persisted=false;
    try {
      await this.audit(card,device); await this.cardChanged(card); persisted=true;
      if (task && this.ownerTurns.get(card.sessionId)===task) this.grants.allowTask(task,card.category);
    }
    catch (error) { card.status='unavailable';card.note='审批记录无法保存，这一步没做';try { await this.store.persist(); } catch {} this.emit('card',card);throw error; }
    finally { waiter?.resolve(persisted && status==='approved'?'allowed-once':'rejected'); }
    return structuredClone(card);
  }
  async answer(id,decision,note,device,remember=false,options={}) {
    const card=this.store.cards.find(c=>c.type==='approval'&&c.id===id);
    if (!card) throw new BffError('NOT_FOUND','审批不存在',404);
    if (card.confirm===true) {
      const choice=this.confirmChoice(card,decision,remember===true);
      if (!choice) throw new BffError('INVALID_INPUT','这张卡没有这个选项',400);
      return this.answerConfirm(id,choice,device,options);
    }
    if (!device) throw new BffError('INVALID_INPUT','需要已登录设备标识',400);
    if (card.confirmationTotal && !options.owner) throw new BffError('FORBIDDEN','请从主人设备确认',403);
    if (!['approve','reject','revise'].includes(decision) || typeof remember!=='boolean' || (remember && (decision!=='approve' || card.tool!=='bash' || card.grantable!==true))) throw new BffError('INVALID_INPUT','这张卡不能保存放行规则',400);
    if (card.status!=='pending' || this.answering.has(id)) throw new BffError('already-answered','已经答过了',409);
    this.answering.add(id);
    try {
    if(this.client.interactionHandler && (!this.client.connected || !this.client.eventsReady || !this.client.answering)) {
      await this.resolve(card,'unavailable',null,'审批连接已结束，这一步没做','dsh-disconnected');
      throw new BffError('already-answered','审批连接已结束',409);
    }
    if (this.now()>=Date.parse(card.expiresAt)) { await this.resolve(card,'timeout',null,'没等到你点头，这一步没做'); throw new BffError('already-answered','审批已超时',409); }
    const turn=this.waiters.get(id)?.turn;
    if (options.scope && (!card.scopeGrantable || this.ownerTurns.get(card.sessionId)!==turn
      || decision!=='approve')) throw new BffError('INVALID_INPUT','这张卡不能授权整个任务',400);
    if (await this.stage(card,decision==='approve',options)) return structuredClone(card);
    if(decision==='approve' && ROSTER_TOOLS.includes(card.tool)) {
      try { const bot=await this.roster.approve(card,device);card.appliedTarget=bot.id; }
      catch(error) {if(card.status!=='pending')return structuredClone(card);card.statusText='没改成';return this.resolve(card,'failed',device,'没改成：'+(error instanceof BffError?error.message:'名册保存失败'),'roster-failed');}
    }
    if (remember) { await this.grants.remember(card,device); card.remembered=true; }
    const result=await this.resolve(card,{approve:'approved',reject:'rejected',revise:'revised'}[decision],
      device,note ?? '',undefined,options.scope==='task' ? turn : undefined);
    if (decision==='revise') void this.send(card.sessionId,'（改一下）主人 看了审批卡，要你按这条意见改完重做（重做照常走审批，这不算绕过）：'+(note ?? ''),'revise',true).catch(()=>this.logger.error('HUB_REVISE_QUEUE_FAILURE'));
    return result;
    } finally { this.answering.delete(id); }
  }
  async expire() {
    for (const card of this.store.cards) {
      if (card.status!=='pending' || this.answering.has(card.id) || this.now()<Date.parse(card.expiresAt)) continue;
      if (card.confirm===true) await this.resolveConfirm(card,'timeout',null,null);
      else if (card.type==='approval') await this.resolve(card,'timeout',null,'没等到你点头，这一步没做');
    }
  }
  async lost(reason='dsh-disconnected') {
    for (const card of this.store.cards) {
      if (card.type!=='approval' || card.status!=='pending' || card.confirm===true) continue;
      await this.resolve(card,'unavailable',null,'审批连接已结束，这一步没做',reason);
    }
  }
  async dispose() {
    clearInterval(this.timer);
    for (const [id,waiter] of this.waiters) {
      if (waiter.confirm) {
        this.waiters.delete(id);
        waiter.resolve({id,status:'unavailable',choice:null,device:null});
      }
    }
    await this.lost('bff-restart');
    await this.statusWrites;
    await this.logWrites;
    await this.grants.writes;
  }
}
export async function phrases(path,bots) {
  let data; try { data=JSON.parse(await readFile(path,'utf8')); } catch { data={}; }
  return bots.map(bot=>{
    const value=Array.isArray(data)?data.find(row=>row.bot===bot.bot)?.phrases:(data[bot.bot]?.phrases ?? data[bot.bot] ?? data.bots?.find?.(row=>row.bot===bot.bot)?.phrases);
    return {...bot,phrases:Array.isArray(value)?value.filter(s=>typeof s==='string').slice(0,3):[]};
  });
}
