// 守住在真实例上踩过的坑：rc.1 重新载入会话时，遇到「类型不认识又没标可忽略」的自定义事件会整段拒绝，
// 会话历史就读不出来。所以源码里往会话日志追加事件，类型必须在内核认识的清单里；插件专用的记录入口一律不用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 内核认识的事件类型（对照 COMPAT.md 的 E01–E03）。
const KNOWN = new Set(['user/message', 'assistant/message', 'turn/start', 'step/start', 'turn/end',
  'tool/call', 'tool/result']);

// 列出要扫的源码：三个包里除测试、运行数据以外的 .mjs/.js/.cjs。
function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'test', 'run', '.tmp', 'scratch', 'shell', 'shell-r23'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(mjs|js|cjs)$/u.test(entry.name)) out.push(full);
  }
  return out;
}

// 找出一段源码里所有对会话日志的追加调用。
export function findAppends(text) {
  const hits = [];
  const call = /\b(?:session|agent\.session|\w+\.session)\??\.append\s*\(\s*(['"`])([^'"`]*)\1/gu;
  for (const match of text.matchAll(call)) hits.push({ kind: 'append', type: match[2] });
  const dynamic = /\b(?:session|agent\.session|\w+\.session)\??\.append\s*\(\s*(?!['"`])/gu;
  for (const _ of text.matchAll(dynamic)) hits.push({ kind: 'append', type: '<非字面量>' });
  if (/\bappendPluginRecord\s*\(/u.test(text)) hits.push({ kind: 'plugin-record', type: 'appendPluginRecord' });
  return hits;
}

test('扫描规则本身：认得出自定义类型、非字面量和插件专用记录入口', () => {
  assert.deepEqual(findAppends("agent.session.append('hub-plugin/notice',{})").map(h => h.type),
    ['hub-plugin/notice']);
  assert.deepEqual(findAppends('payload.agent.session.append(kind,{})').map(h => h.type), ['<非字面量>']);
  assert.equal(findAppends('s.appendPluginRecord(x)').length, 1);
  assert.equal(findAppends("lines.append('x')").length, 0);
});

test('源码里往会话日志追加的事件类型都在内核认识的清单里', () => {
  const bad = [];
  for (const pkg of ['hub-plugin', 'hub-bff', 'hub-web']) {
    for (const file of sources(path.join(root, 'packages', pkg))) {
      for (const hit of findAppends(fs.readFileSync(file, 'utf8'))) {
        if (hit.kind === 'plugin-record' || !KNOWN.has(hit.type)) {
          bad.push(path.relative(root, file) + '：' + hit.type);
        }
      }
    }
  }
  assert.deepEqual(bad, [], '会让内核重载会话失败的追加：\n' + bad.join('\n'));
});
