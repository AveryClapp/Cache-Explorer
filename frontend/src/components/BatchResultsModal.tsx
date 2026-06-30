import { formatPercent } from '../utils/formatting'
import type { CacheResult } from '../types'

interface BatchResult {
  config: string
  result: CacheResult
}

interface BatchResultsModalProps {
  results: BatchResult[]
  running: boolean
  total: number
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

export function BatchResultsModal({ results, running, total, onClose }: BatchResultsModalProps) {
  return (
    <div className="batch-modal-overlay" onClick={() => !running && onClose()}>
      <div className="batch-modal" onClick={e => e.stopPropagation()}>
        <div className="batch-modal-header">
          <span className="batch-modal-title">Hardware Comparison</span>
          <button className="batch-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="batch-modal-content">
          {running && results.length < total && (
            <div className="batch-loading">
              <span className="loading-spinner" />
              Analyzing... ({results.length}/{total} complete)
            </div>
          )}
          {results.length > 0 && (
            <table className="batch-results-table">
              <thead>
                <tr>
                  <th>Hardware</th>
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
