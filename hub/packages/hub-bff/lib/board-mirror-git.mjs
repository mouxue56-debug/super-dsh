import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { ID_PATTERN } from './ticket.mjs';

function git(dir, args, input, binary) {
  // 镜像仓库独立于启动进程的 Git 环境和用户配置，提交不执行系统模板或钩子。
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' });
  const options = ['-C', dir, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=board-mirror',
    '-c', 'user.email=mirror@localhost', '-c', 'commit.gpgSign=false', '-c', 'core.attributesFile=/dev/null'];
  return new Promise((resolve, reject) => {
    const child = execFile(binary, [...options, ...args], { env, maxBuffer: 4 * 1024 * 1024, timeout: 10000 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function createMirrorGit(dir, binary = 'git') {
  const run = (args, input) => git(dir, args, input, binary);
  const hasRemote = async () => Boolean((await run(['remote'])).trim());
  return {
    async inspect(dotGit) {
      if (!dotGit) return 'new';
      if (!dotGit.isDirectory()) return 'wrong-root';
      if (await hasRemote()) return 'remote';
      const root = (await run(['rev-parse', '--show-toplevel'])).trim();
      return await realpath(root) === await realpath(dir) ? 'ready' : 'wrong-root';
    },
    async init() {
      await run(['init', '--quiet', '--template=']);
    },
    hasRemote,
    async commit(paths, message) {
      // 只添加本模块生成的路径和从这些路径删除的旧文件。
      const tracked = (await run(['ls-files', '-z'])).split('\0').filter(Boolean);
      for (const file of tracked) {
        const match = /^(?:cards|archive)\/([^/]+)\.md$/u.exec(file);
        if ((match && ID_PATTERN.test(match[1])) || /^mine\/[A-Za-z0-9_.-]{1,64}\.md$/u.test(file)) {
          paths.add(file);
        }
      }
      const options = ['--pathspec-from-file=-', '--pathspec-file-nul'];
      const input = [...paths].join('\0') + '\0';
      await run(['--literal-pathspecs', 'add', ...options], input);
      const staged = (await run(['diff', '--cached', '--name-only', '-z', '--no-renames'])).split('\0');
      if (!staged.some(file => paths.has(file))) return;
      if (await hasRemote()) return 'remote';
      await run(['--literal-pathspecs', 'commit', '--quiet', '--no-gpg-sign', '--only', '-m', message, ...options],
        input);
    },
  };
}
