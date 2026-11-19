import fs from 'node:fs';import assert from 'node:assert/strict';
import {connect,scratch} from './r26-client.mjs';import {loadHubConfig} from '../hub-config.mjs';import {remoteFixture} from '../test/remote-fixture.mjs';
const c=await connect(),config=loadHubConfig({hubHome:scratch+'/hub'}),own=config.hubHome+'/bots/'+config.chief;
const beat=()=>fs.writeFileSync(config.heartbeat,JSON.stringify({v:1,ts:Date.now(),dshConnected:true,answering:true}),{mode:0o600});beat();const timer=setInterval(beat,2000);let f;
try{
 f=await remoteFixture(c.cookie,c.rpc,async frame=>{const p=JSON.parse(frame.request.reason.slice(13));assert.equal(p.command,'seq 1 300000');return 'allowed-once';});
 const id=await c.start('TOOL bash '+JSON.stringify({description:'隔离验证超过内核缓冲的全文',command:'seq 1 300000'}),'hub-'+config.chief,own),es=await c.done(id,45000);
 const r=es.find(e=>e.type==='tool/result').data.message,text=r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');assert.equal(r.isError,false);
 const relative=text.match(/全文在 (bots\/[^）]+)/)?.[1];assert.ok(relative);const file=config.hubHome+'/'+relative,full=fs.readFileSync(file,'utf8');assert.ok(full.startsWith('1\n2\n'));assert.match(full,/299999\n300000/);
 const summary={sessionId:id,bytes:Buffer.byteLength(full),path:relative,firstLine:full.split('\n')[0],last:full.slice(-130),dialogueBytes:Buffer.byteLength(text)};fs.writeFileSync(scratch+'/run/spill-r26.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(summary));
}finally{clearInterval(timer);f?.close();}
