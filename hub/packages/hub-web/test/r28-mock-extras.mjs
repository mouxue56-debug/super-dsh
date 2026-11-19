import { createHash } from 'node:crypto';

const text = ('分工全文 <b>粗体</b>\n第二行\n').repeat(1000);
const digest = createHash('sha256').update(text).digest('hex');
const bucket = { calls: 3, tokens: { input: 1000, output: 234 }, cost: { localCalls: 3 } };
const routine = { id: 'daily-post', name: '固定任务 <b>日更</b>', assistant: 'chief', at: '07:30',
  days: 'daily', todayState: 'reported' };
const minutes = { type: 'evening', text: '晚会纪要 <b>记录</b>\n第二行' };
const tickets = ['queued', 'progress', 'review', 'completed', 'failed'].map((state, i) => ({
  id: i === 0 ? 'old-ticket' : 'T-20261118-' + i,
  title: '看板工单 <b>' + state + '</b>',
  state: state === 'review' ? 'progress' : state,
  review: state === 'review' ? 'submitted' : '',
  from: { name: 'chief' },
  claimedBy: 'chief'
}));
const defaults = {
  board: { tickets },
  ledger: { total: bucket, byBot: { chief: bucket }, byTicket: { 'T-20261118-1': bucket },
    last7Days: { days: [{ date: '2026-11-18', total: bucket }] }, counts: { approvals: 1 } },
  ledgerToday: { total: bucket },
  ledgerSession: bucket,
  today: { date: '2026-11-18', approvals: { available: true,
    cards: [{ assistant: 'chief', title: '今日待办 <b>确认</b>' }] },
    lastEveningMinutes: { available: true, date: '2026-11-17', text: minutes.text },
    routines: { available: true, items: [routine] } },
  routines: { enabled: true, paused: false, items: [routine] },
  meetingStatus: { times: { morning: '09:00', evening: '21:00' }, today: { evening: true }, running: [] },
  meetingToday: { date: '2026-11-18', minutes: [minutes] },
  meetingMinutes: minutes,
  rules: { shared: ['共享规矩 <b>确认</b>'], bots: [{ id: 'chief', lines: ['助理规矩 <b>核对</b>'] }] },
  models: { enabled: true, default: 'mock/model',
    options: [{ ref: 'mock/model', name: '模型 <b>本地</b>', selectable: true }] },
  groups: { groups: [{ id: 'group-one', name: '讨论组 <b>协作</b>', host: 'chief',
    members: ['chief', 'pm'], status: 'active', lastText: '第三条讨论' }] },
  groupMessages: { messages: [1, 2, 3].map(seq => ({ seq, from: 'chief', text: '讨论 <b>' + seq + '</b>' })) },
  fulltext: { digest, text }
};

// 在既有假后端前挂接扩展路由，未命中时交回原处理器。
export function attachExtras(fake) {
  const old = fake.server.listeners('request')[0];
  let mode = 'data';
  let overrides = {};
  let panic = 'running';
  const messages = structuredClone(defaults.groupMessages.messages);
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  fake.server.removeAllListeners('request');
  fake.server.on('request', async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const bare = url.pathname;
    const path = /^\/(board|ledger|groups|meetings|models|panic|routines|today|rules)(?:\/|$)/.test(bare)
      ? '/bff' + bare : bare;
    if (path === '/bff/__ext' && req.method === 'POST') {
      try {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw || '{}');
        if (['data', 'empty', 'error'].includes(body.mode)) mode = body.mode;
        if (body.set && typeof body.set === 'object') overrides = { ...overrides, ...body.set };
        if (body.seedCards) {
          fake.seedCard({ id: 'ext-confirm', type: 'approval', tool: 'confirm', confirm: true,
            title: '分工表确认', text: '卡上摘要', fullText: digest, status: 'pending',
            sessionId: 'chief-latest', bot: 'chief' });
          const attack = '<img src=x onerror=window.__xss=1>';
          fake.seedCard({ id: 'ext-xss', type: 'approval', tool: 'write', title: attack,
            preview: attack, status: 'pending', sessionId: 'chief-latest', bot: 'chief' });
        }
        return json(res, 200, { ok: true, mode });
      } catch {
        return json(res, 400, { error: '无效数据' });
      }
    }
    const routes = [
      ['board', /^\/bff\/board\/tickets$/], ['ledger', /^\/bff\/ledger$/],
      ['ledgerToday', /^\/bff\/ledger\/today$/], ['ledgerSession', /^\/bff\/ledger\/session\/[^/]+$/],
      ['today', /^\/bff\/today$/], ['panic', /^\/bff\/panic\/(status|stop|resume)$/],
      ['routines', /^\/bff\/routines(?:\/(?:[^/]+\/)?(?:pause|resume|run))?$/],
      ['meetingStatus', /^\/bff\/meetings\/status$/], ['meetingToday', /^\/bff\/meetings\/today$/],
      ['meetingMinutes', /^\/bff\/meetings\/minutes$/], ['meetingRun', /^\/bff\/meetings\/run$/],
      ['rules', /^\/bff\/rules$/], ['models', /^\/bff\/models\/bots\/[^/]+$/],
      ['groups', /^\/bff\/groups$/], ['groupMessages', /^\/bff\/groups\/[^/]+(?:\/messages)?$/],
      ['fulltext', /^\/bff\/fulltext\/[a-f0-9]{64}$/]
    ];
    const match = routes.find(([, pattern]) => pattern.test(path));
    if (!match) return old(req, res);
    const key = match[0];
    fake.stats.headers.push({ path, device: req.headers['x-hub-device'] });
    if (req.method === 'POST' && !req.headers['x-hub-device']) return json(res, 403, {});
    if (mode !== 'data') return json(res, mode === 'empty' ? 404 : 500, {});
    if (req.method === 'POST') {
      if (key === 'panic') {
        if (path.endsWith('/status')) return json(res, 405, {});
        panic = path.endsWith('/stop') ? 'stopped' : 'running';
        return json(res, 200, { state: panic, steps: {} });
      }
      if (key === 'routines') {
        if (path.endsWith('/routines')) return json(res, 405, {});
        const action = path.split('/').at(-1);
        return json(res, 200, { state: { pause: 'paused', resume: 'resumed', run: 'reported' }[action] });
      }
      if (key === 'meetingRun') return json(res, 200, { file: 'minutes.md', cards: [] });
      if (key === 'groupMessages' && path.endsWith('/messages')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try {
          const input = JSON.parse(raw || '{}');
          const message = { seq: messages.length + 1, from: 'user', text: String(input.text || '') };
          messages.push(message);
          return json(res, 200, { ok: true, message });
        } catch {
          return json(res, 400, {});
        }
      }
      return json(res, 405, {});
    }
    if (req.method !== 'GET') return json(res, 405, {});
    if (key === 'panic' && !path.endsWith('/status')) return json(res, 405, {});
    if (key === 'routines' && !path.endsWith('/routines')) return json(res, 405, {});
    if (key === 'meetingRun' || key === 'groupMessages' && path.endsWith('/messages')) {
      return json(res, 405, {});
    }
    if (key === 'panic') return json(res, 200, overrides.panic ?? { state: panic, steps: {} });
    if (key === 'fulltext' && path.split('/').at(-1) !== digest) return json(res, 404, {});
    if (key === 'groupMessages' && !overrides.groupMessages) {
      const after = Number(url.searchParams.get('after') || 0);
      return json(res, 200, { messages: messages.filter(message => message.seq > after) });
    }
    return json(res, 200, overrides[key] ?? defaults[key] ?? {});
  });
}
