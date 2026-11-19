// 放弃的会话名单。内核没有删除会话的入口，只聊天名单又写不进去时，
// 后端把这个会话当场记进本名单：从此不再往里送任何一句话（没有回合就没有工具调用），也不收进会话清单。
// 内存先记、立即生效；落盘尽力而为（重启后仍认）。
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const MAX = 2000;

// 建名单；file 为落盘位置（可不给，只记内存）。
export function createDiscardList({ file, logger = console } = {}) {
  const ids = new Set();
  if (file) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value?.v === 1 && Array.isArray(value.sessions)) {
        for (const id of value.sessions) if (typeof id === 'string') ids.add(id);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') logger.error?.('HUB_DISCARD_LIST_UNREADABLE');
    }
  }
  return {
    // 是否已放弃。
    has: id => typeof id === 'string' && ids.has(id),
    // 记一个放弃的会话；落盘失败只记日志，内存里已经生效。
    add(id) {
      if (typeof id !== 'string' || !id) return false;
      ids.add(id);
      if (!file) return true;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        const tmp = file + '.' + randomBytes(6).toString('hex');
        fs.writeFileSync(tmp, JSON.stringify({ v: 1, sessions: [...ids].slice(-MAX) }) + '\n',
          { mode: 0o600, flag: 'wx' });
        fs.renameSync(tmp, file);
      } catch {
        logger.error?.('HUB_DISCARD_LIST_WRITE_FAILURE');
      }
      return true;
    },
  };
}
