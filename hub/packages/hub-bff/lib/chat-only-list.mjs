// 只聊天会话名单：后端建会话时写，插件读（格式 {"v":1,"sessions":[会话id]}，0600）。
// 插件那一侧见 hub-plugin/tools/index.mjs 的 chatOnlyReader；两边的路径都是 <HUB_HOME>/config/chat-only-sessions.json。
import { lstat, readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';

const MAX_BYTES = 262144;
const queues = new Map();

// 读出现有名单；文件不存在返回空，文件坏了抛错（写的一方不许把坏文件覆盖成只剩一条）。
export async function readChatOnlyList(file) {
  let st;
  try {
    st = await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (!st.isFile() || st.size > MAX_BYTES) throw new Error('只聊天名单不是普通文件或太大');
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (value?.v !== 1 || !Array.isArray(value.sessions) || value.sessions.some(x => typeof x !== 'string')) {
    throw new Error('只聊天名单格式不对');
  }
  return value.sessions;
}

// 把一个会话加进只聊天名单；同一文件的写入在本进程内排队，原子替换，权限 0600。
export function addChatOnlySession(file, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return Promise.reject(new Error('会话编号无效'));
  const previous = queues.get(file) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    const list = await readChatOnlyList(file);
    if (list.includes(sessionId)) return list;
    const next = [...list, sessionId];
    const text = JSON.stringify({ v: 1, sessions: next }) + '\n';
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('只聊天名单太大');
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = join(dirname(file), '.' + basename(file) + '.' + randomBytes(6).toString('hex'));
    try {
      await writeFile(tmp, text, { mode: 0o600, flag: 'wx' });
      await rename(tmp, file);
    } catch (error) {
      await unlink(tmp).catch(() => {});
      throw error;
    }
    return next;
  });
  queues.set(file, job);
  job.finally(() => {
    if (queues.get(file) === job) queues.delete(file);
  }).catch(() => {});
  return job;
}
