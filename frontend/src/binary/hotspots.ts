import Ajv from 'ajv'
import schema from './hotspots.schema.json' with { type: 'json' }

export const MAX_FILE_BYTES = 16 * 1024 * 1024
export interface BinaryMetrics {
  accesses: number; reads: number; writes: number; l1dHits: number
  l1dMisses: number; l1dMissRate: number; estimatedMemoryStallCycles: number
}
export interface BinaryHotspot {
  location: { imageId: string; rva: string }
  lookup: { rva: string; method: 'instruction-pc' | 'return-pc-minus-one' }
  navigationConfidence: 'unresolved' | 'source-nearest' | 'function-exact'
  symbol?: { function: string; functionRva: string }
  metrics: BinaryMetrics
}
export interface HotspotBundle {
  schemaVersion: 1; kind: 'hardware-explorer-hotspots'
  capture: { traceFormat: 2; kind: 'intel-pin' | 'clang-cl'; target: string; addressWidth: 32; sampleRate: number; eventLimit: number; truncated: boolean }
  profile: { id: string; displayName: string; modelConfidence: string; configuration: Record<string, string | number | boolean> }
  coverage: { scope: 'exported-ranked-sites'; returnedSites: number; note: string }
  images: { id: string; name: string; sha256: string; imageSize: number; codeView?: { guid: string; age: number } }[]
  codeHotspots: BinaryHotspot[]
  warnings: string[]
}

// One schema/semantic interface is used by local import, CLI export and tests.
const validate = new Ajv({ allErrors: false }).compile<HotspotBundle>(schema)
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
  return value as Record<string, unknown>
}
const list = (value: unknown, limit: number): unknown[] => {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Expected a list of at most ${limit} entries.`)
  return value
}
const basename = (value: unknown) => typeof value === 'string' ? value.split(/[/\\]/).pop() : value
const rvaNumber = (value: unknown): number => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,8}$/.test(value)) throw new Error('Invalid PE32 RVA.')
  return Number.parseInt(value.slice(2), 16)
}
const hex = (value: number) => `0x${value.toString(16)}`
const imageSpan = (image: Record<string, unknown>) => {
  const end = image.endAddress
  if (typeof end !== 'string' || !/^0x[0-9a-fA-F]{1,9}$/.test(end) || Number(end) > 0x100000000) throw new Error('Invalid PE32 image end address.')
  return Number(end) - rvaNumber(image.loadedBase)
}
const pick = (value: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map(key => [key, value[key]]))
const metricKeys = ['accesses', 'reads', 'writes', 'l1dHits', 'l1dMisses', 'l1dMissRate', 'estimatedMemoryStallCycles']
const coverageNote = 'Ranked subset, not complete module/function totals. Unattributed accesses are not represented.'

export function validateBundle(value: unknown): HotspotBundle {
  if (!validate(value)) throw new Error(`Invalid hotspot bundle: ${validate.errors?.[0]?.instancePath || '/'} ${validate.errors?.[0]?.message}.`)
  const images = new Map(value.images.map(image => [image.id, image]))
  if (images.size !== value.images.length || value.coverage.returnedSites !== value.codeHotspots.length) throw new Error('Duplicate image or inconsistent coverage.')
  for (const image of value.images) if (image.id !== `sha256:${image.sha256}`) throw new Error('Image hash and identity disagree.')
  const sites = new Set<string>()
  for (const site of value.codeHotspots) {
    const image = images.get(site.location.imageId)
    const rva = rvaNumber(site.location.rva)
    const key = `${site.location.imageId}:${rva}`
    const expected = value.capture.kind === 'clang-cl' ? rva - 1 : rva
    const method = value.capture.kind === 'clang-cl' ? 'return-pc-minus-one' : 'instruction-pc'
    const m = site.metrics
    if (!image || rva >= image.imageSize || expected < 0 || sites.has(key)) throw new Error('Unknown image, duplicate site or out-of-image RVA.')
    if (site.lookup.method !== method || rvaNumber(site.lookup.rva) !== expected) throw new Error('Code-site lookup does not match the capture method.')
    if (site.symbol && rvaNumber(site.symbol.functionRva) > expected) throw new Error('Function starts after the code site.')
    if ((site.navigationConfidence === 'unresolved') === Boolean(site.symbol)) throw new Error('Navigation confidence disagrees with function attribution.')
    if (m.reads + m.writes !== m.accesses || m.l1dHits + m.l1dMisses !== m.accesses ||
      Math.abs(m.l1dMissRate - (m.accesses ? m.l1dMisses / m.accesses : 0)) > 0.00011) throw new Error('Inconsistent hotspot metrics.')
    sites.add(key)
  }
  return value
}

function configuration(details: unknown): HotspotBundle['profile']['configuration'] {
  const result: HotspotBundle['profile']['configuration'] = {}
  if (!details || typeof details !== 'object') return result
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 4 || Object.keys(result).length >= 128) return
    if (typeof value === 'number' || typeof value === 'boolean' ||
      (typeof value === 'string' && /^[a-zA-Z0-9 -]{0,128}$/.test(value))) result[path] = value
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) if (/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(key)) walk(child, `${path}.${key}`, depth + 1)
    }
  }
  const source = object(details)
  for (const key of ['cache', 'tlb', 'prefetch', 'executionCore', 'memory', 'topology']) walk(source[key], key, 0)
  return result
}

/** Whitelist projection: never spread an analysis into a portable export. */
export function importBinaryProfile(text: string): HotspotBundle {
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw new Error('File exceeds the 16 MiB import limit.')
  const input = object(JSON.parse(text))
  if ('schemaVersion' in input || input.kind === 'hardware-explorer-hotspots') return validateBundle(input)
  const capture = object(input.capture)
  const profile = object(input.profile)
  const images = list(input.images, 4096).map(value => {
    const image = object(value)
    const size = image.imageSize ?? imageSpan(image)
    return { id: image.id, name: basename(image.name), sha256: image.sha256, imageSize: size,
      ...(image.codeView ? { codeView: pick(object(image.codeView), ['guid', 'age']) } : {}) }
  })
  const hotspots = list(input.codeHotspots, 10000).map(value => {
    const site = object(value)
    const location = object(site.location)
    const rva = rvaNumber(location.rva)
    const lookup = capture.kind === 'clang-cl' ? rva - 1 : rva
    return { location: { imageId: location.imageId, rva: hex(rva) },
      lookup: { rva: hex(lookup), method: capture.kind === 'clang-cl' ? 'return-pc-minus-one' : 'instruction-pc' },
      navigationConfidence: site.navigationConfidence,
      ...(site.symbol ? { symbol: pick(object(site.symbol), ['function', 'functionRva']) } : {}),
      metrics: pick(object(site.metrics), metricKeys) }
  })
  const warnings = [
    'Preview: cache outcomes and stall cycles are modeled, not measured hardware counters.',
    coverageNote,
    'The bundle contains binary hashes, module names and optional function names. Review before sharing.',
    'Decompiler pseudocode is reconstructed. Navigation is approximate, not source stepping.',
  ]
  if (capture.sampleRate !== 1) warnings.push('Sampled counts are not extrapolated. Sampling changes modeled cache history.')
  if (capture.truncated) warnings.push('Capture reached its event limit; later execution is not represented.')
  if (Object.keys(configuration(profile.details)).length === 0) warnings.push('Detailed model configuration is unavailable in this result.')
  return validateBundle({ schemaVersion: 1, kind: 'hardware-explorer-hotspots',
    capture: pick(capture, ['traceFormat', 'kind', 'target', 'addressWidth', 'sampleRate', 'eventLimit', 'truncated']),
    profile: { id: basename(profile.id), displayName: basename(profile.displayName), modelConfidence: basename(profile.modelConfidence), configuration: configuration(profile.details) },
    coverage: { scope: 'exported-ranked-sites', returnedSites: hotspots.length, note: coverageNote }, images, codeHotspots: hotspots, warnings })
}

export function groupHotspots(bundle: HotspotBundle, imageId: string, query: string, sort: keyof BinaryMetrics) {
  const groups = new Map<string, { name: string; sites: BinaryHotspot[]; metrics: BinaryMetrics }>()
  const needle = query.toLowerCase().trim()
  for (const site of bundle.codeHotspots) {
    if (site.location.imageId !== imageId) continue
    const name = site.symbol?.function ?? 'Unresolved function'
    if (needle && !`${name} ${site.location.rva}`.toLowerCase().includes(needle)) continue
    const key = site.symbol?.functionRva ?? 'unresolved'
    let group = groups.get(key)
    if (!group) {
      group = { name, sites: [], metrics: { accesses: 0, reads: 0, writes: 0, l1dHits: 0, l1dMisses: 0, l1dMissRate: 0, estimatedMemoryStallCycles: 0 } }
      groups.set(key, group)
    }
    group.sites.push(site)
    for (const metric of metricKeys as (keyof BinaryMetrics)[]) if (metric !== 'l1dMissRate') group.metrics[metric] += site.metrics[metric]
    group.metrics.l1dMissRate = group.metrics.accesses ? group.metrics.l1dMisses / group.metrics.accesses : 0
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group, sites: group.sites.sort((a, b) => b.metrics[sort] - a.metrics[sort]) }))
    .sort((a, b) => b.metrics[sort] - a.metrics[sort])
}
