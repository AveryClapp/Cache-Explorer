import type { CacheResult } from '../types'
import fields from './fields.json' with { type: 'json' }

export { fields }
export const MAX_SCENARIO_BYTES = 1024 * 1024
export interface LabSource { name: string; code: string; language: 'c' | 'cpp' }
export interface LabSettings {
  optLevel: string; prefetch: string; sample: number; limit: number; fast: boolean
  defines: { name: string; value: string }[]; compiler?: string
}
export interface LabRun {
  profile: string; confidence: string; configuration: Record<string, string>
  events: number; l1Misses: number; dtlbMisses: number; branchMisses: number | null; cycles: number | null
  memoryServiceCycles: number | null
  dramBytes: number | null; bandwidthPressure: number | null
  lines: { file: string; line: number; misses: number | null; stallCycles: number | null; explanation: string }[]
  caveats: string[]; provenance: Record<string, string>
}
export interface LabScenario {
  schemaVersion: 1; kind: 'hardware-explorer-scenario'; name: string; config: string
  files: LabSource[]; settings: LabSettings; overrides: Record<string, string>
  report?: { generatedAt: string; baseline: LabRun; variant: LabRun }
}

const object = (value: unknown, keys?: string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
  if (keys && Object.keys(value).some(key => !keys.includes(key))) throw new Error('Scenario contains an unknown field.')
  return value as Record<string, unknown>
}
const text = (value: unknown, max = 4096): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Expected text of at most ${max} characters.`)
  return value
}
const number = (value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid scenario integer.')
  return value
}
const array = (value: unknown, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Expected at most ${max} entries.`)
  return value
}
const strings = (value: unknown): Record<string, string> => {
  const entries = Object.entries(object(value))
  if (entries.length > 128) throw new Error('Too many report fields.')
  return Object.fromEntries(entries.map(([key, value]) => [text(key, 128), text(value)]))
}
const basename = (file: string) => file.split(/[/\\]/).pop() || file
const flatten = (input: unknown): Record<string, string> => {
  const result: Record<string, string> = {}
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 5 || Object.keys(result).length >= 128) return
    if (['string', 'number', 'boolean'].includes(typeof value)) result[path] = String(value).slice(0, 4096)
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key, depth + 1)
    }
  }
  walk(input, '', 0)
  return result
}

export function validateOverrides(value: unknown): Record<string, string> {
  const input = object(value)
  if (Object.keys(input).length > 16) throw new Error('At most 16 overrides are supported.')
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    const field = fields.find(field => field.key === key)
    const entry = text(value, 128)
    if (!field) throw new Error(`Unknown hardware parameter: ${key}`)
    if (field.values ? !field.values.includes(entry) : !/^\d{1,10}$/.test(entry) || Number(entry) < field.min! || Number(entry) > field.max!) {
      throw new Error(`Invalid value for ${field.label}.`)
    }
    if (['cache.lineSize', 'tlb.pageSize'].includes(key) && !Number.isInteger(Math.log2(Number(entry)))) throw new Error(`${field.label} must be a power of two.`)
    return [key, field.values ? entry : String(Number(entry))]
  }))
}

function readRun(value: unknown): LabRun {
  const input = object(value, ['profile', 'confidence', 'configuration', 'events', 'l1Misses', 'dtlbMisses', 'branchMisses', 'cycles', 'memoryServiceCycles', 'dramBytes', 'bandwidthPressure', 'lines', 'caveats', 'provenance'])
  const nullable = (value: unknown) => value === null ? null : number(value)
  const pressure = input.bandwidthPressure
  if (pressure !== null && (typeof pressure !== 'number' || !Number.isFinite(pressure) || pressure < 0 || pressure > 1e12)) throw new Error('Invalid pressure estimate.')
  return { profile: text(input.profile, 200), confidence: text(input.confidence, 100), configuration: strings(input.configuration),
    events: number(input.events), l1Misses: number(input.l1Misses), dtlbMisses: number(input.dtlbMisses),
    branchMisses: nullable(input.branchMisses), cycles: nullable(input.cycles), memoryServiceCycles: nullable(input.memoryServiceCycles), dramBytes: nullable(input.dramBytes), bandwidthPressure: pressure as number | null,
    lines: array(input.lines, 512).map(value => {
      const row = object(value, ['file', 'line', 'misses', 'stallCycles', 'explanation'])
      return { file: text(row.file, 256), line: number(row.line, 4294967295), misses: nullable(row.misses), stallCycles: nullable(row.stallCycles), explanation: text(row.explanation) }
    }), caveats: array(input.caveats, 64).map(value => text(value)), provenance: strings(input.provenance) }
}

export function parseScenario(source: string): LabScenario {
  if (new TextEncoder().encode(source).byteLength > MAX_SCENARIO_BYTES) throw new Error('Scenario exceeds the 1 MiB limit.')
  const input = object(JSON.parse(source), ['schemaVersion', 'kind', 'name', 'config', 'files', 'settings', 'overrides', 'report'])
  if (input.schemaVersion !== 1 || input.kind !== 'hardware-explorer-scenario') throw new Error('Unsupported Hardware Explorer scenario version.')
  const config = text(input.config, 64)
  if (!/^[a-zA-Z0-9_-]+$/.test(config) || config === 'custom') throw new Error('Choose a named hardware profile.')
  const files = array(input.files, 16).map(value => {
    const file = object(value, ['name', 'code', 'language'])
    const name = text(file.name, 100)
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(c|cpp|cc|cxx|h|hpp)$/.test(name) || name.includes('..')) throw new Error('Source filenames must be simple C/C++ filenames, without paths.')
    if (file.language !== 'c' && file.language !== 'cpp') throw new Error('Hardware Lab runs C/C++ source.')
    return { name, code: text(file.code, 262144), language: file.language }
  })
  if (!files.length || new Set(files.map(file => file.name)).size !== files.length || files.reduce((n, file) => n + file.code.length, 0) > 262144) throw new Error('Provide 1–16 unique source files, at most 256 KiB total.')
  const settings = object(input.settings, ['optLevel', 'prefetch', 'sample', 'limit', 'fast', 'defines', 'compiler'])
  if (!['-O0', '-O1', '-O2', '-O3', '-Os', '-Oz'].includes(String(settings.optLevel)) || !['none', 'next', 'next-line', 'stream', 'stride', 'adaptive', 'intel'].includes(String(settings.prefetch)) || typeof settings.fast !== 'boolean') throw new Error('Invalid capture settings.')
  const compiler = settings.compiler === undefined ? undefined : text(settings.compiler, 80)
  if (compiler !== undefined && !/^[a-zA-Z0-9_.+-]+$/.test(compiler)) throw new Error('Compiler must be a local compiler identifier, not a path.')
  const scenario: LabScenario = { schemaVersion: 1, kind: 'hardware-explorer-scenario', name: text(input.name, 120), config,
    files: files as LabSource[], settings: { optLevel: String(settings.optLevel), prefetch: String(settings.prefetch),
      sample: number(settings.sample, 10000, 1), limit: number(settings.limit, 200000, 1), fast: settings.fast, ...(compiler ? { compiler } : {}),
      defines: array(settings.defines, 32).map(value => {
        const entry = object(value, ['name', 'value'])
        const name = text(entry.name, 100), valueText = text(entry.value, 1000)
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid preprocessor definition.')
        return { name, value: valueText }
      }) }, overrides: validateOverrides(input.overrides) }
  if (input.report !== undefined) {
    const report = object(input.report, ['generatedAt', 'baseline', 'variant'])
    const generatedAt = text(report.generatedAt, 40)
    if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid report date.')
    scenario.report = { generatedAt, baseline: readRun(report.baseline), variant: readRun(report.variant) }
  }
  return scenario
}

export function captureScenario(files: { name: string; code: string; language: string }[], config: string, payload: Record<string, unknown>): LabScenario {
  return parseScenario(JSON.stringify({ schemaVersion: 1, kind: 'hardware-explorer-scenario', name: 'Hardware sensitivity', config,
    files: files.map(({ name, code, language }) => ({ name, code, language })),
    settings: { optLevel: payload.optLevel || '-O0', prefetch: payload.prefetch || 'none', sample: payload.sample || 1,
      limit: Math.min(Number(payload.limit) || 100000, 200000), fast: payload.fast === true, defines: payload.defines || [],
      ...(payload.compiler ? { compiler: payload.compiler } : {}) }, overrides: { 'l1d.sizeKB': '64' } }))
}

export function projectRun(result: CacheResult): LabRun {
  if (!result.levels || !result.profile || !result.subsystems?.memorySystem?.available) throw new Error('The backend did not return detailed Hardware Lab evidence. Update the local simulator and retry.')
  const execution = result.subsystems.execution
  const memory = result.subsystems.memorySystem
  const rows = new Map<string, LabRun['lines'][number]>()
  // Legacy hotLines mix instruction and data misses. Only cacheEvidence can
  // supply per-source L1D misses; an absent data row stays unknown, never zero.
  for (const row of result.subsystems.cacheEvidence?.lines || []) {
    const file = basename(row.file), key = `${file}:${row.line}`
    const sample = row.sample
    rows.set(key, { file, line: row.line, misses: row.misses, stallCycles: rows.get(key)?.stallCycles ?? null,
      explanation: `Observed ${sample.missClass} sample at line base ${sample.address}, set ${sample.set}, tag ${sample.tag}; served by ${['', 'L1', 'L2', 'L3', 'DRAM'][sample.hitLevel]}. Stride ${sample.strideBytes ?? 'unknown'} bytes; reuse gap ${sample.reuseGapAccesses ?? 'unknown'} intervening accesses.${sample.competitor ? ` Same-set observation: ${basename(sample.competitor.file)}:${sample.competitor.line} (${sample.competitor.address}), not proof of eviction.` : ''}` })
  }
  for (const row of result.sourceAnnotations || []) {
    const file = basename(row.file), key = `${file}:${row.line}`
    const existing = rows.get(key) || { file, line: row.line, misses: null, stallCycles: 0, explanation: row.detail }
    // Individual subsystem annotations are ranked/truncated. Never sum them
    // into a supposedly complete source total; the native aggregate is exact.
    existing.stallCycles = row.metrics.totalSourceStallCycles ?? null
    rows.set(key, existing)
  }
  return readRun({ profile: result.profile.displayName, confidence: result.profile.modelConfidence,
    configuration: flatten({ ...result.profile.details, labOverrides: result.profile.labOverrides }), events: result.events,
    l1Misses: (result.levels.l1d || result.levels.l1)?.misses || 0, dtlbMisses: result.tlb?.dtlb.misses || 0,
    branchMisses: execution?.available ? execution.branchPrediction?.mispredictions ?? null : null,
    cycles: execution?.available ? execution.pipeline?.cycles ?? null : null,
    memoryServiceCycles: result.timing?.totalCycles ?? null,
    dramBytes: memory.dramDemandFillBytes ?? null, bandwidthPressure: memory.bandwidthPressure ?? null,
    lines: [...rows.values()], caveats: [...new Set([...(result.provenance?.caveats || []), ...(memory.caveats || []), ...(result.subsystems.cacheEvidence?.caveats || []), 'Source rows are a ranked, bounded subset; an omitted row is not evidence of zero cost.'])],
    provenance: flatten(result.provenance) })
}

export function sourceDeltas(baseline: LabRun, variant: LabRun) {
  const a = new Map(baseline.lines.map(row => [`${row.file}:${row.line}`, row]))
  const b = new Map(variant.lines.map(row => [`${row.file}:${row.line}`, row]))
  return [...new Set([...a.keys(), ...b.keys()])].map(key => ({ key, before: a.get(key), after: b.get(key) }))
    .sort((x, y) => Math.abs((y.after?.misses || 0) - (y.before?.misses || 0)) - Math.abs((x.after?.misses || 0) - (x.before?.misses || 0)))
}
