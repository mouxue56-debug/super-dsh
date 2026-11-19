import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendArchive,
  appendMessage,
  createGroup,
  readMessages,
  readPage,
  saveGroup,
  writePage,
} from '../lib/group.mjs';
import { decideWake, initialWakeState } from '../lib/group-wake.mjs';
import { buildContext, estimateTokens } from '../lib/group-context.mjs';
import {
  buildSkeleton,
  checkCoverage,
  emptyPage,
  finalizeSummary,
  parsePage,
  shouldSummarize,
} from '../lib/group-page.mjs';

const ids = ['m-host', 'm-research', 'm-image', 'm-copy', 'm-exec'];
/** 创建长对话测试所需的群组和目录。 */
function mk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grp-'));
  const members = ids.map((id) => ({
    id,
    kind: 'assistant',
    role: id === 'm-host' ? 'host' : 'member',
  }));
  const group = createGroup({
    id: 'g1',
    name: '长对话组',
    goal: '做一个四步项目',
    members,
    host: 'm-host',
  });
  saveGroup(root, group);
  writePage(root, 'g1', emptyPage({ name: group.name, goal: group.goal }));
  return { root, group };
}

/** 模拟模型汇总决定和进度，可按消息号故意遗漏。 */
function fakeModel(oldPage, msgs, omit = []) {
  let p = oldPage.replace(/\n$/, '');
  const dec = msgs.filter((m) => m.text.includes('〔决定〕') && !omit.includes(m.id)).map((m) =>
    `- [#${m.id}] ${m.text.replace('〔决定〕', '')}`
  );
  p = p.replace('## 分工与谁来验', `${dec.length ? '' : ''}## 分工与谁来验`);
  const lines = p.split('\n');
  const di = lines.indexOf('## 已定的决定');
  lines.splice(di + 1 + 0, 0, ...[]);
  let out = lines.join('\n');
  out = out.replace('## 分工与谁来验', '## 分工与谁来验');
  const at = out.indexOf('## 分工与谁来验');
  out = out.slice(0, at).replace(/\n*$/, '\n') + dec.join('\n') + (dec.length ? '\n' : '') +
    out.slice(at);
  const upto = msgs.at(-1).id;
  return out.replace('## 卡点', `- 截至 #${upto} 已推进\n## 卡点`);
}

test('200 条消息：上下文不超预算，主人原话与决定一句不少，6 次空转会停', async () => {
  const { root, group } = mk();
  let state = initialWakeState();
  let sinceSummary = [];
  const owners = [], decisions = [];
  const lastSpoke = Object.fromEntries(ids.map((i) => [i, 0]));
  let maxUsed = 0, pausedSeen = false, summaries = 0;
  for (let n = 1; n <= 200; n++) {
    const fromOwner = n % 20 === 1;
    const from = fromOwner ? 'owner' : ids[1 + (n % 4)];
    let text = fromOwner
      ? `主人第${n}句话要求${'甲乙丙丁'[n % 4]}方案务必先看预算`
      : `成员${from}汇报第${n}项进展，已产出文件 out/${n}.md`;
    if (!fromOwner && n % 17 === 0) {
      text = `〔决定〕第${n}号方案采用路线${n % 3}，理由见文件`;
    }
    const msg = appendMessage(root, 'g1', {
      from,
      text,
      to: fromOwner ? [] : (n % 5 === 0 ? ['m-host'] : []),
      toolCalls: 1,
    });
    if (fromOwner) {
      owners.push(msg);
    }
    if (text.includes('〔决定〕')) {
      decisions.push(msg);
    }
    const r = decideWake({
      group,
      message: msg,
      state,
      recent: readMessages(root, 'g1', { limit: 7 }).slice(0, -1),
    });
    state = r.state;
    sinceSummary.push(msg);
    const sum = shouldSummarize({
      messagesSinceSummary: sinceSummary.length,
      ownerSpoke: fromOwner,
      ticketFinished: false,
      n: group.limits.summaryEveryN,
    });
    if (sum.due) {
      const old = readPage(root, 'g1');
      const sk = buildSkeleton({ messages: sinceSummary, pageText: old });
      assert.ok(sk.prompt.length > 0);
      const f = finalizeSummary({
        oldPageText: old,
        modelPageText: fakeModel(old, sinceSummary),
        messages: sinceSummary,
        maxLines: group.limits.pageMaxLines,
      });
      assert.equal(f.ok, true, JSON.stringify(f.coverage));
      writePage(root, 'g1', f.pageText);
      if (f.archived.length) {
        appendArchive(root, 'g1', f.archived.join('\n'));
      }
      assert.ok(f.pageText.split('\n').length <= 61);
      sinceSummary = [];
      summaries++;
    }
    const page = readPage(root, 'g1');
    const all = readMessages(root, 'g1');
    for (const id of ids) {
      const ctx = buildContext({
        group,
        memberId: id,
        page,
        tickets: [],
        messages: all,
        lastSpokeId: lastSpoke[id],
      });
      maxUsed = Math.max(maxUsed, ctx.used);
      assert.ok(ctx.used <= ctx.budget, `#${n} ${id} used ${ctx.used}`);
      assert.equal(ctx.overBudget, false);
      assert.ok(estimateTokens(ctx.text) <= ctx.budget + 8);
      if (r.wake.includes(id)) {
        lastSpoke[id] = n;
      }
    }
  }
  if (sinceSummary.length) { // 收尾：最后不足 20 条的也要纪要一次
    const old = readPage(root, 'g1');
    const f = finalizeSummary({
      oldPageText: old,
      modelPageText: fakeModel(old, sinceSummary),
      messages: sinceSummary,
    });
    assert.equal(f.ok, true);
    writePage(root, 'g1', f.pageText);
  }
  const finalPage = parsePage(readPage(root, 'g1'));
  for (const m of owners) {
    assert.ok(
      finalPage.sections['主人说过的'].some((e) => e.text.includes(m.text)),
      `主人原话 #${m.id} 丢了`,
    );
  }
  for (const m of decisions) {
    assert.ok(
      finalPage.sections['已定的决定'].some((e) => e.refs.includes(m.id)),
      `决定 #${m.id} 丢了`,
    );
  }
  assert.ok(summaries >= 10 && maxUsed > 0 && owners.length === 10 && decisions.length >= 10);
  // 任一成员最后一次拿到的上下文里仍含全部主人原话和决定
  const ctx = buildContext({
    group,
    memberId: 'm-copy',
    page: readPage(root, 'g1'),
    messages: readMessages(root, 'g1'),
    lastSpokeId: 200,
  });
  for (const m of owners) {
    assert.ok(ctx.text.includes(m.text));
  }
  for (const m of decisions) {
    assert.ok(ctx.text.includes(`#${m.id}`));
  }
});

test('故意漏掉决定：查漏抓到，纪要标不完整', () => {
  const { root } = mk();
  const msgs = [
    appendMessage(root, 'g1', { from: 'owner', text: '预算只有一千' }),
    appendMessage(root, 'g1', { from: 'm-copy', text: '〔决定〕文案走短句风格', toolCalls: 1 }),
    appendMessage(root, 'g1', { from: 'm-image', text: '〔决定〕图用竖版', toolCalls: 1 }),
  ];
  const old = readPage(root, 'g1');
  const f = finalizeSummary({
    oldPageText: old,
    modelPageText: fakeModel(old, msgs, [msgs[2].id]),
    messages: msgs,
  });
  assert.equal(f.ok, false);
  assert.deepEqual(f.coverage.missing.map((x) => [x.id, x.kind]), [[3, 'decision']]);
  assert.match(f.pageText, /纪要不完整/);
  assert.equal(checkCoverage({ pageText: f.pageText, messages: msgs }).complete, false);
});
