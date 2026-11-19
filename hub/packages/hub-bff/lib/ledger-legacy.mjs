import { createHash } from 'node:crypto';

function parse(text, kind, count) {
  const rows = [];
  let bad = 0;
  for (const line of (text ?? '').split(/\r?\n/)) {
    if (!line) continue;
    const cols = line.split('\t');
    const ms = Date.parse(cols[0]);
    if (cols.length !== count || !Number.isFinite(ms) || cols.some((x) => !x)) {
      bad++;
      continue;
    }
    const [ts, bot, tool, target, value, device] = cols;
    const common = {
      kind,
      ts,
      tsMs: ms,
      bot,
      sessionId: null,
      ticket: null,
      backfill: true,
      key: `legacy:${kind}:${createHash('sha1').update(line).digest('hex')}`,
    };
    rows.push(
      kind === 'approval'
        ? {
          ...common,
          approvalId: null,
          seq: null,
          tool,
          level: null,
          action: null,
          target,
          device: device === '-' ? null : device,
          outcome: value,
          askedTsMs: null,
        }
        : { ...common, tool, target, level: value },
    );
  }
  return { rows, bad };
}

// 解析审批日志。
export const parseApprovalsLog = (text) => parse(text, 'approval', 6);

// 解析操作日志。
export const parseActionsLog = (text) => parse(text, 'action', 5);

// 导入旧版日志。
export async function importLegacy(ledger, { approvalsText = '', actionsText = '' } = {}) {
  const a = parseApprovalsLog(approvalsText), b = parseActionsLog(actionsText);
  const result = { written: 0, duplicate: 0, bad: a.bad + b.bad };
  for (const row of [...a.rows, ...b.rows]) {
    const r = await ledger.record(row);
    result[r.written ? 'written' : 'duplicate']++;
  }
  return result;
}
