import { open, mkdir, rename, unlink, constants } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BffError } from './errors.mjs';

const empty = () => ({ version: 1, topics: {}, requests: {}, moves: {}, merges: {} });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const failure = () => new BffError('STORAGE_FAILURE', '话题记录暂时无法读写，请稍后再试', 503);

// 全部改归信息单独存储，写入串行且先落盘再发布内存状态。
export function topicStore(file) {
  let state = empty(), tail = Promise.resolve();
  const ready = (async () => {
    if (!file) return;
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!(await handle.stat()).isFile()) throw failure();
      const loaded = JSON.parse(await handle.readFile('utf8'));
      if (loaded.version !== 1 || !['topics', 'requests', 'moves', 'merges'].every(k => object(loaded[k]))) {
        throw failure();
      }
      state = loaded;
    } catch (error) { if (error.code !== 'ENOENT') throw failure(); }
    finally { await handle?.close(); }
  })();
  ready.catch(() => {});
  async function save(next) {
    if (!file) return;
    const temporary = file + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      await handle.writeFile(JSON.stringify(next) + '\n');
      await handle.sync();
      await handle.close(); handle = null;
      await rename(temporary, file);
    } catch { throw failure(); }
    finally {
      await handle?.close();
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw failure(); });
    }
  }
  return {
    async read() { await ready; await tail; return structuredClone(state); },
    change(fn) {
      const job = tail.then(async () => {
        await ready;
        const next = structuredClone(state), value = await fn(next);
        await save(next);
        state = next;
        return value;
      });
      tail = job.catch(() => {});
      return job;
    },
  };
}
