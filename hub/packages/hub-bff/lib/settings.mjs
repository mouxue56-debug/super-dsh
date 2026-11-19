// 设置：全家共用的权限档位，以及按助理的模型与思考强度。
// 档位只写运行目录里那一个小文件。模型和思考强度不另存一份。
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { modeFilePath, readPermissionMode, writePermissionMode, MODES } from '../../hub-plugin/permission-mode.mjs';

// 每月预算。只存在运行目录里一个小文件 budget.json；默认没有这个文件，也就是「不设」。
// 界面只在设了预算时才画进度条。金额是人填的上限，不是服务商账单。
export const BUDGET_CURRENCIES = ['CNY', 'USD'];
const BUDGET_MAX = 100000000;
export function budgetFile(hubHome) {
  if (typeof hubHome !== 'string' || !hubHome) throw new Error('没有运行目录');
  return path.join(hubHome, 'budget.json');
}
export function readBudget(hubHome) {
  try {
    const value = JSON.parse(fs.readFileSync(budgetFile(hubHome), 'utf8'));
    const monthly = value?.monthly;
    const currency = BUDGET_CURRENCIES.includes(value?.currency) ? value.currency : 'CNY';
    if (typeof monthly === 'number' && Number.isFinite(monthly) && monthly > 0 && monthly <= BUDGET_MAX) {
      return { monthly, currency };
    }
  } catch { /* 没有文件或读不了都当作没设 */ }
  return { monthly: null, currency: 'CNY' };
}
// monthly 为 null 表示取消预算（把文件写成不设，不删文件）。
export function saveBudget(hubHome, { monthly, currency }) {
  if (monthly !== null && !(typeof monthly === 'number' && Number.isFinite(monthly) && monthly > 0 && monthly <= BUDGET_MAX)) {
    throw new Error('预算无效');
  }
  const cur = BUDGET_CURRENCIES.includes(currency) ? currency : 'CNY';
  const file = budgetFile(hubHome);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomBytes(6).toString('hex');
  const rounded = monthly === null ? null : Math.round(monthly * 100) / 100;
  fs.writeFileSync(tmp, JSON.stringify({ monthly: rounded, currency: cur }) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
  return readBudget(hubHome);
}

export const MODEL_BLOCK = '内核预设的模型和思考强度只能查看，不能按助理写回，也不另存一份';

// 从内核预设正文里读 agents 的 model / reasoningEffort。没有这些行就空。
export function parsePresetModel(content) {
  if (typeof content !== 'string' || content.length > 200000) return { model: null, effort: null };
  const line = (name) => {
    const matched = content.match(new RegExp(`^[ \\t]*${name}:[ \\t]*([A-Za-z0-9_.:/@+-]+)[ \\t]*$`, 'mu'));
    return matched ? matched[1] : null;
  };
  const provider = line('provider');
  const model = line('model');
  const effort = line('reasoningEffort');
  const ref = model && provider && !model.includes('/') ? `${provider}/${model}` : model;
  return { model: ref, effort };
}

export function permissionFile(hubHome) {
  if (typeof hubHome !== 'string' || !hubHome) throw new Error('没有运行目录');
  return modeFilePath(hubHome);
}

export function currentMode(hubHome) {
  return readPermissionMode(permissionFile(hubHome)).mode;
}

export function saveMode(hubHome, mode) {
  if (!MODES.includes(mode)) throw new Error('档位无效');
  const file = permissionFile(hubHome);
  writePermissionMode(file, mode);
  return readPermissionMode(file).mode;
}

// 只读拼出 GET 的正文。readPreset 缺席时模型与思考强度为空，不连内核、不读令牌。
export async function readSettings(deps) {
  const mode = currentMode(deps.hubHome);
  const rows = typeof deps.roster?.list === 'function' ? deps.roster.list() : [];
  const bots = {};
  for (const row of rows) {
    if (!row || typeof row.id !== 'string') continue;
    let parsed = { model: null, effort: null };
    if (typeof deps.readPreset === 'function') {
      try {
        const content = await deps.readPreset(row.preset ?? row.id);
        parsed = parsePresetModel(content);
      } catch {
        parsed = { model: null, effort: null };
      }
    }
    bots[row.id] = { model: parsed.model, effort: parsed.effort };
  }
  return {
    ok: true,
    permission: { mode },
    budget: readBudget(deps.hubHome),
    bots,
    models: [],
    modelsWritable: false,
    modelsBlock: MODEL_BLOCK,
  };
}
