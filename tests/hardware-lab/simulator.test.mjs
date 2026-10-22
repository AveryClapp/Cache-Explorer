import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { projectRun } from '../../frontend/src/lab/scenario.ts'

const simulator = process.env.HARDWARE_EXPLORER_SIM
if (!simulator) throw new Error('Set HARDWARE_EXPLORER_SIM to the freshly built cache-sim.')
const fields = JSON.parse(readFileSync(new URL('../../frontend/src/lab/fields.json', import.meta.url)))
const run = (trace, args = []) => JSON.parse(execFileSync(simulator, ['--config', 'educational', '--prefetch', 'none', '--json', ...args], { input: trace, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
const memoryTrace = Array.from({ length: 256 }, (_, i) => `I 0x100000 16 test.c:2 T1\nL 0x${(0x200000 + (i % 64) * 4096).toString(16)} 4 test.c:5 T1`).join('\n')

test('every web parameter initial value is accepted by the native model', () => {
  for (const field of fields) execFileSync(simulator, ['--config', 'intel', '--check-config', '--lab', `${field.key}=${field.initial}`]);
})
test('web parameter bounds and choices match the native validator', () => {
  const check = entry => spawnSync(simulator, ['--config', 'intel', '--check-config', '--lab', entry], { encoding: 'utf8' })
  for (const field of fields) {
    if (field.values) {
      for (const value of field.values) assert.equal(check(`${field.key}=${value}`).status, 0, `${field.key}=${value}`)
      continue
    }
    // An in-range value can still form invalid geometry with the preset, so only the range verdict is compared.
    for (const value of [field.min, field.max]) assert.doesNotMatch(check(`${field.key}=${value}`).stderr, /outside supported range/, `${field.key}=${value}`)
    for (const value of [field.min - 1, field.max + 1]) assert.match(check(`${field.key}=${value}`).stderr, /outside supported range/, `${field.key}=${value}`)
  }
})
test('legacy output stays stable while effective settings and evidence are additive', () => {
  const base = run(memoryTrace)
  const changed = run(memoryTrace, ['--lab', 'memory.assumedMlp=4', '--lab', 'tlb.pageSize=2097152'])
  assert.deepEqual(base.levels, changed.levels)
  assert.equal(changed.profile.modelConfidence, 'experimental')
  assert.equal(changed.profile.details.tlb.dtlb.pageSize, 2097152)
  assert.equal(changed.profile.details.memory.assumedMlp, 4)
  assert.equal(changed.profile.labOverrides['memory.assumedMlp'], '4')
  assert(changed.tlb.dtlb.misses < base.tlb.dtlb.misses)
  assert(changed.subsystems.execution.pipeline.cycles < base.subsystems.execution.pipeline.cycles)
  assert.equal(base.subsystems.cacheEvidence.lines[0].sample.strideBytes, 4096)
  assert.equal(base.subsystems.cacheEvidence.lines[0].sample.address, '0x23f000')
  assert.equal(base.subsystems.cacheEvidence.lines[0].sample.missClass, 'capacity-heuristic')
  // The 4 KiB stride conflicts through the educational lower-level geometry.
  assert.equal(base.subsystems.memorySystem.dramDemandFillBytes, 256 * 64)
  assert.equal(base.subsystems.topology.activeCores, 1)
  assert.equal(base.subsystems.topology.observedEvents, 0)
})
test('bandwidth service floor can signal pressure without pretending to measure throughput', () => {
  const trace = Array.from({ length: 32 }, (_, i) => `I 0x100000 4 bandwidth.c:2 T1\nL 0x${(0x300000 + i * 64).toString(16)} 4 bandwidth.c:5 T1`).join('\n')
  const result = run(trace, ['--lab', 'memory.dramCycles=1', '--lab', 'memory.bandwidthBytesPerCycle=1'])
  assert.equal(result.subsystems.memorySystem.classification, 'bandwidth-pressure')
  assert.equal(result.subsystems.memorySystem.saturationWarning, true)
  assert.equal(result.subsystems.memorySystem.bandwidthServiceCycles, 32 * 64)
  const noInstructions = run('L 0x1000 4 raw.c:1 T1')
  assert.equal(noInstructions.subsystems.memorySystem.bandwidthPressure, null)
  assert.equal(noInstructions.subsystems.memorySystem.pressureAvailable, false)
})
test('instruction counts and base cycles do not depend on fetch splitting or line size', () => {
  for (const address of ['0x100000', '0x10000f']) {
    const trace = `I ${address} 64 test.c:2 T1\nL 0x200000 4 test.c:5 T1`
    for (const size of [16, 32, 64, 128]) {
      const result = run(trace, ['--lab', `cache.lineSize=${size}`])
      assert.equal(result.execution.pipeline.instructions, 16)
      assert.equal(result.execution.pipeline.breakdown.baseCycles, 8)
      assert.equal(result.subsystems.execution.pipeline.instructions, 16)
    }
  }
})
test('source deltas use complete native totals even when subsystem annotations are truncated', () => {
  const trace = ['I 0x100000 4 test.c:1 T1', 'I 0x100040 4 test.c:1 T1',
    'L 0x200000 4 test.c:1 T1', 'L 0x200040 4 test.c:1 T1',
    ...Array.from({ length: 11 }, (_, i) => `I 0x${(0x110000 + i * 64).toString(16)} 4 test.c:${i + 2} T1`)].join('\n')
  const baseline = run(trace), variant = run(trace, ['--lab', 'memory.assumedMlp=4'])
  assert.equal(variant.sourceAnnotations.some(row => row.line === 1 && row.subsystem === 'memory'), false)
  assert.equal(projectRun(baseline).lines.find(row => row.line === 1).stallCycles, 332)
  assert.equal(projectRun(variant).lines.find(row => row.line === 1).stallCycles, 232)
  const legacy = structuredClone(variant)
  for (const row of legacy.sourceAnnotations) delete row.metrics.totalSourceStallCycles
  assert.equal(projectRun(legacy).lines.find(row => row.line === 1).stallCycles, null)
})
test('prefetch explanation does not fabricate late or pollution measurements', () => {
  const result = run(memoryTrace, ['--lab', 'prefetch.policy=stride'])
  assert.equal(result.profile.details.prefetch.activePolicy, 'stride')
  assert(result.subsystems.cacheEvidence.caveats.some(note => note.includes('lateness and pollution are unavailable')))
})
test('BTFNT is trace-direction gated and never inferred from branch ids', () => {
  const result = run('B 0xff 1 loop.c:4 T1 D1\nB 0x01 0 loop.c:5 T1 D0', ['--lab', 'branch.predictor=btfnt'])
  assert.equal(result.subsystems.execution.branchPrediction.mispredictions, 0)
  const missing = spawnSync(simulator, ['--json', '--lab', 'branch.predictor=btfnt'], { input: 'B 0xff 1 loop.c:4 T1\n', encoding: 'utf8' })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /requires D0\/D1/)
})
test('multicore history preserves order, bounds and explicit unsupported subsystems', () => {
  const trace = Array.from({ length: 400 }, (_, i) => `S 0x${(0x1000 + i % 2 * 4).toString(16)} 4 sharing.c:5 T${i % 2 + 1}`).join('\n')
  const result = run(trace)
  assert.equal(result.subsystems.execution.available, false)
  assert.equal(result.subsystems.memorySystem.available, false)
  assert.equal(result.subsystems.topology.observedEvents, 399)
  assert.equal(result.subsystems.topology.omittedEvents, 143)
  assert.equal(result.subsystems.topology.events.length, 256)
  assert.equal(result.subsystems.topology.events[0].sequence, 144)
  assert.equal(result.subsystems.topology.events[0].address, '0x1000')
  assert(result.falseSharing.length > 0)
  const unsupported = spawnSync(simulator, ['--json', '--lab', 'memory.assumedMlp=4'], { input: trace, encoding: 'utf8' })
  assert.notEqual(unsupported.status, 0)
  assert.match(unsupported.stderr, /does not support multithreaded traces/)
})
