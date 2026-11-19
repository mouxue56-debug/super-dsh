import {test} from 'node:test'; import assert from 'node:assert/strict'; import {buildPresence} from '../lib/ext/presence.mjs';
test('状态句不暴露工单里的路径或令牌片段',()=>{for(const title of ['/Users/example/private','sk-secret123456789']){const result=buildPresence({tickets:[{claimedBy:'chief',state:'progress',title}],allowed:new Set(['chief'])});assert.equal(result.bots.chief.line,'在干活')}});
test('套话清洗后普通标题仍保留',()=>{const result=buildPresence({tickets:[{claimedBy:'chief',state:'progress',title:'【任务】原话转达：整理资料'}],allowed:new Set(['chief'])});assert.equal(result.bots.chief.line,'在整理资料')});
