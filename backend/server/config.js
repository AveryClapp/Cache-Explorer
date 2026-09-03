/**
 * Server Configuration
 * Centralized configuration with environment variable overrides
 */

function firstEnv(...names) {
  for (const name of names) {
    if (process.env[name] !== undefined && process.env[name] !== '') return process.env[name];
  }
  return undefined;
}

export const CONFIG = {
  // Timeout settings (in milliseconds)
  timeouts: {
    default: parseInt(process.env.TIMEOUT_DEFAULT) || 60000,
    max: parseInt(process.env.TIMEOUT_MAX) || 300000,
    min: parseInt(process.env.TIMEOUT_MIN) || 5000,
    compilation: parseInt(process.env.TIMEOUT_COMPILATION) || 30000,
    heartbeat: parseInt(process.env.HEARTBEAT_INTERVAL) || 5000,
  },

  // Memory limits
  memory: {
    maxOutputBuffer: parseInt(process.env.MAX_OUTPUT_BUFFER) || 50 * 1024 * 1024,
    maxEventBatch: parseInt(process.env.MAX_EVENT_BATCH) || 1000,
  },

  // Rate limiting
  rateLimit: {
    maxRequestsPerMinute: parseInt(process.env.RATE_LIMIT_RPM) || 30,
    maxConcurrentProcesses: parseInt(process.env.MAX_CONCURRENT_PROCESSES) || 5,
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
  },

  // Event streaming
  streaming: {
    batchSize: parseInt(process.env.STREAM_BATCH_SIZE) || 100,
    batchIntervalMs: parseInt(process.env.STREAM_BATCH_INTERVAL) || 100,
    progressIntervalMs: parseInt(process.env.PROGRESS_INTERVAL) || 1000,
  },

  // Cleanup
  cleanup: {
    tempDirMaxAgeMs: parseInt(process.env.TEMP_DIR_MAX_AGE) || 300000,
    orphanCheckIntervalMs: parseInt(process.env.ORPHAN_CHECK_INTERVAL) || 60000,
  },

  // Server
  server: {
    port: parseInt(firstEnv('HARDWARE_EXPLORER_PORT', 'CACHE_EXPLORER_PORT', 'PORT')) || 3001,
    host: firstEnv('HARDWARE_EXPLORER_HOST', 'CACHE_EXPLORER_HOST', 'HOST') || '0.0.0.0',
    trustProxy: ['1', 'true'].includes(firstEnv('HARDWARE_EXPLORER_TRUST_PROXY', 'CACHE_EXPLORER_TRUST_PROXY', 'TRUST_PROXY') || ''),
  },

  // Paths
  paths: {
    cacheExplore: firstEnv('HARDWARE_EXPLORER_CLI_PATH', 'CACHE_EXPLORE_PATH') || null, // Auto-detected if null
  },

  // Published workload benchmark history
  workloads: {
    dashboardBaseUrl: (firstEnv('HARDWARE_EXPLORER_DASHBOARD_BASE_URL', 'CACHE_EXPLORER_DASHBOARD_BASE_URL') || '').replace(/\/+$/, ''),
    historySummaryPath: firstEnv('HARDWARE_EXPLORER_WORKLOAD_HISTORY_SUMMARY_PATH', 'CACHE_EXPLORER_WORKLOAD_HISTORY_SUMMARY_PATH') || null,
    historyFetchTimeoutMs: parseInt(firstEnv('HARDWARE_EXPLORER_WORKLOAD_HISTORY_TIMEOUT', 'CACHE_EXPLORER_WORKLOAD_HISTORY_TIMEOUT')) || 5000,
    variantTimeoutMs: parseInt(firstEnv('HARDWARE_EXPLORER_WORKLOAD_VARIANT_TIMEOUT_MS', 'CACHE_EXPLORER_WORKLOAD_VARIANT_TIMEOUT_MS')) || 120000,
  },
};

export default CONFIG;
