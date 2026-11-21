// 插件这一侧的看板要认得首席，arrange 工具才不会一直报「只有首席能做」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPluginBoard } from '../tools/index.mjs';

test('插件看板：传了 isChief 首席能过身份关，别人仍被拒；不传时谁都不是首席', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r46-pb-'));
  const withChief = createPluginBoard({ dir, maxHop: 4 }, undefined, name => name === 'chief');
  await assert.rejects(withChief.arrangeSet({ name: 'chief', type: 'assistant' }, 'T-none', {}),
    error => error.code !== 'FORBIDDEN');
  await assert.rejects(withChief.arrangeSet({ name: 'pm', type: 'assistant' }, 'T-none', {}), { code: 'FORBIDDEN' });
  const without = createPluginBoard({ dir, maxHop: 4 });
  await assert.rejects(without.arrangeSet({ name: 'chief', type: 'assistant' }, 'T-none', {}), { code: 'FORBIDDEN' });
});
