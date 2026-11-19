import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {toolText}=require('../hub-real.js');

// 热修：工具步骤不出现「使用工具 原名」。
test('r27 已知工具说中文，认不出的说「在处理」',()=>{
 assert.equal(toolText({name:'bot_list',status:'ok'}),'看了助理名册 · 已完成');
 assert.equal(toolText({name:'bot_update',status:'pending'}),'修改助理资料 · 等你点头');
 assert.equal(toolText({name:'send_to_bot',status:'running'}),'转给别的助理 · 处理中');
 assert.equal(toolText({name:'whatever_new',status:'running'}),'在处理 · 处理中');
 for(const name of ['bot_list','bot_create','board_list','group_say','skill','mystery_tool']){
  assert.doesNotMatch(toolText({name,status:'ok'}),/使用工具|[a-z]_[a-z]/);
 }
});
