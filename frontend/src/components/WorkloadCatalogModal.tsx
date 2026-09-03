import { useMemo, useState } from 'react'
import type {
  WorkloadHistoryDurationDelta,
  WorkloadHistoryResponse,
  WorkloadSnapshot,
  WorkloadVerificationRun,
  WorkloadVerificationResponse,
} from '../types'

type WorkloadStatusFilter = 'all' | 'verified' | 'failed' | 'unverified'
type WorkloadSort = 'name' | 'target' | 'duration' | 'checks' | 'variants'

interface WorkloadCatalogModalProps {
  workloads: WorkloadSnapshot[]
  verification: WorkloadVerificationResponse | null
  history: WorkloadHistoryResponse | null
  includeStress: boolean
  loading: boolean
  verifying: boolean
  error: string | null
  historyLoading: boolean
  historyError: string | null
  onRefresh: () => void
  onVerify: (includeStress: boolean) => void
  onRefreshHistory: () => void
  onIncludeStressChange: (includeStress: boolean) => void
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

function formatDuration(ms: number | undefined) {
  if (typeof ms !== 'number') return '-'
  if (Math.abs(ms) >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms.toLocaleString()}ms`
}

function formatSignedDuration(ms: number) {
  const sign = ms > 0 ? '+' : ''
  return `${sign}${formatDuration(ms)}`
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number') return ''
  const sign = value > 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)}%`
}

function formatDate(value: string | undefined) {
  if (!value) return 'unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortDigest(value: string | undefined) {
  return value ? value.slice(0, 12) : ''
}

function isStressWorkload(workload: WorkloadSnapshot) {
  return workload.stress === true || (workload.tags || []).includes('stress')
}

function variantLabel(workload: WorkloadSnapshot, variant: WorkloadSnapshot['variants'][number]) {
  const details = [
    variant.prefetch ? `pf:${variant.prefetch}` : null,
    variant.optLevel && variant.optLevel !== workload.optLevel ? variant.optLevel : null,
  ].filter(Boolean)
  return details.length > 0 ? `${variant.id} (${details.join(', ')})` : variant.id
}

function searchableText(workload: WorkloadSnapshot) {
  return [
    workload.id,
    workload.description,
    workload.example,
    workload.config,
    workload.optLevel,
    workload.prefetch,
    workload.stress ? 'stress' : '',
    ...(workload.tags || []),
    workload.identity?.manifestSha256,
    ...Object.values(workload.identity?.sourceFiles || {}).map(file => file.sha256),
    ...workload.variants.flatMap(variant => [
      variant.id,
      variant.example,
      variant.optLevel,
      variant.config,
      variant.prefetch,
      ...(variant.defines || []),
    ]),
    ...workload.expectedRelationships.flatMap(check => [
      check.metric,
      check.relationship,
    ]),
  ].filter(Boolean).join(' ').toLowerCase()
}

function statusKey(workload: WorkloadSnapshot, verification: WorkloadVerificationResponse | null): WorkloadStatusFilter {
  const status = statusFor(workload, verification)
  if (!status) return 'unverified'
  return status.ok ? 'verified' : 'failed'
}

function sortWorkloads(
  workloads: WorkloadSnapshot[],
  sortBy: WorkloadSort,
  verification: WorkloadVerificationResponse | null,
) {
  const withStableTieBreak = (a: WorkloadSnapshot, b: WorkloadSnapshot, result: number) => (
    result === 0 ? a.id.localeCompare(b.id) : result
  )

  return [...workloads].sort((a, b) => {
    if (sortBy === 'target') {
      return withStableTieBreak(a, b, a.config.localeCompare(b.config))
    }
    if (sortBy === 'duration') {
      const aDuration = statusFor(a, verification)?.durationMs ?? -1
      const bDuration = statusFor(b, verification)?.durationMs ?? -1
      return withStableTieBreak(a, b, bDuration - aDuration)
    }
    if (sortBy === 'checks') {
      return withStableTieBreak(a, b, b.expectedRelationships.length - a.expectedRelationships.length)
    }
    if (sortBy === 'variants') {
      return withStableTieBreak(a, b, b.variants.length - a.variants.length)
    }
    return a.id.localeCompare(b.id)
  })
}

function deltaTone(delta: WorkloadHistoryDurationDelta | undefined) {
  if (!delta || delta.deltaMs === 0) return 'neutral'
  return delta.deltaMs > 0 ? 'warn' : 'good'
}

function variantRunTone(run: WorkloadVerificationRun | undefined) {
  if (!run) return ''
  if (run.ok) return 'ok'
  return run.timeout ? 'timeout' : 'fail'
}

function variantRunTitle(run: WorkloadVerificationRun | undefined) {
  if (!run) return 'Not verified'
  const state = run.ok ? 'passed' : run.timeout ? 'timed out' : 'failed'
  return [state, formatDuration(run.durationMs), run.error].filter(Boolean).join(' / ')
}

function variantIdsByState(
  status: ReturnType<typeof statusFor> | undefined,
  predicate: (run: WorkloadVerificationRun) => boolean,
) {
  return Object.entries(status?.variants || {})
    .filter(([, run]) => predicate(run))
    .map(([id]) => id)
}

export function WorkloadCatalogModal({
  workloads,
  verification,
  history,
  includeStress,
  loading,
  verifying,
  error,
  historyLoading,
  historyError,
  onRefresh,
  onVerify,
  onRefreshHistory,
  onIncludeStressChange,
  onLoadWorkload,
  onClose,
}: WorkloadCatalogModalProps) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<WorkloadStatusFilter>('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [sortBy, setSortBy] = useState<WorkloadSort>('name')
  const hasWorkloads = workloads.length > 0
  const historyAvailable = history?.available && history.latest
  const normalizedQuery = query.trim().toLowerCase()
  const durationDeltas = useMemo(
    () => history?.durationDeltas || [],
    [history?.durationDeltas],
  )
  const deltaByWorkload = useMemo(() => (
    new Map(durationDeltas.map(delta => [delta.id, delta]))
  ), [durationDeltas])
  const targetOptions = useMemo(() => (
    [...new Set(workloads.map(workload => workload.config))].sort()
  ), [workloads])
  const visibleWorkloads = useMemo(() => {
    const filtered = workloads.filter(workload => {
      const status = statusKey(workload, verification)
      const matchesStatus = statusFilter === 'all' || status === statusFilter
      const matchesTarget = targetFilter === 'all' || workload.config === targetFilter
      const matchesQuery = !normalizedQuery || searchableText(workload).includes(normalizedQuery)
      return matchesStatus && matchesTarget && matchesQuery
    })
    return sortWorkloads(filtered, sortBy, verification)
  }, [normalizedQuery, sortBy, statusFilter, targetFilter, verification, workloads])
  const hasActiveFilters = Boolean(normalizedQuery) || statusFilter !== 'all' || targetFilter !== 'all' || sortBy !== 'name'
  const clearFilters = () => {
    setQuery('')
    setStatusFilter('all')
    setTargetFilter('all')
    setSortBy('name')
  }

  return (
    <div className="batch-modal-overlay" onClick={() => !verifying && onClose()}>
      <div
        className="batch-modal workload-modal"
        onClick={event => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="verified-workloads-title"
      >
        <div className="batch-modal-header">
          <span className="batch-modal-title" id="verified-workloads-title">Verified Workloads</span>
          <div className="batch-modal-header-actions">
            {verification && (
              <span className={`workload-summary-chip ${verification.ok ? 'ok' : 'fail'}`}>
                {verification.summary.passed} passed / {verification.summary.failed} failed
              </span>
            )}
            <button
              className="btn"
              onClick={() => onVerify(includeStress)}
              disabled={loading || verifying || !hasWorkloads}
            >
              {verifying ? 'Verifying...' : 'Verify'}
            </button>
            <button className="btn" onClick={onRefresh} disabled={loading || verifying}>Refresh</button>
            <button
              className="btn"
              onClick={onRefreshHistory}
              disabled={historyLoading}
            >
              {historyLoading ? 'History...' : 'History'}
            </button>
            <button className="batch-modal-close" onClick={onClose} aria-label="Close verified workloads">×</button>
          </div>
        </div>
        <div className="batch-modal-content workload-modal-content">
          {error && <div className="experiment-error" role="alert">{error}</div>}
          {historyError && <div className="experiment-error" role="alert">History unavailable: {historyError}</div>}
          {historyLoading && (
            <div className="workload-history-loading">
              <span className="loading-spinner" />
              Loading published workload history...
            </div>
          )}
          {!historyLoading && historyAvailable && (
            <div className="workload-history-panel">
              <div className="workload-history-heading">
                <div>
                  <div className="workload-history-title">Published History</div>
                  <div className="workload-history-subtitle">
                    Latest {formatDate(history.latest?.generatedAt)}
                    {history.source && ` / ${history.source}`}
                  </div>
                </div>
                <span className={`workload-history-status ${(history.latest?.summary?.failed || 0) > 0 ? 'fail' : 'ok'}`}>
                  {(history.latest?.summary?.failed || 0) > 0 ? 'failing' : 'passing'}
                </span>
              </div>
              <div className="workload-history-stats">
                <span><strong>{history.files?.length || 0}</strong> runs</span>
                <span><strong>{history.latest?.summary?.passed || 0}</strong> passed</span>
                <span><strong>{history.latest?.summary?.failed || 0}</strong> failed</span>
                <span><strong>{formatDuration(history.latest?.summary?.durationMs)}</strong> latest</span>
              </div>
              {durationDeltas.length > 0 && (
                <div className="workload-history-section">
                  <span className="workload-history-label">Largest duration changes</span>
                  <div className="workload-history-pills">
                    {durationDeltas.slice(0, 3).map(delta => (
                      <span className={`workload-history-pill ${deltaTone(delta)}`} key={delta.id}>
                        <span>{delta.id}</span>
                        <strong>{formatSignedDuration(delta.deltaMs)}</strong>
                        {delta.deltaPct !== null && <em>{formatPercent(delta.deltaPct)}</em>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(history.slowestWorkloads || []).length > 0 && (
                <div className="workload-history-section">
                  <span className="workload-history-label">Slowest latest workloads</span>
                  <div className="workload-history-pills">
                    {(history.slowestWorkloads || []).slice(0, 3).map(workload => (
                      <span className={`workload-history-pill ${workload.ok ? 'neutral' : 'fail'}`} key={workload.id}>
                        <span>{workload.id}</span>
                        <strong>{formatDuration(workload.durationMs)}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(history.failures || []).length > 0 && (
                <div className="workload-history-section">
                  <span className="workload-history-label">Latest failures</span>
                  <div className="workload-history-pills">
                    {(history.failures || []).slice(0, 3).map(failure => (
                      <span className="workload-history-pill fail" key={`${failure.workload}-${failure.metric}-${failure.relationship}`}>
                        <span>{failure.workload}</span>
                        <strong>{failure.metric} {failure.relationship}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {!historyLoading && history?.available === false && (
            <div className="workload-history-empty">
              <span>{history.message || 'Published workload history is not configured.'}</span>
            </div>
          )}
          {!historyLoading && history?.available === true && !history.latest && (
            <div className="workload-history-empty">
              <span>No workload history records found.</span>
            </div>
          )}
          {hasWorkloads && (
            <div className="workload-catalog-controls">
              <div className="workload-search-field">
                <span className="workload-search-icon" aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search workloads"
                  aria-label="Search workloads"
                />
              </div>
              <div className="workload-filter-group" role="group" aria-label="Filter workloads by status">
                {([
                  ['all', 'All'],
                  ['verified', 'Verified'],
                  ['failed', 'Failed'],
                  ['unverified', 'Unverified'],
                ] as Array<[WorkloadStatusFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    className={`workload-filter-button ${statusFilter === value ? 'active' : ''}`}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    aria-pressed={statusFilter === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className={`workload-stress-toggle ${includeStress ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={includeStress}
                  disabled={loading || verifying}
                  aria-label="Include stress workloads"
                  onChange={event => onIncludeStressChange(event.target.checked)}
                />
                <span>Stress</span>
              </label>
              <select
                className="workload-filter-select"
                value={targetFilter}
                onChange={event => setTargetFilter(event.target.value)}
                aria-label="Filter workloads by hardware target"
              >
                <option value="all">All targets</option>
                {targetOptions.map(target => (
                  <option key={target} value={target}>{target}</option>
                ))}
              </select>
              <select
                className="workload-filter-select"
                value={sortBy}
                onChange={event => setSortBy(event.target.value as WorkloadSort)}
                aria-label="Sort workloads"
              >
                <option value="name">Name</option>
                <option value="target">Target</option>
                <option value="duration">Duration</option>
                <option value="checks">Checks</option>
                <option value="variants">Variants</option>
              </select>
              {hasActiveFilters && (
                <button className="btn workload-clear-filters" type="button" onClick={clearFilters}>
                  Clear
                </button>
              )}
              <span className="workload-result-count">
                {visibleWorkloads.length} / {workloads.length}
              </span>
            </div>
          )}

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

          {hasWorkloads && visibleWorkloads.length === 0 && (
            <div className="workload-empty">
              <span>No matching workloads</span>
              <button className="btn" type="button" onClick={clearFilters}>Clear filters</button>
            </div>
          )}

          {hasWorkloads && visibleWorkloads.length > 0 && <div className="workload-list">
            {visibleWorkloads.map(workload => {
              const status = statusFor(workload, verification)
              const delta = deltaByWorkload.get(workload.id)
              const timedOutVariants = variantIdsByState(status, run => Boolean(run.timeout))
              const failedVariants = variantIdsByState(status, run => !run.ok && !run.timeout)
              const statusTone = status?.ok ? 'ok' : timedOutVariants.length > 0 ? 'timeout' : 'fail'
              return (
                <div className="workload-row" key={workload.id}>
                  <div className="workload-row-main">
                    <div className="workload-row-heading">
                      <span className="workload-name">{workload.id}</span>
                      {status && (
                        <span className={`workload-status ${statusTone}`}>
                          {status.ok ? 'Verified' : timedOutVariants.length > 0 ? 'Timed out' : 'Failed'}
                        </span>
                      )}
                    </div>
                    <div className="workload-description">{workload.description}</div>
                    <div className="workload-meta">
                      <span>{workload.config}</span>
                      <span>{workload.optLevel || '-O0'}</span>
                      <span>{formatLimit(workload.limit)} events</span>
                      <span>{workload.variants.length} variants</span>
                      {isStressWorkload(workload) && (
                        <span className="workload-tag stress">stress</span>
                      )}
                      {workload.identity?.manifestSha256 && (
                        <span title={workload.identity.manifestSha256}>manifest {shortDigest(workload.identity.manifestSha256)}</span>
                      )}
                      {workload.identity?.sourceFiles[workload.example]?.sha256 && (
                        <span title={workload.identity.sourceFiles[workload.example].sha256}>source {shortDigest(workload.identity.sourceFiles[workload.example].sha256)}</span>
                      )}
                    </div>
                    <div className="workload-variants">
                      {workload.variants.map(variant => {
                        const run = status?.variants[variant.id]
                        const tone = variantRunTone(run)
                        return (
                          <code
                            className={`workload-variant ${tone}`}
                            key={variant.id}
                            title={variantRunTitle(run)}
                          >
                            <span>{variantLabel(workload, variant)}</span>
                            {run && !run.ok && (
                              <span className="workload-variant-state">
                                {run.timeout ? 'timeout' : 'failed'}
                              </span>
                            )}
                          </code>
                        )
                      })}
                    </div>
                    <div className="workload-checks">
                      {workload.expectedRelationships.map(check => {
                        const observed = status?.checks.find(item => item.metric === check.metric && item.relationship === check.relationship)
                        return (
                          <span
                            className={`workload-check ${observed ? (observed.passed ? 'ok' : 'fail') : ''}`}
                            key={`${check.metric}-${check.relationship}`}
                            title={observed?.error}
                          >
                            {check.metric} {check.relationship}
                            {observed && ` (${formatValue(observed.leftValue)} vs ${formatValue(observed.rightValue)})`}
                          </span>
                        )
                      })}
                    </div>
                    {(timedOutVariants.length > 0 || failedVariants.length > 0) && (
                      <div className="workload-run-diagnostics">
                        {timedOutVariants.length > 0 && (
                          <span className="workload-run-diagnostic timeout">
                            Timed out: {timedOutVariants.join(', ')}
                          </span>
                        )}
                        {failedVariants.length > 0 && (
                          <span className="workload-run-diagnostic fail">
                            Failed: {failedVariants.join(', ')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="workload-row-actions">
                    {status && <span className="workload-duration">{formatDuration(status.durationMs)}</span>}
                    {delta && (
                      <span
                        className={`workload-history-delta ${deltaTone(delta)}`}
                        title={`Previous ${formatDuration(delta.previousDurationMs)}, latest ${formatDuration(delta.durationMs)}`}
                      >
                        {formatSignedDuration(delta.deltaMs)}
                      </span>
                    )}
                    <button
                      className="btn"
                      onClick={() => onLoadWorkload(workload)}
                    >
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
