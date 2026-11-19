// 接新壳：离线环境。假后端 3595 + 网页服务 3596，壳目录由命令行给出；不连真实后端，不调模型。
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHubWeb } from '../server.mjs';
import { startMockBff } from './mock-bff.mjs';
import { attachExtras } from './r28-mock-extras.mjs';

const shell = process.argv[2];
if (!shell) throw new Error('用法：node test/r28-shell-env.mjs <壳目录> [临时目录]');
const dir = join(resolve(process.argv[3] || process.env.HUB_TEST_TMP || '.'), 'env-run') + '/';
await mkdir(dir, { recursive: true });
await writeFile(dir + 'web.fixture', 'r28-offline-web', { mode: 0o600 });
await writeFile(dir + 'bff.fixture', 'r28-offline-bff', { mode: 0o600 });
const fake = await startMockBff({ port: 3595 });
attachExtras(fake);
const web = await createHubWeb({
  HUB_WEB_HOSTS: '127.0.0.1', HUB_WEB_PORT: '3596', HUB_WEB_SHELL_DIR: resolve(shell),
  HUB_WEB_KEY_FILE: dir + 'web.fixture', BFF_KEY_FILE: dir + 'bff.fixture', BFF_URL: fake.url
});
console.log('接新壳离线环境已监听 3596，假后端 3595；壳 ' + resolve(shell) + '；PID ' + process.pid);
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => { await web.close(); await fake.close(); process.exit(0); });
}
