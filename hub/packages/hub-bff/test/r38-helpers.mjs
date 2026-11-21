// 测试共用的搭建函数（不是测试文件）。
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHandler as boardHandler } from '../lib/ext/board.mjs';
import { createBoard } from '../lib/board.mjs';
import { createTriggers, arrangeWakeText } from '../lib/triggers.mjs';
import { createHandoffWake } from '../lib/handoff-wake.mjs';
import { buildToday } from '../lib/today.mjs';

export const OWNER = { name: 'owner', type: 'owner' };
export const CHIEF = { name: 'chief', type: 'assistant' };
export const at = (h, m = 0, d = 19) => Date.UTC(2026, 10, d, h, m);

export async function call(handler, url, body, method = 'POST') {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url, method, headers: { trusted: 'yes' } });
  const res = { text: '' };
  res.setHeader = () => {};
  res.writeHead = status => { res.status = status; };
  res.end = text => { res.text += text ?? ''; };
  await handler(req, res);
  return { status: res.status, body: res.text ? JSON.parse(res.text) : null };
}

// 搭一套：看板 + 叫醒 + 触发 + HTTP 处理器；时区按 +09:00（日本），时钟在 10:00（日本 19:00 左右，白天）。
export async function fixture({ clock = at(1, 0), stopped = false, board: boardCfg = {}, chiefStatus = 'active', extra = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'r38-trigger-'));
  const configDir = join(dir, 'cfg');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const state = { stopped, clock };
  const sent = [];
  const created = [];
  const rows = [
    { id: 'chief', name: '首席助理', role: 'chief', status: chiefStatus, duty: '分派' },
    { id: 'research', name: '调研员', role: 'bot', status: 'active', duty: '查资料' },
    { id: 'content', name: '内容助理', role: 'bot', status: 'active', duty: '写文案' },
    { id: 'old', name: '旧', role: 'bot', status: 'disabled', duty: '停用了' },
  ];
  const roster = { list: () => rows, get: id => rows.find(r => r.id === id), rows };
  const sessions = {
    list: () => [],
    create: async (bot, opts) => { created.push({ bot, opts }); return { id: 's-' + created.length }; },
    send: async (id, text, opts) => {
      if (state.stopped) throw Object.assign(new Error('停了'), { code: 'PANIC_STOPPED' });
      const row = created[Number(id.slice(2)) - 1];
      sent.push({ id, bot: row?.bot, text, opts });
    },
  };
  const events = [];
  const hubConfig = { timezone: 'Asia/Tokyo', board: { externals: ['codex'], ...boardCfg } };
  let triggers;
  let handoffWake;
  const extraHooks = [];
  const board = createBoard({ root: join(dir, 'board'), now: () => state.clock, utcOffsetMinutes: () => 540,
    onEvent: ev => {
      events.push(ev);
      triggers?.onEvent(ev);
      for (const hook of extraHooks) hook(ev);
    },
    reservedNames: ['owner', 'chief', 'research', 'content', 'old'],
    isChief: (name) => {
      const bot = rows.find(r => r && (r.id === name || r.name === name));
      return !!(bot && bot.role === 'chief' && bot.status === 'active' && bot.paused !== true);
    }, ...extra });
  handoffWake = createHandoffWake({ board, roster, sessions, stateFile: join(dir, 'wake.json'),
    now: () => state.clock, utcOffsetMinutes: 540, isStopped: () => state.stopped, logger: { error() {} }, tickMs: 0 });
  triggers = createTriggers({ board, roster, sessions, handoffWake, stateFile: join(dir, 'triggers.json'),
    now: () => state.clock, utcOffsetMinutes: 540, isStopped: () => state.stopped, logger: { error() {} }, tickMs: 0,
    config: () => hubConfig.board });
  const deps = { board, configDir, roster, hubConfig, now: () => state.clock,
    isTrusted: req => req.headers.trusted === 'yes', triggers, handoffWake };
  const handler = boardHandler(deps);
  const settle = async () => { await triggers.drain(); await handoffWake.flush(); await triggers.flush(); await triggers.drain(); };
  const view = (ctx = {}) => ({ roster: rows, externals: ['codex'], names: { chief: '首席助理', research: '调研员', content: '内容助理' },
    ...ctx });
  return { dir, configDir, state, sent, created, board, roster, rows, sessions, handler, deps, events, settle, view,
    hubConfig, triggers, handoffWake, extraHooks, tick: () => triggers.tick() };
}

export const newCard = async (h, body = {}) =>
  (await call(h.handler, '/board/tickets/new', { title: '办读书会', goal: '用一句话说说最先要定什么', ...body })).body.ticket;
export const good = (extra = {}) => ({ kind: 'bot', who: 'research', when: 'now', ask_owner: false, why: '这类事归调研员管', ...extra });

