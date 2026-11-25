import assert from 'node:assert/strict';
import test from 'node:test';

import { generateCacheKey } from '../cache.js';

function inputs(overrides = {}) {
  return {
    files: [{ name: 'main.c', code: 'int main(void) { return 0; }', language: 'c' }],
    config: 'intel',
    optLevel: '-O2',
    prefetch: 'stream',
    defines: [{ name: 'SIZE', value: '64' }],
    sampleRate: 1,
    eventLimit: 100000,
    fastMode: false,
    segmentCaching: false,
    customConfig: null,
    compiler: 'clang-20',
    executor: 'direct',
    ...overrides,
  };
}

test('cache key includes every result-affecting nested input', () => {
  const baseline = generateCacheKey(inputs());
  const variants = [
    inputs({ files: [{ name: 'main.c', code: 'int main(void) { return 1; }', language: 'c' }] }),
    inputs({ files: [{ name: 'other.c', code: 'int main(void) { return 0; }', language: 'c' }] }),
    inputs({ files: [{ name: 'main.cpp', code: 'int main() { return 0; }', language: 'cpp' }] }),
    inputs({ defines: [{ name: 'SIZE', value: '128' }] }),
    inputs({ fastMode: true }),
    inputs({ segmentCaching: true }),
    inputs({ customConfig: { l1Size: 64 } }),
    inputs({ compiler: 'clang-21' }),
    inputs({ executor: 'sandbox' }),
  ];

  for (const variant of variants) {
    assert.notEqual(generateCacheKey(variant), baseline);
  }
});

test('cache key is stable across object insertion order', () => {
  const first = inputs({ customConfig: { l1Size: 64, l1Assoc: 8 } });
  const second = inputs({ customConfig: { l1Assoc: 8, l1Size: 64 } });
  assert.equal(generateCacheKey(first), generateCacheKey(second));
});
