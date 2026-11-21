// 外包派工的助理工具。
// dispatch_prepare：建一张给外部工人的工单（派给谁、什么模型由助理按主人口述的规则填，代码不替它选）。
// dispatch_external：把这张工单交给外部工人。三道闸都在后端那一侧；这里只递材料、翻译结果。
// 注意：不能 import ./index.mjs（加载器顶层 await 正在导入本文件，会互等）。
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// 级别写 L1：确认卡由后端出（能放下任务书全文），不走内核那张只有 200 字预览的卡。
export const levels = Object.freeze({
  dispatch_prepare: 'L1',
  dispatch_external: 'L1',
});

const KEY = /^[A-Za-z0-9_.:-]{1,128}$/u;
const NAME = /^[a-z][a-z0-9_-]{0,31}$/u;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const TICKET = /^T-\d{8}-\d{6}-[a-zA-Z0-9]{4}$/u;

// 读一个本用户 0600 的小密钥文件；内容只返回给调用方，不进日志、不进错误信息。
function readKeyFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || (st.mode & 0o777) !== 0o600 || st.size > 16384 ||
      process.getuid && st.uid !== process.getuid()) {
      throw Error('权限不对');
    }
    const value = fs.readFileSync(fd, 'utf8').trim();
    if (!value || /[\r\n\0]/u.test(value)) {
      throw Error('内容无效');
    }
    return value;
  } catch {
    throw Error('BFF 密钥文件读不了');
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

// 建后端客户端：只许连本机回环；密钥每次现读、只放在请求头里。配置读 dispatch 段，没有就用 groups 段的同名键。
export function createDispatchClient(hubConfig = {}, {fetchImpl = globalThis.fetch} = {}) {
  const own = hubConfig.dispatch ?? {};
  const shared = hubConfig.groups ?? {};
  const rawUrl = own.bff_url ?? shared.bff_url;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password) {
    return undefined;
  }
  const keyFile = own.bff_key_file ?? shared.bff_key_file ??
    fileURLToPath(new URL('../../hub-bff/run/bff.key', import.meta.url));
  const call = async (method, pathname, body) => {
    const res = await fetchImpl(url.origin + pathname, {
      method,
      headers: {'x-hub-bff-key': readKeyFile(keyFile), 'content-type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      // 没有 JSON 正文
    }
    return {status: res.status, data};
  };
  return Object.freeze({
    dispatch: body => call('POST', '/dispatch/runs', body),
    run: id => call('GET', '/dispatch/runs/' + encodeURIComponent(id)),
  });
}

// 一行：去掉换行与控制字符，按字数截断。
function oneLine(value, max) {
  const chars = Array.from(String(value ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim());
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('');
}

// 后端拒绝的原因翻成助理能转述的话。
function explain(status, data) {
  const err = data?.error ?? {};
  const why = Array.isArray(err.reasons) ? err.reasons.map(r => oneLine(r.message, 80)).join('；') : '';
  const tail = why || oneLine(err.message, 120);
  if (err.code === 'TAINTED') {
    return `不能外派：${tail}。这件事只能转给主人（用 board_report 的 ask_owner 告诉他），不要换个说法再试`;
  }
  if (err.code === 'BUSY') {
    return `现在不能外派：${tail}。等那一张做完再说，不要自己换目录绕开`;
  }
  return `没有外派（${err.code ?? status}）：${tail || '后端没说原因'}`;
}

// 只允许启用且符合外派名单的助理发起。
function canDispatch(deps, bot) {
  const me = deps.roster.find(row => row.id === bot);
  const allow = deps.hubConfig?.dispatch?.allow_bots;
  const permitted = allow === undefined || allow === '*' ||
    Array.isArray(allow) && (allow.includes('*') || allow.includes(bot));
  return Boolean(me && me.status === 'active' && me.paused !== true && permitted);
}

// 注册 dispatch_prepare 与 dispatch_external。
export function register(ctx, deps) {
  const str = maxLength => ({type: 'string', maxLength});
  const actor = call => ({name: call.bot, type: 'assistant'});
  // 读没读过外部内容：认不出会话也按读过算。
  const tainted = call => {
    const st = deps.state(call.sessionId);
    return call.readExternal === true || !st || st.known === false || st.readExternal === true;
  };
  const client = () => deps.dispatchClient ?? createDispatchClient(deps.hubConfig);

  ctx.tools.register({
    name: 'dispatch_prepare',
    material: false,
    description: '主人点头要把整件交给外部工人时，才建外包工单：任务书、验收、派给谁、用哪个模型'
      + '（按主人口述的规则填；没有规则就先问主人）。不要因为活复杂就建议外派。'
      + '建好后仍要主人在确认卡点头，再用 dispatch_external 交出去。',
    parameters: {
      type: 'object',
      properties: {
        worker: str(32),
        model: str(64),
        title: str(80),
        brief: str(6000),
        acceptance: {type: 'array', items: {type: 'object'}},
        forbidden: {type: 'array', items: {type: 'string'}},
        workdir: str(1024),
        key: str(128),
      },
      required: ['worker', 'model', 'title', 'brief', 'acceptance'],
      additionalProperties: false,
    },
    async execute(args, _exec, call) {
      const me = deps.roster.find(b => b.id === call.bot);
      if (!canDispatch(deps, call.bot)) {
        throw Error('你没有外派的权限');
      }
      if (!NAME.test(args.worker) || !MODEL.test(args.model)) {
        throw Error('工人名或模型名格式不对');
      }
      const acceptance = Array.isArray(args.acceptance) ? args.acceptance : [];
      const checked = acceptance.map(a => ({
        check: String(a?.check ?? '').trim(),
        expect: String(a?.expect ?? '').trim(),
      }));
      if (!checked.length || checked.some(a => !a.check || !a.expect)) {
        throw Error('验收清单至少一条，每条写清 check（检查什么）和 expect（期望什么）');
      }
      const forbidden = (args.forbidden ?? []).map(String).filter(Boolean);
      const brief = args.brief.trim();
      if (!brief || !args.title.trim()) {
        throw Error('标题和任务书不能为空');
      }
      const auto = createHash('sha256').update([call.sessionId, args.worker, args.model, brief].join('\0'))
        .digest('hex').slice(0, 40);
      const key = args.key ?? 'ext-' + auto;
      if (!KEY.test(key)) {
        throw Error('key 只能用字母、数字和 _.:-，最长 128');
      }
      let result;
      try {
        result = await deps.board.createWithMeta(actor(call), {
          title: oneLine(args.title, 80),
          goal: brief,
          key,
          to: [args.worker],
          expects_reply: true,
          sessions: {from: call.sessionId, to: ''},
          workdir: {path: args.workdir ?? null, writable: []},
          forbidden,
          acceptance: checked,
          readExternalContent: tainted(call),
          routing: {requestedBy: me.id, via: 'dispatch_prepare', hint: '', worker: args.worker, model: args.model},
        });
      } catch (e) {
        throw Error('看板建单失败：' + oneLine(e?.message, 120));
      }
      const t = result.ticket;
      return `外包工单 ${t.id} 已建（${args.worker} / ${args.model}）。下一步用 dispatch_external 交出去；`
        + (tainted(call) ? '注意：这张单标了「读过外部内容」，后端会拒绝外派，只能转给主人。' : '');
    },
  });

  ctx.tools.register({
    name: 'dispatch_external',
    material: false,
    description: '把一张你派出的外包工单交给外部工人去做。会先给主人出一张写着任务书全文的确认卡，'
      + '主人点头才真的开工（点过「以后这类不用问」的才免问）。做完结果会作为工人的自述写回工单，由你验收。'
      + '读过外部内容的会话或工单不能外派。再调一次是查进展，不会重复开工。',
    parameters: {
      type: 'object',
      properties: {ticket: str(64)},
      required: ['ticket'],
      additionalProperties: false,
    },
    async execute(args, _exec, call) {
      if (!canDispatch(deps, call.bot)) {
        throw Error('你没有外派的权限');
      }
      if (!TICKET.test(args.ticket)) {
        throw Error('工单号格式不对');
      }
      const api = client();
      if (!api) {
        throw Error('外包派工服务没接通（配置里没有本机回环的后端地址）');
      }
      let reply;
      try {
        reply = await api.dispatch({ticket: args.ticket, bot: call.bot, sessionId: call.sessionId,
          readExternal: tainted(call)});
      } catch {
        throw Error('外包派工服务连不上，没有外派');
      }
      const {status, data} = reply;
      if (status >= 400) {
        throw Error(explain(status, data));
      }
      if (data?.status === 'awaiting_approval') {
        return `已给主人出了确认卡（卡上是任务书全文），等他点头；点了才会开工，进展会写在工单 ${args.ticket} 上。`
          + '不要重复催，也不要换个办法绕过';
      }
      if (data?.status === 'running') {
        return `工单 ${args.ticket} 已经在跑：${data.run?.worker}，运行号 ${data.run?.runId}，状态 ${data.run?.status}`;
      }
      if (data?.status === 'started') {
        return `已按放权直接开工：${data.run?.worker}，运行号 ${data.run?.runId}。结果回来会写在工单上，由你验收`;
      }
      throw Error('后端回的结果看不懂，没有当作成功');
    },
  });
}
