// GET /settings/  PUT /settings/permission  PUT /settings/bots/<助理号>
// 改档位不认请求头里自称的设备名。要服务端传入的主人设备判定；没有或没通过就拒绝。
// 读档位不走这道门。助理工具、组消息、工单正文都进不了这个写入口。
import { MODES } from '../../../hub-plugin/permission-mode.mjs';
import { readSettings, saveMode, saveBudget, MODEL_BLOCK, BUDGET_CURRENCIES } from '../settings.mjs';

const BOT = /^[a-z][a-z0-9-]{1,23}$/u;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function ownerWrite(deps, req) {
  return typeof deps.isOwnerDevice === 'function' && deps.isOwnerDevice(req) === true;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > 4096) return { error: 'too-large' };
    chunks.push(data);
  }
  if (size === 0) return { error: 'invalid' };
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'invalid' };
    return { value };
  } catch {
    return { error: 'invalid' };
  }
}

function onlyKeys(value, keys) {
  return Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key));
}

export function createHandler(deps) {
  return async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return false;
    }
    if (url.pathname !== '/settings' && !url.pathname.startsWith('/settings/')) return false;
    if (typeof deps.isTrusted !== 'function' || deps.isTrusted(req) !== true) {
      send(res, 401, { ok: false, error: 'unauthorized', message: '需要密钥' });
      return true;
    }
    if (!deps.hubHome) {
      send(res, 503, { ok: false, error: 'unavailable', message: '没有运行目录' });
      return true;
    }
    const botRoute = /^\/settings\/bots\/([^/]+)$/u.exec(url.pathname);
    const permission = url.pathname === '/settings/permission';
    const budget = url.pathname === '/settings/budget';
    const read = url.pathname === '/settings' || url.pathname === '/settings/';
    const mirrorStatus = url.pathname === '/settings/board-mirror';
    const mirrorRebuild = url.pathname === '/settings/board-mirror/rebuild';
    try {
      if (mirrorStatus || mirrorRebuild) {
        if (req.method !== (mirrorRebuild ? 'POST' : 'GET')) {
          send(res, 405, { ok: false, error: 'method', message: '请求方法不支持' });
        } else if (!ownerWrite(deps, req)) {
          send(res, 403, { ok: false, error: 'forbidden', message: '任务板文件版要主人在已登录的设备上操作' });
        } else if (!deps.mirror) {
          send(res, 503, { ok: false, error: 'unavailable', message: '任务板文件版暂不可用' });
        } else {
          send(res, 200, mirrorRebuild ? await deps.mirror.rebuild() : deps.mirror.status());
        }
        return true;
      }
      if (read) {
        if (req.method !== 'GET') {
          send(res, 405, { ok: false, error: 'method', message: '请求方法不支持' });
          return true;
        }
        send(res, 200, await readSettings(deps));
        return true;
      }
      if (!permission && !botRoute && !budget) {
        send(res, 404, { ok: false, error: 'not-found', message: '路径不存在' });
        return true;
      }
      if (req.method !== 'PUT') {
        send(res, 405, { ok: false, error: 'method', message: '请求方法不支持' });
        return true;
      }
      // 组消息和工单走别的路径。没有服务端主人判定，或判定没通过，正文里写什么都不改档。
      if (!ownerWrite(deps, req)) {
        send(res, 403, { ok: false, error: 'forbidden', message: '改设置要主人在已登录的设备上操作' });
        return true;
      }
      const body = await readBody(req);
      if (body.error) {
        send(res, 400, { ok: false, error: 'invalid', message: '请求体必须是不超过 4KB 的 JSON 对象' });
        return true;
      }
      if (budget) {
        // 每月预算：{ monthly: 数字或 null（取消）, currency: 'CNY'|'USD' }
        const v = body.value;
        const keys = Object.keys(v);
        const okKeys = keys.every(key => ['monthly', 'currency'].includes(key)) && Object.hasOwn(v, 'monthly');
        const okMonthly = v.monthly === null ||
          (typeof v.monthly === 'number' && Number.isFinite(v.monthly) && v.monthly > 0 && v.monthly <= 100000000);
        const okCurrency = v.currency === undefined || BUDGET_CURRENCIES.includes(v.currency);
        if (!okKeys || !okMonthly || !okCurrency) {
          send(res, 400, { ok: false, error: 'invalid', message: '每月预算要填大于 0 的数字（或留空取消），币种只能是 CNY 或 USD' });
          return true;
        }
        send(res, 200, { ok: true, budget: saveBudget(deps.hubHome, { monthly: v.monthly, currency: v.currency }) });
        return true;
      }
      if (permission) {
        if (!onlyKeys(body.value, ['mode']) || !MODES.includes(body.value.mode)) {
          send(res, 400, { ok: false, error: 'invalid', message: '只接受 mode：open、ask 或 readonly' });
          return true;
        }
        const mode = saveMode(deps.hubHome, body.value.mode);
        send(res, 200, { ok: true, permission: { mode } });
        return true;
      }
      let botId;
      try {
        botId = decodeURIComponent(botRoute[1]);
      } catch {
        botId = '';
      }
      if (!BOT.test(botId)) {
        send(res, 400, { ok: false, error: 'invalid', message: '助理号不正确' });
        return true;
      }
      if (typeof deps.roster?.get === 'function' && !deps.roster.get(botId)) {
        send(res, 404, { ok: false, error: 'not-found', message: '找不到这个助理' });
        return true;
      }
      if (!onlyKeys(body.value, ['model', 'effort'])) {
        send(res, 400, { ok: false, error: 'invalid', message: '只接受 model 和 effort' });
        return true;
      }
      // 不写任何文件。内核没有按预设写回模型和思考强度的入口。
      send(res, 409, {
        ok: false,
        error: 'settings-model-readonly',
        message: MODEL_BLOCK,
        bot: botId,
      });
      return true;
    } catch {
      send(res, 500, { ok: false, error: 'internal', message: '设置处理失败' });
      return true;
    }
  };
}
