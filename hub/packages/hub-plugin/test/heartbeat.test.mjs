import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {heartbeatOnline,watchApproval,OFFLINE,FALLBACK_TIMEOUT,HEARTBEAT_POLL,APPROVAL_TIMEOUT} from '../heartbeat.mjs';
fs.mkdirSync(path.join(os.homedir(),'dsh-work/tmp/r26-B'),{recursive:true});
const dir=fs.mkdtempSync(path.join(os.homedir(),'dsh-work/tmp/r26-B/','fixture-heartbeat-'));
let n=0;
function fixture(){const file=dir+'/'+n++ +'.json';const good={v:1,ts:Date.now(),pid:1,dshConnected:true,answering:true,devicePresent:true,deviceLastSeen:Date.now()};fs.writeFileSync(file,JSON.stringify(good));return {file,good};}
test('生产轮询2秒、兜底10分30秒',()=>{assert.equal(HEARTBEAT_POLL,2000);assert.equal(APPROVAL_TIMEOUT,630000);});
for(const [label,patch]of [['旧心跳',{ts:Date.now()-16000}],['未来心跳',{ts:Date.now()+60000}],['时间非数值',{ts:'2026'}],['未连DSH',{dshConnected:false}],['未回答',{answering:false}],['版本错误',{v:2}]])test('心跳失败关闭 '+label,()=>{const {file,good}=fixture();fs.writeFileSync(file,JSON.stringify({...good,...patch}));assert.equal(heartbeatOnline(file),false);});
test('缺失、损坏、链接文件拒绝，正常心跳通过',()=>{const {file}=fixture();assert.equal(heartbeatOnline(file),true);assert.equal(heartbeatOnline(file+'.missing'),false);const link=file+'.link';fs.symlinkSync(file,link);assert.equal(heartbeatOnline(link),false);fs.writeFileSync(file,'{');assert.equal(heartbeatOnline(file),false);});
test('问前失败不调用next',async()=>{let asked=0,failure;assert.equal(await watchApproval({file:dir+'/missing',next:()=>{asked++;},fail:r=>failure=r}),'rejected');assert.equal(asked,0);assert.equal(failure,OFFLINE);});
test('等待中失效及时拒绝，迟到批准不能复活',async()=>{const {file,good}=fixture();let release,failures=[];const downstream=new Promise(r=>release=r);const waiting=watchApproval({file,next:()=>downstream,fail:r=>failures.push(r),pollMs:10,timeoutMs:300});fs.writeFileSync(file,JSON.stringify({...good,ts:Date.now()-16000}));assert.equal(await waiting,'rejected');release('allowed-once');await Promise.resolve();assert.deepEqual(failures,[OFFLINE]);});
test('超时拒绝',async()=>{const {file}=fixture();let reason;assert.equal(await watchApproval({file,next:()=>new Promise(()=>{}),fail:r=>reason=r,pollMs:10,timeoutMs:30}),'rejected');assert.equal(reason,FALLBACK_TIMEOUT);});
test('取消拒绝且监听收尾',async()=>{const {file}=fixture(),ctrl=new AbortController();const p=watchApproval({file,signal:ctrl.signal,next:()=>new Promise(()=>{}),fail:()=>{}});ctrl.abort();assert.equal(await p,'rejected');});
for(const result of ['allowed-once','rejected','unavailable','cancelled','yes'])test('只接受明确allowed-once '+result,async()=>{const {file}=fixture();assert.equal(await watchApproval({file,next:async()=>result,fail:()=>{}}),result==='allowed-once'?'allowed-once':'rejected');});
test('批准瞬间心跳失效仍拒绝',async()=>{const {file}=fixture();assert.equal(await watchApproval({file,next:async()=>{fs.writeFileSync(file,'{}');return 'allowed-once';},fail:()=>{}}),'rejected');});
test('下游throw失败关闭',async()=>{const {file}=fixture();assert.equal(await watchApproval({file,next:()=>{throw Error('断开');},fail:()=>{}}),'rejected');});

for(const patch of [{devicePresent:false},{devicePresent:undefined}])test('G1 无设备或设备信息缺省仍在线，明确批准可通过',async()=>{const {file,good}=fixture();fs.writeFileSync(file,JSON.stringify({...good,...patch}));assert.equal(heartbeatOnline(file),true);let asked=0;assert.equal(await watchApproval({file,next:async()=>{asked++;return 'allowed-once';},fail:()=>assert.fail('不应因设备状态拒绝')}),'allowed-once');assert.equal(asked,1);});
test('G1 等待中设备离线不拒绝，仍由明确拒绝结束',async()=>{const {file,good}=fixture();let release,failures=[];const p=watchApproval({file,next:()=>new Promise(r=>release=r),fail:r=>failures.push(r),pollMs:5,timeoutMs:300});await new Promise(r=>setTimeout(r,10));fs.writeFileSync(file,JSON.stringify({...good,devicePresent:false}));await new Promise(r=>setTimeout(r,20));assert.deepEqual(failures,[]);release('rejected');assert.equal(await p,'rejected');assert.deepEqual(failures,['主人 没批准，这一步没做']);});
