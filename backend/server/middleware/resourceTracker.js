/**
 * Connection Resource Tracker
 * Manages processes and temp directories per WebSocket connection
 */

import { CONFIG } from '../config.js';

// Track active resources per connection
export const connectionResources = new Map();
export const httpRateTrackers = new Map();
let nextHttpRatePruneAt = 0;
let activeExecutions = 0;

export function reserveGlobalExecution(limit = CONFIG.rateLimit.maxConcurrentProcesses) {
  if (activeExecutions >= limit) return null;
  activeExecutions += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeExecutions = Math.max(0, activeExecutions - 1);
  };
}

export function activeExecutionCount() {
  return activeExecutions;
}

export class ConnectionResourceTracker {
  constructor(connectionId) {
    this.connectionId = connectionId;
    this.processes = new Set();
    this.abortControllers = new Set();
    this.tempDirs = new Set();
    this.requestTimes = [];
    this.heartbeatInterval = null;
    this.cleanupTempDir = null; // Set by caller
  }

  // Rate limiting
  checkRateLimit() {
    const now = Date.now();
    this.requestTimes = this.requestTimes.filter(
      t => now - t < CONFIG.rateLimit.windowMs
    );

    if (this.requestTimes.length >= CONFIG.rateLimit.maxRequestsPerMinute) {
      return false;
    }

    this.requestTimes.push(now);
    return true;
  }

  canStartProcess() {
    return this.processes.size < CONFIG.rateLimit.maxConcurrentProcesses;
  }

  addProcess(proc, tempDir) {
    this.processes.add(proc);
    if (tempDir) {
      this.tempDirs.add(tempDir);
    }
    return () => this.removeProcess(proc, tempDir);
  }

  removeProcess(proc, tempDir) {
    this.processes.delete(proc);
  }

  addAbortController(controller) {
    this.abortControllers.add(controller);
    return () => this.abortControllers.delete(controller);
  }

  setCleanupFunction(fn) {
    this.cleanupTempDir = fn;
  }

  async cleanup() {
    // Kill all active processes
    for (const proc of this.processes) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore kill errors
      }
    }
    this.processes.clear();
    for (const controller of this.abortControllers) controller.abort();
    this.abortControllers.clear();

    // Clear heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Cleanup temp directories
    if (this.cleanupTempDir) {
      for (const tempDir of this.tempDirs) {
        await this.cleanupTempDir(tempDir);
      }
    }
    this.tempDirs.clear();
  }
}

export function getOrCreateTracker(connectionId) {
  if (!connectionResources.has(connectionId)) {
    connectionResources.set(connectionId, new ConnectionResourceTracker(connectionId));
  }
  return connectionResources.get(connectionId);
}

export function removeTracker(connectionId) {
  const tracker = connectionResources.get(connectionId);
  if (tracker) {
    tracker.cleanup();
    connectionResources.delete(connectionId);
  }
}

function clientKey(req) {
  if (req.ip) return req.ip;

  const forwardedFor = req.headers?.['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function pruneHttpRateTrackers(now = Date.now()) {
  for (const [key, tracker] of httpRateTrackers) {
    tracker.requestTimes = tracker.requestTimes.filter(
      t => now - t < CONFIG.rateLimit.windowMs
    );
    if (tracker.requestTimes.length === 0) {
      httpRateTrackers.delete(key);
    }
  }
}

export function createHttpRateLimitMiddleware({ shouldLimit = () => true } = {}) {
  return function httpRateLimit(req, res, next) {
    if (!shouldLimit(req)) {
      next();
      return;
    }

    const now = Date.now();
    if (now >= nextHttpRatePruneAt) {
      pruneHttpRateTrackers(now);
      nextHttpRatePruneAt = now + CONFIG.rateLimit.windowMs;
    }

    const key = `http:${clientKey(req)}`;
    if (!httpRateTrackers.has(key)) {
      httpRateTrackers.set(key, new ConnectionResourceTracker(key));
    }
    const tracker = httpRateTrackers.get(key);

    if (tracker.checkRateLimit()) {
      next();
      return;
    }

    const retryAfter = Math.ceil(CONFIG.rateLimit.windowMs / 1000);
    if (typeof res.set === 'function') {
      res.set('Retry-After', String(retryAfter));
    } else if (typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', String(retryAfter));
    }

    res.status(429).json({
      type: 'rate_limit',
      message: 'Rate limit exceeded',
      suggestion: `Maximum ${CONFIG.rateLimit.maxRequestsPerMinute} requests per minute`,
      retryAfter,
    });
  };
}

export function createHttpExecutionLimitMiddleware({ shouldLimit = () => true } = {}) {
  return function httpExecutionLimit(req, res, next) {
    if (!shouldLimit(req)) {
      next();
      return;
    }

    const release = reserveGlobalExecution();
    if (!release) {
      res.set?.('Retry-After', '1');
      res.status(503).json({
        type: 'capacity_limit',
        message: 'Analysis capacity is full; retry shortly',
      });
      return;
    }

    const controller = new AbortController();
    let executionStarted = false;

    req.executionSignal = controller.signal;
    req.markExecutionStarted = () => {
      executionStarted = true;
    };
    req.finishExecution = () => {
      executionStarted = false;
      release();
    };

    res.once('finish', () => {
      if (!executionStarted) release();
    });
    res.once('close', () => {
      if (!res.writableFinished) {
        controller.abort();
        if (!executionStarted) release();
      }
    });
    next();
  };
}

export default {
  ConnectionResourceTracker,
  connectionResources,
  httpRateTrackers,
  getOrCreateTracker,
  reserveGlobalExecution,
  createHttpRateLimitMiddleware,
  createHttpExecutionLimitMiddleware,
  removeTracker,
};
