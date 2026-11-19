import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,stat,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {parseApproval} from '../lib/runtime.mjs';
import {project} from '../lib/timeline.mjs';
import {fixture,request} from './fixtures.mjs';
const good={v:1,bot:'chief',sessionId:'s1',level:'L3',action:'跑命令',tool:'bash',path:'/fixture/bots/chief',chars:20,preview:'curl https://example.invalid',command:'curl https://example.invalid',cwd:'/fixture/bots/chief',why:'核对公开资料',timeoutMs:60000,caps:{network:true,writeRoots:[],longRunning:false},grantable:true,grantKey:{program:'curl',dir:'/fixture/bots/chief'}};
const reason=v=>'HUBAPPROVAL1 '+JSON.stringify(v),headers={'x-hub-device':'r26-test-device'};
const call=(f,method,path,value,withDevice=true)=>request(f.handler,{method,path,value,headers:withDevice?headers:{}});
async function eventually(fn) {for(let i=0;i<300;i++){if(await fn())return;await delay(5);}assert.fail('等待待批卡超时');}
async function setup(fn) {const f=await fixture();try{await fn(f);}finally{await f.dispose();}}
async function ask(f,id='r26-a',value=good) {
 const req={toolName:'bash',callId:id,reason:reason(value)};
 f.source.records=[{event:{seq:1,type:'approval/asked',data:{id,...req}}}];
 const promise=f.handler.runtime.receive({eventId:id,agentId:'s1',request:req},new AbortController().signal);
 await eventually(()=>f.handler.runtime.cards().some(c=>c.id===id));
 return {promise,card:f.handler.runtime.cards().find(c=>c.id===id)};
}
const answer=(f,id='r26-a',extra={remember:true})=>call(f,'POST','/bff/approvals/'+id+'/answer',{decision:'approve',...extra});
test('r26 命令原因串：完整字段、空 why、不可放行形状；旧写卡不变',()=>{
 assert.deepEqual(parseApproval(reason(good)),good);
 assert.equal(parseApproval(reason({...good,why:''})).why,'');
 assert.equal(parseApproval(reason({...good,grantable:false,grantKey:undefined})).grantable,false);
 const old={v:1,bot:'chief',level:'L3',action:'写共享区',tool:'write',path:'/fixture/shared/a',chars:1,preview:'一'};assert.deepEqual(parseApproval(reason(old)),old);
});
test('r26 命令字段严格失败关闭：类型、边界、绝对路径、控制字符、权限形状',()=>{
 const values=[...['command','cwd','why','timeoutMs','caps','grantable','grantKey'].map(k=>({...good,[k]:undefined})),
 {...good,command:'😀'.repeat(2001)},{...good,why:'字'.repeat(201)},{...good,timeoutMs:0},{...good,timeoutMs:600001},{...good,timeoutMs:1.1},
 {...good,cwd:'relative'},{...good,command:'ls\npwd'},{...good,why:'a\tb'},{...good,cwd:'/a\u0000b'},{...good,preview:'a\tb'},
 {...good,caps:{network:1,writeRoots:[],longRunning:false}},{...good,caps:{network:false,writeRoots:['relative'],longRunning:false}},
 {...good,caps:{network:false,writeRoots:[],longRunning:false,extra:true}},{...good,caps:{network:false,writeRoots:[]}},
 {...good,grantKey:{program:'curl',dir:'/a',extra:'bad'}},{...good,grantKey:{program:'curl\tbad',dir:'/a'}},
 {...good,grantKey:{program:'curl',dir:'relative'}},{...good,grantable:false}];
 for(const value of values)assert.equal(parseApproval(reason(value)),null,JSON.stringify(value));
 assert.ok(parseApproval(reason({...good,command:'😀'.repeat(2000),why:'字'.repeat(200),timeoutMs:600000})));
});
test('r26 命令卡保留插件 why 与全文，不拿上下文替换',()=>setup(async f=>{
 const a=await ask(f);for(const k of ['command','cwd','why','timeoutMs','caps','grantable','grantKey'])assert.deepEqual(a.card[k],good[k]);
 await answer(f,'r26-a',{remember:false}).done;assert.equal(await a.promise,'allowed-once');
}));
test('r26 remember 先持久规则及日志，随后才答 allowed-once；文件为0600',()=>setup(async f=>{
 const a=await ask(f);let answered=false;a.promise.then(()=>{answered=true;});
 const rt=f.handler.runtime,original=rt.grants.atomicFile;let release,entered;const barrier=new Promise(r=>{entered=r;});
 rt.grants.atomicFile=async(...args)=>{if(args[0].endsWith('command-grants.json')){entered();await new Promise(r=>{release=r;});}return original(...args);};
 const response=answer(f);await barrier;assert.equal(answered,false);assert.equal(a.card.status,'pending');
 const concurrent=answer(f);await concurrent.done;assert.equal(concurrent.res.status,409);
 release();const data=await response.json();assert.equal(data.card.status,'approved');assert.equal(await a.promise,'allowed-once');
 const config=f.handlerOptions.configDir,list=(await call(f,'GET','/bff/grants').json()).grants;assert.equal(list.length,1);assert.equal(list[0].status,'active');
 assert.equal(list[0].program,'curl');assert.equal(list[0].by,'owner');assert.match(list[0].tag,/^#by\/owner #on\/\d{4}-\d{2}-\d{2} #until\//);
 for(const file of ['command-grants.json','permissions.changes.log','approvals.log'])assert.equal((await stat(join(config,file))).mode&0o777,0o600);
 assert.match(await readFile(join(config,'approvals.log'),'utf8'),/\tapproved\+remember\tr26-test-device\n$/);
 assert.match(await readFile(join(config,'permissions.changes.log'),'utf8'),/\tgrant-add\tchief\tcurl\t/);
}));
test('r26 remember 规则写失败503，卡仍pending，内核未收到批准，可重试',()=>setup(async f=>{
 const a=await ask(f),rt=f.handler.runtime,original=rt.grants.atomicFile;let answered=false;a.promise.then(()=>{answered=true;});
 rt.grants.atomicFile=async()=>{throw Error('故意失败');};const bad=answer(f);await bad.done;assert.equal(bad.res.status,503);assert.equal(answered,false);assert.equal(a.card.status,'pending');
 rt.grants.atomicFile=original;await answer(f).done;assert.equal(await a.promise,'allowed-once');
}));
test('r26 remember 日志失败回滚规则，卡不批准',()=>setup(async f=>{
 const a=await ask(f),rt=f.handler.runtime,original=rt.grants.log;
 rt.grants.log=async()=>{throw Error('故意失败');};const bad=answer(f);await bad.done;assert.equal(bad.res.status,503);assert.equal(a.card.status,'pending');assert.deepEqual(await rt.grants.list(),[]);
 rt.grants.log=original;await answer(f,'r26-a',{remember:false,decision:'reject'}).done;assert.equal(await a.promise,'rejected');
}));
test('r26 remember 类型、decision、可放行标志及设备校验',()=>setup(async f=>{
 const a=await ask(f,'r26-a',{...good,grantable:false,grantKey:undefined});
 for(const extra of [{remember:true},{remember:'yes'},{decision:'reject',remember:true},{decision:'revise',remember:true,note:'改'}]){const r=answer(f,'r26-a',extra);await r.done;assert.equal(r.res.status,400);}
 const no=call(f,'POST','/bff/approvals/r26-a/answer',{decision:'approve'},false);await no.done;assert.equal(no.res.status,400);
 assert.equal(a.card.status,'pending');await answer(f,'r26-a',{remember:false,decision:'reject'}).done;assert.equal(await a.promise,'rejected');
}));
test('r26 东京日期跨日、配置天数、有效规则去重延期',()=>setup(async f=>{
 const rt=f.handler.runtime;rt.now=()=>Date.parse('2026-11-17T15:30:00Z');rt.grants.now=rt.now;
 await writeFile(join(f.handlerOptions.configDir,'tool-levels.yaml'),'cmd_grant_days: 7\n');
 let a=await ask(f);await answer(f).done;await a.promise;
 let list=await rt.grants.list();assert.equal(list[0].on,'2026-11-18');assert.equal(list[0].until,'2026-11-25');const id=list[0].id;
 rt.now=()=>Date.parse('2026-11-19T15:30:00Z');rt.grants.now=rt.now;a=await ask(f,'r26-b');await answer(f,'r26-b').done;await a.promise;
 list=await rt.grants.list();assert.equal(list.length,1);assert.equal(list[0].id,id);assert.equal(list[0].until,'2026-11-27');
 assert.match(await readFile(join(f.handlerOptions.configDir,'permissions.changes.log'),'utf8'),/\tgrant-extend\t/);
 rt.grants.now=()=>Date.parse('2026-11-26T15:00:00Z');assert.equal((await rt.grants.list())[0].status,'active');rt.grants.now=()=>Date.parse('2026-11-27T15:00:00Z');assert.equal((await rt.grants.list())[0].status,'expired');
}));
test('r26 撤销要设备，写 revokedAt 与日志，重复撤销幂等，历史保留',()=>setup(async f=>{
 const a=await ask(f);await answer(f).done;await a.promise;const g=(await f.handler.runtime.grants.list())[0],path='/bff/grants/'+g.id+'/revoke';
 const no=call(f,'POST',path,{},false);await no.done;assert.equal(no.res.status,400);
 const response=await call(f,'POST',path,{}).json();assert.equal(response.grant.status,'revoked');assert.ok(response.grant.revokedAt);
 await call(f,'POST',path,{}).done;const log=await readFile(join(f.handlerOptions.configDir,'permissions.changes.log'),'utf8');assert.equal(log.match(/grant-revoke/g).length,1);
 assert.equal((await call(f,'GET','/bff/grants').json()).grants[0].status,'revoked');
 const absent=call(f,'POST','/bff/grants/missing/revoke',{});await absent.done;assert.equal(absent.res.status,404);
}));
test('r26 损坏放行文件不能覆盖，审批保持待批',()=>setup(async f=>{
 const rt=f.handler.runtime,path=rt.grants.file;await writeFile(path,'not-json');const a=await ask(f),r=answer(f);await r.done;assert.equal(r.res.status,503);assert.equal(a.card.status,'pending');assert.equal(await readFile(path,'utf8'),'not-json');
 await answer(f,'r26-a',{remember:false,decision:'reject'}).done;await a.promise;
}));
test('r26 命令轨迹包含全文及 UTF8 前4KB，提取全文路径；文件工具仍不投影正文',()=>{
 const records=[{seq:1,type:'tool/call',data:{name:'bash',callId:'b',arguments:{command:'printf example',workdir:'/fixture/bots/chief'}}},
 {seq:2,type:'tool/result',data:{message:{toolCallId:'b',isError:false,content:[{type:'text',text:'😀'.repeat(1500)+'\n（输出共 6000 字节，只显示前 4KB；全文在 bots/chief/outputs/cmd.txt）'}]}}}];
 const t=project(records).surface()[0].tools[0];assert.equal(t.command,'printf example');assert.equal(t.status,'ok');assert.equal(Buffer.byteLength(t.output),4096);assert.equal(t.outputTruncated,true);assert.equal(t.outputPath,'bots/chief/outputs/cmd.txt');assert(!t.output.includes('�'));
 const file=project([{seq:1,type:'tool/call',data:{name:'read',callId:'r',arguments:{path:'/file',secret:'PRIVATE'}}},{seq:2,type:'tool/result',data:{message:{toolCallId:'r',isError:false,content:[{type:'text',text:'PRIVATE'}]}}}]).surface()[0].tools[0];assert(!('output' in file));assert(!JSON.stringify(file).includes('PRIVATE'));
});
