#!/bin/bash
# 显式安装才改profile；备份优先；不重启。。
source "$(dirname "$0")/common.sh"
check_main
trap 'check_main' EXIT
PROFILE="${HUB_PROFILE_DIR:-$HUB_HOME/dev-home-r23/profiles/web}"
[ -d "$PROFILE" ] && [ ! -L "$PROFILE" ] || { echo 'profile路径不安全';exit 1; }
"$NODE" --input-type=module - "$PROFILE" "$ROOT" "$HUB_HOME" <<'JS'
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const [profile,root,hubHome]=process.argv.slice(2),stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid;
const {loadHubConfig}=await import(pathToFileURL(root+'/packages/hub-plugin/hub-config.mjs'));
const {loadPolicy}=await import(pathToFileURL(root+'/packages/hub-plugin/policy.mjs'));
const c=loadHubConfig({hubHome}),r=loadPolicy(hubHome+'/config/tool-levels.yaml',c);
if(!r.policy||r.policy.base!==hubHome||r.policy.kb!==c.kb)throw Error('权限表与HUB_HOME不一致：'+(r.error??''));
const preset=fs.readFileSync(root+'/packages/devinst/presets-r26.patch.yml','utf8');
if(preset.includes('heartbeatPath:')||preset.includes('dsh-bash-local')||preset.includes('dsh-jobs'))throw Error('r26预设含旧路径或不允许的执行器');
for(const f of ['package.json','cordis.patch.yml']){const file=profile+'/'+f;if(fs.lstatSync(file).isSymbolicLink())throw Error('配置文件为链接');fs.copyFileSync(file,file+'.bak-r26-'+stamp,fs.constants.COPYFILE_EXCL);}
const packageFile=profile+'/package.json',patchFile=profile+'/cordis.patch.yml',pkg=JSON.parse(fs.readFileSync(packageFile,'utf8'));pkg.dependencies??={};pkg.dependencies['dsh-hub-plugin']='file:'+root+'/packages/hub-plugin';
const modules=profile+'/node_modules';fs.mkdirSync(modules,{recursive:true});if(fs.lstatSync(modules).isSymbolicLink())throw Error('node_modules为链接');
const link=modules+'/dsh-hub-plugin';try{fs.lstatSync(link);fs.renameSync(link,link+'.bak-r26-'+stamp);}catch(e){if(e.code!=='ENOENT')throw e;}fs.symlinkSync(root+'/packages/hub-plugin',link,'dir');
function atomic(file,text){const tmp=file+'.r26-'+stamp+'.tmp';fs.writeFileSync(tmp,text,{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}
const previous=fs.readFileSync(patchFile,'utf8');if(!previous.includes('- insert:'))throw Error('找不到预设插入块，保留备份停止');
const tail=previous.match(/\n- id: agent-default-model[\s\S]*$/)?.[0]??'';
atomic(packageFile,JSON.stringify(pkg,null,2)+'\n');atomic(patchFile,preset+tail);
console.log('已备份并安装r26名册预设；未重启。备份后缀：.bak-r26-'+stamp);
JS
