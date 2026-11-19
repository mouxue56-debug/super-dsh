// 本处理器挂在 BFF 密钥校验之后；by/from 由可信调用方填写。
// 插件按会话身份填写，网页适配层按主人填写，不由模型参数决定。
import { createGroupRuntime, GroupError } from '../group-runtime.mjs';

let cache = new WeakMap();
let current;

// 同一组依赖只创建一个运行时。
export function runtimeFor(deps) {
  if (!cache.has(deps)) {
    cache.set(deps, createGroupRuntime(deps));
  }
  return cache.get(deps);
}

// 启动共享运行时。
export function start(deps) {
  current = runtimeFor(deps);
  current.start();
  return current;
}

// 停止当前运行时并清除缓存。
export function stop() {
  current?.stop();
  current = undefined;
  cache = new WeakMap();
}

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function bad(message, status = 400) {
  return new GroupError('INVALID', message, status);
}

async function bodyOf(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= 65536) {
      chunks.push(chunk);
    }
  }
  if (size > 65536) {
    throw bad('请求体超过 64 KB', 413);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw bad('JSON 格式错误');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw bad('请求体必须是 JSON 对象');
  }
  return value;
}

// 网页适配层按登录设备重建的设备头（见 hub-web/server.mjs）；格式不对按没有算。
function ownerDevice(req) {
  const value = req.headers?.['x-hub-device'];
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value);
}

function forbidden(message) {
  return new GroupError('FORBIDDEN', message, 403);
}

function decodePart(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    throw bad('路径编码错误');
  }
}

function numberParam(query, key) {
  if (!query.has(key)) {
    return undefined;
  }
  const value = query.get(key);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw bad(`${key} 必须是非负整数`);
  }
  return Number(value);
}

// 创建只处理讨论组路径的 HTTP 处理器。
export function createHandler(deps) {
  const idempotent = new Map();
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/groups' && !url.pathname.startsWith('/groups/')) {
      return false;
    }
    try {
      if (!deps.dataDir) {
        send(res, 503, { error: { code: 'UNAVAILABLE', message: '讨论组服务未接通' } });
        return true;
      }
      const runtime = runtimeFor(deps);
      current = runtime;
      const parts = url.pathname.split('/').slice(2).filter(Boolean).map(decodePart);
      let method;
      let action;
      let status = 200;
      if (parts.length === 0) {
        method = 'GET';
        action = () => ({ groups: runtime.list() });
      } else if (parts.length === 1 && parts[0] === 'propose') {
        method = 'POST';
        status = 201;
        action = async () => runtime.propose(await bodyOf(req));
      } else if (parts.length === 1 && parts[0] === 'create') {
        // 主人直接建组（不经分工表）。只认主人登录的网页，插件那一路不行。
        method = 'POST';
        status = 201;
        action = async () => {
          if (!ownerDevice(req)) {
            throw forbidden('只有主人登录的网页能直接拉群');
          }
          return runtime.createByOwner(await bodyOf(req));
        };
      } else if (parts.length === 1 && parts[0] === 'resolve') {
        method = 'POST';
        action = async () => {
          if (ownerDevice(req)) {
            throw forbidden('主人不能代助理解析工单');
          }
          const body = await bodyOf(req);
          if (body.member === 'owner') {
            throw forbidden('插件不能以主人身份解析讨论组');
          }
          return runtime.resolve(body);
        };
      } else if (parts.length === 1) {
        method = 'GET';
        action = () => runtime.view(parts[0], {
          after: numberParam(url.searchParams, 'after'),
          limit: numberParam(url.searchParams, 'limit'),
          ...(url.searchParams.get('member') ? { member: url.searchParams.get('member') } : {}),
        });
      } else if (parts.length >= 2 && parts[1] === 'members' && (parts.length === 2 ||
        (parts.length === 3 && parts[2] === 'remove'))) {
        // 主人加人、移人。
        method = 'POST';
        action = async () => {
          if (!ownerDevice(req)) {
            throw forbidden('只有主人登录的网页能拉人或请人出组');
          }
          const body = await bodyOf(req);
          return parts.length === 2 ? runtime.addMembers(parts[0], body) : runtime.removeMember(parts[0], body);
        };
      } else if (parts.length === 2 && parts[1] === 'page') {
        method = 'GET';
        action = () => ({ page: runtime.view(parts[0]).page });
      } else if (parts.length === 2 && parts[1] === 'messages' && req.method === 'GET') {
        method = 'GET';
        action = () => ({ messages: runtime.view(parts[0], {
          after: numberParam(url.searchParams, 'after'),
          limit: numberParam(url.searchParams, 'limit'),
        }).messages });
      } else if (parts.length === 2 && ['confirm', 'messages', 'summarize'].includes(parts[1])) {
        method = 'POST';
        action = async () => {
          if (parts[1] === 'summarize') {
            return runtime.summarize(parts[0]);
          }
          const body = await bodyOf(req);
          if (parts[1] === 'messages' && ownerDevice(req)) {
            if (body.from !== undefined && body.from !== 'owner') {
              throw bad('网页只能以主人身份发言');
            }
            body.from = 'owner';
          }
          if (parts[1] === 'messages' && (typeof body.from !== 'string' || !body.from)) {
            throw bad('消息发送人不能为空');
          }
          // 主人的动作（确认分工表、以主人身份发言）只认网页适配层转来的请求：它带登录设备头；插件那一路不带。
          const fromOwner = parts[1] === 'confirm' || body.from === 'owner';
          if (fromOwner && !ownerDevice(req)) {
            throw forbidden('主人的动作只能从主人登录的网页发出');
          }
          if (parts[1] === 'confirm') {
            return runtime.confirm(parts[0], { approved: body.approved, by: 'owner' });
          }
          const key = req.headers?.['idempotency-key'] ?? body.idem;
          if (key !== undefined && (typeof key !== 'string' || !key || key.length > 256)) {
            throw bad('幂等键格式错误');
          }
          const post = () => runtime.post(parts[0], { from: body.from, text: body.text, toolCalls: body.toolCalls });
          if (key === undefined) {
            return post();
          }
          const now = Date.now();
          for (const [id, entry] of idempotent) {
            if (entry.expires <= now) {
              idempotent.delete(id);
            }
          }
          const id = JSON.stringify([parts[0], key]);
          if (idempotent.has(id)) {
            return idempotent.get(id).result;
          }
          const result = post();
          idempotent.set(id, { expires: now + 600000, result });
          try {
            return await result;
          } catch (error) {
            idempotent.delete(id);
            throw error;
          }
        };
      } else if (parts.length === 4 && parts[1] === 'tickets' &&
        ['accept', 'submit', 'verify'].includes(parts[3])) {
        method = 'POST';
        action = async () => {
          if (ownerDevice(req)) {
            throw forbidden('主人不能代助理处理工单');
          }
          if (!/^[A-Z][0-9]{1,6}$/u.test(parts[2])) {
            throw bad('工单编号格式错误');
          }
          const body = await bodyOf(req);
          if (body.by === 'owner') {
            throw forbidden('插件不能以主人身份处理工单');
          }
          return runtime[parts[3]](parts[0], parts[2], body);
        };
      }
      if (!action) {
        send(res, 404, { error: { code: 'NOT_FOUND', message: '路径不存在' } });
      } else if (req.method !== method) {
        send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' } });
      } else {
        const result = await action();
        const rejected = result?.ok === false && ['messages', 'verify'].includes(parts.at(-1));
        send(res, rejected ? 422 : status, result);
      }
    } catch (error) {
      const known = error instanceof GroupError;
      const value = known ? { code: error.code, message: error.message } : {
        code: 'INTERNAL',
        message: '讨论组内部错误',
      };
      send(res, known ? error.status : 500, { error: value });
    }
    return true;
  };
}
