import { posix } from 'node:path';
const cut=(value,n)=>Array.from(String(value ?? '')).slice(0,n).join('');
export const STEP_LIMIT='超过 8 步自动停';
export const stoppedReason=reason=>['aborted','cancelled','canceled','interrupted','stopped'].includes(reason);
export const isStepLimit=reason=>reason===STEP_LIMIT || /^做了 8 步还没做完，按规矩先停了：已完成 \d+ 件，(?:剩 \d+ 件|剩下的没做)$/u.test(reason ?? '');
function linkText(text) {
 const pattern=/!?\[([^\]\n]*)\]\(/gu;let out='',cursor=0,match;
 while((match=pattern.exec(text))) {
  let end=pattern.lastIndex,depth=1;
  for(;end<text.length&&depth;end++) {
   if(text[end]==='\\'){end++;continue;}
   if(text[end]==='(')depth++;else if(text[end]===')')depth--;
  }
  if(depth)continue;
  out+=text.slice(cursor,match.index)+match[1];cursor=end;pattern.lastIndex=end;
 }
 return out+text.slice(cursor);
}
export function plainSummary(value) {
 return cut(linkText(String(value ?? ''))
  .replace(/^\s*\[[^\]\n]+\]:\s+.*$/gmu,'')
  .replace(/\[([^\]\n]*)\]\[[^\]\n]*\]/gu,'$1')
  .replace(/^\s*(?:```|~~~).*$/gmu,'')
  .replace(/^\s{0,3}#{1,6}\s*/gmu,'')
  .replace(/[ \t]+#+[ \t]*$/gmu,'')
  .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gmu,'')
  .replace(/^\s*>\s*/gmu,'')
  .replace(/\*\*|__|~~|`/gu,'')
  .replace(/\*([^*\n]+)\*/gu,'$1')
  .replace(/(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu,'$1')
  .replace(/\s+/gu,' ').trim(),400);
}
function pathLabel(path,cwd) {
 if(typeof path!=='string'||!path.trim())return '文件';
 const value=posix.normalize(path.replace(/[\r\n\t]/gu,' '));
 const own=posix.normalize(cwd ?? '');
 return cut(value.startsWith(own+'/')?value.slice(own.length+1):value.replace(/^\.\//u,''),120);
}
export function toolLabel(tool,cwd) {
 const path=pathLabel(tool.path,cwd), ok=tool.status==='ok';
 if(['denied','rejected','revised','timeout','unavailable'].includes(tool.status))return '被拒：'+plainSummary(tool.brief || ({timeout:'没等到你点头',unavailable:'审批通道不在线',revised:'按 主人 的意见重做'})[tool.status] || '主人 没批准');
 if(tool.status==='error')return '没做成：'+plainSummary(tool.brief || '这一步没做成');
 if(tool.status==='pending')return '等你批准这一步';
 if(tool.status==='approved')return '已获批准，等工具完成';
 switch(tool.name) {
  case 'read':return (ok?'读了 ':'在读 ')+path;
  case 'write':return (ok?'写了 ':'在写 ')+path;
  case 'edit':return (ok?'改了 ':'在改 ')+path;
  case 'list_files':return (ok?'列了 ':'在列 ')+(path.endsWith('/')?path:path+'/');
  case 'ticket_create':return ok?'建了一张工单':'在建工单';
  case 'ticket_update':return ok?'更新了一张工单':'在更新工单';
  case 'ticket_move':return ok?'移动了一张工单':'在移动工单';
  case 'bot_status':return ok?'看了助理的忙闲':'在看助理的忙闲';
  case 'delegate_to_bot':return ok?'派出一张工单':'在派活';
  default:return ok?'完成了一项操作':'在处理一项操作';
 }
}
// 只认任务开头明确给出的交付总数；不从模糊的回复或工具成功数猜总量。
export function taskTotal(task) {
 const m=/^\s*(?:请)?(?:新建|创建|写入|编写|写|生成)\s*(?:(?:总共|共)\s*)?(\d{1,3})\s*(?:个|份|张)?\s*(?:文件|文档|工单)(?:[，。,:：\s]|$)/u.exec(task);
 return m && Number(m[1])>0 ? Number(m[1]) : null;
}
export function limitReport(completed,total=null) {
 return '做了 8 步还没做完，按规矩先停了：已完成 '+completed+' 件，'+(total===null?'剩下的没做':'剩 '+Math.max(0,total-completed)+' 件');
}
