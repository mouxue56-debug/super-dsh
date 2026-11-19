import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OWNER,
  TICKET_STATUS,
  pickVerifier,
  assignTicket,
  checkAck,
  acceptTicket,
  submitForReview,
  validateVerdicts,
  submitVerification,
  makeReviewTicket,
  ownerNoticePolicy,
} from '../lib/group-review.mjs';
/** 创建用于测试的内存工单存储。 */
function makeStore() {
  const map = new Map();
  let seq = 0;
  return {
    async get(id) {
      return structuredClone(map.get(id) ?? null);
    }, async update(id, patch) {
      const next = {
        ...map.get(id), ...structuredClone(patch)
      };
      map.set(id, next);
      return structuredClone(next);
    }, async create(ticket) {
      const next = {
        ...structuredClone(ticket), id: String(++seq)
      };
      map.set(next.id, next);
      return structuredClone(next);
    }
  };
}

const group = {
  id: 'g', host: 'm-host', reviewer: 'm-external', members: [
    'm-host', 'm-research', 'm-copy', 'm-image', 'm-exec'
  ].map(id => ({ id })), pipeline: [
    'm-research', 'm-copy', 'm-image', 'm-exec'
  ], limits: { rejectLimit: 2 }
};

const input = {
  title: '任务', goal: '整理调研结果', assignee: 'm-research', checklist: [
    '列出来源', '说明结论'
  ]
};

const passed = [
  {
    item: 0, verdict: 'pass', evidence: '见 out/sources.md 第一节，来源齐全'
  }, {
    item: '说明结论', verdict: 'pass', evidence: '见 out/summary.md 与消息 #12'
  }
];
/** 创建测试工单及其存储。 */
async function setup(options = {}) {
  const store = makeStore();
  const ticket = await assignTicket({
    store, group, input: {
      ...input, ...options
    }
  });
  return {
    store, ticket
  };
}

/** 将测试工单推进到验收状态。 */
async function ready(store, ticket) {
  await acceptTicket({
    store, ticketId: ticket.id, restatement: '整理调研结果 列出来源 说明结论'
  });
  await submitForReview({
    store, ticketId: ticket.id, by: ticket.assignee
  });
}

test('选择下一位、循环、覆盖与单成员', () => {
  assert.equal(pickVerifier({
    ticket: { assignee: 'm-exec' }, group
  }), 'm-research');
  assert.equal(pickVerifier({
    ticket: { assignee: 'm-research' }, group, overrides: { 'm-research': 'm-image' }
  }), 'm-image');
  assert.equal(pickVerifier({
    ticket: { assignee: 'x' }, group: { members: [{ id: 'x' }] }
  }), null);
  assert.equal(OWNER, 'owner');
  assert.equal(TICKET_STATUS.WAIT_OWNER, 'wait_owner');
});

test('派单校验执行者、验收者与清单', async () => {
  const store = makeStore();
  for (const change of [
    { verifier: 'm-research' },
    { assignee: 'bad' },
    { verifier: 'bad' },
    { checklist: [] },
    { checklist: [' '] },
    { title: ' ' },
    { goal: '' }
  ]) {
    await assert.rejects(assignTicket({
      store, group, input: {
        ...input, ...change
      }
    }));
  }
});

test('复述对不上只提示不拦开工，对得上记 acked', async () => {
  const { store, ticket } = await setup();
  assert.equal(checkAck({
    ticket, restatement: '无关内容'
  }).ok, false);
  // 对不上只提示、不拦开工：状态照常变 doing，acked 为 false，并带纠正提示
  const warned = await acceptTicket({
    store, ticketId: ticket.id, restatement: '无关内容'
  });
  assert.equal(warned.ok, true);
  assert.equal(warned.warning, true);
  assert.match(warned.correction, /请按目标重述/);
  assert.equal((await store.get(ticket.id)).status, 'doing');
  assert.equal((await store.get(ticket.id)).acked, false);
  const { store: store2, ticket: ticket2 } = await setup();
  const good = await acceptTicket({
    store: store2, ticketId: ticket2.id, restatement: '整理调研结果 列出来源 说明结论'
  });
  assert.equal(good.ok, true);
  assert.equal(good.warning, false);
  assert.equal((await store2.get(ticket2.id)).status, 'doing');
  assert.equal((await store2.get(ticket2.id)).acked, true);
});

test('验收者自己验自己被拒', () => {
  const ticket = {
    ...input, status: 'review', verifier: 'm-research', checklist: input.checklist.map(text => ({ text }))
  };
  assert.equal(validateVerdicts({
    ticket, verifier: 'm-research', verdicts: passed
  }).ok, false);
});

test('空、空白和占位证据被拒且状态不变', async () => {
  for (const evidence of [
    '', '   ', '无', '没有', '-', '—', 'n/a', 'N/A', '无证据', '略', '同上', '见上',
    'ok', '好的', '通过', 'done', '看过了没问题', '已检查过内容完整'
  ]) {
    const { store, ticket } = await setup();
    await ready(store, ticket);
    const before = await store.get(ticket.id);
    const x = await submitVerification({
      store, group, ticketId: ticket.id, verifier: 'm-copy', verdicts: [
        {
          ...passed[0], evidence
        }, passed[1]
      ]
    });
    assert.equal(x.ok, false, evidence);
    assert.deepEqual(await store.get(ticket.id), before);
  }
});

test('漏验、错误验收者与失败缺理由被拒', async () => {
  const { store, ticket } = await setup();
  await ready(store, ticket);
  const t = await store.get(ticket.id);
  assert.equal(validateVerdicts({
    ticket: t, verifier: 'm-copy', verdicts: [passed[0]]
  }).ok, false);
  assert.equal(validateVerdicts({
    ticket: t, verifier: 'm-image', verdicts: passed
  }).ok, false);
  assert.equal(validateVerdicts({
    ticket: t, verifier: 'm-copy', verdicts: [
      {
        ...passed[0], verdict: 'fail'
      }, passed[1]
    ]
  }).ok, false);
});

test('两次退回后等待主人，不允许再次提交', async () => {
  const { store, ticket } = await setup();
  await ready(store, ticket);
  const verdicts = [
    {
      ...passed[0], verdict: 'fail', reason: '来源错误'
    }, passed[1]
  ];
  let x = await submitVerification({
    store, group, ticketId: ticket.id, verifier: 'm-copy', verdicts
  });
  assert.equal(x.status, 'rework');
  assert.match((await store.get(ticket.id)).verdicts[0].reason, /〔异议〕/);
  await submitForReview({
    store, ticketId: ticket.id, by: 'm-research'
  });
  x = await submitVerification({
    store, group, ticketId: ticket.id, verifier: 'm-copy', verdicts
  });
  assert.equal(x.status, 'wait_owner');
  assert.equal(x.ownerNotice, 'stuck');
  assert.equal(x.rejections, 2);
  await assert.rejects(submitForReview({
    store, ticketId: ticket.id, by: 'm-research'
  }));
});

test('里程碑产生复核工单，缺复核者或复核者是执行者时提示主人', async () => {
  for (const reviewer of [
    'm-external', undefined, 'm-research'
  ]) {
    const g = {
      ...group, reviewer
    };
    const { store, ticket } = await setup({ milestone: true });
    await ready(store, ticket);
    const x = await submitVerification({
      store, group: g, ticketId: ticket.id, verifier: 'm-copy', verdicts: passed
    });
    if (reviewer === 'm-external') {
      assert.equal(x.ownerNotice, 'milestone');
      assert.equal(x.followUps[0].parentId, ticket.id);
      assert.equal(x.followUps[0].checklist.length, 3);
    } else {
      assert.equal(x.ownerNotice, 'needsOwner');
      assert.equal(x.followUps.length, 0);
    }
  }
  assert.equal(makeReviewTicket({
    ticket: {
      ...input, id: 'a'
    }, group: {
      ...group, reviewer: 'm-research'
    }
  }), null);
});

test('主人通知策略全表', () => {
  for (const e of [
    'plan_ready', 'needs_approval', 'stuck'
  ]) {
    assert.deepEqual(ownerNoticePolicy(e), {
      notify: true, level: 'ask'
    });
  }
  for (const e of [
    'milestone', 'finished'
  ]) {
    assert.deepEqual(ownerNoticePolicy(e), {
      notify: true, level: 'inform'
    });
  }
  for (const e of [
    'progress', 'unknown'
  ]) {
    assert.deepEqual(ownerNoticePolicy(e), {
      notify: false, level: 'silent'
    });
  }
});

test('四人流水交单、逐项验收与里程碑', async () => {
  const store = makeStore();
  for (const assignee of group.pipeline) {
    const ticket = await assignTicket({
      store, group, input: {
        ...input, assignee, milestone: assignee === 'm-exec'
      }
    });
    await ready(store, ticket);
    const x = await submitVerification({
      store, group, ticketId: ticket.id, verifier: ticket.verifier, verdicts: passed
    });
    assert.equal(x.status, 'done');
    if (assignee === 'm-exec') {
      assert.equal(x.ownerNotice, 'milestone');
      assert.equal(x.followUps[0].assignee, 'm-external');
    }
  }
});

test('里程碑复核单：没有合格验收者时转主人，验收者避开做的人、复核者、原验收者', () => {
  const g = {
    ...group, host: 'm-copy', members: [{ id: 'm-copy' }, { id: 'm-research' }], reviewer: 'm-external',
  };
  const t = { ...input, id: 'a', groupId: 'g', verifier: 'm-copy' };
  const r = makeReviewTicket({ ticket: t, group: g });
  assert.equal(r.needsOwner, true);
  const ok = makeReviewTicket({ ticket: { ...t, verifier: 'm-exec' }, group: group });
  assert.ok(![ok.assignee, 'm-research', 'm-exec'].includes(ok.verifier));
});
