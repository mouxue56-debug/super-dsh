// 站台桌宠：台词类别、会话条、刚做完的一句、夜里不发声。端口 3762、3763，跑完关掉。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHubWeb } from '../server.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(new URL('../hub-real.js', import.meta.url), 'utf8');
const bookPath = new URL('../defaults/stage-lines.json', import.meta.url);
const book = JSON.parse(readFileSync(bookPath, 'utf8'));
const shellFile = process.env.HUB_SHELL_DIST || '';
const shellSkip = shellFile && existsSync(shellFile) ? false : '未设置 HUB_SHELL_DIST 或文件不在，跳过走查';
const WEB = 'web-r29d-y7';
const BFF = 'bff-r29d-y7';
const BFF_PORT = 3762;
const WEB_PORT = 3763;
const IDS = ['aa', 'ab', 'ac', 'ad', 'ae', 'af'];
const NAMES = ['甲', '乙', '丙', '丁', '戊', '己'];
const DUTY = {
  aa: '总管排期', ab: '调研资料', ac: '写作改稿',
  ad: '推进交付', ae: '视觉出图', af: '咨询预约'
};
const KIND = {
  aa: '总管', ab: '调研', ac: '写作', ad: '推进', ae: '视觉', af: '咨询'
};
const STATES = ['闲着', '在想', '在干活', '做完', '出错', '被戳', '被摸', '被甩晕', '被哄好', '犯困', '早上', '夜里'];
const MALICIOUS = '<img src=x onerror=alert(1)>周报';
// 含标签样子的标题整条拒绝（复核 10 第 16 项），台词只用另一条干净标题。
const SAID = '刚把周报做完了';
const NIGHT_LINE = '夜深了，我小声守着';

function playwrightCore() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const root = join(homedir(), '.npm', '_npx');
  if (!existsSync(root)) return '';
  for (const name of readdirSync(root)) {
    const dir = join(root, name, 'node_modules', 'playwright-core');
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return '';
}

function chromiumBin() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = join(homedir(), 'Library', 'Caches', 'ms-playwright', 'chromium_headless_shell-1243');
  const bin = join(root, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
  return existsSync(bin) ? bin : '';
}

function embeddedBook() {
  const start = source.indexOf('/* r29-stage-book:start */');
  const end = source.indexOf('/* r29-stage-book:end */');
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  const parts = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = re.exec(block))) parts.push(JSON.parse('"' + match[1] + '"'));
  assert.ok(parts.length > 1);
  return JSON.parse(parts.join(''));
}

test('台词表七类十二态，并和适配层里的副本一致', () => {
  assert.deepEqual(Object.keys(book), ['总管', '调研', '写作', '推进', '视觉', '咨询', '通用']);
  for (const name of Object.keys(book)) {
    assert.deepEqual(Object.keys(book[name]), STATES, name);
    for (const state of STATES) {
      const lines = book[name][state];
      assert.ok(lines.length >= 3 && lines.length <= 5, name + state);
      for (const line of lines) {
        assert.equal(typeof line, 'string');
        assert.ok(line.trim().length > 0);
        assert.ok(Array.from(line).length <= 20, line);
        assert.equal(/[<>&]/.test(line), false, line);
      }
    }
  }
  assert.deepEqual(embeddedBook(), book);
  const regionStart = source.indexOf('/* r29-stage-book:start */');
  const regionEnd = source.indexOf('function r29CorrectDrift', regionStart);
  const region = source.slice(regionStart, regionEnd);
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|eval\(/.test(region), false);
  assert.match(region, /return '通用'/);
  const face = source.indexOf('const R29_FACE');
  const list = source.indexOf('function renderBotList', face);
  assert.equal(/innerHTML/.test(source.slice(face, list)), false);
});

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function startMock(port) {
  const freshAt = new Date(2026, 10, 19, 10, 0, 0).toISOString();
  const oldAt = new Date(2026, 10, 19, 7, 0, 0).toISOString();
  const state = { streams: [] };
  const sessions = [
    { id: 's-done', bot: 'aa', title: MALICIOUS, running: false, lastRole: 'assistant', updatedAt: freshAt },
    { id: 's-done-safe', bot: 'aa', title: '周报', running: false, lastRole: 'assistant', updatedAt: freshAt },
    { id: 's-run', bot: 'ab', title: '在查', running: true, updatedAt: freshAt },
    { id: 's-ask', bot: 'ac', title: '问一句', running: false, pending: true, updatedAt: freshAt },
    { id: 's-old', bot: 'ad', title: '旧稿子', running: false, lastRole: 'assistant', updatedAt: oldAt }
  ];
  const card = {
    id: 'card-1', type: 'approval', bot: 'ac', sessionId: 's-ask', status: 'pending', title: '等一下',
    createdAt: freshAt
  };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    void Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/^\/bff(?=\/)/, '') || '/';
    const method = req.method || 'GET';
    if (path === '/events' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(': ok\n\n');
      state.streams.push(res);
      return;
    }
    if (path.endsWith('/stream') && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write('event: delta\ndata: {"text":"假回复"}\n\n');
      res.write('event: message\ndata: {"role":"assistant","id":"m2","seq":2,"text":"假回复"}\n\n');
      res.write('event: done\ndata: {}\n\n');
      res.end();
      return;
    }
    if (path === '/health') return json(res, 200, { ok: true, dsh: { connected: true } });
    if (path === '/status') {
      const bots = {};
      for (const id of IDS) bots[id] = { running: id === 'ab', pending: id === 'ac' ? 1 : 0, unread: 0 };
      return json(res, 200, { ok: true, pendingTotal: 1, bots });
    }
    if (path === '/bots') {
      return json(res, 200, {
        ok: true,
        bots: IDS.map((id, index) => ({
          id, name: NAMES[index], status: 'active', role: 'bot', order: index + 1, duty: DUTY[id]
        }))
      });
    }
    if (path === '/sessions' && method === 'GET') return json(res, 200, { sessions });
    if (path === '/sessions' && method === 'POST') return json(res, 200, { id: 's-new', bot: 'aa' });
    if (path.endsWith('/history')) return json(res, 200, { messages: [] });
    if (path.endsWith('/messages') && method === 'POST') {
      return json(res, 200, { accepted: true, requestId: 'req-1' });
    }
    if (path.endsWith('/cards')) return json(res, 200, { cards: [card] });
    if (path === '/approvals') return json(res, 200, { approvals: [card] });
    if (path.endsWith('/read')) return json(res, 200, { ok: true });
    if (path === '/unread/' && method === 'GET') {
      return json(res, 200, { ok: true, conversations: {}, bots: {}, groups: {} });
    }
    if (path === '/groups') return json(res, 200, { ok: true, groups: [] });
    if (path === '/presence') return json(res, 200, { ok: true, bots: {} });
    if (path === '/settings/' && method === 'GET') {
      return json(res, 200, {
        ok: true, permission: { mode: 'ask' }, bots: {}, models: [], modelsWritable: false
      });
    }
    if (path === '/panic/status') {
      return json(res, 200, {
        ok: true, state: 'running', steps: {}, live: { runningSessions: 0, runningExternal: 0 }
      });
    }
    if (path === '/board/tickets') return json(res, 200, { ok: true, tickets: [] });
    return json(res, 200, { ok: true });
  });
  server.on('clientError', (_error, socket) => { try { socket.end(); } catch { /* 对端已断 */ } });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      async close() {
        for (const stream of state.streams) { try { stream.end(); } catch { /* 已经断了 */ } }
        await new Promise(done => server.close(done));
        server.closeAllConnections?.();
      }
    }));
  });
}

describe('站台桌宠走查', { concurrency: 1, skip: shellSkip }, () => {
  let mock;
  let web;
  let origin;

  before(async () => {
    mock = await startMock(BFF_PORT);
    const root = join(process.cwd(), 'test', 'scratch');
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, 'r29d-y7-'));
    const shell = join(dir, 'shell');
    await mkdir(shell);
    await copyFile(shellFile, join(shell, 'index.html'));
    await writeFile(join(dir, 'web.key'), WEB, { mode: 0o600 });
    await writeFile(join(dir, 'bff.key'), BFF, { mode: 0o600 });
    web = await createHubWeb({
      HUB_WEB_PORT: String(WEB_PORT), HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_SHELL_DIR: shell,
      HUB_WEB_KEY_FILE: join(dir, 'web.key'), BFF_KEY_FILE: join(dir, 'bff.key'),
      BFF_URL: 'http://127.0.0.1:' + BFF_PORT
    }, { log() {} });
    origin = 'http://127.0.0.1:' + WEB_PORT;
  });

  after(async () => {
    await web?.close();
    await mock?.close();
  });

  test('六位助理台词类别对，状态事件到舞台，恶意标题不执行', { timeout: 120000 }, async () => {
    const core = playwrightCore();
    const bin = chromiumBin();
    assert.ok(core, '没有 playwright-core');
    assert.ok(bin, '没有已安装的无头浏览器');
    const playwright = require(core);
    const browser = await playwright.chromium.launch({ executablePath: bin, headless: true });
    const errors = [];
    let dialogs = 0;
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.addInitScript(() => {
        window.__r29StageNow = () => new Date(2026, 10, 19, 10, 0, 0);
        window.__r29Lines = {};
        window.__r29Events = [];
        window.__r29Sessions = {};
        window.__r29Xss = false;
        window.alert = () => { window.__r29Xss = true; };
        let slot = window.HubPetStage;
        function wrap(stage) {
          if (!stage || stage.__r29Wrapped) return stage;
          const origEvent = stage.event.bind(stage);
          const origSet = stage.setLines.bind(stage);
          const origSessions = stage.sessions.bind(stage);
          stage.event = (id, name) => {
            window.__r29Events.push({ id: id, name: name });
            return origEvent(id, name);
          };
          stage.setLines = (id, table) => {
            const idle = table && Array.isArray(table.idle) ? table.idle.slice() : [];
            window.__r29Lines[id] = { idle: idle };
            return origSet(id, table);
          };
          stage.sessions = (id, list) => {
            const copy = Array.isArray(list) ? list.map(item => ({
              pose: item && item.pose, ask: !!(item && item.ask)
            })) : [];
            window.__r29Sessions[id] = copy;
            return origSessions(id, list);
          };
          stage.__r29Wrapped = true;
          return stage;
        }
        Object.defineProperty(window, 'HubPetStage', {
          configurable: true, enumerable: true,
          get() { return slot; },
          set(value) { slot = wrap(value); }
        });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      page.on('dialog', dialog => { dialogs += 1; return dialog.dismiss(); });
      await page.route('**/*', route => {
        const target = new URL(route.request().url());
        const local = target.hostname === '127.0.0.1' && target.port === String(WEB_PORT);
        if (target.protocol === 'data:' || target.protocol === 'blob:' || local) return route.continue();
        return route.abort();
      });
      await page.goto(origin + '/?key=' + WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => {
        const lines = window.__r29Lines || {};
        const sess = window.__r29Sessions || {};
        const ids = ['aa', 'ab', 'ac', 'ad', 'ae', 'af'];
        const ready = ids.every(id => lines[id] && lines[id].idle && lines[id].idle[0]);
        const ab = sess.ab || [];
        const ac = sess.ac || [];
        return ready && ab.some(item => item.pose === 'writing' && item.ask === false) &&
          ac.some(item => item.pose === 'asking' && item.ask === true);
      }, null, { timeout: 20000 });
      const got = await page.evaluate(() => {
        const out = {};
        for (const id of ['aa', 'ab', 'ac', 'ad', 'ae', 'af']) out[id] = window.__r29Lines[id].idle;
        out.sessAb = window.__r29Sessions.ab;
        out.sessAc = window.__r29Sessions.ac;
        const stage = window.HubPetStage;
        out.night2230 = stage.soundAllowed(new Date(2026, 10, 19, 22, 30, 0));
        out.night0730 = stage.soundAllowed(new Date(2026, 10, 19, 7, 30, 0));
        out.morning = stage.soundAllowed(new Date(2026, 10, 19, 8, 0, 0));
        out.evening = stage.soundAllowed(new Date(2026, 10, 19, 21, 0, 0));
        out.day = stage.soundAllowed(new Date(2026, 10, 19, 10, 0, 0));
        return out;
      });
      for (const id of IDS) assert.deepEqual(got[id], book[KIND[id]]['闲着'], id);
      assert.deepEqual(got.sessAb, [{ pose: 'writing', ask: false }]);
      assert.deepEqual(got.sessAc, [{ pose: 'asking', ask: true }]);
      assert.equal(got.night2230, false);
      assert.equal(got.night0730, false);
      assert.equal(got.morning, true);
      assert.equal(got.evening, true);
      assert.equal(got.day, true);
      await page.locator('.sidebar .pinned [data-bot-tree="aa"] [data-act="bot"]').click();
      await page.locator('[data-focus="composer"]').fill('你好');
      await page.locator('.composer-area [data-act="send"]').click();
      await page.waitForFunction(() => {
        const names = (window.__r29Events || []).filter(item => item.id === 'aa').map(item => item.name);
        return names.includes('thinking') && names.includes('done');
      }, null, { timeout: 20000 });
      await page.evaluate(() => window.Hub.navigate({ view: 'stage', bot: 'aa' }));
      await page.waitForFunction(() => {
        const bubble = document.querySelector('[data-r29-bubble]');
        if (!bubble || bubble.textContent.indexOf('刚把') !== 0) return false;
        window.__r29Said = bubble.textContent;
        window.__r29Kids = bubble.childElementCount;
        return true;
      }, null, { timeout: 15000 });
      const spoken = await page.evaluate(() => ({
        text: window.__r29Said || '',
        kids: window.__r29Kids,
        xss: window.__r29Xss === true,
        img: document.querySelectorAll('img[src="x"]').length
      }));
      assert.equal(spoken.text, SAID);
      assert.equal(spoken.text.includes('<'), false);
      assert.equal(spoken.text.includes('>'), false);
      assert.equal(spoken.kids, 0);
      assert.equal(spoken.xss, false);
      assert.equal(spoken.img, 0);
      await page.evaluate(() => {
        window.__r29StageNow = () => new Date(2026, 10, 19, 22, 30, 0);
      });
      await page.waitForFunction(nightLine => {
        const row = window.__r29Lines && window.__r29Lines.aa;
        const attr = document.querySelector('[data-r29-sound]');
        const stage = window.HubPetStage;
        return row && row.idle && row.idle[0] === nightLine &&
          attr && attr.getAttribute('data-r29-sound') === '0' &&
          stage.soundAllowed(new Date(2026, 10, 19, 22, 30, 0)) === false;
      }, NIGHT_LINE, { timeout: 10000 });
      assert.deepEqual(errors, []);
      assert.equal(dialogs, 0);
    } finally {
      await browser.close();
    }
  });
});
