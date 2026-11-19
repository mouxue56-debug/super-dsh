import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
// 插件把「超过 8 步自动停」写在旁路文件里（不进会话日志），这里按会话与轮次查。
const stepLimitFile=()=>(process.env.HUB_HOME||homedir()+'/dsh-work')+'/config/step-limits.log';
export function stepLimitFor(id,turn){try{return readFileSync(stepLimitFile(),'utf8').trim().split('\n').slice(-500).some(l=>{try{const r=JSON.parse(l);return r.sessionId===id&&r.turn===turn;}catch{return false;}})?'超过 8 步自动停':'';}catch{return '';}}
import { randomUUID } from 'node:crypto';
import { NodeWebSocket } from './websocket.mjs';
import { AsyncQueue } from './queue.mjs';
import { readSecret } from './secrets.mjs';
import { BffError, disconnected, upstreamError } from './errors.mjs';
import { project, Timeline, coordinates, validSeq } from './timeline.mjs';
import { Reconnector } from './reconnect.mjs';
export { messageFromEvent } from './timeline.mjs';
// 收口：去掉写死的个人路径；建会话必须显式给工作目录（名册预设目录），缺了就报错，不落到别处。
export const DEFAULT_CWD = undefined;
const invalid = message => new BffError('INVALID_INPUT', message, 400);
export function sessionId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw invalid('Invalid session id');
  return value;
}
export class DshClient {
  #cookie = ''; #socket; #streams = new Map(); #connecting; #disposed = false; #lifetime = new AbortController();
  connected = false; eventsReady = false; answering = false;
  #stateListeners = new Set();
  onStateChange(listener) { this.#stateListeners.add(listener); return () => this.#stateListeners.delete(listener); }
  #stateChanged() { for (const listener of this.#stateListeners) { try { listener(); } catch {} } }
  constructor({url = process.env.DSH_URL ?? 'http://127.0.0.1:3290', tokenFile = process.env.DSH_TOKEN_FILE, fetchImpl = globalThis.fetch, socketFactory = (url,cookie,timeout) => new NodeWebSocket(url,cookie,timeout), timeoutMs = 10000} = {}) {
    this.url = new URL(url);
    if (this.url.protocol !== 'http:' || this.url.hostname !== '127.0.0.1' || this.url.username || this.url.password || this.url.search || this.url.hash || this.url.pathname !== '/') throw new BffError('CONFIGURATION', 'DSH_URL must be an HTTP URL on 127.0.0.1', 503);
    this.tokenFile = tokenFile; this.fetchImpl = fetchImpl; this.socketFactory = socketFactory; this.timeoutMs = timeoutMs;
  }
  async connect({retry=false} = {}) {
    if (this.#disposed) throw disconnected();
    if (this.#connecting) return this.#connecting;
    if (this.connected) return;
    if (!retry && this.reconnector && !this.reconnector.stopped) throw disconnected();
    this.#connecting = this.#connect();
    try { await this.#connecting; } finally { this.#connecting = undefined; }
  }
  async #connect() {
    const token = await readSecret(this.tokenFile);
    const authUrl = new URL('/connect', this.url); authUrl.searchParams.set('token',token); authUrl.searchParams.set('interactions','answer');
    const response = await this.#fetch(authUrl,{redirect:'manual'});
    const cookies = response.headers.getSetCookie();
    await response.body?.cancel();
    if (response.status !== 302 || response.headers.get('location') !== './api/remote.mux' || !cookies.length) throw new BffError('AUTHENTICATION', 'DSH authentication failed', 503);
    this.#cookie = cookies.map(value => value.split(';',1)[0]).join('; ');
    if (this.#disposed) throw disconnected();
    const socket = this.socketFactory(new URL('/api/remote.mux',this.url),this.#cookie,this.timeoutMs);
    this.#socket = socket;
    socket.on('message', bytes => {
      if (socket !== this.#socket) return;
      try {
        const frame = JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
        if (!frame || typeof frame.streamId !== 'string') throw new Error('frame');
        const stream = this.#streams.get(frame.streamId); if (!stream) return;
        if (frame.type === 'item') {
          if (!stream.push(frame.value)) { this.#streams.delete(frame.streamId); socket.send(JSON.stringify({type:'cancel',streamId:frame.streamId})); }
        }
        else if (frame.type === 'end') { stream.finish(); this.#streams.delete(frame.streamId); }
        else if (frame.type === 'error') { stream.finish(upstreamError(frame.error?.code)); this.#streams.delete(frame.streamId); }
        else throw new Error('frame');
      } catch { this.#lost(new BffError('INCOMPATIBLE','Invalid DSH stream protocol'),socket); socket.close(); }
    });
    socket.on('failure', () => this.#lost(disconnected(),socket));
    socket.on('close', () => this.#lost(disconnected(),socket));
    try {
      await new Promise((resolve,reject) => {
        const timer = setTimeout(() => end(disconnected()),this.timeoutMs); timer.unref();
        const end = error => { clearTimeout(timer); socket.off('open',opened); socket.off('close',closed); error ? reject(error) : resolve(); };
        const opened = () => end(); const closed = () => end(disconnected());
        socket.once('open',opened); socket.once('close',closed);
        if (socket.readyState === 1) end();
      });
      // 同一个 Peer 的 $events ready 与 $events/result 构成可应答连接。
      if (this.#disposed || socket.readyState !== 1) throw disconnected();
      this.connected = true;
      if (this.interactionHandler) await this.#startInteractions(socket);
      else this.#stateChanged();
    } catch (error) { this.#lost(error,socket); socket.close(); throw error; }
  }
  #lost(error,socket=this.#socket) {
    if(socket && socket!==this.#socket)return;
    const wasConnected=this.connected;
    this.#socket=undefined;this.connected=false;this.eventsReady=false;this.answering=false;this.#cookie='';
    for(const stream of this.#streams.values())stream.finish(error);this.#streams.clear();
    if(wasConnected)this.interactionLost?.();
    this.#stateChanged();socket?.close();
  }
  async startReconnect(options={}) {
    if(!this.reconnector || this.reconnector.stopped)this.reconnector=new Reconnector({client:this,...options});
    return this.reconnector.start();
  }
  stopReconnect() {this.reconnector?.stop();this.#stateChanged();}
  async #waitReady(signal) {
    if(this.connected && (!this.interactionHandler || this.eventsReady))return;
    if(this.#disposed || signal.aborted || !this.reconnector || this.reconnector.stopped)throw disconnected();
    await new Promise((resolve,reject)=>{
      const check=()=>{
        if(this.#disposed || signal.aborted || this.reconnector.stopped)end(disconnected());
        else if(this.connected && (!this.interactionHandler || this.eventsReady))end();
      };
      const end=error=>{off();signal.removeEventListener('abort',check);error?reject(error):resolve();};
      const off=this.onStateChange(check);signal.addEventListener('abort',check,{once:true});check();
    });
  }
  async #fetch(url, options) {
    try { return await this.fetchImpl(url,{...options, signal:AbortSignal.any([this.#lifetime.signal,AbortSignal.timeout(this.timeoutMs)])}); }
    catch { throw disconnected(); }
  }
  async rpc(endpoint, args) {
    await this.connect();
    const rpcId = randomUUID(), socket=this.#socket;
    let response;
    try { response = await this.#fetch(new URL('/api/'+endpoint,this.url),{method:'POST',redirect:'manual',headers:{cookie:this.#cookie,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId,method:endpoint,payload:{args}})}); } catch(error) {this.#lost(error,socket);throw error;}
    if (!response.ok) { await response.body?.cancel(); if ([401,403,409].includes(response.status)) { this.#lost(disconnected(),socket); } throw disconnected(); }
    let envelope; try { envelope = await response.json(); } catch { throw new BffError('INCOMPATIBLE','Invalid DSH RPC response'); }
    if (envelope?.type !== 'server-response' || envelope.rpcId !== rpcId || typeof envelope.result?.ok !== 'boolean') throw new BffError('INCOMPATIBLE','Invalid DSH RPC response');
    if (!envelope.result.ok) throw upstreamError(envelope.result.error?.code);
    return envelope.result.value;
  }
  #open(endpoint,payload) {
    const streamId = randomUUID(); const queue = new AsyncQueue();
    queue.disposed = false;
    queue.dispose = () => {
      queue.disposed = true;
      if (this.#streams.delete(streamId) && this.#socket?.readyState === 1) this.#socket.send(JSON.stringify({type:'cancel',streamId}));
      queue.cancel();
    };
    queue.return = async () => { queue.dispose(); return {done:true}; };
    this.#streams.set(streamId,queue);
    try { this.#socket.send(JSON.stringify({type:'open',streamId,endpoint,payload})); }
    catch (error) { this.#streams.delete(streamId); queue.finish(error); }
    return queue;
  }
  setInteractionHandler(handler, lost) { this.interactionHandler = handler; this.interactionLost = lost; }
  async #startInteractions(socket) {
    const raw = this.#open('$events',{args:{}});
    let first, timer;
    try {
      first = await Promise.race([raw.next(),new Promise((_,reject) => {
        timer = setTimeout(() => reject(disconnected()),this.timeoutMs); timer.unref();
      })]);
      if (first.done || first.value?.type !== 'ready' || typeof first.value.clientId !== 'string') throw new BffError('INCOMPATIBLE','Missing Remote events ready');
      if (this.#disposed || !this.connected || socket!==this.#socket || socket.readyState !== 1) throw disconnected();
    } catch (error) { raw.dispose(); throw error; } finally { clearTimeout(timer); }
    const clientId = first.value.clientId, active = new Map();
    this.eventsReady = true; this.answering = true; this.#stateChanged();
    this.interactionTask = (async () => {
      try {
        for await (const frame of raw) {
          if (frame.type === 'cancel') { active.get(frame.eventId)?.abort(); continue; }
          if (frame.type === 'emit') continue;
          if (frame.type !== 'waterfall' || typeof frame.eventId !== 'string') throw new Error('Invalid waterfall');
          const controller = new AbortController(); active.set(frame.eventId,controller);
          // 每张卡独立等待，不能堵塞瀑布流上的取消或其他会话。
          void (async () => {
            let outcome = {kind:'next'};
            if (frame.event === 'approval/request') {
              let value = 'rejected';
              try { value = await this.interactionHandler(frame,controller.signal); } catch {}
              outcome = {kind:'result',value:value === 'allowed-once' ? value : 'rejected'};
            }
            if (!controller.signal.aborted && socket===this.#socket) await this.rpc('$events/result',{clientId,eventId:frame.eventId,outcome});
          })().catch(() => { this.#lost(disconnected(),socket); }).finally(() => active.delete(frame.eventId));
        }
        throw disconnected();
      } catch { if (!this.#disposed) this.#lost(disconnected(),socket); }
      finally { for (const controller of active.values()) controller.abort(); }
    })();
  }
  async approvalContext(id,request) {
    const value=await this.rpc('session/events',{request:{address:{kind:'session',sessionId:sessionId(id)},maxMessages:200}});
    const records=value?.records ?? [], events=records.map(r=>r.event);
    const decided=new Set(events.filter(e=>e.type==='approval/decided').map(e=>e.data.id));
    const asked=events.findLast(e=>e.type==='approval/asked' && !decided.has(e.data.id)
      && e.data.toolName===request.toolName && e.data.callId===request.callId && e.data.reason===request.reason);
    if(!asked)return {};
    const timeline=project(records), call=timeline.calls.get(request.callId);
    return {id:asked.data.id,...coordinates(asked),why:call?.why ?? ''};
  }
  async approvalIdentity(id,request) {return (await this.approvalContext(id,request)).id;}
  async delegationOrigin(id,ticketId) {
    const records=await this.records(id), events=records.map(r=>r.event);
    const result=events.find(e=>e.type==='tool/result' && e.data?.message?.isError===false
      && e.data.message.content?.some(p=>p.type==='text' && new RegExp('工单 '+ticketId+'(?:，|\\s|$)','u').test(p.text)));
    const callId=result?.data.message.toolCallId ?? result?.data.message.source?.callId;
    const call=events.find(e=>e.type==='tool/call' && e.data.callId===callId && e.data.name==='delegate_to_bot');
    return call ? coordinates(call) : {};
  }
  async listSessions() {
    const value = await this.rpc('session/list',{_request:{}});
    if (!Array.isArray(value?.items)) throw new BffError('INCOMPATIBLE','Invalid DSH session list');
    return value.items.map(item => ({id:sessionId(item.sessionId),title:typeof item.projections?.values?.title === 'string' ? item.projections.values.title : 'New session',updatedAt:item.updatedAt}));
  }
  async createSession({cwd, title, agentPreset} = {}) {
    if (typeof cwd !== 'string' || !cwd || (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 200)) || (agentPreset !== undefined && (typeof agentPreset !== 'string' || !agentPreset))) throw invalid('Invalid session options');
    const result = await this.rpc('session/create',{request:{cwd,...(agentPreset === undefined ? {} : {agentPreset})}}); const id = sessionId(result?.sessionId);
    if (title !== undefined) await this.renameSession(id,title);
    return {id};
  }
  async renameSession(id,title) {
    sessionId(id);
    if (typeof title !== 'string' || !title.trim() || title.length > 200) throw invalid('Invalid session title');
    return this.rpc('session/rename',{request:{sessionId:id,title:title.trim()}});
  }
  async prompt(id,text,requestId = randomUUID()) {
    sessionId(id); if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw invalid('Text must contain 1–100000 characters');
    const result = await this.rpc('session/prompt',{request:{sessionId:id,requestId,mode:'queue',content:[{type:'text',text}]}});
    if (result?.accepted !== true) throw new BffError('INCOMPATIBLE','Missing DSH admission receipt');
    return {accepted:true,requestId}; // Never retry writes, including lost admission receipts.
  }
  async cancel(id) { const result = await this.rpc('session/cancel',{request:{sessionId:sessionId(id)}}); if (result?.accepted !== true) throw new BffError('INCOMPATIBLE','Missing DSH cancellation receipt'); return {ok:true}; }
  async records(id) {
    sessionId(id); const records = []; let beforeSeq, throughSeq;
    for (let page = 0; page < 100; page++) {
      const value = await this.rpc('session/events',{request:{address:{kind:'session',sessionId:id},maxMessages:200,...(beforeSeq === undefined ? {} : {beforeSeq,throughSeq})}});
      if (!Array.isArray(value?.records)) throw new BffError('INCOMPATIBLE','Invalid DSH history');
      records.unshift(...value.records);
      if (!value.hasMore) return records;
      throughSeq ??= value.cursor;
      const next = value.records[0]?.event?.seq;
      if (!Number.isSafeInteger(next) || (beforeSeq !== undefined && next >= beforeSeq)) throw new BffError('INCOMPATIBLE','Invalid DSH history cursor');
      beforeSeq = next;
    }
    throw new BffError('UPSTREAM_FAILURE','History exceeds the BFF page limit');
  }
  async history(id,{cards=[]}={}) {
    try{return {messages:project(await this.records(id),cards).surface()};}
    catch(error){if(error.message==='Unsupported history replacement')throw new BffError('INCOMPATIBLE',error.message);throw error;}
  }
  async modelCatalog() { return this.rpc('session/modelCatalog',{}); }
  // 给会话选择内核模型。
  async selectModel({sessionId: id, provider, model, reasoningEffort}) {
    sessionId(id);
    if (typeof provider !== 'string' || !provider.trim() || typeof model !== 'string' || !model.trim()) {
      throw new BffError('INVALID_INPUT','模型参数无效',400);
    }
    const request = {sessionId:id,provider,model,...(reasoningEffort===undefined?{}:{reasoningEffort})};
    const result = await this.rpc('session/selectModel',{request});
    return result?.selected ?? null;
  }

  async #rawFollow(id,signal) {
    const socket=this.#socket;
    const raw=this.#open('session/follow',{args:{request:{address:{kind:'session',sessionId:id},assistantStream:true,maxMessages:200}}});
    const abort=()=>raw.dispose();signal.addEventListener('abort',abort,{once:true});
    let first,timer;
    try {
      first=await Promise.race([raw.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(disconnected()),this.timeoutMs);timer.unref();})]);
      if(first.done || first.value?.type!=='snapshot')throw new BffError('INCOMPATIBLE','Missing DSH follow snapshot');
      return {raw,first:first.value,socket,detach:()=>signal.removeEventListener('abort',abort)};
    } catch(error) {signal.removeEventListener('abort',abort);raw.dispose();throw error;}
    finally {clearTimeout(timer);}
  }
  async follow(id,{cards=()=>[],onRawEvent}={}) {
    sessionId(id);await this.connect();
    const controller=new AbortController(), signal=controller.signal;
    let opened=await this.#rawFollow(id,signal), lastSeq=-1, initial=true, stopReason='';
    const seenChunks=new Map(), timeline=new Timeline(cards), client=this;
    const translate=event=>{
      if(!validSeq(event?.seq) || event.seq<=lastSeq)return [];
      lastSeq=event.seq;
      try {
        const pending = onRawEvent?.(event);
        pending?.catch?.(() => {});
      } catch {}
      const out=[], data=event.data ?? {};
      if(event.type==='turn/start')stopReason='';
      if(event.type==='hub-plugin/notice' && data.text==='超过 8 步自动停')stopReason=data.text;
      if(event.type==='step/start')out.push({type:'step',seq:event.seq,step:data.step,turn:data.turn});
      const value=timeline.ingest(event);
      if(value.message)out.push({type:'message',...value.message});
      if(value.tool)out.push({type:'tool',...value.tool});
      if(event.type==='turn/end' && !stopReason && data.reason?.kind && data.reason.kind!=='completed') stopReason=stepLimitFor(id,data.turn);
      if(event.type==='turn/end') {
        if(['error','failed'].includes(data.reason?.kind))out.push({type:'error',message:'DSH turn failed'});
        out.push({type:'done',...(data.reason?.kind && data.reason.kind!=='completed'?{reason:data.reason.kind}:{}),...(stopReason?{summary:stopReason}:{})});
      }
      return out;
    };
    const iterator=(async function* () {
      try {
        while(!signal.aborted) {
          const {raw,first}=opened;
          try {
            let records=first.records ?? [], replay=[];
            if(initial) {
              if(first.hasMore)records=(await client.records(id)).filter(r=>!validSeq(first.cursor) || r.event?.seq<=first.cursor);
              for(const r of records)timeline.ingest(r.event);
              lastSeq=validSeq(first.cursor)?first.cursor:Math.max(-1,...records.map(r=>r.event?.seq).filter(validSeq));
            } else {
              // 快照窗口不足时只读分页补齐；补事件但绝不重发 prompt。
              if(first.hasMore || records.find(r=>validSeq(r.event?.seq))?.event.seq>lastSeq+1)records=await client.records(id);
              for(const r of records)replay.push(...translate(r.event));
              if(validSeq(first.cursor))lastSeq=Math.max(lastSeq,first.cursor);
            }
            const attempt=first.assistantStream?.activeAttempt;
            const partial=(attempt?.stream ?? []).filter(r=>r.type==='text-chunks').map(r=>r.texts.join('')).join('');
            if(attempt)seenChunks.set(attempt.attemptId,attempt.nextIndex-1);
            yield {type:'snapshot',messages:timeline.surface(),partial};initial=false;
            for(const event of replay)yield event;
            for await(const frame of raw) {
              if(signal.aborted || raw.disposed)return;
              if(frame?.type==='assistant-stream') {
                const item=frame.frame;
                if(item.type==='chunk' && item.index>(seenChunks.get(item.attemptId) ?? -1)) {
                  seenChunks.set(item.attemptId,item.index);
                  if(item.chunk?.type==='text-delta')yield {type:'delta',text:item.chunk.text};
                }
              } else if(frame?.type==='event') {for(const event of translate(frame.event))yield event;}
              else throw new BffError('INCOMPATIBLE','Unsupported DSH follow frame');
            }
            if(!signal.aborted)throw disconnected();
          } catch(error) {
            if(signal.aborted)return;
            // 单条会话流的错误仍如实失败；只有整条 DSH 连接丢失才恢复跟随。
            if(opened.socket===client.#socket || !client.reconnector || client.reconnector.stopped)throw error;
          } finally {opened.detach();raw.dispose();}
          try {await client.#waitReady(signal);}catch(error){if(signal.aborted)return;throw error;}
          if(signal.aborted)return;
          // 重新建会话订阅失败也走同一退避队列，不忙等。
          while(!signal.aborted) {
            try {opened=await client.#rawFollow(id,signal);break;}
            catch(error) {if(signal.aborted)return;if(error.code==='INCOMPATIBLE')throw error;client.#lost(disconnected());await client.#waitReady(signal);}
          }
        }
      } finally {opened.detach();opened.raw.dispose();}
    })();
    const dispose=()=>{controller.abort();opened.raw.dispose();};
    return {[Symbol.asyncIterator]:()=>iterator,next:()=>iterator.next(),return:async()=>{dispose();return iterator.return();},dispose};
  }
  dispose() { if (this.#disposed) return; this.#disposed = true; this.stopReconnect(); this.#lifetime.abort(); this.#lost(disconnected()); }
}
