import { randomUUID } from 'node:crypto';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import { NodeWebSocket } from '../../hub-bff/lib/websocket.mjs';

const points = {
  P01: '连接换取', P02: 'mux 升级', P03: 'RPC 信封', P04: 'session/list',
  P05: 'session/modelCatalog', P06: '$events 就绪流', S01: 'session/create',
  S02: 'session/rename', S03: 'session/events', S04: 'session/follow',
  S05: 'session/selectModel', S06: 'session/prompt', S07: '事件类型与字段',
  S08: 'session/cancel', S09: '开工切片注入',
};
const skipped = '要建会话/收发事件，只读做不到';
const validString = value => typeof value === 'string' && value.length > 0;
const has = (object, key) => object != null && Object.hasOwn(object, key);

function address(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      parsed.search || parsed.hash || value.includes('?') || value.includes('#')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeCode(value) {
  return typeof value === 'string' && /^[A-Z0-9_]{1,60}$/.test(value) ? value : 'UNKNOWN';
}

function connectSocket(factory, url, cookie, timeout) {
  return new Promise((resolve, reject) => {
    let socket;
    let timer;
    const done = error => {
      clearTimeout(timer);
      socket?.off('open', opened);
      socket?.off('close', closed);
      error ? reject(error) : resolve(socket);
    };
    const opened = () => done();
    const closed = () => done(new Error('socket'));
    try {
      socket = factory(url, cookie, timeout);
      socket.on('failure', () => {});
      socket.once('open', opened);
      socket.once('close', closed);
      timer = setTimeout(() => {
        socket.close();
        done(new Error('timeout'));
      }, timeout);
      if (socket.readyState === 1) done();
      if (socket.readyState === 3) closed();
    } catch {
      socket?.close();
      done(new Error('socket'));
    }
  });
}

function firstFrame(socket, endpoint, args, timeout, keepOpen = false) {
  return new Promise(resolve => {
    const streamId = randomUUID();
    let timer;
    const finish = value => {
      clearTimeout(timer);
      socket.off('message', receive);
      socket.off('close', closed);
      try {
        if (!keepOpen && socket.readyState === 1) socket.send(JSON.stringify({ type: 'cancel', streamId }));
      } catch {}
      resolve(value);
    };
    const closed = () => finish(null);
    const receive = bytes => {
      try {
        const frame = JSON.parse(String(bytes));
        if (frame.streamId === streamId) finish(frame.type === 'item' ? frame.value : null);
      } catch {
        finish(null);
      }
    };
    socket.on('message', receive);
    socket.once('close', closed);
    timer = setTimeout(() => finish(null), timeout);
    try {
      socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
    } catch {
      finish(null);
    }
  });
}

// 探测远程内核契约，并返回逐项结果。
export async function runProbe({
  url, token, withSession = false, fetchImpl = globalThis.fetch, socketFactory,
  env = process.env, now = () => Date.now(), timeoutMs = 10000,
} = {}) {
  const base = address(url);
  const required = ['DSH_PROBE_CWD', 'DSH_PROBE_PRESET', 'DSH_PROBE_PROVIDER', 'DSH_PROBE_MODEL'];
  if (!base || !validString(token) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
    (withSession && required.some(key => !validString(env[key])))) return { rows: [], exitCode: 2 };
  const pollMs = Number(env.DSH_PROBE_POLL_MS ?? 100);
  const pollTimeout = Number(env.DSH_PROBE_POLL_TIMEOUT_MS ?? 20000);
  if (withSession && (!Number.isFinite(pollMs) || pollMs <= 0 || !Number.isFinite(pollTimeout) ||
    pollTimeout <= 0)) return { rows: [], exitCode: 2 };
  const factory = socketFactory ?? ((target, cookie, timeout) => target.protocol === 'https:'
    ? new NodeWebSocket(target, cookie, timeout, https.request) : new NodeWebSocket(target, cookie, timeout));
  const rows = Object.entries(points).map(([id, point]) => ({ id, point, status: '没法只读探', detail: skipped }));
  const set = (id, status, detail) => Object.assign(rows.find(row => row.id === id), { status, detail });
  let cookie = '';
  let socket;
  let answerSocket;
  let unreachable = false;
  const fetchTimed = (target, options) => fetchImpl(target, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const exchange = async interactions => {
    const target = new URL('/connect', base);
    target.searchParams.set('token', token);
    target.searchParams.set('interactions', interactions);
    let response;
    try {
      response = await fetchTimed(target, { redirect: 'manual' });
    } catch {
      unreachable = true;
      return null;
    }
    const cookies = response.headers.getSetCookie?.() ?? [];
    await response.body?.cancel();
    if (response.status !== 302 || response.headers.get('location') !== './api/remote.mux' || !cookies.length) {
      return null;
    }
    return cookies.map(value => value.split(';', 1)[0]).join('; ');
  };
  const rpc = async (endpoint, args) => {
    const rpcId = randomUUID();
    try {
      const response = await fetchTimed(new URL('/api/' + endpoint, base), {
        method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        return { error: `HTTP_${response.status}`, envelope: false };
      }
      const body = await response.json();
      const envelope = body?.type === 'server-response' && body.rpcId === rpcId &&
        typeof body.result?.ok === 'boolean';
      if (!envelope) return { error: 'INVALID_ENVELOPE', envelope: false };
      if (!body.result.ok) return { error: safeCode(body.result.error?.code), envelope: true };
      return { value: body.result.value, envelope: true };
    } catch {
      return { error: 'UNAVAILABLE', envelope: false };
    }
  };
  const failure = (id, endpoint, result) => set(id, '缺失', `${endpoint}: ${result.error ?? 'INVALID_VALUE'}`);
  try {
    cookie = (await exchange('none')) ?? '';
    if (!cookie) {
      set('P01', '缺失', '连接换取不符合契约');
      return { rows, exitCode: unreachable ? 2 : 1 };
    }
    set('P01', '通过', '连接换取符合契约');
    try {
      socket = await connectSocket(factory, new URL('/api/remote.mux', base), cookie, timeoutMs);
      set('P02', '通过', '升级成功');
    } catch {
      set('P02', '缺失', '升级失败');
    }
    const list = await rpc('session/list', { _request: {} });
    set('P03', list.envelope ? '通过' : '缺失',
      list.envelope ? '信封符合契约' : 'session/list: INVALID_ENVELOPE');
    const items = list.value?.items;
    const listOk = Array.isArray(items) && items.every(item => typeof item?.sessionId === 'string' &&
      has(item, 'updatedAt') && (!has(item.projections?.values, 'title') ||
      typeof item.projections.values.title === 'string'));
    if (list.error || !listOk) failure('P04', 'session/list', list);
    else set('P04', '通过', '列表符合契约');
    const catalog = await rpc('session/modelCatalog', {});
    const data = catalog.value;
    const catalogOk = validString(data?.default?.provider) && validString(data?.default?.model) &&
      Array.isArray(data?.groups) && data.groups.every(group => has(group, 'id') && Array.isArray(group.models)) &&
      (!has(data, 'failures') || Array.isArray(data.failures));
    if (catalog.error || !catalogOk) failure('P05', 'session/modelCatalog', catalog);
    else set('P05', '通过', '模型目录符合契约');
    if (!withSession || !socket) {
      if (!socket) {
        for (const row of rows.filter(item => /^(S|P06)/.test(item.id))) row.detail = '依赖 mux 升级，已跳过';
      }
      return { rows, exitCode: rows.some(row => row.status === '缺失') ? 1 : 0 };
    }
    const skip = (ids, reason) => ids.forEach(id => set(id, '没法只读探', `依赖 ${reason}，已跳过`));
    let sessionId;
    let proceed = true;
    if (!catalogOk || catalog.error) {
      skip(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'], '模型目录');
      proceed = false;
    }
    if (proceed) {
      const request = { cwd: env.DSH_PROBE_CWD, agentPreset: env.DSH_PROBE_PRESET };
      const result = await rpc('session/create', { request });
      sessionId = result.value?.sessionId;
      if (result.error || typeof sessionId !== 'string') {
        failure('S01', 'session/create', result);
        skip(['S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'], 'session/create');
        proceed = false;
      } else set('S01', '通过', '会话已创建');
    }
    if (proceed) {
      const result = await rpc('session/rename', { request: { sessionId, title: 'probe' } });
      if (result.error) {
        failure('S02', 'session/rename', result);
        skip(['S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'], 'session/rename');
        proceed = false;
      } else set('S02', '通过', '重命名成功');
    }
    if (proceed) {
      const request = { sessionId, provider: env.DSH_PROBE_PROVIDER, model: env.DSH_PROBE_MODEL };
      const result = await rpc('session/selectModel', { request });
      if (result.error || result.value?.selected?.provider !== request.provider ||
        result.value?.selected?.model !== request.model) {
        failure('S05', 'session/selectModel', result);
        skip(['S03', 'S04', 'S06', 'S07', 'S08', 'S09'], 'session/selectModel');
        proceed = false;
      } else {
        const after = await rpc('session/modelCatalog', {});
        const changed = after.value?.default && (after.value.default.provider !== data.default.provider ||
          after.value.default.model !== data.default.model);
        if (after.error || !after.value?.default) {
          failure('S05', 'session/modelCatalog', after);
          skip(['S03', 'S04', 'S06', 'S07', 'S08', 'S09'], 'session/modelCatalog');
          proceed = false;
        } else set('S05', '通过', changed ? '内核选模型改了全局默认' : '选择结果符合契约');
      }
    }
    if (proceed) {
      const request = { address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 200 };
      const frame = await firstFrame(socket, 'session/follow', { request }, timeoutMs, true);
      if (frame?.type !== 'snapshot' || !Array.isArray(frame.records) || !has(frame, 'cursor') ||
        !has(frame, 'hasMore')) {
        set('S04', '缺失', 'session/follow: INVALID_SNAPSHOT');
        skip(['S03', 'S06', 'S07', 'S08', 'S09'], 'session/follow');
        proceed = false;
      } else set('S04', '通过', '快照符合契约');
    }
    if (proceed) {
      const request = { sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'PROBE' }] };
      const result = await rpc('session/prompt', { request });
      if (result.error || result.value?.accepted !== true) {
        failure('S06', 'session/prompt', result);
        skip(['S03', 'S07', 'S08', 'S09'], 'session/prompt');
        proceed = false;
      } else set('S06', '通过', '请求已接收');
    }
    if (proceed) {
      const deadline = now() + pollTimeout;
      let records = [];
      let valid = true;
      let ended = false;
      do {
        const request = { address: { kind: 'session', sessionId }, maxMessages: 200 };
        const result = await rpc('session/events', { request });
        const value = result.value;
        valid = !result.error && Array.isArray(value?.records) && has(value, 'cursor') && has(value, 'hasMore') &&
          value.records.every(({ event } = {}) => typeof event?.type === 'string' &&
            Number.isSafeInteger(event.seq) && event.seq >= 0 && has(event, 'time'));
        if (!valid) {
          failure('S03', 'session/events', result);
          break;
        }
        records = value.records;
        ended = records.some(row => row.event.type === 'turn/end');
        if (!ended && now() < deadline) await new Promise(resolve => setTimeout(resolve, pollMs));
      } while (!ended && now() < deadline);
      if (valid) set('S03', '通过', '事件记录符合契约');
      if (!valid) skip(['S07', 'S09'], 'session/events');
      else {
        const events = records.map(row => row.event);
        const checks = {
          'user/message': e => e.data?.source?.kind === 'user',
          'turn/start': () => true,
          'step/start': e => has(e.data, 'turn') && has(e.data, 'step'),
          'assistant/message': e => ['inputTokens', 'outputTokens', 'totalTokens']
            .every(key => typeof e.data?.usage?.[key] === 'number'),
          'turn/end': e => has(e.data?.reason, 'kind'),
        };
        const missing = Object.entries(checks).filter(([type, check]) =>
          !events.some(event => event.type === type && check(event))).map(([type]) => type);
        set('S07', missing.length ? '缺失' : '通过',
          missing.length ? `缺少或字段不符: ${missing.join(', ')}` : '事件符合契约');
        const boot = events.some(event => event.type === 'user/message' &&
          event.data?.source?.kind === 'hub-boot-slice');
        set('S09', boot ? '通过' : env.DSH_PROBE_EXPECT_BOOT_SLICE === '1' ? '缺失' : '没法只读探',
          boot ? '已发现开工切片' : '预设可能没挂 hub 插件');
      }
      const result = await rpc('session/cancel', { request: { sessionId } });
      if (result.error || result.value?.accepted !== true) failure('S08', 'session/cancel', result);
      else set('S08', '通过', '取消请求已接收');
    }
    const answerCookie = await exchange('answer');
    if (!answerCookie) set('P06', '缺失', '$events: CONNECT_FAILED');
    else {
      try {
        answerSocket = await connectSocket(factory, new URL('/api/remote.mux', base), answerCookie, timeoutMs);
        const ready = await firstFrame(answerSocket, '$events', {}, timeoutMs);
        const readyOk = ready?.type === 'ready' && typeof ready.clientId === 'string';
        set('P06', readyOk ? '通过' : '缺失', readyOk ? '就绪帧符合契约' : '$events: INVALID_READY');
      } catch {
        set('P06', '缺失', '$events: CONNECT_FAILED');
      }
    }
    return { rows, exitCode: rows.some(row => row.status === '缺失') ? 1 : 0 };
  } finally {
    socket?.close();
    answerSocket?.close();
    const secrets = [token, cookie, ...cookie.split(/;\s*/).map(part => part.split('=').slice(1).join('='))]
      .filter(Boolean);
    for (const row of rows) {
      for (const secret of secrets) row.detail = row.detail.split(secret).join('[已脱敏]');
    }
  }
}

function display(rows) {
  const columns = ['编号', '依赖点', '结果', '说明'];
  const values = rows.map(row => [row.id, row.point, row.status, row.detail]);
  const width = text => [...text].reduce((sum, char) => sum + (char.codePointAt(0) > 255 ? 2 : 1), 0);
  const sizes = columns.map((name, index) => Math.max(width(name), ...values.map(row => width(row[index]))));
  return [columns, ...values].map(row => row.map((value, index) =>
    value + ' '.repeat(sizes[index] - width(value))).join('  ').trimEnd()).join('\n');
}

// 读取命令行参数并输出探测结果。
export async function main(argv = process.argv.slice(2), env = process.env) {
  const invalidToken = argv.some(arg => /^--token(?:=|$)/i.test(arg));
  const flags = argv.filter(arg => arg.startsWith('--'));
  const positional = argv.filter(arg => !arg.startsWith('--'));
  if (invalidToken || flags.some(arg => !['--with-session', '--json'].includes(arg)) || positional.length > 1) {
    process.stderr.write('参数错误；令牌请通过 DSH_PROBE_TOKEN 环境变量提供。\n');
    return 2;
  }
  const result = await runProbe({ url: positional[0] ?? env.DSH_PROBE_URL, token: env.DSH_PROBE_TOKEN,
    withSession: flags.includes('--with-session'), env });
  if (!result.rows.length) {
    process.stderr.write('地址、令牌或会话环境变量无效。\n');
    return 2;
  }
  process.stdout.write((flags.includes('--json') ? JSON.stringify(result, null, 2) : display(result.rows)) + '\n');
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write('探测失败。\n');
    process.exitCode = 2;
  });
}
