import {readExposure, exposureCard, clearExposure} from '../bot-exposure.mjs';

function send(res, status, value) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(value));
}

function ownerDevice(req) {
  const value = req.headers?.['x-hub-device'];
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/u.test(value);
}

async function bodyOf(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw Error('请求体过大');
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('请求体无效');
  return body;
}

// 创建助理外部来源状态的后端入口。
export function createHandler(deps) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/exposure' && !url.pathname.startsWith('/exposure/')) return false;
    try {
      const home = deps.hubHome ?? deps.hubConfig?.hubHome;
      if (!home) throw Error('状态目录未配置');
      const parts = url.pathname.split('/').slice(2).filter(Boolean).map(decodeURIComponent);
      const rows = typeof deps.roster?.list === 'function' ? await deps.roster.list() : deps.roster?.bots ?? [];
      if (!parts.length && req.method === 'GET') {
        send(res, 200, {bots: rows.map(row => ({bot: row.id, ...readExposure(home, row.id)}))});
      } else if (parts.length === 2 && ['card', 'clear'].includes(parts[1]) && req.method === 'POST') {
        if (!ownerDevice(req)) {
          send(res, 403, {error: {code: 'FORBIDDEN', message: '仅主人设备可以解除'}});
        } else if (!rows.some(row => row.id === parts[0])) {
          send(res, 404, {error: {code: 'NOT_FOUND', message: '助理不存在'}});
        } else if (parts[1] === 'card') {
          const card = exposureCard(home, parts[0]);
          const notice = '解除后它的会话不再全部先问；它正在进行的会话里可能还留着那些外部内容，建议解除前让它新开会话';
          send(res, 200, {...card, notice});
        } else {
          const body = await bodyOf(req);
          if (body.approved !== true || typeof body.digest !== 'string') throw Error('需要确认和状态摘要');
          clearExposure(home, parts[0], {by: req.headers['x-hub-device'], digest: body.digest});
          send(res, 200, {ok: true});
        }
      } else {
        send(res, 404, {error: {code: 'NOT_FOUND', message: '路径或方法不存在'}});
      }
    } catch (error) {
      const status = error.message === '状态已变，请重新出确认卡' ? 409 :
        error.message === '这位助理没有接触外部内容的状态' ? 404 : 400;
      send(res, status, {error: {code: status === 404 ? 'NOT_FOUND' : 'INVALID', message: error.message}});
    }
    return true;
  };
}
