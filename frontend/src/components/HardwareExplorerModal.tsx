import type { HardwareProfile } from '../types'
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
  onClose: () => void
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

function latencySummary(profile: HardwareProfile) {
  const memory = profile.details?.memory
  if (!memory) return '-'
  return `L1 ${memory.l1HitCycles} / L2 ${memory.l2HitCycles} / DRAM ${memory.dramCycles}`
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
  onClose,
}: HardwareExplorerModalProps) {
  const selected = profiles.find(profile => profile.id === selectedId) || profiles[0]
  const runProfiles = runConfigIds
    .map(profileId => profiles.find(profile => profile.id === profileId))
    .filter((profile): profile is HardwareProfile => Boolean(profile))

  return (
    <div className="batch-modal-overlay" onClick={() => !loading && onClose()}>
      <div className="batch-modal hardware-explorer-modal" onClick={event => event.stopPropagation()}>
        <div className="batch-modal-header">
          <span className="batch-modal-title">Hardware Explorer</span>
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
              onClick={() => selected && onApply(selected.id)}
              disabled={loading || !selected || selected.id === activeId}
            >
              Use Profile
            </button>
            <button className="btn" onClick={onRefresh} disabled={loading}>Refresh</button>
            <button className="batch-modal-close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="batch-modal-content hardware-explorer-content">
          <div className="hardware-profile-list">
            {profiles.map(profile => (
              <div
                key={profile.id}
                className={`hardware-profile-row ${profile.id === selected?.id ? 'active' : ''}`}
              >
                <button className="hardware-profile-row-main" onClick={() => onSelect(profile.id)}>
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
            {error && <div className="experiment-error">{error}</div>}
            {!loading && !error && selected && (
              <>
                <HardwareProfilePanel profile={selected} />
                {selected.notes && <div className="hardware-profile-note">{selected.notes}</div>}
                {runProfiles.length > 0 && (
                  <div className="hardware-run-set-matrix">
                    <div className="profile-detail-title">Run Set</div>
                    <table>
                      <thead>
                        <tr>
                          <th>Profile</th>
                          <th>L1D</th>
                          <th>L2</th>
                          <th>L3</th>
                          <th>Latency</th>
                          <th>Prefetch</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runProfiles.map(profile => {
                          const levels = profile.details?.cache.levels
                          return (
                            <tr key={profile.id}>
                              <td>{profile.displayName}</td>
                              <td>{levels ? formatSize(levels.l1d.sizeKB) : '-'}</td>
                              <td>{levels ? formatSize(levels.l2.sizeKB) : '-'}</td>
                              <td>{levels ? formatSize(levels.l3.sizeKB) : '-'}</td>
                              <td>{latencySummary(profile)}</td>
                              <td>{profile.details?.prefetch.activePolicy || '-'}</td>
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
    </div>
  )
}
