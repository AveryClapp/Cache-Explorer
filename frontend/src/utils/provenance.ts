import type { CacheResult, HardwareModelContractField, HardwareProfile, ResultProvenance } from '../types'

function titleize(value: string | undefined) {
  if (!value) return 'Unknown'
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

export function provenanceClass(provenance: ResultProvenance | undefined) {
  if (!provenance) return 'unknown'
  if (provenance.fidelity.trace === 'sampled' || provenance.fidelity.fastMode) return 'directional'
  if (provenance.hardwareProfile?.validationConfidence === 'empirical') return 'empirical'
  return 'simulated'
}

export function formatTrustLabel(provenance: ResultProvenance | undefined) {
  if (!provenance) return 'Legacy'
  const trace = provenance.fidelity.trace === 'sampled' ? `1:${provenance.fidelity.sampleRate}` : 'Full'
  const confidence = titleize(provenance.hardwareProfile?.modelConfidence)
  return `${trace} / ${confidence}`
}

export function formatExecutor(provenance: ResultProvenance | undefined) {
  if (!provenance) return 'Unknown'
  if (provenance.executor === 'direct-dev') return 'Direct dev'
  return titleize(provenance.executor)
}

export function formatFidelity(provenance: ResultProvenance | undefined) {
  if (!provenance) return 'Unknown'
  const parts = [
    provenance.fidelity.trace === 'sampled'
      ? `sample 1:${provenance.fidelity.sampleRate}`
      : 'full trace',
  ]
  if (provenance.fidelity.fastMode) parts.push('fast')
  if (provenance.fidelity.cacheSegments) parts.push('segments')
  if (provenance.fidelity.prefetch && provenance.fidelity.prefetch !== 'none') {
    parts.push(`prefetch ${provenance.fidelity.prefetch}`)
  }
  return parts.join(' / ')
}

export function formatConfidence(provenance: ResultProvenance | undefined) {
  if (!provenance?.hardwareProfile) return 'Unknown'
  const model = titleize(provenance.hardwareProfile.modelConfidence)
  const validation = titleize(provenance.hardwareProfile.validationConfidence)
  return model === validation ? model : `${model} / ${validation}`
}

export function formatHardwareLabel(provenance: ResultProvenance | undefined) {
  if (!provenance?.hardwareProfile) return 'Unknown'
  return `${provenance.hardwareProfile.displayName} (${provenance.hardwareProfile.id})`
}

export function formatCompilerLabel(provenance: ResultProvenance | undefined) {
  const compiler = provenance?.toolchain?.compiler
  if (!compiler) return 'Unknown'
  const command = compiler.command || compiler.path || 'compiler'
  const version = compiler.version ? compiler.version.replace(/\s+/g, ' ').trim() : ''
  return version ? `${command} / ${version}` : command
}

export function formatSimulatorLabel(provenance: ResultProvenance | undefined) {
  const simulator = provenance?.toolchain?.simulator
  if (!simulator?.path) return 'Unknown'
  const hash = simulator.sha256 ? ` / ${simulator.sha256.slice(0, 12)}` : ''
  return `${simulator.path.split('/').pop() || simulator.path}${hash}`
}

export function formatSourceLabel(provenance: ResultProvenance | undefined) {
  const source = provenance?.source
  if (!source) return 'Unknown'
  const path = source.path ? source.path.split('/').pop() || source.path : 'source'
  return [path, source.language, source.optLevel].filter(Boolean).join(' / ')
}

export interface ModelContractBucket {
  key: 'modeled' | 'estimated' | 'metadata' | 'unsupported'
  label: string
  count: number
  description: string
  fields: string[]
}

function contractFieldLabel(id: string, field: HardwareModelContractField) {
  return titleize(field.subsystem || id)
}

export function summarizeModelContract(profile: HardwareProfile | undefined): ModelContractBucket[] {
  const contractFields = Object.entries(profile?.modelContract?.fields || {})
  if (contractFields.length === 0) return []

  const buckets: ModelContractBucket[] = [
    {
      key: 'modeled',
      label: 'Modeled',
      count: 0,
      description: 'drive simulation',
      fields: [],
    },
    {
      key: 'estimated',
      label: 'Estimated',
      count: 0,
      description: 'drive cycle estimates',
      fields: [],
    },
    {
      key: 'metadata',
      label: 'Metadata',
      count: 0,
      description: 'display only',
      fields: [],
    },
    {
      key: 'unsupported',
      label: 'Unsupported',
      count: 0,
      description: 'not modeled',
      fields: [],
    },
  ]

  for (const [id, field] of contractFields) {
    let bucket = buckets[0]
    if (field.status === 'unsupported') {
      bucket = buckets[3]
    } else if (field.status === 'metadata-only' || !field.drivesSimulation) {
      bucket = buckets[2]
    } else if (field.status === 'estimated') {
      bucket = buckets[1]
    }

    bucket.count += 1
    bucket.fields.push(contractFieldLabel(id, field))
  }

  return buckets
    .filter(bucket => bucket.count > 0)
    .map(bucket => ({
      ...bucket,
      description: `${bucket.count} ${bucket.description}`,
    }))
}

function shellQuote(value: string | number) {
  const text = String(value)
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(text)) return text
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function compilerDirectory(path: string | undefined) {
  if (!path || !path.includes('/')) return undefined
  return path.split('/').slice(0, -1).join('/')
}

export function buildReproCommand(result: CacheResult) {
  const provenance = result.provenance
  const source = provenance?.source
  if (!source) return null

  const sourcePath = source.path || 'main.c'
  const args = ['cache-explore', sourcePath]
  const optLevel = source.optLevel || provenance?.toolchain?.compiler?.optLevel
  if (optLevel) args.push(optLevel)

  for (const define of source.defines || provenance?.toolchain?.compiler?.defines || []) {
    args.push(define.startsWith('-D') ? define : `-D${define}`)
  }

  const compilerPath = compilerDirectory(provenance?.toolchain?.compiler?.path)
  if (compilerPath) args.push('--compiler', compilerPath)

  args.push('--config', source.config || result.config)

  const fidelity = provenance?.fidelity
  if (fidelity?.prefetch && fidelity.prefetch !== 'none') args.push('--prefetch', fidelity.prefetch)
  if (fidelity?.prefetchDegree && fidelity.prefetchDegree > 0) {
    args.push('--prefetch-degree', String(fidelity.prefetchDegree))
  }
  if (fidelity?.sampleRate && fidelity.sampleRate > 1) args.push('--sample', String(fidelity.sampleRate))
  if (fidelity?.eventLimit && fidelity.eventLimit > 0) args.push('--limit', String(fidelity.eventLimit))
  if (fidelity?.fastMode) args.push('--fast')
  if (fidelity?.cacheSegments) args.push('--cache-segments')

  args.push('--json')
  return args.map(shellQuote).join(' ')
}
