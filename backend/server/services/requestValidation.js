import { CONFIG } from '../config.js';

export function normalizeRequestTimeout(value, timeouts = CONFIG.timeouts) {
  const timeout = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timeout)) return timeouts.default;
  return Math.min(Math.max(Math.trunc(timeout), timeouts.min), timeouts.max);
}

export function validateWorkPlan({ configs, variants = 1 }, limits = CONFIG.workPlan) {
  if (configs > limits.maxConfigs) {
    return `A request may use at most ${limits.maxConfigs} hardware profiles`;
  }
  if (variants > limits.maxVariants) {
    return `An experiment may use at most ${limits.maxVariants} variants`;
  }
  if (configs * variants > limits.maxRuns) {
    return `An experiment may schedule at most ${limits.maxRuns} profile-variant runs`;
  }
  return null;
}

export function validateSharePayload(value, maxBytes = CONFIG.persistence.maxShareBytes) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return 'Shared state must be JSON serializable';
  }
  if (encoded === undefined) return 'Shared state must be JSON serializable';
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    return `Shared state may be at most ${maxBytes} bytes`;
  }
  return null;
}
