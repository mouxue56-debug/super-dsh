import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectBrief,
  compileMinutes,
  filterDraft,
  meetingPlan,
  pickForKb,
  readBoard,
  readEventsJsonl,
  runMeeting,
} from '../lib/meeting.mjs';
const cfg = {
  roster: [{ id: 'boss', name: '首席', role: 'chief' }, {
    id: 'a1',
    name: '助理甲',
    role: 'assistant',
  }, { id: 'a2', name: '助理乙', role: 'assistant' }],
  attendees: { morning: 'all', evening: 'all' },
  times: { morning: '09:00', evening: '18:00' },
  utcOffsetMinutes: 60,
  projectMap: { byAssistant: { a1: '项目甲' }, default: '项目乙' },
  bannedTerms: ['禁用词'],
  maxChatLines: 20,
  kbSubmit: 'auto',
};
const date = '2026-01-02', ts = '2026-01-01T23:30:00Z', assistant = cfg.roster[1];
const ticket = (col, id = 'T-20260101-123456-abcd') => ({
  id,
  col,
  meta: { assignee: 'a1', creator: 'a2', status: col, updatedAt: ts },
  title: '任务甲',
  progress: [{ ts, text: '进度甲' }],
  report: '回报甲',
});
const event = (kind, text = '内容甲', extra = {}) => ({
  ts,
  assistant: 'a1',
  kind,
  text,
  ...extra,
});
const brief = (args = {}) =>
  collectBrief({ assistant, date, type: 'evening', tickets: [], events: [], cfg, ...args });
const temp = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-test-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const draft = (over = {}) => ({
  id: 'dshm-2026-01-02-abcdef0123',
  project: '项目甲',
  summary: '摘要',
  body: '正文',
  next: '',
  evidence: ['证据'],
  ...over,
});

test('参会计划', () => {
  assert.deepEqual(meetingPlan(cfg, 'morning').attendees, [{ id: 'a1', name: '助理甲' }, {
    id: 'a2',
    name: '助理乙',
  }]);
  assert.deepEqual(
    meetingPlan({ ...cfg, attendees: { ...cfg.attendees, morning: ['a2'] } }, 'morning').attendees,
    [{ id: 'a2', name: '助理乙' }],
  );
  assert.doesNotThrow(() => meetingPlan({ ...cfg, roster: cfg.roster.slice(1) }, 'morning'));
  assert.throws(() => meetingPlan(cfg, 'other'));
});

test('读取看板与事件', (t) => {
  const d = temp(t), dir = path.join(d, 'done');
  fs.mkdirSync(dir);
  const n = 'T-20260101-123456-abcd.md';
  fs.writeFileSync(
    path.join(dir, n),
    '---\nid: T-20260101-123456-abcd\ncreator: a1\nassignee: a1\nstatus: done\ncreatedAt: ' + ts +
      '\nupdatedAt: ' + ts + '\n---\n## 任务\n任务甲\n## 进度\n- ' + ts +
      ' 完成\n## 回报\n回报甲\n',
  );
  fs.writeFileSync(path.join(dir, 'bad.md'), 'x');
  fs.writeFileSync(path.join(dir, 'T-20260101-123456-abce.md'), 'x'.repeat(262145));
  fs.symlinkSync(path.join(dir, n), path.join(dir, 'T-20260101-123456-abcf.md'));
  const rows = readBoard(d);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '任务甲');
  assert.deepEqual(rows[0].progress, [{ ts, text: '完成' }]);
  assert.deepEqual(readBoard(path.join(d, 'missing')), []);
  const f = path.join(d, 'events');
  fs.writeFileSync(f, JSON.stringify(event('note')) + '\nbad\n');
  assert.equal(readEventsJsonl(f).length, 1);
  assert.deepEqual(readEventsJsonl(path.join(d, 'none')), []);
});

test('完整汇报格式和本地日期', () => {
  const b = brief({
    tickets: [
      ticket('done'),
      ticket('failed', 'T-20260101-123456-abce'),
      ticket('working', 'T-20260101-123456-abcf'),
    ],
    events: [event('approval_pending', '请确认')],
    learned: '学到甲',
  });
  assert.equal(
    b.markdown,
    `# 助理甲 给首席的晚会汇报 · 2026-01-02\n` +
    `来源：a1 · 看板工单 + 事件账，由代码整理 · 标签：【AI归纳】【Owner未确认】\n` +
    `## 做成的（1）\n` +
    `- T-20260101-123456-abcd 任务甲\n` +
    `## 失败的（1）\n` +
    `- T-20260101-123456-abce 任务甲 —— 原因：回报甲\n` +
    `## 在等的（1）\n` +
    `- T-20260101-123456-abcf 任务甲（working）\n` +
    `## 要主人点头的（1）\n` +
    `- 请确认\n` +
    `## 学到的一条\n` +
    `学到甲`,
  );
});

test('空分类、清洗和截断', () => {
  const b = brief({
    learned: '甲\n' + '乙'.repeat(130),
    events: [event('approval_pending', '字\t' + '长'.repeat(150))],
  });
  assert.match(b.markdown, /## 做成的（0）\n（无）/);
  assert.ok(b.markdown.split('\n').every((x) => x.length <= 120));
  assert.equal(b.data.learned.length, 120);
  assert.ok(!b.data.learned.includes('\n'));
  assert.equal(brief({ learned: ' \n ' }).data.learned, undefined);
  assert.match(brief().markdown, /## 学到的一条\n（无）/);
});

test('纪要追加、去重、缺席和权限', (t) => {
  const d = temp(t),
    b = brief(),
    args = {
      date,
      type: 'evening',
      briefs: [b, { ...b, assistantId: 'other' }],
      minutesDir: d,
      cfg,
      now: new Date(ts),
    };
  const first = compileMinutes(args);
  assert.equal(first.appended, true);
  assert.deepEqual(first.absent, ['a2']);
  assert.deepEqual(first.rejected, [{ assistantId: 'other', reason: 'not-attendee' }]);
  assert.match(first.text, /# 2026-01-02 晚会纪要/);
  assert.match(first.text, /## 汇总/);
  assert.equal(fs.statSync(first.file).mode & 0o777, 0o600);
  const again = compileMinutes(args);
  assert.equal(again.appended, false);
  assert.equal(fs.readFileSync(first.file, 'utf8'), first.text);
  const next = compileMinutes({ ...args, briefs: [brief({ learned: '新内容' })] });
  assert.ok(fs.readFileSync(first.file, 'utf8').startsWith(first.text));
  assert.match(next.text, /## 补充/);
  assert.throws(() => compileMinutes({ ...args, minutesDir: 'relative' }));
});

test('条目、映射、原话与稳定标识', (t) => {
  const d = temp(t),
    events = [
      event('decision'),
      event('practice'),
      event('handoff'),
      event('owner_quote', '', {
        ownerQuote: { text: '原话内容', source: '出处', sourceText: '这里是原话内容' },
      }),
    ];
  const m = compileMinutes({
    date,
    type: 'evening',
    briefs: [brief({ tickets: [ticket('failed')], events })],
    minutesDir: d,
    cfg,
  });
  // 主人原话只认宿主按出处从消息库取回的原文，事件自带的 sourceText 不算。
  const host = { resolveSource: (source) => source === '出处' ? '原话内容' : undefined };
  assert.ok(!pickForKb(m, cfg).drafts[0].body.includes('【Owner要求】'));
  const result = pickForKb(m, cfg, host);
  assert.deepEqual(result.drafts.map((x) => x.kind), ['decision', 'incident', 'work', 'handoff', 'decision']);
  assert.ok(result.drafts[4].body.includes('【Owner要求】'));
  assert.ok(result.drafts.every((x) => !x.labels.includes('Owner要求')));
  assert.deepEqual(pickForKb(m, cfg, host).drafts.map((x) => x.id), result.drafts.map((x) => x.id));
  assert.notEqual(
    pickForKb({ ...m, entries: [{ ...m.entries[0], text: '另一内容' }] }, cfg).drafts[0].id,
    result.drafts[0].id,
  );
  assert.equal(pickForKb({ ...m, type: 'morning' }, cfg).skipped, 'not-evening');
  for (
    const q of [{ text: '原话内容', source: '出处', sourceText: '不同内容' }, {
      text: '原话内容',
      source: '',
      sourceText: '原话内容',
    }, { text: '短句', source: '出处', sourceText: '短句' }]
  ) {
    const x = pickForKb({ ...m, entries: [{ ...m.entries[0], ownerQuote: q }] }, cfg, {
      resolveSource: () => q.sourceText,
    }).drafts[0];
    assert.equal(x.quoteDowngraded, true);
    assert.ok(!x.body.includes('【Owner要求】'));
  }
  assert.equal(
    pickForKb({
      ...m,
      entries: [{ assistantId: 'a2', assistantName: '助理乙', category: 'practice', text: '内容' }],
    }, cfg).drafts[0].project,
    '项目乙',
  );
  assert.ok(pickForKb(m, { ...cfg, projectMap: {} }).blocked[0].reasons.includes('no-project'));
});

test('过滤敏感内容与路径', () => {
  const secrets = [
    'sk-' + 'x'.repeat(16),
    '-----BEGIN PRIVATE KEY-----',
    'eyJabc.def.ghi',
    'Bearer ' + 'x'.repeat(20),
    'Ab1' + 'x'.repeat(32),
    'a'.repeat(40),
    'AKIA' + 'A'.repeat(16),
  ];
  for (const s of secrets) {
    const r = filterDraft(draft({ body: s }), cfg);
    assert.ok(r.reasons.includes('secret'), s);
    assert.ok(!JSON.stringify(r).includes(s));
  }
  assert.equal(
    filterDraft(draft({ body: '/abc/' + 'z'.repeat(20) + '1/' + 'y'.repeat(20) }), cfg).ok,
    true,
  );
  assert.equal(filterDraft(draft(), cfg).ok, true);
  for (const s of ['x@example.test', '13812345678', '+12345678901', '123-4567-8901']) {
    assert.ok(filterDraft(draft({ body: s }), cfg).reasons.includes('contact'));
  }
  assert.ok(
    filterDraft(draft({ body: 'BADword' }), { ...cfg, bannedTerms: ['badWORD'] }).reasons.includes(
      'banned-term',
    ),
  );
  assert.equal(filterDraft(draft({ body: Array(20).fill('> 内容').join('\n') }), cfg).ok, true);
  assert.ok(
    filterDraft(draft({ body: Array(21).fill('用户：内容').join('\n') }), cfg).reasons.includes(
      'chat-log',
    ),
  );
  assert.ok(filterDraft(draft({ summary: '', body: '' }), cfg).reasons.includes('invalid-field'));
});

test('编排自动提交、卡片、错误和晨会', async (t) => {
  const d = temp(t), f = path.join(d, 'events');
  fs.writeFileSync(f, [event('decision'), event('practice')].map(JSON.stringify).join('\n'));
  const args = {
    date,
    type: 'evening',
    boardDir: path.join(d, 'board'),
    eventsFile: f,
    minutesDir: d,
    cfg,
  };
  let calls = 0;
  const auto = await runMeeting({
    ...args,
    submit: async () => {
      calls++;
      if (calls === 1) {
        throw Error('x');
      }
      return { state: 'ok' };
    },
  });
  assert.equal(calls, 2);
  assert.equal(auto.submitted[0].reason, 'submit-threw');
  assert.equal(auto.submitted[1].state, 'ok');
  const card = await runMeeting({
    ...args,
    cfg: { ...cfg, kbSubmit: 'card' },
    submit: () => {
      throw Error('called');
    },
  });
  assert.equal(card.pendingCards.length, 2);
  assert.equal((await runMeeting({ ...args, type: 'morning' })).drafts.length, 0);
  const { kbSubmit, ...noMode } = cfg;
  const byDefault = await runMeeting({
    ...args,
    cfg: noMode,
    submit: () => {
      throw Error('called');
    },
  });
  assert.equal(byDefault.kbSubmit, 'card');
  assert.equal(byDefault.pendingCards.length, 2);
});

test('源码卫生', () => {
  const s = fs.readFileSync(new URL('../lib/meeting.mjs', import.meta.url), 'utf8');
  for (
    const term of ['child_process', 'process.env', 'os.homedir', '/Users/', 'fetch(', 'https://']
  ) assert.ok(!s.includes(term));
});

test('拦截结果不回传命中内容且检查所有字段', () => {
  const secret = 'sk-' + 'q'.repeat(16);
  for (const field of ['project', 'summary', 'body', 'next', 'evidence']) {
    const value = field === 'evidence' ? [secret] : secret;
    assert.ok(filterDraft(draft({ [field]: value }), cfg).reasons.includes('secret'));
  }
  const m = {
    date,
    type: 'evening',
    entries: [{ assistantId: 'a1', assistantName: '助理甲', category: 'decision', text: secret }],
  };
  const result = pickForKb(m, cfg);
  assert.equal(result.blocked.length, 1);
  assert.ok(!JSON.stringify(result.blocked).includes(secret));
});

test('工单归属、日期、失败回退与事件筛选', () => {
  const list = [{ ...ticket('failed'), report: '\n', progress: [{ ts, text: '失败进度' }] }, {
    ...ticket('failed', 'T-20260101-123456-abce'),
    report: '',
    progress: [],
  }, {
    ...ticket('done', 'T-20260101-123456-abcf'),
    meta: { assignee: 'a2', creator: 'a2', status: 'done', updatedAt: ts },
  }, {
    ...ticket('working', 'T-20260101-123456-abd0'),
    meta: { assignee: 'a1', status: 'done', updatedAt: ts },
  }];
  const b = brief({
    tickets: list,
    events: [event('approval_pending', '已解决', { resolved: true }), event('decision', '当天'), {
      ...event('practice'),
      ts: '2025-12-30T00:00:00Z',
    }],
  });
  assert.deepEqual(b.data.failed.map((x) => x.reason), ['失败进度', '未记录']);
  assert.equal(b.data.done.length, 0);
  assert.equal(b.data.waiting.length, 0);
  assert.equal(b.data.approvals.length, 0);
  assert.equal(b.data.decisions.length, 1);
  assert.equal(b.data.practices.length, 0);
  assert.equal(brief({ assistant: { id: 'unknown', name: '其他' } }).assistantName, 'unknown');
});

test('原话无决定单独成条，多条原话保留', (t) => {
  const d = temp(t),
    q = (x) => event('owner_quote', '', { ownerQuote: { text: x, source: '出处', sourceText: x } }),
    b = brief({ events: [q('原话甲内容'), q('原话乙内容')] });
  const m = compileMinutes({ date, type: 'evening', briefs: [b], minutesDir: d, cfg });
  assert.equal(m.entries.length, 2);
  assert.ok(m.entries.every((x) => x.category === 'decision' && x.ownerQuote));
  assert.equal(pickForKb(m, cfg).drafts.length, 2);
});

test('重复草稿只保留一份及追加时间换算', (t) => {
  const d = temp(t), b = brief({ events: [event('decision'), event('decision')] });
  let m = compileMinutes({
    date,
    type: 'evening',
    briefs: [b],
    minutesDir: d,
    cfg,
    now: new Date(ts),
  });
  assert.equal(pickForKb(m, cfg).drafts.length, 1);
  m = compileMinutes({
    date,
    type: 'evening',
    briefs: [brief({ learned: '变更' })],
    minutesDir: d,
    cfg,
    now: new Date(ts),
  });
  assert.match(m.text, /## 补充 00:30/);
});
