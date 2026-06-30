import type { ResultProvenance } from '../types'

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
