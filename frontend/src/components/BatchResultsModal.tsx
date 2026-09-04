import { formatPercent } from '../utils/formatting'
import { formatTrustLabel, provenanceClass } from '../utils/provenance'
import type { CacheResult } from '../types'

interface BatchResult {
  config: string
  result: CacheResult
}

interface BatchResultsModalProps {
  results: BatchResult[]
  error?: string | null
  running: boolean
  total: number
  onRun: () => void
  onExportCSV?: () => void
  onExportJSON?: () => void
  onClose: () => void
}

function formatHardwareName(config: string, result: CacheResult) {
  return result.profile?.displayName || config.charAt(0).toUpperCase() + config.slice(1)
}

function formatBottleneck(result: CacheResult) {
  return result.summary?.primaryBottleneck || 'unknown'
}

function formatCycles(result: CacheResult) {
  const cycles = result.summary?.estimatedCycles ?? result.timing?.totalCycles
  return cycles ? cycles.toLocaleString() : '-'
}

function formatTopSource(result: CacheResult) {
  const source = result.summary?.topSource
  if (!source) return '-'
  const file = source.file.split('/').pop() || source.file
  return `${file}:${source.line}`
}

function bottleneckClass(result: CacheResult) {
  const bottleneck = formatBottleneck(result).toLowerCase().replace(/[^a-z0-9_-]/g, '-')
  return `bottleneck-chip ${bottleneck}`
}

export function BatchResultsModal({ results, error, running, total, onRun, onExportCSV, onExportJSON, onClose }: BatchResultsModalProps) {
  const showEmptyState = !running && results.length === 0

  return (
    <div className="batch-modal-overlay product-surface-overlay" onClick={() => !running && onClose()}>
      <div
        className="batch-modal product-surface-panel"
        onClick={e => e.stopPropagation()}
        role="region"
        aria-labelledby="hardware-comparison-title"
      >
        <div className="batch-modal-header">
          <span className="batch-modal-title" id="hardware-comparison-title">Hardware Comparison</span>
          <div className="batch-modal-header-actions">
            <button className="btn-primary" onClick={onRun} disabled={running}>
              {running ? 'Comparing...' : results.length > 0 ? 'Run Again' : 'Run Comparison'}
            </button>
            {onExportCSV && (
              <button className="btn" onClick={onExportCSV} disabled={results.length === 0}>
                Export CSV
              </button>
            )}
            {onExportJSON && (
              <button className="btn" onClick={onExportJSON} disabled={results.length === 0}>
                Export JSON
              </button>
            )}
            <button className="batch-modal-close surface-back" onClick={onClose} aria-label="Close hardware comparison and return to analysis">Back to Analyze</button>
          </div>
        </div>
        <div className="batch-modal-content">
          {running && results.length < total && (
            <div className="batch-loading">
              <span className="loading-spinner" />
              Analyzing... ({results.length}/{total} complete)
            </div>
          )}
          {showEmptyState && (
            <div className={`batch-empty-state${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>
              <div className="batch-empty-title">{error ? 'No hardware results' : 'Ready to compare'}</div>
              <div className="batch-empty-desc">
                {error || 'Run the active source across the selected hardware profiles.'}
              </div>
              <div className="batch-empty-meta">{total} profiles requested</div>
            </div>
          )}
          {results.length > 0 && (
            <table className="batch-results-table">
              <thead>
                <tr>
                  <th>Hardware</th>
                  <th>Trust</th>
                  <th>Bottleneck</th>
                  <th>Cycles</th>
                  <th>L1D Hit</th>
                  <th>Top Source</th>
                  <th>Events</th>
                </tr>
              </thead>
              <tbody>
                {results.map(({ config, result: r }) => {
                  const l1 = r.levels.l1d || r.levels.l1
                  return (
                    <tr key={config}>
                      <td className="config-name">{formatHardwareName(config, r)}</td>
                      <td>
                        <span className={`provenance-inline ${provenanceClass(r.provenance)}`}>
                          {formatTrustLabel(r.provenance)}
                        </span>
                      </td>
                      <td><span className={bottleneckClass(r)}>{formatBottleneck(r)}</span></td>
                      <td>{formatCycles(r)}</td>
                      <td className={l1 && l1.hitRate > 0.9 ? 'good' : 'warning'}>{l1 ? formatPercent(l1.hitRate) : '-'}</td>
                      <td className="source-cell" title={r.summary?.topSource ? `${r.summary.topSource.file}:${r.summary.topSource.line}` : undefined}>
                        {formatTopSource(r)}
                      </td>
                      <td>{r.events.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
