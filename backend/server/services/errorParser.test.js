import test from 'node:test';
import assert from 'node:assert/strict';

import { createErrorResponse, parseCompileErrors } from './errorParser.js';

test('parseCompileErrors returns structured compile diagnostics with hints', () => {
  const stderr = [
    '/tmp/project/main.c:3:10: error: use of undeclared identifier BROKEN_CALL',
    '    3 |   return BROKEN_CALL;',
    '      |          ^',
    '/tmp/project/main.c:4:1: note: expanded from macro KERNEL_ENTRY',
    '',
  ].join('\n');

  const parsed = parseCompileErrors(stderr, '/tmp/project/main.c');

  assert.equal(parsed.type, 'compile_error');
  assert.equal(parsed.summary, '1 error');
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].line, 3);
  assert.equal(parsed.errors[0].column, 10);
  assert.equal(parsed.errors[0].severity, 'error');
  assert.match(parsed.errors[0].message, /BROKEN_CALL/);
  assert.equal(parsed.errors[0].suggestion, 'Check spelling or add the necessary #include');
  assert.equal(parsed.errors[0].sourceLine, 'return BROKEN_CALL;');
  assert.equal(parsed.errors[0].caret, '^');
  assert.deepEqual(parsed.errors[0].notes, ['expanded from macro KERNEL_ENTRY']);
});

test('createErrorResponse reports native Hardware Lab rejections without usage text', () => {
  const response = createErrorResponse({
    stderr: 'Error: Hardware Lab geometry must form valid cache/TLB sets\nUsage: /opt/app/cache-sim [options]\nOptions:\n  --config <name>\n',
    exitCode: 2,
  }, 'main.c');

  assert.equal(response.type, 'validation_error');
  assert.equal(response.message, 'Hardware Lab geometry must form valid cache/TLB sets');
  assert.equal(response.exitCode, 2);
  assert.equal(response.raw, undefined);

  const multithreaded = createErrorResponse({
    stderr: '[2/2] Simulating cache behavior...\nHardware Lab sensitivity does not support multithreaded traces yet; no overrides were silently ignored.\n',
    exitCode: 2,
  }, 'main.c');
  assert.equal(multithreaded.type, 'validation_error');
  assert.match(multithreaded.message, /^Hardware Lab sensitivity does not support multithreaded traces/);
});

test('createErrorResponse preserves timeout partial-progress context', () => {
  const response = createErrorResponse({
    timeout: true,
    timeoutMs: 30000,
    partialProgress: {
      eventsProcessed: 1200,
    },
  }, 'main.c', {
    includePartialResults: true,
    partialResults: {
      eventsProcessed: 1200,
    },
  });

  assert.equal(response.type, 'timeout');
  assert.equal(response.message, 'Execution timed out after 30s - partial results available');
  assert.deepEqual(response.partialResults, { eventsProcessed: 1200 });
});
