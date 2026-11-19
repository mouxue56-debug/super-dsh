import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {canonicalize,within,inspectTicket} from './policy.mjs';
export const COLS=['new','working','done','failed','blocked'];
const clean=s=>String(s??'').replace(/[\r\n\t]/g,' ');
export function appendAction(policy,bot,tool,target,level) {
 const dir=canonicalize(policy.base+'/config','/'); if(!within(dir,policy.base+'/config')) throw Error('日志目录越界'); fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const fd=fs.openSync(path.join(dir,'actions.log'),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
 try {fs.fchmodSync(fd,0o600);fs.writeSync(fd,[new Date().toISOString(),bot,tool,clean(target),level].join('\t')+'\n');} finally {fs.closeSync(fd);}
}
export function atomicWrite(file,text) {
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=path.join(path.dirname(file),'.'+path.basename(file,'.md')+'.tmp');
 const fd=fs.openSync(tmp,'wx',0o600);try {fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);} finally {fs.closeSync(fd);}fs.renameSync(tmp,file);
}
function dir(policy,col) {if(!COLS.includes(col)) throw Error('目标栏无效'); const p=canonicalize(policy.base+'/tickets/'+col,'/');if(!within(p,policy.base+'/tickets')) throw Error('工单目录越界');fs.mkdirSync(p,{recursive:true,mode:0o700});return p;}
export function createTicket(policy,bot,{title,body,assignee,task,sessionId},delegation=false) {
 if(!policy.bots.includes(bot) || (assignee!==undefined && !policy.bots.includes(assignee))) throw Error('助理无效');
 if(typeof body!=='string' || !body.trim() || body.length>(delegation?2000:20000) || typeof title!=='string' || !title.trim() || title.length>200 || /[\r\n]/.test(title)) throw Error('标题或正文无效');
 if(delegation && (policy.roster?.find(b=>b.id===bot)?.role!=='chief' || !sessionId || /[\r\n]/.test(sessionId))) throw Error('派活来源会话不可核实');
 const now=new Date().toISOString(),stamp=now.replace(/[-:T]/g,'').slice(0,14),id=`T-${stamp.slice(0,8)}-${stamp.slice(8)}-${randomBytes(2).toString('hex')}`;
 const queued=delegation?workingTickets(policy).filter(t=>t.meta.assignee===assignee && ['queued','running'].includes(t.meta.status)).length:0;
 const meta={id,kind:delegation?'delegation':'note',creator:bot,assignee:assignee??bot,status:delegation?'queued':'new',createdAt:now,updatedAt:now,...delegation?{fromSession:sessionId,toSession:'',steps:0}: {title}};
 const raw='---\n'+Object.entries(meta).map(([k,v])=>`${k}: ${v}`).join('\n')+'\n---\n## 任务\n'+body+'\n## 进度\n- '+now+(delegation?` 首席派出（排队第 ${queued+1} 位）`:' 新建工单')+'\n## 回报\n';
 const file=path.join(dir(policy,delegation?'working':'new'),id+'.md');if(fs.existsSync(file)) throw Error('工单重号，请稍后重试'); atomicWrite(file,raw);return {id,path:file,queued};
}
export function workingTickets(policy) {
 const root=canonicalize(policy.base+'/tickets/working','/'); if(!within(root,policy.base+'/tickets')) throw Error('工单目录越界');
 try {return fs.readdirSync(root).filter(n=>/^T-\d{8}-\d{6}-[a-f0-9]{4}\.md$/.test(n)).map(n=>inspectTicket(policy,n.slice(0,-3)));} catch(e) {if(e.code==='ENOENT') return [];throw e;}
}
export function updateTicket(policy,bot,args,approved=false) {
 const t=inspectTicket(policy,args.id); if(t.meta.kind==='delegation') throw Error('派活工单只能由 BFF 更新或移动'); if(t.meta.creator!==bot && !approved) throw Error('别人的工单需要 主人 批准');
 if(args.status!==undefined && !['new','queued','running','done','failed','blocked'].includes(args.status)) throw Error('状态无效');
 if(args.append!==undefined && (typeof args.append!=='string' || args.append.length>20000)) throw Error('追加内容无效');
 const now=new Date().toISOString();let raw=t.raw.replace(/^updatedAt: .*$/m,'updatedAt: '+now);
 if(args.status!==undefined) raw=raw.replace(/^status: .*$/m,'status: '+args.status);
 if(args.append) raw=raw.replace('\n## 回报\n',`\n- ${now} ${args.append}\n## 回报\n`);
 atomicWrite(t.path,raw);return t.path;
}
export function moveTicket(policy,bot,args,approved=false) {
 const t=inspectTicket(policy,args.id);if(t.meta.kind==='delegation') throw Error('派活工单只能由 BFF 更新或移动');if(t.meta.creator!==bot && !approved) throw Error('别人的工单需要 主人 批准');
 const destination=path.join(dir(policy,args.to),args.id+'.md');if(destination===t.path) return destination;if(fs.existsSync(destination)) throw Error('目标工单已存在');fs.renameSync(t.path,destination);return destination;
}
export function botStatus(policy) {
 const tickets=workingTickets(policy);let known={};const f=canonicalize(policy.base+'/config/bot-status.json','/');if(!within(f,policy.base+'/config')) throw Error('状态文件越界');
 try {const st=fs.statSync(f);if(!st.isFile()||st.size>262144)throw Error('状态文件不安全');known=JSON.parse(fs.readFileSync(f,'utf8'));} catch(e){if(e.code!=='ENOENT')throw e;}
 return policy.bots.map(id=>{const info=(Array.isArray(known.bots)?known.bots.find(b=>b.id===id||b.bot===id):known.bots?.[id]??known[id])??{};return {bot:id,running:info.running===true||tickets.some(t=>t.meta.assignee===id&&t.meta.status==='running'),pending:Number.isSafeInteger(info.pending)&&info.pending>=0?info.pending:0,queued:tickets.filter(t=>t.meta.assignee===id&&t.meta.status==='queued').length};});
}

// 监工 r24：插件在审批前判拒（心跳不在线）时，也按 BFF 的 approvals.log 格式记一行，结果 unavailable，设备列为 -。
export function appendApproval(policy,bot,tool,target,result) {
 const dir=canonicalize(policy.base+'/config','/'); if(!within(dir,policy.base+'/config')) throw Error('日志目录越界');
 const fd=fs.openSync(path.join(dir,'approvals.log'),fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
 try {fs.writeSync(fd,[new Date().toISOString(),bot,tool,clean(target),result,'-'].join('\t')+'\n');} finally {fs.closeSync(fd);}
}
