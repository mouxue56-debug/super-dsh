import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkContract } from './check-shell-contract.mjs';

for (const kind of ['NEW', 'OLD']) {
  test('第 28 轮壳契约 ' + kind, { skip: !process.env['HUB_R28_SHELL_' + kind] }, async () => {
    const html = await readFile(process.env['HUB_R28_SHELL_' + kind], 'utf8');
    assert.deepEqual(checkContract(html).filter(check => !check.ok), []);
    if (kind === 'NEW') {
      const damaged = html.replaceAll('data-assistant-confirm', 'data-assistant-removed');
      assert.ok(checkContract(damaged).some(check => !check.ok && check.name.includes('data-assistant-confirm')));
    } else {
      assert.equal(checkContract(html).length, 168);
    }
  });
}
