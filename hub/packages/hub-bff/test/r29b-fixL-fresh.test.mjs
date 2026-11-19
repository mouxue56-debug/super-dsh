// 旧数据还在时，配置空着也不能判成全新全开。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STACK_PORT = '3751';
const KERNEL_PORT = '3752';

function tempDir() {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'r29b-fixL-')));
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
  return spawnSync(process.execPath, [
    path.join(repo, 'scripts/demo-prepare.mjs'),
    '--target', target,
    '--port', STACK_PORT,
    '--kernel-port', KERNEL_PORT,
    '--dsh-bin', bin,
  ], {encoding: 'utf8'});
}

function runInstall(target, extra) {
  return spawnSync('/bin/bash', [
    path.join(repo, 'scripts/install.sh'), '--target', target, ...extra,
  ], {encoding: 'utf8'});
}

test('演示准备：配置还是空的，但助理目录已在，不写全开', () => {
  const root = tempDir();
  const target = path.join(root, 'demo');
  fs.mkdirSync(path.join(target, 'hub', 'bots', 'writer'), {recursive: true});
  try {
    const result = prepare(target, fakeDsh(root));
    assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
    const file = path.join(target, 'hub', 'config', 'permission-mode.json');
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('演示准备：只剩会话文件，配置空着也不写全开', () => {
  const root = tempDir();
  const target = path.join(root, 'demo');
  const data = path.join(target, 'hub', 'hub-data');
  fs.mkdirSync(data, {recursive: true});
  fs.writeFileSync(path.join(data, 'sessions.json'), '{}\n', {mode: 0o600});
  try {
    const result = prepare(target, fakeDsh(root));
    assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
    const file = path.join(target, 'hub', 'config', 'permission-mode.json');
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('安装：配置目录没有档，但已有助理或工单，不写全开', () => {
  const root = tempDir();
  try {
    const bots = path.join(root, 'bots-only');
    fs.mkdirSync(path.join(bots, 'bots', 'writer'), {recursive: true});
    const kept = runInstall(bots, ['--apply']);
    assert.equal(kept.status, 0, `${kept.stdout ?? ''}${kept.stderr ?? ''}`);
    assert.equal(fs.existsSync(path.join(bots, 'config', 'permission-mode.json')), false);
    assert.match(kept.stdout ?? '', /保持原样/);

    const tickets = path.join(root, 'tickets-only');
    fs.mkdirSync(path.join(tickets, 'board', 'tickets'), {recursive: true});
    fs.writeFileSync(path.join(tickets, 'board', 'tickets', 'one.json'), '{}\n', {mode: 0o600});
    const ticketRun = runInstall(tickets, ['--apply']);
    assert.equal(ticketRun.status, 0, `${ticketRun.stdout ?? ''}${ticketRun.stderr ?? ''}`);
    assert.equal(fs.existsSync(path.join(tickets, 'config', 'permission-mode.json')), false);
    assert.match(ticketRun.stdout ?? '', /保持原样/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
