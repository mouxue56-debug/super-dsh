import { link, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const remove = (path) =>
  unlink(path).catch((err) => {
    if (err.code !== "ENOENT") throw err;
  });

// 在破锁守卫下清除过期锁：改名到唯一名后复核，误取了新锁就放回。返回是否清除了。
async function breakStale(path, staleMs) {
  const guard = `${path}.brk`;
  let guardHandle;
  try {
    guardHandle = await open(guard, "wx", 0o600);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    try {
      const info = await stat(guard);
      if (Date.now() - info.mtimeMs > staleMs) await remove(guard);
    } catch (err2) {
      if (err2.code !== "ENOENT") throw err2;
    }
    return false;
  }
  try {
    let info;
    let seen;
    try {
      info = await stat(path);
      seen = await readFile(path, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return true;
      throw err;
    }
    if (Date.now() - info.mtimeMs <= staleMs) return false;
    const moved = `${path}.stale.${randomBytes(6).toString("hex")}`;
    try {
      await rename(path, moved);
    } catch (err) {
      if (err.code === "ENOENT") return true;
      throw err;
    }
    let content = null;
    let fresh = false;
    try {
      content = await readFile(moved, "utf8");
      fresh = Date.now() - (await stat(moved)).mtimeMs <= staleMs;
    } catch {}
    if (content !== seen || fresh) {
      try {
        await link(moved, path);
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
      }
      await remove(moved);
      return false;
    }
    await remove(moved);
    return true;
  } finally {
    await guardHandle.close();
    await remove(guard);
  }
}

// 带持有者随机数与过期接管的文件锁；拿不到时抛 code 为 LOCK_TIMEOUT 的错误。
export async function withFileLock(path, fn, { staleMs = 30000, tries = 150, delayMs = 10 } = {}) {
  const token = randomBytes(12).toString("hex");
  let handle;
  for (let index = 0; index < tries && !handle; index++) {
    try {
      handle = await open(path, "wx", 0o600);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let removed = false;
      try {
        const info = await stat(path);
        if (Date.now() - info.mtimeMs > staleMs) removed = await breakStale(path, staleMs);
      } catch (err2) {
        if (err2.code !== "ENOENT") throw err2;
        removed = true;
      }
      if (!removed) await sleep(delayMs);
    }
  }
  if (!handle) {
    const err = new Error("Lock timeout");
    err.code = "LOCK_TIMEOUT";
    throw err;
  }
  try {
    await handle.writeFile(token);
  } catch (err) {
    await handle.close();
    await remove(path);
    throw err;
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    try {
      if ((await readFile(path, "utf8")) === token) await remove(path);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
}
