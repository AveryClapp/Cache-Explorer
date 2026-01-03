/**
 * Metrics and Health Monitoring
 * Provides Prometheus-compatible metrics and health checks
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { isHealthy as isDbHealthy, getDbStats } from './db.js';

const VERSION = '1.0.0';
const startTime = Date.now();

// In-memory metrics storage
const counters = new Map();
const gauges = new Map();
const histograms = new Map();

/**
 * Increment a counter
 */
export function incCounter(name, labels = {}, value = 1) {
  const key = formatKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

/**
 * Set a gauge value
 */
export function setGauge(name, value, labels = {}) {
  const key = formatKey(name, labels);
  gauges.set(key, value);
}

/**
 * Record a duration for histogram
 */
export function recordDuration(name, seconds, labels = {}) {
  const key = formatKey(name, labels);
  if (!histograms.has(key)) {
    histograms.set(key, { count: 0, sum: 0, min: Infinity, max: -Infinity });
  }
  const h = histograms.get(key);
  h.count++;
  h.sum += seconds;
  h.min = Math.min(h.min, seconds);
  h.max = Math.max(h.max, seconds);
}

/**
 * Format metric key with labels
 */
function formatKey(name, labels) {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return labelStr ? `${name}{${labelStr}}` : name;
}

/**
 * Get metrics in Prometheus text format
 */
export function getPrometheusMetrics() {
  const lines = [];
  const prefix = 'cache_explorer';

  // Add uptime
  lines.push(`# HELP ${prefix}_uptime_seconds Time since server start`);
  lines.push(`# TYPE ${prefix}_uptime_seconds gauge`);
  lines.push(`${prefix}_uptime_seconds ${(Date.now() - startTime) / 1000}`);

  // Counters
  lines.push(`# HELP ${prefix}_requests_total Total requests`);
  lines.push(`# TYPE ${prefix}_requests_total counter`);
  for (const [key, value] of counters) {
    if (key.startsWith('requests')) {
      lines.push(`${prefix}_${key} ${value}`);
    }
  }

  lines.push(`# HELP ${prefix}_cache_hits_total Cache hits`);
  lines.push(`# TYPE ${prefix}_cache_hits_total counter`);
  lines.push(`${prefix}_cache_hits_total ${counters.get('cache_hits') || 0}`);

  lines.push(`# HELP ${prefix}_cache_misses_total Cache misses`);
  lines.push(`# TYPE ${prefix}_cache_misses_total counter`);
  lines.push(`${prefix}_cache_misses_total ${counters.get('cache_misses') || 0}`);

  lines.push(`# HELP ${prefix}_errors_total Errors by type`);
  lines.push(`# TYPE ${prefix}_errors_total counter`);
  for (const [key, value] of counters) {
    if (key.startsWith('errors')) {
      lines.push(`${prefix}_${key} ${value}`);
    }
  }

  // Gauges
  lines.push(`# HELP ${prefix}_active_connections Current WebSocket connections`);
  lines.push(`# TYPE ${prefix}_active_connections gauge`);
  lines.push(`${prefix}_active_connections ${gauges.get('active_connections') || 0}`);

  // Histograms (simplified - just show count, sum, avg)
  lines.push(`# HELP ${prefix}_compilation_duration_seconds Compilation time`);
  lines.push(`# TYPE ${prefix}_compilation_duration_seconds summary`);
  const compHist = histograms.get('compilation_duration') || { count: 0, sum: 0 };
  lines.push(`${prefix}_compilation_duration_seconds_count ${compHist.count}`);
  lines.push(`${prefix}_compilation_duration_seconds_sum ${compHist.sum.toFixed(3)}`);
  if (compHist.count > 0) {
    lines.push(`${prefix}_compilation_duration_seconds{quantile="0.5"} ${(compHist.sum / compHist.count).toFixed(3)}`);
  }

  // Database stats
  try {
    const dbStats = getDbStats();
    lines.push(`# HELP ${prefix}_cache_entries Cached compilation entries`);
    lines.push(`# TYPE ${prefix}_cache_entries gauge`);
    lines.push(`${prefix}_cache_entries ${dbStats.cache.entries}`);

    lines.push(`# HELP ${prefix}_cache_size_bytes Cache size in bytes`);
    lines.push(`# TYPE ${prefix}_cache_size_bytes gauge`);
    lines.push(`${prefix}_cache_size_bytes ${dbStats.cache.sizeBytes}`);

    lines.push(`# HELP ${prefix}_short_urls_total Short URLs created`);
    lines.push(`# TYPE ${prefix}_short_urls_total gauge`);
    lines.push(`${prefix}_short_urls_total ${dbStats.urls.count}`);
  } catch (e) {
    // Database not available
  }

  return lines.join('\n') + '\n';
}

/**
 * Check if clang is available
 */
function checkClang() {
  try {
    execSync('which clang', { stdio: 'pipe' });
    return true;
  } catch {
    // Try common paths
    const paths = [
      '/usr/bin/clang',
      '/usr/local/bin/clang',
      '/opt/homebrew/opt/llvm/bin/clang',
    ];
    return paths.some(p => existsSync(p));
  }
}

/**
 * Check if temp directory is writable
 */
function checkTempDir() {
  try {
    const testFile = `/tmp/cache-explorer-health-${Date.now()}`;
    require('fs').writeFileSync(testFile, 'test');
    require('fs').unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get health status
 */
export function getHealthStatus() {
  const checks = {
    database: isDbHealthy() ? 'ok' : 'error',
    compiler: checkClang() ? 'ok' : 'error',
    temp_dir: checkTempDir() ? 'ok' : 'error',
  };

  const allOk = Object.values(checks).every(v => v === 'ok');
  const anyError = Object.values(checks).some(v => v === 'error');

  return {
    status: allOk ? 'ok' : anyError ? 'degraded' : 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: VERSION,
    checks,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Reset all metrics (for testing)
 */
export function resetMetrics() {
  counters.clear();
  gauges.clear();
  histograms.clear();
}

export default {
  incCounter,
  setGauge,
  recordDuration,
  getPrometheusMetrics,
  getHealthStatus,
  resetMetrics,
};
