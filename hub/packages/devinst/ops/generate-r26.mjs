import fs from 'node:fs';
const source=new URL('../presets-r24.patch.yml',import.meta.url),target=new URL('../presets-r26.patch.yml',import.meta.url);
const rules=JSON.parse(fs.readFileSync(new URL('../presets-r26.replace.json',import.meta.url),'utf8'));
let text=fs.readFileSync(source,'utf8');
const count=[...text.matchAll(/^        id: hub-/gm)].length;
for(const old of [rules.old,rules.descriptionOld])if(text.split(old).length-1!==count)throw Error('人设替换数量异常');
text=text.replaceAll(rules.old,rules.new).replaceAll(rules.descriptionOld,rules.descriptionNew).replace(/^\s+heartbeatPath: .*$/gm,'');
const plugins=`          - id: hub-shell-env
            name: '@deepseek-ai/dsh-shell-env'
          - id: hub-bash-sandbox
            name: '@deepseek-ai/dsh-bash-sandbox'
            config:
              timeoutMs: ${rules.bash.timeoutMs}
              maxTimeoutMs: ${rules.bash.maxTimeoutMs}
              maxOutputBytes: ${rules.bash.maxOutputBytes}
          - id: hub-tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            config:
              enableRunInBackground: false
              promoteOnTimeout: false
`;
const group=`          - id: hub-command-scope
            name: cordis:group
            group: true
            isolate:
              shell: true
              shellEnv: true
            config:
`;
text=text.replace(/          - id: hub-permissions\n            name: dsh-hub-plugin\n            config:\n              bot: ([^\n]+)\n/g,(_all,bot)=>group+(plugins+`          - id: hub-permissions
            name: dsh-hub-plugin
            config:
              bot: ${bot}
`).split('\n').map(l=>l?'    '+l:l).join('\n'));

let suffix='';const topLevel=text.search(/\n(?=- id:)/);if(topLevel>=0){const comment=text.lastIndexOf('\n\n#',topLevel),cut=comment>=0?comment:topLevel;suffix=text.slice(cut);text=text.slice(0,cut)+'\n';}
const blocks=text.split(/(?=^    - id: preset-hub-)/m),header=blocks.shift();
const identity=block=>block.match(/^        id: (hub-[^\n]+)$/m)?.[1];
for(let i=0;i<blocks.length;i++){
 const prefix=rules.legacyIntro+rules.commonPrefix+(identity(blocks[i])==='hub-'+rules.chief?rules.chiefPrefix:'');
 blocks[i]=blocks[i].replace(/(              prefix: \|-\n)                [^\n]+/,(_all,start)=>start+'                '+prefix);
}
const template=blocks.find(block=>identity(block)!=='hub-'+rules.chief);if(!template)throw Error('找不到普通助理预设模板');
const generic=template.replace(/^    - id: preset-hub-[^\n]+/m,'    - id: preset-hub-bot').replace(/^        id: hub-[^\n]+/m,'        id: hub-bot').replace(/^        name: [^\n]+/m,'        name: 通用助理').replace(/^        order: [^\n]+/m,'        order: '+(100+count)).replace(/(                  bot: )[^\n]+/,'$1"*"').replace(/(              prefix: \|-\n)                [^\n]+/,(_all,start)=>start+'                '+rules.genericIntro+rules.commonPrefix);
text=header+blocks.join('')+generic+suffix;
text=text.replace(/^#.*\n/,'# 第26轮名册助理预设；由 r24 + 替换表生成。第26轮任务书，Fable 定，Owner 未确认。\n');
fs.writeFileSync(target,text);console.log('已生成 '+count+' 个旧预设与 hub-bot 通用预设；隔离 bash，无新增 jobs 或 bash-local。');
