import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS,
  OWNER,
  emptyPage,
  parsePage,
  renderPage,
  extractRefs,
  shouldSummarize,
  buildSkeleton,
  appendOwnerQuotes,
  checkCoverage,
  archiveOverflow,
  finalizeSummary,
} from '../lib/group-page.mjs';
const base = emptyPage({
  name: '测试', goal: '完成目标'
});

const put = (page, section, lines) => page.replace(`## ${section}\n`, `## ${section}\n${lines}\n`);
test('七段解析渲染逐字往返并诊断错误', () => {
  const page = put(base, '进度', '- 第一行\n  续行 #12\n- ✓ 完成〔作废〕');
  const p = parsePage(page);
  assert.deepEqual(p.errors, []);
  assert.equal(renderPage(p), page);
  assert.equal(p.sections['进度'][0].text, '第一行\n续行 #12');
  assert.deepEqual(extractRefs('#12 #3 #12'), [
    12, 3, 12
  ]);
  assert.equal(p.sections['进度'][1].done, true);
  assert.equal(p.sections['进度'][1].voided, true);
  assert.equal(SECTIONS.length, 7);
  assert.equal(OWNER, 'owner');
  assert.ok(parsePage(page.replace('## 目标', '## 卡点')).errors.length);
});

test('主人原话追加、保留多行和旧行、去重', () => {
  const old = put(base, '主人说过的', '- [#1] 旧话\n  旧续行');
  const msgs = [
    {
      id: 2, from: 'owner', text: '新话\n  原有空格\n末行'
    }, {
      id: 1, from: 'owner', text: '不替换'
    }
  ];
  const page = appendOwnerQuotes(old, msgs);
  assert.equal(page.replace('- [#2] 新话\n    原有空格\n  末行\n', ''), old);
  assert.equal(appendOwnerQuotes(page, msgs), page);
  assert.equal(checkCoverage({
    pageText: page, messages: [msgs[0]]
  }).complete, true);
});

test('三种纪要触发条件', () => {
  for (const args of [
    { messagesSinceSummary: 20 }, { ownerSpoke: true }, { ticketFinished: true }
  ]) {
    assert.equal(shouldSummarize(args).due, true);
  }
  assert.equal(shouldSummarize({ messagesSinceSummary: 19 }).due, false);
});

test('骨架包含原话、决定、异议和变化', () => {
  const messages = [
    {
      id: 1, from: 'owner', text: '原话'
    }, {
      id: 2, from: 'm-copy', text: '〔决定〕方向'
    }, {
      id: 3, from: 'm-image', text: '〔异议〕问题'
    }
  ];
  const x = buildSkeleton({
    messages, tickets: [{
        id: 't', title: '任务', status: 'done'
      }], prevTicketStatus: { t: 'doing' }, pageText: base
  });
  assert.deepEqual(x.ownerQuotes, [{
      id: 1, text: '原话'
    }]);
  assert.equal(x.decisions[0].id, 2);
  assert.equal(x.objections[0].id, 3);
  assert.deepEqual(x.ticketChanges[0], {
    id: 't', title: '任务', from: 'doing', to: 'done'
  });
  assert.match(x.prompt, /每条决定必须带 #消息号/);
});

test('遗漏决定被发现并显式标记', () => {
  const messages = [{
      id: 15, from: 'm-copy', text: '〔决定〕做甲'
    }];
  assert.equal(checkCoverage({
    pageText: base, messages
  }).complete, false);
  const x = finalizeSummary({
    oldPageText: base, modelPageText: base, messages
  });
  assert.equal(x.ok, false);
  assert.match(x.pageText, /〔纪要不完整〕缺：#15（决定）/);
});

test('旧原话与决定受保护，新增决定合并', () => {
  let old = put(base, '主人说过的', '- [#1] 原话');
  old = put(old, '已定的决定', '- [#2] 旧决定');
  let model = put(base, '主人说过的', '- [#1] 篡改');
  model = put(model, '已定的决定', '- [#2] 篡改决定\n- [#3] 新决定');
  const x = finalizeSummary({
    oldPageText: old, modelPageText: model, messages: [{
        id: 3, from: 'm-copy', text: '〔决定〕新决定'
      }, {
        id: 4, from: 'owner', text: '新原话'
      }]
  });
  assert.match(x.pageText, /- \[#1\] 原话/);
  assert.match(x.pageText, /- \[#2\] 旧决定/);
  assert.match(x.pageText, /- \[#3\] 新决定/);
  assert.doesNotMatch(x.pageText, /篡改/);
  assert.equal(x.ok, true);
});

test('异常模型格式回退旧页并警告', () => {
  const x = finalizeSummary({
    oldPageText: base, modelPageText: '坏格式', messages: []
  });
  assert.equal(x.pageText, base);
  assert.ok(x.warnings.length);
});

test('归档按优先级保留保护段和有效决定', () => {
  let page = put(base, '主人说过的', '- [#1] 原话');
  page = put(page, '已定的决定', '- [#2] 有效\n- 〔作废〕 [#3] 旧决定');
  page = put(page, '进度', Array.from({ length: 65 }, (_, i) => `- ${i === 2 ? '✓ ' : ''}进度${i}`).join('\n'));
  const x = archiveOverflow(page, {});
  assert.equal(x.overLimit, false);
  assert.match(x.archived[0], /^\[进度\] - ✓/);
  assert.match(x.pageText, /- \[#1\] 原话/);
  assert.match(x.pageText, /- \[#2\] 有效/);
  assert.equal(parsePage(x.pageText).errors.length, 0);
});

test('保护内容超过上限时仍报告超限', () => {
  const page = put(base, '主人说过的', Array.from({ length: 65 }, (_, i) => `- [#${i}] 原话`).join('\n'));
  const x = archiveOverflow(page, {});
  assert.equal(x.overLimit, true);
  assert.equal(x.pageText, page);
});

test('异议覆盖允许卡点或决定', () => {
  const messages = [{
      id: 8, from: 'm-copy', text: '〔异议〕问题'
    }];
  assert.deepEqual(checkCoverage({
    pageText: base, messages
  }).missing, [{
      id: 8, kind: 'objection'
    }]);
  assert.equal(checkCoverage({
    pageText: put(base, '卡点', '- [#8] 问题'), messages
  }).complete, true);
});
