import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRequestTimeout,
  parseConfigList,
  validateSharePayload,
  validateWorkPlan,
} from './requestValidation.js';

const timeouts = { default: 60_000, min: 5_000, max: 300_000 };

test('request timeout always produces a finite bounded watchdog value', () => {
  assert.equal(normalizeRequestTimeout('invalid', timeouts), 60_000);
  assert.equal(normalizeRequestTimeout({}, timeouts), 60_000);
  assert.equal(normalizeRequestTimeout(1, timeouts), 5_000);
  assert.equal(normalizeRequestTimeout(900_000, timeouts), 300_000);
  assert.equal(normalizeRequestTimeout('12000', timeouts), 12_000);
});

test('work plans reject excessive configs, variants, and their product', () => {
  const limits = { maxConfigs: 16, maxVariants: 16, maxRuns: 64 };
  assert.match(validateWorkPlan({ configs: 17, variants: 1 }, limits), /at most 16 hardware profiles/);
  assert.match(validateWorkPlan({ configs: 1, variants: 17 }, limits), /at most 16 variants/);
  assert.match(validateWorkPlan({ configs: 9, variants: 8 }, limits), /at most 64 profile-variant runs/);
  assert.equal(validateWorkPlan({ configs: 8, variants: 8 }, limits), null);
});

test('config lists reject empty fields and unknown profiles before work is scheduled', () => {
  const allowed = ['educational', 'intel', 'amd', 'apple'];

  assert.deepEqual(parseConfigList('educational,intel', allowed), ['educational', 'intel']);
  assert.deepEqual(parseConfigList(['amd', 'apple'], allowed), ['amd', 'apple']);
  assert.equal(parseConfigList(','), null);
  assert.equal(parseConfigList('intel,'), null);
  assert.equal(parseConfigList(',intel'), null);
  assert.equal(parseConfigList('intel,,amd'), null);
  assert.equal(parseConfigList('unknown', allowed), null);
});

test('share payloads must be serializable and stay within their byte budget', () => {
  assert.equal(validateSharePayload({ code: 'int main() {}' }, 64), null);
  assert.match(validateSharePayload({ code: 'x'.repeat(65) }, 64), /at most 64 bytes/);
  const circular = {};
  circular.self = circular;
  assert.match(validateSharePayload(circular, 64), /JSON serializable/);
});
