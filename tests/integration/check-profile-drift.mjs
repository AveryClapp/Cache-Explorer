#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listHardwareProfiles } from '../../backend/server/hardwareProfiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const simulator = path.join(root, 'backend/cache-simulator/build/cache-sim');
const trace = 'R 4096 4 profile-drift.c:1 T1\n';

if (!existsSync(simulator)) {
  throw new Error(`cache simulator is not built: ${simulator}`);
}

function runSimulator(profileId) {
  const result = spawnSync(simulator, ['--config', profileId, '--json'], {
    input: trace,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`cache-sim failed for ${profileId}: ${result.stderr || result.stdout}`);
  }

  return JSON.parse(result.stdout);
}

function compareObject(actual, expected, fields, label) {
  for (const field of fields) {
    assert.deepEqual(actual?.[field], expected?.[field], `${label}.${field}`);
  }
}

const profileFields = ['id', 'displayName', 'vendor', 'architecture', 'class', 'modelConfidence'];
const cacheLevelFields = ['sizeKB', 'associativity', 'lineSize', 'sets', 'replacement', 'writePolicy'];
const prefetchFields = [
  'activePolicy',
  'activeDegree',
  'l1Stream',
  'l1Stride',
  'l1Degree',
  'l2Stream',
  'l2Adjacent',
  'l2Degree',
  'l2Streams',
  'l2MaxDistance',
  'l3Prefetch',
  'pointerPrefetch',
  'dynamicDegree',
];
const memoryFields = ['l1HitCycles', 'l2HitCycles', 'l3HitCycles', 'dramCycles', 'tlbMissPenaltyCycles'];
const executionFields = [
  'issueWidth',
  'robSize',
  'hideableCycles',
  'branchMispredictPenalty',
  'branchPredictor',
  'branchPredictorEntries',
];

for (const catalogProfile of listHardwareProfiles()) {
  const simulated = runSimulator(catalogProfile.id).profile;
  const label = catalogProfile.id;

  compareObject(simulated, catalogProfile, profileFields, label);

  assert.equal(
    simulated.details.cache.inclusion,
    catalogProfile.details.cache.inclusion,
    `${label}.details.cache.inclusion`,
  );

  for (const level of ['l1d', 'l1i', 'l2', 'l3']) {
    compareObject(
      simulated.details.cache.levels[level],
      catalogProfile.details.cache.levels[level],
      cacheLevelFields,
      `${label}.details.cache.levels.${level}`,
    );
  }

  compareObject(simulated.details.prefetch, catalogProfile.details.prefetch, prefetchFields, `${label}.details.prefetch`);
  compareObject(simulated.details.memory, catalogProfile.details.memory, memoryFields, `${label}.details.memory`);
  compareObject(
    simulated.details.executionCore,
    catalogProfile.details.executionCore,
    executionFields,
    `${label}.details.executionCore`,
  );
}

console.log(`Profile drift check passed for ${listHardwareProfiles().length} profiles.`);
