import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupPageEvents, localDate, offsetFor, rulesEvents, ticketEvents, toTickets }
  from '../lib/meetings-sources.mjs';
import { collectBrief, compileMinutes, pickForKb } from '../lib/meeting.mjs';

const date = '2026-01-02';
const ts = date + 'T12:00:00.000Z';
const attendees = [{ id: 'a1', name: '甲' }];
const temp = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sources-'));
const ticket = { id: 'T1', title: '任务', state: 'progress', to: ['a1'], hop: 1, updatedAt: ts,
  verification: [{ ts, verdict: 'pass' }], report: { summary: '完成验证' } };
const page = '# 组甲\n## 主人说过的\n- [#1] 请保持完整记录\n## 已定的决定\n- [#2] 记录决定\n' +
  '## 分工与谁来验\n- a1 负责\n';

function pages() {
  const dir = temp();
  const file = path.join(dir, 'page.md');
  fs.writeFileSync(file, page);
  fs.utimesSync(file, new Date(ts), new Date(ts));
  return { dir, file };
}

function group(dir, seen = new Set()) {
  return groupPageEvents({ dir, date, offsetMinutes: 0, attendees, seen });
}

function rules(text) {
  const dir = temp();
  fs.mkdirSync(path.join(dir, 'a1'));
  fs.writeFileSync(path.join(dir, 'a1', '规矩.md'), text);
  return rulesEvents({ dir, date, offsetMinutes: 0, attendees });
}

test('核验产生做法', () => {
  assert.match(ticketEvents({ tickets: [ticket], date, type: 'evening' })[0].text, /核验通过/);
});
test('晨会不提取工单事件', () => {
  assert.deepEqual(ticketEvents({ tickets: [ticket], date, type: 'morning' }), []);
});
test('未完成转交产生交接', () => {
  assert.equal(ticketEvents({ tickets: [ticket], date, type: 'evening' })[1].kind, 'handoff');
});
test('完成工单不产生交接', () => {
  assert.equal(ticketEvents({ tickets: [{ ...ticket, state: 'completed' }], date, type: 'evening' }).length, 1);
});
test('项目页抽取决定和原话', () => {
  const result = group(pages().dir);
  assert.equal(result.events.find(x => x.kind === 'decision').ownerQuote, undefined);
  assert.equal(result.events.find(x => x.kind === 'owner_quote').ownerQuote.text, '请保持完整记录');
  assert.deepEqual(result.seenAdd, ['组甲#2', '组甲#q1']);
});
test('决定与原话按 seen 去重', () => {
  const result = group(pages().dir, new Set(['组甲#2', '组甲#q1']));
  assert.deepEqual(result.seenAdd, []);
  assert.deepEqual(result.events, []);
});
test('旧项目页跳过', () => {
  const f = pages();
  fs.utimesSync(f.file, new Date('2026-01-01'), new Date('2026-01-01'));
  assert.deepEqual(group(f.dir).events, []);
});
test('未归属条目计数', () => {
  const f = pages();
  fs.writeFileSync(f.file, page.replace('a1 负责', '无人负责'));
  fs.utimesSync(f.file, new Date(ts), new Date(ts));
  assert.equal(group(f.dir).unattributed, 2);
});
test('符号链接跳过', () => {
  const f = pages();
  fs.symlinkSync(f.file, path.join(f.dir, 'link.md'));
  assert.equal(group(f.dir).seenAdd.length, 2);
});
test('超大项目页跳过', () => {
  const f = pages();
  fs.writeFileSync(f.file, 'x'.repeat(262145));
  fs.utimesSync(f.file, new Date(ts), new Date(ts));
  assert.equal(group(f.dir).events.length, 0);
});
test('规矩页原话', () => {
  const event = rules('- 2026-01-02 「请保持完整记录」');
  assert.equal(event[0].ownerQuote.text, '请保持完整记录');
  assert.equal(event[0].kind, 'owner_quote');
});
test('规矩页做法', () => {
  assert.equal(rules('- 2026-01-02 保持记录')[0].kind, 'practice');
});
test('规矩页日期过滤', () => {
  assert.deepEqual(rules('- 2026-01-01 保持记录'), []);
});
test('各状态转换', () => {
  const states = ['queued', 'progress', 'completed', 'failed', 'blocked',
    'waiting-human', 'waiting-timeout', 'uncertain'];
  assert.deepEqual(toTickets(states.map(state => ({ state }))).map(x => x.col),
    ['new', 'working', 'done', 'failed', 'blocked', 'blocked', 'blocked', 'blocked']);
});
test('显式偏移优先', () => {
  assert.equal(offsetFor({ utcOffsetMinutes: 75, timezone: 'UTC' }, Date.now()), 75);
});
test('时区偏移', () => {
  assert.equal(offsetFor({ timezone: 'Asia/Tokyo' }, Date.now()), 540);
});
test('本机偏移', () => {
  assert.equal(offsetFor({}, Date.now()), -new Date().getTimezoneOffset());
});
test('本地日期跨日', () => {
  assert.equal(localDate('2026-01-01T23:30:00Z', 60), date);
});
test('原话经过会议管线逐字保留', () => {
  const events = rules('- 2026-01-02 「请保持完整记录」');
  const cfg = { roster: [{ ...attendees[0], role: 'assistant' }], attendees: { evening: 'all' },
    utcOffsetMinutes: 0, projectMap: { default: 'project' } };
  const brief = collectBrief({ assistant: attendees[0], date, type: 'evening', tickets: [], events, cfg });
  const minutes = compileMinutes({ date, type: 'evening', briefs: [brief], minutesDir: temp(), cfg });
  const host = { resolveSource: () => '请保持完整记录' };
  assert.match(pickForKb(minutes, cfg).drafts[0].body, /转述/);
  const drafts = pickForKb(minutes, cfg, host).drafts;
  assert.match(drafts[0].body, /主人原话（逐字/);
  assert.doesNotMatch(drafts[0].body, /转述/);
});
