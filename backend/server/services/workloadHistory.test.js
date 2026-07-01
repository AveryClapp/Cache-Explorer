import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchJsonWithTimeout, loadWorkloadHistory } from './workloadHistory.js';

test('loadWorkloadHistory returns an unavailable state when no source is configured', async () => {
  const history = await loadWorkloadHistory();

  assert.equal(history.available, false);
  assert.equal(history.reason, 'not_configured');
  assert.match(history.message, /not configured/);
});

test('loadWorkloadHistory reads a configured local summary file', async () => {
  const summary = {
    latest: {
      generatedAt: '2026-06-30T11:00:00.000Z',
      summary: { passed: 3, failed: 0, durationMs: 8000 },
    },
    durationDeltas: [{ id: 'conv2d-intel14', deltaMs: 1200 }],
  };
  const history = await loadWorkloadHistory({
    summaryPath: '/tmp/workload-history-summary.json',
    readFileImpl: async (path, encoding) => {
      assert.equal(path, '/tmp/workload-history-summary.json');
      assert.equal(encoding, 'utf8');
      return JSON.stringify(summary);
    },
  });

  assert.equal(history.available, true);
  assert.equal(history.source, 'local');
  assert.equal(history.path, '/tmp/workload-history-summary.json');
  assert.deepEqual(history.latest, summary.latest);
  assert.deepEqual(history.durationDeltas, summary.durationDeltas);
});

test('loadWorkloadHistory fetches a configured dashboard summary', async () => {
  const history = await loadWorkloadHistory({
    dashboardBaseUrl: 'https://example.test/cache-explorer/',
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      async json() {
        return {
          latest: { summary: { passed: 4, failed: 0, durationMs: 7000 } },
          files: [{ file: 'workload-history-1.json' }],
        };
      },
      url,
    }),
  });

  assert.equal(history.available, true);
  assert.equal(history.source, 'dashboard');
  assert.equal(history.url, 'https://example.test/cache-explorer/workload-history-summary.json');
  assert.equal(history.latest.summary.passed, 4);
});

test('fetchJsonWithTimeout returns unavailable for missing dashboard history', async () => {
  const history = await fetchJsonWithTimeout('https://example.test/workload-history-summary.json', 1000, async () => ({
    ok: false,
    status: 404,
  }));

  assert.equal(history.available, false);
  assert.equal(history.reason, 'not_found');
  assert.equal(history.source, 'dashboard');
});

test('fetchJsonWithTimeout rejects non-404 dashboard errors', async () => {
  await assert.rejects(
    fetchJsonWithTimeout('https://example.test/workload-history-summary.json', 1000, async () => ({
      ok: false,
      status: 503,
    })),
    /HTTP 503/,
  );
});
