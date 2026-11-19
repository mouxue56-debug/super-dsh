import {readFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Roster,atomic,backup,agents,directory,validateRoster} from '../lib/roster.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const defaults={shapes:['circle','square','diamond','star','heart'],colors:['yellow','coral','blue','green','pink','purple']};
export async function migrationSources({repoRoot=root,shellDir=join(repoRoot,'packages/hub-web/shell-r23'),phrasesFile=join(repoRoot,'packages/devinst/presets-r24.phrases.json')}={}) {
 const shell=await readFile(join(shellDir,'index.html'),'utf8'),pack=JSON.parse(await readFile(join(shellDir,'pets/pack.json'),'utf8')),phrases=JSON.parse(await readFile(phrasesFile,'utf8'));
 // Only parse literal fields in the initial BOT_SRC block; never evaluate shell JS.
 const block=/var BOT_SRC = \[([\s\S]*?)\n\];/u.exec(shell)?.[1];if(!block)throw Error('找不到壳的初始助理清单');
 const short=/const SHORT=\{([^\n]+)\};/u.exec(shell)?.[1]??'',duties=Object.fromEntries([...short.matchAll(/([a-z][a-z0-9-]*):'([^']*)'/gu)].map(m=>[m[1],m[2]]));
 const rows=[];
 for(const line of block.split('\n')) {
   const id=/\{ id: '([^']+)'/u.exec(line)?.[1];if(!id||!Array.isArray(phrases[id]))continue;
   const name=/ name: '([^']+)'/u.exec(line)?.[1],color=/ color: '(#[A-Fa-f0-9]{6})'/u.exec(line)?.[1];
   if(!name||!color||!duties[id]||!pack.assistants?.[id])throw Error('壳的助理资料不完整：'+id);
   rows.push({id,name,color,duty:id==='chief'?'总调度 · 知识库':id==='support'?'咨询 · 预约':duties[id],phrases:phrases[id].slice(0,3)});
 }
 if(rows.length!==6)throw Error('初始助理不是六个，停止迁移');
 const roleIds=[...Object.keys(pack.assistants),...(Array.isArray(pack.spare)?pack.spare.map(v=>typeof v==='string'?v:v.id):Object.keys(pack.spare??{}))];
 const explicit=(name)=>{const m=new RegExp('(?:const|var) '+name+'\\s*=\\s*(\\[[^\\n]+\\])','u').exec(shell);if(!m)return null;try{const v=JSON.parse(m[1]);return Array.isArray(v)&&v.length&&v.every(s=>typeof s==='string')?v:null;}catch{return null;}};
 const colors=explicit('AVATAR_COLORS')??defaults.colors,shapes=explicit('AVATAR_SHAPES')??defaults.shapes;
 const kinds={roles:[...new Set(roleIds)],shapes,colors:[...new Set([...colors,...rows.map(r=>r.color)])]};
 return {rows,kinds,source:{roles:'pets/pack.json: assistants 的键 + spare 的 id',shapes:explicit('AVATAR_SHAPES')?'AVATAR_SHAPES':'通用默认',colors:explicit('AVATAR_COLORS')?'AVATAR_COLORS':'通用默认 + BOT_SRC 的名牌色'}};
}
export async function migrate({hubHome=process.env.HUB_HOME??join(homedir(),'dsh-work'),repoRoot=root,shellDir,phrasesFile,now=Date.now}={}) {
 hubHome=resolve(hubHome);const roster=new Roster({hubHome,now});
 return roster.change(async()=>{
   let migrated=false;try {await lstat(roster.file);migrated=true;}catch(e){if(e.code!=='ENOENT')throw e;}
   if(migrated){await roster.load();return {migrated:false,ids:roster.ids()};}
   await directory(roster.configDir);await directory(roster.botsDir);
   const template=await readFile(join(roster.configDir,'bot-template.md'),'utf8');if(!template.trim())throw Error('bot-template.md 为空，停止迁移');
   const {rows,kinds,source}=await migrationSources({repoRoot,shellDir,phrasesFile}),ts=new Date(now()).toISOString();
   const value={version:1,bots:rows.map((b,order)=>({id:b.id,name:b.name,role:b.id==='chief'?'chief':'bot',preset:'hub-'+b.id,status:'active',avatar:{kind:'role',role:b.id},nameColor:b.color,duty:b.duty,notDuty:'',phrases:b.phrases,order,createdAt:ts,updatedAt:ts}))};
   validateRoster(value,kinds);
   const originals=[];let kindsBefore;
   try{ kindsBefore=await readFile(roster.kindsFile);await backup(roster.kindsFile,now());}catch(e){if(e.code!=='ENOENT')throw e;}
   try {
     for(const bot of value.bots){
       const dir=join(roster.botsDir,bot.id);if(!(await lstat(dir)).isDirectory())throw Error('助理目录无效');await directory(dir);
       const path=join(dir,'AGENTS.md'),old=await backup(path,now(),'.bak-r26-');originals.push({path,raw:old.raw});
       const extra=bot.id==='support'?'客服规则正本在知识库 40-客服/客服场景规则.md（只读）。写任何对客内容前先用 read 读原文，和它冲突时以原文为准，不凭记忆复述。':'';
       await atomic(path,agents(bot,template,extra));
     }
     await atomic(roster.kindsFile,JSON.stringify(kinds)+'\n');
     await roster.log('owner','迁移名册','-', ['bots','avatarKinds'],'-');
     // 名册最后发布；有名册就代表所有 identity 已完成，重跑不再重写。
     await atomic(roster.file,JSON.stringify(value)+'\n');
   }catch(error){for(const original of originals)await atomic(original.path,original.raw);if(kindsBefore)await atomic(roster.kindsFile,kindsBefore);throw error;}
   return {migrated:true,ids:value.bots.map(b=>b.id),source,avatarKinds:kinds};
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try{console.log(JSON.stringify(await migrate(),null,2));}catch(e){console.error('迁移失败：'+e.message);process.exitCode=1;}
}
