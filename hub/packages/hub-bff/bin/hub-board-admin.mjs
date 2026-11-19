#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { issueToken, revokeToken } from '../lib/board-tokens.mjs';

async function main(args) {
  let dir = process.env.HUB_BOARD_CONFIG_DIR;
  const at = args.indexOf('--config-dir');
  if (at !== -1) {
    if (!args[at + 1]) {
      throw new Error('Usage error');
    }
    dir = args[at + 1];
    args.splice(at, 2);
  }
  // 令牌名不得与名册助理重名：--reserved a,b 或环境变量 HUB_BOARD_RESERVED_NAMES。
  let reservedText = process.env.HUB_BOARD_RESERVED_NAMES ?? '';
  const rat = args.indexOf('--reserved');
  if (rat !== -1) {
    if (!args[rat + 1]) {
      throw new Error('Usage error');
    }
    reservedText = args[rat + 1];
    args.splice(rat, 2);
  }
  const reserved = reservedText.split(',').map(item => item.trim()).filter(Boolean);
  if (!dir) {
    throw new Error('Usage error');
  }
  // 默认把名册（<配置目录>/bots.yaml）里每位助理的编号和名字都当保留名。
  try {
    const roster = JSON.parse(await readFile(join(dir, 'bots.yaml'), 'utf8'));
    for (const bot of roster?.bots ?? []) {
      for (const value of [bot?.id, bot?.name]) {
        if (typeof value === 'string' && value) reserved.push(value);
      }
    }
    reserved.push('owner');
  } catch (error) {
    // 没有名册文件（比如只装了看板）照常签；BFF 验令牌时还会再按名册拒同名。名册在但读不出才不签。
    if (error?.code !== 'ENOENT' && args[0] === 'issue' && !reservedText) {
      throw new Error('名册读不出：用 --reserved 显式给出全部助理的编号与名字');
    }
  }
  const [command, name, option, scope] = args;
  if (command === 'issue' && name && (args.length === 2 || args.length === 4 && option === '--scope' && scope)) {
    const result = await issueToken(dir, {
      name,
      reserved,
      ...(scope ? {
        scope
      } : {})
    });
    process.stdout.write(result.token + '\n');
  } else if (command === 'revoke' && name && args.length === 2) {
    await revokeToken(dir, name);
    process.stdout.write('Revoked\n');
  } else if (command === 'list' && args.length === 1) {
    const path = join(dir, 'board-tokens.json');
    const info = await stat(path);
    if (!info.isFile() || (info.mode & 0o7777) !== 0o600) {
      throw new Error('Invalid file permissions');
    }
    const store = JSON.parse(await readFile(path, 'utf8'));
    if (store.version !== 1 || !Array.isArray(store.tokens)) {
      throw new Error('Invalid token file');
    }
    process.stdout.write(JSON.stringify(store.tokens.map(({
      name,
      scope,
      createdAt,
      revoked
    }) => ({
      name,
      scope,
      createdAt,
      revoked
    })), null, 2) + '\n');
  } else {
    throw new Error('Usage error');
  }
}

try {
  await main(process.argv.slice(2));
} catch {
  process.stderr.write('Operation failed or invalid usage\n');
  process.exitCode = 1;
}
