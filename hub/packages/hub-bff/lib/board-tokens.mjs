import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from './board-lock.mjs';
const scopes = ['read', 'work', 'work+create'];
const file = dir => join(dir, 'board-tokens.json');
// 令牌文件的读改写必须串行，否则并发时后写者会覆盖先写者（撤销被写回有效）。
const withStoreLock = (dir, fn) => withFileLock(join(dir, 'board-tokens.lock'), fn);
const digest = value => createHash('sha256').update(value).digest('hex');

async function readStore(dir, missingOkay = false) {
  try {
    const path = file(dir);
    const info = await stat(path);
    if (!info.isFile() || (info.mode & 0o7777) !== 0o600) {
      throw new Error('Token file permissions must be 0600');
    }
    const store = JSON.parse(await readFile(path, 'utf8'));
    if (store.version !== 1 || !Array.isArray(store.tokens)) {
      throw new Error('Invalid token file');
    }
    return store;
  } catch (error) {
    if (missingOkay && error.code === 'ENOENT') {
      return {
        version: 1,
        tokens: []
      };
    }
    throw error;
  }
}

async function save(dir, store) {
  const target = file(dir);
  const temp = join(dir, `.board-tokens-${randomBytes(16).toString('hex')}.tmp`);
  await writeFile(temp, JSON.stringify(store) + '\n', {
    mode: 0o600,
    flag: 'wx'
  });
  await rename(temp, target);
}
// 签发访问令牌
export async function issueToken(configDir, {
  name,
  scope = 'read',
  reserved = []
}, nowMs = Date.now()) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
    throw new Error('Invalid name');
  }
  if (!scopes.includes(scope)) {
    throw new Error('Invalid scope');
  }
  // 令牌名不得与名册里的助理重名（HTTP 身份只有名字，重名即可冒充）。
  if (!Array.isArray(reserved) || reserved.includes(name)) {
    throw new Error('Reserved name');
  }
  await mkdir(configDir, {
    recursive: true,
    mode: 0o700
  });
  if (((await stat(configDir)).mode & 0o7777) !== 0o700) {
    throw new Error('Token directory permissions must be 0700');
  }
  return withStoreLock(configDir, async () => {
    const store = await readStore(configDir, true);
    if (store.tokens.some(entry => entry.name === name)) {
      throw new Error('Name already exists');
    }
    const token = `dsb_${randomBytes(32).toString('base64url')}`;
    const entry = {
      name,
      scope,
      hash: digest(token),
      createdAt: new Date(nowMs).toISOString(),
      revoked: false
    };
    store.tokens.push(entry);
    await save(configDir, store);
    return {
      token,
      entry
    };
  });
}
// 撤销访问令牌
export async function revokeToken(configDir, name) {
  return withStoreLock(configDir, async () => {
    const store = await readStore(configDir);
    const entry = store.tokens.find(item => item.name === name);
    if (!entry) {
      throw new Error('Name not found');
    }
    entry.revoked = true;
    await save(configDir, store);
  });
}
// 验证访问令牌
export async function verifyToken(configDir, rawToken) {
  if (typeof rawToken !== 'string') {
    return null;
  }
  try {
    const store = await readStore(configDir);
    const hash = Buffer.from(digest(rawToken), 'hex');
    for (const entry of store.tokens) {
      if (typeof entry.hash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.hash)) {
        continue;
      }
      if (timingSafeEqual(hash, Buffer.from(entry.hash, 'hex')) && entry.revoked === false &&
        typeof entry.name === 'string' && scopes.includes(entry.scope)) {
        return {
          name: entry.name,
          scope: entry.scope
        };
      }
    }
  } catch {/* Missing, unreadable, invalid or insecure files cannot authenticate. */}
  return null;
}
// 判断权限范围是否允许操作
export function scopeAllows(scope, action) {
  return scope === 'read' && action === 'read' || scope === 'work' && ['read', 'work'].includes(action) ||
    scope === 'work+create' && ['read', 'work', 'create'].includes(action);
}

// 列出还有效的外部身份（只给名字和权限，不给任何令牌内容）。
export async function listTokenNames(dir) {
  try {
    const store = await readStore(dir);
    return store.tokens.filter(entry => entry && entry.revoked === false && typeof entry.name === 'string' &&
      scopes.includes(entry.scope)).map(entry => ({ name: entry.name, scope: entry.scope }));
  } catch {
    return [];
  }
}
