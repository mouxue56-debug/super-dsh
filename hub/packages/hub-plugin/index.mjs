import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AsyncLocalStorage} from 'node:async_hooks';
import {loadPolicy,evaluate,canonicalize,within,commandLists,policyForRoster,decidePlugin,KERNEL_OPTIONAL_TOOLS}
 from './policy.mjs';
import {readPermissionMode,applyPermissionMode,creatorMode,creatorRisk,modeFilePath} from './permission-mode.mjs';
import {loadHubConfig,expandConfiguredPath} from './hub-config.mjs';
import {readGrants} from './grants.mjs';
import {inspectToolInventory,appendInventoryAlert,INVENTORY_DENY} from './tool-inventory.mjs';
import {classifyCommand} from './command-policy.mjs';
import {creatorPaths,creatorFileDecision,creatorCommand} from './creator-policy.mjs';
import {createSelfEditClient} from './tools/self-edit.mjs';
import {readGroupShares,groupAccess} from './group-share.mjs';
import {installCommandSandbox} from './command-sandbox.mjs';
import {sharedGrant} from './shared-grant.mjs';
import {createRosterReader,resolveIdentity,resolveBot,MANAGEMENT_TOOLS,proposeChange,authorizeChange,verifyChange,readAvatarKinds} from './roster.mjs';
import {handoffRefusal} from './reply-route.mjs';

const selfAddrs=()=>[...new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map(i=>String(i.address).split('%')[0]))];
import {heartbeatOnline,watchApproval,OFFLINE} from './heartbeat.mjs';
import {appendAction,appendApproval,createTicket,updateTicket,moveTicket,botStatus,workingTickets} from './tickets.mjs';
import {TOOL_MODULES,KERNEL,validLevels,wrapMaterial,
 boardConfig,createPluginBoard,restrictedContext,gatherBootInput,
 groupsClientFactory,chatOnlyReader} from './tools/index.mjs';
import {installBootSlice} from './boot-slice-listener.mjs';
import {buildBootSlice} from './boot-slice.mjs';
import {countRules} from './tools/rules.mjs';
import {protectedFileNames} from './protected-files.mjs';
import {anyStopped,panicStateDirs} from '../hub-bff/lib/panic-marker.mjs';
import {readExposure,markExposed,readSharedMarks,addSharedMarks} from '../hub-bff/lib/bot-exposure.mjs';
import {DELEGATED_FIRST,EXTERNAL_FIRST} from '../hub-bff/lib/board-inbox.mjs';
import {isTopicSession} from '../hub-bff/lib/topic-session.mjs';

// 一键全停：修E（R3-4）位置与判断和后端共用 hub-bff/lib/panic-marker.mjs；算不出、读不了都按已停（只会多拒）。
function panicStopped(install){
 try{return anyStopped(panicStateDirs({hubHome:install.hubHome,home:install.home,hubConfig:install}));}
 catch{return true;}
}
// 插件工具不许与这些内核或本插件自带的工具同名。
const CORE_TOOLS=new Set(['read','write','edit','bash','list_files','ticket_create','ticket_update',
 'ticket_move','bot_status','bot_list','bot_update',
 'bot_create','bot_set_status','delegate_to_bot']);
export const name='hub-plugin';
export const inject=['tools','workingDirectory'];
const deny=reason=>({kind:'deny',reason:'这件事我做不了：'+reason});
const PARAMETER_ERROR='写文件不要带 justification 或 sandbox_permissions 参数，去掉后直接重试';
const COMMAND_PARAMETER_ERROR='跑命令不要带 sandbox_permissions、justification、run_in_background 参数，去掉后直接重试';
const errorSentence=result=>String(result.error?.message??(result.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')).trim().replace(/^Error:\s*/, '').split(/\r?\n|(?<=[。！？!?])|(?<=\.)\s+/u,1)[0]||'未知错误';
const commandSignature=(args,d)=>JSON.stringify({args,level:d.level,workdir:d.workdir,programs:d.programs,timeoutMs:d.timeoutMs,caps:d.caps,grantKey:d.grantKey,grantId:d.grantId});
function secureOwnDir(own,relative){
 const raw=path.join(own,relative),target=canonicalize(raw,'/');if(!within(target,own)||target!==raw)throw Error('命令输出或临时目录不能是链接');
 fs.mkdirSync(raw,{recursive:true,mode:0o700});fs.chmodSync(raw,0o700);return raw;
}
export function apply(ctx,config={}) {
 let install;try{install=loadHubConfig();}catch(e){ctx.logger.error('hub-plugin 安装配置错误，全部拒绝：'+e.message);ctx.tools.guard(()=>deny('安装配置不可核实，全部停用').reason);ctx.on('tools/pre-execute',()=>deny('安装配置不可核实，全部停用'));return;}
 const protectedNames=protectedFileNames(install.rules);
 const configured=config.bot,heartbeatFile=config.heartbeatPath??install.heartbeat,readRoster=createRosterReader(install);
 let initial;try{initial=readRoster();}catch(e){ctx.logger.error(e.message);ctx.tools.guard(()=>deny(e.message).reason);ctx.on('tools/pre-execute',()=>deny(e.message));return;}
 const registeredRole=configured==='*'?'bot':initial.find(b=>b.id===configured)?.role;
 const loaded=loadPolicy(path.join(install.hubHome,'config/tool-levels.yaml'),install),basePolicy=loaded.policy?.base===install.hubHome&&loaded.policy?.kb===install.kb?loaded.policy:undefined;
 if(loaded.policy&&!basePolicy)ctx.logger.error('hub-plugin 权限表根与安装配置不一致，全部 L4');
 if(loaded.error)ctx.logger.error('hub-plugin 权限表解析失败，全部 L4：'+loaded.error);
 if(!registeredRole)throw Error('hub-plugin 缺少有效 bot');
 const sandbox=ctx.get?.('sandbox'),sandboxPolicy=ctx.get?.('sandboxPolicy'),shell=ctx.get?.('shell');
 const withSharedGrant=sharedGrant(ctx,sandboxPolicy),calls=new AsyncLocalStorage();
 const mode=()=>readPermissionMode(modeFilePath(install.hubHome)).mode;
 const creator=()=>creatorMode(install,mode());
 const selfEdit=install.self_edit?.enabled===true ? createSelfEditClient(install) : null;
 const ownerTurn=s=>s.turn!==null && s.ownerTurn===true && !s.foreignMaterial;
 const ownerSource=s=>s.turn!==null && s.ownerTurn===true;
 const readExternal=(s,bot)=>exposed(bot)||s.untrusted===true||s.tainted===true||s.foreignMaterial;
 let sandboxInstalled=false,sandboxBroken=false,inventoryBroken=false;
 try{
  if(sandbox&&typeof sandbox.confine==='function'&&typeof shell?.resolve==='function'&&shell.sandboxMode){
   const dispose=installCommandSandbox(ctx,sandbox,{getCall:()=>{const call=calls.getStore();if(call)call.confined=true;return call;}});
   const resolve=shell.resolve;
   const wrapped=function(request){
    const call=calls.getStore();
    if(!call)return Reflect.apply(resolve,this,[request]);
   if(call.creator){call.requestEnv=request.env;call.dshEnv=request.dshEnv;}
    const confined=call.creator ? {sandboxPolicy:{...request.sandboxPolicy,mode:'workspace-write'}} : {};
    return Reflect.apply(resolve,this,[{...request,workdir:call.workdir,timeoutMs:call.timeoutMs,...confined}]);
   };
   shell.resolve=wrapped;
   sandboxInstalled=true;ctx.effect?.(()=>()=>{dispose();if(shell.resolve===wrapped)shell.resolve=resolve;});
  }
 }catch(e){sandboxBroken=true;ctx.logger.error('hub-plugin 命令沙箱包装失败：'+e.message);}
 const sessions=new Map(),pending=new Map(),admissions=new Map(),completedPaths=new Map();
 const taintFile=path.join(install.hubHome,'config','group-taint.log');
 const taintBackup=taintFile+'.1',taintLimit=256*1024;
 // 状态写不进去时先记在本进程内存里（按接触过算），之后每次判定都重试写盘，写成了以文件为准。
 const exposureMemory=new Map();
 function exposed(bot){
  const held=exposureMemory.get(bot);
  if(held&&markExposed(install.hubHome,bot,held))exposureMemory.delete(bot);
  return exposureMemory.has(bot)||readExposure(install.hubHome,bot).exposed;
 }
 function mark(s,why,source,session){
  s.untrusted=true;
  if(!s.bot){s.markPending={why,source,session};return;}
  if(markExposed(install.hubHome,s.bot,{why,source,session}))exposureMemory.delete(s.bot);
  else exposureMemory.set(s.bot,{why,source,session});
 }
 function registerGroupTaint(target){
  try{
   const line=JSON.stringify(target)+'\n';
   let found=false,readFailed=false;
   for(const file of [taintFile,taintBackup]){
    try{if(fs.readFileSync(file,'utf8').split('\n').includes(line.trimEnd()))found=true;}
    catch(e){if(e.code!=='ENOENT')readFailed=true;}
   }
   if(found&&!readFailed)return;
   let size=0;
   try{size=fs.statSync(taintFile).size;}catch(e){if(e.code!=='ENOENT')throw e;}
   if(size+Buffer.byteLength(line)>taintLimit)fs.renameSync(taintFile,taintBackup);
   fs.appendFileSync(taintFile,line,{mode:0o600});
  }catch(e){ctx.logger.warn?.('hub-plugin 来源留痕失败：'+e.message);}
 }
 function externalPath(target,bot,rows){
  const shared=readSharedMarks(install.hubHome).paths;
  if(shared.some(p=>within(target,p)||within(p,target)))return true;
  return rows.some(row=>row.id!==bot&&exposed(row.id)&&(
   within(target,path.join(install.hubHome,'bots',row.id))||
   target.startsWith(path.join(install.hubHome,'group-work')+path.sep)&&
   target.slice(path.join(install.hubHome,'group-work').length+1).split(path.sep)[1]===row.id));
 }
 const pluginTools=new Map(),pluginSpecs=new Map(),pluginCalls=new AsyncLocalStorage(),
  chatOnly=chatOnlyReader(path.join(install.hubHome,'config/chat-only-sessions.json'),ctx.logger);
 let board,boardCfg,bootStep;
 try{boardCfg=boardConfig(install);
  // 安排结论只有在任首席能给；名册现读（N4 在后端接了，插件这侧漏了，首席的 arrange 工具一直报「只有首席能做」）。
  board=createPluginBoard(boardCfg,ctx.logger,name=>{const rows=readRoster();
   const bot=rows.find(b=>b&&b.id===name)||rows.find(b=>b&&b.name===name);return !!(bot&&bot.role==='chief'&&bot.status==='active');});}catch(e){
  ctx.logger.error('hub-plugin 看板配置错误，插件工具不启用：'+e.message);}
 const createUserMessage=config.createUserMessage??KERNEL.createUserMessage;
 if(board&&typeof createUserMessage==='function')installBootSlice({on:(_n,f)=>{bootStep=f;}},{name:'hub-boot-slice',
  createUserMessage,getSlice:async({agent})=>{
  const {bot,policy}=context({agent});
  const anomalies=[...(heartbeatOnline(heartbeatFile)?[]:['手机端不在线，要批的事先等着']),
   ...(inventoryBroken?['工具清单对不上，已全部停用']:[]),
   ...(sandboxBroken?['命令沙箱没开']:[])];
  // （方案 B）：开了规矩页工具时，开工切片多一行「你有 N 条规矩，先读」。
  let rules=0;
  try{rules=pluginTools.has('rules_read')?countRules(install.hubHome,bot):0;}catch{rules=0;}
  return buildBootSlice(await gatherBootInput({bot,board,policy,botStatus,workingTickets,
   kbSyncFile:path.join(install.hubHome,'config/kb-sync.json'),
   anomalies,timeZone:install.timezone,rules}));
 }});
 else ctx.logger.warn?.('hub-plugin 开工切片未启用：看板配置无效');
 if(KERNEL.source==='fallback'&&!config.createUserMessage
  )ctx.logger.warn?.('hub-plugin 开工切片用等价的 createUserMessage（解析不到内核包）');
 function state(agent){
  const id=agent?.id;
  if(!id)throw Error('无法核实会话身份');
  if(!sessions.has(id))sessions.set(id,{version:0,locked:false,turn:null,count:0,sendCount:0,firstUserSeen:false,
  delegated:false,steps:0,tainted:false,internal:false,readOutside:false,inventoryChecked:false,bot:null});
  return sessions.get(id);}
 function inventory(agent,s,row,policy){
  const bot=row.id;
  if(inventoryBroken)return;
  try{
   // 期望清单 = 权限表按角色登记的 + 本实例经加载器亲自注册的插件工具；别的来路仍算多出。
   const d=inspectToolInventory(ctx,agent,[...(policy?.expected_tools?.[row.role]??[]),...pluginTools.keys(),
    ...(policy?.kernel_tools??[])]);
   if(d.extra.length){inventoryBroken=true;ctx.logger.error('hub-plugin '+INVENTORY_DENY+'；多出：'+d.extra.join(','));try{appendInventoryAlert(install.hubHome,bot,d.extra);}catch(e){ctx.logger.error('hub-plugin 报警落盘失败：'+e.message);}}
   if(!s.inventoryChecked&&d.missing.length)ctx.logger.warn?.('hub-plugin 工具缺少：'+d.missing.join(','));
   s.inventoryChecked=true;
  }catch(e){inventoryBroken=true;ctx.logger.error('hub-plugin 工具清单无法核实：'+e.message);try{appendInventoryAlert(install.hubHome,bot,['<无法列举>']);}catch{}}
 }
 function context(exec){
  if(!exec.agent)throw Error('无法核实会话身份');
  const cwd=ctx.workingDirectory.get(exec.agent.session),s=state(exec.agent),rows=readRoster();
  const row=resolveIdentity(install,rows,configured,exec.agent.session,cwd),bot=row.id;
  if(row.status==='disabled')throw Error('这个助理已停用');
  s.bot=bot;
  if(s.markPending){const item=s.markPending;s.markPending=null;mark(s,item.why,item.source,item.session);}
  const policy=policyForRoster(basePolicy,rows);
  // 受保护文件名单带上配置里的规矩页与叠加文件名（只加不减）。
  if(policy)policy.protected_files=protectedNames;
  if(policy)policy.group_access=groupAccess({shares:readGroupShares(install.hubHome),bot,hubHome:install.hubHome});
  if(!s.inventoryChecked)inventory(exec.agent,s,row,policy);
  return {cwd,s,bot,row,rows,policy,names:Object.fromEntries(rows.map(b=>[b.id,b.name]))};
 }
 function command(exec,cwd,s,bot,policy,asCreator){
  const args=exec.arguments??{};
  if(['sandbox_permissions','justification','run_in_background'].some(k=>Object.hasOwn(args,k)))return {level:'deny',reason:COMMAND_PARAMETER_ERROR};
  if(typeof args.command!=='string'||!args.command.trim()||args.command.length>2000)return {level:'deny',reason:'命令须为1至2000字'};
  if(!policy)return {level:'deny',reason:'权限表不可核实'};
  if(sandboxBroken||!sandboxInstalled||!asCreator&&shell.sandboxMode!=='workspace-write')
   return {level:'deny',reason:'命令沙箱没开，这次不跑'};
  const own=canonicalize(policy.base+'/bots/'+bot,'/');
  const roots={own,readable:[own,...['shared','tickets'].map(r=>canonicalize(policy.base+'/'+r,'/')),...(policy.kb_allow[bot]??[]).map(r=>canonicalize(policy.kb+'/'+r,'/'))],writable:[own]};
  if(!within(own,policy.base+'/bots/'+bot)||roots.readable.slice(1,3).some((p,i)=>!within(p,policy.base+'/'+['shared','tickets'][i]))||roots.readable.slice(3).some((p,i)=>!within(p,policy.kb+'/'+policy.kb_allow[bot][i])))throw Error('命令可读区域根指向外部');
  roots.readable.push(...policy.group_access.read);
  roots.writable.push(...policy.group_access.write);
  const denyPaths=policy.cmd_deny_paths.filter(p=>!asCreator || !p.startsWith('$HUB_HOME/dsh-hub')
    && p!=='$HUB_HOME/config')
   .map(p=>expandConfiguredPath(p,install));
  if(!asCreator)denyPaths.push(path.dirname(fileURLToPath(import.meta.url)));
  const active=sandboxPolicy?.resolve({session:exec.agent.session})?.mode==='workspace-write'&&!!sandbox&&sandboxInstalled;
  const liveGrants=readGrants(install.grants,ctx.logger);
  // 在途审批仍按未放权判定；新保存的规则从下一次命令生效，保持本次复判与卡片一致。
  const grants=pending.has(exec.token)?[]:liveGrants;
  const d=classifyCommand({command:args.command,workdir:args.workdir,cwd,bot,roots,home:install.home,
   hubHome:install.hubHome,denyPaths,forbiddenWords:policy.forbidden,lists:commandLists(policy),
   sandboxActive:active,tainted:readExternal(s,bot),internalTainted:s.internal,
   timeoutMs:args.timeoutMs,grants,now:new Date(),selfAddrs:selfAddrs(),
   protectedNames,groupFence:policy.group_access,creator:asCreator});
  if(asCreator){
   const bounds=creatorPaths(install);
   const timeoutMs=Math.min(policy.cmd_timeout_max_ms,
    Number.isSafeInteger(args.timeoutMs)&&args.timeoutMs>0 ? args.timeoutMs : policy.cmd_timeout_ms);
   const c=creatorCommand({args,cwd,roots,bounds,timeoutMs,legacy:d});
   return {...c,path:c.workdir,area:'own',denyPaths,sandboxActive:true};
  }
  return {...d,path:d.workdir,area:'own',roots,denyPaths,sandboxActive:active,
   tainted:readExternal(s,bot)||s.internal};
 }
 function check(exec){try{
  if(isTopicSession(exec.agent?.id))
   return {level:'L4',reason:'话题整理只做一次文字归类，不能调用工具',path:''};
  // 一键全停后插件一律拒新工具调用；标记读不了也按已停。全停优先于任何档位。
  if(panicStopped(install))
   return {level:'L4',reason:'已一键全停，需先恢复',path:''};
  const {cwd,s,bot,rows,policy}=context(exec);
  const currentMode=mode(),owner=ownerTurn(s),asCreator=creatorMode(install,currentMode)&&owner;
  const finish=d=>{
   if(d.level==='L4')return d;
   const onceExternal=readExternal(s,bot);
   const fixed=d.management||['board_handoff','board_answer'].includes(exec.name);
   const risk=currentMode==='open'&&(asCreator||fixed||d.ownerRisk)
    ? creatorRisk({tool:exec.name,args:exec.arguments??{},decision:d,cwd,tainted:onceExternal,owner}) : null;
   const out=applyPermissionMode(d,{mode:currentMode,config:install,tool:exec.name,args:exec.arguments??{},cwd,
    home:install.home,hubHome:install.hubHome,ownerTurn:owner,creatorActive:asCreator||Boolean(risk),risk});
   if(out!==d&&out.level==='L3'&&s.locked)
    return {...out,level:'L4',reason:'刚才这件事 主人 没批准，不能换路径或换工具再试'};
   return out;
  };
  if(inventoryBroken)return finish({level:'L4',reason:INVENTORY_DENY,path:''});
  // 后端标成只聊天的会话，任何工具都再拒一次（路 7 的会话本该一个工具都没有）。
  if(chatOnly(exec.agent.id))return finish({level:'L4',reason:'这是只聊天的会话，不动手',path:''});
  if(!policy)return finish({level:'L4',reason:'权限表不可核实',path:''});
  if(exec.name==='bot_list')return finish({level:'L0',path:install.hubHome+'/config/bots.yaml'});
  // 分身工具。再派、改目录、换预设一律拒，避免分身权限高过父助理。登记了才按 L0。
  if(exec.name==='subagent'){
   const header=exec.agent?.session?.header;
   if(header?.origin==='subagent')return finish({level:'L4',reason:'分身不能再派分身',path:''});
   const spawnArgs=exec.arguments??{};
   if(typeof spawnArgs.cwd==='string'&&spawnArgs.cwd.trim())return finish({level:'L4',reason:'分身不能改工作目录',path:''});
   if(typeof spawnArgs.agent_preset==='string'&&spawnArgs.agent_preset.trim())
    return finish({level:'L4',reason:'分身不能换预设',path:''});
   if(policy.kernel_tools?.includes('subagent'))return finish({level:'L0',path:''});
  }
  // 收口：权限表登记过的内核可选工具按登记级别；没登记的照旧走下面的判定（拒）。
  if(policy.kernel_tools?.includes(exec.name))return finish({level:KERNEL_OPTIONAL_TOOLS[exec.name],path:''});
  if(MANAGEMENT_TOOLS.includes(exec.name)){
   const p=pending.get(exec.token);let management;
   if(p?.management){if(p.args!==JSON.stringify(exec.arguments)||p.management.tool!==exec.name)throw Error('审批后助理参数已变化');management=p.management;authorizeChange(rows,bot,exec.name,management.target);}
   else management=proposeChange(install,rows,bot,exec.name,exec.arguments);
   const d={level:'L3',path:management.path,management};
   if(s.locked)return {...d,level:'L4',reason:'刚才这件事 主人 没批准，不能换路径或换工具再试'};return finish(d);
  }
  if(pluginTools.has(exec.name)){
   // 插件工具按权限表启用名单与模块 levels 判定；L3 同样受拒批锁约束。
   const d=decidePlugin(policy,bot,exec.name,pluginTools.get(exec.name));
   if(d.level==='L3'&&!d.path)d.path=install.hubHome;
   if(d.level!=='L4'&&d.plugin==='self-edit'&&(!selfEdit||currentMode!=='readonly')) {
    return finish({...d,level:'L0'});
   }
   if(d.level==='L3'&&s.locked)return {...d,level:'L4',reason:'刚才这件事 主人 没批准，不能换路径或换工具再试'};
   return finish(d);
  }
  if(exec.name==='bash'){
   let cmd=command(exec,cwd,s,bot,policy,asCreator);
   let ownerRisk=false;
   if(currentMode==='open'&&ownerSource(s)&&!asCreator){
    const candidate=command(exec,cwd,s,bot,policy,true);
    if(candidate.level!=='deny'&&creatorRisk({tool:'bash',args:exec.arguments,
     decision:{cmd:candidate},cwd,tainted:true,owner:false})){
     cmd=candidate;
     ownerRisk=true;
    }
   }
   const d={...cmd,cmd,ownerRisk,level:({run:'L1',ask:'L3',deny:'L4'})[cmd.level]??'L4'};
   if(d.level==='L3'&&s.locked)return {...d,level:'L4',reason:'刚才这件事 主人 没批准，不能换路径或换工具再试'};
   return finish(d);
  }
  if(['write','edit'].includes(exec.name)&&['justification','sandbox_permissions'].some(k=>Object.hasOwn(exec.arguments??{},k)))return finish({level:'L4',reason:PARAMETER_ERROR,path:''});
  let d=evaluate(policy,bot,exec.name,exec.arguments,cwd);
  if(asCreator)d=creatorFileDecision(d,creatorPaths(install),exec.name);
  if(d.level==='L3'&&s.locked)return {...d,level:'L4',reason:'刚才这件事 主人 没批准，不能换路径或换工具再试'};
  return finish(d);
 }catch(e){return {level:'L4',reason:e.message,path:''};}}
 function firstUser(s,message,session){if(message.source?.kind!=='user')return;
  const text=typeof message.content==='string'?message.content:(message.content??[])
   .filter(c=>c.type==='text').map(c=>c.text).join('');
  s.ownerTurn=!DELEGATED.test(text)&&!GROUP_TURN.test(text)&&!EXTERNAL_FIRST.test(text)&&
   !text.includes('【外部来源】')&&!text.includes('【外部来源接力】');
  if(EXTERNAL_FIRST.test(text)||text.includes('【外部来源】')){
   s.untrusted=true;s.tainted=true;mark(s,'收到带外部来源的消息','user',session);
  }
  if(s.firstUserSeen)return;
  s.firstUserSeen=true;
  s.delegated=DELEGATED.test(text);
  // 讨论组轮到发言的会话、派单会话读过外部内容的：每一轮都按「读过外部内容」从严（只会多问）。
  // 首句格式与看板收件箱共用 hub-bff/lib/board-inbox.mjs 的正则。
  // 修G：讨论组轮次读到的是别的助理写的东西，算内部来源——只读命令照常跑，
  // 写、联网、跑脚本等仍先问；带「读过外部内容」标记的派单仍算外部来源，所有命令先问。两种都有按外部算。
  s.groupTurn=GROUP_TURN.test(text);
  if(s.groupTurn)s.internal=true;}
 const GROUP_TURN=/^【讨论组「/u;
 const MISSING_DESCRIPTION='这次命令没跑：bash 缺了必填的 description 字段。请带上 command 和 description'+
  '（一句话说明为什么跑，例如 {"command":"ls","description":"列目录"}）再调一次';
 // 派来的会话：旧派活（首席）与看板转单（任何助理）都用「【X派来的活 · 工单 id】」开头；只会多套 8 步上限，不会少拒。
 const DELEGATED=DELEGATED_FIRST;
 // 参数校验没过只认两种：错误对象带参数错误 code；或本次是系统补的说明字段，且原话以参数错误开头。
 const ARGUMENT_CODES=new Set(['INVALID_ARGUMENTS','ERR_INVALID_ARGUMENTS','TOOL_INVALID_ARGUMENTS']);
 const ARGUMENT_START=/^(?:Error:\s*)?(?:invalid arguments|missing required property|must have required property)/iu;
 function argumentError(e,filled){
  if(ARGUMENT_CODES.has(String(e?.code??'')))return true;
  return filled&&ARGUMENT_START.test(String(e?.message??''));
 }
 ctx.on('agent/inbox/inserted',({agent,message})=>{
  if(isTopicSession(agent?.id))return;
  if(message.source?.kind==='user'){
   const s=state(agent);try{context({agent});}catch{}
   firstUser(s,message,agent.id);s.locked=false;s.version++;
  }
 });
 ctx.on('agent/pre-step',async(payload,next)=>{
  // 归类不读取开工资料，也不因模型试图调用工具而继续下一步。
  if(isTopicSession(payload.agent?.id))return payload.step===1?next():{kind:'reject'};
  const s=state(payload.agent);try{const {row,policy}=context({agent:payload.agent});inventory(payload.agent,s,row,policy);}catch(e){ctx.logger.warn?.('hub-plugin '+e.message);}
  for(const message of payload.messages??[])firstUser(s,message,payload.agent.id);
  if(!Number.isSafeInteger(payload.turn)||payload.turn<1){s.turn=null;if(s.delegated)return {kind:'reject'};return next();}
  if(s.turn!==payload.turn){
   s.turn=payload.turn;s.count=0;s.sendCount=0;s.steps=0;s.tainted=s.untrusted===true;
   s.internal=s.groupTurn===true;s.readOutside=false;s.foreignMaterial=false;
  }
  if(s.delegated&&(s.steps>=8||!Number.isSafeInteger(payload.step)||payload.step<1||payload.step>8)){
   // （fcd421a）：不往会话日志写自定义事件，改写旁路 config/step-limits.log 给 BFF 读。
   try{
    const line=JSON.stringify({v:1,sessionId:payload.agent.id,turn:payload.turn,step:payload.step,
     text:'超过 8 步自动停',ts:Date.now()});
    fs.appendFileSync(path.join(install.hubHome,'config/step-limits.log'),line+'\n',{mode:0o600});
   }catch(e){ctx.logger.error('hub-plugin 步数上限记录失败：'+e.message);}
   return {kind:'reject'};
  }
  // 开工切片挂在本监听器的 next 之后，判定与 8 步上限的顺序不变。
  const decision=await (bootStep?bootStep(payload,next):next());
  if(s.delegated&&decision.kind==='enter')s.steps++;
  return decision;
 },{prepend:true});
 ctx.on('agent/disposed',({agent})=>{sessions.delete(agent.id);});
 function wish(exec,names,bot){
  const who=names[bot]??bot;
  return who+(exec.agent?.session?.header?.origin==='subagent'?'的分身想':'想');
 }
 ctx.on('tools/pre-execute',async(exec,next)=>{
  const d=check(exec);if(d.level==='L4')return deny(d.reason);
  const {bot:activeBot,s:activeState}=context(exec);
  if((exposed(activeBot)||activeState.untrusted===true)&&['write','edit'].includes(exec.name))
   registerGroupTaint(d.path);
  if((exposed(activeBot)||activeState.untrusted===true)&&exec.name==='bash'&&d.cmd.sideEffect){
   const targets=d.cmd.writeUnknown||!d.cmd.writePaths.length
    ?[...d.cmd.writePaths,d.cmd.workdir]:d.cmd.writePaths;
   for(const target of targets)registerGroupTaint(target);
  }
  if(exec.name==='bash')admissions.set(exec.token,{signature:commandSignature(exec.arguments,d.cmd),decision:d.cmd});
  if(d.level!=='L3')return next();
  const {s,bot,policy,names}=context(exec),args=exec.arguments;
  const p={path:d.path,version:s.version,agent:exec.agent,callId:exec.callId,approved:false,
   management:d.management,args:JSON.stringify(args),risk:JSON.stringify(d.risk)};
  pending.set(exec.token,p);
  const approvalReason=data=>{
   p.reason=JSON.stringify(data);
   return 'HUBAPPROVAL1 '+p.reason;
  };
  if(!heartbeatOnline(heartbeatFile)){p.failureReason=OFFLINE;s.locked=true;try{appendApproval(policy,bot,exec.name,d.path,'unavailable');}catch{}return deny(OFFLINE);}
  if(d.management){
   const m=d.management,data={v:1,bot,sessionId:exec.agent.id,level:'L3',action:m.action,tool:exec.name,path:m.path,chars:0,preview:m.preview,target:m.target,before:m.before,after:m.after,why:m.why,...d.risk};
   return {kind:'ask',reason:approvalReason(data),displayReason:{zh:wish(exec,names,bot)+m.action+'：'+(m.after.name??m.target)}};
  }
  if(exec.name==='bash'){
   const c=d.cmd,grantable=!d.risk&&!!c.grantKey&&!c.caps?.longRunning;
   const data={v:1,bot,sessionId:exec.agent.id,level:'L3',action:d.modeHold||'跑命令',tool:'bash',path:c.workdir,chars:args.command.length,preview:args.command.slice(0,200),command:args.command,cwd:c.workdir,why:typeof args.description==='string'?args.description.slice(0,200):'',timeoutMs:c.timeoutMs,caps:c.caps,grantable,...grantable?{grantKey:c.grantKey}:{},...d.risk};
   return {kind:'ask',reason:approvalReason(data),displayReason:{zh:`${wish(exec,names,bot)}跑命令：${args.command.slice(0,60)}`}};
  }
  if(d.area==='plugin'){
   const card=pluginCard(exec,args),data={v:1,
    bot,sessionId:exec.agent.id,level:'L3',action:card.action,tool:exec.name,
    path:d.path,chars:card.preview.length,preview:card.preview,
    why:card.why,...d.risk};
   return {kind:'ask',reason:approvalReason(data),
    displayReason:{zh:`${wish(exec,names,bot)}${card.action}：${card.preview.slice(0,60)}`}};
  }
  const action=d.modeHold||(['write','edit'].includes(exec.name)?'写共享区':exec.name==='ticket_move'?'移动别人建的工单':'修改别人建的工单');
  const text=exec.name==='edit'?(args.new_string??args.newString??''):args.content??args.append??'';
  const data={v:1,bot,sessionId:exec.agent.id,level:'L3',action,tool:exec.name,path:d.path,
   chars:String(text).length,preview:d.risk?'':String(text).slice(0,200),...d.ticketId?{ticketId:d.ticketId}:{},...d.risk};
  if(exec.name==='edit'&&!d.risk)data.diff=('- '+String(args.old_string??args.oldString??'')+'\n+ '+String(text)).slice(0,600);
  return {kind:'ask',reason:approvalReason(data),displayReason:{zh:`${wish(exec,names,bot)}${action}，共 ${data.chars} 字，路径 ${d.path}`}};
 });
 ctx.on('approval/request',async(req,next)=>{
  let bot;try{bot=context({agent:req.agent}).bot;}catch{return 'rejected';}
  let data;try{data=JSON.parse(req.reason?.startsWith('HUBAPPROVAL1 ')?req.reason.slice(13):'');}catch{return 'rejected';}
  const p=[...pending.values()].find(p=>p.agent===req.agent&&p.callId===req.callId&&p.path===data.path);
  if(!p||data.bot!==bot||data.sessionId!==req.agent.id||data.tool!==req.toolName||
   (p.management||p.risk)&&JSON.stringify(data)!==p.reason)return 'rejected';
  const s=state(req.agent),outcome=await watchApproval({file:heartbeatFile,signal:req.signal,next,fail:reason=>{p.failureReason=reason;if(s.version===p.version)s.locked=true;}});
  p.approved=outcome==='allowed-once';return outcome;
 },{prepend:true});
 function guard(exec){
  const d=check(exec);if(d.level==='L4')return deny(d.reason).reason;
  if(exec.name==='bash'){
   if(!d.cmd.creator&&sandboxPolicy?.resolve({session:exec.agent.session})?.mode!=='workspace-write')
    return deny('命令沙箱没开，这次不跑').reason;
   if(admissions.get(exec.token)?.signature!==commandSignature(exec.arguments,d.cmd))return deny('审批后命令或目录已变化').reason;
  }
  if(d.level==='L3'){
   const p=pending.get(exec.token),{s}=context(exec);if(p?.path!==d.path)return deny(exec.name==='bash'?'审批后命令或目录已变化':'审批后的路径或工单已变化').reason;
   if(!p.approved)return deny('未取得本次明确批准').reason;
   if(p.risk!==JSON.stringify(d.risk)||d.risk&&(p.args!==JSON.stringify(exec.arguments)||
    p.version!==s.version))return deny('审批后的对象、参数或请求已变化，需要重新确认').reason;
   if(!heartbeatOnline(heartbeatFile)){p.failureReason=OFFLINE;if(s.version===p.version)s.locked=true;return deny(OFFLINE).reason;}
  }
 }
 ctx.tools.guard(guard);
 function callContext(exec,d){
  const {bot,row,s}=context(exec);
  return Object.freeze({bot,role:row.role,tool:exec.name,sessionId:exec.agent.id,turn:s.turn,level:d.level,
   approved:pending.get(exec.token)?.approved===true,
   ownerTurn:ownerTurn(s),
   creatorMode:creator(),
   readExternal:exposed(bot)||s.untrusted===true||s.internal||s.readOutside});
 }
 async function withSourceLease(exec,d,target,summary,next){
  if(!selfEdit)throw Error('改自己还没开通，需要 主人 在配置里开');
  const context=callContext(exec,d);
  const call=d.ownerRisk&&context.approved ? {...context,ownerTurn:true} : context;
  if(!call.ownerTurn)throw Error('需要主人在对话里交代这次改动');
  const prepared=await selfEdit('prepare',{path:target,summary},call,exec.signal);
  const {change,lease}=prepared;
  try {return await next();}
  finally {
   try {await selfEdit('release',{id:change.id,leaseId:lease.id},call);}
   catch {ctx.logger.warn?.('改自己：原生工具的写入租约未释放，等待租约过期');}
  }
 }
 ctx.on('tools/execute',async(exec,next)=>{
  const denied=guard(exec);if(denied)throw Error(denied);
  const d=check(exec);if(d.level==='L4')throw Error(deny(d.reason).reason);
  const {bot,policy}=context(exec);
  if(exec.name==='bash'){
   const c=d.cmd,approved=pending.get(exec.token)?.approved===true||!!c.grantId;
   const openRead=mode()==='open'&&d.level==='L1';
   const call={bot,home:install.home,hubHome:install.hubHome,own:c.roots.own,readable:c.roots.readable,
    denyRead:c.denyPaths.filter(p=>!['/etc','/private/etc','/System'].includes(p)),
    network:c.caps.network&&(approved||openRead)||Boolean(c.creator&&approved&&d.risk?.network),
    extraWrite:[...(approved?c.caps.writeRoots:[]),...policy.group_access.write],
    tmpdir:secureOwnDir(c.roots.own,'.tmp'),workdir:c.workdir,timeoutMs:c.timeoutMs,selfAddrs:selfAddrs(),
    protectedNames,confined:false,creator:c.creator,bounds:c.bounds,sourceMutation:c.sourceMutation,
    risk:approved?d.risk:null,sensitiveWrites:c.sensitiveWrites};
   // 漏了内核必填的说明字段：用命令第一个词补上并留痕，不再让参数错误把沙箱判坏。
   const a=exec.arguments;
   let filled=false;
   // 内核把参数冻住时补不了：只拒这一次，告诉模型缺什么、怎么补；沙箱状态不动。
   if(a&&typeof a==='object'&&(typeof a.description!=='string'||!a.description.trim())){
    filled=true;
    const word='（系统补）'+(String(a.command??'').trim().split(/\s+/u)[0]?.slice(0,40)||'跑命令');
    if(!Reflect.set(a,'description',word)||a.description!==word)throw Error(MISSING_DESCRIPTION);
    appendAction(policy,bot,'bash',c.workdir+' 补说明字段 description='+word,'L1-fill');
   }
   const run=async()=>{
    let failure;
    try{return await calls.run(call,next);}
    catch(e){
     failure=e;
     if(!call.confined&&argumentError(e,filled)){
      throw Error(MISSING_DESCRIPTION+'（内核原话：'+String(e?.message??e).slice(0,120)+'）');
     }
     throw e;
    }
    finally{
     // 缺说明字段导致的参数错误还未进入执行，和实际沙箱断开分开处理。
     if(!call.confined&&!(failure&&argumentError(failure,filled))){
      sandboxBroken=true;ctx.logger.error('hub-plugin 命令没经过沙箱');}
    }
   };
   return c.sourceMutation ? withSourceLease(exec,d,c.bounds.source,'在源码目录运行命令',run) : run();
  }
  if(creator()&&ownerTurn(context(exec).s)&&['write','edit'].includes(exec.name)&&d.path){
   const run=()=>withSharedGrant(exec.agent.session,path.dirname(d.path),next);
   return d.area==='self_source' ? withSourceLease(exec,d,d.path,'修改 '+path.basename(d.path),run) : run();
  }
  // 组员写自己那一格（L1，留痕不出卡）：内核文件沙箱只为这一次调用加这一个写根。
  if(d.area==='group_own'&&['write','edit'].includes(exec.name)){
   const cell=policy.group_access.write.find(r=>within(d.path,r));
   if(!cell)throw Error(deny('讨论组放权已失效').reason);
   return withSharedGrant(exec.agent.session,cell,next);
  }
  // 全开把共享区新文件收成直接做之后，仍要给这一次补上共享区写根；改动前问的 L3 路径不动。
  if(d.level==='L1'&&d.area==='shared'&&['write','edit'].includes(exec.name)){
   const shared=canonicalize(policy.base+'/shared','/');
   if(!within(shared,policy.base+'/shared'))throw Error('共享区根越界');
   fs.mkdirSync(shared,{recursive:true,mode:0o700});
   return withSharedGrant(exec.agent.session,shared,next);
  }
  if(d.level!=='L3'||d.area!=='shared')return next();
  if(pending.get(exec.token)?.path!==d.path)throw Error('这件事我做不了：缺少本次共享区审批');
  const shared=canonicalize(policy.base+'/shared','/');if(!within(shared,policy.base+'/shared'))throw Error('共享区根越界');fs.mkdirSync(shared,{recursive:true,mode:0o700});return withSharedGrant(exec.agent.session,shared,next);
 });
 function bashOutput(exec,result,decision){
  const {bot,policy}=context(exec);
  const c=admissions.get(exec.token)?.decision;if(!c)return decision;
  let content=decision.content??result.content??[],full=content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
  if(result.value?.kind==='foreground'&&(result.value.stdout?.truncated||result.value.stderr?.truncated)){
   const stream=s=>{if(!s)return '';if(!s.truncated)return s.text; if(!s.spillPath)throw Error('内核截断输出且没有全文文件');let fd;try{fd=fs.openSync(s.spillPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const st=fs.fstatSync(fd);if(!st.isFile()||st.size>=67108864)throw Error('内核全文达到64MB上限或文件不安全，无法保证完整');return fs.readFileSync(fd,'utf8');}finally{if(fd!==undefined)fs.closeSync(fd);}};
   const markers=full.match(/^\[(?:exit code:|timed out after|killed by signal:|sandbox:)[^\n]*\]$/gm)??[];
   const stdout=stream(result.value.stdout),stderr=stream(result.value.stderr);
   full=stdout+(stderr?'\n[stderr]\n'+stderr:'')+(markers.length?'\n'+markers.join('\n'):'');content=[{type:'text',text:full}];
  }
  const bytes=Buffer.byteLength(full),limit=policy.cmd_output_bytes;
  if(bytes>limit){
   const dir=secureOwnDir(c.roots.own,'outputs'),stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14),name=`cmd-${stamp.slice(0,8)}-${stamp.slice(8)}-${randomBytes(2).toString('hex')}.txt`;
   fs.writeFileSync(path.join(dir,name),full,{flag:'wx',mode:0o600});
   const prefix=new TextDecoder().decode(Buffer.from(full).subarray(0,limit),{stream:true});
   content=[{type:'text',text:prefix+`\n（输出共 ${bytes} 字节，只显示前 ${limit===4096?'4KB':limit+'字节'}；全文在 bots/${bot}/outputs/${name}）`}];
  }
  if(full.includes('[timed out after'))content=[...content,{type:'text',text:'（超过时限被停了）'}];
  const approved=pending.get(exec.token)?.approved===true;
  appendAction(policy,bot,'bash',c.workdir+' programs='+c.programs.join(','),approved?'L3-approved':'L1-cmd'+(c.grantId?' grant='+c.grantId:''));
  return {kind:'accept',content:[...content,{type:'text',text:approved?'（主人 已在手机上批准，已跑）':'（已跑命令，L1 已记录）'}]};
 }
 ctx.on('tools/post-execute',async(exec,result,next)=>{
  const decision=await next(),p=pending.get(exec.token),failure=p?.failureReason;
  const {bot,policy,s:st,rows}=context(exec);
  if(!result.isError&&decision.kind==='accept'){
   const content=decision.content??result.content??[];
   const text=content.filter(item=>item.type==='text').map(item=>item.text).join('\n');
   if(policy?.cmd_taint_tools.includes(exec.name)){
    st.foreignMaterial=true;mark(st,'使用外部来源工具',exec.name,exec.agent.id);
   }
   if(text.includes('【外部来源】')||text.includes('读过外部内容】')){
    st.foreignMaterial=true;
    mark(st,'工具结果带外部来源记号',exec.name,exec.agent.id);
   }
   const cmd=exec.name==='bash'?admissions.get(exec.token)?.decision:null;
   // 跑过的命令找不到准入记录（认不出读了什么）：从严按接触过外部内容算。
   if(exec.name==='bash'&&!cmd)mark(st,'认不出命令读了什么','bash',exec.agent.id);
   const d=check(exec);
   if(exec.name==='read'||cmd){
    const reads=cmd?(cmd.readPaths.length?cmd.readPaths:[cmd.workdir]):[d.path];
    for(const target of reads){
     const literalNull=target==='/dev/null'&&(cmd?!cmd.nonLiteralNullRead:exec.arguments?.file_path==='/dev/null');
     const ownedSource=d.area==='self_source'||cmd?.bounds?.source&&within(target,cmd.bounds.source);
     const outside=!literalNull&&!ownedSource&&!within(target,path.join(install.hubHome,'bots',bot))&&
      !['shared','tickets','group-work'].some(p=>within(target,path.join(install.hubHome,p)));
     if(externalPath(target,bot,rows)||outside){
      st.foreignMaterial=true;mark(st,'读了 '+target,target,exec.agent.id);
     }
    }
   }
   if(exposed(bot)||st.untrusted===true){
    const root=path.join(install.hubHome,'shared');
    let targets=[];
    if(['write','edit'].includes(exec.name)&&within(d.path,root))targets=[d.path];
    if(cmd&&cmd.sideEffect){
     targets=cmd.writePaths.filter(p=>within(p,root));
     if(cmd.writeUnknown||cmd.caps.writeRoots.some(p=>within(p,root)||within(root,p)))targets=[root];
    }
    if(targets.length&&!addSharedMarks(install.hubHome,targets))ctx.logger.warn?.('共享区记号写入失败');
   }
   if(exec.name==='bash')return bashOutput(exec,result,decision);
  }
  if(result.isError&&decision.kind==='accept'){
   const content=[...(decision.content??result.content??[])];if(failure)content.push({type:'text',text:failure});
   if(p?.approved&&['write','edit'].includes(exec.name))content.push({type:'text',text:`（主人 已批准，但写入没成功：${errorSentence(result)}）`});
   return failure||p?.approved&&['write','edit'].includes(exec.name)?{kind:'accept',content}:decision;
  }
  if(result.isError||decision.kind!=='accept')return decision;
  const d=check(exec);
  if(d.management&&p?.approved){appendAction(policy,bot,exec.name,d.path,'L3-approved');return {kind:'accept',content:[...(decision.content??result.content??[]),{type:'text',text:'（主人 已批准，名册已生效）'}]};}
  if(d.level==='L3'&&p?.approved){appendAction(policy,bot,exec.name,d.path,'L3-approved');return {kind:'accept',content:[...(decision.content??result.content??[]),{type:'text',text:`（主人 已在手机上批准，已写入 ${d.path}）`}]};}
  if(exec.name==='read'&&d.level==='L0'){
   // 读到的文件内容包成资料；读自己目录以外的文件记为「本轮读过外部内容」。
   const st=context(exec).s;
   // 共享区、工单、组文件夹是自己人写的，算内部来源；别处一律按外部算。
   if(['shared','tickets','group','group_own'].includes(d.area))st.internal=true;
   const content=decision.content??result.content;if(!Array.isArray(content))return decision;
   return {...decision,content:wrapMaterial(content,d.path)};
  }
  if(d.area==='plugin'){if(d.level==='L1')appendAction(policy,bot,exec.name,'plugin:'+d.plugin,'L1');return decision;}
  if(d.level!=='L1')return decision;
  const target=completedPaths.get(exec.token)??d.path;appendAction(policy,bot,exec.name,target,'L1');
  return {kind:'accept',content:[...(decision.content??result.content??[]),{type:'text',text:`（已写入 ${d.area==='own'?'bots/'+bot+'/'+target.split('/bots/'+bot+'/')[1]:target}，L1 已记录）`}]};
 });
 ctx.on('tools/result',exec=>{completedPaths.delete(exec.token);pending.delete(exec.token);admissions.delete(exec.token);});
 function register(tool,description,properties,required,run) {
  ctx.tools.register({name:tool,description,parameters:{type:'object',properties,required,additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute(args,exec){
   exec.signal?.throwIfAborted();const d=check(exec);if(d.level==='L4')throw Error(deny(d.reason).reason);
   for(const field of required)if(!Object.hasOwn(args,field)||properties[field].type==='string'&&typeof args[field]!=='string')throw Error('缺少或无效参数 '+field);
   if(Object.keys(args).some(k=>!Object.hasOwn(properties,k)))throw Error('含未声明参数');
   if(d.level==='L3'){const denied=guard(exec);if(denied)throw Error(denied);}return run(args,exec,d);
  }});
 }
 const markText=value=>typeof value==='string'&&!value.startsWith('【外部来源】')?'【外部来源】'+value:value;
 const str={type:'string'};
 register('list_files','列一个获准目录，最多200项',{path:str},['path'],async(args,exec,d)=>{
  const st=fs.statSync(d.path);if(!st.isDirectory())throw Error('只能列目录');
  // 不展开子目录；对每个名称也执行read判定，避免泄露禁用条目与外部链接。
  const {cwd,bot,policy}=context(exec),bounds=creator()?creatorPaths(install):null;
  return JSON.stringify(fs.readdirSync(d.path).filter(n=>{
   const rd=evaluate(policy,bot,'read',{file_path:d.path+'/'+n},cwd);
   return (bounds?creatorFileDecision(rd,bounds,'read'):rd).level==='L0';
  }).sort().slice(0,200));
 });
 register('ticket_create','新建自己的备注工单',{title:str,body:str,assignee:str},['title','body'],async(args,exec)=>{
  const {bot,policy,s}=context(exec);
  const marked=exposed(bot)||s.untrusted===true;
  const t=createTicket(policy,bot,marked?{...args,title:markText(args.title),body:markText(args.body)}:args);
  completedPaths.set(exec.token,t.path);return JSON.stringify(t);
 });
 register('ticket_update','追加工单进度或更新备注状态',{id:str,append:str,status:str},['id'],async(args,exec,d)=>{
  const {bot,policy,s}=context(exec);
  const marked=(exposed(bot)||s.untrusted===true)&&args.append!==undefined;
  return '已更新 '+updateTicket(policy,bot,marked?{...args,append:markText(args.append)}:args,d.level==='L3'||creator());
 });
 register('ticket_move','移动备注工单到指定栏',{id:str,to:str},['id','to'],async(args,exec,d)=>{
  const {bot,policy}=context(exec);
  const p=moveTicket(policy,bot,args,d.level==='L3'||creator());completedPaths.set(exec.token,p);return '已移动 '+p;
 });
 register('bot_status','查看助理忙闲、待批与排队数量',{},[],async(_args,exec)=>JSON.stringify(botStatus(context(exec).policy)));
 register('bot_list','列出启用助理的id、当前名字和职责',{},[],async(_args,exec)=>JSON.stringify(context(exec).rows.filter(b=>b.status==='active').map(({id,name,duty})=>({id,name,duty}))));
 // 形象可选值写进 schema（来自 config/avatar-kinds.json），模型不用猜。
 const kinds=readAvatarKinds(install),en=(a,d)=>a.length?{type:'string',enum:a,description:d}:{type:'string',description:d};
 const avatar={description:'形象：素材角色 {kind:"role",role} 或图形头像 {kind:"shape",shape,color}；只能用列出的值',oneOf:[{type:'object',properties:{kind:{const:'role'},role:en(kinds.roles,'素材角色')},required:['kind','role'],additionalProperties:false},{type:'object',properties:{kind:{const:'shape'},shape:en(kinds.shapes,'形状'),color:en(kinds.colors,'颜色')},required:['kind','shape','color'],additionalProperties:false}]};
 const phrases={type:'array',items:{type:'string',maxLength:20},minItems:3,maxItems:3};
 const manage=async(_args,exec,d)=>{const {rows}=context(exec);if(!verifyChange(rows,d.management))throw Error('批准了但没改成，请 主人 看看');return '已改好：'+d.management.preview;};
 register('bot_update','调整自己的名字、形象、名牌色、职责或开场短语；首席可改其他助理，先请 Owner 确认',{target:str,name:{type:'string',minLength:1,maxLength:8},avatar,nameColor:str,duty:{type:'string',minLength:1,maxLength:60},phrases},[],manage);
 if(registeredRole==='chief'){
  register('bot_create','新建普通助理，先请 Owner 确认；权限由系统统一决定',{name:{type:'string',minLength:1,maxLength:8},duty:{type:'string',minLength:1,maxLength:60},notDuty:{type:'string',maxLength:120},avatar,phrases},['name','duty','notDuty','avatar','phrases'],manage);
  register('bot_set_status','停用或恢复一位助理，没有删除；先请 Owner 确认',{target:str,status:{type:'string',enum:['active','disabled']}},['target','status'],manage);
  register('delegate_to_bot','整件交给启用的普通助理前先问主人；owner_ok 为 true 才派。每轮最多3个。不要自动转单。',{bot:str,task:str,owner_ok:{type:'boolean'}},['bot','task'],async(args,exec)=>{
   const {s,bot,policy,rows}=context(exec),target=resolveBot(rows,args.bot);
   if(s.turn===null)throw Error('无法核实当前轮次，不能派活');
   if(args.owner_ok!==true)throw Error(handoffRefusal(target?.name||'同事'));
   if(s.count>=3)throw Error('本轮已派3个，不能再派');s.count++;
   // 兼容入口：权限表启用了 bots 模块就改走看板（send_to_bot 同一条路）；上面的首席与目标判定、每轮 3 个照旧。
   // 这里已经核对过主人点头，转发给 send_to_bot 时带上 owner_ok。
   const forward=pluginSpecs.get('send_to_bot');
   if(forward&&pluginTools.has('send_to_bot')){
    completedPaths.set(exec.token,path.join(boardCfg.dir,'tickets'));
    const {row}=context(exec),call=Object.freeze({bot,role:row.role,tool:'send_to_bot',
    sessionId:exec.agent.id,turn:s.turn,level:'L1',approved:false,
    readExternal:exposed(bot)||s.untrusted===true||s.internal||s.readOutside});
    return pluginCalls.run(call,()=>forward.execute({to:target.id,message:args.task,owner_ok:true},exec,call));}
   const t=createTicket(policy,bot,{title:args.task.slice(0,120),body:args.task,assignee:target.id,sessionId:exec.agent.id},true);completedPaths.set(exec.token,t.path);return '已派给 '+target.name+'，工单 '+t.id+'，前面还有 '+t.queued+' 个';
  });
 }
 // —— 插件扩展点 ——
 // 模块拿到的 deps；roster、policy 是取值时现读，不缓存旧名册。
 function pluginDeps(groupsClient){
  const deps={hubConfig:Object.freeze({...install,board:boardCfg}),board,material:wrapMaterial,
   state(sessionId){
    const s=[...sessions.entries()].find(([id])=>id===sessionId)?.[1];
    // 不认识的会话按「读过外部内容」处理，宁可多问。
    if(!s)return Object.freeze({known:false,bot:null,turn:null,readExternal:true,markExternalRead(){}});
    return Object.freeze({known:true,bot:s.bot,turn:s.turn,
     get readExternal(){return exposed(s.bot)||s.untrusted===true||s.internal||s.readOutside;},
     get externalTainted(){return exposed(s.bot)||s.untrusted===true;},
     // 预留本轮派单名额，失败或去重时归还。
     reserveSend(turn,limit){
      if(s.turn!==turn)throw Error('无法核实当前轮次，不能派单');
      if(s.sendCount>=limit)throw Error(`本轮已派 ${s.sendCount} 张（暂定上限）`);
      s.sendCount++;
      let released=false;
      return ()=>{
       if(!released&&s.turn===turn)s.sendCount--;
       released=true;
      };
     },
     markExternalRead(){
      s.foreignMaterial=true;
      mark(s,'插件工具读取外部内容','plugin',sessionId);
     },
     // 读到别的助理写的内容（组消息、工单正文与回报）：内部来源。
     markInternalRead(){s.internal=true;}});
   },
   async askApproval(card){
    // 内核的审批在执行前出卡；这里只核对本次调用确已批准，没有就拒，不另开通道。
    const call=pluginCalls.getStore();
    if(call?.level==='L3'&&call.approved===true||call?.tool==='rule_propose_shared'&&creator())
     return {approved:true,card};
    throw Error('这件事要先请 主人 批准：工具级别须为 L3，批准后才执行');
   },
   log(action){
    const call=pluginCalls.getStore();if(!call)throw Error('只能在工具执行中记录');
    appendAction(policyForRoster(basePolicy,readRoster()),call.bot,call.tool,
     String(action?.target??action??'').slice(0,300),'plugin');
   }};
  Object.defineProperty(deps,'groups',{enumerable:true,get:()=>groupsClient()});
  Object.defineProperty(deps,'roster',{enumerable:true,get:()=>readRoster()});
  Object.defineProperty(deps,'policy',{enumerable:true,get:()=>policyForRoster(basePolicy,readRoster())});
  return Object.freeze(deps);
 }
 function pluginCard(exec,args){
  const entry=pluginTools.get(exec.name);let card;
  let tainted=false;
  try{
   const {s,bot}=context(exec);
   tainted=Boolean(exposed(bot)||s.untrusted===true||s.internal||s.readOutside);
  }catch{tainted=true;}
  try{card=entry?.approvalCard?.(args,{readExternal:tainted})??{};}catch{card={};}
  const one=(v,n)=>String(v??'').replace(/[\r\n]+/g,' ').slice(0,n);
  return {action:one(card.action,40)||'用 '+exec.name,preview:one(card.preview,200)||
   one(JSON.stringify(args),200),why:one(card.why,200)};
 }
 function checkPluginArgs(spec,args){
  const props=spec.parameters.properties??{},required=spec.parameters.required??[];
  if(!args||typeof args!=='object'||Array.isArray(args))throw Error('参数无效');
  for(const k of required)if(!Object.hasOwn(args,k))throw Error('缺少参数 '+k);
  for(const [k,v] of Object.entries(args)){
   const p=props[k];if(!p)throw Error('含未声明参数');
   const ok=p.type==='string'?typeof v==='string'
    :p.type==='boolean'?typeof v==='boolean'
    :p.type==='integer'?Number.isSafeInteger(v)
    :p.type==='number'?Number.isFinite(v):true;
   if(!ok||p.enum&&!p.enum.includes(v)||typeof v==='string'
    &&p.maxLength!==undefined&&v.length>p.maxLength
    )throw Error('无效参数 '+k);
  }
 }
 function installPluginTools(){
  // config.toolModules 只给测试与安装者注入（预设配置不归模型写）；注入的模块同样要权限表点名才注册。
  const loaded=Array.isArray(config.toolModules)?{modules:config.toolModules,errors:[]}:TOOL_MODULES;
  for(const e of loaded.errors)ctx.logger.error('hub-plugin '+e);
  const enabled=basePolicy?.plugin_tools??[];
  if(!enabled.length||!board)return;
  const factory=loaded.modules.find(m=>enabled.includes(m?.name)&&typeof m.clientFactory==='function')?.clientFactory;
  const deps=pluginDeps(groupsClientFactory(install,factory,ctx.logger));
  for(const mod of loaded.modules){
   if(!mod||typeof mod.register!=='function'||!validLevels(mod.levels)){
    ctx.logger.error('hub-plugin 插件工具模块无效：'+mod?.name);
    continue;}
   if(!enabled.includes(mod.name))continue;
   const registerTool=spec=>{
    const name=spec?.name;
    if(typeof name!=='string'||!/^[a-z][a-z0-9_]{1,47}$/u.test(name)
     ||CORE_TOOLS.has(name)||pluginTools.has(name)
     )throw Error('插件工具名无效或重名：'+name);
    if(!Object.hasOwn(mod.levels,name))throw Error('插件工具没登记级别，拒绝注册：'+name);
    const params=spec.parameters;
    if(!params||params.type!=='object'||params.additionalProperties!==false
     ||typeof spec.execute!=='function'||typeof spec.description!=='string'
     )throw Error('插件工具定义无效：'+name);
    const entry=Object.freeze({module:mod.name,levels:mod.levels,
     approvalCard:typeof spec.approvalCard==='function'?spec.approvalCard:undefined,
     material:spec.material!==false});
    pluginTools.set(name,entry);pluginSpecs.set(name,spec);
    ctx.tools.register({name,description:spec.description,parameters:params,
     output:spec.output??{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:String(v)}]},
     async execute(args,exec){
     if(exec.name!==name)throw Error('审批后的工具已变化，请重新批准');
     exec.signal?.throwIfAborted();const d=check(exec);if(d.level==='L4')throw Error(deny(d.reason).reason);
     checkPluginArgs(spec,args);
     if(d.level==='L3'){
      const denied=guard(exec);
      if(denied)throw Error(denied);
      // 按对象键排序后比较卡片参数与两份执行参数。
      const normalized=value=>JSON.stringify(value,(_key,item)=>{
       if(!item||typeof item!=='object'||Array.isArray(item))return item;
       return Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]]));
      });
      const approved=normalized(JSON.parse(pending.get(exec.token).args));
      if(approved!==normalized(exec.arguments)||approved!==normalized(args))throw Error('审批后参数已变化，请重新批准');
     }
     const call=callContext(exec,d);
     const out=await pluginCalls.run(call,()=>spec.execute(args,exec,call));
     // 工具结果默认按资料包起来（工单正文、别的助理的回报、组消息都算）；模块明说 material:false 才不包。
     return entry.material&&typeof out==='string'?wrapMaterial([{type:'text',text:out}],
      '工具 '+name).map(p=>p.text).join('\n'):out;
    }});
   };
   try{mod.register(restrictedContext(ctx,registerTool),deps);}catch(e){
    ctx.logger.error('hub-plugin 插件工具模块 '+mod.name+' 注册失败：'+e.message);}
  }
 }
 installPluginTools();
}
