import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, symlink, chmod, utimes, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const scratch = fileURLToPath(new URL('./scratch/', import.meta.url));
await mkdir(scratch, { recursive: true });
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import * as service from '../server.mjs';
// 测试用的运营商级私网（100.64/10）地址首段，运行时拼接，避免源码里留成块的地址。
const C = '100';
const { createDeviceTrust } = service;

const shell = '<html><head><meta http-equiv="Content-Security-Policy" content="connect-src \'none\';"></head><body>第一版</body></html>';
const entries = [
  ['manifest.webmanifest', 'application/manifest+json', '{}'],
  ['assets/icons/icon-192.png', 'image/png', 'PNG'],
  ['pets/pack.json', 'application/json', '{}'],
  ['pets/gpt/happy.webp', 'image/webp', 'WEBP'],
  ['fonts/demo.woff2', 'font/woff2', 'WOFF'],
  ['fonts/fonts.css', 'text/css', '@font-face{}'],
  ['fonts/OFL-License.txt', 'text/plain', 'license'],
  ['pets/CREDITS-pets.md', 'text/markdown', 'credits'],
];

async function fixture(extra = {}, deps = {}) {
  const dir = await mkdtemp(join(scratch, 'r23-web-'));
  const root = join(dir, 'shell');
  await mkdir(root);
  await writeFile(join(root, 'index.html'), shell);
  await writeFile(join(root, 'DSH-Hub.html'), shell.replace('第一版', '旧壳'));
  for (const [path, , body] of entries) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
  }
  await writeFile(join(dir, 'web.fixture'), 'offline-web-key', { mode: 0o600 });
  await writeFile(join(dir, 'bff.fixture'), 'offline-bff-key', { mode: 0o600 });
  await copyFile(new URL('../server.mjs', import.meta.url), join(dir, 'server.mjs'));
  await writeFile(join(dir, 'hub-real.js'), '/* 离线脚本第一版 */');
  const { createHubWeb: start } = await import(pathToFileURL(join(dir, 'server.mjs')).href);
  const env = { HUB_WEB_WHOIS_TARGET: 'self-node', HUB_WEB_PORT: '0', HUB_WEB_SHELL_DIR: root,
    HUB_WEB_KEY_FILE: join(dir, 'web.fixture'), BFF_KEY_FILE: join(dir, 'bff.fixture'), ...extra };
  const app = await start(env, deps);
  const url = `http://127.0.0.1:${app.servers[0].address().port}`;
  const login = await fetch(url + '/?key=offline-web-key', { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return { dir, root, env, app, start, url, headers: { Cookie: cookie } };
}

function rawGet(url, path, headers = {}) {
  return new Promise((ok, fail) => {
    const req = http.get(url, { path, headers }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', c => { body += c; });
      res.on('end', () => ok({ status: res.statusCode, body }));
    });
    req.on('error', fail);
  });
}

// 只替代 HTTP 来源地址；保留真实 handler、信任判断、cookie 与壳读取。
async function sourceRequest(app, ip, headers = {}) {
  const server = app.servers[0], address = server.address();
  const req = { method: 'GET', url: '/', headers: { host: `127.0.0.1:${address.port}`, ...headers },
    socket: { remoteAddress: ip, server } };
  const res = { status: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(code, values) { this.status = code; for (const [k, v] of Object.entries(values)) this.setHeader(k, v); },
    end(body) { this.body = body; } };
  await server.listeners('request')[0](req, res);
  return res;
}

test('r23：旁挂白名单、类型、ETag、304、HEAD 与认证边界', async () => {
  const f = await fixture();
  try {
    for (const [path, type, body] of entries) {
      assert.equal((await fetch(`${f.url}/${path}`)).status, 401);
      const response = await fetch(`${f.url}/${path}`, { headers: f.headers });
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('content-type').split(';')[0], type);
      assert.equal(await response.text(), body);
      const etag = response.headers.get('etag'); assert.match(etag, /^".+"$/);
      const head = await fetch(`${f.url}/${path}`, { method: 'HEAD', headers: f.headers });
      assert.equal(head.status, 200); assert.equal(await head.text(), '');
      assert.equal(head.headers.get('etag'), etag);
      assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(body));
      const unchanged = await fetch(`${f.url}/${path}`, { headers: { ...f.headers, 'If-None-Match': etag } });
      assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), '');
      if (/^(pets|fonts)\//.test(path)) assert.equal(response.headers.get('cache-control'), 'private, max-age=86400');
    }
    const old = await fetch(f.url + '/pets/pack.json', { headers: f.headers });
    await writeFile(join(f.root, 'pets/pack.json'), '{"changed":true}');
    const fresh = await fetch(f.url + '/pets/pack.json', { headers: { ...f.headers, 'If-None-Match': old.headers.get('etag') } });
    assert.equal(fresh.status, 200); assert.equal(await fresh.text(), '{"changed":true}');
    for (const path of ['/assets/icons/no.svg', '/fonts/private.txt', '/pets/UPPER/a.webp', '/pets/gpt/deep/a.webp', '/index.html']) {
      assert.equal((await fetch(f.url + path, { headers: f.headers })).status, 404, path);
    }
  } finally { await f.app.close(); }
});

test('r23：原始穿越、编码斜杠、根目录和中间目录及文件符号链接均拒绝', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, 'outside.webp'), '不可泄露');
    await symlink(join(f.dir, 'outside.webp'), join(f.root, 'pets/gpt/link.webp'));
    await symlink(join(f.root, 'pets/gpt'), join(f.root, 'pets/alias'));
    for (const path of ['/pets/gpt/../pack.json', '/pets/%2e%2e/manifest.webmanifest', '/pets%2fgpt/happy.webp',
      '/pets%5cgpt/happy.webp', '/pets/gpt/link.webp', '/pets/alias/happy.webp', '/fonts/..%2ffonts/fonts.css']) {
      assert.equal((await rawGet(f.url, path, f.headers)).status, 404, path);
    }
    const realRoot = f.root + '-real';
    await rename(f.root, realRoot); await symlink(realRoot, f.root);
    assert.equal((await fetch(f.url + '/pets/pack.json', { headers: f.headers })).status, 404);
  } finally { await f.app.close(); }
});

test('r23：按 mtime 换壳生效，CSP 仅改 meta，首页和脚本保持 no-store', async () => {
  const f = await fixture();
  try {
    const first = await fetch(f.url, { headers: f.headers });
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.match(await first.text(), /第一版/);
    await writeFile(join(f.root, 'index.html'), shell.replace('第一版', '第二版').replace('</body>', '<p>connect-src \'none\';</p></body>'));
    const later = new Date(Date.now() + 3000);
    await utimes(join(f.root, 'index.html'), later, later);
    const html = await (await fetch(f.url, { headers: f.headers })).text();
    assert.match(html, /第二版/); assert.match(html, /content="connect-src 'self';"/);
    assert.match(html, /<p>connect-src 'none';<\/p>/);
    assert.match(html, /<script src="\/hub-real.js"><\/script>\s*<\/body>/);
    assert.equal((html.match(/src="\/hub-real.js"/g) || []).length, 1);
    const head = await fetch(f.url, { method: 'HEAD', headers: f.headers });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const js = await fetch(f.url + '/hub-real.js', { headers: f.headers });
    assert.equal(js.headers.get('cache-control'), 'no-store');
    assert.equal(await js.text(), '/* 离线脚本第一版 */');
    const jsPath = join(f.dir, 'hub-real.js');
    await writeFile(jsPath, '/* 离线脚本第二版 */'); await utimes(jsPath, later, later);
    assert.equal(await (await fetch(f.url + '/hub-real.js', { headers: f.headers })).text(), '/* 离线脚本第二版 */');
  } finally { await f.app.close(); }
});

test('r23：设备白名单和同用户 whois 发 30 天 cookie，异用户与代理头不放行', async () => {
  let mode = 'failure'; const logs = [];
  const f = await fixture({ HUB_WEB_TRUST_TAILNET: '1' }, {
    whois: async ip => { if (mode === 'failure') throw new Error('离线失败');
      return { UserProfile: { ID: ip === 'self-node' || mode === 'same' ? 123 : 456 } }; },
    log: line => logs.push(line),
  });
  try {
    const localHTTP = await fetch(f.url);
    assert.equal(localHTTP.status, 200);
    assert.match(localHTTP.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=2592000/);
    const trustedFile = join(f.dir, 'trusted.json');
    await writeFile(trustedFile, JSON.stringify({ ips: [C+'.80.1.2'] }), { mode: 0o600 });
    await f.app.close();
    f.app = await f.start({ ...f.env, HUB_WEB_TRUSTED_FILE: trustedFile }, {
      whois: async ip => { if (mode === 'failure') throw new Error('离线失败');
        return { UserProfile: { ID: ip === 'self-node' || mode === 'same' ? 123 : 456 } }; },
      log: line => logs.push(line),
    });
    const white = await sourceRequest(f.app, '::ffff:'+C+'.80.1.2');
    assert.equal(white.status, 200); assert.match(white.headers['set-cookie'], /HttpOnly; SameSite=Lax; Max-Age=2592000/);
    assert.match(logs.at(-1), /100\.80\.1\.2.*白名单/);
    const local = await sourceRequest(f.app, '127.0.0.1');
    assert.equal(local.status, 200); assert.match(logs.at(-1), /本机/);
    const n = logs.length;
    const valid = await sourceRequest(f.app, C+'.80.1.2', { cookie: white.headers['set-cookie'].split(';')[0] });
    assert.equal(valid.status, 200); assert.equal(logs.length, n);
    assert.equal((await sourceRequest(f.app, '203.0.113.1', { 'x-forwarded-for': '127.0.0.1' })).status, 401);
    mode = 'different';
    assert.equal((await sourceRequest(f.app, C+'.80.1.3')).status, 401);
    mode = 'same';
    const same = await sourceRequest(f.app, C+'.80.1.4');
    assert.equal(same.status, 200); assert.match(logs.at(-1), /whois/);
    assert(logs.every(line => !line.includes('hub_web_session=') && !line.includes('offline-web-key')));
  } finally { await f.app.close(); }
});

test('r23：whois 缓存边界、失败仅缓存 30 秒，白名单权限与链接校验', async () => {
  const dir = await mkdtemp(join(scratch, 'r23-trust-'));
  const path = join(dir, 'trusted.json');
  await writeFile(path, JSON.stringify({ ips: [C+'.80.1.2'] }), { mode: 0o600 });
  let now = 0, count = 0, fail = false, different = false;
  const trust = createDeviceTrust({ HUB_WEB_TRUSTED_FILE: path, HUB_WEB_WHOIS_TARGET: 'self-node' }, {
    now: () => now,
    whois: async ip => { count++; if (fail) throw new Error('失败');
      return { UserProfile: { ID: different && ip !== 'self-node' ? 456 : 123 } }; } });
  assert.equal(await trust(C+'.80.1.2'), 'whois'); const initial = count;
  different = true; now = 599999; assert.equal(await trust(C+'.80.1.2'), 'whois'); assert.equal(count, initial);
  now = 600001; assert.equal(await trust(C+'.80.1.2'), null, '已查明异用户时不能退白名单');
  fail = true; now = 1200002; assert.equal(await trust(C+'.80.1.2'), '白名单');
  const failures = count;
  now += 29999; assert.equal(await trust(C+'.80.1.2'), '白名单'); assert.equal(count, failures);
  await chmod(path, 0o644); now += 2; assert.equal(await trust(C+'.80.1.2'), null);
  await chmod(path, 0o600); now += 30001; assert.equal(await trust(C+'.80.1.2'), '白名单');
  const link = join(dir, 'link.json'); await symlink(path, link);
  const broken = async () => { throw new Error('失败'); };
  assert.equal(await createDeviceTrust({ HUB_WEB_TRUSTED_FILE: link }, { whois: broken })(C+'.80.1.2'), null);
  await writeFile(path, '{bad json');
  assert.equal(await createDeviceTrust({ HUB_WEB_TRUSTED_FILE: path }, { whois: broken })(C+'.80.1.2'), null);
  for (const ip of [C+'.63.255.255', C+'.128.0.1', 'fd7a:115c:a1e1::1', '::1', '203.0.113.1']) {
    assert.equal(await trust(ip), null, ip);
  }
  different = false; fail = false;
  for (const ip of [C+'.64.0.1', C+'.127.255.254', 'fd7a:115c:a1e0::1']) assert.equal(await trust(ip), 'whois', ip);
  const malformed = createDeviceTrust({}, { whois: async () => ({ UserProfile: {} }) });
  assert.equal(await malformed(C+'.80.1.2'), null);
});
