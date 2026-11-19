import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';

export const BOT_ID=/^[a-z][a-z0-9-]{1,23}$/u;
export const MANAGEMENT_TOOLS=['bot_create','bot_update','bot_set_status'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed,required=[])=>object(v)&&Object.keys(v).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(v,k));
const text=(v,max,empty=false)=>typeof v==='string'&&(empty||v.length>0)&&Array.from(v).length<=max&&!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(v);
const nameOK = (v) => text(v, 8) && v.trim() === v && /^[\p{L}\p{N} ·_()（）-]+$/u.test(v);
const legacyNameOK = (v) => text(v, 8) && v.trim() === v && !/[\/\\:.~]/u.test(v);
const identityText=(v,max,empty=false)=>text(v,max,empty)&&! /<!--\s*\/?hub:identity\s*-->/iu.test(v);
const folded=s=>s.normalize('NFC').toLowerCase();
// JSON.parse establishes syntax; this token walk detects decoded duplicate object keys.
function rejectDuplicateKeys(raw){
 const stack=[];
 for(const match of raw.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/gu)){
  const token=match[0],top=stack.at(-1);
  if(token==='{')stack.push({object:true,keys:new Set(),wantKey:true});
  else if(token==='[')stack.push({object:false});
  else if(token==='}'||token===']')stack.pop();
  else if(token===','&&top?.object)top.wantKey=true;
  else if(token.startsWith('"')&&top?.object&&top.wantKey){const key=JSON.parse(token);if(top.keys.has(key))throw Error('JSON有重复键');top.keys.add(key);top.wantKey=false;}
 }
}
function readJSON(file,max=1024*1024){let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const s=fs.fstatSync(fd);if(!s.isFile()||s.size>max||(s.mode&0o777)!==0o600||process.getuid&&s.uid!==process.getuid())throw Error('须为本用户的0600普通文件');const raw=fs.readFileSync(fd,'utf8'),value=JSON.parse(raw);rejectDuplicateKeys(raw);return value;}finally{if(fd!==undefined)fs.closeSync(fd);}}
const deepFreeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(deepFreeze);Object.freeze(v);}return v;};
export function validateRoster(value, {legacyNames = false} = {}){
 if(!keys(value,['version','bots'],['version','bots'])||value.version!==1||!Array.isArray(value.bots)||!value.bots.length||value.bots.length>10000)throw Error('名册格式无效');
 const fields=['id','name','role','preset','status','avatar','nameColor','duty','notDuty','phrases','order','createdAt','updatedAt'];
 const iso=v=>text(v,40)&&/^\d{4}-\d\d-\d\dT/u.test(v)&&Number.isFinite(Date.parse(v));
 const ids=new Set(),names=new Set();let chiefs=0,active=0;
 for(const r of value.bots){
  if(!keys(r,fields,fields)||!Number.isSafeInteger(r.order)||r.order<0||!iso(r.createdAt)||!iso(r.updatedAt)||!BOT_ID.test(r.id??'')||!(legacyNames ? legacyNameOK(r.name) : nameOK(r.name))||!['chief','bot'].includes(r.role)||!['active','disabled'].includes(r.status)||!/^hub-[a-z][a-z0-9-]{1,23}$/u.test(r.preset??'')||r.preset==='hub-bot'&&r.role!=='bot'||!identityText(r.duty,2000)||!identityText(r.notDuty,2000,true)||!Array.isArray(r.phrases)||r.phrases.length>3||r.phrases.some(s=>!text(s,200))||!text(r.nameColor,64)||!object(r.avatar)||ids.has(r.id)||names.has(folded(r.name)))throw Error('名册行无效或重名');
  if(!validAvatar(r.avatar,null,true)||r.avatar.kind==='upload'&&!r.avatar.file.startsWith(r.id+'.'))throw Error('名册形象无效');
  ids.add(r.id);names.add(folded(r.name));chiefs+=r.role==='chief';active+=r.status==='active';
 }
 if(chiefs!==1||active<1||active>12)throw Error('名册须有一位首席、至少一个启用、最多12个启用');
 return deepFreeze(value.bots);
}
export function createRosterReader(install){
 const file=path.join(install.hubHome,'config/bots.yaml');let stamp,cached;
 return ()=>{try{
  let st;try{st=fs.lstatSync(file,{bigint:true});}catch(e){if(e.code!=='ENOENT')throw e;stamp=undefined;cached=undefined;return deepFreeze(install.bots.map((id,i)=>({id,name:install.names[id],role:id===install.chief?'chief':'bot',preset:'hub-'+id,status:'active',duty:'以工作目录 AGENTS.md 为准',notDuty:'',phrases:[],order:i})));}
  if(st.isSymbolicLink()||!st.isFile()||(Number(st.mode)&0o777)!==0o600||process.getuid&&Number(st.uid)!==process.getuid())throw Error('须为本用户的0600普通文件');
  const next=[st.dev,st.ino,st.size,st.mtimeNs,st.ctimeNs].join(':');if(next!==stamp){const rows=validateRoster(readJSON(file), {legacyNames: true});cached=rows;stamp=next;}return cached;
 }catch(e){stamp=undefined;cached=undefined;throw Error('名册不可核实：'+e.message);}};
}
export function readAvatarKinds(install){
 try{const v=readJSON(path.join(install.hubHome,'config/avatar-kinds.json'),65536);if(!keys(v,['roles','shapes','colors'],['roles','shapes','colors'])||!Object.values(v).every(a=>Array.isArray(a)&&a.length>0&&a.length<=256&&new Set(a).size===a.length&&a.every(s=>text(s,64)&&/^[a-zA-Z0-9#_-]+$/u.test(s))))throw Error('形象清单无效');return v;}
 catch{return JSON.parse(fs.readFileSync(new URL('./avatar-defaults.json',import.meta.url),'utf8'));}
}
function validAvatar(v,kinds,upload=false){
 if(v?.kind==='role')return keys(v,['kind','role'],['kind','role'])&&text(v.role,64)&&(!kinds||kinds.roles.includes(v.role));
 if(v?.kind==='shape')return keys(v,['kind','shape','color'],['kind','shape','color'])&&text(v.shape,64)&&text(v.color,64)&&(!kinds||kinds.shapes.includes(v.shape)&&kinds.colors.includes(v.color));
 return upload&&v?.kind==='upload'&&keys(v,['kind','file','v'],['kind','file','v'])&&/^[a-z][a-z0-9-]{1,23}\.(png|jpg|webp|gif)$/u.test(v.file??'')&&Number.isSafeInteger(v.v)&&v.v>0;
}
export function resolveBot(rows,input){return rows.find(b=>b.id===input)??rows.find(b=>b.name===input);}
export function resolveIdentity(install,rows,configured,session,cwd){
 const preset=session?.header?.agentPreset;
 if(configured==='*'){
  const root=fs.realpathSync.native(path.join(install.hubHome,'bots')),real=fs.realpathSync.native(cwd),id=path.basename(real),bot=rows.find(b=>b.id===id);
  if(root!==path.join(fs.realpathSync.native(install.hubHome),'bots')||real!==path.join(root,id)||!bot||bot.preset!=='hub-bot'||bot.role!=='bot'||preset!=='hub-bot')throw Error('通用预设身份与工作目录不一致');
  return bot;
 }
 const bot=rows.find(b=>b.id===configured);if(!bot||bot.preset!==preset||preset==='hub-bot')throw Error('助理身份与预设不一致');return bot;
}
export function authorizeChange(rows,actor,tool,target){
 const source=rows.find(b=>b.id===actor);if(!source||source.status!=='active')throw Error('这个助理已停用');
 if(tool!=='bot_update'&&source.role!=='chief')throw Error('只有首席能新建或停用助理');
 if(tool==='bot_update'&&target!==actor&&source.role!=='chief')throw Error('改别的助理要找首席');
}
export function proposeChange(install,rows,actor,tool,args){
 if(!MANAGEMENT_TOOLS.includes(tool)||!object(args))throw Error('助理管理参数无效');
 const fields=tool==='bot_create'?['name','duty','notDuty','avatar','phrases']:tool==='bot_update'?['target','name','avatar','nameColor','duty','phrases']:['target','status'];
 if(!keys(args,fields,tool==='bot_create'?fields:tool==='bot_set_status'?fields:[]))throw Error('助理管理含未声明或缺少参数');
 const target=tool==='bot_create'?'new':resolveBot(rows,args.target??actor)?.id;
 if(!target)throw Error('没有这个助理');authorizeChange(rows,actor,tool,target);
 const current=rows.find(b=>b.id===target),kinds=readAvatarKinds(install);
 let after=Object.fromEntries(Object.entries(args).filter(([k])=>k!=='target'));
 if(tool==='bot_set_status'){
  if(!['active','disabled'].includes(args.status))throw Error('状态只能为启用或停用');
  if(args.status==='disabled'&&target===actor)throw Error('不能停用自己');
  if(args.status==='disabled'&&rows.filter(b=>b.status==='active').length<=1)throw Error('至少留一个启用助理');
 }else{
  if(Object.hasOwn(after,'name')){if(!nameOK(after.name))throw Error('名字须1至8字，不含路径字符、控制字符或首尾空白');if(rows.some(b=>b.id!==target&&folded(b.name)===folded(after.name)))throw Error('名字重名了（停用的也算）');}
  if(Object.hasOwn(after,'duty')&&!identityText(after.duty,60))throw Error('职责须1至60字，不能含控制字符或身份标记');
  if(Object.hasOwn(after,'notDuty')&&!identityText(after.notDuty,120,true))throw Error('不管什么最多120字，不能含控制字符或身份标记');
  if(Object.hasOwn(after,'phrases')&&(!Array.isArray(after.phrases)||after.phrases.length!==3||after.phrases.some(s=>!text(s,20))))throw Error('开场短语须正好3条，每条1至20字');
  if(Object.hasOwn(after,'avatar')&&!validAvatar(after.avatar,kinds))throw Error('形象只能选清单里的角色或图形，上传请 主人 到资料页');
  if(Object.hasOwn(after,'nameColor')&&!kinds.colors.includes(after.nameColor))throw Error('名牌色不在取值清单');
  if(tool==='bot_create')after={...after,nameColor:after.avatar.kind==='shape'?after.avatar.color:kinds.colors[0]};
 }
 if(tool==='bot_create'||tool==='bot_set_status'&&args.status==='active')if(rows.filter(b=>b.status==='active').length>=12&&current?.status!=='active')throw Error('启用中的助理最多12个');
 if(current)after=Object.fromEntries(Object.entries(after).filter(([k,v])=>!equal(v,current[k])));
 if(!Object.keys(after).length)throw Error('没有要改的');
 const before=current?Object.fromEntries(Object.keys(after).map(k=>[k,current[k]])):null;
 const action=tool==='bot_create'?'新建助理':tool==='bot_update'?'改助理':args.status==='active'?'恢复助理':'停用助理';
 const why=tool==='bot_create'?'希望增加一位助理负责：'+after.duty:after.duty?'希望调整职责为：'+after.duty:'希望'+action+'，调整'+Object.keys(after).join('、');
 return {tool,target,before,after,action,why,preview:action+'：'+(after.name??current?.name??''),path:path.join(install.hubHome,'config/bots.yaml'),beforeIds:rows.map(b=>b.id)};
}
export function verifyChange(rows,p){
 const b=p.target==='new'?rows.find(b=>!p.beforeIds.includes(b.id)&&b.role==='bot'&&b.preset==='hub-bot'&&b.status==='active'&&b.name===p.after.name):rows.find(b=>b.id===p.target);
 return !!b&&Object.entries(p.after).every(([k,v])=>equal(b[k],v));
}
