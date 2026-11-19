import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHubWeb} from '../server.mjs';
import {startMockBff} from './mock-bff.mjs';
const require=createRequire(import.meta.url);
const {delegationSummary,delegationLabel,delegationSteps,canContinue,stoppedTurn,stoppedSession,friendlyError}=require('../hub-real.js');
const limited='做了 8 步还没做完，按规矩先停了：已完成 3 件，剩 2 件';

test('C7：摘要清理 Markdown、嵌套链接、参考链接、换行，Unicode不截断',()=>{
 assert.equal(delegationSummary('## **交付** ##\n- [文档](https://example.invalid/a_(b))\n1. `说明`\n> ~~旧~~\n[参考][id]\n[id]: https://example.invalid\n```js\n代码\n```'),'交付 文档 说明 旧 参考 代码');
 assert.equal(delegationSummary('😀'.repeat(401)),'😀'.repeat(400));
 assert.equal(delegationSummary('#无空格标题\n__完成__'),'无空格标题 完成');
});
test('C7：旧枚举兜底，不破坏文件名，BFF的人话原样保留',()=>{
 const old='第3步：tool_use；running / failed：max_steps；cancelled';
 assert.equal(delegationLabel(old),'第3步：在处理工具；在做 / 没能完成：达到步数上限；已停止');
 for(const label of ['读了 notes/running.md','写了 drafts/failed','列了 drafts/','在写回复','被拒：主人 没批准'])assert.equal(delegationLabel(label),label);
 assert.equal(delegationLabel('ERROR unavailable STEP-LIMIT'),'没做成 这一步没做 达到步数上限');
});
test('C7：四步不折叠，五步需折叠，生命周期不计入工作步数、不改输入',()=>{
 for(const count of [0,4,5,8]){
  const steps=['派出','开始',...Array.from({length:count},(_,i)=>'读了 notes/'+i+'.md'),'完成'].map(label=>({label,ts:1}));
  const original=JSON.stringify(steps),value=delegationSteps(steps);
  assert.equal(value.count,count);assert.equal(JSON.stringify(steps),original);assert.equal(value.steps.length,count+3);
 }
 assert.equal(delegationSteps([{label:'派出：排队第 2 位'},{label:'开始：处理草稿'},{label:'完成：已回报'},{label:'完成了一项操作'}]).count,1);
 assert.deepEqual(delegationSteps([null,'running',{}, {label:'done'}]).steps.map(s=>s.label),['','完成']);
});
test('C7：仅步数上限失败可续，已续及非失败一律不能再续',()=>{
 for(const reason of [limited,'做了 8 步还没做完，按规矩先停了：已完成 0 件，剩下的没做','超过 8 步自动停'])assert(canContinue({status:'failed',reason}));
 assert(canContinue({status:'failed',failureKind:'step-limit'}));
 for(const status of ['queued','running','done'])assert(!canContinue({status,reason:limited}));
 for(const reason of ['派活已取消','BFF 重启，派活中断','这次没做成'])assert(!canContinue({status:'failed',reason}));
 assert(!canContinue({status:'failed',reason:limited,continuedBy:'新工单'}));
});
test('C7：五类停止原因映射，普通失败和用户文本不能推断成停止',()=>{
 for(const reason of ['aborted','cancelled','canceled','interrupted','stopped']){assert(stoppedTurn(reason));assert(stoppedTurn({kind:reason}));}
 assert(!stoppedTurn('error'));assert(!stoppedTurn('请把 stopped 写入文档'));
 assert(stoppedSession({lastText:'已停止',lastRole:'error',running:false}));
 for(const s of [{lastText:'出错了',lastRole:'error'},{lastText:'已停止',lastRole:'assistant'},{lastText:'已停止',lastRole:'error',running:true}])assert(!stoppedSession(s));
});
test('C7：502/503和网络故障为未连上，超时和丢失回执仍为确认未知',()=>{
 for(const error of [{status:502},{status:503},new TypeError('Failed to fetch'),{definitelyUnsent:true}])assert.match(friendlyError(error),/没连上服务，这句没发出去/);
 for(const error of [{name:'TimeoutError'},{name:'AbortError'},new Error('服务返回无效内容'),new Error('发送结果未知')])assert.match(friendlyError(error),/没收到发送确认.*重新加载/);
});
test('C7：续做代理要求有效cookie和同源Origin，设备头不可伪造，新旧卡只续一次',async()=>{
 const root=fileURLToPath(new URL('./scratch/',import.meta.url));await mkdir(root,{recursive:true});
 const dir=await mkdtemp(join(root,'c7-')),shell=join(dir,'shell');await mkdir(shell);await writeFile(join(shell,'index.html'),'<html><body>假壳</body></html>');
 await writeFile(join(dir,'web.fixture'),'c7-offline-web',{mode:0o600});await writeFile(join(dir,'bff.fixture'),'c7-offline-bff',{mode:0o600});
 const fake=await startMockBff(),app=await createHubWeb({HUB_WEB_PORT:'0',HUB_WEB_SHELL_DIR:shell,HUB_WEB_KEY_FILE:join(dir,'web.fixture'),BFF_KEY_FILE:join(dir,'bff.fixture'),BFF_URL:fake.url},{log:()=>{}});
 const url='http://127.0.0.1:'+app.servers[0].address().port;
 try{
  const login=await fetch(url+'/?key=c7-offline-web',{redirect:'manual'}),cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie,Origin:url,'Content-Type':'application/json'},post=(path,value={},extra=headers)=>fetch(url+'/bff'+path,{method:'POST',headers:extra,body:JSON.stringify(value)});
  assert.equal((await post('/__fixture',{id:'delegation-1',status:'failed',reason:limited,failureKind:'step-limit'})).status,200);
  const before=fake.stats.headers.length,path='/delegations/delegation-1/continue';
  for(const h of [{Origin:url},{Cookie:cookie},{...headers,Origin:'null'},{...headers,Origin:'http://example.invalid'},{...headers,'Sec-Fetch-Site':'cross-site'}])assert.equal((await post(path,{},h)).status,403);
  assert.equal(fake.stats.headers.length,before,'拒绝请求不得到达假BFF');
  const responses=await Promise.all([post(path,{}, {...headers,'X-Hub-Device':'spoof'}),post(path)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const success=await responses.find(r=>r.status===200).json();
  assert.equal(success.continuedBy,success.card.continuedBy);assert.equal(success.continuation.id,success.continuedBy);assert.equal(success.continuation.sessionId,'chief-latest');assert.equal(success.continuation.bot,'pm');assert.equal(success.continuation.status,'queued');
  assert.match(success.continuation.task,/接着做上一张工单 delegation-1 剩下的部分，已完成的不要重做/);
  assert.equal(fake.stats.continuations.length,1);assert.match(fake.stats.continuations[0].device,/^[a-f0-9]{16}$/);assert.notEqual(fake.stats.continuations[0].device,'spoof');
  const data=await (await fetch(url+'/bff/sessions/chief-latest/cards',{headers:{Cookie:cookie}})).json();assert.equal(data.cards.filter(c=>c.id===success.continuedBy).length,1);
 }finally{await app.close();await fake.close();}
});
