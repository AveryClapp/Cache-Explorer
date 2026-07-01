import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../config.js';
import { ConnectionResourceTracker } from './resourceTracker.js';

test('ConnectionResourceTracker enforces per-window request limits', () => {
  const tracker = new ConnectionResourceTracker('rate-test');

  for (let i = 0; i < CONFIG.rateLimit.maxRequestsPerMinute; i += 1) {
    assert.equal(tracker.checkRateLimit(), true);
  }

  assert.equal(tracker.checkRateLimit(), false);
});

test('ConnectionResourceTracker enforces concurrent process limits', () => {
  const tracker = new ConnectionResourceTracker('concurrency-test');
  const cleanupFns = [];

  for (let i = 0; i < CONFIG.rateLimit.maxConcurrentProcesses; i += 1) {
    assert.equal(tracker.canStartProcess(), true);
    cleanupFns.push(tracker.addProcess({ kill() {} }, `/tmp/cache-explorer-${i}`));
  }

  assert.equal(tracker.canStartProcess(), false);

  cleanupFns[0]();
  assert.equal(tracker.canStartProcess(), true);
});

test('ConnectionResourceTracker cleanup kills processes and removes temp dirs', async () => {
  const tracker = new ConnectionResourceTracker('cleanup-test');
  const killedSignals = [];
  const removedDirs = [];

  tracker.setCleanupFunction(async tempDir => {
    removedDirs.push(tempDir);
  });

  tracker.addProcess({
    kill(signal) {
      killedSignals.push(signal);
    },
  }, '/tmp/cache-explorer-cleanup');

  await tracker.cleanup();

  assert.deepEqual(killedSignals, ['SIGKILL']);
  assert.deepEqual(removedDirs, ['/tmp/cache-explorer-cleanup']);
  assert.equal(tracker.processes.size, 0);
  assert.equal(tracker.tempDirs.size, 0);
});
