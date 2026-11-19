import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueToken, revokeToken, verifyToken, scopeAllows } from '../lib/board-tokens.mjs';
test('issue stores only a hash, applies permissions and rejects duplicate names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-tokens-'));
  const {
    token,
    entry
  } = await issueToken(dir, {
    name: 'agent',
    scope: 'work'
  }, 0);
  assert.match(token, /^dsb_[A-Za-z0-9_-]{43}$/);
  assert.equal(entry.createdAt, '1970-01-01T00:00:00.000Z');
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  const path = join(dir, 'board-tokens.json');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.ok(!(await readFile(path, 'utf8')).includes(token));
  assert.match(entry.hash, /^[a-f0-9]{64}$/);
  await assert.rejects(issueToken(dir, {
    name: 'agent'
  }));
  assert.deepEqual(await verifyToken(dir, token), {
    name: 'agent',
    scope: 'work'
  });
  assert.equal(await verifyToken(dir, 'wrong'), null);
  await chmod(path, 0o644);
  assert.equal(await verifyToken(dir, token), null);
  await chmod(path, 0o600);
  await revokeToken(dir, 'agent');
  assert.equal(await verifyToken(dir, token), null);
});
test('verification reloads the file each time', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-tokens-'));
  const {
    token
  } = await issueToken(dir, {
    name: 'agent'
  });
  const path = join(dir, 'board-tokens.json');
  assert.deepEqual(await verifyToken(dir, token), {
    name: 'agent',
    scope: 'read'
  });
  const store = JSON.parse(await readFile(path, 'utf8'));
  store.tokens[0].scope = 'work+create';
  await writeFile(path, JSON.stringify(store));
  assert.deepEqual(await verifyToken(dir, token), {
    name: 'agent',
    scope: 'work+create'
  });
});
test('scopeAllows covers all scopes and actions', () => {
  for (const [scope, expected] of Object.entries({
    read: [true, false, false],
    work: [true, true, false],
    'work+create': [true, true, true]
  })) {
    ['read', 'work', 'create'].forEach((action, _index) => assert.equal(scopeAllows(scope, action), expected[_index]));
  }
  assert.equal(scopeAllows('invalid', 'read'), false);
  assert.equal(scopeAllows('work+create', 'invalid'), false);
});
test('invalid names and scopes and revoking an unknown name are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-tokens-invalid-'));
  for (const name of ['', 'bad name', '../bad', 'a'.repeat(65), null]) {
    await assert.rejects(issueToken(dir, {
      name
    }), /Invalid name/);
  }
  for (const scope of ['', 'admin', 'WORK', null]) {
    await assert.rejects(issueToken(dir, {
      name: 'agent',
      scope
    }), /Invalid scope/);
  }
  await issueToken(dir, {
    name: 'agent'
  });
  await assert.rejects(revokeToken(dir, 'missing'), /Name not found/);
});
test('stored hash is exactly SHA-256 and revoked matching token cannot authenticate', async () => {
  const {
    createHash
  } = await import('node:crypto');
  const dir = await mkdtemp(join(tmpdir(), 'board-tokens-hash-'));
  const {
    token
  } = await issueToken(dir, {
    name: 'agent'
  });
  const path = join(dir, 'board-tokens.json');
  let store = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(store.tokens[0].hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(store.tokens[0].hash, token);
  await revokeToken(dir, 'agent');
  store = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(store.tokens[0].hash, createHash('sha256').update(token).digest('hex'));
  assert.equal(store.tokens[0].revoked, true);
  assert.equal(await verifyToken(dir, token), null);
});
test('verification fails closed for corrupt JSON and a missing directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-tokens-corrupt-'));
  await writeFile(join(dir, 'board-tokens.json'), '{broken', {
    mode: 0o600
  });
  assert.equal(await verifyToken(dir, 'dsb_test'), null);
  assert.equal(await verifyToken(join(dir, 'missing'), 'dsb_test'), null);
});
