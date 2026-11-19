import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isIP} from 'node:net';
import {PROTECTED_FILES} from './protected-files.mjs';

const STATE=Symbol.for('hub-plugin.command-sandbox');
const normalize=p=>String(p).normalize('NFKC').normalize('NFC').toLowerCase().replace(/\/$/,'');
const inside=(p,r)=>normalize(p)===normalize(r)||normalize(p).startsWith(normalize(r)+'/');
const quote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
function canonical(value){
 if(typeof value!=='string'||!path.isAbsolute(value)||/[\0\r\n]/.test(value))throw Error('沙箱路径必须是明确的绝对目录');
 try{return fs.realpathSync.native(value);}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;const parent=path.dirname(value);if(parent===value)throw e;return path.join(canonical(parent),path.basename(value));}
}
function sensitive(home,hubHome){return ['.secrets','.ssh','.gnupg','Library/Keychains','.config','.codex','.grok','.claude','.local/share/opencode','.dsh','.agents','Library/LaunchAgents'].map(p=>home+'/'+p).concat([hubHome+'/config',hubHome+'/dev-home*',hubHome+'/dsh-hub','/Applications/DeepSeek Harness.app','/Library/LaunchDaemons','/Library/LaunchAgents']);}
const execDefaults=['/usr/bin/sudo','/bin/launchctl','/sbin/shutdown','/sbin/reboot','/usr/sbin/diskutil','/usr/bin/defaults','/usr/bin/security','/usr/bin/osascript','/usr/bin/open','/bin/kill','/usr/bin/killall','/usr/bin/pkill','/usr/bin/crontab'];
const reEscape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function filter(root){return root.endsWith('*')?'(regex '+quote('^'+reEscape(root.slice(0,-1)))+')':'(subpath '+quote(canonical(root))+')';}

/** Build a Seatbelt policy; extraWrite/network must come from an approved call. */
export function buildProfile({home=os.homedir(),hubHome=process.env.HUB_HOME||path.join(home,'dsh-work'),own,readable=[],denyRead=[],network=false,extraWrite=[],denyExec=[],selfAddrs=[],protectedNames=[]}={}){
 if(!Array.isArray(selfAddrs)||selfAddrs.some(value=>typeof value!=='string'||!isIP(value)))throw Error('selfAddrs 必须是明确的本机 IP 地址数组');
 home=canonical(home);hubHome=canonical(hubHome);own=canonical(own);
 if(own===home||inside(home,own)||own==='/')throw Error('own 不能使用家目录根或它的上级目录');
 const blocked=[...new Set([...sensitive(home,hubHome),...denyRead])];
 const denied=p=>blocked.some(r=>r.endsWith('*')?normalize(p).startsWith(normalize(r.slice(0,-1))):inside(p,r));
 if(denied(own))throw Error('自己的目录不能落在敏感禁止路径');
 const extra=extraWrite.map(canonical);
 for(const root of extra)if(root==='/'||root===home||inside(home,root)||denied(root)||['/etc','/private/etc','/System'].some(p=>inside(root,p)))throw Error('额外写根涉及敏感禁止路径或范围过宽');
 const read=[...new Set([own,...readable.map(canonical),canonical(path.join(home,'.local/bin')),canonical(path.join(home,'.gitconfig'))])];
 // Resolve node symlinks without inspecting credential contents. On bundled
 // installs its libraries live alongside the executable.
 for(const candidate of [path.join(home,'.local/bin/node'),process.execPath]){
  try{const binary=fs.realpathSync.native(candidate);read.push(path.dirname(binary));}catch{}
 }
 // Seatbelt matches specific allows before generic regex denies. Exclude
 // protected paths IN each allow rule; last-written deny alone is insufficient.
 const ci=s=>[...s].map(c=>/[a-z]/i.test(c)?'['+c.toLowerCase()+c.toUpperCase()+']':c==='.'?'[.]':c).join('');
 const names=['[^/]*'+ci('.credentials')+'[^/]*',ci('auth.json'),ci('.netrc'),ci('id_rsa')+'[^/]*',ci('id_ed25519')+'[^/]*','[^/]*'+ci('.pem'),'[^/]*'+ci('.key'),'[^/]*'+ci('-token'),ci('.hub-opencode-key')+'[^/]*',ci('.env')+'([.][^/]*)?'];
 const credentialFilter='(regex #'+quote('(^|/)('+names.join('|')+')(/|$)')+')';
 const safe=p=>'(require-all (subpath '+quote(p)+') (require-not hub-command-blocked))';
 // 指令文件与规矩页在任何目录都不可写（含改名、删除），只能经专用工具追加。
 // 名单与命令判定共用 protected-files.mjs；配置只能加名字。大小写不分（APFS 默认如此）。
 const extraNames=Array.isArray(protectedNames)
  ?protectedNames.filter(n=>typeof n==='string'&&/^[^/\0\r\n\]\\^]+$/.test(n)):[];
 // 含 ] \ ^ 的配置名写不成安全的 Seatbelt 字面量，这里不收；命令判定那一层照样按名拒。
 const literal=n=>[...n].map(c=>/[a-z]/i.test(c)?'['+c.toLowerCase()+c.toUpperCase()+']'
  :/[.*+?${}()|[]/.test(c)?'['+c+']':c).join('');
 const guarded=[...new Set([...PROTECTED_FILES,...extraNames].map(n=>n.normalize('NFC')))].map(literal);
 const protectedFilter='(regex #'+quote('(^|/)('+guarded.join('|')+')$')+')';
 const forms=['(version 1)',
  '(define hub-command-blocked (require-any '+[credentialFilter,...blocked.map(filter)].join(' ')+'))',
  '(allow default)','(deny file-write*)',
  '(allow file-write* (literal "/dev/null"))',
  '(allow file-write* '+[...new Set([own,...extra])].map(p=>'(require-all '+safe(p)+' (require-not (regex #'+quote('^'+reEscape(own)+'/[aA][gG][eE][nN][tT][sS][.][mM][dD]$')+')) (require-not '+protectedFilter+'))' ).join(' ')+')',
  '(deny file-read-data (subpath '+quote(home)+'))',
  '(allow file-read-data '+[...new Set(read)].map(safe).join(' ')+')'];
 for(const root of blocked){forms.push('(deny file-read* '+filter(root)+')');forms.push('(deny file-write* '+filter(root)+')');}
 forms.push('(deny file-read* '+credentialFilter+')','(deny file-write* '+credentialFilter+')','(deny file-write* (regex #'+quote('^'+reEscape(own)+'/[aA][gG][eE][nN][tT][sS][.][mM][dD]$')+'))',
  '(deny file-write* '+protectedFilter+')');
 if(network!==true)forms.push('(deny network*)');
 // On macOS, remote localhost matches addresses belonging to this machine,
 // including active tailnet interfaces (verified with real connect controls).
 // SBPL only accepts '*' or 'localhost' as hosts; literal IP rules do not compile.
 // Keep the caller's inventory in the generated profile for audit, while the
 // live kernel-local filter also covers newly added interfaces and DNS aliases.
 forms.push('; selfAddrs (covered by remote localhost): '+[...new Set(selfAddrs)].join(', '),
  '(deny network-outbound (remote ip "localhost:*"))',
  '(deny network-outbound (remote unix-socket))');
 // 批准联网时只放行系统 DNS 解析的那一个 unix socket（mDNSResponder），其余 unix socket 与本机回环照旧禁止。
 if(network===true)forms.push('(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))');
 // 系统根证书（/etc/ssl 下的公开 CA 包）会被 .pem 凭据规则误伤；批准联网时放回只读。
 if(network===true)forms.push('(allow file-read* (subpath "/private/etc/ssl"))');
 forms.push('(deny signal)','(allow signal (target self) (target children))');
 const binaries=[...new Set([...execDefaults,...denyExec].flatMap(p=>[p,canonical(p)]))];
 forms.push('(deny process-exec '+binaries.map(p=>'(literal '+quote(p)+')').join(' ')+')');
 return forms.join('\n')+'\n';
}

/** Wrap only assistant calls. Unknown kernel formats never run unconfined. */
export function installCommandSandbox(ctx,sandboxService,{getCall}={}){
 if(typeof sandboxService?.confine!=='function'||typeof getCall!=='function')throw Error('缺少可用的沙箱 confine 或调用上下文');
 let state=sandboxService[STATE];
 if(!state){
  const original=sandboxService.confine,entries=[];
  const wrapped=async function(...args){
   // Capture the AsyncLocalStorage value before awaiting the provider.
   let call;for(let i=entries.length-1;i>=0;i--){call=entries[i].getCall();if(call)break;}
   const result=await Reflect.apply(original,this,args);
   if(!call)return result;
   const argv=result?.argv;
   if(!Array.isArray(argv)||!['sandbox-exec','/usr/bin/sandbox-exec'].includes(argv[0])||argv[1]!=='-p'||typeof argv[2]!=='string')throw Error('未知的内核沙箱 argv 形状，拒绝执行');
   let start=3;if(argv[start]==='--')start++;
   if(!['bash','/bin/bash'].includes(argv[start])||argv[start+1]!=='-c'||typeof argv[start+2]!=='string'||argv.length!==start+3)throw Error('无法识别内核 bash argv 形状，拒绝执行');
   const own=canonical(call.own);let tmpdir;
   if(call.tmpdir){tmpdir=canonical(call.tmpdir);if(tmpdir===own||!inside(tmpdir,own))throw Error('TMPDIR 必须位于助理自己的目录下');}
   const profile=buildProfile({...call,own}),replacement=[...argv];replacement[2]=profile;
   if(tmpdir)replacement.splice(start,0,'/usr/bin/env','TMPDIR='+tmpdir);
   return {...result,argv:replacement};
  };
  state={original,wrapped,entries};sandboxService[STATE]=state;sandboxService.confine=wrapped;
 }
 const entry={getCall};state.entries.push(entry);let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;const i=state.entries.indexOf(entry);if(i>=0)state.entries.splice(i,1);if(!state.entries.length){if(sandboxService.confine===state.wrapped)sandboxService.confine=state.original;delete sandboxService[STATE];}};
 ctx?.effect?.(()=>dispose);
 return dispose;
}
