import fs from 'node:fs';

export const OFFLINE = '审批通道不在线（手机端没连上），这一步没做';
export const FALLBACK_TIMEOUT = '没等到你点头，这一步没做（审批等待超过 10 分 30 秒）';
export const HEARTBEAT_MAX_AGE = 15000;
export const HEARTBEAT_POLL = 2000;
export const APPROVAL_TIMEOUT = 630000;

// 心跳是宿主配置，不能由模型指定；拒绝链接与异常文件，避免读到任意目标。
export function heartbeatOnline(file, now = Date.now()) {
 let fd;
 try {
  fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.size > 4096) return false;
  const h = JSON.parse(fs.readFileSync(fd, 'utf8'));
  return h.v === 1 && Number.isSafeInteger(h.ts) && h.ts <= now + 1000 && now - h.ts <= HEARTBEAT_MAX_AGE
   && h.dshConnected === true && h.answering === true;
 } catch { return false; }
 finally { if (fd !== undefined) fs.closeSync(fd); }
}

// next() 的迟到批准只会结束自己的 Promise，不能推翻已返回的拒绝。
// 不修改只读 ApprovalRequest.signal；Gateway 的剩余 pending 由原 signal/agent 销毁回收。
export function watchApproval({file, signal, next, fail, pollMs = HEARTBEAT_POLL, timeoutMs = APPROVAL_TIMEOUT}) {
 return new Promise(resolve => {
  let done = false, interval, timeout;
  const finish = outcome => {
   if (done) return;
   done = true;
   clearInterval(interval); clearTimeout(timeout);
   signal?.removeEventListener('abort', abort);
   resolve(outcome);
  };
  const reject = reason => { if (!done) { fail(reason); finish('rejected'); } };
  const abort = () => { if (!done) { fail('审批已取消，这一步没做'); finish('rejected'); } };
  if (signal?.aborted) return abort();
  if (!heartbeatOnline(file)) return reject(OFFLINE);
  signal?.addEventListener('abort', abort, {once: true});
  interval = setInterval(() => { if (!heartbeatOnline(file)) reject(OFFLINE); }, pollMs);
  timeout = setTimeout(() => reject(FALLBACK_TIMEOUT), timeoutMs);
  Promise.resolve().then(next).then(outcome => {
   if (done) return;
   if (outcome !== 'allowed-once') return reject('主人 没批准，这一步没做');
   if (!heartbeatOnline(file)) return reject(OFFLINE);
   finish('allowed-once');
  }, () => reject(OFFLINE));
 });
}
