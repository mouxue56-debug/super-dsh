// 源码根的 .gitignore 写了 /*，但有文件被强制跟踪时，还原点快照不能因此失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { snapshot } from '../ops/rescue.mjs';

test('被 /* 忽略但已跟踪的文件，快照能做成并且带上新文件', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'r46-snap-')));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q');
  fs.writeFileSync(path.join(root, '.gitignore'), '/*\n!/.gitignore\n!/packages/\n');
  fs.mkdirSync(path.join(root, 'docs')); fs.writeFileSync(path.join(root, 'docs', 'a.md'), 'x');
  git('add', '-f', '.gitignore', 'docs/a.md'); git('commit', '-q', '-m', 'init');
  fs.mkdirSync(path.join(root, 'packages', 'shell'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'shell', 'b.js'), 'y');
  const config = { source_dir: root, runtime_dir: fs.mkdtempSync(path.join(os.tmpdir(), 'r46-run-')) };
  const commit = await snapshot(config, '测试');
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', commit], { cwd: root }).toString();
  assert.match(names, /docs\/a\.md/); assert.match(names, /packages\/shell\/b\.js/);
});
