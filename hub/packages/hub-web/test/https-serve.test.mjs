import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHubWeb } from '../server.mjs';
// 测试用的运营商级私网（100.64/10）地址首段，运行时拼接，避免源码里留成块的地址。
const C = '100';

const scratch = join(process.env.HUB_HOME || join(homedir(), 'dsh-work'), 'tmp/r26-D');
await mkdir(scratch, { recursive: true });
const owner = 'owner@example.test', foreign = C+'.64.0.11', ownPeer = C+'.64.0.12';
const webKey = 'https-offline-web', bffKey = 'https-offline-bff';
const cookieValue = response => response.headers['set-cookie']?.[0]?.split(';')[0];

async function fixture(t, extra = {}) {
  const dir = await mkdtemp(join(scratch, 'https-'));
  const shell = join(dir, 'shell'); await mkdir(shell);
  await writeFile(join(shell, 'index.html'), '<html><body>HTTPS 离线假壳</body></html>');
  await writeFile(join(dir, 'web.fixture'), webKey, { mode: 0o600 });
  await writeFile(join(dir, 'bff.fixture'), bffKey, { mode: 0o600 });
  const calls = [], logs = [], lookups = [];
  const bff = http.createServer((req, res) => {
    calls.push({ method: req.method, headers: req.headers });
    req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  });
  t.after(() => new Promise(ok => { bff.close(ok); bff.closeAllConnections(); }));
  await new Promise(ok => bff.listen(0, '127.0.0.1', ok));
  const env = { HUB_WEB_WHOIS_TARGET: 'self-node',
    HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_PORT: '0', HUB_WEB_SHELL_DIR: shell,
    HUB_WEB_KEY_FILE: join(dir, 'web.fixture'), BFF_KEY_FILE: join(dir, 'bff.fixture'),
    BFF_URL: `http://127.0.0.1:${bff.address().port}`, HUB_WEB_TRUST_TAILNET: '1',
    HUB_WEB_SERVE_HOSTS: 'hub.example.test:14443', HUB_WEB_SERVE_LOGINS: owner, ...extra };
  const app = await createHubWeb(env, { log: line => logs.push(line), whois: async ip => {
    lookups.push(ip); return { UserProfile: { ID: ip === foreign ? 'another-user' : 'self-user' } };
  } });
  t.after(() => app.close());
  const port = app.servers[0].address().port, directHost = `127.0.0.1:${port}`;
  const serveHost = env.HUB_WEB_SERVE_HOSTS.split(',').map(s => s.trim()).find(Boolean);
  const request = (path = '/', headers = {}, method = 'GET', body = '') => new Promise((ok, fail) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let value = ''; res.setEncoding('utf8'); res.on('data', c => { value += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: value }));
    });
    req.on('error', fail); req.end(body);
  });
  // 仅替代 socket/监听来源，运行真实 HTTP handler；不在真实 100.x 端口监听。
  const sourceRequest = async ({ local = '127.0.0.1', remote = foreign, headers = {}, path = '/' } = {}) => {
    const req = { method: 'GET', url: path, headers: { host: `${local}:${port}`, ...headers },
      socket: { remoteAddress: remote, server: { address: () => ({ address: local, port, family: 'IPv4' }) } } };
    const res = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = Array.isArray(value) ? value : [value]; },
      writeHead(status, headers) { this.status = status; for (const [name, value] of Object.entries(headers)) this.setHeader(name, value); },
      end(body) { this.body = body; } };
    await app.servers[0].listeners('request')[0](req, res);
    return res;
  };
  return { app, env, request, sourceRequest, directHost, serveHost, calls, logs, lookups };
}

test('HTTPS：Serve Host + 允许登录免钥匙发 Secure 设备 cookie，日志标记 tailnet-serve', async t => {
  const f = await fixture(t);
  const res = await f.request('/', { Host: f.serveHost, 'Tailscale-User-Login': owner });
  assert.equal(res.status, 200); assert.match(res.body, /HTTPS 离线假壳/);
  assert.match(cookieValue(res), /^hub_web_session=[a-f0-9]{32}\.[A-Za-z0-9_-]+$/);
  assert.match(res.headers['set-cookie'][0], /Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
  assert.match(f.logs[0], /\t127\.0\.0\.1\ttailnet-serve$/); assert.equal(f.lookups.length, 0);
  assert(f.logs.every(line => !line.includes(cookieValue(res)) && !line.includes(owner) && !line.includes(webKey)));
});

test('HTTPS：Serve 缺失/异用户/重复登录与只有名字或头像头均拒绝且不发 cookie', async t => {
  const f = await fixture(t);
  for (const headers of [{}, { 'Tailscale-User-Login': 'other@example.test' },
    { 'Tailscale-User-Login': `${owner}, other@example.test` }, { 'Tailscale-User-Name': owner },
    { 'Tailscale-User-Profile-Pic': owner }]) {
    const res = await f.request('/', { Host: f.serveHost, ...headers });
    assert.equal(res.status, 403); assert.equal(cookieValue(res), undefined);
  }
  assert.equal(f.lookups.length, 0); assert.equal(f.logs.length, 0);
});

test('HTTPS：Serve Host 出现在 100.x 监听、其它回环监听或非回环来源均 403', async t => {
  const f = await fixture(t);
  for (const [local, remote] of [[ownPeer, ownPeer], [ownPeer, '127.0.0.1'], ['127.0.0.2', '127.0.0.1'],
    ['::1', '::1'], ['127.0.0.1', ownPeer], ['127.0.0.1', '::ffff:'+C+'.64.0.12']]) {
    const res = await f.sourceRequest({ local, remote, headers: { host: f.serveHost, 'tailscale-user-login': owner } });
    assert.equal(res.status, 403, `${local} / ${remote}`); assert.equal(cookieValue(res), undefined);
  }
  assert.equal(f.lookups.length, 0);
});

test('HTTPS：真实回环来源包含 IPv4-mapped 和 IPv6，127.0.0.1 监听才接受', async t => {
  const f = await fixture(t);
  for (const remote of ['127.0.0.1', '127.0.0.2', '::ffff:127.0.0.1', '::1']) {
    const res = await f.sourceRequest({ remote, headers: { host: f.serveHost, 'tailscale-user-login': owner } });
    assert.equal(res.status, 200); assert.match(res.headers['set-cookie'][0], /; Secure$/);
  }
});

test('HTTPS：直连 100.x 伪造全部 Tailscale 用户头仍按 whois 判定，不替异用户发 cookie', async t => {
  const f = await fixture(t);
  const res = await f.sourceRequest({ local: ownPeer, remote: foreign, headers: {
    'tailscale-user-login': owner, 'tailscale-user-name': owner, 'tailscale-user-profile-pic': owner,
    'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': f.serveHost, 'x-forwarded-proto': 'https' } });
  assert.equal(res.status, 401); assert.equal(cookieValue(res), undefined); assert(f.lookups.includes(foreign));
});

test('HTTPS：直连回环头不授予身份；关闭原免钥匙登录时伪造头拿不到 cookie', async t => {
  const f = await fixture(t, { HUB_WEB_TRUST_TAILNET: '0' });
  const res = await f.request('/', { 'Tailscale-User-Login': owner, 'Tailscale-User-Name': owner,
    'Tailscale-User-Profile-Pic': owner, 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': f.serveHost });
  assert.equal(res.status, 401); assert.equal(cookieValue(res), undefined);
  // 独立配置的 Serve 登录仍按允许列表工作。
  assert.equal((await f.request('/', { Host: f.serveHost, 'Tailscale-User-Login': owner })).status, 200);
});

test('HTTPS：旧 HTTP 同用户 whois、本机和钥匙入口保持原 cookie 及日志方式', async t => {
  const f = await fixture(t);
  const peer = await f.sourceRequest({ local: ownPeer, remote: ownPeer, headers: { 'tailscale-user-login': 'other@example.test' } });
  assert.equal(peer.status, 200); assert.doesNotMatch(peer.headers['set-cookie'][0], /; Secure/);
  assert.match(f.logs.at(-1), /\twhois$/);
  const local = await f.request('/', { 'Tailscale-User-Login': 'other@example.test' });
  assert.equal(local.status, 200); assert.doesNotMatch(local.headers['set-cookie'][0], /; Secure/);
  assert.match(f.logs.at(-1), /\t本机$/);
  const key = await f.request('/?key=' + webKey);
  assert.equal(key.status, 303); assert.equal(key.headers.location, '/');
  assert.doesNotMatch(key.headers['set-cookie'][0], /; Secure/);
});

test('HTTPS：Serve 与 HTTP 复用同一套签名 cookie 和稳定设备记录', async t => {
  const f = await fixture(t);
  const login = await f.request('/', { Host: f.serveHost, 'Tailscale-User-Login': owner });
  const cookie = cookieValue(login);
  for (const headers of [{ Host: f.serveHost, Cookie: cookie }, { Cookie: cookie }]) {
    const page = await f.request('/', headers); assert.equal(page.status, 200); assert.equal(cookieValue(page), undefined);
    assert.equal((await f.request('/bff/health', headers)).status, 200);
  }
  const [a, b] = f.calls.map(call => call.headers['x-hub-device']);
  assert.match(a, /^[a-f0-9]{16}$/); assert.equal(a, b);
});

test('HTTPS：Serve BFF 的 GET/POST 只接受 HTTPS Origin；HTTP 入口拒绝 Serve Origin', async t => {
  const f = await fixture(t);
  const login = await f.request('/', { Host: f.serveHost, 'Tailscale-User-Login': owner });
  const cookie = cookieValue(login), origin = `https://${f.serveHost}`;
  const headers = { Host: f.serveHost, Cookie: cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin' };
  for (const method of ['GET', 'POST']) {
    assert.equal((await f.request('/bff/health', headers, method, method === 'POST' ? '{}' : '')).status, 200);
    for (const bad of [`http://${f.serveHost}`, `http://${f.directHost}`, 'null', 'https://other.example.test']) {
      const n = f.calls.length;
      assert.equal((await f.request('/bff/health', { ...headers, Origin: bad }, method, method === 'POST' ? '{}' : '')).status, 403);
      assert.equal(f.calls.length, n);
    }
    assert.equal((await f.request('/bff/health', { Cookie: cookie, Origin: origin }, method, method === 'POST' ? '{}' : '')).status, 403);
    assert.equal((await f.request('/bff/health', { Cookie: cookie, Origin: `http://${f.directHost}` }, method, method === 'POST' ? '{}' : '')).status, 200);
  }
});

test('HTTPS：Serve 写入必须已有有效 cookie，Sec-Fetch-Site 沿用同源限制', async t => {
  const f = await fixture(t);
  const headers = { Host: f.serveHost, 'Tailscale-User-Login': owner, Origin: `https://${f.serveHost}` };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await f.request('/bff/health', headers, method, '{}')).status, 403);
  }
  assert.equal(f.calls.length, 0);
  const login = await f.request('/', headers), cookie = cookieValue(login);
  for (const site of ['cross-site', 'same-site', 'none']) {
    assert.equal((await f.request('/bff/health', { ...headers, Cookie: cookie, 'Sec-Fetch-Site': site }, 'POST', '{}')).status, 403);
  }
  assert.equal((await f.request('/bff/health', { ...headers, Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/bff/health', { ...headers, Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' }, 'POST', '{}')).status, 200);
});

test('HTTPS：Serve 钥匙与旧 cookie 均不能绕过登录白名单，允许登录签发一律 Secure', async t => {
  const f = await fixture(t);
  const legacy = 'hub_web_session=' + createHmac('sha256', webKey).update('hub-web-cookie-v1').digest('base64url');
  for (const [path, Cookie] of [['/?key=' + webKey, ''], ['/', legacy]]) {
    const denied = await f.request(path, { Host: f.serveHost, Cookie });
    assert.equal(denied.status, 403); assert.equal(cookieValue(denied), undefined);
    const ok = await f.request(path, { Host: f.serveHost, Cookie, 'Tailscale-User-Login': owner });
    assert.equal(ok.status, path === '/' ? 200 : 303); assert.match(ok.headers['set-cookie'][0], /; Secure$/);
  }
});

test('HTTPS：用户头不转发 BFF，也不采用客户端伪造的设备头', async t => {
  const f = await fixture(t);
  const login = await f.request('/', { Host: f.serveHost, 'Tailscale-User-Login': owner });
  const res = await f.request('/bff/health', { Host: f.serveHost, Cookie: cookieValue(login),
    'Tailscale-User-Login': owner, 'Tailscale-User-Name': owner, 'Tailscale-User-Profile-Pic': owner,
    'X-Hub-Device': 'forged' });
  assert.equal(res.status, 200);
  const h = f.calls.at(-1).headers;
  for (const key of ['tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic']) assert.equal(h[key], undefined);
  assert.equal(h['x-hub-bff-key'], bffKey); assert.notEqual(h['x-hub-device'], 'forged');
});

test('HTTPS：Serve 未配置默认关闭；逗号列表允许多个 Host/登录，空白名单不放行', async t => {
  const disabled = await fixture(t, { HUB_WEB_SERVE_HOSTS: '', HUB_WEB_SERVE_LOGINS: '' });
  assert.equal((await disabled.request('/', { Host: 'hub.example.test:14443', 'Tailscale-User-Login': owner })).status, 403);
  const empty = await fixture(t, { HUB_WEB_SERVE_LOGINS: '' });
  assert.equal((await empty.request('/', { Host: empty.serveHost, 'Tailscale-User-Login': owner })).status, 403);
  const multi = await fixture(t, { HUB_WEB_SERVE_HOSTS: ' hub.example.test:14443, second.example.test:14444, ',
    HUB_WEB_SERVE_LOGINS: ` ${owner}, second@example.test, ` });
  assert.equal((await multi.request('/', { Host: 'second.example.test:14444', 'Tailscale-User-Login': 'second@example.test' })).status, 200);
});

test('HTTPS：Serve 配置只接受规范 authority，拒绝路径、用户信息和查询参数', async t => {
  const f = await fixture(t);
  for (const value of ['https://hub.example.test', 'hub.example.test/path', 'owner@hub.example.test',
    'hub.example.test?query=1', 'hub.example.test#fragment', 'hub.example.test\\path']) {
    await assert.rejects(createHubWeb({ ...f.env, HUB_WEB_SERVE_HOSTS: value }), /HUB_WEB_SERVE_HOSTS/);
  }
});
