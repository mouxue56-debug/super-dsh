import { routineServiceFor, dropRoutineService } from '../routines.mjs';

let current;

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

// 读取并丢弃请求体（这些接口不需要参数），过大就拒绝。
async function drain(req) {
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.from(chunk).length;
    if (size > 4096) throw Object.assign(new Error('large'), { status: 413 });
  }
}

// 固定任务扩展：挂在密钥校验之后，只认 /routines 开头的路径。
export function createHandler(deps = {}) {
  const service = routineServiceFor(deps);
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname.replace(/\/+$/u, '');
    if (pathname !== '/routines' && !pathname.startsWith('/routines/')) return false;
    const route = pathname.slice('/routines'.length);
    const method = req.method;
    try {
      if (route === '' && method === 'GET') {
        send(res, 200, service.list());
        return true;
      }
      if (route === '/runs' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        send(res, 200, { runs: service.runs(Number.isFinite(limit) ? limit : 50) });
        return true;
      }
      if (route === '/pause' && method === 'POST') {
        await drain(req);
        send(res, 200, service.pause());
        return true;
      }
      if (route === '/resume' && method === 'POST') {
        await drain(req);
        send(res, 200, service.resume());
        return true;
      }
      const match = /^\/([a-z][a-z0-9-]{1,40})\/(run|pause|resume)$/u.exec(route);
      if (match && method === 'POST') {
        await drain(req);
        const [, id, action] = match;
        const result = action === 'run' ? await service.runNow(id) :
          action === 'pause' ? service.pause(id) : service.resume(id);
        const status = result.state === 'not-found' ? 404 : result.state === 'stopped' ? 503 : 200;
        send(res, status, result);
        return true;
      }
      const known = route === '' || route === '/runs' || route === '/pause' || route === '/resume' || match;
      send(res, known ? 405 : 404, { error: known ? 'Method not allowed' : 'Not found' });
    } catch (error) {
      const large = error?.status === 413;
      send(res, large ? 413 : 500, { error: large ? 'Body too large' : 'Internal error' });
    }
    return true;
  };
}

// 启动进程内定时（不装系统定时）。
export function start(deps = {}) {
  current = routineServiceFor(deps);
  return current.begin();
}

// 停止定时。
export function stop() {
  current?.end();
  current = undefined;
}

// 给「一键全停」用：暂停全部固定任务（状态落盘，重启后仍暂停）。
export function pauseAll(deps) {
  return routineServiceFor(deps).pause();
}

// 给「一键恢复」用。
export function resumeAll(deps) {
  return routineServiceFor(deps).resume();
}

// 测试用：清除缓存的服务。
export function __reset(deps) {
  dropRoutineService(deps);
}
