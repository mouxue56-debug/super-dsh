import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProbe } from '../ops/kernel-contract-probe.mjs';

const script = fileURLToPath(new URL('../ops/kernel-contract-probe.mjs', import.meta.url));
const token = 'distinct-probe-token-98371';
const cookie = 'distinct-cookie-47291';
const env = {
  DSH_PROBE_CWD: '/probe', DSH_PROBE_PRESET: 'fake', DSH_PROBE_PROVIDER: 'fake-provider',
  DSH_PROBE_MODEL: 'fake-model', DSH_PROBE_EXPECT_BOOT_SLICE: '1',
  DSH_PROBE_POLL_MS: '5', DSH_PROBE_POLL_TIMEOUT_MS: '40',
};

function frame(value) {
  const data = Buffer.from(JSON.stringify(value));
  const header = data.length < 126 ? Buffer.from([129, data.length])
    : Buffer.from([129, 126, data.length >> 8, data.length & 255]);
  return Buffer.concat([header, data]);
}

function records(omitEnd) {
  const values = [
    ['user/message', { source: { kind: 'hub-boot-slice' } }],
    ['user/message', { source: { kind: 'user' } }],
    ['turn/start', {}],
    ['step/start', { turn: 0, step: 0 }],
    ['assistant/message', { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }],
    ...(!omitEnd ? [['turn/end', { reason: { kind: 'completed' } }]] : []),
  ];
  return values.map(([type, data], seq) => ({ event: { type, data, seq, time: 1 } }));
}

async function server(options = {}) {
  const calls = [];
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/connect?')) {
      res.statusCode = options.no302 ? 200 : 302;
      res.setHeader('location', './api/remote.mux');
      if (!options.noCookie) res.setHeader('set-cookie', `probe=${cookie}; HttpOnly`);
      res.end();
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    const endpoint = request.method;
    calls.push(endpoint);
    const values = {
      'session/list': { items: options.badList ? {} : [{ sessionId: 's', updatedAt: 1 }] },
      'session/modelCatalog': { default: options.badCatalog ? undefined : { provider: 'p', model: 'm' }, groups: [] },
      'session/create': { sessionId: 's' },
      'session/rename': {},
      'session/selectModel': {
        selected: { provider: 'fake-provider', model: options.badSelect ? 'other' : 'fake-model' },
      },
      'session/prompt': { accepted: !options.badPrompt },
      'session/events': { records: records(options.noEnd), hasMore: false, ...(!options.noCursor && { cursor: 5 }) },
      'session/cancel': { accepted: true },
    };
    const result = options.errorEndpoint === endpoint
      ? { ok: false, error: { code: 'BROKEN', message: token + cookie } }
      : { ok: true, value: values[endpoint] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result }));
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] +
      '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        let size = buffer[1] & 127;
        let offset = 2;
        if (size === 126) {
          if (buffer.length < 4) return;
          size = buffer.readUInt16BE(2);
          offset = 4;
        }
        if (size === 127 || buffer.length < offset + 4 + size) return;
        const mask = buffer.subarray(offset, offset + 4);
        const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + size));
        for (let i = 0; i < size; i++) payload[i] ^= mask[i % 4];
        const opcode = buffer[0] & 15;
        buffer = buffer.subarray(offset + 4 + size);
        if (opcode !== 1) continue;
        const message = JSON.parse(payload.toString());
        if (message.type !== 'open') continue;
        calls.push(message.endpoint);
        const value = message.endpoint === '$events' ? { type: 'ready', clientId: 'client' }
          : { type: 'snapshot', records: [], cursor: 0, hasMore: false };
        socket.write(frame({ type: 'item', streamId: message.streamId, value }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function cli(args, variables = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...variables } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function withServer(options, callback) {
  const fake = await server(options);
  try {
    await callback(fake);
  } finally {
    await fake.close();
  }
}

const status = (result, id) => result.rows.find(row => row.id === id).status;

test('只读模式符合契约且不写会话', async () => {
  await withServer({}, async fake => {
    const result = await runProbe({ url: fake.url, token, env });
    assert.equal(result.exitCode, 0);
    for (const id of ['P01', 'P02', 'P03', 'P04', 'P05']) assert.equal(status(result, id), '通过');
    for (const row of result.rows.slice(5)) assert.equal(row.status, '没法只读探');
    assert.deepEqual(fake.calls, ['session/list', 'session/modelCatalog']);
  });
});

test('会话模式全部符合契约', async () => {
  await withServer({}, async fake => {
    const result = await runProbe({ url: fake.url, token, env, withSession: true });
    assert.equal(result.exitCode, 0);
    assert.ok(result.rows.every(row => row.status === '通过'));
  });
});

for (const [name, options, id, withSession] of [
  ['连接状态', { no302: true }, 'P01', false],
  ['缺 cookie', { noCookie: true }, 'P01', false],
  ['模型默认值', { badCatalog: true }, 'P05', false],
  ['列表结构', { badList: true }, 'P04', false],
  ['游标', { noCursor: true }, 'S03', true],
  ['模型选择', { badSelect: true }, 'S05', true],
  ['请求接收', { badPrompt: true }, 'S06', true],
  ['回合结束', { noEnd: true }, 'S07', true],
  ['RPC 错误', { errorEndpoint: 'session/rename' }, 'S02', true],
]) {
  test(`破坏${name}`, async () => {
    await withServer(options, async fake => {
      const result = await runProbe({ url: fake.url, token, env, withSession });
      assert.equal(result.exitCode, 1);
      assert.equal(status(result, id), '缺失');
      if (id !== 'P01') assert.equal(status(result, 'P01'), '通过');
      if (id.startsWith('S')) assert.equal(status(result, 'P06'), '通过');
      assert.ok(!JSON.stringify(result).includes(token));
      assert.ok(!JSON.stringify(result).includes(cookie));
    });
  });
}

test('命令行脱敏与参数校验', async () => {
  await withServer({}, async fake => {
    for (const args of [[fake.url], [fake.url, '--json'], [fake.url, '--token', token]]) {
      const result = await cli(args, { DSH_PROBE_TOKEN: token });
      assert.equal(result.code, args.includes('--token') ? 2 : 0);
      assert.ok(!result.stdout.includes(token) && !result.stderr.includes(token));
      assert.ok(!result.stdout.includes(cookie) && !result.stderr.includes(cookie));
    }
    const noToken = await cli([fake.url], { DSH_PROBE_TOKEN: '' });
    assert.equal(noToken.code, 2);
    const missing = await cli([fake.url, '--with-session'], { DSH_PROBE_TOKEN: token, DSH_PROBE_CWD: '' });
    assert.equal(missing.code, 2);
    assert.ok(!fake.calls.includes('session/create'));
    for (const url of ['http://user:pass@localhost', `${fake.url}?a=b`]) {
      assert.equal((await cli([url], { DSH_PROBE_TOKEN: token })).code, 2);
    }
  });
});

test('无法连接时退出 2', async () => {
  const fake = await server();
  await fake.close();
  const result = await cli([fake.url], { DSH_PROBE_TOKEN: token });
  assert.equal(result.code, 2);
  assert.ok(!result.stderr.includes(token));
});
