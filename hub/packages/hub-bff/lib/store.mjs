import { open, mkdir, rename, constants } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BffError } from './errors.mjs';
import { plainSummary } from './delegation-text.mjs';

const storageError = () => new BffError('STORAGE_FAILURE', 'Hub storage unavailable', 503);
import { BOT_ID } from './roster.mjs';
const validRow = row => row && typeof row === 'object' &&
  typeof row.id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(row.id) &&
  BOT_ID.test(row.bot ?? "") && typeof row.title === 'string' &&
  typeof row.lastText === 'string' && [null, 'user', 'assistant', 'error'].includes(row.lastRole) &&
  Number.isFinite(row.updatedAt) && Number.isSafeInteger(row.unread) && row.unread >= 0 &&
  typeof row.running === 'boolean';
const metaText = v => typeof v === 'string' && v.length > 0 && v.length <= 100 && !/[\u0000-\u001f\u007f]/u.test(v);
// 组内工作会话等「不进会话列表」的行带 hidden 与少量元数据；普通行形状不变。
const cleanRow = row => ({id:row.id, bot:row.bot, title:row.title, lastText:row.lastText,
  lastRole:row.lastRole, updatedAt:row.updatedAt, unread:row.unread, running:row.running,
  ...(row.hidden === true ? {hidden:true} : {}),
  ...(metaText(row.purpose) ? {purpose:row.purpose} : {}),
  ...(metaText(row.groupId) ? {groupId:row.groupId} : {})});

// 文件写入串行执行；调用者拿到成功回执时，相应状态已经原子落盘。
export class SessionStore {
  #rows = new Map(); #writes = Promise.resolve();
  constructor(path, {logger = console} = {}) {
    this.path = path; this.logger = logger; this.cards = []; this.idempotency = [];
    this.ready = this.#load();
    // 处理器工厂保持同步；错误在 startServer 或首个认证请求中显式抛出。
    this.ready.catch(() => {});
  }
  async #load() {
    let file, content;
    try {
      await mkdir(dirname(this.path), {recursive:true, mode:0o700});
      file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!(await file.stat()).isFile()) throw storageError();
      content = await file.readFile('utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw storageError();
    } finally { await file?.close(); }
    if (content !== undefined) {
      let rows;
      try {
        const value = JSON.parse(content);
        rows = value.sessions;
        this.cards = Array.isArray(value.cards) ? value.cards : [];
        this.idempotency = Array.isArray(value.idempotency) ? value.idempotency : [];
        if (!Array.isArray(rows) || !rows.every(validRow) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('invalid');
      } catch {
        const backup = this.path + '.corrupt-' + Date.now();
        try { await rename(this.path, backup); } catch { throw storageError(); }
        this.logger.error('HUB_BFF_STORE_CORRUPT: 已保全损坏清单，重新建立空清单');
        rows = []; this.cards=[]; this.idempotency=[];
      }
      for (const row of rows) this.#rows.set(row.id, {...cleanRow(row), running:false});
    }
    for (const card of this.cards) {
      if (card.type !== 'approval' || card.status !== 'pending') continue;
      card.status = 'unavailable';
      card.reason = 'bff-restart';
      card.note = card.confirm === true ? 'BFF 已重启，这张卡作废' : 'BFF 已重启，这一步没做';
      card.resolvedAt = new Date().toISOString();
    }
    for (const card of this.cards) if(card.type==='delegation')card.summary=plainSummary(card.summary);
    await this.#persist();
  }
  #persist() {
    const text = JSON.stringify({sessions:[...this.#rows.values()],cards:this.cards,idempotency:this.idempotency}) + '\n';
    const write = this.#writes.then(async () => {
      let file;
      try {
        file = await open(this.path + '.tmp', constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
        await file.chmod(0o600); await file.writeFile(text); await file.sync();
        await file.close(); file = undefined;
        await rename(this.path + '.tmp', this.path);
      } catch { throw storageError(); }
      finally { await file?.close(); }
    });
    this.#writes = write.catch(() => {});
    return write;
  }
  get(id) { const row = this.#rows.get(id); return row && {...row}; }
  list(bot) { return [...this.#rows.values()].filter(row => bot === undefined || row.bot === bot)
    .sort((a,b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map(row => ({...row})); }
  async add(row) {
    await this.ready;
    if (!validRow(row)) throw storageError();
    if (this.#rows.has(row.id)) throw new BffError('CONFLICT', 'Session already belongs to Hub', 409);
    this.#rows.set(row.id, cleanRow(row)); await this.#persist(); return this.get(row.id);
  }
  async update(id, patch) {
    await this.ready;
    const row = this.get(id);
    if (!row) throw new BffError('NOT_FOUND', 'Hub session not found', 404);
    const next = {...row, ...(typeof patch === 'function' ? patch(row) : patch)};
    if (!validRow(next) || next.id !== id || next.bot !== row.bot) throw storageError();
    this.#rows.set(id, cleanRow(next)); await this.#persist(); return this.get(id);
  }
  async persist() { await this.ready; await this.#persist(); }
  async flush() { await this.ready; await this.#writes; }
}

// 只记接纳时间、bot、会话及 Unicode 字数，不接收正文。
export class CallLog {
  #writes = Promise.resolve();
  constructor(path) { this.path = path; }
  #append(line) {
    const write = this.#writes.then(async () => {
      let file;
      try {
        await mkdir(dirname(this.path), {recursive:true, mode:0o700});
        file = await open(this.path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
        if (!(await file.stat()).isFile()) throw storageError();
        await file.chmod(0o600);
        if (line) { await file.writeFile(line); await file.sync(); }
      } catch { throw storageError(); }
      finally { await file?.close(); }
    });
    this.#writes = write.catch(() => {}); return write;
  }
  prepare() { return this.#append(''); }
  append(bot, id, count, note) { return this.#append(`${new Date().toISOString()}\t${bot}\t${id}\t${count}${note ? '\t'+note : ''}\n`); }
  async flush() { await this.#writes; }
}
