// 模型密钥从 0600 文件读。用临时假值，不碰真实密钥文件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveModelKey, readKeyConfig } from '../scripts/model-key.mjs';

const DUMMY = 'dummy-model-key-n4';
const script = fileURLToPath(new URL('../scripts/model-key.mjs', import.meta.url));

function tempFile(mode, text = DUMMY + '\n') {
  const dir = mkdtempSync(join(tmpdir(), 'n4-key-'));
  const file = join(dir, 'key');
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, mode);
  return { dir, file };
}

test('0600 文件读得到；权限不对、链接、空文件都拒绝，报错不含密钥', () => {
  const ok = tempFile(0o600);
  try {
    const got = resolveModelKey({ file: ok.file, env: {} });
    assert.equal(got.value, DUMMY);
    assert.equal(got.source, 'file');
    assert.equal(got.warning, null);
  } finally { rmSync(ok.dir, { recursive: true, force: true }); }

  const bad = tempFile(0o644);
  try {
    assert.throws(() => resolveModelKey({ file: bad.file, env: { HUB_OPENCODE_KEY: DUMMY } }), (err) => {
      assert.equal(err.code, 'BAD_MODE');
      assert.match(err.message, /0600/u);
      assert.equal(err.message.includes(DUMMY), false);
      return true;
    });
  } finally { rmSync(bad.dir, { recursive: true, force: true }); }

  const linkDir = mkdtempSync(join(tmpdir(), 'n4-link-'));
  const real = join(linkDir, 'real');
  const link = join(linkDir, 'link');
  writeFileSync(real, DUMMY, { mode: 0o600 });
  chmodSync(real, 0o600);
  symlinkSync(real, link);
  try {
    assert.throws(() => resolveModelKey({ file: link, env: {} }), (err) => {
      assert.equal(err.code, 'BAD_FILE');
      assert.match(err.message, /不能是链接/u);
      assert.equal(err.message.includes(DUMMY), false);
      return true;
    });
  } finally { rmSync(linkDir, { recursive: true, force: true }); }

  const empty = tempFile(0o600, '\n');
  try {
    assert.throws(() => resolveModelKey({ file: empty.file, env: {} }), (err) => {
      assert.equal(err.code, 'EMPTY');
      assert.equal(err.message.includes(DUMMY), false);
      return true;
    });
  } finally { rmSync(empty.dir, { recursive: true, force: true }); }
});

test('没有文件时用环境变量并警告；两边都没有就拒绝。警告里没有密钥', () => {
  const fromEnv = resolveModelKey({ envName: 'HUB_OPENCODE_KEY', env: { HUB_OPENCODE_KEY: DUMMY } });
  assert.equal(fromEnv.source, 'env');
  assert.equal(fromEnv.value, DUMMY);
  assert.match(fromEnv.warning, /HUB_OPENCODE_KEY/u);
  assert.match(fromEnv.warning, /0600/u);
  assert.equal(fromEnv.warning.includes(DUMMY), false);
  assert.throws(() => resolveModelKey({ env: {} }), (err) => {
    assert.equal(err.code, 'ENV_MISSING');
    assert.match(err.message, /HUB_OPENCODE_KEY/u);
    assert.equal(err.message.includes(DUMMY), false);
    return true;
  });
});

test('配置只取路径和变量名', () => {
  const config = readKeyConfig('# 注释\napiKeyFile: ""\napiKeyEnv: HUB_OPENCODE_KEY\n');
  assert.deepEqual(config, { apiKeyFile: '', apiKeyEnv: 'HUB_OPENCODE_KEY' });
  const blob = 'k'.repeat(40);
  assert.throws(() => resolveModelKey({ file: blob, env: {} }), (err) => {
    assert.equal(err.code, 'BAD_CONFIG');
    assert.equal(err.message.includes(blob), false);
    return true;
  });
});

test('命令行：失败写在标准错误，标准输出不含密钥；成功只把密钥写到标准输出', () => {
  const bad = tempFile(0o644);
  try {
    const failed = spawnSync(process.execPath, [script, '--file', bad.file, '--env-name', 'HUB_OPENCODE_KEY'], {
      encoding: 'utf8', env: { ...process.env, HUB_OPENCODE_KEY: DUMMY },
    });
    assert.notEqual(failed.status, 0);
    assert.equal(failed.stdout.includes(DUMMY), false);
    assert.equal(failed.stderr.includes(DUMMY), false);
    assert.match(failed.stderr, /0600/u);
  } finally { rmSync(bad.dir, { recursive: true, force: true }); }

  const missing = spawnSync(process.execPath, [script, '--file', join(tmpdir(), 'n4-no-such-key'), '--fallback-env'], {
    encoding: 'utf8', env: { ...process.env, HUB_OPENCODE_KEY: DUMMY },
  });
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, DUMMY);
  assert.match(missing.stderr, /环境变量/u);
  assert.equal(missing.stderr.includes(DUMMY), false);
});
