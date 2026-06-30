import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HARDWARE_MODEL_FIELD_IDS,
  HARDWARE_MODEL_STATUSES,
  listHardwareProfiles,
  getHardwareProfile,
} from '../hardwareProfiles.js';

const REQUIRED_LEGACY_COVERAGE_KEYS = [
  'cacheHierarchy',
  'tlb',
  'prefetch',
  'branchPrediction',
  'executionCore',
  'simd',
  'bandwidth',
  'coherence',
  'dependencyModel',
];

test('all hardware profiles expose a complete model contract', () => {
  const validStatuses = new Set(Object.keys(HARDWARE_MODEL_STATUSES));

  for (const profile of listHardwareProfiles()) {
    assert.equal(typeof profile.id, 'string');
    assert.ok(profile.details, `${profile.id} should expose hardware details`);
    assert.ok(profile.modelContract, `${profile.id} should expose a model contract`);
    assert.equal(profile.modelContract.version, 1);
    assert.deepEqual(
      Object.keys(profile.modelContract.fields).sort(),
      [...HARDWARE_MODEL_FIELD_IDS].sort(),
      `${profile.id} should declare every model-contract field`,
    );

    for (const fieldId of HARDWARE_MODEL_FIELD_IDS) {
      const field = profile.modelContract.fields[fieldId];
      assert.ok(validStatuses.has(field.status), `${profile.id}.${fieldId} has invalid status ${field.status}`);
      assert.equal(typeof field.subsystem, 'string', `${profile.id}.${fieldId} needs a subsystem`);
      assert.equal(typeof field.drivesSimulation, 'boolean', `${profile.id}.${fieldId} needs drivesSimulation`);
      assert.ok(Array.isArray(field.resultSurface), `${profile.id}.${fieldId} needs resultSurface`);
      assert.equal(typeof field.description, 'string', `${profile.id}.${fieldId} needs a description`);
      assert.ok(field.description.length > 0, `${profile.id}.${fieldId} needs a non-empty description`);
      if (!field.drivesSimulation) {
        assert.ok(
          field.status === 'metadata-only' || field.status === 'unsupported',
          `${profile.id}.${fieldId} cannot be ${field.status} without driving simulation`,
        );
      }
    }
  }
});

test('legacy model coverage stays present for older clients', () => {
  for (const profile of listHardwareProfiles()) {
    for (const key of REQUIRED_LEGACY_COVERAGE_KEYS) {
      assert.equal(typeof profile.modelCoverage?.[key], 'string', `${profile.id} missing modelCoverage.${key}`);
    }
  }
});

test('profile aliases resolve to their canonical profile objects', () => {
  for (const profile of listHardwareProfiles()) {
    assert.equal(getHardwareProfile(profile.id), profile);
    for (const alias of profile.aliases || []) {
      assert.equal(getHardwareProfile(alias), profile, `${alias} should resolve to ${profile.id}`);
    }
  }
});

test('calibrated Xeon profile keeps narrow calibration claims', () => {
  const profile = getHardwareProfile('xeon8488c');
  assert.ok(profile);
  assert.equal(profile.modelConfidence, 'calibrated');
  assert.equal(profile.modelContract.fields.cacheHierarchy.status, 'calibrated');
  assert.equal(profile.modelContract.fields.cacheTiming.status, 'estimated');
  assert.equal(profile.modelContract.fields.dependencyModel.status, 'unsupported');
});
