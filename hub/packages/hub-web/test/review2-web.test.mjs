// 路18 第二轮复核：网页服务与页面渲染。基线上会失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

test('L-4 server.mjs 里不能写死 tailnet 地址（取「本机」身份的 whois 目标应来自配置）', () => {
  const hits = server.match(/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/gu) ?? [];
  assert.deepEqual(hits, [], '源码里有 tailnet 地址字面量：' + hits.join());
});

test('L-5 链接文字里带行内代码时，文字不能被占位符吃掉', () => {
  const { markdown } = require('../hub-real.js');
  const html = markdown('看 [`kb-agent`](https://example.com/doc) 说明');
  assert.match(html, /kb-agent/u, '行内代码在链接文字里丢了：' + html);
  assert.ok(!html.includes('\u0000'), '占位符泄漏到了页面');
});

test('L-6 链接的可见文字是网址而真实地址不同，要么降级成纯文字要么显示真实地址（防伪造跳转）', () => {
  const { markdown } = require('../hub-real.js');
  const html = markdown('[https://bank.example/login](https://evil.example/steal)');
  assert.ok(!/<a [^>]*href="https:\/\/evil\.example/u.test(html) || html.includes('evil.example</a>'),
    '组消息里能放「文字是甲站、实际跳乙站」的链接：' + html);
});
