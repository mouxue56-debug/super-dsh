import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../bin/hub-board.mjs';
const env = {
  HUB_BOARD_URL: 'http://localhost/board',
  HUB_BOARD_TOKEN: 'secret'
};

function harness() {
  const requests = [];
  const io = {
    stdout: {
      write() {}
    },
    stderr: {
      write() {}
    },
    fetch: async (url, options) => {
      requests.push({
        url: new URL(url).pathname + new URL(url).search,
        method: options.method,
        body: options.body && JSON.parse(options.body)
      });
      return {
        ok: true,
        json: async () => ({})
      };
    }
  };
  return {
    io,
    requests
  };
}

test('v1.1 routes, filters and block aliases use contract payloads', async () => {
  const {
    io,
    requests
  } = harness();
  const cases = [[['list', '--state', 'progress', '--inbox', '派单方', '--attention'],
    '/board/tickets?state=progress&inbox=%E6%B4%BE%E5%8D%95%E6%96%B9&attention=1', 'GET'], [['list', '--status',
    'queued'], '/board/tickets?state=queued', 'GET'], [['accept', 'T/1'], '/board/tickets/T%2F1/accept', 'POST'], [
    ['send-back', 'T', '修改'], '/board/tickets/T/send_back', 'POST', {
    note: '修改'
  }], [['answer', 'T', '回答'], '/board/tickets/T/answer', 'POST', {
    text: '回答'
  }], [['timeout', 'T'], '/board/tickets/T/timeout', 'POST'], [['uncertain', 'T', '未知'],
    '/board/tickets/T/uncertain', 'POST', {
    note: '未知'
  }], [['block', 'T', '障碍'], '/board/tickets/T/block', 'POST', {
    reason: '障碍'
  }], ...['--wait-human', '--needs-human'].map(flag => [
    ['block', 'T', '请回答', flag], '/board/tickets/T/block', 'POST', {
    reason: '请回答',
    waitHuman: true
  }])];
  for (const [args, url, method, body] of cases) {
    assert.equal(await main(args, env, io), 0);
    assert.deepEqual(requests.at(-1), {
      url,
      method,
      body
    });
  }
  for (const args of [['accept', 'T', 'extra'], ['timeout', 'T', 'extra'], ['send-back', 'T'], ['answer', 'T', ''],
    ['uncertain', 'T'], ['block', 'T', 'x', '--bad'], ['list', '--inbox']]) {
    const count = requests.length;
    assert.equal(await main(args, env, io), 2);
    assert.equal(requests.length, count);
  }
});
test('report uses whole-file hash and truncates on UTF-8 character boundaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-cli-v11-'));
  const file = join(dir, '报告.md');
  const {
    io,
    requests
  } = harness();
  for (const content of ['短报告', 'a'.repeat(2000), 'a'.repeat(1999) + '猫🐈后续', '猫'.repeat(800)]) {
    await writeFile(file, content);
    assert.equal(await main(['report', 'T', '--file', file], env, io), 0);
    const body = requests.at(-1).body;
    let prefix = '',
      size = 0;
    for (const char of content) {
      const _byteLength = Buffer.byteLength(char);
      if (size + _byteLength > 2000) {
        break;
      }
      prefix += char;
      size += _byteLength;
    }
    assert.equal(body.summary, prefix + (prefix.length < content.length ? '…（全文见 file）' : ''));
    assert.ok(Buffer.byteLength(body.summary) <= 2048);
    assert.equal(body.file, file);
    assert.equal(body.sha256, createHash('sha256').update(content).digest('hex'));
  }
});
