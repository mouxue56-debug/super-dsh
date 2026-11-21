import { BoardError } from './board-errors.mjs';
import { ID_PATTERN } from './ticket.mjs';
import { verifyToken, scopeAllows } from './board-tokens.mjs';
import {
  EXTERNAL_HINT_CANT_TAKE, EXTERNAL_HINT_NOT_YOURS, externalActor, externalInvolved, externalOnRoute,
  externalOpenWaiting, externalReadable,
} from './board-external.mjs';
const messages = {
  INVALID: 'Invalid request',
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'Not permitted',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  TOO_LARGE: 'Request body too large'
};
const problem = code => {
  throw new BoardError(code, messages[code]);
};

// 规则在 board-external.mjs，投文件口调用同一份。
const involved = externalInvolved;
const openWaiting = externalOpenWaiting;
const onRoute = externalOnRoute;
const readable = externalReadable;
const HINT_NOT_YOURS = EXTERNAL_HINT_NOT_YOURS;
const HINT_CANT_TAKE = EXTERNAL_HINT_CANT_TAKE;
const HINT_GATE = '这一棒等主人放行，工作令牌不能自行恢复。';
// 轮过之后只留自己那一棒，加上交给自己的上一棒交接说明。正在做、自己发起、派给自己的仍看整张。
const projectExternalTicket = (ticket, name) => {
  const steps = ticket?.relay?.steps;
  if (!Array.isArray(steps)) return ticket;
  const current = steps[ticket.relay.current];
  const doing = ticket.claimedBy === name || ticket.from?.name === name ||
    (Array.isArray(ticket.to) && ticket.to.includes(name)) ||
    (current?.who?.name === name && current?.who?.type === 'external');
  if (doing) return ticket;
  const own = [];
  steps.forEach((step, index) => {
    if (step?.who?.name === name && step.who?.type === 'external' && step.status !== 'waiting') own.push(index);
  });
  if (!own.length) return ticket;
  const copy = structuredClone(ticket);
  const handoff = new Set(own.map((index) => index - 1).filter((index) => index >= 0 && !own.includes(index)));
  copy.relay.steps = copy.relay.steps.map((step, index) => {
    if (own.includes(index)) return step;
    const keepNote = handoff.has(index);
    return {
      ...step,
      task: '',
      doneWhen: '',
      note: keepNote ? step.note : null,
      noteBy: keepNote ? step.noteBy : null,
      question: null,
      returnedNote: null,
    };
  });
  copy.history = (copy.history ?? []).map((item) => (item?.by === name ? item : { ...item, detail: undefined }));
  copy.progress = (copy.progress ?? []).filter((item) => item?.by === name);
  copy.reports = (copy.reports ?? []).filter((item) => item?.by === name);
  if (copy.report && copy.report.by !== name) copy.report = copy.reports.at(-1) ?? null;
  copy.open_ask = null;
  return copy;
};
const refuse = (code, hint) => {
  const error = new BoardError(code, messages[code]);
  error.hint = hint;
  throw error;
};

async function readBody(req, limit) {
  const length = req.headers['content-length'];
  if (length !== undefined && /^\d+$/u.test(length) && BigInt(length) > BigInt(limit)) {
    req.pause();
    problem('TOO_LARGE');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({
    destroyOnReturn: false
  })) {
    size += chunk.length;
    if (size > limit) {
      req.pause();
      problem('TOO_LARGE');
    }
    chunks.push(chunk);
  }
  if (!size) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    problem('INVALID');
  }
}
// 创建看板 HTTP 请求处理器；readAll 为 true 时只读令牌可看全部单（默认只看与自己有关的）
export function createBoardHandler({
  board,
  configDir,
  prefix = '/board',
  maxBodyBytes = 262144,
  readAll = false,
  reservedNames = () => [],
  // 显式外部名单。不传或返回 null：没配名单，仍只认令牌。返回数组：名字必须在名单里，否则令牌作废。
  allowedExternals = null
}) {
  // 令牌名与名册助理同名（签发时漏了保留名）一律不认；名册读不出时也不认。
  const reserved = (name) => {
    try {
      const names = typeof reservedNames === 'function' ? reservedNames() : reservedNames;
      return !Array.isArray(names) || names.includes(name);
    } catch {
      return true;
    }
  };
  return async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8'
      });
      res.end(JSON.stringify(data));
    };
    let url;
    try {
      url = new URL(String(req.url ?? ''), 'http://localhost');
    } catch {
      // 畸形地址（如 ///）：回 400，绝不抛出。
      send(400, {
        error: {
          code: 'INVALID',
          message: messages.INVALID
        }
      });
      return true;
    }
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) {
      return false;
    }
    try {
      const auth = /^Bearer ([^\s]+)$/iu.exec(req.headers.authorization ?? '');
      const identity = auth && (await verifyToken(configDir, auth[1]));
      if (!identity) {
        problem('UNAUTHORIZED');
      }
      if (typeof allowedExternals === 'function') {
        const allowed = allowedExternals();
        if (Array.isArray(allowed) && !allowed.includes(identity.name)) {
          problem('UNAUTHORIZED');
        }
      }
      if (reserved(identity.name)) {
        problem('FORBIDDEN');
      }
      const unrestricted = identity.scope === 'read' && readAll;
      const present = (ticket) => (unrestricted ? ticket : projectExternalTicket(ticket, identity.name));
      const path = url.pathname.slice(prefix.length);
      let action, id, operation;
      if (path === '/whoami') {
        action = 'whoami';
      } else if (path === '/tickets') {
        action = 'tickets';
      } else {
        const match = /^\/tickets\/([^/]+)(?:\/([^/]+))?$/u.exec(path);
        if (!match) {
          problem('NOT_FOUND');
        }
        try {
          id = decodeURIComponent(match[1]);
        } catch {
          problem('INVALID');
        }
        if (!ID_PATTERN.test(id)) {
          problem('INVALID');
        }
        operation = match[2];
        if (operation && !['claim', 'resume', 'progress', 'report', 'block', 'done', 'fail', 'handoff', 'verify',
          'accept', 'send_back', 'answer', 'timeout', 'uncertain'].includes(operation)) {
          problem('NOT_FOUND');
        }
        action = operation ? 'operation' : 'ticket';
      }
      const method = action === 'whoami' || action === 'ticket' ? 'GET' : action === 'operation' ? 'POST' : null;
      if (method ? req.method !== method : !['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', method ?? 'GET, POST');
        send(405, {
          error: {
            code: 'METHOD_NOT_ALLOWED',
            message: 'Method not allowed'
          }
        });
        return true;
      }
      const permission = action === 'operation' ? ['accept', 'send_back', 'answer'].includes(operation) ?
        'create' : 'work' : action === 'tickets' && req.method === 'POST' ? 'create' : 'read';
      if (!scopeAllows(identity.scope, permission)) {
        problem('FORBIDDEN');
      }
      // 命令通道进来的外部身份：进度和状态记录标 via=cli，界面用来画来源小标。
      const actor = externalActor(identity.name, 'cli');
      if (action === 'whoami') {
        send(200, identity);
      } else if (action === 'ticket') {
        const ticket = await board.get(id);
        // 所有外部身份（不只是只读令牌）只能读自己名下的卡，或开放认领还没人接的卡。
        if (!unrestricted && !readable(ticket, identity.name)) {
          refuse('NOT_FOUND', HINT_NOT_YOURS);
        }
        send(200, {
          ticket: present(ticket)
        });
      } else if (action === 'tickets' && req.method === 'GET') {
        const filters = {};
        if (url.searchParams.has('state') || url.searchParams.has('status')) {
          filters.state = url.searchParams.get(url.searchParams.has('state') ? 'state' : 'status');
        }
        for (const key of ['assignee', 'creator']) {
          if (url.searchParams.has(key)) {
            filters[key] = url.searchParams.get(key);
          }
        }
        if (url.searchParams.has('inbox')) {
          filters.inboxFor = url.searchParams.get('inbox');
        }
        if (url.searchParams.get('attention') === '1') {
          filters.attention = true;
        }
        // 开放认领的卡（谁有空谁接）。只有能干活的令牌（work）看得到，只读令牌不行。
        if (url.searchParams.get('open') === '1') {
          if (!scopeAllows(identity.scope, 'work')) {
            problem('FORBIDDEN');
          }
          filters.open = true;
        }
        const tickets = await board.list(filters);
        send(200, {
          tickets: (unrestricted ? tickets : tickets.filter(item => readable(item, identity.name))).map(present)
        });
      } else if (action === 'tickets') {
        const input = await readBody(req, maxBodyBytes);
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          problem('INVALID');
        }
        const {
          ticket,
          deduped
        } = await board.createWithMeta(actor, input);
        send(deduped ? 200 : 201, {
          ticket: present(ticket)
        });
      } else {
        const body = await readBody(req, maxBodyBytes);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          problem('INVALID');
        }
        let ticket;
        // 除领单外，每个动作都先核对这张卡是不是它名下的，不靠「知道单号」。
        if (operation !== 'claim') {
          const target = await board.get(id);
          if (!involved(target, identity.name)) {
            refuse('FORBIDDEN', HINT_NOT_YOURS);
          }
          if (target.relay?.phase === 'gate' && operation === 'resume') {
            refuse('FORBIDDEN', HINT_GATE);
          }
        }
        switch (operation) {
          case 'claim':
            try {
              ticket = await board.claim(actor, id);
            } catch (claimError) {
              // 开放认领的卡已被别人接走：告诉后来的人是谁（只给名字和方式）。
              if (claimError instanceof BoardError && claimError.code === 'FORBIDDEN') {
                claimError.hint = HINT_CANT_TAKE;
              }
              if (claimError instanceof BoardError && claimError.code === 'CONFLICT') {
                const now = await board.get(id).catch(() => null);
                const taken = now?.openClaim?.state === 'taken' ? now.openClaim : null;
                if (taken && taken.takenBy !== identity.name) {
                  claimError.taken = { by: taken.takenBy, shown: taken.takenShown ?? taken.takenBy, via: taken.via ?? null };
                }
              }
              throw claimError;
            }
            break;
          case 'resume':
          case 'done':
          case 'accept':
            ticket = await board[operation](actor, id);
            break;
          case 'progress':
            ticket = await board.progress(actor, id, body.text);
            break;
          case 'report':
            ticket = await board.report(actor, id, {
              summary: body.summary,
              file: body.file,
              sha256: body.sha256,
              artifacts: body.artifacts
            });
            break;
          case 'block':
            ticket = await board.block(actor, id, body.reason, {
              waitHuman: body.waitHuman
            });
            break;
          case 'send_back':
            ticket = await board.sendBack(actor, id, body.note);
            break;
          case 'answer':
            ticket = await board.answer(actor, id, body.text);
            break;
          case 'timeout':
            ticket = await board.markTimeout(actor, id);
            break;
          case 'uncertain':
            ticket = await board.markUncertain(actor, id, body.note);
            break;
          case 'fail':
            ticket = await board.fail(actor, id, body.reason);
            break;
          case 'handoff':
            ticket = await board.handoff(actor, id, body.to);
            break;
          case 'verify': {
            // 外部身份只验自己派出去的单；别人的单它没有立场下「核验通过」。
            const own = await board.get(id);
            if (own.from?.type !== 'external' || own.from?.name !== identity.name) {
              problem('FORBIDDEN');
            }
            ticket = await board.verify(actor, id, {
              verdict: body.verdict,
              note: body.note
            });
            break;
          }
        }
        send(200, {
          ticket: present(ticket)
        });
      }
    } catch (error) {
      const known = error instanceof BoardError && Object.hasOwn(messages, error.code);
      const code = known ? error.code : 'INTERNAL_ERROR';
      if (code === 'TOO_LARGE') {
        req.pause();
        res.setHeader('Connection', 'close');
      }
      send(known ? error.httpStatus : 500, {
        error: {
          code,
          message: messages[code] ?? 'Internal error',
          ...(known && error.taken ? { taken: error.taken } : {}),
          ...(known && error.hint ? { hint: error.hint } : {})
        }
      });
    }
    return true;
  };
}
