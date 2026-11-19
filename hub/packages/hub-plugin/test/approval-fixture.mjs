// 仅隔离3490的验收夹具，普通六预设从不挂载。只批准唯一测试前缀的共享区write。
import os from 'node:os';
export const name='hub-test-approval';
export const inject=['approval'];
export function apply(ctx) {
 ctx.on('approval/request',async(req,next)=>{
  if(req.agent.session.header.agentPreset!=='hub-chief'||req.toolName!=='write'||!req.reason?.startsWith('HUBAPPROVAL1 '))return next();
  let p;try{p=JSON.parse(req.reason.slice(13));}catch{return next();}
  const prefix=os.homedir()+'/dsh-work/shared/r24-a-approved-';
  if(p.path?.startsWith(prefix)&&/^\d+\.md$/.test(p.path.slice(prefix.length)))return 'allowed-once';
  return next();
 });
}
