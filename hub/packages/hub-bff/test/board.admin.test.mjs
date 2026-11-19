import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../bin/hub-board-admin.mjs', import.meta.url));

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        HUB_BOARD_CONFIG_DIR: '',
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '',
      stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({
      code,
      signal,
      stdout,
      stderr
    }));
  });
}

test('admin issue, duplicate, list and revoke keep credentials private', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'board-admin-'));
  const dir = join(parent, 'config');
  const issued = await run(['issue', 'agent', '--scope', 'work', '--config-dir', dir]);
  assert.equal(issued.code, 0, issued.stderr);
  const token = issued.stdout.trim();
  assert.match(token, /^dsb_[A-Za-z0-9_-]{43}$/);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  const file = join(dir, 'board-tokens.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const store = JSON.parse(await readFile(file, 'utf8'));
  const hash = store.tokens[0].hash;
  const duplicate = await run(['issue', 'agent'], {
    HUB_BOARD_CONFIG_DIR: dir
  });
  assert.notEqual(duplicate.code, 0);
  assert.ok(!`${duplicate.stdout}${duplicate.stderr}`.includes(token));
  let listed = await run(['list'], {
    HUB_BOARD_CONFIG_DIR: dir
  });
  assert.equal(listed.code, 0, listed.stderr);
  assert.ok(!listed.stdout.includes(hash) && !listed.stdout.includes(token));
  assert.equal(JSON.parse(listed.stdout)[0].revoked, false);
  const revoked = await run(['revoke', 'agent'], {
    HUB_BOARD_CONFIG_DIR: dir
  });
  assert.equal(revoked.code, 0, revoked.stderr);
  listed = await run(['list'], {
    HUB_BOARD_CONFIG_DIR: dir
  });
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout)[0].revoked, true);
  assert.ok(!listed.stdout.includes(hash) && !listed.stdout.includes(token));
});
test('admin rejects missing configuration directory as a usage error', async () => {
  const result = await run(['list']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /usage/i);
});
