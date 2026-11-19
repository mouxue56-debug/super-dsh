import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {r29CreateHooks}=require('../hub-real.js');

test('同一语音请求号不得跨会话返回另一段转写', async () => {
  let calls=0;
  const placed=[];
  const hooks=r29CreateHooks({request:async()=>({ok:true,status:200,json:async()=>({ok:true,text:'第'+(++calls)+'段'})}), placeVoice:(bot,text,meta)=>placed.push({bot,text,meta})});
  const audio=new Blob(['audio'],{type:'audio/wav'});
  const a=await hooks.HubVoiceSend(audio,{bot:'a',conversation:'conv-a',requestId:'same'});
  const b=await hooks.HubVoiceSend(audio,{bot:'b',conversation:'conv-b',requestId:'same'});
  assert.equal(a.text,'第1段');
  assert.equal(b.text,'第2段');
  assert.equal(placed.length,2);
});
