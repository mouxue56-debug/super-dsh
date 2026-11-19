// 把线 C 的事件账（v1，见 hub-bff/docs/ledger-schema.md）映射成晨会晚会用的事件结构。
// 本文件只读账本，不写任何东西；路径与日期都由调用方传入。
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

// 取一个可显示的单行字符串，空值返回空串。
function text(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

// 把一行账本转成会议事件；不认识、不相关或缺少助理标识的行返回 null。
export function ledgerRowToEvent(row) {
  if (!row || typeof row !== 'object' || row.v !== 1) return null;
  if (typeof row.bot !== 'string' || !row.bot || typeof row.ts !== 'string') return null;
  const base = {ts: row.ts, assistant: row.bot, ticket: row.ticket ?? null, key: row.key ?? null};

  if (row.kind === 'approval') {
    const what = text(row.action) || text(row.tool) || '审批';
    const target = text(row.target);
    const outcome = text(row.outcome);
    const pending = !outcome || outcome === 'pending' || outcome === 'asked';
    return {
      ...base,
      kind: pending ? 'approval_pending' : 'note',
      resolved: !pending,
      text: pending ? `${what}${target ? ' ' + target : ''}` : `审批 ${what} → ${outcome}`,
    };
  }
  if (row.kind === 'action') {
    const tool = text(row.tool) || '动作';
    return {...base, kind: 'note', text: `动作 ${tool} ${text(row.target)}`.trim()};
  }
  if (row.kind === 'change') {
    const what = text(row.what) || '变更';
    const subject = text(row.subject);
    return {...base, kind: 'note', text: `变更 ${what} ${subject}`.trim()};
  }
  if (row.kind === 'dispatch') {
    const exit = Number.isInteger(row.exitCode) ? `退出码 ${row.exitCode}` : '退出码未知';
    return {...base, kind: 'note', text: `派活 ${text(row.worker) || '工人'} ${exit}`};
  }
  // call 行是逐次模型调用，对会议没有内容，不转换。
  return null;
}

// 把多行账本转成会议事件数组，坏行与不相关行跳过，按 key 去重。
export function ledgerRowsToEvents(rows) {
  const seen = new Set();
  const events = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const event = ledgerRowToEvent(row);
    if (!event) continue;
    if (event.key) {
      if (seen.has(event.key)) continue;
      seen.add(event.key);
    }
    events.push(event);
  }
  return events;
}

// 读取账本目录里指定日期（YYYY-MM-DD 数组）的文件并转成会议事件；目录或文件缺失当作没有。
export function readLedgerEvents(ledgerRoot, dates) {
  const rows = [];
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式无效');
    const file = path.join(ledgerRoot, 'events', `${date}.jsonl`);
    let stat;
    try {
      stat = fs.lstatSync(file);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        // 坏行跳过
      }
    }
  }
  return ledgerRowsToEvents(rows);
}
