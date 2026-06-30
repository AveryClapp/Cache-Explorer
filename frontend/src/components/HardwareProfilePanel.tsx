import type { HardwareProfile, CacheConfig, HardwareProfileCacheLevel } from '../types'

interface HardwareProfilePanelProps {
  profile: HardwareProfile
  cacheConfig?: CacheConfig
}

type DetailRow = [label: string, value: string]

const contractLabels: Record<string, string> = {
  cacheHierarchy: 'Cache hierarchy',
  cacheReplacement: 'Replacement',
  cacheTiming: 'Timing',
  tlb: 'TLB',
  prefetch: 'Prefetch',
  coherence: 'Coherence',
  branchPrediction: 'Branch prediction',
  executionPipeline: 'Pipeline',
  memoryBandwidth: 'Bandwidth',
  memoryLevelParallelism: 'MLP',
  simd: 'SIMD',
  topology: 'Topology',
  dependencyModel: 'Dependencies',
  numa: 'NUMA',
}

function formatCache(level?: HardwareProfileCacheLevel) {
  if (!level) return 'Unknown'
  const size = level.sizeKB >= 1024 ? `${level.sizeKB / 1024} MB` : `${level.sizeKB} KB`
  return `${size}, ${level.associativity}-way, ${level.lineSize} B`
}

function formatLegacyCache(level?: { sizeKB: number; assoc: number; lineSize: number }) {
  if (!level) return 'Unknown'
  const size = level.sizeKB >= 1024 ? `${level.sizeKB / 1024} MB` : `${level.sizeKB} KB`
  return `${size}, ${level.assoc}-way, ${level.lineSize} B`
}

function formatToken(value?: string) {
  return value ? value.replace(/-/g, ' ') : 'Unknown'
}

function formatBool(value: boolean) {
  return value ? 'on' : 'off'
}

function formatOptional(value: string | number | undefined, suffix = '') {
  return value === undefined ? 'Unknown' : `${value}${suffix}`
}

function formatContractLabel(id: string) {
  return contractLabels[id] || formatToken(id)
}

function formatContractStatus(status: string, drivesSimulation: boolean) {
  const scope = drivesSimulation ? 'drives results' : 'profile only'
  return `${formatToken(status)} / ${scope}`
}

function DetailSection({ title, rows }: { title: string; rows: DetailRow[] }) {
  return (
    <div className="profile-detail-section">
      <div className="profile-detail-title">{title}</div>
      <div className="profile-detail-grid">
        {rows.map(([label, value]) => (
          <div className="profile-detail-row" key={label}>
            <span>{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function HardwareProfilePanel({ profile, cacheConfig }: HardwareProfilePanelProps) {
  const details = profile.details
  const cacheRows: DetailRow[] = details
    ? [
        ['L1D', formatCache(details.cache.levels.l1d)],
        ['L1I', formatCache(details.cache.levels.l1i)],
        ['L2', formatCache(details.cache.levels.l2)],
        ['L3', details.cache.levels.l3.sizeKB > 0 ? formatCache(details.cache.levels.l3) : 'none'],
        ['Policy', formatToken(details.cache.inclusion)],
      ]
    : cacheConfig
      ? [
          ['L1D', formatLegacyCache(cacheConfig.l1d)],
          ['L1I', formatLegacyCache(cacheConfig.l1i)],
          ['L2', formatLegacyCache(cacheConfig.l2)],
          ...((cacheConfig.l3?.sizeKB ?? 0) > 0
            ? ([['L3', formatLegacyCache(cacheConfig.l3)]] as DetailRow[])
            : []),
        ]
      : []

  const prefetchRows: DetailRow[] = details
    ? [
        ['Active', `${formatToken(details.prefetch.activePolicy)} x${details.prefetch.activeDegree}`],
        ['L1', `${formatBool(details.prefetch.l1Stream)} stream, ${formatBool(details.prefetch.l1Stride)} stride`],
        ['L2', `${details.prefetch.l2Streams} streams, distance ${details.prefetch.l2MaxDistance}`],
        ['Special', `L3 ${formatBool(details.prefetch.l3Prefetch)}, pointer ${formatBool(details.prefetch.pointerPrefetch)}`],
      ]
    : []

  const executionRows: DetailRow[] = details
    ? [
        ['Core', `${details.executionCore.issueWidth}-wide, ROB ${details.executionCore.robSize}`],
        ['Overlap', `${details.executionCore.hideableCycles} cycles hidden`],
        ['Branch', `${formatToken(details.executionCore.branchPredictor)}, ${details.executionCore.branchMispredictPenalty} cycles`],
        ['Vector', `${formatOptional(details.executionCore.vectorBits, '-bit')} ${formatToken(details.executionCore.vectorIsa)}`],
        ['Ports', `${formatOptional(details.executionCore.loadPorts)} load, ${formatOptional(details.executionCore.storePorts)} store`],
        ['Pipes', `${formatOptional(details.executionCore.integerPipelines)} int, ${formatOptional(details.executionCore.fpPipelines)} fp`],
      ]
    : []

  const memoryRows: DetailRow[] = details
    ? [
        ['Latency', `L1 ${details.memory.l1HitCycles}, L2 ${details.memory.l2HitCycles}, L3 ${details.memory.l3HitCycles}`],
        ['DRAM', `${details.memory.dramCycles} cycles`],
        ['TLB miss', `${details.memory.tlbMissPenaltyCycles} cycles`],
        ['L1/L2 BW', `${formatOptional(details.memory.l1BandwidthBytesPerCycle, ' B/cyc')} / ${formatOptional(details.memory.l2BandwidthBytesPerCycle, ' B/cyc')}`],
        ['DRAM BW', formatOptional(details.memory.dramBandwidthGBs, ' GB/s')],
        ['MLP', `${formatOptional(details.memory.maxMemoryLevelParallelism)} misses`],
      ]
    : []

  const topologyRows: DetailRow[] = details
    ? [
        ['Cores', `${details.topology.activeCores}`],
        ['L1/L2', `${formatToken(details.topology.l1Scope)} / ${formatToken(details.topology.l2Scope)}`],
        ['L3', formatToken(details.topology.l3Scope)],
        ['Coherence', formatToken(details.topology.coherence)],
      ]
    : []

  const tlbRows: DetailRow[] = details
    ? [
        ['DTLB', `${details.tlb.dtlb.entries} entries, ${details.tlb.dtlb.associativity}-way`],
        ['ITLB', `${details.tlb.itlb.entries} entries, ${details.tlb.itlb.associativity}-way`],
        ['Page', `${details.tlb.dtlb.pageSize / 1024} KB`],
      ]
    : []

  const coverageRows: DetailRow[] = profile.modelCoverage
    ? Object.entries(profile.modelCoverage).map(([label, value]) => [formatToken(label), formatToken(value)] as DetailRow)
    : []

  const contractRows: DetailRow[] = profile.modelContract
    ? Object.entries(profile.modelContract.fields).map(([id, field]) => [
        formatContractLabel(id),
        formatContractStatus(field.status, field.drivesSimulation),
      ] as DetailRow)
    : coverageRows

  const validationRows: DetailRow[] = profile.validation
    ? [
        ['Source', profile.validation.source],
        ['Confidence', formatToken(profile.validation.confidence)],
        ['Caveats', profile.validation.caveats.length ? `${profile.validation.caveats.length}` : 'none'],
      ]
    : []

  return (
    <div className="panel hardware-profile-panel">
      <div className="panel-header">
        <span className="panel-title">Hardware Profile</span>
        <span className={`profile-confidence ${profile.modelConfidence}`}>
          {profile.modelConfidence}
        </span>
      </div>
      <div className="panel-content">
        <div className="profile-summary">
          <div>
            <div className="profile-name">{profile.displayName}</div>
            <div className="profile-meta">
              {profile.vendor} / {profile.architecture} / {profile.class}
            </div>
          </div>
          <div className="profile-id">{profile.id}</div>
        </div>
        {cacheRows.length > 0 && <DetailSection title="Cache" rows={cacheRows} />}
        {details && (
          <div className="profile-detail-columns">
            <DetailSection title="TLB" rows={tlbRows} />
            <DetailSection title="Prefetch" rows={prefetchRows} />
            <DetailSection title="Execution" rows={executionRows} />
            <DetailSection title="Memory" rows={memoryRows} />
            <DetailSection title="Topology" rows={topologyRows} />
            {contractRows.length > 0 && <DetailSection title="Model Contract" rows={contractRows} />}
            {validationRows.length > 0 && <DetailSection title="Validation" rows={validationRows} />}
          </div>
        )}
      </div>
    </div>
  )
}
