/* 真模式：打开每个页面和抽屉，看得见的字里不得再有演示味和工程词。端口 3741。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shots = path.resolve(__dirname, '..', '..', 'shots');
const pets = path.resolve(__dirname, '..', '..', '..', '..', '..',
  '源码快照-第25轮收工-20261118', 'hub-art', 'pets-build-r22', 'pets');
const port = 3741;
const WORDS = [
  '演示', '占位', '许可：', '许可:', '未写许可', '正在穿', '原创占位', '本页演示',
  '上下文', '工作区', '白名单', '子智能体', '子代理', '子任务', '挂载', '切片',
  '推理强度', '执行者', '可派工人', '插件', '操控档位', '权限级别', '本地命令',
  '未加载引擎', '音素', '回滚', '参数', '双工', '待重启', '日志', '通路', '进程',
  '端口', '写盘', '缓存', '阈值', '降级', '轮询', '队列', '正本', '唯一写者', '回执',
  '工作流', '脱敏', '配额', '登录态', '契约测试', '分叉', '分支', '流式', '听写',
  '执行轨迹', '临时授权', '执行过程', '待你拍板', '引擎', '密钥', '令牌', '目录',
  '页内存', '大脑', '工人', '计划模式', '对齐', '档位', '工具箱', '执行端', '遮蔽',
  '召回', '路由指针', '冲突隔离', '验收', '重试', '插话', '脚本', '凭据', '口令',
  '闸门', 'SVG', 'Live2D', 'live2d', 'CUA', 'CLI', 'SSH', 'HMR', 'CSV', 'MCP'
];
const RES = [
  ['\\btoken/s\\b', 'i'], ['\\btokens?\\b', 'i'], ['\\b\\d+(?:\\.\\d+)?k\\b', 'i'],
  ['\\bID\\b', ''], ['\\bbot\\b', 'i'], ['\\bskip\\b', 'i'], ['\\bShell\\b', ''],
  ['\\bshell\\b', ''], ['\\bskills?\\b', 'i'], ['\\bcontent\\b', 'i'], ['\\bL[0-4]\\b', ''],
  ['\\bVRM\\b', ''], ['\\bvrm\\b', ''], ['\\basar\\b', 'i'], ['\\bCookie\\b', 'i']
];

function firstExisting(list) {
  for (const item of list) if (item && fs.existsSync(item)) return item;
  return '';
}
const playwrightPath = process.env.PLAYWRIGHT_CORE || firstExisting([
  path.join(os.homedir(), 'node_modules/playwright-core'),
  path.join(os.homedir(), 'node_modules/playwright-core')
]);
const chromiumPath = process.env.CHROMIUM || firstExisting([
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64',
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
  path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
]);
assert(playwrightPath && chromiumPath, '缺少已安装的浏览器或 playwright-core');
const playwright = require(playwrightPath);

function inside(base, file) {
  const rootDir = path.resolve(base);
  const target = path.resolve(file);
  return target === rootDir || target.startsWith(rootDir + path.sep);
}
function readIds(file, re) {
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(re)].map((item) => item[1]);
}
function walkJs(dir, bag) {
  fs.readdirSync(dir).forEach((name) => {
    if (name === '_example.js' || name === 'dist' || name === 'dist-generic') return;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { walkJs(full, bag); return; }
    if (!name.endsWith('.js')) return;
    bag.views.push(...readIds(full, /registerView\(\s*['"]([^'"]+)['"]/g));
    bag.panels.push(...readIds(full, /registerPanel\(\s*['"]([^'"]+)['"]/g));
    bag.settings.push(...readIds(full, /registerSettingsPage\(\s*['"]([^'"]+)['"]/g));
  });
}
function unique(list) {
  return [...new Set(list)].filter((id) => id && !id.endsWith('-'));
}
const found = { views: ['chat', 'task', 'kanban', 'stage'], panels: [], settings: [] };
walkJs(path.join(root, 'js'), found);
walkJs(path.join(root, 'modules'), found);
const views = unique(found.views);
const panels = unique(found.panels.concat([
  'persona-wizard', 'persona-sessions', 'persona-projects', 'persona-guide',
  'plugins-detail', 'plugins-pool', 'plugins-use', 'plugins-art', 'plugins-cua',
  'plugins-channels', 'plugins-group', 'plugins-context', 'plugins-extensions',
  'plugins-bili', 'plugins-sns', 'plugins-providers',
  'more', 'usage', 'context', 'model', 'permission', 'profile', 'sources', 'settings',
  'tools', 'comfy', 'schedule', 'jobs', 'sessions', 'files', 'attachments', 'decisions',
  'session-menu'
]));
const settings = unique(found.settings.concat([
  'persona-appearance', 'persona-voice', 'persona-other'
]));
const plainDrawers = ['card', 'preview', 'mention', 'custom'];

function serve() {
  const types = {
    '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
    '.css': 'text/css;charset=utf-8', '.json': 'application/json',
    '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json'
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    let file = '';
    if (rel === '/pets' || rel.startsWith('/pets/')) {
      if (!fs.existsSync(pets)) { res.writeHead(404); res.end('no pets'); return; }
      const rest = rel === '/pets' ? '' : rel.slice('/pets/'.length);
      file = path.resolve(pets, rest);
      if (!inside(pets, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('missing pet'); return;
      }
    } else {
      file = path.resolve(root, '.' + rel);
      if (!inside(root, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('missing'); return;
      }
    }
    const type = types[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function harvest(page, label) {
  return page.evaluate(({ label, words, res }) => {
    document.querySelectorAll('details').forEach((node) => { node.open = true; });
    if (window.r29PlainTalk) window.r29PlainTalk();
    function shown(el) {
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const style = getComputedStyle(cur);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        cur = cur.parentElement;
      }
      return true;
    }
    const parts = [];
    if (document.body) parts.push(document.body.innerText || '');
    document.querySelectorAll('option').forEach((node) => {
      const host = node.parentElement;
      if (host && shown(host)) parts.push(node.textContent || '');
    });
    document.querySelectorAll('[aria-label],[title],[alt],[placeholder]').forEach((node) => {
      if (!shown(node)) return;
      ['aria-label', 'title', 'alt', 'placeholder'].forEach((name) => {
        const value = node.getAttribute(name);
        if (value) parts.push(value);
      });
    });
    document.querySelectorAll('input,textarea').forEach((node) => {
      if (!shown(node) || node.getAttribute('data-focus') === 'composer') return;
      const kind = (node.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'password', 'file', 'checkbox', 'radio', 'button', 'submit'].includes(kind)) {
        return;
      }
      if (node.value) parts.push(node.value);
    });
    const text = parts.join('\n');
    const hits = [];
    words.forEach((word) => {
      const at = text.indexOf(word);
      if (at < 0) return;
      const sample = text.slice(Math.max(0, at - 18), at + word.length + 18);
      hits.push({ label: label, needle: word, sample: sample.replace(/\s+/g, ' ') });
    });
    res.forEach((pair) => {
      const found = text.match(new RegExp(pair[0], pair[1]));
      if (found) {
        const at = found.index || 0;
        hits.push({
          label: label, needle: pair[0],
          sample: text.slice(Math.max(0, at - 18), at + found[0].length + 18).replace(/\s+/g, ' ')
        });
      }
    });
    return hits.slice(0, 12);
  }, { label: label, words: WORDS, res: RES });
}

async function openSurface(page, id, kind) {
  return page.evaluate(({ id, kind }) => {
    try {
      if (kind === 'home') {
        state.drawer = null;
        state.detail = false;
        state.mode = 'chat';
        if (typeof renderHomeChat === 'function') renderHomeChat();
        else render();
      } else if (kind === 'view') {
        state.drawer = null;
        Hub.navigate({ view: id });
      } else if (kind === 'settings') {
        state.settingsTab = id;
        Hub.openPanel('settings');
      } else if (kind === 'card') {
        const card = (state.cards || [])[0];
        if (!card) return '没有卡片';
        state.cardId = card.id;
        state.mode = 'kanban';
        openPanel('card');
      } else if (kind === 'plain') openPanel(id);
      else if (id === 'automation-detail') {
        const card = (state.cards || [])[0];
        Hub.openPanel(id, card ? { id: card.id } : {});
      } else Hub.openPanel(id);
      document.querySelectorAll('details').forEach((node) => { node.open = true; });
      if (window.r29PlainTalk) window.r29PlainTalk();
      return '';
    } catch (err) {
      return String(err && err.message || err);
    }
  }, { id: id, kind: kind });
}

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const petNote = fs.existsSync(pets) ? '角色素材已挂上' : '角色素材目录不在，舞台仍会画';
  console.log(petNote);
  const server = await serve();
  const browser = await playwright.chromium.launch({ executablePath: chromiumPath, headless: true });
  const errors = [];
  const hits = [];
  const blocked = [];
  let scanned = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let current = 'boot';
    page.on('pageerror', (err) => errors.push(current + ' ' + (err.stack || err)));
    await page.addInitScript(() => {
      var root = document.documentElement;
      if (root && root.dataset) root.dataset.hubMode = 'real';
    });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.Hub && window.state && state.bots && state.bots.length);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.documentElement.dataset.hubMode = 'real';
      if (window.r29PlainTalk) window.r29PlainTalk();
    });
    const plan = [{ id: 'home', kind: 'home' }]
      .concat(views.map((id) => ({ id: id, kind: 'view' })))
      .concat(panels.map((id) => ({ id: id, kind: 'panel' })))
      .concat(settings.map((id) => ({ id: id, kind: 'settings' })))
      .concat([{ id: 'card', kind: 'card' }])
      .concat(plainDrawers.filter((id) => id !== 'card').map((id) => ({ id: id, kind: 'plain' })));
    for (const item of plan) {
      current = item.kind + ':' + item.id;
      const problem = await openSurface(page, item.id, item.kind);
      await page.waitForTimeout(90);
      if (problem) {
        blocked.push(item.kind + ':' + item.id + ' ' + problem);
        continue;
      }
      scanned += 1;
      const foundHits = await harvest(page, item.kind + ':' + item.id);
      foundHits.forEach((hit) => {
        const key = hit.needle + '|' + hit.sample;
        if (!hits.some((old) => old.needle + '|' + old.sample === key)) hits.push(hit);
      });
    }
    await openSurface(page, 'stage', 'view');
    await page.waitForSelector('[data-r29-pet-slot] [data-r29-poke]');
    await page.waitForTimeout(200);
    const stage = await page.evaluate(() => {
      const text = document.body.innerText || '';
      return {
        renderer: document.querySelectorAll('[data-stage-renderer]').length,
        outfit: document.querySelectorAll('[data-outfit-status]').length,
        wearing: text.includes('正在穿'),
        license: text.includes('许可'),
        poke: !!document.querySelector('[data-r29-poke]'),
        pat: !!document.querySelector('[data-r29-pat]'),
        look: !!document.querySelector('[data-r29-change-look]'),
        bubble: !!document.querySelector('[data-r29-bubble]'),
        slot: !!document.querySelector('[data-r29-pet-slot]')
      };
    });
    await page.screenshot({ path: path.join(shots, 'x1-stage-wide.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(shots, 'x1-stage-phone.png') });
    const phoneHits = await harvest(page, 'view:stage-phone');
    phoneHits.forEach((hit) => hits.push(hit));
    await page.locator('[data-r29-change-look]').click();
    await page.waitForTimeout(200);
    const lookHits = await harvest(page, 'sheet:look');
    lookHits.forEach((hit) => {
      if (!hits.some((old) => old.needle === hit.needle && old.sample === hit.sample)) hits.push(hit);
    });
    await page.keyboard.press('Escape');
    await openSurface(page, 'task', 'view');
    await page.screenshot({ path: path.join(shots, 'x1-task.png') });
    await openSurface(page, 'more', 'panel');
    await page.screenshot({ path: path.join(shots, 'x1-more.png') });
    assert.equal(stage.renderer, 0, '真模式舞台还留着旧切换');
    assert.equal(stage.outfit, 0, '真模式舞台还留着正在穿');
    assert.equal(stage.wearing, false);
    assert.equal(stage.license, false);
    assert.equal(stage.poke && stage.pat && stage.look && stage.bubble && stage.slot, true);
    if (hits.length || errors.length) {
      console.log(JSON.stringify({ scanned: scanned, blocked: blocked, hits: hits, errors: errors }, null, 2));
      assert.equal(hits.length, 0, '看得见的字里还有 ' + hits.length + ' 处');
      assert.equal(errors.length, 0, '页面脚本报错');
    }
    console.log('真模式走查 ' + scanned + ' 处，命中 0。打不开 ' + blocked.length + ' 处。');
    if (blocked.length) console.log(blocked.join('\n'));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
