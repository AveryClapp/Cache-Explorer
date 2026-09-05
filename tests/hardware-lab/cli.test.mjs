import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const cli = fileURLToPath(new URL('../../backend/scripts/cache-explore', import.meta.url))
const fixture = fileURLToPath(new URL('./sensitivity.c', import.meta.url))
const execute = (...args) => spawnSync('bash', [cli, fixture, '--json', '--config', 'educational', '--limit', '100000', '--prefetch', 'none', ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 })

test('real compiler/runtime/simulator pipeline preserves effective override provenance', () => {
  const process = execute('--lab', 'l1d.sizeKB=64', '--lab', 'branch.predictor=gshare', '--lab', 'prefetch.policy=stride')
  assert.equal(process.status, 0, process.stderr)
  const result = JSON.parse(process.stdout)
  assert.equal(result.profile.details.cache.levels.l1d.sizeKB, 64)
  assert.equal(result.profile.details.executionCore.branchPredictor, 'gshare')
  assert.equal(result.provenance.hardwareProfile.labOverrides['prefetch.policy'], 'stride')
  assert.equal(result.provenance.fidelity.prefetch, 'stride')
  assert.equal(result.profile.modelConfidence, 'experimental')
  assert(result.events > 100)
  assert(result.subsystems.execution.branchPrediction.total > 0)
  assert(result.subsystems.memorySystem.available)
  assert(result.subsystems.cacheEvidence.lines.length > 0)
})
test('invalid geometry and unsupported source modes fail before compilation starts', () => {
  for (const args of [['--lab', 'cache.lineSize=63'], ['--lab', 'l1d.sizeKB=64', '--cache-segments'], ['--lab', 'l1d.sizeKB=64', '--stream'], ['--lab', 'branch.predictor=btfnt']]) {
    const result = execute(...args)
    assert.notEqual(result.status, 0)
    assert(!result.stderr.includes('Compiling with instrumentation'), result.stderr)
  }
})
test('a simulator rejection propagates through the JSON enrichment pipeline as failure', () => {
  const input = fileURLToPath(new URL('./multithreaded.c', import.meta.url))
  const result = spawnSync('bash', [cli, input, '--json', '--config', 'educational', '--lab', 'l1d.sizeKB=64'], { encoding: 'utf8', timeout: 60000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not support multithreaded traces/)
})
