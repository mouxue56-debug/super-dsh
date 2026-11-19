// 全新实例初始化写成全开。已有实例缺档、坏档、已选档都不改。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modeUrl = pathToFileURL(path.join(repo, 'packages/hub-plugin/permission-mode.mjs'));
const settingsUrl = pathToFileURL(path.join(repo, 'packages/hub-bff/lib/ext/settings.mjs'));
const {readPermissionMode, writePermissionMode} = await import(modeUrl.href);
const {createHandler} = await import(settingsUrl.href);
const STACK_PORT = '3717';
const KERNEL_PORT = '3718';
const OPEN_TEXT = '{"v":1,"mode":"open"}\n';
const READONLY_TEXT = '{"v":1,"mode":"readonly"}\n';

function tempDir() {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r29-w9-')));
}

function fakeDsh(dir) {
  const file = path.join(dir, 'fake-dsh');
  const lines = [
    '#!/bin/bash',
    'mkdir -p "$DSH_HOME/profiles/web"',
    'if [ ! -f "$DSH_HOME/profiles/web/package.json" ]; then',
    '  printf \'%s\\n\' \'{"dependencies":{}}\' > "$DSH_HOME/profiles/web/package.json"',
    'fi',
    'exit 0',
    '',
  ];
  fs.writeFileSync(file, lines.join('\n'), {mode: 0o755});
  return file;
}

function prepare(target, bin) {
  const result = spawnSync(process.execPath, [
    path.join(repo, 'scripts/demo-prepare.mjs'),
    '--target', target,
    '--port', STACK_PORT,
    '--kernel-port', KERNEL_PORT,
    '--dsh-bin', bin,
  ], {encoding: 'utf8'});
  assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
}

function runInstall(target, extra) {
  return spawnSync('/bin/bash', [
    path.join(repo, 'scripts/install.sh'), '--target', target, ...extra,
  ], {encoding: 'utf8'});
}

function bits(file) {
  return fs.lstatSync(file).mode & 0o777;
}

// 首页进来只读档位。这里数改档请求，不替页面发 PUT。
async function readHome(hubHome) {
  let puts = 0;
  const handler = createHandler({
    hubHome,
    isTrusted: () => true,
    isOwnerDevice: () => true,
    roster: {list: () => []},
  });
  const wrapped = async (req, res) => {
    const url = String(req.url ?? '');
    if (req.method === 'PUT' && url.startsWith('/settings/permission')) puts += 1;
    return handler(req, res);
  };
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = '/settings/';
  req.headers = {};
  const res = {
    writeHead(status) { this.status = status; },
    end(data) { this.body = JSON.parse(String(data)); },
  };
  await wrapped(req, res);
  return {status: res.status, mode: res.body?.permission?.mode, puts};
}

test('新建预览实例第一次 GET 为全开，读首页零次改档', async () => {
  const root = tempDir();
  const target = path.join(root, 'demo');
  try {
    prepare(target, fakeDsh(root));
    const file = path.join(target, 'hub', 'config', 'permission-mode.json');
    assert.equal(fs.readFileSync(file, 'utf8'), OPEN_TEXT);
    assert.equal(bits(file), 0o600);
    assert.equal(fs.lstatSync(file).isFile(), true);
    assert.equal(readPermissionMode(file).mode, 'open');
    const home = await readHome(path.join(target, 'hub'));
    assert.equal(home.status, 200);
    assert.equal(home.mode, 'open');
    assert.equal(home.puts, 0);
    const patch = fs.readFileSync(path.join(target, 'kernel', 'demo-model.patch.yml'), 'utf8');
    assert.match(patch, new RegExp(`127\\.0\\.0\\.1:${STACK_PORT}/v1`));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('重复准备保留只读档；缺档、坏档、过宽、符号链接都不改', async () => {
  const root = tempDir();
  const target = path.join(root, 'demo');
  const bin = fakeDsh(root);
  try {
    prepare(target, bin);
    const file = path.join(target, 'hub', 'config', 'permission-mode.json');
    writePermissionMode(file, 'readonly');
    prepare(target, bin);
    assert.equal(fs.readFileSync(file, 'utf8'), READONLY_TEXT);
    assert.equal(readPermissionMode(file).mode, 'readonly');
    assert.equal((await readHome(path.join(target, 'hub'))).puts, 0);

    fs.unlinkSync(file);
    prepare(target, bin);
    assert.equal(fs.existsSync(file), false);
    const missing = await readHome(path.join(target, 'hub'));
    assert.equal(missing.mode, 'ask');
    assert.equal(missing.puts, 0);

    const bad = '{坏\n';
    fs.writeFileSync(file, bad, {mode: 0o600});
    prepare(target, bin);
    assert.equal(fs.readFileSync(file, 'utf8'), bad);
    assert.equal(readPermissionMode(file).mode, 'ask');

    writePermissionMode(file, 'open');
    fs.chmodSync(file, 0o644);
    prepare(target, bin);
    assert.equal(fs.readFileSync(file, 'utf8'), OPEN_TEXT);
    assert.equal(bits(file), 0o644);
    assert.equal(readPermissionMode(file).mode, 'ask');

    fs.unlinkSync(file);
    const side = path.join(target, 'hub', 'config', 'side.json');
    fs.writeFileSync(side, READONLY_TEXT, {mode: 0o600});
    fs.symlinkSync(side, file);
    prepare(target, bin);
    assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(side, 'utf8'), READONLY_TEXT);
    assert.equal(readPermissionMode(file).mode, 'ask');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('安装脚本：全新目录写成全开；再装不覆盖只读', async () => {
  const dir = tempDir();
  try {
    const first = runInstall(dir, ['--apply']);
    assert.equal(first.status, 0, `${first.stdout ?? ''}${first.stderr ?? ''}`);
    const file = path.join(dir, 'config', 'permission-mode.json');
    assert.equal(fs.readFileSync(file, 'utf8'), OPEN_TEXT);
    assert.equal(bits(file), 0o600);
    const home = await readHome(dir);
    assert.equal(home.mode, 'open');
    assert.equal(home.puts, 0);
    writePermissionMode(file, 'readonly');
    const again = runInstall(dir, ['--apply']);
    assert.equal(again.status, 0, `${again.stdout ?? ''}${again.stderr ?? ''}`);
    assert.equal(fs.readFileSync(file, 'utf8'), READONLY_TEXT);
    assert.doesNotMatch(again.stdout ?? '', /新建 {2}文件 {2}config\//u);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('安装脚本：已有实例缺档、坏档、符号链接保持原样；演练不落盘', async () => {
  const root = tempDir();
  try {
    const old = path.join(root, 'old');
    fs.mkdirSync(path.join(old, 'config'), {recursive: true});
    fs.writeFileSync(path.join(old, 'config', 'hub.yaml'), 'mine\n', {mode: 0o600});
    const kept = runInstall(old, ['--apply']);
    assert.equal(kept.status, 0, `${kept.stdout ?? ''}${kept.stderr ?? ''}`);
    assert.equal(fs.existsSync(path.join(old, 'config', 'permission-mode.json')), false);
    assert.equal(fs.readFileSync(path.join(old, 'config', 'hub.yaml'), 'utf8'), 'mine\n');
    assert.match(kept.stdout ?? '', /保持原样/);
    const missing = await readHome(old);
    assert.equal(missing.mode, 'ask');
    assert.equal(missing.puts, 0);

    const badDir = path.join(root, 'bad');
    fs.mkdirSync(path.join(badDir, 'config'), {recursive: true});
    const badFile = path.join(badDir, 'config', 'permission-mode.json');
    fs.writeFileSync(badFile, '{坏\n', {mode: 0o600});
    const badRun = runInstall(badDir, ['--apply']);
    assert.equal(badRun.status, 0, `${badRun.stdout ?? ''}${badRun.stderr ?? ''}`);
    assert.equal(fs.readFileSync(badFile, 'utf8'), '{坏\n');
    assert.equal(readPermissionMode(badFile).mode, 'ask');

    const linkDir = path.join(root, 'link');
    fs.mkdirSync(path.join(linkDir, 'config'), {recursive: true});
    const side = path.join(linkDir, 'config', 'side.json');
    const link = path.join(linkDir, 'config', 'permission-mode.json');
    fs.writeFileSync(side, READONLY_TEXT, {mode: 0o600});
    fs.symlinkSync(side, link);
    const linkRun = runInstall(linkDir, ['--apply']);
    assert.equal(linkRun.status, 0, `${linkRun.stdout ?? ''}${linkRun.stderr ?? ''}`);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(side, 'utf8'), READONLY_TEXT);

    const dry = path.join(root, 'dry');
    const dryRun = runInstall(dry, ['--demo']);
    assert.equal(dryRun.status, 0, `${dryRun.stdout ?? ''}${dryRun.stderr ?? ''}`);
    assert.equal(fs.existsSync(dry), false);
    assert.match(dryRun.stdout ?? '', /permission-mode\.json/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('适配层读取设置不调用改档', () => {
  const text = fs.readFileSync(path.join(repo, 'packages/hub-web/hub-real.js'), 'utf8');
  const start = text.indexOf('async function getSettings()');
  const end = text.indexOf('async function setPermission(');
  assert.ok(start > 0 && end > start);
  const body = text.slice(start, end);
  assert.equal(body.includes('setPermission'), false);
  assert.equal(body.includes('/settings/permission'), false);
  assert.match(body, /method:\s*'GET'/);
});
