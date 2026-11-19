import http from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, lstat, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// 浏览器扩展接口需要去掉的代理前缀。
// 转给后端扩展的前缀（去掉 /bff）。外包派工 /dispatch/ 故意不在里面：不进网页层。
export const EXT_PREFIXES = ['board', 'ledger', 'groups', 'meetings', 'models', 'panic', 'routines', 'today'];
// 只读转发的前缀（规矩页）。只放行 GET/HEAD，别的方法在网页层就 405，不到后端。
export const READONLY_EXT_PREFIXES = ['rules'];
// 未读、语音、上传、设置。不并进 EXT_PREFIXES（旧测试把那份名单钉死了），
// 转发时并到同一条已登录、同源的路上。没有设备钥匙的请求到不了这里。
export const R29_PREFIXES = ['unread', 'voice', 'uploads', 'settings', 'notices', 'presence'];

const here = dirname(fileURLToPath(import.meta.url));
const COOKIE = 'hub_web_session';
const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
const runFile = promisify(execFile);
const tailscale = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const cookieOptions = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000';

function sourceIP(ip = '') { return ip.replace(/^::ffff:/i, ''); }

function loopbackIP(ip) {
  ip = sourceIP(ip);
  return ip === '::1' || (isIP(ip) === 4 && ip.startsWith('127.'));
}

function serveHosts(value = '') {
  const hosts = new Set(value.split(',').map(h => h.trim()).filter(Boolean));
  for (const host of hosts) {
    let url;
    try { url = new URL(`https://${host}`); } catch { throw new Error('Invalid HUB_WEB_SERVE_HOSTS'); }
    if (url.host !== host || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('HUB_WEB_SERVE_HOSTS must contain canonical HTTPS host[:port] authorities');
    }
  }
  return hosts;
}

function tailnetIP(ip) {
  if (isIP(ip) === 4) {
    const bytes = ip.split('.').map(Number);
    return bytes[0] === 100 && bytes[1] >= 64 && bytes[1] <= 127;
  }
  if (isIP(ip) !== 6) return false;
  return new URL(`http://[${ip}]/`).hostname.startsWith('[fd7a:115c:a1e0:');
}

// 判断看板远程入口的连接来源是否允许。
export function boardSourceAllowed(ip, viaServe) {
  return !!viaServe || loopbackIP(ip) || tailnetIP(sourceIP(ip));
}

async function whois(ip) {
  const { stdout } = await runFile(tailscale, ['whois', '--json', ip], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024,
  });
  return JSON.parse(stdout);
}

function userID(result) {
  const id = result?.UserProfile?.ID;
  if ((typeof id !== 'string' || !id.trim()) && (typeof id !== 'number' || !Number.isFinite(id))) {
    throw new Error('whois did not return a user ID');
  }
  return String(id);
}

async function inTrustedFile(path, ip) {
  if (!path) return false;
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size > 65536 ||
        (process.getuid && info.uid !== process.getuid())) return false;
    const value = JSON.parse(await file.readFile('utf8'));
    return Array.isArray(value.ips) && value.ips.some(item => typeof item === 'string' && sourceIP(item) === ip);
  } catch { return false; } finally { await file?.close(); }
}

// 只注入外部 whois 与时钟，HTTP 来源始终来自 socket，不采用代理头。
export function createDeviceTrust(env = {}, { whois: lookup = whois, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  return async function trusted(ip) {
    ip = sourceIP(ip);
    if (ip === '127.0.0.1') return '本机';
    if (!tailnetIP(ip)) return null;
    const cached = cache.get(ip);
    if (cached && cached.until > now()) return cached.method;
    if (pending.has(ip)) return pending.get(ip);
    const task = (async () => {
      let method = null, lifetime = 600000;
      try {
        if (!env.HUB_WEB_WHOIS_TARGET) throw new Error('whois target not configured');
        const [peer, self] = await Promise.all([lookup(ip), lookup(env.HUB_WEB_WHOIS_TARGET)]);
        if (userID(peer) === userID(self)) method = 'whois';
      } catch {
        lifetime = 30000;
        if (await inTrustedFile(env.HUB_WEB_TRUSTED_FILE, ip)) method = '白名单';
      }
      cache.set(ip, { method, until: now() + lifetime });
      return method;
    })();
    pending.set(ip, task);
    try { return await task; } finally { pending.delete(ip); }
  };
}

function injectShell(source) {
  if (!source.includes('</body>')) throw new Error('Shell has no closing body');
  return source.replace(/<meta\b[^>]*>/gi, tag =>
    /http-equiv\s*=\s*(["'])Content-Security-Policy\1/i.test(tag)
      ? tag.replace(/connect-src\s+'none'(?=\s*(?:;|["']))/gi, "connect-src 'self'") : tag)
    .replace('</body>', '<script src="/hub-real.js"></script>\n</body>');
}

function mtimeReader(path, transform = value => value) {
  let version, value;
  return async () => {
    const info = await stat(path);
    const next = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
    if (version !== next) {
      const fresh = transform(await readFile(path));
      value = fresh; version = next;
    }
    return value;
  };
}

const assetRules = [
  /^\/manifest\.webmanifest$/,
  /^\/assets\/icons\/[a-zA-Z0-9_-]+\.png$/,
  /^\/pets\/pack\.json$/,
  /^\/pets\/spare\/spare\.json$/,
  /^\/pets\/spare\/[a-z0-9_-]+\/avatar(?:-96|-192)?\.webp$/,
  /^\/pets\/[a-z0-9_-]+\/[a-zA-Z0-9_-]+\.webp$/,
  /^\/pets\/[a-z0-9_-]+\/x(?:216|360)\/[a-zA-Z0-9_-]+\.webp$/,
  /^\/fonts\/[a-zA-Z0-9_-]+\.woff2$/,
  /^\/fonts\/fonts\.css$/,
  /^\/fonts\/OFL-License\.txt$/,
  /^\/pets\/CREDITS-pets\.md$/,
];
const types = { '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

// 逐级拒绝符号链接，打开后再核对 inode 与最终路径；资源由文件流发送。
async function shellFile(root, name) {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Invalid shell root');
  const base = await realpath(root);
  let path = root, info;
  for (const part of name.split('/')) {
    if (!part || part === '.' || part === '..') throw new Error('Invalid shell path');
    path = join(path, part); info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Symbolic links are not served');
  }
  if (!info?.isFile()) throw new Error('Not a regular file');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat(), final = await realpath(path), distance = relative(base, final);
    const currentRoot = await lstat(root);
    if (!distance || distance === '..' || distance.startsWith('../') || isAbsolute(distance) ||
        !opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino ||
        currentRoot.isSymbolicLink() || currentRoot.dev !== rootInfo.dev || currentRoot.ino !== rootInfo.ino) {
      throw new Error('Shell file changed or escaped its root');
    }
    return { file, info: opened };
  } catch (error) { await file.close(); throw error; }
}

function shellReader(root) {
  let version, html;
  return async () => {
    const { file, info } = await shellFile(root, 'index.html');
    try {
      const next = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
      if (next !== version) {
        const fresh = injectShell(await file.readFile('utf8'));
        html = fresh; version = next;
      }
      return html;
    } finally { await file.close(); }
  };
}

export async function keyFile(path, generate = false) {
  if (!path) throw new Error('A key file path is required');
  if (generate) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
      const f = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await f.writeFile(randomBytes(32).toString('hex') + '\n'); } finally { await f.close(); }
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await f.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 8192 ||
        (process.getuid && stat.uid !== process.getuid())) throw new Error('Key files must be owned by this user and mode 0600');
    const key = (await f.readFile('utf8')).trim();
    if (!key || /[\r\n\x00-\x1f\x7f]/.test(key)) throw new Error('Invalid key file');
    return key;
  } finally { await f.close(); }
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function createHubWeb(env = process.env, dependencies = {}) {
  const hosts = [...new Set((env.HUB_WEB_HOSTS || '127.0.0.1').split(',').map(h => h.trim()))];
  if (hosts.some(h => {
    const family = isIP(h);
    if (!family || h === '0.0.0.0') return true;
    const normalized = family === 6 ? new URL(`http://[${h}]/`).hostname : h;
    return normalized === '[::]' || normalized === '[::ffff:0:0]';
  })) {
    throw new Error('HUB_WEB_HOSTS must contain explicit non-wildcard IP addresses');
  }
  const allowedServeHosts = serveHosts(env.HUB_WEB_SERVE_HOSTS);
  const allowedServeLogins = new Set((env.HUB_WEB_SERVE_LOGINS || '').split(',').map(s => s.trim()).filter(Boolean));
  const port = Number(env.HUB_WEB_PORT || 3292);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid HUB_WEB_PORT');
  const upstream = new URL(env.BFF_URL || 'http://127.0.0.1:3291');
  if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' || upstream.username || upstream.password || upstream.search || upstream.hash || upstream.pathname !== '/') {
    throw new Error('BFF_URL must be a plain HTTP origin on 127.0.0.1');
  }
  const webKey = await keyFile(env.HUB_WEB_KEY_FILE || join(here, 'run/hub-web.key'), true);
  const bffKey = await keyFile(env.BFF_KEY_FILE);
  const legacySession = createHmac('sha256', webKey).update('hub-web-cookie-v1').digest('base64url');
  const sign = id => createHmac('sha256', webKey).update('hub-web-device-v2:' + id).digest('base64url');
  const issue = () => { const id = randomBytes(16).toString('hex'); return id + '.' + sign(id); };
  const deviceSession = cookie => {
    const values = (cookie || '').split(';').map(c => c.trim()).filter(c => c.startsWith(COOKIE + '='));
    if (values.length !== 1) return null;
    const value = values[0].slice(COOKIE.length + 1), parts = value.split('.');
    return parts.length === 2 && /^[a-f0-9]{32}$/.test(parts[0]) && equal(parts[1], sign(parts[0])) ? value : null;
  };
  const shellDir = env.HUB_WEB_SHELL_DIR ? resolve(env.HUB_WEB_SHELL_DIR) : null;
  const legacyHTML = shellDir ? null : injectShell(await readFile(join(here, 'shell/DSH-Hub.html'), 'utf8'));
  const getHTML = shellDir ? shellReader(shellDir) : async () => legacyHTML;
  const getScript = mtimeReader(env.HUB_WEB_SCRIPT ? resolve(env.HUB_WEB_SCRIPT) : join(here, 'hub-real.js'));
  await getHTML(); await getScript();
  const trust = createDeviceTrust(env, dependencies);
  const log = dependencies.log || (line => console.log(line));
  const servers = [], proxies = new Set();
  const json = (res, code, message) => {
    res.writeHead(code, { ...noStore, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: String(code), message } }));
  };

  async function handler(req, res) {
    try {
    const address = req.socket.server.address();
    const expectedHost = `${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`;
    // Serve 身份头仅在指定监听、真实回环来源和配置 Host 同时成立时可信。
    const viaServe = address.address === '127.0.0.1' && loopbackIP(req.socket.remoteAddress) &&
      allowedServeHosts.has(req.headers.host);
    // Serve Host 在其它监听上一律拒绝，包括与直连 Host 重合的配置。
    if ((allowedServeHosts.has(req.headers.host) && !viaServe) ||
        (!viaServe && req.headers.host !== expectedHost)) return json(res, 403, 'Invalid Host');
    const expectedOrigin = `${viaServe ? 'https' : 'http'}://${viaServe ? req.headers.host : expectedHost}`;
    const options = cookieOptions + (viaServe ? '; Secure' : '');
    let url;
    try { url = new URL(req.url, expectedOrigin); } catch { return json(res, 400, 'Invalid URL'); }
    if (env.HUB_WEB_BOARD_REMOTE === '1' && (url.pathname === '/board' || url.pathname.startsWith('/board/'))) {
      const remoteRawPath = req.url.split(/[?#]/, 1)[0];
      if (/\.\.|%2f|%5c|%2e|%00|\\/i.test(remoteRawPath) || remoteRawPath !== url.pathname) {
        return json(res, 404, 'Not found');
      }
      if (!boardSourceAllowed(req.socket.remoteAddress, viaServe)) return json(res, 403, 'Invalid source');
      // 经 Serve 进来的远程看板请求同样要在 Serve 登录名单里（与网页登录同一口径）。
      if (viaServe && !allowedServeLogins.has(req.headers['tailscale-user-login'])) {
        return json(res, 403, 'Serve login not allowed');
      }
      if (req.headers.origin !== undefined) return json(res, 403, 'Origin not allowed');
      if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST');
        return json(res, 405, 'Method not allowed');
      }
      if (!/^Bearer\s+\S+$/i.test(req.headers.authorization || '')) return json(res, 401, 'Bearer required');
      const maxBody = 262144;
      if (Number(req.headers['content-length']) > maxBody) return json(res, 413, 'Request body too large');
      const target = new URL(upstream);
      target.pathname = url.pathname;
      target.search = url.search;
      const headers = {};
      for (const name of ['authorization', 'content-type', 'accept', 'idempotency-key']) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }
      let requestBytes = 0;
      const proxy = http.request(target, { method: req.method, headers }, upstreamRes => {
        const contentType = upstreamRes.headers['content-type'] || 'application/json; charset=utf-8';
        res.writeHead(upstreamRes.statusCode, { ...noStore, 'Content-Type': contentType, 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        upstreamRes.on('error', () => res.destroy());
        upstreamRes.pipe(res);
      });
      proxies.add(proxy);
      proxy.once('close', () => proxies.delete(proxy));
      proxy.setTimeout(120_000, () => proxy.destroy(new Error('Upstream timeout')));
      proxy.on('error', () => {
        if (!res.headersSent) json(res, 502, 'BFF unavailable');
        else res.destroy();
      });
      req.once('aborted', () => proxy.destroy());
      res.once('close', () => proxy.destroy());
      req.on('data', chunk => {
        requestBytes += chunk.length;
        if (requestBytes > maxBody) {
          req.unpipe(proxy);
          proxy.destroy();
          if (!res.headersSent) json(res, 413, 'Request body too large');
          req.resume();
        }
      });
      req.pipe(proxy);
      return;
    }
    let session = deviceSession(req.headers.cookie);
    const authenticated = !!session;
    if(/^\/bff\/avatars\//.test(url.pathname) && !authenticated)return json(res,401,'Valid device cookie required');
    if (viaServe && !authenticated && !allowedServeLogins.has(req.headers['tailscale-user-login'])) {
      return json(res, 403, 'Tailscale Serve login required');
    }
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('key')) {
      if (!equal(url.searchParams.get('key'), webKey)) return json(res, 401, 'Unauthorized');
      res.writeHead(303, { ...noStore, Location: '/',
        'Set-Cookie': `${COOKIE}=${issue()}; ${options}` });
      return res.end();
    }
    if (url.pathname.startsWith('/bff/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !authenticated) {
      return json(res, 403, 'Valid device cookie required');
    }
    if (!session) {
      // 老设备在下一次只读访问时升级；写请求必须先有新的有效设备 cookie。
      const legacy = (req.headers.cookie || '').split(';').some(c => equal(c.trim(), `${COOKIE}=${legacySession}`));
      const ip = sourceIP(req.socket.remoteAddress);
      const method = viaServe ? 'tailnet-serve' :
        legacy ? 'cookie升级' : env.HUB_WEB_TRUST_TAILNET === '1' ? await trust(ip) : null;
      if (!method) return json(res, 401, 'Unauthorized');
      session = issue();
      res.setHeader('Set-Cookie', `${COOKIE}=${session}; ${options}`);
      log(`${new Date().toISOString()}\t${ip}\t${method}`);
    }
    const rawPath = req.url.split(/[?#]/, 1)[0];
    // URL() 会提前折叠点路径，必须检查未经解析的路径。
    if (shellDir && (/\.\.|%2f|%5c|%2e|%00|\\/i.test(rawPath) || rawPath !== url.pathname)) {
      return json(res, 404, 'Not found');
    }
    if (url.pathname.startsWith('/bff/')) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!authenticated ||
          req.headers.origin !== expectedOrigin ||
          (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'))) {
        return json(res, 403, 'Valid device cookie and same-origin Origin required');
      }
      if (req.headers['sec-fetch-site'] === 'cross-site' ||
          (req.headers.origin && req.headers.origin !== expectedOrigin)) return json(res, 403, 'Same-origin requests only');
      const target = new URL(upstream);
      // Assign pathname; new URL(userPath, origin) could turn // into a different host.
      const underPrefix = prefix => url.pathname === `/bff/${prefix}` || url.pathname.startsWith(`/bff/${prefix}/`);
      const readOnlyExt = READONLY_EXT_PREFIXES.some(underPrefix);
      if (readOnlyExt && !['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return json(res, 405, 'Method not allowed');
      }
      const r29Ext = R29_PREFIXES.some(underPrefix);
      const extended = readOnlyExt || EXT_PREFIXES.some(underPrefix) || r29Ext;
      target.pathname = extended ? url.pathname.slice(4) : url.pathname;
      target.search = url.search;
      // 只从白名单重建请求头；浏览器伪造的设备头永远不转发。
      const headers = { 'X-Hub-Bff-Key': bffKey,
        'X-Hub-Device': createHash('sha256').update('hub-device-v1:' + session.split('.')[0]).digest('hex').slice(0, 16) };
      const headerNames = ['accept', 'content-type', 'last-event-id', 'idempotency-key',
        'content-disposition', 'x-filename', 'x-request-id'];
      for (const name of headerNames) if (req.headers[name]) headers[name] = req.headers[name];
      const avatarRequest=/^\/bff\/bots\/[^/]+\/avatar$/.test(url.pathname)&&req.method==='POST';
      // 语音和上传与后端一样是 25MB。只放宽这两条已登录的路；其余仍是 512KB，头像仍是 2MB。
      const r29Body=/^\/bff\/(voice|uploads)(\/|$)/.test(url.pathname);
      const maxBody=avatarRequest?2*1024*1024+65536:r29Body?25*1024*1024:512000;
      if(Number(req.headers['content-length'])>maxBody)return json(res,413,'Request body too large');
      let requestBytes=0;
      const proxy = http.request(target, { method: req.method, headers }, upstreamRes => {
        const outgoing = { ...noStore, 'Content-Type': upstreamRes.headers['content-type'] || 'application/json; charset=utf-8', 'X-Accel-Buffering': 'no' };
        if(/^\/bff\/avatars\//.test(url.pathname))outgoing['Cache-Control']='private, max-age=0, must-revalidate';
        res.writeHead(upstreamRes.statusCode, outgoing);
        res.flushHeaders();
        upstreamRes.on('error', () => res.destroy());
        upstreamRes.pipe(res); // No buffering: SSE arrives a frame at a time, with backpressure.
      });
      proxies.add(proxy);
      proxy.once('close', () => proxies.delete(proxy));
      proxy.setTimeout(120_000, () => proxy.destroy(new Error('Upstream timeout')));
      proxy.on('error', () => { if (!res.headersSent) json(res, 502, 'BFF unavailable'); else res.destroy(); });
      req.once('aborted', () => proxy.destroy());
      res.once('close', () => proxy.destroy());
      req.on('data',chunk=>{requestBytes+=chunk.length;if(requestBytes>maxBody){req.unpipe(proxy);proxy.destroy();if(!res.headersSent)json(res,413,'Request body too large');req.resume();}});
      req.pipe(proxy);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, 'Method not allowed');
    if (shellDir && assetRules.some(rule => rule.test(url.pathname))) {
      let opened;
      try { opened = await shellFile(shellDir, url.pathname.slice(1)); }
      catch { return json(res, 404, 'Not found'); }
      const { file, info } = opened;
      const etag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
      const headers = { ...noStore, 'Content-Type': types[extname(url.pathname)], ETag: etag,
        'Cache-Control': /^\/(pets|fonts)\//.test(url.pathname) ? 'private, max-age=86400' : 'no-store' };
      const match = req.headers['if-none-match'];
      if (match && match.split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag)) {
        await file.close(); res.writeHead(304, headers); return res.end();
      }
      if (req.method === 'HEAD') {
        await file.close(); res.writeHead(200, { ...headers, 'Content-Length': info.size }); return res.end();
      }
      const stream = file.createReadStream();
      stream.once('error', () => res.destroy());
      res.once('close', () => stream.destroy());
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      stream.pipe(res);
      return;
    }
    const body = url.pathname === '/' ? await getHTML() : url.pathname === '/hub-real.js' ? await getScript() : null;
    if (body === null) return json(res, 404, 'Not found');
    res.writeHead(200, { ...noStore, 'Content-Type': url.pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
      'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      if (!res.headersSent) json(res, 500, 'Hub web unavailable'); else res.destroy();
    }
  }

  try {
    for (const host of hosts) {
      const server = http.createServer(handler);
      servers.push(server);
      await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
    }
  } catch (error) { await Promise.all(servers.map(s => new Promise(ok => s.close(ok)))); throw error; }
  return {
    servers,
    async close() {
      for (const p of proxies) p.destroy();
      await Promise.all(servers.map(s => new Promise(ok => { s.close(ok); s.closeAllConnections(); })));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = await createHubWeb();
    for (const server of app.servers) {
      const a = server.address();
      console.log(`hub-web listening on ${a.address}:${a.port} (authentication required)`);
    }
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); process.exit(0); });
  } catch (error) { console.error(`hub-web failed: ${error.code || error.message}`); process.exitCode = 1; }
}
