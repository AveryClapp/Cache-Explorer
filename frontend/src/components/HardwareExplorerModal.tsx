import type { HardwareProfile } from '../types'
import { HardwareProfilePanel } from './HardwareProfilePanel'

interface HardwareExplorerModalProps {
  profiles: HardwareProfile[]
  selectedId: string
  activeId: string
  loading: boolean
  error: string | null
  onSelect: (id: string) => void
  onApply: (id: string) => void
  onRefresh: () => void
  onClose: () => void
}

function cacheSummary(profile: HardwareProfile) {
  const levels = profile.details?.cache.levels
  if (!levels) return profile.class
  const l1 = levels.l1d.sizeKB
  const l2 = levels.l2.sizeKB >= 1024 ? `${levels.l2.sizeKB / 1024} MB` : `${levels.l2.sizeKB} KB`
  const l3 = levels.l3.sizeKB > 0
    ? levels.l3.sizeKB >= 1024 ? `${levels.l3.sizeKB / 1024} MB` : `${levels.l3.sizeKB} KB`
    : 'no L3'
  return `L1D ${l1} KB / L2 ${l2} / ${l3}`
}

export function HardwareExplorerModal({
  profiles,
  selectedId,
  activeId,
  loading,
  error,
  onSelect,
  onApply,
  onRefresh,
  onClose,
}: HardwareExplorerModalProps) {
  const selected = profiles.find(profile => profile.id === selectedId) || profiles[0]

  return (
    <div className="batch-modal-overlay" onClick={() => !loading && onClose()}>
      <div className="batch-modal hardware-explorer-modal" onClick={event => event.stopPropagation()}>
        <div className="batch-modal-header">
          <span className="batch-modal-title">Hardware Explorer</span>
          <div className="hardware-explorer-actions">
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
              <button
                key={profile.id}
                className={`hardware-profile-row ${profile.id === selected?.id ? 'active' : ''}`}
                onClick={() => onSelect(profile.id)}
              >
                <span className="hardware-profile-row-heading">
                  <span className="hardware-profile-row-name">{profile.displayName}</span>
                  {profile.id === activeId && <span className="hardware-profile-current">Current</span>}
                </span>
                <span className="hardware-profile-row-meta">{profile.vendor} / {profile.class}</span>
                <span className="hardware-profile-row-cache">{cacheSummary(profile)}</span>
              </button>
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
