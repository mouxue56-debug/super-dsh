// 只读核对本轮隔离测试会话，并取消本轮自己留下的悬挂无应答者测试。
import {readFile,writeFile} from 'node:fs/promises';import {homedir} from 'node:os';import {join} from 'node:path';import {DshClient} from '../lib/dsh-client.mjs';
const run=new URL('../run-r24test/',import.meta.url).pathname;
const dirs=(await import('node:fs/promises')).readdir;const names=(await dirs(run)).filter(n=>/^live-\d+$/u.test(n)).sort();
const log=await readFile(join(homedir(),'dsh-work/dev-home-r24scratch/run/dsh.out'),'utf8'),m=log.match(/http:\/\/127\.0\.0\.1:3490\/[^\s]+/u);if(!m)throw Error('3490 未就绪');
const auth=new URL(m[0]);auth.pathname='/connect';auth.searchParams.set('interactions','none');
const client=new DshClient({url:'http://127.0.0.1:3490',tokenFile:join(run,names[0],'synthetic-auth'),fetchImpl:(url,options)=>fetch(new URL(url).pathname==='/connect'?auth:url,options)});
try {
const catalog=await client.modelCatalog();if(catalog.default.provider!=='hub-fake-r24')throw Error('不是假模型实例，停止');
const sessions=await client.listSessions(),output=[];
for(const row of sessions.filter(s=>['R24 BFF 断开失败关闭','R24 BFF 假审批 approve','R24 BFF 假审批 reject'].includes(s.title))) {
 const records=(await client.rpc('session/events',{request:{address:{kind:'session',sessionId:row.id},maxMessages:200}})).records;
 const outcome={title:row.title,sessionId:row.id,events:records.map(r=>r.event.type),decisions:records.filter(r=>r.event.type==='approval/decided').map(r=>r.event.data),toolErrors:records.filter(r=>r.event.type==='tool/result').map(r=>({code:r.event.data.error?.code,text:r.event.data.message?.content?.filter(p=>p.type==='text').map(p=>p.text).join('')}))};
 if(!records.some(r=>r.event.type==='turn/end')){await client.cancel(row.id);outcome.cancelledOwnPendingTest=true;}output.push(outcome);
}
await writeFile(join(run,'no-answer-diagnostic.json'),JSON.stringify(output,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(output,null,2));
} finally {client.dispose();}
