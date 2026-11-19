#!/usr/bin/env node
// r24 监工：3392 是 http + tailnet 地址，不是安全上下文。
// 静态检查适配层与壳里只在安全上下文可用的接口；没有就近判空回退的列出并报警。
// 用法：node ops/check-secure-context.mjs <文件>...   退出码：适配层有未回退用法=1；仅壳里有=0（只报警，壳不归本轮改）。
import fs from 'node:fs';
const APIS = ['crypto.randomUUID', 'crypto.subtle', 'navigator.clipboard', 'serviceWorker', 'navigator.mediaDevices', 'Notification'];
// 就近（同一行或前 200 字内）出现这些写法之一，视为已判空回退
const GUARDS = [/typeof\s+[\w.]+\s*===?\s*['"]function['"]/, /typeof\s+[\w.]+\s*!==?\s*['"]undefined['"]/, /\bin\s+(navigator|window|globalThis|crypto)\b/, /\?\./, /isSecureContext/, /try\s*\{/];
let adapterBad = 0, shellWarn = 0, total = 0;
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const isShell = /shell[^/]*\/index\.html$/.test(file);
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // 跳过注释行
    for (const api of APIS) {
      let from = 0, at;
      while ((at = line.indexOf(api, from)) !== -1) {
        from = at + api.length;
        if (api === 'Notification' && !/\bNotification\b/.test(line.slice(Math.max(0, at - 1), at + api.length + 1))) continue;
        total++;
        const ctx = (lines[i - 1] || '').slice(-200) + line.slice(Math.max(0, at - 200), at + api.length + 40);
        const guarded = GUARDS.some(g => g.test(ctx));
        if (guarded) continue;
        const where = `${file}:${i + 1}:${at + 1}`;
        if (isShell) { shellWarn++; console.log(`【报警·壳】${where} 用了 ${api}，附近没有判空回退（壳归第22/25轮）`); }
        else { adapterBad++; console.log(`【不通过·适配层】${where} 用了 ${api}，附近没有判空回退`); }
      }
    }
  });
}
console.log(`安全上下文检查：共出现 ${total} 处；适配层未回退 ${adapterBad} 处，壳报警 ${shellWarn} 处`);
process.exit(adapterBad ? 1 : 0);
