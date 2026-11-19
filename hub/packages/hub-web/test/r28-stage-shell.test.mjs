import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../ops/stage-shell.sh', import.meta.url));

test('暂存成功、失败不切换及拒绝符号链接', { skip: !process.env.HUB_R28_SHELL_NEW }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'r28-stage-'));
  const source = join(dir, 'source');
  const target = join(dir, 'target');
  await mkdir(source);
  await mkdir(target);
  for (const name of ['assets', 'pets', 'fonts']) await mkdir(join(source, name));
  await copyFile(process.env.HUB_R28_SHELL_NEW, join(source, 'index.html'));
  await writeFile(join(source, 'manifest.webmanifest'), '{}');
  await writeFile(join(target, 'index.html'), '旧壳');
  const first = await run('/bin/bash', [script, source, target]);
  assert.match(first.stdout, /SHA256=[a-f0-9]{64} 文件数=/);
  const baseline = await readFile(join(target, 'index.html'), 'utf8');
  await writeFile(join(source, 'index.html'), '缺失契约');
  await assert.rejects(run('/bin/bash', [script, source, target]));
  assert.equal(await readFile(join(target, 'index.html'), 'utf8'), baseline);
  await symlink('manifest.webmanifest', join(source, 'link'));
  await assert.rejects(run('/bin/bash', [script, source, target]), /符号链接/);
});
