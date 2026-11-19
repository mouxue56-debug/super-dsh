// 已知基线失败也照实输出并令总入口非零退出；各段失败后继续运行后续段。
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const rootTests = [];
for (const name of readdirSync(new URL('./', import.meta.url)).sort()) {
  if (name.endsWith('.test.mjs')) rootTests.push(`test/${name}`);
}
const sections = [
  { name: 'hub-bff', cwd: 'packages/hub-bff', args: ['--run', 'test'] },
  { name: 'hub-plugin', cwd: 'packages/hub-plugin', args: ['--run', 'test'] },
  { name: 'hub-web', cwd: 'packages/hub-web', args: ['--run', 'test'] },
  { name: '根测试', cwd: '.', args: ['--test', ...rootTests] },
];

// 运行一段测试，保留原始输出并提取 Node 测试汇总。
function runSection(section) {
  console.log(`\n========== ${section.name} ==========`);
  const result = spawnSync(process.execPath, section.args, {
    cwd: resolve(root, section.cwd),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  if (result.error) console.error(result.error.message);
  return {
    name: section.name,
    pass: count(output, 'pass'),
    fail: count(output, 'fail'),
    skip: count(output, 'skipped'),
    status: result.status,
  };
}

// 从测试输出读取指定计数，未产生汇总时明确标为未知。
function count(output, key) {
  return output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? '未知';
}

const results = [];
for (const section of sections) results.push(runSection(section));
console.log('\n========== 汇总 ==========');
for (const result of results) {
  const counts = `通过 ${result.pass}，失败 ${result.fail}，跳过 ${result.skip}`;
  console.log(`${result.name}：${counts}；退出 ${result.status}`);
  if (result.status !== 0) process.exitCode = 1;
}
