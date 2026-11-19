import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pickForKb } from '../lib/meeting.mjs';
import { submit } from '../lib/kb-contribute.mjs';
import { createHandler, createMeetingService } from '../lib/ext/meetings.mjs';

const base = path.resolve('test/.tmp');
const date = '2026-01-02';
const cfg = { projectMap: { default: 'p' } };

// 构造一条带出处的会议条目。
function picked(text, original) {
  const entry = { assistantId: 'a', assistantName: '甲', category: 'decision', text: '摘录',
    ownerQuote: { text, source: '出处' } };
  return pickForKb({ type: 'evening', date, entries: [entry] }, cfg, { resolveSource: () => original }).drafts[0];
}

// 模拟扩展层的请求和响应。
async function request(handler, id, headers, body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.url = `/meetings/cards/${id}/approve`;
  req.headers = headers;
  const res = { writeHead(status) { this.status = status; }, end(value) { this.value = JSON.parse(value); } };
  await handler(req, res);
  return res;
}

test('原话必须等于完整消息或完整句子', () => {
  assert.equal(picked('把生产库删掉', '不要把生产库删掉').quoteDowngraded, true);
  assert.ok(picked('保留完整记录', '先检查。保留完整记录！再复核').verifiedQuote);
  assert.ok(picked('保留完整记录！', '先检查。保留完整记录！再复核').verifiedQuote);
  assert.ok(picked('整条 消息', '整条  消息').verifiedQuote);
});

test('放权后逐字原话仍出卡并披露数量', async () => {
  const dir = fs.mkdtempSync(path.join(base, 'seam-'));
  const draft = picked('保留完整记录', '保留完整记录');
  const grantsFile = path.join(dir, 'grants');
  fs.writeFileSync(grantsFile, JSON.stringify({ grants: [{ key: 'p/decision' }] }));
  const options = { kbAgentPath: process.execPath, workDir: dir, pendingDir: path.join(dir, 'pending'),
    contributor: 'tester', grantsFile, approval: 'card' };
  const result = await submit(draft, options, { execFile() { throw new Error('unexpected'); } });
  assert.equal(result.state, 'card');
  assert.equal(result.card.ownerQuoteCount, 1);
  assert.equal(result.card.bodyLength, draft.body.length);
});

test('批准必须有合法设备头且不信请求体里的批准人', async () => {
  const dir = fs.mkdtempSync(path.join(base, 'seam-'));
  const seen = [];
  const deps = { dataDir: dir, configDir: dir, now: () => Date.parse(date + 'T18:00:00Z'),
    roster: [{ id: 'a', name: '甲', role: 'assistant' }],
    hubConfig: { meetings: { utcOffsetMinutes: 0, kb: { kbAgentPath: process.execPath } } },
    sessions: { create: async () => 's', send: async () => '经验内容' },
    kbExecFile: (file, args, opts, cb) => {
      seen.push(args);
      const value = args.includes('record') ? { state: 'queued', id: 'receipt' } :
        { event: 'receipt', state: 'pushed', commit: 'a'.repeat(40) };
      cb(null, JSON.stringify(value));
    } };
  const service = createMeetingService(deps);
  const result = await service.run({ type: 'evening', date });
  const id = result.cards[0].draftId;
  const handler = createHandler(deps);
  assert.equal((await request(handler, id, {}, { always: true, by: 'spoof' })).status, 403);
  assert.equal((await request(handler, id, { 'x-hub-device': 'bad value' }, { always: true })).status, 403);
  assert.equal(seen.length, 0);
  const accepted = await request(handler, id, { 'x-hub-device': 'device-token' }, { always: true, by: 'spoof' });
  assert.equal(accepted.value.state, 'delivered');
  const grants = JSON.parse(fs.readFileSync(path.join(dir, 'kb-contribute-grants.json'), 'utf8'));
  assert.equal(grants.grants[0].by, 'device-token');
});

test('会议遇到已放权的逐字原话仍出卡，回执无设备不能批准', async () => {
  const dir = fs.mkdtempSync(path.join(base, 'seam-'));
  const rules = path.join(dir, 'rules', 'a');
  fs.mkdirSync(rules, { recursive: true });
  fs.writeFileSync(path.join(rules, '规矩.md'), `- ${date} 「保留完整记录」\n`);
  fs.writeFileSync(path.join(dir, 'kb-contribute-grants.json'), JSON.stringify({ grants: [{ key: 'p/decision' }] }));
  const cards = [];
  const calls = [];
  const deps = { dataDir: dir, configDir: dir, now: () => Date.parse(date + 'T18:00:00Z'),
    roster: [{ id: 'a', name: '甲', role: 'assistant' }],
    hubConfig: { meetings: { utcOffsetMinutes: 0, rulesDir: path.join(dir, 'rules'),
      projectMap: { default: 'p' }, kb: { kbAgentPath: process.execPath } } },
    resolveOwnerSource: () => '保留完整记录',
    cards: { ask: async card => {
      cards.push(card);
      return { decision: 'approve-always', by: 'spoof' };
    } },
    kbExecFile: (...args) => {
      calls.push(args);
    } };
  const service = createMeetingService(deps);
  const result = await service.run({ type: 'evening', date });
  await service.idle();
  assert.equal(result.cards.length, 1);
  assert.equal(result.submitted.length, 0);
  assert.match(cards[0].why, /含主人原话 1 条/);
  assert.equal(calls.length, 0);
});
