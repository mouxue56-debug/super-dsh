// 开源准备的测试:文档齐全且干净、示例数据有效、三个脚本的演练与真装(只对临时目录)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(repo, 'scripts');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
const imp = (rel) => import(pathToFileURL(path.join(repo, rel)).href);

const DOCS = [
  'README.md', 'README.en.md', 'CONTRIBUTING.md', 'CONTRIBUTING.en.md', 'SECURITY.md', 'NOTICE',
  'LICENSE-说明.md', 'docs/适合新手的小任务.md', 'defaults/demo/README.md', 'defaults/demo/dsh-demo-model.patch.yml',
  'defaults/bots.example.yaml', 'defaults/tool-levels.example.yaml', 'package.json',
  '.github/ISSUE_TEMPLATE/bug_report.md', '.github/ISSUE_TEMPLATE/feature_request.md',
  '.github/ISSUE_TEMPLATE/good_first_issue.md',
  'scripts/install.sh', 'scripts/start.sh', 'scripts/doctor.sh', 'scripts/lib.sh',
];

// 建一个临时目录;测试结束时留给系统清理。
function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hub-prep-'));
}

// 跑一个脚本,返回 {code, out}。
function run(script, args, env = {}) {
  const r = spawnSync('bash', [path.join(scripts, script), ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

// 递归列出目录下所有文件(相对路径)。
function listAll(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listAll(full, base) : [path.relative(base, full)];
  });
}

// 写一个假的 dsh 程序,只会打印版本号。
function fakeDsh(dir, version) {
  const file = path.join(dir, 'fake-dsh');
  fs.writeFileSync(file, `#!/bin/sh\necho "dsh ${version}"\n`, { mode: 0o755 });
  return file;
}

// 取一个空闲端口。
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// GET 一个本机地址,返回状态码和正文。
function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('文档与脚本都在,且每行不超过 120 字符', () => {
  for (const rel of DOCS) {
    assert.ok(fs.existsSync(path.join(repo, rel)), '缺少 ' + rel);
    if (['defaults/tool-levels.example.yaml', 'package.json'].includes(rel)) continue; // 格式限制:单行值
    const long = read(rel).split('\n').map((l, i) => [i + 1, Array.from(l).length]).filter(([, n]) => n > 120);
    assert.deepEqual(long, [], rel + ' 有超长行');
  }
});

test('文档里没有个人路径、内网地址、密钥形状', () => {
  const rules = [
    /(?:\/Users|\/home)\/(?!<|\$|\{|\.\.\.|user|name|you|me|runner)[A-Za-z0-9._-]+\//,
    /\.ts\.net\b/,
    /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  ];
  const files = [...DOCS, ...listAll(path.join(repo, 'defaults/personas')).map((f) => 'defaults/personas/' + f),
    ...listAll(path.join(repo, 'defaults/demo/board')).map((f) => 'defaults/demo/board/' + f)];
  for (const rel of files) {
    const text = read(rel);
    for (const rule of rules) assert.ok(!rule.test(text), rel + ' 命中 ' + rule);
  }
  // 私有词表(可选):与仓库已有的开源卫生扫描共用同一个环境变量,没设就跳过。
  const list = process.env.DSH_PUBLISH_SCAN_WORDLIST;
  if (list && fs.existsSync(list)) {
    const words = fs.readFileSync(list, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    for (const rel of files) {
      for (const w of words) assert.ok(!read(rel).includes(w), rel + ' 含私有词表里的词');
    }
  }
});

test('名字与声明:标题不带 DeepSeek,中英文 README 与 NOTICE 都声明非官方', () => {
  for (const rel of ['README.md', 'README.en.md']) {
    const title = read(rel).split('\n').find((l) => l.startsWith('# '));
    assert.ok(title && !/deepseek/i.test(title), rel + ' 的标题不得带 DeepSeek');
  }
  assert.match(read('README.md'), /非官方/);
  assert.match(read('README.en.md'), /[Uu]nofficial/);
  assert.match(read('NOTICE'), /非官方/);
  assert.match(read('NOTICE'), /not affiliated/i);
  assert.ok(!/deepseek/i.test(JSON.parse(read('package.json')).name));
  for (const rel of listAll(path.join(repo, 'defaults/personas')).map((f) => 'defaults/personas/' + f)) {
    assert.ok(!/deepseek/i.test(read(rel)), rel);
  }
});

test('许可证页只有推荐和理由,不含许可证全文', () => {
  const text = read('LICENSE-说明.md');
  assert.match(text, /MIT/);
  assert.ok(!/TERMS AND CONDITIONS|Permission is hereby granted/i.test(text));
  assert.ok(text.length < 4000);
  assert.ok(!fs.existsSync(path.join(repo, 'LICENSE')), '许可证未定,不应有 LICENSE 文件');
});

test('README 必备章节与相对链接都有效', () => {
  const zh = read('README.md');
  for (const h of ['是什么，不是什么', '演示模式：一条命令，不要钥匙', '还没做成的', '测试', '致谢与许可证']) {
    assert.ok(zh.includes('## ' + h), '缺章节 ' + h);
  }
  assert.match(zh, /第二道门/);
  assert.match(read('SECURITY.md'), /第二道门,第一道是内核沙箱/);
  assert.match(read('CONTRIBUTING.md'), /第一级[\s\S]*第二级[\s\S]*第三级[\s\S]*第四级/);
  for (const rel of ['README.md', 'README.en.md', 'CONTRIBUTING.md', 'CONTRIBUTING.en.md', 'LICENSE-说明.md']) {
    for (const m of read(rel).matchAll(/\]\(([^)#\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      assert.ok(fs.existsSync(path.join(repo, m[1])), `${rel} 的链接指向不存在的 ${m[1]}`);
    }
  }
});

test('新手任务页至少 6 条,引用的文件都存在', () => {
  const text = read('docs/适合新手的小任务.md');
  assert.ok((text.match(/^### \d+\./gm) ?? []).length >= 6);
  for (const m of text.matchAll(/`((?:defaults|scripts|test|packages|docs)\/[^`\s]+)`/g)) {
    const p = m[1].replace(/<[^>]*>/g, '').replace(/\/$/, '');
    if (/[<*]/.test(m[1]) || /\/$/.test(m[1]) && !fs.existsSync(path.join(repo, p))) continue;
    if (/SKILL\.en\.md|<id>/.test(m[1])) continue;
    assert.ok(fs.existsSync(path.join(repo, p)), '新手任务页引用了不存在的 ' + m[1]);
  }
});

test('示例名册通过真实的名册校验,恰好三位:总管、写作、调研', async () => {
  const { validateRoster } = await imp('packages/hub-plugin/roster.mjs');
  const rows = validateRoster(JSON.parse(read('defaults/bots.example.yaml')));
  assert.deepEqual(rows.map((r) => r.id), ['chief', 'writer', 'research']);
  assert.equal(rows.filter((r) => r.role === 'chief').length, 1);
});

test('三个示例人设:有人设文件,只用允许的占位,且长度不超过 900 字', () => {
  for (const id of ['chief', 'writer', 'research']) {
    const text = read(`defaults/personas/${id}.md`);
    assert.ok(Array.from(text).length <= 900, id + ' 超长');
    const slots = new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]));
    for (const s of slots) assert.ok(['owner', 'bot_name', 'manuals'].includes(s), id + ' 用了未知占位 ' + s);
    assert.ok(!/【主人|【AI/.test(text), id + ' 不应带过程标签');
  }
});

test('演示工单是有效的工单,四种状态齐全', async () => {
  const { validateTicket } = await imp('packages/hub-bff/lib/ticket.mjs');
  const dir = path.join(repo, 'defaults/demo/board/tickets');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 4);
  const states = files.map((f) => {
    const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.equal(validateTicket(t).ok, true, f);
    return t.state + '/' + t.review;
  }).sort();
  assert.deepEqual(states, ['completed/accepted', 'progress/none', 'progress/submitted', 'queued/none']);
});

test('install.sh:拒绝缺失、相对、系统目标', () => {
  assert.notEqual(run('install.sh', []).code, 0);
  assert.match(run('install.sh', ['--target', 'rel/dir']).out, /绝对路径/);
  assert.match(run('install.sh', ['--target', '/etc/x']).out, /系统目录/);
  assert.match(run('install.sh', ['--target', '/tmp/a"b']).out, /不允许的字符/);
});

test('install.sh:默认只演练,不写任何东西', () => {
  const dir = path.join(tmp(), 'home');
  const r = run('install.sh', ['--target', dir, '--demo']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /演练/);
  assert.ok(!fs.existsSync(dir), '演练不应创建目标目录');
  const existing = tmp();
  run('install.sh', ['--target', existing, '--demo']);
  assert.deepEqual(listAll(existing), [], '演练不应在已有目录里写文件');
});

test('install.sh --apply:装好、可被真实加载器读取、权限 600、重复运行不改动', async () => {
  const dir = path.join(tmp(), 'home');
  const r = run('install.sh', ['--target', dir, '--demo', '--apply']);
  assert.equal(r.code, 0, r.out);
  for (const f of ['config/hub.yaml', 'config/bots.yaml', 'config/tool-levels.yaml']) {
    assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
  }
  assert.ok(fs.existsSync(path.join(dir, 'bots/chief/AGENTS.md')));
  assert.equal(listAll(path.join(dir, 'board/tickets')).length, 4);
  const { loadHubConfig } = await imp('packages/hub-plugin/hub-config.mjs');
  const { loadPolicy } = await imp('packages/hub-plugin/policy.mjs');
  const c = loadHubConfig({ hubHome: dir, home: dir });
  assert.deepEqual(c.bots, ['chief', 'writer', 'research']);
  assert.equal(c.chief, 'chief');
  const loaded = loadPolicy(path.join(dir, 'config/tool-levels.yaml'), c);
  assert.ok(loaded.policy, String(loaded.error));
  const { validateRoster } = await imp('packages/hub-plugin/roster.mjs');
  assert.equal(validateRoster(JSON.parse(fs.readFileSync(path.join(dir, 'config/bots.yaml'), 'utf8'))).length, 3);
  const before = listAll(dir).sort();
  const again = run('install.sh', ['--target', dir, '--demo', '--apply']);
  assert.equal(again.code, 0, again.out);
  assert.deepEqual(listAll(dir).sort(), before);
  assert.ok(!/新建  文件  config\//.test(again.out), '第二次不应再新建 config 文件');
  const noDemo = path.join(tmp(), 'home');
  assert.equal(run('install.sh', ['--target', noDemo, '--apply']).code, 0);
  assert.equal(listAll(path.join(noDemo, 'board')).length, 0, '没加 --demo 不应放演示数据');
});

test('install.sh --apply:不覆盖已有的配置', () => {
  const dir = path.join(tmp(), 'home');
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config/hub.yaml'), 'mine\n', { mode: 0o600 });
  assert.equal(run('install.sh', ['--target', dir, '--apply']).code, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'config/hub.yaml'), 'utf8'), 'mine\n');
});

// 路 33 的 doctor.sh 取代了路 16 的同名脚本：只测版本区间与只读（演示实例的整条流程见 demo-e2e.test.mjs）。
test('doctor.sh:版本区间与只读', () => {
  const bin = tmp();
  const dir = path.join(tmp(), 'none');
  const ports = ['--port', '1', '--kernel-port', '2'];
  const good = run('doctor.sh', ['--target', dir, ...ports], { DSH_BIN: fakeDsh(bin, '0.2.2-rc.1') });
  assert.match(good.out, /DSH 版本 0\.2\.2-rc\.1 在实测区间/);
  for (const v of ['0.2.2', '0.2.2-rc.7']) {
    const r = run('doctor.sh', ['--target', dir, ...ports], { DSH_BIN: fakeDsh(bin, v) });
    assert.ok(!/DSH 版本 \S+ 不在实测区间/.test(r.out), v);
  }
  for (const v of ['0.2.2-rc.0', '0.2.3', '0.3.0', '0.1.9']) {
    const bad = run('doctor.sh', ['--target', dir, ...ports], { DSH_BIN: fakeDsh(bin, v) });
    assert.notEqual(bad.code, 0, v);
    assert.match(bad.out, /不在实测区间/, v);
    const forced = run('doctor.sh', ['--target', dir, ...ports], { DSH_BIN: fakeDsh(bin, v), HUB_DEMO_FORCE: '1' });
    assert.match(forced.out, /已设 HUB_DEMO_FORCE=1/, v);
  }
  assert.ok(!fs.existsSync(dir), '体检不应建目录');
});

test('脚本语法检查通过(bash -n)', () => {
  for (const s of ['install.sh', 'start.sh', 'doctor.sh', 'lib.sh']) {
    assert.doesNotThrow(() => execFileSync('bash', ['-n', path.join(scripts, s)]), s);
  }
});
