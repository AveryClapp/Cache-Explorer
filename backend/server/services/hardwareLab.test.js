import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHardwareLabTrust, hardwareLabArgs, normalizeHardwareLab, validateHardwareLabRequest } from './hardwareLab.js';
import { generateCacheKey } from '../cache.js';

test('Hardware Lab fields are normalized, ordered and passed as argv, never shell commands', () => {
  const result = normalizeHardwareLab({ 'memory.assumedMlp': 4, 'l1d.sizeKB': '0064' });
  assert.deepEqual(result, { 'l1d.sizeKB': '64', 'memory.assumedMlp': '4' });
  assert.deepEqual(hardwareLabArgs(result), ['--lab', 'l1d.sizeKB=64', '--lab', 'memory.assumedMlp=4']);
  for (const input of [null, [], true, { unknown: 1 }, { 'l1d.sizeKB': '1;touch /tmp/test' },
    { 'l1d.sizeKB': 0 }, { 'l1d.sizeKB': {} }, { 'l1d.sizeKB': NaN }, { 'tlb.pageSize': 5000 },
    { 'cache.lineSize': 63 }, { 'branch.predictor': 'btfnt' }, { 'memory.assumedMlp': 65 }]) {
    assert.throws(() => normalizeHardwareLab(input));
  }
});

test('unsupported modes and unsafe work sizes fail before execution', () => {
  const body = { hardwareLab: { 'branch.predictor': 'gshare' }, limit: 200000, language: 'c' };
  assert.deepEqual(validateHardwareLabRequest(body, false), body.hardwareLab);
  assert.throws(() => validateHardwareLabRequest(body, true), error => error.statusCode === 501);
  for (const patch of [{ limit: undefined }, { limit: 0 }, { limit: 200001 }, { limit: '100' }, { sample: 0 }, { sample: Infinity }, { cacheSegments: true }, { customConfig: {} }, { language: 'rust' }]) {
    assert.throws(() => validateHardwareLabRequest({ ...body, ...patch }, false));
  }
  assert.deepEqual(validateHardwareLabRequest({ code: 'int main(){}' }, true), {});
});

test('scenario cache identity includes every override without depending on object order', () => {
  const base = { files: [{ name: 'main.c', code: 'int main(){}', language: 'c' }], config: 'educational' };
  const a = { 'l1d.sizeKB': '64', 'memory.assumedMlp': '4' };
  const b = { 'memory.assumedMlp': '4', 'l1d.sizeKB': '64' };
  assert.equal(generateCacheKey({ ...base, hardwareLab: a }), generateCacheKey({ ...base, hardwareLab: b }));
  assert.notEqual(generateCacheKey(base), generateCacheKey({ ...base, hardwareLab: a }));
  assert.notEqual(generateCacheKey({ ...base, hardwareLab: a }), generateCacheKey({ ...base, hardwareLab: { ...a, 'memory.assumedMlp': '2' } }));
});

test('catalog enrichment and cache replay cannot promote scenarios to calibrated', () => {
  const fields = { cache: { status: 'calibrated', drivesSimulation: true }, numa: { status: 'unsupported' } };
  const result = { profile: { modelConfidence: 'calibrated', validation: { confidence: 'calibrated' },
    labOverrides: { 'prefetch.policy': 'stride' }, modelContract: { fields } },
    provenance: { hardwareProfile: { validationConfidence: 'calibrated' }, fidelity: { prefetch: 'none' }, caveats: [] } };
  applyHardwareLabTrust(result);
  assert.equal(result.profile.modelConfidence, 'experimental');
  assert.equal(result.profile.validation.confidence, 'uncalibrated');
  assert.equal(result.profile.modelContract.fields.cache.status, 'estimated');
  assert.equal(result.profile.modelContract.fields.numa.status, 'unsupported');
  assert.equal(fields.cache.status, 'calibrated', 'catalog objects must not be mutated');
  assert.equal(result.provenance.fidelity.prefetch, 'stride');
  assert.equal(result.provenance.hardwareProfile.validationConfidence, 'uncalibrated');
  applyHardwareLabTrust(result);
  assert.equal(result.provenance.caveats.length, 1);
});
