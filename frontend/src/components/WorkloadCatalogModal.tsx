import type { WorkloadSnapshot, WorkloadVerificationResponse } from '../types'

interface WorkloadCatalogModalProps {
  workloads: WorkloadSnapshot[]
  verification: WorkloadVerificationResponse | null
  loading: boolean
  verifying: boolean
  error: string | null
  onRefresh: () => void
  onVerify: () => void
  onLoadWorkload: (workload: WorkloadSnapshot) => void
  onClose: () => void
}

function formatLimit(limit: number | undefined) {
  return typeof limit === 'number' && limit > 0 ? limit.toLocaleString() : 'full'
}

function statusFor(workload: WorkloadSnapshot, verification: WorkloadVerificationResponse | null) {
  return verification?.workloads.find(item => item.id === workload.id)
}

function formatValue(value: number | undefined) {
  if (typeof value !== 'number') return '-'
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(3)
}

function variantLabel(workload: WorkloadSnapshot, variant: WorkloadSnapshot['variants'][number]) {
  const details = [
    variant.prefetch ? `pf:${variant.prefetch}` : null,
    variant.optLevel && variant.optLevel !== workload.optLevel ? variant.optLevel : null,
  ].filter(Boolean)
  return details.length > 0 ? `${variant.id} (${details.join(', ')})` : variant.id
}

export function WorkloadCatalogModal({
  workloads,
  verification,
  loading,
  verifying,
  error,
  onRefresh,
  onVerify,
  onLoadWorkload,
  onClose,
}: WorkloadCatalogModalProps) {
  const hasWorkloads = workloads.length > 0

  return (
    <div className="batch-modal-overlay" onClick={() => !verifying && onClose()}>
      <div className="batch-modal workload-modal" onClick={event => event.stopPropagation()}>
        <div className="batch-modal-header">
          <span className="batch-modal-title">Verified Workloads</span>
          <div className="batch-modal-header-actions">
            {verification && (
              <span className={`workload-summary-chip ${verification.ok ? 'ok' : 'fail'}`}>
                {verification.summary.passed} passed / {verification.summary.failed} failed
              </span>
            )}
            <button className="btn" onClick={onVerify} disabled={loading || verifying || !hasWorkloads}>
              {verifying ? 'Verifying...' : 'Verify'}
            </button>
            <button className="btn" onClick={onRefresh} disabled={loading || verifying}>Refresh</button>
            <button className="batch-modal-close" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="batch-modal-content workload-modal-content">
          {error && <div className="experiment-error">{error}</div>}
          {(loading || verifying) && (
            <div className="batch-loading">
              <span className="loading-spinner" />
              {verifying ? 'Running workload contracts...' : 'Loading workloads...'}
            </div>
          )}

          {!loading && !verifying && !hasWorkloads && (
            <div className="workload-empty">
              <span>No workloads found</span>
            </div>
          )}

          {hasWorkloads && <div className="workload-list">
            {workloads.map(workload => {
              const status = statusFor(workload, verification)
              return (
                <div className="workload-row" key={workload.id}>
                  <div className="workload-row-main">
                    <div className="workload-row-heading">
                      <span className="workload-name">{workload.id}</span>
                      {status && (
                        <span className={`workload-status ${status.ok ? 'ok' : 'fail'}`}>
                          {status.ok ? 'Verified' : 'Failed'}
                        </span>
                      )}
                    </div>
                    <div className="workload-description">{workload.description}</div>
                    <div className="workload-meta">
                      <span>{workload.config}</span>
                      <span>{workload.optLevel || '-O0'}</span>
                      <span>{formatLimit(workload.limit)} events</span>
                      <span>{workload.variants.length} variants</span>
                    </div>
                    <div className="workload-variants">
                      {workload.variants.map(variant => (
                        <code key={variant.id}>{variantLabel(workload, variant)}</code>
                      ))}
                    </div>
                    <div className="workload-checks">
                      {workload.expectedRelationships.map(check => {
                        const observed = status?.checks.find(item => item.metric === check.metric && item.relationship === check.relationship)
                        return (
                          <span className={`workload-check ${observed ? (observed.passed ? 'ok' : 'fail') : ''}`} key={`${check.metric}-${check.relationship}`}>
                            {check.metric} {check.relationship}
                            {observed && ` (${formatValue(observed.leftValue)} vs ${formatValue(observed.rightValue)})`}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <div className="workload-row-actions">
                    {status && <span className="workload-duration">{status.durationMs.toLocaleString()}ms</span>}
                    <button className="btn" onClick={() => onLoadWorkload(workload)}>
                      Experiment
                    </button>
                  </div>
                </div>
              )
            })}
          </div>}
        </div>
      </div>
    </div>
  )
}
