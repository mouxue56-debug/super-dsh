import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {agents} from '../lib/roster.mjs';
export const TEST_BOT_IDS=['chief','support','content','pm','art','research'];
export const TEST_KINDS={roles:[...TEST_BOT_IDS,'extra'],shapes:['circle','square'],colors:['yellow','blue','green','pink']};
export async function seedRoster(home,{configDir=join(home,'config'),botsDir=join(home,'bots')}={}) {
 const template='通用规则：只在已授权范围工作。';await mkdir(configDir,{recursive:true});await mkdir(botsDir,{recursive:true});
 const ts='2026-11-17T00:00:00.000Z',value={version:1,bots:TEST_BOT_IDS.map((id,order)=>({id,name:['首席助理','客服助理','内容助理','项目经理','艺术总监','调研员'][order],role:order===0?'chief':'bot',preset:'hub-'+id,status:'active',avatar:{kind:'role',role:id},nameColor:'yellow',duty:'测试职责',notDuty:'',phrases:[],order,createdAt:ts,updatedAt:ts}))};
 for(const b of value.bots){const dir=join(botsDir,b.id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'AGENTS.md'),agents(b,template),{mode:0o600});}
 for(const [file,data] of [['bots.yaml',JSON.stringify(value)],['avatar-kinds.json',JSON.stringify(TEST_KINDS)],['bot-template.md',template]])await writeFile(join(configDir,file),data,{mode:0o600});
 return value;
}
