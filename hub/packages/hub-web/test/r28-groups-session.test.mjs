import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeGroups } = require('../hub-real.js');

test('讨论组预览保留正文和时间，过滤原始 cancelled 状态', () => {
  const rows = normalizeGroups([
    { id: 'a', status: 'cancelled' },
    { id: 'b', status: 'active', lastText: '末条', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lastText, '末条');
  assert.equal(rows[0].updatedAt, '2026-01-01T00:00:00.000Z');
});
