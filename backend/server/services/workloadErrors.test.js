import test from 'node:test';
import assert from 'node:assert/strict';

import { truncateDetail, workloadProcessErrorResponse } from './workloadErrors.js';

test('workloadProcessErrorResponse preserves structured workload JSON diagnostics', () => {
  const response = workloadProcessErrorResponse({
    stdout: JSON.stringify({
      error: 'snapshot mismatch',
      type: 'workload_verification_failed',
      details: 'variant padded expected fewer misses',
    }),
    exitCode: 4,
  }, 'Failed to verify workloads');

  assert.equal(response.error, 'Failed to verify workloads');
  assert.equal(response.message, 'Failed to verify workloads: snapshot mismatch');
  assert.equal(response.type, 'workload_verification_failed');
  assert.equal(response.exitCode, 4);
  assert.equal(response.details, 'variant padded expected fewer misses');
});

test('workloadProcessErrorResponse uses stderr first line when JSON is unavailable', () => {
  const response = workloadProcessErrorResponse({
    stderr: '\nmanifest missing for workload id\nsecond line with details',
    exitCode: 1,
  }, 'Failed to list workloads');

  assert.equal(response.message, 'Failed to list workloads: manifest missing for workload id');
  assert.equal(response.type, 'workload_error');
  assert.equal(response.exitCode, 1);
  assert.equal(response.details, 'manifest missing for workload id\nsecond line with details');
});

test('workloadProcessErrorResponse reports process timeouts distinctly', () => {
  const response = workloadProcessErrorResponse({
    timeout: true,
    timeoutMs: 2500,
  }, 'Failed to verify workloads');

  assert.equal(response.message, 'Failed to verify workloads: command timed out after 3s');
  assert.equal(response.type, 'timeout');
  assert.equal(response.timeout, true);
});

test('workloadProcessErrorResponse keeps unstructured details bounded', () => {
  const response = workloadProcessErrorResponse({
    stdout: 'x'.repeat(5000),
  }, 'Failed to list workloads');

  assert.equal(response.message.length, 'Failed to list workloads: '.length + 243);
  assert.equal(response.details.length, 4003);
  assert.equal(response.details, truncateDetail('x'.repeat(5000)));
  assert.ok(response.message.endsWith('...'));
  assert.ok(response.details.endsWith('...'));
});
