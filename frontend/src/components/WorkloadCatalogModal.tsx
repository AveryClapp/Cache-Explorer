import { useMemo, useState } from 'react'
import type { WorkloadSnapshot, WorkloadVerificationResponse } from '../types'

type WorkloadStatusFilter = 'all' | 'verified' | 'failed' | 'unverified'
type WorkloadSort = 'name' | 'target' | 'duration' | 'checks' | 'variants'

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

function searchableText(workload: WorkloadSnapshot) {
  return [
    workload.id,
    workload.description,
    workload.example,
    workload.config,
    workload.optLevel,
    workload.prefetch,
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
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<WorkloadStatusFilter>('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [sortBy, setSortBy] = useState<WorkloadSort>('name')
  const hasWorkloads = workloads.length > 0
  const normalizedQuery = query.trim().toLowerCase()
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
                  >
                    {label}
                  </button>
                ))}
              </div>
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
