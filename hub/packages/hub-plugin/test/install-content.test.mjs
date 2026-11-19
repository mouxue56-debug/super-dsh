import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {applyPlan, checkTarget, diffPlan, fillSlots, loadManifest, planInstall} from '../ops/install-content.mjs';
import {countText, listBots, measureBot, parseSkill, renderTable} from '../ops/measure-boot.mjs';
import {updateIdentity} from '../../hub-bff/lib/roster.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaults = path.resolve(here, '../../../defaults');
const ops = path.resolve(here, '../ops');
const cfg = {
  placeholders: {owner: '测试主人'},
  bots: {
    boss: {template: 'chief', name: '总管甲', values: {duty: '统筹', not_duty: '具体活', speech: '短句'}},
    doer: {
      template: 'worker',
      name: '干活乙',
      values: {duty: '写稿', not_duty: '派单', speech: '平实'},
      manuals: ['dispatch-work', 'use-board'],
    },
  },
};

// 建一个临时运行目录。
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-content-'));

test('占位符:有值才换,缺的列出来', () => {
  const r = fillSlots('a {{owner}} b {{x}}', {owner: 'O'});
  assert.equal(r.text, 'a O b {{x}}');
  assert.deepEqual(r.missing, ['x']);
});

test('defaults 里没有个人信息、手册格式对、简介不超 80 字', () => {
  // 业务词用转义写,免得测试文件自己带上它们。
  const parts = [
    '/Users/',
    '\\u798f\\u697d',
    '\\u732b\\u820d',
    'knowledge-base',
    'tailnet',
    '\\.ts\\.net',
    '\\b100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.',
  ];
  const personal = new RegExp(parts.join('|'), 'u');
  const manifest = loadManifest(defaults);
  const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory()
    ? walk(path.join(d, e.name))
    : [path.join(d, e.name)]);
  for (const f of walk(defaults)) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), personal, f);
  }
  assert.equal(manifest.manuals.length, 7);
  for (const m of manifest.manuals) {
    const skill = parseSkill(fs.readFileSync(path.join(defaults, 'manuals', m.id, 'SKILL.md'), 'utf8'));
    assert.equal(skill.name, m.id);
    assert.ok(Array.from(skill.description).length <= 80, m.id);
    assert.ok(skill.description.startsWith(m.title), m.id + ' 简介应以中文名开头');
  }
  assert.equal(manifest.templates.length, 3);
});

test('目标目录必须显式、绝对、存在', () => {
  assert.throws(() => checkTarget(undefined), /显式/u);
  assert.throws(() => checkTarget('relative/dir'), /显式/u);
  assert.throws(() => checkTarget(path.join(tmp(), 'nope')), /不存在/u);
});

test('命令行不带 --target 直接失败,且默认演练不落盘', () => {
  const dir = tmp();
  const conf = path.join(dir, 'conf.json');
  fs.writeFileSync(conf, JSON.stringify(cfg));
  const target = path.join(dir, 'run');
  fs.mkdirSync(target);
  const script = path.join(ops, 'install-content.mjs');
  assert.throws(() => execFileSync('node', [script, '--config', conf], {stdio: 'pipe'}));
  const out = execFileSync('node', [script, '--target', target, '--config', conf]).toString();
  assert.match(out, /演练/u);
  assert.match(out, /create\s+AGENTS\.md/u);
  assert.deepEqual(fs.readdirSync(target), []);
});

test('真装:写入、占位符填好、再装一次不变、改动先留带时间戳的副本', () => {
  const target = tmp();
  const plan = planInstall({defaultsDir: defaults, config: cfg});
  const first = applyPlan(target, plan, {now: new Date('2026-11-17T00:00:00Z')});
  assert.ok(first.backupRoot);
  const house = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  assert.match(house, /测试主人/u);
  assert.doesNotMatch(house, /\{\{/u);
  assert.ok(fs.existsSync(path.join(target, 'bots/boss/.agents/skills/group-work/SKILL.md')));
  assert.ok(!fs.existsSync(path.join(target, 'bots/boss/.agents/skills/operate-app')), '操作应用默认不装');
  assert.equal(fs.readdirSync(path.join(target, 'bots/doer/.agents/skills')).length, 2);
  assert.match(fs.readFileSync(path.join(target, 'bots/boss/AGENTS.md'), 'utf8'), /总管甲/u);
  const again = diffPlan(target, plan);
  assert.ok(again.every(r => r.action === 'unchanged'));
  fs.writeFileSync(path.join(target, 'AGENTS.md'), '旧内容');
  const second = applyPlan(
    target,
    planInstall({defaultsDir: defaults, config: cfg}),
    {now: new Date('2026-11-18T00:00:00Z')},
  );
  assert.match(second.backupRoot, /2026-11-18T00-00-00-000Z$/u);
  assert.equal(fs.readFileSync(path.join(second.backupRoot, 'AGENTS.md'), 'utf8'), '旧内容');
  assert.match(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), /测试主人/u);
});

test('派活规则只种一次,主人 写过的不覆盖', () => {
  const target = tmp();
  applyPlan(target, planInstall({defaultsDir: defaults, config: cfg}));
  const rules = path.join(target, 'shared/dispatch-rules.md');
  fs.writeFileSync(rules, '主人写的规则');
  applyPlan(target, planInstall({defaultsDir: defaults, config: cfg}));
  assert.equal(fs.readFileSync(rules, 'utf8'), '主人写的规则');
});

test('占位符缺值时整体拒绝落盘', () => {
  const target = tmp();
  const bad = structuredClone(cfg);
  delete bad.bots.boss.values.speech;
  const plan = planInstall({defaultsDir: defaults, config: bad});
  assert.throws(() => applyPlan(target, plan), /缺 speech/u);
  assert.deepEqual(fs.readdirSync(target), []);
});

test('配置校验:坏 id、不存在的模板和手册都拒绝', () => {
  for (const patch of [
    {bots: {'Bad Id': {template: 'chief'}}},
    {bots: {ok: {template: 'nope'}}},
    {bots: {ok: {template: 'chief', manuals: ['nope']}}},
  ]) {
    assert.throws(() => planInstall({defaultsDir: defaults, config: {placeholders: {}, ...patch}}));
  }
});

test('目标里的链接不跟随', () => {
  const target = tmp();
  const outside = tmp();
  fs.symlinkSync(outside, path.join(target, 'bots'));
  const plan = planInstall({defaultsDir: defaults, config: cfg});
  assert.throws(() => applyPlan(target, plan), /链接|普通文件/u);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('个人人设文件由配置指向,不进 defaults;其中的占位符照样填', () => {
  const target = tmp();
  const persona = path.join(tmp(), 'persona.md');
  fs.writeFileSync(persona, '我是{{bot_name}},叫你{{owner}}。');
  const conf = {placeholders: {owner: 'O'}, bots: {solo: {persona_file: persona, name: '小一'}}};
  applyPlan(target, planInstall({defaultsDir: defaults, config: conf}));
  const installed = fs.readFileSync(path.join(target, 'bots/solo/AGENTS.md'), 'utf8');
  assert.ok(installed.trimEnd().endsWith('我是小一,叫你O。'));
});

test('量表:分项、手册简介计数、未量的项标出', () => {
  const target = tmp();
  applyPlan(target, planInstall({defaultsDir: defaults, config: cfg}));
  assert.deepEqual(listBots(target), ['boss', 'doer']);
  const r = measureBot({root: target, id: 'boss'});
  assert.deepEqual(r.items.map(i => i.name.replace(/\(.*\)/u, '')), ['家规', '人设', '手册简介', '开工切片', '工具说明']);
  assert.ok(r.items[0].tokens > 0 && r.items[1].tokens > 0 && r.items[2].tokens > 0);
  assert.deepEqual(r.unmeasured, ['开工切片', '工具说明']);
  assert.equal(r.manuals.length, 5);
  assert.deepEqual(r.warnings, []);
  const full = measureBot({root: target, id: 'boss', sliceTokens: 100, toolTokens: 5000});
  assert.ok(full.warnings.some(w => /超过目标/u.test(w)));
  const table = renderTable([r]);
  assert.match(table, /自带合计/u);
  assert.match(table, /未量/u);
});

// 检查家规独立存放，身份段可按配置改写。
test('家规只在运行根，身份段唯一且可改写', () => {
  const target = tmp();
  applyPlan(target, planInstall({defaultsDir: defaults, config: cfg}));
  const house = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  for (const [id, bot] of Object.entries(cfg.bots)) {
    const text = fs.readFileSync(path.join(target, 'bots', id, 'AGENTS.md'), 'utf8');
    assert.ok(!text.includes(house));
    assert.equal((text.match(/<!-- hub:identity -->/gu) ?? []).length, 1);
    assert.equal((text.match(/<!-- \/hub:identity -->/gu) ?? []).length, 1);
    assert.match(text, new RegExp('^# ' + bot.name, 'u'));
    const updated = updateIdentity(text, {name: '新名', duty: '新职责', notDuty: '新边界'});
    assert.match(updated, /^# 新名/mu);
    assert.match(updated, /职责：新职责。/u);
    const segment = updated.match(/<!-- hub:identity -->[\s\S]*?<!-- \/hub:identity -->/u)[0];
    assert.doesNotMatch(segment, new RegExp('职责：' + bot.values.duty + '。', 'u'));
  }
});

// 检查改家规只更新根文件，不影响助理说明。
test('家规变更只更新运行根并备份旧家规', () => {
  const target = tmp();
  const copied = path.join(tmp(), 'defaults');
  fs.cpSync(defaults, copied, {recursive: true});
  applyPlan(target, planInstall({defaultsDir: copied, config: cfg}));
  const old = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  fs.appendFileSync(path.join(copied, 'house-rules/AGENTS.md'), '\n新增家规 {{owner}}。\n');
  const plan = planInstall({defaultsDir: copied, config: cfg});
  const result = applyPlan(target, plan, {now: new Date('2026-01-02T00:00:00Z')});
  assert.equal(fs.readFileSync(path.join(result.backupRoot, 'AGENTS.md'), 'utf8'), old);
  assert.match(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), /新增家规 测试主人/u);
  for (const id of Object.keys(cfg.bots)) {
    assert.equal(result.done.find(row => row.rel === `bots/${id}/AGENTS.md`).action, 'unchanged');
  }
});

// 检查量表各计一次家规与人设，且分别报告缺失。
test('量表每个助理各计一次根目录家规和自身人设', () => {
  const target = tmp();
  applyPlan(target, planInstall({defaultsDir: defaults, config: cfg}));
  const house = fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8');
  for (const id of Object.keys(cfg.bots)) {
    const persona = fs.readFileSync(path.join(target, 'bots', id, 'AGENTS.md'), 'utf8');
    const result = measureBot({root: target, id, sliceTokens: 0, toolTokens: 0});
    assert.equal(result.items[0].tokens, countText(house).tokens);
    assert.equal(result.items[1].tokens, countText(persona).tokens);
    assert.equal(result.total, countText(house).tokens + countText(persona).tokens + result.items[2].tokens);
  }
});

// 检查旧手册只列入演练清单，安装时保留原文件。
test('旧手册位置列出但不删除', () => {
  const target = tmp();
  const legacy = path.join(target, 'bots/boss/skills/old-manual/SKILL.md');
  fs.mkdirSync(path.dirname(legacy), {recursive: true});
  fs.writeFileSync(legacy, '旧手册');
  const plan = planInstall({defaultsDir: defaults, config: cfg});
  assert.equal(diffPlan(target, plan).find(row => row.file === legacy).action, '旧位置，可删');
  applyPlan(target, plan);
  assert.equal(fs.readFileSync(legacy, 'utf8'), '旧手册');
});

// 检查空模板助理仍有身份段，正文里的身份标记会被拒绝。
test('空模板生成身份段，正文不能重复身份标记', () => {
  const target = tmp();
  const conf = {placeholders: {owner: '主人'}, bots: {solo: {name: '新名', duty: '职责', notDuty: '边界'}}};
  applyPlan(target, planInstall({defaultsDir: defaults, config: conf}));
  const text = fs.readFileSync(path.join(target, 'bots/solo/AGENTS.md'), 'utf8');
  assert.match(text, /^# 新名/mu);
  assert.match(text, /职责：职责。不管：边界。/u);
  const persona = path.join(tmp(), 'persona.md');
  fs.writeFileSync(persona, '<!-- hub:identity -->');
  conf.bots.solo.persona_file = persona;
  assert.throws(() => planInstall({defaultsDir: defaults, config: conf}), /identity 标记/u);
});
