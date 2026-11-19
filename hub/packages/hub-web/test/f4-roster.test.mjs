import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {approvalTitle}=createRequire(import.meta.url)('../hub-real.js');
test('F4 自改标题沿用 before 名字，批准后不改称新名',()=>{
 const card={tool:'bot_update',bot:'actor',target:'actor',botName:'调研员',before:{name:'调研员'},after:{name:'资料员'}};
 for(const status of ['pending','approved','revised','failed'])assert.equal(approvalTitle({...card,status,botName:'资料员',targetName:'资料员'}),'调研员想改自己的资料');
});
test('F4 跨助理目标取 before，发起者取卡片身份快照',()=>{
 const card={tool:'bot_update',bot:'actor',target:'target',botName:'首席助理',targetName:'改后的名字',before:{name:'原助理'},after:{name:'改后的名字'}};
 assert.equal(approvalTitle(card),'首席助理想改原助理的资料');
 for(const status of ['active','disabled'])assert.equal(approvalTitle({...card,tool:'bot_set_status',after:{status}}),'首席助理想'+(status==='active'?'恢复':'停用')+'原助理');
});
test('F4 无名字变更的自改仍使用发起者快照，未知目标不冒名',()=>{
 assert.equal(approvalTitle({tool:'bot_update',bot:'actor',target:'actor',botName:'调研员',before:{duty:'旧职责'},after:{duty:'新职责'}}),'调研员想改自己的资料');
 assert.equal(approvalTitle({tool:'bot_update',bot:'actor',target:'target',botName:'首席'}),'首席想改助理的资料');
});
