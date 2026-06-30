import test from 'node:test';
import assert from 'node:assert/strict';

import { runProcess } from './processRunner.js';

test('runProcess captures stdout and stderr from a successful command', async () => {
  const result = await runProcess(process.execPath, [
    '-e',
    'process.stdout.write("ok"); process.stderr.write("warn");',
  ], {
    timeout: 5000,
    maxOutputBuffer: 1024,
  });

  assert.equal(result.stdout, 'ok');
  assert.equal(result.stderr, 'warn');
});

test('runProcess rejects with timeout metadata when a command exceeds its deadline', async () => {
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000);'], {
      timeout: 25,
      maxOutputBuffer: 1024,
      mainFile: '/tmp/cache-explorer-test/main.c',
    }),
    (err) => {
      assert.equal(err.timeout, true);
      assert.equal(err.timeoutMs, 25);
      assert.equal(err.mainFile, '/tmp/cache-explorer-test/main.c');
      return true;
    },
  );
});
