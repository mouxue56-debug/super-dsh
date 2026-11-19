import fs from 'node:fs';
import path from 'node:path';
import { parseRuleLines, rulesConfig, stripTags, RULE_DEFAULTS } from '../../../hub-plugin/tools/rules.mjs';

const MAX_FILE_BYTES = 65536;
const MAX_LINES = 100;
const BOT_ID = /^[a-z][a-z0-9-]{1,23}$/u;

// 回 JSON，不缓存。
function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

// 读一个小文本文件：只认普通文件（不跟软链接）且不超过 64KB；读不到一律当没有。
function readSmall(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// 目录必须是真目录（不是软链接）才往里读。
function realDir(dir) {
  try {
    const stat = fs.lstatSync(dir);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

// 取一页里格式正确的规矩行，剥掉助理自写的权威标签，最多取最后 100 行。
function pageLines(text) {
  const rows = [];
  for (const row of parseRuleLines(text).rules) {
    const rule = stripTags(row.rule).text.trim();
    const quote = stripTags(row.quote).text.trim();
    if (rule && quote) rows.push({ date: row.date, text: rule, quote });
  }
  return rows.slice(-MAX_LINES);
}

// 「规矩页」扩展：只读，挂在密钥校验之后，只认 GET /rules。
export function createHandler(deps = {}) {
  let cfg;
  try {
    cfg = rulesConfig(deps.hubConfig?.rules);
  } catch {
    cfg = null;
  }
  return async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.replace(/\/+$/u, '');
    if (pathname !== '/rules') return false;
    if (req.method !== 'GET') {
      send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '规矩页只读' } });
      return true;
    }
    try {
      const names = cfg ?? RULE_DEFAULTS;
      const botsDir = deps.botsDir ?? path.join(deps.hubHome ?? '', 'bots');
      const result = { shared: [], bots: [] };
      if (cfg && deps.hubHome) {
        const sharedDir = path.join(deps.hubHome, 'shared');
        if (realDir(sharedDir)) result.shared = pageLines(readSmall(path.join(sharedDir, names.shared_file)));
      }
      for (const bot of cfg ? deps.roster?.list?.() ?? [] : []) {
        if (typeof bot?.id !== 'string' || !BOT_ID.test(bot.id) || !realDir(path.join(botsDir, bot.id))) continue;
        result.bots.push({ id: bot.id, name: typeof bot.name === 'string' ? bot.name.slice(0, 30) : bot.id,
          lines: pageLines(readSmall(path.join(botsDir, bot.id, names.page_file))) });
      }
      send(res, 200, result);
    } catch {
      send(res, 500, { error: { code: 'RULES_READ_FAILED', message: '读规矩页失败' } });
    }
    return true;
  };
}
