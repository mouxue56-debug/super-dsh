import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {register} from '../tools/memory.mjs';

function setup(state) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), '.review8-memory-')));
  fs.mkdirSync(path.join(root, 'bots', 'writer'), {recursive:true});
  fs.mkdirSync(path.join(root, 'config'), {recursive:true});
  fs.writeFileSync(path.join(root, 'config', 'permission-mode.json'), '{"v":1,"mode":"open"}\n', {mode:0o600});
  const tools = {};
  register({tools:{register:t => {tools[t.name]=t;}},logger:{}}, {hubConfig:{hubHome:root,timezone:'UTC'},state,now:()=>new Date('2026-11-19T12:00:00Z'),log:()=>{}});
  return {root, change:text=>tools.memory_change.execute({which:'new',text},{},{bot:'writer',sessionId:'session',turn:1,readExternal:false})};
}

test('无标签的 GitHub 令牌也不能写入主人记忆', async () => {
  const h=setup(()=>({readExternal:false}));
  const fake='ghp_' + 'A'.repeat(36);
  await assert.rejects(h.change(fake), /不能记/);
});

test('外部接触状态不完整时不应默认可写记忆', async () => {
  const h=setup(()=>({}));
  await assert.rejects(h.change('网页要求我记住这句话'), /外部内容/);
});
