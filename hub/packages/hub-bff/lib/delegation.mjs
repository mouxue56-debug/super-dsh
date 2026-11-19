import { readdir, open, constants, rename, mkdir, realpath, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { canDispatch, canDispatchExternal } from './board.mjs';
import { BOT_ID } from './roster.mjs';
import { atomicFile, cut } from './runtime.mjs';
import { BffError } from './errors.mjs';
import { STEP_LIMIT, stoppedReason, isStepLimit, plainSummary, toolLabel, taskTotal, limitReport } from './delegation-text.mjs';
const ID=/^T-\d{8}-\d{6}-[a-zA-Z0-9]{4}$/u;
const FIELDS=['id','kind','creator','assignee','status','createdAt','updatedAt','fromSession','toSession','steps'];
// 把 BFF 名册转成看板判定用的行：name 用助理 id，停用即 paused。
export function boardRows(roster) {
  return roster.list().map(b => ({...b,name:b.id,displayName:b.name,paused:b.status!=='active'}));
}

// 这个助理能不能派单（按名册属性，不按 id）。
export function dispatchAllowed(roster,id) {
  return canDispatch(boardRows(roster),id);
}

// 给扩展用的名册只读视图。
export function rosterView(roster) {
  return {
    list: () => roster.list(),
    get: id => roster.get(id),
    resolve: value => roster.get(value)?.id ?? roster.list().find(b => b.name===value)?.id,
    canDispatch: id => dispatchAllowed(roster,id),
    canDispatchExternal: id => canDispatchExternal(boardRows(roster),id),
    chief: () => roster.list().find(b => b.role==='chief')?.id
  };
}

export function delegationFailure(reason,steps=0,notice='') {
  if(notice===STEP_LIMIT || reason==='blocked' && steps>=8)return STEP_LIMIT;
  if(reason==='blocked')return '派活被权限规则拦下';
  if(stoppedReason(reason))return '派活已取消';
  return '派活执行出错';
}
export function parseTicket(text,filename,statuses=['queued','running'],roster) {
  const match=/^---\r?\n([\s\S]*?)\r?\n---\r?\n## 任务\r?\n([\s\S]*?)\r?\n## 进度\r?\n([\s\S]*?)\r?\n## 回报\r?\n([\s\S]*)$/u.exec(text);
  if (!match) return null;
  const meta={};
  for (const line of match[1].split(/\r?\n/u)) {
    const m=/^([A-Za-z]+): ?([^\r\n]*)$/u.exec(line); if (!m || !FIELDS.includes(m[1]) || Object.hasOwn(meta,m[1])) return null;
    meta[m[1]]=m[2].trim();
  }
  if (!ID.test(meta.id ?? '') || filename!==meta.id+'.md' || meta.kind!=='delegation'
    || (roster?!dispatchAllowed(roster,meta.creator):!BOT_ID.test(meta.creator??''))
    || !BOT_ID.test(meta.assignee??'') || meta.assignee===meta.creator
    || !statuses.includes(meta.status) || !meta.fromSession || !/^[A-Za-z0-9_.:-]{1,200}$/u.test(meta.fromSession)
    || (meta.toSession && !/^[A-Za-z0-9_.:-]{1,200}$/u.test(meta.toSession)) || !/^\d+$/u.test(meta.steps ?? '') || !Number.isFinite(Date.parse(meta.createdAt)) || !Number.isFinite(Date.parse(meta.updatedAt)) || !match[2].trim()) return null;
  return {meta,task:match[2].trim(),progress:match[3].trimEnd(),report:match[4].trimEnd()};
}
export function formatTicket(t) {
  return '---\n'+FIELDS.map(k=>k+': '+(t.meta[k] ?? '')).join('\n')+'\n---\n## 任务\n'+t.task+'\n## 进度\n'+t.progress+'\n## 回报\n'+t.report+'\n';
}
export class Delegations {
  // isStopped：修E注入的一键全停判断；停着时不派新活、不续做，排队的单留到恢复后再派。
  constructor({runtime,ticketsDir,bots,send,client,store,roster,ledger,now=Date.now,logger=console,
    isStopped=()=>false}) {
    Object.assign(this,{runtime,ticketsDir,bots,send,client,store,roster,ledger,now,logger,isStopped});
    this.running=new Map();
    this.stopped=false;
    this.continuing=new Set();
  }
  start() { this.timer=setInterval(()=>{void this.tick().catch(()=>this.logger.error('HUB_DELEGATION_SCAN_FAILURE'));},2000); this.timer.unref(); return this.tick(); }
  async load() {
    let entries; try {
      const root=await realpath(this.ticketsDir);if(await realpath(join(this.ticketsDir,'working'))!==join(root,'working'))throw new Error('Unsafe tickets directory');
      entries=await readdir(join(this.ticketsDir,'working'),{withFileTypes:true}); } catch (e) { if(e.code==='ENOENT')return []; throw e; }
    const result=[];
    for (const entry of entries) {
      if (!entry.isFile() || !/^T-\d{8}-\d{6}-[a-zA-Z0-9]{4}\.md$/u.test(entry.name)) continue;
      let f; try {
        f=await open(join(this.ticketsDir,'working',entry.name),constants.O_RDONLY|constants.O_NOFOLLOW);
        const stat=await f.stat(); if(!stat.isFile()||stat.size>512000)continue;
        const ticket=parseTicket(await f.readFile('utf8'),entry.name,['queued','running'],this.roster);
        if (ticket && this.store.get(ticket.meta.fromSession)?.bot===ticket.meta.creator
          && dispatchAllowed(this.roster,ticket.meta.creator)) result.push(ticket);
      } finally { await f?.close(); }
    }
    return result.sort((a,b)=>a.meta.createdAt.localeCompare(b.meta.createdAt)||a.meta.id.localeCompare(b.meta.id));
  }
  async write(t,folder='working') {
    const dir=join(this.ticketsDir,folder); await mkdir(dir,{recursive:true,mode:0o700});
    // 栏目录不得通过符号链接指向其他位置。
    const root=await realpath(this.ticketsDir), actual=await realpath(dir);
    if(actual!==join(root,folder))throw new Error('Unsafe tickets directory');
    const tmp=join(dir,'.'+t.meta.id+'.tmp'); await atomicFile(tmp,formatTicket(t)); await rename(tmp,join(dir,t.meta.id+'.md'));
  }
  async directory(folder) {
    const dir=join(this.ticketsDir,folder);await mkdir(dir,{recursive:true,mode:0o700});
    if(await realpath(dir)!==join(await realpath(this.ticketsDir),folder))throw new BffError('STORAGE_FAILURE','工单目录不可用',503);
    return dir;
  }
  async readTicket(folder,id,staged=false) {
    const dir=await this.directory(folder);let f;
    try {
      f=await open(join(dir,staged?'.'+id+'.continue':id+'.md'),constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await f.stat();if(!stat.isFile()||stat.size>512000)throw new Error('Invalid ticket');
      const t=parseTicket(await f.readFile('utf8'),id+'.md',staged?['queued']:['failed'],this.roster);
      if(!t)throw new Error('Invalid ticket');return t;
    } finally {await f?.close();}
  }
  async recoverContinuations() {
    for(const c of this.store.cards) {
      if(c.type!=='delegation'||!ID.test(c.continuedBy ?? '')||this.continuing.has(c.id))continue;
      let t;try{t=await this.readTicket('working',c.continuedBy,true);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      if(t.meta.fromSession!==c.sessionId||t.meta.assignee!==c.bot)throw new Error('Invalid continuation');
      const dir=await this.directory('working');
      // staged 文件只在 continuedBy 已持久保存后进入可扫描栏；重启补完这一步，不重建或重发。
      try {await lstat(join(dir,t.meta.id+'.md'));throw new Error('Duplicate continuation');}catch(e){if(e.code!=='ENOENT')throw e;}
      await this.store.persist();
      await rename(join(dir,'.'+t.meta.id+'.continue'),join(dir,t.meta.id+'.md'));
    }
  }
  async continue(id,device) {
    if(!device)throw new BffError('INVALID_INPUT','需要已登录设备标识',400);
    if(this.halted())throw new BffError('PANIC_STOPPED','已一键全停，恢复后再运行',503);
    if(!ID.test(id))throw new BffError('INVALID_INPUT','工单编号无效',400);
    await this.store.ready;
    const original=this.store.cards.find(c=>c.type==='delegation'&&c.id===id);
    if(!original)throw new BffError('NOT_FOUND','派工不存在',404);
    if(original.continuedBy || this.continuing.has(id))throw new BffError('already-continued','这张工单已经续做了',409);
    if(original.status!=='failed'||!isStepLimit(original.reason))throw new BffError('CONFLICT','只有因步数上限停止的失败工单可以续做',409);
    if (!dispatchAllowed(this.roster,this.store.get(original.sessionId)?.bot)) {
      throw new BffError('CONFLICT','派单助理会话无法核验',409);
    }
    this.continuing.add(id);
    try {
      let old;try{old=await this.readTicket('failed',id);}catch{throw new BffError('CONFLICT','失败工单无法核验或尚未收尾',409);}
      if(old.meta.assignee!==original.bot||old.meta.fromSession!==original.sessionId)throw new BffError('CONFLICT','派工信息无法核验',409);
      const ts=new Date(this.now()).toISOString(),stamp=ts.replace(/[-:T]/gu,'').slice(0,14),dir=await this.directory('working');
      let nextId;
      for(let n=0;n<20;n++) {
        const candidate='T-'+stamp.slice(0,8)+'-'+stamp.slice(8)+'-'+randomBytes(2).toString('hex');
        if(this.store.cards.some(c=>c.id===candidate||c.continuedBy===candidate))continue;
        let exists=false;
        for(const folder of ['working','new','done','failed','blocked'])try{await lstat(join(this.ticketsDir,folder,candidate+'.md'));exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
        if(!exists){nextId=candidate;break;}
      }
      if(!nextId)throw new BffError('STORAGE_FAILURE','暂时无法生成工单编号',503);
      const t={meta:{id:nextId,kind:'delegation',creator:old.meta.creator,assignee:old.meta.assignee,status:'queued',createdAt:ts,updatedAt:ts,fromSession:old.meta.fromSession,toSession:'',steps:'0'},
        task:'接着做上一张工单 '+id+' 剩下的部分，已完成的不要重做。原任务：'+old.task,
        progress:'- '+ts+' '+this.creatorName(old.meta.creator)+'派出',report:''};
      await atomicFile(join(dir,'.'+nextId+'.continue'),formatTicket(t));
      original.continuedBy=nextId;
      await this.runtime.cardChanged(original);
      await rename(join(dir,'.'+nextId+'.continue'),join(dir,nextId+'.md'));
      const card=this.card(t);await this.runtime.cardChanged(card);
      void this.tick().catch(()=>this.logger.error('HUB_CONTINUATION_QUEUE_FAILURE'));
      return {ok:true,card:structuredClone(original),continuedBy:nextId,continuation:structuredClone(card)};
    } finally {this.continuing.delete(id);}
  }
  card(t) {
    let c=this.store.cards.find(c=>c.type==='delegation'&&c.id===t.meta.id);
    if(!c) { c={id:t.meta.id,type:'delegation',sessionId:t.meta.fromSession,bot:t.meta.assignee,task:cut(t.task,120),status:t.meta.status,queuePos:0,toSession:t.meta.toSession ?? '',steps:[{ts:t.meta.createdAt,label:'派出'}],summary:'',reason:'',createdAt:t.meta.createdAt,updatedAt:t.meta.updatedAt}; this.store.cards.push(c); }
    return c;
  }
  async update(t,status,label) {
    const ts=new Date(this.now()).toISOString(); t.meta.updatedAt=ts; t.meta.status=status; t.progress+=(t.progress?'\n':'')+'- '+ts+' '+label;
    const c=this.card(t); c.status=status;c.toSession=t.meta.toSession ?? '';c.updatedAt=ts;c.steps.push({ts,label}); if(status!=='queued')c.queuePos=0;
    await this.write(t); await this.runtime.cardChanged(c); return c;
  }
  async tick() {
    if (this.scanning || this.stopped || this.halted()) return; this.scanning=true;
    try {
      if(this.client.reconnector && !this.client.reconnector.stopped && !this.client.connected)return;
      await this.store.ready; await this.recoverContinuations(); const tickets=await this.load(); const positions=new Map();
      const occupied=new Set([...this.running.values()].map(t=>t.meta.assignee));
      for (const t of tickets) {
        let c=this.store.cards.find(c=>c.type==='delegation' && c.id===t.meta.id);
        if(!c) {
          let origin={};try{origin=await this.client.delegationOrigin(t.meta.fromSession,t.meta.id);}catch{}
          c=this.card(t);
          if(origin.seq!==undefined)c.seq=origin.seq;
          if(origin.ts!==undefined)c.createdAt=new Date(origin.ts).toISOString();
        }
        if(this.running.has(t.meta.id))continue;
        if(t.meta.status==='running') {
          // 进程重启后绝不重发工单；取消旧会话，再标失败。
          if(t.meta.toSession) { try { await this.client.cancel(t.meta.toSession); } catch { continue; } }
          await this.finish(t,false,'BFF 重启，派活中断',true); continue;
        }
        if(!occupied.has(t.meta.assignee) && !this.store.list(t.meta.assignee).some(r=>r.running)) {
          occupied.add(t.meta.assignee);this.running.set(t.meta.id,t);
          await this.run(t); // 只等待接纳，生成由后台跟随，不堵队列扫描。
        } else {
          const pos=(positions.get(t.meta.assignee) ?? 0)+1;positions.set(t.meta.assignee,pos);
          if(c.queuePos!==pos || c.steps.length===1) { c.queuePos=pos;c.steps.push({ts:new Date(this.now()).toISOString(),label:'派出（排队第 '+pos+' 位）'});await this.runtime.cardChanged(c); }
        }
      }
    } finally { this.scanning=false; }
  }
  // 停着吗；判断本身出错按停着。
  halted() {
    try { return this.isStopped()===true; } catch { return true; }
  }
  creatorName(id) {
    const bot = this.roster.get(id);
    return bot?.role==='chief' ? '首席' : bot?.name;
  }

  async run(t) {
    // 扫描途中刚好全停：这张单不开会话，放回队列等恢复。
    if (this.halted()) { this.running.delete(t.meta.id); return; }
    t.startedMs = this.now();
    try {
      this.roster.enabled(t.meta.assignee);this.roster.enabled(t.meta.creator);
      const bot=this.bots().find(b=>b.bot===t.meta.assignee);
      const created=await this.client.createSession({cwd:bot.cwd,agentPreset:bot.preset,title:'派工：'+cut(t.task,16)});
      t.meta.toSession=created.id; t.meta.steps='0';
      await this.store.add({id:created.id,bot:bot.bot,title:'派工：'+cut(t.task,16),lastText:'',lastRole:null,updatedAt:this.now(),unread:0,running:false});
      await this.update(t,'running','开始');
      t.actions=new Map();t.completed=new Set();
      const message = '【'+this.creatorName(t.meta.creator)+'派来的活 · 工单 '+t.meta.id+'】'+t.task;
      await this.send(created.id,message,'delegate',false,{
        onStep:async()=>{
          t.meta.steps=String(Number(t.meta.steps)+1);
          if(Number(t.meta.steps)>8) {
            await this.client.cancel(created.id); return false;
          }
          await this.update(t,'running','在写回复');
          t.currentAction={entry:this.card(t).steps.at(-1),line:t.progress.split('\n').length-1,tools:new Map()};
          return true;
        },
        failureReason:reason=>isStepLimit(reason)?limitReport(t.completed.size,taskTotal(t.task)):reason,
        onTool:tool=>this.tool(t,tool,bot.cwd),
        onComplete:async({failed,reason,text})=>this.finish(t,!failed,failed?(reason ?? '派活出错'):text)
      });
    } catch { await this.finish(t,false,'派活未能完成',true); }
  }
  async tool(t,tool,cwd) {
    if(t.finished)return;
    if(!t.currentAction) {
      await this.update(t,'running','在写回复');
      t.currentAction={entry:this.card(t).steps.at(-1),line:t.progress.split('\n').length-1,tools:new Map()};
    }
    let action=t.actions.get(tool.id);
    if(!action){action=t.currentAction;t.actions.set(tool.id,action);}
    action.tools.set(tool.id,tool);
    if(tool.status==='ok') {
      if(['write','edit'].includes(tool.name)&&typeof tool.path==='string'&&tool.path) {
        const absolute=resolve(cwd,tool.path);let canonical=absolute;
        try{canonical=await realpath(absolute);}catch{}
        t.completed.add('file:'+canonical.normalize('NFC').toLowerCase());
      } else if(tool.name==='ticket_create')t.completed.add('ticket:'+tool.id);
    }
    const label=[...action.tools.values()].map(value=>toolLabel(value,cwd)).join('；');action.entry.label=label;
    const lines=t.progress.split('\n');lines[action.line]='- '+action.entry.ts+' '+label;t.progress=lines.join('\n');
    t.meta.updatedAt=new Date(this.now()).toISOString();const card=this.card(t);card.updatedAt=t.meta.updatedAt;
    await this.write(t);await this.runtime.cardChanged(card);
  }
  async finish(t,success,summary,notify=false) {
    if(t.finished)return {reason:this.card(t).reason}; t.finished=true;
    const limited=!success&&isStepLimit(summary);
    if(limited)summary=limitReport(t.completed?.size ?? 0,taskTotal(t.task));
    if(notify&&t.meta.toSession&&this.store.get(t.meta.toSession))await this.store.update(t.meta.toSession,row=>({running:false,unread:row.unread+1,lastRole:'error',lastText:cut(summary,120),updatedAt:this.now()}));
    const status=success?'done':'failed', text=plainSummary(summary);
    t.report=text;
    const card=this.card(t);card.summary=success?text:'';card.reason=success?'':text;
    if(limited){card.failureKind='step-limit';card.completed=t.completed?.size ?? 0;card.remaining=taskTotal(t.task)===null?null:Math.max(0,taskTotal(t.task)-card.completed);}
    await this.update(t,status,success?'完成':'失败：'+text);
    const target=join(this.ticketsDir,status);await mkdir(target,{recursive:true,mode:0o700});
    const root=await realpath(this.ticketsDir);if(await realpath(target)!==join(root,status))throw new Error('Unsafe destination');
    await rename(join(this.ticketsDir,'working',t.meta.id+'.md'),join(target,t.meta.id+'.md'));
    await this.runtime.cardChanged(card);
    try {
      const row = {kind:'dispatch',id:'delegation:'+t.meta.id,tsMs:this.now(),bot:t.meta.creator,
        sessionId:t.meta.fromSession,ticket:t.meta.id,worker:t.meta.assignee,
        wallMs:t.startedMs ? this.now()-t.startedMs : null,exitCode:null,tokens:null,
        parentSessionId:t.meta.fromSession,workerModel:null,outcome:status};
      this.ledger?.record(row)?.catch(() => this.logger.error('HUB_LEDGER_FAILURE'));
    } catch { this.logger.error('HUB_LEDGER_FAILURE'); }
    this.running.delete(t.meta.id);
    return {reason:card.reason};
  }
  async dispose() { this.stopped=true;clearInterval(this.timer); }
}
