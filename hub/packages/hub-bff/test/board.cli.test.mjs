import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../bin/hub-board.mjs';

function capture() {
  const result = {
    out: '',
    err: ''
  };
  result.io = {
    stdout: {
      write: _text => {
        result.out += _text;
      }
    },
    stderr: {
      write: _text2 => {
        result.err += _text2;
      }
    }
  };
  return result;
}

test('CLI sends contract requests and safely maps failures', async _testContext => {
  const requests = [];
  let status = 200;
  const fetch = async (url, options) => {
    const parsed = new URL(url);
    requests.push({
      url: parsed.pathname + parsed.search,
      method: options.method,
      auth: options.headers.Authorization,
      body: options.body ? JSON.parse(options.body) : undefined
    });
    return {
      ok: status === 200,
      status,
      json: async () => ({
        ticket: {
          id: 'T-1'
        },
        tickets: []
      })
    };
  };
  const env = {
    HUB_BOARD_URL: 'http://localhost/board',
    HUB_BOARD_TOKEN: 'dsb_test_secret'
  };
  const dir = await mkdtemp(join(tmpdir(), 'board-cli-'));
  const report = join(dir, 'result.md');
  await writeFile(report, 'result text');
  const cases = [[['list', '--status', 'new', '--assignee', 'a', '--creator', 'b', '--json'],
    '/board/tickets?state=new&assignee=a&creator=b', 'GET'], [['show', 'T-1'], '/board/tickets/T-1', 'GET'], [[
    'claim', 'T-1'], '/board/tickets/T-1/claim', 'POST'], [['resume', 'T-1'], '/board/tickets/T-1/resume', 'POST'],
    [['progress', 'T-1', '10:00 did work'], '/board/tickets/T-1/progress', 'POST', {
    text: '10:00 did work'
  }], [['report', 'T-1', '--file', report], '/board/tickets/T-1/report', 'POST', {
    summary: 'result text',
    file: report,
    sha256: createHash('sha256').update('result text').digest('hex')
  }], [['block', 'T-1', 'needs help', '--needs-human'], '/board/tickets/T-1/block', 'POST', {
    reason: 'needs help',
    waitHuman: true
  }], [['done', 'T-1'], '/board/tickets/T-1/done', 'POST']];
  for (const [args, url, method, body] of cases) {
    const captureResult = capture();
    captureResult.io.fetch = fetch;
    assert.equal(await main(args, env, captureResult.io), 0);
    assert.deepEqual(requests.at(-1), {
      url,
      method,
      auth: `Bearer ${env.HUB_BOARD_TOKEN}`,
      body
    });
    assert.ok(!captureResult.out.includes(env.HUB_BOARD_TOKEN) && !captureResult.err.includes(env.HUB_BOARD_TOKEN));
  }
  for (const [http, code] of [[401, 3], [403, 3], [409, 4], [500, 1]]) {
    status = http;
    const captureResult = capture();
    captureResult.io.fetch = fetch;
    assert.equal(await main(['list'], env, captureResult.io), code);
    assert.ok(!captureResult.out.includes(env.HUB_BOARD_TOKEN) && !captureResult.err.includes(env.HUB_BOARD_TOKEN));
  }
  const captureResult = capture();
  assert.equal(await main(['list', '--token', env.HUB_BOARD_TOKEN], env, captureResult.io), 2);
  assert.equal(await main(['list'], {}, captureResult.io), 2);
  assert.ok(!captureResult.out.includes(env.HUB_BOARD_TOKEN) && !captureResult.err.includes(env.HUB_BOARD_TOKEN));
  const config = join(dir, 'config.json');
  await writeFile(config, JSON.stringify({
    url: env.HUB_BOARD_URL,
    token: env.HUB_BOARD_TOKEN
  }), {
    mode: 0o600
  });
  status = 200;
  const configured = capture();
  configured.io.fetch = fetch;
  assert.equal(await main(['list'], {
    HUB_BOARD_CONFIG: config
  }, configured.io), 0);
  await chmod(config, 0o644);
  assert.equal(await main(['list'], {
    HUB_BOARD_CONFIG: config
  }, capture().io), 2);
});
test('CLI rejects token arguments and credential-bearing URLs without leaking secrets', async () => {
  const token = 'dsb_private_secret';
  const env = {
    HUB_BOARD_URL: 'http://localhost/board',
    HUB_BOARD_TOKEN: token
  };
  for (const args of [['list', '--token', token], ['list', `--token=${token}`]]) {
    const captureResult = capture();
    assert.equal(await main(args, env, captureResult.io), 2);
    assert.match(captureResult.err, /Usage:/);
    assert.ok(!`${captureResult.out}${captureResult.err}`.includes(token));
  }
  for (const url of ['http://user:pass@localhost/board', 'http://user@localhost/board']) {
    const captureResult = capture();
    assert.equal(await main(['list'], {
      ...env,
      HUB_BOARD_URL: url
    }, captureResult.io), 2);
    assert.match(captureResult.err, /Usage:/);
    assert.ok(!`${captureResult.out}${captureResult.err}`.includes(token));
  }
});
test('configuration is read and environment values take precedence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'board-cli-config-'));
  const config = join(dir, 'config.json');
  await writeFile(config, JSON.stringify({
    url: 'http://config.example/board',
    token: 'config-token'
  }), {
    mode: 0o600
  });
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({
      url,
      auth: options.headers.Authorization
    });
    return {
      ok: true,
      json: async () => ({
        tickets: []
      })
    };
  };
  let captureResult = capture();
  captureResult.io.fetch = fetch;
  assert.equal(await main(['list'], {
    HUB_BOARD_CONFIG: config
  }, captureResult.io), 0);
  assert.deepEqual(requests.at(-1), {
    url: 'http://config.example/board/tickets',
    auth: 'Bearer config-token'
  });
  captureResult = capture();
  captureResult.io.fetch = fetch;
  assert.equal(await main(['list'], {
    HUB_BOARD_CONFIG: config,
    HUB_BOARD_URL: 'http://env.example/board',
    HUB_BOARD_TOKEN: 'env-token'
  }, captureResult.io), 0);
  assert.deepEqual(requests.at(-1), {
    url: 'http://env.example/board/tickets',
    auth: 'Bearer env-token'
  });
});
test('HTTP errors and unreadable report produce safe errors and correct exit codes', async () => {
  const token = 'dsb_private_secret';
  const env = {
    HUB_BOARD_URL: 'http://localhost/board',
    HUB_BOARD_TOKEN: token
  };
  for (const [status, code] of [[404, 1], [403, 3], [500, 1]]) {
    const captureResult = capture();
    captureResult.io.fetch = async () => ({
      ok: false,
      status,
      json: async () => ({
        error: {
          message: token
        }
      })
    });
    assert.equal(await main(['list'], env, captureResult.io), code);
    assert.match(captureResult.err, new RegExp(`HTTP ${status}`));
    assert.ok(!`${captureResult.out}${captureResult.err}`.includes(token));
  }
  const dir = await mkdtemp(join(tmpdir(), 'board-cli-report-'));
  const captureResult = capture();
  captureResult.io.fetch = async () => {
    assert.fail('must not request when report cannot be read');
  };
  assert.equal(await main(['report', 'T-1', '--file', join(dir, 'missing.md')], env, captureResult.io), 1);
  assert.match(captureResult.err, /Operation failed/);
  assert.ok(!`${captureResult.out}${captureResult.err}`.includes(token));
});
