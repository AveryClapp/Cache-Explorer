const DEFAULT_DETAIL_MAX_LENGTH = 4000;
const DEFAULT_MESSAGE_DETAIL_MAX_LENGTH = 240;

function firstNonEmptyLine(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
}

export function truncateDetail(value, maxLength = DEFAULT_DETAIL_MAX_LENGTH) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function parseJsonOutput(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function timeoutMessage(fallback, timeoutMs) {
  return `${fallback}: command timed out after ${Math.round((timeoutMs || 0) / 1000)}s`;
}

export function workloadProcessErrorResponse(err, fallback) {
  const stdout = truncateDetail(err?.stdout);
  const stderr = truncateDetail(err?.stderr);
  const output = stderr || stdout || err?.message || '';
  const parsed = parseJsonOutput(err?.stdout);
  const parsedMessage = parsed?.message || parsed?.error || parsed?.summary;
  const outputLine = truncateDetail(firstNonEmptyLine(output), DEFAULT_MESSAGE_DETAIL_MAX_LENGTH);
  const detail = truncateDetail(parsed?.details || parsed?.raw || output);
  const message = err?.timeout
    ? timeoutMessage(fallback, err.timeoutMs)
    : parsedMessage
      ? `${fallback}: ${parsedMessage}`
      : outputLine
        ? `${fallback}: ${outputLine}`
        : fallback;

  return {
    error: fallback,
    message,
    type: parsed?.type || (err?.timeout ? 'timeout' : 'workload_error'),
    exitCode: err?.exitCode,
    timeout: err?.timeout || undefined,
    details: detail || undefined,
  };
}
