/**
 * Connection Resource Tracker
 * Manages processes and temp directories per WebSocket connection
 */

import { CONFIG } from '../config.js';

// Track active resources per connection
export const connectionResources = new Map();

export class ConnectionResourceTracker {
  constructor(connectionId) {
    this.connectionId = connectionId;
    this.processes = new Set();
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

export default {
  ConnectionResourceTracker,
  connectionResources,
  getOrCreateTracker,
  removeTracker,
};
