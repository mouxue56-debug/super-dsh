import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { submit, submitAll, approveCard, validateDraft, stripOwnerTags, scanDraft } from '../lib/kb-contribute.mjs';

// 创建用于验证投递行为的隔离夹具。
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const agent = path.join(dir, 'agent');
  fs.writeFileSync(
    agent,
    `#!/usr/bin/env node\nconst fs=require('node:fs'),` +
    `path=require('node:path');const dir=__dirname,` +
    `args=process.argv.slice(2),cmd=args[2],mode=fs.readFileSync(path.join(dir,'mode'),'utf8');` +
    `fs.appendFileSync(path.join(dir,'called.log'),cmd+'\\n');` +
    `if(cmd==='record'){fs.writeFileSync(path.join(dir,'argv.log'),` +
    `args.map(x=>JSON.stringify(x)).join('\\n'));` +
    `fs.copyFileSync(args[args.indexOf('--body-file')+1],path.join(dir,'body.log'));` +
    `if(mode==='sleep')setTimeout(()=>{},2000);else if(mode==='record-exit')process.exit(2);` +
    `else console.log(JSON.stringify({state:mode==='rejected'?'rejected':mode==='already'?'already_d` +
    `elivered':'queued',id:'key-123'}));}else {if(mode==='flush-exit')process.exit(3);` +
    `else if(mode==='garbage')console.log('???');` +
    `else console.log(JSON.stringify({event:mode==='other'?'other':'key-123',` +
    `state:mode==='local'?'local_commit_pending':mode==='uptodate'?'up_to_date':'pushed',` +
    `commit:mode==='missing'?undefined:mode==='bad'?'xyz':'a'.repeat(40),` +
    `reason:mode==='reason'||mode==='local'?'retry':''}));}\n`,
  );
  fs.chmodSync(agent, 0o755);
  const cfg = {
    kbAgentPath: agent, contributor: 'a1', workDir: dir, timeoutMs: 3000, approval: 'auto',
    pendingDir: path.join(dir, 'pending'),
  };
  const draft = {
    schemaVersion: 1, id: 'item-123', project: 'alpha', kind: 'work', summary: 'brief',
    body: 'private body', source: 'source', evidence: ['proof'], next: 'next',
    assistantId: 'a1', assistantName: '助理甲', date: '2026-01-01', labels: [],
  };
  return { dir, cfg, draft, mode: m => fs.writeFileSync(path.join(dir, 'mode'), m) };
}

for (const mode of ['success', 'uptodate']) {
  test('delivery ' + mode, async (t) => {
    const f = fixture(t);
    f.mode(mode);
    let activity = [];
    const r = await submit(f.draft, { ...f.cfg, activity: x => activity.push(x) });
    assert.equal(r.state, 'delivered');
    assert.equal(r.receipt, mode === 'success' ? 'pushed' : 'up_to_date');
    assert.equal(activity.length, 1);
    assert.ok(!activity[0].text.includes(f.draft.body));
  });
}

for (const mode of [
  'local', 'flush-exit', 'other', 'garbage', 'missing', 'bad', 'reason', 'rejected', 'record-exit', 'sleep',
]) {
  test('pending ' + mode, async (t) => {
    const f = fixture(t);
    f.mode(mode);
    const r = await submit(f.draft, { ...f.cfg, timeoutMs: mode === 'sleep' ? 300 : 3000 });
    assert.equal(r.state, 'pending');
    assert.deepEqual(r.draft, f.draft);
    assert.ok(fs.existsSync(path.join(f.cfg.pendingDir, f.draft.id + '.json')));
    assert.equal(fs.statSync(path.join(f.cfg.pendingDir, f.draft.id + '.json')).mode & 0o777, 0o600);
  });
}

test('already delivered', async (t) => {
  const f = fixture(t);
  f.mode('already');
  assert.deepEqual(await submit(f.draft, f.cfg), { state: 'delivered', receipt: 'already_delivered', id: 'key-123' });
});

test('arguments and body preserved', async (t) => {
  const f = fixture(t);
  f.mode('success');
  const special = `" ' ; \` $(touch PWNED) &&`;
  Object.assign(f.draft, {
    project: special, summary: special, evidence: [special], next: special, body: special + '\nsecond',
  });
  assert.equal((await submit(f.draft, f.cfg)).state, 'delivered');
  const args = fs.readFileSync(path.join(f.dir, 'argv.log'), 'utf8').split('\n').map(JSON.parse);
  const bodyFile = args[args.indexOf('--body-file') + 1];
  assert.deepEqual(args, [
    '--contributor', 'a1', 'record', '--project', special, '--kind', 'work', '--summary', special,
    '--body-file', bodyFile, '--id', 'item-123', '--source', 'source', '--evidence', special, '--next', special,
  ]);
  assert.equal(fs.readFileSync(path.join(f.dir, 'body.log'), 'utf8'), f.draft.body);
  assert.ok(!fs.existsSync(path.join(f.dir, 'PWNED')));
  assert.ok(!fs.existsSync(bodyFile));
});
for (const [field, value] of [['kind', 'bad'],
  ['summary', '-bad'],
  ['summary', 'a\nb'],
  ['labels', ['Owner要求']],
  ['labels', ['Owner确认']],
  ['evidence', Array(6).fill('x')],
  ['body', 'x'.repeat(131073)],
  ['body', 'a\0b'],
  ['id', 'x'],
  ['project', '-bad'],
  ['source', '-bad'],
  ['next', '-bad'],
  ['evidence', ['-bad']]]) {
  test('validation ' + field + ' ' + String(value).slice(0, 8), t => {
    const f = fixture(t);
    assert.equal(validateDraft({ ...f.draft, [field]: value }).ok, false);
  });
}

test('card approval and default', async (t) => {
  const f = fixture(t);
  f.mode('success');
  const r = await submit(f.draft, { ...f.cfg, approval: 'card' });
  assert.equal(r.state, 'card');
  assert.equal(r.card.draftId, f.draft.id);
  assert.ok(fs.existsSync(path.join(f.cfg.pendingDir, f.draft.id + '.json')));
  assert.ok(!fs.existsSync(path.join(f.dir, 'called.log')));
  assert.equal((await approveCard(f.draft, { ...f.cfg, approval: 'card' })).state, 'delivered');
  assert.equal((await submit(f.draft, f.cfg)).state, 'delivered');
});

test('默认值是 card：不写 approval 就只出确认卡，不调用子进程', async (t) => {
  const f = fixture(t);
  f.mode('success');
  const { approval, ...noApproval } = f.cfg;
  const r = await submit(f.draft, noApproval);
  assert.equal(r.state, 'card');
  assert.equal(r.card.alwaysAllow.label, '以后这类不用问');
  assert.equal(r.card.alwaysAllow.key, 'alpha/work');
  assert.ok(!fs.existsSync(path.join(f.dir, 'called.log')));
});

test('点「以后这类不用问」才放权：记谁哪天，之后同类直接投，别类仍出卡', async (t) => {
  const f = fixture(t);
  f.mode('success');
  const grantsFile = path.join(f.dir, 'grants', 'grants.json');
  const lines = [];
  const cfg = { ...f.cfg, approval: 'card', grantsFile, activity: e => lines.push(e.text) };
  assert.equal((await submit(f.draft, cfg)).state, 'card');
  assert.ok(!fs.existsSync(grantsFile));
  const delivered = await approveCard(f.draft, cfg, undefined, { always: true, by: '主人', date: '2026-11-17' });
  assert.equal(delivered.state, 'delivered');
  const saved = JSON.parse(fs.readFileSync(grantsFile, 'utf8'));
  assert.deepEqual(saved.grants, [{ key: 'alpha/work', by: '主人', on: '2026-11-17' }]);
  assert.equal(fs.statSync(grantsFile).mode & 0o777, 0o600);
  assert.ok(lines.some(x => x.includes('放权') && x.includes('alpha/work') && x.includes('2026-11-17')));
  assert.equal((await submit({ ...f.draft, id: 'item-124' }, cfg)).state, 'delivered');
  assert.equal((await submit({ ...f.draft, id: 'item-125', kind: 'decision' }, cfg)).state, 'card');
  assert.equal((await submit({ ...f.draft, id: 'item-126', project: 'beta' }, cfg)).state, 'card');
});

test('只点头不勾「以后不用问」不放权；放权缺谁或日期、缺 grantsFile 都拒绝', async (t) => {
  const f = fixture(t);
  f.mode('success');
  const grantsFile = path.join(f.dir, 'grants.json');
  const cfg = { ...f.cfg, approval: 'card', grantsFile };
  assert.equal((await approveCard(f.draft, cfg)).state, 'delivered');
  assert.ok(!fs.existsSync(grantsFile));
  assert.equal((await submit({ ...f.draft, id: 'item-127' }, cfg)).state, 'card');
  await assert.rejects(async () => approveCard(f.draft, cfg, undefined, { always: true, date: '2026-11-17' }));
  await assert.rejects(async () => approveCard(f.draft, cfg, undefined, { always: true, by: 'x', date: 'bad' }));
  await assert.rejects(async () => approveCard(f.draft, { ...f.cfg, approval: 'card' }, undefined, {
    always: true, by: 'x', date: '2026-11-17',
  }));
});

test('放权文件损坏当作没放权，仍出卡', async (t) => {
  const f = fixture(t);
  f.mode('success');
  const grantsFile = path.join(f.dir, 'grants.json');
  fs.writeFileSync(grantsFile, 'not json');
  assert.equal((await submit(f.draft, { ...f.cfg, approval: 'card', grantsFile })).state, 'card');
});

test('configuration errors and batch isolation', async (t) => {
  const f = fixture(t);
  f.mode('success');
  for (const cfg of [
    { kbAgentPath: 'relative' }, { kbAgentPath: path.join(f.dir, 'absent') },
    { kbAgentPath: path.join(f.dir, 'mode') }, { contributor: 'BAD' },
  ]) {
    await assert.rejects(submit(f.draft, { ...f.cfg, ...cfg }), e => e.state === 'config-error');
  }
  const results = await submitAll([f.draft, { ...f.draft, id: 'x' }], f.cfg);
  assert.deepEqual(results.map(x => x.state), ['delivered', 'invalid']);
});

test('source hygiene', () => {
  const source = fs.readFileSync(new URL('../lib/kb-contribute.mjs', import.meta.url), 'utf8');
  for (const bad of ['exec(', 'execSync', 'spawnSync', 'shell: true', 'shell:true', '/Users/', 'knowledge-base']) {
    assert.ok(!source.includes(bad));
  }
});

// 主人标签的各种写法都要剥掉，剥完再扫不能剩下。
test('剥标签与扫描覆盖全角半角大小写空格变体', () => {
  for (const v of ['【Owner要求】', '[ＯＷＮＥＲ确认]', '【o w n e r 要 求】', 'OWNER 要求', 'Owner：确认', '(owner\u200b要求)']) {
    const out = stripOwnerTags('前' + v + '后');
    assert.equal(out, '前后', v);
    assert.equal(scanDraft({ body: '前' + v + '后' }).ok, false, v);
  }
  assert.equal(scanDraft({ body: '标签：【AI归纳】【Owner未确认】' }).ok, true);
});

// 直投入口自己过滤：带标签字样、证件号、聊天原文的草稿不会进 kb-agent。
test('直投入口拦标签、证件号与聊天原文', async (t) => {
  const f = fixture(t);
  f.mode('success');
  const chat = Array.from({ length: 25 }, (_, i) => `客户：第${i}句`).join('\n');
  for (const body of ['x 【Owner要求】', '证件 110101199003078888', chat]) {
    const r = await submit({ ...f.draft, body }, f.cfg);
    assert.equal(r.state, 'blocked');
  }
  assert.equal(fs.existsSync(path.join(f.dir, 'called.log')), false);
});

// 确认卡出示后草稿被调包，批准时拒绝且不放权、不投。
test('确认卡批准核对校验和', async (t) => {
  const f = fixture(t);
  f.mode('success');
  const cfg = { ...f.cfg, approval: 'card', grantsFile: path.join(f.dir, 'grants.json') };
  assert.equal((await submit(f.draft, cfg)).state, 'card');
  const swapped = { ...f.draft, body: 'swapped' };
  const r = await approveCard(swapped, cfg, undefined, { always: true, by: 'x', date: '2026-11-17' });
  assert.deepEqual(r, { state: 'invalid', reason: 'card-mismatch' });
  assert.equal(fs.existsSync(path.join(f.dir, 'grants.json')), false);
  assert.equal(fs.existsSync(path.join(f.dir, 'called.log')), false);
  assert.equal((await approveCard(f.draft, cfg)).state, 'delivered');
});
