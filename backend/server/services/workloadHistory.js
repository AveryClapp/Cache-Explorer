import { readFile } from 'fs/promises';

export function workloadHistoryUnavailable(reason, message, extra = {}) {
  return {
    available: false,
    reason,
    message,
    ...extra,
  };
}

export async function fetchJsonWithTimeout(url, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (response.status === 404) {
      return workloadHistoryUnavailable(
        'not_found',
        'No published workload history summary was found',
        { source: 'dashboard', url },
      );
    }
    if (!response.ok) {
      throw new Error(`History summary request failed with HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadWorkloadHistory({
  summaryPath,
  dashboardBaseUrl,
  timeoutMs = 5000,
  readFileImpl = readFile,
  fetchImpl = fetch,
} = {}) {
  if (summaryPath) {
    const data = JSON.parse(await readFileImpl(summaryPath, 'utf8'));
    return {
      available: true,
      source: 'local',
      path: summaryPath,
      ...data,
    };
  }

  if (dashboardBaseUrl) {
    const url = `${dashboardBaseUrl.replace(/\/+$/, '')}/workload-history-summary.json`;
    const data = await fetchJsonWithTimeout(url, timeoutMs, fetchImpl);
    return data.available === false ? data : {
      available: true,
      source: 'dashboard',
      url,
      ...data,
    };
  }

  return workloadHistoryUnavailable(
    'not_configured',
    'Published workload history is not configured for this server',
  );
}
