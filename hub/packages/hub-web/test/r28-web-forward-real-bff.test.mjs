// 路37 补验：网页层对后端各组路径的转发，后面接的是真的后端处理器（server.mjs 的 createHandler，
// 内核换成内存假内核），不是假的转发目标。每一条都和「直接带钥匙打后端」的结果逐项对照。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHubWeb, EXT_PREFIXES } from '../server.mjs';
import { realDeps, autoReply } from '../../hub-bff/test/real-deps.mjs';

const BFF_KEY = 'synthetic-bff-key';
const WEB_KEY = 'web-r28-test';
const scratch = fileURLToPath(new URL('./scratch/', import.meta.url));

// 起真后端（HTTP 监听）和前面的网页层，返回带 cookie 的访问器。
async function setup() {
  const env = await realDeps({ handlerOptions: { hubConfig: { timezone: 'Asia/Tokyo',
    meetings: { times: {}, kb: { kbAgentPath: '/usr/bin/false' } }, routines: { items: [{ id: 'daily-post',
      name: '日更', assistant: 'content', at: '07:30', prompt: '写一篇', done: '放到目录',
      escape: { maxSteps: 1, maxMinutes: 5 } }] } } } });
  autoReply(env.f.source, () => '今天学到：先核对再记录。');
  await env.f.handler.start();
  const bff = http.createServer((req, res) => { void env.f.handler(req, res); });
  await new Promise(resolve => bff.listen(0, '127.0.0.1', resolve));
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'r28-'));
  await mkdir(join(dir, 'shell'));
  await writeFile(join(dir, 'shell', 'index.html'), '<html><body>离线壳</body></html>');
  await writeFile(join(dir, 'web.key'), WEB_KEY, { mode: 0o600 });
  await writeFile(join(dir, 'bff.key'), BFF_KEY, { mode: 0o600 });
  const bffUrl = `http://127.0.0.1:${bff.address().port}`;
  const web = await createHubWeb({ HUB_WEB_PORT: '0', HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: join(dir, 'shell'),
    HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'), BFF_URL: bffUrl },
  { log: () => assert.fail('unexpected trust log') });
  const url = `http://127.0.0.1:${web.servers[0].address().port}`;
  const login = await fetch(`${url}/?key=${WEB_KEY}`, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  // 经网页层：带设备 cookie 和同源 Origin。
  const viaWeb = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const jsonHead = body === undefined ? {} : { 'content-type': 'application/json' };
    const res = await fetch(url + '/bff' + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { cookie, origin: url, ...jsonHead, ...headers } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 也如实返回 */ }
    return { status: res.status, json, text };
  };
  // 直连后端：只带钥匙。
  const direct = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(bffUrl + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'x-hub-bff-key': BFF_KEY, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 同上 */ }
    return { status: res.status, json, text };
  };
  return { env, url, cookie, viaWeb, direct, bffUrl, async close() {
    await web.close();
    await new Promise(resolve => bff.close(resolve));
    bff.closeAllConnections?.();
    await env.f.dispose();
  } };
}

test('r28 五组路径经网页层读到的内容，和直连后端逐项一致', async () => {
  const s = await setup();
  try {
    const paths = ['/groups', '/meetings/status', '/meetings/today', '/panic/status', '/routines', '/routines/runs',
      '/today', '/ledger', '/board/tickets'];
    for (const path of paths) {
      const web = await s.viaWeb(path);
      const direct = await s.direct(path);
      assert.equal(web.status, direct.status, `${path} 状态码不一致：网页 ${web.status}，直连 ${direct.status}`);
      assert.notEqual(web.status, 401, `${path} 钥匙没被网页层带上`);
      // 「今天」里的生成时刻每次都不同，其余逐字相同。
      const same = text => text.replace(/"generatedAt":"[^"]*",?/u, '');
      assert.equal(same(web.text), same(direct.text), `${path} 内容不一致`);
    }
    assert.deepEqual(EXT_PREFIXES.filter(p => !['board', 'ledger', 'groups', 'meetings', 'models', 'panic',
      'routines', 'today'].includes(p)), []);
  } finally {
    await s.close();
  }
});

test('r28 网页层把「开晚会」「全停」「恢复」「手动跑固定任务」真的转到后端并生效', async () => {
  const s = await setup();
  try {
    const status = async () => (await s.direct('/panic/status')).json;
    const stop = await s.viaWeb('/panic/stop', { method: 'POST', body: { reason: 'r28 网页层补验' } });
    assert.equal(stop.status, 200, stop.text);
    const stopped = await status();
    assert.equal(JSON.stringify(stopped).includes('stopped'), true, '后端应已进入停机态：' + JSON.stringify(stopped));
    const run = await s.viaWeb('/routines/daily-post/run', { method: 'POST', body: {} });
    // 修 E 之后：全停期间手动跑回 503 与 stopped（路 37 当时记的是 200 与 failed）。
    assert.equal(run.status, 503, run.text);
    assert.equal(run.json.state, 'stopped', '全停期间固定任务不能跑：' + run.text);
    const resume = await s.viaWeb('/panic/resume', { method: 'POST', body: {} });
    assert.equal(resume.status, 200, resume.text);
    const done = await s.viaWeb('/routines/daily-post/run', { method: 'POST', body: {} });
    assert.equal(done.status, 200, done.text);
    assert.notEqual(done.json.state, 'failed', '恢复后手动跑应能跑：' + done.text);
    assert.equal((await s.viaWeb('/routines/no-such-one/run', { method: 'POST', body: {} })).status, 404);
    const meeting = await s.viaWeb('/meetings/run', { method: 'POST', body: { type: 'evening' } });
    assert.equal(meeting.status, 200, meeting.text);
    assert.ok(meeting.json.file, '开晚会应返回纪要文件');
    const minutes = await s.viaWeb('/meetings/today');
    assert.ok(minutes.json.minutes.some(row => row.type === 'evening'), '后端今天的纪要里应有晚会');
    const pause = await s.viaWeb('/routines/pause', { method: 'POST', body: {} });
    assert.equal(pause.status, 200);
    assert.equal((await s.direct('/routines')).json.paused ?? (await s.direct('/routines')).text.includes('true'),
      true);
    await s.viaWeb('/routines/resume', { method: 'POST', body: {} });
  } finally {
    await s.close();
  }
});

test('r28 设备头：网页层替换成自己算的，批准类接口因此认得出设备', async () => {
  const s = await setup();
  try {
    const noDevice = await s.direct('/meetings/cards/draft-not-exist-1/approve', { method: 'POST', body: {} });
    assert.equal(noDevice.status, 403, '直连不带设备头必须被拒');
    const forged = await s.viaWeb('/meetings/cards/draft-not-exist-1/approve', { method: 'POST', body: {},
      headers: { 'x-hub-device': 'forged' } });
    assert.equal(forged.status, 404, '经网页层带着网页层算的设备头，应进到「找不到这张卡」：' + forged.text);
    const reject = await s.viaWeb('/meetings/cards/draft-not-exist-1/reject', { method: 'POST', body: {} });
    assert.equal(reject.status, 404);
  } finally {
    await s.close();
  }
});

test('r28 外包派工不进网页层；没有设备 cookie 或没有同源 Origin 的写请求到不了后端', async () => {
  const s = await setup();
  try {
    const direct = await s.direct('/dispatch/runs');
    assert.notEqual(direct.status, 404, '直连后端的外包扩展应存在');
    const web = await s.viaWeb('/dispatch/runs');
    assert.notEqual(web.status, 200, '外包路径不应经网页层到达后端的外包扩展');
    assert.ok(!web.text.includes('"runs"'), '不应拿到外包运行列表：' + web.text);
    const before = JSON.stringify((await s.direct('/panic/status')).json);
    const noCookie = await fetch(s.url + '/bff/panic/stop', { method: 'POST', headers: { origin: s.url,
      'content-type': 'application/json' }, body: '{}' });
    assert.ok([401, 403].includes(noCookie.status), '无 cookie 写请求状态：' + noCookie.status);
    const noOrigin = await fetch(s.url + '/bff/panic/stop', { method: 'POST', headers: { cookie: s.cookie,
      'content-type': 'application/json' }, body: '{}' });
    assert.equal(noOrigin.status, 403);
    const crossOrigin = await fetch(s.url + '/bff/panic/stop', { method: 'POST', headers: { cookie: s.cookie,
      origin: 'https://other.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(crossOrigin.status, 403);
    await delay(50);
    assert.equal(JSON.stringify((await s.direct('/panic/status')).json), before, '被拒的写请求不能改变后端状态');
    assert.equal((await fetch(s.url + '/bff/routines')).status, 401, '读也要有设备 cookie');
  } finally {
    await s.close();
  }
});

test('r28 网页层对路径穿越和前缀相似的路径不误转', async () => {
  const s = await setup();
  try {
    for (const path of ['/bff/todayx', '/bff/panic-old/status', '/bff/routinesx']) {
      const res = await fetch(s.url + path, { headers: { cookie: s.cookie } });
      assert.notEqual(res.status, 200, `${path} 不该读到扩展内容`);
    }
    // 原样发出（不让客户端先折叠 ..）：带编码的点或原始的 .. 都必须被挡在转发之外。
    for (const raw of ['/bff/panic/%2e%2e/routines', '/bff/panic/../routines', '/bff/today%2fx']) {
      const status = await new Promise((ok, fail) => {
        const req = http.request({ host: '127.0.0.1', port: new URL(s.url).port, path: raw, method: 'GET',
          headers: { cookie: s.cookie } }, res => { res.resume(); ok(res.statusCode); });
        req.on('error', fail);
        req.end();
      });
      assert.equal(status, 404, `${raw} 应被拒绝，实际 ${status}`);
    }
  } finally {
    await s.close();
  }
});
