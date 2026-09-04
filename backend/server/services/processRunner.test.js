import test from 'node:test';
import assert from 'node:assert/strict';

import { runManagedProcess, runProcess } from './processRunner.js';

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

test('runProcess terminates and reports cancellation from an AbortSignal', async () => {
  const controller = new AbortController();
  const resultPromise = runProcess(process.execPath, [
    '-e',
    'process.on("SIGTERM", () => process.exit(0)); setTimeout(() => {}, 10000);',
  ], {
    timeout: 5000,
    maxOutputBuffer: 1024,
    gracefulKillDelayMs: 10,
    signal: controller.signal,
  });

  setTimeout(() => controller.abort(), 25);

  await assert.rejects(resultPromise, (err) => {
    assert.equal(err.cancelled, true);
    assert.equal(err.timeout, false);
    return true;
  });
});

test('runProcess cancellation terminates descendant processes', async () => {
  const controller = new AbortController();
  let descendantPid = null;
  let reportStarted;
  const started = new Promise(resolve => { reportStarted = resolve; });
  const resultPromise = runProcess(process.execPath, [
    '-e',
    `const { spawn } = require('node:child_process');
     const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], { stdio: 'ignore' });
     process.stdout.write(String(child.pid));
     setInterval(() => {}, 10000);`,
  ], {
    timeout: 5000,
    maxOutputBuffer: 1024,
    gracefulKillDelayMs: 10,
    signal: controller.signal,
    onStdout(chunk) {
      descendantPid = Number(chunk.trim());
      reportStarted();
    },
  });

  await started;
  controller.abort();
  await assert.rejects(resultPromise, err => err.cancelled === true);

  let descendantAlive = true;
  for (let attempt = 0; attempt < 20 && descendantAlive; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10));
    try {
      process.kill(descendantPid, 0);
    } catch {
      descendantAlive = false;
    }
  }
  assert.equal(descendantAlive, false);
});

test('runManagedProcess can transform streamed stderr before buffering', async () => {
  const seen = [];
  const result = await runManagedProcess(process.execPath, [
    '-e',
    'process.stderr.write("progress\\nreal warning\\n");',
  ], {
    timeout: 5000,
    maxOutputBuffer: 1024,
    transformStderr(chunk) {
      seen.push(chunk);
      return chunk
        .split('\n')
        .filter(line => line && !line.startsWith('progress'))
        .map(line => `${line}\n`)
        .join('');
    },
  });

  assert.deepEqual(seen, ['progress\nreal warning\n']);
  assert.equal(result.stderr, 'real warning\n');
});

test('runManagedProcess can return nonzero exits for caller-specific parsing', async () => {
  const result = await runManagedProcess(process.execPath, [
    '-e',
    'process.stdout.write("{\\"error\\":\\"compile\\"}"); process.exit(7);',
  ], {
    timeout: 5000,
    maxOutputBuffer: 1024,
    rejectOnNonZero: false,
  });

  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, '{"error":"compile"}');
});
