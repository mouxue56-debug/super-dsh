import {open, mkdir, rename, lstat, constants, realpath} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {BffError} from './errors.mjs';
export const BOT_ID = /^[a-z][a-z0-9-]{1,23}$/u;
export const MAX_ACTIVE = 12;
export const ROSTER_TOOLS = ['bot_create','bot_update','bot_set_status'];
export const EDIT_FIELDS = ['name','avatar','nameColor','duty','notDuty','phrases'];
const ROW_FIELDS = ['id','name','role','preset','status','avatar','nameColor','duty','notDuty','phrases','order','createdAt','updatedAt'];
const locks = new Map();
export const object = v => v !== null && typeof v==='object' && !Array.isArray(v);
const keys = (v,allowed,required=[]) => object(v) && Object.keys(v).every(k=>allowed.includes(k)) && required.every(k=>Object.hasOwn(v,k));
const text = (v,max,empty=false) => typeof v==='string' && (empty || v.length>0) && Array.from(v).length<=max && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(v);
const iso = v => text(v,40) && /^\d{4}-\d\d-\d\dT/u.test(v) && Number.isFinite(Date.parse(v));
const bad = message => new BffError('INVALID_INPUT',message,400);
const storage = () => new BffError('STORAGE_FAILURE','名册没能保存，请稍后重试',503);
// 校验新名字仅含安全字符。
export function validName(v) {
  return text(v, 8) && v.trim() === v && /^[\p{L}\p{N} ·_()（）-]+$/u.test(v);
}
export function validAvatar(v,kinds,upload=false) {
  if(!object(v))return false;
  if(v.kind==='role')return keys(v,['kind','role'],['kind','role']) && text(v.role,64) && (!kinds || kinds.roles.includes(v.role));
  if(v.kind==='shape')return keys(v,['kind','shape','color'],['kind','shape','color']) && text(v.shape,64) && text(v.color,64) && (!kinds || kinds.shapes.includes(v.shape)&&kinds.colors.includes(v.color));
  return upload && v.kind==='upload' && keys(v,['kind','file','v'],['kind','file','v']) && typeof v.file==='string' && /^[a-z][a-z0-9-]{1,23}\.(png|jpg|webp|gif)$/u.test(v.file) && Number.isSafeInteger(v.v) && v.v>0;
}
// 已有的旧名字（读出时按 legacy 口径放行）只在审批卡的 before 里认，after 仍按新规则。
function legacyName(v) {
  return text(v, 8) && v.trim() === v && !/[\/\\:.~\p{Cf}\p{Cc}]/u.test(v);
}
export function validPatch(p,kinds,{status=false,upload=false,full=false,legacy=false}={}) {
  const allowed=[...EDIT_FIELDS,...(status?['status']:[])];
  return keys(p,allowed,full?EDIT_FIELDS:[]) && Object.keys(p).length>0 && Object.entries(p).every(([k,v])=>{
    if(k==='name')return legacy ? legacyName(v) : validName(v);
    if(k==='avatar')return validAvatar(v,kinds,upload);
    if(k==='nameColor')return text(v,64) && (!kinds || kinds.colors.includes(v));
    if(k==='duty')return text(v,2000) && !/<!--\s*\/?hub:identity\s*-->/iu.test(v);
    if(k==='notDuty')return text(v,2000,true) && !/<!--\s*\/?hub:identity\s*-->/iu.test(v);
    if(k==='phrases')return Array.isArray(v)&&v.length<=3&&v.every(s=>text(s,200));
    return k==='status' && ['active','disabled'].includes(v);
  });
}
export function validRosterCard(v,kinds) {
  if(!keys(v,['v','bot','sessionId','level','action','tool','path','chars','preview','target','before','after','why','id','type','callId','createdAt','expiresAt','seq','status','note']) || !ROSTER_TOOLS.includes(v?.tool) || !BOT_ID.test(v.bot??'') || !text(v.sessionId,200) || !text(v.why,200,true) || !text(v.preview,200,true) || v.chars!==0)return false;
  if(v.tool==='bot_create')return v.action==='新建助理' && v.target==='new' && v.before===null && validPatch(v.after,kinds,{full:true});
  if(!BOT_ID.test(v.target??'') || !object(v.before) || !object(v.after) || Object.keys(v.before).length!==Object.keys(v.after).length || !Object.keys(v.after).every(k=>Object.hasOwn(v.before,k)))return false;
  if(v.tool==='bot_update'){
    return v.action==='改助理' && validPatch(v.after,kinds) && validPatch(v.before,kinds,{upload:true,legacy:true});
  }
  return keys(v.before,['status'],['status']) && keys(v.after,['status'],['status']) && ['active','disabled'].includes(v.before.status) && ['active','disabled'].includes(v.after.status) && v.action===(v.after.status==='active'?'恢复助理':'停用助理');
}
export function validateRoster(value,kinds,{legacyNames=false}={}) {
  if(!keys(value,['version','bots'],['version','bots']) || value.version!==1 || !Array.isArray(value.bots) || !value.bots.length || value.bots.length>10000 || Buffer.byteLength(JSON.stringify(value))>1024*1024)throw bad('名册格式无效');
  const ids=new Set(),names=new Set();let chiefs=0,active=0;
  for(const b of value.bots) {
    if(!keys(b,ROW_FIELDS,ROW_FIELDS) || !BOT_ID.test(b.id??'') || !validPatch(Object.fromEntries(EDIT_FIELDS.map(k=>[k,k==='name'&&legacyNames?'旧名':b[k]])),kinds,{full:true,upload:true}) || legacyNames && !(text(b.name,8) && b.name.trim()===b.name && !/[\/\\:.~]/u.test(b.name)) || !['chief','bot'].includes(b.role) || !['active','disabled'].includes(b.status) || !/^hub-[a-z][a-z0-9-]{1,23}$/u.test(b.preset??'') || !Number.isSafeInteger(b.order) || b.order<0 || !iso(b.createdAt) || !iso(b.updatedAt) || ids.has(b.id) || names.has(b.name.normalize('NFC').toLowerCase()) || b.avatar.kind==='upload'&&!b.avatar.file.startsWith(b.id+'.'))throw bad('名册行无效或重名');
    ids.add(b.id);names.add(b.name.normalize('NFC').toLowerCase());chiefs+=b.role==='chief';active+=b.status==='active';
  }
  if(chiefs!==1 || active>MAX_ACTIVE)throw bad('名册须有一位首席，启用助理最多 12 个');
  return value;
}
export async function readSmall(path,max=1024*1024) {
  let f;try {f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const st=await f.stat();if(!st.isFile()||st.size>max)throw storage();return await f.readFile();}finally{await f?.close();}
}
export async function directory(path) {
  await mkdir(path,{recursive:true,mode:0o700});if(!(await lstat(path)).isDirectory() || (await lstat(path)).isSymbolicLink())throw storage();return realpath(path);
}
export async function atomic(path,value) {
  const tmp=path+'.tmp-'+randomBytes(6).toString('hex');let f;
  try {f=await open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await f.writeFile(value);await f.sync();await f.close();f=undefined;await rename(tmp,path);}finally{await f?.close();}
}
function stamp(now) {return new Date(now).toISOString().replace(/[-:]/gu,'').replace('T','-').slice(0,15);}
export async function backup(path,now=Date.now(),marker='.bak-') {
  const raw=await readSmall(path,4*1024*1024),dest=path+marker+stamp(now)+'-'+randomBytes(3).toString('hex');await atomic(dest,raw);return {raw,path:dest};
}
export function identity(bot) {return '<!-- hub:identity -->\n你的名字是「'+bot.name+'」。职责：'+bot.duty+'。不管：'+(bot.notDuty||'职责以外的事')+'。\n<!-- /hub:identity -->';}
export function agents(bot,template,extra='') {return '# '+bot.name+'\n\n'+identity(bot)+'\n\n'+(extra?extra.trim()+'\n\n':'')+template.trim()+'\n';}
export function updateIdentity(raw,bot) {
  const segment=/<!-- hub:identity -->[\s\S]*?<!-- \/hub:identity -->/gu;
  if((raw.match(segment)??[]).length!==1 || !/^# [^\r\n]+/u.test(raw))throw bad('助理说明缺少唯一 identity 段，请先迁移');
  return raw.replace(segment,()=>identity(bot)).replace(/^# [^\r\n]+/u,()=> '# '+bot.name);
}
export class Roster {
  constructor({hubHome=process.env.HUB_HOME??join(homedir(),'dsh-work'),configDir=join(hubHome,'config'),botsDir=join(hubHome,'bots'),now=Date.now,onChange=()=>{}}={}) {Object.assign(this,{hubHome:resolve(hubHome),configDir:resolve(configDir),botsDir:resolve(botsDir),now,onChange});this.file=join(this.configDir,'bots.yaml');this.kindsFile=join(this.configDir,'avatar-kinds.json');this.value=null;}
  async load() {
    const kinds=JSON.parse((await readSmall(this.kindsFile)).toString());
    if(!keys(kinds,['roles','shapes','colors'],['roles','shapes','colors']) || !Object.values(kinds).every(a=>Array.isArray(a)&&a.length>0&&a.length<=256&&new Set(a).size===a.length&&a.every(v=>text(v,64)&&/^[a-zA-Z0-9#_-]+$/u.test(v))))throw bad('形象取值清单无效');
    const value=validateRoster(JSON.parse((await readSmall(this.file)).toString()),kinds,{legacyNames:true});this.kinds=kinds;this.value=value;return this;
  }
  list() {return structuredClone(this.value?.bots??[]).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));}
  get(id) {return this.list().find(b=>b.id===id);}
  ids() {return this.list().map(b=>b.id);}
  chief(id) {return this.get(id)?.role==='chief';}
  enabled(id) {const b=this.get(id);if(!b)throw bad('助理不存在');if(b.status!=='active')throw new BffError('CONFLICT','这个助理已停用',409);return b;}
  presets() {return this.list().map(b=>({bot:b.id,preset:b.preset,name:b.name,cwd:join(this.botsDir,b.id),phrases:b.phrases}));}
  public() {return {bots:this.list().map(({createdAt,updatedAt,...b})=>b),limits:{maxActive:MAX_ACTIVE,nameMax:8},avatarKinds:structuredClone(this.kinds)};}
  change(fn) {const prior=locks.get(this.file)??Promise.resolve();const job=prior.catch(()=>{}).then(fn);locks.set(this.file,job.catch(()=>{}));return job;}
  async log(actor,action,id,fields,device) {
    let f;try {f=await open(join(this.configDir,'bots.changes.log'),constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW,0o600);if(!(await f.stat()).isFile())throw storage();await f.chmod(0o600);await f.writeFile([new Date(this.now()).toISOString(),actor,action,id,fields.join(','),device??'-'].map(s=>String(s).replace(/[\r\n\t]/gu,' ')).join('\t')+'\n');await f.sync();}finally{await f?.close();}
  }
  validateCard(card) {
    if(!validRosterCard(card,this.kinds) || card.path!==this.file)throw bad('名册审批格式或路径无法核验');
    if(card.status!==undefined && card.status!=='pending' || card.expiresAt!==undefined && this.now()>=Date.parse(card.expiresAt))throw new BffError('CONFLICT','审批已结束，请重出确认卡',409);
    this.enabled(card.bot);
    if(card.tool!=='bot_update'&&!this.chief(card.bot) || card.tool==='bot_update'&&card.target!==card.bot&&!this.chief(card.bot))throw new BffError('FORBIDDEN','只有首席可以改其他助理、新建或停用助理',403);
    if(card.tool!=='bot_create') {
      const b=this.get(card.target);if(!b)throw bad('目标助理不存在');
      if(!Object.entries(card.before).every(([k,v])=>isDeepStrictEqual(v,b[k])))throw new BffError('CONFLICT','资料已变化，请重出确认卡',409);
    }
  }
  approve(card,device) {return this.mutate({actor:card.bot,action:card.action,id:card.target,patch:card.after,create:card.tool==='bot_create',card,device});}
  patch(id,patch,device) {if(!validPatch(patch,this.kinds,{status:true}))throw bad('助理资料格式无效');return this.mutate({actor:'owner',action:'改助理',id,patch,device});}
  mutate({actor,action,id,patch,create=false,card,device,avatarFile}) {return this.change(async()=>{
    await this.load();if(card)this.validateCard(card);
    if(!validPatch(patch,this.kinds,{status:!create,upload:Boolean(avatarFile),full:create}))throw bad('助理资料格式无效');
    const before=structuredClone(this.value),ts=new Date(this.now()).toISOString();let bot;
    if(create) {
      id=undefined;
      for(let n=0;n<50;n++){const next='b'+randomBytes(4).toString('hex');if(this.get(next))continue;try{await lstat(join(this.botsDir,next));}catch(e){if(e.code==='ENOENT'){id=next;break;}throw e;}}
      if(!BOT_ID.test(id??''))throw storage();
      bot={id,...structuredClone(patch),role:'bot',preset:'hub-bot',status:'active',order:Math.max(...this.list().map(b=>b.order))+1,createdAt:ts,updatedAt:ts};this.value.bots.push(bot);
    } else {bot=this.value.bots.find(b=>b.id===id);if(!bot)throw new BffError('NOT_FOUND','助理不存在',404);Object.assign(bot,structuredClone(patch),{updatedAt:ts});}
    try {validateRoster(this.value,this.kinds,{legacyNames:true});}catch(e){this.value=before;throw e;}
    const next=structuredClone(this.value);this.value=before;
    let rosterWritten=false,agentsWritten=false,createdDir=false,oldAgent,agentFile,oldImages=[],imageDest,imageWritten=false;
    try {
      await directory(this.configDir);await directory(this.botsDir);await backup(this.file,this.now());
      const botDir=join(this.botsDir,id);agentFile=join(botDir,'AGENTS.md');
      if(create) {
        // 不复用孤立目录或软链接。
        await mkdir(botDir,{mode:0o700});createdDir=true;
        for(const part of ['drafts','notes','memory'])await mkdir(join(botDir,part),{mode:0o700});
        const template=(await readSmall(join(this.configDir,'bot-template.md'))).toString();if(!template.trim())throw storage();
        await atomic(agentFile,agents(bot,template));agentsWritten=true;
      } else if(['name','duty','notDuty'].some(k=>Object.hasOwn(patch,k))) {
        await directory(botDir);oldAgent=await backup(agentFile,this.now(),'.bak-r26-');
        await atomic(agentFile,updateIdentity(oldAgent.raw.toString(),bot));agentsWritten=true;
      }
      if(avatarFile) {
        const root=join(this.hubHome,'avatars');await directory(root);await directory(join(root,'.old'));
        imageDest=join(root,bot.avatar.file);
        const previous=before.bots.find(b=>b.id===id)?.avatar;
        const files=new Set([bot.avatar.file,...(previous?.kind==='upload'?[previous.file]:[])]);
        for(const file of files)try {const path=join(root,file),raw=await readSmall(path,16*1024*1024),saved=join(root,'.old',file+'.'+this.now()+'-'+randomBytes(3).toString('hex'));await rename(path,saved);oldImages.push({raw,path});}catch(e){if(e.code!=='ENOENT')throw e;}
        await atomic(imageDest,avatarFile);imageWritten=true;
      }
      if(card)this.validateCard(card);
      await atomic(this.file,JSON.stringify(next)+'\n');rosterWritten=true;
      await this.log(actor,action,id,Object.keys(patch),device);
      if(card)this.validateCard(card);
    } catch(error) {
      try {
        if(rosterWritten)await atomic(this.file,JSON.stringify(before)+'\n');
        if(create&&createdDir){const trash=join(this.hubHome,'tmp','roster-recovery');await directory(trash);await rename(join(this.botsDir,id),join(trash,id+'-'+this.now()+'-'+randomBytes(3).toString('hex')));}
        else if(agentsWritten&&oldAgent)await atomic(agentFile,oldAgent.raw);
        if(imageWritten){const trash=join(this.hubHome,'avatars','.old');await rename(imageDest,join(trash,bot.avatar.file+'.failed-'+randomBytes(3).toString('hex')));}
        for(const old of oldImages)await atomic(old.path,old.raw);
      } catch {throw new BffError('STORAGE_FAILURE','名册保存及回滚未完成，请检查备份',503);}
      if(error instanceof BffError)throw error;throw storage();
    }
    this.value=next;try{const notification=this.onChange(this.public());notification?.catch?.(()=>{});}catch{/* 文件已成功提交，通知失败不把成功伪装为失败。 */}
    return structuredClone(bot);
  });}
  async avatar(file) {
    if(!this.list().some(b=>b.avatar.kind==='upload'&&b.avatar.file===file))throw new BffError('NOT_FOUND','形象不存在',404);
    await directory(join(this.hubHome,'avatars'));return readSmall(join(this.hubHome,'avatars',file),16*1024*1024);
  }
}
