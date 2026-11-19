import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ledgerRowToEvent, ledgerRowsToEvents, readLedgerEvents} from '../lib/ledger-map.mjs';

const common = {v: 1, ts: '2026-11-17T10:00:00.000Z', tsMs: 1, bot: 'a1', sessionId: null, ticket: 'T-1'};

test('审批行有结论转成已解决的记事', () => {
  const row = {...common, kind: 'approval', key: 'k1', action: '写文件', target: 'x', outcome: 'approved'};
  const event = ledgerRowToEvent(row);
  assert.equal(event.kind, 'note');
  assert.equal(event.resolved, true);
  assert.equal(event.text, '审批 写文件 → approved');
  assert.equal(event.assistant, 'a1');
});

test('审批行没有结论转成待批事件', () => {
  const row = {...common, kind: 'approval', key: 'k2', action: '发布', target: 'p', outcome: null};
  const event = ledgerRowToEvent(row);
  assert.equal(event.kind, 'approval_pending');
  assert.equal(event.resolved, false);
  assert.equal(event.text, '发布 p');
});

test('动作、变更、派活各有一行文字', () => {
  assert.equal(ledgerRowToEvent({...common, kind: 'action', tool: 'write', target: 'f'}).text, '动作 write f');
  const change = {...common, kind: 'change', what: 'roster', subject: 's'};
  assert.equal(ledgerRowToEvent(change).text, '变更 roster s');
  assert.equal(ledgerRowToEvent({...common, kind: 'dispatch', worker: 'w', exitCode: 0}).text, '派活 w 退出码 0');
  assert.equal(ledgerRowToEvent({...common, kind: 'dispatch', worker: 'w', exitCode: null}).text, '派活 w 退出码未知');
});

test('call 行、无助理、版本不对、非对象都返回 null', () => {
  assert.equal(ledgerRowToEvent({...common, kind: 'call'}), null);
  assert.equal(ledgerRowToEvent({...common, kind: 'action', bot: null}), null);
  assert.equal(ledgerRowToEvent({...common, kind: 'action', v: 2}), null);
  assert.equal(ledgerRowToEvent(null), null);
  assert.equal(ledgerRowToEvent('x'), null);
});

test('多行转换按 key 去重并跳过不相关行', () => {
  const rows = [
    {...common, kind: 'action', key: 'same', tool: 't', target: 'a'},
    {...common, kind: 'action', key: 'same', tool: 't', target: 'a'},
    {...common, kind: 'call', key: 'c'},
  ];
  assert.equal(ledgerRowsToEvents(rows).length, 1);
  assert.deepEqual(ledgerRowsToEvents(undefined), []);
});

test('读账本目录：缺文件、坏行、符号链接、非法日期', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-map-'));
  try {
    fs.mkdirSync(path.join(root, 'events'));
    const line = JSON.stringify({...common, kind: 'action', key: 'k', tool: 't', target: 'a'});
    fs.writeFileSync(path.join(root, 'events', '2026-11-17.jsonl'), `${line}\nnot json\n`);
    fs.symlinkSync(path.join(root, 'events', '2026-11-17.jsonl'), path.join(root, 'events', '2026-11-18.jsonl'));
    const events = readLedgerEvents(root, ['2026-11-16', '2026-11-17', '2026-11-18']);
    assert.equal(events.length, 1);
    assert.equal(events[0].text, '动作 t a');
    assert.throws(() => readLedgerEvents(root, ['../x']), /日期/);
    assert.deepEqual(readLedgerEvents(path.join(root, 'nope'), ['2026-11-17']), []);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('源码卫生：不含网络与个人路径', () => {
  const source = fs.readFileSync(new URL('../lib/ledger-map.mjs', import.meta.url), 'utf8');
  for (const bad of ['child_process', 'process.env', '/Users/', 'fetch(', 'https://']) {
    assert.equal(source.includes(bad), false, bad);
  }
});
