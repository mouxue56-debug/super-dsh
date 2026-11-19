import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DshClient, DEFAULT_CWD } from '../lib/dsh-client.mjs';
import {seedRoster} from './roster-fixture.mjs';
import { createHandler } from '../server.mjs';
export const TMP = process.env.HUB_BFF_TEST_TMP ?? fileURLTmp();
function fileURLTmp() { return new URL('./.tmp/',import.meta.url).pathname; }
export async function testDirectory() { await mkdir(TMP,{recursive:true,mode:0o700}); return mkdtemp(join(TMP,'bff-test-')); }
export async function secretFile(value = 'in-memory-test-token') {
  const directory = await testDirectory(); const path = join(directory,'secret');
  await writeFile(path,value,{mode:0o600}); return path;
}
export const userEvent = (seq,text = 'hello') => ({type:'event',event:{type:'user/message',seq,time:seq * 1000,surfaceOp:'append',data:{role:'user',source:{kind:'user'},content:[{type:'text',text}]}}});
export const assistantEvent = (seq,text = 'echo') => ({type:'event',event:{type:'assistant/message',seq,time:seq * 1000,surfaceOp:'append',data:{message:{role:'assistant',source:{kind:'model'},content:[{type:'text',text}]}}}});
export const snapshot = (records = [], cursor = 0) => ({type:'snapshot',cursor,records,hasMore:false,header:{id:'s1'},projections:{}});
export class MemoryUpstream {
  calls = []; streams = new Map(); eventStreams = new Map(); sockets = []; records = []; nextId = 1; lostAdmission = false; initialSnapshot = snapshot(); holdSnapshot = false;
  fetch = async (url,init) => {
    url = new URL(url); this.calls.push({endpoint:url.pathname,args:init?.body ? JSON.parse(init.body).payload.args : undefined});
    if (url.pathname === '/connect') return new Response(null,{status:302,headers:{location:'./api/remote.mux','set-cookie':'session=synthetic-cookie; HttpOnly'}});
    const envelope = JSON.parse(init.body); const args = envelope.payload.args;
    if (this.rpcOverride) { const value = await this.rpcOverride(envelope); if (value) return value; }
    let value;
    switch (envelope.method) {
      case '$events/result': value = undefined; break;
      case 'session/list': value = {items:[{sessionId:'s1',updatedAt:900,projections:{kind:'sequenced',asOfSeq:3,values:{title:'First'}}}]}; break;
      case 'session/create': value = {sessionId:'created-'+this.nextId++}; break;
      case 'session/rename': value = {title:args.request.title,seq:1}; break;
      case 'session/prompt': if(this.lostAdmission) throw new Error('synthetic-cookie PRIVATE_TOKEN stack'); value = {accepted:true}; break;
      case 'session/cancel': value = {accepted:true}; break;
      case 'session/events': value = {records:this.recordsFor?.(args.request.address.sessionId) ?? this.records,cursor:100,hasMore:false}; break;
      case 'session/modelCatalog': value = {default:{provider:'hub-fake',model:'echo-1'}}; break;
      default: return this.response(envelope,{ok:false,error:{code:'gateway/not-found',message:'secret upstream stack',details:{}}});
    }
    return this.response(envelope,{ok:true,value});
  };
  response(envelope,result) { return new Response(JSON.stringify({type:'server-response',rpcId:envelope.rpcId,result}),{headers:{'content-type':'application/json'}}); }
  socketFactory = () => {
    const socket = new EventEmitter(); socket.readyState = 0;
    socket.send = text => {
      const message = JSON.parse(text); this.calls.push({endpoint:message.type,args:message});
      if (message.type === 'open' && message.endpoint==='$events') {
        this.eventStreams.set(message.streamId,{socket,message});
        if (!this.holdEventsReady) queueMicrotask(()=>socket.emit('message',Buffer.from(JSON.stringify({type:'item',streamId:message.streamId,value:{type:'ready',clientId:'event-client',host:{home:'/synthetic'}}}))));
      } else if (message.type === 'open') {
        this.streams.set(message.streamId,{socket,message});
        if (!this.holdSnapshot) queueMicrotask(() => this.frame(message.streamId,this.snapshotFor?.(message.payload.args.request.address.sessionId) ?? this.initialSnapshot));
      } else if (message.type === 'cancel') {this.streams.delete(message.streamId);this.eventStreams.delete(message.streamId);}
    };
    socket.close = () => { if(socket.readyState === 3)return;socket.readyState=3;for(const [id,s] of this.streams)if(s.socket===socket)this.streams.delete(id);for(const [id,s] of this.eventStreams)if(s.socket===socket)this.eventStreams.delete(id);socket.emit('close'); };
    this.sockets.push(socket);queueMicrotask(()=>{socket.readyState=1;socket.emit('open');});return socket;
  };
  frame(id,value,type = 'item') { const entry = this.streams.get(id); if(entry)entry.socket.emit('message',Buffer.from(JSON.stringify({type,streamId:id,value}))); }
  emit(value,session = 's1') { for(const [id,entry] of this.streams) if (entry.message.payload.args.request.address.sessionId === session) this.frame(id,value); }
  interaction(value) { for(const [streamId,{socket}] of this.eventStreams)socket.emit('message',Buffer.from(JSON.stringify({type:'item',streamId,value}))); }
  named(endpoint) { return this.calls.filter(call => call.endpoint === '/api/'+endpoint).map(call => call.args); }
}
export async function fixture(options = {}) {
  const source = new MemoryUpstream(); const tokenFile = await secretFile();
  const client = new DshClient({url:'http://127.0.0.1:13290',tokenFile,fetchImpl:source.fetch,socketFactory:source.socketFactory,timeoutMs:1000});
  const directory = await testDirectory(); const botsDir = join(directory,'bots');
  for (const bot of ['chief','support','content','pm','art','research']) await mkdir(join(botsDir,bot),{recursive:true});
  const storeFile = join(directory,'store.json'), callLogFile = join(directory,'calls.log');
  if (options.seed !== false) await writeFile(storeFile,JSON.stringify({sessions:[{id:'s1',bot:'chief',title:'First',lastText:'',lastRole:null,updatedAt:900,unread:0,running:false}]}),{mode:0o600});
  const key = 'synthetic-bff-key';
  const handlerOptions = {hubHome:directory,storeFile,callLogFile,botsDir,requireBot:options.requireBot ?? false,configDir:join(directory,'config'),ticketsDir:join(directory,'tickets'),interactions:options.interactions ?? false,phrasesFile:join(directory,'missing-phrases.json'),...options.handlerOptions};
  await seedRoster(directory,handlerOptions);
  const handler = createHandler({client,key,...handlerOptions}); await handler.ready;
  const f = {source,client,key,handler,cwd:DEFAULT_CWD,storeFile,callLogFile,botsDir,handlerOptions,
    async dispose(){await f.handler.dispose();client.dispose();}};
  return f;
}
export function request(handler,{method='GET',path='/bff/health',key='synthetic-bff-key',value,raw,headers={}} = {}) {
  const req = Readable.from([Buffer.from(raw ?? (value === undefined ? '' : JSON.stringify(value)))]);
  req.method=method;req.url=path;req.headers={...(key===null?{}:{'x-hub-bff-key':key}),...headers};
  const res = new EventEmitter();res.text='';res.headersSent=false;res.writableEnded=false;res.destroyed=false;res.writableLength=0;
  res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;res.headersSent=true;res.emit('headers');};
  res.write=text=>{res.text+=text;res.emit('chunk',text);return true;};res.flushHeaders=()=>{};
  res.end=text=>{if(text)res.text+=text;res.writableEnded=true;res.emit('finish');};
  res.destroy=()=>{res.destroyed=true;res.emit('close');};
  const done = handler(req,res);return {req,res,done,async json(){await done;return JSON.parse(res.text);}};
}
