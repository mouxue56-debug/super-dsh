// 路18 第二轮复核：插件侧看板写的事件，后端有没有人读。基线上会失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './fixtures.mjs';
import { createBoard } from '../lib/board.mjs';

test('H-4 插件进程里的看板（同一目录、事件只写 plugin-events.jsonl）发出的「等 主人 回答」必须到达 BFF 通知', async () => {
  const f = await fixture();
  try {
    const root = path.join(f.handlerOptions.hubHome, 'board');
    const file = path.join(root, 'plugin-events.jsonl');
    // 与 hub-plugin/tools/index.mjs createPluginBoard 同样的做法：另建一个看板实例，事件追加到文件。
    const pluginBoard = createBoard({ root, maxHop: 4, onEvent: (event) => {
      fs.mkdirSync(root, { recursive: true });
      fs.appendFileSync(file, JSON.stringify(event) + '\n');
    } });
    const notices = [];
    const off = f.handler.runtime.subscribe((type, data) => {
      if (type === 'notice') {
        notices.push(data);
      }
    });
    const chief = { name: 'chief', type: 'assistant' };
    const pm = { name: 'pm', type: 'assistant' };
    const made = await pluginBoard.create(chief, { title: '问一句', goal: '需要主人定', to: ['pm'] });
    await pluginBoard.claim(pm, made.id);
    await pluginBoard.block(pm, made.id, '要主人选哪家', { waitHuman: true });
    await delay(300);
    off();
    assert.ok(fs.existsSync(file), '插件侧事件文件应已写出');
    assert.ok(notices.some((n) => n.source === 'board' && n.attention === true),
      'plugin-events.jsonl 没有任何读取方，助理问主人的话永远到不了手机');
  } finally {
    await f.handler.dispose();
    f.client.dispose();
  }
});
