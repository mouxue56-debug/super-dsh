import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isIP} from 'node:net';
import {PROTECTED_FILES,foldName,isProtectedName} from './protected-files.mjs';
import {commandShape} from './permission-shape.mjs';

// Only programs with an option parser below may become run. Configuration can
// narrow these lists; adding a name cannot create a new read-only parser.
export const CMD_DEFAULTS = Object.freeze({
 run:Object.freeze(['ls','cat','head','tail','wc','grep','rg','find','sort','uniq','cut','sed','jq','date','pwd','echo','printf','diff','cmp','file','stat','du','tee']),
 git_readonly:Object.freeze(['status','log','diff','show']),
 script:Object.freeze(['python3','node','sh','bash']),
 ask_always:Object.freeze(['codex','grok','opencode','kb-agent','cua-driver','osascript','open','curl','wget','git','npm','pnpm','yarn','pip','pip3','brew','gem','cargo','go','ssh','scp','rsync','nc','telnet','ping','awk','less','more','vi','vim','nano','env','command','builtin','nohup','setsid','disown','timeout','nice','time']),
 deny:Object.freeze(['sudo','su','doas','launchctl','systemctl','service','shutdown','reboot','halt','diskutil','hdiutil','mount','umount','fdisk','newfs','mkfs','scutil','networksetup','pmset','csrutil','spctl','security','dscl','kill','killall','pkill','crontab','at','chflags','shred','srm','eval','exec','source','.']),
 timeout_ms:60000,timeout_max_ms:600000,output_bytes:4096,grant_days:30
});
const rank={run:0,ask:1,deny:2};
const DEV_NULL='/dev/null';
// 重定向目标必须逐字是 /dev/null，且没有任何展开、通配或替换。
const discardTarget=t=>!!t&&!t.op&&t.value===DEV_NULL&&!t.wild&&!t.expanded&&!t.substituted;
const fold=x=>String(x).normalize('NFKC').normalize('NFC').toLowerCase();
const inside=(p,r)=>{p=fold(p);r=fold(r).replace(/\/$/,'');return p===r||p.startsWith(r+'/');};
const has=(list,x)=>(Array.isArray(list)?list:[]).includes(x);
const networkPrograms=new Set(['curl','wget','ssh','scp','nc','telnet','ping','npm','pnpm','yarn','pip','pip3','brew','gem','cargo','go','codex','grok','opencode','cua-driver']);
const wrappers=new Set(['env','command','builtin','nohup','setsid','timeout','nice','time','xargs']);
const interpreters=/^(?:sh|bash|zsh|dash|ksh|python[\d.]*|node|perl|ruby)$/;
const dangerousScript=/\b(?:sudo|doas|launchctl|systemctl|shutdown|reboot|diskutil|kill|pkill|killall|rm|rmdir|mv|chmod|chown|chgrp|defaults|security|osascript)\b|\.secrets|\.ssh|\.credentials|auth\.json|dev-home/i;
const credential=/(?:^|\/)\.hub-opencode-key[^/]*|(?:^|\/)\.env(?:[./]|$)|\.credentials|auth\.json|\.netrc|id_rsa|id_ed25519|\.pem|\.key|-token/i;
const slashes=/[\uff0f\uff3c\u2215\u2044\u2024\uff0e]/u;

function addressKey(value){
 if(!isIP(value))return null;
 if(isIP(value)===4)return value;
 const ip=new URL('http://['+value.split('%')[0]+']/').hostname.slice(1,-1);
 const mapped=ip.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
 if(mapped){const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);return [high>>>8,high&255,low>>>8,low&255].join('.');}
 return ip;
}
function selfAddresses(values=[]){
 if(!Array.isArray(values)||values.some(value=>typeof value!=='string'||!isIP(value)))throw Error('selfAddrs 必须是明确的本机 IP 地址数组');
 return [...new Set(values.map(addressKey))];
}
function localService(raw,selfAddrs){
 let value=fold(raw);
 // Inspect escaped/quoted text without evaluating shell or code. Computed
 // addresses and DNS aliases are still fenced by the actual kernel sandbox.
 for(let i=0;i<2;i++){try{const decoded=decodeURIComponent(value);if(decoded===value)break;value=decoded;}catch{break;}}
 if(/localhost|\.sock/.test(value))return true;
 const candidates=value.match(/[0-9a-z_.:%[\]-]+/g)||[];
 for(const match of value.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/g)){try{candidates.push(new URL(match[0]).hostname);}catch{}}
 return candidates.some(candidate=>{
  const bracket=candidate.match(/^\[([^\]]+)\](?::\d+)?$/);if(bracket)candidate=bracket[1];
  if(!isIP(candidate)){const port=candidate.match(/^(.*):\d+$/);if(port&&isIP(port[1]))candidate=port[1];}
  // WHATWG canonicalizes inet_aton integer/hex/short IPv4 spellings too.
  if(!isIP(candidate)&&!/^(?:0+|0x0+)$/.test(candidate)&&/^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+)){0,3}$/.test(candidate)){try{candidate=new URL('http://'+candidate+'/').hostname;}catch{}}
  const address=addressKey(candidate);
  return address!==null&&(address==='::'||address==='::1'||address==='0.0.0.0'||/^127\./.test(address)||selfAddrs.includes(address));
 });
}

// No shell evaluation: quote concatenation is folded into a single value;
// expansion and unsupported syntax are retained as reasons to ask/deny.
function lex(source,depth=0,start=0,stop=null){
 const tokens=[],issues=[],substitutions=[],backtick=String.fromCharCode(96);let value='',started=false,quote=null,wild=false,expanded=false,substituted=false,parens=0;
 const flush=()=>{if(started)tokens.push({value,wild,expanded,substituted});value='';started=false;wild=false;expanded=false;substituted=false;};
 const issue=(level,reason)=>issues.push({level,reason});
 const finish=(end,closed)=>{flush();if(quote)issue('ask','引号没有闭合，无法完整解析');return {tokens,issues,substitutions,end,closed};};
 for(let i=start;i<source.length;i++){
  const c=source[i],n=source[i+1];
  if(quote==="'"){if(c==="'")quote=null;else value+=c;continue;}
  if(c==='\\'){
   started=true;
   if(i+1<source.length){
    const next=source[++i];
    // Legacy escaped backtick nesting has shell-specific quoting semantics.
    if(stop===backtick&&next===backtick)issue('ask','反引号中的转义嵌套无法完整解析');
    if(quote==='"'&&!['$',backtick,'"','\\','\n'].includes(next))value+='\\';
    if(next!=='\n')value+=next;
   }else issue('ask','反斜杠没有结束，无法完整解析');
   continue;
  }
  if(!quote&&c===stop&&parens===0)return finish(i,true);
  const process=!quote&&(c==='<'||c==='>')&&n==='(';
  if(c===backtick||(c==='$'&&n==='(')||process){
   started=true;substituted=true;value+='__hub_substitution__';
   // 回到第 1 期的规矩，命令替换、反引号、进程替换一律永远拒绝。
   // 内层照旧解析，只为在理由与段落里看清楚，不会因此放行。
   issue('deny',process?'包含进程替换，会执行看不清的内容，这类永远不做'
    :'包含命令替换或反引号，会执行看不清的内容，这类永远不做');
   if(depth>=2){issue('ask','命令替换嵌套超过一层，无法完整解析');return finish(source.length,false);}
   const inner=lex(source,depth+1,i+(c===backtick?1:2),c===backtick?backtick:')');
   substitutions.push(inner);
   if(!inner.closed){issue('ask','命令或进程替换没有闭合，无法完整解析');return finish(source.length,false);}
   if(!inner.tokens.length)issue('ask','命令替换没有明确的内层命令');
   i=inner.end;continue;
  }
  if(c==='$'){expanded=true;issue('ask','包含变量展开，展开后的路径需要 Owner 确认');}
  if(quote==='"'){if(c==='"')quote=null;else value+=c;continue;}
  if(c==="'"||c==='"'){started=true;quote=c;continue;}
  if(/\s/.test(c)){flush();if(c==='\n')tokens.push({op:';'});continue;}
  if(c==='#')issue('ask','包含注释语法，需确认完整命令');
  if('(){}'.includes(c)){
   issue('ask','包含子 shell 或分组语法，需先确认');
   if(c==='(')parens++;else if(c===')'&&parens)parens--;
  }
  if(c==='<'&&n==='<')issue('ask','包含 here-doc 或 here-string，需先确认');
  const rest=source.slice(i),match=rest.match(/^(?:[012]>&[012]|&>>?|[012]?>>|[012]?>|<|&&|\|\||\||;|&)/);
  if(match){flush();const op=match[0];tokens.push({op});i+=op.length-1;if(op==='&')issue('ask','不允许直接留下后台进程');continue;}
  if('*?['.includes(c))wild=true;
  if(c==='~'&&started)issue('ask','包含不支持的路径展开');
  if(c==='{'||c==='}')issue('ask','包含花括号展开或分组，需确认');
  started=true;value+=c;
 }
 return finish(source.length,stop===null);
}

// Redirection targets are not program words, including before the executable.
function commandWords(group){
 const words=[];
 for(let i=0;i<group.length;i++){
  const t=group[i];
  if(!t.op)words.push(t);
  else if(!/^[012]>&[012]$/.test(t.op))i++;
 }
 return words;
}

function physical(raw,workdir,home){
 if(typeof raw!=='string'||!raw||raw.includes('\0')||slashes.test(raw))throw Error('路径含有不能安全解释的字符');
 let value=raw;
 if(value==='~')value=home;else if(value.startsWith('~/'))value=home+value.slice(1);else if(value.startsWith('~'))throw Error('不支持其他用户的波浪号展开');
 const parts=(path.isAbsolute(value)?value:workdir+'/'+value).split('/');
 let cur='/',missing=false;
 for(const part of parts){
  if(!part||part==='.')continue;
  if(part==='..'){if(missing)throw Error('不存在路径的剩余段含有上级目录');cur=path.dirname(cur);continue;}
  cur=path.join(cur,part);
  if(!missing){try{cur=fs.realpathSync.native(cur);}catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw Error('无法核实路径或符号链接');try{if(fs.lstatSync(cur).isSymbolicLink())throw Error('无法核实符号链接目标');}catch(x){if(!['ENOENT','ENOTDIR'].includes(x.code))throw x;}missing=true;}}
 }
 return cur;
}
function protectedRoots(home,hubHome){return ['.secrets','.ssh','.gnupg','Library/Keychains','.config','.codex','.grok','.claude','.local/share/opencode','.dsh','.agents'].map(x=>home+'/'+x).concat([hubHome+'/config',hubHome+'/dev-home*',hubHome+'/dsh-hub','/Applications/DeepSeek Harness.app','/Library/LaunchDaemons','/Library/LaunchAgents',home+'/Library/LaunchAgents','/etc','/System']);}

export function classifyCommand(input={}){
 const home=input.home||os.homedir(),hubHome=input.hubHome||process.env.HUB_HOME||path.join(home,'dsh-work');
 const groupFence=input.groupFence;
 const lists={...CMD_DEFAULTS,...input.lists},roots=input.roots||{},caps={network:false,writeRoots:[],longRunning:false};
 const segments=[],programs=[],readPaths=[],writePaths=[];
 let workdir=input.cwd||roots.own||home,level='run',grantId=null;
 let reason='只读查看，路径和选项均在允许范围内',writeUnknown=false;
 let grantEligible=true,sideEffect=false,nonLiteralNullRead=false;
 const notes=[];
 const raise=(l,r)=>{notes.push(r);if(rank[l]>rank[level]){level=l;reason=r;}};
 let selfAddrs=[];try{selfAddrs=selfAddresses(input.selfAddrs);}catch(e){raise('deny',e.message);}
 if(typeof input.command==='string'&&localService(input.command,selfAddrs))raise('deny','不许连本机的服务');
 const denies=[...protectedRoots(home,hubHome),...(input.denyPaths||[])].flatMap(d=>{try{const wildcard=d.endsWith('*');return [d,physical(wildcard?d.slice(0,-1):d,'/',home)+(wildcard?'*':'')];}catch{return [d];}});
 const isBlocked=(p,write=false)=>{
  const v=fold(p);if(slashes.test(p))return true;
  if(credential.test(v)||(input.forbiddenWords||[]).some(w=>w&&v.split('/').some(s=>s.includes(fold(w)))))return true;
  return denies.some(d=>{const f=fold(d);if(!write&&['/etc','/private/etc','/system'].includes(f))return false;if(f.endsWith('*'))return v.startsWith(f.slice(0,-1));return inside(v,f);});
 };
 const textualBlock=raw=>{
  const value=raw.replaceAll('${HOME}',home).replaceAll('$HOME',home).replace(/^~(?=\/|$)/,home);
  if(slashes.test(value))return true;
  // Inspect embedded paths too, including inline code and substitutions. No content is executed.
  if(credential.test(value)||/(?:^|[\/\s'"(=;])(?:~\/)?\.(?:secrets|ssh|gnupg)(?:\/|$|[\s'";)])/i.test(value))return true;
  return denies.some(d=>{const f=fold(d);if(['/etc','/private/etc','/system'].includes(f))return false;const needle=f.endsWith('*')?f.slice(0,-1):f;const v=fold(value);let pos=v.indexOf(needle);while(pos!==-1){const after=v[pos+needle.length];if(f.endsWith('*')||!after||/[\/\s'";)<>&|]/.test(after))return true;pos=v.indexOf(needle,pos+1);}return false;});
 };
 const canonical=(raw)=>physical(raw,workdir,home);
 // 指令文件与规矩页（AGENTS.md、规矩.md、AGENTS.local.md 及配置加的名字）
 // 在任何目录、任何写法下都不许经命令写；名单与 write/edit 判定、命令沙箱共用 protected-files.mjs。
 const protectedNames=[...new Set([...PROTECTED_FILES,
  ...(Array.isArray(input.protectedNames)?input.protectedNames.filter(n=>typeof n==='string'&&n):[])])];
 const mentionsProtected=v=>{const f=fold(v);return protectedNames.some(n=>f.includes(foldName(n)));};
 const protectedTarget=p=>{
  if(isProtectedName(path.basename(p),protectedNames))
   return '助理的指令文件和规矩页（'+path.basename(p)+'）只能经专用工具追加';
  // 硬链接：同一个文件可能另有一个受保护的名字，核实不了就不写。
  try{const st=fs.statSync(p);if(st.isFile()&&st.nlink>1)return '写入目标有多个硬链接，可能就是受保护的文件';}catch{}
  return null;
 };
 const inspect=(raw,write,raiseLocal)=>{
  if(textualBlock(raw)){raiseLocal('deny','碰到了凭据、系统保护区或其他禁用路径，这类永远不做');return null;}
  if(write&&(/[$*?[\]]/.test(raw)||raw.includes('__hub_substitution__'))){
   raiseLocal('deny','写入目标含变量、通配符或替换，核实不了会不会落到指令文件或规矩页，这类永远不做');return null;
  }
  let p;try{p=canonical(raw);}catch(e){raiseLocal('deny',e.message);return null;}
  if(groupFence?.root){
   const rawPath=path.resolve(workdir,raw);
   const inRoot=inside(p,groupFence.root)||inside(rawPath,groupFence.root);
   if(inRoot){
    if((groupFence.ended||[]).some(r=>inside(p,r)||inside(rawPath,r))){
     raiseLocal('deny','讨论组已结束，放权失效');return null;
    }
    const allowed=write?groupFence.write:groupFence.read;
    if(!Array.isArray(allowed)||!allowed.some(r=>inside(p,r))){
     raiseLocal('deny',write?'不能写这个讨论组的该目录':'不是这个讨论组的组员，读不了');
     return null;
    }
   }
  }
  const guarded=write?protectedTarget(p):null;
  if(guarded){raiseLocal('deny',guarded+'，命令不能写，这类永远不做');return null;}
  if(isBlocked(p,write)){raiseLocal('deny','碰到了凭据、系统保护区或其他禁用路径（'+p+'），这类永远不做');return null;}
  // 只有字面上就是 /dev/null 的才当空设备；经 ..、链接绕到它的照普通写入判。
  if(write&&p==='/dev/null'&&raw===DEV_NULL)return p;
  if(!write&&p==='/dev/null'&&raw!==DEV_NULL)nonLiteralNullRead=true;
  const paths=write?writePaths:readPaths;
  if(!paths.includes(p))paths.push(p);
  if(write)sideEffect=true;
  const allowed=write?(roots.writable||[roots.own]).filter(Boolean):(roots.readable||[roots.own]).filter(Boolean);
  if(!allowed.some(r=>inside(p,r))){raiseLocal('ask',(write?'要写自己目录以外的地方':'要读允许范围以外的地方')+'（'+p+'），需要 主人 点头');if(write){let dir=p;try{if(!fs.statSync(p).isDirectory())dir=path.dirname(p);}catch{dir=path.dirname(p);}if(!caps.writeRoots.includes(dir))caps.writeRoots.push(dir);}}
  return p;
 };
 let timeoutMs=input.timeoutMs===undefined?lists.timeout_ms:input.timeoutMs;
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>Math.min(lists.timeout_max_ms,CMD_DEFAULTS.timeout_max_ms)){timeoutMs=Number.isFinite(timeoutMs)?timeoutMs:CMD_DEFAULTS.timeout_ms;raise('deny','命令超时必须为正数，且不能超过十分钟');}
 else if(timeoutMs>Math.min(lists.timeout_ms,CMD_DEFAULTS.timeout_ms))raise('ask','这条命令需要超过默认时限，请 主人 批准更长时间');
 try{workdir=physical(input.workdir||workdir,input.cwd||roots.own||home,home);}catch(e){raise('deny',e.message);}
 if(groupFence?.root&&inside(workdir,groupFence.root)){
  if((groupFence.ended||[]).some(r=>inside(workdir,r))||
   !(groupFence.read||[]).some(r=>inside(workdir,r))){
   raise('deny','工作目录不在可读取的有效讨论组范围内');
  }
 }
 if(isBlocked(workdir,false))raise('deny','工作目录落在永远禁止访问的地方');
 else if(!(roots.readable||[roots.own]).filter(Boolean).some(r=>inside(workdir,r)))raise('ask','工作目录在允许读取的范围以外，需要 主人 点头');
 if(typeof input.command!=='string'||!input.command.trim()||input.command.includes('\0'))raise('deny','命令为空或含有非法字符');
 const parsed=lex(typeof input.command==='string'?input.command:'');
 const groups=[],tokens=[];
 // Parse each substitution independently; its paths, programs and capabilities
 // go through the very same segment policy as the surrounding command.
 const collect=(part,inlineDepth=0)=>{
  tokens.push(...part.tokens);
  for(const x of part.issues){raise(x.level,x.reason);grantEligible=false;}
  if(part.substitutions.length)grantEligible=false; // Never broaden reusable grants to dynamic arguments.
  if(['|','&&','||'].includes(part.tokens.at(-1)?.op)){raise('ask','命令连接符缺少右侧程序，无法完整解析');grantEligible=false;}
  const addGroup=g=>{
   groups.push(g);
   const words=commandWords(g),names=words.map(t=>fold(path.basename(t.value)));
   const shell=wrappers.has(names[0])?names.findIndex(n=>/^(?:sh|bash|zsh|dash|ksh)$/.test(n)):(/^(?:sh|bash|zsh|dash|ksh)$/.test(names[0])?0:-1);
   if(shell<0)return;
   const option=words.findIndex((t,i)=>i>shell&&/^-[a-z]*c/.test(t.value)),script=words[option+1];
   // Single quotes defer substitution to the inner shell. Inspect that shell's
   // literal -c text too, without evaluating it or treating it as authorization.
   if(option<0||!script||script.substituted)return;
   if(inlineDepth>=2){raise('ask','内联 shell 嵌套过深，无法完整解析');grantEligible=false;return;}
   collect(lex(script.value),inlineDepth+1);
  };
  let group=[];
  for(const token of part.tokens){
   if(token.op&&[';','&&','||','|','&'].includes(token.op)){
    if(group.length)addGroup(group);else if(token.op!==';'){raise('ask','命令连接符缺少一端，无法完整解析');grantEligible=false;}
    group=[];
   }else group.push(token);
  }
  if(group.length)addGroup(group);
  for(const inner of part.substitutions)collect(inner,inlineDepth);
 };
 collect(parsed);
 const allValues=tokens.filter(t=>!t.op).map(t=>t.value);
 for(const value of allValues)if(localService(value,selfAddrs))raise('deny','不许连本机的服务');
 for(const value of [typeof input.command==='string'?input.command:'',...allValues])if(textualBlock(value))raise('deny','命令中包含凭据或禁止访问的路径，这类永远不做');
 const allPrograms=groups.flatMap(g=>{const words=commandWords(g).map(t=>fold(path.basename(t.value)));return wrappers.has(words[0])?words:[words[0]];});
 const feedsInterpreter=allPrograms.some(p=>interpreters.test(p)||['eval','exec','source','.'].includes(p));
 if(feedsInterpreter&&(allPrograms.some(p=>['curl','wget'].includes(p))||groups.some(g=>{const v=commandWords(g).map(t=>t.value),p=fold(path.basename(v[0]||''));return (p==='base64'&&v.some(a=>/^(?:-[a-zA-Z]*[dD][a-zA-Z]*|--decode)$/.test(a)))||(p==='xxd'&&v.some(a=>a.startsWith('-r')||a==='-revert'))||(p==='openssl'&&v.includes('-d'));})))raise('deny','下载或解码的内容不能直接交给解释器执行');
 for(const g of groups){
  let sl='run',sr='只读查看，路径和选项均已检查';const local=(l,r)=>{if(rank[l]>rank[sl]){sl=l;sr=r;}};
  if(g.some(token=>!token.op&&localService(token.value,selfAddrs)))local('deny','不许连本机的服务');
  const words=[];
  for(let i=0;i<g.length;i++){
   const t=g[i];if(!t.op){words.push(t);continue;}
   if(/^[012]>&[012]$/.test(t.op))continue;
   if(['>','>>','1>','1>>','2>','2>>','0>','0>>','&>','&>>','<'].includes(t.op)){
    const target=g[++i];if(!target||target.op){local('ask','重定向缺少目标，无法完整解析');grantEligible=false;continue;}
    // 把输出或错误输出丢进字面上的 /dev/null 不算写文件（今晚唯一一处有意放宽）。
    if(t.op!=='<'&&discardTarget(target))continue;
    if(target.wild||target.expanded||target.substituted){local('ask','重定向目标包含展开，需要先确认');grantEligible=false;}
    inspect(target.value,t.op!=='<',local);
   }else{local('ask','包含不支持的重定向语法');grantEligible=false;}
  }
  if(!words.length){local('ask','没有明确的程序，需先确认');segments.push({programs:[],level:sl,reason:sr});raise(sl,sr);continue;}
  let scriptBranch=false,name=words[0].value,program=fold(path.basename(name)),args=words.slice(1);const segmentPrograms=[program];programs.push(program);
  if(words[0].expanded||words[0].wild||words[0].substituted){local('ask','程序名称包含展开，不能直接执行');grantEligible=false;}
  if(name.includes('/')){
   let executable;
   try{executable=canonical(name);if(isBlocked(executable,false))local('deny','程序路径位于永远禁止访问的地方');}catch(e){local('deny',e.message);}
   if(executable&&has(CMD_DEFAULTS.deny,fold(path.basename(executable))))local('deny','程序符号链接实际指向永远禁止的程序');
   let bundledNode=false;try{bundledNode=program==='node'&&executable===fs.realpathSync.native(path.join(home,'.local/bin/node'));}catch{}
   const trusted=executable&&(['/bin','/usr/bin','/usr/sbin','/sbin'].some(r=>inside(executable,r))||bundledNode);
   if(!trusted&&!name.startsWith('./')&&!name.startsWith('../'))local('ask','程序路径不属于已知系统程序，需要先确认');
  }
  if(has(CMD_DEFAULTS.deny,program)||has(lists.deny,program))local('deny','包含提权、系统管理、破坏性操作或任意执行程序（'+program+'），这类永远不做');
  if(wrappers.has(program)){local('ask','执行包装器需要 Owner 确认被包装的完整命令');grantEligible=false;for(const a of args){const wrapped=path.basename(a.value);if(has(CMD_DEFAULTS.deny,wrapped)||has(lists.deny,wrapped))local('deny','包装器内包含永远禁止的程序（'+wrapped+'）');}for(const a of args)if(!a.value.startsWith('-')&&(a.value.includes('/')||a.value.startsWith('~')))inspect(a.value,false,local);}
  for(const a of args)if(a.expanded){local('ask','参数包含变量展开，需要确认实际值');grantEligible=false;}
  const values=args.map(a=>a.value);
  if(wrappers.has(program)||/^[A-Za-z_][A-Za-z_0-9]*=/.test(name)||(program==='find'&&values.some(v=>['-exec','-execdir','-ok','-okdir'].includes(v)))){for(const a of args)if((a.value!=='.'&&has(CMD_DEFAULTS.deny,path.basename(a.value)))||dangerousScript.test(a.value))local('deny','包装或间接执行内容里包含永远禁止的程序');}
  if(/^[A-Za-z_][A-Za-z_0-9]*=/.test(name)){local('ask','环境赋值会改变后续执行，需要先确认');grantEligible=false;}
  if(program==='ps'&&values.some(v=>/^[^-]*[eE]/.test(v)||/^-[^-]*[eE]/.test(v)))local('deny','不能读取其他进程的环境变量');
  if(program==='defaults'&&values.some(v=>['write','delete','import'].includes(v)))local('deny','不能修改系统默认设置');
  if(program==='xattr'&&values.some(v=>/^-[a-z]*[dc]/.test(v)||v==='--delete'))local('deny','不能删除隔离或其他扩展属性');
  if(program==='dd'&&values.some(v=>v.startsWith('of=/dev/')))local('deny','不能写入块设备');
  if(program==='rclone'&&(values.some(v=>['purge','delete','deletefile','cleanup','--resync'].includes(v))))local('deny','不能删除远端数据或强制重新同步');
  if(program==='find'&&(values.some(v=>v==='-delete')||(values.includes('/')&&values.some(v=>['-exec','-execdir','-ok','-okdir'].includes(v)))))local('deny','find -delete 批量删除永远拒绝');
  if(program==='git'){
   const sub=values.find(v=>['reset','clean','push','branch','add','checkout','restore'].includes(v))||'';
   if((sub==='reset'&&values.includes('--hard'))||(sub==='clean'&&values.some(v=>/^-[a-z]*f/.test(v)))||(sub==='push'&&values.some(v=>/^--force(?:$|[-=])/.test(v)||v==='-f'||v==='--delete'))||(sub==='branch'&&values.some(v=>/^-[a-zA-Z]*D/.test(v)))||(sub==='add'&&values.some(v=>['-A','--all','.'].includes(v)))||(sub==='checkout'&&values.includes('--'))||(sub==='restore'))local('deny','这是丢弃改动、强推、批量暂存或删除分支的 git 操作');
  }
  if((wrappers.has(program)&&values.some(v=>networkPrograms.has(fold(path.basename(v)))))||networkPrograms.has(program)||(program==='git'&&values.some(v=>['clone','pull','push','fetch','ls-remote','submodule'].includes(v)))||(program==='rsync'&&values.some(v=>v.includes(':'))))caps.network=true;
  if((program==='tail'&&values.some(v=>/^-[a-zA-Z]*[fF]/.test(v)||v.startsWith('--follow')))||['sleep','yes','watch','nohup','setsid','disown'].includes(program)||(program==='python3'&&values.includes('-m')&&values.some(v=>v==='http.server'))||values.some(v=>['serve','--watch'].includes(v)))caps.longRunning=true;
  if(program==='curl'||program==='wget'){
   const writes=program==='curl'?['-o','--output','-D','--dump-header','-c','--cookie-jar','--trace','--trace-ascii']:['-O','--output-document','-a','--append-output','-o','--output-file','-P','--directory-prefix'];
   for(let j=0;j<args.length;j++){const t=args[j],x=t.value;const exact=writes.includes(x),long=writes.find(v=>v.startsWith('--')&&x.startsWith(v+'=')),short=writes.find(v=>v.length===2&&x.startsWith(v)&&x.length>2);if(exact){if(args[j+1])inspect(args[++j].value,true,local);else local('ask','输出选项缺少路径');}else if(long)inspect(x.slice(long.length+1),true,local);else if(short)inspect(x.slice(short.length),true,local);}
  }
  const pathArg=(t,write=false)=>{if(t.wild||(/[?*\[]/.test(t.value))){local('ask','路径含通配符，展开后可能越界，需要先确认');grantEligible=false;}inspect(t.value,write,local);};
  const inline=(interpreters.test(program)&&values.some(v=>/^-[a-z]*[ce]/.test(v)||v==='--eval'||v==='--print'));
  if(inline){
   sideEffect=true;writeUnknown=true;
   local('ask','内联代码需要 主人 审批完整内容');grantEligible=false;
   for(const a of args){
    if(dangerousScript.test(a.value))local('deny','内联代码里出现永远禁止的操作或路径');
   }
  }
  else if(has(lists.script,program)||name.startsWith('./')||name.startsWith('../')){
   scriptBranch=true;sideEffect=true;writeUnknown=true;
   const script=name.startsWith('./')||name.startsWith('../')?words[0]:args[0];
   if(!script||script.substituted||script.value.startsWith('-'))local('ask','解释器没有明确的自有脚本文件，需要先确认');
   else{
    const p=inspect(script.value,false,local);
    if(!p||!roots.own||!inside(p,roots.own))local('ask','只能直接运行自己目录里的脚本');
    else if(input.sandboxActive!==true)local('ask','脚本需要有效沙箱，当前必须先问 主人');
    else{try{const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK|fs.constants.O_NOFOLLOW);try{if(!fs.fstatSync(fd).isFile())throw Error('not a regular script');const b=Buffer.alloc(65536),n=fs.readSync(fd,b,0,b.length,0);if(dangerousScript.test(b.subarray(0,n).toString()))local('ask','脚本内容出现危险操作字样，交给 主人 先确认');}finally{fs.closeSync(fd);}}catch{local('ask','无法读取脚本进行辅助检查，需要先确认');}}
   }
   for(const a of (script===words[0]?args:args.slice(1)))pathArg(a);
  }else if(program==='git'){
   let i=0,sub='';for(;i<args.length;i++){
    const t=args[i],v=t.value;
    if(v==='-C'){const target=args[++i];if(!target)local('ask','git -C 缺少目录');else pathArg(target);continue;}
    if(v.startsWith('-C')&&v.length>2){pathArg({...t,value:v.slice(2)});continue;}
    if(v==='-c'||v.startsWith('-c')||v.startsWith('--exec-path')||v.startsWith('--git-dir')||v.startsWith('--work-tree')||v.startsWith('--config-env')){local('ask','git 配置或执行路径选项不能直接放行');grantEligible=false;if(v.includes('='))inspect(v.slice(v.indexOf('=')+1),false,local);else if(args[i+1]&&!args[i+1].value.startsWith('-'))pathArg(args[++i]);continue;}
    sub=v;i++;break;
   }
   if(!has(lists.git_readonly,sub))local('ask','这个 git 子命令需要 主人 点头');
   let end=false;for(;i<args.length;i++){
    const t=args[i],v=t.value;
    if(v==='--'){end=true;continue;}if(end){pathArg(t);continue;}
    if(v==='--output'||v.startsWith('--output=')||v.startsWith('-o')||v.startsWith('--ext-diff')||v.startsWith('--textconv')||v.startsWith('--no-index')||v.startsWith('--config-env')||v.startsWith('--exec-path')){local('ask','git 选项可能写文件或执行辅助程序，需要先确认');grantEligible=false;if(v==='--output'||v==='-o'){if(args[i+1])inspect(args[++i].value,true,local);}else if(v.startsWith('--output='))inspect(v.slice(9),true,local);else if(v.startsWith('-o'))inspect(v.slice(2),true,local);continue;}
    if(v.startsWith('-')){if(v==='-n'||v==='--max-count'){if(args[i+1])i++;else local('ask','git 选项缺少数值');}else if(!/^(?:--(?:short|branch|porcelain(?:=v?[12])?|oneline|stat|numstat|name-only|name-status|cached|staged|no-pager|no-color|color=never|no-ext-diff|no-textconv|no-renames|check|quiet|exit-code|all|reverse|patch)|-[psbuUw]|-\d+|-n\d+|--max-count=\d+|--(?:since|until|format|pretty)=.+)$/.test(v))local('ask','未登记的 git 选项需要先确认');}
    else if(/^(?:HEAD(?:[~^]\d*)?|[a-f0-9]{7,40})(?::|\.\.|$)/i.test(v)){if(v.includes(':'))inspect(v.slice(v.indexOf(':')+1),false,local);}
    else pathArg(t);
   }
  }else if(has(lists.run,program)&&has(CMD_DEFAULTS.run,program)){
   if(['ls','find'].includes(program)&&!args.some(t=>!t.value.startsWith('-')))readPaths.push(workdir);
   readonly(program,args,(l,r)=>{if(l==='ask')grantEligible=false;local(l,r);},pathArg,inspect);
   if(program==='find')for(let i=0;i<args.length;i++){
    if(['-fprint','-fprint0','-fprintf','-fls'].includes(args[i].value)&&args[i+1]){
     inspect(args[i+1].value,true,()=>{});
    }
   }
  }else{
   sideEffect=true;
   local('ask','这个程序或操作尚未直接放行，需要 主人 点头');
   if(['tar','unzip','gunzip','7z','bsdtar'].includes(program))writeUnknown=true;
   if(['rm','rmdir','mv','cp','ln','chmod','chown','chgrp','touch','mkdir','truncate','dd','install','rsync','tar','unzip','tee'].includes(program)){
    let positionals=args.filter(t=>!t.value.startsWith('-'));
    if(program==='tar'&&positionals[0]&&/^[a-zA-Z]+$/u.test(positionals[0].value))
     positionals=positionals.slice(1);
    for(let i=0;i<positionals.length;i++){
     let t=positionals[i];if(program==='dd'&&t.value.includes('=')){const [key,...rest]=t.value.split('=');if(!['if','of'].includes(key))continue;t={...t,value:rest.join('=')};}
     if(['chown','chgrp','chmod'].includes(program)&&i===0)continue;
     if(['rsync'].includes(program)&&t.value.includes(':'))continue;
     const sourceOnly=['cp','ln','rsync','install'].includes(program)&&i<positionals.length-1;
     const p=inspect(t.value,!sourceOnly,local);
     if(program==='mv'&&i<positionals.length-1)inspect(t.value,false,()=>{});
     // 链接或复制的来源若实际是受保护文件（含经符号链接），也拒：硬链接会让它换个名字被写。
     if(p&&sourceOnly&&isProtectedName(path.basename(p),protectedNames))
      local('deny','来源是助理的指令文件或规矩页，不能链接或复制成别的名字');
     if(p&&roots.own&&!inside(p,roots.own)){
      if(['rm','rmdir','chmod','chown','chgrp'].includes(program))local('deny','删除或改权限的目标在自己目录以外，这类永远不做');
      if(program==='mv'&&(values.includes('-f')||fs.existsSync(p)))local('deny','不能向自己目录以外覆盖式移动文件');
     }
    }
   }else{
    writeUnknown=true;
    for(const t of args){
     if(['/','~','../','./'].some(prefix=>t.value.startsWith(prefix)))pathArg(t);
    }
   }
  }
  if(has(lists.ask_always,program)&&!(program==='git'&&sl==='run'))local('ask','这个程序需要 主人 审批');
  // 不是纯查看的命令（先问的、跑脚本的）只要提到受保护文件名，就永远拒绝。
  if((sl!=='run'||scriptBranch||inline)&&[name,...values].some(mentionsProtected))
   local('deny','命令提到了助理的指令文件或规矩页，又不是纯查看，这类永远不做（只能经专用工具追加）');
  // 单引号里写的替换语法，交给会再解释它的程序（ssh、awk、watch 等先问的）时也拒。
  if(sl!=='run'&&[name,...values].some(v=>/\$\(|[<>]\(/.test(v)||v.includes(String.fromCharCode(96))))
   local('deny','参数里带命令替换或反引号写法，交给会再解释它的程序，这类永远不做');
  segments.push({programs:segmentPrograms,level:sl,reason:sr,inline,
   ...commandShape(program,args,{inline,script:scriptBranch})});raise(sl,sr);
 }
 if(!groups.length){raise('ask','无法识别完整命令');grantEligible=false;}
 if(input.tainted===true){raise('ask','本轮读过外部内容，所有命令都必须先问 主人');grantEligible=false;}
 // 修G：只读过自己人写的内容（组消息、工单、组文件夹）时只读命令照常跑；
 // 写文件、跑脚本、内联代码、联网、长时间运行，以及靠放行规则才能跑的，一律先问。
 else if(input.internalTainted===true&&(sideEffect||level!=='run'||caps.network||caps.longRunning||
  segments.some(x=>x.inline))){
  raise('ask','本轮读过别的助理写的内容，只读命令照常跑，写文件、跑脚本这类要先问 主人');grantEligible=false;
 }
 const nonRun=segments.filter(s=>s.level==='ask');
 let grantKey=level==='ask'&&grantEligible&&nonRun.length<=1&&programs.length&&new Set(nonRun[0]?.programs||programs).size===1?{program:nonRun[0]?.programs[0]||programs[0],dir:workdir}:null;
 if(level==='ask'&&grantKey){
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(input.now||new Date());
  for(const g of input.grants||[]){
   if(!g||g.bot!==input.bot||g.program!==grantKey.program||g.revokedAt||!/^\d{4}-\d{2}-\d{2}$/.test(g.until||'')||g.until<today||!Number.isFinite(Date.parse(g.until+'T00:00:00Z'))||new Date(g.until+'T00:00:00Z').toISOString().slice(0,10)!==g.until)continue;
   let dir;try{dir=fs.realpathSync.native(g.dir);}catch{continue;}
   if(dir!==workdir||(caps.network&&!g.caps?.network)||(caps.longRunning&&!g.caps?.longRunning)||!caps.writeRoots.every(r=>(g.caps?.writeRoots||[]).some(a=>inside(r,a))))continue;
   level='run';reason='命中 主人 对这个助理、程序与目录的有效放行规则';grantId=g.id;break;
  }
 }
 return {level,reason,segments,programs:[...new Set(programs)],workdir,timeoutMs,caps,sideEffect,writeUnknown,
  readPaths,writePaths,nonLiteralNullRead,notes,
  grantKey:level==='deny'?null:grantKey,grantId};
}

// Explicit per-program option allowlists. Unknown options can never silently
// acquire write/execute capabilities through a new version of a utility.
const optionSpec={
 ls:{short:'aAbBcCdDfFgGhHiIklLmMnNoOpPqQrRsStTuUvVwWxX1',long:['all','almost-all','directory','human-readable','reverse','recursive','size','file-type','classify','color=never']},
 cat:{short:'benstuvET',long:['number','number-nonblank','squeeze-blank','show-ends','show-tabs','show-nonprinting']},
 head:{short:'qv',takes:['n','c'],long:['quiet','verbose'],longTakes:['lines','bytes']},
 tail:{short:'qr',takes:['n','c'],long:['quiet'],longTakes:['lines','bytes']},
 wc:{short:'clwmL',long:['bytes','chars','lines','words','max-line-length']},
 grep:{short:'EFGivwnrlLhcsoRH',takes:['A','B','C','m'],long:['extended-regexp','fixed-strings','ignore-case','invert-match','word-regexp','line-regexp','recursive','line-number','count','files-with-matches','files-without-match','only-matching','no-messages'],longTakes:['after-context','before-context','context','max-count']},
 rg:{short:'iwnlLcrsUFvH',takes:['A','B','C','m','g','t','T'],long:['ignore-case','fixed-strings','word-regexp','line-regexp','files','hidden','no-ignore','line-number','count','files-with-matches','only-matching','no-messages','no-heading','with-filename','no-filename'],longTakes:['glob','type','type-not','max-count','context','after-context','before-context']},
 sort:{short:'bdfghinrMsucCmzV',takes:['k','t'],long:['reverse','unique','numeric-sort','general-numeric-sort','human-numeric-sort','ignore-case','check','stable'],longTakes:['key','field-separator']},
 uniq:{short:'cduiz',takes:['f','s','w'],long:['count','repeated','unique','ignore-case'],longTakes:['skip-fields','skip-chars','check-chars']},
 cut:{short:'nsz',takes:['b','c','f','d'],long:['complement','only-delimited','zero-terminated'],longTakes:['bytes','characters','fields','delimiter','output-delimiter']},
 diff:{short:'abBcdDipqrsStTuwy',takes:['U','C'],long:['brief','recursive','unified','context','ignore-all-space','ignore-space-change','ignore-blank-lines','strip-trailing-cr','text','report-identical-files'],longTakes:[]},
 cmp:{short:'lsbz',takes:['n','i'],long:['silent','quiet','verbose'],longTakes:['bytes','ignore-initial']},
 file:{short:'bchiIkLnNprsz',takes:['F'],long:['brief','mime','mime-type','mime-encoding','dereference','no-pad'],longTakes:['separator']},
 stat:{short:'FLnqrsx',takes:['f','t'],long:['dereference','terse'],longTakes:['format','printf']},
 du:{short:'aAchHklLmsx',takes:['d'],long:['all','human-readable','summarize','total','one-file-system'],longTakes:['max-depth']},
 tee:{short:'ai',long:['append','ignore-interrupts']}
};
function readonly(program,args,raise,pathArg,inspect){
 const v=args.map(t=>t.value);
 if(['echo','printf'].includes(program)){if(program==='printf'&&v[0]?.startsWith('-'))raise('ask','printf 只放行明确的打印格式');if(args.some(t=>t.wild))raise('ask','回显参数包含路径展开，需要先确认');if(program==='echo'&&v.some(s=>s==='-e'||s==='-E'))raise('ask','回显的转义选项需要先确认');for(const t of args)if(/^(?:\/|~|\.\.?\/)/.test(t.value))pathArg(t);return;}
 if(program==='pwd'){if(v.some(x=>!['-L','-P'].includes(x)))raise('ask','pwd 只允许 -L 或 -P');return;}
 if(program==='date'){for(const t of args)if(!t.value.startsWith('+')&&!['-u','-R','-I','--iso-8601','--utc'].includes(t.value))raise('ask','date 只放行查看时间的选项');return;}
 if(program==='find'){
  const expr=new Set(['-name','-iname','-path','-ipath','-regex','-iregex','-type','-size','-mtime','-mmin','-ctime','-cmin','-atime','-amin','-maxdepth','-mindepth','-depth','-user','-group','-perm','-links','-inum']);
  for(let i=0;i<args.length;i++){const t=args[i],x=t.value;if(expr.has(x)&&x!=='-depth'){if(!args[++i])raise('ask','find 表达式缺少值');continue;}if(['-print','-print0','-empty','-prune','-depth','-a','-and','-o','-or','!','-not','(',')','-H','-P','-L'].includes(x))continue;if(x==='-newer'||x==='-anewer'||x==='-cnewer'){if(args[i+1])pathArg(args[++i]);else raise('ask','find 缺少比较文件');continue;}if(x.startsWith('-'))raise('ask','find 只放行查找选项，执行或写文件选项需要先确认');else pathArg(t);}return;
 }
 if(program==='sed'){
  let expression=false;for(let i=0;i<args.length;i++){const t=args[i],x=t.value;if(['-n','-E','-En','-nE'].includes(x))continue;if(x.startsWith('-')){raise('ask','sed 只放行 -n、-E 和打印表达式');continue;}if(!expression){expression=true;if(!/^(?:\d+(?:,\d+|,\$)?|\$)?(?:p|=|q)$/.test(x)&&!/^\/(?:[^/\\]|\\.)*\/(?:p|=|q)$/.test(x))raise('ask','sed 表达式可能写文件或执行程序，需要先确认');}else pathArg(t,v.some(a=>/^-[A-Za-z]*i/.test(a)||a.startsWith('--in-place')));}if(!expression)raise('ask','sed 缺少明确打印表达式');return;
 }
 if(program==='jq'){
  let expression=false;
  for(let i=0;i<args.length;i++){
   const t=args[i],x=t.value;
   if(x==='--rawfile'||x==='--slurpfile'){
    raise('ask','jq 附加读文件需要先确认');
    i++;
    if(args[i+1])pathArg(args[++i]);
    continue;
   }
   if(x==='--arg'||x==='--argjson'){
    if(!args[i+1]||!args[i+2])raise('ask','jq 参数缺少值');
    i+=2;
    continue;
   }
   if(/^-[crRsSnjMeC]+$/.test(x)||['--compact-output','--raw-output','--slurp','--null-input',
    '--sort-keys','--monochrome-output','--exit-status'].includes(x))continue;
   if(x.startsWith('-')){
    raise('ask','未登记的 jq 选项需要先确认');
    continue;
   }
   if(!expression){
    expression=true;
    // 读环境变量、读额外输入、调试输出、模块加载（会读别的文件）一律先问。
    const sensitiveVariable=/\$(?:ENV|__prog_args|__loc__|JQ_\w*)\b/;
    const sensitiveCall=new RegExp('\\b(?:env|input|inputs|debug|stderr|halt_error|input_filename|'+
     'input_line_number|import|include|modulemeta|get_\\w+|\\$__\\w+)\\b');
    const checked=x.replace(/"(?:\\.|[^"\\])*"/g,' ')
     .replace(/\.[A-Za-z_][A-Za-z0-9_]*/g,' ');
    if(/\\\(/.test(x)||sensitiveVariable.test(checked)||sensitiveCall.test(checked)){
     raise('ask','jq 环境、输入或诊断表达式需要先确认');
    }
   }else pathArg(t);
  }
  if(!expression)raise('ask','jq 缺少明确表达式');
  return;
 }
 const spec=optionSpec[program];if(!spec){raise('ask','程序没有只读选项解析器');return;}
 if(program==='file'&&args.some(t=>/^-[^-]*z/.test(t.value))){
  raise('ask','file 解压选项可能调用外部程序，需要先确认');
 }
 let end=false,pattern=false;
 for(let i=0;i<args.length;i++){
  const t=args[i],x=t.value;if(x==='--'&&!end){end=true;continue;}
  if(!end&&(program==='grep'||program==='rg')&&['-e','--regexp','-f','--file'].includes(x)){const arg=args[++i];if(!arg)raise('ask','搜索选项缺少参数');else if(x==='-f'||x==='--file')pathArg(arg);pattern=true;continue;}
  if(!end&&program==='sort'&&(x==='-o'||x.startsWith('--output=')||x==='--output'||x.startsWith('-o'))){raise('ask','sort 输出文件需要先确认');if(x==='-o'||x==='--output'){if(args[i+1])pathArg(args[++i],true);}else pathArg({...t,value:x.startsWith('--output=')?x.slice(9):x.slice(2)},true);continue;}
  if(!end&&x.startsWith('-')&&x!=='-'){
   if(/^-\d+$/.test(x)&&['head','tail'].includes(program))continue;
   if(x.startsWith('--')){const [key]=x.slice(2).split('=');if(spec.longTakes?.includes(key)){if(!x.includes('=')){if(!args[++i])raise('ask','选项缺少参数');}}else if(!spec.long.includes(x.slice(2)))raise('ask','未登记的 '+program+' 选项需要先确认');continue;}
   for(let j=1;j<x.length;j++){const c=x[j];if((spec.takes||[]).includes(c)){if(j===x.length-1&&!args[++i])raise('ask','选项缺少参数');break;}if(!spec.short.includes(c))raise('ask','未登记的 '+program+' 选项需要先确认');}continue;
  }
  if((program==='grep'||program==='rg')&&!pattern&&!v.includes('--files')){pattern=true;continue;}
  pathArg(t,program==='tee'||(program==='uniq'&&i===args.length-1&&args.filter(a=>!a.value.startsWith('-')).length>1));
 }
}
