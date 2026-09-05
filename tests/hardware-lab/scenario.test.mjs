import assert from 'node:assert/strict'
import test from 'node:test'
import { captureScenario, parseScenario, sourceDeltas, validateOverrides } from '../../frontend/src/lab/scenario.ts'

const source = [{ name: 'main.c', code: 'int main(void) { return 0; }', language: 'c' }]
const scenario = () => captureScenario(source, 'educational', { optLevel: '-O0', limit: 1000000 })
const run = () => ({ profile: 'Educational', confidence: 'educational', configuration: {}, events: 10, l1Misses: 2, dtlbMisses: 1,
  branchMisses: 0, cycles: 12, memoryServiceCycles: 100, dramBytes: 128, bandwidthPressure: 0.1, lines: [], caveats: ['Simulated, not measured.'], provenance: {} })

test('portable scenarios capture source/settings without executing or widening event limits', () => {
  const result = scenario()
  assert.equal(result.settings.limit, 200000)
  assert.deepEqual(result.files, source)
  assert.equal(result.report, undefined)
  assert.deepEqual(parseScenario(JSON.stringify(result)), result)
})
test('scenario import strictly bounds files, names, settings, reports and unknown properties', () => {
  const bad = [
    { schemaVersion: 2 }, { kind: 'other' }, { unknown: true }, { config: 'custom' },
    { files: [] }, { files: [{ ...source[0], name: '../main.c' }] }, { files: [{ ...source[0], language: 'rust' }] },
    { files: [source[0], source[0]] }, { files: [{ ...source[0], code: 'x'.repeat(262145) }] },
    { overrides: { 'branch.predictor': 'btfnt' } }, { overrides: { 'memory.assumedMlp': '1e2' } },
    { settings: { ...scenario().settings, compiler: '/tmp/untrusted-compiler' } },
    { settings: { ...scenario().settings, limit: 0 } }, { settings: { ...scenario().settings, timeout: 9999999 } },
    { report: {} }, { report: { generatedAt: '2026-09-05T00:00:00Z', baseline: { ...run(), lines: [{}] }, variant: run() } },
  ]
  for (const patch of bad) assert.throws(() => parseScenario(JSON.stringify({ ...scenario(), ...patch })))
  assert.throws(() => parseScenario(' '.repeat(1024 * 1024 + 1)))
  assert.throws(() => validateOverrides({ 'cache.lineSize': '63' }))
})
test('report snapshots round trip but missing source rows never imply zero cost', () => {
  const baseline = { ...run(), lines: [{ file: 'main.c', line: 5, misses: 5, stallCycles: 10, explanation: 'bounded sample' }] }
  const variant = { ...run(), confidence: 'experimental' }
  const value = { ...scenario(), report: { generatedAt: '2026-09-05T00:00:00Z', baseline, variant } }
  assert.deepEqual(parseScenario(JSON.stringify(value)), value)
  const [row] = sourceDeltas(baseline, variant)
  assert.equal(row.key, 'main.c:5')
  assert.equal(row.before.misses, 5)
  assert.equal(row.after, undefined)
})
