import type { HardwareProfile } from '../types'
import { exportHardwareProfilesAsCSV, exportHardwareProfilesAsJSON } from '../utils/export'
import { HardwareProfilePanel } from './HardwareProfilePanel'

interface HardwareExplorerModalProps {
  profiles: HardwareProfile[]
  selectedId: string
  activeId: string
  runConfigIds: string[]
  loading: boolean
  error: string | null
  onSelect: (id: string) => void
  onApply: (id: string) => void
  onToggleRunConfig: (id: string) => void
  onCompareRunSet: () => void
  onOpenExperiment: () => void
  onRefresh: () => void
}

function formatSize(sizeKB: number) {
  if (!sizeKB) return 'none'
  if (sizeKB >= 1024 && sizeKB % 1024 === 0) return `${sizeKB / 1024} MB`
  return `${sizeKB} KB`
}

function cacheSummary(profile: HardwareProfile) {
  const levels = profile.details?.cache.levels
  if (!levels) return profile.class
  return `L1D ${formatSize(levels.l1d.sizeKB)} / L2 ${formatSize(levels.l2.sizeKB)} / ${formatSize(levels.l3.sizeKB)}`
}

function formatToken(value?: string) {
  return value ? value.replace(/-/g, ' ') : 'unknown'
}

function trustSnapshot(profile: HardwareProfile) {
  const fields = Object.values(profile.modelContract?.fields || {})
  const coverageCount = profile.modelCoverage ? Object.keys(profile.modelCoverage).length : 0
  const counts = fields.reduce<Record<string, number>>((acc, field) => {
    acc[field.status] = (acc[field.status] || 0) + 1
    return acc
  }, {})
  const drivenFields = fields.filter(field => field.drivesSimulation).length

  return {
    totalFields: fields.length || coverageCount,
    drivenFields,
    calibratedFields: counts.calibrated || 0,
    estimatedFields: (counts.estimated || 0) + (counts.conditional || 0),
    metadataFields: (counts['metadata-only'] || 0) + (counts.unsupported || 0),
  }
}

type DiffTone = 'good' | 'warning' | 'neutral'

interface DiffMetric {
  value: string
  delta?: string
  tone?: DiffTone
}

function formatNumber(value: number | undefined, suffix = '') {
  return typeof value === 'number' ? `${value.toLocaleString()}${suffix}` : '-'
}

function signed(value: number) {
  return value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString()
}

function deltaTone(delta: number, higherIsBetter: boolean): DiffTone {
  if (delta === 0) return 'neutral'
  return (higherIsBetter && delta > 0) || (!higherIsBetter && delta < 0) ? 'good' : 'warning'
}

function numberMetric(value: number | undefined, baseline: number | undefined, valueSuffix = '', deltaSuffix = valueSuffix, higherIsBetter = true): DiffMetric {
  if (typeof value !== 'number' || typeof baseline !== 'number') return { value: formatNumber(value, valueSuffix) }
  const delta = value - baseline
  return {
    value: formatNumber(value, valueSuffix),
    delta: delta === 0 ? undefined : `${signed(delta)}${deltaSuffix}`,
    tone: deltaTone(delta, higherIsBetter),
  }
}

function sizeMetric(valueKB: number | undefined, baselineKB: number | undefined, higherIsBetter = true): DiffMetric {
  if (typeof valueKB !== 'number' || typeof baselineKB !== 'number') {
    return { value: typeof valueKB === 'number' ? formatSize(valueKB) : '-' }
  }
  const delta = valueKB - baselineKB
  return {
    value: formatSize(valueKB),
    delta: delta === 0 ? undefined : `${delta > 0 ? '+' : '-'}${formatSize(Math.abs(delta))}`,
    tone: deltaTone(delta, higherIsBetter),
  }
}

function textMetric(value: string | undefined, baseline: string | undefined): DiffMetric {
  if (!value) return { value: '-' }
  return {
    value,
    delta: baseline && value !== baseline ? 'diff' : undefined,
    tone: 'neutral',
  }
}

function DiffCell({ metric }: { metric: DiffMetric }) {
  return (
    <span className="hardware-diff-cell">
      <span>{metric.value}</span>
      {metric.delta && <span className={`hardware-diff-delta ${metric.tone || 'neutral'}`}>{metric.delta}</span>}
    </span>
  )
}

function bestProfile(
  profiles: HardwareProfile[],
  valueOf: (profile: HardwareProfile) => number | undefined,
  higherIsBetter = true,
) {
  return profiles.reduce<{ profile: HardwareProfile; value: number } | null>((best, profile) => {
    const value = valueOf(profile)
    if (typeof value !== 'number') return best
    if (!best) return { profile, value }
    return higherIsBetter === value > best.value ? { profile, value } : best
  }, null)
}

export function HardwareExplorerModal({
  profiles,
  selectedId,
  activeId,
  runConfigIds,
  loading,
  error,
  onSelect,
  onApply,
  onToggleRunConfig,
  onCompareRunSet,
  onOpenExperiment,
  onRefresh,
}: HardwareExplorerModalProps) {
  const selected = profiles.find(profile => profile.id === selectedId) || profiles[0]
  const selectedTrust = selected ? trustSnapshot(selected) : null
  const runProfiles = runConfigIds
    .map(profileId => profiles.find(profile => profile.id === profileId))
    .filter((profile): profile is HardwareProfile => Boolean(profile))
  const diffProfiles = runProfiles.length > 0 ? runProfiles : selected ? [selected] : []
  const baselineDetails = selected?.details
  const diffHighlights = [
    {
      label: 'Largest LLC',
      best: bestProfile(diffProfiles, profile => profile.details?.cache.levels.l3.sizeKB),
      format: formatSize,
    },
    {
      label: 'Lowest DRAM',
      best: bestProfile(diffProfiles, profile => profile.details?.memory.dramCycles, false),
      format: (value: number) => `${value.toLocaleString()} cycles`,
    },
    {
      label: 'Widest Core',
      best: bestProfile(diffProfiles, profile => profile.details?.executionCore.issueWidth),
      format: (value: number) => `${value}-wide`,
    },
    {
      label: 'Highest DRAM BW',
      best: bestProfile(diffProfiles, profile => profile.details?.memory.dramBandwidthGBs),
      format: (value: number) => `${value.toLocaleString()} GB/s`,
    },
  ].filter(item => item.best)

  return (
    <section className="batch-modal-overlay product-surface-overlay" aria-labelledby="hardware-explorer-title">
      <div
        className="batch-modal hardware-explorer-modal product-surface-panel"
        role="region"
        aria-labelledby="hardware-explorer-title"
      >
        <div className="batch-modal-header">
          <div className="product-surface-title">
            <h1 className="batch-modal-title" id="hardware-explorer-title">CPU Profiles</h1>
            <p>Inspect model coverage, confidence, and the profiles used for comparisons.</p>
          </div>
          <div className="hardware-explorer-actions">
            <span className="hardware-run-set-count">{runConfigIds.length} selected</span>
            <button
              className="btn"
              onClick={onCompareRunSet}
              disabled={loading || runConfigIds.length === 0}
            >
              Compare Set
            </button>
            <button
              className="btn"
              onClick={onOpenExperiment}
              disabled={loading || runConfigIds.length === 0}
            >
              Experiment
            </button>
            <button
              className="btn"
              onClick={() => selected && exportHardwareProfilesAsCSV(diffProfiles, selected)}
              disabled={loading || !selected || diffProfiles.length === 0}
            >
              Export CSV
            </button>
            <button
              className="btn"
              onClick={() => selected && exportHardwareProfilesAsJSON(diffProfiles, selected)}
              disabled={loading || !selected || diffProfiles.length === 0}
            >
              Export JSON
            </button>
            <button
              className="btn"
              onClick={() => selected && onApply(selected.id)}
              disabled={loading || !selected || selected.id === activeId}
            >
              Use Profile
            </button>
            <button className="btn" onClick={onRefresh} disabled={loading}>Refresh</button>
          </div>
        </div>
        <div className="batch-modal-content hardware-explorer-content">
          <div className="hardware-profile-list">
            {profiles.map(profile => (
              <div
                key={profile.id}
                className={`hardware-profile-row ${profile.id === selected?.id ? 'active' : ''}`}
              >
                <button
                  className="hardware-profile-row-main"
                  onClick={() => onSelect(profile.id)}
                  aria-pressed={profile.id === selected?.id}
                  aria-label={`Select hardware profile ${profile.displayName}`}
                >
                  <span className="hardware-profile-row-heading">
                    <span className="hardware-profile-row-name">{profile.displayName}</span>
                    {profile.id === activeId && <span className="hardware-profile-current">Current</span>}
                  </span>
                  <span className="hardware-profile-row-meta">{profile.vendor} / {profile.class}</span>
                  <span className="hardware-profile-row-cache">{cacheSummary(profile)}</span>
                </button>
                <label className="hardware-profile-run-toggle" title="Include in compare and experiment runs">
                  <input
                    type="checkbox"
                    checked={runConfigIds.includes(profile.id)}
                    aria-label={`Include ${profile.displayName} in compare and experiment runs`}
                    onChange={() => onToggleRunConfig(profile.id)}
                  />
                  <span>Run</span>
                </label>
              </div>
            ))}
          </div>

          <div className="hardware-explorer-detail">
            {loading && (
              <div className="batch-loading">
                <span className="loading-spinner" />
                Loading profiles...
              </div>
            )}
            {error && <div className="experiment-error" role="alert">{error}</div>}
            {!loading && !error && selected && (
              <>
                {selectedTrust && (
                  <div className="hardware-trust-snapshot" aria-label="Hardware trust snapshot">
                    <div className="hardware-trust-heading">
                      <span className="profile-detail-title">Trust Snapshot</span>
                      <span className={`profile-confidence ${selected.modelConfidence}`}>
                        {formatToken(selected.modelConfidence)}
                      </span>
                    </div>
                    <div className="hardware-trust-grid">
                      <div className="hardware-trust-cell">
                        <span>Driven fields</span>
                        <strong>
                          {selectedTrust.totalFields > 0 ? `${selectedTrust.drivenFields}/${selectedTrust.totalFields}` : 'unknown'}
                        </strong>
                      </div>
                      <div className="hardware-trust-cell">
                        <span>Calibrated</span>
                        <strong>{selectedTrust.calibratedFields}</strong>
                      </div>
                      <div className="hardware-trust-cell">
                        <span>Estimated</span>
                        <strong>{selectedTrust.estimatedFields}</strong>
                      </div>
                      <div className="hardware-trust-cell">
                        <span>Metadata only</span>
                        <strong>{selectedTrust.metadataFields}</strong>
                      </div>
                      <div className="hardware-trust-cell wide">
                        <span>Validation</span>
                        <strong>{selected.validation?.source || 'profile metadata'}</strong>
                      </div>
                      <div className="hardware-trust-cell wide">
                        <span>Aliases</span>
                        <strong>{selected.aliases?.length ? selected.aliases.join(', ') : 'none'}</strong>
                      </div>
                    </div>
                    {selected.validation?.caveats?.length ? (
                      <div className="hardware-trust-caveats">
                        <span>Validation Caveats</span>
                        <ul>
                          {selected.validation.caveats.map(caveat => (
                            <li key={caveat}>{caveat}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
                <HardwareProfilePanel profile={selected} />
                {selected.notes && <div className="hardware-profile-note">{selected.notes}</div>}
                {diffProfiles.length > 0 && (
                  <div className="hardware-run-set-matrix">
                    <div className="hardware-run-set-header">
                      <div>
                        <div className="profile-detail-title">Run Set Diff</div>
                        <div className="hardware-run-set-baseline">
                          Compared against {selected.displayName}
                        </div>
                      </div>
                      {diffHighlights.length > 0 && (
                        <div className="hardware-diff-highlights">
                          {diffHighlights.map(item => item.best && (
                            <span className="hardware-diff-highlight" key={item.label}>
                              <span>{item.label}</span>
                              <strong>{item.best.profile.displayName}</strong>
                              <code>{item.format(item.best.value)}</code>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Profile</th>
                          <th>L1D</th>
                          <th>L2</th>
                          <th>L3</th>
                          <th>DRAM</th>
                          <th>Core</th>
                          <th>Vector</th>
                          <th>DRAM BW</th>
                          <th>MLP</th>
                          <th>Prefetch</th>
                          <th>Model</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffProfiles.map(profile => {
                          const levels = profile.details?.cache.levels
                          const memory = profile.details?.memory
                          const core = profile.details?.executionCore
                          return (
                            <tr key={profile.id}>
                              <td>
                                <span className="hardware-diff-profile-name">{profile.displayName}</span>
                                {profile.id === selected.id && <span className="hardware-diff-baseline-chip">Baseline</span>}
                              </td>
                              <td><DiffCell metric={sizeMetric(levels?.l1d.sizeKB, baselineDetails?.cache.levels.l1d.sizeKB)} /></td>
                              <td><DiffCell metric={sizeMetric(levels?.l2.sizeKB, baselineDetails?.cache.levels.l2.sizeKB)} /></td>
                              <td><DiffCell metric={sizeMetric(levels?.l3.sizeKB, baselineDetails?.cache.levels.l3.sizeKB)} /></td>
                              <td><DiffCell metric={numberMetric(memory?.dramCycles, baselineDetails?.memory.dramCycles, ' cyc', ' cyc', false)} /></td>
                              <td><DiffCell metric={numberMetric(core?.issueWidth, baselineDetails?.executionCore.issueWidth, '-wide', 'w')} /></td>
                              <td><DiffCell metric={numberMetric(core?.vectorBits, baselineDetails?.executionCore.vectorBits, '-bit', 'b')} /></td>
                              <td><DiffCell metric={numberMetric(memory?.dramBandwidthGBs, baselineDetails?.memory.dramBandwidthGBs, ' GB/s')} /></td>
                              <td><DiffCell metric={numberMetric(memory?.maxMemoryLevelParallelism, baselineDetails?.memory.maxMemoryLevelParallelism, '')} /></td>
                              <td><DiffCell metric={textMetric(profile.details?.prefetch.activePolicy, baselineDetails?.prefetch.activePolicy)} /></td>
                              <td><DiffCell metric={textMetric(profile.validation?.confidence || profile.modelConfidence, selected.validation?.confidence || selected.modelConfidence)} /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
