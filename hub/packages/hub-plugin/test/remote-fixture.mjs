// 隔离3490测试专用；只用已有Node内置模块及仓库已有WebSocket传输，不读取凭据文件。
import {randomUUID} from 'node:crypto';
import {NodeWebSocket} from '../../hub-bff/lib/websocket.mjs';
export async function remoteFixture(cookie,rpc,answer) {
 const socket=new NodeWebSocket(new URL('http://127.0.0.1:3490/api/remote.mux'),cookie,5000);
 socket.on('failure',()=>{});
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('close',()=>reject(Error('假应答者连接关闭')));});
 const streamId=randomUUID(),frames=[];
 let clientId,readyResolve;
 const ready=new Promise(r=>readyResolve=r);
 socket.on('message',raw=>{
  const envelope=JSON.parse(String(raw));if(envelope.streamId!==streamId||envelope.type!=='item')return;
  const frame=envelope.value;frames.push(frame);
  if(frame.type==='ready'){clientId=frame.clientId;readyResolve();return;}
  if(frame.type!=='waterfall')return;
  void (async()=>{
   const value=frame.event==='approval/request'?await answer(frame):undefined;
   await rpc('$events/result',{clientId,eventId:frame.eventId,outcome:value===undefined?{kind:'next'}:{kind:'result',value}});
  })().catch(()=>{});
 });
 socket.send(JSON.stringify({type:'open',streamId,endpoint:'$events',payload:{args:{}}}));
 const timer=setTimeout(()=>readyResolve(false),5000);
 const ok=await ready;clearTimeout(timer);if(ok===false){socket.close();throw Error('假应答者未收到ready');}
 return {frames,close:()=>socket.close()};
}
