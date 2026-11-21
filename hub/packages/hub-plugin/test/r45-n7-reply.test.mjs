// 非本职不自动转单；主人点头才交接；询问同事后仍由原助理答复。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {register} from '../tools/bots.mjs';
import {GUIDANCE} from '../tools/self-edit.mjs';
import {boardConfig} from '../tools/index.mjs';
import {identity} from '../../hub-bff/lib/roster.mjs';
import {planOwnerTurn, boardUntouched, handoffRefusal, consultEnvelope} from '../reply-route.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function setup({askColleague} = {}) {
  const parent = path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp');
  fs.mkdirSync(parent, {recursive: true});
  const dir = fs.mkdtempSync(path.join(parent, 'n7-'));
  const tools = {};
  const rows = [];
  let created = 0;
  const roster = [
    {id: 'a', name: '甲', status: 'active', role: 'bot'},
    {id: 'b', name: '乙', status: 'active', role: 'bot'},
  ];
  const board = {
    async list() {
      return rows;
    },
    async get(id) {
      return rows.find(row => row.id === id);
    },
    async createWithMeta(_actor, input) {
      created++;
      const ticket = {...input, id: 'T-' + created, state: 'queued', from: {name: 'a'}};
      rows.push(ticket);
      return {ticket, deduped: false};
    },
  };
  const deps = {
    board,
    hubConfig: {board: {...boardConfig({hubHome: dir}), dir, maxSendPerTurn: 3}},
    roster,
    state() {
      return {readExternal: false, reserveSend() {
        return () => {};
      }};
    },
    askColleague,
  };
  register({tools: {register: tool => {
    tools[tool.name] = tool;
  }}}, deps);
  const call = {bot: 'a', sessionId: 's', turn: 1};
  return {tools, rows, created: () => created, call};
}

test('非本职也不自动建交接工单；主人点头后才交接', async () => {
  const plan = planOwnerTurn({outside: true, colleague: '乙'});
  assert.equal(plan.replyBy, 'self');
  assert.equal(plan.ticket, false);
  assert.equal(plan.consult, '乙');
  assert.equal(planOwnerTurn({outside: true, ownerAgreed: true}).handoff, true);
  assert.equal(boardUntouched('owner-relay'), true);
  assert.equal(boardUntouched('owner-open'), true);
  assert.equal(boardUntouched('external'), true);
  assert.equal(boardUntouched('chat'), false);
  const h = setup();
  await assert.rejects(() => h.tools.send_to_bot.execute(
    {to: 'b', message: '这件事不归我管'}, {}, h.call), /先问主人/);
  assert.equal(h.created(), 0);
  assert.equal(h.rows.length, 0);
  const out = await h.tools.send_to_bot.execute(
    {to: '乙', message: '主人点头后的整件', owner_ok: true}, {}, h.call);
  assert.match(out, /已转给 乙/);
  assert.equal(h.created(), 1);
});

test('询问同事不建工单，结果仍由原助理答复', async () => {
  const h = setup({askColleague: async () => '查到了三条来源'});
  const before = h.created();
  const text = await h.tools.ask_colleague.execute({to: '乙', question: '这事有来源吗'}, {}, h.call);
  assert.match(text, /没有交接工单/);
  assert.match(text, /由你（甲）答复主人/);
  assert.match(text, /查到了三条来源/);
  assert.equal(h.created(), before);
  assert.match(consultEnvelope({fromName: '甲', toName: '乙', answer: ''}), /没有交接工单/);
  assert.match(handoffRefusal('乙'), /owner_ok 须为 true/);
});

test('改自己直接改 SDS，名册「不管」仍只是说明', () => {
  assert.match(GUIDANCE, /直接改配置里的源码/);
  assert.match(GUIDANCE, /自动存还原点/);
  assert.match(GUIDANCE, /全开档直接做/);
  assert.match(GUIDANCE, /SDS/);
  assert.match(GUIDANCE, /不要说改不了/);
  assert.match(GUIDANCE, /不要因此外派/);
  assert.doesNotMatch(GUIDANCE, /超级 DSH/);
  assert.match(identity({name: '甲', duty: '写', notDuty: '发布'}), /职责：写。不管：发布/);
});

test('规矩文本不再教自动转单或改不了就外派', () => {
  const files = [
    'defaults/templates/worker.md',
    'defaults/templates/chief.md',
    'defaults/personas/chief.md',
    'defaults/personas/writer.md',
    'defaults/house-rules/AGENTS.md',
    'defaults/manuals/dispatch-work/SKILL.md',
    'packages/devinst/bots-template/chief/AGENTS.md',
    'packages/devinst/presets-r26.replace.json',
  ];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /不归我管的事,查名册转给对口同事|真做不了的，再请别的助理|需要派活时，用 delegate_to_bot|改超级 DSH/, file);
    assert.match(text, /先问|询问|点头/, file);
  }
  assert.match(read('defaults/house-rules/AGENTS.md'), /花钱、对外发送或发布、删除、上线或动线上服务/);
  assert.match(read('packages/hub-plugin/tools/claim.mjs'), /谁有空谁接/);
  assert.match(read('packages/hub-plugin/tools/arrange.mjs'), /这件事不要自己做/);
});
