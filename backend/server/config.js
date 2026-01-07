/**
 * Server Configuration
 * Centralized configuration with environment variable overrides
 */

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
    port: parseInt(process.env.PORT) || 3001,
    host: process.env.HOST || '0.0.0.0',
  },

  // Paths
  paths: {
    cacheExplore: process.env.CACHE_EXPLORE_PATH || null, // Auto-detected if null
  },
};

export default CONFIG;
