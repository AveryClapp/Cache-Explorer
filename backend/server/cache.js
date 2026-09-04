/**
 * Compilation Cache Layer
 * Caches compilation results to speed up repeat runs
 */

import crypto from 'crypto';
import { getCache, setCache, pruneCache } from './db.js';

// Cache configuration
const CACHE_CONFIG = {
  maxSizeBytes: 1024 * 1024 * 1024, // 1GB
  maxAgeDays: 7,
  pruneIntervalMs: 60 * 60 * 1000, // 1 hour
};

let pruneInterval = null;

/**
 * Generate a cache key from compilation inputs
 */
export function generateCacheKey(inputs) {
  const normalized = {
    schemaVersion: 2,
    files: inputs.files.map(f => ({ name: f.name, code: f.code, language: f.language })),
    config: inputs.config,
    optLevel: inputs.optLevel,
    prefetch: inputs.prefetch || 'none',
    defines: inputs.defines || [],
    sampleRate: inputs.sampleRate || 1,
    eventLimit: inputs.eventLimit || 0,
    fastMode: inputs.fastMode === true,
    segmentCaching: inputs.segmentCaching === true,
    customConfig: inputs.customConfig || null,
    compiler: inputs.compiler || null,
    executor: inputs.executor || 'direct',
  };

  const stableValue = value => {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, stableValue(value[key])])
      );
    }
    return value;
  };

  const json = JSON.stringify(stableValue(normalized));
  return crypto.createHash('sha256').update(json).digest('hex');
}

/**
 * Try to get a cached result
 * Returns null if not found or expired
 */
export function getCachedResult(inputs) {
  const hash = generateCacheKey(inputs);
  const cached = getCache(hash);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      console.warn('Failed to parse cached result:', e);
      return null;
    }
  }

  return null;
}

/**
 * Store a compilation result in cache
 */
export function cacheResult(inputs, result) {
  const hash = generateCacheKey(inputs);
  const json = JSON.stringify(result);

  try {
    setCache(hash, json);
    return true;
  } catch (e) {
    console.warn('Failed to cache result:', e);
    return false;
  }
}

/**
 * Start periodic cache pruning
 */
export function startCachePruning() {
  if (pruneInterval) return;

  pruneInterval = setInterval(() => {
    try {
      const { deleted, freedBytes } = pruneCache(
        CACHE_CONFIG.maxSizeBytes,
        CACHE_CONFIG.maxAgeDays
      );
      if (deleted > 0) {
        console.log(`Cache pruned: ${deleted} entries, ${(freedBytes / 1024 / 1024).toFixed(1)}MB freed`);
      }
    } catch (e) {
      console.warn('Cache pruning failed:', e);
    }
  }, CACHE_CONFIG.pruneIntervalMs);
}

/**
 * Stop cache pruning (for graceful shutdown)
 */
export function stopCachePruning() {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}

export default {
  generateCacheKey,
  getCachedResult,
  cacheResult,
  startCachePruning,
  stopCachePruning,
};
