import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {approvalResult,approvalWhy,surfaceEntries,toolText}=require('../hub-real.js');
test('F1 审批结果：四个原因各用对应人话，无原因旧卡沿用旧文案',()=>{
 const expected={'no-device':'没有登录中的设备，这一步没做','dsh-disconnected':'服务断开了，没等到你点头，这一步没做','bff-restart':'服务断开了，没等到你点头，这一步没做','bad-request':'这张卡信息不全，已按拒绝处理'};
 for(const [reason,text] of Object.entries(expected))assert.equal(approvalResult({status:'unavailable',reason}),text);
 assert.equal(approvalResult({status:'unavailable'}),expected['no-device']);
 assert.equal(approvalResult({status:'approved',reason:'dsh-disconnected'}),'已批准');
 assert.equal(approvalResult({status:'timeout'}),'没等到你点头，这一步没做');
});
test('F1 理由展示：完整短句不动，超长保留80字及省略号，Unicode不切半个字符',()=>{
 assert.equal(approvalWhy('  完整的理由。 '),'完整的理由。');
 assert.equal(approvalWhy('猫'.repeat(80)+'…'),'猫'.repeat(80)+'…');
 assert.equal(approvalWhy('😀'.repeat(81)),'😀'.repeat(80)+'…');
 assert.equal(approvalWhy('  '),'');
});
test('F1 改一下：只缩短固定前缀的用户展示副本，模型原文和助理回复不改',()=>{
 const prefix='（改一下）主人 看了审批卡，要你按这条意见改完重做（重做照常走审批，这不算绕过）：';
 const messages=[{role:'user',text:prefix+'内容加上日期\n另起一行'},{role:'assistant',text:prefix+'助理引用'},{role:'user',text:'普通消息：'+prefix+'保持原样'},{role:'user',text:'（改一下）普通修改意见'}];
 const before=JSON.stringify(messages),display=surfaceEntries(messages);
 assert.equal(display[0].text,'改一下：内容加上日期\n另起一行');
 for(let i=1;i<messages.length;i++)assert.equal(display[i].text,messages[i].text);
 assert.equal(JSON.stringify(messages),before);
});
test('F1 工具条：中文失败短句仍显示真实失败，不把不可审批当成功',()=>{
 for(const brief of ['主人 没批准','审批取消了','审批通道不在线','这一步没做成']){
  const text=toolText({name:'write',path:'shared/f1.md',status:'unavailable',brief});
  assert.match(text,new RegExp(brief));assert.doesNotMatch(text,/已完成|requires approval|unavailable/);
 }
});
