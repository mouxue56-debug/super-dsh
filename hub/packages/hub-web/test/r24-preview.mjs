// C 路离线预览：仅假 BFF + 3592，不连接真实 BFF/内核。
import { mkdir, writeFile } from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHubWeb } from '../server.mjs';
import { startMockBff } from './mock-bff.mjs';
const dir=join(process.env.HUB_TEST_TMP || join(process.env.HUB_HOME || join(homedir(),'dsh-work'),'tmp/r26-C'),'preview')+'/';await mkdir(dir,{recursive:true});
await writeFile(dir+'web.fixture','r24-offline-web',{mode:0o600});
await writeFile(dir+'bff.fixture','r24-offline-bff',{mode:0o600});
const shell=process.env.HUB_R24_SHELL||'shell-r23';
if(!['shell-r23','shell-r23.prev-20261117-201152-4145'].includes(shell))throw Error('只允许本轮两版壳');
let shellDir=fileURLToPath(new URL('../'+shell+'/',import.meta.url));
if(process.env.HUB_R24_SHELL_DIR){
  if(!process.env.HUB_TEST_TMP)throw Error('自选壳需要隔离测试根');
  shellDir=await realpath(resolve(process.env.HUB_R24_SHELL_DIR));
  const root=await realpath(process.env.HUB_TEST_TMP),part=relative(root,shellDir);
  if(!part || part.startsWith('..') || isAbsolute(part))throw Error('自选壳必须在隔离测试根内');
}
const fake=await startMockBff({port:3591});
const web=await createHubWeb({HUB_WEB_HOSTS:'127.0.0.1',HUB_WEB_PORT:'3592',HUB_WEB_SHELL_DIR:shellDir,HUB_WEB_KEY_FILE:dir+'web.fixture',BFF_KEY_FILE:dir+'bff.fixture',BFF_URL:fake.url});
console.log('C 路离线预览已监听 3592，假 BFF 3591；壳 '+shellDir+'；PID '+process.pid+'；无模型调用');
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await web.close();await fake.close();process.exit(0);});
