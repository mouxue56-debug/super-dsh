// 助理目录里只能经专用工具写的文件，三处共用同一份名单：
// write/edit 判定（policy.mjs）、命令判定（command-policy.mjs）、命令沙箱（command-sandbox.mjs）。
//
import {rulesConfig} from './tools/rules.mjs';

// 内置名单：根指令文件、规矩页、叠加指令文件。配置只能往上加，不能减。
export const PROTECTED_FILES = Object.freeze(['AGENTS.md', '规矩.md', 'AGENTS.local.md']);

// 比较用的折叠写法：全角半角、组合字符、大小写都按同一个算（APFS 默认不分大小写）。
export function foldName(name) {
  return String(name).normalize('NFKC').normalize('NFC').toLowerCase();
}

// 合并安装配置 rules 段里的规矩页与叠加文件名；配置不合格就只用内置名单（内置名单本身最严）。
export function protectedFileNames(rules) {
  const names = new Set(PROTECTED_FILES);
  try {
    const cfg = rulesConfig(rules ?? {});
    for (const name of [cfg.page_file, cfg.overlay_file]) {
      if (name) {
        names.add(name);
      }
    }
  } catch {
    // 配置坏了由规矩页模块自己报错；这里不放松，只保留内置名单。
  }
  return Object.freeze([...names]);
}

// 这个文件名是不是受保护的（只看最后一段；比较前折叠）。
export function isProtectedName(base, names = PROTECTED_FILES) {
  const folded = foldName(base);
  return [...PROTECTED_FILES, ...names].some(n => foldName(n) === folded);
}
