import { formatPercent } from '../utils/formatting'
import type { CacheResult } from '../types'

interface BatchResult {
  config: string
  result: CacheResult
}

interface BatchResultsModalProps {
  results: BatchResult[]
  running: boolean
  onClose: () => void
}

export function BatchResultsModal({ results, running, onClose }: BatchResultsModalProps) {
  return (
    <div className="batch-modal-overlay" onClick={() => !running && onClose()}>
      <div className="batch-modal" onClick={e => e.stopPropagation()}>
        <div className="batch-modal-header">
          <span className="batch-modal-title">Hardware Comparison</span>
          <button className="batch-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="batch-modal-content">
          {running && results.length < 4 && (
            <div className="batch-loading">
              <span className="loading-spinner" />
              Analyzing... ({results.length}/4 complete)
            </div>
          )}
          {results.length > 0 && (
            <table className="batch-results-table">
              <thead>
                <tr>
                  <th>Hardware</th>
                  <th>L1 Hit Rate</th>
                  <th>L2 Hit Rate</th>
                  <th>Cycles</th>
                  <th>Events</th>
                </tr>
              </thead>
              <tbody>
                {results.map(({ config, result: r }) => {
                  const l1 = r.levels.l1d || r.levels.l1
                  return (
                    <tr key={config}>
                      <td className="config-name">{config.charAt(0).toUpperCase() + config.slice(1)}</td>
                      <td className={l1 && l1.hitRate > 0.9 ? 'good' : 'warning'}>{l1 ? formatPercent(l1.hitRate) : '-'}</td>
                      <td className={r.levels.l2?.hitRate && r.levels.l2.hitRate > 0.9 ? 'good' : 'warning'}>{r.levels.l2 ? formatPercent(r.levels.l2.hitRate) : '-'}</td>
                      <td>{r.timing?.totalCycles.toLocaleString() || '-'}</td>
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
