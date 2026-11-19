import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=process.env.HUB_HOME??path.join(os.homedir(),'dsh-work');
const root=process.env.HUB_REPO??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const scratch=process.env.HUB_SCRATCH??path.join(base,'tmp/r26-B/runtime');
const tc=JSON.parse(fs.readFileSync(new URL('./r26-test-config.json',import.meta.url),'utf8'));
if(fs.existsSync(scratch)&&fs.lstatSync(scratch).isSymbolicLink())throw Error('scratch不能为链接');
fs.mkdirSync(scratch,{recursive:true,mode:0o700});
const src=path.join(base,'dev-home-r23/profiles'),dest=path.join(scratch,'profiles');
if(!fs.existsSync(dest))fs.cpSync(src,dest,{recursive:true,preserveTimestamps:true,filter:p=>!/(?:key|token|credential|secret)/i.test(path.basename(p))});
const profile=dest+'/'+tc.profile;
for(const d of [profile+'/node_modules',scratch+'/agents',scratch+'/tmp',scratch+'/run',scratch+'/hub/config'])fs.mkdirSync(d,{recursive:true,mode:0o700});
const pkgFile=profile+'/package.json',patchFile=profile+'/cordis.patch.yml',stamp=Date.now();
for(const f of [pkgFile,patchFile])if(fs.existsSync(f))fs.copyFileSync(f,f+'.bak-r26-'+stamp,fs.constants.COPYFILE_EXCL);
const pkg=JSON.parse(fs.readFileSync(pkgFile,'utf8'));pkg.dependencies['dsh-hub-plugin']='file:'+root+'/packages/hub-plugin';fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+'\n');
const link=profile+'/node_modules/dsh-hub-plugin',plugin=root+'/packages/hub-plugin';let linked=false;
try{const st=fs.lstatSync(link);if(st.isSymbolicLink()&&path.resolve(path.dirname(link),fs.readlinkSync(link))===plugin)linked=true;else fs.renameSync(link,link+'.bak-r26-'+stamp);}catch(e){if(e.code!=='ENOENT')throw e;}
if(!linked)fs.symlinkSync(plugin,link,'dir');
const baseline=process.env.R26_BASELINE==='1';
let text=fs.readFileSync(root+'/packages/devinst/presets-'+(baseline?'r24':'r26')+'.patch.yml','utf8');
text=text.replace(/^\s+heartbeatPath: .*$/gm,'');
if(process.env.R26_PROBE==='1')text=text.replace(/(^\s+bot: [^\n]+\n)/gm,'$1          - id: r26-probe\n            name: '+root+'/packages/hub-plugin/test/r26-probe.mjs\n');
if(process.env.R26_EXTRA_TOOL==='1')text=text.replace(/(^\s+bot: [^\n]+\n)/m,'$1          - id: r26-extra\n            name: '+root+'/packages/hub-plugin/test/r26-extra.mjs\n');
text+='\n- insert:\n    - id: preset-test-control\n      name: "@deepseek-ai/dsh-agent-preset"\n      config:\n        id: '+tc.controlPreset+'\n        name: 隔离无命令对照预设\n        plugins:\n          - id: r26-probe\n            name: '+root+'/packages/hub-plugin/test/r26-probe.mjs\n';
fs.writeFileSync(patchFile,text);
if(!baseline){
 const {hubConfigText,loadHubConfig}=await import('../hub-config.mjs');
 const {policyText}=await import('../policy.mjs');
 const c=loadHubConfig({hubHome:scratch+'/hub',home:os.homedir(),read:false});c.kb=scratch+'/hub/kb';
 fs.writeFileSync(scratch+'/hub/config/hub.yaml',hubConfigText(c));
 for(const id of c.bots)fs.mkdirSync(c.hubHome+'/bots/'+id,{recursive:true,mode:0o700});
 for(const d of ['shared','tickets', 'kb'])fs.mkdirSync(c.hubHome+'/'+d,{recursive:true,mode:0o700});
 fs.writeFileSync(scratch+'/hub/config/tool-levels.yaml',policyText(c.hubHome,c.hubHome+'/kb',{bots:c.bots}));
}
const fake=`- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: hub-fake-test
    model: echo-1
- id: llm-pi-ai
  config:
    providers:
      hub-fake-test:
        displayName: 隔离假模型
        apiKeyEnv: HUB_FAKE_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:${tc.fakePort}/v1
        defaultContextWindow: 32000
        defaultMaxTokens: 1024
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
          - id: echo-1
            name: 隔离假模型
            input: [text]
`;
fs.writeFileSync(scratch+'/fake.patch.yml',fake,{mode:0o600});
