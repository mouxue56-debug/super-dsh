import { createBoardHandler } from '../board-http.mjs';
import { BoardError } from '../board-errors.mjs';
import { ID_PATTERN } from '../ticket.mjs';
import { listTokenNames } from '../board-tokens.mjs';
import { OWNER_NAME } from '../relay-model.mjs';
import { externalNames } from '../handoff.mjs';
import { arrangementRecheck, arrangementVersion } from '../arrange-model.mjs';

const OWNER = Object.freeze({ name: 'owner', type: 'owner' });
const MAX_BODY = 16384;

// 读主人网页层转来的请求体（小 JSON）。
async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new BoardError('TOO_LARGE', 'Too large');
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new BoardError('INVALID', 'Invalid request');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BoardError('INVALID', 'Invalid request');
  }
  return value;
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

// 配了 board.externals：候选人只认这份名单，从名单拿掉的人即使令牌还在也不能再被选上。
// 没配名单：仍按已发令牌的名字，和原来一样。
async function externalSet(deps) {
  const board = deps.hubConfig?.board;
  if (Array.isArray(board?.externals)) return new Set(externalNames(board));
  const fromTokens = deps.configDir ? (await listTokenNames(deps.configDir)).map(t => t.name) : [];
  return new Set(fromTokens);
}

// 把界面传来的「谁」解析成 {name,type}：名册里在用的助理、外部名单里的名字、或「主人」。
async function resolveWho(deps, rawWho, cache) {
  const bad = () => new BoardError('INVALID', 'Invalid request');
  const id = typeof rawWho === 'string' ? rawWho : rawWho?.id;
  if (typeof id !== 'string' || !id) throw bad();
  const rows = deps.roster?.list?.() ?? [];
  const active = new Set(rows.filter(b => b && b.id && b.status === 'active').map(b => b.id));
  if (id === OWNER_NAME || rawWho?.type === 'owner') return { name: OWNER_NAME, type: 'owner' };
  if (active.has(id)) return { name: id, type: 'assistant' };
  cache.externals ??= await externalSet(deps);
  if (cache.externals.has(id)) return { name: id, type: 'external' };
  throw bad();
}

// 把界面传来的接力路线里的「谁」解析好。
async function resolveRoute(deps, body) {
  const raw = body?.steps;
  if (!Array.isArray(raw)) throw new BoardError('INVALID', 'Invalid request');
  const cache = {};
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new BoardError('INVALID', 'Invalid request');
    const who = await resolveWho(deps, item.who, cache);
    const step = { who, task: item.task, doneWhen: item.doneWhen ?? item.done_when, gate: item.gate === true };
    if (item.aside === true) step.aside = true;
    out.push(step);
  }
  return out;
}

// 解析界面传来的「什么时候做」：once 带绝对时刻（须在未来）；daily / weekly 带 HH:MM（按服务器所在时区）。
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/u;
function parseSchedule(raw, nowMs) {
  const bad = () => new BoardError('INVALID', 'Invalid request');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad();
  const out = { kind: raw.kind };
  if (raw.kind === 'once') {
    const ms = Date.parse(String(raw.at ?? ''));
    if (!Number.isFinite(ms) || ms <= nowMs || ms > nowMs + 366 * 86400000) throw bad();
    out.at = new Date(ms).toISOString();
  } else if (raw.kind === 'daily' || raw.kind === 'weekly') {
    if (!CLOCK.test(String(raw.time ?? ''))) throw bad();
    out.time = raw.time;
    if (raw.kind === 'weekly') {
      const days = Array.isArray(raw.days) ? [...new Set(raw.days)].sort() : [];
      if (!days.length || !days.every(d => Number.isInteger(d) && d >= 1 && d <= 7)) throw bad();
      out.days = days;
    }
  } else throw bad();
  if (raw.tier !== undefined && raw.tier !== null && raw.tier !== '') {
    if (!['simple', 'complex', 'image'].includes(raw.tier)) throw bad();
    out.tier = raw.tier;
  }
  return out;
}

// 界面传来的人：只认内部助理或外部身份（定时、换人用）。
async function resolveDoer(deps, raw) {
  const who = await resolveWho(deps, raw, {});
  if (who.type === 'owner') throw new BoardError('INVALID', 'Invalid request');
  return who;
}

// 看板扩展：外部令牌鉴权；可信适配层（主人）可读全部，并能挪列、换负责人、改标题说明、新建（POST /board/tickets/new）、删掉（软删除，搬进 archive/）。
export function createHandler(deps) {
  const pendingRechecks = new Map();
  async function decide(request, id, decision, names) {
    const current = await deps.board.get(id);
    if (current.arrange?.state !== 'proposed' || current.state !== 'waiting-human') {
      throw new BoardError('CONFLICT', 'Nothing to decide');
    }
    const risk = arrangementRecheck(current, decision);
    if (!risk) return {ticket: await deps.board.arrangeDecide(OWNER, id, decision, {names})};
    if (deps.isOwnerDevice?.(request) !== true) throw new BoardError('FORBIDDEN', '请从主人设备确认');
    if (typeof deps.cards?.open !== 'function') throw new BoardError('CONFLICT', '确认卡暂未接通，请稍后再试');
    const expectedVersion = arrangementVersion(current);
    const key = JSON.stringify([id, decision, expectedVersion]);
    if (!pendingRechecks.has(key)) {
      const opened = deps.cards.open({title: '再确认一次这项安排',
        text: '你已同意首席的建议。请核对下面的具体对象和数量，再决定是否开始。',
        kind: 'board-arrange', sessionId: current.sessions?.from ?? '', confirmationTotal: 1,
        ...risk, choices: [{id: 'yes', label: '核对过，开始'}, {id: 'no', label: '先不做'}]});
      pendingRechecks.set(key, opened);
      void opened.then(({result}) => result).then(async answer => {
        if (answer.status !== 'answered' || answer.choice !== 'yes' || !answer.device) return;
        await deps.board.arrangeDecide(OWNER, id, decision, {names, expectedVersion});
      }).catch(() => deps.notify?.({source: 'board', kind: 'arrange-changed', ticket: id,
        text: '这张卡在确认期间有变化，请重新查看首席建议。'}))
        .finally(() => pendingRechecks.delete(key));
    }
    const {card} = await pendingRechecks.get(key);
    return {ticket: {...current, awaitingConfirmation: true}, awaitingConfirmation: true, card};
  }
  // 外部令牌：只读令牌只看与自己有关的单（readAll 关）；令牌名不许与名册助理同名。
  const reservedNames = () => ['owner', ...(deps.roster?.list?.() ?? []).flatMap(b => [b.id, b.name])];
  const bearer = deps.board && createBoardHandler({ board: deps.board, configDir: deps.configDir, readAll: false,
    reservedNames,
    allowedExternals: () => {
      const board = deps.hubConfig?.board;
      return Array.isArray(board?.externals) ? externalNames(board) : null;
    } });
  return async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== '/board' && !url.pathname.startsWith('/board/')) return false;
    if (!deps.board) {
      send(response, 503, { error: { code: 'UNAVAILABLE', message: '看板未启用' } });
      return true;
    }
    if (deps.isTrusted?.(request) !== true) return bearer(request, response);
    // 以下是网页适配层转来的主人请求：界面自己的看板页显式看全部单，也能改。
    try {
      const post = /^\/board\/tickets\/([^/]+)\/(move|assign|edit|delete|relay|answer|arrange|schedule)$/u
        .exec(url.pathname);
      if (request.method === 'POST' && (url.pathname === '/board/tickets/new' || post)) {
        const body = await readJson(request);
        if (deps.enforceOwnerProof && deps.isOwnerDevice?.(request)!==true) {
          throw new BoardError('FORBIDDEN', '请从主人设备操作看板');
        }
        if (!post && body.relay !== undefined) {
          // 新建一条接力（路线里每一棒谁接、做什么、交棒标准、要不要主人看一眼）。
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          if (!title) throw new BoardError('INVALID', 'Invalid request');
          const goal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : title;
          const steps = await resolveRoute(deps, body.relay);
          const { ticket } = await deps.board.relayCreate(OWNER, { title, goal, steps });
          send(response, 201, { ticket });
          return true;
        }
        if (!post) {
          const title = typeof body.title === 'string' ? body.title.trim() : '';
          const to = body.to === undefined || body.to === null || body.to === '' ? [] : [body.to];
          const goal = typeof body.goal === 'string' && body.goal.trim() ? body.goal.trim() : title;
          // 「交给首席安排」与「什么时候做」。
          const arrange = body.arrange === true;
          const nowMs = deps.now?.() ?? Date.now();
          const raw = body.schedule;
          const when = raw === undefined || raw === null ? null : parseSchedule(raw, nowMs);
          if ((arrange || when) && (body.open === true || (body.column && body.column !== 'queued') ||
            (arrange && to.length))) throw new BoardError('INVALID', 'Invalid request');
          if (arrange || when) {
            let made;
            if (arrange) {
              made = await deps.board.arrangeCreate(OWNER, { title, goal, ...(when ? { schedule: when } : {}) });
            }
            else {
              const assignee = to.length ? await resolveDoer(deps, to[0]) : null;
              made = await deps.board.scheduleCreate(OWNER, { title, goal, schedule: when, assignee });
            }
            send(response, 201, { ticket: made });
            return true;
          }
          // 负责人选了「谁有空谁接」：挂成开放认领（卡仍在「待领」），不指定任何人。
          const open = body.open === true;
          if (open && (to.length || (body.column && body.column !== 'queued'))) {
            throw new BoardError('INVALID', 'Invalid request');
          }
          let ticket = open ? await deps.board.openCreate(OWNER, { title, goal })
            : await deps.board.create(OWNER, { title, goal, to });
          if (body.column && body.column !== 'queued') {
            ticket = await deps.board.ownerMove(OWNER, ticket.id, body.column);
          }
          send(response, 201, { ticket });
          if (to.length === 1) void deps.handoffWake?.assigned(ticket.id, to[0]);
          return true;
        }
        let id;
        try {
          id = decodeURIComponent(post[1]);
        } catch {
          throw new BoardError('INVALID', 'Invalid request');
        }
        if (!ID_PATTERN.test(id)) throw new BoardError('INVALID', 'Invalid request');
        let ticket;
        let before = null;
        if (post[2] === 'assign') before = await deps.board.get(id).catch(() => null);
        if (post[2] === 'relay') {
          // 主人对接力卡的动作：放行、退回重做、回答卡住的问题、改后面几棒。
          const action = body.action;
          const text = typeof body.text === 'string' ? body.text : '';
          if (action === 'release') ticket = await deps.board.relayRelease(OWNER, id, { note: text });
          else if (action === 'redo') ticket = await deps.board.relayRelease(OWNER, id, { redo: true, note: text });
          else if (action === 'answer') ticket = await deps.board.answer(OWNER, id, text);
          else if (action === 'reroute') {
            ticket = await deps.board.relayReroute(OWNER, id, await resolveRoute(deps, body));
          }
          else if (action === 'reassign') {
            ticket = await deps.board.relayReassign(OWNER, id, await resolveWho(deps, body.who, {}));
          } else if (action === 'rewake') ticket = await deps.board.relayNudge(OWNER, id);
          else throw new BoardError('INVALID', 'Invalid request');
          send(response, 200, { ticket });
          return true;
        }
        if (post[2] === 'arrange') {
          // 主人对「交给首席安排」的操作：交给首席（ask）、就这么办（ok）、换个人（swap）、先不做（skip）。
          const action = body.action;
          const names = Object.fromEntries((deps.roster?.list?.() ?? []).map(b => [b.id, b.name ?? b.id]));
          if (action === 'ask') ticket = await deps.board.arrangeAsk(OWNER, id, 'button');
          else if (action === 'ok' || action === 'skip') {
            const result = await decide(request, id, {action}, names);
            send(response, result.awaitingConfirmation ? 202 : 200, result);
            return true;
          } else if (action === 'swap') {
            const who = await resolveDoer(deps, body.who);
            const result = await decide(request, id, {action, who}, names);
            send(response, result.awaitingConfirmation ? 202 : 200, result);
            return true;
          } else throw new BoardError('INVALID', 'Invalid request');
          send(response, 200, { ticket });
          return true;
        }
        if (post[2] === 'schedule') {
          // 给一张卡设「什么时候做」、取消、暂停或恢复（重复的定时模板）。
          const action = body.action;
          if (action === 'set') {
            const when = parseSchedule(body.schedule, deps.now?.() ?? Date.now());
            const assignee = body.assignee === undefined || body.assignee === null || body.assignee === ''
              ? null : await resolveDoer(deps, body.assignee);
            ticket = await deps.board.scheduleSet(OWNER, id, when, assignee);
          } else if (action === 'clear') ticket = await deps.board.scheduleClear(OWNER, id);
          else if (action === 'pause' || action === 'resume') {
            ticket = await deps.board.schedulePause(OWNER, id, action === 'pause');
          }
          else throw new BoardError('INVALID', 'Invalid request');
          send(response, 200, { ticket });
          return true;
        }
        if (post[2] === 'answer') {
          // 主人回答首席转来的问题（开放认领的卡回到「谁有空谁接」，再叫首席）。
          ticket = await deps.board.answer(OWNER, id, typeof body.text === 'string' ? body.text : '');
        } else if (post[2] === 'assign' && body.open === true) ticket = await deps.board.ownerOpen(OWNER, id);
        else if (post[2] === 'move') ticket = await deps.board.ownerMove(OWNER, id, body.column);
        else if (post[2] === 'delete') ticket = await deps.board.ownerArchive(OWNER, id);
        else if (post[2] === 'assign') {
          ticket = await deps.board.ownerAssign(OWNER, id, body.assignee ?? null, body.assigneeType);
        } else ticket = await deps.board.ownerEdit(OWNER, id, { title: body.title, goal: body.goal });
        send(response, 200, { ticket });
        // 派给内部助理：负责人真变了才叫醒那位助理（固定话，只有单号）；换成外部、主人自己或清空不叫。
        const who = post[2] === 'assign' ? body.assignee : null;
        if (typeof who === 'string' && who && body.assigneeType !== 'external' && body.assigneeType !== 'owner' &&
          !(before?.to ?? []).includes(who)) void deps.handoffWake?.assigned(ticket.id, who);
      } else if (request.method !== 'GET') {
        send(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } },
          { Allow: 'GET' });
      } else if (url.pathname === '/board/people') {
        const assistants = (deps.roster?.list?.() ?? []).filter(b => b && b.id && b.status === 'active')
          .map(b => ({ id: b.id, name: b.name ?? b.id, type: 'assistant' }));
        const external = [...await externalSet(deps)].map(name => ({ id: name, name, type: 'external' }));
        send(response, 200, { people: [...assistants, ...external] });
      } else if (url.pathname === '/board/whoami') {
        send(response, 200, { name: 'owner', type: 'owner', scope: 'read' });
      } else if (url.pathname === '/board/tickets') {
        const filters = {};
        if (url.searchParams.has('state') || url.searchParams.has('status')) {
          filters.state = url.searchParams.get(url.searchParams.has('state') ? 'state' : 'status');
        }
        for (const key of ['assignee', 'creator']) {
          if (url.searchParams.has(key)) filters[key] = url.searchParams.get(key);
        }
        if (url.searchParams.has('inbox')) filters.inboxFor = url.searchParams.get('inbox');
        if (url.searchParams.get('attention') === '1') filters.attention = true;
        send(response, 200, { tickets: await deps.board.list(filters) });
      } else {
        const match = /^\/board\/tickets\/([^/]+)$/u.exec(url.pathname);
        if (!match) {
          send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
          return true;
        }
        let id;
        try {
          id = decodeURIComponent(match[1]);
        } catch {
          throw new BoardError('INVALID', 'Invalid request');
        }
        if (!ID_PATTERN.test(id)) throw new BoardError('INVALID', 'Invalid request');
        send(response, 200, { ticket: await deps.board.get(id) });
      }
    } catch (error) {
      const known = error instanceof BoardError;
      const code = known ? error.code : 'INTERNAL_ERROR';
      const message = known ? error.message : 'Internal error';
      send(response, known ? error.httpStatus : 500, { error: { code, message } });
    }
    return true;
  };
}
