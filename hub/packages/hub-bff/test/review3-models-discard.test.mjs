// 路31 第三轮复核：只聊天名单写不进去时，ext/models 要「放弃这个会话」，但后端接线里没有这个方法。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 发现 12（中）：lib/ext/models.mjs 调 deps.kernel?.discardSession?.()，server.mjs 的 kernel 对象没有它，
// 于是名单写失败时会话留在内核里：一个没进只聊天名单、却选了只聊天模型的会话，工具全开，调用方还只收到 500。
test('R3-12 server.mjs 的 kernel 必须提供 discardSession', () => {
  const source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(source, /discardSession/u, 'kernel 里没有 discardSession');
});
