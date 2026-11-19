import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function parseFlatYaml(text,label='配置') {
 const out=Object.create(null);
 for(const line of text.split(/\r?\n/)){
  if(!line.trim()||line.startsWith('#'))continue;
  const m=/^([a-z_]+): (.+)$/.exec(line);
  if(!m||Object.hasOwn(out,m[1]))throw Error(label+'格式错误或重复键');
  const v=JSON.parse(m[2]);if(JSON.stringify(v)!==m[2])throw Error(label+'值必须为无重复键的紧凑JSON');out[m[1]]=v;
 }
 return out;
}
const abs=p=>typeof p==='string'&&path.isAbsolute(p)&&!/[\0\r\n]/.test(p);
export function presetRoster(){
 const source=fs.readFileSync(new URL('../devinst/presets-r24.patch.yml',import.meta.url),'utf8');
 const rows=[...source.matchAll(/^        id: hub-([a-z][a-z0-9_-]*)\n        name: ([^\n]+)$/gm)];
 if(!rows.length||new Set(rows.map(r=>r[1])).size!==rows.length)throw Error('预设名册不可核实');
 return {bots:rows.map(r=>r[1]),names:Object.fromEntries(rows.map(r=>[r[1],r[2]]))};
}
// BFF 读的平面键（与路 1 一致）与各模块配置段（：board、ledger、groups、meetings、models、cua）。
export const PASS_KEYS=Object.freeze(['timezone','board_dir','ledger_dir','data_dir',
 'prices','max_hop','max_active_per_worker']);
export const PASS_SECTIONS=Object.freeze(['board','ledger','groups','meetings','models','cua','panic','routines',
 'today','rules','dispatch','voice','uploads']);
export function loadHubConfig({home=os.homedir(),hubHome=process.env.HUB_HOME??path.join(home,'dsh-work'),read=true}={}){
 if(!abs(hubHome))throw Error('HUB_HOME须为绝对路径');
 const roster=presetRoster(),seed=JSON.parse(fs.readFileSync(new URL('../devinst/presets-r26.replace.json',import.meta.url),'utf8'));
 let raw={};if(read)try{raw=parseFlatYaml(fs.readFileSync(path.join(hubHome,'config/hub.yaml'),'utf8'),'安装配置');if(raw.version!==1)throw Error('安装配置须声明version: 1');}catch(e){if(e.code!=='ENOENT')throw e;}
 const keys=['version','kb','heartbeat','grants','bots','names','chief','kb_allow',...PASS_KEYS,...PASS_SECTIONS];
 if(Object.keys(raw).some(k=>!keys.includes(k))||raw.version!==undefined&&raw.version!==1)throw Error('安装配置版本或键错误');
 // 各模块的配置段只放行、原样透传，细节由对应模块自己校验；段须为对象。
 if(PASS_SECTIONS.some(k=>Object.hasOwn(raw,k)&&(!raw[k]||typeof raw[k]!=='object'
  ||Array.isArray(raw[k])))
  )throw Error('安装配置的模块段须为对象');
 const extra=Object.fromEntries([...PASS_KEYS,...PASS_SECTIONS].filter(k=>Object.hasOwn(raw,k)).map(k=>[k,raw[k]]));
 const c={version:1,home,hubHome,
  kb:raw.kb??path.join(home,'knowledge-base'),heartbeat:raw.heartbeat??path.join(hubHome,'config/bff-heartbeat.json'),
  grants:raw.grants??path.join(hubHome,'config/command-grants.json'),
  bots:raw.bots??roster.bots,names:raw.names??roster.names,
  chief:raw.chief??seed.chief,kb_allow:raw.kb_allow??seed.kb_allow,...extra};
 if(![c.kb,c.heartbeat,c.grants].every(abs)||!Array.isArray(c.bots)||!c.bots.length||c.bots.some(b=>typeof b!=='string'||! /^[a-z][a-z0-9_-]*$/.test(b))||new Set(c.bots).size!==c.bots.length||!c.bots.includes(c.chief))throw Error('安装配置路径或名册错误');
 if(!c.names||typeof c.names!=='object'||Array.isArray(c.names)||Object.keys(c.names).some(b=>!c.bots.includes(b))||c.bots.some(b=>typeof c.names[b]!=='string'||!c.names[b].trim()||/[\0\r\n]/.test(c.names[b])))throw Error('安装配置名字表错误');
 if(!c.kb_allow||typeof c.kb_allow!=='object'||Array.isArray(c.kb_allow)||Object.entries(c.kb_allow).some(([b,roots])=>!c.bots.includes(b)||!Array.isArray(roots)||roots.some(r=>typeof r!=='string'||!r||path.isAbsolute(r)||r.split('/').includes('..'))))throw Error('知识库白名单错误');
 return c;
}
export function hubConfigText(c=loadHubConfig({read:false})){
 return '# 安装级配置；严格平面 YAML，单行紧凑 JSON。第26轮任务书，Fable 定，Owner 未确认。\n'+
  [...['version','kb','heartbeat','grants','bots','names','chief','kb_allow'],...[...PASS_KEYS,
  ...PASS_SECTIONS].filter(k=>c[k]!==undefined)].map(k=>k+': '+JSON.stringify(c[k])).join('\n')+'\n';
}
export const expandConfiguredPath=(p,{home,hubHome})=>p.startsWith('~/')?path.join(home,p.slice(2)):p.startsWith('$HOME/')?path.join(home,p.slice(6)):p.startsWith('$HUB_HOME/')?path.join(hubHome,p.slice(10)):p;
