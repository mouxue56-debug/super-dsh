#!/usr/bin/env node
// 演示实例的「一个进程、一个端口」：网页层、后端（hub-bff）和演示假模型都挂在同一个端口上，
// 只听 127.0.0.1。内核（dsh）另占一个端口，由 start.sh 起。
// 分流：路径以 /v1/ 开头 → 假模型；带后端钥匙头或 Authorization 头 → 后端；其余 → 网页层。
// （网页层转发到后端时带钥匙头，所以不会绕回自己；浏览器直连不带，所以只会进网页层。）
// 配置全走环境变量，与各包自己的约定一致：HUB_HOME、DSH_URL、DSH_TOKEN_FILE、BFF_KEY_FILE、
// HUB_BFF_STORE、HUB_WEB_KEY_FILE；端口用 --port。
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createDemoModel} from './demo-model.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = name => argv[argv.indexOf(name) + 1];
const port = Number(flag('--port'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('缺少或错误的 --port');
const origin = `http://127.0.0.1:${port}`;
const load = rel => import(pathToFileURL(join(repo, rel)).href);

// 一个不真监听的服务器壳：只为接住后端交进来的请求处理函数，由本进程的分流器转给它。
function inertServer(onHandler, handler) {
  onHandler(handler);
  const shell = {
    requestTimeout: 0, headersTimeout: 0,
    listen: (...args) => args.find(a => typeof a === 'function')?.(),
    once: () => shell, on: () => shell, address: () => ({address: '127.0.0.1', port}),
    close: done => done?.(), closeAllConnections: () => {},
  };
  return shell;
}

const {startServer} = await load('packages/hub-bff/server.mjs');
let bffHandler;
const bff = await startServer({host: '127.0.0.1', port,
  serverFactory: handler => inertServer(h => { bffHandler = h; }, handler)});

const {createHubWeb} = await load('packages/hub-web/server.mjs');
const web = await createHubWeb({
  ...process.env, HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_PORT: String(port), BFF_URL: origin,
});
const server = web.servers[0];
const webHandler = server.listeners('request')[0];
const model = createDemoModel();
server.removeAllListeners('request');
server.on('request', (req, res) => {
  const pathname = (req.url ?? '').split('?')[0];
  if (pathname.startsWith('/v1/')) return model(req, res);
  const direct = req.headers['x-hub-bff-key'] !== undefined || req.headers.authorization !== undefined;
  if (direct) return bffHandler(req, res);
  return webHandler(req, res);
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await web.close().catch(() => {});
  await bff.close().catch(() => {});
  process.exit(0);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
console.log(`demo stack ready on ${origin}`);
