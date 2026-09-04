import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { CONFIG } from '../config.js';
import {
  activeExecutionCount,
  ConnectionResourceTracker,
  createHttpExecutionLimitMiddleware,
  createHttpRateLimitMiddleware,
  httpRateTrackers,
  reserveGlobalExecution,
} from './resourceTracker.js';

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

test('global execution reservations are atomic and idempotent', () => {
  const releases = [];
  for (let i = 0; i < 3; i += 1) releases.push(reserveGlobalExecution(3));
  assert.equal(activeExecutionCount(), 3);
  assert.equal(reserveGlobalExecution(3), null);

  releases[0]();
  releases[0]();
  assert.equal(activeExecutionCount(), 2);
  const replacement = reserveGlobalExecution(3);
  assert.equal(typeof replacement, 'function');

  for (const release of releases.slice(1)) release();
  replacement();
  assert.equal(activeExecutionCount(), 0);
});

function executionResponse() {
  const res = new EventEmitter();
  res.writableFinished = false;
  res.set = () => res;
  res.status = () => res;
  res.json = () => res;
  return res;
}

test('HTTP execution lease survives disconnect until active work finishes', () => {
  const middleware = createHttpExecutionLimitMiddleware();
  const req = {};
  const res = executionResponse();

  middleware(req, res, () => {});
  req.markExecutionStarted();
  assert.equal(activeExecutionCount(), 1);

  res.emit('close');
  assert.equal(req.executionSignal.aborted, true);
  assert.equal(activeExecutionCount(), 1);

  req.finishExecution();
  assert.equal(activeExecutionCount(), 0);
});

test('HTTP execution lease releases an unstarted disconnected request', () => {
  const middleware = createHttpExecutionLimitMiddleware();
  const req = {};
  const res = executionResponse();

  middleware(req, res, () => {});
  res.emit('close');

  assert.equal(req.executionSignal.aborted, true);
  assert.equal(activeExecutionCount(), 0);
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

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('HTTP rate limit middleware rejects requests after the configured window quota', () => {
  httpRateTrackers.clear();
  const middleware = createHttpRateLimitMiddleware({
    shouldLimit: req => req.path === '/compile',
  });
  const req = {
    method: 'POST',
    path: '/compile',
    ip: '127.0.0.1',
    headers: {},
    socket: {},
  };
  let nextCalls = 0;

  for (let i = 0; i < CONFIG.rateLimit.maxRequestsPerMinute; i += 1) {
    middleware(req, mockResponse(), () => { nextCalls += 1; });
  }

  const limited = mockResponse();
  middleware(req, limited, () => { nextCalls += 1; });

  assert.equal(nextCalls, CONFIG.rateLimit.maxRequestsPerMinute);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], String(Math.ceil(CONFIG.rateLimit.windowMs / 1000)));
  assert.equal(limited.body.type, 'rate_limit');
});

test('HTTP rate limit middleware skips routes outside the limiter predicate', () => {
  httpRateTrackers.clear();
  const middleware = createHttpRateLimitMiddleware({
    shouldLimit: req => req.path === '/compile',
  });
  const req = {
    method: 'GET',
    path: '/health',
    ip: '127.0.0.1',
    headers: {},
    socket: {},
  };
  let nextCalls = 0;

  middleware(req, mockResponse(), () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.equal(httpRateTrackers.size, 0);
});
