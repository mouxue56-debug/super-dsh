import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {loadHubConfig,parseFlatYaml} from './hub-config.mjs';
import {CMD_DEFAULTS} from './command-policy.mjs';
import {resolveBot} from './roster.mjs';
import {PROTECTED_FILES,isProtectedName} from './protected-files.mjs';
const defaults=()=>loadHubConfig({read:false});
export const BOTS=Object.freeze(defaults().bots);
export const AREAS = ['own','shared','tickets','kb','outside'];
export const TABLE = Object.freeze({
  read:['L0','L0','L0','L0','L4'], list_files:['L0','L0','L0','L0','L4'],
  write:['L1','L3','L4','L4','L4'], edit:['L1','L3','L4','L4','L4'],
  ticket_create:['L4','L4','L1','L4','L4'], ticket_update:['L4','L4','L1','L4','L4'],
  ticket_move:['L4','L4','L1','L4','L4'], bot_status:['L0','L4','L4','L4','L4'],
  delegate_to_bot:['L4','L4','L1','L4','L4']
});
const norm = s => s.normalize('NFC').toLowerCase();
export const within = (p,r) => norm(p) === norm(r) || norm(p).startsWith(norm(r).replace(/\/$/,'')+'/');
const forbidden = ['医院','病历','医疗','密钥','凭据','secrets','.env','聊天记录'];
function freeze(o) { if (o && typeof o==='object') { Object.getOwnPropertyNames(o).forEach(k=>freeze(o[k])); Object.freeze(o); } return o; }
export const COMMAND_DENY_PATHS=Object.freeze(['~/.secrets','~/.ssh','~/.gnupg','~/Library/Keychains','~/.config','~/.codex','~/.grok','~/.claude','~/.local/share/opencode','~/.dsh','~/.agents','$HUB_HOME/config','$HUB_HOME/dev-home*','/Applications/DeepSeek Harness.app','/Library/LaunchDaemons','/Library/LaunchAgents','~/Library/LaunchAgents','/etc','/System']);
export function roleTools(){const common=['read','write','edit','list_files','ticket_create','ticket_update','ticket_move','bot_status','bot_list','bot_update','bash'];return {bot:common,chief:[...common,'bot_create','bot_set_status','delegate_to_bot']};}
export function expectedTools(bots=defaults().bots,chief=defaults().chief){const tools=roleTools();return Object.fromEntries(bots.map(b=>[b,[...tools[b===chief?'chief':'bot']]]));}
export function policyForRoster(policy,rows){
 if(!policy)return undefined;
 const chief=rows.find(b=>b.role==='chief')?.id;
 return {...policy,bots:rows.map(b=>b.id),chief,roster:rows,kb_allow:Object.fromEntries(Object.entries(policy.kb_allow).filter(([id])=>rows.some(b=>b.id===id&&b.preset!=='hub-bot')))};
}
export function policyText(base=process.env.HUB_HOME??path.join(os.homedir(),'dsh-work'),kb=path.join(os.homedir(),'knowledge-base'),options={}) {
 const c={...defaults(),...options};
 const rows={version:1,base,kb,kb_allow:c.kb_allow,forbidden,others:'L4',ticket_other_creator:'L3',own_root_agents_write:'L4'};
 for(const [tool,levels] of Object.entries(TABLE))rows[tool]=Object.fromEntries(AREAS.map((a,i)=>[a,levels[i]]));
 rows.bash=Object.fromEntries(AREAS.map(a=>[a,'CMD']));
 for(const k of ['run','git_readonly','script','ask_always','deny','timeout_ms','timeout_max_ms','output_bytes','grant_days'])rows['cmd_'+k]=CMD_DEFAULTS[k];
 rows.cmd_deny_paths=COMMAND_DENY_PATHS;rows.cmd_taint_tools=[];rows.expected_tools=roleTools();
 rows.bot_list='L0';for(const t of ['bot_create','bot_update','bot_set_status'])rows[t]='L3';
 // 插件工具模块须在权限表点名才启用；不传就不写这一行，旧表逐字不变。
 if(options.pluginTools!==undefined)rows.plugin_tools=pluginToolList(options.pluginTools);
 // 收口：内核自带的可选工具须在权限表登记才算清单里的；不传就不写这一行。
 // subagent 与 skill 一样，只有调用方传入 kernelTools 才写进表。
 if(options.kernelTools!==undefined)rows.kernel_tools=kernelToolList(options.kernelTools);
 return '# 第26轮任务书，Fable 定，Owner 未确认；严格平面 YAML，每值为单行紧凑 JSON。\n'+Object.entries(rows).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n';
}
export function parsePolicy(text,options={}) {
 const p=parseFlatYaml(text,'权限表'),c={...defaults(),...options};
 // plugin_tools 是唯一可选键：取出单独严格校验，其余键集合仍须与生成表逐一相等。
 const plugins=pluginToolList(Object.hasOwn(p,'plugin_tools')?p.plugin_tools:[]);delete p.plugin_tools;
 const kernelTools=kernelToolList(Object.hasOwn(p,'kernel_tools')?p.kernel_tools:[]);delete p.kernel_tools;
 const expected=Object.keys(parseFlatYaml(policyText(undefined,undefined,c)));
 if(Object.keys(p).length!==expected.length||expected.some(k=>!Object.hasOwn(p,k)))throw Error('权限表缺键或未知键');
 if(p.version!==1||![p.base,p.kb].every(v=>typeof v==='string'&&path.isAbsolute(v)&&!/[\r\n\0]/.test(v))||JSON.stringify(p.kb_allow)!==JSON.stringify(c.kb_allow)||JSON.stringify(p.forbidden)!==JSON.stringify(forbidden)||p.others!=='L4'||p.ticket_other_creator!=='L3')throw Error('权限表根或硬边界错误');
 if(p.own_root_agents_write!=='L4')throw Error('own根AGENTS.md写保护必须为L4');
 for(const [t,levels]of Object.entries(TABLE))if(JSON.stringify(p[t])!==JSON.stringify(Object.fromEntries(AREAS.map((a,i)=>[a,levels[i]]))))throw Error('权限表级别不符合本轮硬边界');
 if(JSON.stringify(p.bash)!==JSON.stringify(Object.fromEntries(AREAS.map(a=>[a,'CMD']))))throw Error('bash必须交给命令判定');
 const list=(v)=>Array.isArray(v)&&v.every(s=>typeof s==='string')&&new Set(v).size===v.length;
 for(const k of ['run','git_readonly','script'])if(!list(p['cmd_'+k])||p['cmd_'+k].some(v=>!CMD_DEFAULTS[k].includes(v)))throw Error('命令放行名单只能收紧：'+k);
 for(const k of ['deny','ask_always'])if(!list(p['cmd_'+k])||CMD_DEFAULTS[k].some(v=>!p['cmd_'+k].includes(v)))throw Error('命令禁止/先问名单只能增加：'+k);
 for(const k of ['timeout_ms','timeout_max_ms','output_bytes','grant_days'])if(!Number.isSafeInteger(p['cmd_'+k])||p['cmd_'+k]<1||p['cmd_'+k]>CMD_DEFAULTS[k])throw Error('命令上限只能收紧：'+k);
 if(p.cmd_timeout_ms>p.cmd_timeout_max_ms||!list(p.cmd_deny_paths)||COMMAND_DENY_PATHS.some(v=>!p.cmd_deny_paths.includes(v))||!list(p.cmd_taint_tools)||JSON.stringify(p.expected_tools)!==JSON.stringify(roleTools()))throw Error('命令路径或工具清单硬边界错误');
 if(p.bot_list!=='L0'||['bot_create','bot_update','bot_set_status'].some(t=>p[t]!=='L3'))throw Error('名册工具级别不符合硬边界');
 p.plugin_tools=plugins;p.kernel_tools=kernelTools;
 Object.defineProperties(p,{bots:{value:[...c.bots]},chief:{value:c.chief},roster:{value:c.bots.map(id=>({id,name:c.names[id],role:id===c.chief?'chief':'bot',status:'active',preset:'hub-'+id}))}});return freeze(p);
}
export function commandLists(policy){return Object.fromEntries(['run','git_readonly','script','ask_always','deny','timeout_ms','timeout_max_ms','output_bytes','grant_days'].map(k=>[k,policy['cmd_'+k]]));}
const policyCache=new Map();
export function loadPolicy(file,options={}) { if (!policyCache.has(file)) { try { policyCache.set(file,{policy:parsePolicy(fs.readFileSync(file,'utf8'),options)}); } catch(e) { policyCache.set(file,{error:e.message}); } } return policyCache.get(file); }
// 不先 path.resolve：symlink/.. 必须按实际文件系统顺序处理。新路径的剩余段禁止 ..。
export function canonicalize(input,cwd) {
 if (typeof input!=='string' || !input || /[\0\r\n\uFF0E\u2024\uFF0F\uFF3C]/u.test(input)) throw Error('路径为空或含不安全字符');
 if (!path.isAbsolute(cwd)) throw Error('无法核实会话工作目录');
 const raw=path.isAbsolute(input)?input:cwd+'/'+input;
 let current='/',missing=false;
 for (let part of raw.split('/')) {
  if (!part || part==='.') continue;
  if (part==='..') { if(missing) throw Error('新路径剩余段含 ..'); current=path.dirname(current); continue; }
  if (!missing) {
   let candidate=path.join(current,part);
   try { current=fs.realpathSync.native(candidate); continue; }
   catch(e) { if(e.code!=='ENOENT') throw e;
    // Linux 上模拟 APFS 大小写/NFC 查找；macOS 上 realpath 通常已成功。
    const names=fs.readdirSync(current).filter(n=>norm(n)===norm(part));
    if(names.length>1) throw Error('路径大小写或Unicode有歧义');
    if(names.length===1) { current=fs.realpathSync.native(path.join(current,names[0])); continue; }
    missing=true;
   }
  }
  current=path.join(current,part);
 }
 return current.normalize('NFC');
}
export function ticketId(id) { if(typeof id!=='string' || !/^T-\d{8}-\d{6}-[a-f0-9]{4}$/.test(id)) throw Error('工单编号无效'); return id; }
export function inspectTicket(policy,id) {
 ticketId(id); const root=canonicalize(policy.base+'/tickets','/');
 const found=[];
 for(const col of ['new','working','done','failed','blocked']) { const p=canonicalize(`${root}/${col}/${id}.md`,'/'); if(!within(p,root)) throw Error('工单路径越界');
  try { const st=fs.lstatSync(p); if(!st.isFile() || st.size>1048576) throw Error('工单文件不安全'); const raw=fs.readFileSync(p,'utf8'); const end=raw.indexOf('\n---\n',4); if(!raw.startsWith('---\n') || end<0) throw Error('工单头无效'); const meta={}; for(const line of raw.slice(4,end).split('\n')) { const m=/^([A-Za-z]+): ([^\r\n]*)$/.exec(line); if(!m || Object.hasOwn(meta,m[1])) throw Error('工单头格式错误'); meta[m[1]]=m[2]; } if(meta.id!==id || !policy.bots.includes(meta.creator)) throw Error('工单身份无效'); found.push({path:p,col,meta,raw});
  } catch(e) { if(e.code!=='ENOENT') throw e; }
 }
 if(found.length!==1) throw Error('工单不存在或重号'); return found[0];
}
export function resolveFacts(policy,bot,tool,args,cwd) {
 if(!policy || !policy.bots.includes(bot) || !args || typeof args!=='object' || Array.isArray(args)) throw Error('权限表或助理身份不可核实');
 let target, ticket;
 if(['read','write','edit','list_files'].includes(tool)) target=args.file_path ?? args.path;
 else if(['ticket_update','ticket_move'].includes(tool)) { ticket=inspectTicket(policy,args.id); target=ticket.path; }
 else if(['ticket_create','delegate_to_bot'].includes(tool)) target=policy.base+'/tickets/'+(tool==='ticket_create'?'new':'working');
 else if(['bot_status','bot_list'].includes(tool)) target=policy.base+'/bots/'+bot;
 else return {area:'outside',path:'',known:false};
 const p=canonicalize(target,cwd);
 const roots={own:canonicalize(policy.base+'/bots/'+bot,'/'),shared:canonicalize(policy.base+'/shared','/'),tickets:canonicalize(policy.base+'/tickets','/')};
 const kbRoots=(policy.kb_allow[bot]??[]).map(r=>canonicalize(policy.kb+'/'+r,'/'));
 // 区域根本身若被替换成向外链接，不能让新目标变成合法区域。
 for(const [a,r] of Object.entries(roots)) if(!within(r,policy.base+'/'+(a==='own'?'bots/'+bot:a))) throw Error('区域根指向外部');
 if(kbRoots.some((r,i)=>!within(r,policy.kb+'/'+policy.kb_allow[bot][i]))) throw Error('知识库白名单根指向外部');
 const access=policy.group_access??{read:[],write:[]};
 const area=Object.keys(roots).find(a=>within(p,roots[a])) ??
  (kbRoots.some(r=>within(p,r))?'kb':access.write.some(r=>within(p,r))?'group_own':
   access.read.some(r=>within(p,r))?'group':'outside');
 // 规矩页与叠加指令文件也只能经专用工具追加。
 // 名单与命令判定、命令沙箱共用 protected-files.mjs；配置里的规矩页、叠加文件名只会往上加。
 const names=[...new Set([...PROTECTED_FILES,...(policy.protected_files??[])])];
 const protectedPaths=policy.bots.flatMap(b=>names
  .map(f=>canonicalize(policy.base+'/bots/'+b+'/'+f,'/')));
 const protectedAgents=protectedPaths.some(a=>norm(p)===norm(a)||within(p,a))||
  (['group','group_own'].includes(area)&&isProtectedName(path.basename(p),names));
 return {area,path:p,ticket,known:true,protectedAgents,blocked:policy.forbidden.some(s=>norm(p).includes(norm(s)))};
}
// 纯决策核：只消费已解析事实，不读写文件；两道入口都用同一函数。
export function decide(bot,tool,args,cwd,policy,facts) {
 if(!policy || !policy.bots.includes(bot) || !facts?.known) return {level:'L4',reason:'未列出的工具或身份不可核实',path:facts?.path??''};
 if(policy.roster?.find(b=>b.id===bot)?.status==='disabled')return {level:'L4',reason:'这个助理已停用',path:facts.path};
 let level=policy[tool]?.[facts.area]??'L4',reason='路径或工具不在本轮授权范围';
 if(['group','group_own'].includes(facts.area)) {
  if(['read','list_files'].includes(tool))level='L0';
  if(['write','edit'].includes(tool)&&facts.area==='group_own')level='L1';
 }
 if(facts.area==='kb'&&!policy.kb_allow[bot]) {level='L4';reason='本助理没有知识库白名单';}
 if(facts.blocked) {level='L4';reason='路径含禁用字样';}
 if(facts.protectedAgents&&['write','edit'].includes(tool)) {level='L4';reason='助理根目录 AGENTS.md 等指令文件和规矩页只能经专用工具追加';}
 if(tool==='delegate_to_bot'){const target=resolveBot(policy.roster??[],args.bot);if(policy.roster?.find(b=>b.id===bot)?.role!=='chief'||!target||target.role==='chief'||target.status!=='active'||typeof args.task!=='string'||!args.task.trim()||args.task.length>2000){level='L4';reason='只有首席能派给启用的普通助理，任务须为1至2000字';}}
 if(facts.ticket) {
  if(facts.ticket.meta.kind==='delegation') {level='L4';reason='派活工单只能由 BFF 更新或移动';}
  else if(level!=='L4' && facts.ticket.meta.creator!==bot) level='L3';
 }
 return {level,reason,path:facts.path,area:facts.area,ticketId:facts.ticket?.meta.id};
}
export function evaluate(policy,bot,tool,args,cwd) {try {return decide(bot,tool,args,cwd,policy,resolveFacts(policy,bot,tool,args,cwd));} catch(e) {return {level:'L4',reason:e.message,path:''};}}

// 插件工具（tools/ 下的模块）的级别。只认 L0、L1、L3、L4；可按角色给 {chief,bot}。
export const PLUGIN_LEVELS=Object.freeze(['L0','L1','L3','L4']);
// 内核自带、可以在权限表里登记的可选工具及其级别。名单外的一律不收（整表作废）。
// skill 只读手册全文。subagent 是本体进程内的分身：派这个动作本身不改东西，按 L0。
export const KERNEL_OPTIONAL_TOOLS=Object.freeze({skill:'L0',subagent:'L0'});

// 校验权限表里登记的内核可选工具名单。
export function kernelToolList(value){
 if(!Array.isArray(value)||new Set(value).size!==value.length)throw Error('kernel_tools 须为不重复的名单');
 if(value.some(v=>typeof v!=='string'||!Object.hasOwn(KERNEL_OPTIONAL_TOOLS,v)))throw Error('kernel_tools 只能登记 '
  +Object.keys(KERNEL_OPTIONAL_TOOLS).join('、'));
 return Object.freeze([...value]);
}
const PLUGIN_MODULE=/^[a-z][a-z0-9-]{0,31}$/u;

// 校验权限表里启用的插件模块名单：去重、限长、只许小写名，错一个整表作废。
export function pluginToolList(value){
 if(!Array.isArray(value)||value.length>32||new Set(value).size!==value.length)throw Error('plugin_tools 须为不重复的名单');
 if(value.some(v=>typeof v!=='string'||!PLUGIN_MODULE.test(v)||v==='index'))throw Error('plugin_tools 名字无效');
 return Object.freeze([...value]);
}

// 取一个插件工具对某角色的级别；写错、缺角色、不认识的级别一律当 L4。
export function pluginLevel(entry,role){
 const v=typeof entry==='string'?entry:entry&&typeof entry==='object'&&!Array.isArray(entry)?entry[role]:undefined;
 return PLUGIN_LEVELS.includes(v)?v:'L4';
}

// 插件工具的判定：身份、停用、权限表启用、模块声明级别，四关都过才不是 L4。
export function decidePlugin(policy,bot,tool,entry){
 if(!policy||!policy.bots?.includes(bot))return {level:'L4',reason:'权限表或助理身份不可核实',path:'',area:'plugin'};
 const row=policy.roster?.find(b=>b.id===bot);
 if(!row||row.status!=='active')return {level:'L4',reason:'这个助理已停用',path:'',area:'plugin'};
 if(!entry||!policy.plugin_tools?.includes(entry.module))return {level:'L4',reason:'这个工具没在权限表里启用',
  path:'',area:'plugin'};
 const level=pluginLevel(entry.levels?.[tool],row.role);
 return {level,reason:level==='L4'?'这个工具不对你的角色开放':'',path:'',area:'plugin',plugin:entry.module};
}
