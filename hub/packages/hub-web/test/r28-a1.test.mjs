import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';

const require = createRequire(import.meta.url);
const {r28a1Profile, r28a1Patch, r28a1Confirm} = require('../hub-real.js');
const bot = {id:'chief',name:'首席',duty:'协调',notDuty:'付款',status:'active',nameColor:'yellow',
  phrases:['一','二','三'],avatar:{kind:'role',role:'cat'}};

test('名册映射覆盖资料并处理角色、形状、上传及降级', () => {
  const profile = r28a1Profile(bot,{catalog:[{kind:'pack',id:'cat'}]});
  assert.equal(profile.description,'管：协调。不管：付款');
  assert.equal(profile.enabled,true);
  assert.equal(profile.homeLabel,'协调');
  assert.deepEqual(profile.avatar,{kind:'pack',id:'cat'});
  assert.equal(r28a1Profile({...bot,status:'disabled'}).enabled,false);
  assert.equal(r28a1Profile(bot).avatar.kind,'shape');
  assert.equal(r28a1Profile({...bot,avatar:{kind:'shape',shape:'star',color:'blue'}}).avatar.shapeId,'soft-2');
  const upload = {...bot,avatar:{kind:'upload',file:'a.png'}};
  assert.equal(r28a1Profile(upload).avatar.kind,'shape');
  assert.equal(r28a1Profile(upload,{uploads:new Map([['a.png','data:image/png;base64,AA==']])}).avatar.kind,'upload');
  assert.deepEqual(bot.avatar,{kind:'role',role:'cat'});
});

test('只翻译变化并拒绝形象颜色，职责须写不管', () => {
  const before = r28a1Profile(bot);
  assert.deepEqual(r28a1Patch({before,after:{...before,name:'小白'}}),{name:'小白'});
  assert.deepEqual(r28a1Patch({before,after:{...before,enabled:false}}),{status:'disabled'});
  assert.deepEqual(r28a1Patch({before,after:{...before,quickReplies:['甲']}}),{phrases:['甲']});
  assert.deepEqual(r28a1Patch({before,after:{...before,description:'管：接待。不管:付款'}}),
    {duty:'接待',notDuty:'付款'});
  assert.throws(() => r28a1Patch({before,after:{...before,description:'只负责接待'}}),/请按/);
  assert.throws(() => r28a1Patch({before,after:{...before,color:'#000000'}}),/助理资料/);
});

function scenario(fail = false) {
  const before = r28a1Profile(bot);
  const draft = {id:'d',status:'pending',changes:[{id:bot.id,before,after:{...before,name:'小白'}}]};
  const roster = new Map([[bot.id,{...bot}]]);
  const calls = [];
  const toast = [];
  const context = {roster,S:{drawer:'sheet'},limits:()=>({nameMax:8}),validateName:()=>'',
    H:{toast:value=>toast.push(value)},
    api:async (path,options)=>{
      calls.push([path,JSON.parse(options.body)]);
      if (fail) throw Object.assign(Error('rejected'),{status:400});
    },
    loadRoster:async ()=>{roster.set(bot.id,{...bot,name:'小白'});}};
  return {draft,context,calls,toast};
}

test('确认依次 PATCH、读回后才确认，且没有撤销', async () => {
  global.window = {render(){}};
  const s = scenario();
  await r28a1Confirm(s.draft,s.context);
  assert.deepEqual(s.calls,[['/bots/chief',{name:'小白'}]]);
  assert.equal(s.draft.status,'confirmed');
  assert.equal(s.draft.undoUntil,0);
  assert.equal(s.context.S.drawer,null);
  assert.equal(s.toast[0],'已改 · 小白');
});

test('后端失败保留 pending 与原资料', async () => {
  global.window = {render(){}};
  const s = scenario(true);
  await r28a1Confirm(s.draft,s.context);
  assert.equal(s.draft.status,'pending');
  assert.equal(s.context.roster.get(bot.id).name,'首席');
  assert.match(s.toast[0],/^没改成：/);
});

test('创建和多助理草稿拒绝且不调用后端', async () => {
  global.window = {render(){}};
  for (const type of ['create','swap']) {
    const s = scenario();
    if (type === 'create') s.draft.create = true;
    else s.draft.changes.push(s.draft.changes[0]);
    await r28a1Confirm(s.draft,s.context);
    assert.equal(s.draft.status,'cancelled');
    assert.equal(s.calls.length,0);
  }
});

test('真实会话已有防止壳本机回复写入的保护', () => {
  const source = readFileSync(new URL('../hub-real.js',import.meta.url),'utf8');
  assert.match(source,/mode === 'real' && records\.has\(conversation\) && !message\.hubReal/);
  assert.match(source,/data-assistant-confirm.*data-avatar-library.*data-profile-color/);
});
